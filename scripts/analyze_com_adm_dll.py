"""
Deep analysis of COM.DLL and ADM.DLL from D:\\PL\\ (Platoon Leader, 1997 SEGA/TechnoBrain).
- Parses NE headers, segments, resources
- Extracts Shift-JIS and ASCII strings with quality filtering
- Detects structured data tables and numeric arrays
- Looks for palette data (ADM.DLL)
- Cross-references between DLLs
- Outputs JSON report
"""
import struct
import json
import os
import sys
import io
from pathlib import Path
from collections import Counter

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

NE_RT_NAMES = {
    0x8001: "RT_CURSOR",    0x8002: "RT_BITMAP",   0x8003: "RT_ICON",
    0x8004: "RT_MENU",      0x8005: "RT_DIALOG",   0x8006: "RT_STRING",
    0x8007: "RT_FONTDIR",   0x8008: "RT_FONT",     0x8009: "RT_ACCELERATOR",
    0x800A: "RT_RCDATA",    0x800C: "RT_GROUP_CURSOR",
    0x800E: "RT_GROUP_ICON", 0x8010: "RT_VERSION",
}

SEG_DATA   = 0x0001
SEG_LOADED = 0x0004
SEG_MOVEABLE = 0x0010
SEG_PRELOAD  = 0x0040
SEG_RELOCDATA = 0x0100
SEG_DISCARD   = 0x1000

# ── NE parsing ───────────────────────────────────────────────────────────────

def read_ne_string(data, offset):
    if offset < 0 or offset >= len(data):
        return ""
    length = data[offset]
    if length == 0:
        return ""
    end = min(offset + 1 + length, len(data))
    return data[offset + 1 : end].decode("ascii", errors="replace")


def parse_ne_full(filepath):
    with open(filepath, "rb") as f:
        data = f.read()

    info = {
        "file": os.path.basename(filepath),
        "size": len(data),
        "segments": [],
        "resources": [],
        "ne_header": {},
        "entry_points": [],
    }

    if data[:2] != b"MZ":
        info["error"] = "Not MZ"; return info, data

    ne_off = struct.unpack_from("<I", data, 0x3C)[0]
    if ne_off + 64 > len(data) or data[ne_off:ne_off+2] != b"NE":
        info["error"] = "Not NE format"; return info, data

    ne = data[ne_off:]
    entry_table_off = struct.unpack_from("<H", ne, 0x04)[0]
    entry_table_len = struct.unpack_from("<H", ne, 0x06)[0]
    flags = struct.unpack_from("<H", ne, 0x0C)[0]
    auto_data_seg = struct.unpack_from("<H", ne, 0x0E)[0]
    seg_count     = struct.unpack_from("<H", ne, 0x1C)[0]
    seg_table_off = struct.unpack_from("<H", ne, 0x22)[0]
    res_table_off = struct.unpack_from("<H", ne, 0x24)[0]
    rn_off        = struct.unpack_from("<H", ne, 0x26)[0]
    mod_ref_off   = struct.unpack_from("<H", ne, 0x28)[0]
    imp_name_off  = struct.unpack_from("<H", ne, 0x2A)[0]
    nonres_off    = struct.unpack_from("<I", ne, 0x2C)[0]
    nonres_size   = struct.unpack_from("<H", ne, 0x30)[0] if len(ne) > 0x31 else 0
    ne_align      = struct.unpack_from("<H", ne, 0x32)[0] if len(ne) > 0x33 else 4

    flag_names = []
    if flags & 0x8000: flag_names.append("DLL")
    if flags & 0x0001: flag_names.append("SINGLEDATA")
    if flags & 0x0002: flag_names.append("MULTIPLEDATA")

    rn_abs = ne_off + rn_off
    module_desc = read_ne_string(data, rn_abs) if rn_abs < len(data) else ""

    info["ne_header"] = {
        "ne_offset": f"0x{ne_off:X}",
        "flags": f"0x{flags:04X}",
        "flag_names": flag_names,
        "auto_data_segment": auto_data_seg,
        "segment_count": seg_count,
        "segment_alignment_shift": ne_align,
        "module_description": module_desc,
        "entry_table_offset": f"0x{ne_off + entry_table_off:X}",
        "entry_table_length": entry_table_len,
    }
    info["_ne_align"] = ne_align

    nonres_names = []
    if nonres_off > 0 and nonres_off < len(data):
        pos = nonres_off
        end_pos = min(nonres_off + nonres_size, len(data)) if nonres_size else len(data)
        while pos < end_pos:
            slen = data[pos]
            if slen == 0:
                break
            name = data[pos+1:pos+1+slen].decode("ascii", errors="replace")
            ordinal = struct.unpack_from("<H", data, pos+1+slen)[0] if pos+1+slen+2 <= len(data) else 0
            nonres_names.append({"name": name, "ordinal": ordinal})
            pos += 1 + slen + 2
    info["nonresident_names"] = nonres_names

    res_names = []
    pos = rn_abs
    while pos < len(data):
        slen = data[pos]
        if slen == 0:
            break
        name = data[pos+1:pos+1+slen].decode("ascii", errors="replace")
        ordinal = struct.unpack_from("<H", data, pos+1+slen)[0] if pos+1+slen+2 <= len(data) else 0
        res_names.append({"name": name, "ordinal": ordinal})
        pos += 1 + slen + 2
    info["resident_names"] = res_names

    imp_names = []
    imp_abs = ne_off + imp_name_off
    mod_abs = ne_off + mod_ref_off
    num_mod_refs = struct.unpack_from("<H", ne, 0x1E)[0]
    for i in range(num_mod_refs):
        ref_off = struct.unpack_from("<H", data, mod_abs + i * 2)[0]
        name = read_ne_string(data, ne_off + imp_name_off + ref_off)
        imp_names.append(name)
    info["imported_modules"] = imp_names

    seg_abs = ne_off + seg_table_off
    for i in range(seg_count):
        soff = seg_abs + i * 8
        if soff + 8 > len(data):
            break
        sector = struct.unpack_from("<H", data, soff)[0]
        seg_len = struct.unpack_from("<H", data, soff + 2)[0]
        seg_flags = struct.unpack_from("<H", data, soff + 4)[0]
        min_alloc = struct.unpack_from("<H", data, soff + 6)[0]

        is_data = bool(seg_flags & SEG_DATA)
        file_offset = sector << ne_align

        seg_info = {
            "index": i + 1,
            "sector": sector,
            "file_offset": f"0x{file_offset:X}",
            "file_offset_dec": file_offset,
            "raw_length": seg_len if seg_len > 0 else 65536,
            "flags": f"0x{seg_flags:04X}",
            "min_alloc": min_alloc if min_alloc > 0 else 65536,
            "type": "DATA" if is_data else "CODE",
            "moveable": bool(seg_flags & SEG_MOVEABLE),
            "preload": bool(seg_flags & SEG_PRELOAD),
            "has_reloc": bool(seg_flags & SEG_RELOCDATA),
        }
        info["segments"].append(seg_info)

    rt_abs = ne_off + res_table_off
    if rt_abs + 2 <= len(data):
        align_shift = struct.unpack_from("<H", data, rt_abs)[0]
        info["resource_align_shift"] = align_shift

    if res_table_off != rn_off:
        pos = rt_abs + 2
        while pos + 8 <= len(data):
            type_id = struct.unpack_from("<H", data, pos)[0]
            if type_id == 0:
                break
            count = struct.unpack_from("<H", data, pos + 2)[0]
            pos += 8

            if type_id & 0x8000:
                type_name = NE_RT_NAMES.get(type_id, f"UNKNOWN_0x{type_id:04X}")
            else:
                type_name = read_ne_string(data, rt_abs + type_id)

            entries = []
            for _ in range(count):
                if pos + 12 > len(data):
                    break
                r_off = struct.unpack_from("<H", data, pos)[0]
                r_len = struct.unpack_from("<H", data, pos + 2)[0]
                r_flags = struct.unpack_from("<H", data, pos + 4)[0]
                r_name = struct.unpack_from("<H", data, pos + 6)[0]
                pos += 12

                abs_off = r_off << align_shift
                abs_len = r_len << align_shift

                if r_name & 0x8000:
                    ename = f"#{r_name & 0x7FFF}"
                else:
                    ename = read_ne_string(data, rt_abs + r_name)

                entries.append({
                    "name": ename,
                    "offset": f"0x{abs_off:X}",
                    "offset_dec": abs_off,
                    "length": abs_len,
                })

            info["resources"].append({
                "type_id": f"0x{type_id:04X}",
                "type_name": type_name,
                "count": count,
                "entries": entries,
            })

    return info, data


