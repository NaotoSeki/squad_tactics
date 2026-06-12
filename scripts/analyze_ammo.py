import json, struct
from pathlib import Path

data = Path('D:/PL/CBE.EXE').read_bytes()
decoded = json.loads(Path('data/wpns_pl_stats_decoded.json').read_text(encoding='utf-8'))
name_tbl = json.loads(Path('data/cbe_name_table.json').read_text(encoding='utf-8'))

TABLE_START = 0x1DDF00
STRIDE = 64

def name(idx):
    return name_tbl.get(str(idx), f'?{idx}')

# 45ACP系の ammo index を探す
print('=== 45ACP 系弾薬 ===')
acp_indices = [i for i, n in name_tbl.items() if '45ACP' in n or '45acp' in n.lower()]
for idx_str in sorted(acp_indices, key=int):
    idx = int(idx_str)
    off = TABLE_START + idx * STRIDE
    rec = data[off:off+64]
    u16s = [struct.unpack_from('<H', rec, i)[0] for i in range(0, 64, 2)]
    print(f'  [{idx:3d}] {name(idx):15s}: all_u16={u16s}')

# M1928A1 の特定
print()
print('=== Thompson 系 ===')
thompson_indices = [i for i, n in name_tbl.items() if 'M1928' in n or 'Thompson' in n or 'M1A1T' in n]
for idx_str in sorted(thompson_indices, key=int):
    idx = int(idx_str)
    rec_data = next((r for r in decoded if r['cbeNameIndex'] == idx), None)
    if rec_data:
        ammo = rec_data.get('ammo_indices')
        malf = rec_data.get('malfunction_rate')
        mag = rec_data.get('magazine_capacity')
        print(f'  [{idx:3d}] {name(idx):15s}: ammo_indices={ammo}, malfunction={malf}, mag={mag}')
    else:
        print(f'  [{idx:3d}] {name(idx):15s}: (not in decoded)')

# タスク3: 全 ammo record フィールド一覧
print()
print('=== 全 ammo record フィールド一覧 ===')
ammo_recs = [r for r in decoded if r['category_code'] == 18]
print(f'total ammo: {len(ammo_recs)}')
header = f'{"idx":>4} {"name":15} {"pen":>5} {"pen_drop":>8} {"acc":>5} {"malf":>5} {"cost":>5} {"cap":>4} {"sub0":>5} {"sub1":>5} {"sub2":>5} {"sub3":>5}'
print(header)
for a in ammo_recs:
    idx = a['cbeNameIndex']
    off = TABLE_START + idx * STRIDE
    rec = data[off:off+64]
    u16s = [struct.unpack_from('<H', rec, i)[0] for i in range(0, 64, 2)]
    pen = u16s[4]      # +8
    pen_drop = u16s[5] # +10
    acc = u16s[8]      # +16
    malf = u16s[12]    # +24
    cost = u16s[18]    # +36
    cap = u16s[20]     # +40
    sub = [u16s[22], u16s[23], u16s[24], u16s[25]]
    print(f'  {idx:4d} {name(idx):15} {pen:5d} {pen_drop:8d} {acc:5d} {malf:5d} {cost:5d} {cap:4d} {sub[0]:5d} {sub[1]:5d} {sub[2]:5d} {sub[3]:5d}')

# タスク4: 全フィールドの生データ詳細（45ACP系に絞って）
print()
print('=== 45ACP 系 全32バイト u16 詳細 ===')
offset_labels = [f'+{i*2}' for i in range(32)]
for idx_str in sorted(acp_indices, key=int):
    idx = int(idx_str)
    off = TABLE_START + idx * STRIDE
    rec = data[off:off+64]
    u16s = [struct.unpack_from('<H', rec, i)[0] for i in range(0, 64, 2)]
    print(f'\n[{idx:3d}] {name(idx)}')
    for i, (label, val) in enumerate(zip(offset_labels, u16s)):
        marker = ''
        if val != 0:
            marker = f'  <-- {val}'
        print(f'  {label:4s} (u16[{i:2d}]): {val:6d}{marker}')
