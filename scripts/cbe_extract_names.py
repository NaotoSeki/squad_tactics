# -*- coding: utf-8 -*-
"""
CBE.EXE 武器・弾薬名テーブル正式抽出。
M1911A1 の位置を起点に null 終端文字列配列として前方に読む。
"""
import json, struct
from pathlib import Path

CBE = Path('D:/PL/CBE.EXE')
data = CBE.read_bytes()

# M1911A1\0 の最初のヒット
hit_m1911 = data.index(b'M1911A1\x00')
print(f'M1911A1 at 0x{hit_m1911:06X}')

# M1911A1 の前に1バイトの \x00 があるか（index 0 = 空文字列の可能性）
print(f'  byte before: 0x{data[hit_m1911-1]:02X}')
print(f'  byte -2: 0x{data[hit_m1911-2]:02X}')
print(f'  byte -3: 0x{data[hit_m1911-3]:02X}')

# 前後 256 バイトをダンプして先頭を推定
pre = data[hit_m1911-32:hit_m1911+128]
print(f'\n前後dump: {pre}')

# --- テーブル先頭を手動特定 ---
# 直前が \x00 なら M1911A1 が idx=0 (table_start = hit_m1911)
# 直前が別の文字列なら、その文字列が idx=0
# 安全策: hit_m1911 の直前をまず確認
prev_null = data.rindex(b'\x00', hit_m1911 - 32, hit_m1911)
table_start_candidate = prev_null + 1
prev_string = data[table_start_candidate:hit_m1911].rstrip(b'\x00')
print(f'\n直前文字列: "{prev_string}"  → table_start = 0x{table_start_candidate:06X}')

# table_start から順読み: この手法が安全
# hit_m1911 の前の文字列から辿って、連続ASCII null-terminated 配列の先頭を探す
# 一定個数（例えば50個）遡る
def read_strings_forward(start, count=500):
    pos = start
    result = []
    while len(result) < count and pos < len(data):
        end = data.find(b'\x00', pos)
        if end == -1:
            break
        s = data[pos:end]
        if len(s) > 24 or (s and not all(0x20 <= b < 0x80 for b in s)):
            break  # 非ASCII か長すぎる → テーブル終端
        result.append((len(result), pos, s.decode('ascii', errors='replace')))
        pos = end + 1
    return result

# まず M1911A1 位置から forward read して何個連続するか確認
fwd_from_m1911 = read_strings_forward(hit_m1911, 500)
print(f'\nM1911A1 から forward: {len(fwd_from_m1911)} エントリ')
print('最初の10件:')
for i, addr, name in fwd_from_m1911[:10]:
    print(f'  [rel+{i}] 0x{addr:06X}: "{name}"')
print('...')
print('最後の5件:')
for i, addr, name in fwd_from_m1911[-5:]:
    print(f'  [rel+{i}] 0x{addr:06X}: "{name}"')

# M1911A1 が cbeNameIndex=0 なので rel+0=idx0
# => absolute index = rel_offset
by_cbe_idx = {i: n for i, _, n in fwd_from_m1911}

print('\n=== キー検証 ===')
for idx in [0, 1, 57, 234, 272, 273, 54]:
    print(f'  [{idx:3d}] "{by_cbe_idx.get(idx, "NOT FOUND")}"')

# 弾薬域 225-260
print('\n=== 弾薬域 225-270 ===')
for idx in range(225, 271):
    n = by_cbe_idx.get(idx, '')
    if n:
        print(f'  [{idx:3d}] "{n}"')

# 27mmStuP の ammo 確認
print('\n=== 27mmStuP (idx 54) の ammo_indices ===')
decoded = json.loads(Path('data/wpns_pl_stats_decoded.json').read_text(encoding='utf-8'))
w54 = next((r for r in decoded if r['cbeNameIndex'] == 54), None)
if w54:
    for ai in w54['ammo_indices']:
        print(f'  [{ai}] "{by_cbe_idx.get(ai, "?")}"')

# M1A1 Cbn (idx 13) の ammo
print('\n=== M1A1 Cbn (idx 13) の ammo_indices ===')
w13 = next((r for r in decoded if r['cbeNameIndex'] == 13), None)
if w13:
    for ai in w13['ammo_indices']:
        print(f'  [{ai}] "{by_cbe_idx.get(ai, "?")}"')

# --- JSON 保存 ---
name_table = {str(i): n for i, _, n in fwd_from_m1911}
Path('data/cbe_name_table.json').write_text(
    json.dumps(name_table, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'\n→ data/cbe_name_table.json: {len(name_table)} エントリ')
