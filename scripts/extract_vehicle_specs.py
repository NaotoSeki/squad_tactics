"""
Extract vehicle specification data from CBE.EXE (Platoon Leader, 1997 SEGA/TechnoBrain).

Strategy:
1. Read known vehicle name tables (code names + display names)
2. Systematically search for stat arrays indexed by vehicle
3. Cross-reference with historical WW2 armor/penetration values
4. Output comprehensive vehicle_specs.json
"""
import struct
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

CBE_PATH = Path(r"D:\PL\CBE.EXE")
OUTPUT_DIR = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded")
OUTPUT_JSON = OUTPUT_DIR / "vehicle_specs.json"


def u8(data, off):
    return data[off] if off < len(data) else 0

def u16(data, off):
    if off + 2 > len(data): return 0
    return struct.unpack_from('<H', data, off)[0]

def s16(data, off):
    if off + 2 > len(data): return 0
    return struct.unpack_from('<h', data, off)[0]

def decode_sjis(raw):
    try: return raw.decode('shift_jis')
    except: return raw.decode('cp932', errors='replace')


def read_null_strings(data, offset, max_count=200, stopper=None):
    strings = []
    pos = offset
    while pos < len(data) and len(strings) < max_count:
        end = data.find(b'\x00', pos)
        if end == -1 or end == pos:
            break
        raw = data[pos:end]
        if not all(0x20 <= b <= 0x7E or (0x80 <= b <= 0xFF) for b in raw):
            break
        try:
            text = decode_sjis(raw)
        except:
            break
        if stopper and text == stopper:
            strings.append(text)
            break
        strings.append(text)
        pos = end + 1
    return strings


def extract_vehicle_tables(data):
    """Extract all vehicle-related name tables."""
    # Code names at 0x20FD36
    code_start = 0x20FD36
    codes = []
    pos = code_start
    while pos < code_start + 600:
        end = data.find(b'\x00', pos)
        if end == -1 or end == pos: break
        raw = data[pos:end]
        text = raw.decode('ascii', errors='replace')
        if '.TDD' in text or text.startswith('2'): break
        if all(0x20 <= b <= 0x7E for b in raw) and len(raw) >= 2:
            codes.append({'offset': pos, 'name': text})
        else:
            break
        pos = end + 1

    # Display names after (end AFV) marker
    marker_idx = data.find(b'(end AFV)')
    display_names = []
    if marker_idx >= 0:
        table_start = marker_idx + len(b'(end AFV)') + 1
        pos = table_start
        while pos < table_start + 5000:
            end = data.find(b'\x00', pos)
            if end == -1 or end == pos: break
            raw = data[pos:end]
            try:
                text = decode_sjis(raw)
                if text == '(end AFV)':
                    break
                display_names.append({'offset': pos, 'name': text})
            except:
                break
            pos = end + 1

    # 2-prefix TDD model codes
    prefix_start = data.find(b'2M3LT\x00')
    prefix_codes = []
    if prefix_start >= 0:
        pos = prefix_start
        while pos < prefix_start + 1000:
            end = data.find(b'\x00', pos)
            if end == -1 or end == pos: break
            raw = data[pos:end]
            text = raw.decode('ascii', errors='replace')
            if not text.startswith('2'): break
            if all(0x20 <= b <= 0x7E for b in raw) and len(raw) >= 2:
                prefix_codes.append({'offset': pos, 'name': text})
            else:
                break
            pos = end + 1

    return codes, display_names, prefix_codes


