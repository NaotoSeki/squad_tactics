"""
Generate hex maps using the continuous-field cluster approach.
Each map pattern defines terrain assignment; rendering uses shared field + blend.

Usage:
    python generate_map.py --pattern coastal
    python generate_map.py --pattern all
"""

import sys
import os
import time
import math
import argparse
import numpy as np
from PIL import Image
from opensimplex import OpenSimplex

sys.path.insert(0, os.path.dirname(__file__))
from lib.noise_field import generate_field, PALETTES
from lib.hex_render import (TILE_W, TILE_H, CX, CY, HEX_R, COL_SP, ROW_SP, ROW_OFF,
                            get_neighbor, hex_center_pixel, hex_mask, sample_hex_tile,
                            canvas_size, tile_position)
from lib.blend import blend_hex_tile, TERRAIN_PRIORITY


def render_map(terrain_map, fields, cols, rows, out_path):
    """Render a complete hex map using continuous-field sampling + single-pass blend."""
    field_h, field_w = fields['grass'].shape[:2]
    margin_x = TILE_W // 2 + 20
    margin_y = TILE_H // 2 + 20
    cw, ch = canvas_size(cols, rows)
    canvas = Image.new('RGB', (cw, ch), (25, 28, 22))
    hmask = hex_mask()

    for r in range(rows):
        for c in range(cols):
            hx_px, hy_px = hex_center_pixel(r, c)
            field_cx = hx_px + margin_x
            field_cy = hy_px + margin_y
            my_terrain = terrain_map.get((r, c), 'grass')
            if my_terrain not in fields:
                my_terrain = 'grass'

            my_tile = sample_hex_tile(fields[my_terrain], field_cx, field_cy)
            my_tile = blend_hex_tile(my_tile, my_terrain, terrain_map, fields, r, c, field_cx, field_cy)

            rgb = (np.clip(my_tile, 0, 1) * 255).astype(np.uint8)
            pil_tile = Image.fromarray(rgb, 'RGB')
            tile_rgba = pil_tile.convert('RGBA')
            tile_rgba.putalpha(hmask)
            px, py = tile_position(r, c, margin_x, margin_y)
            canvas.paste(pil_tile, (px, py), tile_rgba)

    canvas.save(out_path)


# === Map Patterns ===

def pattern_coastal(cols, rows):
    o1 = OpenSimplex(seed=605)
    o2 = OpenSimplex(seed=606)
    terrain_map = {}
    for r in range(rows):
        for c in range(cols):
            hx = c + (0.5 if r % 2 else 0)
            hy = r * 0.866
            ny = hy / (rows * 0.866) * 10
            coast_x = 2.8 + o1.noise2(ny * 0.35, 0.5) * 1.8 + o2.noise2(ny * 0.7, 1.5) * 0.7
            if hx < coast_x - 0.5:
                terrain_map[(r, c)] = 'water'
            elif hx < coast_x + 1.0:
                terrain_map[(r, c)] = 'grass'
            elif hx > 7.0 + o1.noise2(ny * 0.4, 3.0) * 1.5:
                terrain_map[(r, c)] = 'forest'
            else:
                val = o1.noise2(hx * 0.3, hy * 0.3)
                terrain_map[(r, c)] = 'forest' if val < -0.3 else 'grass'
    return terrain_map


def pattern_river(cols, rows):
    o1 = OpenSimplex(seed=333)
    o2 = OpenSimplex(seed=334)
    terrain_map = {}
    for r in range(rows):
        for c in range(cols):
            hx = c + (0.5 if r % 2 else 0)
            hy = r * 0.866
            river_x = 5.0 + math.sin(hy * 0.6 + 1.0) * 1.8 + o1.noise2(hy * 0.3, 0.5) * 1.0
            dist = abs(hx - river_x)
            if dist < 0.6:
                terrain_map[(r, c)] = 'water'
            elif dist < 1.8 and o2.noise2(hx * 0.5, hy * 0.5) < 0.1:
                terrain_map[(r, c)] = 'forest'
            else:
                terrain_map[(r, c)] = 'grass'
    return terrain_map


def pattern_lake(cols, rows):
    o = OpenSimplex(seed=2001)
    terrain_map = {}
    cx_hex = cols / 2.0
    cy_hex = rows * 0.866 / 2.0
    for r in range(rows):
        for c in range(cols):
            hx = c + (0.5 if r % 2 else 0)
            hy = r * 0.866
            dist = math.sqrt((hx - cx_hex)**2 + (hy - cy_hex)**2)
            angle = math.atan2(hy - cy_hex, hx - cx_hex)
            lake_r = 2.2 + o.noise2(angle * 2, 0.5) * 0.8
            if dist < lake_r:
                terrain_map[(r, c)] = 'water'
            elif dist < lake_r + 1.5:
                terrain_map[(r, c)] = 'grass'
            else:
                terrain_map[(r, c)] = 'forest' if o.noise2(hx * 0.35, hy * 0.35) < -0.2 else 'grass'
    return terrain_map


