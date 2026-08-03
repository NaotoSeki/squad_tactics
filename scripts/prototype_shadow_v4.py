#!/usr/bin/env python3
"""Build PS/current/direct-v3 shadow comparisons for three representative assets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

try:
    from .raised_hd_pipeline import (
        calibrate_shadow,
        find_job,
        make_world_review,
    )
    from .shadow_v4_pipeline import synthesize_shadow_v4
except ImportError:
    from raised_hd_pipeline import calibrate_shadow, find_job, make_world_review
    from shadow_v4_pipeline import synthesize_shadow_v4


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = (
    ROOT / "output" / "shadow_v4_prototype" / "three_family_comparison.png"
)
EXAMPLES = (
    (
        ROOT / "asset" / "environment" / "raised_hd" / "inventory.json",
        ROOT / "asset" / "environment" / "raised_hd",
        "german_village_barn_007_ver_01",
        4,
    ),
    (
        ROOT
        / "asset"
        / "environment"
        / "trees_hd"
        / "tree_inventory.json",
        ROOT / "asset" / "environment" / "trees_hd" / "production",
        "ulmus-minor_c_01",
        2,
    ),
    (
        ROOT / "asset" / "environment" / "raised_hd" / "inventory.json",
        ROOT / "asset" / "environment" / "raised_hd",
        "compose_005_0",
        2,
    ),
)


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        Path("C:/Windows/Fonts/meiryo.ttc"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ):
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def fit_rgb(path: Path, size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as source:
        image = source.convert("RGB")
        image.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, (36, 41, 34))
    canvas.paste(
        image,
        ((size[0] - image.width) // 2, (size[1] - image.height) // 2),
    )
    return canvas


def fit_shadow_on_ground(path: Path, size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as source:
        shadow = source.convert("RGBA")
        ground = Image.new("RGBA", shadow.size, (145, 137, 111, 255))
        ground.alpha_composite(shadow)
        image = ground.convert("RGB")
        image.thumbnail(size, Image.Resampling.NEAREST)
    canvas = Image.new("RGB", size, (36, 41, 34))
    canvas.paste(
        image,
        ((size[0] - image.width) // 2, (size[1] - image.height) // 2),
    )
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    work = args.output.parent / "work"
    work.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []

    for inventory_path, output_root, asset_id, body_slot in EXAMPLES:
        job = find_job(inventory_path, asset_id, body_slot)
        job_id = job["jobId"]
        manifest = read_json(output_root / "manifest.json")
        metadata_path = output_root / "metadata" / f"{job_id}.json"
        metadata = read_json(metadata_path)
        body_key = f"{asset_id}_s{body_slot}"
        shadow_key = f"{asset_id}_s{job['pairedShadowSlot']}"
        body_path = output_root / manifest["sprites"][body_key]["file"]
        current_shadow_path = (
            output_root / manifest["sprites"][shadow_key]["file"]
        )
        canonical_shadow_path = Path(job["shadowReferenceAbsolute"])
        body = Image.open(body_path).convert("RGBA")
        canonical_body = Image.open(job["referenceAbsolute"]).convert("RGBA")
        current_shadow = Image.open(current_shadow_path).convert("RGBA")
        canonical_shadow = Image.open(canonical_shadow_path).convert("RGBA")
        canonical_shadow_hd = canonical_shadow.resize(
            (
                canonical_shadow.width * 2,
                canonical_shadow.height * 2,
            ),
            Image.Resampling.LANCZOS,
        )
        calibration = calibrate_shadow(
            canonical_shadow,
            job["shadowOrigin"],
        )
        body_contact = tuple(
            float(value)
            for value in metadata["body"]["quality"]["contact"]
        )
        shadow_contact = (
            float(calibration["referenceContact"][0]) * 2,
            float(calibration["referenceContact"][1]) * 2,
        )
        direct_shadow, derivation = synthesize_shadow_v4(
            body,
            job["origin"],
            body_contact,
            job["shadowOrigin"],
            calibration,
            family=job["family"],
            canonical_body=canonical_body,
        )
        reference_review = work / f"{job_id}_reference.png"
        current_review = work / f"{job_id}_current.png"
        direct_review = work / f"{job_id}_direct.png"
        make_world_review(
            body,
            job["origin"],
            reference_review,
            job_label=f"{job_id} | PS shadow audit",
            shadow=canonical_shadow_hd,
            shadow_origin=job["shadowOrigin"],
            body_contact=body_contact,
            shadow_contact=shadow_contact,
        )
        make_world_review(
            body,
            job["origin"],
            current_review,
            job_label=f"{job_id} | current",
            shadow=current_shadow,
            shadow_origin=job["shadowOrigin"],
            body_contact=body_contact,
            shadow_contact=shadow_contact,
        )
        make_world_review(
            body,
            job["origin"],
            direct_review,
            job_label=f"{job_id} | shadow-v4-paired",
            shadow=direct_shadow,
            shadow_origin=job["shadowOrigin"],
            body_contact=body_contact,
            shadow_contact=shadow_contact,
        )
        direct_shadow_path = work / f"{job_id}_shadow_v4.png"
        reference_shadow_path = work / f"{job_id}_shadow_reference.png"
        canonical_shadow_hd.save(reference_shadow_path, optimize=True)
        direct_shadow.save(direct_shadow_path, optimize=True)
        records.append(
            {
                "jobId": job_id,
                "family": job["family"],
                "reference": reference_review,
                "current": current_review,
                "direct": direct_review,
                "referenceShadow": reference_shadow_path,
                "currentShadow": current_shadow_path,
                "directShadow": direct_shadow_path,
                "fit": derivation["layers"],
                "resultBbox": derivation["resultBbox"],
            }
        )
        body.close()
        current_shadow.close()
        canonical_shadow.close()
        canonical_shadow_hd.close()
        direct_shadow.close()

    preview_size = (360, 310)
    margin = 14
    header = 62
    row_height = preview_size[1] + header + margin
    width = preview_size[0] * 3 + margin * 4
    sheet = Image.new(
        "RGB",
        (width, row_height * len(records)),
        (27, 31, 25),
    )
    draw = ImageDraw.Draw(sheet)
    title_font = font(17)
    label_font = font(13)
    note_font = font(10)
    labels = (
        ("PS geometry reference", (190, 194, 178)),
        ("current generated shadow", (215, 149, 127)),
        ("shadow-v4 paired BODY projection", (168, 218, 154)),
    )
    for row, record in enumerate(records):
        top = row * row_height
        draw.text(
            (margin, top + 8),
            f"{record['jobId']} | {record['family']}",
            font=title_font,
            fill=(231, 234, 218),
        )
        paths = (
            record["reference"],
            record["current"],
            record["direct"],
        )
        for column, (label, color) in enumerate(labels):
            left = margin + column * (preview_size[0] + margin)
            draw.text(
                (left, top + 35),
                label,
                font=label_font,
                fill=color,
            )
            if column == 2:
                draw.text(
                    (left + 210, top + 38),
                    f"bbox {record['resultBbox']}",
                    font=note_font,
                    fill=(166, 172, 156),
                )
            sheet.paste(
                fit_rgb(paths[column], preview_size),
                (left, top + header),
            )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, optimize=True)
    shadow_preview_size = (360, 190)
    shadow_header = 56
    shadow_row_height = shadow_preview_size[1] + shadow_header + margin
    shadow_sheet = Image.new(
        "RGB",
        (
            shadow_preview_size[0] * 3 + margin * 4,
            shadow_row_height * len(records),
        ),
        (27, 31, 25),
    )
    shadow_draw = ImageDraw.Draw(shadow_sheet)
    for row, record in enumerate(records):
        top = row * shadow_row_height
        shadow_draw.text(
            (margin, top + 8),
            f"{record['jobId']} | shadow only",
            font=title_font,
            fill=(231, 234, 218),
        )
        shadow_paths = (
            record["referenceShadow"],
            record["currentShadow"],
            record["directShadow"],
        )
        for column, (label, color) in enumerate(labels):
            left = margin + column * (shadow_preview_size[0] + margin)
            shadow_draw.text(
                (left, top + 33),
                label,
                font=label_font,
                fill=color,
            )
            shadow_sheet.paste(
                fit_shadow_on_ground(
                    shadow_paths[column],
                    shadow_preview_size,
                ),
                (left, top + shadow_header),
            )
    shadow_only_output = args.output.with_name(
        f"{args.output.stem}_shadow_only{args.output.suffix}"
    )
    shadow_sheet.save(shadow_only_output, optimize=True)
    summary_path = args.output.with_suffix(".json")
    summary_path.write_text(
        json.dumps(
            {
                "status": "prototype",
                "canonicalPixelsCopied": False,
                "records": [
                    {
                        "jobId": record["jobId"],
                        "family": record["family"],
                        "directShadow": str(record["directShadow"]),
                        "fit": record["fit"],
                        "resultBbox": record["resultBbox"],
                    }
                    for record in records
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "status": "ok",
                "examples": len(records),
                "output": str(args.output.resolve()),
                "shadowOnly": str(shadow_only_output.resolve()),
                "summary": str(summary_path.resolve()),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