def search_stat_arrays(data, num_vehicles, label=""):
    """Search for arrays of values that could be vehicle stats."""
    results = []
    
    # Search for u8 arrays of length num_vehicles
    for start in range(0, len(data) - num_vehicles):
        arr = list(data[start:start + num_vehicles])
        if all(v == 0 for v in arr): continue
        if all(v == 0xFF for v in arr): continue
        
        # Check for armor-like pattern:
        # - Mostly values 0-200
        # - Not all the same
        # - Some values in 30-150 range (typical armor thickness)
        if max(arr) > 200: continue
        unique = len(set(arr))
        if unique < 5: continue
        
        armor_range = sum(1 for v in arr if 20 <= v <= 150)
        if armor_range < num_vehicles * 0.4: continue
        
        # Check if German heavies (at positions ~24-28 for 45-entry table) have highest values
        if num_vehicles == 45:
            us_max = max(arr[:17]) if max(arr[:17]) > 0 else 1
            ger_heavy = arr[24:29]  # PzKpfw V/VI
            if len(ger_heavy) >= 5 and max(ger_heavy) > us_max * 0.8:
                # Additional check: lighter vehicles should have lower values
                light_vals = [arr[2], arr[13], arr[14]]  # M8, M3_HT1, GMC_15T
                heavy_vals = [arr[8], arr[9], arr[27], arr[28]]  # M4A3E2, M26, Tiger, Tiger II
                if all(v > 0 for v in heavy_vals):
                    if sum(heavy_vals) / len(heavy_vals) > sum(light_vals) / max(len(light_vals), 1):
                        results.append({
                            'offset': start,
                            'type': 'u8',
                            'values': arr,
                            'score': max(ger_heavy) - min(light_vals) if min(light_vals) > 0 else max(ger_heavy),
                        })
    
    # Search for u16 arrays
    for start in range(0, len(data) - num_vehicles * 2, 2):
        arr = [u16(data, start + i * 2) for i in range(num_vehicles)]
        if all(v == 0 for v in arr): continue
        if max(arr) > 500: continue
        unique = len(set(arr))
        if unique < 5: continue
        
        armor_range = sum(1 for v in arr if 10 <= v <= 200)
        if armor_range < num_vehicles * 0.4: continue
        
        if num_vehicles == 45:
            us_max = max(arr[:17]) if max(arr[:17]) > 0 else 1
            ger_heavy = arr[24:29]
            if len(ger_heavy) >= 5 and max(ger_heavy) >= 80:
                light_vals = [arr[2], arr[13], arr[14]]
                heavy_vals = [arr[8], arr[9], arr[27], arr[28]]
                if all(v > 0 for v in heavy_vals):
                    avg_heavy = sum(heavy_vals) / len(heavy_vals)
                    avg_light = sum(light_vals) / max(len([v for v in light_vals if v > 0]), 1)
                    if avg_heavy > avg_light:
                        results.append({
                            'offset': start,
                            'type': 'u16',
                            'values': arr,
                            'score': max(ger_heavy),
                        })
    
    return sorted(results, key=lambda x: -x['score'])[:20]


def search_record_arrays(data, num_vehicles, codes):
    """Search for fixed-size record arrays where one field matches expected armor values."""
    results = []
    
    # Known approximate frontal armor (mm) for validation
    # Index: vehicle code index -> approximate frontal armor
    expected_front = {
        0: 44, 1: 64, 2: 25, 5: 51, 6: 63, 8: 102, 9: 102,
        10: 51, 17: 35, 18: 50, 19: 70, 22: 80, 23: 80,
        24: 80, 25: 80, 26: 80, 27: 100, 28: 150
    }
    
    for rec_size in [8, 10, 12, 16, 20, 24, 28, 32, 36, 40, 48, 64]:
        total_size = num_vehicles * rec_size
        for start in range(0x20E000, min(len(data) - total_size, 0x220000)):
            # Quick validation: check a few key records
            tiger1_rec = data[start + 27 * rec_size:start + 28 * rec_size]
            tiger2_rec = data[start + 28 * rec_size:start + 29 * rec_size]
            m8_rec = data[start + 2 * rec_size:start + 3 * rec_size]
            
            if all(b == 0 for b in tiger1_rec): continue
            if all(b == 0xFF for b in tiger1_rec): continue
            
            # Check each byte offset within the record for armor-like field
            for field_off in range(rec_size):
                tiger1_val = tiger1_rec[field_off] if field_off < len(tiger1_rec) else 0
                tiger2_val = tiger2_rec[field_off] if field_off < len(tiger2_rec) else 0
                m8_val = m8_rec[field_off] if field_off < len(m8_rec) else 0
                
                # Tiger I should be ~100, Tiger II ~150, M8 should be ~25
                if 90 <= tiger1_val <= 110 and 130 <= tiger2_val <= 180 and m8_val < 40:
                    # Validate more entries
                    match_count = 0
                    for idx, expected in expected_front.items():
                        if idx >= num_vehicles: continue
                        actual = data[start + idx * rec_size + field_off]
                        if abs(actual - expected) <= expected * 0.3:
                            match_count += 1
                    
                    if match_count >= 8:
                        records = []
                        for i in range(num_vehicles):
                            rec = data[start + i * rec_size:start + (i+1) * rec_size]
                            records.append(list(rec))
                        results.append({
                            'offset': start,
                            'rec_size': rec_size,
                            'field_offset': field_off,
                            'match_count': match_count,
                            'tiger1_val': tiger1_val,
                            'tiger2_val': tiger2_val,
                            'records': records,
                        })
    
    # Also try u16 fields within records
    for rec_size in [8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 64]:
        total_size = num_vehicles * rec_size
        for start in range(0x20E000, min(len(data) - total_size, 0x220000)):
            tiger1_off = start + 27 * rec_size
            tiger2_off = start + 28 * rec_size
            m8_off = start + 2 * rec_size
            
            for field_off in range(0, rec_size - 1, 2):
                t1 = u16(data, tiger1_off + field_off)
                t2 = u16(data, tiger2_off + field_off)
                m8v = u16(data, m8_off + field_off)
                
                if 90 <= t1 <= 110 and 130 <= t2 <= 180 and m8v < 40:
                    match_count = 0
                    for idx, expected in expected_front.items():
                        if idx >= num_vehicles: continue
                        actual = u16(data, start + idx * rec_size + field_off)
                        if abs(actual - expected) <= expected * 0.35:
                            match_count += 1
                    
                    if match_count >= 8:
                        records = []
                        for i in range(num_vehicles):
                            rec_off = start + i * rec_size
                            u16_vals = [u16(data, rec_off + j) for j in range(0, rec_size, 2)]
                            records.append(u16_vals)
                        results.append({
                            'offset': start,
                            'rec_size': rec_size,
                            'field_offset': field_off,
                            'field_type': 'u16',
                            'match_count': match_count,
                            'tiger1_val': t1,
                            'tiger2_val': t2,
                            'records': records,
                        })
    
    return sorted(results, key=lambda x: -x['match_count'])[:10]


