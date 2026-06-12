"""
Analyze MISSDATA binary files from Platoon Leader (1997 SEGA/TechnoBrain).
Produces structured hex dumps and identifies header/record formats.
"""
import os, struct, json, sys
from pathlib import Path
from collections import defaultdict

MISSDATA_DIR = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded\ne_resources\MISSDATA")
TDD_DIR = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded\tdd")
OUTPUT_PATH = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded\mission_structure.json")

def hex_dump(data, start=0, length=None, width=16):
    if length is None:
        length = len(data) - start
    lines = []
    for i in range(start, min(start + length, len(data)), width):
        chunk = data[i:i+width]
        hex_part = ' '.join(f'{b:02x}' for b in chunk)
        ascii_part = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
        lines.append(f"  {i:04x}: {hex_part:<{width*3}}  {ascii_part}")
    return '\n'.join(lines)

def read_le16(data, offset):
    return struct.unpack_from('<H', data, offset)[0]

def read_le32(data, offset):
    return struct.unpack_from('<I', data, offset)[0]

def read_string(data, offset, max_len=32):
    end = offset
    while end < min(offset + max_len, len(data)) and data[end] != 0:
        end += 1
    return data[offset:end].decode('ascii', errors='replace')

# ============================================================
# PHASE 1: Inventory all files and group by mission
# ============================================================
print("=" * 70)
print("PHASE 1: FILE INVENTORY")
print("=" * 70)

files = sorted(MISSDATA_DIR.glob("*.bin"))
missions = defaultdict(dict)
all_sizes = {}

for f in files:
    name = f.stem  # e.g. MAP00_0_0
    size = f.stat().st_size
    all_sizes[name] = size
    parts = name.split('_')
    map_id = parts[0]  # MAP00
    variant = '_'.join(parts[1:])  # 0_0, 1_0, etc.
    missions[map_id][variant] = {'file': name, 'size': size}

print(f"Total files: {len(files)}")
print(f"Missions: {len(missions)}")
print(f"\nMain file (_0_0) sizes:")
for mid in sorted(missions.keys()):
    if '0_0' in missions[mid]:
        sz = missions[mid]['0_0']['size']
        print(f"  {mid}: {sz:>6} bytes")
    else:
        print(f"  {mid}: (no _0_0 variant) variants={list(missions[mid].keys())}")

# ============================================================
# PHASE 2: HEADER ANALYSIS - dump & compare headers
# ============================================================
print("\n" + "=" * 70)
print("PHASE 2: HEADER ANALYSIS")
print("=" * 70)

target_files = ['MAP00_0_0', 'MAP01_0_0', 'MAP07_0_0', 'MAP14_0_0',
                'MAP20_0_0', 'MAP32_0_0', 'MAP36_0_0']
header_data = {}

for name in target_files:
    fpath = MISSDATA_DIR / f"{name}.bin"
    if not fpath.exists():
        print(f"  {name}: NOT FOUND")
        continue
    data = fpath.read_bytes()
    header_data[name] = data
    print(f"\n--- {name} ({len(data)} bytes) ---")
    print(hex_dump(data, 0, min(256, len(data))))

# Analyze common header fields
print("\n\n--- HEADER FIELD COMPARISON ---")
print(f"{'File':<14} {'Sz':>6} | bytes[0:2] | b[2] | b[3] | b[4:6] | b[6:8] | b[8:16]_ascii | b[8:16]_hex")
print("-" * 120)
for name, data in header_data.items():
    w0 = f"{data[0]:02x} {data[1]:02x}"
    b2 = data[2]
    b3 = data[3]
    w2 = f"{read_le16(data, 4):5d}"
    w3 = f"{read_le16(data, 6):5d}"
    ascii_8_16 = ''.join(chr(b) if 32 <= b < 127 else '.' for b in data[8:16])
    hex_8_16 = ' '.join(f'{b:02x}' for b in data[8:16])
    print(f"  {name:<12} {len(data):>6} | {w0}       | {b2:3d} | {b3:3d} | {w2} | {w3} | {ascii_8_16:<8} | {hex_8_16}")

# ============================================================
# PHASE 3: Find ASCII strings (map name references)
# ============================================================
print("\n" + "=" * 70)
print("PHASE 3: ASCII STRING SEARCH")
print("=" * 70)

for name in ['MAP00_0_0', 'MAP01_0_0', 'MAP07_0_0', 'MAP14_0_0', 'MAP32_0_0']:
    fpath = MISSDATA_DIR / f"{name}.bin"
    if not fpath.exists():
        continue
    data = fpath.read_bytes()
    strings_found = []
    i = 0
    while i < len(data):
        if 32 <= data[i] < 127:
            start = i
            while i < len(data) and 32 <= data[i] < 127:
                i += 1
            s = data[start:i].decode('ascii')
            if len(s) >= 3:
                strings_found.append((start, s))
        else:
            i += 1
    print(f"\n  {name}:")
    for off, s in strings_found:
        print(f"    offset 0x{off:04x} ({off:5d}): '{s}'")

