# -*- coding: utf-8 -*-
"""
ITEML.DLL seg2 生データを 8bpp DIB（既定 256x240 等、61440=全消費）にデコードし、
グリッド等分割 → **透過 RGBA PNG** として 1 タイル 1 ファイルで書き出す。

背景除去:
  近黒＋GUNIW 系の緑っぽい地色をヒューリスティクスで透明化（本番 ITEMPAL ではないため完全ではない）。

使用:
  set PL_DIR=D:\\PL
  python scripts\\export_iteml_seg2_tiles_rgba.py
  set ITEML_DIB_W=256
  set ITEML_DIB_H=240
  set PL_TILE_COLS=4
  set PL_TILE_ROWS=5
  set PL_DRY_RUN=1

  # 4bpp 厳密 384x320（違う解釈。別フォルダに出力）
  set ITEML_BPP=4
  set ITEML_DIB_W=384
  set ITEML_DIB_H=320
  python scripts\\export_iteml_seg2_tiles_rgba.py

目視比較の一括（human_suggested 複数解 + compare_sheet）:
  python scripts\\export_iteml_seg2_eyeball_variants.py
  -> asset/pl_weapons/iteml_seg2_eyeball_v1/compare_sheet_eyeball.png
"""
from __future__ import annotations

import io
import os
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from extract_ne_resources import build_bmp_file, parse_ne_resources
from probe_iteml_stride_decode import (
    build_dib4,
    build_dib8,
    extract_bgr_256_parsed,
    ne_segments,
    unpack_4_dib,
    unpack_8_dib,
)
from extract_pl_cbe_weapon_icons import find_pl_dir, slice_atlas_row_major

try:
    import numpy as np
except ImportError:
    print("需要: pip install numpy")
    np = None

try:
    from PIL import Image
except ImportError:
    print("需要: pip install Pillow")
    sys.exit(1)

OUT = ROOT / "asset" / "pl_weapons" / "iteml_seg2_tiles_rgba"
OUT4 = ROOT / "asset" / "pl_weapons" / "iteml_seg2_4bpp384_tiles_rgba"
SEG_LABEL = "seg2"


def row_8_dib(w: int) -> int:
    return ((w * 8 + 31) // 32) * 4


def row_4_dib(w: int) -> int:
    return ((w * 4 + 31) // 32) * 4


def chroma_rgba(
    im_rgb: np.ndarray, black_thr: int = 28, green_key: bool = True
) -> np.ndarray:
    """
    (h,w,3) uint8 -> (h,w,4) uint8
    """
    r = im_rgb[:, :, 0].astype(np.int16)
    g = im_rgb[:, :, 1].astype(np.int16)
    b = im_rgb[:, :, 2].astype(np.int16)
    s = (r + g * 2 + b) // 4
    a = 255 * np.ones(r.shape, dtype=np.uint8)
    # 近黒
    t = (np.maximum(np.maximum(r, g), b) < black_thr) & (s < black_thr * 2)
    a = np.where(t, 0, a)
    # 黄緑/オリーブ地のみ（水色ハイライトは g≈b なので落としにくい）
    if green_key:
        sumx = (r + g + b).clip(1, 9999)
        olive = (g > r + 8) & (g > b) & (g > 50) & (r + g + b < 220) & (g * 2 > sumx * 0.7)
        a = np.where(olive, 0, a)
    return np.dstack((im_rgb, a))


def main() -> int:
    if np is None:
        return 1
    pl = find_pl_dir() or Path(os.environ.get("PL_DIR", "D:/PL"))
    p_iteml = pl / "ITEML.DLL"
    if not p_iteml.is_file():
        print("ITEML.DLL なし", p_iteml)
        return 1
    bpp = int(os.environ.get("ITEML_BPP", "8"))
    w = int(os.environ.get("ITEML_DIB_W", "256" if bpp == 8 else "384"))
    h = int(os.environ.get("ITEML_DIB_H", "240" if bpp == 8 else "320"))
    cols = int(os.environ.get("PL_TILE_COLS", "4"))
    rows_ = int(os.environ.get("PL_TILE_ROWS", "5"))
    dry = os.environ.get("PL_DRY_RUN", "").strip() in ("1", "true", "yes")
    if bpp == 8:
        rlen = row_8_dib(w) * h
    else:
        rlen = row_4_dib(w) * h
    d = p_iteml.read_bytes()
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    segs = ne_segments(d, ne)
    s2 = next(s for s in segs if s[0] == 2)
    buf = d[s2[1] : s2[2]]
    if rlen != len(buf):
        print("seg2 長", len(buf), "期待 8bpp", w, h, "→", rlen, "。環境変数を調整。")
        return 1
    p_int = parse_ne_resources(str(pl / "INTERMIS.DLL"))
    bgr256, rgb3 = extract_bgr_256_parsed(p_int)
    bgr16 = bgr256[: 16 * 4]
    if bpp == 8:
        inds = unpack_8_dib(buf, w, h)
        if not inds:
            print("8bpp デコード失敗")
            return 1
        dib = build_dib8(inds, w, h, bgr256)
    else:
        inds = unpack_4_dib(buf, w, h)
        if not inds:
            print("4bpp デコード失敗")
            return 1
        dib = build_dib4(inds, w, h, bgr16)
    bmp = build_bmp_file(dib)
    base = Image.open(io.BytesIO(bmp)).convert("RGB")
    arr = np.array(base, dtype=np.uint8)
    rgba = chroma_rgba(arr)
    pil = Image.fromarray(rgba, "RGBA")
    if dry:
        print("OK dry run", bpp, "bpp", w, h, "grid", cols, rows_)
        return 0
    outdir = OUT if bpp == 8 else OUT4
    outdir.mkdir(parents=True, exist_ok=True)
    cells = slice_atlas_row_major(pil, cols, rows_, cols * rows_)
    n = 0
    for i, cell in enumerate(cells):
        cell.save(outdir / f"iteml_{SEG_LABEL}_tile_{i:03d}.png", "PNG")
        n += 1
    meta = outdir / "_meta.txt"
    meta.write_text(
        f"source={p_iteml}\n"
        f"dib={bpp}bpp {w}x{h} bytes={rlen}\n"
        f"grid={cols}x{rows_} tiles={n}\n"
        f"chroma: black<{28}, green g>r+14 etc. (tune in script)\n"
        f"next: cbe 索引との対応は pl_iteml_tile_map_*.json 未。ITEMPAL 取得で色精度向上。\n",
        encoding="utf-8",
    )
    print("WROTE", outdir, "tiles", n, meta)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
