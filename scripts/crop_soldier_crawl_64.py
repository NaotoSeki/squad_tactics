# SPDX-License-Identifier: MIT
"""
soldier_crawl.png から以下を生成する。
・soldier_crawl_64.png / soldier_crawl_128.png … スプライトシート（参考用）
・soldier_crawl_0.png ～ soldier_crawl_7.png … 8方向の単体画像（128×128）。ゲームはこちらを load.image で使用。

画像が 2048×2048 未満の場合は透明パディングする（本番は Blender で 2048×7680 出力後に実行）。

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
    # 128pxセル版: 1024x1024
    out128 = out64.resize((SHEET_128_SIZE, SHEET_128_SIZE), Image.Resampling.LANCZOS)
    out128.save(dst128, "PNG")
    print("Saved:", dst128)
    # 8方向の単体画像（128x128）。スプライトシートが1枚で出る不具合を避け load.image + setTexture で使用
    cell = 128
    asset_dir = os.path.join(root, "asset")
    for d in range(8):
        x, y = d * cell, 0
        cell_img = out128.crop((x, y, x + cell, y + cell))
        out_path = os.path.join(asset_dir, "soldier_crawl_{}.png".format(d))
        cell_img.save(out_path, "PNG")
    print("Saved: soldier_crawl_0.png .. soldier_crawl_7.png")

if __name__ == "__main__":
    main()
