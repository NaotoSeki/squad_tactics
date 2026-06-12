# -*- coding: utf-8 -*-
"""
NE リロケーションチェーンを正しく歩いて、
ITEML.DLL / ITEMS.DLL の CG far pointer テーブルを
ファイルオフセットまで完全解決する。

NE fixup chain: 各リロケーションレコードの offset_in_seg は
チェーンの先頭を指す。その位置の u16 値が次のリンク先。
0xFFFF（または自己参照）で終端。ローダーがチェーンを歩き、
各位置に実際のセグメントセレクタを書き込む。

  python scripts\\resolve_cg_tables_chained.py
  -> scripts/pl_decoded/iteml_cg_resolved.json
  -> scripts/pl_decoded/items_cg_resolved.json
  -> scripts/pl_decoded/iteml_palette_data.json
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
        raw, length, flags, _ = struct.unpack_from("<HHHH", d, o)
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
        relocs.append({
            "addr_type": addr_type,
            "reloc_kind": reloc_type & 0x03,
            "additive": bool(reloc_type & 0x04),
            "offset_in_seg": offset,
            "target_seg": d[p + 4] if (reloc_type & 0x03) == 0 and d[p + 4] != 0xFF else None,
            "target_offset": struct.unpack_from("<H", d, p + 6)[0],
            "raw": d[p:p + 8].hex(),
        })
        p += 8
    return relocs


def walk_reloc_chain(seg_data: bytes, start_offset: int, max_links: int = 2000) -> list[int]:
    """Walk an NE relocation chain starting at start_offset.
    Each link is a u16 at the given offset pointing to the next link.
    Chain terminates at 0xFFFF or self-reference or out of bounds.
    Returns list of offsets that should be patched.
    """
    offsets = []
    seen = set()
    cur = start_offset
    for _ in range(max_links):
        if cur in seen or cur >= len(seg_data) - 1 or cur == 0xFFFF:
            break
        seen.add(cur)
        offsets.append(cur)
        next_link = struct.unpack_from("<H", seg_data, cur)[0]
        if next_link == 0xFFFF or next_link == cur:
            break
        cur = next_link
    return offsets


def resolve_segment_selectors(d: bytes, seg: dict, segs: list[dict]) -> dict[int, int]:
    """For each offset in the segment where a selector fixup applies,
    return the target segment number."""
    seg_data = d[seg["file_offset"]:seg["file_offset"] + seg["length"]]
    relocs = get_seg_relocs(d, seg)

    offset_to_seg: dict[int, int] = {}
    for r in relocs:
        if r["reloc_kind"] != 0 or r["addr_type"] != 2 or r["target_seg"] is None:
            continue
        chain = walk_reloc_chain(seg_data, r["offset_in_seg"])
        for off in chain:
            offset_to_seg[off] = r["target_seg"]

    return offset_to_seg


def resolve_far_ptr_table(seg_data: bytes, table_start: int,
                          offset_to_seg: dict[int, int],
                          segs: list[dict],
                          max_entries: int = 600) -> list[dict]:
    entries = []
    for i in range(max_entries):
        off = table_start + i * 4
        if off + 4 > len(seg_data):
            break
        ptr_off = struct.unpack_from("<H", seg_data, off)[0]
        seg_selector_offset = off + 2
        target_seg_num = offset_to_seg.get(seg_selector_offset)

        if target_seg_num is None and ptr_off == 0:
            raw4 = struct.unpack_from("<I", seg_data, off)[0]
            if raw4 == 0:
                look_ahead_null = True
                for j in range(1, 4):
                    check = off + j * 4
                    if check + 4 <= len(seg_data):
                        if struct.unpack_from("<I", seg_data, check)[0] != 0:
                            look_ahead_null = False
                            break
                if look_ahead_null:
                    break

        file_offset_cg = None
        seg_file_off = None
        seg_length = None
        if target_seg_num is not None:
            target = next((s for s in segs if s["seg_num"] == target_seg_num), None)
            if target:
                file_offset_cg = target["file_offset"] + ptr_off
                seg_file_off = target["file_offset"]
                seg_length = target["length"]

        entries.append({
            "index": i,
            "ptr_offset": ptr_off,
            "ptr_offset_hex": f"0x{ptr_off:04X}",
            "target_seg": target_seg_num,
            "file_offset_cg": file_offset_cg,
            "file_offset_cg_hex": f"0x{file_offset_cg:X}" if file_offset_cg else None,
            "seg_file_offset": seg_file_off,
            "seg_length": seg_length,
        })

    return entries


def analyze_palette(dg_data: bytes, dgroup_file_off: int) -> dict:
    """Extract palette at DGROUP:0x10."""
    pal_off = 0x10
    pal_data = dg_data[pal_off:pal_off + 1024]

    non_zero = 0
    for i in range(len(pal_data)):
        if pal_data[i] != 0:
            non_zero = i + 1
    n_colors = (non_zero + 3) // 4

    colors_rgb = []
    for i in range(min(n_colors, 256)):
        base = i * 4
        if base + 3 > len(pal_data):
            break
        r, g, b, x = pal_data[base], pal_data[base + 1], pal_data[base + 2], pal_data[base + 3]
        colors_rgb.append({
            "index": i,
            "r": r, "g": g, "b": b, "x": x,
            "hex": f"#{r:02X}{g:02X}{b:02X}",
        })

    is_vga_style = all(c["r"] <= 63 and c["g"] <= 63 and c["b"] <= 63 for c in colors_rgb if c["index"] > 0)
    max_component = max(
        max(c["r"], c["g"], c["b"]) for c in colors_rgb if c["index"] > 0
    ) if colors_rgb else 0

    return {
        "offset_in_dgroup": pal_off,
        "file_offset": dgroup_file_off + pal_off,
        "file_offset_hex": f"0x{dgroup_file_off + pal_off:X}",
        "n_colors": len(colors_rgb),
        "non_zero_bytes": non_zero,
        "is_vga_6bit": is_vga_style,
        "max_component_value": max_component,
        "note": "VGA 6-bit (0-63)" if is_vga_style else f"8-bit or scaled (max={max_component})",
        "colors": colors_rgb,
    }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── ITEML.DLL ─────────────────────────────────────────────
    iteml_path = PL / "ITEML.DLL"
    d = iteml_path.read_bytes()
    hdr, segs = parse_ne_basics(d)
    dg_num = hdr["auto_data_seg"]
    dgroup = next(s for s in segs if s["seg_num"] == dg_num)
    dg_data = d[dgroup["file_offset"]:dgroup["file_offset"] + dgroup["length"]]

    print(f"ITEML.DLL: DGROUP=seg{dg_num}, file_off=0x{dgroup['file_offset']:X}, len={dgroup['length']}")

    offset_to_seg = resolve_segment_selectors(d, dgroup, segs)
    print(f"  Resolved selector offsets in DGROUP: {len(offset_to_seg)}")

    cg_table_off = 0x68
    cg_entries = resolve_far_ptr_table(dg_data, cg_table_off, offset_to_seg, segs)
    resolved = [e for e in cg_entries if e["target_seg"] is not None]
    print(f"  CG table entries: {len(cg_entries)}, resolved: {len(resolved)}")

    seg_set = sorted(set(e["target_seg"] for e in resolved))
    print(f"  Target segments: {seg_set}")

    for e in resolved[:10]:
        print(f"    [{e['index']:3d}] off={e['ptr_offset_hex']} seg{e['target_seg']:2d} "
              f"→ file {e['file_offset_cg_hex']}")

    pal = analyze_palette(dg_data, dgroup["file_offset"])
    print(f"\n  Palette: {pal['n_colors']} colors, {pal['note']}")
    print(f"    First 4 colors: ", end="")
    for c in pal["colors"][:4]:
        print(f"  {c['hex']}(r={c['r']},g={c['g']},b={c['b']},x={c['x']})", end="")
    print()

    iteml_result = {
        "dll": "ITEML.DLL",
        "dgroup_seg": dg_num,
        "cg_table_offset": f"0x{cg_table_off:04X}",
        "cg_table_desc": "DGROUP:0x68, far pointer array, index = arg to _DLLGET_ITEMLCG_PTR",
        "total_entries": len(cg_entries),
        "resolved_entries": len(resolved),
        "target_segments": seg_set,
        "palette": pal,
        "entries": cg_entries,
    }

    (OUT_DIR / "iteml_cg_resolved.json").write_text(
        json.dumps(iteml_result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  WROTE iteml_cg_resolved.json")

    (OUT_DIR / "iteml_palette_data.json").write_text(
        json.dumps(pal, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  WROTE iteml_palette_data.json")

    # ── ITEMS.DLL ─────────────────────────────────────────────
    items_path = PL / "ITEMS.DLL"
    d2 = items_path.read_bytes()
    hdr2, segs2 = parse_ne_basics(d2)
    seg2 = next(s for s in segs2 if s["seg_num"] == 2)
    seg2_data = d2[seg2["file_offset"]:seg2["file_offset"] + seg2["length"]]

    print(f"\nITEMS.DLL: lookup table=seg2, file_off=0x{seg2['file_offset']:X}, len={seg2['length']}")

    offset_to_seg2 = resolve_segment_selectors(d2, seg2, segs2)
    print(f"  Resolved selector offsets in seg2: {len(offset_to_seg2)}")

    cg_entries2 = resolve_far_ptr_table(seg2_data, 0, offset_to_seg2, segs2)
    resolved2 = [e for e in cg_entries2 if e["target_seg"] is not None]
    print(f"  CG table entries: {len(cg_entries2)}, resolved: {len(resolved2)}")

    seg_set2 = sorted(set(e["target_seg"] for e in resolved2))
    print(f"  Target segments: {seg_set2}")

    for e in resolved2[:10]:
        print(f"    [{e['index']:3d}] off={e['ptr_offset_hex']} seg{e['target_seg']:2d} "
              f"→ file {e['file_offset_cg_hex']}")

    items_result = {
        "dll": "ITEMS.DLL",
        "table_seg": 2,
        "cg_table_offset": "0x0000",
        "cg_table_desc": "seg2:0x00, far pointer array, index = arg to _DLLGET_ITEMSCG_PTR",
        "total_entries": len(cg_entries2),
        "resolved_entries": len(resolved2),
        "target_segments": seg_set2,
        "entries": cg_entries2,
    }

    (OUT_DIR / "items_cg_resolved.json").write_text(
        json.dumps(items_result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  WROTE items_cg_resolved.json")

    # ── Summary ───────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"Summary:")
    print(f"  ITEML (list CG): {len(resolved)} items across segs {seg_set}")
    print(f"  ITEMS (large CG): {len(resolved2)} items across segs {seg_set2}")
    print(f"  Palette: {pal['n_colors']} colors at file 0x{dgroup['file_offset'] + 0x10:X}")
    if pal["is_vga_6bit"]:
        print(f"  Palette format: VGA 6-bit (values 0-63, multiply by 4 for 8-bit RGB)")
    else:
        print(f"  Palette format: 8-bit RGB (max component = {pal['max_component_value']})")
    print(f"{'='*60}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
