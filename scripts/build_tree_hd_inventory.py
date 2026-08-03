#!/usr/bin/env python3
"""Build the PS-map-priority tree HD production inventory.

The checked-in 14 object ledgers are placement truth.  Every unique tree uses
BODY slot 2 and SHADOW slot 4.  The already approved
``quercus-cerris_a_02`` sample remains external production truth, so this queue
contains the other 57 trees while still reporting the complete 58-tree target.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
import os
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAP_DIR = ROOT / "asset" / "environment" / "maps"
DEFAULT_CANONICAL_MANIFEST = (
    ROOT / "asset" / "environment" / "ps_objects" / "manifest.json"
)
DEFAULT_OUTPUT = (
    ROOT / "asset" / "environment" / "trees_hd" / "tree_inventory.json"
)
APPROVED_SAMPLE = "quercus-cerris_a_02"


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _relative(path: Path, start: Path) -> str:
    return Path(os.path.relpath(path, start)).as_posix()


def build_inventory(
    map_dir: Path,
    canonical_manifest_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    canonical_manifest = _read(canonical_manifest_path)
    if canonical_manifest.get("schema") != "ps_object_assets/v1":
        raise ValueError("unsupported PS object manifest")
    canonical = canonical_manifest["sprites"]

    usage_by_asset: Counter[str] = Counter()
    usage_by_map: dict[str, Counter[str]] = defaultdict(Counter)
    all_objects_by_map: dict[str, int] = {}
    ledgers: list[dict[str, Any]] = []
    for ledger_path in sorted(map_dir.glob("ps_seed_*_objects.json")):
        ledger = _read(ledger_path)
        name = str(ledger["name"])
        all_objects_by_map[name] = len(ledger["objects"])
        tree_count = 0
        for record in ledger["objects"]:
            if record.get("family") != "tree":
                continue
            if (record.get("body_slot"), record.get("shadow_slot")) != (2, 4):
                raise ValueError(
                    f"{name}:{record.get('asset')} has unexpected tree slots"
                )
            asset = str(record["asset"])
            usage_by_asset[asset] += 1
            usage_by_map[asset][name] += 1
            tree_count += 1
        ledgers.append(
            {
                "name": name,
                "objectCount": len(ledger["objects"]),
                "selectedUsageCount": tree_count,
                "file": _relative(ledger_path.resolve(), output_path.parent),
            }
        )

    map_names = [item["name"] for item in ledgers]
    target_ids = sorted(usage_by_asset)
    queued_ids = [item for item in target_ids if item != APPROVED_SAMPLE]
    assets: list[dict[str, Any]] = []
    missing: list[str] = []
    for asset in queued_ids:
        body_key = f"{asset}_s2"
        shadow_key = f"{asset}_s4"
        body = canonical.get(body_key)
        shadow = canonical.get(shadow_key)
        if not body or not shadow:
            missing.append(asset)
            continue
        body_path = canonical_manifest_path.parent / body["file"]
        shadow_path = canonical_manifest_path.parent / shadow["file"]
        if not body_path.is_file() or not shadow_path.is_file():
            missing.append(asset)
            continue
        assets.append(
            {
                "id": asset,
                "family": "tree",
                "usageCount": int(usage_by_asset[asset]),
                "usageByMap": {
                    name: int(usage_by_map[asset][name]) for name in map_names
                },
                "composite": False,
                "slotRoles": {
                    "body": [2],
                    "shadow": [4],
                    "stateBody": [],
                    "stateShadow": [],
                    "crushedBody": [],
                    "crushedShadow": [],
                },
                "bodyVariants": [
                    {
                        "bodySlot": 2,
                        "roles": ["body"],
                        "pairedShadowSlot": 4,
                    }
                ],
                "canonicalSlots": [
                    {
                        "slot": 2,
                        "roles": ["body"],
                        "reference": _relative(
                            body_path.resolve(),
                            output_path.parent,
                        ),
                        "referenceSize": [int(body["w"]), int(body["h"])],
                        "origin": [int(body["ox"]), int(body["oy"])],
                        "formatId": 723,
                    },
                    {
                        "slot": 4,
                        "roles": ["shadow"],
                        "reference": _relative(
                            shadow_path.resolve(),
                            output_path.parent,
                        ),
                        "referenceSize": [
                            int(shadow["w"]),
                            int(shadow["h"]),
                        ],
                        "origin": [int(shadow["ox"]), int(shadow["oy"])],
                        "formatId": 934,
                    },
                ],
            }
        )
    if missing:
        raise FileNotFoundError(f"tree canonical sprites missing: {missing}")

    return {
        "schema": "raised-hd-inventory/v1",
        "status": "production-queue-ready",
        "selection": {
            "families": ["tree"],
            "assetRule": (
                "unique tree ids actually placed by the 14 checked-in "
                "ps_seed object ledgers"
            ),
            "slotRule": "BODY slot 2 paired with SHADOW slot 4",
            "approvedExternalSample": APPROVED_SAMPLE,
            "queuedAssetCount": len(assets),
            "completeTargetAssetCount": len(target_ids),
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
            "bodyAuthority": "accepted generated tree BODY alpha",
            "canonicalShadowRole": (
                "numeric anchor/contact/bbox/extent/penumbra/density "
                "calibration only"
            ),
            "forbidden": "reuse of canonical shadow pixels",
            "alignmentInvariant": (
                "generated trunk base begins at the canonical notch and casts "
                "toward screen lower-right"
            ),
        },
        "animationContract": {
            "method": "runtime-subtle-whole-body-sway",
            "staticShadow": True,
            "angleDeg": 0.42,
            "scaleX": 0.0035,
            "durationMs": 4200,
            "anchor": "trunk base",
        },
        "sources": {
            "canonicalManifest": _relative(
                canonical_manifest_path.resolve(),
                output_path.parent,
            ),
            "mapDirectory": _relative(map_dir.resolve(), output_path.parent),
            "ledgers": ledgers,
        },
        "summary": {
            "assetCount": len(assets),
            "completeTargetAssetCount": len(target_ids),
            "approvedExternalSampleCount": 1,
            "usageCount": sum(
                count
                for asset, count in usage_by_asset.items()
                if asset != APPROVED_SAMPLE
            ),
            "completeTargetUsageCount": sum(usage_by_asset.values()),
            "mapCount": len(map_names),
            "bodyVariantCount": len(assets),
            "pairedShadowVariantCount": len(assets),
            "shadowlessBodyVariantCount": 0,
            "canonicalSlotCount": len(assets) * 2,
            "assetsByFamily": {"tree": len(assets)},
            "usageByFamily": {
                "tree": sum(
                    count
                    for asset, count in usage_by_asset.items()
                    if asset != APPROVED_SAMPLE
                )
            },
            "bodyVariantsByFamily": {"tree": len(assets)},
            "pairedShadowVariantsByFamily": {"tree": len(assets)},
            "canonicalSlotsByFamily": {"tree": len(assets) * 2},
            "usageByMap": {
                name: sum(
                    int(usage_by_map[asset][name])
                    for asset in queued_ids
                )
                for name in map_names
            },
            "allObjectsByMap": all_objects_by_map,
        },
        "assets": assets,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--map-dir", type=Path, default=DEFAULT_MAP_DIR)
    parser.add_argument(
        "--canonical-manifest",
        type=Path,
        default=DEFAULT_CANONICAL_MANIFEST,
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    output = args.output.resolve()
    inventory = build_inventory(
        args.map_dir.resolve(),
        args.canonical_manifest.resolve(),
        output,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "status": "ok",
                "inventory": str(output),
                "queued": inventory["summary"]["assetCount"],
                "approved": inventory["summary"]["approvedExternalSampleCount"],
                "target": inventory["summary"]["completeTargetAssetCount"],
                "placements": inventory["summary"]["completeTargetUsageCount"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
