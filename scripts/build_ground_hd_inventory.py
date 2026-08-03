#!/usr/bin/env python3
"""Build the deterministic HD ground-production inventory.

The current battlefield generator samples its low layer from the first map in
the extracted PS placement grammar.  A vocabulary item is drawable only when
the canonical sprite manifest contains slot 0 for that asset.  Current-map
usage is reproduced from the 14 checked-in generator seeds without writing or
rendering any map image.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
import os
from pathlib import Path
import sys
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

import gen_ps_seed_map as generator  # noqa: E402


LOW_FAMILIES = (
    "terrain",
    "grass",
    "ground_feature",
    "ground_spot",
    "road",
    "field",
    "flower",
)
DEFAULT_GRAMMAR = (
    REPO_ROOT
    / "scratch"
    / "ps_placement_grammar"
    / "ps_demo_building_clusters_v1.json"
)
DEFAULT_CANONICAL_ROOT = REPO_ROOT / "scratch" / "ps_sprites_canonical_v1"
DEFAULT_CANONICAL_MANIFEST = DEFAULT_CANONICAL_ROOT / "canonical_manifest.json"
DEFAULT_LEGACY_CATALOG = REPO_ROOT / "scratch" / "ps_sprites_v2" / "catalog.json"
DEFAULT_MAP_DIR = REPO_ROOT / "asset" / "environment" / "maps"
DEFAULT_OUTPUT = REPO_ROOT / "asset" / "environment" / "ground_hd" / "inventory.json"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def slot_number(entry: dict[str, Any]) -> int:
    return int(entry["slot"])


def asset_id(entry: dict[str, Any]) -> str:
    return Path(str(entry["ssc"])).stem.casefold()


def build_vocabulary(
    grammar_path: Path,
) -> tuple[
    list[dict[str, Any]],
    dict[str, list[str]],
    dict[str, str],
    Counter[str],
]:
    """Return the exact vocabulary consumed by ``gen_ps_seed_map``.

    Duplicate placement occurrences are deliberately retained in the family
    lists because ``random.choice`` uses them as generation weights.
    """

    grammar = read_json(grammar_path)
    source_map = grammar["maps"][0]
    clusters = list(source_map.get("building_clusters", []))
    vocabulary: dict[str, list[str]] = defaultdict(list)
    family_by_asset: dict[str, str] = {}
    source_usage: Counter[str] = Counter()

    for cluster in clusters:
        for placement in cluster.get("placements", []):
            family = placement.get("family")
            name = placement.get("asset")
            if family not in LOW_FAMILIES or not isinstance(name, str) or not name:
                continue
            previous = family_by_asset.setdefault(name, family)
            if previous != family:
                raise ValueError(
                    f"{name!r} belongs to both {previous!r} and {family!r}"
                )
            vocabulary[family].append(name)
            source_usage[name] += 1

    return clusters, dict(vocabulary), family_by_asset, source_usage


def canonical_indexes(
    manifest_path: Path,
) -> tuple[dict[str, dict[str, Any]], dict[str, list[int]]]:
    """Index canonical slot 0 exactly as the generator's SpriteIndex does.

    Six grass identifiers occur in both the active and ``old`` directories.
    SpriteIndex's slot dictionary keeps the last manifest entry, so this index
    intentionally follows the same deterministic rule.
    """

    manifest = read_json(manifest_path)
    ground_slot: dict[str, dict[str, Any]] = {}
    all_slots: dict[str, set[int]] = defaultdict(set)

    for entry in manifest["sprites"]:
        name = asset_id(entry)
        slot = slot_number(entry)
        all_slots[name].add(slot)
        if slot == 0:
            ground_slot[name] = entry

    return ground_slot, {
        name: sorted(slots)
        for name, slots in all_slots.items()
    }


def current_map_metadata(map_dir: Path) -> list[dict[str, Any]]:
    maps: list[dict[str, Any]] = []
    for path in sorted(map_dir.glob("ps_seed_*.json")):
        if path.stem.endswith("_objects"):
            continue
        metadata = read_json(path)
        source = metadata.get("source", {})
        if source.get("generator") != "gen_ps_seed_map":
            continue
        seed = source.get("seed")
        if not isinstance(seed, int):
            raise ValueError(f"{path}: source.seed must be an integer")
        metadata["_path"] = path
        maps.append(metadata)

    if not maps:
        raise ValueError(f"no generated ps_seed maps found in {map_dir}")
    return maps


def reproduce_map_usage(
    maps: list[dict[str, Any]],
    grammar_path: Path,
    canonical_root: Path,
    canonical_manifest: Path,
    legacy_catalog: Path,
    missing_ids: set[str],
) -> tuple[Counter[str], dict[str, Counter[str]], dict[str, int]]:
    """Dry-run current generation choices and count low-layer selections."""

    clusters, vocabulary, _ = generator.read_grammar(grammar_path)
    sprite_index = generator.SpriteIndex(
        canonical_root,
        canonical_manifest,
        legacy_catalog,
    )
    original_renderer = generator.Renderer

    class UsageRenderer(original_renderer):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)
            self.ground_usage: Counter[str] = Counter()

        def stamp_ground(
            self,
            selected_asset: str | None,
            _x: int,
            _y: int,
        ) -> None:
            if selected_asset is not None:
                self.ground_usage[selected_asset] += 1

    total: Counter[str] = Counter()
    by_map: dict[str, Counter[str]] = {}
    map_totals: dict[str, int] = {}
    generator.Renderer = UsageRenderer
    try:
        for metadata in maps:
            seed = int(metadata["source"]["seed"])
            name = str(metadata["name"])
            plan, _connectivity, _counts = generator.build_valid_plan(seed)
            expected_rows = generator.terrain_rows(plan)
            if expected_rows != metadata.get("rows"):
                raise ValueError(
                    f"{name}: checked-in terrain rows no longer match seed {seed}"
                )

            _canvas, renderer, _top_left_x, _top_left_y = generator.render_map(
                plan=plan,
                clusters=clusters,
                vocabulary=vocabulary,
                index=sprite_index,
                width=int(metadata["image_width"]),
                height=int(metadata["image_height"]),
                scale=float(metadata["projection"]["scale"]),
                base_color=(0, 0, 0, 0),
                cluster_radius=150,
                seed=seed,
                map_height=max(int(row[0]) for row in metadata["rows"]),
            )
            usage = Counter(renderer.ground_usage)

            # Missing slot-0 assets were already recorded in each map audit.
            # Matching those values proves this dry-run follows the checked-in
            # maps' random-choice sequence without needing to render an image.
            audited_missing = Counter(metadata.get("audit", {}).get("missing_assets", {}))
            for missing_id in missing_ids:
                if usage[missing_id] != audited_missing[missing_id]:
                    raise ValueError(
                        f"{name}: usage drift for missing asset {missing_id}: "
                        f"dry-run={usage[missing_id]}, "
                        f"audit={audited_missing[missing_id]}"
                    )

            by_map[name] = usage
            map_totals[name] = sum(usage.values())
            total.update(usage)
    finally:
        generator.Renderer = original_renderer

    return total, by_map, map_totals


def relative_posix(path: Path, start: Path) -> str:
    return Path(os.path.relpath(path, start)).as_posix()


def build_inventory(
    *,
    grammar_path: Path = DEFAULT_GRAMMAR,
    canonical_root: Path = DEFAULT_CANONICAL_ROOT,
    canonical_manifest: Path = DEFAULT_CANONICAL_MANIFEST,
    legacy_catalog: Path = DEFAULT_LEGACY_CATALOG,
    map_dir: Path = DEFAULT_MAP_DIR,
    output_path: Path = DEFAULT_OUTPUT,
) -> dict[str, Any]:
    (
        _clusters,
        _vocabulary,
        family_by_asset,
        source_usage,
    ) = build_vocabulary(grammar_path)
    ground_slot, canonical_slots = canonical_indexes(canonical_manifest)
    maps = current_map_metadata(map_dir)

    missing_ids = {
        name
        for name in family_by_asset
        if name.casefold() not in ground_slot
    }
    usage, usage_by_map, map_totals = reproduce_map_usage(
        maps,
        grammar_path,
        canonical_root,
        canonical_manifest,
        legacy_catalog,
        missing_ids,
    )
    map_names = [str(metadata["name"]) for metadata in maps]

    available: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    for name in sorted(family_by_asset):
        family = family_by_asset[name]
        normalized_name = name.casefold()
        per_map = {
            map_name: usage_by_map[map_name][name]
            for map_name in map_names
        }
        common = {
            "id": name,
            "family": family,
            "usageCount": usage[name],
            "usageByMap": per_map,
            "sourceGrammarOccurrences": source_usage[name],
        }

        canonical = ground_slot.get(normalized_name)
        if canonical is None:
            missing.append({
                **common,
                "reason": "canonical ground slot 0 is absent",
                "canonicalSlots": canonical_slots.get(normalized_name, []),
            })
            continue

        reference_path = canonical_root / Path(str(canonical["png"]))
        if not reference_path.is_file():
            raise FileNotFoundError(reference_path)
        available.append({
            **common,
            "reference": relative_posix(reference_path, output_path.parent),
            "referenceSize": [
                int(canonical["width"]),
                int(canonical["height"]),
            ],
            "origin": [
                int(canonical["origin_x"]),
                int(canonical["origin_y"]),
            ],
            "canonicalSlot": 0,
        })

    available_by_family = Counter(item["family"] for item in available)
    missing_by_family = Counter(item["family"] for item in missing)
    inventory = {
        "schema": "ground-hd-inventory/v1",
        "status": "production-queue",
        "selection": {
            "families": list(LOW_FAMILIES),
            "grammarMapIndex": 0,
            "drawableRule": "canonical_manifest contains slot 0",
            "canonicalDuplicateRule": (
                "last manifest entry for an id/slot wins, matching "
                "gen_ps_seed_map.SpriteIndex"
            ),
            "usageDefinition": (
                "number of low-layer selections reproduced from the checked-in "
                "14 gen_ps_seed_map seeds; no image is rendered or written"
            ),
        },
        "sources": {
            "grammar": relative_posix(grammar_path, output_path.parent),
            "canonicalManifest": relative_posix(
                canonical_manifest,
                output_path.parent,
            ),
            "mapDirectory": relative_posix(map_dir, output_path.parent),
            "maps": map_names,
        },
        "summary": {
            "vocabularyCount": len(family_by_asset),
            "drawableCount": len(available),
            "missingCount": len(missing),
            "mapCount": len(maps),
            "usageCount": sum(usage.values()),
            "drawableByFamily": {
                family: available_by_family[family]
                for family in LOW_FAMILIES
            },
            "missingByFamily": {
                family: missing_by_family[family]
                for family in LOW_FAMILIES
            },
            "usageByMap": map_totals,
        },
        "assets": available,
        "missing": missing,
    }
    return inventory


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--grammar", type=Path, default=DEFAULT_GRAMMAR)
    parser.add_argument(
        "--canonical-root",
        type=Path,
        default=DEFAULT_CANONICAL_ROOT,
    )
    parser.add_argument(
        "--canonical-manifest",
        type=Path,
        default=DEFAULT_CANONICAL_MANIFEST,
    )
    parser.add_argument(
        "--legacy-catalog",
        type=Path,
        default=DEFAULT_LEGACY_CATALOG,
    )
    parser.add_argument("--map-dir", type=Path, default=DEFAULT_MAP_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    inventory = build_inventory(
        grammar_path=args.grammar.resolve(),
        canonical_root=args.canonical_root.resolve(),
        canonical_manifest=args.canonical_manifest.resolve(),
        legacy_catalog=args.legacy_catalog.resolve(),
        map_dir=args.map_dir.resolve(),
        output_path=args.output.resolve(),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    summary = inventory["summary"]
    print(
        f"wrote {args.output}: "
        f"{summary['drawableCount']} drawable, "
        f"{summary['missingCount']} missing, "
        f"{summary['usageCount']} uses across {summary['mapCount']} maps"
    )


if __name__ == "__main__":
    main()
