# -*- coding: utf-8 -*-
"""
Phase 1-A (詳細): CBE.EXE 武器レコード構造の確定
0x1DDF04 付近に M1911A1 の全値（pen=39,pen_drop=4,acc=90,acc_drop=14,
malfunction=3,cost=200,cap=8）が確認済み。
ここからストライドと全フィールドオフセットを確定する。
"""
import struct
from pathlib import Path

CBE = Path("D:/PL/CBE.EXE")
data = CBE.read_bytes()

# M1911A1 のアンカー座標（cost=200 が 0x1DDF24 にあった）
ANCHOR_COST = 0x1DDF24

SAMPLES = {
    0:  dict(acc=90, melee=2, shots=2, cost=200, acc_drop=14, pen=39, pen_drop=4, malfunction=3, cap=8),
    1:  dict(acc=90, melee=2, shots=1, cost=100, acc_drop=13, pen=39, pen_drop=4, malfunction=1, cap=6),
    8:  dict(acc=60, melee=5, shots=2, cost=1900,acc_drop=5,  pen=76, pen_drop=3, malfunction=2, cap=8),
    41: dict(acc=90, melee=2, shots=2, cost=340, acc_drop=12, pen=40, pen_drop=6, malfunction=3, cap=10),
}

def u16(offset):
    return struct.unpack_from("<H", data, offset)[0]

def u8(offset):
    return data[offset]

# 0x1DDF04 周辺を詳細表示
print("=== 0x1DDE00 - 0x1DE200 のダンプ（M1911A1 周辺）===")
start = 0x1DDE00
for row in range(0, 0x400, 16):
    off = start + row
    if off >= len(data):
        break
    raw = data[off:off+16]
    hex_str = " ".join(f"{b:02x}" for b in raw)
    u16s = " ".join(f"{struct.unpack_from('<H', raw, i)[0]:5d}" for i in range(0, 16, 2))
    print(f"  {off:07X}: {hex_str}   | {u16s}")

print("\n=== M1911A1 アンカー確認 (cost=200 at 0x1DDF24) ===")
print(f"  u16 at 0x1DDF24 = {u16(0x1DDF24)} (expected 200)")

# M1911A1 確認済みオフセット（cost基準の相対オフセット）
# cost at +0:  0x1DDF24 = 200
# cap  at +4:  0x1DDF28 = ?
print("\n=== cost=200 を基点とした相対値 ===")
base = ANCHOR_COST
for i in range(-12, 20):
    off = base + i * 2
    if 0 <= off < len(data) - 1:
        v = u16(off)
        print(f"  +{i*2:+4d} (0x{off:06X}): {v:6d}  (0x{v:04X})")

print("\n=== ストライド探索: M1917S&W(idx1)を見つける ===")
# M1917 S&W: acc=90, shots=1, cost=100, acc_drop=13, pen=39, pen_drop=4, malfunction=1, cap=6
# acc=90(0x5A) と cost=100(0x64) の組み合わせを探す
for stride in range(16, 128, 2):
    cand = base + stride  # idx1のcost位置
    if cand + 40 >= len(data):
        continue
    cv = u16(cand)
    if cv != 100:
        continue
    # cost=100 が見つかった。他のフィールドも確認
    # cost-basedの同じオフセットで acc=90 を確認（base-20でaccが見つかった）
    for acc_offset in range(-20, 20, 2):
        acc_pos = cand + acc_offset
        if 0 <= acc_pos < len(data) - 1 and u16(acc_pos) == 90:
            # acc_dropも確認
            acc_drop_pos = acc_pos + 4  # accの次が shots、その次が acc_drop と仮定
            shots_pos = acc_pos + 2
            mal_pos = cand + (0x1DDF1C - base)
            cap_pos = cand + (0x1DDF28 - base)
            
            shots_v = u16(shots_pos) if 0 <= shots_pos < len(data)-1 else -1
            mal_v = u16(mal_pos) if 0 <= mal_pos < len(data)-1 else -1
            cap_v = u16(cap_pos) if 0 <= cap_pos < len(data)-1 else -1
            
            if shots_v == 1 and mal_v == 1 and cap_v == 6:
                print(f"  stride={stride}: cost@0x{cand:06X}=100, acc@0x{acc_pos:06X}=90, shots={shots_v}, mal={mal_v}, cap={cap_v} *** MATCH! ***")
            elif shots_v == 1 or mal_v == 1 or cap_v == 6:
                print(f"  stride={stride}: cost@0x{cand:06X}=100, acc@0x{acc_pos:06X}=90, shots={shots_v}, mal={mal_v}, cap={cap_v} (partial)")

print("\n=== 0x1DDF00 から100バイト詳細 ===")
for off in range(0x1DDE80, 0x1DE100, 2):
    v = u16(off)
    note = ""
    if v == 200: note = " << COST_M1911A1"
    if v == 100: note = " << COST_M1917"
    if v == 1900: note = " << COST_M1"
    if v == 340: note = " << COST_C96"
    if v == 90: note = " << ACC=90"
    if v == 39: note = " << PEN_M1911"
    if v == 76: note = " << PEN_M1Rifle"
    if note:
        print(f"  0x{off:06X}: {v:6d}{note}")
