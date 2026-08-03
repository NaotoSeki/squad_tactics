#!/usr/bin/env python3
"""Stage and atomically install V4 light-only shadows for every raised-HD BODY."""

from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
import shutil
import tempfile
from typing import Any

from PIL import Image

try:
    from .package_tree_hd_runtime import crop_about_anchor
    from .raised_hd_pipeline import (
        alpha_sha256,
        atomic_write_json,
        calibrate_shadow,
        file_sha256,
        find_job,
        make_world_review,
        sync_manifest,
    )
    from .shadow_v4_pipeline import (
        synthesize_shadow_v4,
        validate_shadow_v4,
    )
except ImportError:
    from package_tree_hd_runtime import crop_about_anchor
    from raised_hd_pipeline import (
        alpha_sha256,
        atomic_write_json,
        calibrate_shadow,
        file_sha256,
        find_job,
        make_world_review,
        sync_manifest,
    )
    from shadow_v4_pipeline import synthesize_shadow_v4, validate_shadow_v4


ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / "asset" / "environment"
RAISED_ROOT = ENV / "raised_hd"
TREE_HD_ROOT = ENV / "trees_hd"
TREE_PRODUCTION = TREE_HD_ROOT / "production"
STAGING_ROOT = ROOT / "output" / "shadow_v4_light_staging"
BACKUP_ROOT = ROOT / "output" / "shadow_v4_light_backup_20260730"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def save_png_atomic(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f".{path.stem}.",
        suffix=".png",
        dir=path.parent,
    )
    os.close(descriptor)
    try:
        image.save(temp_name, "PNG", optimize=True)
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def backup_file(path: Path, relative: Path) -> None:
    if not path.is_file():
        return
    destination = BACKUP_ROOT / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        shutil.copy2(path, destination)


