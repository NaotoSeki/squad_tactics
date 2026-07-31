import os
import sys
from PIL import Image

def compose_spritesheet(input_dir, output_file, directions=8):
    """
    Composes a spritesheet from frames sorted by direction.
    Expects input_dir to contain folders named dir_0, dir_1, ..., dir_7.
    Each folder should contain frames like frame_0001.png, frame_0002.png.
    """
    if not os.path.exists(input_dir):
        print(f"Error: Input directory {input_dir} not found.")
        return

    frames_per_dir = []
    max_frames = 0
    frame_width = 0
    frame_height = 0

    # First pass: collect images and determine dimensions
    for d in range(directions):
        dir_path = os.path.join(input_dir, f"dir_{d}")
        if not os.path.exists(dir_path):
            print(f"Warning: Directory {dir_path} not found.")
            frames_per_dir.append([])
            continue
            
        # Get all png files, sorted alphabetically (which sorts frame_0001, frame_0002 correctly)
        frames = sorted([f for f in os.listdir(dir_path) if f.endswith('.png')])
        frames_per_dir.append([os.path.join(dir_path, f) for f in frames])
        
        if len(frames) > max_frames:
            max_frames = len(frames)
            
        if frames and frame_width == 0:
            with Image.open(os.path.join(dir_path, frames[0])) as img:
                frame_width, frame_height = img.size

    if max_frames == 0:
        print("No frames found to compose.")
        return

    print(f"Composing spritesheet: {directions} directions, {max_frames} frames per direction.")
    print(f"Frame size: {frame_width}x{frame_height}")

    # Create blank canvas
    # Layout: Rows = Directions (0 to 7), Columns = Frames
    sheet_width = frame_width * max_frames
    sheet_height = frame_height * directions
    
    spritesheet = Image.new('RGBA', (sheet_width, sheet_height), (0, 0, 0, 0))

    # Paste frames
    for row, dir_frames in enumerate(frames_per_dir):
        for col, frame_path in enumerate(dir_frames):
            with Image.open(frame_path) as img:
                x = col * frame_width
                y = row * frame_height
                spritesheet.paste(img, (x, y))
                
    # Save the output
    spritesheet.save(output_file)
    print(f"Saved spritesheet to {output_file}")
    print(f"Phaser config: frameWidth: {frame_width}, frameHeight: {frame_height}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Compose Blender rendered frames into a spritesheet.")
    parser.add_argument("--input", "-i", type=str, required=True, help="Directory containing dir_0 ... dir_7 folders")
    parser.add_argument("--output", "-o", type=str, default="spritesheet.png", help="Output PNG file path")
    
    args = parser.parse_args()
    compose_spritesheet(args.input, args.output)
