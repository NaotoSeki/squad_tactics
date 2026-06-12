# -*- coding: utf-8 -*-
"""武器 u21 != 0 の mag_type ペア調査。"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CBE = Path("D:/PL/CBE.EXE")
DECODED = ROOT / "data" / "wpns_pl_stats_decoded.json"
TABLE, STRIDE = 0x1DDF00, 64


def u16s(data: bytes, idx: int) -> list[int]:
    off = TABLE + idx * STRIDE
    return [struct.unpack_from("<H", data, off + i)[0] for i in range(0, 64, 2)]


def main() -> None:
    cbe = CBE.read_bytes()
    decoded = json.loads(DECODED.read_text(encoding="utf-8"))
    by_idx = {r["cbeNameIndex"]: r for r in decoded}

    nz = []
    for r in decoded:
        cat = r.get("category_code", 99)
        if cat == 18 or cat > 17:
            continue
        wi = r["cbeNameIndex"]
        u = u16s(cbe, wi)
        if u[21] != 0:
            nz.append((wi, r["name"], u[21], u[27], r.get("ammo_indices") or []))

    print(f"weapons with u21 != 0: {len(nz)}")
    for wi, nm, u21, u27, ai in sorted(nz, key=lambda x: x[2]):
        pairs = []
        for a in ai:
            au = u16s(cbe, a)
            an = by_idx.get(a, {}).get("name", str(a))
            pairs.append(f"{a}:{an}:a21={au[21]}")
        print(f"  W[{wi:3d}] {nm:14s} w21={u21:3d} w27={u27:3d} ammo -> {pairs}")


if __name__ == "__main__":
    main()
