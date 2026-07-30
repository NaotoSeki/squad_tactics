#!/usr/bin/env python3
"""
新レンダフレームと旧形式スプライトシートの同一性を検証する。

例:
    python sp_parity_check.py --new-frames-dir C:/work/frames/parity_stand_idle --old-sheet C:/old/Stand.Idle_spritesheet.png
    python sp_parity_check.py --new-frames-dir frames/parity_stand_idle --old-sheet old.png --col 2 --threshold 3.0
"""

import argparse
import sys
from pathlib import Path

from PIL import Image


CELL_WIDTH = 400
CELL_HEIGHT = 262
DIRECTIONS = 8


def load_new_frames(directory):
    """新レンダのd0～d7フレームを読み込む。"""
    if not directory.is_dir():
        raise ValueError(f"new-frames-dir が存在しません: {directory}")

    frames = []
    for direction in range(DIRECTIONS):
        path = directory / f"d{direction}_f000.png"
        if not path.is_file():
            raise ValueError(f"必要なフレームがありません: {path}")
        try:
            image = Image.open(path).convert("RGBA")
        except OSError as exc:
            raise ValueError(f"PNGを開けません: {path} ({exc})")

        if image.size != (CELL_WIDTH, CELL_HEIGHT):
            image.close()
            raise ValueError(
                f"新フレーム寸法が不正です: {path} "
                f"({image.size[0]}x{image.size[1]}、{CELL_WIDTH}x{CELL_HEIGHT} が必要)"
            )
        frames.append(image)
    return frames


def validate_old_sheet(path, col):
    """旧シートを読み込み、寸法と列番号を検証する。"""
    if not path.is_file():
        raise ValueError(f"old-sheet が存在しません: {path}")

    try:
        sheet = Image.open(path).convert("RGBA")
    except OSError as exc:
        raise ValueError(f"旧シートを開けません: {path} ({exc})")

    width, height = sheet.size
    if height != DIRECTIONS * CELL_HEIGHT or width < CELL_WIDTH or width % CELL_WIDTH != 0:
        sheet.close()
        raise ValueError(
            f"旧シート寸法が不正です: {width}x{height} "
            f"(幅は{CELL_WIDTH}の倍数、高さは{DIRECTIONS * CELL_HEIGHT}が必要)"
        )

    frame_count = width // CELL_WIDTH
    if col < 0 or col >= frame_count:
        sheet.close()
        raise ValueError(f"--col が範囲外です: {col} (0～{frame_count - 1})")
    return sheet


def metrics(new_image, old_image):
    """alpha対象画素だけでRGBA差分とalpha IoUを算出する。"""
    new_data = list(new_image.getdata())
    old_data = list(old_image.getdata())

    target_count = 0
    component_sum = 0
    diff_gt8_count = 0
    intersection = 0
    union = 0

    for new_px, old_px in zip(new_data, old_data):
        new_alpha = new_px[3] > 0
        old_alpha = old_px[3] > 0

        if new_alpha or old_alpha:
            target_count += 1
            differences = [abs(a - b) for a, b in zip(new_px, old_px)]
            component_sum += sum(differences)
            if max(differences) > 8:
                diff_gt8_count += 1

        if new_alpha and old_alpha:
            intersection += 1
        if new_alpha or old_alpha:
            union += 1

    mean_abs_diff = component_sum / (target_count * 4) if target_count else 0.0
    pct_diff_gt8 = (diff_gt8_count * 100.0 / target_count) if target_count else 0.0
    alpha_iou = (intersection / union) if union else 1.0
    return mean_abs_diff, pct_diff_gt8, alpha_iou


def print_table(title, rows):
    """等幅の結果表を出力する。"""
    print()
    print(title)
    print("+-----+---------+---------------+--------------+-----------+")
    print("| new | old row | mean_abs_diff | pct_diff_gt8 | alpha_IoU |")
    print("+-----+---------+---------------+--------------+-----------+")
    for new_direction, old_row, mean_diff, pct_gt8, iou in rows:
        print(
            f"| d{new_direction:<2} | d{old_row:<5} | {mean_diff:13.4f} |"
            f" {pct_gt8:10.3f}% | {iou:9.5f} |"
        )
    print("+-----+---------+---------------+--------------+-----------+")


def main():
    parser = argparse.ArgumentParser(description="新旧スプライトレンダのパリティを検証します。")
    parser.add_argument("--new-frames-dir", required=True, help="d0_f000.png～d7_f000.png のあるディレクトリ")
    parser.add_argument("--old-sheet", required=True, help="旧形式スプライトシートPNG")
    parser.add_argument("--col", type=int, default=0, help="比較する旧シートの列番号（既定: 0）")
    parser.add_argument("--threshold", type=float, default=3.0, help="PASSとなる平均差分の閾値（既定: 3.0）")
    args = parser.parse_args()

    if args.threshold < 0:
        print("[parity] エラー: --threshold は0以上で指定してください", file=sys.stderr)
        return 1

    new_frames = []
    old_sheet = None
    old_cells = []

    try:
        new_frames = load_new_frames(Path(args.new_frames_dir))
        old_sheet = validate_old_sheet(Path(args.old_sheet), args.col)

        for row in range(DIRECTIONS):
            left = args.col * CELL_WIDTH
            top = row * CELL_HEIGHT
            old_cells.append(old_sheet.crop((left, top, left + CELL_WIDTH, top + CELL_HEIGHT)))

        identity_rows = []
        reversed_rows = []

        for direction in range(DIRECTIONS):
            identity_values = metrics(new_frames[direction], old_cells[direction])
            reversed_row = (8 - direction) % 8
            reversed_values = metrics(new_frames[direction], old_cells[reversed_row])

            identity_rows.append((direction, direction) + identity_values)
            reversed_rows.append((direction, reversed_row) + reversed_values)

        print_table("仮説 A: identity（新 d -> 旧 row d）", identity_rows)
        print_table("仮説 B: reversed（新 d -> 旧 row (8-d)%8）", reversed_rows)

        identity_average = sum(row[2] for row in identity_rows) / DIRECTIONS
        reversed_average = sum(row[2] for row in reversed_rows) / DIRECTIONS

        print()
        print(f"identity 平均 mean_abs_diff: {identity_average:.4f}")
        print(f"reversed 平均 mean_abs_diff: {reversed_average:.4f}")

        identity_wins = identity_average <= reversed_average
        if identity_wins and identity_average < args.threshold:
            print("PARITY: PASS")
            return 0

        if not identity_wins:
            print("PARITY: FAIL (reversed_mapping_wins)")
        else:
            print(f"PARITY: FAIL (diff_too_large={identity_average:.1f})")
        return 1

    except (ValueError, OSError) as exc:
        print(f"[parity] エラー: {exc}", file=sys.stderr)
        return 1
    finally:
        for image in old_cells:
            image.close()
        if old_sheet is not None:
            old_sheet.close()
        for image in new_frames:
            image.close()


if __name__ == "__main__":
    sys.exit(main())
