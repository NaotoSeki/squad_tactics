# -*- coding: utf-8 -*-
"""
cbeNameIndex（CBE 名チェーン 0..483）を行優先 22x22 グリッドのセル座標に写し、
INTERMIS.DLL の IDB_ITEM_01（408×242 前後）からタイルを切り出す。

**仮定**: アトラス上の行優先 0,1,..483 が cbe 名索引と 1:1 対応。ゲーム本番の対応表は
未固定のため、本出力は人間が M1911 等の見た目で合否を見る用。

  set PL_DIR=D:\\PL
  python scripts\\export_intermis_tiles_by_cbe_index.py
  set PL_CBE_INDEX_LIST=0,7,8,70,120
  python scripts\\export_intermis_tiles_by_cbe_index.py

出力: asset\\pl_weapons\\_intermis_ITEM01_tiles\\cbe_###.png
"""
from __future__ import annotations

import csv
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from extract_ne_resources import parse_ne_resources  # noqa: E402
from extract_pl_cbe_weapon_icons import (  # noqa: E402
    find_pl_dir,
    get_rt_bitmap_by_name,
    slice_atlas_row_major,
)

OUT_DIR = ROOT / "asset" / "pl_weapons" / "_intermis_ITEM01_tiles"
CSV_PATH = ROOT / "data" / "wpns_pl_master_table.csv"
ATLAS = os.environ.get("PL_ATLAS_NAME", "IDB_ITEM_01")
COLS = int(os.environ.get("PL_ATLAS_COLS", "22"))
ROWS = int(os.environ.get("PL_ATLAS_ROWS", "22"))


def _csv_indices() -> set[int]:
    s = set()
    with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        for row in r:
            try:
                s.add(int(row["cbeNameIndex"]))
            except (ValueError, KeyError):
                pass
    return s


def _pick_indices() -> list[int]:
    env = os.environ.get("PL_CBE_INDEX_LIST", "").strip()
    if env:
        out = []
        for part in env.split(","):
            part = part.strip()
            if part.isdigit():
                out.append(int(part))
        return out or [0, 1, 2, 4, 5, 6, 7, 8]
    # 既定: マスタに出てくる索引を最大 80 点まで
    s = sorted(_csv_indices())
    return s[: min(80, len(s))]


def main() -> int:
    pl = find_pl_dir()
    if not pl:
        print("PL_DIR / D:/PL がありません。")
        return 1
    inter = pl / "INTERMIS.DLL"
    if not inter.is_file():
        print("INTERMIS.DLL がありません:", inter)
        return 1
    p = parse_ne_resources(str(inter))
    if p.get("error"):
        print(p["error"])
        return 1
    im = get_rt_bitmap_by_name(p, ATLAS)
    if im is None:
        print("アトラス不在:", ATLAS)
        return 1
    iw, ih = im.size
    chain = 484
    cells = slice_atlas_row_major(im, COLS, ROWS, chain)
    if len(cells) < chain:
        print("warning: cells", len(cells), "<", chain)
    indices = _pick_indices()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    meta_path = OUT_DIR / "_meta.txt"
    lines = [
        f"atlas={ATLAS} bitmap={iw}x{ih} grid={COLS}x{ROWS} row_major",
        f"cbeNameIndex = row * {COLS} + col (0..{COLS*ROWS-1} の範囲で切り出し)",
        f"count exported = {len(indices)}",
    ]
    n = 0
    for idx in indices:
        if idx < 0 or idx >= len(cells):
            continue
        cells[idx].save(OUT_DIR / f"cbe_{idx:03d}.png", "PNG")
        n += 1
    meta_path.write_text("\n".join(lines) + f"\nfiles={n}\n", encoding="utf-8")
    print("WROTE", OUT_DIR, n, "files", meta_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
