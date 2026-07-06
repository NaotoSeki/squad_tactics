# -*- coding: utf-8 -*-
"""
Wave 0b: (0,225) 等の断片ヒット相対距離から、仮定ストライド（行バイト）との整合性を採点する。
入力: re_item_table_hits.json または CBE 直スキャン
出力: scripts/pl_decoded/cbe_row_stride_alignment.json

  set PL_CBE_EXE=path  未設定時 D:\\PL\\CBE.EXE
  python scripts/cbe_row_stride_align.py
"""
from __future__ import annotations

import json
import math
import os
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HITS = ROOT / "scripts" / "pl_decoded" / "re_item_table_hits.json"
OUT = ROOT / "scripts" / "pl_decoded" / "cbe_row_stride_alignment.json"
DEFAULT_EXE = os.environ.get("PL_CBE_EXE", r"D:\PL\CBE.EXE")
PAIR = (0, 225)


def u16w(w: int, a: int) -> bytes:
    return struct.pack("<HH", w & 0xFFFF, a & 0xFFFF)


def find_all(hay: bytes, needle: bytes) -> list[int]:
    r = []
    p = 0
    while True:
        i = hay.find(needle, p)
        if i < 0:
            break
        r.append(i)
        p = i + 1
    return r


def gcd_list(vals: list[int]) -> int:
    g = 0
    for v in vals:
        g = math.gcd(g, abs(v))
    return g


def main() -> None:
    ex = Path(DEFAULT_EXE)
    offsets: list[int] = []
    if ex.is_file():
        data = ex.read_bytes()
        offsets = find_all(data, u16w(*PAIR))
    else:
        if HITS.is_file():
            j = json.loads(HITS.read_text(encoding="utf-8"))
            hexes = (j.get("cbe", {}) or {}).get("pair_hits", [])
            for ph in hexes:
                if ph.get("w") == PAIR[0] and ph.get("a") == PAIR[1]:
                    for h in ph.get("offsets_hex", []):
                        offsets.append(int(h, 16))
                    break

    if len(offsets) < 2:
        OUT.write_text(
            json.dumps(
                {
                    "_meta": {
                        "error": "insufficient (0,225) hits; need CBE at PL_CBE_EXE or re_item_table_hits.json",
                        "cbe": str(ex),
                    }
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print("WROTE (minimal)", OUT, "— no offsets")
        return

    offsets = sorted(set(offsets))
    diffs = [offsets[i + 1] - offsets[i] for i in range(len(offsets) - 1)]
    g = gcd_list(diffs) if diffs else 0

    # For stride S bytes: (diff % S) == 0 なら行境界が揃う仮説に加点
    stride_scores: dict = {}
    for s in (8, 10, 12, 16, 20, 24, 28, 32, 40, 48, 64):
        if s < 4:
            continue
        mod_ok = sum(1 for d in diffs if d % s == 0)
        stride_scores[str(s)] = {
            "diffs_covered": mod_ok,
            "diffs_total": len(diffs),
            "all_divisible": mod_ok == len(diffs) and len(diffs) > 0,
        }

    best = []
    for k, v in stride_scores.items():
        if v.get("all_divisible"):
            best.append(int(k))

    out = {
        "_meta": {
            "script": "cbe_row_stride_align.py",
            "cbe": str(ex) if ex.is_file() else None,
            "pair": list(PAIR),
            "count": len(offsets),
        },
        "offsets_hex": [hex(x) for x in offsets],
        "pairwise_deltas_dec": diffs,
        "pairwise_deltas_hex": [hex(d) for d in diffs],
        "gcd_of_deltas": g,
        "stride_mod_hint": f"If rows are {g}B-aligned, GCD of deltas = {g} (weak — hits may be different tables).",
        "stride_scores_bytes": stride_scores,
        "strides_all_diffs_divisible": best,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", OUT, "n=", len(offsets), "gcd=", g, "candidates", best)


if __name__ == "__main__":
    main()
