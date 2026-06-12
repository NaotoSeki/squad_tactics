"""
Phase 2: Deep structural analysis of MISSDATA binary files.
Focus on identifying section boundaries, unit record format, and Shift-JIS text blocks.
"""
import os, struct, json, sys
from pathlib import Path
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

MISSDATA_DIR = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded\ne_resources\MISSDATA")

def read_le16(data, offset):
    return struct.unpack_from('<H', data, offset)[0]

def read_le32(data, offset):
    return struct.unpack_from('<I', data, offset)[0]

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

def find_null_terminators(data, start=0, end=None):
    """Find all null bytes in data."""
    if end is None:
        end = len(data)
    positions = []
    for i in range(start, end):
        if data[i] == 0:
            positions.append(i)
    return positions

def decode_sjis(data, start, max_len=200):
    """Decode Shift-JIS text from data."""
    end = start
    while end < min(start + max_len, len(data)) and data[end] != 0:
        end += 1
    try:
        return data[start:end].decode('shift_jis', errors='replace'), end
    except:
        return data[start:end].decode('ascii', errors='replace'), end

# ============================================================
# ANALYSIS 1: Find all text blocks and structural boundaries
# ============================================================
print("=" * 70)
print("ANALYSIS 1: TEXT BLOCK & SECTION BOUNDARY DETECTION")
print("=" * 70)

for name in ['MAP00_0_0', 'MAP01_0_0', 'MAP07_0_0', 'MAP14_0_0', 'MAP32_0_0']:
    fpath = MISSDATA_DIR / f"{name}.bin"
    data = fpath.read_bytes()
    unit_count = read_le16(data, 2)
    print(f"\n{'='*60}")
    print(f"  {name} ({len(data)} bytes, unit_count={unit_count})")
    print(f"{'='*60}")

    # Decode the map name
    map_name_end = 8
    while map_name_end < 20 and data[map_name_end] != 0:
        map_name_end += 1
    map_name = data[8:map_name_end].decode('ascii')
    print(f"  Map name: {map_name} (bytes 8-{map_name_end})")

    # Find all null terminators in the first 1024 bytes
    # These separate text blocks
    nulls = []
    i = map_name_end
    while i < min(len(data), 2048):
        if data[i] == 0:
            # Check if this is a text block terminator (preceded by text)
            nulls.append(i)
        i += 1

    # Try to parse text blocks
    pos = map_name_end + 1  # skip the null
    # After null: sometimes 00 padding, then text starts
    while pos < len(data) and data[pos] == 0:
        pos += 1

    text_blocks = []
    block_num = 0
    while pos < min(len(data), 4500):
        # Try to decode Shift-JIS text
        text, end_pos = decode_sjis(data, pos)
        if len(text) >= 3 and any(ord(c) > 127 for c in text):
            text_blocks.append({
                'start': pos,
                'end': end_pos,
                'length': end_pos - pos,
                'text': text[:60] + ('...' if len(text) > 60 else '')
            })
            block_num += 1
            pos = end_pos + 1
            # Skip non-text data between blocks
            binary_start = pos
            while pos < min(len(data), 4500):
                # Check if we're at a text block start (Shift-JIS high byte)
                if pos + 1 < len(data) and 0x82 <= data[pos] <= 0x9F and 0x40 <= data[pos+1] <= 0xFC:
                    break
                if pos + 1 < len(data) and 0xE0 <= data[pos] <= 0xEF and 0x40 <= data[pos+1] <= 0xFC:
                    break
                pos += 1
            if pos > binary_start:
                binary_len = pos - binary_start
                if binary_len >= 4:
                    hex_preview = ' '.join(f'{data[j]:02x}' for j in range(binary_start, min(binary_start + 20, pos)))
                    text_blocks.append({
                        'start': binary_start,
                        'end': pos,
                        'length': binary_len,
                        'text': f'[BINARY: {hex_preview}]'
                    })
        else:
            pos += 1

    for tb in text_blocks[:25]:
        print(f"  [{tb['start']:4d}-{tb['end']:4d}] ({tb['length']:3d}b) {tb['text']}")

