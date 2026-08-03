#!/usr/bin/env python3
"""Render diagnostic overviews of PSM brightness, tiles, and cell flags."""

from __future__ import annotations

import argparse
from pathlib import Path
import struct

from PIL import Image, ImageDraw

from psm_inspect import (
    decompress_members,
    find_member,
    parse_map_info,
    sized_block,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("psm", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--scale", type=int, default=2)
    return parser.parse_args()


def iso_cell(
    draw: ImageDraw.ImageDraw,
    gx: int,
    gy: int,
    map_height: int,
    scale: int,
    fill: tuple[int, int, int],
) -> None:
    center_x = (gx - gy + map_height) * scale
    center_y = (gx + gy) * scale // 2
    draw.polygon(
        (
            (center_x, center_y - scale // 2),
            (center_x + scale, center_y),
            (center_x, center_y + scale // 2),
            (center_x - scale, center_y),
        ),
        fill=fill,
    )


def main() -> int:
    args = parse_args()
    members = decompress_members(args.psm.read_bytes())
    info_member = find_member(members, "MAP_INFO")
    map_member = find_member(members, "MAP_CELLS")
    _, width, height = parse_map_info(info_member)
    brightness = sized_block(map_member, "MAP_BRIGHTNESS")
    tiles = sized_block(map_member, "MAP_TILES")
    cells = sized_block(map_member, "MAP_CELLS")
    depth = sized_block(map_member, "MAP_DEPTH")

    if len(brightness) != (width + 1) * (height + 1):
        raise ValueError("unexpected MAP_BRIGHTNESS size")
    if len(tiles) != width * height * 4:
        raise ValueError("unexpected MAP_TILES size")
    if len(cells) != width * height * 3:
        raise ValueError("unexpected MAP_CELLS size")
    if len(depth) != width * height * 8:
        raise ValueError("unexpected MAP_DEPTH size")

    scale = max(2, args.scale)
    size = ((width + height + 2) * scale, (width + height + 2) * scale // 2)
    layers = {
        "brightness": Image.new("RGB", size, (16, 18, 16)),
        "tiles": Image.new("RGB", size, (16, 18, 16)),
        "cells": Image.new("RGB", size, (16, 18, 16)),
        "depth": Image.new("RGB", size, (16, 18, 16)),
    }
    draws = {name: ImageDraw.Draw(image) for name, image in layers.items()}
    depth_values = struct.unpack("<%dH" % (len(depth) // 2), depth)

    for gy in range(height):
        for gx in range(width):
            cell_index = gy * width + gx
            vertex_stride = width + 1
            vertex_values = (
                brightness[gy * vertex_stride + gx],
                brightness[gy * vertex_stride + gx + 1],
                brightness[(gy + 1) * vertex_stride + gx],
                brightness[(gy + 1) * vertex_stride + gx + 1],
            )
            brightness_value = round(sum(vertex_values) / 4)
            shade = round(brightness_value * 255 / 45)
            iso_cell(
                draws["brightness"],
                gx,
                gy,
                height,
                scale,
                (shade, shade, shade),
            )

            tile_values = tiles[cell_index * 4 : cell_index * 4 + 4]
            tile_count = sum(value == 64 for value in tile_values)
            iso_cell(
                draws["tiles"],
                gx,
                gy,
                height,
                scale,
                (30 + tile_count * 45, 45 + tile_count * 35, 35),
            )

            cell_value = cells[cell_index * 3 + 2]
            cell_colors = {
                0: (35, 45, 34),
                2: (211, 167, 70),
                4: (188, 76, 62),
            }
            iso_cell(
                draws["cells"],
                gx,
                gy,
                height,
                scale,
                cell_colors.get(cell_value, (150, 60, 180)),
            )

            values = depth_values[cell_index * 4 : cell_index * 4 + 4]
            value = round(sum(values) / 4)
            red = value * 37 % 256
            green = value * 73 % 256
            blue = value * 109 % 256
            iso_cell(
                draws["depth"],
                gx,
                gy,
                height,
                scale,
                (red, green, blue),
            )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for name, image in layers.items():
        path = args.out_dir / f"{args.psm.stem}_{name}_iso.png"
        image.save(path, optimize=True)
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
