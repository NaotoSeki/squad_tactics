"""Build hex terrain PNGs + organic road tiles (one PNG per 6-bit neighbor mask)."""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / "asset" / "environment"
OUT = ENV / "hex_tiles"
ROADS_OUT = OUT / "roads"

HEX_SIZE = 54
HIGH_RES_SCALE = 2.0
BLEED = 1.08

R = HEX_SIZE * HIGH_RES_SCALE
W = int(math.sqrt(3) * R * BLEED)
H = int(R * 2 * BLEED)
CX = W / 2.0
CY = H / 2.0

TILES = {
    "hex_dirt": ("terrain_dirt.jpg", None),
    "hex_grass": ("terrain_grass.jpg", None),
    "hex_forest": ("terrain_forest.jpg", None),
    "hex_town": ("terrain_town.jpg", "town"),
    "hex_water": (None, "water"),
}

FALLBACK_RGB = {
    "hex_dirt": (98, 92, 82),
    "hex_grass": (88, 95, 72),
    "hex_forest": (62, 72, 54),
    "hex_town": (84, 78, 70),
    "hex_water": (48, 58, 68),
}

ROAD_DIR_DELTAS = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]
ARM_LENGTH = R * math.sqrt(3) / 2 * 1.16
ARM_HALF_W = R * 0.19

ROAD_FILL = (56, 52, 48, 248)
HUB_FILL = (50, 46, 42, 252)


def hex_polygon(cx: float, cy: float, radius: float) -> list[tuple[float, float]]:
    pts = []
    for i in range(6):
        a = math.radians(90 + 60 * i)
        pts.append((cx + radius * math.cos(a), cy + radius * math.sin(a)))
    return pts


def make_hex_mask() -> Image.Image:
    mask = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(hex_polygon(CX, CY, R), fill=255)
    return mask


def add_grain(img: Image.Image, amount: float = 8.0) -> Image.Image:
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            n = random.uniform(-amount, amount)
            px[x, y] = (
                max(0, min(255, int(r + n))),
                max(0, min(255, int(g + n))),
                max(0, min(255, int(b + n))),
                a,
            )
    return img


def sample_fill_from_jpg(jpg: Path, style: str | None) -> Image.Image:
    src = Image.open(jpg).convert("RGB")
    sw, sh = src.size
    crop_scale = random.uniform(0.35, 0.55)
    cw = max(W, int(sw * crop_scale))
    ch = max(H, int(sh * crop_scale))
    ox = random.randint(0, max(0, sw - cw)) if sw > cw else 0
    oy = random.randint(0, max(0, sh - ch)) if sh > ch else 0
    crop = src.crop((ox, oy, min(sw, ox + cw), min(sh, oy + ch)))
    fill = crop.resize((W, H), Image.Resampling.LANCZOS)
    fill = ImageEnhance.Color(fill).enhance(0.85)
    fill = ImageEnhance.Contrast(fill).enhance(1.05)
    rgba = fill.convert("RGBA")
    if style == "town":
        rgba = ImageEnhance.Brightness(rgba).enhance(0.88)
        draw = ImageDraw.Draw(rgba)
        for _ in range(18):
            rx = random.uniform(CX - R * 0.7, CX + R * 0.7)
            ry = random.uniform(CY - R * 0.7, CY + R * 0.7)
            sz = random.uniform(2, 6)
            draw.ellipse(
                (rx - sz, ry - sz, rx + sz, ry + sz),
                fill=(70, 65, 58, random.randint(40, 90)),
            )
    return rgba


def procedural_water() -> Image.Image:
    base = Image.new("RGBA", (W, H), FALLBACK_RGB["hex_water"] + (255,))
    px = base.load()
    for y in range(H):
        for x in range(W):
            wave = math.sin(x * 0.08) * 4 + math.cos(y * 0.06) * 4
            r, g, b, a = px[x, y]
            px[x, y] = (
                max(0, min(255, int(r + wave))),
                max(0, min(255, int(g + wave * 0.8))),
                max(0, min(255, int(b + wave * 1.2))),
                a,
            )
    return base.filter(ImageFilter.GaussianBlur(radius=0.6))


