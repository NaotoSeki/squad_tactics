import struct
import sys
import os
import argparse
from PIL import Image

def rgb565_to_rgba(val565, alpha=255):
    r = ((val565 >> 11) & 0x1F) * 255 // 31
    g = ((val565 >> 5) & 0x3F) * 255 // 63
    b = (val565 & 0x1F) * 255 // 31
    return (r, g, b, alpha)

def load_palette(spl_path):
    if not os.path.exists(spl_path):
        return None
    with open(spl_path, 'rb') as f:
        data = f.read()
    if len(data) < 1024:
        return None
    
    palette = [(0,0,0,0)] * 256
    # The first 4 bytes is usually 0x03FC. Then 255 colors follow.
    # Color format is BGRA (little endian ARGB).
    for i in range(1, 256):
        c = struct.unpack('<I', data[i*4:i*4+4])[0]
        a = (c >> 24) & 0xFF
        r = (c >> 16) & 0xFF
        g = (c >> 8) & 0xFF
        b = c & 0xFF
        
        # In many older games, full alpha (FF) is solid, 00 is transparent.
        # But color 0 is usually transparent. We'll set alpha properly.
        palette[i] = (r, g, b, a)
        
    palette[0] = (0, 0, 0, 0) # Force index 0 to transparent
    return palette

