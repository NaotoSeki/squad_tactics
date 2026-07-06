"""
Phase 2: Refine CBE.EXE analysis - extract structured game mechanics data.
Reads the raw analysis from cbe_analysis.json and the binary directly,
producing a curated cbe_analysis.json with clearly labeled game data.
"""
import struct
import json
import io
import sys
import os
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

CBE_PATH = Path(r"D:\PL\CBE.EXE")
OUTPUT_DIR = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded")
OUTPUT_JSON = OUTPUT_DIR / "cbe_analysis.json"
PHASE1_JSON = OUTPUT_DIR / "cbe_analysis.json"


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

def decode_sjis(raw_bytes):
    try:
        return raw_bytes.decode('shift_jis')
    except (UnicodeDecodeError, ValueError):
        try:
            return raw_bytes.decode('cp932')
        except (UnicodeDecodeError, ValueError):
            return raw_bytes.decode('latin-1', errors='replace')


def read_null_terminated_strings(data, offset, sentinel=None, max_count=2000):
    """Read consecutive null-terminated strings from binary data."""
    strings = []
    pos = offset
    while pos < len(data) and len(strings) < max_count:
        end = data.find(b'\x00', pos)
        if end == -1 or end == pos:
            break
        raw = data[pos:end]
        try:
            text = decode_sjis(raw)
        except Exception:
            break
        if sentinel and text == sentinel:
            strings.append(text)
            break
        if not all(0x20 <= b <= 0x7E or (0x80 <= b <= 0xFF) for b in raw):
            break
        strings.append(text)
        pos = end + 1
    return strings


def extract_vehicle_names(data):
    """
    Extract the AFV (Armored Fighting Vehicle) name tables.
    These are at known offset in segment 157 around 0x2169d6.
    """
    # Find "(end AFV)" marker
    marker = b'(end AFV)'
    idx = data.find(marker)
    if idx == -1:
        return {'allied': [], 'axis': [], 'error': 'Could not find (end AFV) marker'}

    # The table starts after the marker + null byte
    table_start = idx + len(marker) + 1
    vehicles = read_null_terminated_strings(data, table_start, max_count=200)

    # Look for a second vehicle table (Axis vehicles)
    # Search for patterns like German vehicle names after US vehicles
    # The table at 0x21728e starts with PPK (German weapon) - so vehicles end before that
    
    # Split into Allied and Axis based on content patterns
    allied_vehicles = []
    axis_vehicles = []

    in_axis = False
    for v in vehicles:
        if v.startswith('Pz') or v.startswith('StuG') or v.startswith('Sd') or \
           v.startswith('SPW') or v.startswith('Jg') or v.startswith('Nashorn') or \
           v.startswith('Marder') or v.startswith('Tiger') or v.startswith('Panther') or \
           v.startswith('Hummel') or v.startswith('Wespe') or v.startswith('Brumm'):
            in_axis = True
        if v == '(end AFV)':
            break
        if in_axis:
            axis_vehicles.append(v)
        else:
            allied_vehicles.append(v)

    return {
        'all_vehicles': vehicles,
        'count': len(vehicles),
    }


def extract_weapon_names(data):
    """Extract weapon name tables (US and German)."""
    # US weapons start with M1911A1
    us_start = data.find(b'M1911A1\x00M1917 S&W')
    german_start = data.find(b'PPK\x00HSc\x00P38')

    us_weapons = []
    if us_start >= 0:
        us_weapons = read_null_terminated_strings(data, us_start, max_count=100)

    german_weapons = []
    if german_start >= 0:
        german_weapons = read_null_terminated_strings(data, german_start, max_count=300)

    # Russian weapons may follow
    ru_start = data.find(b'PM1910\x00DShK')
    ru_weapons = []
    if ru_start >= 0:
        ru_weapons = read_null_terminated_strings(data, ru_start, max_count=300)

    return {
        'us_weapons': us_weapons,
        'us_count': len(us_weapons),
        'german_weapons': german_weapons,
        'german_count': len(german_weapons),
        'russian_weapons': ru_weapons,
        'russian_count': len(ru_weapons),
    }


