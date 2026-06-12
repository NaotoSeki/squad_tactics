# -*- coding: utf-8 -*-
"""
CBE.EXE の武器名テーブルを正しく特定する。
weapon_name_idx=1 が M1911A1、idx=2 が M1917 S&W という順序で
連続している文字列配列を探す。
"""
import struct
from pathlib import Path

CBE = Path('D:/PL/CBE.EXE')
data = CBE.read_bytes()

# すべての "M1911A1\0" 位置
hits_m1911 = []
pos = 0
while True:
    p = data.find(b'M1911A1\x00', pos)
    if p == -1: break
    hits_m1911.append(p)
    pos = p + 1
print(f'M1911A1\\0 hits: {[hex(p) for p in hits_m1911]}')

# "M1917" の位置
hits_m1917 = []
pos = 0
while True:
    p = data.find(b'M1917', pos)
    if p == -1: break
    hits_m1917.append(p)
    pos = p + 1
print(f'M1917 hits: {len(hits_m1917)} total')

# M1911A1 の直後に M1917 が来るパターンを探す
print('\n=== M1911A1 直後に M1917 のパターン ===')
for h1 in hits_m1911:
    end1 = data.find(b'\x00', h1) + 1  # M1911A1\0 の次バイト
    # end1 から 30 バイト以内に "M1917" があるか
    window = data[end1:end1+50]
    if b'M1917' in window:
        print(f'  M1911A1 at 0x{h1:06X}, next: {window}')

# CBE の weapon record から name_ptr の逆引き
# TABLE_START=0x1DDF00, stride=64, weapon_name_idx(u16@0) = cbeNameIndex+1
TABLE_START = 0x1DDF00
STRIDE = 64

print('\n=== weapon_name_idx のオフセット逆引き ===')
# idx=1(M1911A1), idx=2(M1917 S&W) それぞれのレコードを確認済み
# → テーブルは 0x1DDF00 から始まり、各レコードの先頭u16がname_idx
# name_idx はオフセットテーブル or 直接文字列配列 ?

# CBE.EXE に名前オフセットテーブルがある可能性: 
# u16/u32 の配列で各要素が文字列へのオフセット
# M1911A1 の文字列アドレスをターゲットとしてオフセットテーブルを探す

for h1 in hits_m1911:
    # h1 の値を u16 として持つ場所（近セグメントオフセット）
    lo_bytes = struct.pack('<H', h1 & 0xFFFF)
    seg_off = data.find(lo_bytes)
    if seg_off > 0:
        ctx = data[seg_off-4:seg_off+16]
        # print(f'  0x{h1:06X} u16-lo found at 0x{seg_off:06X}: {ctx.hex()}')

# 別アプローチ: 既知の名前 CSV から名前→位置マッピングを作り、
# cbeNameIndex 順に文字列が並んでいる範囲を特定
known_names_ordered = [
    'M1911A1', 'M1917 S&W', 'M1917 Colt', 'OSS', 'AN-M8',
    'M1903A1', 'M1903A4', 'M1918A2 BAR', 'M1 Rifle', 'M1C Rifle',
    'M1D Rifle', 'M1941 Rifle', 'M1 Cbn', 'M1A1 Cbn', 'M2 Cbn',
    'M1928A1 SMG', 'M1 SMG', 'M1A1 SMG', 'M3 SMG', 'M3A1 SMG',
]

print('\n=== 各名前の CBE.EXE 内位置 ===')
name_positions = {}
for name in known_names_ordered:
    needle = name.encode('ascii') + b'\x00'
    p = data.find(needle)
    if p == -1:
        # スペース無しで試す
        needle2 = name.replace(' ', '').encode('ascii') + b'\x00'
        p = data.find(needle2)
        if p != -1:
            name = name.replace(' ', '')
    name_positions[name] = p
    print(f'  "{name:20s}" -> 0x{p:06X} ({p})')

# 連続しているか確認
print('\n=== 連続性チェック ===')
positions = [(n, p) for n, p in name_positions.items() if p != -1]
positions.sort(key=lambda x: x[1])
for i in range(1, len(positions)):
    prev_n, prev_p = positions[i-1]
    cur_n, cur_p = positions[i]
    gap = cur_p - prev_p - len(prev_n) - 1
    cont = "CONT" if gap == 0 else f"gap={gap}"
    print(f'  0x{prev_p:06X} "{prev_n}" -> 0x{cur_p:06X} "{cur_n}" [{cont}]')
