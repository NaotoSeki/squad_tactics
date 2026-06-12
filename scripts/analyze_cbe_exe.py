"""
Comprehensive analysis of CBE.EXE - the Combat Battle Engine from
"Platoon Leader" (1997 SEGA/TechnoBrain, 16-bit NE format).

Extracts:
  - RT_STRING   (Shift-JIS string tables)
  - RT_DIALOG   (dialog definitions)
  - RT_MENU     (menu definitions)
  - Segment table & data segment scanning for game mechanics tables
  - Vehicle/unit name tables
  - Terrain type definitions

Writes results to: cbe_analysis.json
"""
import struct
import json
import re
import os
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

CBE_PATH = Path(r"D:\PL\CBE.EXE")
OUTPUT_DIR = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded")
OUTPUT_JSON = OUTPUT_DIR / "cbe_analysis.json"

NE_RT = {
    0x8001: "RT_CURSOR",
    0x8002: "RT_BITMAP",
    0x8003: "RT_ICON",
    0x8004: "RT_MENU",
    0x8005: "RT_DIALOG",
    0x8006: "RT_STRING",
    0x8007: "RT_FONTDIR",
    0x8008: "RT_FONT",
    0x8009: "RT_ACCELERATOR",
    0x800A: "RT_RCDATA",
    0x800C: "RT_GROUP_CURSOR",
    0x800E: "RT_GROUP_ICON",
    0x8010: "RT_VERSION",
}

