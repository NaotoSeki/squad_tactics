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
| 18 | ammo | 215 | **主装填** |
| 24 | bayonet_knife | 40 | 付属品/非装填 |
| 19 | rifle_grenade | 27 | 付属品/非装填 |

## 付属品スロット例（cat != 18）

| 武器 | slot | ref | cat | 名称 |
|------|------|-----|-----|------|
| M1903A1 | 1 | 244 | rifle_grenade | M9A1 RfG |
| M1903A1 | 2 | 245 | rifle_grenade | Mk2 GPA |
| 27mmLeuP | 1 | 267 | rifle_grenade | Wkor361 |
| 27mmLeuP | 2 | 268 | rifle_grenade | Wgrp326 |
| 27mmKpfP | 0 | 270 | rifle_grenade | SprGr.Z |
| 27mmStuP | 0 | 271 | rifle_grenade | Pzwk42 |
| Kar98k | 1 | 303 | rifle_grenade | GPzgr |
| Kar98k | 2 | 304 | rifle_grenade | GSprgr |
| M1903A1 | 3 | 250 | bayonet_knife | M1905Byt |
| M1941 Rifle | 1 | 251 | bayonet_knife | John Byt |
| M1 Cbn | 3 | 252 | bayonet_knife | M4 Byt |
| Gew98 | 1 | 313 | bayonet_knife | S84/92 |
| F. mod91 | 1 | 331 | bayonet_knife | SB.mod91 |
| MAB mod38A | 3 | 332 | bayonet_knife | BP.MAB38 |
| F. Mle86/93 | 1 | 347 | bayonet_knife | Mle86/35 |
| M. Mle92/27 | 1 | 348 | bayonet_knife | Mle92/15 |
| No1 Mk3 | 1 | 362 | bayonet_knife | No1 Mk1 |
| No3 Mk1*(T) | 1 | 363 | bayonet_knife | No3 Mk1 |
| No4 Mk1 | 1 | 364 | bayonet_knife | No4 Mk2 |
| obr1891/30g | 1 | 376 | bayonet_knife | sht.1891 |
| SVT40 | 2 | 377 | bayonet_knife | sht.1940 |

## ST 実装

```
effectiveAccepts = ammo_indices
  ∩ validAmmoIndex (PL_AMMO_DATA)
  ∩ categoryFilter (cat==18)
  ∩ magShapeFilter (u27)
  ∩ overrides
```

データ: `data/pl_cbe_item_categories.js`
実行: `pl_ammo_resolve.js` → `passesCategoryLoadFilter()`

**ロールバック**: `FEATURE_PL_CATEGORY_FILTER = false`