# ============================================================
# PHASE 4: Analyze record structure after header
# ============================================================
print("\n" + "=" * 70)
print("PHASE 4: RECORD STRUCTURE ANALYSIS")
print("=" * 70)

# For each _0_0 file, try to identify the repeating pattern after the header
for name in ['MAP00_0_0', 'MAP01_0_0', 'MAP07_0_0', 'MAP14_0_0']:
    fpath = MISSDATA_DIR / f"{name}.bin"
    data = fpath.read_bytes()
    print(f"\n--- {name} ({len(data)} bytes) ---")

    # Look at byte[2] as potential unit count
    unit_count_b2 = data[2]
    print(f"  byte[2] = {unit_count_b2} (potential unit count?)")

    # Look at first 2 bytes as LE16
    val_0_2 = read_le16(data, 0)
    print(f"  LE16[0] = {val_0_2} (0x{val_0_2:04x})")

    # Look for the map name string to find header end
    for i in range(len(data) - 4):
        if data[i:i+4] == b'NMAP' or data[i:i+3] == b'MAP':
            print(f"  Found map string at offset 0x{i:04x}: {read_string(data, i)}")

    # Dump bytes 0-63 as 16-bit LE words
    print(f"  First 32 words (LE16):")
    for wi in range(0, 64, 2):
        if wi + 1 < len(data):
            val = read_le16(data, wi)
            print(f"    [{wi:3d}] 0x{wi:02x}: {val:5d} (0x{val:04x})")

# ============================================================
# PHASE 5: Variant comparison (_0_0 vs _1_0 vs _1_1 vs _2_1)
# ============================================================
print("\n" + "=" * 70)
print("PHASE 5: VARIANT COMPARISON")
print("=" * 70)

for map_id in ['MAP00', 'MAP07', 'MAP14']:
    print(f"\n--- {map_id} variants ---")
    variant_data = {}
    for variant in ['0_0', '1_0', '1_1', '2_0', '2_1']:
        fpath = MISSDATA_DIR / f"{map_id}_{variant}.bin"
        if fpath.exists():
            variant_data[variant] = fpath.read_bytes()

    if '0_0' in variant_data:
        main = variant_data['0_0']
        print(f"  Main (_0_0): {len(main)} bytes")
        for vname, vdata in variant_data.items():
            if vname == '0_0':
                continue
            print(f"\n  Variant _{vname}: {len(vdata)} bytes")
            # Compare first 64 bytes
            print(f"  First 64 bytes comparison:")
            limit = min(64, len(main), len(vdata))
            diffs = []
            for i in range(limit):
                if main[i] != vdata[i]:
                    diffs.append(i)
            if diffs:
                print(f"    Differences at offsets: {diffs}")
                for d in diffs[:20]:
                    print(f"      [{d:3d}] main=0x{main[d]:02x}({main[d]:3d})  variant=0x{vdata[d]:02x}({vdata[d]:3d})")
            else:
                print(f"    First 64 bytes are IDENTICAL")

            # Compare first 256 bytes
            limit256 = min(256, len(main), len(vdata))
            diffs256 = [i for i in range(limit256) if main[i] != vdata[i]]
            print(f"    Total diffs in first {limit256} bytes: {len(diffs256)}")

            # Check if variant is a subset/truncation
            if len(vdata) < len(main):
                # Check how much of variant matches beginning of main
                match_end = 0
                for i in range(min(len(main), len(vdata))):
                    if main[i] == vdata[i]:
                        match_end = i + 1
                    else:
                        break

# ============================================================
# PHASE 6: Deep dive into record detection
# ============================================================
print("\n" + "=" * 70)
print("PHASE 6: RECORD PATTERN DETECTION")
print("=" * 70)

