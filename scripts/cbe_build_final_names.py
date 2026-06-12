# -*- coding: utf-8 -*-
"""
CBE.EXE 武器・弾薬名テーブル正式抽出
テーブル開始: 0x2170EC (M1911A1 が cbeNameIndex=0)
"""
import json, csv
from pathlib import Path

CBE = Path('D:/PL/CBE.EXE')
data = CBE.read_bytes()

TABLE_ADDR = 0x2170EC  # M1911A1 の開始位置

def read_all_names(start, max_count=500):
    pos = start
    names = []
    while len(names) < max_count and pos < len(data):
        end = data.find(b'\x00', pos)
        if end == -1:
            break
        s = data[pos:end]
        # 有効性チェック: ASCII 印字可能 or 空文字列
        if s and not all(0x20 <= b < 0x80 for b in s):
            # 日本語等の非 ASCII → テーブル終端と判断
            break
        names.append((len(names), pos, s.decode('ascii', errors='replace')))
        pos = end + 1
    return names

names = read_all_names(TABLE_ADDR, 500)
print(f'名前テーブル読み出し: {len(names)} エントリ')

by_idx = {i: n for i, _, n in names}

# === 既知名との照合 ===
print('\n=== 既知名照合 ===')
expected = {
    0: 'M1911A1', 1: 'M1917 S&W', 2: 'M1917 Colt', 3: 'OSS', 4: 'AN-M8',
    5: 'M1903A1', 6: 'M1903A4', 7: 'M1918A2 BAR', 8: 'M1 Rifle', 9: 'M1C Rifle',
    10: 'M1D Rifle', 11: 'M1941 Rifle', 12: 'M1 Cbn', 13: 'M1A1 Cbn',
    41: 'C/96', 57: 'Kar98k', 76: 'StG44',
}
all_ok = True
for idx, exp in expected.items():
    actual = by_idx.get(idx, 'NOT FOUND')
    ok = actual == exp
    if not ok: all_ok = False
    mark = 'OK' if ok else f'NG (got "{actual}")'
    print(f'  [{idx:3d}] {mark:30s}  expected="{exp}"')
print(f'\n全照合: {"OK" if all_ok else "NG - 修正必要"}')

# === 弾薬域の正式名称 ===
print('\n=== 弾薬・アイテム域 (index 220-280) ===')
for i in range(220, 281):
    n = by_idx.get(i, '')
    if n:
        print(f'  [{i:3d}] "{n}"')

# === 27mmStuP の ammo 正式名 ===
print('\n=== 27mmStuP (idx 54) ammo 正式名 ===')
decoded = json.loads(Path('data/wpns_pl_stats_decoded.json').read_text(encoding='utf-8'))
w54 = next((r for r in decoded if r['cbeNameIndex'] == 54), None)
if w54:
    print(f'  CBE ammo_indices: {w54["ammo_indices"]}')
    for ai in w54['ammo_indices']:
        print(f'    [{ai}] "{by_idx.get(ai, "?")}"')

# === M1A1 Cbn の ammo 正式名 ===
print('\n=== M1A1 Cbn (idx 13) ammo 正式名 ===')
w13 = next((r for r in decoded if r['cbeNameIndex'] == 13), None)
if w13:
    for ai in w13['ammo_indices']:
        print(f'  [{ai}] "{by_idx.get(ai, "?")}"')

# === Kar98k (idx 57) の ammo ===
print('\n=== Kar98k (idx 57) ammo 正式名 ===')
w57 = next((r for r in decoded if r['cbeNameIndex'] == 57), None)
if w57:
    for ai in w57['ammo_indices']:
        print(f'  [{ai}] "{by_idx.get(ai, "?")}"')

# === decoded JSON を正式名で更新 ===
print('\n=== JSON 更新 ===')
updated = 0
for r in decoded:
    idx = r['cbeNameIndex']
    official_name = by_idx.get(idx)
    if official_name is not None and official_name != r.get('name', ''):
        r['name'] = official_name
        updated += 1

Path('data/wpns_pl_stats_decoded.json').write_text(
    json.dumps(decoded, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'  wpns_pl_stats_decoded.json: {updated} 件名称更新')

# === CSV の name 列も更新 ===
csv_path = Path('data/wpns_pl_master_table.csv')
with open(csv_path, encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    rows = list(reader)

csv_updated = 0
for row in rows:
    idx = int(row['cbeNameIndex'])
    official = by_idx.get(idx)
    if official and official != row.get('name', ''):
        row['name'] = official
        csv_updated += 1

import io
buf = io.StringIO()
writer = csv.DictWriter(buf, fieldnames=fieldnames, lineterminator='\n')
writer.writeheader()
writer.writerows(rows)
csv_path.write_text('\ufeff' + buf.getvalue(), encoding='utf-8')
print(f'  wpns_pl_master_table.csv: {csv_updated} 件名称更新')

# === 名前テーブル JSON 保存 ===
name_table_out = {str(i): n for i, _, n in names}
Path('data/cbe_name_table.json').write_text(
    json.dumps(name_table_out, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'  cbe_name_table.json: {len(name_table_out)} エントリ')

# === 最初の30 と 220-280 を表示 ===
print('\n=== 最初の 30 エントリ ===')
for i, _, n in names[:30]:
    print(f'  [{i:3d}] "{n}"')
