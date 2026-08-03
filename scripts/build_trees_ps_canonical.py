#!/usr/bin/env python3
"""本編の木アセットを **PS正本スロット抽出** から作る。

置き換え対象: scripts/build_trees_ps_v3.py（差分blit抽出 = ps_trees_v3 が入力）。

なぜ差し替えるか（2026-07-25、オーナー指摘「木が塩コショウ」）:
  差分blit抽出は黒地/白地の2回blitから straight色 = S/cov を逆算する。
  この除算は cov の小さい画素でノイズを増幅し、1px市松がコントラスト付きで
  焼き付く。正本抽出（scripts/ps_extract、SSCスロットの[coverage,index]を
  直接読む）は除算を経ないので、同じ木で高周波量が実測 42.48 -> 15.75 まで下がる。
  PS実機の描画も後者と同じデータを見ている。

両者は origin もサイズも同一（quercus-cerris_a_02: 181x208 origin(-92,-204) で一致）、
合成規約もストレートα（正本レンダラは Image.alpha_composite を使う）なので、
入力ディレクトリを差し替えるだけで下流はそのまま動く。

入力: scratch/ps_sprites_canonical_v1/ + canonical_manifest.json
出力: asset/environment/trees_ps/*.png + manifest.json
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from PIL import Image

TREE_DIR = "Objects/Trees/"

# SSCのスロット規約: slot2(fmt723)=立体本体, slot4(fmt934)=独立影。
BODY_FORMAT = 723
SHADOW_FORMAT = 934

CONIFER_GENERA = {
    "pinus",
    "picea",
    "abies",
    "larix",
    "cedrus",
    "pseudotsuga",
    "podocarpus",
    "sciadopitys",
}

# WW2欧州の地表色に対して蛍光/異国的に見えるパレットの種。抽出はするが本編には出さない。
EXCLUDE_GENERA = {"podocarpus", "sciadopitys", "heteromeles"}

# 本編で「木」として使う最小の高さ(px)。これ未満は低木として別扱い。
MIN_BODY_HEIGHT = 110


def next_pow2(value: int) -> int:
    if value < 1:
        raise ValueError(f"Invalid image dimension: {value}")
    return 1 << (value - 1).bit_length()


def process_sprite(
    source_path: Path, output_path: Path, origin_x: float, origin_y: float
) -> dict[str, float | int]:
    """POT キャンバスへ中央padして保存し、アンカー原点を分率で返す。

    POT化はWebGL1のmipmap生成要件。前処理フィルタは一切かけない
    （デディザ等の近似はオーナー方針で禁止。平滑化はGPUのミニフィケーションに任せる）。
    """
    with Image.open(source_path) as image:
        rgba = image.convert("RGBA")
        w, h = rgba.size

        tw, th = next_pow2(w), next_pow2(h)
        padx, pady = (tw - w) // 2, (th - h) // 2

        canvas = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
        canvas.paste(rgba, (padx, pady))
        canvas.save(output_path, format="PNG", optimize=True)

    return {
        "w": w,
        "h": h,
        "tw": tw,
        "th": th,
        "ox": (-float(origin_x) + padx) / tw,
        "oy": (-float(origin_y) + pady) / th,
    }


def collect_trees(manifest: dict[str, Any]) -> dict[str, dict[int, dict[str, Any]]]:
    """canonical_manifest から木のSSCごとに {format_id: record} を集める。"""
    by_ssc: dict[str, dict[int, dict[str, Any]]] = defaultdict(dict)
    for record in manifest["sprites"]:
        png = record.get("png", "")
        if not png.startswith(TREE_DIR):
            continue
        fmt = record.get("format_id")
        if fmt in (BODY_FORMAT, SHADOW_FORMAT):
            # 同フォーマットが複数スロットある場合は最初の1つ（規約通りの並び順）
            by_ssc[record["ssc"]].setdefault(fmt, record)
    return by_ssc


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    repo_root = Path(__file__).resolve().parent.parent
    parser.add_argument(
        "--canonical-root",
        type=Path,
        default=repo_root / "scratch" / "ps_sprites_canonical_v1",
    )
    parser.add_argument(
        "--out-dir", type=Path, default=repo_root / "asset" / "environment" / "trees_ps"
    )
    args = parser.parse_args()

    manifest_path = args.canonical_root / "canonical_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    by_ssc = collect_trees(manifest)
    if not by_ssc:
        raise SystemExit(f"no tree sprites found under {TREE_DIR} in {manifest_path}")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for path in args.out_dir.glob("*.png"):
        if path.is_file():
            path.unlink()
    # v2時代の un-premultiply マーカーが残っていたら消す（v3以降は不要）
    marker = args.out_dir / ".unpremultiplied"
    if marker.is_file():
        marker.unlink()

    trees: list[dict[str, Any]] = []
    skipped_short = 0
    skipped_genus = 0

    for ssc in sorted(by_ssc):
        slots = by_ssc[ssc]
        body = slots.get(BODY_FORMAT)
        if body is None:
            continue

        tree_id = Path(ssc).stem
        genus = tree_id.split("-", 1)[0].lower()
        if genus in EXCLUDE_GENERA:
            skipped_genus += 1
            continue
        if int(body.get("height", 0)) < MIN_BODY_HEIGHT:
            skipped_short += 1
            continue

        body_source = args.canonical_root / body["png"]
        if not body_source.is_file():
            raise SystemExit(f"canonical body png missing: {body_source}")

        body_data = process_sprite(
            body_source,
            args.out_dir / f"{tree_id}.png",
            body["origin_x"],
            body["origin_y"],
        )

        shadow = slots.get(SHADOW_FORMAT)
        shadow_data = None
        shadow_name = None
        if shadow is not None:
            shadow_source = args.canonical_root / shadow["png"]
            if shadow_source.is_file():
                shadow_name = f"{tree_id}_shadow.png"
                shadow_data = process_sprite(
                    shadow_source,
                    args.out_dir / shadow_name,
                    shadow["origin_x"],
                    shadow["origin_y"],
                )

        trees.append(
            {
                "id": tree_id,
                "kind": "conifer" if genus in CONIFER_GENERA else "broadleaf",
                "body": f"{tree_id}.png",
                "w": body_data["w"],
                "h": body_data["h"],
                "tw": body_data["tw"],
                "th": body_data["th"],
                "ox": body_data["ox"],
                "oy": body_data["oy"],
                "shadow": shadow_name,
                "sw": shadow_data["w"] if shadow_data else None,
                "sh": shadow_data["h"] if shadow_data else None,
                "stw": shadow_data["tw"] if shadow_data else None,
                "sth": shadow_data["th"] if shadow_data else None,
                "sox": shadow_data["ox"] if shadow_data else None,
                "soy": shadow_data["oy"] if shadow_data else None,
            }
        )

    manifest_out = args.out_dir / "manifest.json"
    manifest_out.write_text(
        json.dumps({"source": "ps_sprites_canonical_v1", "trees": trees}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )

    conifers = sum(1 for t in trees if t["kind"] == "conifer")
    print(f"source {args.canonical_root}")
    print(f"trees {len(trees)} (conifer {conifers}, broadleaf {len(trees) - conifers})")
    print(f"skipped: short(<{MIN_BODY_HEIGHT}px) {skipped_short}, excluded genus {skipped_genus}")
    print(f"manifest {manifest_out}")


if __name__ == "__main__":
    main()
