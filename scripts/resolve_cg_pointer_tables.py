# -*- coding: utf-8 -*-
"""
ITEML.DLL / ITEMS.DLL の far pointer テーブルを読み、
DGROUP リロケーションレコードからセグメントセレクタを解決し、
各アイテムインデックスの CG データのファイルオフセットを確定する。

Phase 1 — CG/パレット位置の最終確定

  python scripts\\resolve_cg_pointer_tables.py
  -> scripts/pl_decoded/iteml_cg_pointer_table.json
  -> scripts/pl_decoded/items_cg_pointer_table.json
  -> scripts/pl_decoded/iteml_palette_dump.bin   (raw palette)
  -> scripts/pl_decoded/iteml_palette_info.json
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

PL = Path("D:/PL")
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "scripts" / "pl_decoded"


def parse_ne_basics(d: bytes):
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    hdr = {
        "ne": ne,
        "n_segments": struct.unpack_from("<H", d, ne + 0x1C)[0],
        "seg_table_off": struct.unpack_from("<H", d, ne + 0x22)[0],
        "sector_align_shift": struct.unpack_from("<H", d, ne + 0x32)[0],
        "auto_data_seg": struct.unpack_from("<H", d, ne + 0x0E)[0],
    }
    align = 1 << hdr["sector_align_shift"]
    segs = []
    base = ne + hdr["seg_table_off"]
    for i in range(hdr["n_segments"]):
        o = base + 8 * i
        raw, length, flags, min_alloc = struct.unpack_from("<HHHH", d, o)
        segs.append({
            "seg_num": i + 1,
            "file_offset": raw * align,
            "length": 65536 if length == 0 else length,
            "flags": flags,
        })
    return hdr, segs


def get_seg_relocs(d: bytes, seg: dict) -> list[dict]:
    seg_end = seg["file_offset"] + seg["length"]
    if seg_end + 2 > len(d):
        return []
    n = struct.unpack_from("<H", d, seg_end)[0]
    relocs = []
    p = seg_end + 2
    for _ in range(n):
        if p + 8 > len(d):
            break
        addr_type = d[p]
        reloc_type = d[p + 1]
        offset = struct.unpack_from("<H", d, p + 2)[0]
        w3 = struct.unpack_from("<H", d, p + 4)[0]
        w4 = struct.unpack_from("<H", d, p + 6)[0]
        kind = reloc_type & 0x03
        rec = {
            "addr_type": addr_type,
            "reloc_kind": kind,
            "offset_in_seg": offset,
            "w3": w3,
            "w4": w4,
        }
        if kind == 0:
            seg_ref = d[p + 4]
            rec["target_seg"] = seg_ref if seg_ref != 0xFF else None
            rec["target_offset"] = w4
        relocs.append(rec)
        p += 8
    return relocs


def build_dgroup_selector_map(d: bytes, dgroup_seg: dict) -> dict[int, int]:
    """Build a map: offset_in_dgroup → target_segment_number for selector fixups."""
    relocs = get_seg_relocs(d, dgroup_seg)
    sel_map = {}
    for r in relocs:
        if r["reloc_kind"] == 0 and r["addr_type"] == 2 and r.get("target_seg") is not None:
            sel_map[r["offset_in_seg"]] = r["target_seg"]
    return sel_map


def build_seg1_selector_map(d: bytes, seg1: dict) -> dict[int, int]:
    """Build map: offset_in_seg1 → target_segment_number for internal segment refs."""
    relocs = get_seg_relocs(d, seg1)
    sel_map = {}
    for r in relocs:
        if r["reloc_kind"] == 0 and r.get("target_seg") is not None:
            sel_map[r["offset_in_seg"]] = r["target_seg"]
    return sel_map


def read_far_ptr_table(seg_data: bytes, table_offset: int,
                       seg_selector_map: dict[int, int],
                       seg_file_base: int,
                       segs: list[dict],
                       max_entries: int = 512) -> list[dict]:
    """Read far pointer table entries, resolving segment selectors via fixup map."""
    entries = []
    consecutive_null = 0
    for i in range(max_entries):
        off = table_offset + i * 4
        if off + 4 > len(seg_data):
            break
        ptr_off = struct.unpack_from("<H", seg_data, off)[0]
        ptr_seg_raw = struct.unpack_from("<H", seg_data, off + 2)[0]

        abs_fixup_off = off + 2
        resolved_seg = seg_selector_map.get(abs_fixup_off)

        if ptr_off == 0 and ptr_seg_raw == 0 and resolved_seg is None:
            consecutive_null += 1
            if consecutive_null >= 3:
                break
            entries.append({
                "index": i,
                "ptr_offset": 0,
                "ptr_seg_raw": 0,
                "resolved_seg": None,
                "file_offset_cg": None,
                "null": True,
            })
            continue

        consecutive_null = 0

        file_offset_cg = None
        seg_length = None
        if resolved_seg is not None:
            target = next((s for s in segs if s["seg_num"] == resolved_seg), None)
            if target:
                file_offset_cg = target["file_offset"] + ptr_off
                seg_length = target["length"]

        entries.append({
            "index": i,
            "ptr_offset": ptr_off,
            "ptr_offset_hex": f"0x{ptr_off:04X}",
            "ptr_seg_raw": ptr_seg_raw,
            "ptr_seg_raw_hex": f"0x{ptr_seg_raw:04X}",
            "resolved_seg": resolved_seg,
            "file_offset_cg": file_offset_cg,
            "file_offset_cg_hex": f"0x{file_offset_cg:X}" if file_offset_cg else None,
            "seg_length": seg_length,
            "null": False,
        })

    return entries


def analyze_iteml(d: bytes, hdr: dict, segs: list[dict]) -> dict:
    dgroup_num = hdr["auto_data_seg"]
    dgroup = next(s for s in segs if s["seg_num"] == dgroup_num)
    dg_data = d[dgroup["file_offset"]:dgroup["file_offset"] + dgroup["length"]]

    dg_sel_map = build_dgroup_selector_map(d, dgroup)

    print(f"  DGROUP (seg{dgroup_num}): file_off=0x{dgroup['file_offset']:X}, len={dgroup['length']}")
    print(f"  Selector fixups in DGROUP: {len(dg_sel_map)}")

    palette_offset = 0x10
    palette_size = min(256 * 4, dgroup["length"] - palette_offset)
    palette_raw = dg_data[palette_offset:palette_offset + palette_size]

    non_zero_end = palette_size
    while non_zero_end > 0 and palette_raw[non_zero_end - 1] == 0:
        non_zero_end -= 1
    non_zero_end = ((non_zero_end + 3) // 4) * 4

    n_colors_candidate = non_zero_end // 4 if non_zero_end > 0 else 0

    pal_info = {
        "dgroup_seg": dgroup_num,
        "offset_in_dgroup": palette_offset,
        "offset_hex": f"0x{palette_offset:04X}",
        "file_offset": dgroup["file_offset"] + palette_offset,
        "file_offset_hex": f"0x{dgroup['file_offset'] + palette_offset:X}",
        "raw_size_read": palette_size,
        "non_zero_bytes": non_zero_end,
        "likely_n_colors": n_colors_candidate,
        "first_64_bytes_hex": palette_raw[:64].hex(),
    }

    pal_path = OUT_DIR / "iteml_palette_dump.bin"
    pal_path.write_bytes(palette_raw[:non_zero_end] if non_zero_end > 0 else palette_raw[:256])

    table_offset = 0x68
    print(f"\n  CG pointer table at DGROUP:0x{table_offset:04X}")
    cg_entries = read_far_ptr_table(dg_data, table_offset, dg_sel_map,
                                     dgroup["file_offset"], segs)

    non_null = [e for e in cg_entries if not e.get("null")]
    print(f"  Total entries: {len(cg_entries)}, non-null: {len(non_null)}")
    for e in non_null[:5]:
        fo = e.get("file_offset_cg")
        fo_str = f"0x{fo:X}" if fo is not None else "unresolved"
        print(f"    [{e['index']:3d}] off={e.get('ptr_offset_hex','?')} "
              f"seg={e.get('resolved_seg','?')} → file {fo_str}")

    return {
        "palette": pal_info,
        "cg_table_offset_in_dgroup": f"0x{table_offset:04X}",
        "cg_entries": cg_entries,
        "dgroup_selector_map": {
            f"0x{k:04X}": v for k, v in sorted(dg_sel_map.items())
        },
    }


def analyze_items(d: bytes, hdr: dict, segs: list[dict]) -> dict:
    dgroup_num = hdr["auto_data_seg"]
    dgroup = next(s for s in segs if s["seg_num"] == dgroup_num)
    dg_sel_map = build_dgroup_selector_map(d, dgroup)

    seg2 = next(s for s in segs if s["seg_num"] == 2)
    seg2_data = d[seg2["file_offset"]:seg2["file_offset"] + seg2["length"]]

    seg2_relocs = get_seg_relocs(d, seg2)
    seg2_sel_map = {}
    for r in seg2_relocs:
        if r["reloc_kind"] == 0 and r["addr_type"] == 2 and r.get("target_seg") is not None:
            seg2_sel_map[r["offset_in_seg"]] = r["target_seg"]

    print(f"\n  Seg2 (lookup table): file_off=0x{seg2['file_offset']:X}, len={seg2['length']}")
    print(f"  Seg2 selector fixups: {len(seg2_sel_map)}")

    table_offset = 0x00
    cg_entries = read_far_ptr_table(seg2_data, table_offset, seg2_sel_map,
                                     seg2["file_offset"], segs)

    non_null = [e for e in cg_entries if not e.get("null")]
    print(f"  Total entries: {len(cg_entries)}, non-null: {len(non_null)}")
    for e in non_null[:5]:
        fo = e.get("file_offset_cg")
        fo_str = f"0x{fo:X}" if fo is not None else "unresolved"
        print(f"    [{e['index']:3d}] off={e.get('ptr_offset_hex','?')} "
              f"seg={e.get('resolved_seg','?')} → file {fo_str}")

    return {
        "table_seg": 2,
        "table_offset_in_seg2": f"0x{table_offset:04X}",
        "cg_entries": cg_entries,
        "seg2_selector_map": {
            f"0x{k:04X}": v for k, v in sorted(seg2_sel_map.items())
        },
    }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results = {}

    for dll_name, analyzer in [("ITEML.DLL", analyze_iteml), ("ITEMS.DLL", analyze_items)]:
        path = PL / dll_name
        if not path.is_file():
            continue
        d = path.read_bytes()
        ne = struct.unpack_from("<I", d, 0x3C)[0]
        hdr_raw = {
            "ne": ne,
            "n_segments": struct.unpack_from("<H", d, ne + 0x1C)[0],
            "seg_table_off": struct.unpack_from("<H", d, ne + 0x22)[0],
            "sector_align_shift": struct.unpack_from("<H", d, ne + 0x32)[0],
            "auto_data_seg": struct.unpack_from("<H", d, ne + 0x0E)[0],
        }
        align = 1 << hdr_raw["sector_align_shift"]
        segs = []
        base = ne + hdr_raw["seg_table_off"]
        for i in range(hdr_raw["n_segments"]):
            o = base + 8 * i
            raw, length, flags, min_alloc = struct.unpack_from("<HHHH", d, o)
            segs.append({
                "seg_num": i + 1,
                "file_offset": raw * align,
                "length": 65536 if length == 0 else length,
                "flags": flags,
            })

        print(f"\n{'='*60}")
        print(f"  {dll_name}")
        print(f"{'='*60}")

        result = analyzer(d, hdr_raw, segs)
        results[dll_name] = result

        out_name = dll_name.split(".")[0].lower()
        out_path = OUT_DIR / f"{out_name}_cg_pointer_table.json"
        out_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n  WROTE {out_path}")

    pal_info_path = OUT_DIR / "iteml_palette_info.json"
    if "ITEML.DLL" in results:
        pal_info_path.write_text(
            json.dumps(results["ITEML.DLL"]["palette"], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  WROTE {pal_info_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
