#!/usr/bin/env python3
"""DEPRECATED (2026-07-25): 本編の木は scripts/build_trees_ps_canonical.py で作る。

差分blit抽出(scripts/ps_extract/extract_trees_v3.py)を入力にしていたが、
straight色 = S/cov の除算が低カバレッジ画素のノイズを増幅し、1px市松ディザが
コントラスト付きで焼き付く。オーナー指摘「木が塩コショウ」の実体はこれ。

実測(全81種、樹冠の水平方向 |Δ| 平均):
  差分blit(このスクリプトの出力)     42.37
  正本スロット抽出(canonical_v1)     17.75

PS実機の描画も正本スロットと同じデータを見ているため、正本側が正しい。
origin もサイズも両者一致しているので、下流(manifest/VegetationLayer)は無変更で
入れ替わる。このスクリプトは経緯の参照用に残すだけで、実行してはいけない。

--- 以下、旧説明 ---
Build padded, game-ready tree sprites and manifest from extracted PS sprites.

Pipeline: differential-blit extraction (scripts/ps_extract/extract_trees_v3.py)
-> this builder (POT pad + anchor-origin fractions + manifest). Replaces the old
pot_pad_trees.py + unpremultiply_trees.py chain (v3 sprites are true straight
color + true coverage, so standard alpha blending is already exact).
Generated via GPT-5.6 lane, reviewed. See memory: ps-render-pipeline.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageFilter


# The source .ssc art is 8bpp palette-indexed with a 1px checkerboard dither.
# Bilinear MAGNIFICATION (which is what our camera zoom does) cannot melt a 1px
# dither — proven empirically: a reconstruction filter needs >=2px source support.
# PS's own presentation path (CPU pixel buffer -> GPU texture) effectively applies
# that lowpass, so the texture PS displays is already de-dithered relative to its
# on-screen size. We reproduce that by de-dithering here at authoring resolution
# (a small gaussian in PREMULTIPLIED space so edges stay clean), then the GPU
# scales the smooth result. sigma≈0.7 melts the checkerboard while preserving the
# macro leaf/branch structure (sigma>=1.0 over-blurs into a "moss blob").
# See memory: ps-render-pipeline.
DEDITHER_SIGMA = 0.7


def dedither(image: Image.Image) -> Image.Image:
    """Melt the 1px palette dither via a small premultiplied-space gaussian."""
    a = np.asarray(image.convert("RGBA")).astype(np.float32)
    alpha = a[..., 3:4] / 255.0
    premult = np.concatenate([a[..., :3] * alpha, a[..., 3:4]], axis=-1)
    blurred = np.asarray(
        Image.fromarray(np.clip(premult, 0, 255).astype(np.uint8), "RGBA").filter(
            ImageFilter.GaussianBlur(DEDITHER_SIGMA)
        )
    ).astype(np.float32)
    safe_alpha = np.clip(blurred[..., 3:4], 1e-3, 255.0)
    straight = np.clip(blurred[..., :3] * 255.0 / safe_alpha, 0, 255)
    out = np.concatenate([straight, blurred[..., 3:4]], axis=-1).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


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

# Species whose palettes read as fluorescent/exotic against the WW2 European
# ground set — excluded from the game roster (still extracted in ps_trees_v3).
EXCLUDE_GENERA = {"podocarpus", "sciadopitys", "heteromeles"}


def next_pow2(value: int) -> int:
    """Return the smallest power of two greater than or equal to value."""
    if value < 1:
        raise ValueError(f"Invalid image dimension: {value}")
    return 1 << (value - 1).bit_length()


def process_sprite(
    source_path: Path,
    output_path: Path,
    metadata: dict[str, Any],
) -> dict[str, float | int]:
    """Pad a sprite to a centered power-of-two RGBA canvas and save it."""
    with Image.open(source_path) as image:
        # No pre-filtering: keep the raw dithered art. The GPU's hardware texture
        # filtering (mipmap/trilinear, as PS's config device:hardware/direct3d9)
        # melts the 1px dither on minification — reproduce that, don't fake it.
        rgba = image.convert("RGBA")
        w, h = rgba.size

        tw = next_pow2(w)
        th = next_pow2(h)
        padx = (tw - w) // 2
        pady = (th - h) // 2

        canvas = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
        canvas.paste(rgba, (padx, pady))
        canvas.save(output_path, format="PNG", optimize=True)

    anchor_x = -float(metadata["origin_x"]) + padx
    anchor_y = -float(metadata["origin_y"]) + pady

    return {
        "w": w,
        "h": h,
        "tw": tw,
        "th": th,
        "ox": anchor_x / tw,
        "oy": anchor_y / th,
    }


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    source_dir = repo_root / "scratch" / "ps_trees_v3"
    output_dir = repo_root / "asset" / "environment" / "trees_ps"
    catalog_path = source_dir / "catalog_v3.json"

    with catalog_path.open("r", encoding="utf-8") as file:
        catalog = json.load(file)

    if not isinstance(catalog, list):
        raise ValueError(f"Catalog must be a JSON list: {catalog_path}")

    by_name: dict[str, dict[str, Any]] = {}
    body_entries: list[dict[str, Any]] = []

    for entry in catalog:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        if not isinstance(name, str):
            continue

        by_name[name] = entry
        if entry.get("kind") == "body":
            body_entries.append(entry)

    output_dir.mkdir(parents=True, exist_ok=True)

    for path in output_dir.glob("*.png"):
        if path.is_file():
            path.unlink()

    unpremultiplied_marker = output_dir / ".unpremultiplied"
    if unpremultiplied_marker.is_file():
        unpremultiplied_marker.unlink()

    trees: list[dict[str, Any]] = []
    conifer_count = 0
    broadleaf_count = 0

    for body_entry in body_entries:
        body_name = body_entry["name"]
        body_source = source_dir / body_name

        if int(body_entry.get("h", 0)) < 110 or not body_source.is_file():
            continue

        if not body_name.lower().endswith(".png"):
            raise ValueError(f"Body catalog name is not a PNG filename: {body_name}")

        tree_id = Path(body_name).stem
        genus = tree_id.split("-", 1)[0].lower()
        if genus in EXCLUDE_GENERA:
            continue
        tree_kind = "conifer" if genus in CONIFER_GENERA else "broadleaf"

        body_output = output_dir / f"{tree_id}.png"
        body_data = process_sprite(body_source, body_output, body_entry)

        shadow_name = f"{tree_id}_shadow.png"
        shadow_source = source_dir / shadow_name
        shadow_entry = by_name.get(shadow_name)

        if shadow_source.is_file():
            if shadow_entry is None:
                raise ValueError(
                    f"Shadow PNG exists but has no catalog entry: {shadow_source}"
                )
            if shadow_entry.get("kind") != "shadow":
                raise ValueError(
                    f"Catalog entry for shadow has wrong kind: {shadow_name}"
                )

            shadow_output = output_dir / shadow_name
            shadow_data = process_sprite(shadow_source, shadow_output, shadow_entry)
            shadow_value: str | None = shadow_name
        else:
            shadow_data = None
            shadow_value = None

        tree_record: dict[str, Any] = {
            "id": tree_id,
            "kind": tree_kind,
            "body": f"{tree_id}.png",
            "w": body_data["w"],
            "h": body_data["h"],
            "tw": body_data["tw"],
            "th": body_data["th"],
            "ox": body_data["ox"],
            "oy": body_data["oy"],
            "shadow": shadow_value,
            "sw": shadow_data["w"] if shadow_data else None,
            "sh": shadow_data["h"] if shadow_data else None,
            "stw": shadow_data["tw"] if shadow_data else None,
            "sth": shadow_data["th"] if shadow_data else None,
            "sox": shadow_data["ox"] if shadow_data else None,
            "soy": shadow_data["oy"] if shadow_data else None,
        }
        trees.append(tree_record)

        if tree_kind == "conifer":
            conifer_count += 1
        else:
            broadleaf_count += 1

        shadow_status = "shadow=yes" if shadow_data else "shadow=no"
        print(
            f"{tree_id} {tree_kind} "
            f"{body_data['w']}x{body_data['h']}->"
            f"{body_data['tw']}x{body_data['th']} "
            f"{shadow_status}"
        )

    manifest_path = output_dir / "manifest.json"
    with manifest_path.open("w", encoding="utf-8") as file:
        json.dump({"trees": trees}, file, ensure_ascii=False, indent=2)
        file.write("\n")

    print(
        f"Total trees: {len(trees)} "
        f"(conifer: {conifer_count}, broadleaf: {broadleaf_count})"
    )


if __name__ == "__main__":
    main()
