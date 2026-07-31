#!/usr/bin/env python3
"""Deterministically synchronize all inventory assets into the HD manifest."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import tempfile
from typing import Any

try:
    from .validate_ground_hd_production import (
        DEFAULT_INVENTORY,
        DEFAULT_MANIFEST,
        EXPECTED_ASSET_COUNT,
        validate_production,
    )
except ImportError:
    from validate_ground_hd_production import (
        DEFAULT_INVENTORY,
        DEFAULT_MANIFEST,
        EXPECTED_ASSET_COUNT,
        validate_production,
    )


def _relative_path(target: Path, owner: Path) -> str:
    return Path(os.path.relpath(target, owner.parent)).as_posix()


def build_overrides(
    inventory: dict[str, Any],
    inventory_path: Path,
    manifest_path: Path,
    lighting_id: str,
) -> list[dict[str, Any]]:
    """Build stable override records in inventory order."""

    overrides = []
    for item in inventory["assets"]:
        asset_id = item["id"]
        reference_path = (inventory_path.parent / item["reference"]).resolve()
        source_path = (
            manifest_path.parents[3]
            / "tmp"
            / "ground_hd"
            / f"{asset_id}_source.png"
        )
        reference_size = [int(value) for value in item["referenceSize"]]
        overrides.append(
            {
                "id": asset_id,
                "family": item["family"],
                "reference": _relative_path(reference_path, manifest_path),
                "generatedSource": _relative_path(source_path, manifest_path),
                "file": f"{asset_id}_hd_v1.png",
                "referenceSize": reference_size,
                "outputSize": [value * 2 for value in reference_size],
                "canonicalSlot": int(item["canonicalSlot"]),
                "lightingContract": lighting_id,
            }
        )
    return overrides


def build_manifest(
    inventory: dict[str, Any],
    manifest: dict[str, Any],
    inventory_path: Path,
    manifest_path: Path,
) -> dict[str, Any]:
    if len(inventory.get("assets", [])) != inventory.get("summary", {}).get(
        "drawableCount"
    ):
        raise ValueError("inventory assets and summary.drawableCount disagree")
    lighting = manifest.get("lightingContract")
    if not isinstance(lighting, dict) or not isinstance(lighting.get("id"), str):
        raise ValueError("manifest must define lightingContract.id")

    result = dict(manifest)
    result["status"] = "production-complete"
    result["inventory"] = {
        "file": _relative_path(inventory_path.resolve(), manifest_path),
        "schema": inventory.get("schema"),
        "assetCount": len(inventory["assets"]),
    }
    result["overrides"] = build_overrides(
        inventory,
        inventory_path,
        manifest_path,
        lighting["id"],
    )
    return result


def _serialized(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def sync_manifest(
    inventory_path: Path = DEFAULT_INVENTORY,
    manifest_path: Path = DEFAULT_MANIFEST,
    *,
    check: bool = False,
    expected_asset_count: int = EXPECTED_ASSET_COUNT,
) -> tuple[dict[str, Any], bool]:
    """Validate then write the deterministic manifest.

    Returns ``(candidate, changed)``. No file is changed if validation fails.
    """

    inventory_path = inventory_path.resolve()
    manifest_path = manifest_path.resolve()
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    candidate = build_manifest(
        inventory,
        manifest,
        inventory_path,
        manifest_path,
    )
    report = validate_production(
        inventory_path,
        manifest_path,
        manifest_path.parent,
        expected_asset_count=expected_asset_count,
        manifest_data=candidate,
    )
    if not report["ok"]:
        preview = "; ".join(
            (
                f"{item.get('asset', 'catalog')}:"
                f"{item['code']}"
            )
            for item in report["issues"][:8]
        )
        raise ValueError(
            "refusing to publish an invalid production manifest "
            f"({report['issueCount']} issue(s)): {preview}"
        )

    current = _serialized(manifest)
    desired = _serialized(candidate)
    changed = current != desired
    if check:
        return candidate, changed
    if changed:
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            newline="\n",
            dir=manifest_path.parent,
            prefix=f".{manifest_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(desired)
        os.replace(temp_path, manifest_path)
    return candidate, changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate and report drift without modifying the manifest",
    )
    args = parser.parse_args()

    candidate, changed = sync_manifest(
        args.inventory,
        args.manifest,
        check=args.check,
    )
    if args.check and changed:
        print(
            f"manifest needs synchronization: "
            f"{len(candidate['overrides'])} overrides"
        )
        raise SystemExit(1)
    action = "already synchronized" if not changed else "synchronized"
    print(f"{action}: {len(candidate['overrides'])} overrides")


if __name__ == "__main__":
    main()
