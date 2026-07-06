# SPDX-License-Identifier: MIT
"""
Blender 出力の soldier_crawl.png（2048×7680 = 8列×30行・256pxセル）をスライスしてゲーム用に変換する。

想定: Blender で 2048×7680 を asset/soldier_crawl.png に出力 → このスクリプト実行。

生成物:
・上 2048×2048（先頭8行）→ soldier_crawl_64.png / soldier_crawl_128.png（参考用シート）
・1行目を8方向にスライス（各256×256のまま）→ soldier_crawl_0.png ～ soldier_crawl_7.png（ゲームで使用）

画像が 2048×2048 未満の場合は透明パディングしてから同様に処理（未配置時用）。

使い方:
  【方法1】Windows: scripts/crop_soldier_crawl_64.cmd をダブルクリック
  【方法2】ターミナルでプロジェクトルートに移動してから:
    cd c:\\Projects\\squad_tactics
    python scripts/crop_soldier_crawl_64.py
  初回のみ: pip install Pillow
"""
import os
import sys

CROP_64_W, CROP_64_H = 2048, 2048  # 64コマ用（256pxセル）
SHEET_128_SIZE = 1024  # 128pxセル x 8x8 = 64コマ（tank_sheet と同じセルサイズで互換性重視）

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = os.path.join(root, "asset", "soldier_crawl.png")
    dst64 = os.path.join(root, "asset", "soldier_crawl_64.png")
    dst128 = os.path.join(root, "asset", "soldier_crawl_128.png")
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
    if w >= CROP_64_W and h >= CROP_64_H:
        out64 = img.crop((0, 0, CROP_64_W, CROP_64_H))
    else:
        out64 = Image.new("RGBA", (CROP_64_W, CROP_64_H), (0, 0, 0, 0))
        out64.paste(img, (0, 0))
    out64.save(dst64, "PNG")
    print("Saved:", dst64)
    # 128pxセル版: 1024x1024（参考用）
    out128 = out64.resize((SHEET_128_SIZE, SHEET_128_SIZE), Image.Resampling.LANCZOS)
    out128.save(dst128, "PNG")
    print("Saved:", dst128)
    # 8方向を 256×256 のままスライス（リサイズせず1コマずつ保存）
    cell = 256
    asset_dir = os.path.join(root, "asset")
    for d in range(8):
        x1, y1 = d * cell, 0
        one_cell = out64.crop((x1, y1, x1 + cell, y1 + cell))
        out_path = os.path.join(asset_dir, "soldier_crawl_{}.png".format(d))
        one_cell.save(out_path, "PNG")
    print("Saved: soldier_crawl_0.png .. soldier_crawl_7.png (each 256x256)")

if __name__ == "__main__":
    main()
