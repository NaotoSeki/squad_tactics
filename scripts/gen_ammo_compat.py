# -*- coding: utf-8 -*-
"""
ammo_compat_full.json, ammo_compat_report.md を生成する。

sprite offset ルール: item_NNNN.png -> cbeNameIndex = NNN - 1
"""
import json, csv
from pathlib import Path
from collections import defaultdict

# ── データ読み込み ──────────────────────────────────────────────
decoded = json.loads(Path('data/wpns_pl_stats_decoded.json').read_text(encoding='utf-8'))
name_tbl = json.loads(Path('data/cbe_name_table.json').read_text(encoding='utf-8'))

def cbe_name(idx):
    return name_tbl.get(str(idx), f'?{idx}')

# weapon 逆引き: cbeNameIndex -> record
by_idx = {r['cbeNameIndex']: r for r in decoded}

# ── 武器名マップ (weapon category != 18 のもの) ─────────────────
weapon_records = [r for r in decoded if r['category_code'] != 18]
weapon_name_map = {r['cbeNameIndex']: r.get('name', cbe_name(r['cbeNameIndex'])) for r in weapon_records}

# ── ammo records (category_code == 18) ──────────────────────────
ammo_records = [r for r in decoded if r['category_code'] == 18]

# weapon record から ammo→weapon 逆引きマップを作成
ammo_to_weapons = defaultdict(list)
for w in weapon_records:
    wid = w['cbeNameIndex']
    for aidx in w.get('ammo_indices', []):
        ammo_to_weapons[aidx].append(wid)

# ── ユーザー補正データ ───────────────────────────────────────────
# スプライトズレ確定情報
sprite_note = "sprite_offset: item_NNNN.png -> cbeNameIndex = NNN-1 (confirmed)"

# Kar98k 系武器インデックス
kar98_weapons = [55, 56, 57, 58, 59, 60, 61, 64, 65, 66, 67, 68, 69, 70]

# 書面資料に基づく Kar98k 互換弾薬
# Paper: 7.92-5(272), GPzgr(303), GSprgr(304) + S84/92(313) bayonet
# CBE:   7.92-10G(273), GSprgr(304), StiGr24(305), Messer(314)
# → 272(7.92-5) と 303(GPzgr) をユーザー補正追加
# → 313(S84/92) は銃剣なので別扱い
# → 305(StiGr24) は CBE に入っているが書面無し（ゲーム側の拡張か）

# M1A1 Cbn 関連
# weapon 13 (M1A1 Cbn) ammo_indices = [233, 234, 245, 253]
# 233 = 30Cbn-30, 234 = 45ACP20T
# ユーザー要求: 232 (30Cbn-15) を追加

# 27mmStuP 互換 (ユーザー提供)
STUP27_COMPAT_AMMO = [271, 268, 267]  # Pzwk42, Wgrp326, Wkor361

# ── ammo compat full JSON 構築 ───────────────────────────────────
ammo_entries = {}

for a in ammo_records:
    aidx = a['cbeNameIndex']
    cname = cbe_name(aidx)
    weapons_cbe = sorted(ammo_to_weapons.get(aidx, []))
    weapon_names_cbe = [weapon_name_map.get(w, cbe_name(w)) for w in weapons_cbe]

    entry = {
        "cbe_name": cname,
        "display_name": cname,
        "magazine_capacity": a.get('magazine_capacity', 0),
        "purchase_cost": a.get('purchase_cost', 0),
        "weight_100g": a.get('weight_100g', 0),
        "weapons_from_cbe": weapons_cbe,
        "weapon_names_cbe": weapon_names_cbe,
        "note": ""
    }

    # 個別補正
    if aidx == 272:  # 7.92-5
        entry["weapons_user_correction"] = kar98_weapons
        entry["note"] = (
            "書面資料: Kar98k系で使用可。CBEの4スロットには未収録。"
            " clip-fed 5発クリップ弾薬（magazine_capacity=5確認済み）。"
            " 7.92-10G(273)の10発=2×5発クリップ相当という解釈も可能。"
            " 注意: CBE decoded で weapons_from_cbe=[54] (27mmStuP) となるが、"
            " 27mmStuP (category_code=2 grenade_launcher_ammo) の ammo_indices解釈が"
            " 通常武器と異なる可能性がある。CBE 27mmStuP ammo_indices=[272,269,268]"
            " はユーザー提供値[271,268,267]と1ずれしており要調査。"
        )

    elif aidx == 232:  # 30Cbn-15
        entry["note"] = (
            "CBE weapons_from_cbe=[8,9,10] = M1 Rifle/M1C/M1D Rifle (.30-06系)。"
            " 30Cbn-15 という名前はゲーム内簡略表記で .30口径15発の意味とみられる"
            " (M1 Garand は8発クリップだが CBE内部の命名による)。"
            " M1A1 Cbn(13)/M1 Cbn(12) のCBE 4スロットには未収録。"
            " ユーザー補正: M1A1 Cbn, M1 Cbn も15発マガジンとして使用可能と想定。"
        )
        entry["weapons_user_correction"] = [12, 13]

    elif aidx == 233:  # 30Cbn-30
        entry["note"] = (
            "sprite: item_0234.png (offset+1). CBE name='30Cbn-30' 正確。"
            " M1A1 Cbn(13)/M1 Cbn(12)/M2 Cbn(14) のammo_indicesに含まれる。"
        )

    elif aidx == 234:  # 45ACP20T
        entry["note"] = (
            "sprite: item_0235.png (offset+1). CBE name='45ACP20T' = .45ACP 20発トーチャーマグ。"
            " M1A1 SMG/M3 SMG 用。M1A1 Cbn(13)のCBE ammo_indicesに含まれているが、"
            " これは .45ACP 弾でカービン弾ではない。要調査。"
        )

    ammo_entries[str(aidx)] = entry

