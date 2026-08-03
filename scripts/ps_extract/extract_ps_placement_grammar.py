#!/usr/bin/env python3
"""Extract building-centred placement grammar from confirmed PS map records."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
import math
from pathlib import Path
from statistics import median
from typing import Any, Iterable

from render_ps_native_crop import decode_map


CATALOG_LABELS = {
    0: "terrain",
    1: "grass",
    2: "ground_feature",
    3: "small_prop",
    4: "vegetation",
    5: "fence",
    6: "large_prop",
    7: "building",
    8: "unused",
    9: "tree",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("psm", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--radius", type=int, default=320)
    parser.add_argument("--bucket-size", type=int, default=160)
    return parser.parse_args()


def family_for(asset: str, catalog: int, source: str) -> str:
    name = asset.casefold()
    if source == "MAP_BUILDINGS":
        return "building"
    if name.startswith("road_"):
        return "road"
    if name.startswith("field_"):
        return "field"
    if name.startswith("terrain_"):
        return "terrain"
    if name.startswith("grass_"):
        return "grass"
    if "fence" in name:
        return "fence"
    if name.startswith(("spot_", "land_")):
        return "ground_spot"
    if name.startswith(("tracks_", "crater_")):
        return "battle_mark"
    if name.startswith(("shrub_", "bush_")):
        return "shrub"
    if name.startswith(("plant_", "flower_")):
        return "flower"
    if catalog == 9:
        return "tree"
    if catalog == 6:
        return "large_prop"
    if catalog in (3, 4):
        return "small_prop"
    return CATALOG_LABELS.get(catalog, "other")


def screen_offset(dx: int, dy: int) -> list[int]:
    return [dx - dy, (dx + dy) // 2]


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * fraction
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return round(ordered[lower], 2)
    weight = index - lower
    return round(
        ordered[lower] * (1.0 - weight) + ordered[upper] * weight,
        2,
    )


def distribution(values: Iterable[int | float]) -> dict[str, Any]:
    samples = [float(value) for value in values]
    if not samples:
        return {"count": 0}
    return {
        "count": len(samples),
        "min": round(min(samples), 2),
        "p25": percentile(samples, 0.25),
        "median": round(median(samples), 2),
        "p75": percentile(samples, 0.75),
        "p90": percentile(samples, 0.90),
        "max": round(max(samples), 2),
        "mean": round(sum(samples) / len(samples), 2),
    }


class SpatialIndex:
    def __init__(self, placements: list[dict[str, Any]], bucket_size: int) -> None:
        self.bucket_size = bucket_size
        self.buckets: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
        for placement in placements:
            key = (
                int(placement["x"]) // bucket_size,
                int(placement["y"]) // bucket_size,
            )
            self.buckets[key].append(placement)

    def within(
        self,
        x: int,
        y: int,
        radius: int,
    ) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        bucket_radius = math.ceil(radius / self.bucket_size)
        center_x = x // self.bucket_size
        center_y = y // self.bucket_size
        radius_squared = radius * radius
        for by in range(center_y - bucket_radius, center_y + bucket_radius + 1):
            for bx in range(center_x - bucket_radius, center_x + bucket_radius + 1):
                for placement in self.buckets.get((bx, by), []):
                    dx = int(placement["x"]) - x
                    dy = int(placement["y"]) - y
                    if dx * dx + dy * dy <= radius_squared:
                        result.append(placement)
        return result


def decoded_placements(decoded: dict[str, Any]) -> list[dict[str, Any]]:
    assets = decoded["assets"]
    placements: list[dict[str, Any]] = []
    for order, (catalog, asset_index, x, y) in enumerate(decoded["decors"]):
        asset = assets[catalog][asset_index]
        placements.append(
            {
                "source": "MAP_DECORS",
                "order": order,
                "catalog": catalog,
                "asset_index": asset_index,
                "asset": asset,
                "family": family_for(asset, catalog, "MAP_DECORS"),
                "x": x,
                "y": y,
                "extra": 0,
            }
        )
    for order, (catalog, asset_index, x, y, extra) in enumerate(decoded["objects"]):
        asset = assets[catalog][asset_index]
        placements.append(
            {
                "source": "MAP_OBJECTS",
                "order": order,
                "catalog": catalog,
                "asset_index": asset_index,
                "asset": asset,
                "family": family_for(asset, catalog, "MAP_OBJECTS"),
                "x": x,
                "y": y,
                "extra": extra,
            }
        )
    for order, (asset_index, x, y, orientation) in enumerate(decoded["buildings"]):
        asset = assets[7][asset_index]
        placements.append(
            {
                "source": "MAP_BUILDINGS",
                "order": order,
                "catalog": 7,
                "asset_index": asset_index,
                "asset": asset,
                "family": "building",
                "x": x,
                "y": y,
                "extra": orientation,
            }
        )
    return placements


def nearest_distance(
    center: dict[str, Any],
    candidates: Iterable[dict[str, Any]],
) -> float | None:
    distances = []
    for candidate in candidates:
        if candidate is center:
            continue
        dx = int(candidate["x"]) - int(center["x"])
        dy = int(candidate["y"]) - int(center["y"])
        distances.append(math.hypot(dx, dy))
    return min(distances) if distances else None


def extract_map(path: Path, radius: int, bucket_size: int) -> dict[str, Any]:
    decoded = decode_map(path)
    placements = decoded_placements(decoded)
    index = SpatialIndex(placements, bucket_size)
    buildings = [
        placement
        for placement in placements
        if placement["source"] == "MAP_BUILDINGS"
    ]
    roads = [placement for placement in placements if placement["family"] == "road"]
    clusters: list[dict[str, Any]] = []

    for building in buildings:
        nearby = index.within(int(building["x"]), int(building["y"]), radius)
        nearby.sort(
            key=lambda item: (
                (int(item["x"]) - int(building["x"])) ** 2
                + (int(item["y"]) - int(building["y"])) ** 2,
                item["source"],
                int(item["order"]),
            )
        )
        counts = Counter(item["family"] for item in nearby if item is not building)
        rings: dict[str, dict[str, int]] = {}
        for ring_radius in (80, 160, 240, radius):
            ring_counts: Counter[str] = Counter()
            limit = ring_radius * ring_radius
            for item in nearby:
                if item is building:
                    continue
                dx = int(item["x"]) - int(building["x"])
                dy = int(item["y"]) - int(building["y"])
                if dx * dx + dy * dy <= limit:
                    ring_counts[item["family"]] += 1
            rings[str(ring_radius)] = dict(sorted(ring_counts.items()))

        cluster_placements = []
        for item in nearby:
            if item is building:
                continue
            dx = int(item["x"]) - int(building["x"])
            dy = int(item["y"]) - int(building["y"])
            cluster_placements.append(
                {
                    "source": item["source"],
                    "catalog": item["catalog"],
                    "asset_index": item["asset_index"],
                    "asset": item["asset"],
                    "family": item["family"],
                    "dx": dx,
                    "dy": dy,
                    "screen_offset": screen_offset(dx, dy),
                    "extra": item["extra"],
                }
            )

        clusters.append(
            {
                "building_order": building["order"],
                "building_asset": building["asset"],
                "logical_anchor": [building["x"], building["y"]],
                "orientation_raw": building["extra"],
                "nearest_building": (
                    round(nearest_distance(building, buildings) or 0.0, 2)
                ),
                "nearest_road": (
                    round(nearest_distance(building, roads) or 0.0, 2)
                ),
                "family_counts": dict(sorted(counts.items())),
                "cumulative_rings": rings,
                "placements": cluster_placements,
            }
        )

    family_counts = Counter(item["family"] for item in placements)
    nearest_buildings = [
        cluster["nearest_building"]
        for cluster in clusters
        if cluster["nearest_building"] > 0
    ]
    nearest_roads = [
        cluster["nearest_road"]
        for cluster in clusters
        if cluster["nearest_road"] > 0
    ]
    local_distributions = {}
    families = sorted(family_counts)
    for family in families:
        local_distributions[family] = {
            str(ring_radius): distribution(
                cluster["cumulative_rings"][str(ring_radius)].get(family, 0)
                for cluster in clusters
            )
            for ring_radius in (80, 160, 240, radius)
        }

    return {
        "source": str(path),
        "declared_grid": [decoded["width"], decoded["height"]],
        "logical_extent": [decoded["width"] * 40, decoded["height"] * 40],
        "placement_counts": {
            "total": len(placements),
            "by_family": dict(sorted(family_counts.items())),
        },
        "building_count": len(buildings),
        "building_spacing": distribution(nearest_buildings),
        "building_to_road": distribution(nearest_roads),
        "local_family_distributions": local_distributions,
        "building_clusters": clusters,
    }


def main() -> int:
    args = parse_args()
    report = {
        "schema": "ps-placement-grammar-v1",
        "coordinate_system": {
            "logical_cell": 40,
            "screen_basis_x": [40, 20],
            "screen_basis_y": [-40, 20],
        },
        "cluster_radius": args.radius,
        "family_rules": {
            "road": "asset prefix road_",
            "field": "asset prefix field_",
            "fence": "asset name contains fence",
            "ground_spot": "asset prefix spot_ or land_",
            "tree": "catalog 9 except shrub_",
            "shrub": "asset prefix shrub_ or bush_",
            "flower": "asset prefix plant_ or flower_",
            "building": "MAP_BUILDINGS",
        },
        "maps": [
            extract_map(path, args.radius, args.bucket_size)
            for path in args.psm
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "PS_PLACEMENT_GRAMMAR OK maps=%d clusters=%d path=%s"
        % (
            len(report["maps"]),
            sum(item["building_count"] for item in report["maps"]),
            args.output.resolve(),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
