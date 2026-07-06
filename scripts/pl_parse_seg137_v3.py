"""Parse Segment 137: 45 x 36-byte vehicle stat records."""
import struct
import json

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

HIST = {
    "M3LT":    {"gun": 37, "front": 44, "side": 25},
    "M5LT":    {"gun": 37, "front": 44, "side": 28},
    "M8":      {"gun": 37, "front": 25, "side": 12},
    "M3MT":    {"gun": 37, "front": 51, "side": 38},
    "M4MT":    {"gun": 105,"front": 51, "side": 38},
    "M4A1":    {"gun": 75, "front": 51, "side": 38},
    "M4A3":    {"gun": 75, "front": 63, "side": 38},
    "M4A3E8":  {"gun": 76, "front": 63, "side": 38},
    "M4A3E2":  {"gun": 75, "front":101, "side": 76},
    "M26":     {"gun": 90, "front":101, "side": 76},
    "M10":     {"gun": 76, "front": 51, "side": 25},
    "M36":     {"gun": 90, "front": 51, "side": 25},
    "M3_GMC":  {"gun": 75, "front": 13, "side":  6},
    "M3_HT1":  {"gun": 0,  "front": 13, "side":  6},
    "GMC_15T": {"gun": 0,  "front":  0, "side":  0},
    "M1ATG":   {"gun": 57, "front":  0, "side":  0},
    "3INM5":   {"gun": 76, "front":  0, "side":  0},
    "PZKW2F":  {"gun": 20, "front": 35, "side": 15},
    "PZKW3J":  {"gun": 50, "front": 50, "side": 30},
    "PZKW3L":  {"gun": 50, "front": 57, "side": 30},
    "PZKW3N":  {"gun": 75, "front": 57, "side": 30},
    "PZKW4F":  {"gun": 75, "front": 50, "side": 30},
    "PZKW4G":  {"gun": 75, "front": 80, "side": 30},
    "PZKW4H":  {"gun": 75, "front": 80, "side": 30},
    "PZKW5D":  {"gun": 75, "front": 80, "side": 40},
    "PZKW5A":  {"gun": 75, "front": 80, "side": 50},
    "PZKW5G":  {"gun": 75, "front": 80, "side": 50},
    "PZKW6E":  {"gun": 88, "front":100, "side": 80},
    "PZKW6B":  {"gun": 88, "front":150, "side": 80},
    "STG3F":   {"gun": 75, "front": 50, "side": 30},
    "STG3F8":  {"gun": 75, "front": 80, "side": 30},
    "STG3G":   {"gun": 75, "front": 80, "side": 30},
    "STUH42":  {"gun":105, "front": 80, "side": 30},
    "STPZ4":   {"gun":150, "front":100, "side": 40},
    "MARDER2": {"gun": 75, "front": 30, "side": 14},
    "JGDPZ6":  {"gun":128, "front":200, "side": 80},
    "SPW251":  {"gun": 0,  "front": 14, "side":  8},
    "SPW234":  {"gun": 50, "front": 30, "side":  8},
    "OPEL_BT": {"gun": 0,  "front":  0, "side":  0},
    "PAK40":   {"gun": 75, "front":  0, "side":  0},
    "FLAK36":  {"gun": 88, "front":  0, "side":  0},
    "L5_30":   {"gun": 37, "front": 15, "side": 13},
    "FT17":    {"gun": 37, "front": 22, "side": 16},
    "STG3GL":  {"gun": 75, "front": 80, "side": 30},
    "STUH42L": {"gun":105, "front": 80, "side": 30},
}

# Parse all 45 records (36 bytes each)
records = []
for i in range(45):
    off = i * 36
    rec = seg_data[off:off+36]
    u16s = [struct.unpack_from("<H", rec, j)[0] for j in range(0, 36, 2)]
    records.append(u16s)

# Print in a clear table format
print("=== ALL 45 VEHICLE RECORDS (36 bytes = 18 u16 fields each) ===")
print(f"{'':10s} idx   f1   f2   f3   f4   f5   f6   f7   f8   f9  f10  f11  f12 flag mark   ID  ex1  ex2")
print("-" * 130)

for i, (name, u16s) in enumerate(zip(VEHICLES, records)):
    # Determine marker type
    if u16s[14] == 0x8000:
        mark_str = "8000"
    elif u16s[14] == 0x4000:
        mark_str = "4000"
    else:
        mark_str = f"{u16s[14]:4d}"
    
    vals = " ".join(f"{v:4d}" for v in u16s[:14])
    extra = " ".join(f"{v:4d}" for v in u16s[15:])
    print(f"{name:10s} {vals} {mark_str} {extra}")

# Analyze each column
print("\n=== FIELD ANALYSIS ===")
for col in range(18):
    col_vals = [records[i][col] for i in range(45)]
    cname = ["idx","f1","f2","f3","f4","f5","f6","f7","f8","f9","f10","f11","f12","flag","mark","ID","ex1","ex2"][col]
    
    print(f"\n  {cname} (column {col}):")
    print(f"    min={min(col_vals):5d} max={max(col_vals):5d} avg={sum(col_vals)/45:.1f}")
    
    # Correlation with historical armor
    if col not in [0, 14, 15]:  # Skip index, marker, ID
        front_vals = [HIST[VEHICLES[i]]["front"] for i in range(45)]
        gun_vals = [HIST[VEHICLES[i]]["gun"] for i in range(45)]
        
        # Spearman-like rank correlation
        def rank_corr(a, b):
            n = len(a)
            if n == 0: return 0
            pairs = list(zip(a, b))
            concordant = sum(1 for i in range(n) for j in range(i+1, n) 
                           if (pairs[i][0]-pairs[j][0]) * (pairs[i][1]-pairs[j][1]) > 0)
            discordant = sum(1 for i in range(n) for j in range(i+1, n) 
                            if (pairs[i][0]-pairs[j][0]) * (pairs[i][1]-pairs[j][1]) < 0)
            total = concordant + discordant
            if total == 0: return 0
            return (concordant - discordant) / total
        
        c_front = rank_corr(col_vals, front_vals)
        c_gun = rank_corr(col_vals, gun_vals)
        
        indicators = []
        if abs(c_front) > 0.3: indicators.append(f"armor_front corr={c_front:.2f}")
        if abs(c_gun) > 0.3: indicators.append(f"gun_cal corr={c_gun:.2f}")
        
        if indicators:
            print(f"    CORRELATIONS: {', '.join(indicators)}")

# Remaining data after 45 records
remaining_start = 45 * 36  # 1620
remaining_data = seg_data[remaining_start:]
print(f"\n=== REMAINING DATA (bytes {remaining_start}-{seg_size}, {len(remaining_data)} bytes) ===")
for off in range(0, min(len(remaining_data), 320), 32):
    chunk = remaining_data[off:off+32]
    hex_str = " ".join(f"{b:02X}" for b in chunk)
    ascii_str = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
    abs_off = seg_start + remaining_start + off
    print(f"  {abs_off:06X}: {hex_str}  {ascii_str}")

# Parse remaining as u16
rem_u16 = [struct.unpack_from("<H", remaining_data, i)[0] for i in range(0, len(remaining_data)-1, 2)]
print(f"\n  As u16 ({len(rem_u16)} values): {rem_u16[:80]}...")

# Check if remaining has 0x8000 markers too  
rem_markers = [(i, rem_u16[i+1] if i+1 < len(rem_u16) else -1) for i, v in enumerate(rem_u16) if v == 0x8000 or v == 0x4000]
if rem_markers:
    print(f"\n  Markers in remaining: {rem_markers[:20]}")
