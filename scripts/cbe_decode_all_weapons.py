# -*- coding: utf-8 -*-
"""
Phase 1-B: CBE.EXE 全武器レコードデコード
確定した構造で全エントリをデコードし wpns_pl_stats_decoded.json を生成。

フィールドレイアウト（stride=64, TABLE_START=0x1DDF00, 1-indexed）:
  +00 u16: weapon_name_idx  (= cbeNameIndex + 1)
  +02 u16: category_code    (1=pistol, 4=rifle, 5=MG...)
  +04 u32: segment_sel      (far ptr / ignore)
  +08 u16: initial_penetration
  +10 u16: penetration_decay_rate
  +12 u16: special / shaped-charge effect value
  +14 u16: explosive / area effect value
  +16 u16: initial_hit_rate
  +18 u16: shots_per_action
  +20 u16: hit_decay_rate
  +22 u16: unknown_16
  +24 u16: unknown_18
  +26 u16: malfunction_rate
  +28 u16: melee_attack
  +30 u16: unknown_1e
  +32 u16: unknown_20
  +34 u16: unknown_22
  +36 u16: purchase_cost
  +38 u16: weight_100g     (重量 推定：単位 100g)
  +40 u16: magazine_capacity
  +42 u16: unknown_2a
  +44 u16: ammo_idx_0
  +46 u16: ammo_idx_1
  +48 u16: ammo_idx_2
  +50 u16: ammo_idx_3
  +52 u16: unknown_34
  +54 u16: unknown_36
  +56 u16: unknown_38
  +58 u16: unknown_3a
  +60 u16: unknown_3c
  +62 u16: unknown_3e
"""
import struct
import json
import csv
from pathlib import Path

CBE = Path("D:/PL/CBE.EXE")
data = CBE.read_bytes()

TABLE_START = 0x1DDF00
STRIDE = 64

