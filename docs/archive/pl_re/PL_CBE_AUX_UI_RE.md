# CBE 副装備 UI — +0x34 ループ / cat=24 分岐

**生成**: 2026-05-31 — `python scripts/re_cbe_aux_ui_disasm.py`

## M9 RL 弾薬（訂正）

| M9 RL(27) CBE slots | `['M9A1 RfG', 'M6A5 HR']` |

| idx | 名称 | cat | この弾をスロットに持つ武器 |
|-----|------|-----|---------------------------|
| 242 | M6A1 HR | 18 | 35=M2HB Ammobox |
| 243 | M6A5 HR | 18 | 25=M1 RL, 26=M1A1 RL, 27=M9 RL |
| 244 | M9A1 RfG | 19 | 27=M9 RL |
| 245 | Mk2 GPA | 19 | 5=M1903A1, 8=M1 Rifle, 12=M1 Cbn, 13=M1A1 Cbn, 14=M2 Cbn |

**史実**: M9 RL（バズーカ）→ **M6A1 HR / M6A5 HR**（PL 表記。M6A3 は CBE 上 **M6A5 HR(243)**）。

CBE 上 M9 RL(27) スロットは **`[244 M9A1 RfG, 243 M6A5 HR]`** — 244 はライフルグレネード行で **データ上の異常候補**（243/242 がロケット正本）。
242 M6A1 HR 行は逆リンク `[27=M9 RL, …]` を持つ。

## `@ 0x46CD4` — +0x34 走査（MG 予備弾/弾薬箱候補）

装備関数 `@ 0x46C00` 内。**条件**: 武器コピー `[bp-8]` で **`+0x34 ≠ 0` かつ `+0x28 == 0`** のときのみ。
UI 構造体 `[bp+6]+0x48` から **8 バイト stride × 最大 3 エントリ**（di=1..2）を走査し、
各エントリ u16 を `[si+0x34]` と照合 → 一致列を `[bp+6]+0x40+di×8` に反映、`[si+0x28]` を更新。

```asm
0x046CD4  cmp    word ptr es:[bx + 0x34], 0 ; +0x34 reserve?
0x046CD9  je     0x46d42
0x046CDB  cmp    word ptr es:[bx + 0x28], 0 ; +0x28
0x046CE0  jne    0x46d42
0x046D01  cmp    word ptr [si + 0x34], ax ; +0x34 reserve?
0x046D04  je     0x46d14
0x046D0A  cmp    di, 2
0x046D0D  jle    0x46cf9
0x046D3E  mov    word ptr es:[si + 0x28], ax ; +0x28
0x046D45  cmp    word ptr es:[bx + 0x28], 0 ; +0x28
0x046D4A  je     0x46d63
0x046D55  je     0x46d63
0x046D79  lea    cx, [bx + 0x120] ; cat18
```

**解釈**: レコード **+0x34 (u16[26])** = **予備リンク index**（MG→弾薬箱、三脚、観測鏡等）。
CBE 4 スロット外。`@ 0x46CD4` は UI 側 `[+0x48]` 列と照合して装備 UI に反映。

### u16[26] ≠ 0 の武器（+0x34 リンク先）

| 武器 | cat | u26→ | 先 cat | CBE ammo 4スロット |
|------|-----|------|--------|-------------------|
| M1919A6 LMG (20) | 5 | 35=M2HB Ammobox | 13 | — |
| MG08/15 (87) | 5 | 117=Fernglas | 14 | 7.92f100 |
| MG08/18 (88) | 5 | 117=Fernglas | 14 | 7.92f100 |
| MG34 (91) | 5 | 116=PatrK15 | 13 | Pt34-75, 7.92-50 |
| MG34S (92) | 5 | 116=PatrK15 | 13 | Pt34-75, 7.92-50 |
| MG34/41 (93) | 5 | 116=PatrK15 | 13 | Pt34-75, 7.92-50 |
| MG42 (94) | 5 | 116=PatrK15 | 13 | Pt34-75 |
| M1917A1 MMG (22) | 7 | 35=M2HB Ammobox | 13 | — |
| M1919A4 MMG (23) | 7 | 35=M2HB Ammobox | 13 | — |
| M2 HB HMG (24) | 7 | 36=M3 Binocular | 14 | — |
| MG08 (95) | 7 | 117=Fernglas | 14 | — |
| FR mod14/35 (137) | 7 | 142=Binocolo | 14 | — |
| Vickers Mk1 (179) | 7 | 186=Binocular | 14 | — |
| PM1910 (199) | 7 | 202=pat.DShK | 13 | — |
| DShK (200) | 7 | 203=SP M12 | 1 | — |
| M07/12 (206) | 7 | 209=Mle1903 | 1 | — |
| tk ZB vz37 (217) | 7 | 116=PatrK15 | 13 | — |
| weapon_227 (227) | 18 | 33=M3 Tripod | 12 | — |
| M1919A4 MMG (395) | 25 | 35=M2HB Ammobox | 13 | — |
| M1919A4 MMG (396) | 25 | 35=M2HB Ammobox | 13 | — |
| M1919A5 MMG (397) | 25 | 35=M2HB Ammobox | 13 | — |
| M2 HB HMG (398) | 25 | 36=M3 Binocular | 14 | — |

