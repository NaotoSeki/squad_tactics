# -*- coding: utf-8 -*-
"""
CBE 第2フィルタ調査: weapon ammo_indices 各スロットの参照先 category_code 分布。

仮説: PL UI は ammo_indices に列挙されていても、参照先が cat!=18 の行は
      「主装填弾」ではなく付属品スロット（銃剣・擲弾・三脚・弾薬箱等）。

出力:
  - data/pl_cbe_item_categories.js  (index → category_code)
  - docs/PL_SLOT_FILTER.md

再実行: python scripts/export_pl_cbe_slot_categories.py
"""
from __future__ import annotations

import json
import struct
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CBE_PATH = Path("D:/PL/CBE.EXE")
DECODED = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAMES = ROOT / "data" / "cbe_name_table.json"
OUT_JS = ROOT / "data" / "pl_cbe_item_categories.js"
OUT_MD = ROOT / "docs" / "PL_SLOT_FILTER.md"

TABLE_START = 0x1DDF00
STRIDE = 64

# cbe_finalize_decoded_json.py
CAT_NAMES = {
    1: "pistol", 2: "grenade_launcher_ammo", 3: "smoke_grenade", 4: "rifle",
    5: "lmg", 6: "smg", 7: "mmg", 8: "at_rifle", 9: "flamethrower",
    10: "rocket_launcher", 11: "panzerfaust", 12: "tripod", 13: "ammo_box",
    14: "binoculars", 15: "radio", 16: "medical", 17: "document", 18: "ammo",
    19: "rifle_grenade", 20: "hand_grenade", 21: "magnetic_mine", 22: "demolition",
    23: "smoke", 24: "bayonet_knife", 25: "mounted_weapon",
    26: "autocannon", 27: "gun", 28: "howitzer",
}

# 主装填判定: category 18 のみ（第2フィルタ正本）
LOADABLE_AMMO_CAT = 18

# 付属品として ammo_indices に載るが主装填から除外
AUX_SLOT_CATEGORIES = frozenset({
    12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25,
    2, 3,  # grenade launcher ammo types as items
})

# 武器行が ammo_indices に載せる「非弾薬」典型例（調査で確定）
KNOWN_AUX_INDICES = {
    314: "Messer (bayonet_knife)",
    33: "M3 Tripod",
    38: "Med Bag",
    9: "M1C Rifle (mounted?)",
}


def read_u16(rec_idx: int, u16_idx: int, cbe: bytes) -> int:
    off = TABLE_START + rec_idx * STRIDE + u16_idx * 2
    if off + 2 > len(cbe):
        return 0
    return struct.unpack_from("<H", cbe, off)[0]


def decode_cat(cbe: bytes, idx: int) -> int:
    return read_u16(idx, 1, cbe)