def stage_catalog(
    *,
    name: str,
    output_root: Path,
    inventory_path: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    inventory = read_json(inventory_path)
    manifest = read_json(output_root / "manifest.json")
    stage_root = STAGING_ROOT / name
    records: list[dict[str, Any]] = []
    family_counts: dict[str, int] = {}

    for asset in inventory["assets"]:
        asset_id = str(asset["id"])
        family = str(asset["family"])
        for variant in asset["bodyVariants"]:
            body_slot = int(variant["bodySlot"])
            shadow_slot = variant.get("pairedShadowSlot")
            if shadow_slot is None:
                continue
            job = find_job(inventory_path, asset_id, body_slot)
            job_id = str(job["jobId"])
            body_key = f"{asset_id}_s{body_slot}"
            shadow_key = f"{asset_id}_s{int(shadow_slot)}"
            metadata_path = output_root / "metadata" / f"{job_id}.json"
            metadata = read_json(metadata_path)
            body_path = output_root / manifest["sprites"][body_key]["file"]
            shadow_relative = Path(metadata["outputs"]["shadow"])
            shadow_path = output_root / shadow_relative
            review_relative = Path("review") / f"{job_id}_world_review.png"
            review_path = output_root / review_relative

            with Image.open(body_path) as source:
                body = source.convert("RGBA")
            with Image.open(job["referenceAbsolute"]) as source:
                canonical_body = source.convert("RGBA")
            with Image.open(job["shadowReferenceAbsolute"]) as source:
                canonical_shadow = source.convert("RGBA")
            calibration = calibrate_shadow(
                canonical_shadow,
                job["shadowOrigin"],
            )
            body_contact = tuple(
                float(value)
                for value in metadata["body"]["quality"]["contact"]
            )
            shadow, derivation = synthesize_shadow_v4(
                body,
                job["origin"],
                body_contact,
                job["shadowOrigin"],
                calibration,
                family=family,
                canonical_body=canonical_body,
                light_only=True,
            )
            quality = validate_shadow_v4(
                shadow,
                canonical_shadow,
                calibration,
                derivation,
                family=family,
            )

            staged_shadow = stage_root / shadow_relative
            staged_review = stage_root / review_relative
            staged_metadata = stage_root / "metadata" / f"{job_id}.json"
            save_png_atomic(shadow, staged_shadow)
            review = make_world_review(
                body,
                job["origin"],
                staged_review,
                job_label=f"{job_id} | shadow V4 light-only",
                shadow=shadow,
                shadow_origin=job["shadowOrigin"],
                body_contact=body_contact,
                shadow_contact=tuple(
                    float(value)
                    for value in derivation["shadowContact"]
                ),
            )

            updated = copy.deepcopy(metadata)
            updated["shadow"]["method"] = (
                "paired-canonical-body-transform-v4-light-only"
            )
            updated["shadow"]["bodyAlphaAuthority"] = alpha_sha256(body)
            updated["shadow"]["calibration"] = calibration
            updated["shadow"]["derivation"] = derivation
            updated["shadow"]["quality"] = quality
            updated["shadow"]["fileSha256"] = file_sha256(staged_shadow)
            updated["shadow"]["alphaSha256"] = alpha_sha256(shadow)
            updated["shadow"]["canonicalShadowPixelsCopied"] = False
            updated["review"] = review
            atomic_write_json(staged_metadata, updated)
            records.append(
                {
                    "catalog": name,
                    "jobId": job_id,
                    "family": family,
                    "bodyKey": body_key,
                    "shadowKey": shadow_key,
                    "sourceShadow": shadow_path,
                    "sourceMetadata": metadata_path,
                    "sourceReview": review_path,
                    "stagedShadow": staged_shadow,
                    "stagedMetadata": staged_metadata,
                    "stagedReview": staged_review,
                    "shadowRelative": shadow_relative,
                    "reviewRelative": review_relative,
                    "quality": quality,
                }
            )
            family_counts[family] = family_counts.get(family, 0) + 1
            body.close()
            canonical_body.close()
            canonical_shadow.close()
            shadow.close()

            if len(records) % 25 == 0:
                print(f"{name}: staged {len(records)} shadows", flush=True)

    expected = int(inventory["summary"]["pairedShadowVariantCount"])
    if len(records) != expected:
        raise ValueError(
            f"{name}: staged {len(records)} shadows, expected {expected}"
        )
    return records, {
        "catalog": name,
        "staged": len(records),
        "families": dict(sorted(family_counts.items())),
    }


def stage_approved_tree() -> dict[str, Any]:
    public_manifest_path = TREE_HD_ROOT / "manifest.json"
    public_manifest = read_json(public_manifest_path)
    canonical_manifest_path = ENV / "ps_objects" / "manifest.json"
    canonical_manifest = read_json(canonical_manifest_path)
    approved = public_manifest["overrides"][0]
    tree_id = str(approved["id"])
    body_key = f"{tree_id}_s2"
    shadow_key = f"{tree_id}_s4"
    body_meta = canonical_manifest["sprites"][body_key]
    shadow_meta = canonical_manifest["sprites"][shadow_key]
    canonical_root = canonical_manifest_path.parent

    public_body_path = TREE_HD_ROOT / Path(approved["body"]).name
    public_shadow_path = TREE_HD_ROOT / Path(approved["shadow"]).name
    with Image.open(public_body_path) as source:
        public_body = source.convert("RGBA")
    body = crop_about_anchor(
        public_body,
        (
            float(approved["ox"]) * public_body.width,
            float(approved["oy"]) * public_body.height,
        ),
        (int(body_meta["w"]) * 2, int(body_meta["h"]) * 2),
        (-int(body_meta["ox"]) * 2, -int(body_meta["oy"]) * 2),
    )
    with Image.open(canonical_root / body_meta["file"]) as source:
        canonical_body = source.convert("RGBA")
    with Image.open(canonical_root / shadow_meta["file"]) as source:
        canonical_shadow = source.convert("RGBA")

    body_origin = (int(body_meta["ox"]), int(body_meta["oy"]))
    shadow_origin = (int(shadow_meta["ox"]), int(shadow_meta["oy"]))
    body_contact = (-body_origin[0] * 2.0, -body_origin[1] * 2.0)
    calibration = calibrate_shadow(canonical_shadow, shadow_origin)
    shadow, derivation = synthesize_shadow_v4(
        body,
        body_origin,
        body_contact,
        shadow_origin,
        calibration,
        family="tree",
        canonical_body=canonical_body,
        light_only=True,
    )
    quality = validate_shadow_v4(
        shadow,
        canonical_shadow,
        calibration,
        derivation,
        family="tree",
    )

    public_shadow_size = (
        int(approved["stw"]),
        int(approved["sth"]),
    )
    public_shadow_anchor = (
        float(approved["sox"]) * public_shadow_size[0],
        float(approved["soy"]) * public_shadow_size[1],
    )
    cropped_shadow_anchor = (
        -float(shadow_origin[0]) * 2.0,
        -float(shadow_origin[1]) * 2.0,
    )
    left = round(public_shadow_anchor[0] - cropped_shadow_anchor[0])
    top = round(public_shadow_anchor[1] - cropped_shadow_anchor[1])
    padded = Image.new("RGBA", public_shadow_size, (0, 0, 0, 0))
    padded.alpha_composite(shadow, (left, top))

    staged_shadow = (
        STAGING_ROOT / "approved" / public_shadow_path.name
    )
    staged_metadata = (
        STAGING_ROOT
        / "approved"
        / f"{tree_id}_shadow_hd_v4_light.json"
    )
    staged_manifest = STAGING_ROOT / "approved" / "manifest.json"
    save_png_atomic(padded, staged_shadow)
    sidecar = {
        "schema": "approved-tree-shadow/v4-light",
        "id": tree_id,
        "body": str(public_body_path.relative_to(ROOT)),
        "shadow": str(public_shadow_path.relative_to(ROOT)),
        "bodyAlphaSha256": alpha_sha256(body),
        "canonicalShadowPixelsCopied": False,
        "calibration": calibration,
        "derivation": derivation,
        "quality": quality,
        "fileSha256": file_sha256(staged_shadow),
        "alphaSha256": alpha_sha256(padded),
    }
    atomic_write_json(staged_metadata, sidecar)

    updated_manifest = copy.deepcopy(public_manifest)
    updated_manifest["generationDefinition"]["postprocess"][
        "shadowDefinition"
    ] = {
        "method": (
            "paired canonical BODY/SHADOW transform applied to final "
            "generated BODY; V4 light-only grade"
        ),
        "version": "shadow-v4-paired-transform",
        "reference": "../trees_ps/quercus-cerris_a_02_shadow.png",
        "referenceRole": (
            "BODY-to-shadow transform calibration only; no canonical "
            "shadow pixels are copied"
        ),
        "bodyAuthority": "final generated BODY alpha and foliage luminance",
        "familyModel": "separate generated canopy and trunk projection",
        "darkCoreRemoved": True,
        "lightOnlyKneeAlpha": 52,
        "lightOnlyCapAlpha": 76,
        "color": [16, 13, 26],
        "runtimeMotion": "static; shares the trunk-base world anchor",
        "metadata": f"{tree_id}_shadow_hd_v4_light.json",
    }
    atomic_write_json(staged_manifest, updated_manifest)

    public_body.close()
    body.close()
    canonical_body.close()
    canonical_shadow.close()
    shadow.close()
    padded.close()
    return {
        "catalog": "approved",
        "jobId": f"{tree_id}_s2",
        "sourceShadow": public_shadow_path,
        "sourceManifest": public_manifest_path,
        "targetMetadata": TREE_HD_ROOT / staged_metadata.name,
        "stagedShadow": staged_shadow,
        "stagedMetadata": staged_metadata,
        "stagedManifest": staged_manifest,
        "quality": quality,
    }


def install_catalog(
    records: list[dict[str, Any]],
    *,
    name: str,
    output_root: Path,
    inventory_path: Path,
) -> None:
    backup_file(
        output_root / "manifest.json",
        Path(name) / "manifest.json",
    )
    for record in records:
        backup_file(
            record["sourceShadow"],
            Path(name) / record["shadowRelative"],
        )
        backup_file(
            record["sourceMetadata"],
            Path(name) / "metadata" / record["sourceMetadata"].name,
        )
        backup_file(
            record["sourceReview"],
            Path(name) / record["reviewRelative"],
        )
        record["sourceShadow"].parent.mkdir(parents=True, exist_ok=True)
        record["sourceMetadata"].parent.mkdir(parents=True, exist_ok=True)
        record["sourceReview"].parent.mkdir(parents=True, exist_ok=True)
        os.replace(record["stagedShadow"], record["sourceShadow"])
        os.replace(record["stagedMetadata"], record["sourceMetadata"])
        os.replace(record["stagedReview"], record["sourceReview"])
    sync_manifest(output_root, inventory_path)


def install_approved(record: dict[str, Any]) -> None:
    backup_file(
        record["sourceShadow"],
        Path("approved") / record["sourceShadow"].name,
    )
    backup_file(
        record["sourceManifest"],
        Path("approved") / "manifest.json",
    )
    os.replace(record["stagedShadow"], record["sourceShadow"])
    os.replace(record["stagedManifest"], record["sourceManifest"])
    os.replace(record["stagedMetadata"], record["targetMetadata"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--commit",
        action="store_true",
        help="install the fully validated staging set into production",
    )
    args = parser.parse_args()

    targets = (
        (
            "raised",
            RAISED_ROOT,
            RAISED_ROOT / "inventory.json",
        ),
        (
            "trees",
            TREE_PRODUCTION,
            TREE_HD_ROOT / "tree_inventory.json",
        ),
    )
    all_records: dict[str, list[dict[str, Any]]] = {}
    summaries: list[dict[str, Any]] = []
    for name, output_root, inventory_path in targets:
        records, summary = stage_catalog(
            name=name,
            output_root=output_root,
            inventory_path=inventory_path,
        )
        all_records[name] = records
        summaries.append(summary)
    approved = stage_approved_tree()
    summaries.append({"catalog": "approved", "staged": 1, "families": {"tree": 1}})

    if args.commit:
        for name, output_root, inventory_path in targets:
            install_catalog(
                all_records[name],
                name=name,
                output_root=output_root,
                inventory_path=inventory_path,
            )
        install_approved(approved)

    result = {
        "status": "ok",
        "committed": args.commit,
        "shadowContract": "shadow-v4-paired-transform-light-only",
        "darkCoreRemoved": True,
        "lightOnlyKneeAlpha": 52,
        "lightOnlyCapAlpha": 76,
        "canonicalShadowPixelsCopied": False,
        "catalogs": summaries,
        "totalStaged": sum(item["staged"] for item in summaries),
        "backup": str(BACKUP_ROOT.resolve()) if args.commit else None,
        "staging": str(STAGING_ROOT.resolve()),
    }
    output = ROOT / "output" / "shadow_v4_light_rebuild_summary.json"
    atomic_write_json(output, result)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
