#!/usr/bin/env python3
"""Build a labelled original-vs-HD contact sheet for PS battlefield backgrounds."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SEED_RE = re.compile(r"^ps_seed_(\d+)_ground_hd_x(\d+)\.png$")


def _font(size: int) -> ImageFont.ImageFont:
    candidates = (
        Path("C:/Windows/Fonts/meiryo.ttc"),
        Path("C:/Windows/Fonts/arial.ttf"),
    )
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def _fit_rgb(path: Path, size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as source:
        image = source.convert("RGB")
        image.thumbnail(size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", size, (24, 27, 23))
        x = (size[0] - image.width) // 2
        y = (size[1] - image.height) // 2
        canvas.paste(image, (x, y))
        return canvas


def build_review(
    hd_dir: Path,
    canonical_dir: Path,
    output: Path,
    *,
    columns: int = 3,
    preview_size: int = 300,
) -> Path:
    records: list[tuple[int, int, Path, Path]] = []
    for hd_path in hd_dir.glob("ps_seed_*_ground_hd_x*.png"):
        match = SEED_RE.match(hd_path.name)
        if not match:
            continue
        seed = int(match.group(1))
        ratio = int(match.group(2))
        canonical_path = canonical_dir / f"ps_seed_{seed}.png"
        if canonical_path.is_file():
            records.append((seed, ratio, canonical_path, hd_path))
    records.sort()
    if not records:
        raise SystemExit(f"no matched HD maps in {hd_dir}")

    columns = max(1, columns)
    rows = (len(records) + columns - 1) // columns
    margin = 18
    gap = 10
    header = 54
    cell_width = preview_size * 2 + gap + margin * 2
    cell_height = preview_size + header + margin
    sheet = Image.new(
        "RGB",
        (cell_width * columns, cell_height * rows),
        (31, 35, 29),
    )
    draw = ImageDraw.Draw(sheet)
    title_font = _font(18)
    label_font = _font(13)

    for index, (seed, ratio, canonical_path, hd_path) in enumerate(records):
        column = index % columns
        row = index // columns
        left = column * cell_width
        top = row * cell_height
        draw.rounded_rectangle(
            (left + 5, top + 5, left + cell_width - 5, top + cell_height - 5),
            radius=12,
            fill=(42, 47, 38),
            outline=(102, 111, 86),
            width=2,
        )
        draw.text(
            (left + margin, top + 13),
            f"seed {seed}  |  logical view 620×620",
            font=title_font,
            fill=(229, 232, 214),
        )
        draw.text(
            (left + margin, top + 37),
            "PS original",
            font=label_font,
            fill=(181, 190, 164),
        )
        draw.text(
            (left + margin + preview_size + gap, top + 37),
            f"HD ground x{ratio}",
            font=label_font,
            fill=(198, 215, 166),
        )
        original = _fit_rgb(canonical_path, (preview_size, preview_size))
        hd = _fit_rgb(hd_path, (preview_size, preview_size))
        image_top = top + header
        sheet.paste(original, (left + margin, image_top))
        sheet.paste(hd, (left + margin + preview_size + gap, image_top))

    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--hd-dir",
        type=Path,
        default=Path("output/ground_hd_maps"),
    )
    parser.add_argument(
        "--canonical-dir",
        type=Path,
        default=Path("asset/environment/maps"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("output/ground_hd_review/all_maps_original_vs_hd.png"),
    )
    parser.add_argument("--columns", type=int, default=3)
    parser.add_argument("--preview-size", type=int, default=300)
    args = parser.parse_args()
    print(
        build_review(
            args.hd_dir,
            args.canonical_dir,
            args.output,
            columns=args.columns,
            preview_size=args.preview_size,
        )
    )


if __name__ == "__main__":
    main()
