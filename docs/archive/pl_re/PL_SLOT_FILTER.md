# PL 第2フィルタ — スロット category 調査

**生成**: `python scripts/export_pl_cbe_slot_categories.py`  
**第1フィルタ**: u27 形状（[PL_AMMO_UI_FILTER.md](./PL_AMMO_UI_FILTER.md)）  
**第2フィルタ**: 参照先 `category_code` — **18=ammo のみ主装填候補**

---

## 結論

武器 `ammo_indices[4]` は **主弾候補 + 付属品** の混在リスト。
PL UI は参照先レコードの **category_code==18（ammo）** だけを装填 UI に出す（仮説→データ支持）。

| category | 名称 | スロット参照回数 | 扱い |
|----------|------|------------------|------|
| 18 | ammo | 213 | **主装填** |
| 24 | bayonet_knife | 36 | 付属品/非装填 |
| 19 | rifle_grenade | 21 | 付属品/非装填 |
| 20 | hand_grenade | 11 | 付属品/非装填 |
| 25 | mounted_weapon | 1 | 付属品/非装填 |

## 付属品スロット例（cat != 18）

| 武器 | slot | ref | cat | 名称 |
|------|------|-----|-----|------|
| M9 RL | 0 | 244 | rifle_grenade | M9A1 RfG |
| M1903A1 | 1 | 245 | rifle_grenade | Mk2 GPA |
| 27mmLeuP | 0 | 267 | rifle_grenade | Wkor361 |
| 27mmLeuP | 1 | 268 | rifle_grenade | Wgrp326 |
| 27mmKpfP | 1 | 270 | rifle_grenade | SprGr.Z |
| 27mmKpfP | 0 | 271 | rifle_grenade | Pzwk42 |
| RPzB54 | 1 | 303 | rifle_grenade | GPzgr |
| Kar98k | 1 | 304 | rifle_grenade | GSprgr |
| M1903A1 | 2 | 246 | hand_grenade | Mk2 Grd |
| Kar98k | 2 | 305 | hand_grenade | StiGr24 |
| CM. FR 14/35 | 0 | 328 | hand_grenade | SRCM m35 |
| Mle1914 | 1 | 345 | hand_grenade | Grd F1 |
| PIAT | 0 | 361 | hand_grenade | No36M |
| M1903A1 | 3 | 251 | bayonet_knife | John Byt |
| M1941 Rifle | 1 | 252 | bayonet_knife | M4 Byt |
| M1 Cbn | 3 | 253 | bayonet_knife | Mk1 TKnf |
| Gew98 | 1 | 314 | bayonet_knife | Messer |
| F. mod91 | 1 | 332 | bayonet_knife | BP.MAB38 |
| MAB mod38A | 3 | 333 | bayonet_knife | P. mod39 |
| F. Mle86/93 | 1 | 348 | bayonet_knife | Mle92/15 |
| M. Mle92/27 | 1 | 349 | bayonet_knife | 41 CONON |
| No1 Mk3 | 1 | 363 | bayonet_knife | No3 Mk1 |
| No3 Mk1*(T) | 1 | 364 | bayonet_knife | No4 Mk2 |
| pat.DShK | 0 | 376 | bayonet_knife | sht.1891 |
| obr1891/30g | 1 | 377 | bayonet_knife | sht.1940 |
| S-18/100 | 1 | 395 | mounted_weapon | M1919A4 MMG |

## ST 実装（済）

```
effectiveAccepts = ammo_indices
  ∩ categoryFilter (cat==18)     ← 第2フィルタ
  ∩ validAmmoIndex (PL_AMMO_DATA)
  ∩ magShapeFilter (u27)         ← 第1フィルタ
  ∩ overrides
```

| ファイル | 役割 |
|----------|------|
| `data/pl_cbe_item_categories.js` | index → category_code |
| `data/pl_cbe_weapon_slots.js` | 武器 → 全スロット（付属含む） |
| `pl_ammo_resolve.js` | `passesCategoryLoadFilter`, `getWeaponAuxSlotRefs` |

**ロールバック**: `FEATURE_PL_CATEGORY_FILTER = false`

**再生成**: `python scripts/export_pl_cbe_slot_categories.py`
