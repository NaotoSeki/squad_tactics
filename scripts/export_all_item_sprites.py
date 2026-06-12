# -*- coding: utf-8 -*-
"""
確定した寸法で全 CG エントリを透過 PNG としてエクスポートする。

パレット:
  ITEML.DLL DGROUP:0x10 に格納された 3-byte RGB パレットを使用。
  pixel_value - 10 = palette_index のオフセットが確認済み。
  pixel 24 (0x18 = BG) -> palette[14] = (76, 82, 204) = 青背景色。

画像:
  - 垂直フリップ（DIB bottom-up 格納補正）
  - ブロックサイズ自動判定（大:192x64 / 小:64x64 の境界を検出）

  python scripts\\export_all_item_sprites.py
  -> data/sprites/iteml/  (大: 192x64, 小: 64x64)
  -> scripts/pl_decoded/item_sprite_export_summary.json
"""
from __future__ import annotations

import json
import struct
import subprocess
import sys
from pathlib import Path

from PIL import Image

PL = Path("D:/PL")
ROOT = Path(__file__).resolve().parents[1]
PL_DECODED = ROOT / "scripts" / "pl_decoded"
SPRITE_DIR_L = ROOT / "data" / "sprites" / "iteml"
BG_INDEX = 0x18
PIXEL_OFFSET = 10


def load_game_palette() -> list[tuple[int, int, int]]:
    """Load the weapon sprite palette from ITEML.DLL DGROUP:0x10.

    The palette is stored as 3-byte RGB entries. Pixel values in the CG
    data are offset by 10, so palette_index = pixel_value - PIXEL_OFFSET.

    Color ramps:
      palette[0-6]:  gray metal gradient  (pixel 10-16)
      palette[7]:    olive accent          (pixel 17)
      palette[8-13]: brown/gold wood ramp  (pixel 18-23)
      palette[14]:   blue BG (76,82,204)   (pixel 24 = 0x18)
      palette[15]:   dark gray detail      (pixel 25)
      palette[16]:   near-white highlight  (pixel 26)
      palette[17-25]:olive/accent colors   (pixel 27-35)
    """
    d = PL.joinpath("ITEML.DLL").read_bytes()
    ne_off = struct.unpack_from("<I", d, 0x3C)[0]
    auto_ds = struct.unpack_from("<H", d, ne_off + 0x0E)[0]
    align = 1 << struct.unpack_from("<H", d, ne_off + 0x32)[0]
    seg_base = ne_off + struct.unpack_from("<H", d, ne_off + 0x22)[0]
    o = seg_base + 8 * (auto_ds - 1)
    dg_off = struct.unpack_from("<H", d, o)[0] * align

    pal_raw = d[dg_off + 0x10: dg_off + 0x10 + 38 * 3]

    colors: list[tuple[int, int, int]] = [(0, 0, 0)] * 256
    for i in range(38):
        r, g, b = pal_raw[i * 3], pal_raw[i * 3 + 1], pal_raw[i * 3 + 2]
        pixel_val = i + PIXEL_OFFSET
        if pixel_val < 256:
            colors[pixel_val] = (r, g, b)

    colors[247] = (255, 255, 255)
    colors[248] = (0, 0, 0)
    colors[7] = (0, 0, 0)
    return colors


def compute_block_sizes(entries: list[dict]) -> list[int]:
    """Compute actual block size for each entry from pointer spacing."""
    sizes = []
    for i, e in enumerate(entries):
        if e.get("file_offset_cg") is None:
            sizes.append(0)
            continue
        fo = e["file_offset_cg"]
        seg = e.get("target_seg")
        seg_end = e.get("seg_file_offset", 0) + (e.get("seg_length", 0) or 0)
        max_in_seg = seg_end - fo if seg_end > fo else 0

        next_in_same_seg = None
        for j in range(i + 1, min(i + 5, len(entries))):
            ne = entries[j]
            if ne.get("target_seg") == seg and ne.get("file_offset_cg") is not None:
                next_in_same_seg = ne["file_offset_cg"]
                break

        if next_in_same_seg is not None:
            sizes.append(next_in_same_seg - fo)
        elif max_in_seg > 0:
            sizes.append(max_in_seg)
        else:
            sizes.append(0)
    return sizes


def detect_size_classes(entries: list[dict], block_sizes: list[int]) -> dict:
    """Detect the boundary between large and small items."""
    resolved = [
        (i, bs)
        for i, (e, bs) in enumerate(zip(entries, block_sizes))
        if e.get("file_offset_cg") is not None and bs > 0
    ]
    if not resolved:
        return {"boundary": len(entries), "large_block": 0, "small_block": 0}

    from collections import Counter
    size_counts = Counter(bs for _, bs in resolved)
    most_common = size_counts.most_common(2)

    if len(most_common) >= 2:
        large_block = max(most_common[0][0], most_common[1][0])
        small_block = min(most_common[0][0], most_common[1][0])
    else:
        large_block = most_common[0][0]
        small_block = large_block

    boundary = len(entries)
    for idx, bs in resolved:
        if bs == small_block:
            boundary = idx
            break

    return {
        "boundary": boundary,
        "large_block": large_block,
        "small_block": small_block,
    }


