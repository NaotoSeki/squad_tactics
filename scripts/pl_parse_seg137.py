"""Parse Segment 137 as vehicle stat records: 2-byte header + 45 * 58 bytes."""
import struct

cbe = open(r"D:\PL\CBE.EXE", "rb").read()
seg_start = 0x1E8580
seg_data = cbe[seg_start:seg_start+2612]

VEHICLES = [
    "M3LT","M5LT","M8","M3MT","M4MT","M4A1","M4A3","M4A3E8","M4A3E2","M26",
    "M10","M36","M3_GMC","M3_HT1","GMC_15T","M1ATG","3INM5",
    "PZKW2F","PZKW3J","PZKW3L","PZKW3N","PZKW4F","PZKW4G","PZKW4H",
    "PZKW5D","PZKW5A","PZKW5G","PZKW6E","PZKW6B",
    "STG3F","STG3F8","STG3G","STUH42","STPZ4","MARDER2","JGDPZ6",
    "SPW251","SPW234","OPEL_BT","PAK40","FLAK36",
    "L5_30","FT17","STG3GL","STUH42L",
]

header = struct.unpack_from("<H", seg_data, 0)[0]
print(f"Header: {header} (0x{header:04X})")
print()

# Parse each 58-byte record as u16 values (29 fields per record)
records = []
for i in range(45):
    off = 2 + i * 58
    rec = seg_data[off:off+58]
    u16s = [struct.unpack_from("<H", rec, j)[0] for j in range(0, 58, 2)]
    records.append(u16s)

# Print all records as a table
header_row = "".join(f"f{j:02d}  " for j in range(29))
print(f"{'Vehicle':10s} {header_row}")
print("-" * 200)

for i, (name, u16s) in enumerate(zip(VEHICLES, records)):
    vals = "".join(f"{v:5d}" for v in u16s)
    print(f"{name:10s}{vals}")

print()

# Analyze columns to identify fields
print("=== COLUMN ANALYSIS ===")
for col in range(29):
    col_vals = [records[i][col] for i in range(45)]
    min_v = min(col_vals)
    max_v = max(col_vals)
    avg_v = sum(col_vals) / len(col_vals)
    unique = len(set(col_vals))
    
    # Check correlation with known armor values
    hist_front = [44,44,25,51,51,51,63,63,101,101,51,51,13,13,0,0,0,
                  35,50,57,57,50,80,80,80,80,80,100,150,50,80,80,80,100,30,200,14,30,0,0,0,15,22,80,80]
    hist_gun = [37,37,37,37,105,75,75,76,75,90,76,90,75,0,0,57,76,
                20,50,50,75,75,75,75,75,75,75,88,88,75,75,75,105,150,75,128,0,50,0,75,88,37,37,75,105]
    
    # Simple correlation
    corr_armor = 0
    corr_gun = 0
    for j in range(45):
        if hist_front[j] > 0 and col_vals[j] > 0:
            corr_armor += 1 if (col_vals[j] > avg_v) == (hist_front[j] > sum(hist_front)/len(hist_front)) else 0
        if hist_gun[j] > 0 and col_vals[j] > 0:
            corr_gun += 1 if (col_vals[j] > avg_v) == (hist_gun[j] > sum(hist_gun)/len(hist_gun)) else 0
    
    notes = []
    if max_v == 32768:
        notes.append("contains 0x8000 (flag/marker)")
    if 700 <= max_v <= 800:
        notes.append("high values ~700")
    if unique <= 10:
        notes.append(f"low diversity ({unique} unique)")
    
    note_str = " | " + ", ".join(notes) if notes else ""
    print(f"  f{col:02d}: min={min_v:6d} max={max_v:6d} avg={avg_v:6.1f} unique={unique:2d} corr_armor={corr_armor:2d}/45 corr_gun={corr_gun:2d}/45{note_str}")

# Show specific vehicles side by side for comparison
print()
print("=== KEY VEHICLE COMPARISON ===")
key_vehicles = [
    (0, "M3LT", "light tank, 37mm, 44mm front"),
    (6, "M4A3", "medium, 75mm, 63mm front"),
    (8, "M4A3E2", "Jumbo, 75mm, 101mm front"),
    (9, "M26", "heavy, 90mm, 101mm front"),
    (17, "PZKW2F", "light, 20mm, 35mm front"),
    (23, "PZKW4H", "medium, 75mm, 80mm front"),
    (27, "PZKW6E", "Tiger, 88mm, 100mm front"),
    (28, "PZKW6B", "Tiger II, 88mm, 150mm front"),
    (35, "JGDPZ6", "Jagdpanzer, 128mm, 200mm front"),
    (14, "GMC_15T", "truck, no armor"),
    (38, "OPEL_BT", "truck, no armor"),
]

for idx, name, desc in key_vehicles:
    u16s = records[idx]
    print(f"  {name:10s} ({desc})")
    print(f"    fields: {u16s}")
    print()
