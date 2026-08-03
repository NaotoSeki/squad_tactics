# Platoon Leader item-link audit (2026-07-12)

## Outcome

Squad Tactics now uses the old game's exact item links as the final runtime
authority. The former caliber/magazine heuristics no longer broaden a weapon's
feed beyond the links encoded by Platoon Leader.

Baseline audit of the 189 infantry weapons in CBE categories 1-11:

| Result | Before | After |
|---|---:|---:|
| Exact weapon/feed matches | 53 | 189 |
| Mismatched weapons | 136 | 0 |
| Weapons with at least one unsafe extra ammo link | 104 | 0 |
| Weapons with no ammo despite a valid legacy feed | 18 | 0 |

The exhaustive runtime regression test also checks all 240 published rows
(225 infantry large items and 15 AFV mounted-weapon records).

## Index rule and evidence

The CBE 64-byte item records store linked items as **one-based raw item IDs**.
Squad Tactics and the decoded name table use the **zero-based**
`cbeNameIndex`.

The verified source executable is `D:\PL\CBE.EXE` (2,247,424 bytes,
SHA-256 `7EF70D11CF65B30E2FAC90522FFDEE0DA9E5D68DC09AF8E7FBE9F9710D1C652D`).

```text
non-zero raw item ID N  ->  cbeNameIndex N - 1
```

The [Platoon Leader remodel code list](http://drunker.s4.xrea.com/another01_pl_remodel.shtml)
numbers the first large item as `01h M1911A1` and its ammunition as
`E2h 45ACP-7`. The CBE link value for M1911A1 is decimal 226 (`E2h`);
therefore the matching Squad Tactics row is index 225, not 226. The same
one-row displacement explained the P08 -> .32 ACP, M1919A4 -> bazooka rocket,
and M2HB ammunition-box -> binocular errors.

The decoded JSON now preserves both representations:

- `ammo_raw_item_ids`: original one-based CBE values
- `ammo_indices`: normalized zero-based Squad Tactics indices

## Representative corrected feeds

| Weapon (CBE index) | Effective ammo | Ammo box | Tripod |
|---|---|---:|---:|
| M1911A1 (0) | 45ACP-7 (225) | - | - |
| P08 (43) | 9Pb-8L (258) | - | - |
| M1919A6 (20) | 3006-200/250 (239, 240) | M1 Ammobox (34) | M2 Tripod (31) |
| M1917A1 (22) | 3006-200/250 (239, 240) | M1 Ammobox (34) | M1917 Tripod (32) |
| M1919A4 (23) | 3006-200/250 (239, 240) | M1 Ammobox (34) | M2 Tripod (31) |
| M2HB (24) | 50M2-110 (241) | M2HB Ammobox (35) | M3 Tripod (33) |
| MG34 (91) | Gt34-50 (293), Pt34-75 (294), 7.92m250 (296), 7.92-50 (295) | PatrK41 (115) | Laf34 (112) |
| MG42 (94) | Gt34-50 (293), 7.92m250 (296), 7.92-50 (295) | PatrK41 (115) | Laf42 (113) |
| MG08 (95) | 7.92f250 (289), 7.92f100 (288) | PatrK15 (116) | Sch08 (114) |
| Vickers Mk1 (179) | 303Br250 (358) | No8 Mk1 (185) | Tripod Mk4 (184) |
| PM1910 (199) | 7.62-250 (374) | Pat.1910 (201) | - |
| DShK (200) | 12.7-50 (375) | Pat.DShK (202) | - |
| MAC1931A (407) | 7.5-25 (342) | - | vehicle mount |
| Besa Mk1 (409) | no infantry-item feed in CBE | - | vehicle mount |

## Runtime precedence

`data/pl_weapon_ammo_legacy_truth.js` is loaded after the older derived and
override tables and before `data/pl_ammo_resolve.js`. It replaces the
canonical ammo, slot, box, auxiliary, tripod, and per-weapon override maps.
An explicit empty feed is authoritative, so the resolver cannot fall back to
same-caliber heuristics.

## AFV record correction

The original decoder had an artificial 400-row ceiling. The mounted-weapon
records continue through CBE index 454. CBE record 407 (`MAC1931A`,
`0x1E44C0`) explicitly links raw item ID 343 to normalized item 342
(`7.5-25`). Its 150-round weapon capacity remains separate from that
inventory item's 25-round label.

CBE record 409 (`Besa Mk1`, `0x1E4540`) has no slot or u26 reference to an
infantry item. It is therefore deliberately represented as no infantry-item
feed: it is not safe to substitute a German MG belt solely because both use
7.92 mm ammunition.

## Regeneration and regression check

```powershell
python scripts/normalize_pl_item_refs.py --check
python scripts/build_pl_legacy_item_links.py
node tests/pl_ammo_compat.test.js
```

The generator uses the normalized four CBE link slots, the captured CBE
`u16[26]` ammunition-box links, category 18 as the loadable-ammunition
boundary, and the verified tripod map.
