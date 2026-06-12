# -*- coding: utf-8 -*-
"""
PL 補助装備の組み合わせ調査: 銃剣・擲弾・MG弾薬箱・三脚等。

CBE wpns_pl_stats_decoded.json の category_code / ammo_indices を走査。
出力: docs/PL_AUX_EQUIPMENT.md

再実行: python scripts/probe_pl_aux_combos.py
"""
from __future__ import annotations

import json
import struct
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECODED = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAMES = ROOT / "data" / "cbe_name_table.json"
CBE_PATH = Path(r"D:\PL\CBE.EXE")
OUT = ROOT / "docs" / "PL_AUX_EQUIPMENT.md"

# cbe_finalize_decoded_json.py category_code
CAT = {
    13: "ammo_box",
    19: "rifle_grenade",
    24: "bayonet_knife",
    17: "smg",
    16: "lmg",
    15: "hmg",
    14: "auto_rifle",
    12: "carbine",
    11: "rifle",
    10: "sniper",
    18: "ammo",
}

BAYONET_NAMES = ("Messer", "S84", "bayonet", "Seitengewehr", "SGew")
GRB_NAMES = ("GrB", "RfG", "Rifle Gren", "Gewehrgranat")
TRIPOD = ("Tripod", "tripod", "Lafette", "lafette")
AMMOBOX = ("Ammobox", "Ammo Box", "Ammbox", "M2A1", "M19", "PatrK", "Gurt")


def name(names: dict, idx: int) -> str:
    return names.get(str(idx), f"?{idx}")


def is_bayonet_item(n: str) -> bool:
    u = n.upper()
    return any(x.upper() in u for x in BAYONET_NAMES)


