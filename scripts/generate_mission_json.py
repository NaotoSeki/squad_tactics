"""
Generate comprehensive mission_structure.json from MISSDATA binary analysis.
Platoon Leader (1997 SEGA/TechnoBrain) mission data format documentation.
"""
import os, struct, json, sys
from pathlib import Path
from collections import defaultdict, OrderedDict

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

MISSDATA_DIR = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded\ne_resources\MISSDATA")
TDD_DIR = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded\tdd")
OUTPUT_PATH = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded\mission_structure.json")

def read_le16(data, offset):
    return struct.unpack_from('<H', data, offset)[0]

def read_le32(data, offset):
    return struct.unpack_from('<I', data, offset)[0]

def read_cstring(data, offset, max_len=32):
    end = offset
    while end < min(offset + max_len, len(data)) and data[end] != 0:
        end += 1
    return data[offset:end].decode('ascii', errors='replace')

def decode_sjis_safe(data, offset, max_len=64):
    end = offset
    while end < min(offset + max_len, len(data)) and data[end] != 0:
        end += 1
    try:
        return data[offset:end].decode('shift_jis', errors='replace')
    except:
        return data[offset:end].decode('ascii', errors='replace')

def hex_str(data, start, length):
    return ' '.join(f'{data[i]:02x}' for i in range(start, min(start + length, len(data))))

# ============================================================
# Parse all files
# ============================================================
files = sorted(MISSDATA_DIR.glob("*.bin"))
missions = defaultdict(dict)

for f in files:
    name = f.stem
    parts = name.split('_')
    map_id = parts[0]
    variant = '_'.join(parts[1:])
    data = f.read_bytes()
    missions[map_id][variant] = {
        'filename': f.name,
        'size': len(data),
        'data': data
    }

# ============================================================
# Build the header structure definition
# ============================================================
header_def = OrderedDict([
    ("offset_0x00_magic", {
        "offset": "0x00",
        "size": 2,
        "type": "uint16_le",
        "value": "0xFFFF (always)",
        "description": "Magic number / file type marker. Always 0xFFFF for MISSDATA files."
    }),
    ("offset_0x02_unit_count", {
        "offset": "0x02",
        "size": 2,
        "type": "uint16_le",
        "description": "Number of military units defined in this mission scenario. Main files (_0_0) contain the actual deployment count (5-68). Variant files (_1_0, _2_0, etc.) typically have value 1.",
        "observed_range": "1-68"
    }),
    ("offset_0x04_map_width", {
        "offset": "0x04",
        "size": 2,
        "type": "uint16_le",
        "value": "60 (0x003C, always)",
        "description": "Hex grid width in columns. All missions use 60-column hex maps."
    }),
    ("offset_0x06_map_height", {
        "offset": "0x06",
        "size": 2,
        "type": "uint16_le",
        "value": "100 (0x0064, always)",
        "description": "Hex grid height in rows. All missions use 100-row hex maps."
    }),
    ("offset_0x08_map_bitmap", {
        "offset": "0x08",
        "size": "10-12 (null-terminated)",
        "type": "ascii_string",
        "description": "Reference to the terrain bitmap file (e.g. 'NMAP00.BMP'). These correspond to the DMAP/WMAP tile image files. Null-terminated, padded to align."
    })
])

# ============================================================
# Analyze unit record structure (98-byte records)
# ============================================================
UNIT_RECORD_SIZE = 98

VALID_HEX_TYPES = frozenset(range(0x00, 0x10))  # 0x00-0x0F covers all observed tile types

def find_hex_grid_end(data):
    """Find where the 6-byte 0x80 hex grid records end.
    Grid records: 80 xx xx xx xx TT  (TT = tile type, 0x00-0x0F range).
    Scan near the scenario/grid boundary (~4560-4590) for the longest
    contiguous run of valid 6-byte records.
    """
    best_start = None
    best_count = 0
    for try_start in range(4556, 4590):
        if try_start + 11 >= len(data):
            break
        if data[try_start] != 0x80:
            continue
        if data[try_start + 5] not in VALID_HEX_TYPES:
            continue
        if data[try_start + 6] != 0x80:
            continue

        pos = try_start
        count = 0
        while pos + 5 < len(data):
            if data[pos] == 0x80 and data[pos + 5] in VALID_HEX_TYPES:
                count += 1
                pos += 6
            else:
                break
        if count > best_count:
            best_count = count
            best_start = try_start

    if best_start is not None:
        return best_start + best_count * 6, best_count, best_start
    return 4576, 0, 4576

