# PL 補助装備・固有組み合わせ — 調査メモ

**生成**: `python scripts/probe_pl_aux_combos.py`  
**前提**: CBE `ammo_indices[4]` + category_code。UI フィルタは [PL_AMMO_UI_FILTER.md](./PL_AMMO_UI_FILTER.md) 参照。

---

## 1. 銃剣 / 白兵（Messer 等）

Kar98 系の `ammo_indices` 第4スロットに **314=Messer** が入る例（主弾ではなく付属品スロット）。

| 武器 idx | 武器名 | ammo_indices | 備考 |
|----------|--------|--------------|------|
| 55 | Gew98 | 273=7.92-10G, 314=Messer | 銃剣/白兵スロット |
| 56 | Kar98b | 273=7.92-10G, 314=Messer | 銃剣/白兵スロット |
| 57 | Kar98k | 273=7.92-10G, 304=GSprgr, 305=StiGr24, 314=Messer | 銃剣/白兵スロット |
| 59 | Gew29/40 | 273=7.92-10G, 314=Messer | 銃剣/白兵スロット |
| 60 | Gew33/40 | 273=7.92-10G, 314=Messer | 銃剣/白兵スロット |
| 61 | Gew98/40 | 273=7.92-10G, 314=Messer | 銃剣/白兵スロット |
| 65 | Gew41(W) | 273=7.92-10G, 314=Messer | 銃剣/白兵スロット |
| 66 | Gew41(M) | 273=7.92-10G, 314=Messer | 銃剣/白兵スロット |
| 69 | Zf Kar98k | 273=7.92-10G, 314=Messer | 銃剣/白兵スロット |
| 73 | MKb42(W) | 278=9Pb-20S, 314=Messer | 銃剣/白兵スロット |
| 74 | MKb42(H) | 278=9Pb-20S, 304=GSprgr, 305=StiGr24, 314=Messer | 銃剣/白兵スロット |
| 78 | MP28/2 | 280=9Pb-50S, 279=9Pb-32S, 281=9Pb-20E, 314=Messer | 銃剣/白兵スロット |

### PL 白兵システム（プレイ記憶・要実機再確認）

- 所持品のうち **白兵攻撃力（melee_attack）最大** の装備が白兵時に採用される（**Win98 実機未確認** — CBE RE が正本）。
- **銃剣加算はその銃に適合した銃剣のみ**。別の銃用銃剣を所持していても、現在の銃の白兵に加算されない。
- 適合時は **銃本体 melee + 適合銃剣行 melee**。CBE: 小銃 `melee_attack=5`、Messer/S84/92 行 `melee_attack=4`（cat=24）。

**Messer vs S84/98**: 史実の Gew98/Kar98 銃剣は **S84/98**。CBE では Kar98 系スロットに **314=Messer**（汎用ナイフ行）。
**313=S84/92** は cat=24 で存在するが、Kar98 `ammo_indices` には **未リンク**（銃剣は別経路 or 未実装の可能性）。

**フィルタ**: cat=24 は主装填 UI から除外（`@ 0x771E` cat18 分岐）。`ammo_indices` 第4スロット＝付属品候補リスト。

**ST 方針（案）**: Messer / 銃剣は `acceptsAmmo` から除外し、白兵・付属スロットとして扱う。

---

## 2. 擲弾器 / ライフルグレネード（GrB39, M9A1 RfG 等）

| 武器 idx | 武器名 | category | ammo_indices |
|----------|--------|----------|--------------|
| 98 | GrB39 | 8 | 304=GSprgr, 305=StiGr24 |
| 244 | M9A1 RfG | rifle_grenade | 9=M1C Rifle, 13=M1A1 Cbn, 14=M2 Cbn, 38=Med Bag |
| 245 | Mk2 GPA | rifle_grenade | 9=M1C Rifle, 13=M1A1 Cbn, 14=M2 Cbn, 38=Med Bag |
| 267 | Wkor361 | rifle_grenade | 53=27mmKpfP, 55=Gew98, 33=M3 Tripod |
| 268 | Wgrp326 | rifle_grenade | 53=27mmKpfP, 55=Gew98, 33=M3 Tripod |
| 270 | weapon_270 | rifle_grenade | 33=M3 Tripod |
| 271 | Pzwk42 | rifle_grenade | 38=Med Bag |
| 303 | GPzgr | rifle_grenade | 33=M3 Tripod |
| 304 | GSprgr | rifle_grenade | 33=M3 Tripod |

### ライフル擲弾 — M9A1 RfG / Mk2 GPA