# ============================================================
# ANALYSIS 2: Understand the 6-byte pattern in the excess region
# ============================================================
print("\n" + "=" * 70)
print("ANALYSIS 2: EXCESS REGION (after byte 4576) PATTERN ANALYSIS")
print("=" * 70)

for name in ['MAP00_0_0', 'MAP07_0_0', 'MAP14_0_0', 'MAP32_0_0']:
    fpath = MISSDATA_DIR / f"{name}.bin"
    data = fpath.read_bytes()
    unit_count = read_le16(data, 2)
    excess_start = 4576
    excess = data[excess_start:]
    print(f"\n--- {name} (excess={len(excess)} bytes, units={unit_count}) ---")

    # Analyze the 6-byte pattern: each starts with 0x80
    records_6 = []
    i = 0
    while i + 5 < len(excess):
        if excess[i] == 0x80:
            rec = excess[i:i+6]
            x = rec[1] | (rec[2] << 8)
            y = rec[3] | (rec[4] << 8)
            t = rec[5]
            records_6.append({'offset': excess_start + i, 'x': x, 'y': y, 'type': t, 'raw': rec})
            i += 6
        else:
            break

    print(f"  6-byte records starting with 0x80: {len(records_6)} found")
    non_empty = [r for r in records_6 if r['x'] != 0 or r['y'] != 0]
    print(f"  Non-empty (x/y != 0): {len(non_empty)}")
    for r in non_empty[:20]:
        raw_hex = ' '.join(f'{b:02x}' for b in r['raw'])
        print(f"    @0x{r['offset']:04x}: x={r['x']:4d} y={r['y']:4d} type=0x{r['type']:02x}  [{raw_hex}]")

    # What comes after the 0x80 block?
    end_of_80_block = excess_start + len(records_6) * 6
    remaining = len(data) - end_of_80_block
    print(f"\n  After 0x80 block (offset {end_of_80_block}, {remaining} bytes remaining):")
    if remaining > 0:
        print(hex_dump(data, end_of_80_block, min(256, remaining)))

# ============================================================
# ANALYSIS 3: Size-based record detection
# ============================================================
print("\n" + "=" * 70)
print("ANALYSIS 3: FILE SIZE FORMULA ANALYSIS")
print("=" * 70)

# For all _0_0 files, check: filesize = base + N * record_size
all_sizes = {}
for f in sorted(MISSDATA_DIR.glob("*_0_0.bin")):
    data = f.read_bytes()
    unit_count = read_le16(data, 2)
    all_sizes[f.stem] = {'size': len(data), 'units': unit_count}

# Try different formulas
print("\nTesting: filesize = base + units * rec_size")
for base in range(4500, 4600, 2):
    for rec_size in range(50, 600, 2):
        matches = 0
        total = 0
        for name, info in all_sizes.items():
            expected = base + info['units'] * rec_size
            if expected == info['size']:
                matches += 1
            total += 1
        if matches >= 5:
            print(f"  base={base} rec_size={rec_size}: {matches}/{total} matches")
            if matches >= 10:
                matching = [n for n, i in all_sizes.items() if base + i['units'] * rec_size == i['size']]
                non_matching = [n for n, i in all_sizes.items() if base + i['units'] * rec_size != i['size']]
                print(f"    Matching: {matching[:10]}")
                print(f"    Non-matching: {non_matching[:10]}")

# Also try: filesize = base + units * rec_size + footer
print("\nTesting with footer: filesize = base + units * rec_size + footer")
for base in range(4500, 4600, 2):
    for footer in range(0, 64, 2):
        for rec_size in range(50, 600, 2):
            matches = 0
            total = 0
            for name, info in all_sizes.items():
                expected = base + info['units'] * rec_size + footer
                if expected == info['size']:
                    matches += 1
                total += 1
            if matches >= 10:
                print(f"  base={base} rec_size={rec_size} footer={footer}: {matches}/{total} matches")

# ============================================================
# ANALYSIS 4: Find unit name strings at end of file
# ============================================================
print("\n" + "=" * 70)
print("ANALYSIS 4: UNIT NAME STRINGS IN TAIL SECTION")
print("=" * 70)

