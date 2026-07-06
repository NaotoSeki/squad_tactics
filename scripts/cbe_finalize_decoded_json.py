# -*- coding: utf-8 -*-
"""
Phase 1-B 最終化: wpns_pl_stats_decoded.json の生成
- shots_per_action の 0x8000 フラグを auto_fire フラグに分離
- 弾薬インデックスのクリーニング
- 武器/弾薬/装備の分類
"""
import struct
import json
import csv
from pathlib import Path

CBE = Path("D:/PL/CBE.EXE")
data = CBE.read_bytes()

TABLE_START = 0x1DDF00
STRIDE = 64

# CSV からウェポン名・カテゴリを取得
csv_weapons = {}
with open("data/wpns_pl_master_table.csv", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        idx = int(row["cbeNameIndex"])
        csv_weapons[idx] = {
            "name": row.get("name", ""),
            "plCategory": row.get("plCategory", ""),
            "statTemplate": row.get("statTemplate", ""),
            "wpns_code": row.get("wpns_code", ""),
            "type": row.get("type", ""),
            "plAmmoLabel": row.get("plAmmoLabel", ""),
            "acceptsAmmoPlIndices": row.get("acceptsAmmoPlIndices", ""),
        }

# カテゴリコード → 名称マッピング
CATEGORY_NAMES = {
    1: "pistol",
    2: "grenade_launcher_ammo",
    3: "smoke_grenade",
    4: "rifle",
    5: "lmg",
    6: "smg",
    7: "mmg",
    8: "at_rifle",
    9: "flamethrower",
    10: "rocket_launcher",
    11: "panzerfaust",
    12: "tripod",
    13: "ammo_box",
    14: "binoculars",
    15: "radio",
    16: "medical",
    17: "document",
    18: "ammo",
    19: "rifle_grenade",
    20: "hand_grenade",
    21: "magnetic_mine",
    22: "demolition",
    23: "smoke",
    24: "bayonet_knife",
    25: "mounted_weapon",
}

def decode_record(cbe_name_idx):
    dump_idx = cbe_name_idx + 1
    off = TABLE_START + (dump_idx - 1) * STRIDE
    if off + STRIDE > len(data):
        return None
    rec = data[off:off + STRIDE]
    u = [struct.unpack_from("<H", rec, i)[0] for i in range(0, 64, 2)]

    if u[0] != dump_idx:
        return None

    csv_info = csv_weapons.get(cbe_name_idx, {})
    cat_code = u[1]

    # shots_per_action の 0x8000 フラグ処理
    shots_raw = u[9]
    auto_fire = bool(shots_raw & 0x8000)
    shots_per_action = shots_raw & 0x7FFF

    # ammo_indices: 0 は除外
    ammo_indices = [u[i] for i in [22, 23, 24, 25] if u[i] != 0]

    # unknown_22 も同様に 0x8000 フラグが立つ場合があるので記録
    unk_0x16_raw = u[11]

    entry = {
        "cbeNameIndex": cbe_name_idx,
        "name": csv_info.get("name") or f"weapon_{cbe_name_idx}",
        "wpns_code": csv_info.get("wpns_code", ""),
        "plCategory": csv_info.get("plCategory", ""),
        "category_code": cat_code,
        "category_name": CATEGORY_NAMES.get(cat_code, f"unknown_{cat_code}"),
        "initial_hit_rate": u[8],
        "shots_per_action": shots_per_action,
        "auto_fire": auto_fire,
        "hit_decay_rate": u[10],
        "malfunction_rate": u[13],
        "melee_attack": u[14],
        "initial_penetration": u[4],
        "penetration_decay_rate": u[5],
        "purchase_cost": u[18],
        "weight_100g": u[19],
        "magazine_capacity": u[20],
        "ammo_indices": ammo_indices,
        # 未確定フィールド（将来の参照用）
        "_unknown_02": u[1],  # category_code と同じ
        "_unknown_0e": u[7],  # 常に 0?
        "_unknown_16": unk_0x16_raw,
        "_unknown_1e": u[15],
        "_unknown_20": u[16],
        "_unknown_22": u[17],
        "_unknown_26": u[19],  # weight と同じ?
        "_unknown_2a": u[21],
        "_offset": f"0x{TABLE_START + (dump_idx-1)*STRIDE:06X}",
    }
    return entry

# 全400レコードをデコード
print("=== フルデコード ===")
all_records = []
for cbe_idx in range(400):
    dump_idx = cbe_idx + 1
    off = TABLE_START + cbe_idx * STRIDE
    if off + STRIDE > len(data):
        break
    first_u16 = struct.unpack_from("<H", data, off)[0]
    if first_u16 != dump_idx:
        print(f"  終端検出: cbeNameIndex={cbe_idx}, expected={dump_idx}, found={first_u16}")
        break
    rec = decode_record(cbe_idx)
    if rec:
        all_records.append(rec)

print(f"  総レコード数: {len(all_records)}")

# カテゴリ別の分類
weapon_items = [r for r in all_records if r["category_code"] <= 17]  # 武器・装備
ammo_items = [r for r in all_records if r["category_code"] == 18]  # 弾薬
other_items = [r for r in all_records if r["category_code"] > 18]   # その他
print(f"  武器/装備: {len(weapon_items)}, 弾薬: {len(ammo_items)}, その他: {len(other_items)}")

# JSON出力（_フィールドを除外したクリーンバージョン）
clean_records = []
for r in all_records:
    clean = {k: v for k, v in r.items() if not k.startswith("_")}
    clean_records.append(clean)

out_path = Path("data/wpns_pl_stats_decoded.json")
out_path.write_text(json.dumps(clean_records, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"  → {out_path} に {len(clean_records)} レコード出力")

# 武器のみの詳細表示 (最初の50件)
print("\n=== 武器レコード詳細 (最初の50件) ===")
print(f"  {'idx':3s} {'name':22s} {'cat_name':15s} {'acc':3s} {'sh':3s} {'auto':4s} {'pen':3s} {'pd':2s} {'ad':2s} {'mal':3s} {'mel':3s} {'cost':5s} {'cap':3s} ammo")
for r in all_records[:50]:
    auto_str = "AUTO" if r["auto_fire"] else "    "
    ammo_str = ",".join(str(a) for a in r["ammo_indices"][:3])
    if len(r["ammo_indices"]) > 3:
        ammo_str += "..."
    print(f"  {r['cbeNameIndex']:3d} {r['name']:22s} {r['category_name']:15s} "
          f"{r['initial_hit_rate']:3d} {r['shots_per_action']:3d} {auto_str} {r['initial_penetration']:3d} "
          f"{r['penetration_decay_rate']:2d} {r['hit_decay_rate']:2d} "
          f"{r['malfunction_rate']:3d} {r['melee_attack']:3d} "
          f"{r['purchase_cost']:5d} {r['magazine_capacity']:3d} [{ammo_str}]")

# 自動射撃武器一覧
print("\n=== 自動射撃武器 (auto_fire=True) ===")
for r in all_records:
    if r["auto_fire"] and r["category_code"] <= 15:
        print(f"  {r['cbeNameIndex']:3d} {r['name']:22s} shots={r['shots_per_action']} auto_fire=True")

# バリデーション結果
print("\n=== バリデーション結果 ===")
VALIDATION = {
    0:  dict(acc=90, melee=2, shots=2, cost=200,  acc_drop=14, pen=39, pen_drop=4, malfunction=3, cap=8),
    1:  dict(acc=90, melee=2, shots=1, cost=100,  acc_drop=13, pen=39, pen_drop=4, malfunction=1, cap=6),
    8:  dict(acc=60, melee=5, shots=2, cost=1900, acc_drop=5,  pen=76, pen_drop=3, malfunction=2, cap=8),
    41: dict(acc=90, melee=2, shots=2, cost=340,  acc_drop=12, pen=40, pen_drop=6, malfunction=3, cap=10),
}
field_map = {
    "acc": "initial_hit_rate", "melee": "melee_attack", "shots": "shots_per_action",
    "cost": "purchase_cost", "acc_drop": "hit_decay_rate", "pen": "initial_penetration",
    "pen_drop": "penetration_decay_rate", "malfunction": "malfunction_rate", "cap": "magazine_capacity"
}
for cbe_idx, expected in VALIDATION.items():
    r = all_records[cbe_idx]
    mismatches = []
    for field, exp_val in expected.items():
        actual = r.get(field_map[field], -1)
        if actual != exp_val:
            mismatches.append(f"{field}: CBE={actual}, guide={exp_val}")
    status = "OK" if not mismatches else "VERSION_DIFF"
    print(f"  [{cbe_idx}] {r['name']:20s}: {status}")
    for m in mismatches:
        print(f"    {m}")
