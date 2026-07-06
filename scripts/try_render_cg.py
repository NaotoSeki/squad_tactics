# -*- coding: utf-8 -*-
"""
CG データを様々な幅で試しレンダリングし、
正しい寸法を目視で判断するためのプローブ画像を生成する。

  python scripts\\try_render_cg.py
  -> scripts/pl_decoded/cg_probe_renders/ (PNG files)
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    raise SystemExit("pip install Pillow")

PL = Path("D:/PL")
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "scripts" / "pl_decoded"
RENDER_DIR = OUT_DIR / "cg_probe_renders"


def load_palette(pal_json_path: Path) -> list[tuple[int, int, int]]:
    pal = json.loads(pal_json_path.read_text(encoding="utf-8"))
    colors = []
    for c in pal["colors"]:
        colors.append((c["r"], c["g"], c["b"]))
    while len(colors) < 256:
        colors.append((0, 0, 0))
    return colors


def render_8bpp(raw: bytes, width: int, palette: list[tuple],
                transparent_index: int = 0x18) -> Image.Image:
    height = len(raw) // width
    if height == 0:
        height = 1
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    pixels = img.load()
    for y in range(height):
        for x in range(width):
            idx = y * width + x
            if idx >= len(raw):
                break
            pix = raw[idx]
            if pix == transparent_index:
                pixels[x, y] = (0, 0, 0, 0)
            else:
                r, g, b = palette[pix]
                pixels[x, y] = (r, g, b, 255)
    return img


def render_4bpp(raw: bytes, width: int, palette: list[tuple],
                transparent_index: int = 0x18) -> Image.Image:
    height = (len(raw) * 2) // width
    if height == 0:
        height = 1
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    pixels = img.load()
    for y in range(height):
        for x in range(width):
            pixel_idx = y * width + x
            byte_idx = pixel_idx // 2
            if byte_idx >= len(raw):
                break
            if pixel_idx % 2 == 0:
                pix = (raw[byte_idx] >> 4) & 0x0F
            else:
                pix = raw[byte_idx] & 0x0F
            if pix == transparent_index:
                pixels[x, y] = (0, 0, 0, 0)
            else:
                r, g, b = palette[pix]
                pixels[x, y] = (r, g, b, 255)
    return img


def main() -> int:
    RENDER_DIR.mkdir(parents=True, exist_ok=True)

    pal_path = OUT_DIR / "iteml_palette_data.json"
    palette = load_palette(pal_path)

    for dll_name, table_file, block_size in [
        ("ITEML.DLL", "iteml_cg_resolved.json", 12288),
        ("ITEMS.DLL", "items_cg_resolved.json", 3072),
    ]:
        table_path = OUT_DIR / table_file
        entries = json.loads(table_path.read_text(encoding="utf-8"))["entries"]
        d = (PL / dll_name).read_bytes()
        stem = dll_name.split(".")[0].lower()

        test_indices = [2, 5, 10, 20, 50, 100, 200, 300]
        test_indices = [i for i in test_indices if i < len(entries)]

        for entry_idx in test_indices:
            e = entries[entry_idx]
            if e.get("file_offset_cg") is None:
                continue

            fo = e["file_offset_cg"]
            raw = d[fo:fo + block_size]

            if all(b == 0x18 for b in raw[:64]):
                continue

            if dll_name == "ITEML.DLL":
                widths_8bpp = [48, 64, 96, 128, 192, 256]
            else:
                widths_8bpp = [24, 32, 48, 64, 96]

            for w in widths_8bpp:
                img = render_8bpp(raw, w, palette)
                fname = f"{stem}_idx{entry_idx:03d}_w{w}_8bpp.png"
                img.save(RENDER_DIR / fname)

            if dll_name == "ITEML.DLL":
                widths_4bpp = [48, 64, 96, 128, 192]
            else:
                widths_4bpp = [32, 48, 64, 96]

            for w in widths_4bpp:
                img = render_4bpp(raw, w, palette)
                fname = f"{stem}_idx{entry_idx:03d}_w{w}_4bpp.png"
                img.save(RENDER_DIR / fname)

            print(f"  {dll_name} index {entry_idx}: rendered {len(widths_8bpp) + len(widths_4bpp)} variants")

    contact_widths = {
        "ITEML.DLL": [(96, 12288, "iteml_cg_resolved.json")],
        "ITEMS.DLL": [(48, 3072, "items_cg_resolved.json")],
    }
    for dll_name, configs in contact_widths.items():
        for width, block_size, table_file in configs:
            table_path = OUT_DIR / table_file
            entries = json.loads(table_path.read_text(encoding="utf-8"))["entries"]
            d = (PL / dll_name).read_bytes()
            stem = dll_name.split(".")[0].lower()

            valid = [
                e for e in entries
                if e.get("file_offset_cg") is not None and e["index"] > 0
            ][:64]

            if not valid:
                continue

            height = block_size // width
            cols = 8
            rows = (len(valid) + cols - 1) // cols
            sheet = Image.new("RGBA", (width * cols, height * rows), (0, 0, 0, 0))

            for i, e in enumerate(valid):
                fo = e["file_offset_cg"]
                raw = d[fo:fo + block_size]
                img = render_8bpp(raw, width, palette)
                col = i % cols
                row = i // cols
                sheet.paste(img, (col * width, row * height))

            sheet_path = RENDER_DIR / f"{stem}_contact_w{width}_8bpp.png"
            sheet.save(sheet_path)
            print(f"  Contact sheet: {sheet_path.name} ({len(valid)} items)")

    print(f"\nAll renders saved to {RENDER_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