def extract_soldier_names(data):
    """Extract the soldier surname tables."""
    # US names start near "(EndName)" marker followed by surnames
    markers = []
    pos = 0
    while True:
        idx = data.find(b'(EndName)', pos)
        if idx == -1:
            break
        markers.append(idx)
        pos = idx + 9

    name_tables = []
    for marker_off in markers:
        # Names likely start after the marker
        start = marker_off + len(b'(EndName)') + 1
        names = read_null_terminated_strings(data, start, sentinel='(EndName)', max_count=1500)
        if len(names) > 10:
            name_tables.append({
                'offset': hex(marker_off),
                'count': len(names),
                'names': names,
            })

        # Also check if names are BEFORE the marker
        scan_back = marker_off - 1
        while scan_back > 0 and data[scan_back] == 0:
            scan_back -= 1
        # Go back to find the start of name list
        back_names = []
        scan_start = marker_off - 4000
        if scan_start < 0:
            scan_start = 0
        test_names = read_null_terminated_strings(data, scan_start, sentinel='(EndName)', max_count=1500)
        if len(test_names) > 50 and '(EndName)' in test_names:
            # Remove (EndName) from list
            test_names = [n for n in test_names if n != '(EndName)']
            if len(test_names) > len(names):
                name_tables.append({
                    'offset': hex(scan_start),
                    'count': len(test_names),
                    'names': test_names,
                })

    return name_tables


def extract_radio_messages(data):
    """Extract the radio message table (US military radio chatter)."""
    marker = b'US:...This is White Rook, over.'
    idx = data.find(marker)
    if idx == -1:
        return {'messages': [], 'error': 'Could not find radio message table'}

    # Scan backward to find start of table
    start = idx
    while start > 0:
        prev_null = data.rfind(b'\x00', 0, start)
        if prev_null == -1:
            break
        candidate = data[prev_null + 1:start]
        if len(candidate) > 0 and all(0x20 <= b <= 0x7E for b in candidate):
            start = prev_null + 1
        else:
            break

    messages = read_null_terminated_strings(data, start, max_count=500)
    return {
        'count': len(messages),
        'messages': messages,
    }


def extract_map_file_lists(data):
    """Extract map filename lists (.PLX and .IPF)."""
    plx_start = data.find(b'DMAP00.PLX')
    ipf_start = data.find(b'MAP00.IPF')

    plx_files = []
    if plx_start >= 0:
        plx_files = read_null_terminated_strings(data, plx_start, max_count=100)
        plx_files = [f for f in plx_files if '.PLX' in f]

    ipf_files = []
    if ipf_start >= 0:
        ipf_files = read_null_terminated_strings(data, ipf_start, max_count=100)
        ipf_files = [f for f in ipf_files if '.IPF' in f]

    return {
        'plx_map_files': plx_files,
        'ipf_map_files': ipf_files,
    }


def extract_event_names(data):
    """Extract campaign event/scenario names."""
    ev_start = data.find(b'EVETAFAR\x00')
    if ev_start == -1:
        return []
    events = read_null_terminated_strings(data, ev_start, max_count=50)
    events = [e for e in events if e.startswith('EV')]
    return events


