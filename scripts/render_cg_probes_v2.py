# -*- coding: utf-8 -*-
"""
CG probe render v2: all candidate widths, proper contact sheets.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

PL = Path("D:/PL")
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "scripts" / "pl_decoded"
RENDER_DIR = OUT_DIR / "cg_probe_renders"


def load_palette(pal_json_path: Path) -> list[tuple[int, int, int]]:
    pal = json.loads(pal_json_path.read_text(encoding="utf-8"))
    colors = [(c["r"], c["g"], c["b"]) for c in pal["colors"]]
    while len(colors) < 256:
        colors.append((0, 0, 0))
    return colors


def render_8bpp(raw: bytes, width: int, palette: list[tuple],
                bg_idx: int = 0x18) -> Image.Image:
    n_pixels = len(raw)
    height = n_pixels // width
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    px = img.load()
    for y in range(height):
        for x in range(width):
            i = y * width + x
            if i >= n_pixels:
                break
            b = raw[i]
            if b == bg_idx:
                px[x, y] = (0, 0, 0, 0)
            else:
                r, g, bb = palette[b]
                px[x, y] = (r, g, bb, 255)
    return img


def make_contact_sheet(images: list[Image.Image], cols: int = 8,
                       bg: tuple = (40, 40, 40, 255)) -> Image.Image:
    if not images:
        return Image.new("RGBA", (1, 1))
    w, h = images[0].size
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new("RGBA", (w * cols + cols - 1, h * rows + rows - 1), bg)
    for i, img in enumerate(images):
        c = i % cols
        r = i // cols
        sheet.paste(img, (c * (w + 1), r * (h + 1)))
    return sheet


def main() -> int:
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    palette = load_palette(OUT_DIR / "iteml_palette_data.json")

    configs = [
        {
            "dll": "ITEML.DLL",
            "table": "iteml_cg_resolved.json",
            "block": 12288,
            "widths": [48, 64, 96, 128, 192],
            "stem": "iteml",
        },
        {
            "dll": "ITEMS.DLL",
            "table": "items_cg_resolved.json",
            "block": 3072,
            "widths": [24, 32, 48, 64, 96],
            "stem": "items",
        },
    ]

    for cfg in configs:
        entries = json.loads(
            (OUT_DIR / cfg["table"]).read_text(encoding="utf-8")
        )["entries"]
        d = (PL / cfg["dll"]).read_bytes()

        resolved = [
            e for e in entries
            if e.get("file_offset_cg") is not None and e["index"] >= 2
        ]

        for w in cfg["widths"]:
            images = []
            for e in resolved[:80]:
                fo = e["file_offset_cg"]
                raw = d[fo:fo + cfg["block"]]
                img = render_8bpp(raw, w, palette)
                images.append(img)

            sheet = make_contact_sheet(images, cols=8)
            out = RENDER_DIR / f"{cfg['stem']}_w{w}_8bpp_contact.png"
            sheet.save(out)
            print(f"  {out.name}  ({sheet.size[0]}x{sheet.size[1]})")

        for idx in [2, 3, 10, 26]:
            if idx >= len(entries):
                continue
            e = entries[idx]
            if e.get("file_offset_cg") is None:
                continue
            fo = e["file_offset_cg"]
            raw = d[fo:fo + cfg["block"]]
            for w in cfg["widths"]:
                img = render_8bpp(raw, w, palette)
                img.save(RENDER_DIR / f"{cfg['stem']}_idx{idx:03d}_w{w}.png")

    print(f"\nDone. Files in {RENDER_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
