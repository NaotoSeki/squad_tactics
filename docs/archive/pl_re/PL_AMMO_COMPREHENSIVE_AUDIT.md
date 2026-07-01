# PL 装填 包括監査

**生成**: 2026-05-31 — `python scripts/audit_pl_ammo_comprehensive.py`

## 方針

CBE `ammo_indices` + 解明済みフィルタ（cat18 → u27）を **Effective** とし、
`wpns_pl_master.js` の `acceptsAmmo`（ビルドヒューリスティクス混入）との差分を分類する。
**override 不要**のため、差分はビルド修正 or 未解明フィルタ RE で潰す。

## サマリー

| 指標 | 値 |
|------|-----|
| 照合火器 | 225 |
| Effective == ST マスタ | **129** (57.3%) |
| Raw CBE == ST マスタ | 119 (52.9%) |
| 差分あり（要対応） | **96** |
| ST extra 弾（件数） | 124 |
| ST missing 弾（件数） | 55 |

## ST extra の根本原因（件数）

| カテゴリ | 件数 | 対処 |
|----------|------|------|
| `BUILD_HEURISTIC:OTHER` | 42 | ビルド fallback 見直し |
| `BUILD_HEURISTIC:AMMO_792` | 33 | `build_wpns_pl_master.py` mg42→AMMO_792 撤去、CBE effective 使用 |
| `U27_SHAPE_FILTER` | 20 | マスタ再ビルド（u27 フィルタ後を正本化） |
| `BUILD_HEURISTIC:AMMO_303BR` | 10 | 同上 AMMO_303BR クラスタ撤去 |
| `BUILD_HEURISTIC:AMMO_3006` | 8 | 同上 AMMO_3006 クラスタ撤去 |
| `BUILD_HEURISTIC:AMMO_27` | 6 | 同上 AMMO_27 クラスタ撤去 |
| `BUILD_HEURISTIC:AMMO_9` | 3 | 同上 AMMO_9 クラスタ撤去 |
| `BUILD_HEURISTIC:AMMO_30CBN` | 2 | 同上 AMMO_30CBN 撤去 |

## ビルドヒューリスティクスが主因の武器（extra ≥2）

