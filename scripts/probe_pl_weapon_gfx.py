# -*- coding: utf-8 -*-
"""
D:\\PL 配下を走査し、(1) 埋め込み DIB らしい BITMAPINFOHEADER の寸法を集計
(2) CBE.EXE 名 103/110 の帯を列・行分割してプレビュー PNG へ書き出す。

武器データ（cbe 名索引）と画像の**厳密なテーブル指針**は未確定のため、
本スクリプトは「目視用の幾何候補」と「DIB 寸法の分布」を成果物にする。

使用:
  set PL_DIR=D:\\PL
  python scripts\\probe_pl_weapon_gfx.py

出力:
  - scripts\\pl_decoded\\pl_weapon_dib_dim_scan.json
  - asset\\pl_weapons\\_cbeStrip_probe\\cbe_103_cols{c}_rows{r}\\*.png
"""
from __future__ import annotations

import io
import json
import struct
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from extract_ne_resources import build_bmp_file, parse_ne_resources  # noqa: E402

try:
    from PIL import Image
except ImportError:
    print("ERROR: pip install Pillow")
    sys.exit(1)

OUT_SCAN = ROOT / "scripts" / "pl_decoded" / "pl_weapon_dib_dim_scan.json"
OUT_STRIP_DIR = ROOT / "asset" / "pl_weapons" / "_cbeStrip_probe"

# 1MB 超はスキップ（巨大マップ用 IPF 等を除外）
MAX_FILE = 5 * 1024 * 1024
PL_EXTS = {".exe", ".dll", ".dat", ".res", ".bin", ".cpl", ".sys", ".drv", ".386", ".ovl"}


def find_pl() -> Path | None:
    import os

    for k in ("PL_DIR", "PL_ROOT"):
        v = os.environ.get(k)
        if v and Path(v).is_dir():
            return Path(v)
    for p in (Path("D:/PL"), Path("C:/PL")):
        if p.is_dir():
            return p
    return None


def iter_pl_files(root: Path):
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in PL_EXTS and p.suffix not in (".", ""):
            continue
        try:
            sz = p.stat().st_size
        except OSError:
            continue
        if sz < 200 or sz > MAX_FILE:
            continue
        yield p, sz


def scan_dib_headers(data: bytes, source: str) -> list[dict]:
    """
    疑似 BITMAPINFOHEADER: biSize==40, biPlanes==1, biCompression==0, biBitCount 1/4/8/16/24/32
    幅 16..2048, 高さ 1..2048 (絶対値, top-down 符号付き対応)
    """
    n = len(data)
    hits: list[dict] = []
    o = 0
    # 粗密: 2 バイトアライン (多くの埋め込みはワード境界)
    while o + 40 <= n:
        bi_size = struct.unpack_from("<I", data, o)[0]
        if bi_size != 40:
            o += 2
            continue
        w = struct.unpack_from("<i", data, o + 4)[0]
        h = struct.unpack_from("<i", data, o + 8)[0]
        planes = struct.unpack_from("<H", data, o + 12)[0]
        bpp = struct.unpack_from("<H", data, o + 14)[0]
        comp = struct.unpack_from("<I", data, o + 16)[0]
        if planes != 1 or comp != 0:
            o += 2
            continue
        if bpp not in (1, 4, 8, 16, 24, 32):
            o += 2
            continue
        aw, ah = abs(w), abs(h)
        if not (16 <= aw <= 2048 and 8 <= ah <= 2048):
            o += 2
            continue
        # 偽陽性削減: パレット直後ぽいサイズ
        hits.append(
            {
                "off": o,
                "w": w,
                "h": h,
                "bpp": bpp,
            }
        )
        o += 2
    return hits


def dib_to_rgba(dib: bytes) -> Image.Image | None:
    b = build_bmp_file(dib)
    if not b:
        return None
    try:
        return Image.open(io.BytesIO(b)).convert("RGBA")
    except Exception:
        return None


def slice_grid(im: Image.Image, cols: int, rows: int) -> list[Image.Image]:
    w, h = im.size
    if cols < 1 or rows < 1:
        return []
    out: list[Image.Image] = []
    for r in range(rows):
        for c in range(cols):
            x0, x1 = (c * w) // cols, ((c + 1) * w) // cols
            y0, y1 = (r * h) // rows, ((r + 1) * h) // rows
            if x1 > x0 and y1 > y0:
                out.append(im.crop((x0, y0, x1, y1)).copy())
    return out


