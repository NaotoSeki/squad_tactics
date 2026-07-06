"""
Build comprehensive vehicle database from CBE.EXE analysis.
Outputs vehicle_specs.json with all extracted data and reference specs.
"""
import struct, json, sys, io, os
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

CBE = Path(r"D:\PL\CBE.EXE")
OUT = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded\vehicle_specs.json")

def u16(d, o):
    return struct.unpack_from('<H', d, o)[0] if o+2 <= len(d) else 0

def sjis(raw):
    try: return raw.decode('shift_jis')
    except: return raw.decode('cp932', errors='replace')

def read_strings(d, off, max_n=500, stop=None):
    r, p = [], off
    while p < len(d) and len(r) < max_n:
        e = d.find(b'\x00', p)
        if e == -1 or e == p: break
        raw = d[p:e]
        if not all(0x20 <= b <= 0x7E or 0x80 <= b <= 0xFF for b in raw): break
        t = sjis(raw)
        if stop and t == stop:
            r.append(t); break
        r.append(t)
        p = e + 1
    return r

HIST = {
    'M3LT':    {'full': 'M3 Stuart Light Tank', 'af': 44, 'as': 25, 'ar': 25, 'tf': 44, 'ts': 32, 'gun': '37mm M6', 'wt': 12.7, 'spd': 58, 'crew': 4, 'year': 1941},
    'M5LT':    {'full': 'M5A1 Stuart', 'af': 64, 'as': 29, 'ar': 25, 'tf': 64, 'ts': 32, 'gun': '37mm M6', 'wt': 15.0, 'spd': 58, 'crew': 4, 'year': 1942},
    'M8':      {'full': 'M8 Greyhound', 'af': 25, 'as': 9, 'ar': 9, 'tf': 25, 'ts': 19, 'gun': '37mm M6', 'wt': 7.9, 'spd': 89, 'crew': 4, 'year': 1943},
    'M3MT':    {'full': 'M3 Lee/Grant', 'af': 51, 'as': 38, 'ar': 38, 'tf': 76, 'ts': 51, 'gun': '75mm M3 + 37mm M6', 'wt': 27.2, 'spd': 39, 'crew': 6, 'year': 1941},
    'M4MT':    {'full': 'M4 Sherman (75mm)', 'af': 51, 'as': 38, 'ar': 38, 'tf': 76, 'ts': 51, 'gun': '75mm M3', 'wt': 30.3, 'spd': 39, 'crew': 5, 'year': 1942},
    'M4A1':    {'full': 'M4A1 Sherman (cast)', 'af': 51, 'as': 38, 'ar': 38, 'tf': 76, 'ts': 51, 'gun': '75mm M3', 'wt': 30.3, 'spd': 39, 'crew': 5, 'year': 1942},
    'M4A3':    {'full': 'M4A3 Sherman (75mm)', 'af': 63, 'as': 38, 'ar': 38, 'tf': 76, 'ts': 51, 'gun': '75mm M3', 'wt': 31.6, 'spd': 42, 'crew': 5, 'year': 1944},
    'M4A3E8':  {'full': 'M4A3E8 Easy Eight', 'af': 63, 'as': 38, 'ar': 38, 'tf': 89, 'ts': 64, 'gun': '76mm M1', 'wt': 33.0, 'spd': 42, 'crew': 5, 'year': 1944},
    'M4A3E2':  {'full': 'M4A3E2 Jumbo', 'af': 102, 'as': 76, 'ar': 38, 'tf': 152, 'ts': 152, 'gun': '75mm M3', 'wt': 38.1, 'spd': 35, 'crew': 5, 'year': 1944},
    'M26':     {'full': 'M26 Pershing', 'af': 102, 'as': 76, 'ar': 51, 'tf': 102, 'ts': 76, 'gun': '90mm M3', 'wt': 41.7, 'spd': 40, 'crew': 5, 'year': 1945},
    'M10':     {'full': 'M10 Wolverine', 'af': 51, 'as': 25, 'ar': 25, 'tf': 25, 'ts': 25, 'gun': '76mm M7', 'wt': 29.6, 'spd': 48, 'crew': 5, 'year': 1942},
    'M36':     {'full': 'M36 Jackson', 'af': 51, 'as': 25, 'ar': 25, 'tf': 25, 'ts': 25, 'gun': '90mm M3', 'wt': 28.6, 'spd': 42, 'crew': 5, 'year': 1944},
    'M3_GMC':  {'full': 'M3 GMC', 'af': 12, 'as': 6, 'ar': 6, 'tf': 0, 'ts': 0, 'gun': '75mm M1897A4', 'wt': 9.1, 'spd': 72, 'crew': 5, 'year': 1941},
    'M3_HT1':  {'full': 'M3 Half-Track', 'af': 12, 'as': 6, 'ar': 6, 'tf': 0, 'ts': 0, 'gun': '.50 cal MG', 'wt': 9.1, 'spd': 72, 'crew': 13, 'year': 1941},
    'GMC_15T': {'full': 'GMC 2.5t CCKW', 'af': 0, 'as': 0, 'ar': 0, 'tf': 0, 'ts': 0, 'gun': 'none', 'wt': 4.6, 'spd': 72, 'crew': 2, 'year': 1941},
    'M1ATG':   {'full': '57mm M1 Anti-Tank Gun', 'af': 5, 'as': 0, 'ar': 0, 'tf': 0, 'ts': 0, 'gun': '57mm M1', 'wt': 1.2, 'spd': 0, 'crew': 6, 'year': 1943},
    '3INM5':   {'full': '3-inch Gun M5', 'af': 5, 'as': 0, 'ar': 0, 'tf': 0, 'ts': 0, 'gun': '3in M7', 'wt': 2.2, 'spd': 0, 'crew': 6, 'year': 1943},
    'PZKW2F':  {'full': 'Pz.Kpfw. II Ausf. F', 'af': 35, 'as': 15, 'ar': 15, 'tf': 35, 'ts': 15, 'gun': '20mm KwK 30', 'wt': 9.5, 'spd': 40, 'crew': 3, 'year': 1941},
    'PZKW3J':  {'full': 'Pz.Kpfw. III Ausf. J', 'af': 50, 'as': 30, 'ar': 30, 'tf': 57, 'ts': 30, 'gun': '50mm KwK 39', 'wt': 21.5, 'spd': 40, 'crew': 5, 'year': 1941},
    'PZKW3L':  {'full': 'Pz.Kpfw. III Ausf. L', 'af': 70, 'as': 30, 'ar': 30, 'tf': 57, 'ts': 30, 'gun': '50mm KwK 39', 'wt': 22.7, 'spd': 40, 'crew': 5, 'year': 1942},
    'PZKW3N':  {'full': 'Pz.Kpfw. III Ausf. N', 'af': 57, 'as': 30, 'ar': 30, 'tf': 57, 'ts': 30, 'gun': '75mm KwK 37', 'wt': 23.0, 'spd': 40, 'crew': 5, 'year': 1942},
    'PZKW4F':  {'full': 'Pz.Kpfw. IV Ausf. F1', 'af': 50, 'as': 30, 'ar': 20, 'tf': 50, 'ts': 30, 'gun': '75mm KwK 37', 'wt': 22.3, 'spd': 42, 'crew': 5, 'year': 1941},
    'PZKW4G':  {'full': 'Pz.Kpfw. IV Ausf. G', 'af': 80, 'as': 30, 'ar': 20, 'tf': 50, 'ts': 30, 'gun': '75mm KwK 40', 'wt': 23.5, 'spd': 40, 'crew': 5, 'year': 1942},
    'PZKW4H':  {'full': 'Pz.Kpfw. IV Ausf. H', 'af': 80, 'as': 30, 'ar': 20, 'tf': 50, 'ts': 30, 'gun': '75mm KwK 40', 'wt': 25.0, 'spd': 38, 'crew': 5, 'year': 1943},
    'PZKW5D':  {'full': 'Panther Ausf. D', 'af': 80, 'as': 45, 'ar': 40, 'tf': 100, 'ts': 45, 'gun': '75mm KwK 42', 'wt': 44.8, 'spd': 55, 'crew': 5, 'year': 1943},
    'PZKW5A':  {'full': 'Panther Ausf. A', 'af': 80, 'as': 45, 'ar': 40, 'tf': 100, 'ts': 45, 'gun': '75mm KwK 42', 'wt': 44.8, 'spd': 55, 'crew': 5, 'year': 1943},
    'PZKW5G':  {'full': 'Panther Ausf. G', 'af': 80, 'as': 50, 'ar': 40, 'tf': 110, 'ts': 45, 'gun': '75mm KwK 42', 'wt': 45.5, 'spd': 46, 'crew': 5, 'year': 1944},
    'PZKW6E':  {'full': 'Tiger I (Ausf. E)', 'af': 100, 'as': 80, 'ar': 80, 'tf': 100, 'ts': 80, 'gun': '88mm KwK 36', 'wt': 57.0, 'spd': 38, 'crew': 5, 'year': 1942},
    'PZKW6B':  {'full': 'Tiger II (Ausf. B)', 'af': 150, 'as': 80, 'ar': 80, 'tf': 180, 'ts': 80, 'gun': '88mm KwK 43', 'wt': 69.8, 'spd': 38, 'crew': 5, 'year': 1944},
    'STG3F':   {'full': 'StuG III Ausf. F', 'af': 50, 'as': 30, 'ar': 30, 'tf': 0, 'ts': 0, 'gun': '75mm StuK 40', 'wt': 23.9, 'spd': 40, 'crew': 4, 'year': 1942},
    'STG3F8':  {'full': 'StuG III Ausf. F/8', 'af': 80, 'as': 30, 'ar': 30, 'tf': 0, 'ts': 0, 'gun': '75mm StuK 40', 'wt': 23.9, 'spd': 40, 'crew': 4, 'year': 1942},
    'STG3G':   {'full': 'StuG III Ausf. G', 'af': 80, 'as': 30, 'ar': 30, 'tf': 0, 'ts': 0, 'gun': '75mm StuK 40', 'wt': 24.1, 'spd': 40, 'crew': 4, 'year': 1943},
    'STUH42':  {'full': 'StuH 42', 'af': 80, 'as': 30, 'ar': 30, 'tf': 0, 'ts': 0, 'gun': '105mm StuH 42', 'wt': 24.0, 'spd': 40, 'crew': 4, 'year': 1942},
    'STPZ4':   {'full': 'Sturmpanzer IV Brummbär', 'af': 100, 'as': 30, 'ar': 20, 'tf': 100, 'ts': 30, 'gun': '150mm StuH 43', 'wt': 28.2, 'spd': 40, 'crew': 5, 'year': 1943},
    'MARDER2': {'full': 'Marder II', 'af': 30, 'as': 15, 'ar': 15, 'tf': 15, 'ts': 15, 'gun': '75mm PaK 40', 'wt': 10.8, 'spd': 40, 'crew': 3, 'year': 1942},
    'JGDPZ6':  {'full': 'Jagdtiger', 'af': 250, 'as': 80, 'ar': 80, 'tf': 250, 'ts': 0, 'gun': '128mm PaK 44', 'wt': 72.0, 'spd': 34, 'crew': 6, 'year': 1944},
    'SPW251':  {'full': 'Sd.Kfz. 251/1', 'af': 14, 'as': 8, 'ar': 8, 'tf': 0, 'ts': 0, 'gun': 'MG 42', 'wt': 7.8, 'spd': 53, 'crew': 12, 'year': 1939},
    'SPW234':  {'full': 'Sd.Kfz. 234/2 Puma', 'af': 30, 'as': 8, 'ar': 8, 'tf': 30, 'ts': 14, 'gun': '50mm KwK 39/1', 'wt': 11.7, 'spd': 85, 'crew': 4, 'year': 1943},
    'OPEL_BT': {'full': 'Opel Blitz 3t', 'af': 0, 'as': 0, 'ar': 0, 'tf': 0, 'ts': 0, 'gun': 'none', 'wt': 3.3, 'spd': 80, 'crew': 2, 'year': 1937},
    'PAK40':   {'full': '75mm PaK 40', 'af': 5, 'as': 0, 'ar': 0, 'tf': 0, 'ts': 0, 'gun': '75mm PaK 40', 'wt': 1.4, 'spd': 0, 'crew': 6, 'year': 1942},
    'FLAK36':  {'full': '88mm FlaK 36/37', 'af': 5, 'as': 0, 'ar': 0, 'tf': 0, 'ts': 0, 'gun': '88mm FlaK 36', 'wt': 5.0, 'spd': 0, 'crew': 8, 'year': 1936},
    'L5_30':   {'full': 'L5/30 (Fiat-Ansaldo)', 'af': 15, 'as': 6, 'ar': 6, 'tf': 15, 'ts': 6, 'gun': '37mm', 'wt': 5.0, 'spd': 30, 'crew': 2, 'year': 1930},
    'FT17':    {'full': 'Renault FT-17', 'af': 22, 'as': 16, 'ar': 16, 'tf': 22, 'ts': 22, 'gun': '37mm SA18', 'wt': 6.5, 'spd': 8, 'crew': 2, 'year': 1917},
    'STG3GL':  {'full': 'StuG III Ausf. G (late)', 'af': 80, 'as': 30, 'ar': 30, 'tf': 0, 'ts': 0, 'gun': '75mm StuK 40', 'wt': 24.1, 'spd': 40, 'crew': 4, 'year': 1944},
    'STUH42L': {'full': 'StuH 42 (late)', 'af': 80, 'as': 30, 'ar': 30, 'tf': 0, 'ts': 0, 'gun': '105mm StuH 42', 'wt': 24.0, 'spd': 40, 'crew': 4, 'year': 1943},
}

