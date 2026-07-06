#!/usr/bin/env python3
"""
Repack soldier spritesheet collection v2.
- Per-action tight bbox (not union)
- Global anchor from stand_idle ground point
- Higher resolution output (variable frame size per action)
- Input: 19 spritesheets (8 directions × N frames each)
- Output: individual action PNG + manifest.json (v2)
"""

import os
import json
import sys
import hashlib
from pathlib import Path
from PIL import Image
import math

INPUT_DIR = Path("C:/Users/aware.梨花のPC/Documents/output/spritesheets")
OUTPUT_DIR = Path("C:/Projects/squad_tactics/asset/sprites/soldier")
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"

FRAME_W_SRC = 400
FRAME_H_SRC = 262
PADDING = 2
MAX_SHEET_DIM = 8192
MAX_GRID_WIDTH = 8000
MAX_VRAM_MB = 230

def get_bbox_frame(image, frame_idx, direction=0):
    """Extract bbox of alpha > 0 for a single frame in direction row"""
    img_w, img_h = image.size
    n_cols = img_w // FRAME_W_SRC

    if frame_idx >= n_cols:
        return None

    left = frame_idx * FRAME_W_SRC
    top = direction * FRAME_H_SRC
    right = left + FRAME_W_SRC
    bottom = top + FRAME_H_SRC

    frame_img = image.crop((left, top, right, bottom))

    if frame_img.mode != 'RGBA':
        frame_img = frame_img.convert('RGBA')

    data = frame_img.getdata()
    pixels = list(data)

    x_min, x_max = None, None
    y_min, y_max = None, None

    for y in range(FRAME_H_SRC):
        for x in range(FRAME_W_SRC):
            alpha = pixels[y * FRAME_W_SRC + x][3]
            if alpha > 0:
                if x_min is None or x < x_min:
                    x_min = x
                if x_max is None or x > x_max:
                    x_max = x
                if y_min is None or y < y_min:
                    y_min = y
                if y_max is None or y > y_max:
                    y_max = y

    if x_min is None:
        return None

    return (x_min, y_min, x_max + 1, y_max + 1)

def union_bbox(bboxes):
    """Compute union of multiple bboxes"""
    if not bboxes:
        return None
    bboxes = [b for b in bboxes if b is not None]
    if not bboxes:
        return None

    x_min = min(b[0] for b in bboxes)
    y_min = min(b[1] for b in bboxes)
    x_max = max(b[2] for b in bboxes)
    y_max = max(b[3] for b in bboxes)

    return (x_min, y_min, x_max, y_max)

def clamp_bbox(bbox, pad=PADDING):
    """Add padding and clamp to frame bounds"""
    x_min, y_min, x_max, y_max = bbox
    x_min = max(0, x_min - pad)
    y_min = max(0, y_min - pad)
    x_max = min(FRAME_W_SRC, x_max + pad)
    y_max = min(FRAME_H_SRC, y_max + pad)
    return (x_min, y_min, x_max, y_max)

def action_name_from_filename(filename):
    """Convert filename to action name"""
    name = filename.replace("_spritesheet.png", "")
    name = name.lower()
    name = name.replace(".", "_")
    return name

def get_stride(action_name):
    """Determine stride: 2 for idle, dying, throw_grenade (low fps OK); 1 otherwise"""
    stride2_actions = {
        "stand_idle", "kneel_idle", "prone_idle",
        "stand_dying", "kneel_dying", "prone_dying",
        "stand_throw_grenade", "kneel_throw_grenade", "prone_throw_grenade"
    }
    return 2 if action_name in stride2_actions else 1

def compute_action_bbox(image):
    """Compute union bbox across all 8 directions for this sheet"""
    img_w = image.width
    n_cols = img_w // FRAME_W_SRC

    all_bboxes = []
    for direction in range(8):
        for frame_idx in range(n_cols):
            bbox = get_bbox_frame(image, frame_idx, direction)
            if bbox:
                all_bboxes.append(bbox)

    union = union_bbox(all_bboxes)
    if union is None:
        return None

    union_clamped = clamp_bbox(union)
    return union_clamped

def compute_content_bbox(image, bbox):
    """Compute bbox without padding (for charH calculation)"""
    bbox_left, bbox_top, bbox_right, bbox_bottom = bbox

    # Remove padding to get actual content
    actual_left = bbox_left + PADDING
    actual_top = bbox_top + PADDING
    actual_right = bbox_right - PADDING
    actual_bottom = bbox_bottom - PADDING

    # Clamp to frame
    actual_left = max(0, actual_left)
    actual_top = max(0, actual_top)
    actual_right = min(FRAME_W_SRC, actual_right)
    actual_bottom = min(FRAME_H_SRC, actual_bottom)

    if actual_left >= actual_right or actual_top >= actual_bottom:
        return bbox  # fallback

    return (actual_left, actual_top, actual_right, actual_bottom)

