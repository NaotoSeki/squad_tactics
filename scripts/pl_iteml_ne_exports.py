# -*- coding: utf-8 -*-
"""NE 常駐名テーブルを歩いて ITEML.DLL / ITEMS.DLL のエクスポート名＋序数を JSON 化。

  python scripts\\pl_iteml_ne_exports.py
  -> scripts/pl_decoded/iteml_ne_exports.json
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "scripts" / "pl_decoded" / "iteml_ne_exports.json"


def walk_resident_names(d: bytes, ne: int) -> list[dict]:
    off = struct.unpack_from("<H", d, ne + 0x26)[0]
    p = ne + off
    out: list[dict] = []
    while p < len(d) - 3:
        ln = d[p]
        if ln == 0:
            break
        name = d[p + 1 : p + 1 + ln].decode("ascii", errors="replace")
        ord_ = struct.unpack_from("<H", d, p + 1 + ln)[0]
        out.append({"ordinal": ord_, "name": name})
        p += 1 + ln + 2
    return out


def main() -> int:
    pl = Path("D:/PL")
    doc: dict = {"_meta": {"pl": str(pl)}, "modules": {}}
    for dll in ("ITEML.DLL", "ITEMS.DLL"):
        p = pl / dll
        if not p.is_file():
            doc["modules"][dll] = {"error": "missing"}
            continue
        d = p.read_bytes()
        if d[:2] != b"MZ":
            doc["modules"][dll] = {"error": "not MZ"}
            continue
        ne = struct.unpack_from("<I", d, 0x3C)[0]
        if d[ne : ne + 2] != b"NE":
            doc["modules"][dll] = {"error": "not NE"}
            continue
        doc["modules"][dll] = {
            "size": len(d),
            "ne_off": ne,
            "exports": walk_resident_names(d, ne),
        }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
