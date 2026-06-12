# -*- coding: utf-8 -*-
"""
Phase 2: CBE.EXE 弾薬名テーブルの完全抽出と ammo_table.json の生成

1. 0x21783E 付近の null-terminated 文字列テーブルを抽出
2. cbeNameIndex 225 から始まるアイテムと名前を対応付け
3. 武器レコードの ammo_indices と結合して ammo_table.json を生成
4. wpns_pl_master_table.csv の acceptsAmmoPlIndices を CBE 実値で更新
"""
import json
import csv
import struct
from pathlib import Path

CBE = Path("D:/PL/CBE.EXE")
data = CBE.read_bytes()

# ================================================================
# Step 1: 弾薬名テーブルの抽出
# 0x21783E 付近の null-terminated C 文字列テーブルを読み出す
# ================================================================
# まず弾薬名テーブルの開始位置を特定する
# "45ACP-7" は最初の ammo item (index 225) の名前（推定）
# その前に他のエントリが来る可能性がある

def find_string_table_start(near_pos, search_back=512):
    """null-terminated 文字列テーブルの開始位置を逆方向探索"""
    pos = near_pos
    # 逆方向にスキャンして、可読 ASCII テーブルの先頭を探す
    while pos > search_back:
        # 2バイト連続の 0x00 があったらそこが前のテーブルとの境界
        if data[pos] == 0 and data[pos-1] == 0:
            return pos + 1
        pos -= 1
    return near_pos

def extract_string_table(start_pos, max_strings=400, min_len=2, max_len=32):
    """null-terminated 文字列の配列を読み出す"""
    strings = []
    pos = start_pos
    while len(strings) < max_strings and pos < len(data):
        # 文字列の終端を探す
        end = pos
        while end < len(data) and data[end] != 0:
            end += 1
        s = data[pos:end]
        try:
            name = s.decode("ascii")
            if min_len <= len(name) <= max_len and all(0x20 <= ord(c) < 0x7f for c in name):
                strings.append((pos, name))
                pos = end + 1
            else:
                break
        except UnicodeDecodeError:
            break
    return strings

# 45ACP の位置を特定
ammo45_pos = data.find(b"45ACP-7")
print(f"45ACP-7 @ 0x{ammo45_pos:06X}")

# テーブル開始を逆方向探索
table_start = find_string_table_start(ammo45_pos)
print(f"Estimated table start: 0x{table_start:06X}")

# より大きな範囲でテーブルを探索
# まず前後を表示
print("\n=== 0x21785E-30 付近のバイト ===")
for off in range(ammo45_pos - 64, ammo45_pos + 16):
    b = data[off]
    ch = chr(b) if 0x20 <= b < 0x7f else "."
    if off == ammo45_pos:
        print(f">>> 0x{off:06X}: {b:02x} '{ch}'")
    else:
        print(f"    0x{off:06X}: {b:02x} '{ch}'")

# 文字列テーブルの実際の開始を見つける
# ammo45_pos より前にある文字列群を取得
print("\n=== テーブル抽出（前方向スキャン） ===")
# ammo45_pos から後方に文字列を抽出
strings_from_45 = extract_string_table(ammo45_pos, max_strings=200)
print(f"  抽出件数: {len(strings_from_45)}")
for i, (pos, name) in enumerate(strings_from_45[:50]):
    print(f"  [{i:3d}] 0x{pos:06X}: {name!r}")

# また前方も調べる
print("\n=== 逆方向スキャン（45ACP-7の前） ===")
pre_strings = []
scan_pos = ammo45_pos - 1
while scan_pos > ammo45_pos - 1024:
    # null 境界を探す
    if data[scan_pos] == 0:
        # null の直後から文字列が始まる
        str_start = scan_pos + 1
        str_end = ammo45_pos
        candidate = data[str_start:str_end]
        try:
            name = candidate.decode("ascii").rstrip("\x00")
            if 2 <= len(name) <= 32 and all(0x20 <= ord(c) < 0x7f for c in name):
                pre_strings.append((str_start, name))
                scan_pos -= 1
                ammo45_pos = str_start - 1
                continue
        except UnicodeDecodeError:
            pass
    scan_pos -= 1
    break

print(f"  前方で見つかった文字列: {pre_strings}")
