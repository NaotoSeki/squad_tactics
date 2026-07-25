#!/usr/bin/env python3
"""PS正本のクレーター/轍アセットを本編のデカール素材として書き出す。

PS実機は着弾痕や轍を「配置台帳へ追記される地表デコー」として扱う
（戦場差分で `crater_gun` 9種と `tracks_tank` 62種がセーブ側に増えていた）。
本編でも同じく、生きたスプライトではなく**地表へ焼き込むデカール**として使う。
焼き込みなら描画コストは枚数に依らず1テクスチャ1ドローで済む。

出力: asset/environment/decals/<name>.png + manifest.json
manifest はティア別に分類する。ティアは砲の口径帯に対応する PS の命名そのまま:
  auto   32x18 前後 — 小口径・銃弾の着弾痕
  light  50x30 前後
  medium 80x44 前後
  heavy  70-97x45 前後 — 榴弾・爆発

origin はSSC由来をそのまま持つ。焼き込み時に
`left = worldX + origin_x`, `top = worldY + origin_y` で貼ると
PSと同じ接地位置になる（正本レンダラの stamp_entry と同じ規約）。
"""

from __future__ import annotations

import argparse
import json
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any

CRATER_TIERS = ("auto", "light", "medium", "heavy")


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--canonical-root", type=Path, default=repo_root / "scratch" / "ps_sprites_canonical_v1"
    )
    parser.add_argument(
        "--out-dir", type=Path, default=repo_root / "asset" / "environment" / "decals"
    )
    args = parser.parse_args()

    manifest = json.loads(
        (args.canonical_root / "canonical_manifest.json").read_text(encoding="utf-8")
    )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for path in args.out_dir.glob("*.png"):
        path.unlink()

    tiers: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for record in manifest["sprites"]:
        stem = Path(record["png"]).stem  # 例: crater_gun_heavy_03_s0
        if not stem.startswith("crater_gun_"):
            continue
        tier = stem.split("_")[2]
        if tier not in CRATER_TIERS:
            continue

        name = stem.rsplit("_s", 1)[0]
        source = args.canonical_root / record["png"]
        if not source.is_file():
            continue

        shutil.copyfile(source, args.out_dir / f"{name}.png")
        tiers[tier].append(
            {
                "id": name,
                "file": f"{name}.png",
                "w": record["width"],
                "h": record["height"],
                # SSC由来のorigin。貼付位置 = world + origin。
                "ox": record["origin_x"],
                "oy": record["origin_y"],
            }
        )

    for tier in tiers:
        tiers[tier].sort(key=lambda item: item["id"])

    out = {
        "schema": "ps_decals/v1",
        "source": "ps_sprites_canonical_v1",
        "note": "焼き込み用。left = worldX + ox, top = worldY + oy で貼る（PS stamp_entry と同規約）",
        "tiers": {tier: tiers[tier] for tier in CRATER_TIERS if tier in tiers},
    }
    (args.out_dir / "manifest.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    total = sum(len(v) for v in tiers.values())
    print(f"decals {total} -> {args.out_dir}")
    for tier in CRATER_TIERS:
        items = tiers.get(tier, [])
        if items:
            sizes = f"{items[0]['w']}x{items[0]['h']}"
            print(f"  {tier:7s} {len(items):2d}  (例 {sizes})")


if __name__ == "__main__":
    main()
