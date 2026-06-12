# -*- coding: utf-8 -*-
"""
CBE.EXE（NE）のセグメント末尾 relocation を Wine の ne_segment.c と同形にパースし、
ITEML / ITEMS 向け import fixup を列挙する。

  python scripts\\parse_cbe_ne_import_fixups.py

  -> scripts/pl_decoded/cbe_iteml_items_reloc_hits.json

参照: Wine `dlls/krnl386.exe16/ne_segment.c`（relocation_entry_s 8 バイト、
先頭 u16 = count）。

Ghidra: 「バイナリを開く」→ File → Offset に `file_offset_data_ref` を入れると
        POINTER32 置き場（import 解決先スロット）に飛ぶ。そこを XRef する。
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

PL = Path("D:/PL")
CBE = PL / "CBE.EXE"
OUT = Path(__file__).resolve().parents[1] / "scripts" / "pl_decoded" / "cbe_iteml_items_reloc_hits.json"

NE_RELTYPE_ORDINAL = 1
NE_RELTYPE_NAME = 2
NE_RADDR_POINTER32 = 3  # 手元のヒットはすべて 3（far ポインタ 4B）


def read_ne_segments(d: bytes, ne: int) -> list[dict]:
    a = 1 << struct.unpack_from("<H", d, ne + 0x32)[0]
    nseg = struct.unpack_from("<H", d, ne + 0x1C)[0]
    segto = ne + struct.unpack_from("<H", d, ne + 0x22)[0]
    segs: list[dict] = []
    for i in range(nseg):
        o = segto + 8 * i
        raw, ln, fl, m = struct.unpack_from("<HHHH", d, o)
        fo = raw * a
        act = 65536 if ln == 0 else ln
        segs.append(
            {
                "index": i + 1,
                "file_start": fo,
                "raw_len": act,
                "flags": fl,
            }
        )
    return segs


def next_file_offset_after(segs: list[dict], i: int) -> int:
    for j in range(i + 1, len(segs)):
        nfo = segs[j]["file_start"]
        if nfo > 0:
            return nfo
    return 0


def pascal_name(d: bytes, base: int, off: int) -> str:
    p = base + off
    if p < 0 or p >= len(d):
        return "<oob>"
    ln = d[p]
    if ln == 0 or p + 1 + ln > len(d):
        return "<bad>"
    return d[p + 1 : p + 1 + ln].decode("ascii", errors="replace")


def is_plausible_name(s: str) -> bool:
    if s.startswith("<"):
        return False
    return all(32 <= ord(c) < 127 for c in s)


def main() -> int:
    if not CBE.is_file():
        print("not found", CBE)
        return 1
    d = CBE.read_bytes()
    if d[:2] != b"MZ":
        return 1
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    if d[ne : ne + 2] != b"NE":
        return 1

    imptab_base = ne + struct.unpack_from("<H", d, ne + 0x2A)[0]
    modref = ne + struct.unpack_from("<H", d, ne + 0x28)[0]
    modc = struct.unpack_from("<H", d, ne + 0x1E)[0]
    mods: list[tuple[int, str]] = []
    for i in range(modc):
        w = struct.unpack_from("<H", d, modref + 2 * i)[0]
        p = imptab_base + w
        ln = d[p]
        name = d[p + 1 : p + 1 + ln].decode("ascii", errors="replace")
        mods.append((i + 1, name))

    segs = read_ne_segments(d, ne)
    hits: list[dict] = []
    for i, s in enumerate(segs):
        fo, act = s["file_start"], s["raw_len"]
        if fo == 0:
            continue
        end = fo + act
        nfo = next_file_offset_after(segs, i)
        if nfo == 0 or nfo <= end:
            continue
        gap = d[end:nfo]
        if len(gap) < 10:
            continue
        count = struct.unpack_from("<H", gap, 0)[0]
        if count == 0 or 2 + count * 8 > len(gap):
            continue
        pos = 2
        for r in range(count):
            if pos + 8 > len(gap):
                break
            addr_t, rel_t, off, t1, t2 = struct.unpack_from("<BBHHH", gap, pos)
            rt = rel_t & 3
            if t1 in (4, 5) and rt in (NE_RELTYPE_ORDINAL, NE_RELTYPE_NAME):
                if rt == NE_RELTYPE_ORDINAL:
                    sym, imp_off, ord_ = f"ord_{t2}", None, t2
                else:
                    ps = pascal_name(d, imptab_base, t2)
                    sym, imp_off, ord_ = ps, t2, None
                    if not is_plausible_name(ps):
                        pos += 8
                        continue
                modname = mods[t1 - 1][1] if 0 < t1 <= len(mods) else "?"
                hits.append(
                    {
                        "segment": s["index"],
                        "file_segment_start": fo,
                        "in_seg_offset": off,
                        "file_offset_data_ref": fo + off,
                        "addr_type": addr_t,
                        "relocation_type_low2": rt,
                        "addr_type_name": "POINTER32" if addr_t == NE_RADDR_POINTER32 else str(addr_t),
                        "module_index": t1,
                        "module": modname,
                        "symbol": sym,
                        "import_name_table_offset": imp_off,
                        "ordinal": ord_,
                    }
                )
            pos += 8

    doc = {
        "_meta": {
            "cbe": str(CBE),
            "ne_offset": ne,
            "imptab_file_base": imptab_base,
            "module_ref_table_1based": {str(k): v for k, v in mods},
            "parser": "u16 count @ segment_end, then 8 * count (Wine relocation_entry_s)",
            "note": "addr_type=3 は POINTER32（スロットに far Ptr）。Ghidra では当該 file_offset を表示アドレスにする。",
        },
        "iteml_items_imports": hits,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", OUT, "n=", len(hits))
    for h in hits:
        print(
            f"  seg{h['segment']}+{h['in_seg_offset']:#x} file={h['file_offset_data_ref']:#x} {h['module']}!{h['symbol']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
