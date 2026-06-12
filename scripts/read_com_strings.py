"""Read key strings directly from COM.DLL binary with correct Shift-JIS decoding."""
import struct
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

with open(r"D:\PL\COM.DLL", "rb") as f:
    data = f.read()

def read_sjis_string(data, offset, max_len=200):
    """Read a null-terminated Shift-JIS string."""
    end = offset
    while end < min(offset + max_len, len(data)) and data[end] != 0:
        end += 1
    return data[offset:end].decode("cp932", errors="replace")

def scan_null_terminated_sjis(data, start, length, min_len=4):
    """Scan for null-terminated Shift-JIS strings."""
    strings = []
    i = start
    end = min(start + length, len(data))
    while i < end:
        if data[i] == 0:
            i += 1
            continue
        s = read_sjis_string(data, i)
        if len(s) >= min_len:
            raw = data[i:i+len(s.encode("cp932", errors="replace"))]
            strings.append((i, s, len(raw)))
            i += len(raw) + 1
        else:
            i += 1
    return strings

# ─ Parse NE to find segments ─
ne_off = struct.unpack_from("<I", data, 0x3C)[0]
ne = data[ne_off:]
ne_align = struct.unpack_from("<H", ne, 0x32)[0]
seg_count = struct.unpack_from("<H", ne, 0x1C)[0]
seg_table_off = struct.unpack_from("<H", ne, 0x22)[0]

segments = []
for i in range(seg_count):
    soff = ne_off + seg_table_off + i * 8
    sector = struct.unpack_from("<H", data, soff)[0]
    seg_len = struct.unpack_from("<H", data, soff + 2)[0]
    seg_flags = struct.unpack_from("<H", data, soff + 4)[0]
    file_off = sector << ne_align
    is_data = bool(seg_flags & 0x0001)
    stype = "DATA" if is_data else "CODE"
    actual_len = seg_len if seg_len > 0 else 65536
    segments.append((i+1, stype, file_off, actual_len))
    print(f"Segment {i+1}: {stype} at 0x{file_off:X}, length={actual_len}")

print(f"\n{'='*80}")
print("CODE SEGMENT STRINGS (Null-terminated Shift-JIS)")
print(f"{'='*80}")

# The CODE segment has embedded strings mixed with code
# Look for mission name area, rank names, weapon names
code_seg = segments[0]
code_start = code_seg[2]
code_len = code_seg[3]

strings = scan_null_terminated_sjis(data, code_start, code_len, min_len=3)

# Group by character type
mission_names = []
rank_names = []
weapon_model_names = []
other_jp = []
other_ascii = []
error_msgs = []
exported_names = []

for off, text, blen in strings:
    has_jp = any(ord(c) > 0x7F for c in text)
    
    if "作戦" in text or "任務" in text or "戦闘" in text:
        mission_names.append((off, text))
    elif text in ("二等兵","一等兵","兵長","伍長","軍曹","曹長","少尉","中尉","大尉","少佐","中佐","大佐","准将","少将","中将","大将","元帥"):
        rank_names.append((off, text))
    elif any(k in text for k in ("等兵","伍長","軍曹","曹長","少尉","中尉","大尉","少佐","中佐","大佐","准将","少将","中将","大将","元帥","参謀","司令","師団","連隊","大隊","中隊","小隊")):
        rank_names.append((off, text))
    elif "失敗" in text or "Error" in text or "error" in text or "***" in text:
        error_msgs.append((off, text))
    elif text.startswith("_DLL") or text.startswith("WEP") or text.startswith("___"):
        exported_names.append((off, text))
    elif has_jp:
        # Check for weapon-like terms
        if any(k in text for k in ("銃","砲","弾","ライフル","マシンガン","機関銃","手榴弾","チーム","分隊")):
            weapon_model_names.append((off, text))
        else:
            other_jp.append((off, text))
    else:
        # ASCII - check for WW2 weapon model numbers
        if any(c.isdigit() for c in text) and len(text) > 2:
            weapon_model_names.append((off, text))
        elif len(text) > 2:
            other_ascii.append((off, text))

print(f"\n--- Mission Names ({len(mission_names)}) ---")
for off, text in mission_names:
    print(f"  [0x{off:04X}] {text}")