**M9A1 RfG** = 米軍 **ライフルグレネード**（[M9 rifle grenade — Wikipedia](https://en.wikipedia.org/wiki/M9_rifle_grenade)）。M1 ガランド + M7 擲弾発射器系。**バズーカとは別物**。

| PL 行 | 推定役割 | CBE |
|------|----------|-----|
| **245 Mk2 GPA** | 擲弾発射器/アダプタ（ホスト銃側） | M1903A1, M1 Rifle, M1/M1A1/M2 Cbn の武器スロット |
| **244 M9A1 RfG** | ライフルグレネード弾体 | M9 RL スロットにも載るが **ロケット正本ではない** |
| M1C Rifle / M1903A4 | スコープ付 | 擲弾スロットなし |

ユーザー想定の「M9A1 対応銃」は **Mk2 GPA + M9A1 RfG の二行分割**（ライフルグレネード系）。

### M9 RL（バズーカ）— ロケット弾

| idx | 名称 | CBE |
|-----|------|-----|
| 27 M9 RL | 武器スロット | **244 M9A1 RfG, 243 M6A5 HR** — 244 は異常候補 |
| 242 M6A1 HR | ロケット弾 | 242 行が M9 RL(27) を逆リンク |
| 243 M6A5 HR | ロケット弾 | M1/M1A1 RL, M9 RL |

史実: **M6A1 HR / M6A5 HR**（M6A3 表記は PL 上 M6A5）。244 M9A1 RfG はライルグレネード別物。

---

## 3. 機関銃 + 弾薬箱（ammo_box category）

| 武器 idx | 武器名 | ammo_indices（CBE 4スロット） |
|----------|--------|------------------------------|

### ammo_box カテゴリ行（category_code=13）

| idx | 名称 | 内包弾（ammo_indices） | この箱を指す武器（逆引き） |
|-----|------|------------------------|---------------------------|
| 34 | M1 Ammobox | 240=3006-250, 241=50M2-110 | — |
| 35 | M2HB Ammobox | 242=M6A1 HR | 20=M1919A6 LMG, 22=M1917A1 MMG, 23=M1919A4 MMG, 395=M1919A4 MMG, 396=M1919A4 MMG, 397=M1919A5 MMG (+0x34) |
| 115 | PatrK41 | 297=Pa318-1, 296=7.92m250 | — |
| 116 | PatrK15 | 290=7.92-25, 289=7.92f250 | 91=MG34, 92=MG34S, 93=MG34/41, 94=MG42, 217=tk ZB vz37 (+0x34) |
| 141 | CM. FR 14/35 | 328=SRCM m35 | — |
| 185 | No8 Mk1 | 359=55Boys-5 | — |
| 201 | pat.1910 | 375=12.7-50 | — |
| 202 | pat.DShK | 376=sht.1891 | 199=PM1910 (+0x34) |
| 208 | M07 PatrK | 382=9BLg-7 | — |

**ammo_box の `ammo_indices`**: 箱が **内包する弾種行**（例: M1 Ammobox → 3006-250 / 50M2-110）を指す。
**MG→弾薬箱** は武器レコード **u16[26] (+0x34)** に記載（例: M1919A4→35 M2HB Ammobox）。`@ 0x46CD4` が UI 側と照合。
4 スロット逆引きと +0x34 逆引きは別経路 — 表の括弧内に表示。

---

## 4. 三脚 / 二脚（Tripod, Lafette）

| idx | 名称 | category |
|-----|------|----------|
| 31 | M2 Tripod | carbine |
| 32 | M1917 Tripod | carbine |
| 33 | M3 Tripod | carbine |
| 183 | Tripod Mk2 | carbine |
| 184 | Tripod Mk4 | carbine |

**ST**: `pl_mg_tripod.js` — MG + 三脚で仮想武器化済み。

---

## 5. 次の ST タスク

- [ ] Messer / 銃剣: 主弾 `acceptsAmmo` と分離
- [ ] GrB39 + 専用擲弾: 仮想武器 or 副装備スロット
- [PL_CBE_UI_TABLE_RE.md](./PL_CBE_UI_TABLE_RE.md) — equip_ui / +0x48 列構築
- [PL_CBE_AUX_UI_RE.md](./PL_CBE_AUX_UI_RE.md) — +0x34 / cat24 逆アセンブル
- [x] MG 弾薬箱: 武器 u16[26] (+0x34) 逆引き確定
- [ ] `@ 0x46CD4`: 0xF7C8 が ui+0x48 列を構築 — 文字列 ID→index 規則
- [ ] 0x46CA0: weapon.u21 を **item index** として `shl 6` 間接参照 — mag_type 完全一致の別経路