### ammo_box 行（cat=13）— 内包弾

| idx | 名称 | u26 | 内包弾 |
|-----|------|-----|--------|
| 34 | M1 Ammobox | 0 | 3006-250, 50M2-110 |
| 35 | M2HB Ammobox | 0 | M6A1 HR |
| 115 | PatrK41 | 0 | Pa318-1, 7.92m250 |
| 116 | PatrK15 | 0 | 7.92-25, 7.92f250 |
| 141 | CM. FR 14/35 | 0 | SRCM m35 |
| 185 | No8 Mk1 | 0 | 55Boys-5 |
| 201 | pat.1910 | 0 | 12.7-50 |
| 202 | pat.DShK | 0 | sht.1891 |
| 208 | M07 PatrK | 0 | 9BLg-7 |

バイナリ内 `cmp [+0x34]` パターン: **17** 箇所（先頭: 0xcb3f, 0xcd7e, 0xcff1, 0xd104, 0xd2b7）

## `@ 0x771E` — category 分岐（cat18 vs cat24）

```
target_index → shl 6 → レコード取得
category - 0x12 == 0  → cat 18: ammo_indices[+0x2C..+0x32] **4スロット**ループ
category - 0x18 == 0  → cat 24: **cmp [record+0x32], target** のみ（第4 u16 単独）
else → skip
```

```asm
0x007762  sub    ax, 0x12 ; cat18
0x00776E  mov    word ptr [bp - 0x12], si ; cat18
0x00779B  mov    si, word ptr [bp - 0x12] ; cat18
0x0077A6  cmp    word ptr es:[bx + 0x32], ax ; +0x32 cat24
```

**cat=24**: 主装填 UI とは **別分岐**（`+0x32` フィールド照合）。Messer/S84/92 等の付属スロット。
cat18 は **4 u16 ループ**（+0x2C..+0x32）、cat24 は **+0x32 単独 cmp** — 銃剣は第4スロット専用。

### 武器 ammo_indices 内の cat=24 行

| 武器 | 付属 (cat=24) |
|------|---------------|
| M1903A1 (5) | John Byt (251) |
| M1903A4 (6) | John Byt (251) |
| M1 Rifle (8) | John Byt (251) |
| M1941 Rifle (11) | M4 Byt (252) |
| M1 Cbn (12) | Mk1 TKnf (253) |
| M1A1 Cbn (13) | Mk1 TKnf (253) |
| M2 Cbn (14) | Mk1 TKnf (253) |
| Gew98 (55) | Messer (314) |
| Kar98b (56) | Messer (314) |
| Kar98k (57) | Messer (314) |
| Gew29/40 (59) | Messer (314) |
| Gew33/40 (60) | Messer (314) |
| Gew98/40 (61) | Messer (314) |
| Gew41(W) (65) | Messer (314) |
| Gew41(M) (66) | Messer (314) |
| Zf Kar98k (69) | Messer (314) |
| MKb42(W) (73) | Messer (314) |
| MKb42(H) (74) | Messer (314) |
| MP28/2 (78) | Messer (314) |
| F. mod91 (124) | BP.MAB38 (332) |
| … | +16 more |

## 関連

- [PL_CBE_UI_TABLE_RE.md](./PL_CBE_UI_TABLE_RE.md) — +0x48 列構築 / equip_ui 構造体
- [PL_AUX_EQUIPMENT.md](./PL_AUX_EQUIPMENT.md)
- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)