print(f"\n--- Rank/Military Titles ({len(rank_names)}) ---")
for off, text in rank_names:
    print(f"  [0x{off:04X}] {text}")

print(f"\n--- Weapon/Equipment Names ({len(weapon_model_names)}) ---")
for off, text in weapon_model_names:
    print(f"  [0x{off:04X}] {text}")

print(f"\n--- Error Messages ({len(error_msgs)}) ---")
for off, text in error_msgs:
    print(f"  [0x{off:04X}] {text}")

print(f"\n--- Other Japanese ({len(other_jp)}) ---")
for off, text in other_jp[:80]:
    print(f"  [0x{off:04X}] {text}")
if len(other_jp) > 80:
    print(f"  ... and {len(other_jp)-80} more")

print(f"\n--- Other ASCII ({len(other_ascii)}) ---")
for off, text in other_ascii[:50]:
    print(f"  [0x{off:04X}] {text}")
if len(other_ascii) > 50:
    print(f"  ... and {len(other_ascii)-50} more")

# ─ DATA segments ─
print(f"\n\n{'='*80}")
print("DATA SEGMENTS")
print(f"{'='*80}")

for seg_idx, stype, file_off, seg_len in segments:
    if stype != "DATA":
        continue
    print(f"\n--- Segment {seg_idx} (DATA) at 0x{file_off:X}, {seg_len} bytes ---")
    
    # Show hex dump of first 128 bytes
    chunk = data[file_off:file_off + min(128, seg_len)]
    for row in range(0, len(chunk), 16):
        hex_part = " ".join(f"{b:02X}" for b in chunk[row:row+16])
        ascii_part = "".join(chr(b) if 0x20 <= b < 0x7F else "." for b in chunk[row:row+16])
        print(f"  {file_off+row:08X}  {hex_part:<48s}  {ascii_part}")
    
    # Scan for strings
    strings = scan_null_terminated_sjis(data, file_off, seg_len, min_len=3)
    if strings:
        print(f"\n  Strings found ({len(strings)}):")
        for off, text, blen in strings[:30]:
            print(f"    [0x{off:04X}] {text}")

# ─ Analyze the 4-byte record tables ─
print(f"\n\n{'='*80}")
print("4-BYTE RECORD TABLE ANALYSIS (Segments 2-6)")
print(f"{'='*80}")

for seg_idx, stype, file_off, seg_len in segments:
    if stype != "DATA" or seg_idx == 7:
        continue
    print(f"\n--- Segment {seg_idx} at 0x{file_off:X} ({seg_len} bytes, {seg_len//4} records of 4 bytes) ---")
    
    records = []
    for i in range(0, seg_len, 4):
        if file_off + i + 4 > len(data):
            break
        w1 = struct.unpack_from("<H", data, file_off + i)[0]
        w2 = struct.unpack_from("<H", data, file_off + i + 2)[0]
        records.append((w1, w2))
    
    # Check if w1 looks like offsets (into code segment) and w2 looks like indices
    code_base = segments[0][2]
    code_end = code_base + segments[0][3]
    
    # Show first 20 records
    print(f"  Format: (word1, word2)")
    for i, (w1, w2) in enumerate(records[:20]):
        note = ""
        # Check if w1 is a pointer into code segment range
        if code_base <= w1 <= code_end:
            # Try to read string at that offset
            s = read_sjis_string(data, w1, max_len=60)
            if len(s) >= 2:
                note = f" => \"{s}\""
        print(f"  [{i:4d}] 0x{w1:04X}  0x{w2:04X}{note}")
    
    if len(records) > 20:
        print(f"  ... total {len(records)} records")
    
    # Statistics
    w1_vals = [r[0] for r in records]
    w2_vals = [r[1] for r in records]
    print(f"  w1 range: {min(w1_vals):#06X} - {max(w1_vals):#06X}")
    print(f"  w2 range: {min(w2_vals):#06X} - {max(w2_vals):#06X}")
    
    # Check if w2 is sequential
    sequential = all(w2_vals[i+1] == w2_vals[i] + 4 for i in range(min(10, len(w2_vals)-1)))
    print(f"  w2 sequential (+4): {sequential}")
    diffs = [w2_vals[i+1] - w2_vals[i] for i in range(min(20, len(w2_vals)-1))]
    print(f"  w2 diffs: {diffs[:20]}")