def parse_unit_records(data, unit_table_start, unit_count):
    """Parse 98-byte unit records.
    Record layout (98 bytes):
      byte 0:       padding (always 0x00)
      bytes 1-11:   ASCII designation (null-padded, 11 bytes)
      bytes 12-~50: Shift-JIS full name (null-terminated)
      bytes 28-61:  numeric attributes (LE16 pairs, often zero; non-zero in some units)
      bytes 62-91:  zero padding
      byte 92:      always 0x00
      byte 93:      field_a (uint8) — categorical value (3 dominant); last record = unit_count echo
      byte 94:      always 0x00
      byte 95:      field_b (uint8) — unit organizational/formation class
      byte 96:      always 0x00
      byte 97:      field_c (uint8) — unit type/equipment modifier
    """
    units = []
    for i in range(unit_count):
        offset = unit_table_start + i * UNIT_RECORD_SIZE
        available = len(data) - offset
        if available < 12:
            break
        rec_len = min(UNIT_RECORD_SIZE, available)
        rec = data[offset:offset + rec_len]

        ascii_name = ""
        name_end = 1
        while name_end < 12 and name_end < len(rec) and rec[name_end] != 0:
            name_end += 1
        if name_end > 1:
            ascii_name = rec[1:name_end].decode('ascii', errors='replace')

        sjis_name = decode_sjis_safe(rec, 12, min(40, rec_len - 12))

        field_a = rec[93] if rec_len > 93 else 0
        field_b = rec[95] if rec_len > 95 else 0
        field_c = rec[97] if rec_len > 97 else 0

        is_last = (i == unit_count - 1)
        truncated = rec_len < UNIT_RECORD_SIZE

        entry = {
            "record_index": i,
            "file_offset": offset,
            "ascii_designation": ascii_name,
            "sjis_full_name": sjis_name,
            "field_a": field_a,
            "field_b": field_b,
            "field_c": field_c,
            "is_last_record": is_last,
            "raw_hex_first_20": hex_str(rec, 0, min(20, rec_len)),
            "raw_hex_last_20": hex_str(rec, max(0, rec_len - 20), min(20, rec_len))
        }
        if truncated:
            entry["truncated_bytes"] = rec_len
        units.append(entry)
    return units

def parse_hex_grid(data, grid_start, grid_count):
    """Parse 6-byte hex placement records."""
    placements = []
    for i in range(grid_count):
        offset = grid_start + i * 6
        rec = data[offset:offset + 6]
        flag = rec[0]
        x = rec[1] | (rec[2] << 8)
        y = rec[3] | (rec[4] << 8)
        tile_type = rec[5]
        if x != 0 or y != 0:
            placements.append({
                "grid_index": i,
                "file_offset": offset,
                "flag": flag,
                "x": x,
                "y": y,
                "tile_type": tile_type
            })
    return placements

# ============================================================
# Build mission inventory with parsed data
# ============================================================
mission_data = OrderedDict()
map_name_xref = OrderedDict()

all_main_files = sorted([mid for mid in missions.keys() if '0_0' in missions[mid]])

