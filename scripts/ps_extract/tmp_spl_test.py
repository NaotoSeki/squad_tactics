import struct
import sys

def analyze_spl(filepath):
    with open(filepath, 'rb') as f:
        data = f.read()
    print(f"SPL Size: {len(data)} bytes")
    if len(data) >= 4:
        header_size = struct.unpack('<I', data[:4])[0]
        print(f"Header size (uint32): {header_size}")
        
    if len(data) == 1024:
        print("Likely a 255 color palette (1020 bytes payload).")
        # dump first 5 colors
        for i in range(5):
            idx = 4 + i * 4
            b, g, r, a = data[idx], data[idx+1], data[idx+2], data[idx+3]
            print(f"Color {i}: R={r} G={g} B={b} A={a}")

if __name__ == "__main__":
    analyze_spl(r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\Data\Game\Common\Media\Objects\Buildings\german_rural_house_001_ver_01.spl")
