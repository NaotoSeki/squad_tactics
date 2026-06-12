# 装填整合 — 個別ケース調査（2026-05-25）

CBE 逆引き + `scripts/probe_mag_type_kar_bren.py` の結果。override 方針は [PL_AMMO_TRUTH.md](./PL_AMMO_TRUTH.md)。

---

## No3 Mk1*(T) — 9Pb-32R 表示

| 項目 | 値 |
|------|-----|
| CBE ammo_indices | `[355, 364]` |
| 355 | cat=18、CBE 名称 **9Pb-32R**、実体は **.303Br クリップ**（Lee-Enfield 系専用） |
| 364 | cat=24 **No4 Mk2 銃剣** — 主装填から除外、付属装備スロット |

**ST 対応**

- 適合弾表示: `.303Br clip`（`PL_AMMO_DISPLAY_HINTS`）
- 付属: `No4 Mk2 (銃剣)` — 「PL付属スロット」表記は撤去済

9Pb-32R という名称は PL/CBE の命名ミスに近く、9mm Para とは無関係。

---

## Bren Mk2 — 303Br250

| 項目 | 値 |
|------|-----|
| CBE ammo_indices | `[358]` → 名称 **303Br250** |
| 武器 u21 / 弾 u21 | w21=**184**, a21=**186**（+2 差 — mag_type 系の候補） |
| Lewis Mk1 | ammo `[357]` **303Br-30**（w21=0） |

**スプライト番号**

- ルール: `item_NNNN.png` → cbeNameIndex = **NNN − 1**
- `item_0358.png` → index **357** = **303Br-30**（Lewis 用ドラム）
- index **358** = 303Br250 → `item_0359.png`

Bren Mk2 本体は index **177**（`pl_177`）。358 番は弾薬行であり、銃剣アイコンではない。

CBE 上 Bren Mk1/2/3 はいずれも 358 のみリンク。実機 UI で 357 が出るか、または第3フィルタで 358 が隠れるかは **要 PL 実機確認**。

---

## Kar43 — 7.92 系

| 弾 | index | u21 | mag_cap | CBE で Kar43 にリンク |
|----|-------|-----|---------|----------------------|
| 7.92-5 | 272 | 58 | 5 | **なし**（Kar98 書面資料のみ） |
| 7.92-10G | 273 | 68 | 10 | **あり** |
| 7.92-101 | 274 | 72 | 10 | **あり** |

Kar43 の CBE ammo_indices: `[273, 274]` — ユーザー指摘の **272+273** とは不一致。

**7.92-101 (274) と FG42**

- FG42/1 (71): ammo `[276, 275]` — **274 ではない**
- 274 は Gew43 / Kar43 / VG-1 / VG-2 等の CBE リンク先

272 (5発クリップ) は Kar98k 系でも **ammo_indices 4 スロットに未収録**（[PL_AMMO_UI_FILTER.md](./PL_AMMO_UI_FILTER.md) 参照）。PL UI で Kar43 に 272 が出るなら、**別テーブル or 未解明フィルタ** の可能性。

---

## 次の RE タスク

1. `export_pl_cbe_mag_type.py` → 第3フィルタ仮説検証（Bren w21/a21、Kar43 u21=0 問題）
2. Kar98 / Kar43 + 7.92-5: CBE コード or 実機
3. Bren: 357 vs 358 — 実機装填 UI

関連: `scripts/probe_mag_type_kar_bren.py`, `scripts/probe_weapon_u21_nonzero.py`