for name in ['MAP00_0_0', 'MAP07_0_0', 'MAP14_0_0', 'MAP32_0_0']:
    fpath = MISSDATA_DIR / f"{name}.bin"
    data = fpath.read_bytes()
    unit_count = read_le16(data, 2)
    print(f"\n--- {name} ({len(data)} bytes, units={unit_count}) ---")

    # Search for ASCII strings (unit names) in the latter portion
    search_start = len(data) // 2
    i = search_start
    strings_found = []
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

    print(f"  ASCII strings in latter half ({len(strings_found)} found):")
    for off, s in strings_found[:30]:
        print(f"    0x{off:04x}: '{s}'")

    # Also look for patterns that might be unit records
    # Try to find repeating structures with consistent size
    if strings_found:
        # Check spacing between consecutive strings
        for j in range(min(5, len(strings_found) - 1)):
            gap = strings_found[j+1][0] - strings_found[j][0]
            print(f"    Gap between '{strings_found[j][1]}' and '{strings_found[j+1][1]}': {gap} bytes")

# ============================================================
# ANALYSIS 5: Work from the known unit names backward
# ============================================================
print("\n" + "=" * 70)
print("ANALYSIS 5: UNIT RECORD STRUCTURE FROM KNOWN NAMES")
print("=" * 70)

# MAP32_0_0 has clear unit names like "Lehr", "26VG" etc.
# Let's examine the structure around each unit name
fpath = MISSDATA_DIR / "MAP32_0_0.bin"
data = fpath.read_bytes()
unit_count = read_le16(data, 2)
print(f"MAP32_0_0: {len(data)} bytes, {unit_count} units")

# Find all ASCII strings >= 3 chars
all_strings = []
i = 0
while i < len(data):
    if 48 <= data[i] < 127:  # start with digit or letter
        start = i
        while i < len(data) and 32 <= data[i] < 127:
            i += 1
        s = data[start:i].decode('ascii')
        if len(s) >= 2 and any(c.isalpha() for c in s):
            all_strings.append((start, s))
    else:
        i += 1

# Focus on unit-name-like strings in the tail section
unit_names = [(off, s) for off, s in all_strings if off > 20000 and (
    'VG' in s or 'Ind' in s or 'Lehr' in s or 'CC' in s or 'Gds' in s or
    'Can' in s or s.startswith('1') or s.startswith('2') or s.startswith('3') or
    s.startswith('9') or 'Maucke' in s or 'Aosta' in s or 'Manteuffel' in s
)]

print(f"\nUnit name candidates ({len(unit_names)} found):")
for off, s in unit_names:
    # Show context around the name
    ctx_start = max(0, off - 32)
    ctx_end = min(len(data), off + len(s) + 32)
    print(f"\n  @0x{off:04x} ({off}): '{s}'")
    print(hex_dump(data, ctx_start, ctx_end - ctx_start))

# Check if the names are at regular intervals
if len(unit_names) >= 2:
    print(f"\nIntervals between unit names:")
    for j in range(min(20, len(unit_names) - 1)):
        gap = unit_names[j+1][0] - unit_names[j][0]
        print(f"  '{unit_names[j][1]}' -> '{unit_names[j+1][1]}': {gap} bytes")

# ============================================================
# ANALYSIS 6: Examine MAP07 which has "Manteuffel" 
# ============================================================
print("\n" + "=" * 70)
print("ANALYSIS 6: MAP07_0_0 UNIT NAME REGION")
print("=" * 70)

fpath = MISSDATA_DIR / "MAP07_0_0.bin"
data = fpath.read_bytes()
unit_count = read_le16(data, 2)

# Find "Manteuffel"
for i in range(len(data) - 10):
    if data[i:i+4] == b'Mant':
        print(f"  Found 'Manteuffel' at offset 0x{i:04x} ({i})")
        # Dump surrounding context
        ctx_start = max(0, i - 64)
        ctx_end = min(len(data), i + 64)
        print(hex_dump(data, ctx_start, ctx_end - ctx_start))