for map_id in sorted(missions.keys()):
    info = OrderedDict()
    variants_info = OrderedDict()

    for variant_key in sorted(missions[map_id].keys()):
        v = missions[map_id][variant_key]
        data = v['data']
        vinfo = OrderedDict()
        vinfo["filename"] = v['filename']
        vinfo["size_bytes"] = v['size']

        if len(data) >= 8:
            vinfo["magic"] = f"0x{read_le16(data, 0):04X}"
            vinfo["unit_count"] = read_le16(data, 2)
            vinfo["map_width"] = read_le16(data, 4)
            vinfo["map_height"] = read_le16(data, 6)

        if len(data) >= 20:
            map_name = read_cstring(data, 8, 14)
            vinfo["map_bitmap_ref"] = map_name
            if variant_key == '0_0':
                map_name_xref[map_id] = map_name

        # For main files, parse hex grid and unit records
        if variant_key == '0_0' and v['size'] > 4600:
            unit_count = read_le16(data, 2)
            grid_end, grid_count, grid_start = find_hex_grid_end(data)

            vinfo["hex_grid"] = {
                "start_offset": grid_start,
                "end_offset": grid_end,
                "record_count": grid_count,
                "record_size": 6,
                "total_bytes": grid_count * 6,
            }

            non_empty = parse_hex_grid(data, grid_start, grid_count)
            vinfo["hex_grid"]["non_empty_placements"] = len(non_empty)
            if non_empty:
                vinfo["hex_grid"]["placement_samples"] = non_empty[:5]

            # Unit table starts right after hex grid
            unit_table_start = grid_end
            expected_unit_table_size = unit_count * UNIT_RECORD_SIZE
            actual_remaining = v['size'] - unit_table_start

            vinfo["unit_table"] = {
                "start_offset": unit_table_start,
                "unit_count": unit_count,
                "record_size": UNIT_RECORD_SIZE,
                "expected_size": expected_unit_table_size,
                "actual_remaining_bytes": actual_remaining,
                "footer_bytes": actual_remaining - expected_unit_table_size
            }

            units = parse_unit_records(data, unit_table_start, unit_count)
            vinfo["units"] = units

            # Footer analysis
            footer_start = unit_table_start + expected_unit_table_size
            if footer_start < v['size']:
                footer = data[footer_start:]
                vinfo["footer"] = {
                    "offset": footer_start,
                    "size": len(footer),
                    "hex": hex_str(data, footer_start, min(32, len(footer)))
                }

        variants_info[variant_key] = vinfo

    mission_data[map_id] = variants_info

# ============================================================
# Build the unit record structure definition
# ============================================================
unit_record_def = OrderedDict([
    ("record_size", 98),
    ("description", "Each unit in the scenario is described by a 98-byte fixed-size record. Records are stored sequentially after the hex grid data. The name fields are at the start; three classification bytes at the end are separated by zero-padding bytes."),
    ("fields", [
        {
            "name": "padding",
            "offset": "0x00 (byte 0)",
            "size": 1,
            "type": "uint8",
            "description": "Leading padding byte. Always 0x00."
        },
        {
            "name": "ascii_designation",
            "offset": "0x01 (byte 1)",
            "size": 11,
            "type": "ascii_string (null-padded)",
            "description": "Short ASCII unit designation code (e.g. 'CCB', '212VG', 'Lehr', 'Manteuffel', 'Maucke', 'Gds', '150'). May contain a secondary letter at byte 5 after a null (e.g. '150\\0G'). Null-padded to 11 bytes."
        },
        {
            "name": "sjis_full_name",
            "offset": "0x0C (byte 12)",
            "size": "variable (null-terminated, up to ~40 bytes)",
            "type": "shift_jis_string",
            "description": "Full Japanese unit name in Shift-JIS encoding (e.g. '独第212国民擲弾兵師団' = German 212th Volksgrenadier Division). Null-terminated."
        },
        {
            "name": "numeric_attributes",
            "offset": "~0x1C-0x3D (bytes 28-61)",
            "size": "~34 bytes",
            "type": "uint16_le[] (pairs)",
            "description": "Optional numeric attribute area. Contains LE16 values in some units (e.g. repeated value 99/0x0063 in certain records). Often all zeros. Exact meaning TBD — may encode strength/morale/experience values."
        },
        {
            "name": "reserved_padding",
            "offset": "~0x3E-0x5B (bytes 62-91)",
            "size": "30 bytes",
            "type": "padding",
            "description": "Always zero-padded."
        },
        {
            "name": "zero_pad_92",
            "offset": "0x5C (byte 92)",
            "size": 1,
            "type": "uint8",
            "description": "Always 0x00. Separator before field_a."
        },
        {
            "name": "field_a",
            "offset": "0x5D (byte 93)",
            "size": 1,
            "type": "uint8",
            "description": "Primary classification byte. For most units, holds a categorical value (dominant value 3, seen: 0-10). For the LAST unit record in each mission, this byte stores the unit_count (echoing header offset 0x02), serving as a sentinel/trailer marker.",
            "observed_values": {
                "3": "Most common (65.5% of units). Assigned to units of all nationalities and types — likely 'standard deployment' or default category.",
                "4": "~4.3%. Seen on specific US armored commands and German division HQs.",
                "5": "~3.7%. Appears on HQ/objective units and certain named formations.",
                "8": "~4.3%. Appears on reinforcement-eligible or late-arriving units.",
                "9": "~12.3%. Frequently paired with special/named formations (e.g. '2A' Oran, 'BLM' artillery).",
                "1-2": "Rare. Possibly variant/reserve category.",
                "6-7, 10": "Very rare. May be scenario-specific special roles.",
                ">10 (last record)": "Equals unit_count. Not a classification value — it's a trailer/sentinel."
            }
        },
        {
            "name": "zero_pad_94",
            "offset": "0x5E (byte 94)",
            "size": 1,
            "type": "uint8",
            "description": "Always 0x00. Separator before field_b."
        },
        {
            "name": "field_b",
            "offset": "0x5F (byte 95)",
            "size": 1,
            "type": "uint8",
            "description": "Secondary classification — likely unit formation/organizational class.",
            "observed_values": {
                "0": "43.4%. Most common — standard/unclassified.",
                "1": "15.9%. Correlates with Commonwealth/British units (Guards, Indian divisions).",
                "2": "28.9%. Correlates with mechanized/armored formations.",
                "3": "3.5%. Possibly airborne or special operations.",
                "4": "5.6%. Possibly artillery or support.",
                "6": "1.0%. Rare — linked to specific US command units.",
                "7": "1.7%. Rare — appears on named German division HQs."
            }
        },
        {
            "name": "zero_pad_96",
            "offset": "0x60 (byte 96)",
            "size": 1,
            "type": "uint8",
            "description": "Always 0x00. Separator before field_c."
        },
        {
            "name": "field_c",
            "offset": "0x61 (byte 97)",
            "size": 1,
            "type": "uint8",
            "description": "Tertiary classification — likely unit equipment/type modifier.",
            "observed_values": {
                "0": "27.6%. Default/basic infantry.",
                "4": "54.9%. Most common non-zero value — possibly 'combat-ready' or standard equipment.",
                "7": "6.2%. Appears on airborne and special units.",
                "13-14": "~2.2%. Rare — specific formation modifiers.",
                "16-20": "~5.3%. Range of values on special/named units (Oran, BLM artillery, etc.)."
            }
        }
    ]),
    ("notes", [
        "The last record in each mission has field_a = unit_count (sentinel). This unit's classification values in field_b/field_c are valid.",
        "Fields are separated by 0x00 padding bytes. The game likely reads individual bytes, not 16-bit values.",
        "About half of all unit records (446/907) have non-zero data in the numeric_attributes area (bytes 28-61). These likely encode combat statistics."
    ])
])