# ── String extraction (improved quality) ──────────────────────────────────────

def is_sjis_lead(b):
    return (0x81 <= b <= 0x9F) or (0xE0 <= b <= 0xEF)

def is_sjis_trail(b):
    return (0x40 <= b <= 0x7E) or (0x80 <= b <= 0xFC)

def is_halfwidth_kana(b):
    return 0xA1 <= b <= 0xDF

def is_printable_ascii(b):
    return 0x20 <= b <= 0x7E


def string_quality_score(raw_bytes, has_sjis, from_code=False):
    """Rate string quality 0.0-1.0 to filter false positives from code bytes."""
    if len(raw_bytes) == 0:
        return 0.0

    try:
        text = bytes(raw_bytes).decode("cp932", errors="replace")
    except Exception:
        return 0.0

    replace_count = text.count('\ufffd')
    if replace_count > len(text) * 0.2:
        return 0.0

    printable = sum(1 for c in text if c.isprintable() or c in '\r\n\t')
    if printable < max(2, len(text) * 0.5):
        return 0.0

    score = 0.5

    ascii_upper = sum(1 for b in raw_bytes if 0x41 <= b <= 0x5A)
    ascii_lower = sum(1 for b in raw_bytes if 0x61 <= b <= 0x7A)
    ascii_digits = sum(1 for b in raw_bytes if 0x30 <= b <= 0x39)
    spaces = sum(1 for b in raw_bytes if b == 0x20)
    ascii_letters = ascii_upper + ascii_lower

    if from_code:
        # Penalize x86 instruction-like patterns:
        # PUSH/POP (0x50-0x5F), MOV (0x88-0x8B), etc. often look like
        # uppercase ASCII (P-Z, [, \, ], ^, _)
        x86_push_pop = sum(1 for b in raw_bytes if 0x50 <= b <= 0x5F)
        if x86_push_pop > len(raw_bytes) * 0.5:
            return 0.1

        # All uppercase with no spaces/lowercase = likely code bytes
        if ascii_upper > 0 and ascii_lower == 0 and spaces == 0 and not has_sjis:
            if len(raw_bytes) < 8:
                return 0.15
            if ascii_digits == 0:
                return 0.2

        # Short strings with halfwidth kana + uppercase = probably code bytes
        if has_sjis and len(raw_bytes) < 8:
            hk_count = sum(1 for b in raw_bytes if is_halfwidth_kana(b))
            if hk_count <= 2 and ascii_upper > hk_count:
                return 0.2

        # For Shift-JIS in code: require at least 3 full double-byte chars
        if has_sjis:
            sjis_full = 0
            i = 0
            while i < len(raw_bytes):
                b = raw_bytes[i]
                if is_sjis_lead(b) and i + 1 < len(raw_bytes) and is_sjis_trail(raw_bytes[i+1]):
                    sjis_full += 1
                    i += 2
                else:
                    i += 1
            if sjis_full < 3 and ascii_lower == 0 and spaces == 0:
                return 0.2
            if sjis_full >= 3:
                score += 0.3
        else:
            # For pure ASCII from code: need spaces or consecutive lowercase
            has_consec_lower = False
            consec = 0
            for b in raw_bytes:
                if 0x61 <= b <= 0x7A:
                    consec += 1
                    if consec >= 3:
                        has_consec_lower = True
                        break
                else:
                    consec = 0
            if spaces > 0 or has_consec_lower:
                score += 0.3
            elif ascii_lower > ascii_upper:
                score += 0.2
            elif ascii_digits > 0 and ascii_letters > 0:
                score += 0.1
    else:
        if has_sjis:
            sjis_chars = 0
            i = 0
            while i < len(raw_bytes):
                b = raw_bytes[i]
                if is_sjis_lead(b) and i + 1 < len(raw_bytes) and is_sjis_trail(raw_bytes[i+1]):
                    sjis_chars += 1
                    i += 2
                else:
                    i += 1
            if sjis_chars >= 2:
                score += 0.3
            elif sjis_chars >= 1:
                score += 0.1

    readable_ratio = (ascii_letters + ascii_digits + spaces) / len(raw_bytes) if not has_sjis else 0.5
    score += readable_ratio * 0.2

    if any(b in raw_bytes for b in [0x25]):
        score += 0.1

    return min(1.0, score)


