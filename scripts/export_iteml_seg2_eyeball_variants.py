# -*- coding: utf-8 -*-
"""
ITEML seg2（61440B）を「目視比較用」に複数レイアウト一括エクスポート。

- iteml_seg2_likely_layouts.json の **human_suggested** 系（512x120 / 480x128 / 256x240 /
  240x256 / 二面512x120 / 4bpp 320x384）＋ deinterlace 256x120 を各サブフォルダにタイル PNG。
- ルートに **compare_sheet_eyeball.png**（全バリアント縮小を1枚に並べ、ラベル付き）。

  set PL_DIR=D:\\PL
  python scripts\\export_iteml_seg2_eyeball_variants.py

出力: asset/pl_weapons/iteml_seg2_eyeball_v1/
"""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import numpy as np
from extract_ne_resources import build_bmp_file, parse_ne_resources
from extract_pl_cbe_weapon_icons import find_pl_dir, slice_atlas_row_major
from PIL import Image, ImageDraw, ImageFont
from probe_iteml_stride_decode import (
    build_dib4,
    build_dib8,
    extract_bgr_256_parsed,
    ne_segments,
    unpack_4_dib,
    unpack_8_dib,
)
from probe_iteml_seg2_likely_layouts import deinterlace_maxpair

# 既存スクリプトと同じ chroma
from export_iteml_seg2_tiles_rgba import chroma_rgba

OUT_ROOT = ROOT / "asset" / "pl_weapons" / "iteml_seg2_eyeball_v1"
SEG_LABEL = "seg2"


def rgba_from_indices8(inds: bytes, w: int, h: int, bgr256: bytes) -> Image.Image:
    dib = build_dib8(inds, w, h, bgr256)
    bmp = build_bmp_file(dib)
    base = Image.open(io.BytesIO(bmp)).convert("RGB")
    arr = np.array(base, dtype=np.uint8)
    r = chroma_rgba(arr)
    return Image.fromarray(r, "RGBA")


def rgba_from_indices4(inds: bytes, w: int, h: int, bgr16: bytes) -> Image.Image:
    dib = build_dib4(inds, w, h, bgr16)
    bmp = build_bmp_file(dib)
    base = Image.open(io.BytesIO(bmp)).convert("RGB")
    arr = np.array(base, dtype=np.uint8)
    r = chroma_rgba(arr)
    return Image.fromarray(r, "RGBA")


def export_tiles(
    pil: Image.Image,
    outdir: Path,
    cols: int,
    rows: int,
    prefix: str,
) -> int:
    outdir.mkdir(parents=True, exist_ok=True)
    cells = slice_atlas_row_major(pil, cols, rows, cols * rows)
    for i, cell in enumerate(cells):
        cell.save(outdir / f"{prefix}_tile_{i:03d}.png", "PNG")
    return len(cells)


def two_plane_512x120(buf: bytes, bgr256: bytes) -> Image.Image:
    a0 = np.frombuffer(buf[0:30720], dtype=np.uint8).reshape((120, 256))
    a1 = np.frombuffer(buf[30720:61440], dtype=np.uint8).reshape((120, 256))
    side = np.hstack((a0, a1))
    inds = side.astype(np.uint8).tobytes()
    return rgba_from_indices8(inds, 512, 120, bgr256)


def fit_font(size: int = 14) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        try:
            return ImageFont.truetype("C:/Windows/Fonts/meiryo.ttc", size)
        except OSError:
            return ImageFont.load_default()


def build_compare_sheet(
    entries: list[tuple[str, Image.Image]], path: Path, thumb_w: int = 300
) -> None:
    """各 (label, full_rgba) を横2列で縮小して1枚に。"""
    font = fit_font(13)
    imgs: list[tuple[str, Image.Image]] = []
    for label, im in entries:
        w, h = im.size
        if w <= 0 or h <= 0:
            continue
        tw = min(thumb_w, w)
        th = max(1, int(h * tw / w))
        imgs.append((label, im.resize((tw, th), Image.Resampling.LANCZOS)))

    if not imgs:
        return
    col_n = 2
    margin = 12
    label_h = 20
    cell_w = thumb_w + margin
    cell_h = label_h + int(thumb_w * 0.75) + margin * 2
    nrows = (len(imgs) + col_n - 1) // col_n
    sheet_w = col_n * cell_w + margin
    sheet_h = nrows * cell_h + margin
    sheet = Image.new("RGB", (sheet_w, sheet_h), (36, 38, 46))
    dr = ImageDraw.Draw(sheet)

    for idx, (label, sim) in enumerate(imgs):
        row, col = divmod(idx, col_n)
        x0 = margin + col * cell_w
        y0 = margin + row * cell_h
        dr.text((x0, y0), label, fill=(235, 235, 245), font=font)
        y_img = y0 + label_h
        x_img = x0 + max(0, (cell_w - margin - sim.width) // 2)
        if sim.mode == "RGBA":
            sheet.paste(sim, (x_img, y_img), sim.split()[3])
        else:
            sheet.paste(sim, (x_img, y_img))

    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "PNG")