# Windows 3.x dialog control class IDs
DIALOG_CTRL_CLASS = {
    0x80: "BUTTON",
    0x81: "EDIT",
    0x82: "STATIC",
    0x83: "LISTBOX",
    0x84: "SCROLLBAR",
    0x85: "COMBOBOX",
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def u8(data, off):
    return data[off] if off < len(data) else 0

def u16(data, off):
    if off + 2 > len(data):
        return 0
    return struct.unpack_from('<H', data, off)[0]

def s16(data, off):
    if off + 2 > len(data):
        return 0
    return struct.unpack_from('<h', data, off)[0]

def u32(data, off):
    if off + 4 > len(data):
        return 0
    return struct.unpack_from('<I', data, off)[0]

def decode_sjis(raw_bytes):
    """Decode bytes as Shift-JIS, falling back to latin-1."""
    try:
        return raw_bytes.decode('shift_jis')
    except (UnicodeDecodeError, ValueError):
        try:
            return raw_bytes.decode('cp932')
        except (UnicodeDecodeError, ValueError):
            return raw_bytes.decode('latin-1', errors='replace')

def read_ne_pascal_string(data, offset):
    """Read a Pascal-style (length-prefixed) string."""
    if offset >= len(data):
        return ""
    length = data[offset]
    if length == 0:
        return ""
    return data[offset+1:offset+1+length].decode('ascii', errors='replace')


# ── NE header & resource table parsing ───────────────────────────────────────

def parse_ne_header(data):
    """Parse NE header; return dict with header info and resource entries."""
    assert data[:2] == b'MZ', "Not MZ"
    ne_off = u32(data, 0x3C)
    assert data[ne_off:ne_off+2] == b'NE', "Not NE"

    ne = data[ne_off:]
    info = {
        'ne_offset': ne_off,
        'linker_version': f"{ne[2]}.{ne[3]}",
        'entry_table_off': u16(ne, 0x04),
        'entry_table_len': u16(ne, 0x06),
        'flags': u16(ne, 0x0C),
        'auto_data_seg': u16(ne, 0x0E),
        'heap_size': u16(ne, 0x10),
        'stack_size': u16(ne, 0x12),
        'cs_ip': u32(ne, 0x14),
        'ss_sp': u32(ne, 0x18),
        'seg_table_entries': u16(ne, 0x1C),
        'module_ref_count': u16(ne, 0x1E),
        'non_resident_name_size': u16(ne, 0x20),
        'seg_table_off': u16(ne, 0x22),
        'res_table_off': u16(ne, 0x24),
        'resident_name_off': u16(ne, 0x26),
        'module_ref_off': u16(ne, 0x28),
        'imported_name_off': u16(ne, 0x2A),
        'non_resident_name_table': u32(ne, 0x2C),
        'moveable_entry_count': u16(ne, 0x30),
        'align_shift_count': u16(ne, 0x32),
        'target_os': ne[0x36] if len(ne) > 0x36 else 0,
    }

    # Segment table
    seg_abs = ne_off + info['seg_table_off']
    segments = []
    for i in range(info['seg_table_entries']):
        off = seg_abs + i * 8
        seg_offset_raw = u16(data, off)
        seg_length = u16(data, off + 2)
        seg_flags = u16(data, off + 4)
        seg_alloc = u16(data, off + 6)
        seg_offset = seg_offset_raw << info['align_shift_count']
        actual_len = seg_length if seg_length != 0 else 65536
        segments.append({
            'index': i + 1,
            'offset': seg_offset,
            'length': actual_len,
            'flags': seg_flags,
            'alloc_size': seg_alloc if seg_alloc != 0 else 65536,
            'is_data': bool(seg_flags & 0x0001),
            'is_moveable': bool(seg_flags & 0x0010),
            'is_preload': bool(seg_flags & 0x0040),
            'is_relocatable': bool(seg_flags & 0x0100),
            'has_reloc': bool(seg_flags & 0x0100),
        })
    info['segments'] = segments

    # Resource table
    rt_abs = ne_off + info['res_table_off']
    align_shift = u16(data, rt_abs)
    info['res_align_shift'] = align_shift

    pos = rt_abs + 2
    resource_types = []

    while pos + 8 <= len(data):
        type_id = u16(data, pos)
        if type_id == 0:
            break
        count = u16(data, pos + 2)
        pos += 8

        if type_id & 0x8000:
            type_name = NE_RT.get(type_id, f"RT_UNKNOWN_{type_id:#06x}")
        else:
            type_name = read_ne_pascal_string(data, rt_abs + type_id)

        entries = []
        for _ in range(count):
            if pos + 12 > len(data):
                break
            res_off_raw = u16(data, pos)
            res_len_raw = u16(data, pos + 2)
            res_flags = u16(data, pos + 4)
            res_name_id = u16(data, pos + 6)
            pos += 12

            abs_off = res_off_raw << align_shift
            abs_len = res_len_raw << align_shift

            if res_name_id & 0x8000:
                name = f"#{res_name_id & 0x7FFF}"
            else:
                name = read_ne_pascal_string(data, rt_abs + res_name_id)

            entries.append({
                'name': name,
                'name_id': res_name_id,
                'offset': abs_off,
                'length': abs_len,
                'flags': res_flags,
            })

        resource_types.append({
            'type_id': type_id,
            'type_name': type_name,
            'count': count,
            'entries': entries,
        })

    info['resource_types'] = resource_types
    return info


# ── RT_STRING extraction ─────────────────────────────────────────────────────

def extract_strings(data, header):
    """
    Parse RT_STRING resources. Each resource block contains 16 strings.
    Block ID N contains string IDs (N-1)*16 through (N-1)*16+15.
    Each string: u8 length, followed by that many bytes (Shift-JIS on Win16).
    """
    strings = {}
    string_blocks = []

    for rtype in header['resource_types']:
        if rtype['type_id'] != 0x8006:
            continue
        for entry in rtype['entries']:
            name = entry['name']
            block_id = int(name.replace('#', '')) if name.startswith('#') else 0
            base_string_id = (block_id - 1) * 16

            off = entry['offset']
            end = off + entry['length']
            if off >= len(data) or end > len(data):
                continue

            block_data = data[off:end]
            block_strings = []
            pos = 0

            for i in range(16):
                if pos >= len(block_data):
                    break
                str_len = block_data[pos]
                pos += 1
                if str_len > 0 and pos + str_len <= len(block_data):
                    raw = block_data[pos:pos + str_len]
                    text = decode_sjis(raw)
                    string_id = base_string_id + i
                    strings[string_id] = text
                    block_strings.append({
                        'string_id': string_id,
                        'text': text,
                        'raw_hex': raw.hex(),
                    })
                    pos += str_len
                else:
                    pos += str_len

            if block_strings:
                string_blocks.append({
                    'block_id': block_id,
                    'base_string_id': base_string_id,
                    'resource_name': name,
                    'offset': hex(entry['offset']),
                    'length': entry['length'],
                    'strings': block_strings,
                })

    return strings, string_blocks


# ── RT_DIALOG extraction ─────────────────────────────────────────────────────

def read_dialog_string_at(data, pos):
    """
    Read a null-terminated Shift-JIS string from dialog resource data.
    Returns (string, bytes_consumed).
    """
    start = pos
    while pos < len(data) and data[pos] != 0:
        b = data[pos]
        if 0x81 <= b <= 0x9F or 0xE0 <= b <= 0xFC:
            pos += 2
        else:
            pos += 1
    text = decode_sjis(data[start:pos])
    return text, pos + 1 - start

def parse_dialog_resource(raw):
    """
    Parse a Win16 DLGTEMPLATE structure.
    Layout:
      DWORD  style
      BYTE   item_count
      WORD   x, y, cx, cy
      ... menu (null-term or 0xFF + ordinal)
      ... class (null-term or 0xFF + ordinal)
      ... caption (null-term)
      [if DS_SETFONT] WORD font_size, string font_name
    Then for each item:
      WORD   x, y, cx, cy
      WORD   id
      DWORD  style
      ... class (byte or 0x80-style ordinal)
      ... text (null-term)
      BYTE   creation_data_len
    """
    if len(raw) < 13:
        return None

    style = u32(raw, 0)
    item_count = u8(raw, 4)
    x = u16(raw, 5)
    y = u16(raw, 7)
    cx = u16(raw, 9)
    cy = u16(raw, 11)
    pos = 13

    # Menu
    menu_str = ""
    if pos < len(raw):
        if raw[pos] == 0:
            pos += 1
        elif raw[pos] == 0xFF:
            menu_ordinal = u16(raw, pos + 1) if pos + 2 < len(raw) else 0
            menu_str = f"ordinal:{menu_ordinal}"
            pos += 3
        else:
            menu_str, consumed = read_dialog_string_at(raw, pos)
            pos += consumed

    # Class
    class_str = ""
    if pos < len(raw):
        if raw[pos] == 0:
            pos += 1
        elif raw[pos] == 0xFF:
            class_ordinal = u16(raw, pos + 1) if pos + 2 < len(raw) else 0
            class_str = f"ordinal:{class_ordinal}"
            pos += 3
        else:
            class_str, consumed = read_dialog_string_at(raw, pos)
            pos += consumed

    # Caption
    caption = ""
    if pos < len(raw):
        caption, consumed = read_dialog_string_at(raw, pos)
        pos += consumed

    # Font (if DS_SETFONT = 0x40)
    font_info = None
    if style & 0x40:
        if pos + 2 <= len(raw):
            font_size = u16(raw, pos)
            pos += 2
            font_name, consumed = read_dialog_string_at(raw, pos)
            pos += consumed
            font_info = {'size': font_size, 'name': font_name}

    # Parse dialog items
    items = []
    for _ in range(item_count):
        if pos + 14 > len(raw):
            break

        item_x = u16(raw, pos)
        item_y = u16(raw, pos + 2)
        item_cx = u16(raw, pos + 4)
        item_cy = u16(raw, pos + 6)
        item_id = u16(raw, pos + 8)
        item_style = u32(raw, pos + 10)
        pos += 14

        # Class
        item_class = ""
        if pos < len(raw):
            b = raw[pos]
            if b >= 0x80 and b <= 0x85:
                item_class = DIALOG_CTRL_CLASS.get(b, f"class_{b:#x}")
                pos += 1
            else:
                item_class, consumed = read_dialog_string_at(raw, pos)
                pos += consumed

        # Text
        item_text = ""
        if pos < len(raw):
            item_text, consumed = read_dialog_string_at(raw, pos)
            pos += consumed

        # Creation data length
        creation_len = 0
        if pos < len(raw):
            creation_len = raw[pos]
            pos += 1
            pos += creation_len

        items.append({
            'x': item_x, 'y': item_y, 'cx': item_cx, 'cy': item_cy,
            'id': item_id,
            'style': f"{item_style:#010x}",
            'class': item_class,
            'text': item_text,
        })

    result = {
        'style': f"{style:#010x}",
        'item_count': item_count,
        'x': x, 'y': y, 'cx': cx, 'cy': cy,
        'menu': menu_str,
        'class': class_str,
        'caption': caption,
        'items': items,
    }
    if font_info:
        result['font'] = font_info

    return result


def extract_dialogs(data, header):
    """Extract all RT_DIALOG resources."""
    dialogs = []
    for rtype in header['resource_types']:
        if rtype['type_id'] != 0x8005:
            continue
        for entry in rtype['entries']:
            off = entry['offset']
            end = off + entry['length']
            if off >= len(data) or end > len(data):
                continue
            raw = data[off:end]
            parsed = parse_dialog_resource(raw)
            if parsed:
                parsed['resource_name'] = entry['name']
                parsed['resource_offset'] = hex(off)
                parsed['resource_length'] = entry['length']
                dialogs.append(parsed)
    return dialogs


# ── RT_MENU extraction ───────────────────────────────────────────────────────

MF_POPUP = 0x0010
MF_END = 0x0080

def parse_menu_items(raw, pos, end):
    """Recursively parse MENUITEMTEMPLATE entries."""
    items = []
    while pos < end:
        if pos + 2 > end:
            break
        flags = u16(raw, pos)
        pos += 2

        is_popup = bool(flags & MF_POPUP)
        is_end = bool(flags & MF_END)

        item_id = None
        if not is_popup:
            if pos + 2 > end:
                break
            item_id = u16(raw, pos)
            pos += 2

        text, consumed = read_dialog_string_at(raw, pos)
        pos += consumed

        item = {'text': text, 'flags': f"{flags:#06x}"}
        if item_id is not None:
            item['id'] = item_id

        if is_popup:
            sub_items, pos = parse_menu_items(raw, pos, end)
            item['submenu'] = sub_items

        items.append(item)
        if is_end:
            break

    return items, pos


def extract_menus(data, header):
    """Extract all RT_MENU resources."""
    menus = []
    for rtype in header['resource_types']:
        if rtype['type_id'] != 0x8004:
            continue
        for entry in rtype['entries']:
            off = entry['offset']
            end = off + entry['length']
            if off >= len(data) or end > len(data):
                continue
            raw = data[off:end]

            if len(raw) < 4:
                continue
            version = u16(raw, 0)
            header_size = u16(raw, 2)
            items_start = 4 + header_size

            items, _ = parse_menu_items(raw, items_start, len(raw))
            menus.append({
                'resource_name': entry['name'],
                'resource_offset': hex(off),
                'resource_length': entry['length'],
                'version': version,
                'items': items,
            })
    return menus


# ── Data segment scanning ────────────────────────────────────────────────────

def find_sjis_strings_in_segment(data, seg_offset, seg_length, min_len=4):
    """
    Scan a data segment for Shift-JIS strings.
    Returns list of (offset_in_segment, string).
    """
    results = []
    seg_data = data[seg_offset:seg_offset + seg_length]
    pos = 0

    while pos < len(seg_data):
        start = pos
        text_bytes = bytearray()
        is_valid = True
        has_japanese = False

        while pos < len(seg_data):
            b = seg_data[pos]
            if b == 0:
                break
            if (0x81 <= b <= 0x9F or 0xE0 <= b <= 0xFC) and pos + 1 < len(seg_data):
                b2 = seg_data[pos + 1]
                if 0x40 <= b2 <= 0xFC and b2 != 0x7F:
                    text_bytes.append(b)
                    text_bytes.append(b2)
                    has_japanese = True
                    pos += 2
                    continue
                else:
                    is_valid = False
                    break
            elif 0x20 <= b <= 0x7E:
                text_bytes.append(b)
                pos += 1
            elif b == 0x0D or b == 0x0A:
                text_bytes.append(b)
                pos += 1
            else:
                is_valid = False
                break

        if is_valid and len(text_bytes) >= min_len:
            text = decode_sjis(bytes(text_bytes))
            results.append((start, text))

        if pos == start:
            pos += 1
        elif not is_valid:
            pos += 1

    return results


def scan_for_ascii_tables(data, seg_offset, seg_length):
    """Scan for null-terminated ASCII string arrays (like filename tables)."""
    seg_data = data[seg_offset:seg_offset + seg_length]
    tables = []
    pos = 0
    current_table = []
    table_start = 0

    while pos < len(seg_data):
        start = pos
        s = bytearray()
        while pos < len(seg_data) and seg_data[pos] != 0:
            b = seg_data[pos]
            if 0x20 <= b <= 0x7E:
                s.append(b)
                pos += 1
            else:
                break
            if len(s) > 200:
                break

        if len(s) >= 3 and pos < len(seg_data) and seg_data[pos] == 0:
            text = s.decode('ascii', errors='replace')
            if not current_table:
                table_start = start
            current_table.append((start, text))
            pos += 1
        else:
            if len(current_table) >= 3:
                tables.append({
                    'offset_in_segment': table_start,
                    'count': len(current_table),
                    'entries': [(off, t) for off, t in current_table],
                })
            current_table = []
            pos = start + 1

    if len(current_table) >= 3:
        tables.append({
            'offset_in_segment': table_start,
            'count': len(current_table),
            'entries': [(off, t) for off, t in current_table],
        })

    return tables


def scan_for_numeric_tables(data, seg_offset, seg_length):
    """
    Look for arrays of small integers that could be game parameter tables.
    For example: arrays of u16 values in range [0..1000] or byte arrays.
    """
    seg_data = data[seg_offset:seg_offset + seg_length]
    tables = []

    # Scan for byte arrays of consistent small values (like terrain cost tables)
    for start in range(0, len(seg_data) - 16):
        candidate = seg_data[start:start + 32]
        vals = list(candidate)
        if all(1 <= v <= 100 for v in vals[:16]):
            non_trivial = len(set(vals[:16])) >= 3
            if non_trivial:
                extend = 16
                while start + extend < len(seg_data) and extend < 256:
                    v = seg_data[start + extend]
                    if 1 <= v <= 100:
                        extend += 1
                    else:
                        break
                if extend >= 8:
                    tables.append({
                        'type': 'byte_array',
                        'offset_in_segment': start,
                        'abs_offset': hex(seg_offset + start),
                        'length': extend,
                        'values': list(seg_data[start:start + extend]),
                        'preview': list(seg_data[start:start + min(extend, 32)]),
                    })
                    start += extend

    # Scan for u16 arrays (AP costs, modifiers, etc.)
    u16_tables = []
    for start in range(0, len(seg_data) - 32, 2):
        vals = []
        for i in range(16):
            off = start + i * 2
            if off + 2 > len(seg_data):
                break
            v = struct.unpack_from('<H', seg_data, off)[0]
            vals.append(v)
        if len(vals) >= 8 and all(0 < v < 5000 for v in vals) and len(set(vals)) >= 3:
            extend = 16
            while start + extend * 2 + 1 < len(seg_data) and extend < 128:
                v = struct.unpack_from('<H', seg_data, start + extend * 2)[0]
                if 0 < v < 5000:
                    extend += 1
                else:
                    break
            if extend >= 6:
                u16_tables.append({
                    'type': 'u16_array',
                    'offset_in_segment': start,
                    'abs_offset': hex(seg_offset + start),
                    'count': extend,
                    'values': [struct.unpack_from('<H', seg_data, start + i * 2)[0] for i in range(min(extend, 32))],
                })

    # Deduplicate overlapping tables
    seen_ranges = set()
    deduped = []
    for t in tables:
        key = (t['offset_in_segment'], t['length'])
        if key not in seen_ranges:
            seen_ranges.add(key)
            deduped.append(t)

    return deduped, u16_tables


def scan_for_tdd_filenames(data):
    """Scan the entire binary for .TDD filename references (vehicle model files)."""
    results = []
    pos = 0
    while True:
        idx = data.find(b'.TDD', pos)
        if idx == -1:
            break
        start = idx
        while start > 0 and data[start - 1] >= 0x20 and data[start - 1] <= 0x7E:
            start -= 1
            if idx - start > 50:
                break
        if start < idx:
            name = data[start:idx + 4].decode('ascii', errors='replace')
            if len(name) >= 5:
                results.append({
                    'offset': hex(start),
                    'filename': name,
                })
        pos = idx + 4
    return results


def scan_for_file_references(data):
    """Scan for other file references (.BMP, .WAV, .MID, .CG, etc.)."""
    extensions = [b'.BMP', b'.WAV', b'.MID', b'.CG', b'.DAT', b'.DLL', b'.EXE',
                  b'.IPF', b'.SCN', b'.MAP']
    results = {}
    for ext in extensions:
        ext_str = ext.decode('ascii')
        findings = []
        pos = 0
        while True:
            idx = data.find(ext, pos)
            if idx == -1:
                break
            start = idx
            while start > 0 and 0x20 <= data[start - 1] <= 0x7E:
                start -= 1
                if idx - start > 80:
                    break
            if start < idx:
                name = data[start:idx + len(ext)].decode('ascii', errors='replace')
                if len(name) >= 3:
                    findings.append({
                        'offset': hex(start),
                        'filename': name,
                    })
            pos = idx + len(ext)
        if findings:
            results[ext_str] = findings
    return results


def categorize_strings(strings_dict):
    """Categorize extracted strings by likely purpose."""
    categories = {
        'command_labels': [],
        'unit_military': [],
        'terrain_map': [],
        'ui_messages': [],
        'error_messages': [],
        'menu_labels': [],
        'game_mechanics': [],
        'file_references': [],
        'other': [],
    }

    for sid, text in sorted(strings_dict.items()):
        text_lower = text.lower()
        categorized = False

        if any(kw in text for kw in ['移動', '射撃', 'アイテム', 'パス', '待機',
                                        '姿勢', '陣地', '命令', 'コマンド',
                                        '攻撃', '防御', '偵察']):
            categories['command_labels'].append({'id': sid, 'text': text})
            categorized = True

        if any(kw in text for kw in ['歩兵', '戦車', '車両', '砲兵', '部隊',
                                        '分隊', '小隊', '中隊', '兵', '師団',
                                        'ユニット', '士気', '練度']):
            categories['unit_military'].append({'id': sid, 'text': text})
            categorized = True

        if any(kw in text for kw in ['地形', '森', '林', '草', '道', '川',
                                        '橋', '建物', '市街', '沼', '山',
                                        'ヘクス', 'マップ', '視線', '射程']):
            categories['terrain_map'].append({'id': sid, 'text': text})
            categorized = True

        if any(kw in text for kw in ['AP', 'HP', 'ポイント', 'ターン',
                                        '命中', '回避', '装甲', '貫通',
                                        'ダメージ', '射程', '距離']):
            categories['game_mechanics'].append({'id': sid, 'text': text})
            categorized = True

        if '.TDD' in text or '.BMP' in text or '.WAV' in text or '.DLL' in text:
            categories['file_references'].append({'id': sid, 'text': text})
            categorized = True

        if 'エラー' in text or 'error' in text_lower or '失敗' in text:
            categories['error_messages'].append({'id': sid, 'text': text})
            categorized = True

        if not categorized:
            if len(text) <= 20 and not any(c in text for c in '.\\/:'):
                categories['menu_labels'].append({'id': sid, 'text': text})
            elif len(text) > 5:
                categories['ui_messages'].append({'id': sid, 'text': text})
            else:
                categories['other'].append({'id': sid, 'text': text})

    return categories


def scan_data_segments_for_game_tables(data, segments):
    """Scan data segments for interesting game-mechanics tables."""
    all_sjis = []
    all_ascii_tables = []
    all_numeric = {'byte_arrays': [], 'u16_arrays': []}

    for seg in segments:
        if not seg['is_data']:
            continue
        off = seg['offset']
        length = seg['length']
        if off == 0 or off + length > len(data):
            continue

        sjis = find_sjis_strings_in_segment(data, off, length, min_len=3)
        for s_off, s_text in sjis:
            all_sjis.append({
                'segment': seg['index'],
                'offset_in_segment': s_off,
                'abs_offset': hex(off + s_off),
                'text': s_text,
            })

        ascii_tables = scan_for_ascii_tables(data, off, length)
        for t in ascii_tables:
            table_entries = []
            for e_off, e_text in t['entries']:
                table_entries.append({
                    'offset': e_off,
                    'text': e_text,
                })
            all_ascii_tables.append({
                'segment': seg['index'],
                'offset_in_segment': t['offset_in_segment'],
                'abs_offset': hex(off + t['offset_in_segment']),
                'count': t['count'],
                'entries': table_entries,
            })

        byte_arrays, u16_arrays = scan_for_numeric_tables(data, off, length)
        for t in byte_arrays:
            t['segment'] = seg['index']
            all_numeric['byte_arrays'].append(t)
        for t in u16_arrays:
            t['segment'] = seg['index']
            all_numeric['u16_arrays'].append(t)

    return all_sjis, all_ascii_tables, all_numeric


def scan_command_dispatch_patterns(data, segments):
    """
    Look for patterns that suggest command handler dispatch tables.
    A dispatch table in Win16 might be an array of function pointers (seg:offset pairs)
    or a switch-case pattern with sequential command IDs.
    """
    results = []

    # Look in code segments for sequences of indirect CALL patterns
    for seg in segments:
        if seg['is_data']:
            continue
        off = seg['offset']
        length = seg['length']
        if off == 0 or off + length > len(data):
            continue

        seg_data = data[off:off + length]

        # Pattern: array of far pointers (4 bytes each: offset:segment)
        # Common in Win16 dispatch tables
        for start in range(0, len(seg_data) - 24, 2):
            ptrs = []
            valid = True
            for i in range(6):
                ptr_off = struct.unpack_from('<H', seg_data, start + i * 4)[0]
                ptr_seg = struct.unpack_from('<H', seg_data, start + i * 4 + 2)[0]
                if 1 <= ptr_seg <= 20 and ptr_off > 0:
                    ptrs.append((ptr_seg, ptr_off))
                else:
                    valid = False
                    break
            if valid and len(set(p[0] for p in ptrs)) <= 3:
                results.append({
                    'type': 'far_ptr_table',
                    'segment': seg['index'],
                    'offset_in_segment': start,
                    'abs_offset': hex(off + start),
                    'entries': [{'seg': s, 'offset': o} for s, o in ptrs],
                })

    return results


# ── Resident / Non-resident name tables ──────────────────────────────────────

def extract_resident_names(data, ne_offset, resident_name_off):
    """Extract names from the resident name table."""
    abs_off = ne_offset + resident_name_off
    names = []
    pos = abs_off
    while pos < len(data):
        length = data[pos]
        if length == 0:
            break
        name = data[pos+1:pos+1+length].decode('ascii', errors='replace')
        ordinal = u16(data, pos + 1 + length)
        names.append({'name': name, 'ordinal': ordinal})
        pos += 1 + length + 2
    return names


def extract_imported_names(data, ne_offset, imported_name_off):
    """Extract names from the imported name table."""
    abs_off = ne_offset + imported_name_off
    names = []
    pos = abs_off
    limit = min(len(data), abs_off + 4096)
    while pos < limit:
        length = data[pos]
        if length == 0:
            pos += 1
            continue
        name = data[pos+1:pos+1+length].decode('ascii', errors='replace')
        names.append(name)
        pos += 1 + length
        if pos + 1 >= limit:
            break
    return names


# ── Heuristic: terrain/movement cost table detection ─────────────────────────

def detect_terrain_tables(data, segments):
    """
    Look for patterns matching terrain-type definition tables.
    Typical structure: array of structs with movement cost, defense bonus, etc.
    """
    candidates = []

    for seg in segments:
        if not seg['is_data']:
            continue
        off = seg['offset']
        length = seg['length']
        if off == 0 or off + length > len(data):
            continue

        seg_data = data[off:off + length]

        # Look for byte sequences that could be terrain cost tables:
        # - Typically 10-30 terrain types
        # - Movement costs in range 1-10 or 1-99
        # - Multiple columns (infantry, vehicle, etc.)
        for start in range(0, len(seg_data) - 40):
            # Try as a 2D table: rows = terrain types, cols = unit types
            for cols in [4, 5, 6, 8]:
                rows = 0
                valid = True
                for r in range(20):
                    row_start = start + r * cols
                    if row_start + cols > len(seg_data):
                        break
                    row_vals = list(seg_data[row_start:row_start + cols])
                    if all(0 <= v <= 99 for v in row_vals) and any(v > 0 for v in row_vals):
                        rows += 1
                    else:
                        break

                if 8 <= rows <= 30:
                    table_data = []
                    for r in range(rows):
                        row_start = start + r * cols
                        table_data.append(list(seg_data[row_start:row_start + cols]))

                    # Check if it looks like a structured table (not random data)
                    flat = [v for row in table_data for v in row]
                    unique_ratio = len(set(flat)) / max(len(flat), 1)
                    if 0.1 < unique_ratio < 0.9:
                        candidates.append({
                            'segment': seg['index'],
                            'offset_in_segment': start,
                            'abs_offset': hex(off + start),
                            'rows': rows,
                            'cols': cols,
                            'data': table_data,
                        })
                        break

    # Deduplicate overlapping candidates
    seen = set()
    deduped = []
    for c in candidates:
        key = c['abs_offset']
        if key not in seen:
            seen.add(key)
            deduped.append(c)
    return deduped


# ── Main analysis ────────────────────────────────────────────────────────────

def main():
    print("=" * 80)
    print("CBE.EXE Comprehensive Analysis")
    print("Platoon Leader - Combat Battle Engine (1997 SEGA/TechnoBrain)")
    print("=" * 80)

    if not CBE_PATH.is_file():
        print(f"\nERROR: File not found: {CBE_PATH}")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\nReading {CBE_PATH} ...")
    with open(CBE_PATH, 'rb') as f:
        data = f.read()

    file_size = len(data)
    print(f"  File size: {file_size:,} bytes ({file_size / (1024*1024):.2f} MB)")

    # Parse NE header
    print("\n[1/8] Parsing NE header & resource table...")
    header = parse_ne_header(data)
    print(f"  NE offset:    {header['ne_offset']:#x}")
    print(f"  Segments:     {len(header['segments'])}")
    print(f"  Align shift:  {header['res_align_shift']}")

    for seg in header['segments']:
        seg_type = "DATA" if seg['is_data'] else "CODE"
        print(f"    Seg {seg['index']:2d}: {seg_type}  offset={seg['offset']:#010x}  "
              f"len={seg['length']:#08x} ({seg['length']:,} bytes)  "
              f"flags={seg['flags']:#06x}")

    total_res = sum(len(rt['entries']) for rt in header['resource_types'])
    print(f"\n  Resource types: {len(header['resource_types'])}")
    print(f"  Total resources: {total_res}")
    for rt in header['resource_types']:
        print(f"    {rt['type_name']:25s} x {rt['count']}")

    # Extract strings
    print("\n[2/8] Extracting RT_STRING resources (Shift-JIS)...")
    strings_dict, string_blocks = extract_strings(data, header)
    print(f"  Extracted {len(strings_dict)} strings from {len(string_blocks)} blocks")
    for sid, text in sorted(strings_dict.items()):
        if text.strip():
            print(f"    [{sid:4d}] {text}")

    # Categorize strings
    print("\n[3/8] Categorizing strings...")
    categories = categorize_strings(strings_dict)
    for cat, items in categories.items():
        if items:
            print(f"  {cat}: {len(items)} strings")

    # Extract dialogs
    print("\n[4/8] Extracting RT_DIALOG resources...")
    dialogs = extract_dialogs(data, header)
    print(f"  Extracted {len(dialogs)} dialog definitions")
    for dlg in dialogs:
        caption = dlg['caption'] or "(no caption)"
        print(f"    {dlg['resource_name']:20s}  \"{caption}\"  "
              f"{dlg['x']},{dlg['y']} {dlg['cx']}x{dlg['cy']}  "
              f"items={dlg['item_count']}")

    # Extract menus
    print("\n[5/8] Extracting RT_MENU resources...")
    menus = extract_menus(data, header)
    print(f"  Extracted {len(menus)} menu definitions")
    for menu in menus:
        top_items = [item['text'] for item in menu['items'] if item['text']]
        print(f"    {menu['resource_name']:20s}  items: {', '.join(top_items[:5])}")

    # Scan for file references
    print("\n[6/8] Scanning for file references...")
    tdd_files = scan_for_tdd_filenames(data)
    print(f"  Found {len(tdd_files)} .TDD references (vehicle model files)")
    for f in tdd_files:
        print(f"    {f['offset']}: {f['filename']}")

    file_refs = scan_for_file_references(data)
    for ext, refs in file_refs.items():
        unique_names = list(set(r['filename'] for r in refs))
        print(f"  {ext}: {len(unique_names)} unique references")

    # Scan data segments
    print("\n[7/8] Scanning data segments for game tables...")
    sjis_in_data, ascii_tables, numeric_tables = scan_data_segments_for_game_tables(
        data, header['segments']
    )
    print(f"  Shift-JIS strings in data segments: {len(sjis_in_data)}")
    print(f"  ASCII string tables: {len(ascii_tables)}")
    print(f"  Byte array candidates: {len(numeric_tables['byte_arrays'])}")
    print(f"  U16 array candidates: {len(numeric_tables['u16_arrays'])}")

    for table in ascii_tables:
        preview = [e['text'] for e in table['entries'][:5]]
        print(f"    ASCII table at {table['abs_offset']}: {table['count']} entries  "
              f"preview={preview}")

    # Terrain table detection
    print("\n[8/8] Detecting terrain/movement cost tables...")
    terrain_candidates = detect_terrain_tables(data, header['segments'])
    print(f"  Found {len(terrain_candidates)} table candidates")
    for tc in terrain_candidates[:10]:
        print(f"    At {tc['abs_offset']}: {tc['rows']}x{tc['cols']}")
        for i, row in enumerate(tc['data'][:5]):
            print(f"      row {i}: {row}")

    # Extract names
    resident_names = extract_resident_names(
        data, header['ne_offset'], header['resident_name_off']
    )
    imported_names = extract_imported_names(
        data, header['ne_offset'], header['imported_name_off']
    )

    # Build comprehensive report
    print(f"\nBuilding JSON report...")

    # Limit numeric tables to most interesting ones (avoid huge output)
    interesting_byte_arrays = [
        t for t in numeric_tables['byte_arrays']
        if t['length'] >= 12 and t['length'] <= 200
    ][:50]

    interesting_u16_arrays = [
        t for t in numeric_tables['u16_arrays']
        if t['count'] >= 8 and t['count'] <= 100
    ][:50]

    report = {
        '_meta': {
            'file': str(CBE_PATH),
            'file_size': file_size,
            'format': 'NE (16-bit New Executable)',
            'description': 'Combat Battle Engine - Platoon Leader (1997 SEGA/TechnoBrain)',
            'analysis_sections': [
                'ne_header', 'segments', 'resource_summary',
                'strings', 'string_categories', 'dialogs', 'menus',
                'file_references', 'data_segment_strings',
                'ascii_tables', 'numeric_tables', 'terrain_table_candidates',
                'resident_names', 'imported_names',
            ],
        },
        'ne_header': {
            k: v for k, v in header.items()
            if k not in ('segments', 'resource_types')
        },
        'segments': [
            {
                'index': seg['index'],
                'offset': hex(seg['offset']),
                'length': seg['length'],
                'type': 'DATA' if seg['is_data'] else 'CODE',
                'flags': hex(seg['flags']),
                'alloc_size': seg['alloc_size'],
            }
            for seg in header['segments']
        ],
        'resource_summary': [
            {
                'type_id': hex(rt['type_id']),
                'type_name': rt['type_name'],
                'count': rt['count'],
                'entries': [
                    {
                        'name': e['name'],
                        'offset': hex(e['offset']),
                        'length': e['length'],
                    }
                    for e in rt['entries']
                ],
            }
            for rt in header['resource_types']
        ],
        'strings': {
            'total_count': len(strings_dict),
            'blocks': string_blocks,
            'all_strings': {str(k): v for k, v in sorted(strings_dict.items())},
        },
        'string_categories': {
            cat: items for cat, items in categories.items()
        },
        'dialogs': dialogs,
        'menus': menus,
        'file_references': {
            'tdd_vehicle_files': tdd_files,
            'by_extension': {
                ext: [{'filename': r['filename'], 'offset': r['offset']} for r in refs]
                for ext, refs in file_refs.items()
            },
        },
        'data_segment_analysis': {
            'sjis_strings_count': len(sjis_in_data),
            'sjis_strings': sjis_in_data[:500],
            'ascii_tables': ascii_tables,
        },
        'numeric_tables': {
            'byte_arrays': interesting_byte_arrays,
            'u16_arrays': interesting_u16_arrays,
        },
        'terrain_table_candidates': terrain_candidates[:20],
        'resident_names': resident_names,
        'imported_names': imported_names,
    }

    # Write JSON
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\n{'=' * 80}")
    print(f"Report written to: {OUTPUT_JSON}")
    print(f"  File size: {os.path.getsize(OUTPUT_JSON):,} bytes")
    print(f"{'=' * 80}")

    # Print summary statistics
    print(f"\n--- SUMMARY ---")
    print(f"  Strings extracted:      {len(strings_dict)}")
    print(f"  Dialogs parsed:         {len(dialogs)}")
    print(f"  Menus parsed:           {len(menus)}")
    print(f"  .TDD file references:   {len(tdd_files)}")
    print(f"  Data segment strings:   {len(sjis_in_data)}")
    print(f"  ASCII tables found:     {len(ascii_tables)}")
    print(f"  Numeric table candidates: {len(interesting_byte_arrays)} byte + {len(interesting_u16_arrays)} u16")
    print(f"  Terrain table candidates: {len(terrain_candidates)}")


if __name__ == '__main__':
    main()
