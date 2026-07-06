# -*- coding: utf-8 -*-
"""
CBE.EXE の完全な武器・弾薬名テーブルを 0x2170F4 付近から抽出
"""
import json
import csv
import struct
from pathlib import Path

CBE = Path("D:/PL/CBE.EXE")
data = CBE.read_bytes()

# 0x2170F4 の M1917 S&W の直前を遡って先頭を見つける
m1917_pos = data.find(b"M1917 S&W", 0x217000)
m1911_pos2 = data.rfind(b"M1911A1", 0, m1917_pos)
print(f"M1911A1 (table2) @ 0x{m1911_pos2:06X}")
print(f"M1917 S&W (table2) @ 0x{m1917_pos:06X}")

# M1911A1 の前を調べる
before = data[m1911_pos2-100:m1911_pos2]
print(f"\n前100バイト: {before.hex(' ')}")
print(f"Printable: {bytes(b if 0x20<=b<0x7f else 0x2e for b in before).decode()}")

# M1911A1 の前で null を探し、テーブル開始を特定
scan = m1911_pos2 - 1
while scan > m1911_pos2 - 200 and data[scan] != 0:
    scan -= 1
# null の位置
prev_null = scan
# その前の文字列
str_before = data[prev_null-50:prev_null]
# さかのぼってテーブル先頭を探す
# (none) が見つかった場合、それ以前の null から始まる

print(f"\nprev_null @ 0x{prev_null:06X}")
print(f"str before null: {str_before}")

# 全部の名前を前のnullから後方に抽出
# まず (none) → M1911A1 → M1917 S&W ... と続く
pos = prev_null - 50
# もっと前まで遡る
while pos > m1911_pos2 - 1000:
    if data[pos] == 0 and data[pos+1] != 0:
        # ここが文字列の開始候補
        end = pos + 1
        while end < len(data) and data[end] != 0:
            end += 1
        raw = data[pos+1:end]
        try:
            name = raw.decode("ascii")
            if all(0x20 <= ord(c) < 0x7f for c in name) and len(name) >= 1:
                print(f"  @ 0x{pos+1:06X}: {name!r}")
        except:
            pass
    pos -= 1

# 実際にテーブル先頭から全文字列を抽出
# 2重NULLで始まるエントリの前が先頭か、または特別なマーカー
# まず全体を scan して null-terminated 文字列を収集
print("\n=== テーブル全体抽出（0x2170D0から） ===")
start = 0x2170D0
strings = []
pos = start
while pos < 0x218000 and len(strings) < 600:
    end = pos
    while end < len(data) and data[end] != 0:
        end += 1
    raw = data[pos:end]
    try:
        name = raw.decode("ascii")
        if all(0x20 <= ord(c) < 0x80 for c in name):
            strings.append((pos, name))
        else:
            strings.append((pos, f"<binary:{raw[:4].hex()}>"))
    except UnicodeDecodeError:
        strings.append((pos, f"<unicode:{raw[:4].hex()}>"))
    pos = end + 1
    if pos >= 0x218000:
        break

print(f"  抽出: {len(strings)} 件")
for i, (p, n) in enumerate(strings[:50]):
    print(f"  [{i:3d}] 0x{p:06X}: {n!r}")

print(f"\n  ... (showing from index 50) ...")
for i, (p, n) in enumerate(strings[50:120], start=50):
    print(f"  [{i:3d}] 0x{p:06X}: {n!r}")

print(f"\n  last 20 strings:")
for i, (p, n) in enumerate(strings[-20:], start=len(strings)-20):
    print(f"  [{i:3d}] 0x{p:06X}: {n!r}")
