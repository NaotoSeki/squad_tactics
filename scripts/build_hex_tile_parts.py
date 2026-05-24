"""Build hex terrain PNGs + organic road tiles (one PNG per 6-bit neighbor mask)."""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

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


def draw_cap(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    angle: float,
    half_w: float,
    *,
    outward: bool,
) -> None:
    sign = 1.0 if outward else -1.0
    nx = math.cos(angle) * sign
    ny = math.sin(angle) * sign
    cap_w = half_w * 1.22
    cap_h = half_w * 0.95
    px = -math.sin(angle) * cap_w
    py = math.cos(angle) * cap_w
    ox = cx + nx * cap_h * 0.35
    oy = cy + ny * cap_h * 0.35
    draw.ellipse((ox - abs(px), oy - abs(py), ox + abs(px), oy + abs(py)), fill=HUB_FILL)


def draw_road_arm(
    draw: ImageDraw.ImageDraw,
    dir_index: int,
    start_r: float,
    *,
    is_end: bool,
    inner_cap: bool = False,
) -> None:
    a = neighbor_angle_rad(dir_index)
    half_w = ARM_HALF_W * (1.0 + random.uniform(-0.04, 0.04))
    sx = CX + math.cos(a) * start_r
    sy = CY + math.sin(a) * start_r
    ex = CX + math.cos(a) * ARM_LENGTH
    ey = CY + math.sin(a) * ARM_LENGTH
    px = -math.sin(a) * half_w
    py = math.cos(a) * half_w
    quad = [
        (sx + px, sy + py),
        (sx - px, sy - py),
        (ex - px, ey - py),
        (ex + px, ey + py),
    ]
    draw.polygon(quad, fill=ROAD_FILL)
    if is_end:
        draw_cap(draw, ex, ey, a, half_w, outward=True)
    if inner_cap:
        draw_cap(draw, CX, CY, a, half_w, outward=False)


def draw_road_organic(mask: int) -> Image.Image:
    rgba = dirt_base()
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    n = popcount(mask)
    hr = hub_radius(n)

    start_r = R * 0.06 if n >= 2 else R * 0.12
    for i in range(6):
        if mask & (1 << i):
            draw_road_arm(
                draw,
                i,
                start_r,
                is_end=(n == 1),
                inner_cap=(n == 1),
            )

    blur_r = 0.55 if n >= 3 else 0.42
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=blur_r))
    rgba = Image.alpha_composite(rgba, overlay)
    rgba = add_grain(rgba, 6.0)

    hex_m = make_hex_mask()
    rgba.putalpha(hex_m)
    edge = hex_m.filter(ImageFilter.GaussianBlur(radius=0.7))
    r, g, b, a = rgba.split()
    return Image.merge("RGBA", (r, g, b, edge))


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
    for name, (jpg, style) in TILES.items():
        build_tile(name, jpg, style)
    for mask in range(64):
        save_road_mask(mask)
        if popcount(mask) > 0:
            print(f"  road m{mask:02x} ({popcount(mask)} arms)")

    readme = OUT / "README.md"
    readme.write_text(
        f"""# Hex terrain tile parts

## Base terrain (`hex_*.png`)
dirt / grass / forest / town / water

## Roads (`roads/m00.png` … `roads/m3f.png`)
**64 organic variants** from 6-bit neighbor mask (dir order = `logic_map.getNeighbors`).

Regenerate:
```powershell
python scripts/build_hex_tile_parts.py
```

In-game: `hex_road_m` + mask as 2-digit hex, **no rotation**.
Size: {W}×{H}px, scale `1/HIGH_RES_SCALE`.
""",
        encoding="utf-8",
    )
    print(f"Wrote {readme}")


if __name__ == "__main__":
    main()
