#!/usr/bin/env python3
"""Finalize one built-in ImageGen raised BODY and its derived HD shadow.

Production path:
1. copy the selected built-in ImageGen PNG into ``tmp/raised_hd``;
2. extract the uniform chroma background with the installed imagegen helper;
3. normalize the generated BODY contour to the exact 2x canonical canvas and
   canonical world/contact anchor;
4. if paired, fit the paired canonical BODY-to-SHADOW transform, apply it to
   the accepted generated BODY, and remove the dense shadow core;
5. write a world-origin review, quality sidecar, and runtime manifest.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import Any

from PIL import Image

try:
    from .raised_hd_pipeline import (
        BODY_VERSION,
        LIGHTING_CONTRACT,
        METADATA_SCHEMA,
        PIXEL_RATIO,
        alpha_sha256,
        atomic_write_json,
        calibrate_shadow,
        file_sha256,
        find_job,
        make_world_review,
        normalize_body,
        relative_posix,
        sync_manifest,
        validate_body,
    )
    from .shadow_v4_pipeline import synthesize_shadow_v4, validate_shadow_v4
except ImportError:
    from raised_hd_pipeline import (
        BODY_VERSION,
        LIGHTING_CONTRACT,
        METADATA_SCHEMA,
        PIXEL_RATIO,
        alpha_sha256,
        atomic_write_json,
        calibrate_shadow,
        file_sha256,
        find_job,
        make_world_review,
        normalize_body,
        relative_posix,
        sync_manifest,
        validate_body,
    )
    from shadow_v4_pipeline import synthesize_shadow_v4, validate_shadow_v4


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INVENTORY = (
    ROOT / "asset" / "environment" / "raised_hd" / "inventory.json"
)
DEFAULT_OUTPUT_ROOT = ROOT / "asset" / "environment" / "raised_hd"
DEFAULT_TMP_ROOT = ROOT / "tmp" / "raised_hd"


def default_chroma_helper() -> Path:
    codex_root = Path(
        os.environ.get("CODEX_HOME", Path.home() / ".codex")
    )
    return (
        codex_root
        / "skills"
        / ".system"
        / "imagegen"
        / "scripts"
        / "remove_chroma_key.py"
    )


def extract_chroma(
    source: Path,
    cutout: Path,
    helper: Path,
) -> None:
    if not helper.is_file():
        raise FileNotFoundError(helper)
    cutout.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        (
            sys.executable,
            str(helper),
            "--input",
            str(source),
            "--out",
            str(cutout),
            "--auto-key",
            "border",
            "--soft-matte",
            "--transparent-threshold",
            "12",
            "--opaque-threshold",
            "220",
            "--despill",
            "--force",
        ),
        check=True,
    )


def _save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f".{path.stem}.",
        suffix=".png",
        dir=path.parent,
    )
    os.close(descriptor)
    try:
        image.save(temp_name, format="PNG", optimize=True)
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def finalize(
    *,
    inventory_path: Path,
    asset_id: str,
    body_slot: int,
    generated_path: Path,
    chroma_helper: Path,
    output_root: Path,
    tmp_root: Path,
    manifest_path: Path | None = None,
) -> dict[str, Any]:
    inventory_path = inventory_path.resolve()
    generated_path = generated_path.resolve()
    chroma_helper = chroma_helper.resolve()
    output_root = output_root.resolve()
    tmp_root = tmp_root.resolve()
    if not inventory_path.is_file():
        raise FileNotFoundError(inventory_path)
    if not generated_path.is_file():
        raise FileNotFoundError(generated_path)
    job = find_job(inventory_path, asset_id, body_slot)
    job_id = job["jobId"]

    tmp_root.mkdir(parents=True, exist_ok=True)
    source_path = tmp_root / f"{job_id}_source.png"
    cutout_path = tmp_root / f"{job_id}_cutout.png"
    if generated_path != source_path:
        shutil.copy2(generated_path, source_path)
    extract_chroma(source_path, cutout_path, chroma_helper)

    reference_path = Path(job["referenceAbsolute"])
    reference = Image.open(reference_path).convert("RGBA")
    cutout = Image.open(cutout_path).convert("RGBA")
    body, normalization = normalize_body(
        cutout,
        reference,
        job["origin"],
    )
    body_quality = validate_body(body, reference, job["origin"])
    body_path = (
        output_root
        / "body"
        / f"{job_id}_body_hd_{BODY_VERSION}.png"
    )

    shadow: Image.Image | None = None
    shadow_path: Path | None = None
    shadow_calibration: dict[str, Any] | None = None
    shadow_derivation: dict[str, Any] | None = None
    shadow_quality: dict[str, Any] | None = None
    if job["pairedShadowSlot"] is not None:
        canonical_shadow_path = Path(job["shadowReferenceAbsolute"])
        canonical_shadow = Image.open(canonical_shadow_path).convert("RGBA")
        shadow_calibration = calibrate_shadow(
            canonical_shadow,
            job["shadowOrigin"],
        )
        body_contact = tuple(
            float(value) for value in body_quality["contact"]
        )
        shadow, shadow_derivation = synthesize_shadow_v4(
            body,
            job["origin"],
            body_contact,
            job["shadowOrigin"],
            shadow_calibration,
            family=job["family"],
            canonical_body=reference,
            light_only=True,
        )
        shadow_quality = validate_shadow_v4(
            shadow,
            canonical_shadow,
            shadow_calibration,
            shadow_derivation,
            family=job["family"],
        )
        shadow_path = (
            output_root
            / "shadow"
            / (
                f"{job['id']}_s{job['pairedShadowSlot']}"
                f"_shadow_hd_{BODY_VERSION}.png"
            )
        )

    # Do not expose a completed BODY until every paired derivative has passed.
    if shadow is not None and shadow_path is not None:
        _save_png(shadow, shadow_path)
    # BODY is the queue completion sentinel and is therefore published last.
    _save_png(body, body_path)

    review_path = output_root / "review" / f"{job_id}_world_review.png"
    review = make_world_review(
        body,
        job["origin"],
        review_path,
        job_label=job_id,
        shadow=shadow,
        shadow_origin=job["shadowOrigin"],
        body_contact=tuple(
            float(value) for value in body_quality["contact"]
        ),
        shadow_contact=(
            tuple(
                float(value)
                for value in shadow_derivation["shadowContact"]
            )
            if shadow_derivation is not None
            else None
        ),
    )

    metadata_path = output_root / "metadata" / f"{job_id}.json"
    metadata = {
        "schema": METADATA_SCHEMA,
        "jobId": job_id,
        "id": job["id"],
        "family": job["family"],
        "roles": job["roles"],
        "bodySlot": job["bodySlot"],
        "pairedShadowSlot": job["pairedShadowSlot"],
        "pixelRatio": PIXEL_RATIO,
        "lightingContract": LIGHTING_CONTRACT,
        "bodyOrigin": job["origin"],
        "shadowOrigin": job["shadowOrigin"],
        "references": {
            "body": job["reference"],
            "shadowCalibration": job["shadowReference"],
            "bodyRole": "numeric canvas/bbox/origin/contact/color calibration",
            "shadowRole": (
                "paired BODY-to-SHADOW transform calibration only; "
                "no canonical shadow pixels are copied"
                if job["pairedShadowSlot"] is not None
                else None
            ),
            "canonicalPixelsCopied": False,
        },
        "provenance": {
            "source": "built-in ImageGen selected output",
            "sourceCopy": str(source_path),
            "sourceSha256": file_sha256(source_path),
            "cutout": str(cutout_path),
            "cutoutSha256": file_sha256(cutout_path),
            "cutoutAlphaSha256": alpha_sha256(cutout),
            "chromaHelper": str(chroma_helper),
        },
        "outputs": {
            "body": relative_posix(body_path, output_root),
            "shadow": (
                relative_posix(shadow_path, output_root)
                if shadow_path is not None
                else None
            ),
            "review": relative_posix(review_path, output_root),
            "metadata": relative_posix(metadata_path, output_root),
        },
        "body": {
            "normalization": normalization,
            "quality": body_quality,
            "fileSha256": file_sha256(body_path),
            "alphaSha256": alpha_sha256(body),
        },
        "shadow": (
            {
                "method": "paired-canonical-body-transform-v4-light-only",
                "bodyAlphaAuthority": alpha_sha256(body),
                "calibration": shadow_calibration,
                "derivation": shadow_derivation,
                "quality": shadow_quality,
                "fileSha256": file_sha256(shadow_path),
                "alphaSha256": alpha_sha256(shadow),
                "canonicalShadowPixelsCopied": False,
            }
            if shadow is not None and shadow_path is not None
            else {
                "method": "intentionally-shadowless-state",
                "canonicalShadowPixelsCopied": False,
            }
        ),
        "review": review,
    }
    atomic_write_json(metadata_path, metadata)
    manifest = sync_manifest(
        output_root,
        inventory_path,
        manifest_path=manifest_path,
    )
    return {
        "jobId": job_id,
        "body": str(body_path),
        "shadow": str(shadow_path) if shadow_path else None,
        "review": str(review_path),
        "metadata": str(metadata_path),
        "manifest": str(
            manifest_path.resolve()
            if manifest_path
            else output_root / "manifest.json"
        ),
        "manifestStatus": manifest["status"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--id", required=True)
    parser.add_argument("--body-slot", type=int, required=True)
    parser.add_argument("--generated", type=Path, required=True)
    parser.add_argument(
        "--chroma-helper",
        type=Path,
        default=default_chroma_helper(),
    )
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--tmp-root", type=Path, default=DEFAULT_TMP_ROOT)
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()

    result = finalize(
        inventory_path=args.inventory,
        asset_id=args.id,
        body_slot=args.body_slot,
        generated_path=args.generated,
        chroma_helper=args.chroma_helper,
        output_root=args.output_root,
        tmp_root=args.tmp_root,
        manifest_path=args.manifest,
    )
    import json

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
