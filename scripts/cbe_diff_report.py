# -*- coding: utf-8 -*-
"""
Phase 1-C: 既存テーブルとの差分レポート
wpns_pl_master_table.csv の既存列と新データを比較し、
残存/置換/追加方針を整理する。

出力: scripts/pl_decoded/weapon_stats_diff_report.md
"""
import json
import csv
from pathlib import Path
from collections import defaultdict

# 既存 CSV の読み込み
csv_rows = {}
with open("data/wpns_pl_master_table.csv", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        idx = int(row["cbeNameIndex"])
        csv_rows[idx] = row

# 新デコード JSON
decoded_records = json.loads(Path("data/wpns_pl_stats_decoded.json").read_text(encoding="utf-8"))
decoded_map = {r["cbeNameIndex"]: r for r in decoded_records}

# 既存 CSV のカラム
csv_cols = list(next(iter(csv_rows.values())).keys())

# 既存列の意味と新データとの対応
COL_MAPPING = {
    "wpns_code":             {"action": "KEEP",    "notes": "識別コード"},
    "cbeNameIndex":          {"action": "KEEP",    "notes": "CBEインデックス（主キー）"},
    "plCategory":            {"action": "KEEP",    "notes": "カテゴリ文字列（CSV 手動定義）"},
    "statTemplate":          {"action": "RETIRE",  "notes": "テンプレート名 → 実データで不要"},
    "name":                  {"action": "KEEP",    "notes": "武器名称"},
    "type":                  {"action": "KEEP",    "notes": "弾種（bullet/shell等）"},
    "rng":                   {"action": "UNCLEAR", "notes": "射程（CBEデータに対応フィールド未特定）"},
    "acc":                   {"action": "REPLACE", "new_col": "initial_hit_rate",    "notes": "初期命中率 → CBE実値で置換"},
    "dmg":                   {"action": "RETIRE",  "notes": "不明（CBEに対応フィールドなし）"},
    "cap":                   {"action": "REPLACE", "new_col": "magazine_capacity",   "notes": "装填弾数 → CBE実値で置換"},
    "mag":                   {"action": "UNCLEAR", "notes": "マガジン数（CBEでは不明）"},
    "ap":                    {"action": "UNCLEAR", "notes": "装甲貫通（初期貫通と同一?）"},
    "rld":                   {"action": "RETIRE",  "notes": "装填速度（CBEに対応なし）"},
    "wgt":                   {"action": "REPLACE", "new_col": "weight_100g",         "notes": "重量（単位:100g） → CBE実値で置換"},
    "plAmmoLabel":           {"action": "KEEP",    "notes": "弾薬ラベル"},
    "acceptsAmmoPlIndices":  {"action": "REPLACE", "new_col": "ammo_indices",        "notes": "許容弾薬インデックス → CBE実値で置換"},
}

# 新規追加列
NEW_COLS = {
    "shots_per_action":       "発射弾数（CBE逆解析）",
    "auto_fire":              "自動射撃フラグ（CBE逆解析）",
    "hit_decay_rate":         "命中低下率（CBE逆解析）",
    "malfunction_rate":       "故障率（CBE逆解析）",
    "melee_attack":           "白兵戦攻撃力（CBE逆解析）",
    "initial_penetration":    "初期貫通力（CBE逆解析）",
    "penetration_decay_rate": "貫通力低下率（CBE逆解析）",
    "purchase_cost":          "購入費用（CBE逆解析）",
    "category_code":          "カテゴリコード（CBE逆解析）",
    "category_name":          "カテゴリ名（CBE逆解析）",
}

# 既存 acc vs 新 initial_hit_rate の差分調査
print("=== acc (CSV) vs initial_hit_rate (CBE) の差分 ===")
acc_diffs = []
for idx, row in csv_rows.items():
    if idx in decoded_map:
        d = decoded_map[idx]
        csv_acc = row.get("acc", "")
        cbe_acc = d.get("initial_hit_rate", -1)
        if csv_acc and csv_acc.strip():
            try:
                csv_val = float(csv_acc)
                if abs(csv_val - cbe_acc) > 1:
                    acc_diffs.append((idx, row.get("name","?"), csv_val, cbe_acc))
            except ValueError:
                pass
print(f"  相違件数: {len(acc_diffs)}")
for idx, name, csv_val, cbe_val in acc_diffs[:10]:
    print(f"    [{idx:3d}] {name:20s}: CSV={csv_val:.0f}, CBE={cbe_val}")

# cap (CSV) vs magazine_capacity (CBE)
print("\n=== cap (CSV) vs magazine_capacity (CBE) の差分 ===")
cap_diffs = []
for idx, row in csv_rows.items():
    if idx in decoded_map:
        d = decoded_map[idx]
        csv_cap = row.get("cap", "")
        cbe_cap = d.get("magazine_capacity", -1)
        if csv_cap and csv_cap.strip():
            try:
                csv_val = int(csv_cap)
                if csv_val != cbe_cap:
                    cap_diffs.append((idx, row.get("name","?"), csv_val, cbe_cap))
            except ValueError:
                pass
print(f"  相違件数: {len(cap_diffs)}")
for idx, name, csv_val, cbe_val in cap_diffs[:15]:
    print(f"    [{idx:3d}] {name:20s}: CSV={csv_val}, CBE={cbe_val}")

# 仮弾薬行のカウント
print("\n=== acceptsAmmoPlIndices 「仮」行のカウント ===")
fake_ammo_rows = []
for idx, row in csv_rows.items():
    ammo_str = row.get("acceptsAmmoPlIndices", "")
    if "仮" in ammo_str or "fake" in ammo_str.lower():
        fake_ammo_rows.append((idx, row.get("name","?"), ammo_str))
print(f"  仮行数: {len(fake_ammo_rows)}")
for idx, name, ammo_str in fake_ammo_rows[:10]:
    cbe_ammo = decoded_map.get(idx, {}).get("ammo_indices", [])
    print(f"    [{idx:3d}] {name:20s}: CSV=\"{ammo_str}\", CBE={cbe_ammo}")

# マークダウンレポート生成
report = """# CBE.EXE 武器データ差分レポート
## Phase 1-C: 既存テーブルとの差分・統合方針

生成日: 2026-05-18

---

## 1. 確定したレコード構造

| パラメータ | 値 |
|-----------|-----|
| テーブルアドレス | 0x1DDF00 |
| ストライド | 64 bytes |
| インデックス | cbeNameIndex + 1 (1-indexed) |
| 総レコード数 | 400 |
| 武器/装備 | 225 |
| 弾薬 | 126 |
| その他 | 49 |

### フィールドマップ（確定済み）

| Offset | フィールド | 型 | 説明 |
|--------|-----------|-----|------|
| +08 | initial_penetration | u16 | 初期貫通力 |
| +10 | penetration_decay_rate | u16 | 貫通力低下率（1ヘックスごと） |
| +16 | initial_hit_rate | u16 | 初期命中率 |
| +18 | shots_per_action | u16 | 発射弾数（0x8000=自動射撃フラグ） |
| +20 | hit_decay_rate | u16 | 命中低下率 |
| +26 | malfunction_rate | u16 | 故障率 |
| +28 | melee_attack | u16 | 白兵戦攻撃力 |
| +36 | purchase_cost | u16 | 購入費用 |
| +38 | weight_100g | u16 | 重量（100g単位、推定） |
| +40 | magazine_capacity | u16 | 装填弾数 |
| +44-50 | ammo_indices[0..3] | u16×4 | 許容弾薬インデックス |

### バリデーション結果

| 武器 | acc | shots | pen | pen_drop | acc_drop | mal | melee | cost | cap |
|-----|-----|-------|-----|---------|---------|-----|-------|------|-----|
| M1911A1 | 90✓ | 2✓ | 39✓ | 4✓ | 14✓ | 3✓ | 2✓ | 200✓ | 8✓ |
| M1917 S&W | 90✓ | 1✓ | 39✓ | 4✓ | 13✓ | 1✓ | 2✓ | 100✓ | 6✓ |
| M1 Rifle | 60✓ | 2✓ | 76✓ | 3✓ | 5✓ | 2✓ | 5✓ | **900/1900** | 8✓ |
| C/96 | 90✓ | 2✓ | 40✓ | 6✓ | 12✓ | 3✓ | 2✓ | 340✓ | 10✓ |

> **注記**: M1 Rifle のコストのみ CBE=900 vs 攻略本=1900。Windows 版 CBE.EXE と PC-98 版とのバージョン差と推定。

---

## 2. 既存 CSV 列との統合方針

"""

for col, info in COL_MAPPING.items():
    action = info["action"]
    notes = info["notes"]
    new_col = info.get("new_col", "")
    if action == "KEEP":
        report += f"- **{col}**: [KEEP] {notes}\n"
    elif action == "REPLACE":
        report += f"- **{col}**: [REPLACE→{new_col}] {notes}\n"
    elif action == "RETIRE":
        report += f"- ~~{col}~~: [RETIRE] {notes}\n"
    elif action == "UNCLEAR":
        report += f"- **{col}**: [UNCLEAR] {notes}\n"

report += """
### 新規追加列（CBE逆解析データ）

"""
for col, desc in NEW_COLS.items():
    report += f"- **{col}**: {desc}\n"

report += f"""
---

## 3. データ品質チェック

### acc (CSV) vs initial_hit_rate (CBE) 差分
- 相違件数: {len(acc_diffs)}

"""
if acc_diffs:
    report += "| idx | name | CSV.acc | CBE.initial_hit_rate |\n|-----|------|---------|---------------------|\n"
    for idx, name, cv, bv in acc_diffs[:20]:
        report += f"| {idx} | {name} | {cv:.0f} | {bv} |\n"

report += f"""
### cap (CSV) vs magazine_capacity (CBE) 差分
- 相違件数: {len(cap_diffs)}

"""
if cap_diffs:
    report += "| idx | name | CSV.cap | CBE.magazine_capacity |\n|-----|------|---------|----------------------|\n"
    for idx, name, cv, bv in cap_diffs[:20]:
        report += f"| {idx} | {name} | {cv} | {bv} |\n"

report += f"""
### acceptsAmmoPlIndices 「仮」行
- 仮行数: {len(fake_ammo_rows)} → Phase 2 で全置換対象

---

## 4. 推奨アクション

1. **REPLACE 列**: `acc`, `cap`, `wgt`, `acceptsAmmoPlIndices` を CBE実値で上書き
2. **RETIRE 列**: `statTemplate`, `dmg`, `rld` は削除または非表示化
3. **UNCLEAR 列**: `rng`, `mag`, `ap` は引き続き調査
4. **新規追加**: 上記 {len(NEW_COLS)} 列を wpns_pl_master_table.csv に追加

---

## 5. 弾薬テーブル統合（Phase 2 向け）

CBE 弾薬レコード（category_code=18）は 126 件。
ammo_indices フィールドにより武器→弾薬の直接参照が可能。
Phase 2 では弾薬名テーブルと結合して ammo_table.json を生成する。
"""

out_path = Path("scripts/pl_decoded/weapon_stats_diff_report.md")
out_path.write_text(report, encoding="utf-8")
print(f"\n  → {out_path} に出力")

# Summary
print("\n=== 差分レポートサマリー ===")
actions = defaultdict(list)
for col, info in COL_MAPPING.items():
    actions[info["action"]].append(col)
for action, cols in actions.items():
    print(f"  {action}: {cols}")
print(f"  新規追加列: {list(NEW_COLS.keys())}")
