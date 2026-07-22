import os
import glob
from ssc_decoder import extract_ssc

def main():
    base_dir = r"c:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\Data\Game\Common\Media"
    out_dir = r"c:\Projects\squad_tactics\scratch\ps_sprites"
    
    ssc_files = glob.glob(os.path.join(base_dir, "**", "*.ssc"), recursive=True)
    
    total_files = len(ssc_files)
    print(f"Found {total_files} .ssc files to process.")
    
    for i, ssc_path in enumerate(ssc_files, 1):
        rel_path = os.path.relpath(os.path.dirname(ssc_path), base_dir)
        target_dir = os.path.join(out_dir, rel_path)
        os.makedirs(target_dir, exist_ok=True)
        
        print(f"[{i}/{total_files}] Extracting: {os.path.basename(ssc_path)}")
        try:
            frames, px = extract_ssc(ssc_path, out_dir=target_dir)
            print(f"  -> {frames} frames, {px} pixels")
        except Exception as e:
            print(f"  -> Error: {e}")

if __name__ == "__main__":
    main()
