import struct
import sys

def analyze_ssc(filepath):
    with open(filepath, 'rb') as f:
        data = f.read()
    
    print(f"SSC Size: {len(data)} bytes")
    if len(data) < 32:
        return
        
    # Read first 32 bytes as 8 uint32s
    header = struct.unpack('<8I', data[:32])
    print(f"Header: {header}")
    
    # Dump next 64 bytes
    print("Next 64 bytes:")
    print(data[32:96].hex(' '))

if __name__ == "__main__":
    analyze_ssc(r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\Data\Game\Common\Media\Objects\Buildings\german_village_barn_001_ver_01.ssc")
