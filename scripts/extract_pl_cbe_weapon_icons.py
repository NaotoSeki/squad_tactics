# -*- coding: utf-8 -*-
"""
Platoon Leader 本体外付け (PL_DIR) の NE モジュールから武器/装備用 RT_BITMAP を抽出し、
CBE 名チェーン行 index（0..CBE_CHAIN_LEN-1）に対応する asset/pl_weapons/cbe_NNN.png を生成する。

前提:
  - **既定 (PL_CBE_CELLS 未設定):** `asset/pl_weapons/_previews/` に INTERMIS 主要 RT_BITMAP
    全図（GUNIW / ITEM_01 / ILIST 等）を保存。484 等分は **セル 18x11 級**になり武器表現に不適のため
    cbe_NNN.png は**生成しない**。
  - **實験的スライス:** `set PL_CBE_CELLS=1` のときだけ PL_ATLAS_* で cbe_000.. 出力（非推奨。探索用）。

  set PL_DIR=D:\\PL
  python scripts\\extract_pl_cbe_weapon_icons.py
  （スライスする場合） set PL_CBE_CELLS=1
"""
from __future__ import annotations

import io
import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from extract_ne_resources import build_bmp_file, parse_ne_resources  # noqa: E402

try:
    from PIL import Image
except ImportError:
    print("ERROR: pip install Pillow")
    sys.exit(1)

ASSET_OUT = ROOT / "asset" / "pl_weapons"
MANIFEST_PY = ROOT / "scripts" / "build_pl_weapon_icon_manifest.py"
PL_JSON = ROOT / "scripts" / "pl_decoded" / "pl_item_compatibility.json"
DEBUG_JSON = ROOT / "scripts" / "pl_decoded" / "pl_weapon_icon_extraction.json"

# 武器アイコン候補としてありがちな範囲（外れ値を捨てる）
MIN_W, MAX_W = 8, 220
MIN_H, MAX_H = 8, 220

TARGET_DLLS = [
    "ITEML.DLL",
    "ITEMS.DLL",
    "INTERMIS.DLL",
]

# フル解像度で人間が目視する用（1 枚に 484 セル詰め込むと 18x11 級→武器絵向きでない）
INTERMIS_PREVIEW_ATLASES: tuple[str, ...] = (
    "IDB_GUNIW_10",
    "IDB_GUNIW_01",
    "IDB_ITEM_01",
    "IDB_ILIST_00",
    "IDB_ITEM_04",
    "IDB_NISHI_10",
    "IDB_KIROKW_0",
)


def _pl_cbe_slice_enabled() -> bool:
    return os.environ.get("PL_CBE_CELLS", "0").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def load_chain_len() -> int:
    env = os.environ.get("PL_CBE_CHAIN_LEN")
    if env and env.isdigit():
        return int(env)
    doc = json.loads(PL_JSON.read_text(encoding="utf-8"))
    return int(doc["weapon_name_tables"]["cbe_us_m1911a1_chain"]["count"])


def dib_to_image(dib_data: bytes) -> Image.Image | None:
    bmp = build_bmp_file(dib_data)
    if not bmp:
        return None
    try:
        return Image.open(io.BytesIO(bmp)).convert("RGBA")
    except Exception:
        return None


def get_rt_bitmap_by_name(parsed: dict, res_name: str) -> Image.Image | None:
    data = parsed["data"]
    for rtype in parsed.get("resource_types", []):
        if rtype.get("type_id") != 0x8002:
            continue
        for entry in rtype.get("entries", []):
            if str(entry.get("name", "")) != res_name:
                continue
            offset = entry.get("offset", 0)
            length = entry.get("length", 0)
            if offset + length > len(data) or length < 40:
                return None
            return dib_to_image(data[offset : offset + length])
    return None


def slice_atlas_row_major(
    im: Image.Image, cols: int, rows: int, max_cells: int
) -> list[Image.Image]:
    """
    行優先。アトラス寸法を等分（比例境界）。H÷行数が割り切れないときも各行がズレないよう
    (i*L)//n .. ((i+1)*L)//n で区切る。
    """
    w, h = im.size
    if cols < 1 or rows < 1:
        return []
    out: list[Image.Image] = []
    for r in range(rows):
        for c in range(cols):
            if len(out) >= max_cells:
                return out
            x0 = (c * w) // cols
            x1 = ((c + 1) * w) // cols
            y0 = (r * h) // rows
            y1 = ((r + 1) * h) // rows
            if x1 <= x0 or y1 <= y0:
                continue
            out.append(im.crop((x0, y0, x1, y1)).copy())
    return out


