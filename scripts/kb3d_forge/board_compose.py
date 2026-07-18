# -*- coding: utf-8 -*-
"""Compose a mixed v7 ground and v8 object demonstration board."""

import argparse
import json
import math
import random
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image


TILE_WIDTH = 288
TILE_HEIGHT = 384
ANCHOR_X = 144.0
ANCHOR_Y = 234.5
PX_PER_M = 288.0 / 20.25
HEX_RADIUS_M = 9.0
HORIZONTAL_STEP = math.sqrt(3.0) * HEX_RADIUS_M * PX_PER_M
VERTICAL_STEP = 1.5 * HEX_RADIUS_M * PX_PER_M


def ascii_text(value):
    return str(value).encode("ascii", "replace").decode("ascii")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--v7-dir",
        default="C:/Projects/squad_tactics/asset/environment/hex_tiles_v7",
    )
    parser.add_argument(
        "--v8-dir",
        default="C:/Projects/squad_tactics/asset/environment/hex_tiles_v8",
    )
    parser.add_argument(
        "--out",
        default="C:/Projects/squad_tactics/scratch/kb3d_forge/board_demo.png",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--cols", type=int, default=7)
    parser.add_argument("--rows", type=int, default=6)
    return parser.parse_args()


def warning_missing(path):
    print("WARN missing file %s" % ascii_text(path))


def find_v7_named(v7_dir, stem):
    exact = v7_dir / (stem + ".png")
    if exact.exists():
        return exact

    matches = sorted(v7_dir.glob(stem + "_rot*.png"))
    if matches:
        return matches[0]

    matches = sorted(v7_dir.glob(stem + "*.png"))
    if matches:
        return matches[0]

    warning_missing(exact)
    return None


def load_v8_catalog(v8_dir):
    catalog_path = v8_dir / "catalog.json"
    if not catalog_path.exists():
        warning_missing(catalog_path)
        return []

    try:
        with open(catalog_path, "r", encoding="utf-8") as handle:
            return json.load(handle).get("tiles", [])
    except (OSError, ValueError) as exc:
        print("WARN catalog read failed %s" % ascii_text(exc))
        return []


def make_tile_lookup(tiles):
    lookup = {}
    by_kind = defaultdict(list)

    for tile in tiles:
        if tile.get("kind") not in ("building", "tree", "vignette"):
            continue
        filename = tile.get("file")
        if not filename:
            continue
        key = (
            tile.get("kind"),
            tile.get("base"),
            tile.get("dmg"),
            tile.get("variant"),
            tile.get("rot"),
        )
        lookup[key] = filename
        by_kind[tile["kind"]].append(tile)

    bases = {}
    for kind, entries in by_kind.items():
        grouped = defaultdict(list)
        for entry in entries:
            grouped[entry["base"]].append(entry)
        bases[kind] = grouped

    return lookup, bases


def choose_v8_path(kind, rng, lookup, grouped_bases, v8_dir):
    available = grouped_bases.get(kind, {})
    if not available:
        return None

    base = rng.choice(sorted(available))
    entries = available[base]
    rotation = rng.choice((0, 60, 120, 180, 240, 300))

    if kind == "building":
        damages = sorted({entry.get("dmg") for entry in entries if entry.get("dmg") is not None})
        if not damages:
            return None
        damage = rng.choice(damages)
        key = (kind, base, damage, None, rotation)
    else:
        variants = sorted({entry.get("variant") for entry in entries if entry.get("variant") is not None})
        if not variants:
            return None
        variant = rng.choice(variants)
        key = (kind, base, None, variant, rotation)

    filename = lookup.get(key)
    if filename is None:
        requested = "%s base=%s rot=%d" % (kind, base, rotation)
        print("WARN missing tile %s" % ascii_text(requested))
        return None

    path = v8_dir / filename
    if not path.exists():
        warning_missing(path)
        return None
    return path


def rgba_image(path, cache):
    key = str(path)
    if key not in cache:
        with Image.open(path) as image:
            cache[key] = image.convert("RGBA")
    return cache[key]


def composite_tile(canvas, tile_path, center_x, center_y, cache):
    if tile_path is None:
        return False

    try:
        image = rgba_image(tile_path, cache)
    except (OSError, ValueError) as exc:
        print("WARN image read failed %s" % ascii_text(exc))
        return False

    position = (
        int(round(center_x - ANCHOR_X)),
        int(round(center_y - ANCHOR_Y)),
    )
    canvas.alpha_composite(image, dest=position)
    return True


def cell_center(row, col, min_center_x, min_center_y):
    center_x = min_center_x + col * HORIZONTAL_STEP
    if row % 2:
        center_x += HORIZONTAL_STEP * 0.5
    center_y = min_center_y + row * VERTICAL_STEP
    return center_x, center_y


def main():
    args = parse_args()
    if args.cols < 1 or args.rows < 1:
        raise ValueError("--cols and --rows must be at least 1")

    rng = random.Random(args.seed)
    v7_dir = Path(args.v7_dir)
    v8_dir = Path(args.v8_dir)
    out_path = Path(args.out)

    grass = find_v7_named(v7_dir, "gnd_grass_v0")
    cobble = find_v7_named(v7_dir, "gnd_cobble_v0")
    grounds = [path for path in (grass, cobble) if path is not None]

    roads_and_fields = sorted(v7_dir.glob("*road*.png")) + sorted(v7_dir.glob("*fieldrows*.png"))
    if not grounds:
        print("WARN no ground tiles found")

    tiles = load_v8_catalog(v8_dir)
    lookup, grouped_bases = make_tile_lookup(tiles)

    margin = 12.0
    min_center_x = ANCHOR_X + margin
    min_center_y = ANCHOR_Y + margin
    max_center_x = min_center_x + (args.cols - 1) * HORIZONTAL_STEP + HORIZONTAL_STEP * 0.5
    max_center_y = min_center_y + (args.rows - 1) * VERTICAL_STEP
    canvas_width = int(math.ceil(max_center_x + (TILE_WIDTH - ANCHOR_X) + margin))
    canvas_height = int(math.ceil(max_center_y + (TILE_HEIGHT - ANCHOR_Y) + margin))

    blank = np.zeros((canvas_height, canvas_width, 4), dtype=np.uint8)
    canvas = Image.fromarray(blank, mode="RGBA")
    cache = {}
    placed = 0

    # Pass 1: ground layer for every cell (flat tiles never overlap objects).
    ground_plan = {}
    for row in range(args.rows):
        for col in range(args.cols):
            center_x, center_y = cell_center(row, col, min_center_x, min_center_y)
            if grounds:
                if composite_tile(canvas, rng.choice(grounds), center_x, center_y, cache):
                    placed += 1
            if roads_and_fields and rng.random() < 0.25:
                if composite_tile(canvas, rng.choice(roads_and_fields), center_x, center_y, cache):
                    placed += 1
            ground_plan[(row, col)] = True

    # Pass 2: objects, top row to bottom row so lower rows overlap correctly.
    for row in range(args.rows):
        for col in range(args.cols):
            center_x, center_y = cell_center(row, col, min_center_x, min_center_y)

            if rng.random() < 0.30:
                path = choose_v8_path("building", rng, lookup, grouped_bases, v8_dir)
                if composite_tile(canvas, path, center_x, center_y, cache):
                    placed += 1

            if rng.random() < 0.20:
                path = choose_v8_path("tree", rng, lookup, grouped_bases, v8_dir)
                if composite_tile(canvas, path, center_x, center_y, cache):
                    placed += 1

            if rng.random() < 0.10:
                path = choose_v8_path("vignette", rng, lookup, grouped_bases, v8_dir)
                if composite_tile(canvas, path, center_x, center_y, cache):
                    placed += 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)
    print("BOARD OK cells=%d placed=%d out=%s" % (args.cols * args.rows, placed, ascii_text(out_path)))


if __name__ == "__main__":
    main()