def main():
    d = open(CBE, 'rb').read()
    print(f"CBE.EXE: {len(d):,} bytes")

    # 1. Code names
    codes = []
    p = 0x20FD36
    while p < 0x20FE60:
        e = d.find(b'\x00', p)
        if e == -1 or e == p: break
        t = d[p:e].decode('ascii', errors='replace')
        if '.TDD' in t or t.startswith('2'): break
        if all(0x20 <= b <= 0x7E for b in d[p:e]) and len(d[p:e]) >= 2:
            codes.append(t)
        else: break
        p = e + 1
    print(f"Codes: {len(codes)}")

    # 2. Display names
    mi = d.find(b'(end AFV)')
    dnames = []
    if mi >= 0:
        p = mi + 10
        while p < mi + 5000:
            e = d.find(b'\x00', p)
            if e == -1 or e == p: break
            t = sjis(d[p:e])
            if t == '(end AFV)': break
            dnames.append(t)
            p = e + 1
    print(f"Display names: {len(dnames)}")

    # 3. 2-prefix codes
    pi = d.find(b'2M3LT\x00')
    pcodes = []
    if pi >= 0:
        p = pi
        while p < pi + 1000:
            e = d.find(b'\x00', p)
            if e == -1 or e == p: break
            t = d[p:e].decode('ascii', errors='replace')
            if not t.startswith('2'): break
            if all(0x20 <= b <= 0x7E for b in d[p:e]):
                pcodes.append(t)
            else: break
            p = e + 1
    print(f"2-prefix: {len(pcodes)}")

    # 4. Weapons
    ui = d.find(b'M1911A1\x00')
    us_wpns = read_strings(d, ui, 100) if ui >= 0 else []
    gi = d.find(b'PPK\x00HSc\x00P38')
    ger_wpns = read_strings(d, gi, 400) if gi >= 0 else []
    ri = d.find(b'PM1910\x00DShK')
    ru_wpns = read_strings(d, ri, 300) if ri >= 0 else []
    print(f"Weapons: US={len(us_wpns)} GER={len(ger_wpns)} RU={len(ru_wpns)}")

    # 5. Command system
    cmd = {}
    for pat, key, n in [
        (b'Stay\x00Aslt\x00Move', 'action_modes', 9),
        (b'Stand\x00Kneel\x00Prone', 'postures', 4),
        (b'Med\x00Sig\x00Eng', 'specialist_types', 5),
    ]:
        idx = d.find(pat)
        if idx >= 0:
            cmd[key] = read_strings(d, idx, n)

    # 6. Numeric area (0x21005C)
    u16_data = []
    for i in range(40):
        off = 0x21005C + i * 8
        u16_data.append([u16(d, off + j) for j in range(0, 8, 2)])

    # 7. Penetration blocks (100 bytes each: 99 data + 1 padding)
    # Structure: 11 rows x 9 columns = 99 bytes
    # Rows likely represent different firing conditions or ammo types
    # Columns: 3 groups of 3 values (e.g., 3 range brackets x 3 hit zones)
    pen_blocks = []
    seg20_start = 0x071E88
    for bi in range(45):
        off = seg20_start + bi * 100
        if off + 100 > len(d): break
        raw = list(d[off:off + 99])
        if all(b == 0 for b in raw): break
        grid = []
        for r in range(11):
            row = raw[r*9:(r+1)*9]
            grid.append({
                'group_A': row[0:3],
                'group_B': row[3:6],
                'group_C': row[6:9],
            })
        pen_blocks.append({
            'block_index': bi,
            'offset': f"0x{off:06X}",
            'raw_99_bytes': raw,
            'grid_11x9': grid,
            'padding_byte': d[off + 99],
        })

    # 8. Build vehicle records
    # Display names (70) are NOT 1:1 with code names (45).
    # Display names include sub-variants sharing the same sprite model.
    # Build a best-effort mapping using keyword matching.

    type_map = {
        'M3LT': 'light_tank', 'M5LT': 'light_tank', 'M8': 'armored_car',
        'M3MT': 'medium_tank', 'M4MT': 'medium_tank', 'M4A1': 'medium_tank',
        'M4A3': 'medium_tank', 'M4A3E8': 'medium_tank', 'M4A3E2': 'assault_tank',
        'M26': 'heavy_tank', 'M10': 'tank_destroyer', 'M36': 'tank_destroyer',
        'M3_GMC': 'spg', 'M3_HT1': 'halftrack', 'GMC_15T': 'truck',
        'M1ATG': 'at_gun', '3INM5': 'at_gun',
        'PZKW2F': 'light_tank', 'PZKW3J': 'medium_tank', 'PZKW3L': 'medium_tank',
        'PZKW3N': 'medium_tank', 'PZKW4F': 'medium_tank', 'PZKW42': 'medium_tank',
        'PZKW4G': 'medium_tank', 'PZKW4H': 'medium_tank',
        'PZKW5D': 'medium_tank', 'PZKW5A': 'medium_tank', 'PZKW5G': 'medium_tank',
        'PZKW6E': 'heavy_tank', 'PZKW6B': 'heavy_tank',
        'STG3F': 'assault_gun', 'STG3F8': 'assault_gun', 'STG3G': 'assault_gun',
        'STUH42': 'assault_gun', 'STPZ4': 'assault_gun', 'MARDER2': 'tank_destroyer',
        'JGDPZ6': 'heavy_td', 'SPW251': 'halftrack', 'SPW234': 'armored_car',
        'OPEL_BT': 'truck', 'PAK40': 'at_gun', 'FLAK36': 'aa_gun',
        'L5_30': 'light_tank', 'FT17': 'light_tank',
        'STG3GL': 'assault_gun', 'STUH42L': 'assault_gun',
    }

    # Known mapping: code_name index → display_name indices
    # The display names table has 70 entries for all in-game variants.
    # Multiple display names can share one code (sprite model).
    dn_map = {
        0:  [0,1],       # M3LT → "M3 LT", "M3A1 LT"
        1:  [2],         # M5LT → "M5A1"
        2:  [3],         # M8 → "M8 HMC"
        3:  [4],         # M3MT → "M3 MT"
        4:  [5,6],       # M4MT → "M4 MT", "M4(105) MT"
        5:  [7],         # M4A1 → "M4A1 MT"
        6:  [8],         # M4A3 → "M4A3 MT"
        7:  [9],         # M4A3E8 → "M4A3(76) MT"
        8:  [10],        # M4A3E2 → "M4A3E2 AT"
        9:  [11],        # M26 → "M26 HT"
        10: [12],        # M10 → "M10 GMC"
        11: [13,14],     # M36 → "M36 GMC", "M36B1 GMC"
        12: [15],        # M3_GMC → "M3 GMC"
        13: [16],        # M3_HT1 → "M3A1 HTPC"
        14: [17,18,19,20], # GMC_15T → "Jeep", "GMC 2.5t" x3
        15: [21],        # M1ATG → "57mm M1 ATG"
        16: [22],        # 3INM5 → "3in M5 ATG"
        17: [23],        # PZKW2F → "PzKpfw 2 F"
        18: [24],        # PZKW3J → "PzKpfw 3 J"
        19: [25],        # PZKW3L → "PzKpfw 3 L"
        20: [26],        # PZKW3N → "PzKpfw 3 N"
        21: [27,28],     # PZKW4F → "PzKpfw 4 F1", "PzKpfw 4 F2"
        22: [29],        # PZKW4G → "PzKpfw 4 G"
        23: [30],        # PZKW4H → "PzKpfw 4 H"
        24: [31],        # PZKW5D → "PzKpfw 5 D"
        25: [32],        # PZKW5A → "PzKpfw 5 A"
        26: [33],        # PZKW5G → "PzKpfw 5 G"
        27: [34],        # PZKW6E → "PzKpfw 6 E"
        28: [35],        # PZKW6B → "PzKpfw 6 B"
        29: [36],        # STG3F → "StuG 3 F"
        30: [37],        # STG3F8 → "StuG 3 F/8"
        31: [38],        # STG3G → "StuG 3 G"
        32: [40],        # STUH42 → "StuH 42"
        33: [42],        # STPZ4 → "StuPz 4"
        34: [43],        # MARDER2 → "PzJag 2"
        35: [44],        # JGDPZ6 → "JgdPz 6"
        36: [45,46],     # SPW251 → "SdKfz 251/1" x2
        37: [49,50,51,52], # SPW234 → "SdKfz 234/1~4"
        38: [53],        # OPEL_BT → "Opel6700A"
        39: [54],        # PAK40 → "75mm PaK40"
        40: [55],        # FLAK36 → "88mm FlaK36"
        41: [56],        # L5_30 → "L5/30"
        42: [57],        # FT17 → "FT17"
        43: [38,39],     # STG3GL → "StuG 3 G" (late)
        44: [40,41],     # STUH42L → "StuH 42" (late)
    }

    vehicles = []
    for i, code in enumerate(codes):
        side = 'US' if i < 17 else 'Germany'
        dn_idxs = dn_map.get(i, [])
        dn_list = [dnames[j] for j in dn_idxs if j < len(dnames)]
        primary_dn = dn_list[0] if dn_list else code
        h = HIST.get(code, {})
        
        off_accum = 0x20FD36
        for ci in range(i):
            off_accum += len(codes[ci]) + 1

        v = {
            'index': i,
            'id': code,
            'display_name': primary_dn,
            'all_display_names': dn_list,
            'tdd_model': next((p for p in pcodes if p == f"2{code}"), f"2{code}"),
            'side': side,
            'type': type_map.get(code, 'unknown'),
            'data_offsets': {
                'code_name': f"0x{off_accum:06X}",
            },
            'historical_reference': {
                'full_name': h.get('full', ''),
                'armor_front_mm': h.get('af'),
                'armor_side_mm': h.get('as'),
                'armor_rear_mm': h.get('ar'),
                'turret_front_mm': h.get('tf'),
                'turret_side_mm': h.get('ts'),
                'main_gun': h.get('gun', ''),
                'weight_tonnes': h.get('wt'),
                'speed_kph': h.get('spd'),
                'crew': h.get('crew'),
                'year_introduced': h.get('year'),
            },
        }
        vehicles.append(v)

    # Extended display names: British/other vehicles beyond the 45 code-name models
    extended = []
    side_guess = {
        'A15': 'UK', 'Lee': 'UK', 'Sherman 2': 'UK', 'Sherman 5': 'UK',
        'A22': 'UK', 'MMG': 'UK', 'M5A1 HTPC': 'UK', 'Bedford': 'UK',
        'OQF': 'UK', 'SPW251/10': 'Germany', 'SdKfz': 'Germany',
    }
    type_guess = {
        'A15': 'infantry_tank', 'Lee': 'medium_tank', 'Sherman': 'medium_tank',
        'A22': 'infantry_tank', 'MMG': 'carrier', 'HTPC': 'halftrack',
        'Bedford': 'truck', 'OQF': 'at_gun', 'SPW': 'halftrack', 'SdKfz': 'halftrack',
    }
    used_dn_idxs = set()
    for v in dn_map.values():
        used_dn_idxs.update(v)
    for i in range(len(dnames)):
        if i in used_dn_idxs: continue
        dn = dnames[i]
        side, vtype = 'unknown', 'unknown'
        for k, s in side_guess.items():
            if k in dn: side = s; break
        for k, t in type_guess.items():
            if k in dn: vtype = t; break
        extended.append({
            'display_name_index': i,
            'display_name': dn,
            'side': side,
            'type': vtype,
        })

    # 9. Format string evidence
    fmt_evidence = {
        'armor_display': {
            'body_format': '装甲値: BF:%3d BS:%3d BR:%3d BU:%3d',
            'turret_format': 'TF:%3d TS:%3d TR:%3d TU:%3d',
            'offset': '0x071C9F',
            'fields': ['BF=Body Front', 'BS=Body Side', 'BR=Body Rear', 'BU=Body Upper',
                       'TF=Turret Front', 'TS=Turret Side', 'TR=Turret Rear', 'TU=Turret Upper'],
            'note': '8 armor values per vehicle (integer, displayed as %3d = 0-999)',
        },
        'hit_probability': {
            'body_format': '被命中: BF:%3d BS:%3d BR:%3d BU:%3d',
            'turret_format': 'TF:%3d TS:%3d TR:%3d TU:%3d',
            'offset': '0x071C61',
            'note': '8 hit zone probability values per vehicle',
        },
        'combat_display': {
            'hit_format': 'Hit: %3d %3d %3d %3d',
            'pen_format': 'Prc: %3d %3d %3d %3d',
            'offset': '0x071C35',
            'note': '4 range brackets for hit chance and penetration',
        },
        'weight_format': {
            'format': 'Wgt: %2d.%01dkg',
            'offset': '0x071CDF',
        },
        'weapon_stats_jp': {
            'labels_found': [
                '初期貫通力 (initial penetration)',
                '低下率 (degradation rate)',
                '初期命中率 (initial hit rate)',
                '発射弾数 (shots per turn)',
                '命中低下 (hit degradation per shot)',
                '故障率 (malfunction/jam rate)',
                '重量 (weight)',
            ],
            'offset_area': '0x2129E0 - 0x212A40',
        },
    }

    report = {
        '_meta': {
            'source': str(CBE),
            'file_size': len(d),
            'game': 'Platoon Leader (1997 SEGA/TechnoBrain)',
            'platform': 'Windows 3.1/95 (16-bit NE executable)',
            'analysis_notes': [
                'Vehicle name tables fully extracted from CBE.EXE Segment 157',
                'Armor stat structure identified via format strings: 8 values per vehicle (BF/BS/BR/BU/TF/TS/TR/TU)',
                'Hit probability structure: same 8-zone system',
                'Combat uses 4 range brackets for hit and penetration calculation',
                'Weapon penetration lookup tables found at 0x071E88 (Data Seg 20, ~45 blocks of 99 bytes)',
                'Per-vehicle numeric stat arrays NOT found as contiguous memory - likely computed at runtime from formulas or loaded from scenario data',
                'DLL files (ITEML.DLL, ITEMS.DLL, ADM.DLL, COM.DLL, MISSDATA.DLL) do not contain vehicle name strings',
                'Stat values may use game-specific units rather than historical mm values',
                'A 320-byte numeric u16 table exists at 0x21005C (40 records x 4 u16 values) - purpose unknown, possibly TDD rendering parameters',
            ],
            'reverse_engineering_status': {
                'vehicle_names': 'COMPLETE - 45 code names + 70 display names + 49 TDD model codes',
                'armor_structure': 'IDENTIFIED - 8 zones (BF/BS/BR/BU/TF/TS/TR/TU)',
                'weapon_stats': 'IDENTIFIED - penetration, hit rate, degradation, malfunction, weight, ammo',
                'penetration_tables': 'EXTRACTED - 45+ blocks of 99-byte lookup data at 0x071E88',
                'actual_stat_values': 'NOT_FOUND - per-vehicle armor/speed/HP values not located as raw data tables',
                'next_steps': [
                    'Disassemble code segments to trace armor value loading (start from format string at 0x071C9F)',
                    'Check if stats are computed from formulas (common in Japanese tactical games)',
                    'Examine scenario files (.PLX) for per-mission unit initialization data',
                    'Use a Win16 debugger to intercept armor display routine at runtime',
                ],
            },
        },
        'name_tables': {
            'code_names': {'offset': '0x20FD36', 'count': len(codes), 'entries': codes},
            'display_names': {'offset': '0x2169E0', 'count': len(dnames), 'entries': dnames},
            'tdd_model_codes': {'offset': '0x20FEF2', 'count': len(pcodes), 'entries': pcodes},
        },
        'vehicles': vehicles,
        'extended_variants': extended,
        'format_string_evidence': fmt_evidence,
        'command_system': cmd,
        'weapons': {
            'us_weapons': {'count': len(us_wpns), 'names': us_wpns[:50], 'total': len(us_wpns)},
            'german_weapons': {'count': len(ger_wpns), 'names': ger_wpns[:50], 'total': len(ger_wpns)},
            'russian_weapons': {'count': len(ru_wpns), 'names': ru_wpns[:50], 'total': len(ru_wpns)},
        },
        'numeric_tables': {
            'u16_table_0x21005C': {
                'offset': '0x21005C',
                'description': '40 records x 4 u16 values, immediately follows 2-prefix TDD codes',
                'hypothesis': 'TDD sprite rendering parameters (dimensions/offsets) for vehicle models',
                'records': u16_data,
            },
            'penetration_lookup': {
                'offset': '0x071E88',
                'segment': 'Data Seg 20 (0x071D80, 4060 bytes)',
                'description': f'{len(pen_blocks)} blocks of 100 bytes (99 data + 1 padding) - weapon/combat lookup tables',
                'structure_hypothesis': {
                    'layout': '11 rows x 9 columns = 99 bytes per block',
                    'column_groups': '3 groups of 3 values each (possibly 3 range brackets x 3 hit zones)',
                    'evidence': [
                        'Block 7 rows 8-10: [150,150,150 | 120,120,120 | 91,91,91] → [60,60,60 | 20,20,20 | 0,0,0] - classic descending penetration curve with identical triplets',
                        'Blocks 0-3 are identical (possibly default/template data)',
                        'Blocks 4+ have unique data per weapon type',
                        'Values 0-255 represent game-internal penetration units',
                    ],
                },
                'block_count': len(pen_blocks),
                'blocks': pen_blocks,
            },
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    sz = os.path.getsize(OUT)
    print(f"\nWrote {OUT} ({sz:,} bytes)")
    print(f"  {len(vehicles)} base vehicles (code names)")
    print(f"  {len(extended)} extended variants (display-only, no unique sprite code)")
    print(f"  {len(pen_blocks)} penetration blocks")

if __name__ == '__main__':
    main()
