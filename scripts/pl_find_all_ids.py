"""Find all sequential IDs (704-748) in Segment 137 to determine actual record boundaries."""
import struct

cbe = open(r"D:\PL\CBE.EXE", "rb").read()
seg_start = 0x1E8580
seg_size = 2612
seg_data = cbe[seg_start:seg_start+seg_size]

VEHICLES = [
    "M3LT","M5LT","M8","M3MT","M4MT","M4A1","M4A3","M4A3E8","M4A3E2","M26",
    "M10","M36","M3_GMC","M3_HT1","GMC_15T","M1ATG","3INM5",
    "PZKW2F","PZKW3J","PZKW3L","PZKW3N","PZKW4F","PZKW4G","PZKW4H",
    "PZKW5D","PZKW5A","PZKW5G","PZKW6E","PZKW6B",
    "STG3F","STG3F8","STG3G","STUH42","STPZ4","MARDER2","JGDPZ6",
    "SPW251","SPW234","OPEL_BT","PAK40","FLAK36",
    "L5_30","FT17","STG3GL","STUH42L",
]

# Search for each ID (704-748) as u16 little-endian
print("=== SEARCHING FOR SEQUENTIAL IDS 704-748 ===")
id_positions = {}
for target_id in range(704, 749):
    target_bytes = struct.pack("<H", target_id)
    idx = 0
    positions = []
    while True:
        idx = seg_data.find(target_bytes, idx)
        if idx == -1:
            break
        # Verify it's at a u16 boundary
        if idx % 2 == 0:
            positions.append(idx)
        idx += 1
    
    vehicle_idx = target_id - 704
    name = VEHICLES[vehicle_idx] if vehicle_idx < len(VEHICLES) else "?"
    id_positions[target_id] = positions
    
    if positions:
        pos_str = ", ".join(f"byte {p} (u16#{p//2})" for p in positions)
        print(f"  ID {target_id} ({name:10s}): {pos_str}")
    else:
        print(f"  ID {target_id} ({name:10s}): NOT FOUND")

# Now look at the positions: each ID should be preceded by data and a marker
print("\n=== RECORD BOUNDARIES BASED ON ID POSITIONS ===")
all_ids = []
for target_id in range(704, 749):
    for pos in id_positions.get(target_id, []):
        all_ids.append((pos, target_id))
all_ids.sort()

for i, (pos, tid) in enumerate(all_ids):
    vidx = tid - 704
    name = VEHICLES[vidx] if vidx < len(VEHICLES) else "?"
    
    # Look at 4 bytes before this ID (should be marker like 0x8000 or 0x0000)
    if pos >= 4:
        prev2 = struct.unpack_from("<H", seg_data, pos - 2)[0]
        prev4 = struct.unpack_from("<H", seg_data, pos - 4)[0]
    else:
        prev2 = prev4 = -1
    
    # Next ID position
    if i + 1 < len(all_ids):
        next_pos = all_ids[i+1][0]
        gap = next_pos - pos
    else:
        gap = seg_size - pos
    
    # Expected record start (ID should be at offset 30 within a 36-byte record)
    # So record start = pos - 30
    rec_start = pos - 30
    
    # Or: looking at the pattern, the ID is at u16 position 15 in the record
    # So in bytes, ID is at offset 30 from record start
    
    # Check if the byte at rec_start is the vehicle index
    if 0 <= rec_start < seg_size:
        start_val = struct.unpack_from("<H", seg_data, rec_start)[0]
    else:
        start_val = -1
    
    print(f"  ID={tid:3d} ({name:10s}) at byte {pos:4d}, prev_u16={prev2:5d} ({prev2:#06x}), "
          f"prev_prev={prev4:5d}, gap_to_next={gap:4d}, rec_start={rec_start}, start_val={start_val}")

# Now extract using the corrected record positions
print("\n=== CORRECTED VEHICLE DATA ===")
print(f"{'Vehicle':10s} {'idx':>4s} {'f1':>4s} {'f2':>4s} {'f3':>4s} {'f4':>4s} "
      f"{'f5':>4s} {'f6':>4s} {'f7':>4s} {'f8':>4s} {'f9':>4s} {'f10':>4s} {'f11':>4s} "
      f"{'f12':>4s} {'fl':>4s} {'mark':>5s} {'ID':>5s} {'ex1':>4s} {'ex2':>4s}")
print("-" * 130)

for pos, tid in all_ids:
    vidx = tid - 704
    name = VEHICLES[vidx] if vidx < len(VEHICLES) else f"v{vidx}"
    
    rec_start = pos - 30
    if rec_start < 0 or rec_start + 36 > seg_size:
        print(f"{name:10s} [out of bounds, rec_start={rec_start}]")
        continue
    
    rec = seg_data[rec_start:rec_start+36]
    u16s = [struct.unpack_from("<H", rec, j)[0] for j in range(0, 36, 2)]
    
    # Format values
    vals = " ".join(f"{v:4d}" for v in u16s[:14])
    mark = f"{u16s[14]:#06x}" if u16s[14] > 255 else f"{u16s[14]:5d}"
    extra = " ".join(f"{v:4d}" for v in u16s[15:])
    print(f"{name:10s} {vals} {mark} {extra}")