def extract_command_system(data):
    """
    Extract command-related data:
    - Action modes: Stay, Aslt, Move, Warn, Wipe, Guard, Free, Quick, NoAct
    - Postures: Stand, Kneel, Prone, Down
    - Weapon states: JAM, BRK
    - Damage states: Dmg, LWA, WIA, HWA
    - Specialist types: Med, Sig, Eng
    - Sides: AXIS, ALLIES
    """
    results = {}

    # Action modes - exactly 9 known modes
    idx = data.find(b'Stay\x00Aslt\x00Move')
    if idx >= 0:
        modes = read_null_terminated_strings(data, idx, max_count=9)
        results['action_modes'] = modes[:9]

    # Postures - exactly 4
    idx = data.find(b'Stand\x00Kneel\x00Prone')
    if idx >= 0:
        postures = read_null_terminated_strings(data, idx, max_count=4)
        results['postures'] = postures[:4]

    # Vehicle type labels (found after postures)
    vtype_idx = data.find(b'\xe8\xa9\xb2\xb4\xd9\xce\xd4')  # 自動貨物 in SJIS
    if vtype_idx == -1:
        # Try finding by known sequence
        vtype_idx = data.find(b'Down \x00')
        if vtype_idx >= 0:
            vtype_idx += 6  # skip "Down \0"
            vtypes = read_null_terminated_strings(data, vtype_idx, max_count=20)
            vtypes_jp = [v for v in vtypes if any(0x80 <= b <= 0xFF for b in v.encode('shift_jis', errors='ignore'))]
            if vtypes_jp:
                results['vehicle_type_labels_jp'] = vtypes_jp

    # Weapon states - exactly 2
    idx = data.find(b'JAM\x00BRK\x00')
    if idx >= 0:
        results['weapon_states'] = ['JAM', 'BRK']

    # Damage states - English abbreviations
    idx = data.find(b'Dmg\x00LWA\x00WIA\x00HWA')
    if idx >= 0:
        scan = idx - 4
        states_en = read_null_terminated_strings(data, scan, max_count=12)
        states_en = [s.strip() for s in states_en if s.strip()]
        # Known damage states
        known = {'Dmg', 'LWA', 'WIA', 'HWA', 'CIA', 'KIA', 'MIA', 'AOL', 'DA', 'BCD', 'NEW'}
        results['damage_states_en'] = [s for s in states_en if s in known or s == '']

    # Damage states - Japanese
    idx_jp = data.find('カスリ傷'.encode('shift_jis'))
    if idx_jp >= 0:
        jp_states = read_null_terminated_strings(data, idx_jp, max_count=10)
        jp_states = [s for s in jp_states if any(0x80 <= b <= 0xFF for b in s.encode('shift_jis', errors='ignore'))]
        results['damage_states_jp'] = jp_states

    # Specialist types - exactly 3
    idx = data.find(b'Med\x00Sig\x00Eng')
    if idx >= 0:
        scan = idx
        while scan > 0 and data[scan - 1] != 0:
            scan -= 1
        specs = read_null_terminated_strings(data, scan, max_count=5)
        prefix = [s for s in specs if s in ('', '---')]
        actual = [s for s in specs if s in ('Med', 'Sig', 'Eng')]
        results['specialist_types'] = prefix + actual if prefix else actual

    # Sides
    idx = data.find(b'AXIS\x00ALLIES\x00')
    if idx >= 0:
        results['sides'] = ['AXIS', 'ALLIES']

    # Phase labels
    idx = data.find(b'PhE\x00Rfc')
    if idx >= 0:
        scan = max(0, idx - 8)
        phases_raw = read_null_terminated_strings(data, scan, max_count=20)
        if not phases_raw:
            phases_raw = read_null_terminated_strings(data, idx, max_count=20)
        # Keep only phase-related labels
        phase_labels = []
        for p in phases_raw:
            p_stripped = p.strip()
            if p_stripped in ('PhE', 'Rfc', 'HtH', 'Spt', 'Bom', 'Flm', 'Turn', 'Phase', ''):
                phase_labels.append(p_stripped)
            elif p_stripped.startswith('%'):
                continue
            else:
                break
        results['phase_labels'] = [p for p in phase_labels if p]

    # Japanese posture command labels from menus/resources
    fire_disable_idx = data.find('走行不能'.encode('shift_jis'))
    if fire_disable_idx >= 0:
        results['vehicle_disabled_label'] = '走行不能'

    return results