def main() -> None:
    decoded = json.loads(DECODED.read_text(encoding="utf-8"))
    names = json.loads(NAMES.read_text(encoding="utf-8"))
    by_idx = {r["cbeNameIndex"]: r for r in decoded}

    field34_to_weapon: dict[int, list[int]] = defaultdict(list)
    if CBE_PATH.is_file():
        cbe = CBE_PATH.read_bytes()
        for r in decoded:
            wi = r["cbeNameIndex"]
            off = 0x1DDF00 + wi * 64
            if off + 54 > len(cbe):
                continue
            u26 = struct.unpack_from("<H", cbe, off + 52)[0]
            if u26:
                field34_to_weapon[u26].append(wi)

    lines = [
        "# PL 補助装備・固有組み合わせ — 調査メモ",
        "",
        "**生成**: `python scripts/probe_pl_aux_combos.py`  ",
        "**前提**: CBE `ammo_indices[4]` + category_code。UI フィルタは [PL_AMMO_UI_FILTER.md](./PL_AMMO_UI_FILTER.md) 参照。",
        "",
        "---",
        "",
        "## 1. 銃剣 / 白兵（Messer 等）",
        "",
        "Kar98 系の `ammo_indices` 第4スロットに **314=Messer** が入る例（主弾ではなく付属品スロット）。",
        "",
        "| 武器 idx | 武器名 | ammo_indices | 備考 |",
        "|----------|--------|--------------|------|",
    ]

    bayonet_weapons = []
    for r in decoded:
        if r.get("category_code", 99) > 17:
            continue
        slots = r.get("ammo_indices") or []
        aux = [s for s in slots if is_bayonet_item(name(names, s))]
        if aux:
            bayonet_weapons.append(r)
            slot_str = ", ".join(f"{s}={name(names, s)}" for s in slots)
            lines.append(f"| {r['cbeNameIndex']} | {r['name']} | {slot_str} | 銃剣/白兵スロット |")

    if not bayonet_weapons:
        lines.append("| — | — | — | — |")

    lines += [
        "",
        "### PL 白兵システム（プレイ記憶・要実機再確認）",
        "",
        "- 所持品のうち **白兵攻撃力（melee_attack）最大** の装備が白兵時に採用される（**Win98 実機未確認** — CBE RE が正本）。",
        "- **銃剣加算はその銃に適合した銃剣のみ**。別の銃用銃剣を所持していても、現在の銃の白兵に加算されない。",
        "- 適合時は **銃本体 melee + 適合銃剣行 melee**。CBE: 小銃 `melee_attack=5`、Messer/S84/92 行 `melee_attack=4`（cat=24）。",
        "",
        "**Messer vs S84/98**: 史実の Gew98/Kar98 銃剣は **S84/98**。CBE では Kar98 系スロットに **314=Messer**（汎用ナイフ行）。",
        "**313=S84/92** は cat=24 で存在するが、Kar98 `ammo_indices` には **未リンク**（銃剣は別経路 or 未実装の可能性）。",
        "",
        "**フィルタ**: cat=24 は主装填 UI から除外（`@ 0x771E` cat18 分岐）。`ammo_indices` 第4スロット＝付属品候補リスト。",
        "",
        "**ST 方針（案）**: Messer / 銃剣は `acceptsAmmo` から除外し、白兵・付属スロットとして扱う。",
        "",
        "---",
        "",
        "## 2. 擲弾器 / ライフルグレネード（GrB39, M9A1 RfG 等）",
        "",
        "| 武器 idx | 武器名 | category | ammo_indices |",
        "|----------|--------|----------|--------------|",
    ]

    for r in decoded:
        n = r.get("name") or ""
        cat = r.get("category_code")
        if cat == 19 or any(x in n for x in GRB_NAMES):
            slots = r.get("ammo_indices") or []
            slot_str = ", ".join(f"{s}={name(names, s)}" for s in slots if s)
            cat_l = CAT.get(cat, str(cat))
            lines.append(f"| {r['cbeNameIndex']} | {n} | {cat_l} | {slot_str or '—'} |")

    lines += [
        "",
        "### ライフル擲弾 — M9A1 RfG / Mk2 GPA",
        "",
        "**M9A1 RfG** = 米軍 **ライフルグレネード**（[M9 rifle grenade — Wikipedia](https://en.wikipedia.org/wiki/M9_rifle_grenade)）。M1 ガランド + M7 擲弾発射器系。**バズーカとは別物**。",
        "",
        "| PL 行 | 推定役割 | CBE |",
        "|------|----------|-----|",
        "| **245 Mk2 GPA** | 擲弾発射器/アダプタ（ホスト銃側） | M1903A1, M1 Rifle, M1/M1A1/M2 Cbn の武器スロット |",
        "| **244 M9A1 RfG** | ライフルグレネード弾体 | M9 RL スロットにも載るが **ロケット正本ではない** |",
        "| M1C Rifle / M1903A4 | スコープ付 | 擲弾スロットなし |",
        "",
        "ユーザー想定の「M9A1 対応銃」は **Mk2 GPA + M9A1 RfG の二行分割**（ライフルグレネード系）。",
        "",
        "### M9 RL（バズーカ）— ロケット弾",
        "",
        "| idx | 名称 | CBE |",
        "|-----|------|-----|",
        "| 27 M9 RL | 武器スロット | **244 M9A1 RfG, 243 M6A5 HR** — 244 は異常候補 |",
        "| 242 M6A1 HR | ロケット弾 | 242 行が M9 RL(27) を逆リンク |",
        "| 243 M6A5 HR | ロケット弾 | M1/M1A1 RL, M9 RL |",
        "",
        "史実: **M6A1 HR / M6A5 HR**（M6A3 表記は PL 上 M6A5）。244 M9A1 RfG はライルグレネード別物。",
        "",
        "---",
        "",
        "## 3. 機関銃 + 弾薬箱（ammo_box category）",
        "",
        "| 武器 idx | 武器名 | ammo_indices（CBE 4スロット） |",
        "|----------|--------|------------------------------|",
    ]

    for r in decoded:
        cat = r.get("category_code")
        if cat not in (15, 16):  # HMG, LMG
            continue
        slots = r.get("ammo_indices") or []
        if not slots:
            continue
        slot_str = ", ".join(f"{s}={name(names, s)}" for s in slots)
        lines.append(f"| {r['cbeNameIndex']} | {r['name']} | {slot_str} |")

    lines += [
        "",
        "### ammo_box カテゴリ行（category_code=13）",
        "",
        "| idx | 名称 | 内包弾（ammo_indices） | この箱を指す武器（逆引き） |",
        "|-----|------|------------------------|---------------------------|",
    ]

    ammo_to_weapons: dict[int, list[int]] = defaultdict(list)
    for r in decoded:
        if r.get("category_code", 99) > 17:
            continue
        for ai in r.get("ammo_indices") or []:
            if ai and ai in by_idx and by_idx[ai].get("category_code") == 13:
                ammo_to_weapons[ai].append(r["cbeNameIndex"])

    for r in decoded:
        if r.get("category_code") != 13:
            continue
        idx = r["cbeNameIndex"]
        contents = ", ".join(
            f"{s}={name(names, s)}" for s in (r.get("ammo_indices") or []) if s
        )
        users = ammo_to_weapons.get(idx, [])
        u26_users = field34_to_weapon.get(idx, [])
        all_users = sorted(set(users + u26_users))
        user_str = ", ".join(f"{u}={name(names, u)}" for u in all_users[:8])
        if len(all_users) > 8:
            user_str += f" …+{len(all_users)-8}"
        via = []
        if u26_users:
            via.append("+0x34")
        if users:
            via.append("4slot")
        note = f" ({','.join(via)})" if via else ""
        lines.append(
            f"| {idx} | {r['name']} | {contents or '—'} | {user_str or '—'}{note} |"
        )

    lines += [
        "",
        "**ammo_box の `ammo_indices`**: 箱が **内包する弾種行**（例: M1 Ammobox → 3006-250 / 50M2-110）を指す。",
        "**MG→弾薬箱** は武器レコード **u16[26] (+0x34)** に記載（例: M1919A4→35 M2HB Ammobox）。`@ 0x46CD4` が UI 側と照合。",
        "4 スロット逆引きと +0x34 逆引きは別経路 — 表の括弧内に表示。",
        "",
        "---",
        "",
        "## 4. 三脚 / 二脚（Tripod, Lafette）",
        "",
        "| idx | 名称 | category |",
        "|-----|------|----------|",
    ]

    for r in decoded:
        n = r.get("name") or ""
        if any(t in n for t in TRIPOD):
            cat = CAT.get(r.get("category_code"), r.get("category_code"))
            lines.append(f"| {r['cbeNameIndex']} | {n} | {cat} |")

    lines += [
        "",
        "**ST**: `pl_mg_tripod.js` — MG + 三脚で仮想武器化済み。",
        "",
        "---",
        "",
        "## 5. 次の ST タスク",
        "",
        "- [ ] Messer / 銃剣: 主弾 `acceptsAmmo` と分離",
        "- [ ] GrB39 + 専用擲弾: 仮想武器 or 副装備スロット",
        "- [PL_CBE_UI_TABLE_RE.md](./PL_CBE_UI_TABLE_RE.md) — equip_ui / +0x48 列構築",
        "- [PL_CBE_AUX_UI_RE.md](./PL_CBE_AUX_UI_RE.md) — +0x34 / cat24 逆アセンブル",
        "- [x] MG 弾薬箱: 武器 u16[26] (+0x34) 逆引き確定",
        "- [PL_CBE_F7C8_RE.md](./PL_CBE_F7C8_RE.md) — 0xF7C8 列構築 / 0x4240C 走査",
        "- [ ] `@ 0x46CD4`: F7C8 下位 lcall → 8B link_index 書込",
        "- [ ] 0x46CA0: weapon.u21 を **item index** として `shl 6` 間接参照 — mag_type 完全一致の別経路",
        "",
    ]

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT}")
    print(f"  bayonet weapons: {len(bayonet_weapons)}")


if __name__ == "__main__":
    main()
