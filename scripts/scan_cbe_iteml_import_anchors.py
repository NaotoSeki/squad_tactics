# -*- coding: utf-8 -*-
"""
CBE.EXE 内の ITEML / ITEMS 関連の import 名断片出現位置を列挙（逆アセ・Ghidra のアンカー用）。

  python scripts\\scan_cbe_iteml_import_anchors.py

  -> scripts/pl_decoded/cbe_iteml_import_anchors.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "scripts" / "pl_decoded" / "cbe_iteml_import_anchors.json"
PL = Path("D:/PL")
CBE = PL / "CBE.EXE"

PATTERNS = [
    b"ITEML",
    b"ITEMS",
    b"ITEMLCG",
    b"ITEMPAL",
    b"_DLLGET_ITEMLCG",
    b"_DLLGET_ITEMPAL",
    b"_DLLGET_ITEMSCG",
]


def find_all(d: bytes, pat: bytes) -> list[int]:
    out = []
    p = 0
    while True:
        i = d.find(pat, p)
        if i < 0:
            break
        out.append(i)
        p = i + 1
    return out


def main() -> int:
    if not CBE.is_file():
        print("CBE なし", CBE)
        return 1
    d = CBE.read_bytes()
    if d[:2] != b"MZ":
        return 1
    ne = int.from_bytes(d[0x3C:0x40], "little")
    res: dict = {
        "_meta": {
            "file": str(CBE),
            "size": len(d),
            "ne_offset": ne,
            "purpose": "静的解析で import / GetProc 相当呼び出しを探す手がかり",
        },
        "string_hits": [],
    }
    for pat in PATTERNS:
        for i in find_all(d, pat):
            res["string_hits"].append(
                {
                    "pat": pat.decode("ascii", errors="replace"),
                    "file_offset": i,
                    "offset_hex": hex(i),
                    "context_hex_96": d[max(0, i - 32) : i + 64].hex(" "),
                }
            )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", OUT, "n_hits", len(res["string_hits"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
