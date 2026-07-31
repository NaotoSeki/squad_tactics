#!/usr/bin/env python3
"""PS正本クロップ -> 本編用の戦場キャンバス(背景PNG + 30hex地形テーブル)。

入力は `scripts/ps_extract/render_ps_native_crop.py --projection isometric` が出す
`*_native.png` と `*_audit.json`。audit の placements は PS screen 空間の
アンカー座標 (screen_x, screen_y) と asset 名を持つので、これをゲームの hex 盤へ
射影し、family（`extract_ps_placement_grammar.family_for` と同一の分類器）から
各 hex の地形を決める。手描きの地形テーブルを置き換える。

スケール S は既存 Blender 背景の sx=0.3375 に合わせてある。これは
「PS 1px あたりのゲーム px」であり、盤面の1hexが PS の約277x320px
(= 家屋1軒＋庭) を覆う。既存 rural_v29 の1hex密度と一致するので、
地形テーブルの意味（1hex=1建物）が変わらない。

出力:
  asset/environment/maps/<name>.png    背景(PS原寸のまま。縮小はGPU側で行う)
  asset/environment/maps/<name>.json   投影パラメータ + 地形行 + 監査

使い方:
  python scripts/build_ps_battlefield.py \
    --audit scratch/ps_board_crops/..._audit.json \
    --name ps_village_north
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any

# extract_ps_placement_grammar は同ディレクトリの render_ps_native_crop を
# トップレベル名で import するので、ps_extract/ 自体を sys.path へ入れる。
sys.path.insert(0, str(Path(__file__).resolve().parent / "ps_extract"))
from extract_ps_placement_grammar import family_for  # noqa: E402

# --- ゲーム盤の定数(data.js / phaser_bridge.js Renderer.hexToPx と一致させること) ---
HEX_SIZE = 54
SQRT3 = math.sqrt(3.0)

# 30hex盤の行構成。logic_map_rural_v29.js `_locationRows` と同一。
BOARD_ROWS: list[tuple[int, int]] = [(7, 7), (8, 6), (9, 6), (10, 5), (11, 5), (12, 4)]
ROW_LEN = 5

# PS 1px あたりのゲーム px。既存 Blender 背景 sx=0.3375 と同値。
DEFAULT_SCALE = 0.3375

# 地形の優先順位（強い方が勝つ）。BLDG は cost 99 の不可侵。
TERRAIN_PRIORITY = ["BLDG", "FOREST", "ROAD", "FIELD", "RUIN", "GRASS"]


def hex_to_px(q: int, r: int) -> tuple[float, float]:
    """Renderer.hexToPx と同一。"""
    return HEX_SIZE * SQRT3 * (q + r / 2.0), HEX_SIZE * 1.5 * r


def px_to_hex(x: float, y: float) -> tuple[int, int]:
    """hex_to_px の逆。Renderer.roundHex と同じ cube 丸めを行う。"""
    rf = y / (HEX_SIZE * 1.5)
    qf = x / (HEX_SIZE * SQRT3) - rf / 2.0
    return round_hex(qf, rf)


def round_hex(qf: float, rf: float) -> tuple[int, int]:
    rq, rr = round(qf), round(rf)
    rs = round(-qf - rf)
    dq, dr, ds = abs(rq - qf), abs(rr - rf), abs(rs - (-qf - rf))
    if dq > dr and dq > ds:
        rq = -rr - rs
    elif dr > ds:
        rr = -rq - rs
    return rq, rr


def board_cells() -> list[tuple[int, int]]:
    return [(q0 + i, r) for r, q0 in BOARD_ROWS for i in range(ROW_LEN)]


def board_bbox() -> tuple[float, float, float, float]:
    """盤面のゲームpx範囲(hex中心の最小/最大)。"""
    xs, ys = zip(*(hex_to_px(q, r) for q, r in board_cells()))
    return min(xs), min(ys), max(xs), max(ys)


def neighbors(q: int, r: int) -> list[tuple[int, int]]:
    return [(q + 1, r), (q - 1, r), (q, r + 1), (q + 1, r - 1), (q - 1, r + 1), (q, r - 1)]


def classify_hex(families: Counter[str], forest_floor: int) -> str:
    """1hex分の配置内訳から地形を決める。

    建物アンカーがあれば無条件でBLDG(不可侵)。以降は「そのhexを支配している
    要素は何か」を配置数で判定する。閾値はPS正本の密度実測に合わせた
    (1hexが約277x320 PS px = 家屋1軒＋庭の広さである点に注意)。
    """
    if families.get("building", 0) > 0:
        return "BLDG"

    trees = families.get("tree", 0)
    shrubs = families.get("shrub", 0)
    # terrain_forest_* は林床の地表デコー。樹冠と併せて林と判定する。
    if trees >= 3 or (trees >= 1 and forest_floor >= 4) or forest_floor >= 8:
        return "FOREST"

    if families.get("field", 0) > 0:
        return "FIELD"
    if families.get("road", 0) >= 3:
        return "ROAD"
    # 低木が濃い区画は林扱い(遮蔽が効く)。単発の茂みは草地のまま。
    if trees >= 1 or shrubs >= 12:
        return "FOREST"
    # 道デコーが1個だけの hex は「道が通っている」とはみなさない。
    # (菜園の隅を道が掠めただけで ROAD 判定になり、花壇が街道になる事故を防ぐ)
    if families.get("road", 0) >= 2:
        return "ROAD"
    return "GRASS"


def check_connectivity(terrain: dict[tuple[int, int], str]) -> dict[str, Any]:
    """BLDG(cost99)で盤面が分断されていないか検査する。

    loc_church_square で実際に4hexが孤立した事故があるため、生成時に必ず通す。
    """
    passable = {c for c, t in terrain.items() if t != "BLDG"}
    if not passable:
        return {"ok": False, "reason": "no passable hex", "components": []}

    seen: set[tuple[int, int]] = set()
    components: list[list[tuple[int, int]]] = []
    for start in sorted(passable):
        if start in seen:
            continue
        comp, queue = [], deque([start])
        seen.add(start)
        while queue:
            cell = queue.popleft()
            comp.append(cell)
            for nb in neighbors(*cell):
                if nb in passable and nb not in seen:
                    seen.add(nb)
                    queue.append(nb)
        components.append(sorted(comp))

    return {
        "ok": len(components) == 1,
        "passable": len(passable),
        "component_sizes": sorted((len(c) for c in components), reverse=True),
        "isolated": [list(c) for c in components[1:]] if len(components) > 1 else [],
    }


TERRAIN_COLORS = {
    "BLDG": (255, 90, 90),
    "FOREST": (60, 220, 90),
    "ROAD": (240, 200, 80),
    "FIELD": (200, 130, 255),
    "RUIN": (255, 150, 60),
    "GRASS": (255, 255, 255),
}


def write_overlay(
    native_png: Path,
    out_path: Path,
    terrain: dict[tuple[int, int], str],
    top_left_x: float,
    top_left_y: float,
    scale: float,
) -> None:
    """導出した地形がPS画のどこに乗ったかを目視検収するための注釈画像。"""
    from PIL import Image, ImageDraw  # 遅延import: 検収時のみ必要

    base = Image.open(native_png).convert("RGBA")
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    def to_img(gx: float, gy: float) -> tuple[float, float]:
        return (gx - top_left_x) / scale, (gy - top_left_y) / scale

    for (q, r), kind in sorted(terrain.items()):
        cx, cy = hex_to_px(q, r)
        # pointy-top hex の6頂点(Renderer.hexToPx と同じ向き)
        pts = [
            to_img(
                cx + HEX_SIZE * math.sin(math.radians(60 * i)),
                cy - HEX_SIZE * math.cos(math.radians(60 * i)),
            )
            for i in range(6)
        ]
        color = TERRAIN_COLORS.get(kind, (255, 255, 255))
        draw.polygon(pts, fill=color + (48,), outline=color + (220,), width=2)
        ix, iy = to_img(cx, cy)
        draw.text((ix - 16, iy - 10), f"{kind}\n{q},{r}", fill=(0, 0, 0, 255))

    Image.alpha_composite(base, layer).convert("RGB").save(out_path, quality=92)


REGISTRY_NAME = "ps_battlefields.js"


def write_registry(out_dir: Path) -> Path:
    """maps/ 配下の ps_battlefield/v1 レコードを1本のJSレジストリへ焼き直す。

    ゲーム側の `RuralV29Map.generate()` は同期なので fetch を使えない。
    <script> で読める素のグローバルにしておく。
    """
    entries: dict[str, Any] = {}
    for path in sorted(out_dir.glob("*.json")):
        try:
            rec = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if rec.get("schema") != "ps_battlefield/v1":
            continue
        projection = rec["projection"]
        entry = {
            "name": rec["name"],
            "image": rec["image"],
            "imageWidth": rec["image_width"],
            "imageHeight": rec["image_height"],
            "projection": {
                "scale": projection["scale"],
                "topLeftX": projection["top_left_x"],
                "topLeftY": projection["top_left_y"],
            },
            "rows": rec["rows"],
        }
        # Optional physical/logical background pixel ratio. Keep imageWidth/
        # imageHeight in PS logical pixels so decals and object ledgers retain
        # their original projection.
        pixel_ratio = rec.get("pixel_ratio")
        if pixel_ratio is not None:
            if (
                isinstance(pixel_ratio, bool)
                or not isinstance(pixel_ratio, (int, float))
                or pixel_ratio <= 0
            ):
                raise ValueError(
                    f"{path}: pixel_ratio must be a positive number"
                )
            logical_width = rec.get("logical_image_width")
            logical_height = rec.get("logical_image_height")
            logical_scale = projection.get("logical_scale")
            if (
                not isinstance(logical_width, int)
                or isinstance(logical_width, bool)
                or logical_width <= 0
                or not isinstance(logical_height, int)
                or isinstance(logical_height, bool)
                or logical_height <= 0
                or not isinstance(logical_scale, (int, float))
                or isinstance(logical_scale, bool)
                or logical_scale <= 0
            ):
                raise ValueError(
                    f"{path}: pixel_ratio records require positive logical "
                    "image dimensions and projection.logical_scale"
                )
            # The Phaser renderer receives the canonical logical projection and
            # divides only the background texture scale by pixelRatio. Decals
            # and object ledgers therefore remain in the original 620px space.
            entry["imageWidth"] = logical_width
            entry["imageHeight"] = logical_height
            entry["projection"]["scale"] = logical_scale
            entry["pixelRatio"] = pixel_ratio
        entries[rec["name"]] = entry

    registry = out_dir / REGISTRY_NAME
    body = json.dumps(entries, ensure_ascii=False, indent=2)
    registry.write_text(
        "// GENERATED by scripts/build_ps_battlefield.py — 手で編集しない。\n"
        "// PS正本クロップから導出した戦場キャンバス(背景画像 + 30hex地形)。\n"
        f"window.PS_BATTLEFIELDS = {body};\n",
        encoding="utf-8",
    )
    return registry


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--name", required=True, help="出力アセット名 (拡張子なし)")
    parser.add_argument("--scale", type=float, default=DEFAULT_SCALE)
    parser.add_argument(
        "--out-dir", type=Path, default=Path("asset/environment/maps")
    )
    parser.add_argument(
        "--overlay", type=Path, help="地形注釈画像の出力先(目視検収用)"
    )
    args = parser.parse_args()

    audit = json.loads(args.audit.read_text(encoding="utf-8"))
    crop = audit["crop"]
    if crop.get("coordinate_space") != "isometric":
        raise SystemExit(
            "audit must come from --projection isometric "
            f"(got {crop.get('coordinate_space')!r})"
        )

    native_png = args.audit.parent / audit["outputs"]["native"]
    if not native_png.is_file():
        raise SystemExit(f"native render not found: {native_png}")

    img_w, img_h = int(crop["width"]), int(crop["height"])
    scale = float(args.scale)

    # 盤面の中心を画像の中心へ合わせる。これで投影が一意に決まる。
    min_x, min_y, max_x, max_y = board_bbox()
    board_cx, board_cy = (min_x + max_x) / 2.0, (min_y + max_y) / 2.0
    top_left_x = board_cx - (img_w / 2.0) * scale
    top_left_y = board_cy - (img_h / 2.0) * scale

    # 盤面が画像内に収まるか検査(hexの外接半径分の余白を要求)
    pad_x, pad_y = HEX_SIZE * SQRT3 / 2.0, HEX_SIZE
    need_w = (max_x - min_x + 2 * pad_x) / scale
    need_h = (max_y - min_y + 2 * pad_y) / scale
    coverage_ok = img_w >= need_w and img_h >= need_h

    cells = board_cells()
    on_board = set(cells)
    per_hex: dict[tuple[int, int], Counter[str]] = defaultdict(Counter)
    forest_floor: Counter[tuple[int, int]] = Counter()
    off_board = 0

    for item in audit["placements"]:
        asset = item.get("asset") or ""
        family = family_for(asset, int(item.get("catalog", 0)), item.get("source", ""))
        # audit の screen_x/y は PS screen 空間の絶対座標。crop 左上を引いて画像px化。
        img_x = float(item["screen_x"]) - float(crop["x"])
        img_y = float(item["screen_y"]) - float(crop["y"])
        cell = px_to_hex(top_left_x + img_x * scale, top_left_y + img_y * scale)
        if cell not in on_board:
            off_board += 1
            continue
        per_hex[cell][family] += 1
        if asset.casefold().startswith("terrain_forest"):
            forest_floor[cell] += 1

    terrain = {
        cell: classify_hex(per_hex.get(cell, Counter()), forest_floor.get(cell, 0))
        for cell in cells
    }

    connectivity = check_connectivity(terrain)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    out_png = args.out_dir / f"{args.name}.png"
    shutil.copyfile(native_png, out_png)

    rows = [
        [r, q0, [terrain[(q0 + i, r)] for i in range(ROW_LEN)]]
        for r, q0 in BOARD_ROWS
    ]

    record = {
        "schema": "ps_battlefield/v1",
        "name": args.name,
        "image": out_png.name,
        "image_width": img_w,
        "image_height": img_h,
        # JS 側(phaser_terrain_rural_v29.js の psNative 分岐)がそのまま使う投影値。
        "projection": {
            "scale": scale,
            "top_left_x": top_left_x,
            "top_left_y": top_left_y,
            "note": "game_px = top_left + image_px * scale (等方。PS 2:1等角のまま歪ませない)",
        },
        "source": {
            "psm": audit.get("source"),
            "crop": crop,
            "placements_audited": audit["counts"]["placements_audited"],
            "missing_instances": audit["counts"]["missing_instances"],
        },
        "rows": rows,
        "audit": {
            "coverage_ok": coverage_ok,
            "required_image_px": [round(need_w), round(need_h)],
            "placements_on_board": sum(sum(c.values()) for c in per_hex.values()),
            "placements_off_board": off_board,
            "terrain_counts": dict(Counter(terrain.values()).most_common()),
            "connectivity": connectivity,
            "per_hex_families": {
                f"{q},{r}": dict(per_hex[(q, r)].most_common())
                for q, r in cells
                if per_hex.get((q, r))
            },
        },
    }

    out_json = args.out_dir / f"{args.name}.json"
    out_json.write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    write_registry(args.out_dir)

    if args.overlay:
        args.overlay.parent.mkdir(parents=True, exist_ok=True)
        write_overlay(
            native_png, args.overlay, terrain, top_left_x, top_left_y, scale
        )
        print(f"overlay {args.overlay}")

    print(f"png  {out_png} ({img_w}x{img_h})")
    print(f"json {out_json}")
    print(f"scale {scale}  top_left ({top_left_x:.1f}, {top_left_y:.1f})")
    print(f"coverage_ok={coverage_ok} required={round(need_w)}x{round(need_h)}")
    print(f"terrain {record['audit']['terrain_counts']}")
    print(
        f"connectivity ok={connectivity['ok']} "
        f"components={connectivity.get('component_sizes')}"
    )
    for r, q0, bases in rows:
        print(f"  r={r:<3} q0={q0}  {bases}")


if __name__ == "__main__":
    main()