def search_parallel_arrays(data, num_vehicles):
    """Search for parallel column arrays (all frontal armor, then all side armor, etc.)."""
    results = []
    
    expected_front = {
        0: 44, 1: 64, 2: 25, 5: 51, 6: 63, 8: 102, 9: 102,
        10: 51, 17: 35, 18: 50, 19: 70, 22: 80, 23: 80,
        24: 80, 25: 80, 26: 80, 27: 100, 28: 150
    }
    
    # u8 parallel arrays
    for start in range(0, len(data) - num_vehicles):
        arr = list(data[start:start + num_vehicles])
        if max(arr) > 200 or max(arr) < 30: continue
        if len(set(arr)) < 5: continue
        
        match_count = 0
        for idx, expected in expected_front.items():
            if idx >= num_vehicles: continue
            if abs(arr[idx] - expected) <= max(expected * 0.3, 10):
                match_count += 1
        
        if match_count >= 10:
            # Check if next num_vehicles bytes could be side armor
            next_arr = list(data[start + num_vehicles:start + 2 * num_vehicles])
            if len(next_arr) == num_vehicles and max(next_arr) <= 200:
                side_reasonable = all(next_arr[i] <= arr[i] + 10 for i in range(min(17, num_vehicles)) if arr[i] > 0)
            else:
                side_reasonable = False
            
            results.append({
                'offset': start,
                'type': 'u8_parallel',
                'match_count': match_count,
                'values': arr,
                'next_array_is_side': side_reasonable,
                'next_values': next_arr if len(next_arr) == num_vehicles else [],
            })
    
    # u16 parallel arrays
    for start in range(0, len(data) - num_vehicles * 2, 2):
        arr = [u16(data, start + i * 2) for i in range(num_vehicles)]
        if max(arr) > 300 or max(arr) < 30: continue
        if len(set(arr)) < 5: continue
        
        match_count = 0
        for idx, expected in expected_front.items():
            if idx >= num_vehicles: continue
            if abs(arr[idx] - expected) <= max(expected * 0.3, 10):
                match_count += 1
        
        if match_count >= 10:
            results.append({
                'offset': start,
                'type': 'u16_parallel',
                'match_count': match_count,
                'values': arr,
            })
    
    return sorted(results, key=lambda x: -x['match_count'])[:10]


def extract_numeric_area(data, start, length, num_vehicles):
    """Extract and structure a numeric area as potential vehicle stat data."""
    bytes_per_vehicle = length // num_vehicles
    records = []
    for i in range(num_vehicles):
        off = start + i * bytes_per_vehicle
        rec_bytes = data[off:off + bytes_per_vehicle]
        u8_vals = list(rec_bytes)
        u16_vals = [u16(data, off + j) for j in range(0, bytes_per_vehicle, 2)]
        records.append({
            'u8': u8_vals,
            'u16': u16_vals,
            'hex': rec_bytes.hex(),
        })
    return records


