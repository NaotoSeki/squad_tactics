# -*- coding: utf-8 -*-
"""
Phase 2: ammo_table.json 完全版の生成と CSV acceptsAmmoPlIndices の更新
"""
import json
import csv
import struct
from pathlib import Path

CBE = Path("D:/PL/CBE.EXE")
data = CBE.read_bytes()

# ================================================================
# Step 1: 0x2170D0 からの全文字列テーブル再抽出
# table_index = cbeNameIndex + 3
# ================================================================
TABLE_STRING_START = 0x2170D0
strings = []
pos = TABLE_STRING_START
while pos < 0x218500 and len(strings) < 700:
    end = pos
    while end < len(data) and data[end] != 0:
        end += 1
    raw = data[pos:end]
    try:
        name = raw.decode("ascii")
        if all(0x20 <= ord(c) < 0x80 for c in name):
            strings.append((pos, name))
        else:
            strings.append((pos, ""))
    except UnicodeDecodeError:
        strings.append((pos, ""))
    pos = end + 1

print(f"文字列テーブル: {len(strings)} エントリ")
print(f"マッピング: table_index = cbeNameIndex + 3")

# マッピング関数
def cbe_to_name(cbe_name_idx):
    tbl_idx = cbe_name_idx + 3
    if 0 <= tbl_idx < len(strings):
        return strings[tbl_idx][1]
    return ""

# 検証
validations = [(0, "M1911A1"), (1, "M1917 S&W"), (7, "M1918A2 BAR"), (41, "C/96")]
print("\n=== 検証 ===")
for cbe_idx, expected in validations:
    actual = cbe_to_name(cbe_idx)
    status = "OK" if actual == expected else "NG"
    print(f"  [{cbe_idx}] expected={expected!r}, actual={actual!r}: {status}")

# ================================================================
# Step 2: 全 ammo/weapon アイテムに名前を付与
# ================================================================
decoded = json.loads(Path("data/wpns_pl_stats_decoded.json").read_text(encoding="utf-8"))

# CBE 名前テーブルで全レコードを更新
updated_records = []
for r in decoded:
    cbe_idx = r["cbeNameIndex"]
    cbe_name = cbe_to_name(cbe_idx)
    
    # 名前が見つかった場合は更新
    new_r = dict(r)
    if cbe_name:
        new_r["name"] = cbe_name
    updated_records.append(new_r)

# 更新後のレコードを保存
Path("data/wpns_pl_stats_decoded.json").write_text(
    json.dumps(updated_records, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(f"\n  wpns_pl_stats_decoded.json 更新: {len(updated_records)} レコード")

# ================================================================
# Step 3: ammo_table.json の完全版生成
# ================================================================
ammo_entries = {}
for r in updated_records:
    cbe_idx = r["cbeNameIndex"]
    if cbe_idx >= 225:  # ammo/gear items
        ammo_entries[cbe_idx] = {
            "cbeNameIndex": cbe_idx,
            "name": r["name"],
            "category_code": r["category_code"],
            "category_name": r["category_name"],
        }

print(f"\n  ammo_table entries: {len(ammo_entries)}")
print("  弾薬名一覧（最初の60件）:")
for idx in sorted(ammo_entries.keys())[:60]:
    e = ammo_entries[idx]
    print(f"    [{idx:3d}] {e['name']:25s} cat={e['category_name']}")

Path("data/ammo_table.json").write_text(
    json.dumps(ammo_entries, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(f"\n  → data/ammo_table.json 出力")

# ================================================================
# Step 4: 武器-弾薬マッピングを更新
# ================================================================
def get_ammo_name(ammo_idx):
    entry = ammo_entries.get(ammo_idx)
    if entry:
        return entry["name"]
    # string table から直接引く
    name = cbe_to_name(ammo_idx)
    return name or f"ammo_{ammo_idx}"

weapon_ammo_map = []
weapons = [r for r in updated_records if r["category_code"] <= 17]
for r in weapons:
    if r["ammo_indices"]:
        weapon_ammo_map.append({
            "weapon_cbeNameIndex": r["cbeNameIndex"],
            "weapon_name": r["name"],
            "category_name": r["category_name"],
            "ammo_indices": r["ammo_indices"],
            "ammo_names": [get_ammo_name(a) for a in r["ammo_indices"]],
        })

Path("data/weapon_ammo_map.json").write_text(
    json.dumps(weapon_ammo_map, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(f"  → data/weapon_ammo_map.json 出力 ({len(weapon_ammo_map)} entries)")

# サンプル表示
print("\n=== 武器-弾薬マッピング サンプル ===")
for entry in weapon_ammo_map[:40]:
    pairs = ", ".join(f"[{a}]{n}" for a, n in zip(entry["ammo_indices"], entry["ammo_names"]))
    print(f"  [{entry['weapon_cbeNameIndex']:3d}] {entry['weapon_name']:22s}: {pairs}")

# ================================================================
# Step 5: CSV の acceptsAmmoPlIndices を CBE 実値で更新
# ================================================================
print("\n=== CSV 更新: acceptsAmmoPlIndices ===")
csv_path = Path("data/wpns_pl_master_table.csv")
with open(csv_path, encoding="utf-8-sig") as f:
    rows = list(csv.DictReader(f))
    fieldnames = rows[0].keys() if rows else []

# weapon_ammo_map を辞書化
ammo_map_dict = {e["weapon_cbeNameIndex"]: e for e in weapon_ammo_map}

updated_rows = []
update_count = 0
for row in rows:
    cbe_idx = int(row["cbeNameIndex"])
    if cbe_idx in ammo_map_dict:
        old_val = row.get("acceptsAmmoPlIndices", "")
        new_val = json.dumps(ammo_map_dict[cbe_idx]["ammo_indices"])
        if old_val != new_val:
            row["acceptsAmmoPlIndices"] = new_val
            update_count += 1
    updated_rows.append(row)

print(f"  更新件数: {update_count}")

# CSV 書き出し
with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(updated_rows)
print(f"  → {csv_path} 更新完了")

# ================================================================
# Step 6: 全弾薬リストを表示
# ================================================================
print("\n=== 全弾薬リスト ===")
for idx in sorted(ammo_entries.keys()):
    e = ammo_entries[idx]
    # この弾薬を使う武器を探す
    users = [m["weapon_name"] for m in weapon_ammo_map if idx in m["ammo_indices"]]
    print(f"  [{idx:3d}] {e['name']:25s} cat={e['category_name']:12s} used_by: {', '.join(users[:4])}")