# ── weapons_using_ammo_outside_4slots ───────────────────────────
outside_4slots = {
    "57": {
        "weapon_name": "Kar98k",
        "cbe_ammo_indices": [273, 304, 305, 314],
        "user_add_ammo_indices": [272, 303],
        "note": (
            "書面資料: 7.92-5(272)とGPzgr(303)を追加。"
            " S84/92(313)は銃剣アタッチメント（ammo扱いか要確認）。"
            " CBEにあるStiGr24(305)は書面に無し（ゲーム拡張か）。"
        )
    },
    "55": {
        "weapon_name": "Gew98",
        "cbe_ammo_indices": [273, 314],
        "user_add_ammo_indices": [272, 303, 304],
        "note": "Kar98kと同系統のためGPzgr/GSprgr/7.92-5互換と推定。"
    },
    "56": {
        "weapon_name": "Kar98b",
        "cbe_ammo_indices": [273, 314],
        "user_add_ammo_indices": [272, 303, 304],
        "note": "Kar98kと同系統のためGPzgr/GSprgr/7.92-5互換と推定。"
    },
    "13": {
        "weapon_name": "M1A1 Cbn",
        "cbe_ammo_indices": [233, 234, 245, 253],
        "user_add_ammo_indices": [232],
        "note": (
            "CBEの4スロットに30Cbn-15(232)が未収録。"
            " ユーザー要求: M1A1 Cbnは15発マガジンが基本装備のため232を追加。"
        )
    },
    "12": {
        "weapon_name": "M1 Cbn",
        "cbe_ammo_indices": [233, 234, 245, 253],
        "user_add_ammo_indices": [232],
        "note": "M1A1 Cbnと同様、30Cbn-15(232)を追加。"
    }
}

# ── 27mmStuP の ammo record 確認 ─────────────────────────────────
stuP_record = by_idx.get(54, {})
stuP_ammo_from_cbe = stuP_record.get('ammo_indices', [])

# ── final JSON 組み立て ──────────────────────────────────────────
result = {
    "version": "1.1",
    "note": (
        "CBE.EXE decode (TABLE_START=0x1DDF00, stride=64) + user corrections. "
        "Sprite offset: item_NNNN.png -> cbeNameIndex = NNN-1 (confirmed). "
        "Kar98k paper docs: 7.92-5(272), GPzgr(303), GSprgr(304), S84/92(313 bayonet)."
    ),
    "sprite_index_rule": {
        "formula": "item_NNNN.png -> cbeNameIndex = NNN - 1",
        "confirmed": True,
        "examples": {
            "item_0233.png": {"cbeNameIndex": 232, "cbe_name": "30Cbn-15"},
            "item_0234.png": {"cbeNameIndex": 233, "cbe_name": "30Cbn-30"},
            "item_0235.png": {"cbeNameIndex": 234, "cbe_name": "45ACP20T"}
        }
    },
    "kar98k_paper_vs_cbe": {
        "paper_ammo": {
            "272": "7.92-5 (not in CBE 4slots)",
            "303": "GPzgr (not in CBE 4slots)",
            "304": "GSprgr (in CBE ✓)",
            "313": "S84/92 bayonet (not in CBE 4slots)"
        },
        "cbe_only": {
            "305": "StiGr24 (in CBE, not in paper docs)",
            "314": "Messer (in CBE, paper has S84/92 instead)"
        }
    },
    "stuP27_user_compat": {
        "weapon_index": 54,
        "weapon_name": "27mmStuP",
        "category_code": 2,
        "category_name": "grenade_launcher_ammo",
        "cbe_ammo_indices": stuP_ammo_from_cbe,
        "cbe_ammo_names": [cbe_name(i) for i in stuP_ammo_from_cbe],
        "user_confirmed_ammo": STUP27_COMPAT_AMMO,
        "user_confirmed_names": [cbe_name(i) for i in STUP27_COMPAT_AMMO],
        "note": (
            "ユーザー提供: Pzwk42(271), Wgrp326(268), Wkor361(267)。"
            " CBE decoded: [272=7.92-5, 269=FLeut.Z, 268=Wgrp326]。"
            " CBE[272]とユーザー[271]が1ずれ(CBE[269]とユーザー[267]も2ずれ)。"
            " category_code=2(grenade_launcher_ammo)は通常武器と ammo_indices 解釈が異なる可能性。"
            " 268(Wgrp326)はCBE/ユーザー双方で一致。"
        )
    },
    "ammo": ammo_entries,
    "weapons_using_ammo_outside_4slots": outside_4slots
}

