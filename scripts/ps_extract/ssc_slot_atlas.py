#!/usr/bin/env python3
"""Render a labelled, origin-aligned atlas for one extracted SSC asset."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canonical-root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--asset", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--slots", help="Inclusive slot range, for example 24-95")
    parser.add_argument("--columns", type=int, default=8)
    parser.add_argument("--scale", type=int, default=3)
    return parser.parse_args()


def slot_bounds(spec: str | None) -> tuple[int, int] | None:
    if not spec:
        return None
    start, separator, end = spec.partition("-")
    if not separator:
        value = int(start)
        return value, value
    return int(start), int(end)


def checkerboard(size: tuple[int, int], scale: int) -> Image.Image:
    image = Image.new("RGB", size, (47, 50, 44))
    draw = ImageDraw.Draw(image)
    block = max(4, scale * 2)
    for y in range(0, size[1], block):
        for x in range(0, size[0], block):
            if (x // block + y // block) % 2:
                draw.rectangle(
                    (x, y, min(size[0], x + block) - 1, min(size[1], y + block) - 1),
                    fill=(55, 59, 51),
                )
    return image


def main() -> int:
    args = parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    asset_key = args.asset.casefold()
    bounds = slot_bounds(args.slots)
    entries = [
        entry
        for entry in manifest["sprites"]
        if Path(entry["ssc"]).stem.casefold() == asset_key
        and (
            bounds is None
            or bounds[0] <= int(entry["slot"]) <= bounds[1]
        )
    ]
    entries.sort(key=lambda entry: int(entry["slot"]))
    if not entries:
        raise SystemExit(f"no slots found for asset {args.asset!r}")

    scale = max(1, args.scale)
    columns = max(1, args.columns)
    rows = (len(entries) + columns - 1) // columns
    min_x = min(int(entry["origin_x"]) for entry in entries)
    min_y = min(int(entry["origin_y"]) for entry in entries)
    max_x = max(int(entry["origin_x"]) + int(entry["width"]) for entry in entries)
    max_y = max(int(entry["origin_y"]) + int(entry["height"]) for entry in entries)
    padding = 5
    label_height = 18
    sprite_width = (max_x - min_x + padding * 2) * scale
    sprite_height = (max_y - min_y + padding * 2) * scale
    cell_width = max(108, sprite_width)
    cell_height = max(92, sprite_height + label_height)
    canvas = Image.new(
        "RGB",
        (columns * cell_width, rows * cell_height),
        (28, 31, 28),
    )
    font = ImageFont.load_default(size=13)

    anchor_x = (-min_x + padding) * scale
    anchor_y = (-min_y + padding) * scale
    for index, entry in enumerate(entries):
        col = index % columns
        row = index // columns
        x0 = col * cell_width
        y0 = row * cell_height
        cell = checkerboard((cell_width, cell_height - label_height), scale)
        cell_draw = ImageDraw.Draw(cell)
        cell_draw.line(
            (anchor_x - 4, anchor_y, anchor_x + 4, anchor_y),
            fill=(218, 74, 66),
        )
        cell_draw.line(
            (anchor_x, anchor_y - 4, anchor_x, anchor_y + 4),
            fill=(218, 74, 66),
        )

        sprite = Image.open(args.canonical_root / Path(entry["png"])).convert("RGBA")
        if scale != 1:
            sprite = sprite.resize(
                (sprite.width * scale, sprite.height * scale),
                Image.Resampling.NEAREST,
            )
        left = anchor_x + int(entry["origin_x"]) * scale
        top = anchor_y + int(entry["origin_y"]) * scale
        cell.paste(sprite, (left, top), sprite)
        canvas.paste(cell, (x0, y0))

        draw = ImageDraw.Draw(canvas)
        slot = int(entry["slot"])
        format_id = int(entry.get("format_id", 0))
        draw.text(
            (x0 + 6, y0 + cell_height - label_height + 2),
            f"s{slot}  fmt {format_id}",
            fill=(225, 222, 202),
            font=font,
        )
        draw.rectangle(
            (x0, y0, x0 + cell_width - 1, y0 + cell_height - 1),
            outline=(90, 96, 80),
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output)
    print(
        "SSC_SLOT_ATLAS OK asset=%s slots=%d path=%s"
        % (args.asset, len(entries), args.output.resolve())
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
