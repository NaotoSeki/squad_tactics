#!/usr/bin/env python3
"""Render a native Panzer Strike PSM crop from confirmed placement records."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import struct
from typing import Any

from PIL import Image, ImageDraw

from psm_inspect import (
    decompress_members,
    find_member,
    parse_assets,
    parse_map_info,
    parse_records,
    sized_block,
)


DECOR_RECORD = struct.Struct("<BHII")
OBJECT_RECORD = struct.Struct("<BHIII")
BUILDING_RECORD = struct.Struct("<HIII")
DEFAULT_GROUND = (74, 88, 58, 255)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--psm", type=Path, required=True)
    parser.add_argument("--canonical-root", type=Path, required=True)
    parser.add_argument("--canonical-manifest", type=Path, required=True)
    parser.add_argument("--legacy-catalog", type=Path, required=True)
    parser.add_argument(
        "--reference-psm",
        type=Path,
        help=(
            "Optional pristine map. When rendering a save, exact object-to-decor "
            "migrations are resolved as flattened/destroyed states."
        ),
    )
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--crop-x", type=int, required=True)
    parser.add_argument("--crop-y", type=int, required=True)
    parser.add_argument("--width", type=int, default=960)
    parser.add_argument("--height", type=int, default=640)
    parser.add_argument("--margin", type=int, default=360)
    parser.add_argument(
        "--projection",
        choices=("logical", "isometric"),
        default="logical",
        help="Interpret PSM x/y directly or project the logical grid to PS screen space.",
    )
    return parser.parse_args()


def decode_map(path: Path) -> dict[str, Any]:
    members = decompress_members(path.read_bytes())
    info_member = find_member(members, "MAP_INFO")
    map_member = find_member(members, "MAP_CELLS")
    version, width, height = parse_map_info(info_member)
    return {
        "version": version,
        "width": width,
        "height": height,
        "assets": parse_assets(map_member),
        "decors": parse_records(
            sized_block(map_member, "MAP_DECORS"),
            DECOR_RECORD,
        ),
        "objects": parse_records(
            sized_block(map_member, "MAP_OBJECTS"),
            OBJECT_RECORD,
        ),
        "buildings": parse_records(
            sized_block(map_member, "MAP_BUILDINGS"),
            BUILDING_RECORD,
        ),
        "brightness": sized_block(map_member, "MAP_BRIGHTNESS"),
        "tiles": sized_block(map_member, "MAP_TILES"),
    }


def canonical_name(entry: dict[str, Any]) -> str:
    return Path(entry["ssc"]).stem.casefold()


class SpriteIndex:
    def __init__(
        self,
        canonical_root: Path,
        canonical_manifest: Path,
        legacy_catalog: Path,
    ) -> None:
        self.root = canonical_root
        manifest = json.loads(
            canonical_manifest.read_text(encoding="utf-8")
        )
        self.canonical: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for entry in manifest["sprites"]:
            self.canonical[canonical_name(entry)].append(entry)
        for entries in self.canonical.values():
            entries.sort(key=lambda item: int(item["slot"]))

        legacy = json.loads(legacy_catalog.read_text(encoding="utf-8"))
        self.legacy = {
            str(entry.get("name", "")).casefold(): entry
            for entry in legacy.values()
            if entry.get("name")
        }
        self.cache: dict[str, Image.Image] = {}

    def image(self, entry: dict[str, Any]) -> Image.Image:
        path = self.root / Path(entry["png"])
        key = str(path)
        if key not in self.cache:
            self.cache[key] = Image.open(path).convert("RGBA")
        return self.cache[key]

    def _entry_for_slot(
        self,
        entries: list[dict[str, Any]],
        slot: int,
    ) -> dict[str, Any] | None:
        return next(
            (entry for entry in entries if int(entry["slot"]) == slot),
            None,
        )

    def slots(
        self,
        asset_name: str,
        slot_numbers: list[int],
    ) -> list[dict[str, Any]]:
        entries = self.canonical.get(asset_name.casefold(), [])
        by_slot = {int(entry["slot"]): entry for entry in entries}
        return [
            by_slot[slot]
            for slot in slot_numbers
            if slot in by_slot
        ]

    def resolve(
        self,
        asset_name: str,
    ) -> tuple[dict[str, Any], dict[str, Any] | None] | None:
        key = asset_name.casefold()
        entries = self.canonical.get(key)
        if not entries:
            return None

        legacy = self.legacy.get(key, {})
        primary_slot = legacy.get("primary_slot")
        body: dict[str, Any] | None = None
        if primary_slot is not None:
            body = self._entry_for_slot(entries, int(primary_slot))
        if body is None:
            body = next(
                (
                    entry
                    for entry in entries
                    if int(entry.get("format_id", 0)) != 934
                ),
                entries[0],
            )

        shadow_slots = sorted(
            int(slot["slot"])
            for slot in legacy.get("slots", [])
            if slot.get("is_shadow")
        )
        shadow = (
            self._entry_for_slot(entries, shadow_slots[0])
            if shadow_slots
            else next(
                (
                    entry
                    for entry in entries
                    if int(entry.get("format_id", 0)) == 934
                ),
                None,
            )
        )
        return body, shadow

    def resolve_building_intact(
        self,
        asset_name: str,
    ) -> tuple[dict[str, Any], dict[str, Any] | None] | None:
        return self.resolve_building_state(asset_name, 0)

    def resolve_building_state(
        self,
        asset_name: str,
        state: int,
    ) -> tuple[dict[str, Any], dict[str, Any] | None] | None:
        """Resolve aligned building body/shadow arrays for damage state 0..N."""
        entries = self.canonical.get(asset_name.casefold())
        if not entries:
            return None
        shadow_slots = sorted(
            int(entry["slot"])
            for entry in entries
            if int(entry.get("format_id", 0)) == 934
        )
        if not shadow_slots:
            return self.resolve(asset_name)
        state = min(max(0, state), len(shadow_slots) - 1)
        body_slot = shadow_slots[0] - len(shadow_slots) + state
        body = self._entry_for_slot(entries, body_slot)
        shadow = self._entry_for_slot(entries, shadow_slots[0] + state)
        if body is None:
            return self.resolve(asset_name)
        return body, shadow

    def resolve_object_runtime(
        self,
        asset_name: str,
        extra: int,
    ) -> tuple[dict[str, Any], dict[str, Any] | None] | None:
        """Resolve PS standing objects; saved records expose body slot in byte 3."""
        entries = self.canonical.get(asset_name.casefold())
        if not entries:
            return None
        requested_slot = (extra >> 24) & 0xFF
        if requested_slot == 0:
            requested_slot = 2
        body = self._entry_for_slot(entries, requested_slot)
        if body is None or int(body.get("format_id", 0)) == 934:
            return self.resolve(asset_name)
        shadow = next(
            (
                entry
                for entry in entries
                if int(entry.get("format_id", 0)) == 934
            ),
            None,
        )
        return body, shadow

    def resolve_flattened(
        self,
        asset_name: str,
    ) -> tuple[dict[str, Any], None] | None:
        """Resolve the ground/flattened body used after object-to-decor migration."""
        entries = self.canonical.get(asset_name.casefold())
        if not entries:
            return None
        body = self._entry_for_slot(entries, 1)
        if body is None or int(body.get("format_id", 0)) == 934:
            resolved = self.resolve(asset_name)
            return (resolved[0], None) if resolved is not None else None
        return body, None


def project_point(
    x: int,
    y: int,
    *,
    map_height: int,
    projection: str,
) -> tuple[int, int]:
    if projection == "isometric":
        return (
            x - y + map_height * 40,
            (x + y) // 2,
        )
    return x, y


def stable_variant(x: int, y: int, count: int = 4) -> int:
    """Choose a repeatable visual variant when the PSM stores no variant id."""
    grid_x = x // 40
    grid_y = y // 40
    return ((grid_x * 3) ^ (grid_y * 5) ^ (grid_x * grid_y)) % count


def migrated_object_counter(
    pristine: dict[str, Any],
    saved: dict[str, Any],
) -> Counter[tuple[str, int, int]]:
    """Return exact saved decor additions that were pristine standing objects."""
    pristine_assets = pristine["assets"]
    saved_assets = saved["assets"]
    pristine_decors = Counter(
        (pristine_assets[catalog][asset_index], x, y)
        for catalog, asset_index, x, y in pristine["decors"]
    )
    saved_decors = Counter(
        (saved_assets[catalog][asset_index], x, y)
        for catalog, asset_index, x, y in saved["decors"]
    )
    pristine_objects = Counter(
        (pristine_assets[catalog][asset_index], x, y)
        for catalog, asset_index, x, y, _ in pristine["objects"]
    )
    saved_objects = Counter(
        (saved_assets[catalog][asset_index], x, y)
        for catalog, asset_index, x, y, _ in saved["objects"]
    )
    return (saved_decors - pristine_decors) & (
        pristine_objects - saved_objects
    )


def resolve_fence_layers(
    sprites: SpriteIndex,
    asset_name: str,
    x: int,
    y: int,
    fence_points: set[tuple[int, int]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Compose the intact post and one half-fence for every connected neighbor."""
    variant = stable_variant(x, y)
    directions = (
        (40, 0),
        (0, 40),
        (-40, 0),
        (0, -40),
    )
    body_slots = [
        64 + direction * 4 + variant
        for direction, (dx, dy) in enumerate(directions)
        if (x + dx, y + dy) in fence_points
    ]
    body_slots.append(56 + variant)
    shadow_slots = [slot + 56 for slot in body_slots]
    return (
        sprites.slots(asset_name, body_slots),
        sprites.slots(asset_name, shadow_slots),
    )


