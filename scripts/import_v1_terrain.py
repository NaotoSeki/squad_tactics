"""Import v1.0 hex tiles into asset/environment/hex_tiles/ (RGBA + hex mask)."""
from __future__ import annotations

import math
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC_CANDIDATES = [
    ROOT / "scripts" / "terrain_v1" / "output" / "tiles",
    ROOT / "_v1_extract" / "v1.0" / "output" / "tiles",
]
DST = ROOT / "asset" / "environment" / "hex_tiles"

TILE_W, TILE_H = 202, 233
HEX_R = 108
CX, CY = TILE_W / 2, TILE_H / 2


def hex_mask() -> Image.Image:
    mask = Image.new("L", (TILE_W, TILE_H), 0)
    draw = ImageDraw.Draw(mask)
    verts = [
        (
            CX + HEX_R * math.cos(math.radians(90 + 60 * i)),
            CY + HEX_R * math.sin(math.radians(90 + 60 * i)),
        )
        for i in range(6)
    ]
    draw.polygon(verts, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(radius=1))


def to_rgba(src: Path, dst: Path, mask: Image.Image) -> None:
    img = Image.open(src).convert("RGB")
    rgba = img.convert("RGBA")
    rgba.putalpha(mask)
    dst.parent.mkdir(parents=True, exist_ok=True)
    rgba.save(dst, "PNG", optimize=True)


def main() -> None:
    zip_src = ROOT / "v1.0.zip"
    src = next((p for p in SRC_CANDIDATES if p.is_dir()), None)
    if src is None and zip_src.is_file():
        import zipfile

        with zipfile.ZipFile(zip_src, "r") as zf:
            zf.extractall(ROOT / "_v1_extract")
        src = next((p for p in SRC_CANDIDATES if p.is_dir()), None)

    if src is None:
        print("Source not found. Run scripts/terrain_v1/generate_tiles.py or place v1.0.zip", file=sys.stderr)
        sys.exit(1)

    mask = hex_mask()
    count = 0
    for tile in sorted(src.glob("*.png")):
        to_rgba(tile, DST / tile.name, mask)
        count += 1

    # Legacy single-name aliases (variant 0)
    for terrain in ("dirt", "grass", "forest", "water"):
        v0 = DST / f"hex_{terrain}_0.png"
        alias = DST / f"hex_{terrain}.png"
        if v0.is_file():
            shutil.copy2(v0, alias)

    town_src = DST / "hex_dirt_0.png"
    if town_src.is_file():
        shutil.copy2(town_src, DST / "hex_town.png")

    readme = DST / "README.md"
    readme.write_text(
        """# Hex terrain tiles (v1.0)

Imported from `v1.0.zip` via `scripts/import_v1_terrain.py`.

## Files
- `hex_{terrain}_{0-5}.png` — grass / forest / water / dirt variants
- `hex_trans_{a}_{b}_d{0-5}.png` — boundary transitions (higher-priority neighbor)
- `hex_{terrain}.png` — alias of variant 0

## Regenerate source tiles
```powershell
pip install numpy pillow opensimplex
python scripts/terrain_v1/generate_tiles.py
python scripts/import_v1_terrain.py
```

In-game: `TerrainRender.useV1Tiles = true` in `phaser_terrain.js`.
Size: 202×233 px, scale `1/HIGH_RES_SCALE`.
""",
        encoding="utf-8",
    )
    print(f"Imported {count} tiles -> {DST}")


if __name__ == "__main__":
    main()
