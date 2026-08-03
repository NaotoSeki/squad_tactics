import os
import glob
from PIL import Image, ImageChops, ImageStat

INPUT_DIR = os.path.expanduser("~/Documents/output/renders_test")
OUTPUT_DIR = os.path.expanduser("~/Documents/output/spritesheets_test")
ANGLES = 8
PADDING = 4 # extra pixels around the tight crop

def frames_are_similar(img1, img2, threshold=0.01):
    diff = ImageChops.difference(img1, img2)
    stat = ImageStat.Stat(diff)
    avg_diff = sum(stat.mean) / len(stat.mean)
    return avg_diff < threshold

def create_spritesheets():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    search_path = os.path.join(INPUT_DIR, "*.png")
    files = glob.glob(search_path)
    
    if not files:
        print("No render files found.")
        return

    # 1. Group files by action
    actions = {}
    for f in files:
        basename = os.path.basename(f)
        parts = basename.rsplit('_', 2)
        if len(parts) == 3:
            action_name = parts[0]
            if action_name not in actions:
                actions[action_name] = []
            actions[action_name].append(f)

    # 2. Filter identical frames per action
    filtered_files = []
    actions_filtered = {}
    
    for action_name, action_files in actions.items():
        frames_by_angle = {i: [] for i in range(ANGLES)}
        for f in action_files:
            basename = os.path.basename(f)
            ang_part = basename.rsplit('_', 1)[1] # ang0.png
            ang_idx = int(ang_part.replace('ang', '').replace('.png', ''))
            frames_by_angle[ang_idx].append(f)
            
        base_angle_frames = frames_by_angle[0]
        base_angle_frames.sort()
        
        frames_to_keep = [0]
        if len(base_angle_frames) > 0:
            last_img = Image.open(base_angle_frames[0])
            for i in range(1, len(base_angle_frames)):
                curr_img = Image.open(base_angle_frames[i])
                if not frames_are_similar(last_img, curr_img, threshold=0.01):
                    frames_to_keep.append(i)
                    last_img = curr_img
        
        print(f"Action {action_name}: kept {len(frames_to_keep)} out of {len(base_angle_frames)} frames.")
        
        actions_filtered[action_name] = {i: [] for i in range(ANGLES)}
        for angle_idx in range(ANGLES):
            frames_by_angle[angle_idx].sort()
            filtered = [frames_by_angle[angle_idx][i] for i in frames_to_keep]
            actions_filtered[action_name][angle_idx] = filtered
            filtered_files.extend(filtered)

    # 3. Determine GLOBAL bounding box across ALL FILTERED frames
    global_min_l, global_min_t = 9999, 9999
    global_max_r, global_max_b = 0, 0
    
    print("Calculating global bounding box...")
    for f in filtered_files:
        img = Image.open(f)
        bbox = img.getbbox()
        if bbox:
            global_min_l = min(global_min_l, bbox[0])
            global_min_t = min(global_min_t, bbox[1])
            global_max_r = max(global_max_r, bbox[2])
            global_max_b = max(global_max_b, bbox[3])

    if global_min_l == 9999:
        global_min_l, global_min_t, global_max_r, global_max_b = 0, 0, 256, 256
        
    sample_img = Image.open(filtered_files[0])
    orig_w, orig_h = sample_img.size
    
    min_l = max(0, global_min_l - PADDING)
    min_t = max(0, global_min_t - PADDING)
    max_r = min(orig_w, global_max_r + PADDING)
    max_b = min(orig_h, global_max_b + PADDING)
    
    frame_w = max_r - min_l
    frame_h = max_b - min_t
    
    print(f"Global crop frame size will be: {frame_w}x{frame_h}")

    # 4. Create sprite sheets
    for action_name, frames_dict in actions_filtered.items():
        cols = len(frames_dict[0])
        rows = ANGLES
        
        sheet_w = cols * frame_w
        sheet_h = rows * frame_h
        
        spritesheet = Image.new('RGBA', (sheet_w, sheet_h), (0, 0, 0, 0))
        
        for angle_idx in range(rows):
            frames = frames_dict[angle_idx]
            for col_idx, frame_file in enumerate(frames):
                img = Image.open(frame_file)
                cropped_img = img.crop((min_l, min_t, max_r, max_b))
                
                x = col_idx * frame_w
                y = angle_idx * frame_h
                spritesheet.paste(cropped_img, (x, y))
                
        output_file = os.path.join(OUTPUT_DIR, f"{action_name}_spritesheet.png")
        spritesheet.save(output_file, optimize=True)
        
        # 8-bit quantized version
        quantized = spritesheet.quantize(colors=256, method=2, kmeans=1)
        quantized_output_file = os.path.join(OUTPUT_DIR, f"{action_name}_spritesheet_8bit.png")
        quantized.save(quantized_output_file, optimize=True)
        
        print(f"Created {output_file} ({frame_w}x{frame_h}, {cols} frames)")

    # 5. Generate preview.html with the correct frame size
    options_html = "\\n".join([f'            <option value="{a}">{a}</option>' for a in actions_filtered.keys()])
    
    import re
    template_path = os.path.join(os.path.dirname(__file__), "template_preview.html")
    if os.path.exists(template_path):
        with open(template_path, "r", encoding="utf-8") as f:
            html = f.read()
            
        html = re.sub(r"const FRAME_WIDTH = \d+;", f"const FRAME_WIDTH = {frame_w};", html)
        html = re.sub(r"const FRAME_HEIGHT = \d+;", f"const FRAME_HEIGHT = {frame_h};", html)
        
        # Replace CSS width/height specifically for #sprite-viewer
        html = re.sub(r'(#sprite-viewer\s*\{[^}]*?width:\s*)\d+px;', rf'\g<1>{frame_w}px;', html)
        html = re.sub(r'(#sprite-viewer\s*\{[^}]*?height:\s*)\d+px;', rf'\g<1>{frame_h}px;', html)
        
        html = re.sub(r'(<select id="actionSelect">).*?(</select>)', r'\1\n' + options_html + r'\n        \2', html, flags=re.DOTALL)
        # Also fix the default SPRITE_SHEET to the first action
        first_action = list(actions_filtered.keys())[0]
        html = re.sub(r"const SPRITE_SHEET = '.*?_spritesheet\.png';", f"const SPRITE_SHEET = '{first_action}_spritesheet.png';", html)
        
        with open(os.path.join(OUTPUT_DIR, "preview.html"), "w", encoding="utf-8") as f:
            f.write(html)
        print("Generated dynamic preview.html from template")
    else:
        print("Template not found!")

if __name__ == "__main__":
    create_spritesheets()