def extract_all_bitmaps(parsed: dict, source: str) -> list[dict]:
    """各 RT_BITMAP を {sort_name, id_num?, w, h, pil, source} で返す（数値名・IDB_ 文字名の両方）。"""
    data = parsed["data"]
    out: list[dict] = []
    for rtype in parsed.get("resource_types", []):
        if rtype.get("type_id") != 0x8002:
            continue
        for entry in rtype.get("entries", []):
            name = str(entry.get("name", ""))
            offset = entry.get("offset", 0)
            length = entry.get("length", 0)
            if offset + length > len(data) or length < 40:
                continue
            dib = data[offset : offset + length]
            im = dib_to_image(dib)
            if im is None:
                continue
            w, h = im.size
            if not (MIN_W <= w <= MAX_W and MIN_H <= h <= MAX_H):
                continue
            id_num = int(name) if name.isdigit() else None
            out.append(
                {
                    "sort_name": name,
                    "id_num": id_num,
                    "w": w,
                    "h": h,
                    "pil": im,
                    "source": source,
                }
            )
    return out


def pick_size_filter(items: list[dict], env_filter: str | None) -> tuple[int, int] | None:
    if env_filter and "x" in env_filter.lower():
        try:
            a, b = env_filter.lower().split("x", 1)
            return (int(a.strip()), int(b.strip()))
        except ValueError:
            pass
    cnt = Counter((x["w"], x["h"]) for x in items)
    if not cnt:
        return None
    return cnt.most_common(1)[0][0]


def find_pl_dir() -> Path | None:
    for k in ("PL_DIR", "PL_ROOT"):
        v = os.environ.get(k)
        if v:
            p = Path(v)
            if p.is_dir():
                return p
    for p in (Path("D:/PL"), Path("C:/PL"), ROOT / "vendor" / "pl"):
        if p.is_dir():
            return p
    return None