def extract_frame_from_sheet(image, frame_idx, direction, bbox, scale):
    """Extract, crop, and scale a single frame"""
    left = frame_idx * FRAME_W_SRC
    top = direction * FRAME_H_SRC
    right = left + FRAME_W_SRC
    bottom = top + FRAME_H_SRC

    frame_img = image.crop((left, top, right, bottom))
    if frame_img.mode != 'RGBA':
        frame_img = frame_img.convert('RGBA')

    # Crop to bbox
    bbox_left, bbox_top, bbox_right, bbox_bottom = bbox
    cropped = frame_img.crop((bbox_left, bbox_top, bbox_right, bbox_bottom))

    # Scale
    bbox_w = bbox_right - bbox_left
    bbox_h = bbox_bottom - bbox_top
    new_w = round(bbox_w * scale)
    new_h = round(bbox_h * scale)

    scaled = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
    return scaled

def repack_sheet(sheet_path, action_bbox, scale, action_charH_src, yG):
    """Repack a single sheet: extract frames, arrange in grid"""
    img = Image.open(sheet_path)
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    filename = sheet_path.name
    action_name = action_name_from_filename(filename)
    stride = get_stride(action_name)

    n_cols = img.width // FRAME_W_SRC
    src_frames = n_cols

    # Frame dimensions
    bbox_left, bbox_top, bbox_right, bbox_bottom = action_bbox
    bbox_w = bbox_right - bbox_left
    bbox_h = bbox_bottom - bbox_top
    frame_w = round(bbox_w * scale)
    frame_h = round(bbox_h * scale)

    # Collect frames (8 directions)
    frames_by_direction = [[] for _ in range(8)]

    for direction in range(8):
        for col_idx in range(n_cols):
            if col_idx % stride == 0:
                frame_idx = col_idx
                frame = extract_frame_from_sheet(img, frame_idx, direction, action_bbox, scale)
                frames_by_direction[direction].append(frame)

    # Flatten: dir-major order (dir0 all frames, then dir1 all frames, etc.)
    all_frames = []
    frames_per_dir = len(frames_by_direction[0]) if frames_by_direction[0] else 0
    for direction in range(8):
        all_frames.extend(frames_by_direction[direction])

    total_frames = len(all_frames)

    # Grid dimensions
    cols = min(total_frames, MAX_GRID_WIDTH // frame_w) if frame_w > 0 else 1
    cols = max(1, cols)
    rows = math.ceil(total_frames / cols) if cols > 0 else 1

    sheet_w = cols * frame_w
    sheet_h = rows * frame_h

    # Create output image
    output_img = Image.new('RGBA', (sheet_w, sheet_h), (0, 0, 0, 0))

    # Paste frames
    idx = 0
    for row in range(rows):
        for col in range(cols):
            if idx < len(all_frames):
                x = col * frame_w
                y = row * frame_h
                output_img.paste(all_frames[idx], (x, y), all_frames[idx])
                idx += 1

    # Save
    output_path = OUTPUT_DIR / f"{action_name}.png"
    output_img.save(output_path, 'PNG')

    # Compute originX, originY
    ax = 200
    originX = round((ax - bbox_left) / bbox_w, 4) if bbox_w > 0 else 0.5
    originY = round((yG - bbox_top) / bbox_h, 4) if bbox_h > 0 else 0.5

    return {
        "action": action_name,
        "file": f"{action_name}.png",
        "src_frames": src_frames,
        "stride": stride,
        "frames": frames_per_dir,
        "cols": cols,
        "rows": rows,
        "frame_w": frame_w,
        "frame_h": frame_h,
        "sheet_w": sheet_w,
        "sheet_h": sheet_h,
        "origin_x": originX,
        "origin_y": originY,
        "output_path": output_path,
        "file_size_kb": output_path.stat().st_size / 1024
    }

def main():
    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=== Step 1: Compute global anchor (stand_idle) ===")

    stand_idle_sheet_path = None
    for sheet_path in sorted(INPUT_DIR.glob("*_spritesheet.png")):
        name = action_name_from_filename(sheet_path.name)
        if name == "stand_idle":
            stand_idle_sheet_path = sheet_path
            break

    if stand_idle_sheet_path is None:
        print("ERROR: stand_idle sheet not found")
        return 1

    stand_idle_img = Image.open(stand_idle_sheet_path)
    if stand_idle_img.mode != 'RGBA':
        stand_idle_img = stand_idle_img.convert('RGBA')

    stand_idle_bbox = compute_action_bbox(stand_idle_img)
    if stand_idle_bbox is None:
        print("ERROR: could not compute stand_idle bbox")
        return 1

    print(f"stand_idle bbox (with padding): {stand_idle_bbox}")

    # Content bbox (without padding)
    stand_idle_content_bbox = compute_content_bbox(stand_idle_img, stand_idle_bbox)
    print(f"stand_idle content bbox (no padding): {stand_idle_content_bbox}")

    # yG = content bottom
    _, _, _, yG = stand_idle_content_bbox
    print(f"Global anchor yG (ground point): {yG}")

    # charH_src = content height
    _, content_top, _, content_bottom = stand_idle_content_bbox
    charH_src = content_bottom - content_top
    print(f"Character height (src): {charH_src}")

    print("\n=== Step 2: Compute per-action bboxes and scale ===")

    sheets = sorted(INPUT_DIR.glob("*_spritesheet.png"))
    action_bboxes = {}

    for sheet_path in sheets:
        img = Image.open(sheet_path)
        if img.mode != 'RGBA':
            img = img.convert('RGBA')

        bbox = compute_action_bbox(img)
        action_name = action_name_from_filename(sheet_path.name)
        action_bboxes[action_name] = bbox

        bbox_left, bbox_top, bbox_right, bbox_bottom = bbox
        bbox_w = bbox_right - bbox_left
        bbox_h = bbox_bottom - bbox_top
        print(f"  {action_name}: bbox={bbox}, w={bbox_w}, h={bbox_h}")

    # Global scale (from charH_src)
    scale = 108 / charH_src
    scale = min(scale, 0.8)
    print(f"\nGlobal scale: {scale:.4f}")

    charH_scaled = round(charH_src * scale)
    print(f"Character height (scaled): {charH_scaled}")

    print("\n=== Step 3: Repack sheets ===")
    action_data = {}
    summary = []

    for sheet_path in sheets:
        action_name = action_name_from_filename(sheet_path.name)
        print(f"Processing {sheet_path.name}...", end=" ", flush=True)
        try:
            bbox = action_bboxes[action_name]
            result = repack_sheet(sheet_path, bbox, scale, charH_src, yG)

            action_data[result["action"]] = {
                "file": result["file"],
                "srcFrames": result["src_frames"],
                "stride": result["stride"],
                "frames": result["frames"],
                "cols": result["cols"],
                "rows": result["rows"],
                "frameW": result["frame_w"],
                "frameH": result["frame_h"],
                "originX": result["origin_x"],
                "originY": result["origin_y"],
                "sheetW": result["sheet_w"],
                "sheetH": result["sheet_h"]
            }
            summary.append(result)
            print("OK")
        except Exception as e:
            print(f"FAILED: {e}")
            import traceback
            traceback.print_exc()
            return 1

    print("\n=== Step 4: Write manifest ===")
    manifest = {
        "version": 2,
        "scale": scale,
        "srcFps": 24,
        "dirOrder": ["S", "SE", "E", "NE", "N", "NW", "W", "SW"],
        "anchorSrc": {
            "x": 200,
            "groundY": yG
        },
        "charH": charH_scaled,
        "actions": action_data
    }

    with open(MANIFEST_PATH, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f"Manifest written to {MANIFEST_PATH}")

    print("\n=== Step 5: Self-validation ===")
    errors = []

    # 1. Verify all output PNGs exist and match manifest dimensions
    print("\n[1/4] Verifying PNG dimensions...")
    for action, meta in action_data.items():
        action_path = OUTPUT_DIR / meta["file"]

        if not action_path.exists():
            errors.append(f"{action}: output file not found")
            continue

        try:
            img = Image.open(action_path)
            actual_w, actual_h = img.size

            if actual_w != meta["sheetW"] or actual_h != meta["sheetH"]:
                errors.append(
                    f"{action}: size mismatch. Expected {meta['sheetW']}×{meta['sheetH']}, "
                    f"got {actual_w}×{actual_h}"
                )
        except Exception as e:
            errors.append(f"{action}: error reading output PNG: {e}")

    print(f"  -> {len(action_data)} files checked, {len([e for e in errors if 'size mismatch' in e])} mismatches")

    # 2. Verify sheet dimensions <= 8192
    print("[2/4] Verifying sheet dimensions...")
    dim_errors = []
    for action, meta in action_data.items():
        if meta["sheetW"] > MAX_SHEET_DIM or meta["sheetH"] > MAX_SHEET_DIM:
            errors.append(
                f"{action}: sheet exceeds {MAX_SHEET_DIM}×{MAX_SHEET_DIM}. "
                f"Got {meta['sheetW']}×{meta['sheetH']}"
            )
            dim_errors.append(action)

    print(f"  -> {len(dim_errors)} sheets exceed limit" if dim_errors else "  -> All within limits")

    # 3. Content validation: dir0_f0 != dir4_f0 (md5)
    print("[3/4] Verifying direction diversity (dir0_f0 vs dir4_f0)...")
    dir_check_pass = True
    for action, meta in action_data.items():
        action_path = OUTPUT_DIR / meta["file"]

        if not action_path.exists():
            continue

        try:
            img = Image.open(action_path)
            cols = meta["cols"]
            frame_w = meta["frameW"]
            frame_h = meta["frameH"]
            frames_per_dir = meta["frames"]

            # dir0_f0: index 0
            idx_dir0_f0 = 0
            row_dir0_f0 = idx_dir0_f0 // cols
            col_dir0_f0 = idx_dir0_f0 % cols
            x0 = col_dir0_f0 * frame_w
            y0 = row_dir0_f0 * frame_h
            crop_dir0_f0 = img.crop((x0, y0, x0 + frame_w, y0 + frame_h))
            md5_dir0_f0 = hashlib.md5(crop_dir0_f0.tobytes()).hexdigest()

            # dir4_f0: index 4*frames_per_dir
            idx_dir4_f0 = 4 * frames_per_dir
            if idx_dir4_f0 < frames_per_dir * 8:
                row_dir4_f0 = idx_dir4_f0 // cols
                col_dir4_f0 = idx_dir4_f0 % cols
                x4 = col_dir4_f0 * frame_w
                y4 = row_dir4_f0 * frame_h
                crop_dir4_f0 = img.crop((x4, y4, x4 + frame_w, y4 + frame_h))
                md5_dir4_f0 = hashlib.md5(crop_dir4_f0.tobytes()).hexdigest()

                if md5_dir0_f0 == md5_dir4_f0:
                    errors.append(
                        f"{action}: dir0_f0 and dir4_f0 identical (direction duplication bug!)"
                    )
                    dir_check_pass = False
        except Exception as e:
            errors.append(f"{action}: error during direction check: {e}")

    print(f"  -> {'PASS' if dir_check_pass else 'FAIL (direction duplication detected)'}")

    # 4. VRAM estimate
    print("[4/4] Estimating total VRAM...")
    total_vram_bytes = 0
    for action, meta in action_data.items():
        sheet_bytes = meta["sheetW"] * meta["sheetH"] * 4
        total_vram_bytes += sheet_bytes

    total_vram_mb = total_vram_bytes / (1024 * 1024)
    print(f"  -> {total_vram_mb:.1f} MB", end="")

    if total_vram_mb > MAX_VRAM_MB:
        errors.append(f"Total VRAM {total_vram_mb:.1f} MB exceeds {MAX_VRAM_MB} MB limit")
        print(f" (EXCEEDS {MAX_VRAM_MB} MB limit)")
    else:
        print(f" (within {MAX_VRAM_MB} MB limit)")

    print("\n=== Summary Table ===")
    print(f"{'Action':<30} {'SrcFrames':<10} {'Frames':<8} {'FrameW×H':<12} {'originX,Y':<20} {'Grid':<12} {'SheetSize':<15} {'KB':<8}")
    print("-" * 135)
    for s in sorted(summary, key=lambda x: x['action']):
        grid_str = f"{s['cols']}×{s['rows']}"
        frame_str = f"{s['frame_w']}×{s['frame_h']}"
        sheet_str = f"{s['sheet_w']}×{s['sheet_h']}"
        origin_str = f"{s['origin_x']:.3f},{s['origin_y']:.3f}"
        print(
            f"{s['action']:<30} {s['src_frames']:<10} {s['frames']:<8} "
            f"{frame_str:<12} {origin_str:<20} {grid_str:<12} {sheet_str:<15} {s['file_size_kb']:<8.1f}"
        )

    print(f"\n{'='*135}")
    print(f"Global scale: {scale:.4f}")
    print(f"Character height (src): {charH_src} px  ->  scaled: {charH_scaled} px")
    print(f"Global anchor (stand_idle): yG={yG}")
    print(f"Total VRAM: {total_vram_mb:.1f} MB")

    # Report originY outliers
    print("\n=== Origin Y Outliers (outside [0, 1.5]) ===")
    outliers = [
        (s['action'], s['origin_y'])
        for s in summary
        if s['origin_y'] < 0 or s['origin_y'] > 1.5
    ]
    if outliers:
        for action, oy in sorted(outliers):
            print(f"  {action}: originY={oy:.4f}")
    else:
        print("  (none)")

    print(f"\n{'='*135}")
    if errors:
        print(f"VALIDATION: FAILED ({len(errors)} error(s))")
        for err in errors:
            print(f"  - {err}")
        return 1
    else:
        print("VALIDATION: PASSED")
        return 0

if __name__ == "__main__":
    sys.exit(main())
