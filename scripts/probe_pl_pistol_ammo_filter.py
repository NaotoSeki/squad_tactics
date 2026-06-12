# -*- coding: utf-8 -*-
"""
9mm 拳銃 / 9Pb 弾の CBE リンクと mag_type_group (u16[21]) を一覧する。
PL 第3フィルタ（mag_type）解明用。

実行: python scripts/probe_pl_pistol_ammo_filter.py
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECODED = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAMES = ROOT / "data" / "cbe_name_table.json"
CBE_PATH = Path("D:/PL/CBE.EXE")
TABLE, STRIDE = 0x1DDF00, 64

PISTOL_INDICES = [42, 43, 49, 50, 223]  # C/96, P08, HSc, P38, Astra903
AMMO_9PB = [258, 259, 265, 278, 320]  # 8L, 32ACP-8M, 8W, 20S, 10


def load_names() -> dict:
    return json.loads(NAMES.read_text(encoding="utf-8"))


def u16s(cbe: bytes, idx: int) -> list[int]:
    off = TABLE + idx * STRIDE
    return [struct.unpack_from("<H", cbe, off + i)[0] for i in range(0, 64, 2)]


def main() -> None:
    names = load_names()
    decoded = json.loads(DECODED.read_text(encoding="utf-8"))
    cbe = CBE_PATH.read_bytes() if CBE_PATH.exists() else None

    def n(i: int) -> str:
        return names.get(str(i), f"?{i}")

    print("=== 拳銃 ammo_indices（CBE 正本候補） ===")
    for wi in PISTOL_INDICES:
        w = next((r for r in decoded if r["cbeNameIndex"] == wi), None)
        if not w:
            continue
        ai = w.get("ammo_indices") or []
        line = f"  [{wi:3d}] {w['name']:14s} ammo={ai} -> {[n(x) for x in ai]}"
        if cbe:
            u = u16s(cbe, wi)
            line += f"  w_u21={u[21]} w_u27={u[27]}"
        print(line)

    print("\n=== 9Pb / 近傍弾 ===")
    for ai in AMMO_9PB:
        a = next((r for r in decoded if r["cbeNameIndex"] == ai), None)
        nm = n(ai)
        weapons = []
        if (ROOT / "data/ammo_compat_full.json").exists():
            doc = json.loads((ROOT / "data/ammo_compat_full.json").read_text(encoding="utf-8"))
            row = (doc.get("ammo") or {}).get(str(ai)) or {}
            weapons = row.get("weapon_names_cbe") or []
        line = f"  [{ai}] {nm:12s} linked_weapons={weapons}"
        if cbe:
            u = u16s(cbe, ai)
            line += f"  a_u21={u[21]} a_u27={u[27]}"
        print(line)

    print("\n=== 仮説: UI可 = ammo_indices に含まれる AND u27 一致（Thompson 系） AND mag_type? ===")
    print("  → mag_type export 後に pl_ammo_resolve に第3フィルタ追加")
    if not cbe:
        print("\n  (CBE.EXE 未配置 — u21/u27 は D:\\PL\\CBE.EXE 配置後に再実行)")


if __name__ == "__main__":
    main()