def extract_strings(data, start, length, min_len=3, from_code=False):
    strings = []
    end = min(start + length, len(data))
    i = start
    current = bytearray()
    current_start = i
    has_sjis = False

    quality_threshold = 0.45 if from_code else 0.35
    effective_min_len = max(min_len, 4 if from_code else 3)

    def flush():
        nonlocal current, current_start, has_sjis
        if len(current) >= effective_min_len:
            score = string_quality_score(current, has_sjis, from_code=from_code)
            if score >= quality_threshold:
                try:
                    text = bytes(current).decode("cp932", errors="replace")
                except Exception:
                    text = bytes(current).decode("ascii", errors="replace")

                text_stripped = text.strip()
                if len(text_stripped) >= 2:
                    enc = "shift_jis" if has_sjis else "ascii"
                    strings.append({
                        "offset": f"0x{current_start:X}",
                        "offset_dec": current_start,
                        "text": text,
                        "raw_hex": bytes(current)[:64].hex(" "),
                        "encoding": enc,
                        "byte_length": len(current),
                        "quality": round(score, 2),
                    })
        current = bytearray()
        has_sjis = False

    while i < end:
        b = data[i]

        if is_sjis_lead(b) and i + 1 < end and is_sjis_trail(data[i + 1]):
            if not current:
                current_start = i
            current.append(b)
            current.append(data[i + 1])
            has_sjis = True
            i += 2
        elif is_halfwidth_kana(b):
            if not current:
                current_start = i
            current.append(b)
            has_sjis = True
            i += 1
        elif is_printable_ascii(b):
            if not current:
                current_start = i
            current.append(b)
            i += 1
        elif b in (0x0D, 0x0A) and len(current) > 0:
            current.append(b)
            i += 1
        else:
            flush()
            current_start = i + 1
            i += 1

    flush()
    return strings


# ── Null-terminated string extraction (C-style) ──────────────────────────────

def extract_null_terminated_strings(data, start, length, min_len=4, from_code=False):
    """Extract C-style null-terminated strings."""
    strings = []
    end = min(start + length, len(data))
    i = start
    quality_min = 0.45 if from_code else 0.35

    while i < end:
        if data[i] == 0:
            i += 1
            continue

        str_start = i
        raw = bytearray()
        has_sjis = False

        while i < end and data[i] != 0:
            b = data[i]
            if is_sjis_lead(b) and i + 1 < end and is_sjis_trail(data[i + 1]):
                raw.append(b)
                raw.append(data[i + 1])
                has_sjis = True
                i += 2
            elif is_halfwidth_kana(b):
                raw.append(b)
                has_sjis = True
                i += 1
            elif is_printable_ascii(b) or b in (0x0D, 0x0A, 0x09):
                raw.append(b)
                i += 1
            else:
                i += 1
                break

        if i < end and data[i] == 0:
            i += 1

        if len(raw) < min_len:
            continue

        score = string_quality_score(raw, has_sjis, from_code=from_code)
        if score < quality_min:
            continue

        try:
            text = bytes(raw).decode("cp932", errors="replace")
        except Exception:
            text = bytes(raw).decode("ascii", errors="replace")

        if len(text.strip()) < 2:
            continue

        enc = "shift_jis" if has_sjis else "ascii"
        strings.append({
            "offset": f"0x{str_start:X}",
            "offset_dec": str_start,
            "text": text,
            "raw_hex": bytes(raw)[:64].hex(" "),
            "encoding": enc,
            "byte_length": len(raw),
            "quality": round(score, 2),
            "null_terminated": True,
        })

    return strings


