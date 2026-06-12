"""Search MISSDATA.DLL and other files for vehicle stat data."""
import struct

data = open(r"D:\PL\MISSDATA.DLL", "rb").read()
print(f"MISSDATA.DLL: {len(data)} bytes")

sig = data[0:2]
print(f"DOS sig: {sig}")
ne_off = struct.unpack_from("<H", data, 0x3C)[0]
ne_sig = data[ne_off:ne_off+2]
print(f"NE header at 0x{ne_off:X}: {ne_sig}")

names = [b"M4A3\x00", b"PZKW6E\x00", b"M3LT\x00", b"PZKW5G\x00", b"M26\x00",
         b"PZKW6B\x00", b"STG3G\x00", b"M4A3E2\x00", b"MARDER2\x00", b"FLAK36\x00", b"PAK40\x00"]

for name in names:
    idx = 0
    count = 0
    while True:
        idx = data.find(name, idx)
        if idx == -1:
            break
        count += 1
        if count <= 3:
            start = max(0, idx - 16)
            end = min(len(data), idx + len(name) + 16)
            context = data[start:end]
            ascii_ctx = "".join(chr(b) if 32 <= b < 127 else "." for b in context)
            print(f"  {name[:-1].decode('ascii')} at 0x{idx:06X}: ...{ascii_ctx}...")
        idx += 1
    if count > 3:
        print(f"  {name[:-1].decode('ascii')}: {count} occurrences total")
    elif count == 0:
        print(f"  {name[:-1].decode('ascii')}: NOT FOUND")

print()

# NE segment info for MISSDATA.DLL
if ne_sig == b"NE":
    seg_table_off = ne_off + struct.unpack_from("<H", data, ne_off + 0x22)[0]
    n_segments = struct.unpack_from("<H", data, ne_off + 0x1C)[0]
    align_shift = struct.unpack_from("<H", data, ne_off + 0x32)[0]
    print(f"Segments: {n_segments}, align shift: {align_shift}")
    
    for i in range(min(n_segments, 30)):
        entry_off = seg_table_off + i * 8
        sector = struct.unpack_from("<H", data, entry_off)[0]
        size = struct.unpack_from("<H", data, entry_off + 2)[0]
        flags = struct.unpack_from("<H", data, entry_off + 4)[0]
        file_off = sector << align_shift
        seg_type = "DATA" if (flags & 0x0001) else "CODE"
        print(f"  Seg {i+1}: 0x{file_off:08X} size={size:6d} {seg_type} flags=0x{flags:04X}")

print("\n=== Now search CBE.EXE segment 93 (largest data segment) ===")
cbe = open(r"D:\PL\CBE.EXE", "rb").read()
ne_off_cbe = struct.unpack_from("<H", cbe, 0x3C)[0]
seg_table_off_cbe = ne_off_cbe + struct.unpack_from("<H", cbe, ne_off_cbe + 0x22)[0]
align_shift_cbe = struct.unpack_from("<H", cbe, ne_off_cbe + 0x32)[0]

# Get segment 93 info
entry_off = seg_table_off_cbe + 92 * 8
sector = struct.unpack_from("<H", cbe, entry_off)[0]
size = struct.unpack_from("<H", cbe, entry_off + 2)[0]
file_off = sector << align_shift_cbe
print(f"Seg 93: 0x{file_off:08X} size={size}")

seg93 = cbe[file_off:file_off+size]

# Check for vehicle names
for name in [b"M4A3", b"PZKW", b"M3LT"]:
    idx = seg93.find(name)
    if idx >= 0:
        print(f"  Found {name.decode()} at seg offset +0x{idx:04X}")
    else:
        print(f"  {name.decode()}: not found")

# Show first 512 bytes
print("\nFirst 512 bytes of Seg 93:")
for off in range(0, min(512, size), 32):
    chunk = seg93[off:off+32]
    hex_str = " ".join(f"{b:02X}" for b in chunk)
    ascii_str = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
    print(f"  {file_off+off:06X}: {hex_str}  {ascii_str}")

# Show as u16 values for first few rows
print("\nFirst 128 u16 values:")
for i in range(0, 128, 16):
    vals = [struct.unpack_from("<H", seg93, i*2)[0] for i in range(i, min(i+16, 128))]
    line = " ".join(f"{v:5d}" for v in vals)
    print(f"  [{i:4d}]: {line}")
