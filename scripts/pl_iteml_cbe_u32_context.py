# -*- coding: utf-8 -*-
"""CBE.EXE 内の u32 定数 3200（0x0C80, ITEML.DLL seg2 先頭ファイルオフセット）出現箇所の前後 24 バイトを列挙。

  python scripts\\pl_iteml_cbe_u32_context.py
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "scripts" / "pl_decoded" / "iteml_cbe_u32_3200_context.txt"


def main() -> int:
    cbe = Path("D:/PL/CBE.EXE")
    if not cbe.is_file():
        print("D:/PL/CBE.EXE なし")
        return 1
    c = cbe.read_bytes()
    needle = struct.pack("<I", 3200)
    p = 0
    lines: list[str] = [f"CBE size={len(c)} needle=u32(3200) = ITEML seg2 file off\n"]
    n = 0
    while True:
        i = c.find(needle, p)
        if i < 0:
            break
        lo = max(0, i - 24)
        chunk = c[lo : i + 28]
        lines.append(f"\n--- hit #{n} file_off=0x{i:x} ---\n")
        lines.append(chunk.hex(" "))
        p = i + 1
        n += 1
    lines.append(f"\n\ntotal_hits {n}\n")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("".join(lines), encoding="utf-8")
    print("WROTE", OUT, "hits", n)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