for name in ['MAP00_0_0', 'MAP07_0_0', 'MAP14_0_0', 'MAP32_0_0']:
    fpath = MISSDATA_DIR / f"{name}.bin"
    data = fpath.read_bytes()
    file_size = len(data)
    print(f"\n--- {name} ({file_size} bytes) ---")

    # Try to find the header/data boundary
    # Look for a point where data pattern changes
    # Also try common record sizes
    variant_size = 4576
    main_excess = file_size - variant_size
    print(f"  Size - 4576 = {main_excess} bytes (excess over variant)")

    # Analyze the excess bytes (likely the unit placement data)
    if main_excess > 0:
        print(f"  Excess region (offset {variant_size} to end):")
        print(hex_dump(data, variant_size, min(128, main_excess)))

    # Also check what's at the very end
    print(f"  Last 64 bytes:")
    print(hex_dump(data, max(0, file_size - 64), 64))

    # Try to detect record sizes by autocorrelation
    # Look for repeating patterns of various sizes in the data body
    print(f"\n  Record size detection (testing sizes 16-128):")
    for rec_size in [16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 80, 96, 128]:
        # Check if data[some_offset:] has a repeating pattern of rec_size
        # Start from various offsets after potential header
        for header_end in [8, 16, 32, 48, 64]:
            if header_end + rec_size * 3 > file_size:
                continue
            # Count how many full records fit
            remaining = file_size - header_end
            if remaining % rec_size == 0:
                n_recs = remaining // rec_size
                print(f"    header={header_end}, rec_size={rec_size}: {n_recs} records (exact fit)")

# ============================================================
# PHASE 7: Byte-by-byte pattern analysis of the first file
# ============================================================
print("\n" + "=" * 70)
print("PHASE 7: MAP00_0_0 DEEP ANALYSIS")
print("=" * 70)

data = (MISSDATA_DIR / "MAP00_0_0.bin").read_bytes()
print(f"Total size: {len(data)} bytes")
print(f"\nFull hex dump of first 512 bytes:")
print(hex_dump(data, 0, 512))

print(f"\nLE16 word analysis (first 128 bytes):")
for i in range(0, 128, 2):
    val = read_le16(data, i)
    marker = ""
    if val == 0xffff:
        marker = " <-- 0xFFFF marker"
    elif val == 0x003c:
        marker = " <-- 60 decimal"
    elif val == 0x0064:
        marker = " <-- 100 decimal"
    print(f"  offset {i:3d} (0x{i:02x}): {val:5d} (0x{val:04x}){marker}")

# Look for 0xFFFF markers throughout the file
print(f"\n0xFFFF occurrences throughout file:")
for i in range(0, len(data) - 1, 2):
    if data[i] == 0xff and data[i+1] == 0xff:
        context = ' '.join(f'{b:02x}' for b in data[max(0,i-4):min(len(data),i+8)])
        print(f"  offset {i:4d} (0x{i:04x}): ...{context}...")

# ============================================================
# PHASE 8: Variant file analysis (all 4576-byte files)
# ============================================================
print("\n" + "=" * 70)
print("PHASE 8: VARIANT FILE (4576 bytes) STRUCTURE")
print("=" * 70)

variant_file = MISSDATA_DIR / "MAP00_1_0.bin"
vdata = variant_file.read_bytes()
print(f"MAP00_1_0 ({len(vdata)} bytes):")
print(hex_dump(vdata, 0, 256))

print(f"\nMAP00_1_1 comparison:")
v11_data = (MISSDATA_DIR / "MAP00_1_1.bin").read_bytes()
print(hex_dump(v11_data, 0, 256))

print(f"\nDifferences between MAP00_1_0 and MAP00_1_1:")
diffs = []
for i in range(min(len(vdata), len(v11_data))):
    if vdata[i] != v11_data[i]:
        diffs.append(i)
print(f"  Total differing bytes: {len(diffs)}")
if diffs:
    for d in diffs[:50]:
        print(f"    [{d:4d}] 0x{d:04x}: _1_0=0x{vdata[d]:02x}({vdata[d]:3d})  _1_1=0x{v11_data[d]:02x}({v11_data[d]:3d})")

# Also compare MAP00_0_0 first 4576 bytes with MAP00_1_0
print(f"\nDifferences between MAP00_0_0[0:4576] and MAP00_1_0:")
main_data = (MISSDATA_DIR / "MAP00_0_0.bin").read_bytes()
diffs_main = []
for i in range(min(4576, len(main_data), len(vdata))):
    if main_data[i] != vdata[i]:
        diffs_main.append(i)
print(f"  Total differing bytes: {len(diffs_main)}")
if diffs_main:
    for d in diffs_main[:50]:
        print(f"    [{d:4d}] 0x{d:04x}: _0_0=0x{main_data[d]:02x}({main_data[d]:3d})  _1_0=0x{vdata[d]:02x}({vdata[d]:3d})")

# ============================================================
# PHASE 9: Analyze all _0_0 files systematically
# ============================================================
print("\n" + "=" * 70)
print("PHASE 9: SYSTEMATIC HEADER SURVEY (all _0_0 files)")
print("=" * 70)

print(f"{'File':<14} {'Size':>6} | w0    w1    w2    w3    w4    w5    w6    w7   | String@?")
print("-" * 100)