# ============================================================
# Build hex grid record structure
# ============================================================
hex_grid_def = OrderedDict([
    ("record_size", 6),
    ("description", "Sparse hex grid placement records. Each describes a hex tile position with a unit/object marker. The grid starts after the base scenario section (typically at file offset ~4576+)."),
    ("fields", [
        {
            "name": "flag",
            "offset": 0,
            "size": 1,
            "description": "Always 0x80 for valid records. Marks this as a hex grid entry."
        },
        {
            "name": "x_position",
            "offset": 1,
            "size": 2,
            "type": "uint16_le",
            "description": "X coordinate (pixel position on hex map). Range 0-~500. Maps to hex column via pixel_x / hex_width."
        },
        {
            "name": "y_position",
            "offset": 3,
            "size": 2,
            "type": "uint16_le",
            "description": "Y coordinate (pixel position on hex map). Range 0-~350. Maps to hex row via pixel_y / hex_height."
        },
        {
            "name": "tile_type",
            "offset": 5,
            "size": 1,
            "description": "Placement type. 0x08=empty, 0x03=objective(?), 0x04=allied_unit(?), 0x05=axis_unit(?), 0x0A=special_marker(?), 0x0C=reinforcement_point(?)"
        }
    ]),
    ("tile_type_values", {
        "0x08": "Empty/default - most entries use this",
        "0x03": "Possibly objective/victory hex marker",
        "0x04": "Likely one side's unit placement (appears with higher coordinates)",
        "0x05": "Likely opposing side's unit placement (most common non-empty type)",
        "0x0A": "Special marker - possibly reinforcement entry point",
        "0x0C": "Rare - possibly terrain modifier or special condition"
    })
])

# ============================================================
# Map name cross-reference
# ============================================================
# Build complete cross-reference from all _0_0 files
bitmap_to_missions = defaultdict(list)
for map_id, bmp in map_name_xref.items():
    bitmap_to_missions[bmp].append(map_id)

