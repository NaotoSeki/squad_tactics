#!/usr/bin/env python3
"""Build a local damage plate while preserving the source scene elsewhere."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat


DISPLAY_SIZE = (960, 640)
NATIVE_SIZE = (864, 576)
CROP_BOX = (468, 0, 814, 346)
SOURCE_POINTS = [
    (80, 48),
    (185, 42),
    (258, 78),
    (310, 132),
    (311, 188),
    (262, 196),
    (240, 209),
    (205, 216),
    (118, 205),
    (88, 181),
    (73, 131),
]
SOURCE_POINT_SIZE = 384


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--before-native", type=Path, required=True)
    parser.add_argument("--before-display", type=Path, required=True)
    parser.add_argument("--palette-companion", type=Path, required=True)
    parser.add_argument("--generated-crop", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    return parser.parse_args()


def exact_palette(images: list[Image.Image]) -> Image.Image:
    counts: Counter[tuple[int, int, int]] = Counter()
    for image in images:
        counts.update(image.convert("RGB").get_flattened_data())
    colors = [color for color, _ in counts.most_common(256)]
    if not colors:
        raise ValueError("cannot build a palette from empty images")
    colors.extend([colors[-1]] * (256 - len(colors)))
    flattened = [channel for color in colors for channel in color]
    palette = Image.new("P", (1, 1))
    palette.putpalette(flattened)
    return palette


def polygon_mask(size: tuple[int, int]) -> Image.Image:
    scale_x = size[0] / SOURCE_POINT_SIZE
    scale_y = size[1] / SOURCE_POINT_SIZE
    points = [
        (round(x * scale_x), round(y * scale_y))
        for x, y in SOURCE_POINTS
    ]
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask


def match_context(
    candidate: Image.Image,
    reference: Image.Image,
    target_mask: Image.Image,
) -> tuple[Image.Image, dict[str, object]]:
    expanded = target_mask.filter(ImageFilter.MaxFilter(31))
    context_mask = ImageChops.invert(expanded)
    source_stat = ImageStat.Stat(candidate, mask=context_mask)
    reference_stat = ImageStat.Stat(reference, mask=context_mask)
    source_means = source_stat.mean[:3]
    reference_means = reference_stat.mean[:3]
    source_stddev = source_stat.stddev[:3]
    reference_stddev = reference_stat.stddev[:3]

    channels = candidate.convert("RGB").split()
    matched_channels: list[Image.Image] = []
    for index, channel in enumerate(channels):
        source_sigma = max(1.0, source_stddev[index])
        ratio = reference_stddev[index] / source_sigma
        table = []
        for value in range(256):
            transferred = (
                (value - source_means[index]) * ratio
                + reference_means[index]
            )
            # Preserve local generated shading while removing most global
            # grade drift.
            blended = value * 0.35 + transferred * 0.65
            table.append(max(0, min(255, round(blended))))
        matched_channels.append(channel.point(table))

    return (
        Image.merge("RGB", matched_channels),
        {
            "candidate_context_mean": [
                round(value, 3) for value in source_means
            ],
            "reference_context_mean": [
                round(value, 3) for value in reference_means
            ],
            "candidate_context_stddev": [
                round(value, 3) for value in source_stddev
            ],
            "reference_context_stddev": [
                round(value, 3) for value in reference_stddev
            ],
        },
    )


def diff_metrics(
    before: Image.Image,
    after: Image.Image,
) -> tuple[dict[str, object], Image.Image]:
    difference = ImageChops.difference(before, after)
    mask = difference.convert("L").point(lambda value: 255 if value else 0)
    changed = sum(value > 0 for value in mask.get_flattened_data())
    total = before.width * before.height
    overlay = before.convert("L").convert("RGB")
    overlay.paste(Image.new("RGB", before.size, (222, 60, 38)), mask=mask)
    return (
        {
            "changed_pixels": changed,
            "total_pixels": total,
            "unchanged_ratio": round(1 - changed / total, 6),
            "difference_bbox": list(difference.getbbox() or (0, 0, 0, 0)),
        },
        overlay,
    )


def main() -> None:
    args = parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    before_native = Image.open(args.before_native).convert("RGB")
    before_display = Image.open(args.before_display).convert("RGB")
    companion = Image.open(args.palette_companion).convert("RGB")
    if before_native.size != NATIVE_SIZE:
        raise ValueError(f"expected native size {NATIVE_SIZE}")
    if before_display.size != DISPLAY_SIZE:
        raise ValueError(f"expected display size {DISPLAY_SIZE}")

    crop_size = (CROP_BOX[2] - CROP_BOX[0], CROP_BOX[3] - CROP_BOX[1])
    reference_crop = before_native.crop(CROP_BOX)
    generated = Image.open(args.generated_crop).convert("RGB").resize(
        crop_size,
        Image.Resampling.LANCZOS,
    )
    hard_mask = polygon_mask(crop_size)
    matched, color_metrics = match_context(
        generated,
        reference_crop,
        hard_mask,
    )

    palette = exact_palette([before_native, companion])
    matched = matched.quantize(
        palette=palette,
        dither=Image.Dither.NONE,
    ).convert("RGB")
    feathered_mask = hard_mask.filter(ImageFilter.GaussianBlur(4.25))

    after_native = before_native.copy()
    after_native.paste(matched, CROP_BOX[:2], feathered_mask)
    after_display = after_native.resize(
        DISPLAY_SIZE,
        Image.Resampling.BILINEAR,
    )

    plate = matched.convert("RGBA")
    plate.putalpha(feathered_mask)
    mask_display = Image.new("L", NATIVE_SIZE, 0)
    mask_display.paste(feathered_mask, CROP_BOX[:2])
    mask_display = mask_display.resize(
        DISPLAY_SIZE,
        Image.Resampling.BILINEAR,
    )

    native_metrics, native_diff = diff_metrics(before_native, after_native)
    display_metrics, display_diff = diff_metrics(
        before_display,
        after_display,
    )

    after_native_path = args.out_dir / "farm_local_damage_after_native.png"
    after_display_path = args.out_dir / "farm_local_damage_after_ps.png"
    plate_path = args.out_dir / "farmhouse_damage_plate_native.png"
    mask_path = args.out_dir / "farmhouse_damage_mask_display.png"
    diff_path = args.out_dir / "farm_local_damage_diff.png"
    native_diff_path = args.out_dir / "farm_local_damage_diff_native.png"
    manifest_path = args.out_dir / "manifest.json"

    after_native.save(after_native_path, optimize=True)
    after_display.save(after_display_path, optimize=True)
    plate.save(plate_path, optimize=True)
    mask_display.save(mask_path, optimize=True)
    display_diff.save(diff_path, optimize=True)
    native_diff.save(native_diff_path, optimize=True)

    manifest = {
        "schema": "squad-tactics-scene-conditioned-damage-v1",
        "source": str(args.before_display),
        "generated_crop": str(args.generated_crop),
        "native_size": list(NATIVE_SIZE),
        "display_size": list(DISPLAY_SIZE),
        "crop_box_native": list(CROP_BOX),
        "plate_anchor_native": list(CROP_BOX[:2]),
        "palette_source_colors": len(
            set(before_native.get_flattened_data())
            | set(companion.get_flattened_data())
        ),
        "color_match": color_metrics,
        "native_metrics": native_metrics,
        "display_metrics": display_metrics,
        "outputs": {
            "after_native": after_native_path.name,
            "after_display": after_display_path.name,
            "plate": plate_path.name,
            "mask": mask_path.name,
            "diff": diff_path.name,
        },
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(manifest_path)


if __name__ == "__main__":
    main()
