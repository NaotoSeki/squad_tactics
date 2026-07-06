"""CC0 terrain sources -> game-ready seamless JPGs (1024, desaturated wasteland look)."""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "asset" / "environment"
TMP = Path(__import__("os").environ.get("TEMP", "/tmp")) / "st_terrain_dl"

SOURCES = {
    "terrain_dirt.jpg": ("Ground103", "Ground103_2K-JPG_Color.jpg"),
    "terrain_grass.jpg": ("Ground079S", "Ground079S_2K-JPG_Color.jpg"),
    "terrain_forest.jpg": ("Ground086", "Ground086_2K-JPG_Color.jpg"),
    "terrain_road.jpg": ("Road005", "Road005_2K-JPG_Color.jpg"),
    "terrain_town.jpg": ("Ground103", "Ground103_2K-JPG_Color.jpg"),
}

# (saturation, brightness, contrast) — lower = more desolate
TUNE = {
    "terrain_dirt.jpg": (0.32, 0.88, 1.05),
    "terrain_grass.jpg": (0.42, 0.92, 1.02),
    "terrain_forest.jpg": (0.38, 0.72, 1.08),
    "terrain_road.jpg": (0.55, 0.85, 1.12),
    "terrain_town.jpg": (0.28, 0.78, 1.15),
}


def find_color_file(folder: str, filename: str) -> Path:
    base = TMP / folder
    direct = base / filename
    if direct.is_file():
        return direct
    for p in base.rglob(filename):
        if p.is_file():
            return p
    raise FileNotFoundError(f"Missing {filename} under {base}")


def _seamlessize(img: Image.Image) -> Image.Image:
    """Soft cross-blend at opposite edges to hide tile seams in-game."""
    w, h = img.size
    band = max(8, w // 64)
    out = img.copy()
    for y in range(h):
        for x in range(band):
            t = x / band
            px = out.getpixel((x, y))
            qx = out.getpixel((w - band + x, y))
            blend = tuple(int(px[c] * (1 - t) + qx[c] * t) for c in range(3))
            out.putpixel((x, y), blend)
            out.putpixel((w - 1 - x, y), blend)
    for x in range(w):
        for y in range(band):
            t = y / band
            px = out.getpixel((x, y))
            qy = out.getpixel((x, h - band + y))
            blend = tuple(int(px[c] * (1 - t) + qy[c] * t) for c in range(3))
            out.putpixel((x, y), blend)
            out.putpixel((x, h - 1 - y), blend)
    return out


def process(src: Path, out_name: str) -> None:
    sat, bright, cont = TUNE[out_name]
    img = Image.open(src).convert("RGB")
    img = ImageEnhance.Color(img).enhance(sat)
    img = ImageEnhance.Brightness(img).enhance(bright)
    img = ImageEnhance.Contrast(img).enhance(cont)
    img = img.resize((1024, 1024), Image.Resampling.LANCZOS)
    img = _seamlessize(img)
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / out_name
    img.save(dest, "JPEG", quality=88, optimize=True)
    print(f"Wrote {dest} ({dest.stat().st_size // 1024} KB)")


def main() -> None:
    for out_name, (folder, color_name) in SOURCES.items():
        src = find_color_file(folder, color_name)
        process(src, out_name)
    credits = OUT / "TERRAIN_CREDITS.md"
    credits.write_text(
        """# Terrain texture credits (CC0)

| File | Source | License |
|------|--------|---------|
| terrain_dirt.jpg, terrain_town.jpg | [ambientCG Ground 103](https://ambientcg.com/a/Ground103) | CC0 |
| terrain_grass.jpg | [ambientCG Ground 079S](https://ambientcg.com/a/Ground079s) | CC0 |
| terrain_forest.jpg | [ambientCG Ground 086](https://ambientcg.com/a/Ground086) | CC0 |
| terrain_road.jpg | [ambientCG Road 005](https://ambientcg.com/a/Road005) | CC0 |

Processed: desaturated, 1024×1024 JPEG for in-game tiling.
""",
        encoding="utf-8",
    )
    print(f"Wrote {credits}")


if __name__ == "__main__":
    main()