def pattern_peninsula(cols, rows):
    o1 = OpenSimplex(seed=1001)
    o2 = OpenSimplex(seed=1002)
    terrain_map = {}
    for r in range(rows):
        for c in range(cols):
            hx = c + (0.5 if r % 2 else 0)
            hy = r * 0.866
            dist_y = abs(hy - rows * 0.866 / 2)
            land_ext = 7.5 - dist_y * 1.2 + o1.noise2(hy * 0.4, 0.5) * 1.5
            if hx < land_ext:
                terrain_map[(r, c)] = 'forest' if o2.noise2(hx * 0.4, hy * 0.4) < -0.35 else 'grass'
            else:
                terrain_map[(r, c)] = 'water'
    return terrain_map


def pattern_archipelago(cols, rows):
    o1 = OpenSimplex(seed=5001)
    o2 = OpenSimplex(seed=5002)
    terrain_map = {}
    for r in range(rows):
        for c in range(cols):
            hx = c + (0.5 if r % 2 else 0)
            hy = r * 0.866
            val = o1.noise2(hx * 0.45, hy * 0.45) + o2.noise2(hx * 0.9, hy * 0.9) * 0.3
            if val > 0.15:
                terrain_map[(r, c)] = 'forest' if val > 0.4 else 'grass'
            else:
                terrain_map[(r, c)] = 'water'
    return terrain_map


def pattern_forest_clearing(cols, rows):
    o = OpenSimplex(seed=3001)
    terrain_map = {}
    cx_hex = cols / 2.0
    cy_hex = rows * 0.866 / 2.0
    for r in range(rows):
        for c in range(cols):
            hx = c + (0.5 if r % 2 else 0)
            hy = r * 0.866
            dist = math.sqrt((hx - cx_hex)**2 + (hy - cy_hex)**2)
            angle = math.atan2(hy - cy_hex, hx - cx_hex)
            clearing_r = 1.8 + o.noise2(angle * 1.5, 1.0) * 0.6
            terrain_map[(r, c)] = 'grass' if dist < clearing_r else 'forest'
    return terrain_map


def pattern_wide_front(cols, rows):
    o1 = OpenSimplex(seed=4001)
    o2 = OpenSimplex(seed=4002)
    terrain_map = {}
    for r in range(rows):
        for c in range(cols):
            hx = c + (0.5 if r % 2 else 0)
            hy = r * 0.866
            val = o1.noise2(hx * 0.35, hy * 0.35) + o2.noise2(hx * 0.7, hy * 0.7) * 0.4
            terrain_map[(r, c)] = 'forest' if val < -0.35 else 'grass'
    return terrain_map


def pattern_steppe(cols, rows):
    o = OpenSimplex(seed=777)
    terrain_map = {}
    for r in range(rows):
        for c in range(cols):
            hx = c + (0.5 if r % 2 else 0)
            hy = r * 0.866
            val = o.noise2(hx * 0.3, hy * 0.3)
            terrain_map[(r, c)] = 'forest' if val < -0.4 else 'grass'
    return terrain_map


PATTERNS = {
    'coastal': pattern_coastal,
    'river': pattern_river,
    'lake': pattern_lake,
    'peninsula': pattern_peninsula,
    'archipelago': pattern_archipelago,
    'forest_clearing': pattern_forest_clearing,
    'wide_front': pattern_wide_front,
    'steppe': pattern_steppe,
}


def main():
    parser = argparse.ArgumentParser(description='Generate hex terrain maps')
    parser.add_argument('--pattern', default='all', choices=list(PATTERNS.keys()) + ['all'])
    parser.add_argument('--cols', type=int, default=10)
    parser.add_argument('--rows', type=int, default=7)
    args = parser.parse_args()

    out_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'output', 'maps')
    os.makedirs(out_dir, exist_ok=True)

    patterns_to_run = PATTERNS if args.pattern == 'all' else {args.pattern: PATTERNS[args.pattern]}

    print("=== Hex Map Generation v1.0 ===")
    print(f"    Grid: {args.cols}x{args.rows}")
    total_t0 = time.time()

    # Generate terrain fields
    field_w = int(args.cols * COL_SP + ROW_OFF + TILE_W) + 50
    field_h = int(args.rows * ROW_SP + TILE_H) + 50
    print(f"    Field: {field_w}x{field_h}")
    print("  Generating terrain fields...")

    fields = {}
    for terrain in ['grass', 'forest', 'water']:
        t0 = time.time()
        seed = hash(terrain + 'v1') % 10000 + 100
        scale = 0.010 if terrain == 'water' else 0.012
        fields[terrain] = generate_field(field_w, field_h, seed, PALETTES[terrain], scale)
        print(f"    {terrain}: {time.time()-t0:.0f}s")

    # Render maps
    for name, pattern_fn in patterns_to_run.items():
        print(f"\n  Rendering: {name}...", flush=True)
        t0 = time.time()
        terrain_map = pattern_fn(args.cols, args.rows)
        out_path = os.path.join(out_dir, f'{name}.png')
        render_map(terrain_map, fields, args.cols, args.rows, out_path)
        print(f"    {time.time()-t0:.0f}s → {out_path}")

    print(f"\n  === ALL DONE in {time.time()-total_t0:.0f}s ===")


if __name__ == '__main__':
    main()