| cbeIdx | 武器 | Effective | ST extra（原因） |
|--------|------|-----------|------------------|
| 199 | PM1910 | — | BUILD_HEURISTIC:AMMO_792: 7.92-5, 7.92-10G, 7.92-101, 7.92-201 +8 |
| 44 | M1934 | 32ACP-7B | BUILD_HEURISTIC:OTHER: 32ACP-8M, Pt34-75; BUILD_HEURISTIC:AMMO_792: 7.92f100 |
| 94 | MG42 | Pt34-75 | BUILD_HEURISTIC:AMMO_27: FLeut41; BUILD_HEURISTIC:AMMO_792: 7.92f250, 7.92-25 |
| 91 | MG34 | Pt34-75, 7.92-50 | BUILD_HEURISTIC:AMMO_792: 7.92f250, 7.92-25 |
| 92 | MG34S | Pt34-75, 7.92-50 | BUILD_HEURISTIC:AMMO_792: 7.92f250, 7.92-25 |
| 93 | MG34/41 | Pt34-75, 7.92-50 | BUILD_HEURISTIC:AMMO_792: 7.92f250, 7.92-25 |
| 95 | MG08 | — | BUILD_HEURISTIC:AMMO_27: FLeut41; BUILD_HEURISTIC:OTHER: Pt34-75 |
| 107 | RPzB54/1 | — | BUILD_HEURISTIC:AMMO_27: FLeut41; BUILD_HEURISTIC:OTHER: RPzB4992 |
| 179 | Vickers Mk1 | — | BUILD_HEURISTIC:OTHER: Very-1; BUILD_HEURISTIC:AMMO_303BR: 303Br250 |
| 181 | PIAT | — | BUILD_HEURISTIC:OTHER: Very-1, PIAT-1 |
| 206 | M07/12 | — | BUILD_HEURISTIC:OTHER: 8Aut-250, 380ACP8B |
| 217 | tk ZB vz37 | — | BUILD_HEURISTIC:AMMO_792: 7.92f250, 7.92-25 |
| 5 | M1903A1 | 3006-20B | BUILD_HEURISTIC:AMMO_3006: 3006-5 |
| 9 | M1C Rifle | 30Cbn-15 | BUILD_HEURISTIC:AMMO_3006: 3006-8 |
| 10 | M1D Rifle | 30Cbn-15 | BUILD_HEURISTIC:AMMO_3006: 3006-8 |
| 12 | M1 Cbn | 30Cbn-30 | BUILD_HEURISTIC:AMMO_30CBN: 30Cbn-15 |
| 13 | M1A1 Cbn | 30Cbn-30 | BUILD_HEURISTIC:AMMO_30CBN: 30Cbn-15 |
| 16 | M1 SMG | 45ACP30T | BUILD_HEURISTIC:AMMO_3006: 3006-20B |
| 20 | M1919A6 LMG | — | BUILD_HEURISTIC:OTHER: M6A1 HR |
| 21 | M1941   LMG | 3006-200 | BUILD_HEURISTIC:AMMO_3006: 3006-20B |
| 22 | M1917A1 MMG | — | BUILD_HEURISTIC:OTHER: M6A1 HR |
| 23 | M1919A4 MMG | — | BUILD_HEURISTIC:OTHER: M6A1 HR |
| 24 | M2 HB HMG | — | BUILD_HEURISTIC:OTHER: 50M2-110 |
| 28 | E1R1 Fl | — | BUILD_HEURISTIC:AMMO_3006: 3006-5 |
| 29 | M1A1 Fl | — | BUILD_HEURISTIC:AMMO_3006: 3006-5 |
| 30 | M2A1-7 Fl | — | BUILD_HEURISTIC:AMMO_3006: 3006-5 |
| 52 | 27mmP42 | FLeut41 | BUILD_HEURISTIC:AMMO_792: 7.92-10G |
| 53 | 27mmKpfP | — | BUILD_HEURISTIC:OTHER: FLeut.Z |
| 54 | 27mmStuP | — | BUILD_HEURISTIC:AMMO_792: 7.92-10G |
| 55 | Gew98 | 7.92-10G | BUILD_HEURISTIC:AMMO_792: 7.92-5 |
| 56 | Kar98b | 7.92-10G | BUILD_HEURISTIC:AMMO_792: 7.92-5 |
| 57 | Kar98k | 7.92-10G | BUILD_HEURISTIC:AMMO_792: 7.92-5 |
| 60 | Gew33/40 | 7.92-10G | BUILD_HEURISTIC:AMMO_792: 7.92-5 |
| 61 | Gew98/40 | 7.92-10G | BUILD_HEURISTIC:AMMO_792: 7.92-5 |
| 64 | VK-98 | 7.92-10G | BUILD_HEURISTIC:AMMO_27: FLeut41 |
| 69 | Zf Kar98k | 7.92-10G | BUILD_HEURISTIC:AMMO_792: 7.92-5 |
| 73 | MKb42(W) | 9Pb-20S | BUILD_HEURISTIC:AMMO_792: 7.92k-30 |
| 85 | Ger Potsdam | Pk16-100 | BUILD_HEURISTIC:AMMO_9: 9Pb-32S |
| 89 | MG13 | Pt13-75, Dt15-75 | BUILD_HEURISTIC:AMMO_792: 7.92-25 |
| 96 | PzB38 | Pa318-10 | BUILD_HEURISTIC:OTHER: Pa318-1 |

## u27 形状フィルタで落ちる弾（CBE raw にあるが Effective 外）

