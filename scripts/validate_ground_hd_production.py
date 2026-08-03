#!/usr/bin/env python3
"""Validate the complete HD-ground catalog against its canonical PS sources."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, UnidentifiedImageError

try:
    from .ground_hd_quality import conspicuous_magenta_spill
except ImportError:
    from ground_hd_quality import conspicuous_magenta_spill


ROOT = Path(__file__).resolve().parents[1]
HD_DIR = ROOT / "asset" / "environment" / "ground_hd"
DEFAULT_INVENTORY = HD_DIR / "inventory.json"
DEFAULT_MANIFEST = HD_DIR / "manifest.json"
EXPECTED_ASSET_COUNT = 238
EXPECTED_PIXEL_RATIO = 2
EXPECTED_LIGHTING_ID = "ps-overcast-upper-left-v1"
VISIBLE_ALPHA_THRESHOLD = 16


def _issue(
    issues: list[dict[str, Any]],
    code: str,
    detail: str,
    asset: str | None = None,
) -> None:
    item: dict[str, Any] = {"code": code, "detail": detail}
    if asset is not None:
        item["asset"] = asset
    issues.append(item)


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def _resolve(owner: Path, value: str) -> Path:
    return (owner.parent / value).resolve()


def _manifest_overrides(
    manifest: dict[str, Any],
    issues: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    raw = manifest.get("overrides")
    if not isinstance(raw, list):
        _issue(issues, "manifest.overrides.invalid", "overrides must be a list")
        return {}

    result: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            _issue(
                issues,
                "manifest.override.invalid",
                f"override at index {index} must be an object",
            )
            continue
        asset_id = item.get("id")
        if not isinstance(asset_id, str) or not asset_id:
            _issue(
                issues,
                "manifest.override.id.invalid",
                f"override at index {index} has no non-empty id",
            )
            continue
        if asset_id in result:
            _issue(
                issues,
                "manifest.override.id.duplicate",
                "override id occurs more than once",
                asset_id,
            )
            continue
        result[asset_id] = item
    return result


def _validate_lighting(
    manifest: dict[str, Any],
    manifest_path: Path,
    issues: list[dict[str, Any]],
) -> str | None:
    lighting = manifest.get("lightingContract")
    if not isinstance(lighting, dict):
        _issue(
            issues,
            "lighting.contract.missing",
            "manifest has no lightingContract object",
        )
        return None

    lighting_id = lighting.get("id")
    if lighting_id != EXPECTED_LIGHTING_ID:
        _issue(
            issues,
            "lighting.id.invalid",
            f"expected {EXPECTED_LIGHTING_ID!r}, found {lighting_id!r}",
        )
    if lighting.get("keyOrigin") != "screen upper-left":
        _issue(
            issues,
            "lighting.key.invalid",
            "keyOrigin must be 'screen upper-left'",
        )
    if lighting.get("shadowDirection") != "screen lower-right":
        _issue(
            issues,
            "lighting.shadow.invalid",
            "shadowDirection must be 'screen lower-right'",
        )

    spec_value = lighting.get("spec")
    if not isinstance(spec_value, str) or not spec_value:
        _issue(
            issues,
            "lighting.spec.missing",
            "lightingContract.spec must reference the shared specification",
        )
    else:
        spec_path = _resolve(manifest_path, spec_value)
        if not spec_path.is_file():
            _issue(
                issues,
                "lighting.spec.not_found",
                f"shared specification does not exist: {spec_path}",
            )
        else:
            spec_text = spec_path.read_text(encoding="utf-8")
            for required in (
                EXPECTED_LIGHTING_ID,
                "screen upper-left",
                "screen lower-right",
            ):
                if required not in spec_text:
                    _issue(
                        issues,
                        "lighting.spec.content",
                        f"shared specification does not contain {required!r}",
                    )

    generation = manifest.get("generationDefinition")
    prompt_contract = (
        generation.get("promptContract")
        if isinstance(generation, dict)
        else None
    )
    prompt_text = (
        " ".join(str(value) for value in prompt_contract)
        if isinstance(prompt_contract, list)
        else ""
    )
    for required in (
        EXPECTED_LIGHTING_ID,
        "screen upper-left",
        "screen lower-right",
    ):
        if required not in prompt_text:
            _issue(
                issues,
                "lighting.prompt.reference",
                f"generation prompt contract does not contain {required!r}",
            )

    return lighting_id if isinstance(lighting_id, str) else None


def _validate_override_metadata(
    item: dict[str, Any],
    override: dict[str, Any] | None,
    lighting_id: str | None,
    inventory_path: Path,
    manifest_path: Path,
    issues: list[dict[str, Any]],
) -> None:
    asset_id = item["id"]
    if override is None:
        _issue(
            issues,
            "manifest.override.missing",
            "inventory asset has no manifest override",
            asset_id,
        )
        return

    expected_file = f"{asset_id}_hd_v1.png"
    expected_size = [
        int(item["referenceSize"][0]) * EXPECTED_PIXEL_RATIO,
        int(item["referenceSize"][1]) * EXPECTED_PIXEL_RATIO,
    ]
    expected_fields = {
        "family": item["family"],
        "file": expected_file,
        "referenceSize": item["referenceSize"],
        "outputSize": expected_size,
        "canonicalSlot": int(item["canonicalSlot"]),
        "lightingContract": lighting_id,
    }
    for field, expected in expected_fields.items():
        if override.get(field) != expected:
            _issue(
                issues,
                f"manifest.override.{field}.mismatch",
                f"expected {expected!r}, found {override.get(field)!r}",
                asset_id,
            )

    reference_value = override.get("reference")
    if not isinstance(reference_value, str):
        _issue(
            issues,
            "manifest.override.reference.invalid",
            "override reference must be a relative path string",
            asset_id,
        )
    else:
        inventory_reference = _resolve(inventory_path, item["reference"])
        manifest_reference = _resolve(manifest_path, reference_value)
        if inventory_reference != manifest_reference:
            _issue(
                issues,
                "manifest.override.reference.mismatch",
                (
                    f"override resolves to {manifest_reference}; "
                    f"inventory resolves to {inventory_reference}"
                ),
                asset_id,
            )


def _validate_inventory_reference(
    inventory: dict[str, Any],
    inventory_path: Path,
    manifest: dict[str, Any],
    manifest_path: Path,
    asset_count: int,
    issues: list[dict[str, Any]],
) -> None:
    reference = manifest.get("inventory")
    if not isinstance(reference, dict):
        _issue(
            issues,
            "manifest.inventory.missing",
            "manifest must identify the inventory used to build its overrides",
        )
        return

    file_value = reference.get("file")
    if not isinstance(file_value, str) or not file_value:
        _issue(
            issues,
            "manifest.inventory.file.invalid",
            "manifest inventory.file must be a relative path string",
        )
    elif _resolve(manifest_path, file_value) != inventory_path:
        _issue(
            issues,
            "manifest.inventory.file.mismatch",
            (
                f"manifest resolves to {_resolve(manifest_path, file_value)}; "
                f"validator uses {inventory_path}"
            ),
        )
    if reference.get("schema") != inventory.get("schema"):
        _issue(
            issues,
            "manifest.inventory.schema.mismatch",
            (
                f"expected {inventory.get('schema')!r}, "
                f"found {reference.get('schema')!r}"
            ),
        )
    if reference.get("assetCount") != asset_count:
        _issue(
            issues,
            "manifest.inventory.count.mismatch",
            (
                f"expected {asset_count}, "
                f"found {reference.get('assetCount')!r}"
            ),
        )


def _validate_image(
    item: dict[str, Any],
    inventory_path: Path,
    hd_dir: Path,
    issues: list[dict[str, Any]],
) -> bool:
    asset_id = item["id"]
    reference_path = _resolve(inventory_path, item["reference"])
    output_path = hd_dir / f"{asset_id}_hd_v1.png"
    if not reference_path.is_file():
        _issue(
            issues,
            "reference.not_found",
            f"canonical PS source does not exist: {reference_path}",
            asset_id,
        )
        return False
    if not output_path.is_file():
        _issue(
            issues,
            "output.not_found",
            f"HD output does not exist: {output_path}",
            asset_id,
        )
        return False

    try:
        with Image.open(reference_path) as source:
            source.load()
            reference_format = source.format
            reference_bands = source.getbands()
            reference = source.convert("RGBA")
        with Image.open(output_path) as source:
            source.load()
            output_format = source.format
            output_bands = source.getbands()
            output = source.convert("RGBA")
    except (OSError, UnidentifiedImageError) as error:
        _issue(
            issues,
            "output.unreadable",
            f"could not decode reference/output PNG: {error}",
            asset_id,
        )
        return False

    valid = True
    declared_reference_size = tuple(item["referenceSize"])
    if reference.size != declared_reference_size:
        _issue(
            issues,
            "reference.size.mismatch",
            (
                f"inventory declares {declared_reference_size}, "
                f"canonical source is {reference.size}"
            ),
            asset_id,
        )
        valid = False
    if reference_format != "PNG":
        _issue(
            issues,
            "reference.format.invalid",
            f"canonical source format is {reference_format!r}, expected 'PNG'",
            asset_id,
        )
        valid = False
    if "A" not in reference_bands and "transparency" not in reference.info:
        _issue(
            issues,
            "reference.alpha.missing",
            "canonical PS source has no alpha/transparency channel",
            asset_id,
        )
        valid = False

    expected_size = (
        reference.width * EXPECTED_PIXEL_RATIO,
        reference.height * EXPECTED_PIXEL_RATIO,
    )
    if output_format != "PNG":
        _issue(
            issues,
            "output.format.invalid",
            f"HD output format is {output_format!r}, expected 'PNG'",
            asset_id,
        )
        valid = False
    if "A" not in output_bands and "transparency" not in output.info:
        _issue(
            issues,
            "output.alpha.missing",
            "HD output has no alpha/transparency channel",
            asset_id,
        )
        valid = False
    if output.size != expected_size:
        _issue(
            issues,
            "output.size.mismatch",
            f"HD output is {output.size}; exact 2x size is {expected_size}",
            asset_id,
        )
        return False

    canonical_array = np.asarray(
        reference.resize(
            expected_size,
            Image.Resampling.LANCZOS,
        )
    )
    expected_alpha = canonical_array[:, :, 3]
    rgba = np.asarray(output)
    actual_alpha = rgba[:, :, 3]
    if not np.array_equal(expected_alpha, actual_alpha):
        difference = np.abs(
            expected_alpha.astype(np.int16) - actual_alpha.astype(np.int16)
        )
        _issue(
            issues,
            "output.alpha.mismatch",
            (
                f"{int(np.count_nonzero(difference))} alpha pixels differ "
                f"from the exact 2x canonical footprint; "
                f"max delta={int(difference.max())}"
            ),
            asset_id,
        )
        valid = False
    if not np.any(actual_alpha > VISIBLE_ALPHA_THRESHOLD):
        _issue(
            issues,
            "output.alpha.empty",
            "HD output has no visible pixels",
            asset_id,
        )
        valid = False

    magenta = conspicuous_magenta_spill(rgba, canonical_array)
    magenta_count = int(np.count_nonzero(magenta))
    if magenta_count:
        _issue(
            issues,
            "output.magenta_spill",
            f"{magenta_count} visible pixels retain conspicuous magenta",
            asset_id,
        )
        valid = False
    return valid


def validate_production(
    inventory_path: Path = DEFAULT_INVENTORY,
    manifest_path: Path = DEFAULT_MANIFEST,
    hd_dir: Path | None = None,
    *,
    expected_asset_count: int = EXPECTED_ASSET_COUNT,
    manifest_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a machine-readable report; no source or output file is modified."""

    inventory_path = inventory_path.resolve()
    manifest_path = manifest_path.resolve()
    hd_dir = (hd_dir or manifest_path.parent).resolve()
    inventory = _load_json(inventory_path)
    manifest = (
        _load_json(manifest_path)
        if manifest_data is None
        else manifest_data
    )
    issues: list[dict[str, Any]] = []

    assets = inventory.get("assets")
    if not isinstance(assets, list):
        raise ValueError("inventory assets must be a list")
    if len(assets) != expected_asset_count:
        _issue(
            issues,
            "inventory.count.mismatch",
            f"expected {expected_asset_count} assets, found {len(assets)}",
        )
    declared_count = inventory.get("summary", {}).get("drawableCount")
    if declared_count != len(assets):
        _issue(
            issues,
            "inventory.summary.count.mismatch",
            f"summary drawableCount={declared_count!r}, assets={len(assets)}",
        )

    asset_ids = [
        item.get("id")
        for item in assets
        if isinstance(item, dict)
    ]
    if len(asset_ids) != len(set(asset_ids)):
        _issue(
            issues,
            "inventory.id.duplicate",
            "inventory contains duplicate ids",
        )

    if manifest.get("pixelRatio") != EXPECTED_PIXEL_RATIO:
        _issue(
            issues,
            "manifest.pixel_ratio.invalid",
            (
                f"expected pixelRatio={EXPECTED_PIXEL_RATIO}, "
                f"found {manifest.get('pixelRatio')!r}"
            ),
        )
    if manifest.get("runtimeRenderScale") != 1 / EXPECTED_PIXEL_RATIO:
        _issue(
            issues,
            "manifest.runtime_scale.invalid",
            (
                f"expected runtimeRenderScale={1 / EXPECTED_PIXEL_RATIO}, "
                f"found {manifest.get('runtimeRenderScale')!r}"
            ),
        )
    if manifest.get("status") != "production-complete":
        _issue(
            issues,
            "manifest.status.incomplete",
            (
                "production validation requires status='production-complete'; "
                f"found {manifest.get('status')!r}"
            ),
        )

    _validate_inventory_reference(
        inventory,
        inventory_path,
        manifest,
        manifest_path,
        len(assets),
        issues,
    )
    lighting_id = _validate_lighting(manifest, manifest_path, issues)
    overrides = _manifest_overrides(manifest, issues)
    expected_ids = {
        item["id"]
        for item in assets
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    extra_ids = sorted(set(overrides) - expected_ids)
    for asset_id in extra_ids:
        _issue(
            issues,
            "manifest.override.extra",
            "manifest override is not present in inventory",
            asset_id,
        )

    present_count = 0
    valid_image_count = 0
    for raw_item in assets:
        if not isinstance(raw_item, dict) or not isinstance(raw_item.get("id"), str):
            _issue(
                issues,
                "inventory.asset.invalid",
                "every inventory asset must be an object with a string id",
            )
            continue
        asset_id = raw_item["id"]
        _validate_override_metadata(
            raw_item,
            overrides.get(asset_id),
            lighting_id,
            inventory_path,
            manifest_path,
            issues,
        )
        output = hd_dir / f"{asset_id}_hd_v1.png"
        if output.is_file():
            present_count += 1
        if _validate_image(raw_item, inventory_path, hd_dir, issues):
            valid_image_count += 1

    report = {
        "schema": "ground-hd-production-validation/v1",
        "ok": not issues,
        "inventoryAssetCount": len(assets),
        "manifestOverrideCount": len(overrides),
        "outputPresentCount": present_count,
        "validImageCount": valid_image_count,
        "issueCount": len(issues),
        "issues": issues,
    }
    return report


def _print_human(report: dict[str, Any], max_issues: int) -> None:
    print(
        "ground HD production validation: "
        f"{'PASS' if report['ok'] else 'FAIL'}; "
        f"inventory={report['inventoryAssetCount']}; "
        f"manifest={report['manifestOverrideCount']}; "
        f"present={report['outputPresentCount']}; "
        f"valid={report['validImageCount']}; "
        f"issues={report['issueCount']}"
    )
    for item in report["issues"][:max_issues]:
        asset = f" [{item['asset']}]" if "asset" in item else ""
        print(f"- {item['code']}{asset}: {item['detail']}")
    remaining = report["issueCount"] - min(max_issues, report["issueCount"])
    if remaining:
        print(f"- ... {remaining} more issue(s); use --json for the full report")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--hd-dir", type=Path)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--max-issues", type=int, default=20)
    args = parser.parse_args()

    report = validate_production(
        args.inventory,
        args.manifest,
        args.hd_dir,
    )
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        _print_human(report, max(0, args.max_issues))
    raise SystemExit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