def main() -> None:
    if not CBE_PATH.exists():
        raise SystemExit(f"CBE not found: {CBE_PATH}")
    cbe = CBE_PATH.read_bytes()
    decoded = json.loads(DECODED.read_text(encoding="utf-8"))
    names = json.loads(NAMES.read_text(encoding="utf-8"))

    by_idx = {r["cbeNameIndex"]: r for r in decoded}
    categories: dict[str, dict] = {}

    for row in decoded:
        idx = int(row["cbeNameIndex"])
        cat = decode_cat(cbe, idx)
        categories[str(idx)] = {
            "cat": cat,
            "catName": CAT_NAMES.get(cat, f"unknown_{cat}"),
            "name": names.get(str(idx), row.get("name", "")),
        }

    # weapon slot analysis
    slot_ref_cats: Counter = Counter()
    aux_examples: list[tuple] = []
    loadable_examples: list[tuple] = []

    for row in decoded:
        wi = row["cbeNameIndex"]
        if row.get("category_code", 99) > 17:
            continue
        wname = row.get("name") or names.get(str(wi), "?")
        for slot_i, ref in enumerate(row.get("ammo_indices") or []):
            if not ref:
                continue
            info = categories.get(str(ref), {})
            cat = info.get("cat", decode_cat(cbe, ref))
            slot_ref_cats[cat] += 1
            nm = info.get("name") or names.get(str(ref), "?")
            entry = (wi, wname, slot_i, ref, cat, CAT_NAMES.get(cat, "?"), nm)
            if cat == LOADABLE_AMMO_CAT:
                if len(loadable_examples) < 15:
                    loadable_examples.append(entry)
            else:
                aux_examples.append(entry)

    # Write JS
    js_lines = [
        "/** 自動生成: python scripts/export_pl_cbe_slot_categories.py */",
        "(function () {",
        "    'use strict';",
        "    /** cbeNameIndex → { cat, catName, name } — CBE record u16[1] */",
        "    window.PL_CBE_ITEM_CATEGORIES = " + json.dumps(categories, ensure_ascii=False) + ";",
        f"    window.PL_CBE_LOADABLE_AMMO_CATEGORY = {LOADABLE_AMMO_CAT};",
        "    window.PL_CBE_AUX_SLOT_CATEGORIES = " + json.dumps(sorted(AUX_SLOT_CATEGORIES)) + ";",
        "})();",
        "",
    ]
    OUT_JS.write_text("\n".join(js_lines), encoding="utf-8")

    # Markdown report
    lines = [
        "# PL 第2フィルタ — スロット category 調査",
        "",
        "**生成**: `python scripts/export_pl_cbe_slot_categories.py`  ",
        "**第1フィルタ**: u27 形状（[PL_AMMO_UI_FILTER.md](./PL_AMMO_UI_FILTER.md)）  ",
        "**第2フィルタ**: 参照先 `category_code` — **18=ammo のみ主装填候補**",
        "",
        "---",
        "",
        "## 結論",
        "",
        "武器 `ammo_indices[4]` は **主弾候補 + 付属品** の混在リスト。",
        "PL UI は参照先レコードの **category_code==18（ammo）** だけを装填 UI に出す（仮説→データ支持）。",
        "",
        "| category | 名称 | スロット参照回数 | 扱い |",
        "|----------|------|------------------|------|",
    ]
    for cat, count in sorted(slot_ref_cats.items(), key=lambda x: -x[1]):
        role = "**主装填**" if cat == LOADABLE_AMMO_CAT else "付属品/非装填"
        lines.append(f"| {cat} | {CAT_NAMES.get(cat, '?')} | {count} | {role} |")

    lines += [
        "",
        "## 付属品スロット例（cat != 18）",
        "",
        "| 武器 | slot | ref | cat | 名称 |",
        "|------|------|-----|-----|------|",
    ]
    seen = set()
    for wi, wn, si, ref, cat, cn, nm in sorted(aux_examples, key=lambda x: (x[4], x[3])):
        key = (ref, cat)
        if key in seen:
            continue
        seen.add(key)
        lines.append(f"| {wn} | {si} | {ref} | {cn} | {nm} |")
        if len(seen) >= 40:
            break

    lines += [
        "",
        "## ST 実装",
        "",
        "```",
        "effectiveAccepts = ammo_indices",
        "  ∩ validAmmoIndex (PL_AMMO_DATA)",
        "  ∩ categoryFilter (cat==18)",
        "  ∩ magShapeFilter (u27)",
        "  ∩ overrides",
        "```",
        "",
        "データ: `data/pl_cbe_item_categories.js`",
        "実行: `pl_ammo_resolve.js` → `passesCategoryLoadFilter()`",
        "",
        "**ロールバック**: `FEATURE_PL_CATEGORY_FILTER = false`",
        "",
    ]

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")

    # weapon → 全スロット（付属品 UI 用）
    weapon_slots: dict[str, list] = {}
    for row in decoded:
        wi = row["cbeNameIndex"]
        if row.get("category_code", 99) > 17:
            continue
        slots = []
        for si, ref in enumerate(row.get("ammo_indices") or []):
            if not ref:
                continue
            info = categories.get(str(ref), {})
            slots.append({
                "slot": si,
                "ref": ref,
                "cat": info.get("cat", decode_cat(cbe, ref)),
                "catName": info.get("catName", "?"),
                "name": info.get("name", names.get(str(ref), "?")),
            })
        if slots:
            weapon_slots[str(wi)] = slots

    slots_js = ROOT / "data" / "pl_cbe_weapon_slots.js"
    slots_lines = [
        "/** 自動生成: python scripts/export_pl_cbe_slot_categories.py */",
        "(function () {",
        "    'use strict';",
        "    /** 武器 cbeNameIndex → ammo_indices 全スロット（主弾+付属） */",
        "    window.PL_CBE_WEAPON_SLOTS = " + json.dumps(weapon_slots, ensure_ascii=False) + ";",
        "})();",
        "",
    ]
    slots_js.write_text("\n".join(slots_lines), encoding="utf-8")
    print(f"Wrote {OUT_JS} ({len(categories)} items)")
    print(f"Wrote {OUT_MD}")
    print(f"Wrote {slots_js} ({len(weapon_slots)} weapons with slots)")
    print("Slot ref category counts:", dict(slot_ref_cats.most_common(12)))


if __name__ == "__main__":
    main()
