# -*- coding: utf-8 -*-
"""Thompson / 装填フィルタ仮説: weapon ammo_indices vs mag_type_group / +54 flag."""
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CBE = Path("D:/PL/CBE.EXE").read_bytes()
decoded = json.loads((ROOT / "data/wpns_pl_stats_decoded.json").read_text(encoding="utf-8"))
names = json.loads((ROOT / "data/cbe_name_table.json").read_text(encoding="utf-8"))
TABLE = 0x1DDF00
STRIDE = 64


def name(i):
    return names.get(str(i), f"?{i}")


def u16s(idx):
    off = TABLE + idx * STRIDE
    return [struct.unpack_from("<H", CBE, off + i)[0] for i in range(0, 64, 2)]


def weapon_row(idx):
    w = next((r for r in decoded if r["cbeNameIndex"] == idx), None)
    u = u16s(idx)
    return {
        "idx": idx,
        "name": name(idx),
        "ammo_indices": w["ammo_indices"] if w else [],
        "mag_cap": w.get("magazine_capacity") if w else None,
        "malf": w.get("malfunction_rate") if w else None,
        "u21_mag_type_group": u[21],
        "u27_flag": u[27],
        "u22_25": u[22:26],
    }


print("=== Thompson 系武器 ===")
for idx in [15, 16, 17]:
    r = weapon_row(idx)
    ammo_names = [name(x) for x in r["ammo_indices"]]
    print(f"  [{r['idx']:2d}] {r['name']:14s} ammo={r['ammo_indices']} {ammo_names}")
    print(f"       mag_cap={r['mag_cap']} malf={r['malf']} weapon_u21={r['u21_mag_type_group']} u27={r['u27_flag']}")

print("\n=== 45ACP 弾薬行 ===")
for ai in [234, 235, 236, 237]:
    u = u16s(ai)
    print(
        f"  [{ai}] {name(ai):12s} mag_type_group={u[21]:3d} "
        f"sub_links={u[22:26]} flag_u27={u[27]:3d} malf_mod={u[13]}"
    )

print("\n=== 仮説: weapon ammo_indices が UI 候補、+54(ammo)/mag_type で形状フィルタ？ ===")
print("M1/M1A1 に 236 があるか:")
for idx in [16, 17]:
    w = next((r for r in decoded if r["cbeNameIndex"] == idx), None)
    if w:
        print(f"  [{idx}] {name(idx)}: {w['ammo_indices']} -> {[name(x) for x in w['ammo_indices']]}")

print("\n=== ammo_indices に 236 を含む全武器 ===")
for w in decoded:
    if w.get("category_code", 99) > 17:
        continue
    if 236 in (w.get("ammo_indices") or []):
        print(f"  [{w['cbeNameIndex']:3d}] {w['name']}")

print("\n=== Kar98b (56): ammo_indices vs 7.92-5(272) 不在 ===")
w56 = next((r for r in decoded if r["cbeNameIndex"] == 56), None)
if w56:
    print(f"  ammo_indices={w56['ammo_indices']} -> {[name(x) for x in w56['ammo_indices']]}")
    print("  (272=7.92-5 はスロットに無いが PL プレイで使える報告あり → 別フィルタ/拡張テーブル疑い)")

print("\n=== u16[27] weapon-ammo shape flag hypothesis ===")
print("  65 = ドラム/旧式レシーバー系, 1 = スティック/ボックス系 (ammo_field_analysis.md 参照)")


def ammo_u27(ai):
    return u16s(ai)[27]


def weapon_u27(wi):
    return u16s(wi)[27]


for wi in [15, 16, 17]:
    wu = weapon_u27(wi)
    w = next(r for r in decoded if r["cbeNameIndex"] == wi)
    print(f"\n  W[{wi}] {name(wi)} weapon_u27={wu}")
    for ai in w["ammo_indices"]:
        au = ammo_u27(ai)
        # 仮説: M1系(u27=1)は ammo_u27=1 のみ UI 可、M1928(u27=65)は両方可
        ui_guess = (wu == 65) or (au == wu)
        print(f"    ammo[{ai}] {name(ai):12s} ammo_u27={au:3d}  UI可(仮説)={ui_guess}")

print("\n=== 7.92-5(272) を ammo record sub_links / 逆引きで持つ弾 ===")
for a in decoded:
    if a.get("category_code") != 18:
        continue
    subs = a.get("ammo_indices") or []
    if 272 in subs or any(x == 272 for x in subs):
        print(f"  ammo[{a['cbeNameIndex']}] {a['name']} sub_links={subs}")

# 7.92-10G sub_links from raw
u273 = u16s(273)
print(f"\n7.92-10G raw sub_links u22-25 = {u273[22:26]} -> {[name(x) for x in u273[22:26] if x]}")

print("\n=== ammo_indices 4スロット外: 7.92-5 を Kar98 系が使う根拠探索 ===")
# 7.92-10G(273) sub_link 71 = FG42? check name
for x in u273[22:26]:
    if x:
        print(f"  7.92-10G sub_link {x} = {name(x)}")