def main() -> int:
    pl = find_pl_dir() or Path(os.environ.get("PL_DIR", "D:/PL"))
    p_iteml = pl / "ITEML.DLL"
    if not p_iteml.is_file():
        print("ITEML.DLL なし", p_iteml)
        return 1
    d = p_iteml.read_bytes()
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    segs = ne_segments(d, ne)
    s2 = next(s for s in segs if s[0] == 2)
    buf = d[s2[1] : s2[2]]
    if len(buf) != 61440:
        print("seg2 len", len(buf), "expected 61440")
        return 1

    p_int = parse_ne_resources(str(pl / "INTERMIS.DLL"))
    bgr256, rgb3 = extract_bgr_256_parsed(p_int)
    bgr16 = bgr256[: 16 * 4]

    # (folder_id, label, pil 生成, cols, rows)
    compare: list[tuple[str, Image.Image]] = []

    def one_dib8(w: int, h: int, folder: str, label: str, cols: int, rows: int) -> None:
        inds = unpack_8_dib(buf, w, h)
        if not inds:
            print("skip 8bpp", w, h)
            return
        pil = rgba_from_indices8(inds, w, h, bgr256)
        compare.append((label, pil.copy()))
        n = export_tiles(
            pil,
            OUT_ROOT / folder,
            cols,
            rows,
            f"iteml_{SEG_LABEL}",
        )
        (OUT_ROOT / folder / "_meta.txt").write_text(
            f"{label}\n8bpp DIB {w}x{h}\ntiles={n} grid={cols}x{rows}\n",
            encoding="utf-8",
        )
        print("OK", folder, n, "tiles")

    # 1..4: human_suggested 8bpp DIB
    one_dib8(512, 120, "01_8bpp_512x120", "8bpp 512x120 (横長・主副枠想定)", 8, 2)
    one_dib8(480, 128, "02_8bpp_480x128", "8bpp 480x128", 8, 2)
    one_dib8(256, 240, "03_8bpp_256x240", "8bpp 256x240 (従来グリッド)", 4, 5)
    one_dib8(240, 256, "04_8bpp_240x256", "8bpp 240x256 (縦長ストライド別解)", 4, 5)

    # 5: 二面 512x120
    pil5 = two_plane_512x120(buf, bgr256)
    compare.append(("8bpp 512x120 二面(256x120+256x120 横連結)", pil5.copy()))
    n5 = export_tiles(pil5, OUT_ROOT / "05_8bpp_512x120_twoPlane", 8, 2, f"iteml_{SEG_LABEL}")
    (OUT_ROOT / "05_8bpp_512x120_twoPlane" / "_meta.txt").write_text(
        f"twoPlane 256x120|256x120 → 512x120\ntiles={n5}\n", encoding="utf-8"
    )
    print("OK 05", n5)

    # 6: 4bpp 320x384
    w, h = 320, 384
    ind4 = unpack_4_dib(buf, w, h)
    if ind4:
        pil6 = rgba_from_indices4(ind4, w, h, bgr16)
        compare.append(("4bpp 320x384 (縦・16色)", pil6.copy()))
        n6 = export_tiles(pil6, OUT_ROOT / "06_4bpp_320x384", 4, 5, f"iteml_{SEG_LABEL}")
        (OUT_ROOT / "06_4bpp_320x384" / "_meta.txt").write_text(
            f"4bpp DIB {w}x{h}\ntiles={n6}\n", encoding="utf-8"
        )
        print("OK 06", n6)

    # 7: deinterlace 256x120
    ind240 = unpack_8_dib(buf, 256, 240)
    if ind240:
        ind120 = deinterlace_maxpair(ind240, 256, 240)
        pil7 = rgba_from_indices8(ind120, 256, 120, bgr256)
        compare.append(("8bpp 256x120 deint(256x240 隣行max)", pil7.copy()))
        n7 = export_tiles(pil7, OUT_ROOT / "07_8bpp_256x120_deint", 4, 5, f"iteml_{SEG_LABEL}")
        (OUT_ROOT / "07_8bpp_256x120_deint" / "_meta.txt").write_text(
            f"deinterlace_maxpair from 8bpp 256x240\n8bpp 256x120\ntiles={n7}\n",
            encoding="utf-8",
        )
        print("OK 07", n7)

    build_compare_sheet(compare, OUT_ROOT / "compare_sheet_eyeball.png")

    root_meta = OUT_ROOT / "_root_meta.txt"
    root_meta.write_text(
        "目視: まず **compare_sheet_eyeball.png** を1枚で比較。\n"
        "良さそうな解はサブフォルダ名（01_.. 07_..）で選び、その中の tile を確認。\n"
        f"源: {p_iteml} seg2, INTERMIS パレット (GUNIW 由来、本番 ITEMPAL 非)\n"
        "設定: pl_decoded/iteml_seg2_likely_layouts.json human_suggested 準拠 + deint 追加\n",
        encoding="utf-8",
    )
    print("WROTE", OUT_ROOT, "compare_sheet_eyeball.png", "variants", len(compare))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