def extract_ssc(ssc_path, out_dir=None):
    if out_dir is None:
        out_dir = os.path.dirname(ssc_path)
        
    os.makedirs(out_dir, exist_ok=True)
    basename = os.path.basename(ssc_path).replace('.ssc', '')
    spl_path = ssc_path.replace('.ssc', '.spl')
    
    palette = load_palette(spl_path)
    is_palette_mode = (palette is not None)
    
    with open(ssc_path, 'rb') as f:
        data = f.read()

    # Pass 1: Dynamically determine BBox by scanning all draw commands
    min_x, min_y, max_x, max_y = 32767, 32767, -32768, -32768
    ptr = 0
    while ptr < len(data) - 4:
        val = struct.unpack('<I', data[ptr:ptr+4])[0]
        length = val & 0xFF
        tag_base = val & 0xFFFFFF00
        
        if tag_base != 0x00010000 or length < 4:
            ptr += 1
            continue
            
        tag_id = val & 0xFF
        if ptr + length <= len(data) and tag_id != 8:
            is_even = (tag_id % 2 == 0)
            if not is_even:
                try:
                    x = struct.unpack('<h', data[ptr+4:ptr+6])[0]
                    y = struct.unpack('<b', data[ptr+6:ptr+7])[0]
                    count = data[ptr+7]
                    
                    if x < min_x: min_x = x
                    if x + count > max_x: max_x = x + count
                    if y < min_y: min_y = y
                    if y > max_y: max_y = y
                except:
                    pass
            ptr += length
        else:
            ptr += 8 if tag_id == 8 else length

    if min_x > max_x:  # Fallback if no valid coordinates found
        min_x, min_y, max_x, max_y = 0, 0, 256, 256
        
    # Add a small padding
    bbox_w = max_x - min_x + 1
    bbox_h = max_y - min_y + 1
    if bbox_w <= 0 or bbox_h <= 0 or bbox_w > 2048 or bbox_h > 2048:
        bbox_w, bbox_h = 256, 256
        min_x, min_y = 0, 0

    # Pass 1: Dynamically determine BBox
    min_x, min_y, max_x, max_y = 32767, 32767, -32768, -32768
    ptr = 0
    current_idx_pass1 = 0
    while ptr < len(data) - 4:
        val = struct.unpack('<I', data[ptr:ptr+4])[0]
        length = val & 0xFF
        tag_base = val & 0xFFFFFF00
        
        if tag_base != 0x00010000 or length < 4:
            ptr += 1
            continue
            
        tag_id = val & 0xFF
        if ptr + length + 4 <= len(data) and tag_id != 8:
            is_even = (tag_id % 2 == 0)
            if is_even:
                if length >= 4:
                    idx = struct.unpack('<I', data[ptr+4:ptr+8])[0]
                    pixel_count = length - 4
                    current_idx_pass1 = idx + pixel_count
                    x = current_idx_pass1 % 2048 # Rough bound check for pass 1
                    y = current_idx_pass1 // 2048
            else:
                if length >= 2:
                    skip = struct.unpack('<H', data[ptr+4:ptr+6])[0]
                    pixel_count = length - 2
                    current_idx_pass1 += skip + pixel_count
            ptr += 4 + length
        elif tag_id == 8:
            ptr += 8
            current_idx_pass1 = 0
        else:
            ptr += 4 + length

    # BBox logic is disabled because local idx already bounds within the original frame box.
    # We will use the file header BBox.
    min_x, min_y, max_x, max_y = 0, 0, 256, 256
    frame_headers = []
    for i in range(0, min(8192, len(data) - 16), 4):
        val1 = struct.unpack('<I', data[i:i+4])[0]
        val2 = struct.unpack('<I', data[i+4:i+8])[0]
        if (val1 == 723 or val1 == 693 or val1 == 703) and val2 == 8:
            bbox = struct.unpack('<4h', data[i+8:i+16])
            frame_headers.append(bbox)
            
    if frame_headers:
        min_x = min([b[0] for b in frame_headers])
        min_y = min([b[1] for b in frame_headers])
        max_x = max([b[2] for b in frame_headers])
        max_y = max([b[3] for b in frame_headers])
        
    bbox_w, bbox_h = 256, 256
    min_x, min_y = 0, 0

    frames = []
    current_img = Image.new('RGBA', (bbox_w, bbox_h), (0, 0, 0, 0))
    current_pixels = current_img.load()
    pixel_plot_count = 0
    frame_started = False
    current_idx = 0
    
    ptr = 0
    bbox_w, bbox_h = 256, 256
    
    # Read true width and height from header
    if len(data) >= 12:
        true_w = struct.unpack('<I', data[4:8])[0]
        true_h = struct.unpack('<I', data[8:12])[0]
        # Some fallback if unreasonable
        if true_w == 0 or true_w > 4096:
            true_w = 256
    else:
        true_w = 256
        
    # Use true dimensions for canvas
    canvas_w, canvas_h = true_w, true_h
    if canvas_w > 4096: canvas_w = 4096
    if canvas_h > 4096: canvas_h = 4096
    
    frames = []
    current_img = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
    current_pixels = current_img.load()
    pixel_plot_count = 0
    frame_started = False
    
    # Local frame dimensions and offsets
    frame_x, frame_y = 0, 0
    frame_w, frame_h = 256, 256
    
    ptr = 12
    while ptr < len(data) - 4:
        val = struct.unpack('<I', data[ptr:ptr+4])[0]
        length = val & 0xFF
        tag_base = val & 0xFFFFFF00
        
        tag_id = val & 0xFF
        if tag_base == 0 and tag_id == 8:
            if frame_started:
                frames.append(current_img)
                current_img = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
                current_pixels = current_img.load()
                frame_started = False
            
            # Read frame header if enough data
            if ptr + 12 <= len(data):
                frame_x = struct.unpack('<h', data[ptr+4:ptr+6])[0]
                frame_y = struct.unpack('<h', data[ptr+6:ptr+8])[0]
                frame_w = struct.unpack('<h', data[ptr+8:ptr+10])[0]
                frame_h = struct.unpack('<h', data[ptr+10:ptr+12])[0]
                if frame_w <= 0: frame_w = 256
                if frame_h <= 0: frame_h = 256
                ptr += 12
            else:
                ptr += 8
            continue
            
        if tag_base not in [0x00010000, 0x00020000, 0x00030000] or length < 4:
            ptr += 1
            continue
            
        if ptr + length <= len(data):
            frame_started = True
            is_even = (tag_id % 2 == 0)
            
            # We must center the frame rendering on the global canvas using frame_x, frame_y
            center_x = canvas_w // 2 + frame_x
            center_y = canvas_h // 2 + frame_y
            
            try:
                if is_even and length >= 4:
                    idx = struct.unpack('<I', data[ptr+4:ptr+8])[0]
                    if is_palette_mode:
                        num_pixels = length - 8
                        for p in range(num_pixels):
                            color_idx = data[ptr + 8 + p]
                            px = (idx + p) % frame_w
                            py = (idx + p) // frame_w
                            if 0 <= px < frame_w and 0 <= py < frame_h:
                                global_x = center_x + px
                                global_y = center_y + py
                                if 0 <= global_x < canvas_w and 0 <= global_y < canvas_h:
                                    current_pixels[global_x, global_y] = palette[color_idx]
                                    pixel_plot_count += 1
                    else:
                        num_pixels = (length - 8) // 2
                        for p in range(num_pixels):
                            color_offset = ptr + 8 + p * 2
                            if color_offset + 2 <= len(data):
                                color565 = struct.unpack('<H', data[color_offset:color_offset+2])[0]
                                px = (idx + p) % frame_w
                                py = (idx + p) // frame_w
                                if 0 <= px < frame_w and 0 <= py < frame_h:
                                    global_x = center_x + px
                                global_y = center_y + py
                                if 0 <= global_x < canvas_w and 0 <= global_y < canvas_h:
                                    current_pixels[global_x, global_y] = rgb565_to_rgba(color565, 255)
                                    pixel_plot_count += 1
                elif not is_even and length >= 4:
                    x = struct.unpack('<h', data[ptr+4:ptr+6])[0]
                    y = struct.unpack('<b', data[ptr+6:ptr+7])[0]
                    count = data[ptr+7]
                    
                    if is_palette_mode:
                        for p in range(min(count, length - 4)):
                            if ptr + 8 + p < len(data):
                                color_idx = data[ptr + 8 + p]
                                px = x + p
                                py = y
                                if 0 <= px < frame_w and 0 <= py < frame_h:
                                    global_x = center_x + px
                                    global_y = center_y + py
                                    if 0 <= global_x < canvas_w and 0 <= global_y < canvas_h:
                                        current_pixels[global_x, global_y] = palette[color_idx]
                                        pixel_plot_count += 1
                    else:
                        for p in range(min(count, (length - 4) // 2)):
                            color_offset = ptr + 8 + p * 2
                            if color_offset + 2 <= len(data):
                                color565 = struct.unpack('<H', data[color_offset:color_offset+2])[0]
                                px = x + p
                                py = y
                                if 0 <= px < frame_w and 0 <= py < frame_h:
                                    global_x = center_x + px
                                    global_y = center_y + py
                                    if 0 <= global_x < canvas_w and 0 <= global_y < canvas_h:
                                        current_pixels[global_x, global_y] = rgb565_to_rgba(color565, 255)
                                        pixel_plot_count += 1
            except Exception as e:
                pass
                
            # BRUTE-FORCE SCAN: Never jump by length, as length definition is uncertain.
            # We just process the pixels we can, then continue scanning byte-by-byte for the next marker.
            ptr += 4
        else:
            ptr += 1

    if frame_started or pixel_plot_count > 0:
        frames.append(current_img)
        
    # Save frames if output directory is provided
    if out_dir:
        base_name = os.path.splitext(os.path.basename(ssc_path))[0]
        for i, img in enumerate(frames):
            bbox = img.getbbox()
            if bbox:
                cropped = img.crop(bbox)
                out_path = os.path.join(out_dir, f"{base_name}_f{i:04d}.png")
                cropped.save(out_path)
            else:
                # Ignore empty frames to prevent clutter
                pass
        
    return len(frames), pixel_plot_count

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?")
    args = parser.parse_args()
    if args.input:
        f, p = extract_ssc(args.input)
        print(f"Extracted {f} frames, {p} pixels.")
    else:
        base_dirs = [
            r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\Data\Game\Common\Media\Objects",
            r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\Data\Game\Common\Media\Units"
        ]
        out_base = r"c:\Projects\squad_tactics\scratch\ps_sprites"
        
        for base_dir in base_dirs:
            for root, dirs, files in os.walk(base_dir):
                for f in files:
                    if f.endswith(".ssc"):
                        ssc_path = os.path.join(root, f)
                        rel_path = os.path.relpath(root, base_dir)
                        if rel_path == '.': rel_path = ''
                        out_dir = os.path.join(out_base, os.path.basename(base_dir), rel_path)
                        try:
                            frames, p = extract_ssc(ssc_path, out_dir=out_dir)
                            if frames > 0:
                                print(f"{f:36s}: {frames:4d} frames, {p:8d} px -> {out_dir}")
                        except Exception as e:
                            print(f"Error extracting {f}: {e}")