out_path = Path('data/ammo_compat_full.json')
out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"Written: {out_path}  ({out_path.stat().st_size} bytes)")
print(f"Total ammo entries: {len(ammo_entries)}")

# ── ammo_compat_report.md 生成 ───────────────────────────────────
lines = []
lines.append("# CBE.EXE 弾薬互換マップ レポート")
lines.append("")
lines.append(f"> 生成: gen_ammo_compat.py  |  sprite offset: item_NNNN.png → cbeNameIndex = NNN-1  |  version 1.1")
lines.append("")

# ── スプライトズレ確認 ──
lines.append("## スプライト番号 vs cbeNameIndex の対応")
lines.append("")
lines.append("| sprite ファイル | cbeNameIndex | CBE名 | 説明 |")
lines.append("|---|---|---|---|")
lines.append("| item_0233.png | 232 | 30Cbn-15 | 15発 .30カービンマグ |")
lines.append("| item_0234.png | 233 | 30Cbn-30 | 30発 .30カービンマグ |")
lines.append("| item_0235.png | 234 | 45ACP20T | 20発 .45ACP（SMG用）|")
lines.append("")
lines.append("**結論**: CBE 内部での命名ミスではなく、スプライト番号が cbeNameIndex より常に +1 のオフセットを持つ。")
lines.append("以前の「45ACP20T が 30Cbn-30 に見える」という混乱はこのズレが原因。")
lines.append("")

# ── 7.92系 ──────────────────────────────────────────────
lines.append("## 7.92mm 系弾薬と対応武器")
lines.append("")
lines.append("| idx | CBE名 | mag | 対応武器 (CBE) | ユーザー補正 |")
lines.append("|---|---|---|---|---|")

sevenNine_ammo = [272, 273, 274, 275, 276, 277, 295, 296]
for aidx in sevenNine_ammo:
    e = ammo_entries.get(str(aidx))
    if not e:
        continue
    w_cbe = ', '.join(f"{w}={weapon_name_map.get(w, '?')}" for w in e['weapons_from_cbe'])
    corr = e.get('weapons_user_correction', [])
    corr_str = ', '.join(f"{w}={weapon_name_map.get(w, '?')}" for w in corr) if corr else '-'
    lines.append(f"| {aidx} | {e['cbe_name']} | {e['magazine_capacity']} | {w_cbe or '-'} | {corr_str} |")

lines.append("")
lines.append("### Kar98k 系武器 × 弾薬（書面資料 vs CBE）")
lines.append("")
lines.append("| 武器 idx | 武器名 | cap | CBE ammo_indices | 書面追加 |")
lines.append("|---|---|---|---|---|")
for widx in [55, 56, 57, 58, 59, 60, 61, 64, 65, 66, 67, 68, 69, 70]:
    w = by_idx.get(widx)
    if not w:
        continue
    slots = w.get('ammo_indices', [])
    slots_str = ', '.join(f"{i}={cbe_name(i)}" for i in slots)
    extra = outside_4slots.get(str(widx), {}).get('user_add_ammo_indices', [])
    extra_str = ', '.join(f"{i}={cbe_name(i)}" for i in extra) if extra else '-'
    lines.append(f"| {widx} | {w.get('name',cbe_name(widx))} | {w.get('magazine_capacity','')} | {slots_str} | {extra_str} |")

lines.append("")
lines.append("**注**: StiGr24(305) は CBE に Kar98k の ammo_indices として収録されているが書面には無し。")
lines.append("Messer(314) は CBE に収録、書面では S84/92(313) 銃剣が記載。")
lines.append("")

