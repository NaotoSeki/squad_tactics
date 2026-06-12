# -*- coding: utf-8 -*-
"""Kar43 / Bren / .303 系の mag_type_group (u16[21]) 調査。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CBE_PATH = Path("D:/PL/CBE.EXE")
DECODED = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAMES = ROOT / "data" / "cbe_name_table.json"
TABLE, STRIDE = 0x1DDF00, 64


def u16s(cbe: bytes, idx: int) -> list[int]:
    off = TABLE + idx * STRIDE
    return [struct.unpack_from("<H", cbe, off + i)[0] for i in range(0, 64, 2)]


def main() -> None:
    if not CBE_PATH.exists():
        raise SystemExit(f"CBE not found: {CBE_PATH}")
    cbe = CBE_PATH.read_bytes()
    names = json.loads(NAMES.read_text(encoding="utf-8"))
    decoded = json.loads(DECODED.read_text(encoding="utf-8"))
    by_idx = {r["cbeNameIndex"]: r for r in decoded}

    def n(i: int) -> str:
        return names.get(str(i), f"?{i}")

    print("=== 7.92 弾 u21/u27 ===")
    for ai in [272, 273, 274, 275, 276]:
        u = u16s(cbe, ai)
        cap = by_idx.get(ai, {}).get("magazine_capacity", "?")
        print(f"  A[{ai:3d}] {n(ai):12s} u21={u[21]:3d} u27={u[27]:3d} mag_cap={cap}")

    print("\n=== 7.92 小銃 u21 / ammo_indices ===")
    for wi in [55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]:
        w = by_idx.get(wi)
        if not w:
            continue
        u = u16s(cbe, wi)
        ai = w.get("ammo_indices") or []
        print(
            f"  W[{wi:3d}] {w['name']:12s} u21={u[21]:3d} u27={u[27]:3d} "
            f"ammo={ai} -> {[n(x) for x in ai]}"
        )

    print("\n=== Bren / .303 ===")
    for wi in [169, 170, 171, 175, 176, 177, 178, 179]:
        w = by_idx.get(wi)
        if not w:
            continue
        u = u16s(cbe, wi)
        ai = w.get("ammo_indices") or []
        print(
            f"  W[{wi:3d}] {w['name']:12s} u21={u[21]:3d} u27={u[27]:3d} "
            f"ammo={ai} -> {[n(x) for x in ai]}"
        )
    for ai in [355, 357, 358, 364]:
        u = u16s(cbe, ai)
        cap = by_idx.get(ai, {}).get("magazine_capacity", "?")
        cat = by_idx.get(ai, {}).get("category_code", "?")
        print(f"  A[{ai:3d}] {n(ai):12s} cat={cat} u21={u[21]:3d} u27={u[27]:3d} mag_cap={cap}")

    print("\n=== .303 / Bren 系 u21 マッチ候補 ===")
    for r in decoded:
        if r.get("category_code") != 18:
            continue
        ai = r["cbeNameIndex"]
        u = u16s(cbe, ai)
        if u[27] == 64 and u[21] in (173, 177, 184, 186):
            print(f"  A[{ai:3d}] {r['name']:12s} u21={u[21]:3d} mag={r.get('magazine_capacity')}")


if __name__ == "__main__":
    main()
