#!/usr/bin/env python3
"""Build the deterministic non-tree raised-asset HD inventory.

The 14 checked-in ``ps_seed_*_objects.json`` ledgers are the placement truth.
Only building, fence, large_prop, and shrub records are selected.  Every body,
shadow, alternate-state, and crushed-state slot declared by those ledgers is
resolved against the canonical PS sprite manifest.

Canonical shadow images are recorded as alignment/extent calibration references
only.  They are never production shadow sources: an HD shadow must be derived
from the accepted generated HD body.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
import os
from pathlib import Path
from typing import Any, Iterable


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent

RAISED_FAMILIES = (
    "building",
    "fence",
    "large_prop",
    "shrub",
)
ROLE_ORDER = (
    "body",
    "shadow",
    "stateBody",
    "stateShadow",
    "crushedBody",
    "crushedShadow",
)
BODY_ROLES = frozenset(("body", "stateBody", "crushedBody"))
SHADOW_ROLES = frozenset(("shadow", "stateShadow", "crushedShadow"))

DEFAULT_MAP_DIR = REPO_ROOT / "asset" / "environment" / "maps"
DEFAULT_CANONICAL_ROOT = REPO_ROOT / "scratch" / "ps_sprites_canonical_v1"
DEFAULT_CANONICAL_MANIFEST = DEFAULT_CANONICAL_ROOT / "canonical_manifest.json"
DEFAULT_OUTPUT = (
    REPO_ROOT / "asset" / "environment" / "raised_hd" / "inventory.json"
)


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def relative_posix(path: Path, start: Path) -> str:
    return Path(os.path.relpath(path, start)).as_posix()


def canonical_asset_id(entry: dict[str, Any]) -> str:
    return Path(str(entry["ssc"])).stem.casefold()


def canonical_index(
    manifest_path: Path,
) -> tuple[
    dict[str, dict[int, dict[str, Any]]],
    set[tuple[str, int]],
]:
    """Index canonical sprites like ``SpriteIndex.slots``.

    ``SpriteIndex.slots`` creates a slot dictionary from manifest-ordered
    entries, so a later duplicate id/slot wins.  The same rule is explicit
    here even though none of the selected 539 canonical records is duplicated.
    """

    manifest = read_json(manifest_path)
    result: dict[str, dict[int, dict[str, Any]]] = defaultdict(dict)
    duplicate_slots: set[tuple[str, int]] = set()
    for entry in manifest["sprites"]:
        asset = canonical_asset_id(entry)
        slot = int(entry["slot"])
        if slot in result[asset]:
            duplicate_slots.add((asset, slot))
        result[asset][slot] = entry
    return dict(result), duplicate_slots


def slot_value(value: Any, *, context: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"{context}: boolean is not a slot")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.lstrip("-").isdigit():
        return int(value)
    raise ValueError(f"{context}: invalid slot {value!r}")


def slot_list(value: Any, *, context: str) -> list[int | None]:
    if value is None:
        return []
    raw = value if isinstance(value, list) else [value]
    return [
        slot_value(item, context=f"{context}[{index}]")
        for index, item in enumerate(raw)
    ]


def add_pairs(
    *,
    asset: str,
    body_values: Any,
    shadow_values: Any,
    body_role: str,
    shadow_role: str,
    context: str,
    slot_roles: dict[str, dict[int, set[str]]],
    body_pairs: dict[str, dict[int, set[int | None]]],
) -> None:
    bodies = slot_list(body_values, context=f"{context}.body")
    shadows = slot_list(shadow_values, context=f"{context}.shadow")
    if not bodies:
        if shadows:
            raise ValueError(f"{context}: shadow slots exist without body slots")
        return
    if len(bodies) != len(shadows):
        raise ValueError(
            f"{context}: body/shadow slot counts differ "
            f"({len(bodies)} != {len(shadows)})"
        )

    for body, shadow in zip(bodies, shadows):
        if body is None:
            if shadow is not None:
                raise ValueError(f"{context}: shadow {shadow} has no body")
            continue
        slot_roles[asset][body].add(body_role)
        body_pairs[asset][body].add(shadow)
        if shadow is not None:
            slot_roles[asset][shadow].add(shadow_role)


def object_ledgers(map_dir: Path) -> list[tuple[Path, dict[str, Any]]]:
    ledgers: list[tuple[Path, dict[str, Any]]] = []
    names: set[str] = set()
    for path in sorted(map_dir.glob("ps_seed_*_objects.json")):
        data = read_json(path)
        if data.get("schema") != "ps_objects/v1":
            raise ValueError(f"{path}: expected ps_objects/v1")
        name = data.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError(f"{path}: missing map name")
        if name in names:
            raise ValueError(f"duplicate map ledger name: {name}")
        if not isinstance(data.get("objects"), list):
            raise ValueError(f"{path}: objects must be an array")
        names.add(name)
        ledgers.append((path, data))
    if not ledgers:
        raise ValueError(f"no ps_seed object ledgers found in {map_dir}")
    return ledgers


def collect_ledger_truth(
    ledgers: Iterable[tuple[Path, dict[str, Any]]],
) -> dict[str, Any]:
    family_by_asset: dict[str, str] = {}
    original_id_by_key: dict[str, str] = {}
    usage: Counter[str] = Counter()
    usage_by_map: dict[str, Counter[str]] = defaultdict(Counter)
    map_selected_totals: Counter[str] = Counter()
    map_object_totals: dict[str, int] = {}
    slot_roles: dict[str, dict[int, set[str]]] = defaultdict(
        lambda: defaultdict(set)
    )
    body_pairs: dict[str, dict[int, set[int | None]]] = defaultdict(
        lambda: defaultdict(set)
    )
    ledger_sources: list[dict[str, Any]] = []

    for path, data in ledgers:
        map_name = str(data["name"])
        objects = data["objects"]
        map_object_totals[map_name] = len(objects)
        for object_index, record in enumerate(objects):
            family = record.get("family")
            if family not in RAISED_FAMILIES:
                continue
            asset = record.get("asset")
            if not isinstance(asset, str) or not asset:
                raise ValueError(
                    f"{path}: object {object_index} has invalid asset id"
                )
            key = asset.casefold()
            previous_id = original_id_by_key.setdefault(key, asset)
            if previous_id != asset:
                raise ValueError(
                    f"case-colliding asset ids: {previous_id!r}, {asset!r}"
                )
            previous_family = family_by_asset.setdefault(key, family)
            if previous_family != family:
                raise ValueError(
                    f"{asset!r} belongs to {previous_family!r} and {family!r}"
                )

            usage[key] += 1
            usage_by_map[key][map_name] += 1
            map_selected_totals[map_name] += 1
            context = f"{path}: object {object_index} ({asset})"

            if record.get("composite"):
                add_pairs(
                    asset=key,
                    body_values=record.get("body_slots"),
                    shadow_values=record.get("shadow_slots"),
                    body_role="body",
                    shadow_role="shadow",
                    context=f"{context}.composite",
                    slot_roles=slot_roles,
                    body_pairs=body_pairs,
                )
                add_pairs(
                    asset=key,
                    body_values=record.get("crushed_slots"),
                    shadow_values=record.get("crushed_shadow_slots"),
                    body_role="crushedBody",
                    shadow_role="crushedShadow",
                    context=f"{context}.crushed",
                    slot_roles=slot_roles,
                    body_pairs=body_pairs,
                )
            else:
                add_pairs(
                    asset=key,
                    body_values=record.get("body_slot"),
                    shadow_values=record.get("shadow_slot"),
                    body_role="body",
                    shadow_role="shadow",
                    context=f"{context}.standing",
                    slot_roles=slot_roles,
                    body_pairs=body_pairs,
                )
                states = record.get("states")
                if states is not None:
                    if not isinstance(states, dict):
                        raise ValueError(f"{context}: states must be an object")
                    add_pairs(
                        asset=key,
                        body_values=states.get("body"),
                        shadow_values=states.get("shadow"),
                        body_role="stateBody",
                        shadow_role="stateShadow",
                        context=f"{context}.states",
                        slot_roles=slot_roles,
                        body_pairs=body_pairs,
                    )

        ledger_sources.append(
            {
                "name": map_name,
                "_path": path,
                "objectCount": len(objects),
                "selectedUsageCount": map_selected_totals[map_name],
            }
        )

    for asset, variants in body_pairs.items():
        for body_slot, shadows in variants.items():
            if len(shadows) != 1:
                raise ValueError(
                    f"{original_id_by_key[asset]} body slot {body_slot} "
                    f"has ambiguous shadows: {sorted(shadows, key=str)}"
                )

    return {
        "familyByAsset": family_by_asset,
        "originalIdByKey": original_id_by_key,
        "usage": usage,
        "usageByMap": usage_by_map,
        "mapSelectedTotals": map_selected_totals,
        "mapObjectTotals": map_object_totals,
        "slotRoles": slot_roles,
        "bodyPairs": body_pairs,
        "ledgerSources": ledger_sources,
    }


def role_sort_key(role: str) -> int:
    return ROLE_ORDER.index(role)


def canonical_record(
    *,
    entry: dict[str, Any],
    roles: set[str],
    canonical_root: Path,
    output_path: Path,
) -> dict[str, Any]:
    reference_path = canonical_root / Path(str(entry["png"]))
    if not reference_path.is_file():
        raise FileNotFoundError(reference_path)
    return {
        "slot": int(entry["slot"]),
        "roles": sorted(roles, key=role_sort_key),
        "reference": relative_posix(reference_path, output_path.parent),
        "referenceSize": [
            int(entry["width"]),
            int(entry["height"]),
        ],
        "origin": [
            int(entry["origin_x"]),
            int(entry["origin_y"]),
        ],
        "formatId": int(entry["format_id"]),
    }


def build_inventory(
    *,
    map_dir: Path = DEFAULT_MAP_DIR,
    canonical_root: Path = DEFAULT_CANONICAL_ROOT,
    canonical_manifest: Path = DEFAULT_CANONICAL_MANIFEST,
    output_path: Path = DEFAULT_OUTPUT,
) -> dict[str, Any]:
    ledgers = object_ledgers(map_dir)
    truth = collect_ledger_truth(ledgers)
    canonical, manifest_duplicate_slots = canonical_index(canonical_manifest)

    map_names = [str(data["name"]) for _path, data in ledgers]
    assets: list[dict[str, Any]] = []
    assets_by_family: Counter[str] = Counter()
    usage_by_family: Counter[str] = Counter()
    body_variants_by_family: Counter[str] = Counter()
    paired_shadows_by_family: Counter[str] = Counter()
    canonical_slots_by_family: Counter[str] = Counter()

    for key in sorted(truth["familyByAsset"]):
        asset_id = truth["originalIdByKey"][key]
        family = truth["familyByAsset"][key]
        canonical_asset = canonical.get(key)
        if canonical_asset is None:
            raise ValueError(f"{asset_id}: absent from canonical manifest")

        slot_roles = truth["slotRoles"][key]
        slot_records: list[dict[str, Any]] = []
        for slot in sorted(slot_roles):
            entry = canonical_asset.get(slot)
            if entry is None:
                raise ValueError(
                    f"{asset_id}: canonical slot {slot} is absent"
                )
            slot_records.append(
                canonical_record(
                    entry=entry,
                    roles=slot_roles[slot],
                    canonical_root=canonical_root,
                    output_path=output_path,
                )
            )

        body_variants: list[dict[str, Any]] = []
        for body_slot in sorted(truth["bodyPairs"][key]):
            roles = sorted(
                slot_roles[body_slot] & BODY_ROLES,
                key=role_sort_key,
            )
            shadow = next(iter(truth["bodyPairs"][key][body_slot]))
            body_variants.append(
                {
                    "bodySlot": body_slot,
                    "roles": roles,
                    "pairedShadowSlot": shadow,
                }
            )

        role_slots = {
            role: sorted(
                slot
                for slot, roles in slot_roles.items()
                if role in roles
            )
            for role in ROLE_ORDER
        }
        usage_count = int(truth["usage"][key])
        per_map = {
            map_name: int(truth["usageByMap"][key][map_name])
            for map_name in map_names
        }
        asset = {
            "id": asset_id,
            "family": family,
            "usageCount": usage_count,
            "usageByMap": per_map,
            "composite": family == "fence",
            "slotRoles": role_slots,
            "bodyVariants": body_variants,
            "canonicalSlots": slot_records,
        }
        assets.append(asset)
        assets_by_family[family] += 1
        usage_by_family[family] += usage_count
        body_variants_by_family[family] += len(body_variants)
        paired_shadows_by_family[family] += sum(
            variant["pairedShadowSlot"] is not None
            for variant in body_variants
        )
        canonical_slots_by_family[family] += len(slot_records)

    ledger_sources = [
        {
            **{key: value for key, value in source.items() if key != "_path"},
            "file": relative_posix(source["_path"], output_path.parent),
        }
        for source in truth["ledgerSources"]
    ]
    body_variant_count = sum(
        len(item["bodyVariants"])
        for item in assets
    )
    paired_shadow_count = sum(
        variant["pairedShadowSlot"] is not None
        for item in assets
        for variant in item["bodyVariants"]
    )
    canonical_slot_count = sum(
        len(item["canonicalSlots"])
        for item in assets
    )
    selected_duplicate_slot_count = sum(
        (item["id"].casefold(), int(record["slot"]))
        in manifest_duplicate_slots
        for item in assets
        for record in item["canonicalSlots"]
    )

    return {
        "schema": "raised-hd-inventory/v1",
        "status": "production-queue-ready",
        "selection": {
            "families": list(RAISED_FAMILIES),
            "excludedFamilies": ["tree"],
            "assetRule": (
                "unique asset ids actually placed by the 14 checked-in "
                "ps_seed object ledgers"
            ),
            "slotRule": (
                "all body/shadow slots declared by standing, alternate-state, "
                "and composite crushed-state ledger fields"
            ),
            "canonicalDuplicateRule": (
                "last manifest entry for an id/slot wins, matching "
                "SpriteIndex.slots"
            ),
            "usageDefinition": (
                "one use per selected object ledger record; a composite fence "
                "record counts once regardless of its simultaneous segment slots"
            ),
        },
        "lightingContract": {
            "id": "ps-overcast-upper-left-v1",
            "spec": "../../../docs/ASSET_LIGHTING_CONTRACT.md",
            "keyOrigin": "screen upper-left",
            "shadowDirection": "screen lower-right",
            "shadowScreenVector": [0.72, 0.69],
            "elevationDegrees": 55,
            "ambientFill": 0.72,
            "colorTemperatureK": 6000,
        },
        "shadowPolicy": {
            "method": "generated-body-derived",
            "bodyAuthority": (
                "the accepted photorealistic generated HD body cutout"
            ),
            "canonicalShadowRole": (
                "calibration only: anchor, direction, footprint, extent, "
                "penumbra, and density"
            ),
            "forbidden": (
                "copying, tracing, pasting, recoloring, scaling, or otherwise "
                "reusing canonical shadow pixels as the HD shadow"
            ),
            "alignmentInvariant": (
                "the generated shadow begins at the generated body's exact "
                "ground-contact point and travels toward screen lower-right"
            ),
        },
        "sources": {
            "canonicalManifest": relative_posix(
                canonical_manifest,
                output_path.parent,
            ),
            "canonicalRoot": relative_posix(
                canonical_root,
                output_path.parent,
            ),
            "mapDirectory": relative_posix(map_dir, output_path.parent),
            "ledgers": ledger_sources,
        },
        "summary": {
            "assetCount": len(assets),
            "usageCount": sum(item["usageCount"] for item in assets),
            "mapCount": len(ledgers),
            "bodyVariantCount": body_variant_count,
            "pairedShadowVariantCount": paired_shadow_count,
            "shadowlessBodyVariantCount": (
                body_variant_count - paired_shadow_count
            ),
            "canonicalSlotCount": canonical_slot_count,
            "allManifestDuplicateSlotCount": len(manifest_duplicate_slots),
            "selectedDuplicateSlotCount": selected_duplicate_slot_count,
            "assetsByFamily": {
                family: assets_by_family[family]
                for family in RAISED_FAMILIES
            },
            "usageByFamily": {
                family: usage_by_family[family]
                for family in RAISED_FAMILIES
            },
            "bodyVariantsByFamily": {
                family: body_variants_by_family[family]
                for family in RAISED_FAMILIES
            },
            "pairedShadowVariantsByFamily": {
                family: paired_shadows_by_family[family]
                for family in RAISED_FAMILIES
            },
            "canonicalSlotsByFamily": {
                family: canonical_slots_by_family[family]
                for family in RAISED_FAMILIES
            },
            "usageByMap": {
                name: int(truth["mapSelectedTotals"][name])
                for name in map_names
            },
            "allObjectsByMap": {
                name: int(truth["mapObjectTotals"][name])
                for name in map_names
            },
        },
        "assets": assets,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--map-dir", type=Path, default=DEFAULT_MAP_DIR)
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
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    inventory = build_inventory(
        map_dir=args.map_dir.resolve(),
        canonical_root=args.canonical_root.resolve(),
        canonical_manifest=args.canonical_manifest.resolve(),
        output_path=args.output.resolve(),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    summary = inventory["summary"]
    print(
        f"wrote {args.output}: {summary['assetCount']} assets, "
        f"{summary['usageCount']} uses, "
        f"{summary['bodyVariantCount']} body variants, "
        f"{summary['pairedShadowVariantCount']} paired shadows, "
        f"{summary['canonicalSlotCount']} canonical slots"
    )


if __name__ == "__main__":
    main()