map_xref = OrderedDict()
for bmp in sorted(bitmap_to_missions.keys()):
    map_xref[bmp] = {
        "missions": bitmap_to_missions[bmp],
        "dmap_file": bmp.replace("NMAP", "DMAP").replace(".BMP", ""),
        "wmap_file": bmp.replace("NMAP", "WMAP").replace(".BMP", ""),
        "note": f"Shared terrain map used by {len(bitmap_to_missions[bmp])} mission(s)"
    }

# ============================================================
# Variant file analysis
# ============================================================
variant_analysis = OrderedDict([
    ("base_size", 4576),
    ("description", "Variant files contain alternative scenario conditions (reinforcements, difficulty adjustments). They share the same 8-byte header and map reference as the main _0_0 file."),
    ("naming_convention", {
        "_0_0": "Main scenario file with full unit deployment, hex grid, and unit records",
        "_1_0": "Reinforcement/condition variant set 1, normal difficulty",
        "_1_1": "Reinforcement/condition variant set 1, hard difficulty",
        "_2_0": "Reinforcement/condition variant set 2, normal difficulty",
        "_2_1": "Reinforcement/condition variant set 2, hard difficulty",
        "_0_1": "MAP99 special: tutorial/training variant 1",
        "_0_2": "MAP99 special: tutorial/training variant 2"
    }),
    ("structure", {
        "header": "Same 8-byte header (magic + unit_count + dimensions)",
        "map_ref": "Same NMAP reference as parent _0_0 file",
        "briefing": "Different Shift-JIS mission briefing text (scenario conditions)",
        "parameters": "Modified scenario parameters (turn limits, victory conditions, reinforcement timing)",
        "hex_grid": "NOT present in variant files",
        "unit_records": "NOT present in variant files"
    }),
    ("key_differences", {
        "byte_2": "unit_count is typically 1 (vs full count in _0_0)",
        "bytes_21+": "Different Shift-JIS text starts here (different briefing content)",
        "bytes_35-40": "Often contain 0xFF or 0x00 in variants where _0_0 has Shift-JIS continuation",
        "total_differing_bytes": "Typically 170-210 bytes differ between _0_0 and variant in the first 256 bytes"
    }),
    ("exceptions", {
        "MAP36_1_1": "6912 bytes (larger than standard 4576, contains extra data)",
        "MAP36_2_1": "6912 bytes (same exception as _1_1)",
        "MAP99": "Only has _0_1 and _0_2 variants (tutorial missions)"
    })
])

# ============================================================
# TDD file analysis
# ============================================================
tdd_analysis = OrderedDict()

tdd_files_info = {
    "HLAND": {
        "original_size": 20480,
        "png_path": "tdd/HLAND.png",
        "png_size": 18348,
        "description": "Hex terrain tile graphics sheet",
        "analysis": {
            "total_bytes": 20480,
            "width_assumption": "64 pixels wide (standard tile sheet width)",
            "height_if_64w": "320 pixels tall (20480 / 64 = 320)",
            "hex_tile_size": "33x41 pixels (standard hex dimensions for this game)",
            "tiles_by_byte_count": "20480 / (33*41) = 15.13 - does NOT evenly divide",
            "tiles_if_padded_40x48": "20480 / (40*48) = 10.67 - does NOT evenly divide",
            "tiles_if_32x32": "20480 / (32*32) = 20 tiles",
            "most_likely_format": "64px wide strip containing terrain tiles stacked vertically. At 64px wide and 8bpp indexed color, this is 320 rows tall. With ~41px per hex tile height, this gives ~7-8 terrain tile types.",
            "terrain_types_estimate": [
                "0: Clear/Open ground",
                "1: Forest/Woods",
                "2: Hills/Elevation",
                "3: Town/Urban",
                "4: Road",
                "5: River/Water",
                "6: Mountain",
                "7: Marsh/Swamp"
            ]
        }
    },
    "GRD": {
        "original_size": 896,
        "png_path": "tdd/GRD.png",
        "png_size": 717,
        "description": "Hex grid overlay lines",
        "analysis": {
            "total_bytes": 896,
            "possible_dimensions": "At 64px wide: 14 rows (896/64). Or single hex tile overlay at 32x28.",
            "purpose": "Drawn over terrain to show hex grid boundaries"
        }
    },
    "HEX": {
        "original_size": 9471,
        "png_path": "tdd/HEX.png",
        "png_size": 1003,
        "description": "Hex selection/highlight cursors",
        "analysis": {
            "total_bytes": 9471,
            "tiles_33x41": "9471 / (33*41) = 7.0 tiles exactly",
            "interpretation": "7 hex cursor frames at 33x41 pixels each (selection highlight, movement range, attack range, etc.)",
            "cursor_types_estimate": [
                "0: Normal selection cursor",
                "1: Movement range highlight",
                "2: Attack range highlight",
                "3: Support range highlight",
                "4: Enemy unit highlight",
                "5: Objective hex highlight",
                "6: Blocked/impassable highlight"
            ]
        }
    },
    "VCHEX": {
        "original_size": 4059,
        "png_path": "tdd/VCHEX.png",
        "png_size": 459,
        "description": "Vehicle hex cursors (larger vehicle footprint)",
        "analysis": {
            "total_bytes": 4059,
            "tiles_33x41": "4059 / (33*41) = 3.0 tiles exactly",
            "interpretation": "3 vehicle hex cursor frames at 33x41 pixels each",
            "cursor_types_estimate": [
                "0: Vehicle selection cursor",
                "1: Vehicle movement destination",
                "2: Vehicle attack target"
            ]
        }
    }
}

