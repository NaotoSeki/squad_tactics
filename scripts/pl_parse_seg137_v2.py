"""Re-analyze Segment 137 by looking at 0x8000 markers and sequential IDs."""
import struct

cbe = open(r"D:\PL\CBE.EXE", "rb").read()
seg_start = 0x1E8580
seg_size = 2612
seg_data = cbe[seg_start:seg_start+seg_size]

# Find ALL 0x8000 occurrences (as u16) and what follows each
print("=== 0x8000 MARKER POSITIONS AND FOLLOWING VALUES ===")
markers = []
for i in range(0, seg_size - 3, 2):
    v = struct.unpack_from("<H", seg_data, i)[0]
    if v == 0x8000:
        next_v = struct.unpack_from("<H", seg_data, i+2)[0]
        markers.append((i, next_v))
        print(f"  Byte {i:4d} (0x{seg_start+i:06X}): 0x8000, next=0x{next_v:04X} ({next_v})")

print(f"\nTotal markers: {len(markers)}")
if len(markers) > 1:
    print("Intervals between markers (bytes):")
    for j in range(len(markers)-1):
        diff = markers[j+1][0] - markers[j][0]
        print(f"  {markers[j][0]} -> {markers[j+1][0]}: {diff} bytes ({diff//2} u16s)")

# The IDs after 0x8000: check if sequential
ids = [m[1] for m in markers]
print(f"\nIDs after markers: {ids[:30]}...")
if len(ids) > 1:
    diffs = [ids[i+1] - ids[i] for i in range(len(ids)-1)]
    print(f"ID diffs: {diffs[:30]}...")

# Now look at the data BETWEEN the initial 0x8000-delimited section and the rest
last_marker_end = markers[-1][0] + 4  # 0x8000 + ID = 4 bytes
remaining = seg_size - last_marker_end
print(f"\nLast marker at byte {markers[-1][0]}, end at byte {last_marker_end}")
print(f"Remaining bytes: {remaining}")

print("\n=== REMAINING DATA AFTER MARKERS ===")
rem_data = seg_data[last_marker_end:]
for i in range(0, min(256, len(rem_data)), 32):
    off = last_marker_end + i
    chunk = rem_data[i:i+32]
    hex_str = " ".join(f"{b:02X}" for b in chunk)
    print(f"  {seg_start+off:06X}: {hex_str}")

# Maybe the REMAINING data is the actual stat table?
# The 0x8000-delimited area is a different structure
# Let me also look at the very first bytes before the first 0x8000

first_marker = markers[0][0]
print(f"\n=== DATA BEFORE FIRST 0x8000 ({first_marker} bytes) ===")
pre_data = seg_data[:first_marker]
for i in range(0, len(pre_data), 2):
    v = struct.unpack_from("<H", pre_data, i)[0]
    print(f"  byte {i:3d}: {v:5d} (0x{v:04X})")

# Interpret the 36-byte records: each has 16 u16 data + 1 u16 0x8000 + 1 u16 ID
print("\n=== 36-BYTE RECORDS (16 data fields + 0x8000 + ID) ===")
VEHICLES = [
    "M3LT","M5LT","M8","M3MT","M4MT","M4A1","M4A3","M4A3E8","M4A3E2","M26",
    "M10","M36","M3_GMC","M3_HT1","GMC_15T","M1ATG","3INM5",
    "PZKW2F","PZKW3J","PZKW3L","PZKW3N","PZKW4F","PZKW4G","PZKW4H",
    "PZKW5D","PZKW5A","PZKW5G","PZKW6E","PZKW6B",
    "STG3F","STG3F8","STG3G","STUH42","STPZ4","MARDER2","JGDPZ6",
    "SPW251","SPW234","OPEL_BT","PAK40","FLAK36",
    "L5_30","FT17","STG3GL","STUH42L",
]

# Parse from beginning, looking at each 36-byte chunk
for i in range(min(45, seg_size // 36)):
    off = i * 36
    if off + 36 > seg_size:
        break
    rec = seg_data[off:off+36]
    u16s = [struct.unpack_from("<H", rec, j)[0] for j in range(0, 36, 2)]
    
    marker_pos = None
    for j, v in enumerate(u16s):
        if v == 0x8000:
            marker_pos = j
            break
    
    name = VEHICLES[i] if i < len(VEHICLES) else f"?{i}"
    vals_str = " ".join(f"{v:5d}" for v in u16s)
    marker_info = f"  (0x8000 at field {marker_pos})" if marker_pos is not None else ""
    print(f"Rec {i:2d} [{name:10s}]: {vals_str}{marker_info}")
