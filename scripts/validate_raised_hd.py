#!/usr/bin/env python3
"""Validate finalized raised-HD sidecars, assets, origins, and manifest."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image

try:
    from .raised_hd_pipeline import (
        LIGHTING_CONTRACT,
        MANIFEST_SCHEMA,
        METADATA_SCHEMA,
        PIXEL_RATIO,
        alpha_sha256,
        calibrate_shadow,
        file_sha256,
        find_job,
        read_inventory,
        resolve_reference,
        sync_manifest,
        validate_body,
        validate_shadow,
    )
    from .shadow_v4_pipeline import validate_shadow_v4
except ImportError:
    from raised_hd_pipeline import (
        LIGHTING_CONTRACT,
        MANIFEST_SCHEMA,
        METADATA_SCHEMA,
        PIXEL_RATIO,
        alpha_sha256,
        calibrate_shadow,
        file_sha256,
        find_job,
        read_inventory,
        resolve_reference,
        sync_manifest,
        validate_body,
        validate_shadow,
    )
    from shadow_v4_pipeline import validate_shadow_v4


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = ROOT / "asset" / "environment" / "raised_hd"
DEFAULT_INVENTORY = DEFAULT_ROOT / "inventory.json"


def _assert_equal(actual: Any, expected: Any, label: str) -> None:
    if actual != expected:
        raise ValueError(f"{label}: expected {expected!r}, got {actual!r}")


def validate_all(
    *,
    output_root: Path,
    inventory_path: Path,
    manifest_path: Path | None = None,
    require_complete: bool = False,
    resync_manifest: bool = False,
) -> dict[str, Any]:
    output_root = output_root.resolve()
    inventory_path = inventory_path.resolve()
    manifest_path = (
        manifest_path.resolve()
        if manifest_path
        else output_root / "manifest.json"
    )
    if resync_manifest or not manifest_path.is_file():
        sync_manifest(output_root, inventory_path, manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    _assert_equal(manifest.get("schema"), MANIFEST_SCHEMA, "manifest schema")
    _assert_equal(manifest.get("pixelRatio"), PIXEL_RATIO, "pixel ratio")
    _assert_equal(
        manifest["lightingContract"]["id"],
        LIGHTING_CONTRACT,
        "lighting contract",
    )
    _assert_equal(
        manifest["shadowPolicy"]["canonicalShadowPixelsCopied"],
        False,
        "shadow pixel-copy policy",
    )

    metadata_paths = sorted((output_root / "metadata").glob("*.json"))
    checked_bodies = 0
    checked_shadows = 0
    checked_shadowless = 0
    for metadata_path in metadata_paths:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        _assert_equal(
            metadata.get("schema"),
            METADATA_SCHEMA,
            f"{metadata_path.name} schema",
        )
        job = find_job(
            inventory_path,
            metadata["id"],
            int(metadata["bodySlot"]),
        )
        _assert_equal(
            metadata["bodyOrigin"],
            job["origin"],
            f"{metadata['jobId']} body origin",
        )
        _assert_equal(
            metadata["pairedShadowSlot"],
            job["pairedShadowSlot"],
            f"{metadata['jobId']} paired shadow slot",
        )
        body_path = output_root / metadata["outputs"]["body"]
        if not body_path.is_file():
            raise FileNotFoundError(body_path)
        body = Image.open(body_path).convert("RGBA")
        reference = Image.open(job["referenceAbsolute"]).convert("RGBA")
        body_quality = validate_body(body, reference, job["origin"])
        _assert_equal(
            file_sha256(body_path),
            metadata["body"]["fileSha256"],
            f"{metadata['jobId']} body file hash",
        )
        _assert_equal(
            alpha_sha256(body),
            metadata["body"]["alphaSha256"],
            f"{metadata['jobId']} body alpha hash",
        )
        _assert_equal(
            body_quality["canonicalAlphaIdentical"],
            False,
            f"{metadata['jobId']} generated body authority",
        )
        body_key = f"{metadata['id']}_s{metadata['bodySlot']}"
        body_entry = manifest["sprites"].get(body_key)
        if body_entry is None:
            raise ValueError(f"manifest is missing {body_key}")
        _assert_equal(
            body_entry["file"],
            metadata["outputs"]["body"],
            f"{body_key} file",
        )
        _assert_equal(body_entry["ox"], job["origin"][0], f"{body_key} ox")
        _assert_equal(body_entry["oy"], job["origin"][1], f"{body_key} oy")
        checked_bodies += 1

        if job["pairedShadowSlot"] is None:
            _assert_equal(
                metadata["outputs"]["shadow"],
                None,
                f"{metadata['jobId']} shadowless output",
            )
            _assert_equal(
                metadata["shadow"]["method"],
                "intentionally-shadowless-state",
                f"{metadata['jobId']} shadowless method",
            )
            checked_shadowless += 1
            continue

        shadow_path = output_root / metadata["outputs"]["shadow"]
        if not shadow_path.is_file():
            raise FileNotFoundError(shadow_path)
        shadow = Image.open(shadow_path).convert("RGBA")
        canonical_shadow = Image.open(
            job["shadowReferenceAbsolute"]
        ).convert("RGBA")
        calibration = calibrate_shadow(
            canonical_shadow,
            job["shadowOrigin"],
        )
        shadow_contact = tuple(
            float(value)
            for value in metadata["shadow"]["derivation"]["shadowContact"]
        )
        derivation = metadata["shadow"]["derivation"]
        if derivation.get("version") == "shadow-v4-paired-transform":
            shadow_quality = validate_shadow_v4(
                shadow,
                canonical_shadow,
                calibration,
                derivation,
                family=job["family"],
            )
        else:
            shadow_quality = validate_shadow(
                shadow,
                canonical_shadow,
                shadow_contact,
                calibration,
                derivation["projectionMatrix"],
            )
        _assert_equal(
            metadata["shadow"]["canonicalShadowPixelsCopied"],
            False,
            f"{metadata['jobId']} canonical shadow reuse",
        )
        _assert_equal(
            metadata["shadow"]["bodyAlphaAuthority"],
            alpha_sha256(body),
            f"{metadata['jobId']} shadow body authority",
        )
        _assert_equal(
            file_sha256(shadow_path),
            metadata["shadow"]["fileSha256"],
            f"{metadata['jobId']} shadow file hash",
        )
        _assert_equal(
            shadow_quality["canonicalPixelIdentical"],
            False,
            f"{metadata['jobId']} generated shadow authority",
        )
        shadow_key = f"{metadata['id']}_s{job['pairedShadowSlot']}"
        shadow_entry = manifest["sprites"].get(shadow_key)
        if shadow_entry is None:
            raise ValueError(f"manifest is missing {shadow_key}")
        _assert_equal(
            shadow_entry["derivedFrom"],
            body_key,
            f"{shadow_key} derivation",
        )
        _assert_equal(
            shadow_entry["ox"],
            job["shadowOrigin"][0],
            f"{shadow_key} ox",
        )
        _assert_equal(
            shadow_entry["oy"],
            job["shadowOrigin"][1],
            f"{shadow_key} oy",
        )
        checked_shadows += 1

    inventory = read_inventory(inventory_path)
    expected_bodies = int(inventory["summary"]["bodyVariantCount"])
    expected_shadows = int(inventory["summary"]["pairedShadowVariantCount"])
    expected_shadowless = int(
        inventory["summary"]["shadowlessBodyVariantCount"]
    )
    if require_complete:
        _assert_equal(checked_bodies, expected_bodies, "complete body count")
        _assert_equal(checked_shadows, expected_shadows, "complete shadow count")
        _assert_equal(
            checked_shadowless,
            expected_shadowless,
            "complete shadowless count",
        )
        _assert_equal(
            manifest["status"],
            "production-complete",
            "complete manifest status",
        )

    # Every sprite reference must remain inside the selected raised-HD root.
    for key, sprite in manifest["sprites"].items():
        path = (output_root / sprite["file"]).resolve()
        try:
            path.relative_to(output_root)
        except ValueError as error:
            raise ValueError(f"{key} escapes output root") from error
        if not path.is_file():
            raise FileNotFoundError(path)

    return {
        "status": "ok",
        "manifest": str(manifest_path),
        "manifestStatus": manifest["status"],
        "checkedBodies": checked_bodies,
        "expectedBodies": expected_bodies,
        "checkedShadows": checked_shadows,
        "expectedShadows": expected_shadows,
        "checkedShadowlessBodies": checked_shadowless,
        "expectedShadowlessBodies": expected_shadowless,
        "lightingContract": LIGHTING_CONTRACT,
        "canonicalShadowPixelsCopied": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--require-complete", action="store_true")
    parser.add_argument("--sync-manifest", action="store_true")
    args = parser.parse_args()
    result = validate_all(
        output_root=args.output_root,
        inventory_path=args.inventory,
        manifest_path=args.manifest,
        require_complete=args.require_complete,
        resync_manifest=args.sync_manifest,
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