# ============================================================
# Scenario text section analysis
# ============================================================
scenario_section = OrderedDict([
    ("description", "The scenario briefing section occupies bytes ~20 to ~4576 of each file. It contains Japanese text (Shift-JIS encoding) intermixed with binary parameter data."),
    ("text_encoding", "Shift-JIS (Microsoft Code Page 932) - standard for 1997 Japanese PC games"),
    ("structure", {
        "text_blocks": "Multiple null-terminated Shift-JIS strings containing mission briefing narrative",
        "binary_gaps": "Between text blocks, 7-33 byte binary sequences contain scenario parameters",
        "section_markers": "0xFFFF appears as section delimiter within the briefing data (at ~68-byte intervals in the parameter area around offsets 0x500-0x1000)",
        "parameter_data": "Victory conditions, turn limits, reinforcement schedules encoded in the binary gaps"
    }),
    ("identified_parameters", [
        {
            "offset_range": "0x30-0x4C (after first text block)",
            "description": "Scenario timing/turn parameters. Contains LE16 values that appear to be turn counters and time limits.",
            "fields": {
                "0x32-0x33": "Possibly max_turns or time_limit_1",
                "0x36-0x37": "Possibly score_threshold or reinforcement_turn",
                "0x48-0x49": "Possibly secondary objective value"
            }
        },
        {
            "offset_range": "0x50-0x58",
            "description": "Victory condition block. Contains '5a 62' (0x625A) consistently across files, possibly a condition type identifier.",
            "fields": {
                "0x53": "Victory condition type (observed: 0x5A = 90 decimal)",
                "0x54-0x55": "0x0162 = 354 - possibly victory point target",
                "0x57": "Sub-condition or difficulty modifier"
            }
        }
    ]),
    ("victory_condition_encoding", {
        "status": "PARTIALLY_DECODED",
        "notes": "Victory conditions appear embedded in binary gaps between text blocks. The exact encoding requires runtime analysis or disassembly of the game executable for confirmation.",
        "observed_patterns": {
            "pattern_5a62": "Appears at offset ~0x52-0x53 in most files. Likely a magic number for 'victory condition block'.",
            "text_references": "Japanese text blocks contain victory condition descriptions in natural language"
        }
    })
])