all_headers = {}
for f in sorted(MISSDATA_DIR.glob("*_0_0.bin")):
    data = f.read_bytes()
    name = f.stem
    words = [read_le16(data, i) for i in range(0, min(16, len(data)), 2)]
    word_str = ' '.join(f'{w:5d}' for w in words)

    # Find first ASCII string
    str_info = ""
    for i in range(len(data)):
        if 65 <= data[i] <= 90:  # uppercase letter
            s = read_string(data, i, 16)
            if len(s) >= 4:
                str_info = f"@0x{i:04x}:'{s}'"
                break

    all_headers[name] = {
        'size': len(data),
        'words': words,
        'string': str_info
    }
    print(f"  {name:<12} {len(data):>6} | {word_str} | {str_info}")

# ============================================================
# PHASE 10: TDD File Analysis
# ============================================================
print("\n" + "=" * 70)
print("PHASE 10: TDD FILE ANALYSIS (PNG versions)")
print("=" * 70)

for tdd_name in ['HLAND.png', 'GRD.png', 'HEX.png', 'VCHEX.png']:
    tdd_path = TDD_DIR / tdd_name
    if tdd_path.exists():
        sz = tdd_path.stat().st_size
        print(f"  {tdd_name}: {sz} bytes (PNG)")
    else:
        print(f"  {tdd_name}: NOT FOUND")

# Also look for original TDD files
print("\nSearching for original .TDD files...")
for root, dirs, fnames in os.walk(r"c:\Projects\squad_tactics\scripts"):
    for fn in fnames:
        if fn.upper().endswith('.TDD'):
            fp = os.path.join(root, fn)
            sz = os.path.getsize(fp)
            print(f"  {fp}: {sz} bytes")

# Also check for decode_ipf.py which may have TDD decoding info
print("\nChecking related scripts...")
for script in ['decode_ipf.py', 'extract_ne_resources.py', '_ne_resource_scan.py']:
    sp = Path(r"c:\Projects\squad_tactics\scripts") / script
    if sp.exists():
        print(f"  Found: {sp} ({sp.stat().st_size} bytes)")

# ============================================================
# PHASE 11: Deeper record analysis with autocorrelation
# ============================================================
print("\n" + "=" * 70)
print("PHASE 11: RECORD SIZE AUTOCORRELATION")
print("=" * 70)

for name in ['MAP00_0_0', 'MAP07_0_0', 'MAP14_0_0']:
    fpath = MISSDATA_DIR / f"{name}.bin"
    data = fpath.read_bytes()
    file_size = len(data)
    print(f"\n--- {name} ({file_size} bytes) ---")

    # For each candidate record size, score how well it divides the data
    # after various header offsets
    best_scores = []
    for header_size in range(0, 128, 2):
        body = data[header_size:]
        body_len = len(body)
        if body_len < 32:
            continue
        for rec_size in range(8, 256, 2):
            if body_len % rec_size == 0:
                n_recs = body_len // rec_size
                if n_recs >= 2:
                    # Score: check if bytes repeat at rec_size intervals
                    score = 0
                    checks = 0
                    for field_off in [0, 1, 2, 3]:
                        vals = set()
                        for r in range(n_recs):
                            if header_size + r * rec_size + field_off < file_size:
                                vals.add(data[header_size + r * rec_size + field_off])
                        # Fewer unique values = more likely a type field
                        if len(vals) < n_recs * 0.5 and len(vals) > 0:
                            score += 1
                        checks += 1
                    if n_recs >= 5 and score >= 2:
                        best_scores.append((score, header_size, rec_size, n_recs))

    best_scores.sort(reverse=True)
    for score, hs, rs, nr in best_scores[:15]:
        print(f"  header={hs:3d} rec_size={rs:3d} n_recs={nr:3d} score={score}")

# ============================================================
# PHASE 12: Full hex dump of MAP00_0_0 for pattern spotting
# ============================================================
print("\n" + "=" * 70)
print("PHASE 12: MAP00_0_0 FULL HEX DUMP")
print("=" * 70)
data = (MISSDATA_DIR / "MAP00_0_0.bin").read_bytes()
print(f"Full dump ({len(data)} bytes):")
print(hex_dump(data, 0, len(data)))

# ============================================================
# PHASE 13: MAP00_1_0 FULL HEX DUMP (variant)
# ============================================================
print("\n" + "=" * 70)
print("PHASE 13: MAP00_1_0 FULL HEX DUMP (variant, 4576 bytes)")
print("=" * 70)
data_v = (MISSDATA_DIR / "MAP00_1_0.bin").read_bytes()
print(f"Full dump ({len(data_v)} bytes):")
print(hex_dump(data_v, 0, len(data_v)))

print("\n\nAnalysis complete.")