def solid_fill(rgb: tuple[int, int, int]) -> Image.Image:
    return Image.new("RGBA", (W, H), rgb + (255,))


def dirt_base() -> Image.Image:
    jpg = ENV / "terrain_dirt.jpg"
    if jpg.is_file():
        return sample_fill_from_jpg(jpg, None)
    return solid_fill(FALLBACK_RGB["hex_dirt"])


def neighbor_angle_rad(dir_index: int) -> float:
    dq, dr = ROAD_DIR_DELTAS[dir_index]
    dx = math.sqrt(3) * (dq + dr / 2.0)
    dy = (3.0 / 2.0) * dr
    return math.atan2(dy, dx)


def popcount(m: int) -> int:
    return bin(m).count("1")


def hub_radius(arm_count: int) -> float:
    if arm_count >= 5:
        return R * 0.26
    if arm_count >= 4:
        return R * 0.24
    if arm_count >= 3:
        return R * 0.21
    if arm_count == 2:
        return R * 0.10
    return R * 0.06


def is_straight_pair(mask: int) -> bool:
    if popcount(mask) != 2:
        return False
    bits = [i for i in range(6) if mask & (1 << i)]
    return (bits[1] - bits[0]) % 6 == 3


def generate_trench_path(dir_index: int, start_r: float, rng: random.Random) -> list[tuple[float, float]]:
    a = neighbor_angle_rad(dir_index)
    cos_a = math.cos(a)
    sin_a = math.sin(a)
    nx = -sin_a
    ny = cos_a
    
    total_len = ARM_LENGTH - start_r
    d1 = start_r
    d2 = start_r + total_len * 0.35
    d3 = start_r + total_len * 0.70
    d4 = ARM_LENGTH
    
    # Zigzag offset
    side = rng.choice([-1, 1])
    off1 = side * rng.uniform(4.5, 7.5)
    off2 = -side * rng.uniform(4.5, 7.5)
    
    p1 = (CX + cos_a * d1, CY + sin_a * d1)
    p2 = (CX + cos_a * d2 + nx * off1, CY + sin_a * d2 + ny * off1)
    p3 = (CX + cos_a * d3 + nx * off2, CY + sin_a * d3 + ny * off2)
    p4 = (CX + cos_a * d4, CY + sin_a * d4)
    
    return [p1, p2, p3, p4]

def interpolate_path(vertices: list[tuple[float, float]], step_dist: float) -> list[tuple[float, float, float, float]]:
    pts = []
    for i in range(len(vertices) - 1):
        x1, y1 = vertices[i]
        x2, y2 = vertices[i+1]
        dx = x2 - x1
        dy = y2 - y1
        length = math.hypot(dx, dy)
        if length == 0:
            continue
        tx = dx / length
        ty = dy / length
        
        curr_d = 0.0
        while curr_d < length:
            pts.append((x1 + tx * curr_d, y1 + ty * curr_d, tx, ty))
            curr_d += step_dist
    if vertices:
        x1, y1 = vertices[-2]
        x2, y2 = vertices[-1]
        dx = x2 - x1
        dy = y2 - y1
        length = math.hypot(dx, dy)
        tx = dx / length if length > 0 else 1.0
        ty = dy / length if length > 0 else 0.0
        pts.append((x2, y2, tx, ty))
    return pts


def draw_crooked_line(draw: ImageDraw.ImageDraw, x1: float, y1: float, x2: float, y2: float, fill: tuple[int, int, int, int], width: int, rng: random.Random) -> None:
    dx = x2 - x1
    dy = y2 - y1
    length = math.hypot(dx, dy)
    if length < 6:
        draw.line([(x1, y1), (x2, y2)], fill=fill, width=width)
        return
    
    num_segs = max(2, int(length / 7.0))
    pts = [(x1, y1)]
    nx = -dy / length
    ny = dx / length
    
    for i in range(1, num_segs):
        t = i / num_segs
        px = x1 + dx * t
        py = y1 + dy * t
        jitter = rng.uniform(-0.7, 0.7)
        pts.append((px + nx * jitter, py + ny * jitter))
    pts.append((x2, y2))
    draw.line(pts, fill=fill, width=width)

