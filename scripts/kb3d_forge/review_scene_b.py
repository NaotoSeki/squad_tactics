"""Compose the dense 30-hex Candidate B direction study.

This is a deterministic 2.5D review render.  It uses sprites decoded through
Panzer Strike's own renderer as terrain-language layers, not as isolated hex
exhibits.  Hexes remain logical coordinates and are intentionally invisible.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import math
from pathlib import Path
import random
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance


CANVAS_SIZE = (1600, 960)
WORLD_EXTENT_M = 72.0
ISO_ORIGIN = (800.0, 112.0)
ISO_X = 9.8
ISO_Y = 4.9
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REFERENCE_ROOT = Path("scratch/kb3d_study/ps_reference")
DEFAULT_OUTPUT = Path("scratch/kb3d_review/round2_review_candidate_b.png")
KB_SPRITES = {
    "kb_cottage": PROJECT_ROOT / "scratch/kb3d_review/multibake_cottage_beauty/round1_cottage_beauty__qp000_rp000_rot0.png",
    "kb_barn": PROJECT_ROOT / "scratch/kb3d_review/multibake_barn_curated/round1_barn_curated__qp000_rp000_rot0.png",
    "kb_farmstead": PROJECT_ROOT / "scratch/kb3d_review/multibake_farmstead_curated_clean/round1_farmstead_curated_clean__qp000_rp000_rot0.png",
}
_KB_CACHE: dict[str, Image.Image] = {}


def iso_point(x_m: float, y_m: float) -> tuple[int, int]:
    return (
        round(ISO_ORIGIN[0] + (x_m - y_m) * ISO_X),
        round(ISO_ORIGIN[1] + (x_m + y_m) * ISO_Y),
    )


def _noise_field(
    size: tuple[int, int],
    rng: np.random.Generator,
    *,
    coarse: int,
    fine: int,
) -> np.ndarray:
    width, height = size
    coarse_values = rng.normal(0.0, 1.0, (max(2, height // coarse), max(2, width // coarse)))
    fine_values = rng.normal(0.0, 1.0, (max(2, height // fine), max(2, width // fine)))
    coarse_image = Image.fromarray(
        np.uint8(np.clip(coarse_values * 32.0 + 128.0, 0.0, 255.0)),
        "L",
    ).resize(size, Image.Resampling.BICUBIC)
    fine_image = Image.fromarray(
        np.uint8(np.clip(fine_values * 32.0 + 128.0, 0.0, 255.0)),
        "L",
    ).resize(size, Image.Resampling.BILINEAR)
    return (
        (np.asarray(coarse_image, dtype=np.float32) - 128.0) * 0.65
        + (np.asarray(fine_image, dtype=np.float32) - 128.0) * 0.35
    )


def _terrain_texture(
    size: tuple[int, int],
    rng: np.random.Generator,
    base: tuple[int, int, int],
    variation: tuple[float, float, float],
) -> Image.Image:
    field = _noise_field(size, rng, coarse=54, fine=9)
    height, width = field.shape
    rgb = np.empty((height, width, 3), dtype=np.float32)
    for channel in range(3):
        rgb[:, :, channel] = base[channel] + field * variation[channel]
    flecks = rng.random((height, width))
    rgb[flecks > 0.994] += np.array([18.0, 14.0, 5.0])
    rgb[flecks < 0.004] -= np.array([14.0, 10.0, 5.0])
    return Image.fromarray(np.uint8(np.clip(rgb, 0.0, 255.0)), "RGB").convert("RGBA")


def _soft_polygon_mask(
    size: tuple[int, int],
    points: Iterable[tuple[int, int]],
    *,
    blur: float,
) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(list(points), fill=255)
    if blur:
        mask = mask.filter(ImageFilter.GaussianBlur(blur))
    return mask


def _load_kb_sprite(item_id: str) -> Image.Image:
    if item_id in _KB_CACHE:
        return _KB_CACHE[item_id]
    source = Image.open(KB_SPRITES[item_id]).convert("RGBA")
    values = np.asarray(source, dtype=np.uint8)
    max_rgb = values[:, :, :3].max(axis=2).astype(np.int16)
    source_alpha = values[:, :, 3].astype(np.int16)
    keyed_alpha = np.uint8(np.clip((max_rgb - 1) * 72, 0, 255))
    alpha = Image.fromarray(np.uint8(np.minimum(source_alpha, keyed_alpha)), "L")
    alpha = alpha.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.55))
    source.putalpha(alpha)
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("KB sprite has no keyed foreground: %s" % item_id)
    source = source.crop(bbox)
    kept_alpha = source.getchannel("A")
    graded = ImageEnhance.Brightness(source.convert("RGB")).enhance(0.86)
    graded = ImageEnhance.Color(graded).enhance(0.82)
    warm = Image.new("RGB", graded.size, (105, 78, 42))
    graded = Image.blend(graded, warm, 0.07).convert("RGBA")
    graded.putalpha(kept_alpha)
    _KB_CACHE[item_id] = graded
    return graded


def _paste_kb_sprite(
    target: Image.Image,
    item_id: str,
    anchor: tuple[int, int],
    *,
    scale: float,
    opacity: float,
) -> None:
    sprite = _load_kb_sprite(item_id)
    if abs(scale - 1.0) > 1e-6:
        sprite = sprite.resize(
            (
                max(1, round(sprite.width * scale)),
                max(1, round(sprite.height * scale)),
            ),
            Image.Resampling.LANCZOS,
        )
    if opacity < 0.999:
        sprite = _alpha_multiply(sprite, opacity)
    target.alpha_composite(
        sprite,
        (round(anchor[0] - sprite.width * 0.5), round(anchor[1] - sprite.height + 4)),
    )
def _alpha_multiply(image: Image.Image, opacity: float) -> Image.Image:
    if opacity >= 0.999:
        return image
    copy = image.copy()
    alpha = copy.getchannel("A").point(lambda value: round(value * opacity))
    copy.putalpha(alpha)
    return copy


@dataclass(frozen=True)
class SpriteFrame:
    image_path: Path
    origin_x: int
    origin_y: int
    margin: int
    format_id: int


class ReferenceLibrary:
    def __init__(self, root: Path):
        self.root = root
        self._frames: dict[tuple[str, int], SpriteFrame] = {}
        self._images: dict[Path, Image.Image] = {}

    def frame(self, item_id: str, slot: int) -> SpriteFrame:
        key = (item_id, slot)
        if key in self._frames:
            return self._frames[key]
        item_dir = self.root / item_id
        metadata_path = next(item_dir.glob("*.metadata.json"))
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        margin = int(metadata["margin_px"])
        for frame in metadata["frames"]:
            if frame["slot"] != slot:
                continue
            png_name = frame.get("png")
            if not png_name:
                raise KeyError("sprite frame not extracted: %s slot %d" % key)
            origin = frame["origin"]
            result = SpriteFrame(
                image_path=item_dir / png_name,
                origin_x=int(origin[0]),
                origin_y=int(origin[1]),
                margin=margin,
                format_id=int(frame["format_id"]),
            )
            self._frames[key] = result
            return result
        raise KeyError("sprite frame missing: %s slot %d" % key)

    def image(self, frame: SpriteFrame) -> Image.Image:
        if frame.image_path not in self._images:
            self._images[frame.image_path] = Image.open(frame.image_path).convert("RGBA")
        return self._images[frame.image_path]

    def paste(
        self,
        target: Image.Image,
        item_id: str,
        slot: int,
        anchor: tuple[int, int],
        *,
        scale: float = 1.0,
        opacity: float = 1.0,
    ) -> None:
        frame = self.frame(item_id, slot)
        sprite = self.image(frame)
        if abs(scale - 1.0) > 1e-6:
            sprite = sprite.resize(
                (
                    max(1, round(sprite.width * scale)),
                    max(1, round(sprite.height * scale)),
                ),
                Image.Resampling.LANCZOS,
            )
        if opacity < 0.999:
            sprite = _alpha_multiply(sprite, opacity)
        x = round(anchor[0] + (frame.origin_x - frame.margin) * scale)
        y = round(anchor[1] + (frame.origin_y - frame.margin) * scale)
        target.alpha_composite(sprite, (x, y))


def _map_mask() -> Image.Image:
    corners = [
        iso_point(0.0, 0.0),
        iso_point(WORLD_EXTENT_M, 0.0),
        iso_point(WORLD_EXTENT_M, WORLD_EXTENT_M),
        iso_point(0.0, WORLD_EXTENT_M),
    ]
    return _soft_polygon_mask(CANVAS_SIZE, corners, blur=3.5)


def _make_background(rng: np.random.Generator) -> tuple[Image.Image, Image.Image]:
    width, height = CANVAS_SIZE
    backdrop = _terrain_texture(CANVAS_SIZE, rng, (30, 33, 29), (0.10, 0.12, 0.09))
    map_mask = _map_mask()

    shadow_mask = Image.new("L", CANVAS_SIZE, 0)
    shadow_mask.paste(map_mask, (0, 18))
    shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(24))
    shadow = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    shadow.putalpha(shadow_mask.point(lambda value: round(value * 0.46)))
    backdrop.alpha_composite(shadow)

    ground = _terrain_texture(CANVAS_SIZE, rng, (67, 70, 43), (0.34, 0.38, 0.20))
    warm = _terrain_texture(CANVAS_SIZE, rng, (75, 66, 42), (0.20, 0.16, 0.10))
    broad = Image.fromarray(
        np.uint8(
            np.clip(
                _noise_field(CANVAS_SIZE, rng, coarse=130, fine=38) * 3.0 + 128.0,
                0.0,
                255.0,
            )
        ),
        "L",
    ).filter(ImageFilter.GaussianBlur(14))
    warm.putalpha(Image.composite(map_mask, Image.new("L", CANVAS_SIZE, 0), broad))
    ground.alpha_composite(_alpha_multiply(warm, 0.28))
    ground.putalpha(map_mask)
    backdrop.alpha_composite(ground)
    return backdrop, map_mask


def _parcel_layer(
    canvas: Image.Image,
    rng: np.random.Generator,
    polygon_world: list[tuple[float, float]],
    base: tuple[int, int, int],
) -> Image.Image:
    points = [iso_point(x, y) for x, y in polygon_world]
    mask = _soft_polygon_mask(CANVAS_SIZE, points, blur=2.4)
    texture = _terrain_texture(CANVAS_SIZE, rng, base, (0.34, 0.25, 0.14))
    texture.putalpha(mask)
    canvas.alpha_composite(texture)
    return mask


def _draw_organic_road(
    canvas: Image.Image,
    rng: np.random.Generator,
    world_path: list[tuple[float, float]],
) -> list[tuple[int, int]]:
    points = [iso_point(x, y) for x, y in world_path]
    shoulder = Image.new("L", CANVAS_SIZE, 0)
    core = Image.new("L", CANVAS_SIZE, 0)
    ImageDraw.Draw(shoulder).line(points, fill=238, width=66, joint="curve")
    ImageDraw.Draw(core).line(points, fill=245, width=43, joint="curve")

    edge_noise = _noise_field(CANVAS_SIZE, rng, coarse=36, fine=7)
    shoulder_values = np.asarray(shoulder, dtype=np.float32)
    core_values = np.asarray(core, dtype=np.float32)
    shoulder_values = np.clip(shoulder_values + edge_noise * 2.1 - 24.0, 0.0, 255.0)
    core_values = np.clip(core_values + edge_noise * 1.2 - 10.0, 0.0, 255.0)
    shoulder_mask = Image.fromarray(np.uint8(shoulder_values), "L").filter(
        ImageFilter.GaussianBlur(1.2)
    )
    core_mask = Image.fromarray(np.uint8(core_values), "L").filter(
        ImageFilter.GaussianBlur(0.6)
    )

    shoulder_texture = _terrain_texture(CANVAS_SIZE, rng, (79, 69, 45), (0.34, 0.27, 0.15))
    shoulder_texture.putalpha(shoulder_mask)
    canvas.alpha_composite(shoulder_texture)

    road_texture = _terrain_texture(CANVAS_SIZE, rng, (106, 88, 57), (0.42, 0.32, 0.18))
    road_texture.putalpha(core_mask)
    canvas.alpha_composite(road_texture)

    rut_layer = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    rut_draw = ImageDraw.Draw(rut_layer)
    for offset, color, width in ((-9, (55, 48, 34, 105), 3), (9, (55, 48, 34, 105), 3)):
        shifted: list[tuple[int, int]] = []
        for index, point in enumerate(points):
            before = points[max(0, index - 1)]
            after = points[min(len(points) - 1, index + 1)]
            dx = after[0] - before[0]
            dy = after[1] - before[1]
            length = max(1.0, math.hypot(dx, dy))
            shifted.append(
                (
                    round(point[0] - dy / length * offset),
                    round(point[1] + dx / length * offset),
                )
            )
        rut_draw.line(shifted, fill=color, width=width, joint="curve")
    rut_layer = rut_layer.filter(ImageFilter.GaussianBlur(0.55))
    canvas.alpha_composite(rut_layer)
    return points


def _paste_field_rows(
    lib: ReferenceLibrary,
    ground: Image.Image,
    parcel_mask: Image.Image,
    placements: list[tuple[str, int, tuple[float, float], float]],
) -> None:
    rows = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    for item_id, slot, world, scale in placements:
        lib.paste(rows, item_id, slot, iso_point(*world), scale=scale, opacity=0.92)
    rows.putalpha(Image.composite(rows.getchannel("A"), Image.new("L", CANVAS_SIZE, 0), parcel_mask))
    ground.alpha_composite(rows)


def _soft_object_shadow(
    layer: Image.Image,
    anchor: tuple[int, int],
    *,
    width: int,
    height: int,
    opacity: int,
) -> None:
    shadow = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    x, y = anchor
    draw.ellipse(
        (x - width // 4, y - height // 2, x + width, y + height // 2),
        fill=(12, 14, 11, opacity),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(3, height // 3)))
    layer.alpha_composite(shadow)


@dataclass(frozen=True)
class ObjectPlacement:
    item_id: str
    slot: int
    world: tuple[float, float]
    scale: float = 1.0
    opacity: float = 1.0
    kind: str = "detail"
    shadow: tuple[int, int, int] | None = None


def compose(reference_root: Path, output_path: Path) -> dict[str, object]:
    rng = np.random.default_rng(41027)
    py_rng = random.Random(41027)
    lib = ReferenceLibrary(reference_root)
    canvas, map_mask = _make_background(rng)
    ground = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))

    grass_items = [
        ("grass_base_a", 0),
        ("grass_base_a", 1),
        ("grass_base_b", 0),
        ("grass_base_b", 1),
        ("grass_flowers", 0),
    ]
    grass_world = [
        (8, 9), (31, 8), (56, 10), (11, 29), (34, 27),
        (58, 31), (8, 53), (30, 55), (57, 58),
    ]
    for index, world in enumerate(grass_world):
        item_id, slot = grass_items[index % len(grass_items)]
        lib.paste(
            ground,
            item_id,
            slot,
            iso_point(*world),
            scale=1.06 + (index % 3) * 0.04,
            opacity=0.70 if "flowers" not in item_id else 0.54,
        )

    village_yards = [
        ("yard_a", (18, 25), 1.04),
        ("yard_b", (34, 29), 1.00),
        ("ground_patch", (25, 44), 1.08),
        ("yard_entrance", (45, 48), 0.95),
    ]
    for item_id, world, scale in village_yards:
        lib.paste(ground, item_id, 0, iso_point(*world), scale=scale, opacity=0.90)

    soil_places = [
        ("soil_a", (20, 31), 1.0),
        ("soil_b", (41, 36), 0.92),
        ("soil_c", (49, 53), 1.05),
        ("forest_floor", (7, 21), 1.16),
        ("forest_floor", (63, 18), 1.10),
    ]
    for item_id, world, scale in soil_places:
        lib.paste(ground, item_id, 0, iso_point(*world), scale=scale, opacity=0.80)

    field_mask_a = _parcel_layer(
        ground,
        rng,
        [(43, 7), (70, 8), (70, 28), (46, 31)],
        (87, 72, 44),
    )
    field_mask_b = _parcel_layer(
        ground,
        rng,
        [(43, 48), (69, 42), (71, 69), (47, 71)],
        (91, 71, 41),
    )
    _paste_field_rows(
        lib,
        ground,
        field_mask_a,
        [
            ("field_a", 0, (51, 15), 1.08),
            ("field_b", 0, (61, 18), 1.04),
            ("field_c", 0, (55, 25), 1.08),
            ("field_a", 0, (66, 26), 0.92),
        ],
    )
    _paste_field_rows(
        lib,
        ground,
        field_mask_b,
        [
            ("field_c", 0, (51, 54), 1.12),
            ("field_b", 0, (61, 55), 1.04),
            ("field_a", 0, (54, 64), 1.08),
            ("field_c", 0, (66, 65), 0.98),
        ],
    )

    road_world = [
        (3, 8), (12, 12), (22, 18), (26, 29), (31, 38),
        (43, 44), (55, 51), (63, 60), (70, 67),
    ]
    road_points = _draw_organic_road(ground, rng, road_world)
    road_sprites = [
        ("road_cap", (7, 10), 0.90, 0.72),
        ("road_straight", (20, 19), 0.84, 0.62),
        ("road_curve_a", (28, 31), 0.82, 0.68),
        ("road_straight", (43, 44), 0.83, 0.60),
        ("road_curve_a", (56, 53), 0.76, 0.58),
    ]
    for item_id, world, scale, opacity in road_sprites:
        lib.paste(ground, item_id, 0, iso_point(*world), scale=scale, opacity=opacity)

    lib.paste(ground, "crater_light", 0, iso_point(30.5, 37.0), scale=1.03, opacity=0.95)
    lib.paste(ground, "crater_heavy", 0, iso_point(57.5, 56.5), scale=0.94, opacity=0.90)
    for slot, world in zip((0, 8, 16, 24), ((18, 17), (22, 22), (38, 42), (42, 45))):
        lib.paste(ground, "tank_tracks", slot, iso_point(*world), scale=1.0, opacity=0.72)

    ground.putalpha(Image.composite(ground.getchannel("A"), Image.new("L", CANVAS_SIZE, 0), map_mask))
    canvas.alpha_composite(ground)

    object_layer = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    placements: list[ObjectPlacement] = []

    tree_cycle = [
        "tree_oak", "tree_linden", "tree_willow", "tree_poplar",
        "tree_robinia", "tree_fir", "tree_spruce", "tree_blossom",
    ]
    tree_world = [
        (4, 17), (8, 25), (13, 18), (4, 42), (10, 58), (17, 65),
        (60, 5), (67, 12), (70, 23), (65, 34), (8, 68), (59, 68),
        (38, 11), (49, 37),
    ]
    for index, world in enumerate(tree_world):
        placements.append(
            ObjectPlacement(
                tree_cycle[index % len(tree_cycle)],
                2,
                world,
                scale=(0.92, 1.00, 1.07)[index % 3],
                kind="tree",
                shadow=(55, 19, 75),
            )
        )

    crop_world_a = [(49 + col * 3.6, 12 + row * 4.0) for row in range(4) for col in range(5)]
    crop_world_b = [(49 + col * 3.8, 51 + row * 4.3) for row in range(4) for col in range(5)]
    for index, world in enumerate(crop_world_a):
        placements.append(
            ObjectPlacement(
                "sunflower",
                2,
                world,
                scale=0.92 + (index % 3) * 0.04,
                kind="crop",
            )
        )
    for index, world in enumerate(crop_world_b):
        placements.append(
            ObjectPlacement(
                "wheat_ripe",
                2,
                world,
                scale=0.92 + (index % 2) * 0.05,
                kind="crop",
            )
        )

    structures = [
        ObjectPlacement("house_rural", 5, (24, 44), 0.94, kind="structure"),
    ]
    structure_shadows = {"house_rural": 10}
    for structure in structures:
        placements.append(
            ObjectPlacement(
                structure.item_id,
                structure_shadows[structure.item_id],
                structure.world,
                scale=structure.scale,
                opacity=0.82,
                kind="structure_shadow",
            )
        )
        placements.append(structure)

    placements.extend(
        [
            ObjectPlacement(
                "kb_cottage", 0, (14, 25), 1.05, kind="structure", shadow=(82, 24, 88)
            ),
            ObjectPlacement(
                "kb_barn", 0, (39, 20), 1.08, kind="structure", shadow=(68, 20, 84)
            ),
            ObjectPlacement(
                "kb_farmstead", 0, (44, 51), 0.88, kind="structure", shadow=(96, 28, 92)
            ),
        ]
    )

    detail_specs = [
        ("washing", 2, (10.0, 29.0), 0.96),
        ("well", 2, (20.5, 30.0), 0.94),
        ("woodpile", 2, (34.0, 24.0), 0.96),
        ("cart", 2, (42.0, 27.0), 0.96),
        ("compose_farm_a", 1, (21.0, 47.0), 0.92),
        ("compose_farm_b", 2, (46.0, 55.0), 0.96),
        ("barrel", 2, (35.0, 22.0), 0.92),
        ("bench", 2, (28.0, 41.0), 0.94),
    ]
    for item_id, slot, world, scale in detail_specs:
        placements.append(ObjectPlacement(item_id, slot, world, scale=scale, kind="life"))

    fence_world = [
        (14, 21), (21, 20), (29, 22), (39, 25),
        (16, 35), (23, 36), (33, 39), (44, 42),
        (45, 12), (55, 9), (66, 10), (46, 31),
        (47, 47), (58, 44), (68, 45), (48, 69),
    ]
    fence_slots = (24, 28, 32, 36, 40, 44, 48, 52)
    for index, world in enumerate(fence_world):
        placements.append(
            ObjectPlacement(
                "fences",
                fence_slots[index % len(fence_slots)],
                world,
                scale=1.02,
                kind="fence",
            )
        )

    small_items = [
        ("bush_big", 2), ("bush_medium", 0), ("bush_small", 0),
        ("flower_phlox", 0), ("flower_phlox", 1), ("flower_primula", 0),
        ("fern", 2),
    ]
    protected = [(14, 25), (39, 20), (24, 44), (44, 51)]
    for _ in range(62):
        x = py_rng.uniform(3.0, 69.0)
        y = py_rng.uniform(5.0, 69.0)
        if any(math.hypot(x - px, y - py) < 5.0 for px, py in protected):
            continue
        item_id, slot = small_items[py_rng.randrange(len(small_items))]
        placements.append(
            ObjectPlacement(
                item_id,
                slot,
                (x, y),
                scale=py_rng.uniform(0.88, 1.08),
                opacity=py_rng.uniform(0.78, 1.0),
                kind="understory",
            )
        )

    placements.sort(key=lambda item: (iso_point(*item.world)[1], item.kind != "structure_shadow"))
    counts: dict[str, int] = {}
    for placement in placements:
        anchor = iso_point(*placement.world)
        if placement.shadow:
            _soft_object_shadow(
                object_layer,
                anchor,
                width=placement.shadow[0],
                height=placement.shadow[1],
                opacity=placement.shadow[2],
            )
        if placement.item_id in KB_SPRITES:
            _paste_kb_sprite(
                object_layer,
                placement.item_id,
                anchor,
                scale=placement.scale,
                opacity=placement.opacity,
            )
        else:
            lib.paste(
                object_layer,
                placement.item_id,
                placement.slot,
                anchor,
                scale=placement.scale,
                opacity=placement.opacity,
            )
        counts[placement.kind] = counts.get(placement.kind, 0) + 1

    object_layer.putalpha(
        Image.composite(
            object_layer.getchannel("A"),
            Image.new("L", CANVAS_SIZE, 0),
            map_mask,
        )
    )
    canvas.alpha_composite(object_layer)

    grade = Image.new("RGBA", CANVAS_SIZE, (112, 82, 42, 12))
    canvas.alpha_composite(grade)
    final = ImageEnhance.Contrast(canvas.convert("RGB")).enhance(1.035)
    final = ImageEnhance.Color(final).enhance(0.94)
    final = final.filter(ImageFilter.UnsharpMask(radius=0.8, percent=55, threshold=3))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    final.save(output_path, quality=96)
    metrics = {
        "schema": "squad-tactics.review-scene-b/v1",
        "scene": "round2.panzer-language.30hex",
        "logical_hex_count": 30,
        "visible_hex_lines": 0,
        "canvas": list(CANVAS_SIZE),
        "seed": 41027,
        "object_counts": counts,
        "ground_layers": {
            "grass_patches": len(grass_world),
            "yard_patches": len(village_yards),
            "soil_patches": len(soil_places),
            "field_parcels": 2,
            "field_row_overlays": 8,
            "road_control_points": len(road_points),
            "road_sprite_overlays": len(road_sprites),
            "contextual_craters": 2,
            "track_marks": 4,
        },
        "principles": [
            "world-space composition before any hex clipping",
            "buildings placed with yard, access, fence, life props, vegetation, and shadow",
            "organic road shoulders and ruts",
            "damage remains subordinate to living terrain",
            "Panzer Strike ground vocabulary at native visual scale",
        ],
    }
    metrics_path = output_path.with_suffix(".metrics.json")
    metrics_path.write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return metrics


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-root", type=Path, default=DEFAULT_REFERENCE_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    metrics = compose(args.reference_root, args.output)
    print(
        "REVIEW_SCENE_B OK output=%s objects=%d hex_lines=0"
        % (
            args.output.resolve(),
            sum(metrics["object_counts"].values()),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