def alpha_stamp(
    canvas: Image.Image,
    sprite: Image.Image,
    left: int,
    top: int,
) -> bool:
    right = left + sprite.width
    bottom = top + sprite.height
    clip_left = max(0, left)
    clip_top = max(0, top)
    clip_right = min(canvas.width, right)
    clip_bottom = min(canvas.height, bottom)
    if clip_left >= clip_right or clip_top >= clip_bottom:
        return False

    source = sprite.crop(
        (
            clip_left - left,
            clip_top - top,
            clip_right - left,
            clip_bottom - top,
        )
    )
    canvas.alpha_composite(source, (clip_left, clip_top))
    return True


def stamp_entry(
    canvas: Image.Image,
    index: SpriteIndex,
    entry: dict[str, Any],
    world_x: int,
    world_y: int,
    crop_x: int,
    crop_y: int,
) -> bool:
    sprite = index.image(entry)
    left = world_x + int(entry["origin_x"]) - crop_x
    top = world_y + int(entry["origin_y"]) - crop_y
    return alpha_stamp(canvas, sprite, left, top)


def anchor_in_margin(
    x: int,
    y: int,
    crop: tuple[int, int, int, int],
    margin: int,
) -> bool:
    left, top, right, bottom = crop
    return (
        left - margin <= x <= right + margin
        and top - margin <= y <= bottom + margin
    )


