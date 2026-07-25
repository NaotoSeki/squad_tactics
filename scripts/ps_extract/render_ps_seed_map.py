#!/usr/bin/env python3
"""Compose a new PS-style scene from measured building-centred map clusters."""

from __future__ import annotations

import argparse
from collections import Counter
import json
import math
from pathlib import Path
import random
from typing import Any

from PIL import Image

from render_ps_native_crop import (
    DEFAULT_GROUND,
    SpriteIndex,
    resolve_fence_layers,
    stamp_entry,
)


DEFAULT_ANCHORS = (
    (330, 310),
    (130, 310),
    (330, 110),
    (330, 510),
    (530, 310),
)
GROUND_FILL_FAMILIES = {
    "terrain",
    "grass",
    "ground_feature",
    "ground_spot",
}
SALT_PEPPER_FOLIAGE_REPLACEMENTS = {
    "shrub_carpinus-betulus_b_01": "shrub_syringa-vulgaris_a_01",
    "shrub_carpinus-betulus_b_02": "shrub_syringa-vulgaris_b_02",
    "shrub_carpinus-betulus_b_03": "shrub_syringa-vulgaris_a_01",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--grammar", type=Path, required=True)
    parser.add_argument("--canonical-root", type=Path, required=True)
    parser.add_argument("--canonical-manifest", type=Path, required=True)
    parser.add_argument("--legacy-catalog", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260724)
    parser.add_argument("--radius", type=int, default=180)
    parser.add_argument("--ground-radius", type=int, default=360)
    parser.add_argument("--width", type=int, default=1000)
    parser.add_argument("--height", type=int, default=640)
    parser.add_argument("--map-height", type=int, default=12)
    return parser.parse_args()


def squared_distance(placement: dict[str, Any]) -> int:
    return int(placement["dx"]) ** 2 + int(placement["dy"]) ** 2


def cluster_is_usable(cluster: dict[str, Any]) -> bool:
    rings = cluster["cumulative_rings"]["160"]
    return (
        12 <= float(cluster["nearest_road"]) <= 115
        and 1 <= int(rings.get("building", 0)) <= 2
        and int(rings.get("road", 0)) >= 3
    )


def choose_clusters(
    clusters: list[dict[str, Any]],
    seed: int,
) -> list[dict[str, Any]]:
    """Choose a church/house/farm/support mix without copying one source block."""
    rng = random.Random(seed)
    usable = [cluster for cluster in clusters if cluster_is_usable(cluster)]
    churches = [
        cluster
        for cluster in usable
        if "kirche" in str(cluster["building_asset"]).casefold()
    ]
    houses = [
        cluster
        for cluster in usable
        if "_house_" in str(cluster["building_asset"]).casefold()
    ]
    field_barns = [
        cluster
        for cluster in usable
        if "_barn_" in str(cluster["building_asset"]).casefold()
        and int(cluster["cumulative_rings"]["160"].get("field", 0)) >= 2
    ]
    support = [
        cluster
        for cluster in usable
        if int(cluster["cumulative_rings"]["160"].get("fence", 0)) >= 8
    ]

    selected: list[dict[str, Any]] = []

    def add_from(pool: list[dict[str, Any]]) -> None:
        available = [
            cluster
            for cluster in pool
            if cluster["building_order"]
            not in {item["building_order"] for item in selected}
        ]
        if not available:
            return
        rng.shuffle(available)
        selected.append(available[0])

    add_from(churches)
    add_from(houses)
    add_from(field_barns)
    add_from(support)
    add_from(support)
    while len(selected) < len(DEFAULT_ANCHORS):
        add_from(usable)
    return selected[: len(DEFAULT_ANCHORS)]


def screen_point(x: int, y: int, map_height: int) -> tuple[int, int]:
    return x - y + map_height * 40, (x + y) // 2


def translated_cluster(
    cluster: dict[str, Any],
    destination: tuple[int, int],
    cluster_index: int,
    radius: int,
    ground_radius: int,
    map_height: int,
    all_destinations: tuple[tuple[int, int], ...],
) -> list[dict[str, Any]]:
    """Keep the measured core plus its nearest neighbouring building."""
    anchor_x, anchor_y = destination
    anchor_screen_x, anchor_screen_y = screen_point(
        anchor_x,
        anchor_y,
        map_height,
    )
    result = [
        {
            "source": "MAP_BUILDINGS",
            "catalog": 7,
            "asset_index": -1,
            "asset": cluster["building_asset"],
            "family": "building",
            "x": anchor_x,
            "y": anchor_y,
            "screen_x": anchor_screen_x,
            "screen_y": anchor_screen_y,
            "extra": cluster["orientation_raw"],
            "cluster_index": cluster_index,
            "is_anchor": True,
        }
    ]

    destination_screens = [
        screen_point(x, y, map_height)
        for x, y in all_destinations
    ]
    within = []
    for placement in cluster["placements"]:
        distance_squared = squared_distance(placement)
        in_core = distance_squared <= radius * radius
        in_ground_shell = (
            placement["source"] == "MAP_DECORS"
            and placement["family"] in GROUND_FILL_FAMILIES
            and distance_squared <= ground_radius * ground_radius
        )
        if not in_core and not in_ground_shell:
            continue
        if in_ground_shell and not in_core:
            screen_dx, screen_dy = placement["screen_offset"]
            translated_screen = (
                anchor_screen_x + int(screen_dx),
                anchor_screen_y + int(screen_dy),
            )
            owner = min(
                range(len(destination_screens)),
                key=lambda index: (
                    translated_screen[0] - destination_screens[index][0]
                )
                ** 2
                + (
                    translated_screen[1] - destination_screens[index][1]
                )
                ** 2,
            )
            if owner != cluster_index:
                continue
        within.append(placement)
    neighbours = sorted(
        (
            placement
            for placement in within
            if placement["source"] == "MAP_BUILDINGS"
        ),
        key=squared_distance,
    )
    nearest_building = neighbours[0] if neighbours else None
    for placement in within:
        if (
            placement["source"] == "MAP_BUILDINGS"
            and placement is not nearest_building
        ):
            continue
        dx = int(placement["dx"])
        dy = int(placement["dy"])
        screen_dx, screen_dy = placement["screen_offset"]
        result.append(
            {
                **placement,
                "x": anchor_x + dx,
                "y": anchor_y + dy,
                "screen_x": anchor_screen_x + int(screen_dx),
                "screen_y": anchor_screen_y + int(screen_dy),
                "cluster_index": cluster_index,
                "is_anchor": False,
            }
        )
    return result


def replace_salt_pepper_foliage(
    placements: list[dict[str, Any]],
) -> list[dict[str, str]]:
    replacements: list[dict[str, str]] = []
    for placement in placements:
        asset = str(placement["asset"]).casefold()
        replacement = SALT_PEPPER_FOLIAGE_REPLACEMENTS.get(asset)
        if replacement is None:
            continue
        placements_asset = str(placement["asset"])
        placement["asset"] = replacement
        replacements.append(
            {
                "from": placements_asset,
                "to": replacement,
            }
        )
    return replacements


def keep_noncolliding_buildings(
    placements: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Protect anchors; reject only transplanted neighbours that collide."""
    anchors = [
        placement
        for placement in placements
        if placement["source"] == "MAP_BUILDINGS"
        and placement["is_anchor"]
    ]
    accepted = list(anchors)
    neighbours = [
        placement
        for placement in placements
        if placement["source"] == "MAP_BUILDINGS"
        and not placement["is_anchor"]
    ]
    for placement in neighbours:
        if all(
            math.hypot(
                int(placement["screen_x"]) - int(existing["screen_x"]),
                int(placement["screen_y"]) - int(existing["screen_y"]),
            )
            >= 82
            for existing in accepted
        ):
            accepted.append(placement)
    accepted_ids = {id(placement) for placement in accepted}
    return [
        placement
        for placement in placements
        if placement["source"] != "MAP_BUILDINGS"
        or id(placement) in accepted_ids
    ]


def deduplicate(
    placements: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    seen: set[tuple[Any, ...]] = set()
    result: list[dict[str, Any]] = []
    for placement in placements:
        key = (
            placement["source"],
            placement["asset"],
            int(placement["x"]),
            int(placement["y"]),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(placement)
    return result


def render(
    placements: list[dict[str, Any]],
    sprites: SpriteIndex,
    width: int,
    height: int,
) -> tuple[Image.Image, Image.Image, Image.Image, Counter[str]]:
    missing: Counter[str] = Counter()
    background = Image.new("RGBA", (width, height), DEFAULT_GROUND)
    low = background.copy()
    low_placements = sorted(
        (
            placement
            for placement in placements
            if placement["source"] == "MAP_DECORS"
        ),
        key=lambda placement: (
            int(placement["catalog"]),
            int(placement["cluster_index"]),
            int(placement["screen_y"]),
        ),
    )
    for placement in low_placements:
        resolved = sprites.resolve(str(placement["asset"]))
        if resolved is None:
            missing[str(placement["asset"])] += 1
            continue
        body, shadow = resolved
        if shadow is not None:
            stamp_entry(
                low,
                sprites,
                shadow,
                int(placement["screen_x"]),
                int(placement["screen_y"]),
                0,
                0,
            )
        stamp_entry(
            low,
            sprites,
            body,
            int(placement["screen_x"]),
            int(placement["screen_y"]),
            0,
            0,
        )

    fence_asset = "village_fence_frontage"
    fence_points = {
        (int(placement["x"]), int(placement["y"]))
        for placement in placements
        if str(placement["asset"]).casefold() == fence_asset
    }
    resolved_tall: list[
        tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]
    ] = []
    for placement in placements:
        if placement["source"] not in ("MAP_OBJECTS", "MAP_BUILDINGS"):
            continue
        asset = str(placement["asset"])
        if asset.casefold() == fence_asset:
            bodies, shadows = resolve_fence_layers(
                sprites,
                asset,
                int(placement["x"]),
                int(placement["y"]),
                fence_points,
            )
        else:
            resolved = (
                sprites.resolve_building_intact(asset)
                if placement["source"] == "MAP_BUILDINGS"
                else sprites.resolve_object_runtime(
                    asset,
                    int(placement.get("extra", 0)),
                )
            )
            if resolved is None:
                missing[asset] += 1
                continue
            body, shadow = resolved
            bodies = [body]
            shadows = [shadow] if shadow is not None else []
        if not bodies:
            missing[asset] += 1
            continue
        resolved_tall.append((placement, bodies, shadows))

    resolved_tall.sort(
        key=lambda item: (
            int(item[0]["screen_y"]),
            1 if item[0]["source"] == "MAP_BUILDINGS" else 0,
            int(item[0]["cluster_index"]),
        )
    )
    shadow_layer = low.copy()
    for placement, _, shadows in resolved_tall:
        for shadow in shadows:
            stamp_entry(
                shadow_layer,
                sprites,
                shadow,
                int(placement["screen_x"]),
                int(placement["screen_y"]),
                0,
                0,
            )

    final = shadow_layer.copy()
    for placement, bodies, _ in resolved_tall:
        for body in bodies:
            stamp_entry(
                final,
                sprites,
                body,
                int(placement["screen_x"]),
                int(placement["screen_y"]),
                0,
                0,
            )
    return low, shadow_layer, final, missing


def main() -> int:
    args = parse_args()
    report = json.loads(args.grammar.read_text(encoding="utf-8"))
    map_report = report["maps"][0]
    selected = choose_clusters(map_report["building_clusters"], args.seed)
    if len(selected) != len(DEFAULT_ANCHORS):
        raise RuntimeError("not enough usable building clusters")

    placements: list[dict[str, Any]] = []
    for index, (cluster, anchor) in enumerate(
        zip(selected, DEFAULT_ANCHORS, strict=True)
    ):
        placements.extend(
            translated_cluster(
                cluster,
                anchor,
                index,
                args.radius,
                args.ground_radius,
                args.map_height,
                DEFAULT_ANCHORS,
            )
        )
    placements = deduplicate(keep_noncolliding_buildings(placements))
    foliage_replacements = replace_salt_pepper_foliage(placements)

    sprites = SpriteIndex(
        args.canonical_root,
        args.canonical_manifest,
        args.legacy_catalog,
    )
    low, shadows, final, missing = render(
        placements,
        sprites,
        args.width,
        args.height,
    )
    flat_background_pixels = sum(
        1
        for pixel in final.get_flattened_data()
        if pixel == DEFAULT_GROUND
    )
    flat_background_fraction = flat_background_pixels / (
        args.width * args.height
    )
    args.out_dir.mkdir(parents=True, exist_ok=True)
    prefix = (
        f"ps_cluster_seed_{args.seed}_r{args.radius}"
        f"_g{args.ground_radius}_v2"
    )
    low_path = args.out_dir / f"{prefix}_low.png"
    shadow_path = args.out_dir / f"{prefix}_shadows.png"
    final_path = args.out_dir / f"{prefix}_native.png"
    ledger_path = args.out_dir / f"{prefix}_ledger.json"
    low.convert("RGB").save(low_path, optimize=True)
    shadows.convert("RGB").save(shadow_path, optimize=True)
    final.convert("RGB").save(final_path, optimize=True)

    payload = {
        "schema": "ps-cluster-seed-map-v2",
        "seed": args.seed,
        "source_grammar": str(args.grammar),
        "render_contract": {
            "assets": "canonical PS SSC slots",
            "resampling": "none",
            "building_state": "intact state zero",
            "fences": "post plus authored half-connections",
            "local_grammar": (
                f"measured building clusters, radius {args.radius}, "
                "one nearest neighbouring building retained"
            ),
            "ground_grammar": (
                f"Voronoi-stitched measured low-layer shells, radius "
                f"{args.ground_radius}, families "
                f"{sorted(GROUND_FILL_FAMILIES)}"
            ),
            "foliage_quality_gate": (
                "isolated high-frequency carpinus cutouts are replaced by "
                "lower-contrast PS syringa shrubs"
            ),
            "novelty": (
                "clusters sampled from distinct source anchors and transplanted "
                "to a new five-anchor layout"
            ),
            "global_brightness": "not synthesized in seed v1",
        },
        "selected_clusters": [
            {
                "destination_anchor": list(anchor),
                "building_order": cluster["building_order"],
                "building_asset": cluster["building_asset"],
                "source_anchor": cluster["logical_anchor"],
                "nearest_building": cluster["nearest_building"],
                "nearest_road": cluster["nearest_road"],
            }
            for cluster, anchor in zip(selected, DEFAULT_ANCHORS, strict=True)
        ],
        "counts": {
            "placements": len(placements),
            "by_family": dict(
                sorted(Counter(item["family"] for item in placements).items())
            ),
            "missing_instances": sum(missing.values()),
            "foliage_replacements": len(foliage_replacements),
            "flat_background_pixels": flat_background_pixels,
            "flat_background_fraction": round(flat_background_fraction, 6),
        },
        "foliage_replacement_pairs": {
            f"{source} -> {target}": count
            for (source, target), count in sorted(
                Counter(
                    (item["from"], item["to"])
                    for item in foliage_replacements
                ).items()
            )
        },
        "missing_assets": dict(missing.most_common()),
        "outputs": {
            "low": low_path.name,
            "shadows": shadow_path.name,
            "native": final_path.name,
        },
        "placements": placements,
    }
    ledger_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(ledger_path.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