| cbeIdx | 武器 | u27 で除外 | Effective 残 |
|--------|------|------------|----------------|
| 0 | M1911A1 | 45ACP-7 | — |
| 12 | M1 Cbn | 45ACP20T | 30Cbn-30 |
| 13 | M1A1 Cbn | 45ACP20T | 30Cbn-30 |
| 14 | M2 Cbn | 45ACP20T | 30Cbn-30 |
| 16 | M1 SMG | 45ACP50T | 45ACP30T |
| 17 | M1A1 SMG | 45ACP20T, 45ACP50T | 45ACP30T, 45ACP30G |
| 42 | C/96M712 | 7.63-10b, 7.63-20b, 9Pb-8L | — |
| 59 | Gew29/40 | 7.92-10G | — |
| 71 | FG42/1 | 7.92-201, 7.92-202 | — |
| 72 | FG42/2 | 7.92k-30 | — |
| 79 | MP35/1 | 9Pb-32B, 9Pb-32M | — |
| 80 | EMP | 9Pb-32E, 9Pb-24B | — |
| 84 | MP41 | 9Pb-32P | — |
| 85 | Ger Potsdam | 303Br-47 | Pk16-100 |
| 90 | MG15 | Gt34-50 | — |
| 99 | PzBSS41 | 20LS-5 | — |
| 100 | PzB41 | RPzB4322 | 20LS-10 |
| 133 | MAB mod38A | 9Pb-30 | 6.5-20, 9Pb-20 |
| 134 | MAB mod38/42 | 9Pb-30, 9Pb-40 | 6.5-20 |
| 168 | No4 Mk1 | 7.62N-1 | 9Pb-32R |
| 169 | No4 Mk1* | 7.62N-1 | 9Pb-32R |
| 170 | No4 Mk1(T) | 7.62N-1 | 9Pb-32R |
| 172 | Sten Mk2 | Pk16-100 | 303Br-47 |
| 173 | Sten Mk3 | Pk16-100 | 303Br-47 |
| 174 | Sten Mk5 | Pk16-100, 7.62N-1 | 303Br-47 |
| 204 | MP34(o) | 8Aut-25 | — |
| 210 | Mle10/22 | 9Pb-13 | — |
| 215 | ZK383 | 7.92-20Z | — |
| 216 | lk ZB vz26 | 9Pb-8R | — |
| 221 | wz35 | 9Largo-8 | — |

## ST missing（Effective にあるがマスタ未反映）

| cbeIdx | 武器 | missing 弾 |
|--------|------|------------|
| 5 | M1903A1 | 3006-20B (230) |
| 9 | M1C Rifle | 30Cbn-15 (232) |
| 10 | M1D Rifle | 30Cbn-15 (232) |
| 12 | M1 Cbn | 30Cbn-30 (233) |
| 13 | M1A1 Cbn | 30Cbn-30 (233) |
| 16 | M1 SMG | 45ACP30T (235) |
| 17 | M1A1 SMG | 45ACP30G (237) |
| 21 | M1941   LMG | 3006-200 (239) |
| 44 | M1934 | 32ACP-7B (260) |
| 52 | 27mmP42 | FLeut41 (266) |
| 55 | Gew98 | 7.92-10G (273) |
| 56 | Kar98b | 7.92-10G (273) |
| 57 | Kar98k | 7.92-10G (273) |
| 60 | Gew33/40 | 7.92-10G (273) |
| 61 | Gew98/40 | 7.92-10G (273) |
| 64 | VK-98 | 7.92-10G (273) |
| 69 | Zf Kar98k | 7.92-10G (273) |
| 73 | MKb42(W) | 9Pb-20S (278) |
| 85 | Ger Potsdam | Pk16-100 (287) |
| 89 | MG13 | Pt13-75 (291) |
| 89 | MG13 | Dt15-75 (292) |
| 96 | PzB38 | Pa318-10 (298) |
| 97 | PzB39 | Pa318-10 (298) |
| 100 | PzB41 | 20LS-10 (300) |
| 121 | Bodeo mod89 | 9Gli-7 (316) |
| 127 | F. mod38 | 9Pb-10 (320) |
| 128 | M. mod38 | 9Pb-10 (320) |
| 129 | M. mod38/TS | 9Pb-10 (320) |
| 130 | F. mod38 | 7.35-6 (319) |
| 138 | Breda mod37 | 8Brd-50 (327) |
| 148 | M. Mle92/27 | 8M86-5 (339) |
| 149 | F. Mle07/15 | 8M86-5 (339) |
| 152 | F. MAS36 | 7.65-32 (341) |
| 153 | F. MAS36CR39 | 7.65-32 (341) |
| 156 | Mle1914 | 8M86-30 (344) |
| 166 | No1 Mk3 | 9Pb-32R (355) |
| 167 | No1 Mk3* | 9Pb-32R (355) |
| 168 | No4 Mk1 | 9Pb-32R (355) |
| 169 | No4 Mk1* | 9Pb-32R (355) |
| 171 | No3 Mk1*(T) | 9Pb-32R (355) |
| 172 | Sten Mk2 | 303Br-47 (356) |
| 173 | Sten Mk3 | 303Br-47 (356) |
| 174 | Sten Mk5 | 303Br-47 (356) |
| 176 | Bren Mk1 | 303Br250 (358) |
| 188 | obr1895g | 7.62T-8 (366) |
| 190 | obr1891/30g | 7.62-10 (368) |
| 191 | obr1938g | 7.62-10 (368) |
| 192 | obr91/30g-PU | 7.62-10 (368) |
| 195 | PPD40 | 7.62T35h (370) |
| 197 | PPS43 | 7.62-47 (373) |
| … | +5 件 | |

