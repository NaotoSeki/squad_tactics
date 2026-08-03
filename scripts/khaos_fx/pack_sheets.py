#!/usr/bin/env python3
"""
爆発エフェクト連番PNG → スプライトシート梱包スクリプト
高解像度シート（128×128）と互換シート（64×64）を生成。
"""

import argparse
import sys
from pathlib import Path
import re
from PIL import Image
import numpy as np


def load_frames_sorted(src_dir):
    """frame_*.png をソート順に読み込み。"""
    src_path = Path(src_dir)
    pattern = re.compile(r'^frame_(\d+)\.png$', re.IGNORECASE)

    frames = []
    for file in src_path.glob('frame_*.png'):
        match = pattern.match(file.name)
        if match:
            frame_num = int(match.group(1))
            frames.append((frame_num, file))

    frames.sort()
    return [img_path for _, img_path in frames]


def select_frames(frame_paths, target_count):
    """
    等間隔でフレームを選択。
    最初の1〜2枚を飛ばし、残りから等間隔に target_count 枚を選ぶ。
    """
    if len(frame_paths) < 3:
        # フレーム不足時は全て使用
        return frame_paths

    # 最初の2枚を飛ばす
    remaining = frame_paths[2:]

    if len(remaining) <= target_count:
        # 残りの枚数が target_count 以下なら全て返す
        return [frame_paths[0]] + remaining  # 最初の1枚も追加してバランス調整

    # np.linspace で等間隔インデックスを生成（重複なし）
    indices = np.linspace(0, len(remaining) - 1, target_count, dtype=int)
    selected = [remaining[i] for i in indices]
    return selected


def verify_sheet_quality(sheet_img, frame_width, frame_height, grid_cols, grid_rows):
    """
    シート検証:
    - 全体のα > 10 の比率
    - 各セルの非空判定
    """
    data = np.array(sheet_img, dtype=np.uint32)

    # アルファチャネルが 10 より大きい ピクセル数
    if data.shape[2] >= 4:
        alpha = data[:, :, 3]
        opaque_count = np.sum(alpha > 10)
    else:
        opaque_count = data.shape[0] * data.shape[1]

    total_pixels = sheet_img.width * sheet_img.height
    opaque_ratio = opaque_count / total_pixels if total_pixels > 0 else 0

    # 各セルをチェック
    empty_cells = []
    for row in range(grid_rows):
        for col in range(grid_cols):
            x0 = col * frame_width
            y0 = row * frame_height
            x1 = x0 + frame_width
            y1 = y0 + frame_height

            cell = data[y0:y1, x0:x1]
            if cell.size > 0 and data.shape[2] >= 4:
                cell_alpha = cell[:, :, 3]
                if np.sum(cell_alpha > 10) == 0:
                    empty_cells.append((row, col))

    return {
        'opaque_ratio': opaque_ratio,
        'opaque_pixels': int(opaque_count),
        'total_pixels': total_pixels,
        'empty_cells': empty_cells,
    }


