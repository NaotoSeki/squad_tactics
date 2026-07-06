# PL 複合装備リンク — 主武器 + 弾薬箱 + 内包弾帯

**生成**: 2026-05-31 — `python scripts/export_pl_composite_links.py`

## モデル（CBE + RE + プレイ知見）

重機関銃の「完成形」は **単一行の acceptsAmmo では表現できない**:

```
MG 武器行
  ├─ ammo_indices[4] … 主弾 cat18（Pt34-75, 7.92-50 等）— ドラム/短ベルト
  ├─ u16[26] (+0x34) … 弾薬箱/三脚/観測鏡 index（4slot 外）
  │     └─ ammo_box 行 → ammo_indices = 内包弾帯（7.92f100, 7.92f250）
  └─ UI @0x4240C→0xF7C8→0x46CD4 … 列ごとに 8B エントリで link_index 照合
```

**PatrK15(116)** = ドイツ MG 弾薬箱。内包: **7.92-25, 7.92f250**（CBE）。
プレイ上 **7.92f100** 等も同箱 — 本表記と整合。

**M1 Ammobox(34)** → 3006-250, 50M2-110。
**M2HB Ammobox(35)** → M6A1 HR（CBE 上はロケット行 — M2HB 用ベルト未リンク要 RE）。

## サマリー

| 複合リンクあり武器 | 186 |
| ammo_box 行 | 9 |
| HMG 型（主弾+箱） | 9 |

## 弾薬箱 — 内包弾 + 参照武器

| idx | 名称 | 内包弾 | u26 参照元 |
|-----|------|--------|------------|
| 34 | M1 Ammobox | 3006-250, 50M2-110 | — |
| 35 | M2HB Ammobox | M6A1 HR | M1919A6 LMG(20), M1917A1 MMG(22), M1919A4 MMG(23) |
| 115 | PatrK41 | Pa318-1, 7.92m250 | — |
| 116 | PatrK15 | 7.92-25, 7.92f250 | MG34(91), MG34S(92), MG34/41(93), MG42(94), tk ZB vz37(217) |
| 141 | CM. FR 14/35 | SRCM m35 | — |
| 185 | No8 Mk1 | 55Boys-5 | — |
| 201 | pat.1910 | 12.7-50 | — |
| 202 | pat.DShK | sht.1891 | PM1910(199) |
| 208 | M07 PatrK | 9BLg-7 | — |

## HMG / MG — 複合一覧

| 武器 | 主弾(4slot) | u26→ | 箱内弾 |
|------|-------------|------|--------|
| M1919A6 LMG (20) | — | M2HB Ammobox(35) | M6A1 HR |
| M1917A1 MMG (22) | — | M2HB Ammobox(35) | M6A1 HR |
| M1919A4 MMG (23) | — | M2HB Ammobox(35) | M6A1 HR |
| M2 HB HMG (24) | — | M3 Binocular(36) | — |
| MG08/15 (87) | 7.92f100 | Fernglas(117) | — |
| MG08/18 (88) | 7.92f100 | Fernglas(117) | — |
| MG34 (91) | Pt34-75, 7.92-50 | PatrK15(116) | 7.92-25, 7.92f250 |
| MG34S (92) | Pt34-75, 7.92-50 | PatrK15(116) | 7.92-25, 7.92f250 |
| MG34/41 (93) | Pt34-75, 7.92-50 | PatrK15(116) | 7.92-25, 7.92f250 |
| MG42 (94) | Pt34-75 | PatrK15(116) | 7.92-25, 7.92f250 |
| MG08 (95) | — | Fernglas(117) | — |
| FR mod14/35 (137) | — | Binocolo(142) | — |
| Vickers Mk1 (179) | — | Binocular(186) | — |
| PM1910 (199) | — | pat.DShK(202) | sht.1891 |
| DShK (200) | — | SP M12(203) | — |
| M07/12 (206) | — | Mle1903(209) | — |
| tk ZB vz37 (217) | — | PatrK15(116) | 7.92-25, 7.92f250 |

## ST 未実装（ロードマップ）

1. **入れ子解決**: `effectiveAmmo = cat18(slot) ∪ box(u26).inner`
2. **三脚**: Laf34 等 — u26 または UI 別列（0x4C4..）。MG34 は u26=PatrK15 のみ確認
3. **装備 UI 4 列** + `@ 0x46CD4` — 完成形はランタイムで合成

正本: CBE + RE。攻略本「主弾+箱+三脚」記述と **PatrK15 入れ子** は一致。

## 関連

- [PL_WEAPON_LINK_TRUTH.md](./PL_WEAPON_LINK_TRUTH.md)
- [PL_CBE_F7C8_RE.md](./PL_CBE_F7C8_RE.md)
- [PL_CBE_AUX_UI_RE.md](./PL_CBE_AUX_UI_RE.md)