## mag_type (u21) — w21≠0 武器のみ

武器 u21≠0: 18 件。
武器側 u21 は `sub_action_items[0]`、弾側は `mag_type_group`（同一オフセット・意味別）。

### delta = a21 − w21 分布

| delta | 件数 |
|-------|------|
| -22 | 1 |
| -21 | 1 |
| -1 | 2 |
| +1 | 1 |
| +2 | 4 |
| +3 | 1 |

### 全ペア

| 武器 | w21 | 弾 | a21 | delta |
|------|-----|-----|-----|-------|
| MG34 | 113 | Pt34-75 | 92 | -21 |
| MG34 | 113 | 7.92-50 | 116 | +3 |
| MG42 | 114 | Pt34-75 | 92 | -22 |
| FR mod14 | 140 | 8Brd-20 | 139 | -1 |
| Breda mod37 | 141 | 8Brd-50 | 142 | +1 |
| Mle1914 | 158 | 8M86-30 | 157 | -1 |
| Bren Mk1 | 184 | 303Br250 | 186 | +2 |
| Bren Mk2 | 184 | 303Br250 | 186 | +2 |
| Bren Mk3 | 184 | 303Br250 | 186 | +2 |
| lk ZB vz26 | 219 | 9Pb-8R | 221 | +2 |

## Kar98 / Kar43 系 — 7.92-5 (272) ギャップ

CBE `ammo_indices` 4 スロットに 272 が無い武器（第3フィルタ or 拡張テーブル疑い）:

| cbeIdx | 武器 | raw に 272 | effective 273 |
|--------|------|------------|---------------|
| 55 | Gew98 | **—** | ✓ |
| 56 | Kar98b | **—** | ✓ |
| 57 | Kar98k | **—** | ✓ |
| 58 | Kar98k svw | **—** | ✓ |
| 59 | Gew29/40 | **—** | — |
| 60 | Gew33/40 | **—** | ✓ |
| 61 | Gew98/40 | **—** | ✓ |
| 64 | VK-98 | **—** | ✓ |
| 68 | Kar43 | **—** | ✓ |
| 69 | Zf Kar98k | **—** | ✓ |

## override 不要ロードマップ

1. **`build_wpns_pl_master.py`**: `plcompat_for_index` の AMMO_* クラスタ fallback を廃止し、
   `stats.ammo_indices` → cat18 → u27 の Effective を `acceptsAmmo` に焼く
2. **ランタイム**: 既存 `finalizeWeaponAmmoIndices` はマスタノイズ除去の安全網として維持
3. **第3フィルタ**: mag_type RE 完了後 `FEATURE_PL_MAG_TYPE_FILTER` 追加
4. **272 問題**: PL 実機 or CBE コード — override 禁止

## 再実行

```bash
python scripts/audit_pl_ammo_comprehensive.py
python scripts/export_pl_weapon_ammo_canonical.py
```