# ── Data table detection ─────────────────────────────────────────────────────

def detect_data_tables(data, start, length, min_records=4):
    tables = []
    end = min(start + length, len(data))
    region = data[start:end]
    region_len = len(region)

    # Limit scan to reasonable step sizes to avoid O(n^2) blow-up
    for rec_size in [2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128]:
        if rec_size * min_records > region_len:
            continue

        step = max(rec_size, 16)
        max_start = min(region_len - rec_size * min_records, 4096)
        for scan_start in range(0, max_start, step):
            records = []
            for r in range(min_records):
                roff = scan_start + r * rec_size
                rec = region[roff:roff + rec_size]
                records.append(rec)

            if all(r == records[0] for r in records):
                continue
            if all(all(b == 0 for b in r) for r in records):
                continue

            byte_ranges = []
            for pos_idx in range(rec_size):
                vals = [r[pos_idx] for r in records]
                byte_ranges.append((min(vals), max(vals)))

            constrained = sum(1 for mn, mx in byte_ranges if mn != mx and mx - mn < 128)
            constant = sum(1 for mn, mx in byte_ranges if mn == mx)

            if constrained >= rec_size // 4 and constant >= 1:
                count = min_records
                while scan_start + count * rec_size + rec_size <= region_len:
                    count += 1

                if count >= min_records + 2:
                    abs_off = start + scan_start
                    sample = []
                    for r in range(min(8, count)):
                        roff = scan_start + r * rec_size
                        sample.append(region[roff:roff + rec_size].hex(" "))

                    tables.append({
                        "offset": f"0x{abs_off:X}",
                        "offset_dec": abs_off,
                        "record_size": rec_size,
                        "estimated_count": count,
                        "total_bytes": count * rec_size,
                        "sample_records": sample,
                        "byte_ranges": [
                            {"pos": j, "min": byte_ranges[j][0], "max": byte_ranges[j][1]}
                            for j in range(min(rec_size, 32))
                        ],
                    })
                    break

    tables.sort(key=lambda t: t["total_bytes"], reverse=True)
    filtered = []
    used_ranges = []
    for t in tables:
        off = t["offset_dec"]
        end_off = off + t["total_bytes"]
        overlaps = False
        for (u_start, u_end) in used_ranges:
            if off < u_end and end_off > u_start:
                overlaps = True
                break
        if not overlaps:
            filtered.append(t)
            used_ranges.append((off, end_off))

    return filtered[:20]


# ── Palette detection (improved: skip MZ header) ─────────────────────────────

def detect_palettes(data, start, length):
    palettes = []
    end = min(start + length, len(data))

    for pal_size, entry_size, name in [(1024, 4, "RGBQUAD"), (768, 3, "RGB")]:
        for i in range(max(start, 0x200), end - pal_size, 4):
            region = data[i:i + pal_size]

            entries = []
            for j in range(0, pal_size, entry_size):
                entries.append(tuple(region[j:j + entry_size]))

            unique = len(set(entries))
            if unique < 24:
                continue

            all_vals = list(region)
            zero_count = all_vals.count(0)
            if zero_count > pal_size * 0.7:
                continue

            if entry_size == 4:
                fourth_bytes = [region[j + 3] for j in range(0, pal_size, 4)]
                if len(set(fourth_bytes)) > 4:
                    continue

            # Verify first color is plausibly black or near-black
            first_rgb = entries[0][:3]
            # This 1997 game likely starts palettes with black
            has_black = any(all(c < 16 for c in e[:3]) for e in entries[:4])
            if not has_black and unique < 64:
                continue

            first_colors = [entries[j] for j in range(min(8, len(entries)))]
            last_colors = [entries[j] for j in range(max(0, len(entries)-4), len(entries))]

            palettes.append({
                "offset": f"0x{i:X}",
                "offset_dec": i,
                "format": name,
                "entry_count": 256,
                "byte_size": pal_size,
                "unique_colors": unique,
                "first_entries": [list(c) for c in first_colors],
                "last_entries": [list(c) for c in last_colors],
            })

            if len(palettes) >= 20:
                return palettes

    return palettes


# ── Numeric table detection ──────────────────────────────────────────────────

def detect_numeric_tables(data, start, length):
    results = []
    end = min(start + length, len(data))
    skip_to = start

    for scan_off in range(start, end - 32, 2):
        if scan_off < skip_to:
            continue

        vals = []
        for j in range(16):
            if scan_off + j * 2 + 2 > end:
                break
            v = struct.unpack_from("<H", data, scan_off + j * 2)[0]
            vals.append(v)

        if len(vals) < 8:
            continue

        if all(0 < v < 10000 for v in vals) and len(set(vals)) >= 3:
            count = 0
            while scan_off + count * 2 + 2 <= end:
                v = struct.unpack_from("<H", data, scan_off + count * 2)[0]
                if v >= 10000 or v == 0:
                    break
                count += 1

            if count >= 8:
                full_vals = []
                for j in range(count):
                    full_vals.append(struct.unpack_from("<H", data, scan_off + j * 2)[0])

                skip_to = scan_off + count * 2

                results.append({
                    "offset": f"0x{scan_off:X}",
                    "type": "uint16[]",
                    "count": count,
                    "values": full_vals[:32],
                    "min": min(full_vals),
                    "max": max(full_vals),
                    "mean": round(sum(full_vals) / len(full_vals), 1),
                })

                if len(results) >= 20:
                    return results

    return results


