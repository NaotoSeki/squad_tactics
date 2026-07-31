#!/usr/bin/env python3
"""Rebuild completed tree shadows with the approved V4 light-only contract."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import tempfile
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

try:
    from .raised_hd_pipeline import (
        alpha_sha256,
        atomic_write_json,
        calibrate_shadow,
        file_sha256,
        find_job,
        make_world_review,
        sync_manifest,
    )
    from .shadow_v4_pipeline import synthesize_shadow_v4, validate_shadow_v4
except ImportError:
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
DEFAULT_INVENTORY = (
    ROOT / "asset" / "environment" / "trees_hd" / "tree_inventory.json"
)
DEFAULT_OUTPUT_ROOT = (
    ROOT / "asset" / "environment" / "trees_hd" / "production"
)
DEFAULT_PREVIEW = (
    ROOT / "output" / "tree_hd_review" / "shadow_v4_light_before_after.png"
)
DEFAULT_PREVIEW_IDS = (
    "populus-tremuloides_a_01",
    "tilia-europaea_c_01",
    "ulmus-minor_c_01",
    "pseudotsuga-menziesii_a_01",
)


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


def banding_score(image: Image.Image) -> float:
    alpha = np.asarray(image.getchannel("A"), dtype=np.float32) / 255.0
    bbox = image.getchannel("A").getbbox()
    if not bbox:
        return 0.0
    crop = alpha[bbox[1]:bbox[3], bbox[0]:bbox[2]]
    if crop.shape[0] < 3:
        return 0.0
    first = np.diff(crop, axis=0)
    second = np.diff(first, axis=0)
    return float(np.mean(np.abs(second)))


def font(size: int) -> ImageFont.ImageFont:
    for path in (
        Path("C:/Windows/Fonts/meiryo.ttc"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ):
        if path.is_file():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def fit_rgb(path: Path, size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as source:
        image = source.convert("RGB")
        image.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, (36, 42, 34))
    canvas.paste(
        image,
        ((size[0] - image.width) // 2, (size[1] - image.height) // 2),
    )
    return canvas


def build_preview(
    records: list[dict[str, Any]],
    output: Path,
) -> None:
    preview_size = (420, 300)
    margin = 14
    header = 56
    row_height = preview_size[1] + header + margin
    sheet = Image.new(
        "RGB",
        (preview_size[0] * 2 + margin * 3, row_height * len(records)),
        (28, 32, 26),
    )
    draw = ImageDraw.Draw(sheet)
    title = font(17)
    label = font(13)
    note = font(11)
    for index, record in enumerate(records):
        top = index * row_height
        draw.text(
            (margin, top + 8),
            record["jobId"],
            font=title,
            fill=(226, 230, 211),
        )
        draw.text(
            (margin, top + 32),
            "before",
            font=label,
            fill=(209, 164, 132),
        )
        draw.text(
            (margin + preview_size[0] + margin, top + 32),
            "tree shadow V4 light-only",
            font=label,
            fill=(171, 214, 155),
        )
        draw.text(
            (margin + 74, top + 34),
            f"banding {record['beforeBanding']:.4f}",
            font=note,
            fill=(179, 183, 167),
        )
        draw.text(
            (margin + preview_size[0] + margin + 124, top + 34),
            f"banding {record['afterBanding']:.4f}",
            font=note,
            fill=(179, 183, 167),
        )
        image_top = top + header
        sheet.paste(
            fit_rgb(record["beforeReview"], preview_size),
            (margin, image_top),
        )
        sheet.paste(
            fit_rgb(record["afterReview"], preview_size),
            (margin * 2 + preview_size[0], image_top),
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, optimize=True)


def rebuild(
    *,
    inventory_path: Path,
    output_root: Path,
    selected_ids: set[str] | None,
    preview_only: bool,
    preview_output: Path,
) -> dict[str, Any]:
    inventory = read_json(inventory_path)
    production_manifest_path = output_root / "manifest.json"
    production = read_json(production_manifest_path)
    preview_dir = preview_output.parent / "shadow_v2_work"
    records: list[dict[str, Any]] = []
    rebuilt = 0

    for asset in inventory["assets"]:
        asset_id = str(asset["id"])
        if selected_ids is not None and asset_id not in selected_ids:
            continue
        for variant in asset["bodyVariants"]:
            body_slot = int(variant["bodySlot"])
            shadow_slot = variant.get("pairedShadowSlot")
            if shadow_slot is None:
                continue
            job = find_job(inventory_path, asset_id, body_slot)
            job_id = job["jobId"]
            body_key = f"{asset_id}_s{body_slot}"
            shadow_key = f"{asset_id}_s{int(shadow_slot)}"
            body_path = output_root / production["sprites"][body_key]["file"]
            shadow_path = (
                output_root / production["sprites"][shadow_key]["file"]
            )
            metadata_path = output_root / "metadata" / f"{job_id}.json"
            metadata = read_json(metadata_path)

            body = Image.open(body_path).convert("RGBA")
            before_shadow = Image.open(shadow_path).convert("RGBA")
            canonical_shadow = Image.open(
                Path(job["shadowReferenceAbsolute"])
            ).convert("RGBA")
            canonical_body = Image.open(
                Path(job["referenceAbsolute"])
            ).convert("RGBA")
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
                family="tree",
                canonical_body=canonical_body,
                light_only=True,
            )
            shadow_contact = tuple(
                float(value) for value in derivation["shadowContact"]
            )
            quality = validate_shadow_v4(
                shadow,
                canonical_shadow,
                calibration,
                derivation,
                family="tree",
            )

            before_review_path = preview_dir / f"{job_id}_before.png"
            after_review_path = preview_dir / f"{job_id}_after.png"
            make_world_review(
                body,
                job["origin"],
                before_review_path,
                job_label=f"{job_id} before",
                shadow=before_shadow,
                shadow_origin=job["shadowOrigin"],
                body_contact=body_contact,
                shadow_contact=shadow_contact,
            )
            after_review = make_world_review(
                body,
                job["origin"],
                after_review_path,
                job_label=f"{job_id} tree shadow V4 light-only",
                shadow=shadow,
                shadow_origin=job["shadowOrigin"],
                body_contact=body_contact,
                shadow_contact=shadow_contact,
            )
            records.append(
                {
                    "jobId": job_id,
                    "beforeReview": before_review_path,
                    "afterReview": after_review_path,
                    "beforeBanding": banding_score(before_shadow),
                    "afterBanding": banding_score(shadow),
                }
            )

            if not preview_only:
                save_png_atomic(shadow, shadow_path)
                review_path = (
                    output_root / "review" / f"{job_id}_world_review.png"
                )
                with Image.open(after_review_path) as review_source:
                    review_image = review_source.convert("RGB")
                    save_png_atomic(review_image, review_path)
                    review_image.close()
                metadata["shadow"]["method"] = (
                    "paired-canonical-body-transform-v4-light-only"
                )
                metadata["shadow"]["bodyAlphaAuthority"] = alpha_sha256(body)
                metadata["shadow"]["calibration"] = calibration
                metadata["shadow"]["derivation"] = derivation
                metadata["shadow"]["quality"] = quality
                metadata["shadow"]["fileSha256"] = file_sha256(shadow_path)
                metadata["shadow"]["alphaSha256"] = alpha_sha256(shadow)
                metadata["shadow"]["canonicalShadowPixelsCopied"] = False
                metadata["review"] = after_review
                atomic_write_json(metadata_path, metadata)
                rebuilt += 1

            body.close()
            before_shadow.close()
            canonical_shadow.close()
            canonical_body.close()
            shadow.close()

    if not records:
        raise ValueError("no tree shadow records selected")
    build_preview(records, preview_output)
    if not preview_only:
        sync_manifest(output_root, inventory_path)
    return {
        "status": "ok",
        "previewOnly": preview_only,
        "selected": len(records),
        "rebuilt": rebuilt,
        "beforeBandingMean": round(
            float(np.mean([item["beforeBanding"] for item in records])),
            6,
        ),
        "afterBandingMean": round(
            float(np.mean([item["afterBanding"] for item in records])),
            6,
        ),
        "preview": str(preview_output.resolve()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--id", action="append", dest="ids")
    parser.add_argument("--preview-only", action="store_true")
    parser.add_argument("--preview-output", type=Path, default=DEFAULT_PREVIEW)
    args = parser.parse_args()

    ids = set(args.ids) if args.ids else None
    if args.preview_only and ids is None:
        ids = set(DEFAULT_PREVIEW_IDS)
    result = rebuild(
        inventory_path=args.inventory.resolve(),
        output_root=args.output_root.resolve(),
        selected_ids=ids,
        preview_only=args.preview_only,
        preview_output=args.preview_output.resolve(),
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
