#!/usr/bin/env python3
"""
Repack soldier spritesheet collection.
- Input: 19 spritesheets (8 directions × N frames each)
- Compute union bbox across all sheets/frames
- Repack each sheet with stride selection + grid layout
- Output: individual action PNG + manifest.json
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
TARGET_HEIGHT = 72
PADDING = 2
MAX_SHEET_DIM = 8192
MAX_GRID_WIDTH = 8000

def get_bbox_frame(image, frame_idx, direction=0):
    """Extract bbox of alpha > 0 for a single frame (8 rows, N columns, frame_idx is column)"""
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

def compute_union_bbox():
    """Compute union bbox across all 19 sheets and all frames"""
    sheets = sorted(INPUT_DIR.glob("*_spritesheet.png"))
    all_bboxes = []

    for sheet_path in sheets:
        img = Image.open(sheet_path)
        if img.mode != 'RGBA':
            img = img.convert('RGBA')

        n_cols = img.width // FRAME_W_SRC

        for direction in range(8):
            for frame_idx in range(n_cols):
                bbox = get_bbox_frame(img, frame_idx, direction)
                if bbox:
                    all_bboxes.append(bbox)

    union = union_bbox(all_bboxes)
    if union is None:
        raise ValueError("No non-transparent pixels found")

    union_clamped = clamp_bbox(union)
    return union_clamped

def compute_scale(bbox):
    """Compute scale factor: target height = 72px"""
    _, _, _, bbox_h = bbox
    bbox_h_int = bbox_h
    scale = TARGET_HEIGHT / bbox_h_int
    scale = min(scale, 1.0)
    return scale

def action_name_from_filename(filename):
    """Convert filename to action name"""
    name = filename.replace("_spritesheet.png", "")
    name = name.lower()
    name = name.replace(".", "_")
    return name

def get_stride(action_name):
    """Determine stride: 2 for idle, 1 otherwise"""
    if action_name in ("stand_idle", "kneel_idle", "prone_idle"):
        return 2
    return 1

def extract_frame_from_sheet(image, frame_idx, direction, bbox, scale):
    """Extract, crop, and scale a single frame"""
    left = frame_idx * FRAME_W_SRC
    top = direction * FRAME_H_SRC
    right = left + FRAME_W_SRC
    bottom = top + FRAME_H_SRC

    frame_img = image.crop((left, top, right, bottom))
    if frame_img.mode != 'RGBA':
        frame_img = frame_img.convert('RGBA')

    # Crop to union bbox
    bbox_left, bbox_top, bbox_right, bbox_bottom = bbox
    cropped = frame_img.crop((bbox_left, bbox_top, bbox_right, bbox_bottom))

    # Scale
    bbox_w = bbox_right - bbox_left
    bbox_h = bbox_bottom - bbox_top
    new_w = round(bbox_w * scale)
    new_h = round(bbox_h * scale)

    scaled = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
    return scaled

def repack_sheet(sheet_path, bbox, scale, fw, fh):
    """Repack a single sheet: extract frames, arrange in grid"""
    img = Image.open(sheet_path)
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    filename = sheet_path.name
    action_name = action_name_from_filename(filename)
    stride = get_stride(action_name)

    n_cols = img.width // FRAME_W_SRC
    src_frames = n_cols

    # Collect frames (8 directions)
    frames_by_direction = [[] for _ in range(8)]

    for direction in range(8):
        for col_idx in range(n_cols):
            if col_idx % stride == 0:
                frame_idx = col_idx
                frame = extract_frame_from_sheet(img, frame_idx, direction, bbox, scale)
                frames_by_direction[direction].append(frame)

    # Flatten: dir-major order
    all_frames = []
    frames_per_dir = len(frames_by_direction[0]) if frames_by_direction[0] else 0
    for direction in range(8):
        all_frames.extend(frames_by_direction[direction])

    total_frames = len(all_frames)

    # Grid dimensions
    cols = min(total_frames, MAX_GRID_WIDTH // fw)
    rows = math.ceil(total_frames / cols) if cols > 0 else 1

    sheet_w = cols * fw
    sheet_h = rows * fh

    # Create output image
    output_img = Image.new('RGBA', (sheet_w, sheet_h), (0, 0, 0, 0))

    # Paste frames
    idx = 0
    for row in range(rows):
        for col in range(cols):
            if idx < len(all_frames):
                x = col * fw
                y = row * fh
                output_img.paste(all_frames[idx], (x, y), all_frames[idx])
                idx += 1

    # Save
    output_path = OUTPUT_DIR / f"{action_name}.png"
    output_img.save(output_path, 'PNG')

    return {
        "action": action_name,
        "file": f"{action_name}.png",
        "src_frames": src_frames,
        "stride": stride,
        "frames": frames_per_dir,
        "cols": cols,
        "rows": rows,
        "sheet_w": sheet_w,
        "sheet_h": sheet_h,
        "output_path": output_path,
        "file_size_kb": output_path.stat().st_size / 1024
    }

def main():
    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=== Step 1: Compute union bbox ===")
    union_bbox_result = compute_union_bbox()
    print(f"Union bbox (padded): {union_bbox_result}")

    bbox_left, bbox_top, bbox_right, bbox_bottom = union_bbox_result
    bbox_w = bbox_right - bbox_left
    bbox_h = bbox_bottom - bbox_top
    print(f"  Width: {bbox_w}, Height: {bbox_h}")

    print("\n=== Step 2: Compute scale ===")
    scale = compute_scale(union_bbox_result)
    print(f"Scale: {scale}")

    fw = round(bbox_w * scale)
    fh = round(bbox_h * scale)
    print(f"Output frame size: {fw}×{fh}")

    print("\n=== Step 3: Repack sheets ===")
    sheets = sorted(INPUT_DIR.glob("*_spritesheet.png"))
    action_data = {}
    summary = []

    for sheet_path in sheets:
        print(f"Processing {sheet_path.name}...", end=" ", flush=True)
        try:
            result = repack_sheet(sheet_path, union_bbox_result, scale, fw, fh)
            action_data[result["action"]] = {
                "file": result["file"],
                "srcFrames": result["src_frames"],
                "stride": result["stride"],
                "frames": result["frames"],
                "cols": result["cols"],
                "rows": result["rows"],
                "sheetW": result["sheet_w"],
                "sheetH": result["sheet_h"]
            }
            summary.append(result)
            print("OK")
        except Exception as e:
            print(f"FAILED: {e}")
            return 1

    print("\n=== Step 4: Compute anchor ===")
    anchor_x = round((200 - bbox_left) / bbox_w, 4)
    anchor_y = round((131 - bbox_top) / bbox_h, 4)
    print(f"Anchor: X={anchor_x}, Y={anchor_y}")

    print("\n=== Step 5: Write manifest ===")
    manifest = {
        "frameWidth": fw,
        "frameHeight": fh,
        "scale": scale,
        "srcFrameW": FRAME_W_SRC,
        "srcFrameH": FRAME_H_SRC,
        "bbox": [bbox_left, bbox_top, bbox_right, bbox_bottom],
        "anchorX": anchor_x,
        "anchorY": anchor_y,
        "dirOrder": ["S", "SE", "E", "NE", "N", "NW", "W", "SW"],
        "srcFps": 24,
        "actions": action_data
    }

    with open(MANIFEST_PATH, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f"Manifest written to {MANIFEST_PATH}")

    print("\n=== Step 6: Self-validation ===")
    errors = []
    dir_check_pass = True

    for action, meta in action_data.items():
        action_path = OUTPUT_DIR / meta["file"]

        # Verify file exists and dimensions
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

            # Verify dimensions against manifest
            if meta["sheetW"] > MAX_SHEET_DIM or meta["sheetH"] > MAX_SHEET_DIM:
                errors.append(
                    f"{action}: sheet exceeds max dim (8192). Got {meta['sheetW']}×{meta['sheetH']}"
                )

            # Verify frame count
            max_frames = meta["cols"] * meta["rows"]
            expected_frames = meta["frames"] * 8
            if expected_frames > max_frames:
                errors.append(
                    f"{action}: frame count mismatch. Need {expected_frames}, "
                    f"grid holds {max_frames}"
                )

            # Content validation: dir0 f0 vs dir4 f0 must have different md5
            frames_per_dir = meta["frames"]
            cols = meta["cols"]
            frame_h = fh

            # Extract dir0 f0 (index 0)
            idx_dir0_f0 = 0
            row_dir0_f0 = idx_dir0_f0 // cols
            col_dir0_f0 = idx_dir0_f0 % cols
            x0 = col_dir0_f0 * fw
            y0 = row_dir0_f0 * frame_h
            crop_dir0_f0 = img.crop((x0, y0, x0 + fw, y0 + frame_h))
            md5_dir0_f0 = hashlib.md5(crop_dir0_f0.tobytes()).hexdigest()

            # Extract dir4 f0 (index 4*frames_per_dir)
            idx_dir4_f0 = 4 * frames_per_dir
            if idx_dir4_f0 < frames_per_dir * 8:
                row_dir4_f0 = idx_dir4_f0 // cols
                col_dir4_f0 = idx_dir4_f0 % cols
                x4 = col_dir4_f0 * fw
                y4 = row_dir4_f0 * frame_h
                crop_dir4_f0 = img.crop((x4, y4, x4 + fw, y4 + frame_h))
                md5_dir4_f0 = hashlib.md5(crop_dir4_f0.tobytes()).hexdigest()

                if md5_dir0_f0 == md5_dir4_f0:
                    errors.append(
                        f"{action}: dir0_f0 and dir4_f0 have identical md5 (direction data duplicate!)"
                    )
                    dir_check_pass = False

        except Exception as e:
            errors.append(f"{action}: error reading output PNG: {e}")

    # Generate stand_idle direction check image
    print("\n=== Step 7: Generate direction check image ===")
    try:
        stand_idle_path = OUTPUT_DIR / "stand_idle.png"
        if stand_idle_path.exists():
            stand_idle_img = Image.open(stand_idle_path)
            meta_idle = action_data.get("stand_idle", {})
            if meta_idle:
                frames_per_dir_idle = meta_idle["frames"]
                cols_idle = meta_idle["cols"]

                # Extract frames at indices 0, 43, 86, 129 (dir0 f0, dir1 f0, dir2 f0, dir3 f0)
                indices = [
                    0,
                    frames_per_dir_idle,
                    2 * frames_per_dir_idle,
                    3 * frames_per_dir_idle
                ]

                frames_check = []
                for idx in indices:
                    row = idx // cols_idle
                    col = idx % cols_idle
                    x = col * fw
                    y = row * fh
                    frame = stand_idle_img.crop((x, y, x + fw, y + fh))
                    # Upscale 3x with NEAREST for clarity
                    frame_scaled = frame.resize((fw * 3, fh * 3), Image.Resampling.NEAREST)
                    frames_check.append(frame_scaled)

                # Concatenate horizontally
                total_w = len(frames_check) * fw * 3
                total_h = fh * 3
                check_img = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))
                for i, frame in enumerate(frames_check):
                    check_img.paste(frame, (i * fw * 3, 0), frame)

                check_img_path = Path(
                    "C:/Users/AWARE~1.梨/AppData/Local/Temp/claude/C--Projects-squad-tactics/"
                    "5448d5bf-7f89-427f-a19a-c2399886ab60/scratchpad/worker_dir_check.png"
                )
                check_img_path.parent.mkdir(parents=True, exist_ok=True)
                check_img.save(check_img_path, 'PNG')
                print(f"Direction check image saved: {check_img_path}")
    except Exception as e:
        errors.append(f"Failed to generate direction check image: {e}")

    print("\n=== Summary Table ===")
    print(f"{'Action':<30} {'SrcFrames':<10} {'Frames':<8} {'Grid':<15} {'SheetSize':<15} {'FileSizeKB':<10}")
    print("-" * 90)
    for s in summary:
        grid_str = f"{s['cols']}×{s['rows']}"
        sheet_str = f"{s['sheet_w']}×{s['sheet_h']}"
        print(
            f"{s['action']:<30} {s['src_frames']:<10} {s['frames']:<8} "
            f"{grid_str:<15} {sheet_str:<15} {s['file_size_kb']:<10.1f}"
        )

    print(f"\n{'='*90}")
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
