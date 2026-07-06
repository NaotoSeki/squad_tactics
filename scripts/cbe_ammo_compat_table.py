# -*- coding: utf-8 -*-
"""
CBE.EXE の包括的な弾薬互換テーブルを探す。

weapon record の4スロット ammo_indices は主弾薬のみ保持。
7.92-5 が Kar98k 系で使えるなら、別の互換テーブルがある。

探索方針:
1. 弾薬 index → 対応武器 index の2次元マッピング
2. ammo record 自身の "ammo_indices" の意味を解析
3. 7.92-5(272) / 7.92-10G(273) を使う武器のクロスリファレンスを探す
"""
import json, struct
from pathlib import Path

CBE = Path('D:/PL/CBE.EXE')
data = CBE.read_bytes()
decoded = json.loads(Path('data/wpns_pl_stats_decoded.json').read_text(encoding='utf-8'))
name_tbl = json.loads(Path('data/cbe_name_table.json').read_text(encoding='utf-8'))
def name(idx): return name_tbl.get(str(idx), f'?{idx}')

TABLE_START = 0x1DDF00
STRIDE = 64

# === 1. ammo record 自身の ammo_indices の解析 ===
print('=== ammo record 自身の ammo_indices（cat=18）===')
ammo_recs = [r for r in decoded if r['category_code'] == 18]
for a in ammo_recs[:30]:
    if a['ammo_indices']:
        print(f'  [{a["cbeNameIndex"]:3d}] {name(a["cbeNameIndex"]):15s} -> {a["ammo_indices"]} = {[name(x) for x in a["ammo_indices"]]}')

# === 2. 7.92-5(272) の ammo_record ===
print('\n=== 7.92-5(272) ammo record ===')
a272 = next((r for r in decoded if r['cbeNameIndex'] == 272), None)
if a272:
    print(f'  ammo_indices: {a272["ammo_indices"]} = {[name(x) for x in a272["ammo_indices"]]}')
    print(f'  raw offset: {a272}')

# === 3. CBE.EXE に別の互換テーブルを探す ===
# 仮説: ammo_idx=272 と weapon_idx=57(Kar98k) が同じテーブル行にある
# バイナリで [57, 0, ..., 272, ...] のパターンを探す
# または [272, 57, ...] のパターンを探す

print('\n=== 7.92-5(272) と Kar98k(57) の共起パターン検索 ===')
target_ammo = 272
targets_weapon = [55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69]  # Kar98系
for wt in targets_weapon:
    # u16(272) と u16(wt) が 128 バイト以内に共存する位置を探す
    needle_a = struct.pack('<H', target_ammo)
    pos = 0
    while True:
        p = data.find(needle_a, pos)
        if p == -1: break
        # 前後128バイトでweapon idxを探す
        window = data[max(0,p-128):p+128]
        needle_w = struct.pack('<H', wt)
        if needle_w in window:
            off = window.index(needle_w)
            ctx_start = max(0, p-128)
            wpos = ctx_start + off
            dist = abs(p - wpos)
            if dist < 64 and dist % 2 == 0:
                # 近接しているか確認
                chunk = data[min(p, wpos):min(p, wpos)+64]
                u16s = [struct.unpack_from('<H', chunk, i)[0] for i in range(0, 64, 2)]
                if 272 in u16s and wt in u16s:
                    print(f'  ammo=272, weapon={wt}: co-found at 0x{min(p,wpos):06X}, dist={dist}')
                    print(f'    u16s: {u16s[:16]}')
        pos = p + 1

# === 4. ammo record の +44 以降を詳細解析 ===
# ammo record も 64-byte stride で格納されているが、
# ammo 自身の ammo_indices は何を意味するか?
# → ammo record の weapon_name_idx (=ammo_name_idx) が ammo index 自体
# → ammo record の +44-50 は "この弾薬を使う weapon categories" かもしれない
print('\n=== ammo record raw bytes for 7.92-5(272) and 7.92-10G(273) ===')
for ammo_idx in [272, 273]:
    off = TABLE_START + ammo_idx * STRIDE
    rec = data[off:off+64]
    u16s = [struct.unpack_from('<H', rec, i)[0] for i in range(0, 64, 2)]
    print(f'  [{ammo_idx}] {name(ammo_idx)}: {u16s}')
    # +44-50 = ammo_indices
    print(f'    +44-50: {u16s[22:26]} = {[name(x) for x in u16s[22:26] if x != 0]}')

# === 5. 7.92系の全ammoとKar98系の全weaponの詳細 ===
print('\n=== 7.92系弾薬の compatibility ===')
print('弾薬 272-277 の ammo record:')
for idx in range(272, 280):
    off = TABLE_START + idx * STRIDE
    rec = data[off:off+64]
    u16s = [struct.unpack_from('<H', rec, i)[0] for i in range(0, 64, 2)]
    ammo_slots = [u16s[i] for i in [22,23,24,25] if u16s[i] != 0]
    print(f'  [{idx}] {name(idx):12s}: ammo_slots={ammo_slots} = {[name(x) for x in ammo_slots]}')

print('\n=== Kar98系武器の ammo_indices ===')
kar_indices = [55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70]
for idx in kar_indices:
    w = next((r for r in decoded if r['cbeNameIndex'] == idx), None)
    if w:
        slots = w['ammo_indices']
        print(f'  [{idx:3d}] {name(idx):15s} cap={w["magazine_capacity"]:2d}: {slots} = {[name(x) for x in slots]}')

# === 6. CBE.EXE で ammo→weapon の逆引きテーブルを探す ===
# 7.92-5 が index 272 で、もし逆引きテーブルが存在するなら
# 272 → [55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66] のようなリストがあるはず
# テーブル形式候補: bit array (1 bit/weapon), u8 count + u8[] index list, etc.
print('\n=== 272(7.92-5) をバイナリで直接検索 ===')
needle_272 = struct.pack('<H', 272)
hits_272 = []
pos = 0
while True:
    p = data.find(needle_272, pos)
    if p == -1: break
    hits_272.append(p)
    pos = p + 1
print(f'  272 (\\x10\\x01) の出現: {len(hits_272)} 回')

# weapon record の ammo_indices 以外の場所だけ抽出
weapon_offsets = set()
for idx in range(400):
    base = TABLE_START + idx * STRIDE
    for slot in [22, 23, 24, 25]:
        weapon_offsets.add(base + slot * 2)

other_hits_272 = [p for p in hits_272 if p not in weapon_offsets and p % 2 == 0]
print(f'  weapon record 外の272: {len(other_hits_272)} 回')
for p in other_hits_272[:20]:
    ctx = data[max(0,p-8):p+16]
    u16s_ctx = [struct.unpack_from('<H', ctx, i)[0] for i in range(0, len(ctx)-1, 2)]
    print(f'    0x{p:06X}: {u16s_ctx}')
