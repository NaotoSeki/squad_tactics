# -*- coding: utf-8 -*-
"""
ITEML.DLL / ITEMS.DLL の NE セグメントリロケーションレコードを解析し、
エクスポート関数内の fixup ターゲットを特定。
さらに、自動データセグメント (DGROUP) から far pointer テーブルの位置を推定する。

Phase 1 追加解析

  python scripts\\analyze_iteml_fixups_and_tables.py
  -> scripts/pl_decoded/iteml_items_fixups_and_tables.json
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

PL = Path("D:/PL")
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "scripts" / "pl_decoded"
OUT = OUT_DIR / "iteml_items_fixups_and_tables.json"


def parse_ne_header(d: bytes, ne: int) -> dict:
    return {
        "ne_offset": ne,
        "entry_table_off": struct.unpack_from("<H", d, ne + 0x04)[0],
        "n_segments": struct.unpack_from("<H", d, ne + 0x1C)[0],
        "seg_table_off": struct.unpack_from("<H", d, ne + 0x22)[0],
        "sector_align_shift": struct.unpack_from("<H", d, ne + 0x32)[0],
        "auto_data_seg": struct.unpack_from("<H", d, ne + 0x0E)[0],
    }


def parse_segments(d: bytes, ne: int, hdr: dict) -> list[dict]:
    align = 1 << hdr["sector_align_shift"]
    n = hdr["n_segments"]
    base = ne + hdr["seg_table_off"]
    segs = []
    for i in range(n):
        o = base + 8 * i
        raw_sector, length, flags, min_alloc = struct.unpack_from("<HHHH", d, o)
        file_offset = raw_sector * align
        actual_len = 65536 if length == 0 else length
        segs.append({
            "seg_num": i + 1,
            "file_offset": file_offset,
            "length": actual_len,
            "flags": flags,
            "is_code": (flags & 1) == 0,
        })
    return segs


def parse_segment_relocations(d: bytes, seg: dict) -> list[dict]:
    """Parse NE relocation records at the end of a segment's file data."""
    seg_end = seg["file_offset"] + seg["length"]
    if seg_end + 2 > len(d):
        return []
    n_relocs = struct.unpack_from("<H", d, seg_end)[0]
    relocs = []
    p = seg_end + 2
    for _ in range(n_relocs):
        if p + 8 > len(d):
            break
        addr_type = d[p]
        reloc_type = d[p + 1]
        offset = struct.unpack_from("<H", d, p + 2)[0]
        w3 = struct.unpack_from("<H", d, p + 4)[0]
        w4 = struct.unpack_from("<H", d, p + 6)[0]

        rec = {
            "addr_type": addr_type,
            "reloc_type": reloc_type & 0x03,
            "additive": bool(reloc_type & 0x04),
            "offset_in_seg": offset,
            "offset_hex": f"0x{offset:04X}",
            "file_offset": seg["file_offset"] + offset,
            "file_offset_hex": f"0x{seg['file_offset'] + offset:X}",
        }

        reloc_kind = reloc_type & 0x03
        if reloc_kind == 0:
            rec["kind"] = "INTERNALREF"
            seg_ref = d[p + 4]
            if seg_ref == 0xFF:
                rec["target"] = "moveable_entry"
                rec["entry_ordinal"] = w4
            else:
                rec["target"] = "fixed"
                rec["target_seg"] = seg_ref
                rec["target_offset"] = w4
                rec["target_offset_hex"] = f"0x{w4:04X}"
        elif reloc_kind == 1:
            rec["kind"] = "IMPORTORDINAL"
            rec["module_ref_index"] = w3
            rec["ordinal"] = w4
        elif reloc_kind == 2:
            rec["kind"] = "IMPORTNAME"
            rec["module_ref_index"] = w3
            rec["name_table_offset"] = w4
        elif reloc_kind == 3:
            rec["kind"] = "OSFIXUP"
            rec["fixup_type"] = w3

        relocs.append(rec)
        p += 8

    return relocs