# ── String pointer table detection ────────────────────────────────────────────

def detect_string_pointer_tables(data, seg_offset, seg_length, all_string_offsets):
    """Look for arrays of 16-bit offsets that point to known strings within the segment."""
    tables = []
    end = min(seg_offset + seg_length, len(data))

    string_off_set = set(all_string_offsets)
    if len(string_off_set) < 4:
        return tables

    # Only scan first 2KB of each DATA segment for pointer tables
    scan_end = min(end, seg_offset + 2048)

    for i in range(seg_offset, scan_end - 8, 2):
        hits = 0
        count = 0
        for j in range(min(64, (scan_end - i) // 2)):
            off = i + j * 2
            if off + 2 > end:
                break
            ptr = struct.unpack_from("<H", data, off)[0]
            abs_ptr = seg_offset + ptr
            if abs_ptr in string_off_set:
                hits += 1
            count += 1
            if count > 4 and hits < count * 0.3:
                break

        if hits >= 4:
            ptrs = []
            for j in range(count):
                off = i + j * 2
                if off + 2 > end:
                    break
                ptrs.append(struct.unpack_from("<H", data, off)[0])

            tables.append({
                "offset": f"0x{i:X}",
                "offset_dec": i,
                "pointer_count": count,
                "hits": hits,
                "sample_pointers": [f"0x{p:04X}" for p in ptrs[:16]],
            })

            if len(tables) >= 5:
                break

    return tables


# ── Categorize strings ───────────────────────────────────────────────────────

def categorize_strings(strings_list):
    categories = {
        "menu_text": [],
        "unit_military": [],
        "weapon_names": [],
        "terrain_weather": [],
        "error_messages": [],
        "system_messages": [],
        "file_references": [],
        "format_strings": [],
        "game_messages": [],
        "misc_japanese": [],
        "misc_ascii": [],
    }

    military_keywords = [
        "部隊", "中隊", "小隊", "大隊", "連隊", "師団", "軍", "歩兵", "戦車",
        "砲兵", "偵察", "工兵", "兵", "隊", "司令", "指揮", "分隊", "班",
        "衛生", "補給", "通信", "機甲", "装甲", "狙撃", "突撃", "防衛",
        "攻撃", "守備", "前進", "後退", "援護", "支援", "占領", "降伏",
        "将校", "士官", "兵士", "軍曹", "伍長", "少尉", "中尉", "大尉",
        "少佐", "中佐", "大佐", "将軍", "元帥",
    ]
    weapon_keywords = [
        "銃", "砲", "弾", "ライフル", "マシンガン", "機関銃", "手榴弾", "対戦車",
        "迫撃砲", "火炎", "狙撃", "爆", "弾薬", "ロケット", "地雷", "榴弾",
        "小銃", "拳銃", "バズーカ", "カービン", "サブマシンガン",
        "MP40", "MG42", "MG34", "Kar98", "M1", "Thompson", "BAR",
        "Panzerfaust", "Panzerschreck", "StG44",
    ]
    terrain_keywords = [
        "森", "林", "平地", "丘", "山", "川", "橋", "道路", "建物", "市街",
        "塹壕", "壕", "陣地", "草原", "沼", "湿地", "雪", "砂漠", "海岸",
        "天候", "晴", "雨", "曇", "霧", "嵐", "夜", "昼",
        "地形", "視界", "射程", "移動",
    ]
    menu_keywords_ja = [
        "選択", "決定", "キャンセル", "戻る", "開始", "終了",
        "設定", "セーブ", "ロード", "はい", "いいえ", "確認",
        "メニュー", "配置", "編成", "情報", "報告",
    ]
    error_keywords = [
        "エラー", "失敗", "不正", "Error", "error", "Warning", "FATAL",
        "cannot", "failed", "invalid", "不足", "不可",
    ]
    game_msg_keywords = [
        "勝利", "敗北", "任務", "ミッション", "完了", "達成", "作戦",
        "命中", "回避", "損害", "壊滅", "撤退", "増援", "士気",
        "経験", "レベル", "ターン", "フェイズ", "フェーズ",
        "占領", "攻略", "防御", "上陸", "戦闘", "進撃",
    ]

    for s in strings_list:
        text = s["text"]
        cat = None

        if any(k in text for k in error_keywords):
            cat = "error_messages"
        elif "%" in text and any(c in text for c in "dsfcxXoupie"):
            cat = "format_strings"
        elif text.upper().rstrip().endswith(
                (".DLL", ".EXE", ".BMP", ".WAV", ".MID",
                 ".IPF", ".TDD", ".INI", ".DAT", ".HLP")):
            cat = "file_references"
        elif any(k in text for k in weapon_keywords):
            cat = "weapon_names"
        elif any(k in text for k in terrain_keywords):
            cat = "terrain_weather"
        elif any(k in text for k in game_msg_keywords):
            cat = "game_messages"
        elif any(k in text for k in military_keywords):
            cat = "unit_military"
        elif any(k in text for k in menu_keywords_ja):
            cat = "menu_text"
        elif s["encoding"] == "shift_jis":
            cat = "misc_japanese"
        elif text.startswith("WM_") or text.startswith("WS_") or \
             "KERNEL" in text.upper() or "GDI" in text.upper() or \
             "USER" in text.upper() and len(text) <= 20:
            cat = "system_messages"
        else:
            cat = "misc_ascii"

        categories[cat].append(s)

    return categories


# ── BITMAPINFO detection ─────────────────────────────────────────────────────

def detect_bitmapinfo(data, start, length):
    results = []
    end = min(start + length, len(data))
    for i in range(max(start, 0x100), end - 40, 2):
        hdr_size = struct.unpack_from("<I", data, i)[0]
        if hdr_size != 40:
            continue
        w = struct.unpack_from("<i", data, i + 4)[0]
        h = struct.unpack_from("<i", data, i + 8)[0]
        planes = struct.unpack_from("<H", data, i + 12)[0]
        bpp = struct.unpack_from("<H", data, i + 14)[0]
        compression = struct.unpack_from("<I", data, i + 16)[0]
        if planes == 1 and bpp in (1, 4, 8, 16, 24, 32) and \
           0 < abs(w) < 4096 and 0 < abs(h) < 4096 and compression <= 3:
            results.append({
                "offset": f"0x{i:X}",
                "offset_dec": i,
                "width": abs(w),
                "height": abs(h),
                "bpp": bpp,
                "compression": compression,
                "has_palette": bpp <= 8,
                "palette_offset": f"0x{i + 40:X}" if bpp <= 8 else None,
                "palette_entries": (1 << bpp) if bpp <= 8 else 0,
            })
    return results


# ── Main analysis ────────────────────────────────────────────────────────────

def analyze_dll(filepath):
    print(f"\n{'='*70}")
    print(f"  Analyzing: {filepath}")
    print(f"{'='*70}")

    info, data = parse_ne_full(filepath)
    if "error" in info:
        print(f"  ERROR: {info.get('error')}")
        return info

    result = {
        "file_info": {
            "name": info["file"],
            "path": filepath,
            "size": info["size"],
            "format": "NE (16-bit New Executable)",
        },
        "ne_header": info["ne_header"],
        "segments": info["segments"],
        "resources": info["resources"],
        "resident_names": info["resident_names"],
        "nonresident_names": info["nonresident_names"],
        "imported_modules": info["imported_modules"],
    }

    # ─ String extraction: DATA segments = primary, CODE segments = secondary ─
    data_strings = []
    code_strings = []
    data_string_offsets = set()

    for seg in info["segments"]:
        file_off = seg["file_offset_dec"]
        seg_len = seg["raw_length"]
        seg_type = seg["type"]

        print(f"  Scanning segment {seg['index']} ({seg_type}) at 0x{file_off:X}, len={seg_len}...", flush=True)

        if seg_type == "DATA":
            strings = extract_null_terminated_strings(data, file_off, seg_len, min_len=3)
            extra = extract_strings(data, file_off, seg_len, min_len=3, from_code=False)
            existing_offs = {s["offset_dec"] for s in strings}
            for s in extra:
                if s["offset_dec"] not in existing_offs:
                    strings.append(s)
            for s in strings:
                s["segment"] = seg["index"]
                s["segment_type"] = seg_type
                data_string_offsets.add(s["offset_dec"])
            data_strings.extend(strings)
            print(f"    Found {len(strings)} DATA strings", flush=True)
        else:
            # For CODE segments, use null-terminated extraction with stricter filtering.
            # Real string literals in code are null-terminated C strings.
            strings = extract_null_terminated_strings(
                data, file_off, seg_len, min_len=4, from_code=True
            )
            for s in strings:
                s["segment"] = seg["index"]
                s["segment_type"] = seg_type
            code_strings.extend(strings)
            print(f"    Found {len(strings)} CODE strings (high-quality only)", flush=True)

    # Also scan resource areas
    for rtype in info["resources"]:
        for entry in rtype["entries"]:
            off = entry["offset_dec"]
            rlength = entry["length"]
            if rtype["type_name"] in ("RT_BITMAP", "RT_ICON", "RT_CURSOR",
                                       "RT_GROUP_CURSOR", "RT_GROUP_ICON"):
                continue
            strings = extract_null_terminated_strings(data, off, rlength, min_len=3)
            for s in strings:
                s["segment"] = f"resource:{rtype['type_name']}:{entry['name']}"
                s["segment_type"] = "RESOURCE"
            data_strings.extend(strings)
            if strings:
                print(f"    Resource {rtype['type_name']}:{entry['name']} => {len(strings)} strings")

    # Deduplicate DATA strings
    seen = set()
    deduped_data = []
    for s in data_strings:
        if s["offset_dec"] not in seen:
            seen.add(s["offset_dec"])
            deduped_data.append(s)
    deduped_data.sort(key=lambda x: x["offset_dec"])

    # Deduplicate CODE strings (separate from DATA)
    deduped_code = []
    for s in code_strings:
        if s["offset_dec"] not in seen:
            seen.add(s["offset_dec"])
            deduped_code.append(s)
    deduped_code.sort(key=lambda x: x["offset_dec"])

    # In 16-bit NE DLLs (esp. Borland C++), string literals are embedded in CODE
    # segments. Merge all strings but tag their source.
    all_deduped = deduped_data + deduped_code
    all_deduped.sort(key=lambda x: x["offset_dec"])

    print(f"  DATA segment strings: {len(deduped_data)}")
    print(f"  CODE segment strings (filtered): {len(deduped_code)}")
    print(f"  Total: {len(all_deduped)}")

    result["strings_total"] = len(all_deduped)
    result["data_strings_count"] = len(deduped_data)
    result["code_strings_count"] = len(deduped_code)

    categories = categorize_strings(all_deduped)
    result["strings_by_category"] = {}
    for cat, items in categories.items():
        result["strings_by_category"][cat] = {
            "count": len(items),
            "items": items,
        }
        if items:
            print(f"    {cat}: {len(items)}")

    # ─ Data table detection ─
    print(f"  Detecting data tables...")
    all_tables = []
    for seg in info["segments"]:
        if seg["type"] != "DATA":
            continue
        file_off = seg["file_offset_dec"]
        seg_len = seg["raw_length"]
        tables = detect_data_tables(data, file_off, seg_len)
        for t in tables:
            t["segment"] = seg["index"]
        all_tables.extend(tables)

    result["data_tables"] = all_tables
    print(f"    Found {len(all_tables)} potential data tables")

    # ─ Numeric tables ─
    print(f"  Detecting numeric tables...")
    num_tables = []
    for seg in info["segments"]:
        if seg["type"] != "DATA":
            continue
        file_off = seg["file_offset_dec"]
        seg_len = seg["raw_length"]
        nt = detect_numeric_tables(data, file_off, seg_len)
        num_tables.extend(nt)

    result["numeric_tables"] = num_tables
    print(f"    Found {len(num_tables)} potential numeric tables")

    # ─ String pointer tables ─
    print(f"  Looking for string pointer tables...")
    str_ptr_tables = []
    for seg in info["segments"]:
        if seg["type"] != "DATA":
            continue
        file_off = seg["file_offset_dec"]
        seg_len = seg["raw_length"]
        spt = detect_string_pointer_tables(data, file_off, seg_len, data_string_offsets)
        str_ptr_tables.extend(spt)

    if str_ptr_tables:
        result["string_pointer_tables"] = str_ptr_tables
        print(f"    Found {len(str_ptr_tables)} potential string pointer tables")

    return result


def main():
    com_path = r"D:\PL\COM.DLL"
    adm_path = r"D:\PL\ADM.DLL"
    output_path = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded\com_dll_analysis.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    report = {
        "title": "Platoon Leader (1997 SEGA/TechnoBrain) - COM.DLL & ADM.DLL Analysis",
        "description": "Deep analysis of NE format DLLs: string extraction, data tables, palette detection",
    }

    # ─ COM.DLL ─
    print("=" * 70)
    print("  PHASE 1: COM.DLL Analysis")
    print("=" * 70)
    com_result = analyze_dll(com_path)
    report["COM_DLL"] = com_result

    # ─ ADM.DLL ─
    print("\n" + "=" * 70)
    print("  PHASE 2: ADM.DLL Analysis")
    print("=" * 70)
    adm_result = analyze_dll(adm_path)

    with open(adm_path, "rb") as f:
        adm_data = f.read()

    # Palette detection
    print(f"  Palette scan...")
    adm_info, _ = parse_ne_full(adm_path)
    palettes = []
    for seg in adm_info["segments"]:
        if seg["type"] != "DATA":
            continue
        pals = detect_palettes(adm_data, seg["file_offset_dec"], seg["raw_length"])
        for p in pals:
            p["segment"] = seg["index"]
        palettes.extend(pals)
    adm_result["palettes"] = palettes
    print(f"    Found {len(palettes)} palettes in DATA segments")

    # BITMAPINFO scan
    print(f"  BITMAPINFO scan...")
    bmps = detect_bitmapinfo(adm_data, 0, len(adm_data))
    adm_result["bitmapinfo_headers"] = bmps
    print(f"    Found {len(bmps)} BITMAPINFO headers")

    report["ADM_DLL"] = adm_result

    # ─ Cross-reference analysis ─
    print("\n" + "=" * 70)
    print("  PHASE 3: Cross-reference analysis")
    print("=" * 70)

    xrefs = {
        "shared_strings": [],
        "hypotheses": [],
    }

    def collect_texts(result_dict):
        texts = {}
        for cat, info_cat in result_dict.get("strings_by_category", {}).items():
            for item in info_cat.get("items", []):
                t = item["text"].strip()
                if len(t) >= 3:
                    texts[t] = cat
        return texts

    com_texts = collect_texts(com_result)
    adm_texts = collect_texts(adm_result)

    shared = set(com_texts.keys()) & set(adm_texts.keys())
    xrefs["shared_strings"] = [
        {"text": t, "com_category": com_texts[t], "adm_category": adm_texts[t]}
        for t in sorted(shared)
        if len(t) >= 4  # only meaningful shared strings
    ]
    print(f"  Meaningful shared strings: {len(xrefs['shared_strings'])}")

    com_cats = com_result.get("strings_by_category", {})
    adm_cats = adm_result.get("strings_by_category", {})

    if com_cats.get("weapon_names", {}).get("count", 0) > 0:
        wep_texts = [i["text"] for i in com_cats["weapon_names"]["items"][:10]]
        xrefs["hypotheses"].append({
            "topic": "weapon_data",
            "description": "COM.DLL contains weapon-related text, likely weapon names/descriptions used across the game",
            "evidence": wep_texts,
        })
    if com_cats.get("unit_military", {}).get("count", 0) > 0:
        unit_texts = [i["text"] for i in com_cats["unit_military"]["items"][:10]]
        xrefs["hypotheses"].append({
            "topic": "unit_data",
            "description": "COM.DLL contains unit/military terminology, likely unit type definitions",
            "evidence": unit_texts,
        })
    if com_cats.get("menu_text", {}).get("count", 0) > 0:
        xrefs["hypotheses"].append({
            "topic": "localization",
            "description": "COM.DLL contains menu/UI text, serving as the shared localization resource",
            "evidence": [i["text"] for i in com_cats["menu_text"]["items"][:10]],
        })
    if com_cats.get("format_strings", {}).get("count", 0) > 0:
        xrefs["hypotheses"].append({
            "topic": "format_strings",
            "description": "COM.DLL contains printf-style format strings for formatted game messages",
            "evidence": [i["text"] for i in com_cats["format_strings"]["items"][:10]],
        })
    if com_cats.get("terrain_weather", {}).get("count", 0) > 0:
        xrefs["hypotheses"].append({
            "topic": "terrain_weather",
            "description": "COM.DLL contains terrain/weather related strings for tactical map system",
            "evidence": [i["text"] for i in com_cats["terrain_weather"]["items"][:10]],
        })
    if com_cats.get("game_messages", {}).get("count", 0) > 0:
        xrefs["hypotheses"].append({
            "topic": "game_messages",
            "description": "COM.DLL contains game event messages (victory, defeat, mission status)",
            "evidence": [i["text"] for i in com_cats["game_messages"]["items"][:10]],
        })

    if adm_result.get("palettes"):
        xrefs["hypotheses"].append({
            "topic": "palette_data",
            "description": f"ADM.DLL contains {len(adm_result['palettes'])} palette definitions for 256-color mode",
            "evidence": [p["offset"] for p in adm_result["palettes"][:5]],
        })
    if adm_result.get("bitmapinfo_headers"):
        xrefs["hypotheses"].append({
            "topic": "bitmap_resources",
            "description": f"ADM.DLL contains {len(adm_result['bitmapinfo_headers'])} BITMAPINFO structures",
            "evidence": [
                f"{b['offset']} ({b['width']}x{b['height']} {b['bpp']}bpp)"
                for b in adm_result["bitmapinfo_headers"][:5]
            ],
        })

    report["cross_references"] = xrefs

    # ─ Summary ─
    summary = {
        "com_dll": {
            "total_strings": com_result.get("strings_total", 0),
            "data_strings": com_result.get("data_strings_count", 0),
            "code_strings": com_result.get("code_strings_count", 0),
            "segments": len(com_result.get("segments", [])),
            "resources": sum(r["count"] for r in com_result.get("resources", [])),
            "data_tables": len(com_result.get("data_tables", [])),
            "numeric_tables": len(com_result.get("numeric_tables", [])),
            "categories": {k: v["count"] for k, v in com_cats.items() if v.get("count", 0) > 0},
        },
        "adm_dll": {
            "total_strings": adm_result.get("strings_total", 0),
            "data_strings": adm_result.get("data_strings_count", 0),
            "code_strings": adm_result.get("code_strings_count", 0),
            "segments": len(adm_result.get("segments", [])),
            "resources": sum(r["count"] for r in adm_result.get("resources", [])),
            "palettes": len(adm_result.get("palettes", [])),
            "bitmapinfo_headers": len(adm_result.get("bitmapinfo_headers", [])),
            "data_tables": len(adm_result.get("data_tables", [])),
            "categories": {k: v["count"] for k, v in adm_cats.items() if v.get("count", 0) > 0},
        },
    }
    report["summary"] = summary

    # ─ Write JSON ─
    def clean(obj):
        if isinstance(obj, dict):
            return {k: clean(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [clean(v) for v in obj]
        elif isinstance(obj, bytes):
            return obj.hex(" ")
        elif isinstance(obj, float):
            return round(obj, 2)
        return obj

    report = clean(report)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    file_size_kb = output_path.stat().st_size / 1024
    print(f"\n{'='*70}")
    print(f"  Report written to: {output_path}")
    print(f"  Report size: {file_size_kb:.1f} KB")
    print(f"{'='*70}")

    print(f"\n  === KEY FINDINGS ===")
    for h in xrefs["hypotheses"]:
        print(f"  [{h['topic']}] {h['description']}")

    print(f"\n  COM.DLL: {summary['com_dll']['data_strings']} DATA + {summary['com_dll']['code_strings']} CODE strings")
    for cat, count in summary["com_dll"]["categories"].items():
        print(f"    {cat}: {count}")
        items = com_cats[cat]["items"]
        for item in items[:5]:
            try:
                print(f"      [{item['offset']}] {item['text'][:80]}")
            except Exception:
                pass

    print(f"\n  ADM.DLL: {summary['adm_dll']['data_strings']} DATA + {summary['adm_dll']['code_strings']} CODE strings")
    for cat, count in summary["adm_dll"]["categories"].items():
        print(f"    {cat}: {count}")
        items = adm_cats[cat]["items"]
        for item in items[:3]:
            try:
                print(f"      [{item['offset']}] {item['text'][:80]}")
            except Exception:
                pass


if __name__ == "__main__":
    main()
