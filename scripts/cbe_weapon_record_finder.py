# -*- coding: utf-8 -*-
"""
Phase 1-A: CBE.EXE 武器レコード構造の確定スクリプト

既知のサンプル値をアンカーとして CBE.EXE をスキャンし、
武器ステータステーブルのオフセット・ストライドを特定する。

既知サンプル値（攻略本）:
  M1911A1  (idx 0):  acc=90, melee=2, shots=2, cost=200, acc_drop=14, pen=39, pen_drop=4, malfunction=3, cap=8
  M1917S&W (idx 1):  acc=90, melee=2, shots=1, cost=100, acc_drop=13, pen=39, pen_drop=4, malfunction=1, cap=6
  M1 Rifle (idx 8):  acc=60, melee=5, shots=2, cost=1900,acc_drop= 5, pen=76, pen_drop=3, malfunction=2, cap=8
  C/96     (idx 41): acc=90, melee=2, shots=2, cost=340, acc_drop=12, pen=40, pen_drop=6, malfunction=3, cap=10
"""
import struct
from pathlib import Path

CBE = Path("D:/PL/CBE.EXE")
data = CBE.read_bytes()
print(f"CBE.EXE size: {len(data):,} bytes")

# 既知の値（u8 または u16 little-endian）
SAMPLES = {
    0:  dict(acc=90, melee=2, shots=2, cost=200, acc_drop=14, pen=39, pen_drop=4, malfunction=3, cap=8),
    1:  dict(acc=90, melee=2, shots=1, cost=100, acc_drop=13, pen=39, pen_drop=4, malfunction=1, cap=6),
    8:  dict(acc=60, melee=5, shots=2, cost=1900,acc_drop=5,  pen=76, pen_drop=3, malfunction=2, cap=8),
    41: dict(acc=90, melee=2, shots=2, cost=340, acc_drop=12, pen=40, pen_drop=6, malfunction=3, cap=10),
}

# ステップ1: cost=200 (u16 LE = c8 00) と cost=100 (u16 LE = 64 00) の出現位置を探す
# そして acc=90 (0x5a) が近くにあるか確認
def find_u16(val, start=0, end=None):
    end = end or len(data)
    b = struct.pack("<H", val)
    positions = []
    pos = start
    while True:
        pos = data.find(b, pos, end)
        if pos == -1:
            break
        positions.append(pos)
        pos += 1
    return positions

def find_u8(val, start=0, end=None):
    end = end or len(data)
    positions = []
    pos = start
    while True:
        if pos >= end:
            break
        if data[pos] == val:
            positions.append(pos)
        pos += 1
    return positions

print("\n=== cost=200 (u16 LE) の出現位置 ===")
cost200_positions = find_u16(200)
print(f"  total hits: {len(cost200_positions)}")

# コスト200の周辺に acc=90(0x5a) があるか確認
for pos in cost200_positions:
    window = data[max(0, pos-32):pos+32]
    if 0x5a in window:
        off = window.index(0x5a)
        dist = off - 32
        print(f"  0x{pos:06X}: 0x5A(90) at relative {dist:+d}")
        print(f"    hex: {window.hex(' ')}")

print("\n=== 全4サンプルを同時に満たすストライド探索 ===")
# アプローチ: cost値(u16)が acc(u8)より近くにある位置のクラスタを探す
# サンプル0のコスト=200, サンプル1のコスト=100 の2点間距離がストライドを示す

cost200_pos = set(find_u16(200))
cost100_pos = set(find_u16(100))

# 2点間の距離候補（ストライド候補）
stride_candidates = {}
for p200 in cost200_pos:
    for p100 in cost100_pos:
        diff = abs(p200 - p100)
        if 16 <= diff <= 128:
            stride_candidates[diff] = stride_candidates.get(diff, [])
            stride_candidates[diff].append((p200, p100))

print(f"  ストライド候補数: {len(stride_candidates)}")
top = sorted(stride_candidates.items(), key=lambda x: -len(x[1]))[:20]
for stride, pairs in top:
    print(f"  stride={stride}: {len(pairs)} 組")
    for p200, p100 in pairs[:3]:
        print(f"    p200=0x{p200:06X}, p100=0x{p100:06X}")

print("\n=== M1 Rifle(cost=1900)も加えた3点一致探索 ===")
# cost=1900 u16=0x076C
cost1900_pos = set(find_u16(1900))
print(f"  cost=1900 hits: {len(cost1900_pos)}")

for stride, pairs in top[:10]:
    for p200, p100 in pairs:
        # p200からstride*8離れた位置にcost=1900があるか
        for mult in range(-50, 51):
            target = p200 + mult * stride
            if target in cost1900_pos and target != p200:
                diff08 = mult  # 8番目のweaponはidx-0から8番先
                print(f"  stride={stride}: p200=0x{p200:06X}, p100=0x{p100:06X}, p1900=0x{target:06X} (mult={mult})")

print("\n=== コスト系列を直接探索（cost_200, cost_100が隣接している行） ===")
# M1911A1(cost=200) とM1917S&W(cost=100) は連続したレコードなので
# cost200+stride=cost100 となる stride を探す
for p200 in sorted(cost200_pos):
    for stride in [16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 48]:
        p100 = p200 + stride
        if p100 < len(data) - 2:
            v = struct.unpack_from("<H", data, p100)[0]
            if v == 100:
                # さらにstride先にcost=1900があるか
                p1900 = p200 + stride * 8  # idx0->idx8なので8ストライド先
                if 0 < p1900 < len(data) - 2:
                    v8 = struct.unpack_from("<H", data, p1900)[0]
                    if v8 == 1900:
                        print(f"  3点一致! stride={stride}, p200=0x{p200:06X}, p100=0x{p100:06X}, p1900=0x{p1900:06X}")
                        # C/96はidx41なのでstride*41先
                        p340 = p200 + stride * 41
                        if 0 < p340 < len(data) - 2:
                            v41 = struct.unpack_from("<H", data, p340)[0]
                            print(f"    C/96(idx41) cost at 0x{p340:06X} = {v41} (expected 340)")
