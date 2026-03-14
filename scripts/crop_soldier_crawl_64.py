# SPDX-License-Identifier: MIT
"""
soldier_crawl.png の上 2048×2048（8列×8行＝64コマ）を切り出し、
soldier_crawl_64.png として保存する。Phaser の load.spritesheet 用。

画像が 2048×2048 未満の場合は、透明で 2048×2048 にパディングして保存する
（本番用は Blender で 2048×7680 を出力してから実行すること）。

使い方: プロジェクトルートで
  python scripts/crop_soldier_crawl_64.py
"""
import os
import sys

CROP_W, CROP_H = 2048, 2048

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = os.path.join(root, "asset", "soldier_crawl.png")
    dst = os.path.join(root, "asset", "soldier_crawl_64.png")
    if not os.path.isfile(src):
        print("Error: not found:", src, file=sys.stderr)
        sys.exit(1)
    try:
        from PIL import Image
    except ImportError:
        print("Error: Pillow required. Run: pip install Pillow", file=sys.stderr)
        sys.exit(1)
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    if w >= CROP_W and h >= CROP_H:
        out = img.crop((0, 0, CROP_W, CROP_H))
    else:
        out = Image.new("RGBA", (CROP_W, CROP_H), (0, 0, 0, 0))
        out.paste(img, (0, 0))
    out.save(dst, "PNG")
    print("Saved:", dst)

if __name__ == "__main__":
    main()
