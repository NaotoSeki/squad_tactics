"""
Single-pass boundary blending for terrain transitions.
Only the lower-priority terrain blends toward the higher-priority one,
preventing double-border artifacts.
"""

import numpy as np
import math
from opensimplex import OpenSimplex
from .hex_render import TILE_W, TILE_H, CX, CY, HEX_R, get_neighbor, sample_hex_tile

# Terrain priority: higher number = "stronger" terrain that doesn't blend away
TERRAIN_PRIORITY = {
    'water': 3,
    'forest': 2,
    'grass': 1,
    'dirt': 1,
}


def blend_hex_tile(my_tile, my_terrain, terrain_map, fields, r, c, field_cx, field_cy):
    """Apply single-pass directional blend to a hex tile.

    Only blends if neighbor terrain has HIGHER priority.
    All contributing directions are combined in one pass.

    Args:
        my_tile: np.ndarray (H,W,3) — the base tile to blend
        my_terrain: str — terrain type of this hex
        terrain_map: dict — (row,col) → terrain_type
        fields: dict — terrain_type → noise field array
        r, c: grid position
        field_cx, field_cy: sampling center in field coordinates

    Returns:
        Blended tile (H,W,3)
    """
    my_pri = TERRAIN_PRIORITY.get(my_terrain, 1)

    # Find neighbors with higher priority (they encroach on us)
    diff_neighbors = []
    for d in range(6):
        nr, nc = get_neighbor(r, c, d)
        nt = terrain_map.get((nr, nc))
        if nt and nt != my_terrain and nt in fields:
            if TERRAIN_PRIORITY.get(nt, 1) > my_pri:
                diff_neighbors.append((d, nt))

    if not diff_neighbors:
        return my_tile

    # Single-pass: accumulate all neighbor contributions
    o_edge = OpenSimplex(seed=hash((r, c)) % 10000 + 999)
    other_color = np.zeros((TILE_H, TILE_W, 3))
    other_weight = np.zeros((TILE_H, TILE_W))

    xs = (np.arange(TILE_W) - CX) / HEX_R
    ys = (np.arange(TILE_H) - CY) / HEX_R
    dx_arr, dy_arr = np.meshgrid(xs, ys)

    for d, nt in diff_neighbors:
        # Outward direction angle
        out_angle = math.radians(d * 60)
        # Projection: how far each pixel is in the outward direction
        proj = dx_arr * math.cos(out_angle) - dy_arr * math.sin(out_angle)

        # Organic noise on blend edge
        edge_n = np.zeros((TILE_H, TILE_W))
        for ey in range(0, TILE_H, 2):
            for ex in range(0, TILE_W, 2):
                n = o_edge.noise2(ex * 0.025 + d * 7, ey * 0.025 + d * 5) * 0.3
                edge_n[ey, ex] = n
                if ey + 1 < TILE_H:
                    edge_n[ey + 1, ex] = n
                if ex + 1 < TILE_W:
                    edge_n[ey, ex + 1] = n
                    if ey + 1 < TILE_H:
                        edge_n[ey + 1, ex + 1] = n

        # Smoothstep blend starting from outer portion of hex
        dir_blend = np.clip((proj + edge_n - 0.2) / 0.5, 0, 1)
        dir_blend = dir_blend * dir_blend * (3 - 2 * dir_blend)

        # Sample neighbor terrain and accumulate
        neighbor_tile = sample_hex_tile(fields[nt], field_cx, field_cy)
        other_color += neighbor_tile * dir_blend[:, :, np.newaxis]
        other_weight += dir_blend

    # Normalize accumulated contributions
    mask = other_weight > 0.01
    other_color[mask] /= other_weight[mask, np.newaxis]

    # Final blend
    final_blend = np.clip(other_weight, 0, 1)
    result = my_tile * (1 - final_blend[:, :, np.newaxis]) + other_color * final_blend[:, :, np.newaxis]
    return result
