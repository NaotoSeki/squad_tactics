"""
Deep scan for vehicle stat data in CBE.EXE.
Strategy: Find all arrays of 45 elements, and search for the number 45 in code.
Also look at medium-sized data segments systematically.
"""
import struct

cbe = open(r"D:\PL\CBE.EXE", "rb").read()
ne_off = struct.unpack_from("<H", cbe, 0x3C)[0]
seg_table_off = ne_off + struct.unpack_from("<H", cbe, ne_off + 0x22)[0]
n_segments = struct.unpack_from("<H", cbe, ne_off + 0x1C)[0]
align_shift = struct.unpack_from("<H", cbe, ne_off + 0x32)[0]

segments = []
for i in range(n_segments):
    entry_off = seg_table_off + i * 8
    sector = struct.unpack_from("<H", cbe, entry_off)[0]
    size = struct.unpack_from("<H", cbe, entry_off + 2)[0]
    flags = struct.unpack_from("<H", cbe, entry_off + 4)[0]
    file_off = sector << align_shift
    is_data = (flags & 0x0001) != 0
    segments.append((i+1, file_off, size, is_data))

# === Strategy 1: Look at ALL data segments 90-3000 bytes (good size for stat tables) ===
print("=== DATA SEGMENTS 90-6000 BYTES (potential stat table size) ===")
candidate_segs = [(n, o, s) for n, o, s, d in segments if d and 90 <= s <= 6000 and o > 0]
print(f"Found {len(candidate_segs)} candidate segments")
print()

for seg_num, seg_off, seg_size in sorted(candidate_segs, key=lambda x: x[2], reverse=True):
    seg_data = cbe[seg_off:seg_off+seg_size]
    
    # Quick check: is this mostly text or numerical data?
    printable = sum(1 for b in seg_data if 32 <= b < 127)
    ratio = printable / seg_size if seg_size > 0 else 0
    
    # Skip text-heavy segments
    if ratio > 0.6:
        continue
    
    # Show u16 values
    vals = [struct.unpack_from("<H", seg_data, i)[0] for i in range(0, min(seg_size, 256) - 1, 2)]
    max_val = max(vals) if vals else 0
    min_val = min(vals) if vals else 0
    nonzero = sum(1 for v in vals if v > 0)
    
    # Filter: reasonable stat-like values (not pointers, not all zeros)
    if max_val > 1000 and min_val == 0:
        # Might be pointer table, skip for now
        pass
    
    print(f"Seg {seg_num:3d}: off=0x{seg_off:06X} size={seg_size:5d} printable={ratio:.0%} max_u16={max_val} nonzero={nonzero}/{len(vals)}")
    
    # If size is divisible by 45, interesting!
    if seg_size % 45 == 0:
        rec = seg_size // 45
        print(f"  *** size / 45 = {rec} bytes per record!")
    if seg_size % 90 == 0:
        rec = seg_size // 90
        print(f"  *** size / 90 = {rec} (u16 per 45 records)")
    
    # Show first 128 bytes as hex
    for row_off in range(0, min(128, seg_size), 32):
        chunk = seg_data[row_off:row_off+32]
        hex_str = " ".join(f"{b:02X}" for b in chunk)
        print(f"    {seg_off+row_off:06X}: {hex_str}")
    
    if seg_size > 128:
        print("    ...")
    print()

# === Strategy 2: Search code segments for CMP/MOV with value 45 (0x2D) ===
print("\n=== SEARCHING CODE FOR VALUE 45 (vehicle count) ===")
# In 16-bit x86, CMP reg, 0x2D would be: 83 F8 2D (cmp ax,2D) or 3D 2D 00 (cmp ax,002D)
# Also: MOV reg, 0x2D would be: B8 2D 00 (mov ax,2D) or C7 06 xx xx 2D 00 (mov [xxxx], 002D)
patterns_45 = [
    (b"\x3D\x2D\x00", "CMP AX, 0x002D"),
    (b"\x83\xF8\x2D", "CMP AX, 0x2D"),
    (b"\x83\xFB\x2D", "CMP BX, 0x2D"),
    (b"\x83\xF9\x2D", "CMP CX, 0x2D"),
    (b"\x83\xFA\x2D", "CMP DX, 0x2D"),
    (b"\xB8\x2D\x00", "MOV AX, 0x002D"),
    (b"\xBB\x2D\x00", "MOV BX, 0x002D"),
    (b"\xB9\x2D\x00", "MOV CX, 0x002D"),
]

for seg_num, seg_off, seg_size, is_data in segments:
    if is_data or seg_size == 0:
        continue
    seg_data = cbe[seg_off:seg_off+seg_size]
    
    for pattern, desc in patterns_45:
        idx = 0
        while True:
            idx = seg_data.find(pattern, idx)
            if idx == -1:
                break
            # Get surrounding context (20 bytes before, 20 after)
            start = max(0, idx - 12)
            end = min(seg_size, idx + len(pattern) + 20)
            context = seg_data[start:end]
            hex_ctx = " ".join(f"{b:02X}" for b in context)
            
            # Highlight the match
            match_pos_in_ctx = idx - start
            print(f"  Seg {seg_num} +0x{idx:04X}: {desc}")
            print(f"    {hex_ctx}")
            idx += 1

# === Strategy 3: Search for 0x2D as loop counter with MUL nearby ===
# When accessing arr[vehicle_idx], code would multiply index by record size
print("\n=== SEARCH FOR MUL/IMUL NEAR VEHICLE LOOP ===")
for seg_num, seg_off, seg_size, is_data in segments:
    if is_data or seg_size == 0:
        continue
    seg_data = cbe[seg_off:seg_off+seg_size]
    
    for pattern, desc in patterns_45[:5]:  # Just CMP patterns
        idx = 0
        while True:
            idx = seg_data.find(pattern, idx)
            if idx == -1:
                break
            # Look for MUL/IMUL within 50 bytes
            nearby = seg_data[max(0, idx-50):idx+50]
            has_mul = False
            for mul_op in [0xF7, 0x69, 0x6B]:  # MUL, IMUL variations
                if mul_op in nearby:
                    has_mul = True
                    break
            if has_mul:
                start = max(0, idx - 30)
                end = min(seg_size, idx + 40)
                context = seg_data[start:end]
                hex_ctx = " ".join(f"{b:02X}" for b in context)
                print(f"  Seg {seg_num} +0x{idx:04X}: {desc} (MUL nearby!)")
                print(f"    {hex_ctx}")
            idx += 1
