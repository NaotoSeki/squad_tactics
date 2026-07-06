# -*- coding: utf-8 -*-
"""
Phase 2: 弾薬互換テーブルの完全抽出

decoded JSON の ammo_indices フィールドから:
- weapon -> ammo_indices の正規マッピング
- ammo -> accepts_by_weapons の逆引きマッピング
- data/ammo_table.json を生成
- wpns_pl_master_table.csv の acceptsAmmoPlIndices を CBE 実値で更新
"""
import json
import csv
import io
from pathlib import Path
from collections import defaultdict

# データ読み込み
decoded = json.loads(Path("data/wpns_pl_stats_decoded.json").read_text(encoding="utf-8"))
decoded_map = {r["cbeNameIndex"]: r for r in decoded}

# 武器レコード（カテゴリ 1-17）
weapons = [r for r in decoded if r["category_code"] <= 17]
# 弾薬レコード（カテゴリ 18）
ammo_items = [r for r in decoded if r["category_code"] == 18]
ammo_map = {r["cbeNameIndex"]: r for r in ammo_items}

print(f"武器: {len(weapons)}, 弾薬: {len(ammo_items)}")

# 武器 → 弾薬インデックス
print("\n=== 武器別弾薬インデックス (最初の50件) ===")
print(f"  {'idx':3s} {'name':22s} {'cat':12s} ammo_indices -> ammo_names")
for w in weapons[:50]:
    ammo_names = [ammo_map.get(ai, {}).get("name", f"?{ai}") for ai in w["ammo_indices"]]
    print(f"  {w['cbeNameIndex']:3d} {w['name']:22s} {w['category_name']:12s} "
          f"{w['ammo_indices']} -> {ammo_names}")

# 弾薬 → 対応武器（逆引き）
ammo_to_weapons = defaultdict(list)
for w in weapons:
    for ai in w["ammo_indices"]:
        ammo_to_weapons[ai].append({
            "cbeNameIndex": w["cbeNameIndex"],
            "name": w["name"],
            "category_name": w["category_name"],
        })

# ammo_table.json 生成
print("\n=== ammo_table.json 生成 ===")
ammo_table = []
for a in ammo_items:
    idx = a["cbeNameIndex"]
    entry = {
        "cbeNameIndex": idx,
        "name": a["name"],
        "category_code": a["category_code"],
        "purchase_cost": a["purchase_cost"],
        "accepted_by": ammo_to_weapons.get(idx, []),
        "accepted_by_count": len(ammo_to_weapons.get(idx, [])),
    }
    ammo_table.append(entry)

out_ammo = Path("data/ammo_table.json")
out_ammo.write_text(json.dumps(ammo_table, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"  → {out_ammo}: {len(ammo_table)} エントリ")

# 弾薬テーブルサンプル表示
print("\n=== 弾薬テーブルサンプル ===")
print(f"  {'idx':3s} {'name':15s} {'cost':5s} {'#weapons':8s} 対応武器例")
for a in ammo_table[:40]:
    wnames = [w["name"] for w in a["accepted_by"]][:3]
    more = f"+{len(a['accepted_by'])-3}" if len(a["accepted_by"]) > 3 else ""
    print(f"  {a['cbeNameIndex']:3d} {a['name']:15s} {a['purchase_cost']:5d} "
          f"{a['accepted_by_count']:8d} {', '.join(wnames)}{more}")

# CSV の acceptsAmmoPlIndices を更新
print("\n=== CSV 更新 ===")
csv_path = Path("data/wpns_pl_master_table.csv")
with open(csv_path, encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    rows = list(reader)

updated_count = 0
for row in rows:
    idx = int(row["cbeNameIndex"])
    if idx in decoded_map:
        d = decoded_map[idx]
        cbe_ammo = d["ammo_indices"]
        if cbe_ammo:
            new_val = ",".join(str(a) for a in cbe_ammo)
        else:
            new_val = ""
        old_val = row.get("acceptsAmmoPlIndices", "")
        if old_val != new_val:
            row["acceptsAmmoPlIndices"] = new_val
            updated_count += 1

# BOM付きで書き戻し
out_buf = io.StringIO()
writer = csv.DictWriter(out_buf, fieldnames=fieldnames, lineterminator="\n")
writer.writeheader()
writer.writerows(rows)
csv_path.write_text("\ufeff" + out_buf.getvalue(), encoding="utf-8")
print(f"  更新行数: {updated_count}")
print(f"  → {csv_path} を上書き")

# 武器別弾薬マッピング JSON
weapon_ammo_map = []
for w in weapons:
    ammo_details = []
    for ai in w["ammo_indices"]:
        a = ammo_map.get(ai, {})
        ammo_details.append({
            "cbeNameIndex": ai,
            "name": a.get("name", f"ammo_{ai}"),
            "cost": a.get("purchase_cost", 0),
        })
    weapon_ammo_map.append({
        "cbeNameIndex": w["cbeNameIndex"],
        "name": w["name"],
        "category_name": w["category_name"],
        "ammo_details": ammo_details,
    })

out_wammo = Path("data/weapon_ammo_map.json")
out_wammo.write_text(json.dumps(weapon_ammo_map, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"  → {out_wammo}: {len(weapon_ammo_map)} エントリ")

# 完成確認: Kar98kと7.92-5の対応
print("\n=== Kar98k の弾薬確認 ===")
for w in weapons:
    if "Kar98" in w["name"] or "kar98" in w["name"].lower():
        ammo_names = [ammo_map.get(ai, {}).get("name", f"?{ai}") for ai in w["ammo_indices"]]
        print(f"  {w['cbeNameIndex']:3d} {w['name']:22s} -> {w['ammo_indices']} = {ammo_names}")