def brightness_mask(
    values: bytes,
    map_width: int,
    map_height: int,
    crop_x: int,
    crop_y: int,
    width: int,
    height: int,
) -> Image.Image:
    """Bilinearly project the (w+1)x(h+1) vertex field to screen pixels."""
    stride = map_width + 1
    offset_x = map_height * 40
    pixels: list[int] = []
    for screen_y in range(crop_y, crop_y + height):
        logical_sum = screen_y * 2
        for screen_x in range(crop_x, crop_x + width):
            logical_difference = screen_x - offset_x
            logical_x = (logical_difference + logical_sum) / 2.0
            logical_y = (logical_sum - logical_difference) / 2.0
            grid_x = logical_x / 40.0
            grid_y = logical_y / 40.0
            if (
                grid_x < 0
                or grid_y < 0
                or grid_x > map_width
                or grid_y > map_height
            ):
                pixels.append(0)
                continue
            x0 = min(map_width, max(0, int(grid_x)))
            y0 = min(map_height, max(0, int(grid_y)))
            x1 = min(map_width, x0 + 1)
            y1 = min(map_height, y0 + 1)
            tx = grid_x - x0
            ty = grid_y - y0
            top = values[y0 * stride + x0] * (1.0 - tx) + values[
                y0 * stride + x1
            ] * tx
            bottom = values[y1 * stride + x0] * (1.0 - tx) + values[
                y1 * stride + x1
            ] * tx
            pixels.append(round(top * (1.0 - ty) + bottom * ty))
    mask = Image.new("L", (width, height))
    mask.putdata(pixels)
    return mask