def extract_vehicle_model_table(data):
    """
    Extract the vehicle TDD model filename table with both allied (2-prefixed)
    and standard versions.
    """
    tdd_tables = {}

    # Infantry models
    idx = data.find(b'MANSTY.TDD')
    if idx >= 0:
        models = read_null_terminated_strings(data, idx, max_count=30)
        models = [m for m in models if '.TDD' in m]
        tdd_tables['infantry_models'] = models

    # Explosion/bomb effects
    idx = data.find(b'2BOMGND.TDD')
    if idx >= 0:
        models = read_null_terminated_strings(data, idx, max_count=10)
        models = [m for m in models if '.TDD' in m]
        tdd_tables['explosion_models'] = models

    # Shot models
    idx = data.find(b'2SHOTS.TDD')
    if idx >= 0:
        models = read_null_terminated_strings(data, idx, max_count=10)
        models = [m for m in models if '.TDD' in m]
        tdd_tables['shot_models'] = models

    # Vehicle hex models
    idx = data.find(b'2VCHEX.TDD')
    if idx >= 0:
        models = read_null_terminated_strings(data, idx, max_count=10)
        models = [m for m in models if '.TDD' in m]
        tdd_tables['vehicle_hex_models'] = models

    # Vehicle ID/designation tables
    # M3LT, M5LT etc - vehicle short codes that map to TDD files
    idx = data.find(b'M3LT\x00M5LT')
    if idx >= 0:
        # Go back to capture any prefix
        scan = max(0, idx - 16)
        codes = read_null_terminated_strings(data, scan, max_count=100)
        # Keep only entries that look like vehicle codes
        codes = [c for c in codes if len(c) >= 2 and len(c) <= 20]
        tdd_tables['vehicle_codes_us'] = codes

    # Axis vehicle codes with 2-prefix
    idx = data.find(b'2M3LT\x002M5LT')
    if idx >= 0:
        codes = read_null_terminated_strings(data, idx, max_count=100)
        codes = [c for c in codes if len(c) >= 2 and len(c) <= 20]
        tdd_tables['vehicle_codes_2prefix'] = codes

    return tdd_tables


def extract_sound_references(data):
    """Extract WAV sound effect references."""
    results = []
    pos = 0
    while True:
        idx = data.find(b'.WAV', pos)
        if idx == -1:
            break
        start = idx
        while start > 0 and 0x20 <= data[start - 1] <= 0x7E:
            start -= 1
            if idx - start > 50:
                break
        if start < idx:
            name = data[start:idx + 4].decode('ascii', errors='replace')
            if len(name) >= 4:
                results.append(name)
        pos = idx + 4
    return sorted(set(results))


def scan_segment_for_structured_tables(data, offset, length):
    """
    Look for structured record arrays in data segments.
    Specifically look for tables of fixed-size records.
    """
    seg_data = data[offset:offset + length]
    results = []

    # Look for arrays of structs where fields have game-relevant ranges
    # Typical: movement_cost(1-10), defense(0-5), LOS_modifier(0-3), etc.
    for record_size in [4, 6, 8, 10, 12, 16, 20, 24]:
        for start in range(0, min(len(seg_data) - record_size * 8, 1000)):
            records = []
            valid = True
            for r in range(20):
                rec_start = start + r * record_size
                if rec_start + record_size > len(seg_data):
                    break
                rec = list(seg_data[rec_start:rec_start + record_size])
                # Check if record looks like game data (not all zeros, not all same)
                if all(v == 0 for v in rec):
                    break
                if all(v == rec[0] for v in rec):
                    break
                # Values should be in reasonable game-data ranges
                if any(v > 200 for v in rec):
                    valid = False
                    break
                records.append(rec)

            if valid and 8 <= len(records) <= 30:
                flat = [v for rec in records for v in rec]
                unique_ratio = len(set(flat)) / len(flat) if flat else 0
                if 0.05 < unique_ratio < 0.8:
                    results.append({
                        'offset_in_segment': start,
                        'abs_offset': hex(offset + start),
                        'record_size': record_size,
                        'record_count': len(records),
                        'records': records[:15],
                    })

    # Deduplicate by taking non-overlapping candidates with best structure
    seen = set()
    deduped = []
    for r in sorted(results, key=lambda x: (-x['record_count'], x['record_size'])):
        key = r['offset_in_segment'] // 8
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    return deduped[:20]