def draw_trench_mud_arm(draw: ImageDraw.ImageDraw, dir_index: int, start_r: float, rng: random.Random) -> None:
    vertices = generate_trench_path(dir_index, start_r, rng)
    dense_pts = interpolate_path(vertices, 2.0)
    
    # Outer mud base: wider ditch with irregular radius
    w_mud = ARM_HALF_W * 1.30
    for x, y, tx, ty in dense_pts:
        r_jitter = w_mud + rng.uniform(-1.5, 1.5)
        draw.ellipse((x - r_jitter, y - r_jitter, x + r_jitter, y + r_jitter), fill=(85, 68, 52, 255))
        
    # Draw mud ditch shadow & highlight (for 3D depth)
    L = (-0.707, -0.707)  # Light direction coming from top-left
    w_mud_inner = ARM_HALF_W * 0.95
    for x, y, tx, ty in dense_pts:
        nx, ny = -ty, tx
        dot = nx * L[0] + ny * L[1]
        
        # Casting side (top-left)
        side = 1 if dot < 0 else -1
        
        # Draw shadow side (darker mud, shifted to top-left)
        sh_r = w_mud_inner * 0.9
        sh_x = x + nx * (w_mud_inner * 0.15) * side
        sh_y = y + ny * (w_mud_inner * 0.15) * side
        draw.ellipse((sh_x - sh_r, sh_y - sh_r, sh_x + sh_r, sh_y + sh_r), fill=(45, 32, 22, 255))
        
        # Draw highlight side (brighter mud, shifted to bottom-right)
        hl_r = w_mud_inner * 0.72
        hl_x = x + nx * (w_mud_inner * 0.15) * (-side)
        hl_y = y + ny * (w_mud_inner * 0.15) * (-side)
        draw.ellipse((hl_x - hl_r, hl_y - hl_r, hl_x + hl_r, hl_y + hl_r), fill=(95, 78, 62, 255))
        
        # Draw wet mud center
        ct_r = w_mud_inner * 0.5
        draw.ellipse((x - ct_r, y - ct_r, x + ct_r, y + ct_r), fill=(60, 46, 32, 255))

