# -*- coding: utf-8 -*-
"""
CBE u16[21] @ +42 を抽出 → data/pl_cbe_mag_type.js

弾薬行: mag_type_group（マグ種別グループ ID）
武器行: sub_action_items[0]（同名オフセットだが意味は別 — 照合は要 RE）

再生成: python scripts/export_pl_cbe_mag_type.py
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CBE_PATH = Path("D:/PL/CBE.EXE")
DECODED = ROOT / "data" / "wpns_pl_stats_decoded.json"
OUT = ROOT / "data" / "pl_cbe_mag_type.js"

TABLE_START = 0x1DDF00
STRIDE = 64
U21_OFFSET = 42  # u16 index 21


def u21_at(data: bytes, record_idx: int) -> int:
    off = TABLE_START + record_idx * STRIDE + U21_OFFSET
    if off + 2 > len(data):
        return 0
    return struct.unpack_from("<H", data, off)[0]


def main() -> None:
    if not CBE_PATH.exists():
        raise SystemExit(f"CBE not found: {CBE_PATH}")
    cbe = CBE_PATH.read_bytes()
    decoded = json.loads(DECODED.read_text(encoding="utf-8"))

    ammo: dict[str, int] = {}
    weapons: dict[str, int] = {}

    for row in decoded:
        idx = int(row["cbeNameIndex"])
        flag = u21_at(cbe, idx)
        key = str(idx)
        cat = row.get("category_code", 0)
        if cat == 18:
            ammo[key] = flag
        elif cat <= 17:
            weapons[key] = flag

    lines = [
        "/** 自動生成: python scripts/export_pl_cbe_mag_type.py — 手編集禁止 */",
        "/** CBE u16[21] @ +42 — 弾: mag_type_group / 武器: sub_action_items[0] */",
        "(function () {",
        "    'use strict';",
        "    window.PL_CBE_MAG_TYPE_AMMO = " + json.dumps(ammo, ensure_ascii=False) + ";",
        "    window.PL_CBE_MAG_TYPE_WEAPONS = " + json.dumps(weapons, ensure_ascii=False) + ";",
        "})();",
        "",
    ]
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT}")
    print(f"  ammo: {len(ammo)}, weapons: {len(weapons)}")
    nz = sum(1 for v in weapons.values() if v)
    print(f"  weapons with u21!=0: {nz}")


if __name__ == "__main__":
    main()