def extract_format_strings(data):
    """Extract printf-style format strings that reveal game data structures."""
    results = []
    interesting = [
        b'Hit: %3d',
        b'Prc: %3d',
        b'Wgt:',
        b'Rate %d%% Prc %d%%',
        b'Tn%2d/Ph%d',
        b'BF:%3d',
        b'Body:%d/%d',
        b'Amn',
        b'(X:%2d,Y:%2d)',
    ]
    for pat in interesting:
        idx = data.find(pat)
        if idx >= 0:
            end = data.find(b'\x00', idx)
            if end >= 0 and end - idx < 200:
                text = data[idx:end].decode('ascii', errors='replace')
                results.append({
                    'offset': hex(idx),
                    'format': text,
                })
    return results


def main():
    print("=" * 80)
    print("CBE.EXE Phase 2 - Structured Game Mechanics Extraction")
    print("=" * 80)

    # Load phase 1 results
    print("\nLoading Phase 1 analysis...")
    with open(PHASE1_JSON, 'r', encoding='utf-8') as f:
        phase1 = json.load(f)

    # Load binary
    print(f"Reading {CBE_PATH}...")
    with open(CBE_PATH, 'rb') as f:
        data = f.read()

    print(f"  Size: {len(data):,} bytes")

    # Extract structured data
    print("\n[1] Extracting vehicle (AFV) name table...")
    vehicles = extract_vehicle_names(data)
    print(f"  Found {vehicles.get('count', 0)} vehicles")

    print("\n[2] Extracting weapon name tables...")
    weapons = extract_weapon_names(data)
    print(f"  US weapons:      {weapons['us_count']}")
    print(f"  German weapons:  {weapons['german_count']}")
    print(f"  Russian weapons: {weapons['russian_count']}")

    print("\n[3] Extracting soldier name tables...")
    soldier_names = extract_soldier_names(data)
    for i, tbl in enumerate(soldier_names):
        print(f"  Table {i}: {tbl['count']} names at {tbl['offset']}")

    print("\n[4] Extracting radio messages...")
    radio = extract_radio_messages(data)
    print(f"  Found {radio['count']} messages")
    for msg in radio['messages'][:10]:
        print(f"    {msg}")

    print("\n[5] Extracting command system labels...")
    commands = extract_command_system(data)
    for key, vals in commands.items():
        print(f"  {key}: {vals}")

    print("\n[6] Extracting TDD model file tables...")
    tdd_models = extract_vehicle_model_table(data)
    for key, vals in tdd_models.items():
        print(f"  {key}: {len(vals)} entries")
        for v in vals[:5]:
            print(f"    {v}")

    print("\n[7] Extracting map file lists...")
    maps = extract_map_file_lists(data)
    print(f"  PLX files: {len(maps['plx_map_files'])}")
    print(f"  IPF files: {len(maps['ipf_map_files'])}")

    print("\n[8] Extracting event/scenario names...")
    events = extract_event_names(data)
    print(f"  Found {len(events)} events: {events}")

    print("\n[9] Extracting sound references...")
    sounds = extract_sound_references(data)
    print(f"  Found {len(sounds)} unique .WAV references")

    print("\n[10] Extracting format strings (game data structure hints)...")
    fmt_strings = extract_format_strings(data)
    for fs in fmt_strings:
        print(f"  {fs['offset']}: {fs['format']}")

    print("\n[11] Scanning key data segments for structured tables...")
    key_segments = []
    for seg_info in phase1.get('segments', []):
        seg_len = seg_info['length']
        seg_off_str = seg_info['offset']
        seg_off = int(seg_off_str, 16)
        if seg_info['type'] == 'DATA' and 100 <= seg_len <= 10000 and seg_off > 0:
            key_segments.append(seg_info)

    structured_tables = []
    for seg_info in key_segments[:30]:
        seg_off = int(seg_info['offset'], 16)
        seg_len = seg_info['length']
        tables = scan_segment_for_structured_tables(data, seg_off, seg_len)
        if tables:
            for t in tables:
                t['segment'] = seg_info['index']
            structured_tables.extend(tables)
            print(f"  Seg {seg_info['index']} ({seg_info['offset']}, {seg_len}B): "
                  f"{len(tables)} candidate table(s)")

    # Build enhanced report
    print("\n\nBuilding enhanced JSON report...")

    # Keep essential parts from Phase 1 but restructure
    report = {
        '_meta': phase1['_meta'],
        '_meta_phase2': {
            'description': 'Phase 2: Curated game mechanics extraction',
            'sections': [
                'ne_header', 'segments', 'resource_summary',
                'rt_strings', 'menus', 'dialogs',
                'game_data.command_system', 'game_data.vehicles',
                'game_data.weapons', 'game_data.soldier_names',
                'game_data.radio_messages', 'game_data.tdd_models',
                'game_data.maps', 'game_data.events',
                'game_data.sounds', 'game_data.format_strings',
                'game_data.structured_tables',
            ],
        },

        'ne_header': phase1['ne_header'],
        'segments': phase1['segments'],
        'resource_summary': phase1['resource_summary'],

        'rt_strings': phase1.get('strings', phase1.get('rt_strings', {})),

        'menus': phase1['menus'],
        'dialogs': phase1['dialogs'],

        'game_data': {
            'command_system': commands,
            'vehicles': vehicles,
            'weapons': weapons,
            'soldier_names': [
                {
                    'offset': tbl['offset'],
                    'count': tbl['count'],
                    'sample': tbl['names'][:50],
                    'all_names': tbl['names'],
                }
                for tbl in soldier_names
            ],
            'radio_messages': radio,
            'tdd_models': tdd_models,
            'maps': maps,
            'events': events,
            'sounds': sounds,
            'format_strings': fmt_strings,
            'structured_tables': structured_tables[:30],
        },

        'file_references': phase1['file_references'],
        'resident_names': phase1.get('resident_names', []),
        'imported_names': phase1.get('imported_names', []),
    }

    # Write JSON
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    size = os.path.getsize(OUTPUT_JSON)
    print(f"\n{'=' * 80}")
    print(f"Enhanced report written to: {OUTPUT_JSON}")
    print(f"  File size: {size:,} bytes")
    print(f"{'=' * 80}")

    # Print final summary
    print(f"\n=== GAME MECHANICS SUMMARY ===")
    print(f"")
    print(f"COMMAND SYSTEM:")
    for key, vals in commands.items():
        print(f"  {key}: {vals}")
    print(f"")
    print(f"VEHICLES (AFV): {vehicles.get('count', 0)} total")
    if vehicles.get('all_vehicles'):
        for v in vehicles['all_vehicles'][:20]:
            print(f"  - {v}")
        if len(vehicles['all_vehicles']) > 20:
            print(f"  ... and {len(vehicles['all_vehicles']) - 20} more")
    print(f"")
    print(f"WEAPONS:")
    print(f"  US:      {weapons['us_count']} ({', '.join(weapons['us_weapons'][:5])}...)")
    print(f"  German:  {weapons['german_count']} ({', '.join(weapons['german_weapons'][:5])}...)")
    print(f"  Russian: {weapons['russian_count']} ({', '.join(weapons['russian_weapons'][:5])}...)")
    print(f"")
    print(f"RADIO MESSAGES: {radio['count']}")
    print(f"MAP FILES: {len(maps['plx_map_files'])} PLX + {len(maps['ipf_map_files'])} IPF")
    print(f"EVENTS: {events}")
    print(f"SOUND EFFECTS: {len(sounds)} unique .WAV files")
    print(f"STRUCTURED DATA TABLES: {len(structured_tables)} candidates")


if __name__ == '__main__':
    main()
