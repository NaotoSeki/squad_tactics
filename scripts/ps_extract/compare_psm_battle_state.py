#!/usr/bin/env python3
"""Compare a pristine PS map with a battle save and expose persistent changes."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import struct
from typing import Any

from psm_inspect import decompress_members, find_member, sized_block
from render_ps_native_crop import decode_map, migrated_object_counter, project_point


MISSION_TAGS = (
    "MISSION_HANDLES",
    "MISSION_PLAYERS",
    "MISSION_UNIT_ASSETS",
    "MISSION_UNITS",
    "MISSION_UNITS_COMPONENTS",
    "MISSION_BUILDINGS",
    "MISSION_BUILDINGS_COMPONENTS",
    "MISSION_MINES",
    "MISSION_SCRIPTS",
    "MISSION_MEMORIES",
    "MISSION_SHOTS",
    "MISSION_EXPLOSIONS",
    "MISSION_TRASSERS",
    "MISSION_ANIMATIONS",
    "MISSION_CORPSES",
    "MISSION_STATISTICS",
    "MISSION_SCROLL",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pristine", type=Path, required=True)
    parser.add_argument("--saved", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def object_counter(decoded: dict[str, Any]) -> Counter[tuple[str, int, int]]:
    assets = decoded["assets"]
    return Counter(
        (assets[catalog][asset_index], x, y)
        for catalog, asset_index, x, y, _ in decoded["objects"]
    )


def decor_counter(decoded: dict[str, Any]) -> Counter[tuple[str, int, int]]:
    assets = decoded["assets"]
    return Counter(
        (assets[catalog][asset_index], x, y)
        for catalog, asset_index, x, y in decoded["decors"]
    )


def family(asset: str) -> str:
    name = asset.casefold()
    if "fence" in name:
        return "fence"
    if name.startswith("tracks_"):
        return "track"
    if name.startswith("crater_"):
        return "crater"
    if name.startswith("wheat_"):
        return "wheat"
    if name.startswith("sunflower_"):
        return "sunflower"
    if name.startswith(("flower_", "plant_")):
        return "flower"
    if name.startswith(("shrub_", "bush_")):
        return "shrub"
    return name.split("_", 1)[0]


def mission_blocks(saved_path: Path) -> dict[str, Any]:
    members = decompress_members(saved_path.read_bytes())
    member = find_member(members, "MISSION_SCROLL")
    result: dict[str, Any] = {}
    for tag in MISSION_TAGS:
        try:
            payload = sized_block(member, tag)
        except ValueError:
            continue
        item: dict[str, Any] = {"bytes": len(payload)}
        if len(payload) >= 4:
            item["leading_u32"] = struct.unpack_from("<I", payload)[0]
        result[tag] = item

    scroll = sized_block(member, "MISSION_SCROLL")
    if len(scroll) >= 8:
        logical_x, logical_y = struct.unpack_from("<II", scroll)
        result["MISSION_SCROLL"]["logical_xy"] = [logical_x, logical_y]
    return result


def building_records(
    decoded: dict[str, Any],
) -> dict[tuple[str, int, int], int]:
    assets = decoded["assets"]
    return {
        (assets[7][asset_index], x, y): raw
        for asset_index, x, y, raw in decoded["buildings"]
    }


def main() -> int:
    args = parse_args()
    pristine = decode_map(args.pristine)
    saved = decode_map(args.saved)
    pristine_decors = decor_counter(pristine)
    saved_decors = decor_counter(saved)
    pristine_objects = object_counter(pristine)
    saved_objects = object_counter(saved)
    decor_added = saved_decors - pristine_decors
    decor_removed = pristine_decors - saved_decors
    object_removed = pristine_objects - saved_objects
    object_added = saved_objects - pristine_objects
    migrated = migrated_object_counter(pristine, saved)
    disappeared = object_removed - migrated

    pristine_buildings = building_records(pristine)
    saved_buildings = building_records(saved)
    changed_buildings = []
    transition_counts: Counter[tuple[int, int]] = Counter()
    for key in sorted(pristine_buildings.keys() & saved_buildings.keys()):
        before = pristine_buildings[key]
        after = saved_buildings[key]
        if before == after:
            continue
        before_state = (before >> 21) & 0x03
        after_state = (after >> 21) & 0x03
        transition_counts[(before_state, after_state)] += 1
        asset, x, y = key
        screen_x, screen_y = project_point(
            x,
            y,
            map_height=int(saved["height"]),
            projection="isometric",
        )
        changed_buildings.append(
            {
                "asset": asset,
                "logical_xy": [x, y],
                "screen_xy": [screen_x, screen_y],
                "raw_before": before,
                "raw_after": after,
                "raw_before_hex": f"0x{before:08x}",
                "raw_after_hex": f"0x{after:08x}",
                "damage_state_before": before_state,
                "damage_state_after": after_state,
            }
        )

    catalog_additions = {}
    for catalog, (before_group, after_group) in enumerate(
        zip(pristine["assets"], saved["assets"], strict=True)
    ):
        additions = [
            asset
            for asset in after_group
            if asset not in set(before_group)
        ]
        if additions:
            catalog_additions[str(catalog)] = {
                "count": len(additions),
                "by_family": dict(
                    sorted(Counter(family(asset) for asset in additions).items())
                ),
                "assets": additions,
            }

    saved_object_extras = Counter(
        extra for _, _, _, _, extra in saved["objects"]
    )
    saved_object_body_slots = Counter(
        (extra >> 24) & 0xFF for extra in saved_object_extras.elements()
    )
    mission = mission_blocks(args.saved)
    scroll_xy = mission.get("MISSION_SCROLL", {}).get("logical_xy")
    if scroll_xy:
        scroll_screen = project_point(
            int(scroll_xy[0]),
            int(scroll_xy[1]),
            map_height=int(saved["height"]),
            projection="isometric",
        )
        mission["MISSION_SCROLL"]["screen_xy"] = list(scroll_screen)

    payload = {
        "schema": "ps-battlefield-state-diff-v1",
        "pristine": str(args.pristine),
        "saved": str(args.saved),
        "map_counts": {
            "pristine": {
                "decors": len(pristine["decors"]),
                "objects": len(pristine["objects"]),
                "buildings": len(pristine["buildings"]),
            },
            "saved": {
                "decors": len(saved["decors"]),
                "objects": len(saved["objects"]),
                "buildings": len(saved["buildings"]),
            },
        },
        "asset_catalog_additions": catalog_additions,
        "persistent_map_delta": {
            "decor_added": sum(decor_added.values()),
            "decor_removed": sum(decor_removed.values()),
            "object_added": sum(object_added.values()),
            "object_removed": sum(object_removed.values()),
            "object_to_decor_migrations": sum(migrated.values()),
            "migrations_by_family": dict(
                sorted(
                    Counter(
                        family(asset)
                        for (asset, _, _), count in migrated.items()
                        for _ in range(count)
                    ).items()
                )
            ),
            "objects_disappeared_without_decor": sum(disappeared.values()),
            "disappeared_by_family": dict(
                sorted(
                    Counter(
                        family(asset)
                        for (asset, _, _), count in disappeared.items()
                        for _ in range(count)
                    ).items()
                )
            ),
        },
        "saved_object_runtime": {
            "extra_values": {
                f"0x{value:08x}": count
                for value, count in sorted(saved_object_extras.items())
            },
            "body_slot_high_byte_counts": {
                str(slot): count
                for slot, count in sorted(saved_object_body_slots.items())
            },
        },
        "building_delta": {
            "count_unchanged": len(pristine["buildings"])
            == len(saved["buildings"]),
            "changed_records": len(changed_buildings),
            "damage_state_transitions": {
                f"{before}->{after}": count
                for (before, after), count in sorted(transition_counts.items())
            },
            "records": changed_buildings,
        },
        "mission_blocks": mission,
        "confirmed_interpretation": [
            (
                "Standing vegetation/props crushed during battle are removed "
                "from MAP_OBJECTS. Exactly matching asset/x/y records are "
                "appended to MAP_DECORS for flattened ground-layer rendering."
            ),
            (
                "Objects without a persistent flattened representation are "
                "removed from MAP_OBJECTS without a replacement decor."
            ),
            (
                "Buildings keep stable identity and coordinates; bits 21..22 "
                "select aligned SSC damage body/shadow states."
            ),
            (
                "The save contains dedicated mission blocks for corpses, "
                "shots, explosions, animations, units, and camera scroll."
            ),
        ],
        "open_questions": [
            (
                "The observed 2048 object-to-decor migrations may be a fixed "
                "capacity, but one save is insufficient to prove the cap."
            ),
            (
                "Tracks/craters are added to the save asset catalog; their "
                "placement owner inside mission state is not decoded yet."
            ),
            (
                "Corpse and vehicle-wreck record layouts inside "
                "MISSION_CORPSES remain to be decoded."
            ),
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
