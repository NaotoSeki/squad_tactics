"""
Generate all terrain tiles and transition tiles for v1.0.
Uses continuous noise fields — each variant is sampled from a unique position.
"""

import sys
import os
import time
import math
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from lib.noise_field import generate_field, PALETTES
from lib.hex_render import TILE_W, TILE_H, CX, CY, HEX_R, hex_mask, sample_hex_tile
from lib.blend import blend_hex_tile

# Hex neighbor offsets in pixels
HEX_OFFSETS = []
for d in range(6):
    angle = math.radians(d * 60)
    dx = int(math.sqrt(3) * HEX_R * math.cos(angle))
    dy = int(-math.sqrt(3) * HEX_R * math.sin(angle))
    HEX_OFFSETS.append((dx, dy))


def save_tile(arr, path):
    rgb = (np.clip(arr, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(rgb, 'RGB').save(path)


def main():
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                           'scripts', 'terrain_v1', 'output', 'tiles')
    os.makedirs(out_dir, exist_ok=True)

    print("=== Hex Terrain Tile Generation v1.0 ===")
    total_t0 = time.time()

    # Field size large enough for 6 variants spread out
    field_size = 800
    fc = field_size // 2

    terrains = ['grass', 'forest', 'water', 'dirt']

    # Generate one large field per terrain
    fields = {}
    for terrain in terrains:
        print(f"  Generating {terrain} field ({field_size}x{field_size})...", flush=True)
        t0 = time.time()
        seed = hash(terrain) % 10000 + 42
        scale = 0.010 if terrain == 'water' else 0.012
        fields[terrain] = generate_field(field_size, field_size, seed, PALETTES[terrain], scale)
        print(f"    {time.time() - t0:.0f}s")

    # === Terrain variants: 6 per type ===
    print("\n  Saving terrain variants...")
    for terrain in terrains:
        for v in range(6):
            dx, dy = HEX_OFFSETS[v]
            tile = sample_hex_tile(fields[terrain], fc + dx, fc + dy)
            save_tile(tile, os.path.join(out_dir, f'hex_{terrain}_{v}.png'))
            if v == 0:
                save_tile(tile, os.path.join(out_dir, f'hex_{terrain}.png'))
        print(f"    {terrain}: 6 variants")

    # === Transition tiles: per-direction, individually generated ===
    # Each trans tile is sampled from the continuous field with blend applied
    print("\n  Generating transition tiles...")
    from opensimplex import OpenSimplex

    transitions = [('grass', 'forest'), ('grass', 'water'), ('grass', 'dirt'), ('forest', 'water')]
    for ta, tb in transitions:
        for d in range(6):
            dx, dy = HEX_OFFSETS[d]
            # Sample position offset for this direction
            cx = fc + dx
            cy = fc + dy
            tile_a = sample_hex_tile(fields[ta], cx, cy)
            tile_b = sample_hex_tile(fields[tb], cx, cy)

            # Blend: A on center side, B on outer side
            out_angle = math.radians(d * 60)
            xs = (np.arange(TILE_W) - CX) / HEX_R
            ys = (np.arange(TILE_H) - CY) / HEX_R
            dx_arr, dy_arr = np.meshgrid(xs, ys)
            proj = dx_arr * math.cos(out_angle) - dy_arr * math.sin(out_angle)

            o_edge = OpenSimplex(seed=hash((ta, tb, d)) % 10000 + 500)
            edge_n = np.zeros((TILE_H, TILE_W))
            for ey in range(0, TILE_H, 2):
                for ex in range(0, TILE_W, 2):
                    n = o_edge.noise2(ex * 0.025 + d * 7, ey * 0.025 + d * 5) * 0.3
                    edge_n[ey, ex] = n
                    if ey + 1 < TILE_H: edge_n[ey + 1, ex] = n
                    if ex + 1 < TILE_W: edge_n[ey, ex + 1] = n
                    if ey + 1 < TILE_H and ex + 1 < TILE_W: edge_n[ey + 1, ex + 1] = n

            blend = np.clip((proj + edge_n - 0.1) / 0.5, 0, 1)
            blend = blend * blend * (3 - 2 * blend)
            tile = tile_a * (1 - blend[:, :, np.newaxis]) + tile_b * blend[:, :, np.newaxis]

            save_tile(tile, os.path.join(out_dir, f'hex_trans_{ta}_{tb}_d{d}.png'))
        print(f"    {ta} → {tb}: 6 directions")

    total = time.time() - total_t0
    print(f"\n  === DONE in {total:.0f}s ===")
    print(f"  Tiles: {len(terrains) * 6 + len(transitions) * 6}")
    print(f"  Output: {out_dir}")


if __name__ == '__main__':
    main()