def draw_trench_struct_arm(draw: ImageDraw.ImageDraw, dir_index: int, start_r: float, is_end: bool, rng: random.Random) -> None:
    vertices = generate_trench_path(dir_index, start_r, rng)
    dense_pts = interpolate_path(vertices, 1.0) # Dense path for line segments
    if not dense_pts:
        return
        
    w_runner = ARM_HALF_W * 0.22
    w_wall = ARM_HALF_W * 0.85
    
    # 1. Draw runners (longitudinal boards - crooked by segment)
    for i in range(len(dense_pts) - 1):
        x1, y1, tx1, ty1 = dense_pts[i]
        x2, y2, tx2, ty2 = dense_pts[i+1]
        nx1, ny1 = -ty1, tx1
        nx2, ny2 = -ty2, tx2
        for side in [-1, 1]:
            rx1 = x1 + nx1 * w_runner * side
            ry1 = y1 + ny1 * w_runner * side
            rx2 = x2 + nx2 * w_runner * side
            ry2 = y2 + ny2 * w_runner * side
            draw.line([(rx1, ry1), (rx2, ry2)], fill=(75, 54, 36, 255), width=2)
            
    # 2. Draw walls (wooden retaining planks) and their local 3D shadows/highlights
    for i in range(len(dense_pts) - 1):
        x1, y1, tx1, ty1 = dense_pts[i]
        x2, y2, tx2, ty2 = dense_pts[i+1]
        nx1, ny1 = -ty1, tx1
        nx2, ny2 = -ty2, tx2
        for side in [-1, 1]:
            wx1 = x1 + nx1 * w_wall * side
            wy1 = y1 + ny1 * w_wall * side
            wx2 = x2 + nx2 * w_wall * side
            wy2 = y2 + ny2 * w_wall * side
            
            # Base dark wall wood outline
            draw.line([(wx1, wy1), (wx2, wy2)], fill=(45, 30, 20, 255), width=5)
            # Wall wood fill
            draw.line([(wx1, wy1), (wx2, wy2)], fill=(145, 115, 88, 255), width=3)
            
            # Local ambient occlusion shadow on the mud floor (cast inwards, towards the center)
            sh_nx1 = -nx1 * side
            sh_ny1 = -ny1 * side
            sh_nx2 = -nx2 * side
            sh_ny2 = -ny2 * side
            
            fsx1 = wx1 + sh_nx1 * 3.0
            fsy1 = wy1 + sh_ny1 * 3.0
            fsx2 = wx2 + sh_nx2 * 3.0
            fsy2 = wy2 + sh_ny2 * 3.0
            draw.line([(fsx1, fsy1), (fsx2, fsy2)], fill=(0, 0, 0, 75), width=7)
            draw.line([(fsx1, fsy1), (fsx2, fsy2)], fill=(0, 0, 0, 120), width=3)
            
            # Local highlight on the outer top edge of the wall
            thx1 = wx1 - sh_nx1 * 1.5
            thy1 = wy1 - sh_ny1 * 1.5
            thx2 = wx2 - sh_nx2 * 1.5
            thy2 = wy2 - sh_ny2 * 1.5
            draw.line([(thx1, thy1), (thx2, thy2)], fill=(210, 185, 160, 255), width=1)
            
    # 3. Draw support posts, slats, and sandbags along the curve
    dist_accum_post = 6.0
    dist_accum_slat = 4.0
    dist_accum_bag = 8.0
    
    post_step = 22.0
    slat_step_base = 9.0
    bag_step = 15.0
    bag_len_base = 12.0
    slat_w_base = ARM_HALF_W * 0.38
    w_sandbag_base = ARM_HALF_W * 1.25
    
    curr_dist = 0.0
    for i in range(len(dense_pts)):
        x, y, tx, ty = dense_pts[i]
        nx, ny = -ty, tx
        
        if i > 0:
            px, py, _, _ = dense_pts[i-1]
            seg_len = math.hypot(x - px, y - py)
            curr_dist += seg_len
            dist_accum_post += seg_len
            dist_accum_slat += seg_len
            dist_accum_bag += seg_len
            
        # Support posts
        if dist_accum_post >= post_step:
            dist_accum_post = rng.uniform(-2, 2)
            for side in [-1, 1]:
                px_p = x + nx * (w_wall + rng.uniform(-0.8, 0.8)) * side + rng.uniform(-1.0, 1.0)
                py_p = y + ny * (w_wall + rng.uniform(-0.8, 0.8)) * side + rng.uniform(-1.0, 1.0)
                draw.ellipse((px_p - 3, py_p - 3, px_p + 3, py_p + 3), fill=(55, 36, 22, 255))
                draw.ellipse((px_p - 1.5, py_p - 1.5, px_p + 1.5, py_p + 1.5), fill=(155, 120, 105, 255))
                
        # Slat (duckboard floor wood)
        if dist_accum_slat >= slat_step_base:
            dist_accum_slat = rng.uniform(-1.5, 1.5)
            if rng.random() > 0.08:
                sx = x + nx * rng.uniform(-1.2, 1.2)
                sy = y + ny * rng.uniform(-1.2, 1.2)
                
                is_broken = rng.random() < 0.08
                angle_jitter = rng.uniform(-0.45, 0.45) if is_broken else rng.uniform(-0.16, 0.16)
                
                sa_slat = math.atan2(ty, tx) + angle_jitter + math.pi / 2
                snx = math.cos(sa_slat)
                sny = math.sin(sa_slat)
                
                slat_w = slat_w_base * rng.uniform(0.82, 1.12)
                x1, y1 = sx - snx * slat_w, sy - sny * slat_w
                x2, y2 = sx + snx * slat_w, sy + sny * slat_w
                
                draw.line([(x1, y1), (x2, y2)], fill=(75, 54, 36, 255), width=4)
                draw.line([(x1, y1), (x2, y2)], fill=(175, 142, 115, 255), width=2)
                draw.line([(x1 + snx*0.5, y1 + sny*0.5), (x2 - snx*0.5, y2 - sny*0.5)], fill=(210, 178, 155, 255), width=1)
                
        # Sandbags with local 3D shading
        if dist_accum_bag >= bag_step:
            dist_accum_bag = rng.uniform(-1.5, 1.5)
            for side in [-1, 1]:
                w_sandbag = w_sandbag_base * rng.uniform(1.20, 1.32)
                sx = x + nx * w_sandbag * side + rng.uniform(-1.0, 1.0)
                sy = y + ny * w_sandbag * side + rng.uniform(-1.0, 1.0)
                
                bag_angle = math.atan2(ty, tx) + rng.uniform(-0.16, 0.16)
                bcos = math.cos(bag_angle)
                bsin = math.sin(bag_angle)
                
                bag_len = bag_len_base * rng.uniform(0.85, 1.15)
                bx1 = sx - bcos * (bag_len / 2)
                by1 = sy - bsin * (bag_len / 2)
                bx2 = sx + bcos * (bag_len / 2)
                by2 = sy + bsin * (bag_len / 2)
                
                # Normal vector pointing from sandbag center to trench floor (inwards)
                sh_nx = -nx * side
                sh_ny = -ny * side
                
                bag_width = int(rng.uniform(8.0, 10.0))
                
                # 1. Sandbag drop-shadow underneath (shifted inwards, wider)
                sbx1 = bx1 + sh_nx * 2.0
                sby1 = by1 + sh_ny * 2.0
                sbx2 = bx2 + sh_nx * 2.0
                sby2 = by2 + sh_ny * 2.0
                draw.line([(sbx1, sby1), (sbx2, sby2)], fill=(0, 0, 0, 130), width=bag_width + 2)
                
                # 2. Sandbag dark base outline
                draw.line([(bx1, by1), (bx2, by2)], fill=(50, 36, 24, 255), width=bag_width)
                
                # 3. Sandbag main body fill color
                bag_color = rng.choice([
                    (238, 230, 215, 255),
                    (225, 215, 200, 255),
                    (232, 224, 210, 255)
                ])
                draw.line([(bx1, by1), (bx2, by2)], fill=bag_color, width=bag_width - 4)
                
                # 4. Shadow on the inner side of the bag (towards center of trench)
                draw.line(
                    [(bx1 + sh_nx * 1.0, by1 + sh_ny * 1.0), (bx2 + sh_nx * 1.0, by2 + sh_ny * 1.0)],
                    fill=(40, 28, 18, 120),
                    width=bag_width - 6
                )
                
                # 5. Highlight on the outer side of the bag (facing outwards)
                draw.line(
                    [(bx1 - sh_nx * 1.0, by1 - sh_ny * 1.0), (bx2 - sh_nx * 1.0, by2 - sh_ny * 1.0)],
                    fill=(255, 255, 245, 140),
                    width=2
                )
                
    # 4. End-cap blockage (if n == 1)
    if is_end:
        x_start, y_start, tx_s, ty_s = dense_pts[0]
        nx_s, ny_s = -ty_s, tx_s
        wx1 = x_start - nx_s * w_wall
        wy1 = y_start - ny_s * w_wall
        wx2 = x_start + nx_s * w_wall
        wy2 = y_start + ny_s * w_wall
        
        draw.line([(wx1, wy1), (wx2, wy2)], fill=(65, 46, 32, 255), width=5)
        draw.line([(wx1, wy1), (wx2, wy2)], fill=(145, 115, 88, 255), width=3)
        
        sx = x_start - tx_s * 4.0
        sy = y_start - ty_s * 4.0
        bx1 = sx - nx_s * 10.0
        by1 = sy - ny_s * 10.0
        bx2 = sx + nx_s * 10.0
        by2 = sy + ny_s * 10.0
        draw.line([(bx1, by1), (bx2, by2)], fill=(75, 54, 36, 255), width=9)
        draw.line([(bx1, by1), (bx2, by2)], fill=(238, 230, 215, 255), width=5)