# CSV からウェポン名を取得
csv_weapons = {}
with open("data/wpns_pl_master_table.csv", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        idx = int(row["cbeNameIndex"])
        csv_weapons[idx] = row.get("name", f"weapon_{idx}")

# The master CSV does not name every AFV gun record. The CBE name chain does.
cbe_names = {
    int(idx): name
    for idx, name in json.loads(
        Path("data/cbe_name_table.json").read_text(encoding="utf-8")
    ).items()
}

def read_record(cbe_name_idx):
    """cbeNameIndex (0-indexed) からレコードを読み込む"""
    dump_idx = cbe_name_idx + 1
    off = TABLE_START + (dump_idx - 1) * STRIDE
    if off + STRIDE > len(data):
        return None
    rec = data[off:off + STRIDE]
    u = [struct.unpack_from("<H", rec, i)[0] for i in range(0, 64, 2)]
    
    # weapon_name_idx の整合性チェック
    if u[0] != dump_idx:
        return None  # 想定外のデータ
    
    # CBE stores linked item references as one-based raw item IDs. Runtime
    # tables use zero-based cbeNameIndex values, so retain both forms and make
    # ammo_indices unambiguously zero-based.
    ammo_raw_item_ids = [a for a in [u[22], u[23], u[24], u[25]] if a != 0]
    ammo_indices = [raw_item_id - 1 for raw_item_id in ammo_raw_item_ids]
    
    effective_penetration = u[4]
    if u[4]:
        penetration_source = "u4/+08"
    elif u[1] in (10, 11, 21) and u[6]:
        effective_penetration = u[6]
        penetration_source = "u6/+12"
    elif u[1] == 19 and (u[3] & 0x4000) and u[6]:
        effective_penetration = u[6]
        penetration_source = "u6/+12"
    elif u[1] == 19 and (u[3] & 0x8000) and u[7]:
        effective_penetration = u[7]
        penetration_source = "u7/+14"
    elif u[1] == 22 and u[7]:
        effective_penetration = u[7]
        penetration_source = "u7/+14"
    else:
        penetration_source = None

    effect_profiles = []
    if u[4]:
        effect_profiles.append({
            "kind": "explosive" if u[1] == 20 else "kinetic",
            "value": u[4],
            "decay_per_hex": u[5],
            "source": "u4/+08",
        })
    if u[6]:
        effect_profiles.append({
            "kind": "flame_direct" if u[1] == 9 else "special_or_shaped_charge",
            "value": u[6],
            "decay_per_hex": 0,
            "source": "u6/+12",
        })
    if u[7]:
        effect_profiles.append({
            "kind": "flame_area" if u[1] == 9 else "explosive",
            "value": u[7],
            "decay_per_hex": 0,
            "source": "u7/+14",
        })

    return {
        "cbeNameIndex": cbe_name_idx,
        "name": csv_weapons.get(
            cbe_name_idx,
            cbe_names.get(cbe_name_idx, f"weapon_{cbe_name_idx}"),
        ),
        "category_code": u[1],
        "initial_penetration": effective_penetration,
        "initial_penetration_raw_u4": u[4],
        "penetration_decay_rate": u[5],
        "penetration_source": penetration_source,
        "effect_mode_raw": u[3],
        "special_penetration_u6": u[6],
        "special_penetration_u7": u[7],
        "effect_profiles": effect_profiles,
        "initial_hit_rate": u[8],
        "shots_per_action": u[9],
        "hit_decay_rate": u[10],
        "malfunction_rate": u[13],
        "base_malfunction_rate": 0 if u[1] == 18 else u[13],
        "malfunction_modifier": u[13] if u[1] == 18 else 0,
        "melee_attack": u[14],
        "purchase_cost": u[18],
        "weight_100g": u[19],
        "magazine_capacity": u[20],
        "ammo_raw_item_ids": ammo_raw_item_ids,
        "ammo_indices": ammo_indices,
        "u26_raw_item_id": u[26] or None,
        "u26_index": (u[26] - 1) if u[26] else None,
        "record_offset": f"0x{TABLE_START + (dump_idx-1)*STRIDE:06X}",
        # デバッグ用: 未確定フィールド
        "_raw_u16": u,
        "_offset": f"0x{TABLE_START + (dump_idx-1)*STRIDE:06X}",
    }

# テーブルの終端を検出: weapon_name_idx が連続していなくなるまで
print("=== テーブルスキャン ===")
records = []
# Stop at the first invalid one-based header. This CBE build has 455 valid
# rows (0..454), including the mounted AFV weapons.
max_scan = (len(data) - TABLE_START) // STRIDE

prev_idx = 0
for cbe_idx in range(max_scan):
    dump_idx = cbe_idx + 1
    off = TABLE_START + cbe_idx * STRIDE
    if off + STRIDE > len(data):
        break
    first_u16 = struct.unpack_from("<H", data, off)[0]
    if first_u16 != dump_idx:
        print(f"  cbeNameIndex={cbe_idx}: dump_idx不一致 (found={first_u16}, expected={dump_idx}), テーブル終端")
        break
    rec = read_record(cbe_idx)
    if rec:
        records.append(rec)
        prev_idx = cbe_idx

print(f"  デコード成功: {len(records)} レコード")

# サンプル検証
VALIDATION = {
    0:  dict(acc=90, melee=2, shots=2, cost=200,  acc_drop=14, pen=39, pen_drop=4, malfunction=3, cap=8),
    1:  dict(acc=90, melee=2, shots=1, cost=100,  acc_drop=13, pen=39, pen_drop=4, malfunction=1, cap=6),
    8:  dict(acc=60, melee=5, shots=2, cost=1900, acc_drop=5,  pen=76, pen_drop=3, malfunction=2, cap=8),
    41: dict(acc=90, melee=2, shots=2, cost=340,  acc_drop=12, pen=40, pen_drop=6, malfunction=3, cap=10),
}

print("\n=== サンプル検証 ===")
for cbe_idx, expected in VALIDATION.items():
    if cbe_idx < len(records):
        r = records[cbe_idx]
        ok_fields = []
        ng_fields = []
        for field, exp_val in expected.items():
            field_map = {
                "acc": "initial_hit_rate", "melee": "melee_attack", "shots": "shots_per_action",
                "cost": "purchase_cost", "acc_drop": "hit_decay_rate", "pen": "initial_penetration",
                "pen_drop": "penetration_decay_rate", "malfunction": "malfunction_rate", "cap": "magazine_capacity"
            }
            actual = r.get(field_map[field], -1)
            if actual == exp_val:
                ok_fields.append(f"{field}={actual}[OK]")
            else:
                ng_fields.append(f"{field}: expected={exp_val} actual={actual}[NG]")
        status = "OK" if not ng_fields else "NG"
        print(f"  [{cbe_idx}] {r['name']:20s}: {status}")
        if ng_fields:
            for ng in ng_fields:
                print(f"    {ng}")
        print(f"    {', '.join(ok_fields)}")

# カテゴリコードの分布
print("\n=== category_code の分布 ===")
cat_dist = {}
for r in records:
    cc = r["category_code"]
    cat_dist[cc] = cat_dist.get(cc, [])
    cat_dist[cc].append(r["name"])
for cc, names in sorted(cat_dist.items()):
    print(f"  code={cc}: {len(names)} 武器 (例: {', '.join(names[:5])})")

# 最初の30件をサマリー表示
print("\n=== 最初の30武器サマリー ===")
print(f"  {'idx':3s} {'name':20s} {'cat':3s} {'acc':3s} {'sh':2s} {'pen':3s} {'pd':2s} {'ad':2s} {'mal':3s} {'mel':3s} {'cost':5s} {'cap':3s} {'ammo'}")
for r in records[:30]:
    ammo_str = ",".join(str(a) for a in r["ammo_indices"])
    print(f"  {r['cbeNameIndex']:3d} {r['name']:20s} {r['category_code']:3d} "
          f"{r['initial_hit_rate']:3d} {r['shots_per_action']:2d} {r['initial_penetration']:3d} "
          f"{r['penetration_decay_rate']:2d} {r['hit_decay_rate']:2d} "
          f"{r['malfunction_rate']:3d} {r['melee_attack']:3d} "
          f"{r['purchase_cost']:5d} {r['magazine_capacity']:3d} [{ammo_str}]")

# JSON出力（_raw_u16 は保持）
out_path = Path("data/wpns_pl_stats_decoded.json")
output = []
for r in records:
    entry = {k: v for k, v in r.items() if not k.startswith("_")}
    output.append(entry)

out_path.parent.mkdir(exist_ok=True)
out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n  → {out_path} に {len(output)} レコード出力")
