# -*- coding: utf-8 -*-
"""
CBE.EXE 武器/弾薬レコード u16[27] (+54) を抽出 → data/pl_cbe_mag_shape.js

PL 装填 UI 形状フィルタ（Thompson ドラム等）用。
再生成: python scripts/export_pl_cbe_mag_shape.py
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CBE_PATH = Path("D:/PL/CBE.EXE")
DECODED = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAMES = ROOT / "data" / "cbe_name_table.json"
OUT = ROOT / "data" / "pl_cbe_mag_shape.js"

TABLE_START = 0x1DDF00
STRIDE = 64
U27_OFFSET = 54  # u16 index 27


def u16_at(data: bytes, record_idx: int) -> int:
    off = TABLE_START + record_idx * STRIDE + U27_OFFSET
    if off + 2 > len(data):
        return 0
    return struct.unpack_from("<H", data, off)[0]


def main() -> None:
    if not CBE_PATH.exists():
        raise SystemExit(f"CBE not found: {CBE_PATH}")
    cbe = CBE_PATH.read_bytes()
    decoded = json.loads(DECODED.read_text(encoding="utf-8"))
    names = json.loads(NAMES.read_text(encoding="utf-8"))

    weapons: dict[str, int] = {}
    ammo: dict[str, int] = {}
    other: dict[str, int] = {}

    for row in decoded:
        idx = int(row["cbeNameIndex"])
        flag = u16_at(cbe, idx)
        key = str(idx)
        cat = row.get("category_code", 0)
        if cat == 18:
            ammo[key] = flag
        elif cat <= 17:
            weapons[key] = flag
        else:
            other[key] = flag

    lines = [
        "/** 自動生成: python scripts/export_pl_cbe_mag_shape.py — 手編集禁止 */",
        "/** CBE u16[27] @ +54 — PL 装填 UI 形状/レシーバーフラグ（Thompson ドラム等） */",
        "(function () {",
        "    'use strict';",
        "    /** @type {Record<number, number>} cbeNameIndex → u27 */",
        "    window.PL_CBE_MAG_SHAPE_WEAPONS = " + json.dumps(weapons, ensure_ascii=False) + ";",
        "    /** @type {Record<number, number>} 弾薬行 cbeNameIndex → u27 */",
        "    window.PL_CBE_MAG_SHAPE_AMMO = " + json.dumps(ammo, ensure_ascii=False) + ";",
        "    /** 65 = ドラム/旧式レシーバー可（commercial Thompson 等） */",
        "    window.PL_CBE_MAG_SHAPE_DRUM_RECEIVER = 65;",
        "})();",
        "",
    ]
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT}")
    print(f"  weapons: {len(weapons)}, ammo: {len(ammo)}, other: {len(other)}")
    # sanity: Thompson
    for wi in [15, 16, 17]:
        print(f"  W[{wi}] {names.get(str(wi), '?')} u27={weapons.get(str(wi))}")
    for ai in [235, 236]:
        print(f"  A[{ai}] {names.get(str(ai), '?')} u27={ammo.get(str(ai))}")


if __name__ == "__main__":
    main()
