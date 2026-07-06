# -*- coding: utf-8 -*-
"""
Phase 1-A 詳細: ストライド64, weapon_idx 1-indexed を確認し
全4サンプル武器のフィールドマッピングを確定する。

テーブル開始アドレス: 0x1DDF00 (weapon_idx=1=M1911A1)
ストライド: 64 bytes
weapon_idx = cbeNameIndex + 1 (仮説)
"""
import struct
from pathlib import Path

CBE = Path("D:/PL/CBE.EXE")
data = CBE.read_bytes()

TABLE_START = 0x1DDF00
STRIDE = 64

def record(idx_1based):
    """1-indexed weapon_idx のレコードを返す（64バイト）"""
    off = TABLE_START + (idx_1based - 1) * STRIDE
    return data[off:off + STRIDE]

def u16s(rec):
    """64バイトレコードを 32個の u16 に変換"""
    return [struct.unpack_from("<H", rec, i)[0] for i in range(0, 64, 2)]

SAMPLES = {
    0:  dict(acc=90, melee=2, shots=2, cost=200,  acc_drop=14, pen=39, pen_drop=4, malfunction=3, cap=8,  cbeNameIdx=0),
    1:  dict(acc=90, melee=2, shots=1, cost=100,  acc_drop=13, pen=39, pen_drop=4, malfunction=1, cap=6,  cbeNameIdx=1),
    8:  dict(acc=60, melee=5, shots=2, cost=1900, acc_drop=5,  pen=76, pen_drop=3, malfunction=2, cap=8,  cbeNameIdx=8),
    41: dict(acc=90, melee=2, shots=2, cost=340,  acc_drop=12, pen=40, pen_drop=6, malfunction=3, cap=10, cbeNameIdx=41),
}

print("=== 各サンプル武器のレコード（stride=64, 1-indexed） ===\n")
for sample_key, s in SAMPLES.items():
    dump_idx = s["cbeNameIdx"] + 1
    rec = record(dump_idx)
    vals = u16s(rec)
    _names = {0:"M1911A1", 1:"M1917S&W", 8:"M1 Rifle", 41:"C/96"}
    name = _names[sample_key]
    
    print(f"--- {name} (cbeNameIndex={s['cbeNameIdx']}, dump_idx={dump_idx}, offset=0x{TABLE_START+(dump_idx-1)*STRIDE:06X}) ---")
    print(f"  hex: {rec.hex(' ')}")
    print(f"  u16: {' '.join(f'{v:5d}' for v in vals)}")
    print(f"  expected: acc={s['acc']} melee={s['melee']} shots={s['shots']} cost={s['cost']} "
          f"acc_drop={s['acc_drop']} pen={s['pen']} pen_drop={s['pen_drop']} "
          f"malfunction={s['malfunction']} cap={s['cap']}")
    
    # 各フィールドを期待値と照合
    matches = {}
    for i, v in enumerate(vals):
        for field, expected in s.items():
            if field == "cbeNameIdx": continue
            if v == expected:
                matches[i*2] = field
    print(f"  field matches at offsets: {matches}")
    print()

print("=== フィールドオフセット照合 ===")
print("expected field → found offsets across 4 weapons")

field_offsets = {}
for sample_key, s in SAMPLES.items():
    dump_idx = s["cbeNameIdx"] + 1
    rec = record(dump_idx)
    vals = u16s(rec)
    for i, v in enumerate(vals):
        for field, expected in s.items():
            if field == "cbeNameIdx": continue
            if v == expected:
                if field not in field_offsets:
                    field_offsets[field] = []
                field_offsets[field].append((sample_key, i*2, v))

for field, hits in sorted(field_offsets.items()):
    # 同じオフセットで複数の武器が一致しているか
    offsets = [h[1] for h in hits]
    if len(set(offsets)) == 1:
        print(f"  {field:15s}: offset={offsets[0]:2d} (u16), consistent across {len(hits)} weapons *** CONFIRMED ***")
    else:
        print(f"  {field:15s}: offsets={offsets} (inconsistent) - hits: {hits}")

print("\n=== 全サンプルで一致するフィールドオフセットのまとめ ===")
# 全4サンプルで同じオフセットに一致したフィールドのみ表示
for field, hits in sorted(field_offsets.items()):
    weapon_keys = [h[0] for h in hits]
    offsets = [h[1] for h in hits]
    if len(set(offsets)) == 1 and len(hits) >= 2:
        print(f"  offset={offsets[0]:2d}: {field}")

print("\n=== cost フィールドの詳細確認 ===")
# M1911A1のcostは200(=0xC8)で一致。M1 Rifleのcostは?
for sample_key, s in SAMPLES.items():
    dump_idx = s["cbeNameIdx"] + 1
    rec = record(dump_idx)
    vals = u16s(rec)
    _names2 = {0:"M1911A1", 1:"M1917S&W", 8:"M1 Rifle", 41:"C/96"}
    name = _names2[sample_key]
    print(f"\n  {name}:")
    for i, v in enumerate(vals):
        print(f"    [{i*2:2d}] {v:6d} (0x{v:04X})", end="")
        # フラグ
        notes = []
        if v == s.get("acc"): notes.append("ACC")
        if v == s.get("pen"): notes.append("PEN")
        if v == s.get("pen_drop"): notes.append("PEN_DROP")
        if v == s.get("shots"): notes.append("SHOTS")
        if v == s.get("acc_drop"): notes.append("ACC_DROP")
        if v == s.get("malfunction"): notes.append("MAL")
        if v == s.get("melee"): notes.append("MELEE")
        if v == s.get("cost"): notes.append("COST ← exact match")
        if v == s.get("cap"): notes.append("CAP")
        if notes:
            print(f"  ← {', '.join(notes)}", end="")
        print()