def _run_manifest() -> None:
    os.chdir(ROOT)
    import importlib.util

    spec = importlib.util.spec_from_file_location("m", MANIFEST_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.main()


def main() -> int:
    chain_len = load_chain_len()
    pl_dir = find_pl_dir()
    start_id = int(os.environ.get("PL_ICON_START_ID", "0"))
    size_env = os.environ.get("PL_ICON_SIZE_FILTER") or None
    atlas_name = os.environ.get("PL_ATLAS_NAME", "IDB_ITEM_01")
    try:
        atlas_cols = int(os.environ.get("PL_ATLAS_COLS", "22"))
        atlas_rows = int(os.environ.get("PL_ATLAS_ROWS", "22"))
    except ValueError:
        atlas_cols, atlas_rows = 22, 22

    result: dict = {
        "_meta": {
            "cbeNameChainLen": chain_len,
            "plDir": str(pl_dir) if pl_dir else None,
        },
        "sources": {},
        "assigned": 0,
        "outputDir": str(ASSET_OUT),
    }

    if not pl_dir:
        result["_meta"]["error"] = "PL_DIR 未設定または D:/PL 等が見つかりません。PL インストール先を指定してください。"
        DEBUG_JSON.parent.mkdir(parents=True, exist_ok=True)
        DEBUG_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(result["_meta"]["error"])
        return 1

    intermis = pl_dir / "INTERMIS.DLL"
    if intermis.is_file():
        p_intermis = parse_ne_resources(str(intermis))
        result["sources"]["INTERMIS.DLL"] = {
            "error": p_intermis.get("error"),
            "align_shift": p_intermis.get("align_shift"),
        }
        if not p_intermis.get("error"):
            prev_dir = ASSET_OUT / "_previews"
            prev_dir.mkdir(parents=True, exist_ok=True)
            approx_cells: dict[str, dict] = {}
            for pn in INTERMIS_PREVIEW_ATLASES:
                pim = get_rt_bitmap_by_name(p_intermis, pn)
                if pim is None:
                    continue
                pim.save(prev_dir / f"{pn}.png", "PNG")
                iw, ih = pim.size
                approx_cells[pn] = {
                    "bitmap": [iw, ih],
                    "cell_floor_22x22": [iw // 22, ih // 22],
                    "cell_floor_31x16": [iw // 31, ih // 16],
                }
            result["_meta"]["atlasPreviews"] = str(prev_dir)
            result["_meta"]["approxCellIfGrid"] = approx_cells
            if not _pl_cbe_slice_enabled():
                result["_meta"]["strategy"] = "previews_only (no cbe_*.png)"
                result["_meta"]["note"] = (
                    "484 件を1枚に等分セル化すると 408x242/22/22 等で 18x11 前後/セルに"
                    "なり、横長の武器シルエットとして不適。全アトラスは _previews/ に全図を保存した。"
                    " 実験的に cbe_000.. を出すときは PL_CBE_CELLS=1。CBE 行と画素の対応は要バイナリ表。"
                )
                result["assigned"] = 0
                DEBUG_JSON.write_text(
                    json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                print("Wrote atlas previews in", prev_dir, "- no cbe_*.png (set PL_CBE_CELLS=1 to slice).", DEBUG_JSON)
                _run_manifest()
                return 0
            ilist = get_rt_bitmap_by_name(p_intermis, atlas_name)
            if ilist is not None:
                iw, ih = ilist.size
                cells = slice_atlas_row_major(ilist, atlas_cols, atlas_rows, chain_len)
                result["_meta"]["strategy"] = f"atlas:{atlas_name} grid {atlas_cols}x{atlas_rows} bitmap {iw}x{ih}"
                result["_meta"]["warning_tiny_cell"] = (
                    f"セル目安(床割り) {iw // atlas_cols}x{ih // atlas_rows} px ― 武器絵向きでない可能性"
                )
                if len(cells) < chain_len:
                    result["_meta"]["warning"] = (
                        f"アトラスから {len(cells)} セルしか得られず（要 {chain_len}）。"
                        " PL_ATLAS_COLS/ROWS を調整してください。"
                    )
                take_imgs = cells[:chain_len]
                ASSET_OUT.mkdir(parents=True, exist_ok=True)
                for slot, im in enumerate(take_imgs):
                    im.save(ASSET_OUT / f"cbe_{slot:03d}.png", "PNG")
                result["assigned"] = len(take_imgs)
                DEBUG_JSON.write_text(
                    json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                print("Wrote", ASSET_OUT, "files", len(take_imgs), "via", atlas_name, "debug", DEBUG_JSON)
                _run_manifest()
                return 0

    # ── フォールバック: 小型 RT_BITMAP 列（INTERMIS ITEML 等） ──
    all_items: list[dict] = []
    for dll in TARGET_DLLS:
        path = pl_dir / dll
        if not path.is_file():
            result["sources"][dll] = {"error": "not found"}
            continue
        parsed = parse_ne_resources(str(path))
        if parsed.get("error"):
            result["sources"][dll] = {"error": parsed["error"]}
            continue
        al = int(parsed.get("align_shift") or 0)
        if al > 32 and dll.upper().startswith("ITEM"):
            result["sources"][dll]["skipped"] = f"unreliable align_shift={al}"
            continue
        items = extract_all_bitmaps(parsed, dll)
        result["sources"].setdefault(dll, {})["bitmap_count"] = len(items)
        result["sources"][dll]["names_sample"] = [x["sort_name"] for x in items[:12]]
        all_items.extend(items)

    if not all_items:
        result["_meta"]["error"] = "フォールバック: RT_BITMAP が取得できませんでした。INTERMIS に IDB_ILIST_00 があるか確認してください。"
        DEBUG_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(result["_meta"]["error"])
        return 1

    priority = {"ITEML.DLL": 0, "ITEMS.DLL": 1, "INTERMIS.DLL": 2}
    seen_key: dict[tuple[str, str], dict] = {}
    for it in sorted(all_items, key=lambda x: (priority.get(x["source"], 9), x["sort_name"])):
        k = (it["source"], it["sort_name"])
        if k not in seen_key:
            seen_key[k] = it
    uniq = list(seen_key.values())
    uniq.sort(
        key=lambda x: (
            0 if x["id_num"] is not None else 1,
            x["id_num"] if x["id_num"] is not None else 0,
            x["sort_name"].lower(),
            priority.get(x["source"], 9),
        )
    )
    if start_id > 0:
        uniq = [x for x in uniq if (x["id_num"] is not None and x["id_num"] >= start_id)]

    wh = pick_size_filter(uniq, size_env)
    filtered: list[dict] = []
    if wh is not None:
        fw, fh = wh
        filtered = [x for x in uniq if x["w"] == fw and x["h"] == fh]
        result["_meta"]["chosenSize"] = f"{fw}x{fh}"
    if not filtered:
        result["_meta"]["chosenSize"] = "mixed"
        filtered = uniq
    result["_meta"]["afterSizeFilter"] = len(filtered)
    result["_meta"]["strategy"] = "fallback_small_bitmaps"
    if len(filtered) < chain_len:
        result["_meta"]["warning"] = (
            f"利用可能 {len(filtered)} 件／目標 {chain_len}。アトラス経路（IDB_ILIST_00）を推奨。"
        )
    take = filtered[:chain_len]
    ASSET_OUT.mkdir(parents=True, exist_ok=True)
    for slot, it in enumerate(take):
        it["pil"].save(ASSET_OUT / f"cbe_{slot:03d}.png", "PNG")
    result["assigned"] = len(take)
    DEBUG_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Wrote", ASSET_OUT, "files", len(take), "fallback debug", DEBUG_JSON)
    _run_manifest()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