def draw_trench_mud_hub(draw: ImageDraw.ImageDraw, n: int, rng: random.Random) -> None:
    # Muddy base circle (slightly wider, with jagged radius)
    hub_r = ARM_HALF_W * 1.25
    draw.ellipse((CX - hub_r, CY - hub_r, CX + hub_r, CY + hub_r), fill=(85, 68, 52, 255))
    
    # Inner wet mud center
    hub_ri = ARM_HALF_W * 0.95
    # Bevel/shadow effect for 3D pit look
    # Base dark pit
    draw.ellipse((CX - hub_ri, CY - hub_ri, CX + hub_ri, CY + hub_ri), fill=(45, 32, 22, 255))
    # Top-left shadow overlay (shifted to top-left)
    draw.ellipse((CX - hub_ri - 1, CY - hub_ri - 1, CX + hub_ri - 2, CY + hub_ri - 2), fill=(30, 20, 12, 255))
    # Bottom-right highlight overlay (shifted to bottom-right)
    draw.ellipse((CX - hub_ri + 2, CY - hub_ri + 2, CX + hub_ri, CY + hub_ri), fill=(70, 54, 38, 255))
    # Core wet mud center
    draw.ellipse((CX - hub_ri * 0.7, CY - hub_ri * 0.7, CX + hub_ri * 0.7, CY + hub_ri * 0.7), fill=(60, 46, 32, 255))

