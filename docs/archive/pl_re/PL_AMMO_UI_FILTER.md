# PL 装填: テーブル行 vs UI 装填可否 — 調査メモ

**更新**: 2026-05-25  
**対象**: `D:\PL\CBE.EXE` / `data/wpns_pl_stats_decoded.json`  
**再現**: `python scripts/probe_pl_ammo_ui_filter.py`

---

## 結論（要約）

| 問い | 答え |
|------|------|
| PL に override 専用テーブルはある？ | **未確認**。別 JSON より **同一 64byte レコード内の複数フィールド** でフィルタしている可能性が高い |
| `ammo_indices` ＝ UI で選べる弾？ | **No**。候補リストに近く、**追加条件で絞る** |
| 45ACP50T は PL 上 M1928A1 専用？ | **テーブル上は M1/M1A1 にも行がある**が、**形状フラグ u16[27] 一致で UI から除外される仮説が強い** |
| 1993 PL vs 2026 史実 | PL は当時の理解でかなり忠実。**ドラム問題は PL 自身が M1 系で実質ブロックしている**可能性。ただし Kar98 の 5発クリップ等は要追加調査 |

---

## 武器レコード vs 弾薬レコード（64byte stride @ 0x1DDF00）

| オフセット | 武器 | 弾薬 (cat=18) |
|-----------|------|---------------|
| +44..+50 | **ammo_indices[4]** — 装填候補 index | sub_ammo_link（別意味。7.92-10G は FG42 行等とリンク） |
| +42 | （武器側は未特定） | **mag_type_group** — 口径/マグファミリ ID |
| +54 | **u16[27] 形状/レシーバーフラグ（仮）** | **u16[27] マガジン形状フラグ（仮）** |
| +26 | malfunction_rate | malfunction_modifier（ドラム +2 等） |

詳細: [data/ammo_field_analysis.md](../data/ammo_field_analysis.md)

---

## Thompson ドラム — 決定的なデータ

### L1: ammo_indices（テーブル行）

| idx | 武器 | ammo_indices |
|-----|------|--------------|
| 15 | M1928A1 SMG | 235, **236**, 237 |
| 16 | M1 SMG | 235, **236** |
| 17 | M1A1 SMG | 235, **236** |

→ **3 銃とも 45ACP50T(236) が行に存在**（M1928A1 専用ではない）

### L1+: u16[27] 形状フラグ（UI フィルタ仮説）

| | weapon u27 | 45ACP30T (235) u27 | 45ACP50T (236) u27 | UI可(仮説) |
|--|------------|--------------------|--------------------|------------|
| M1928A1 | **65** | 1 | **65** | 両方 ✓ |
| M1 SMG | **1** | 1 | 65 | 30T ✓ / **50T ✗** |
| M1A1 SMG | **1** | 1 | 65 | 同上 |

**仮説ルール（要 PL 実機確認）**

```
UI装填可 ⇔ (weapon.u27 == 65) OR (weapon.u27 == ammo.u27)
```

- `65` … ドラム/旧式（commercial）レシーバー可
- `1` … スティック/ボックス系

American Rifleman の史実（M1/M1A1 はドラム溝廃止）と **PL のデータ設計が一致**している。

### malfunction ペナルティ（別レイヤー）

- 45ACP50T: `malfunction_modifier = 2`
- M1928A1: `malfunction_rate = 2` → 実効 4（ジャム増）

→ ドラムは「装填できるが嫌われる」設計。

---

## Kar98 / 7.92 系 — 未解決

| 項目 | 観測 |
|------|------|
| Kar98b ammo_indices | 273 (7.92-10G), 314 (Messer) — **272 (7.92-5) なし** |
| 7.92-5 / 7.92-10G の u27 | ともに **14**（Thompson とは別スキーム） |
| 7.92-10G sub_links | `[71, 0, 0, 36]` → FG42/1, M3 Binocular（フィールド解釈要再検証） |

5 発クリップ (272) が PL UI で Kar98 に出るかは **実プレイ or CBE コード逆引き** が必要。  
候補: `category_group`(u25=35/36)、caliber ファミリ走査、別セグメントの拡張テーブル。

---

## Squad Tactics への示唆

| 方針 | 内容 |
|------|------|
| **PL 忠実** | `pl_cbe_mag_shape.js` + `pl_ammo_resolve.js` の **u27 形状フィルタ**（実装済） |
| **史実優先** | 1993 PL より新しい文献 → `pl_ammo_compat_overrides.js` + `sources` |
| **両立** | `effectiveAccepts = tableIndices ∩ shapeFilter(u27) ∩ overrides` |

**ロールバック**: `FEATURE_PL_MAG_SHAPE_FILTER = false`

**第2フィルタ（category）**: [PL_SLOT_FILTER.md](./PL_SLOT_FILTER.md) — `FEATURE_PL_CATEGORY_FILTER`

**補助装備（銃剣・擲弾・弾薬箱）**: [PL_AUX_EQUIPMENT.md](./PL_AUX_EQUIPMENT.md)

---

## 次の調査タスク

- [ ] PL 実機: M1 SMG 装填 UI に 45ACP50T が出るか確認
- [ ] CBE.EXE 逆アセンブル: u16[27] 比較コードの特定
- [ ] Kar98 + 7.92-5: 実プレイ or バイナリ二次テーブル探索
- [x] ST: `pl_ammo_resolve.js` に u27 形状フィルタ実装（`pl_cbe_mag_shape.js`）
- [ ] 銃剣・擲弾・MG弾薬箱: [PL_AUX_EQUIPMENT.md](./PL_AUX_EQUIPMENT.md) ベースで category フィルタ

---

## 関連ファイル

| ファイル | 役割 |
|----------|------|
| `scripts/probe_pl_ammo_ui_filter.py` | 本調査の再現スクリプト |
| `data/wpns_pl_stats_decoded.json` | CBE 全武器デコード |
| `data/pl_ammo_compat_overrides.js` | ST 実行時補正 |
