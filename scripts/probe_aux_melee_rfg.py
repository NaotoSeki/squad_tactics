# -*- coding: utf-8 -*-
"""Messer / S84 / M9A1 RfG / ammo_box — CBE レコード調査。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATS = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAMES = ROOT / "data" / "cbe_name_table.json"
CBE = Path("D:/PL/CBE.EXE")
TABLE, STRIDE = 0x1DDF00, 64


def u16s(data: bytes, idx: int) -> list[int]:
    off = TABLE + idx * STRIDE
    return [struct.unpack_from("<H", data, off + i)[0] for i in range(0, 64, 2)]


def main() -> None:
    stats = json.loads(STATS.read_text(encoding="utf-8"))
    names = json.loads(NAMES.read_text(encoding="utf-8"))
    by = {r["cbeNameIndex"]: r for r in stats}
    cbe = CBE.read_bytes() if CBE.exists() else b""

    def n(i: int) -> str:
        return names.get(str(i), "?")

    print("=== 白兵 / 銃剣行 ===")
    for ai in [313, 314]:
        r = by.get(ai)
        u = u16s(cbe, ai) if cbe else []
        print(
            f"  A[{ai}] {n(ai):10s} cat={r.get('category_code')} "
            f"melee_mod={r.get('melee_attack')} mag_cap={r.get('magazine_capacity')} "
            f"ammo_indices={r.get('ammo_indices')} u21={u[21] if u else '?'} u27={u[27] if u else '?'}"
        )

    print("\n=== Kar98 系 ammo_indices ===")
    for wi in list(range(55, 70)) + [73, 74]:
        r = by.get(wi)
        if not r:
            continue
        ai = r.get("ammo_indices") or []
        print(
            f"  W[{wi}] {r['name']:12s} melee_w={r.get('melee_attack'):3} "
            f"slots={[n(x) for x in ai]}"
        )

    print("\n=== M9A1 RfG (244) — CBE 行 ===")
    r244 = by.get(244)
    print(f"  cat={r244.get('category_code')} name={r244.get('category_name')}")
    print(f"  ammo_indices={r244.get('ammo_indices')} -> {[n(x) for x in r244.get('ammo_indices') or []]}")

    print("\n=== 擲弾発射機を ammo_indices に持つ銃 ===")
    for r in stats:
        cat = r.get("category_code", 99)
        if cat > 17:
            continue
        ai = r.get("ammo_indices") or []
        rfg = [x for x in ai if x in (244, 245, 303, 304, 305)]
        if rfg:
            print(f"  W[{r['cbeNameIndex']}] {r['name']:14s} -> {[n(x) for x in rfg]}")

    print("\n=== 244/245 をスロットに含む全レコード ===")
    for r in stats:
        ai = r.get("ammo_indices") or []
        hits = [x for x in ai if x in (244, 245)]
        if hits:
            print(
                f"  [{r['cbeNameIndex']:3d}] {r['name']:14s} cat={r.get('category_code')} "
                f"-> {[n(x) for x in hits]}"
            )

    print("\n=== ユーザー想定 RfG 対象 ===")
    for wi in [6, 8, 9, 10, 11, 12, 13, 14]:
        r = by.get(wi)
        if not r:
            continue
        ai = r.get("ammo_indices") or []
        has_rfg = any(x in (244, 245) for x in ai)
        print(
            f"  W[{wi}] {r['name']:14s} cat={r.get('category_code')} "
            f"rfg_in_slots={has_rfg} slots={[n(x) for x in ai if x]}"
        )

    print("\n=== ammo_box (cat=13) — ammo_indices 中身 ===")
    for r in stats:
        if r.get("category_code") != 13:
            continue
        ai = [x for x in (r.get("ammo_indices") or []) if x]
        print(f"  [{r['cbeNameIndex']:3d}] {r['name']:14s} ammo_indices={ai or '[]'}")

    print("\n=== mag_type 間接参照 @ w21*64 (Bren w21=184) ===")
    if cbe:
        for w21 in [184, 113, 114]:
            off = TABLE + w21 * STRIDE
            rec = cbe[off : off + STRIDE]
            u = [struct.unpack_from("<H", rec, i)[0] for i in range(0, 64, 2)]
            nm = n(w21) if w21 in by else f"idx{w21}"
            print(f"  table[{w21}] ({nm}): name_idx={u[0]} cat={u[1]} u21={u[21]} ammo={u[22:26]}")


if __name__ == "__main__":
    main()