def pack_sheets(src_dir, out_dir):
    """メイン処理。"""
    src_path = Path(src_dir)
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # フレームを読み込み
    frame_paths = load_frames_sorted(src_dir)

    if not frame_paths:
        print(f"ERROR: frame_*.png not found in {src_dir}")
        sys.exit(1)

    print(f"[INFO] Loaded {len(frame_paths)} frames")

    # フレームをPILで読み込む
    frames = []
    for fp in frame_paths:
        try:
            img = Image.open(fp).convert('RGBA')
            frames.append(img)
        except Exception as e:
            print(f"ERROR: Failed to load {fp}: {e}")
            sys.exit(1)

    frame_width = frames[0].width
    frame_height = frames[0].height
    print(f"[INFO] Frame size: {frame_width}×{frame_height} (RGBA)")

    # === 高解像度シート: 32フレーム, 128×128, 8×4 ===
    target_frames_128 = min(32, len(frames))
    selected_128 = select_frames(frames, target_frames_128)
    print(f"[INFO] Selected {len(selected_128)} frames for 128×128 sheet")

    frames_128 = []
    for frame in selected_128:
        resized = frame.resize((128, 128), Image.LANCZOS)
        frames_128.append(resized)

    sheet_128 = Image.new('RGBA', (8 * 128, 4 * 128), (0, 0, 0, 0))
    for idx, frame in enumerate(frames_128):
        row = idx // 8
        col = idx % 8
        x = col * 128
        y = row * 128
        sheet_128.paste(frame, (x, y))

    sheet_128_path = out_path / 'explosion_khaos_128.png'
    sheet_128.save(sheet_128_path)

    stats_128 = verify_sheet_quality(sheet_128, 128, 128, 8, 4)
    print(f"[INFO] Sheet 128×128 saved: {sheet_128_path}")
    print(f"  Size: {sheet_128.width}×{sheet_128.height}")
    print(f"  Opaque ratio: {stats_128['opaque_ratio']:.2%}")
    print(f"  Opaque pixels: {stats_128['opaque_pixels']:,} / {stats_128['total_pixels']:,}")

    if stats_128['empty_cells']:
        print(f"  WARNING: {len(stats_128['empty_cells'])} empty cells detected:")
        for row, col in stats_128['empty_cells'][:5]:
            print(f"    - Cell ({row}, {col})")
        if len(stats_128['empty_cells']) > 5:
            print(f"    ... and {len(stats_128['empty_cells']) - 5} more")

    # === ドロップイン互換シート: 16フレーム, 64×64, 4×4 ===
    target_frames_64 = min(16, len(frames))
    selected_64 = select_frames(frames, target_frames_64)
    print(f"\n[INFO] Selected {len(selected_64)} frames for 64×64 sheet")

    frames_64 = []
    for frame in selected_64:
        resized = frame.resize((64, 64), Image.LANCZOS)
        frames_64.append(resized)

    sheet_64 = Image.new('RGBA', (4 * 64, 4 * 64), (0, 0, 0, 0))
    for idx, frame in enumerate(frames_64):
        row = idx // 4
        col = idx % 4
        x = col * 64
        y = row * 64
        sheet_64.paste(frame, (x, y))

    sheet_64_path = out_path / 'explosion_khaos_64.png'
    sheet_64.save(sheet_64_path)

    stats_64 = verify_sheet_quality(sheet_64, 64, 64, 4, 4)
    print(f"[INFO] Sheet 64×64 saved: {sheet_64_path}")
    print(f"  Size: {sheet_64.width}×{sheet_64.height}")
    print(f"  Opaque ratio: {stats_64['opaque_ratio']:.2%}")
    print(f"  Opaque pixels: {stats_64['opaque_pixels']:,} / {stats_64['total_pixels']:,}")

    if stats_64['empty_cells']:
        print(f"  WARNING: {len(stats_64['empty_cells'])} empty cells detected:")
        for row, col in stats_64['empty_cells'][:5]:
            print(f"    - Cell ({row}, {col})")
        if len(stats_64['empty_cells']) > 5:
            print(f"    ... and {len(stats_64['empty_cells']) - 5} more")

    # === preview.html ===
    frames_count_128 = len(selected_128)
    frames_count_64 = len(selected_64)
    opaque_ratio_128 = stats_128['opaque_ratio']
    opaque_pixels_128 = stats_128['opaque_pixels']
    opaque_ratio_64 = stats_64['opaque_ratio']
    opaque_pixels_64 = stats_64['opaque_pixels']

    preview_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Explosion Sprite Sheet Preview</title>
    <style>
        body {{
            background: linear-gradient(45deg, #444 25%, transparent 25%, transparent 75%, #444 75%, #444),
                        linear-gradient(45deg, #444 25%, transparent 25%, transparent 75%, #444 75%, #444);
            background-size: 20px 20px;
            background-position: 0 0, 10px 10px;
            background-color: #333;
            margin: 0;
            padding: 20px;
            font-family: Arial, sans-serif;
            color: #fff;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
        }}
        h1 {{
            text-align: center;
        }}
        .preview-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-top: 20px;
        }}
        .preview-section {{
            border: 1px solid #666;
            padding: 15px;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.5);
        }}
        .preview-section h2 {{
            margin: 0 0 10px 0;
            font-size: 18px;
        }}
        .animation-container {{
            background: linear-gradient(45deg, #222 25%, transparent 25%, transparent 75%, #222 75%, #222),
                        linear-gradient(45deg, #222 25%, transparent 25%, transparent 75%, #222 75%, #222);
            background-size: 10px 10px;
            background-position: 0 0, 5px 5px;
            background-color: #111;
            padding: 10px;
            border-radius: 4px;
            display: inline-block;
        }}
        .sprite-128 {{
            width: 128px;
            height: 128px;
            background-image: url('explosion_khaos_128.png');
            background-size: 1024px 512px;
            animation: explode_128 2s steps({frames_count_128}, end) infinite;
        }}
        .sprite-64 {{
            width: 64px;
            height: 64px;
            background-image: url('explosion_khaos_64.png');
            background-size: 256px 256px;
            animation: explode_64 2s steps({frames_count_64}, end) infinite;
        }}
        @keyframes explode_128 {{
            0% {{ background-position: 0 0; }}
            100% {{ background-position: -1024px 0; }}
        }}
        @keyframes explode_64 {{
            0% {{ background-position: 0 0; }}
            100% {{ background-position: -256px 0; }}
        }}
        .info {{
            margin-top: 10px;
            font-size: 12px;
            color: #aaa;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Explosion Sprite Sheet Preview</h1>
        <div class="preview-grid">
            <div class="preview-section">
                <h2>High Resolution (128×128)</h2>
                <p>{frames_count_128} frames • 1024×512 spritesheet</p>
                <div class="animation-container">
                    <div class="sprite-128"></div>
                </div>
                <div class="info">
                    Opaque: {opaque_ratio_128:.1%} | {opaque_pixels_128:,} px
                </div>
            </div>
            <div class="preview-section">
                <h2>Drop-in Compatible (64×64)</h2>
                <p>{frames_count_64} frames • 256×256 spritesheet</p>
                <div class="animation-container">
                    <div class="sprite-64"></div>
                </div>
                <div class="info">
                    Opaque: {opaque_ratio_64:.1%} | {opaque_pixels_64:,} px
                </div>
            </div>
        </div>
    </div>
</body>
</html>"""

    preview_path = out_path / 'preview.html'
    preview_path.write_text(preview_html, encoding='utf-8')
    print(f"\n[INFO] Preview saved: {preview_path}")

    print("\n[SUCCESS] Sheet packing complete.")


def main():
    parser = argparse.ArgumentParser(
        description='Pack explosion effect frames into sprite sheets.'
    )
    parser.add_argument('--src', required=True, help='Source directory containing frame_*.png')
    parser.add_argument('--out', required=True, help='Output directory for spritesheet files')

    args = parser.parse_args()

    pack_sheets(args.src, args.out)


if __name__ == '__main__':
    main()