# ============================================================
# Compile complete output
# ============================================================
output = OrderedDict([
    ("_metadata", {
        "title": "Platoon Leader MISSDATA Binary Format Specification",
        "game": "Platoon Leader (プラトーンリーダー)",
        "developer": "TechnoBrain",
        "publisher": "SEGA",
        "year": 1997,
        "platform": "Windows PC",
        "source": "MISSDATA.DLL (NE resource extraction)",
        "total_files": len(files),
        "total_missions": len([m for m in missions if '0_0' in missions[m]]),
        "analysis_date": "2026-04-25"
    }),

    ("file_format_overview", {
        "description": "MISSDATA binary files define mission scenarios for Platoon Leader's tactical combat. Each mission (MAP00-MAP36) has a main file (_0_0) and up to 4 variant files for reinforcements and difficulty.",
        "file_structure": [
            "1. HEADER (8 bytes) — Magic + unit count + map dimensions",
            "2. MAP REFERENCE (10-12 bytes) — ASCII bitmap filename, null-terminated",
            "3. SCENARIO SECTION (~4556 bytes) — Shift-JIS briefing text + binary parameters",
            "4. HEX GRID DATA (variable) — 6-byte placement records for hex positions [_0_0 only]",
            "5. UNIT RECORDS (98 bytes × unit_count) — Unit definitions with names and attributes [_0_0 only]",
            "6. FOOTER (variable, ~12-32 bytes) — Trailing data including unit count echo"
        ],
        "variant_files": "Contain only sections 1-3 (header + map ref + briefing). Always 4576 bytes (with rare exceptions).",
        "endianness": "Little-endian (Intel byte order)"
    }),

    ("header_structure", header_def),

    ("scenario_briefing_section", scenario_section),

    ("hex_grid_record_format", hex_grid_def),

    ("unit_record_format", unit_record_def),

    ("variant_file_analysis", variant_analysis),

    ("map_name_cross_reference", map_xref),

    ("tdd_tile_data_analysis", tdd_files_info),

    ("mission_inventory", {})
])

# Build per-mission inventory (without raw binary data)
inventory = OrderedDict()
for map_id in sorted(missions.keys()):
    mission_entry = OrderedDict()
    for variant_key in sorted(missions[map_id].keys()):
        v = missions[map_id][variant_key]
        data = v['data']
        entry = OrderedDict()
        entry["filename"] = v['filename']
        entry["size_bytes"] = v['size']

        if len(data) >= 8:
            entry["unit_count"] = read_le16(data, 2)
            entry["map_bitmap_ref"] = read_cstring(data, 8, 14)

        if variant_key == '0_0' and v['size'] > 4600:
            unit_count = read_le16(data, 2)
            grid_end, grid_count, grid_start = find_hex_grid_end(data)

            entry["hex_grid_records"] = grid_count
            non_empty = parse_hex_grid(data, grid_start, grid_count)
            entry["hex_grid_non_empty"] = len(non_empty)

            units = parse_unit_records(data, grid_end, unit_count)
            unit_summary = []
            for u in units:
                unit_summary.append({
                    "designation": u["ascii_designation"],
                    "full_name": u["sjis_full_name"],
                    "field_a": u["field_a"],
                    "field_b": u["field_b"],
                    "field_c": u["field_c"]
                })
            entry["units"] = unit_summary
            entry["file_structure_offsets"] = {
                "header": "0x00-0x07",
                "map_name": f"0x08-0x{8 + len(read_cstring(data, 8, 14)):02X}",
                "scenario_section": f"0x{8 + len(read_cstring(data, 8, 14)) + 1:02X}-0x{grid_start - 1:04X}",
                "hex_grid": f"0x{grid_start:04X}-0x{grid_end - 1:04X}" if grid_count > 0 else "N/A",
                "unit_records": f"0x{grid_end:04X}-0x{grid_end + unit_count * 98 - 1:04X}",
                "footer": f"0x{grid_end + unit_count * 98:04X}-0x{v['size'] - 1:04X}"
            }

        mission_entry[variant_key] = entry

    inventory[map_id] = mission_entry

output["mission_inventory"] = inventory

# ============================================================
# Size statistics
# ============================================================
main_sizes = []
for map_id in sorted(missions.keys()):
    if '0_0' in missions[map_id]:
        main_sizes.append(missions[map_id]['0_0']['size'])

output["statistics"] = {
    "main_file_sizes": {
        "min": min(main_sizes) if main_sizes else 0,
        "max": max(main_sizes) if main_sizes else 0,
        "mean": sum(main_sizes) // len(main_sizes) if main_sizes else 0
    },
    "variant_file_size": 4576,
    "variant_exceptions": ["MAP36_1_1 (6912)", "MAP36_2_1 (6912)"],
    "unit_count_range": {
        "min": min(read_le16(missions[m]['0_0']['data'], 2) for m in missions if '0_0' in missions[m]),
        "max": max(read_le16(missions[m]['0_0']['data'], 2) for m in missions if '0_0' in missions[m])
    }
}

# ============================================================
# Write output
# ============================================================
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f"Written to: {OUTPUT_PATH}")
print(f"File size: {OUTPUT_PATH.stat().st_size:,} bytes")
print(f"Missions documented: {len(inventory)}")
print(f"Total unit records parsed: {sum(len(v.get('units', [])) for mi in inventory.values() for v in mi.values())}")