def export_cbe_strips(pl: Path) -> dict:
    p = parse_ne_resources(str(pl / "CBE.EXE"))
    if p.get("error"):
        return {"error": p["error"]}
    d = p["data"]
    meta: dict = {}
    for name in ("103", "110"):
        im = None
        for rtype in p.get("resource_types", []):
            if rtype.get("type_id") != 0x8002:
                continue
            for e in rtype.get("entries", []):
                if str(e.get("name", "")) != name:
                    continue
                off, ln = e["offset"], e["length"]
                if off + ln <= len(d):
                    im = dib_to_rgba(d[off : off + ln])
                break
        if im is None:
            meta[name] = {"ok": False}
            continue
        w, h = im.size
        meta[name] = {"ok": True, "w": w, "h": h, "slices": []}
        base = OUT_STRIP_DIR / f"cbe_{name}_{w}x{h}"
        for cols in (1, 2, 3, 4, 5, 6, 8):
            for rows in (1, 2):
                cells = slice_grid(im, cols, rows)
                if not cells:
                    continue
                cw = round(w / cols) if cols else 0
                ch = round(h / rows) if rows else 0
                sub = base / f"cols{cols}_rows{rows}"
                sub.mkdir(parents=True, exist_ok=True)
                for i, cim in enumerate(cells[: 48]):  # 目盛り過多を避ける
                    cim.save(sub / f"cell_{i:02d}_{cim.size[0]}x{cim.size[1]}.png")
                meta[name]["slices"].append(
                    {
                        "cols": cols,
                        "rows": rows,
                        "cell_approx_w": cw,
                        "cell_approx_h": ch,
                        "n_cells": len(cells),
                        "dir": str(sub.relative_to(ROOT)),
                    }
                )
    return {"cbe": meta, "out_base": str(OUT_STRIP_DIR.relative_to(ROOT))}


def main() -> int:
    pl = find_pl()
    if not pl:
        print("PL_DIR または D:/PL がありません。")
        return 1

    all_dims: Counter[tuple[int, int, int, str]] = Counter()
    per_file: list[dict] = []
    files_scanned = 0
    for path, _sz in iter_pl_files(pl):
        rel = str(path.relative_to(pl)).replace("\\", "/")
        try:
            data = path.read_bytes()
        except OSError:
            continue
        files_scanned += 1
        ht = scan_dib_headers(data, rel)
        for h in ht:
            w, hi = h["w"], h["h"]
            aw, ahi = abs(w), abs(hi)
            key = (aw, ahi, h["bpp"], rel)
            all_dims[key] += 1
        if ht:
            per_file.append(
                {
                    "file": rel,
                    "n_header_like": len(ht),
                    "sample": [
                        {**h, "w_abs": abs(h["w"]), "h_abs": abs(h["h"])}
                        for h in ht[:8]
                    ],
                }
            )

    # 寸法別に集約 (ファイル横断)
    by_wh: Counter[tuple[int, int, int]] = Counter()
    for (w, h, bpp, f), c in all_dims.items():
        by_wh[(w, h, bpp)] += c

    # 帯 103/110
    strip_meta: dict
    try:
        strip_meta = export_cbe_strips(pl)
    except Exception as e:
        strip_meta = {"error": str(e)}

    doc = {
        "_meta": {
            "pl": str(pl),
            "max_file_bytes": MAX_FILE,
            "files_scanned": files_scanned,
            "note": "DIB ヘッダ風 40/BI_RGB。偽陽性あり。120x40 前後は集計で目視。",
        },
        "cbe_strips": strip_meta,
        "unique_dims_top": [
            {"w": w, "h": h, "bpp": bpp, "count": c}
            for (w, h, bpp), c in by_wh.most_common(60)
        ],
        "weapon_like_dims": [
            {
                "w": w,
                "h": h,
                "bpp": bpp,
                "count": c,
            }
            for (w, h, bpp), c in by_wh.most_common(200)
            if 90 <= w <= 140 and 28 <= h <= 55
        ],
        "per_file_hits": sorted(per_file, key=lambda x: -x["n_header_like"])[:40],
    }
    OUT_SCAN.parent.mkdir(parents=True, exist_ok=True)
    OUT_SCAN.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", OUT_SCAN)
    if strip_meta.get("cbe"):
        print("CBe strips", strip_meta.get("out_base", ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