def draw_trench_struct_hub(draw: ImageDraw.ImageDraw, n: int, rng: random.Random) -> None:
    # Wooden deck in center if multiple arms meet (slightly misaligned deck planks)
    if n >= 2:
        deck_r = ARM_HALF_W * 0.65
        slat_w = deck_r * 2.0
        y_positions = [-9.0, -4.5, 0.0, 4.5, 9.0]
        for dy in y_positions:
            # Add rotation and shift to deck planks
            dx = rng.uniform(-1.0, 1.0)
            x1, y1 = CX - deck_r + dx, CY + dy + rng.uniform(-0.5, 0.5)
            x2, y2 = CX + deck_r + dx, CY + dy + rng.uniform(-0.5, 0.5)
            
            draw.line([(x1, y1), (x2, y2)], fill=(75, 54, 36, 255), width=5)
            draw.line([(x1, y1), (x2, y2)], fill=(175, 142, 115, 255), width=3)
            draw.line([(x1 + 0.5, y1), (x2 - 0.5, y2)], fill=(210, 178, 155, 255), width=1)
            
        # Draw framing log circle around the deck
        draw.ellipse((CX - deck_r, CY - deck_r, CX + deck_r, CY + deck_r), outline=(75, 54, 36, 255), width=2)
        
        # 3D Crescent shadow inside deck framing (top-left)
        draw.ellipse((CX - deck_r + 1, CY - deck_r + 1, CX + deck_r - 2, CY + deck_r - 2), outline=(0, 0, 0, 110), width=2)
        # 3D Crescent highlight inside deck framing (bottom-right)
        draw.ellipse((CX - deck_r + 2, CY - deck_r + 2, CX + deck_r - 1, CY + deck_r - 1), outline=(255, 255, 220, 85), width=1)

