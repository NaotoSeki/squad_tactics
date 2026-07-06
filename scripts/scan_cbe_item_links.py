# -*- coding: utf-8 -*-
"""
Scan CBE.EXE near embedded weapon/ammo strings for u16 index-like tables.
Platoon Leader (Win16) — heuristics; definitive edges come from play + name offsets.
"""
import struct
import json
from pathlib import Path

CBE = Path(r"D:\PL\CBE.EXE")
OUT = Path(__file__).resolve().parent / "pl_decoded" / "cbe_item_link_scan.json"


def u16(d, o):
    return struct.unpack_from("<H", d, o)[0] if o + 2 <= len(d) else 0


def find_cstr(d: bytes, s: str) -> int:
    b = s.encode("ascii", errors="strict")
    return d.find(b + b"\x00")


def scan_window(d: bytes, center: int, win: int = 2048) -> dict:
    lo = max(0, center - win)
    hi = min(len(d), center + win)
    chunk = d[lo:hi]
    # u16 values in plausible index range 0-600 (name table size)
    candidates = []
    for off in range(0, len(chunk) - 1, 2):
        v = u16(chunk, off)
        if v <= 600:
            rel = lo + off
            candidates.append({"file_off": rel, "rel_to_center": rel - center, "value": v})
    return {"lo": lo, "hi": hi, "u16_in_range_count": len(candidates), "sample": candidates[:40]}


def main():
    d = CBE.read_bytes()
    names = {
        "M1911A1": "M1911A1",
        "M1917_S&W": "M1917 S&W",
        "45ACP-7": "45ACP-7",
        "M1918A2": "M1918A2 BAR",
        "3006-20B": "3006-20B",
        "FLeut41": "FLeut41",
    }
    res = {"file": str(CBE), "size": len(d), "anchors": {}}
    for key, s in names.items():
        p = d.find(s.encode("ascii") + b"\x00")
        res["anchors"][key] = None if p < 0 else {"offset": p, "scan": scan_window(d, p)}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", OUT)


if __name__ == "__main__":
    main()