def placement_payload(
    source: str,
    catalog: int,
    asset_index: int,
    asset_name: str,
    x: int,
    y: int,
    extra: int,
    bodies: list[dict[str, Any]],
    shadows: list[dict[str, Any]],
    screen_x: int,
    screen_y: int,
) -> dict[str, Any]:
    body = bodies[-1]
    shadow = shadows[-1] if shadows else None
    return {
        "source": source,
        "catalog": catalog,
        "asset_index": asset_index,
        "asset": asset_name,
        "x": x,
        "y": y,
        "screen_x": screen_x,
        "screen_y": screen_y,
        "extra": extra,
        "body_slot": int(body["slot"]),
        "body_png": body["png"],
        "body_origin": [int(body["origin_x"]), int(body["origin_y"])],
        "composite_body_slots": [int(entry["slot"]) for entry in bodies],
        "shadow_slot": int(shadow["slot"]) if shadow else None,
        "shadow_png": shadow["png"] if shadow else None,
        "composite_shadow_slots": [int(entry["slot"]) for entry in shadows],
        "shadow_origin": (
            [int(shadow["origin_x"]), int(shadow["origin_y"])]
            if shadow
            else None
        ),
    }


def main() -> None:
    args = parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    decoded = decode_map(args.psm)
    migrated = (
        migrated_object_counter(
            decode_map(args.reference_psm),
            decoded,
        )
        if args.reference_psm
        else Counter()
    )
    migrated_total = sum(migrated.values())
    sprites = SpriteIndex(
        args.canonical_root,
        args.canonical_manifest,
        args.legacy_catalog,
    )

    crop = (
        args.crop_x,
        args.crop_y,
        args.crop_x + args.width,
        args.crop_y + args.height,
    )
    background = Image.new(
        "RGBA",
        (args.width, args.height),
        DEFAULT_GROUND,
    )
    low_only = background.copy()
    assets = decoded["assets"]
    missing: Counter[str] = Counter()
    used: list[dict[str, Any]] = []
    low_count = 0
    map_height = int(decoded["height"])
    fence_asset = "village_fence_frontage"

    decor_rows: list[tuple[int, int, int, int, int, int, int]] = []
    for order, row in enumerate(decoded["decors"]):
        catalog, asset_index, x, y = row
        screen_x, screen_y = project_point(
            x,
            y,
            map_height=map_height,
            projection=args.projection,
        )
        if anchor_in_margin(screen_x, screen_y, crop, args.margin):
            decor_rows.append(
                (catalog, order, asset_index, x, y, screen_x, screen_y)
            )

    # Catalog index is the confirmed PS low-layer family order.
    for (
        catalog,
        order,
        asset_index,
        x,
        y,
        screen_x,
        screen_y,
    ) in sorted(decor_rows):
        asset_name = assets[catalog][asset_index]
        migrated_key = (asset_name, x, y)
        is_migrated = migrated[migrated_key] > 0
        if is_migrated:
            migrated[migrated_key] -= 1
        if is_migrated and asset_name.casefold() == fence_asset:
            debris_slot = 24 + stable_variant(x, y, 32)
            debris = sprites.slots(asset_name, [debris_slot])
            resolved = (debris[0], None) if debris else None
        elif is_migrated:
            resolved = sprites.resolve_flattened(asset_name)
        else:
            resolved = sprites.resolve(asset_name)
        if resolved is None:
            missing[asset_name] += 1
            continue
        body, shadow = resolved
        bodies = [body]
        shadows = [shadow] if shadow is not None else []
        if shadow is not None:
            stamp_entry(
                low_only,
                sprites,
                shadow,
                screen_x,
                screen_y,
                args.crop_x,
                args.crop_y,
            )
        visible = stamp_entry(
            low_only,
            sprites,
            body,
            screen_x,
            screen_y,
            args.crop_x,
            args.crop_y,
        )
        if visible:
            low_count += 1
            used.append(
                placement_payload(
                    "MAP_DECORS",
                    catalog,
                    asset_index,
                    asset_name,
                    x,
                    y,
                    order,
                    bodies,
                    shadows,
                    screen_x,
                    screen_y,
                )
            )

    shadow_layer = low_only.copy()
    fence_points = {
        (x, y)
        for catalog, asset_index, x, y, _ in decoded["objects"]
        if assets[catalog][asset_index].casefold() == fence_asset
    }
    tall_rows: list[tuple[int, int, int, int, int, int, int, int, str, int]] = []
    for order, row in enumerate(decoded["objects"]):
        catalog, asset_index, x, y, extra = row
        screen_x, screen_y = project_point(
            x,
            y,
            map_height=map_height,
            projection=args.projection,
        )
        if anchor_in_margin(screen_x, screen_y, crop, args.margin):
            tall_rows.append(
                (
                    screen_y,
                    0,
                    order,
                    catalog,
                    asset_index,
                    x,
                    y,
                    screen_x,
                    "MAP_OBJECTS",
                    extra,
                )
            )
    for order, row in enumerate(decoded["buildings"]):
        asset_index, x, y, orientation = row
        screen_x, screen_y = project_point(
            x,
            y,
            map_height=map_height,
            projection=args.projection,
        )
        if anchor_in_margin(screen_x, screen_y, crop, args.margin):
            tall_rows.append(
                (
                    screen_y,
                    1,
                    order,
                    7,
                    asset_index,
                    x,
                    y,
                    screen_x,
                    "MAP_BUILDINGS",
                    orientation,
                )
            )

    resolved_tall: list[
        tuple[
            tuple[int, int, int, int, int, int, int, int, str, int],
            str,
            list[dict[str, Any]],
            list[dict[str, Any]],
        ]
    ] = []
    for row in tall_rows:
        (
            screen_y,
            type_order,
            order,
            catalog,
            asset_index,
            x,
            y,
            screen_x,
            source,
            extra,
        ) = row
        asset_name = assets[catalog][asset_index]
        if source == "MAP_OBJECTS" and asset_name.casefold() == fence_asset:
            bodies, shadows = resolve_fence_layers(
                sprites,
                asset_name,
                x,
                y,
                fence_points,
            )
            if not bodies:
                missing[asset_name] += 1
                continue
            resolved_tall.append((row, asset_name, bodies, shadows))
            continue
        resolved = (
            sprites.resolve_building_state(
                asset_name,
                (extra >> 21) & 0x03,
            )
            if source == "MAP_BUILDINGS"
            else sprites.resolve_object_runtime(asset_name, extra)
        )
        if resolved is None:
            missing[asset_name] += 1
            continue
        body, shadow = resolved
        resolved_tall.append(
            (
                row,
                asset_name,
                [body],
                [shadow] if shadow is not None else [],
            )
        )

    # PS shadows are independent SSC slots and live below Y-sorted bodies.
    for row, asset_name, bodies, shadows in sorted(
        resolved_tall,
        key=lambda item: item[0][:3],
    ):
        if not shadows:
            continue
        screen_y, _, _, _, _, _, _, screen_x, _, _ = row
        for shadow in shadows:
            stamp_entry(
                shadow_layer,
                sprites,
                shadow,
                screen_x,
                screen_y,
                args.crop_x,
                args.crop_y,
            )

    final = shadow_layer.copy()
    tall_count = 0
    for row, asset_name, bodies, shadows in sorted(
        resolved_tall,
        key=lambda item: item[0][:3],
    ):
        (
            screen_y,
            _,
            order,
            catalog,
            asset_index,
            x,
            y,
            screen_x,
            source,
            extra,
        ) = row
        visible = False
        for body in bodies:
            visible = (
                stamp_entry(
                    final,
                    sprites,
                    body,
                    screen_x,
                    screen_y,
                    args.crop_x,
                    args.crop_y,
                )
                or visible
            )
        if not visible:
            continue
        tall_count += 1
        used.append(
            placement_payload(
                source,
                catalog,
                asset_index,
                asset_name,
                x,
                y,
                extra,
                bodies,
                shadows,
                screen_x,
                screen_y,
            )
        )

    anchor_overlay = final.copy()
    anchor_draw = ImageDraw.Draw(anchor_overlay, "RGBA")
    source_colors = {
        "MAP_DECORS": (246, 209, 84, 235),
        "MAP_OBJECTS": (87, 205, 255, 235),
        "MAP_BUILDINGS": (255, 79, 72, 245),
    }
    for placement in used:
        screen_x = int(placement["screen_x"]) - args.crop_x
        screen_y = int(placement["screen_y"]) - args.crop_y
        if not (0 <= screen_x < args.width and 0 <= screen_y < args.height):
            continue
        color = source_colors[placement["source"]]
        radius = 4 if placement["source"] == "MAP_BUILDINGS" else 2
        anchor_draw.line(
            (
                screen_x - radius,
                screen_y,
                screen_x + radius,
                screen_y,
            ),
            fill=color,
            width=1,
        )
        anchor_draw.line(
            (
                screen_x,
                screen_y - radius,
                screen_x,
                screen_y + radius,
            ),
            fill=color,
            width=1,
        )

    projection_tag = "iso" if args.projection == "isometric" else "logical"
    prefix = (
        f"{args.psm.stem}_{projection_tag}_x{args.crop_x}_y{args.crop_y}"
    )
    low_path = args.out_dir / f"{prefix}_low.png"
    shadow_path = args.out_dir / f"{prefix}_shadows.png"
    final_path = args.out_dir / f"{prefix}_native.png"
    anchor_path = args.out_dir / f"{prefix}_anchors.png"
    brightness_path = args.out_dir / f"{prefix}_brightness.png"
    dark_path = args.out_dir / f"{prefix}_native_brightness_dark.png"
    light_path = args.out_dir / f"{prefix}_native_brightness_light.png"
    audit_path = args.out_dir / f"{prefix}_audit.json"
    low_only.save(low_path, optimize=True)
    shadow_layer.save(shadow_path, optimize=True)
    final.convert("RGB").save(final_path, optimize=True)
    anchor_overlay.convert("RGB").save(anchor_path, optimize=True)
    if args.projection == "isometric":
        projected_brightness = brightness_mask(
            decoded["brightness"],
            int(decoded["width"]),
            int(decoded["height"]),
            args.crop_x,
            args.crop_y,
            args.width,
            args.height,
        )
        projected_brightness.point(lambda value: round(value * 255 / 45)).save(
            brightness_path,
            optimize=True,
        )
        black = Image.new("RGBA", final.size, (0, 0, 0, 0))
        black.putalpha(projected_brightness)
        dark = final.copy()
        dark.alpha_composite(black)
        dark.convert("RGB").save(dark_path, optimize=True)
        white = Image.new("RGBA", final.size, (255, 255, 255, 0))
        white.putalpha(projected_brightness)
        light = final.copy()
        light.alpha_composite(white)
        light.convert("RGB").save(light_path, optimize=True)

    audit = {
        "schema": "ps-native-crop-render-v2",
        "source": str(args.psm),
        "map_version": decoded["version"],
        "declared_grid": [decoded["width"], decoded["height"]],
        "logical_extent": [decoded["width"] * 40, decoded["height"] * 40],
        "screen_extent": (
            [
                (decoded["width"] + decoded["height"]) * 40,
                (decoded["width"] + decoded["height"]) * 20,
            ]
            if args.projection == "isometric"
            else [decoded["width"] * 40, decoded["height"] * 40]
        ),
        "crop": {
            "x": args.crop_x,
            "y": args.crop_y,
            "width": args.width,
            "height": args.height,
            "coordinate_space": args.projection,
            "scale": "native SSC pixels; no resampling",
        },
        "render_contract": {
            "resampling": "none",
            "position": (
                "isometric PSM projection + authored SSC origin"
                if args.projection == "isometric"
                else "logical PSM position + authored SSC origin"
            ),
            "low_order": "MAP_DECORS catalog then serialized order",
            "shadow_order": "all independent shadow slots below tall bodies",
            "tall_order": "screen y, then object/building, then serialized order",
            "fence_connections": (
                "intact post plus one authored half-fence per cardinal PSM neighbor"
            ),
            "fence_variant": "deterministic coordinate hash; exact PS selector unresolved",
            "building_state": (
                "bits 21..22 select aligned body/shadow damage state"
            ),
            "building_orientation": "recorded but not yet applied",
            "standing_object_slot": (
                "saved high byte when present, otherwise runtime default slot 2"
            ),
            "flattened_objects": (
                "exact reference-object to saved-decor migrations use ground "
                "slot 1; migrated fences use authored debris slots 24..55"
                if args.reference_psm
                else "not classified without --reference-psm"
            ),
            "brightness": "not yet applied",
            "base_tiles": "flat PS grass plus MAP_DECORS; MAP_TILES unresolved",
        },
        "counts": {
            "low_visible": low_count,
            "tall_visible": tall_count,
            "placements_audited": len(used),
            "missing_instances": sum(missing.values()),
            "missing_unique": len(missing),
            "flattened_migrations": migrated_total,
        },
        "missing_assets": dict(missing.most_common()),
        "placements": used,
        "outputs": {
            "low": low_path.name,
            "shadows": shadow_path.name,
            "native": final_path.name,
            "anchors": anchor_path.name,
            "brightness": (
                brightness_path.name
                if args.projection == "isometric"
                else None
            ),
            "brightness_dark_candidate": (
                dark_path.name if args.projection == "isometric" else None
            ),
            "brightness_light_candidate": (
                light_path.name if args.projection == "isometric" else None
            ),
        },
    }
    audit_path.write_text(
        json.dumps(audit, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(audit_path)


if __name__ == "__main__":
    main()