def render(raw: bytes, width: int, height: int,
           palette: list[tuple], bg: int = BG_INDEX,
           flip_v: bool = True) -> Image.Image:
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    px = img.load()
    for y in range(height):
        src_y = (height - 1 - y) if flip_v else y
        row_off = src_y * width
        for x in range(width):
            i = row_off + x
            if i >= len(raw):
                break
            b = raw[i]
            if b == bg:
                px[x, y] = (0, 0, 0, 0)
            else:
                r, g, bb = palette[b]
                px[x, y] = (r, g, bb, 255)
    return img


def export_sprites(dll_path: Path, table_path: Path,
                   out_dir: Path, large_dims: tuple, small_dims: tuple,
                   palette: list[tuple]) -> list[dict]:
    d = dll_path.read_bytes()
    table = json.loads(table_path.read_text(encoding="utf-8"))
    entries = table["entries"]

    block_sizes = compute_block_sizes(entries)
    size_info = detect_size_classes(entries, block_sizes)

    boundary = size_info["boundary"]
    large_w, large_h = large_dims
    small_w, small_h = small_dims
    large_block = large_w * large_h
    small_block = small_w * small_h

    print(f"  Size boundary at index {boundary}")
    print(f"  Large: {large_w}x{large_h} = {large_block} bytes")
    print(f"  Small: {small_w}x{small_h} = {small_block} bytes")
    print(f"  Detected large_block={size_info['large_block']}, small_block={size_info['small_block']}")

    out_dir.mkdir(parents=True, exist_ok=True)
    summary = []

    for e in entries:
        idx = e["index"]
        if e.get("file_offset_cg") is None:
            summary.append({"index": idx, "exported": False, "reason": "unresolved"})
            continue

        fo = e["file_offset_cg"]
        is_small = idx >= boundary
        w = small_w if is_small else large_w
        h = small_h if is_small else large_h
        bs = w * h

        raw = d[fo:fo + bs]
        if len(raw) < bs:
            summary.append({"index": idx, "exported": False, "reason": "truncated",
                            "available": len(raw), "needed": bs})
            continue

        non_bg = sum(1 for b in raw if b != BG_INDEX)
        if non_bg == 0:
            summary.append({
                "index": idx, "exported": False, "reason": "all_background",
                "file_offset_hex": e.get("file_offset_cg_hex"),
                "size_class": "small" if is_small else "large",
            })
            continue

        img = render(raw, w, h, palette, flip_v=True)
        fname = f"item_{idx:04d}.png"
        img.save(out_dir / fname)
        summary.append({
            "index": idx,
            "exported": True,
            "file": fname,
            "file_offset_hex": e.get("file_offset_cg_hex"),
            "target_seg": e.get("target_seg"),
            "dimensions": f"{w}x{h}",
            "size_class": "small" if is_small else "large",
            "non_bg_pixels": non_bg,
            "unique_colors": len(set(raw)),
        })

    return summary


def main() -> int:
    palette = load_game_palette()

    print("Exporting ITEML sprites...")
    iteml_summary = export_sprites(
        PL / "ITEML.DLL",
        PL_DECODED / "iteml_cg_resolved.json",
        SPRITE_DIR_L,
        large_dims=(192, 64),
        small_dims=(64, 64),
        palette=palette,
    )
    exported_l = sum(1 for s in iteml_summary if s.get("exported"))
    large_l = sum(1 for s in iteml_summary if s.get("size_class") == "large" and s.get("exported"))
    small_l = sum(1 for s in iteml_summary if s.get("size_class") == "small" and s.get("exported"))
    print(f"  Total: {exported_l} (large={large_l}, small={small_l})")

    results = {
        "ITEML": {
            "large_dims": "192x64",
            "small_dims": "64x64",
            "total": len(iteml_summary),
            "exported": exported_l,
            "large_count": large_l,
            "small_count": small_l,
            "output_dir": str(SPRITE_DIR_L),
            "entries": iteml_summary,
        }
    }

    out_json = PL_DECODED / "item_sprite_export_summary.json"
    out_json.write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nWROTE {out_json}")

    # CBE index>=395 は ITEML に実データ無し → 名チェーン同名エイリアス
    alias_script = ROOT / "scripts" / "export_iteml_cbe_aliases.py"
    if alias_script.is_file():
        print("\nGenerating CBE alias sprites (index>=395)...")
        subprocess.run([sys.executable, str(alias_script)], check=False)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