# Find strings with numbers (unit IDs like "334", "999")
print(f"\nAll ASCII strings in MAP07_0_0 after offset 0x1C00:")
i = 0x1C00
while i < len(data):
    if 32 <= data[i] < 127:
        start = i
        while i < len(data) and 32 <= data[i] < 127:
            i += 1
        s = data[start:i].decode('ascii')
        if len(s) >= 2:
            print(f"  @0x{i-len(s):04x}: '{s}' (context follows)")
            ctx_start = max(0, start - 16)
            print(hex_dump(data, ctx_start, min(64, len(data) - ctx_start)))
    else:
        i += 1

# ============================================================
# ANALYSIS 7: Systematic record size from unit regions
# ============================================================
print("\n" + "=" * 70)
print("ANALYSIS 7: UNIT RECORD BOUNDARIES IN MAP32_0_0")
print("=" * 70)

fpath = MISSDATA_DIR / "MAP32_0_0.bin"
data = fpath.read_bytes()
unit_count = read_le16(data, 2)  # 68

# The excess region starts at 4576 and has the 80-byte hex grid
# After that, unit records with names
# Let's find where the 0x80 pattern ends and the unit record table begins

# Count consecutive 6-byte 0x80 records from offset 4576
pos = 4576
count_80 = 0
while pos + 5 < len(data) and data[pos] == 0x80:
    pos += 6
    count_80 += 1

print(f"  0x80 records from offset 4576: {count_80} ({count_80 * 6} bytes)")
print(f"  0x80 block ends at offset {pos} (0x{pos:04x})")
remaining_after_80 = len(data) - pos
print(f"  Remaining after 0x80 block: {remaining_after_80} bytes")
print(f"  If {unit_count} unit records: {remaining_after_80 / unit_count:.1f} bytes per record")

# Dump first few hundred bytes of unit record area
print(f"\n  Unit record area (offset {pos}):")
print(hex_dump(data, pos, min(512, remaining_after_80)))

# Also check end of file
print(f"\n  Last 128 bytes:")
print(hex_dump(data, len(data) - 128, 128))

# ============================================================
# ANALYSIS 8: Same analysis for MAP00_0_0 and MAP07_0_0
# ============================================================
print("\n" + "=" * 70)
print("ANALYSIS 8: UNIT RECORD AREA FOR OTHER FILES")
print("=" * 70)

for name in ['MAP00_0_0', 'MAP07_0_0', 'MAP14_0_0']:
    fpath = MISSDATA_DIR / f"{name}.bin"
    data = fpath.read_bytes()
    unit_count = read_le16(data, 2)

    pos = 4576
    count_80 = 0
    while pos + 5 < len(data) and data[pos] == 0x80:
        pos += 6
        count_80 += 1

    remaining = len(data) - pos
    per_unit = remaining / unit_count if unit_count > 0 else 0

    print(f"\n--- {name} (units={unit_count}) ---")
    print(f"  0x80 records: {count_80}, block ends at offset {pos} (0x{pos:04x})")
    print(f"  Remaining: {remaining} bytes ({per_unit:.1f} per unit)")
    print(f"\n  Unit record area start:")
    print(hex_dump(data, pos, min(256, remaining)))

# ============================================================
# ANALYSIS 9: Try to find record boundaries using 0xFF markers
# ============================================================
print("\n" + "=" * 70)
print("ANALYSIS 9: 0xFF FF SECTION MARKERS IN ALL FILES")
print("=" * 70)

for name in ['MAP00_0_0', 'MAP07_0_0', 'MAP14_0_0', 'MAP32_0_0']:
    fpath = MISSDATA_DIR / f"{name}.bin"
    data = fpath.read_bytes()
    unit_count = read_le16(data, 2)

    print(f"\n--- {name} (units={unit_count}, {len(data)} bytes) ---")
    # Find all occurrences of ff ff in the file
    for i in range(len(data) - 1):
        if data[i] == 0xff and data[i+1] == 0xff:
            ctx = ' '.join(f'{data[j]:02x}' for j in range(max(0,i-4), min(len(data),i+12)))
            print(f"  0x{i:04x} ({i:5d}): {ctx}")

print("\n\nPhase 2 analysis complete.")