# ── .30カービン系 ──────────────────────────────────────────
lines.append("## .30 カービン系弾薬と対応武器")
lines.append("")
lines.append("| idx | CBE名 | mag | 対応武器 (CBE) | ユーザー補正 |")
lines.append("|---|---|---|---|---|")

cbn_ammo = [232, 233, 234, 235, 236, 237]
for aidx in cbn_ammo:
    e = ammo_entries.get(str(aidx))
    if not e:
        continue
    w_cbe = ', '.join(f"{w}={weapon_name_map.get(w, '?')}" for w in e['weapons_from_cbe'])
    corr = e.get('weapons_user_correction', [])
    corr_str = ', '.join(f"{w}={weapon_name_map.get(w, '?')}" for w in corr) if corr else '-'
    lines.append(f"| {aidx} | {e['cbe_name']} | {e['magazine_capacity']} | {w_cbe or '-'} | {corr_str} |")

lines.append("")
lines.append("### M1A1 Cbn / M1 Cbn の補正")
lines.append("")
lines.append("| weapon idx | 武器名 | CBE ammo_indices | ユーザー追加 |")
lines.append("|---|---|---|---|")
for widx in [12, 13, 14]:
    w = by_idx.get(widx)
    if not w:
        continue
    slots = w.get('ammo_indices', [])
    slots_str = ', '.join(f"{i}={cbe_name(i)}" for i in slots)
    extra = outside_4slots.get(str(widx), {}).get('user_add_ammo_indices', [])
    extra_str = ', '.join(f"{i}={cbe_name(i)}" for i in extra) if extra else '-'
    lines.append(f"| {widx} | {w.get('name',cbe_name(widx))} | {slots_str} | {extra_str} |")

lines.append("")
lines.append("**注**: 234=45ACP20T が M1A1 Cbn の CBE ammo_indices に含まれている理由は不明。")
lines.append(".45ACP 弾薬は SMG 用であり、カービン系には不適切。要調査。")
lines.append("")

# ── 27mmStuP系 ──────────────────────────────────────────
lines.append("## 27mm 信号拳銃 / StuP 系弾薬")
lines.append("")
lines.append("| 武器 idx | 武器名 | CBE ammo_indices | ユーザー確認 ammo |")
lines.append("|---|---|---|---|")
stuP27 = result['stuP27_user_compat']
cbe_str = ', '.join(f"{i}={cbe_name(i)}" for i in stuP27['cbe_ammo_indices'])
user_str = ', '.join(f"{i}={cbe_name(i)}" for i in stuP27['user_confirmed_ammo'])
lines.append(f"| 54 | 27mmStuP | {cbe_str or '-'} | {user_str} |")

# 27mm 系の weapon (51-54)
for widx in [51, 52, 53, 54]:
    w = by_idx.get(widx)
    if not w or widx == 54:
        continue
    slots = w.get('ammo_indices', [])
    slots_str = ', '.join(f"{i}={cbe_name(i)}" for i in slots)
    lines.append(f"| {widx} | {w.get('name',cbe_name(widx))} | {slots_str} | - |")

lines.append("")

# ── CBEデータ vs ユーザー補正 差分サマリー ──────────────────
lines.append("## CBEデータ vs ユーザー補正 差分サマリー")
lines.append("")
lines.append("| 項目 | CBEデータ | ユーザー補正・書面資料 |")
lines.append("|---|---|---|")
lines.append("| Kar98k ammo (272=7.92-5) | 未収録 | 書面に明記。7.92-5クリップ弾追加 |")
lines.append("| Kar98k ammo (303=GPzgr) | 未収録 | 書面に明記。対戦車榴弾追加 |")
lines.append("| Kar98k ammo (305=StiGr24) | 収録済み | 書面に無し。CBEのみ |")
lines.append("| Kar98k ammo (313=S84/92) | 未収録 | 書面に銃剣として記載（ammo扱い?) |")
lines.append("| Kar98k ammo (314=Messer) | 収録済み | 書面はS84/92。Messerはゲーム独自? |")
lines.append("| M1A1 Cbn ammo (232=30Cbn-15) | 未収録 | ユーザー要求: 15発マグ追加 |")
lines.append("| 27mmStuP ammo | 要確認 | ユーザー提供: Pzwk42/Wgrp326/Wkor361 |")
lines.append("| sprite offset | - | item_NNNN.png → cbeNameIndex=NNN-1 確定 |")
lines.append("")
lines.append("---")
lines.append(f"*生成: gen_ammo_compat.py | データソース: CBE.EXE 0x1DDF00 (stride=64, 400 records)*")

report_path = Path('data/ammo_compat_report.md')
report_path.write_text('\n'.join(lines), encoding='utf-8')
print(f"Written: {report_path}  ({report_path.stat().st_size} bytes)")
