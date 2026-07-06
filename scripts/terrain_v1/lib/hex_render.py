"""
Hex grid rendering utilities.
Handles hex geometry, mask creation, tile sampling, and grid composition.
"""

import numpy as np
import math
from PIL import Image, ImageDraw, ImageFilter

TILE_W, TILE_H = 202, 233
HEX_R = 108
CX, CY = TILE_W / 2, TILE_H / 2
COL_SP = math.sqrt(3) * HEX_R  # ~187 px
ROW_SP = HEX_R * 1.5           # 162 px
ROW_OFF = COL_SP / 2           # ~93.5 px


def get_neighbor(row, col, direction):
    """Get neighbor hex coordinates in offset grid (odd-row shifts right).
    Directions: 0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE"""
    odd = row % 2
    offsets = [(0, 1), (-1, odd), (-1, -1 + odd), (0, -1), (1, -1 + odd), (1, odd)]
    dr, dc = offsets[direction]
    return (row + dr, col + dc)


def hex_center_pixel(row, col):
    """Get pixel position of hex center in the rendering field."""
    x = col * COL_SP + (ROW_OFF if row % 2 else 0)
    y = row * ROW_SP
    return x, y


def hex_mask():
    """Create hex-shaped alpha mask with 1px Gaussian feather."""
    mask = Image.new('L', (TILE_W, TILE_H), 0)
    draw = ImageDraw.Draw(mask)
    verts = [(CX + HEX_R * math.cos(math.radians(90 + 60 * i)),
              CY + HEX_R * math.sin(math.radians(90 + 60 * i))) for i in range(6)]
    draw.polygon(verts, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(radius=1))


def sample_hex_tile(field, center_x, center_y):
    """Sample a tile-sized region from a large field (wrapping at edges)."""
    field_h, field_w = field.shape[:2]
    tile = np.zeros((TILE_H, TILE_W, 3))
    x0 = int(center_x - CX)
    y0 = int(center_y - CY)
    for y in range(TILE_H):
        for x in range(TILE_W):
            sx = (x0 + x) % field_w
            sy = (y0 + y) % field_h
            tile[y, x] = field[sy, sx]
    return tile


def canvas_size(cols, rows):
    """Calculate canvas dimensions for a hex grid."""
    w = int(cols * COL_SP + ROW_OFF + TILE_W // 2 + 20)
    h = int(rows * ROW_SP + TILE_H // 2 + 40)
    return w, h


def tile_position(row, col, margin_x, margin_y):
    """Get canvas paste position for a hex tile."""
    hx_px, hy_px = hex_center_pixel(row, col)
    cx = int(hx_px + margin_x - CX + 5)
    cy = int(hy_px + margin_y - CY + 10)
    return cx, cy