def main():
    print("=" * 80)
    print("Vehicle Specification Extraction - Platoon Leader CBE.EXE")
    print("=" * 80)

    data = open(CBE_PATH, 'rb').read()
    print(f"File: {CBE_PATH} ({len(data):,} bytes)")

    # Step 1: Extract name tables
    print("\n[1] Extracting vehicle name tables...")
    codes, display_names, prefix_codes = extract_vehicle_tables(data)
    print(f"  Code names:    {len(codes)} entries")
    print(f"  Display names: {len(display_names)} entries")
    print(f"  2-prefix codes: {len(prefix_codes)} entries")

    num_codes = len(codes)
    num_display = len(display_names)

    # Step 2: Search for structured record arrays
    print(f"\n[2] Searching for {num_codes}-entry record arrays near vehicle data...")
    record_results = search_record_arrays(data, num_codes, codes)
    if record_results:
        print(f"  Found {len(record_results)} candidates!")
        for r in record_results[:5]:
            ft = r.get('field_type', 'u8')
            print(f"    offset=0x{r['offset']:06X} rec_size={r['rec_size']} "
                  f"field_off={r['field_offset']} ({ft}) "
                  f"matches={r['match_count']} "
                  f"Tiger I={r['tiger1_val']} Tiger II={r['tiger2_val']}")
    else:
        print("  No strong record array candidates found in 0x20E000-0x220000")

    # Step 3: Search parallel arrays
    print(f"\n[3] Searching for {num_codes}-entry parallel arrays in entire binary...")
    parallel_results = search_parallel_arrays(data, num_codes)
    if parallel_results:
        print(f"  Found {len(parallel_results)} candidates!")
        for r in parallel_results[:5]:
            print(f"    offset=0x{r['offset']:06X} type={r['type']} "
                  f"matches={r['match_count']}")
            vals = r['values']
            print(f"      M3LT={vals[0]} M5LT={vals[1]} M8={vals[2]} "
                  f"M4A3={vals[6]} M4A3E2={vals[8]} M26={vals[9]}")
            print(f"      PzIII-J={vals[18]} PzIV-H={vals[23]} "
                  f"Panther={vals[24]} Tiger-I={vals[27]} Tiger-II={vals[28]}")
            if r.get('next_array_is_side'):
                next_vals = r['next_values']
                print(f"      [next arr] M3LT={next_vals[0]} Tiger-I={next_vals[27]} Tiger-II={next_vals[28]}")
    else:
        print("  No strong parallel array candidates found")

    # Step 4: Analyze the known numeric area at 0x21005C
    print(f"\n[4] Analyzing numeric area at 0x21005C (after 2-prefix table)...")
    num_area_start = 0x21005C
    num_area_end = 0x21019C
    num_area_len = num_area_end - num_area_start  # 320 bytes
    print(f"  Size: {num_area_len} bytes")
    
    # Try as 49-entry table (matching 2-prefix count) x various sizes
    for rec_size in [4, 6, 8]:
        count = num_area_len // rec_size
        print(f"  As {count} records x {rec_size} bytes:")
        for i in range(min(count, 10)):
            off = num_area_start + i * rec_size
            vals = [u16(data, off + j) for j in range(0, rec_size, 2)]
            code = prefix_codes[i]['name'] if i < len(prefix_codes) else '???'
            print(f"    [{i:2d}] {code:12s}: {vals}")
    
    # Step 5: Look for weapon penetration tables  
    print(f"\n[5] Analyzing weapon/armor penetration data at 0x071E88...")
    pen_start = 0x071E88
    block_size = 97  # 96 data + 1 null
    
    block_count = 0
    current = pen_start
    blocks = []
    while current + block_size <= len(data) and block_count < 20:
        block = data[current:current + 96]
        if all(b == 0 for b in block):
            break
        blocks.append({
            'offset': current,
            'values': list(block),
        })
        current += block_size
        block_count += 1
    
    print(f"  Found {len(blocks)} penetration data blocks (96 bytes each)")
    
    # Step 6: Build comprehensive vehicle database
    print("\n[6] Building vehicle database...")
    
    # Map code names to display names
    vehicles = []
    for i, code in enumerate(codes):
        display = display_names[i]['name'] if i < len(display_names) else code['name']
        prefix = prefix_codes[i]['name'] if i < len(prefix_codes) else f"2{code['name']}"
        
        # Determine side
        if i < 17:
            side = "US"
        elif i < 17 + 11:
            side = "Germany"  # tanks
        else:
            side = "Germany"  # other vehicles
        
        # Determine vehicle type
        name = code['name']
        if 'LT' in name or 'M3LT' in name or 'M5LT' in name:
            vtype = "light_tank"
        elif 'MT' in name or 'M4' in name:
            vtype = "medium_tank"
        elif name in ('M26',):
            vtype = "heavy_tank"
        elif name in ('M10', 'M36', 'M3_GMC'):
            vtype = "tank_destroyer"
        elif 'HT' in name or 'SPW' in name:
            vtype = "halftrack"
        elif name in ('GMC_15T', 'OPEL_BT'):
            vtype = "truck"
        elif 'ATG' in name or 'PAK' in name or 'FLAK' in name or '3INM5' in name:
            vtype = "towed_gun"
        elif name in ('M8',) or 'PSW' in name or 'SPW234' in name:
            vtype = "armored_car"
        elif 'PZKW5' in name:
            vtype = "medium_tank"  # Panther
        elif 'PZKW6' in name:
            vtype = "heavy_tank"
        elif 'PZKW' in name:
            vtype = "medium_tank"
        elif 'STG' in name or 'STUH' in name or 'STPZ' in name or 'MARDER' in name or 'JGDPZ' in name:
            vtype = "assault_gun"
        elif name in ('FT17', 'L5_30'):
            vtype = "light_tank"
        else:
            vtype = "unknown"
        
        # Approximate historical specs
        hist = get_historical_specs(name)
        
        vehicle = {
            'index': i,
            'id': name,
            'display_name': display,
            'tdd_code': prefix,
            'side': side,
            'type': vtype,
            'code_offset': f"0x{code['offset']:06X}",
            'display_offset': f"0x{display_names[i]['offset']:06X}" if i < len(display_names) else None,
            'historical_reference': hist,
        }
        
        # Add stat data from parallel arrays if found
        if parallel_results:
            best = parallel_results[0]
            vehicle['stats'] = {
                'armor_front_candidate': best['values'][i],
            }
            if best.get('next_array_is_side'):
                vehicle['stats']['armor_side_candidate'] = best['next_values'][i]
        
        vehicles.append(vehicle)
    
    # Add British vehicles from display name table (indices 57-70)
    brit_start_idx = len(codes)
    for i in range(brit_start_idx, len(display_names)):
        dn = display_names[i]
        if dn['name'] == '(end AFV)':
            break
        side = "UK" if any(k in dn['name'] for k in ('A15', 'A22', 'Lee', 'Sherman', 'Bedford', 'OQF', 'MMG Carrier', 'HTPC', 'Mk')) else "Germany"
        vehicles.append({
            'index': i,
            'id': f"BRIT_{i-brit_start_idx:02d}",
            'display_name': dn['name'],
            'tdd_code': None,
            'side': side,
            'type': 'unknown',
            'code_offset': None,
            'display_offset': f"0x{dn['offset']:06X}",
            'historical_reference': {},
        })
    
    # Step 7: Extract the u16 numeric area data and associate with vehicles
    print(f"\n[7] Associating numeric data with vehicles...")
    
    # The data at 0x21005C: 320 bytes = 80 u16 values
    # 80 / 2 = 40 pairs (too few for 45 vehicles)
    # But 320 / 4 = 80 bytes per column if we have 4 columns
    # OR: it could be indexed differently
    
    # Let's try: this is 2 separate tables of 40 entries each
    # OR: this is some kind of lookup indexed by something else
    
    # Actually, let me check if it's 49 entries x ~6-7 bytes
    # 320 / 49 = 6.53... Not clean.
    # 320 / 45 = 7.11... Not clean either.
    # But 320 / 40 = 8 (4 x u16 per entry)
    
    # Interpret as 40 entries of 4 u16 values
    u16_table = []
    for i in range(40):
        off = 0x21005C + i * 8
        vals = [u16(data, off + j) for j in range(0, 8, 2)]
        u16_table.append({
            'index': i,
            'offset': f"0x{off:06X}",
            'values': vals,
        })
    
    # Step 8: Extract the penetration lookup area  
    print(f"\n[8] Extracting penetration/armor lookup tables...")
    pen_tables = []
    for block in blocks:
        vals = block['values']
        pen_tables.append({
            'offset': f"0x{block['offset']:06X}",
            'data': vals,
            'interpretation': interpret_pen_block(vals),
        })
    
    # Step 9: Raw data dump of key areas
    print(f"\n[9] Dumping raw data for unidentified stat areas...")
    
    raw_areas = {}
    # Area before vehicle codes in Seg 157
    raw_areas['seg157_pre_codes'] = {
        'offset': '0x20EDC0',
        'length': 0x20FD36 - 0x20EDC0,
        'description': 'Data before vehicle code table in Seg 157',
    }
    # Area between code table end and 2-prefix table
    raw_areas['between_codes_and_prefix'] = {
        'offset': '0x20FE54',
        'length': 0x20FEF2 - 0x20FE54,
        'description': 'TDD file references between code table and 2-prefix table',
    }
    # Numeric area after 2-prefix
    raw_areas['numeric_after_prefix'] = {
        'offset': '0x21005C',
        'length': 0x21019C - 0x21005C,
        'description': 'Numeric u16 data after 2-prefix table (320 bytes)',
        'data_u16': [u16(data, 0x21005C + i*2) for i in range(160)],
    }
    
    # Build final output
    report = {
        '_meta': {
            'source_file': str(CBE_PATH),
            'file_size': len(data),
            'description': 'Vehicle specifications extracted from Platoon Leader CBE.EXE',
            'game': 'Platoon Leader (1997 SEGA/TechnoBrain)',
            'format_notes': {
                'armor_structure': 'BF=Body Front, BS=Body Side, BR=Body Rear, BU=Body Upper, TF=Turret Front, TS=Turret Side, TR=Turret Rear, TU=Turret Upper',
                'weapon_stats': 'Weight(kg), Initial Penetration, Pen Degradation Rate, Initial Hit Rate, Shots per Turn, Hit Degradation, Malfunction Rate',
                'penetration_display': 'Hit: %3d %3d %3d %3d  /  Prc: %3d %3d %3d %3d (4 range brackets)',
            },
        },
        'name_tables': {
            'code_names': {
                'offset': '0x20FD36',
                'count': len(codes),
                'entries': [c['name'] for c in codes],
            },
            'display_names': {
                'offset': f"0x{display_names[0]['offset']:06X}" if display_names else None,
                'count': len(display_names),
                'entries': [d['name'] for d in display_names],
            },
            'tdd_prefix_codes': {
                'offset': f"0x{prefix_codes[0]['offset']:06X}" if prefix_codes else None,
                'count': len(prefix_codes),
                'entries': [p['name'] for p in prefix_codes],
            },
        },
        'vehicles': vehicles,
        'numeric_data': {
            'u16_table_after_prefix': u16_table,
            'penetration_lookup_tables': pen_tables,
        },
        'search_results': {
            'record_arrays': [
                {k: v for k, v in r.items() if k != 'records'}
                for r in record_results[:5]
            ] if record_results else [],
            'parallel_arrays': [
                {k: v for k, v in r.items()}
                for r in parallel_results[:5]
            ] if parallel_results else [],
        },
        'raw_areas': raw_areas,
        'weapon_system': extract_weapon_stat_labels(data),
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    
    import os
    print(f"\n{'='*80}")
    print(f"Vehicle specs written to: {OUTPUT_JSON}")
    print(f"  File size: {os.path.getsize(OUTPUT_JSON):,} bytes")
    print(f"  Vehicles: {len(vehicles)} total")
    print(f"{'='*80}")


def get_historical_specs(code):
    """Return approximate historical specifications for reference."""
    specs = {
        'M3LT': {'name': 'M3 Stuart', 'armor_front_mm': 44, 'armor_side_mm': 25, 'gun_mm': 37, 'weight_t': 12.7, 'crew': 4},
        'M5LT': {'name': 'M5 Stuart', 'armor_front_mm': 64, 'armor_side_mm': 29, 'gun_mm': 37, 'weight_t': 15.0, 'crew': 4},
        'M8': {'name': 'M8 Greyhound', 'armor_front_mm': 25, 'armor_side_mm': 9, 'gun_mm': 37, 'weight_t': 7.9, 'crew': 4},
        'M3MT': {'name': 'M3 Lee', 'armor_front_mm': 51, 'armor_side_mm': 38, 'gun_mm': 75, 'weight_t': 27.2, 'crew': 6},
        'M4MT': {'name': 'M4 Sherman', 'armor_front_mm': 51, 'armor_side_mm': 38, 'gun_mm': 75, 'weight_t': 30.3, 'crew': 5},
        'M4A1': {'name': 'M4A1 Sherman', 'armor_front_mm': 51, 'armor_side_mm': 38, 'gun_mm': 75, 'weight_t': 30.3, 'crew': 5},
        'M4A3': {'name': 'M4A3 Sherman', 'armor_front_mm': 63, 'armor_side_mm': 38, 'gun_mm': 75, 'weight_t': 31.6, 'crew': 5},
        'M4A3E8': {'name': 'M4A3E8 Easy Eight', 'armor_front_mm': 63, 'armor_side_mm': 38, 'gun_mm': 76, 'weight_t': 33.0, 'crew': 5},
        'M4A3E2': {'name': 'M4A3E2 Jumbo', 'armor_front_mm': 102, 'armor_side_mm': 76, 'gun_mm': 75, 'weight_t': 38.1, 'crew': 5},
        'M26': {'name': 'M26 Pershing', 'armor_front_mm': 102, 'armor_side_mm': 76, 'gun_mm': 90, 'weight_t': 41.7, 'crew': 5},
        'M10': {'name': 'M10 Wolverine', 'armor_front_mm': 51, 'armor_side_mm': 25, 'gun_mm': 76, 'weight_t': 29.6, 'crew': 5},
        'M36': {'name': 'M36 Jackson', 'armor_front_mm': 51, 'armor_side_mm': 25, 'gun_mm': 90, 'weight_t': 28.6, 'crew': 5},
        'M3_GMC': {'name': 'M3 GMC', 'armor_front_mm': 12, 'armor_side_mm': 6, 'gun_mm': 75, 'weight_t': 9.1, 'crew': 5},
        'M3_HT1': {'name': 'M3 Halftrack', 'armor_front_mm': 12, 'armor_side_mm': 6, 'gun_mm': 0, 'weight_t': 9.1, 'crew': 13},
        'GMC_15T': {'name': 'GMC 2.5t Truck', 'armor_front_mm': 0, 'armor_side_mm': 0, 'gun_mm': 0, 'weight_t': 4.6, 'crew': 2},
        'M1ATG': {'name': '57mm M1 ATG', 'armor_front_mm': 5, 'armor_side_mm': 0, 'gun_mm': 57, 'weight_t': 1.2, 'crew': 6},
        '3INM5': {'name': '3in M5 ATG', 'armor_front_mm': 5, 'armor_side_mm': 0, 'gun_mm': 76, 'weight_t': 2.2, 'crew': 6},
        'PZKW2F': {'name': 'Pz.Kpfw. II F', 'armor_front_mm': 35, 'armor_side_mm': 15, 'gun_mm': 20, 'weight_t': 9.5, 'crew': 3},
        'PZKW3J': {'name': 'Pz.Kpfw. III J', 'armor_front_mm': 50, 'armor_side_mm': 30, 'gun_mm': 50, 'weight_t': 21.5, 'crew': 5},
        'PZKW3L': {'name': 'Pz.Kpfw. III L', 'armor_front_mm': 70, 'armor_side_mm': 30, 'gun_mm': 50, 'weight_t': 22.7, 'crew': 5},
        'PZKW3N': {'name': 'Pz.Kpfw. III N', 'armor_front_mm': 57, 'armor_side_mm': 30, 'gun_mm': 75, 'weight_t': 23.0, 'crew': 5},
        'PZKW4F': {'name': 'Pz.Kpfw. IV F1', 'armor_front_mm': 50, 'armor_side_mm': 30, 'gun_mm': 75, 'weight_t': 22.3, 'crew': 5},
        'PZKW4G': {'name': 'Pz.Kpfw. IV G', 'armor_front_mm': 80, 'armor_side_mm': 30, 'gun_mm': 75, 'weight_t': 23.5, 'crew': 5},
        'PZKW4H': {'name': 'Pz.Kpfw. IV H', 'armor_front_mm': 80, 'armor_side_mm': 30, 'gun_mm': 75, 'weight_t': 25.0, 'crew': 5},
        'PZKW5D': {'name': 'Panther D', 'armor_front_mm': 80, 'armor_side_mm': 45, 'gun_mm': 75, 'weight_t': 44.8, 'crew': 5},
        'PZKW5A': {'name': 'Panther A', 'armor_front_mm': 80, 'armor_side_mm': 45, 'gun_mm': 75, 'weight_t': 44.8, 'crew': 5},
        'PZKW5G': {'name': 'Panther G', 'armor_front_mm': 80, 'armor_side_mm': 50, 'gun_mm': 75, 'weight_t': 45.5, 'crew': 5},
        'PZKW6E': {'name': 'Tiger I', 'armor_front_mm': 100, 'armor_side_mm': 80, 'gun_mm': 88, 'weight_t': 57.0, 'crew': 5},
        'PZKW6B': {'name': 'Tiger II', 'armor_front_mm': 150, 'armor_side_mm': 80, 'gun_mm': 88, 'weight_t': 69.8, 'crew': 5},
        'STG3F': {'name': 'StuG III F', 'armor_front_mm': 50, 'armor_side_mm': 30, 'gun_mm': 75, 'weight_t': 23.9, 'crew': 4},
        'STG3F8': {'name': 'StuG III F/8', 'armor_front_mm': 80, 'armor_side_mm': 30, 'gun_mm': 75, 'weight_t': 23.9, 'crew': 4},
        'STG3G': {'name': 'StuG III G', 'armor_front_mm': 80, 'armor_side_mm': 30, 'gun_mm': 75, 'weight_t': 24.1, 'crew': 4},
        'STUH42': {'name': 'StuH 42', 'armor_front_mm': 80, 'armor_side_mm': 30, 'gun_mm': 105, 'weight_t': 24.0, 'crew': 4},
        'STPZ4': {'name': 'Sturmpanzer IV', 'armor_front_mm': 100, 'armor_side_mm': 30, 'gun_mm': 150, 'weight_t': 28.2, 'crew': 5},
        'MARDER2': {'name': 'Marder II', 'armor_front_mm': 30, 'armor_side_mm': 15, 'gun_mm': 75, 'weight_t': 10.8, 'crew': 3},
        'JGDPZ6': {'name': 'Jagdpanzer VI', 'armor_front_mm': 250, 'armor_side_mm': 80, 'gun_mm': 128, 'weight_t': 72.0, 'crew': 6},
        'SPW251': {'name': 'Sd.Kfz. 251', 'armor_front_mm': 14, 'armor_side_mm': 8, 'gun_mm': 0, 'weight_t': 7.8, 'crew': 12},
        'SPW234': {'name': 'Sd.Kfz. 234 Puma', 'armor_front_mm': 30, 'armor_side_mm': 8, 'gun_mm': 50, 'weight_t': 11.7, 'crew': 4},
        'OPEL_BT': {'name': 'Opel Blitz', 'armor_front_mm': 0, 'armor_side_mm': 0, 'gun_mm': 0, 'weight_t': 3.3, 'crew': 2},
        'PAK40': {'name': '75mm PaK 40', 'armor_front_mm': 5, 'armor_side_mm': 0, 'gun_mm': 75, 'weight_t': 1.4, 'crew': 6},
        'FLAK36': {'name': '88mm FlaK 36', 'armor_front_mm': 5, 'armor_side_mm': 0, 'gun_mm': 88, 'weight_t': 5.0, 'crew': 8},
        'L5_30': {'name': 'L5/30', 'armor_front_mm': 15, 'armor_side_mm': 6, 'gun_mm': 37, 'weight_t': 5.0, 'crew': 2},
        'FT17': {'name': 'Renault FT-17', 'armor_front_mm': 22, 'armor_side_mm': 16, 'gun_mm': 37, 'weight_t': 6.5, 'crew': 2},
        'STG3GL': {'name': 'StuG III G (late)', 'armor_front_mm': 80, 'armor_side_mm': 30, 'gun_mm': 75, 'weight_t': 24.1, 'crew': 4},
        'STUH42L': {'name': 'StuH 42 (late)', 'armor_front_mm': 80, 'armor_side_mm': 30, 'gun_mm': 105, 'weight_t': 24.0, 'crew': 4},
    }
    return specs.get(code, {})


def interpret_pen_block(vals):
    """Try to interpret a 96-byte penetration data block."""
    if len(vals) < 96:
        return {'error': 'block too short'}
    
    # Possible structure: 32 entries x 3 bytes (front/side/rear at each range)
    # Or: 12 entries x 8 bytes
    # Or: 8 entries x 12 bytes  
    
    interp = {
        'as_32x3': [],
        'as_12x8': [],
    }
    
    for i in range(32):
        interp['as_32x3'].append(vals[i*3:(i+1)*3])
    
    for i in range(12):
        interp['as_12x8'].append(vals[i*8:(i+1)*8])
    
    return interp


def extract_weapon_stat_labels(data):
    """Extract weapon stat system labels from the binary."""
    labels = {}
    
    searches = {
        'armor_display_body': b'BF:%3d BS:%3d BR:%3d BU:%3d',
        'armor_display_turret': b'TF:%3d TS:%3d TR:%3d TU:%3d',
        'hit_display': b'Hit: %3d %3d %3d %3d',
        'pen_display': b'Prc: %3d %3d %3d %3d',
        'weight_display': b'Wgt: %2d.%01dkg',
        'rate_pen_display': b'Rate %d%% Prc %d%%',
        'body_hp': b'Body:%d/%d',
    }
    
    for key, pattern in searches.items():
        idx = data.find(pattern)
        if idx >= 0:
            labels[key] = {
                'offset': f"0x{idx:06X}",
                'format': pattern.decode('ascii', errors='replace'),
            }
    
    return labels


if __name__ == '__main__':
    main()
