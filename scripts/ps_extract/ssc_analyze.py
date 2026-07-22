import struct
import sys
import os

def hex_dump(data, start, length):
    end = min(start + length, len(data))
    chunk = data[start:end]
    hex_str = ' '.join(f'{b:02x}' for b in chunk)
    ascii_str = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
    return f"{start:04x} | {hex_str:48} | {ascii_str}"

def analyze_file(filepath):
    print(f"\nVisualizing: {os.path.basename(filepath)}")
    with open(filepath, 'rb') as f:
        data = f.read()

    from PIL import Image
    # Try to plot the raw bytes in a generic width
    width = 256
    height = len(data) // width + 1
    img = Image.new('RGB', (width, height), color='black')
    pixels = img.load()
    
    # We will map bytes to grayscale
    for i, b in enumerate(data):
        x = i % width
        y = i // width
        if y < height:
            pixels[x, y] = (b, b, b)
            
    out_path = filepath.replace(".ssc", "_raw.png")
    img.save(out_path)
    print(f"Saved raw byte visualization to {out_path}")
    
    # Try another approach: extract based on chunks
    # We saw tag 0x00010008 might be a chunk separator or command.
    # Let's just create an image where each tag change changes color.
    img2 = Image.new('RGB', (512, 512), color='black')
    pixels2 = img2.load()
    
    x, y = 0, 0
    i = 0
    color = (255, 255, 255)
    while i < len(data) - 4:
        val = struct.unpack('<I', data[i:i+4])[0]
        if (val & 0xFFFFFF00) == 0x00010000:
            # Tag found, change color randomly based on tag
            tag_byte = val & 0xFF
            import random
            random.seed(tag_byte)
            color = (random.randint(50,255), random.randint(50,255), random.randint(50,255))
            i += 4
        else:
            if x < 512 and y < 512:
                # Plot pixel with intensity based on data byte
                intensity = data[i]
                pixels2[x, y] = (intensity * color[0] // 255, intensity * color[1] // 255, intensity * color[2] // 255)
            x += 1
            if x >= 512:
                x = 0
                y += 1
            i += 1
            
    out_path2 = filepath.replace(".ssc", "_chunks.png")
    img2.save(out_path2)
    print(f"Saved chunk visualization to {out_path2}")

if __name__ == "__main__":
    files = [
        r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\Data\Game\Common\Media\Objects\Buildings\german_rural_house_001_ver_01.ssc",
        r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\Data\Game\Common\Media\Objects\Buildings\german_village_barn_001_ver_01.ssc",
    ]
    for f in files:
        analyze_file(f)