def draw_road_organic(mask: int) -> Image.Image:
    rgba = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    n = popcount(mask)
    
    # Seed RNG stably based on mask to ensure exact reproducibility per mask
    rng = random.Random(mask + 101)
    
    # 1. Generate blurred mud base ditch overlay
    mud_overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    mud_draw = ImageDraw.Draw(mud_overlay)
    
    start_r = R * 0.06 if n >= 2 else R * 0.12
    
    # Draw muddy hub first
    if n > 0:
        draw_trench_mud_hub(mud_draw, n, rng)
        
    # Draw muddy arms
    for i in range(6):
        if mask & (1 << i):
            draw_trench_mud_arm(mud_draw, i, start_r, rng)
            
    # Apply soft blur to the mud base so it transitions smoothly into background (increased radius to 4.5)
    mud_overlay = mud_overlay.filter(ImageFilter.GaussianBlur(radius=4.5))
    rgba = Image.alpha_composite(rgba, mud_overlay)
    
    # 2. Generate sharp wooden structure and sandbag overlay (NO BLUR)
    struct_overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    struct_draw = ImageDraw.Draw(struct_overlay)
    
    if n > 0:
        # Draw arms structures
        for i in range(6):
            if mask & (1 << i):
                draw_trench_struct_arm(struct_draw, i, start_r, is_end=(n == 1), rng=rng)
        # Draw hub structures on top of arm bases
        draw_trench_struct_hub(struct_draw, n, rng)
        
    rgba = Image.alpha_composite(rgba, struct_overlay)
    rgba = add_grain(rgba, 4.0)

    # 3. Apply hex boundary mask and retain transparency
    r, g, b, a = rgba.split()
    hex_m = make_hex_mask()
    edge = hex_m.filter(ImageFilter.GaussianBlur(radius=0.7))
    final_alpha = ImageChops.darker(a, edge)
    return Image.merge("RGBA", (r, g, b, final_alpha))


def save_road_mask(mask: int) -> None:
    ROADS_OUT.mkdir(parents=True, exist_ok=True)
    img = draw_road_organic(mask)
    path = ROADS_OUT / f"m{mask:02x}.png"
    img.save(path, "PNG", optimize=True)


def build_tile(name: str, jpg_name: str | None, style: str | None) -> None:
    if jpg_name and (ENV / jpg_name).is_file():
        rgba = sample_fill_from_jpg(ENV / jpg_name, style)
    elif style == "water":
        rgba = procedural_water()
    else:
        rgba = solid_fill(FALLBACK_RGB.get(name, (90, 90, 90)))
    mask = make_hex_mask()
    rgba.putalpha(mask)
    rgba = add_grain(rgba, 10.0)
    edge = mask.filter(ImageFilter.GaussianBlur(radius=0.8))
    r, g, b, a = rgba.split()
    rgba = Image.merge("RGBA", (r, g, b, edge))
    OUT.mkdir(parents=True, exist_ok=True)
    rgba.save(OUT / f"{name}.png", "PNG", optimize=True)
    print(f"Wrote {OUT / name}.png")


def main() -> None:
    random.seed(42)
    
    # Clean output roads directory
    if ROADS_OUT.is_dir():
        import shutil
        print(f"Cleaning existing roads directory: {ROADS_OUT}")
        shutil.rmtree(ROADS_OUT)
        
    for name, (jpg, style) in TILES.items():
        build_tile(name, jpg, style)
        
    # Generate only the 14 base rotation masks
    BASE_MASKS = [0x00, 0x01, 0x03, 0x05, 0x07, 0x09, 0x0b, 0x0d, 0x0f, 0x15, 0x17, 0x1b, 0x1f, 0x3f]
    print("\nGenerating 14 base rotation trench tiles...")
    for mask in BASE_MASKS:
        save_road_mask(mask)
        print(f"  trench m{mask:02x} ({popcount(mask)} arms) - BASE TILE")
        
    readme = OUT / "README.md"
    readme.write_text(
        f"""# Hex terrain tile parts
 
## Base terrain (`hex_*.png`)
dirt / grass / forest / town / water
 
## Roads / Trenches (`roads/m00.png` … `roads/m3f.png`)
**14 rotation base variants** from 6-bit neighbor mask (dir order = `logic_map.getNeighbors`).
Other 50 patterns are rotated at runtime in Phaser client.
 
Regenerate:
```powershell
python scripts/build_hex_tile_parts.py
```
 
Size: {W}×{H}px, scale `1/HIGH_RES_SCALE`.
""",
        encoding="utf-8",
    )
    print(f"Wrote {readme}")
 
 
if __name__ == "__main__":
    main()