def analyze_dll(dll_path: Path) -> dict:
    d = dll_path.read_bytes()
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    if d[ne:ne + 2] != b"NE":
        return {"error": "not NE"}

    hdr = parse_ne_header(d, ne)
    segs = parse_segments(d, ne, hdr)

    code_seg = next((s for s in segs if s["seg_num"] == 1), None)
    if not code_seg:
        return {"error": "no segment 1"}

    relocs = parse_segment_relocations(d, code_seg)

    auto_ds_num = hdr["auto_data_seg"]
    auto_ds_seg = next((s for s in segs if s["seg_num"] == auto_ds_num), None)

    ds_dump = None
    ds_analysis = {}
    if auto_ds_seg:
        ds_start = auto_ds_seg["file_offset"]
        ds_len = auto_ds_seg["length"]
        ds_data = d[ds_start:ds_start + ds_len]
        ds_dump = {
            "seg_num": auto_ds_num,
            "file_offset": ds_start,
            "file_offset_hex": f"0x{ds_start:X}",
            "length": ds_len,
        }

        interesting_offsets = {}
        dll_name = dll_path.stem.upper()
        if dll_name == "ITEML":
            interesting_offsets = {
                "0x718": "ES loader for _DLLGET_ITEMLCG_PTR",
                "0x6A4": "WEP flag byte",
            }
        elif dll_name == "ITEMS":
            interesting_offsets = {
                "0x90": "ES loader for _DLLGET_ITEMSCG_PTR",
                "0x1C": "WEP flag byte",
            }

        for off_hex, desc in interesting_offsets.items():
            off = int(off_hex, 16)
            if off + 4 <= ds_len:
                w = struct.unpack_from("<H", ds_data, off)[0]
                dw = struct.unpack_from("<I", ds_data, off)[0]
                ctx = ds_data[max(0, off - 8):off + 16].hex()
                ds_analysis[off_hex] = {
                    "description": desc,
                    "value_u16": w,
                    "value_u16_hex": f"0x{w:04X}",
                    "value_u32": dw,
                    "value_u32_hex": f"0x{dw:08X}",
                    "context_hex": ctx,
                    "note": "ロード前は未解決（ランタイムでセグメントセレクタが書き込まれる）",
                }

    internal_fixups = [r for r in relocs if r.get("kind") == "INTERNALREF"]
    seg_refs_in_code = {}
    for r in internal_fixups:
        if r.get("target") == "fixed":
            t = r["target_seg"]
            key = f"seg{t}"
            if key not in seg_refs_in_code:
                seg_refs_in_code[key] = []
            seg_refs_in_code[key].append({
                "at_offset_hex": r["offset_hex"],
                "file_offset_hex": r["file_offset_hex"],
                "target_offset_hex": r.get("target_offset_hex", "?"),
                "addr_type": r["addr_type"],
            })

    pal_fixup = None
    for r in internal_fixups:
        if r.get("target") == "fixed" and r["offset_in_seg"] in range(0x07D0, 0x07E2):
            pal_fixup = r

    return {
        "file": str(dll_path),
        "ne_header": hdr,
        "auto_data_segment": ds_dump,
        "ds_interesting_offsets": ds_analysis,
        "seg1_relocations_total": len(relocs),
        "seg1_relocations": relocs,
        "seg1_internal_fixups_by_target": seg_refs_in_code,
        "palette_fixup_candidate": pal_fixup,
        "segments_summary": [
            {
                "seg_num": s["seg_num"],
                "file_offset_hex": f"0x{s['file_offset']:X}",
                "length": s["length"],
                "is_code": s["is_code"],
            }
            for s in segs
        ],
    }


def find_far_pointer_table(d: bytes, seg: dict, table_offset: int,
                           max_entries: int = 256) -> list[dict]:
    """Read a table of far pointers (offset:segment pairs) from a segment."""
    seg_start = seg["file_offset"]
    seg_data = d[seg_start:seg_start + seg["length"]]

    entries = []
    for i in range(max_entries):
        off = table_offset + i * 4
        if off + 4 > len(seg_data):
            break
        ptr_off = struct.unpack_from("<H", seg_data, off)[0]
        ptr_seg = struct.unpack_from("<H", seg_data, off + 2)[0]
        if ptr_off == 0 and ptr_seg == 0 and i > 0:
            null_run = True
            for j in range(min(4, max_entries - i)):
                check = table_offset + (i + j) * 4
                if check + 4 <= len(seg_data):
                    if struct.unpack_from("<I", seg_data, check)[0] != 0:
                        null_run = False
                        break
            if null_run:
                break
        entries.append({
            "index": i,
            "offset": ptr_off,
            "segment": ptr_seg,
            "offset_hex": f"0x{ptr_off:04X}",
            "segment_hex": f"0x{ptr_seg:04X}",
            "raw_hex": seg_data[off:off + 4].hex(),
        })

    return entries


def analyze_dgroup_relocs(d: bytes, ne: int, hdr: dict, segs: list[dict]) -> list[dict]:
    """Parse relocations for the auto data segment to find segment selector stores."""
    auto_ds_num = hdr["auto_data_seg"]
    auto_ds_seg = next((s for s in segs if s["seg_num"] == auto_ds_num), None)
    if not auto_ds_seg:
        return []
    return parse_segment_relocations(d, auto_ds_seg)


