"""Build a labelled contact sheet from extracted transparent PNG sprites."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def make_contact_sheet(
    images: list[Path],
    output: Path,
    *,
    columns: int = 4,
    cell_width: int = 300,
    cell_height: int = 240,
) -> None:
    if not images:
        raise ValueError("no PNG images supplied")
    columns = max(1, columns)
    rows = math.ceil(len(images) / columns)
    label_height = 28
    margin = 12
    canvas = Image.new(
        "RGB",
        (columns * cell_width, rows * cell_height),
        (28, 31, 28),
    )
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=14)

    for index, path in enumerate(images):
        col = index % columns
        row = index // columns
        x0 = col * cell_width
        y0 = row * cell_height
        draw.rectangle(
            (x0 + 2, y0 + 2, x0 + cell_width - 3, y0 + cell_height - 3),
            fill=(42, 46, 39),
            outline=(91, 96, 80),
        )
        sprite = Image.open(path).convert("RGBA")
        bbox = sprite.getbbox()
        if bbox:
            sprite = sprite.crop(bbox)
            available_w = cell_width - margin * 2
            available_h = cell_height - label_height - margin * 2
            scale = min(available_w / sprite.width, available_h / sprite.height)
            scale = max(scale, 1.0)
            resized = sprite.resize(
                (
                    max(1, round(sprite.width * scale)),
                    max(1, round(sprite.height * scale)),
                ),
                Image.Resampling.NEAREST,
            )
            px = x0 + (cell_width - resized.width) // 2
            py = y0 + margin + (available_h - resized.height) // 2
            canvas.paste(resized, (px, py), resized)
        label = path.stem
        draw.text(
            (x0 + margin, y0 + cell_height - label_height + 4),
            label,
            fill=(220, 218, 194),
            font=font,
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--cell-width", type=int, default=300)
    parser.add_argument("--cell-height", type=int, default=240)
    parser.add_argument("--recursive", action="store_true")
    args = parser.parse_args()
    image_glob = args.input_dir.rglob if args.recursive else args.input_dir.glob
    images = sorted(image_glob("*.png"))
    make_contact_sheet(
        images,
        args.output,
        columns=args.columns,
        cell_width=args.cell_width,
        cell_height=args.cell_height,
    )
    print("SSC_CONTACT_SHEET OK images=%d path=%s" % (len(images), args.output.resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
