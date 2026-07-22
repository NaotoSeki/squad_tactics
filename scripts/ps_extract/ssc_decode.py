import struct
import glob
import os

def analyze_headers(directory):
    files = glob.glob(os.path.join(directory, '*.ssc'))
    print(f"Found {len(files)} SSC files.")
    
    for filepath in files[:20]: # Check first 20 files
        with open(filepath, 'rb') as f:
            data = f.read()
        
        if len(data) < 4:
            continue
            
        frames = struct.unpack('<I', data[:4])[0]
        header_vals = struct.unpack(f'<{min(32, len(data))//4}I', data[:min(32, len(data))])
        
        # 最後のほうにあるデータオフセットの配列らしきものを探す
        # もしフレーム数が N なら、 N個の単調増加する uint32 (ファイルサイズより小さい) が並んでいるはず。
        offset_table_start = -1
        for i in range(4, 256, 4):
            if i + frames * 4 <= len(data):
                vals = struct.unpack(f'<{frames}I', data[i:i + frames*4])
                # Check if monotonically increasing and reasonable offsets
                is_offset_table = True
                for j in range(frames - 1):
                    if vals[j] >= vals[j+1] or vals[j] > len(data) or vals[j] < 16:
                        is_offset_table = False
                        break
                if is_offset_table and vals[-1] < len(data):
                    offset_table_start = i
                    break
                    
        filename = os.path.basename(filepath)
        print(f"File: {filename:35} | Frames: {frames:3} | Offset Table at: {offset_table_start:3}")
        if offset_table_start != -1:
            vals = struct.unpack(f'<{frames}I', data[offset_table_start:offset_table_start + frames*4])
            print(f"  Offsets: {vals[:5]} ...")
        else:
            print(f"  Header vals: {header_vals}")

if __name__ == "__main__":
    analyze_headers(r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\Data\Game\Common\Media\Objects\Buildings")