def main() -> int:
    results = {}

    for dll_name in ("ITEML.DLL", "ITEMS.DLL"):
        path = PL / dll_name
        if not path.is_file():
            results[dll_name] = {"error": "file not found"}
            continue

        print(f"\n{'='*60}")
        print(f"Analyzing {dll_name}")
        print(f"{'='*60}")

        info = analyze_dll(path)
        results[dll_name] = info

        if "error" in info:
            print(f"  ERROR: {info['error']}")
            continue

        print(f"  Auto data segment: {info['ne_header']['auto_data_seg']}")
        print(f"  Seg1 relocations: {info['seg1_relocations_total']}")

        if info.get("palette_fixup_candidate"):
            pf = info["palette_fixup_candidate"]
            print(f"\n  ** PALETTE FIXUP at 0x{pf['offset_in_seg']:04X}:")
            print(f"     kind={pf['kind']}, target_seg={pf.get('target_seg')}, "
                  f"target_offset={pf.get('target_offset_hex')}")

        for k, v in info.get("seg1_internal_fixups_by_target", {}).items():
            print(f"\n  Internal refs to {k}: {len(v)} fixups")
            for r in v[:5]:
                print(f"    at {r['at_offset_hex']} → target off {r['target_offset_hex']}")

        d = path.read_bytes()
        ne = struct.unpack_from("<I", d, 0x3C)[0]
        hdr = info["ne_header"]
        segs_list = parse_segments(d, ne, hdr)

        auto_ds_num = hdr["auto_data_seg"]
        auto_ds = next((s for s in segs_list if s["seg_num"] == auto_ds_num), None)
        if auto_ds:
            ds_relocs = analyze_dgroup_relocs(d, ne, hdr, segs_list)
            seg_selector_stores = [
                r for r in ds_relocs
                if r.get("kind") == "INTERNALREF" and r.get("target") == "fixed"
                and r["addr_type"] == 2
            ]
            print(f"\n  DGROUP relocs total: {len(ds_relocs)}")
            print(f"  DGROUP segment-selector stores (addr_type=2): {len(seg_selector_stores)}")

            stem = dll_name.split(".")[0]
            target_ds_offsets = {
                "ITEML": [0x718],
                "ITEMS": [0x90],
            }.get(stem, [])

            for toff in target_ds_offsets:
                matches = [
                    r for r in seg_selector_stores
                    if r["offset_in_seg"] == toff
                ]
                if matches:
                    for m in matches:
                        print(f"\n  *** DS:0x{toff:04X} fixup FOUND: "
                              f"target seg {m.get('target_seg')}, "
                              f"target_offset {m.get('target_offset_hex')}")
                        info[f"ds_0x{toff:04X}_resolved"] = m
                else:
                    for r in seg_selector_stores:
                        if abs(r["offset_in_seg"] - toff) <= 8:
                            print(f"  (nearby DS fixup at 0x{r['offset_in_seg']:04X} → "
                                  f"seg {r.get('target_seg')})")

            info["dgroup_segment_selector_fixups"] = [
                {
                    "offset_in_ds_hex": f"0x{r['offset_in_seg']:04X}",
                    "target_seg": r.get("target_seg"),
                    "target_offset_hex": r.get("target_offset_hex", "?"),
                    "addr_type": r["addr_type"],
                }
                for r in seg_selector_stores
            ]

            internal_seg1_refs = [
                r for r in info["seg1_relocations"]
                if r.get("kind") == "INTERNALREF" and r.get("target") == "fixed"
            ]
            for r in internal_seg1_refs:
                off = r["offset_in_seg"]
                if 0x07D0 <= off <= 0x07E1:
                    target_seg_num = r["target_seg"]
                    target_seg = next(
                        (s for s in segs_list if s["seg_num"] == target_seg_num), None
                    )
                    print(f"\n  *** PALETTE seg1 fixup at 0x{off:04X}: "
                          f"→ seg{target_seg_num}")
                    if target_seg:
                        print(f"      seg{target_seg_num} file_offset=0x{target_seg['file_offset']:X}, "
                              f"length={target_seg['length']}")
                    info["palette_segment_resolved"] = {
                        "fixup_at": f"0x{off:04X}",
                        "target_seg_num": target_seg_num,
                        "target_seg_file_offset": f"0x{target_seg['file_offset']:X}" if target_seg else "?",
                        "target_seg_length": target_seg["length"] if target_seg else "?",
                    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    def make_serializable(obj):
        if isinstance(obj, dict):
            return {k: make_serializable(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [make_serializable(v) for v in obj]
        if isinstance(obj, bytes):
            return obj.hex()
        return obj

    OUT.write_text(
        json.dumps(make_serializable(results), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nWROTE {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
