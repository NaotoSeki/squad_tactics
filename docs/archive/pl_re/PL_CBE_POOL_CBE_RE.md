# CBE 名称系統 RE — 表示プール / cbe index / DATA 走査

**生成**: 2026-05-31 — `python scripts/re_cbe_pool_cbe_scan.py`

## 全体像（確定）

```
CBE 名称 @ file 0x2170xx
  ├─ 拡張テーブル @ 0x2170D0 … (none) 等プレフィックス → M1911A1
  ├─ 正本チェーン @ 0x2170EC … pool_idx == cbeNameIndex
  │     M1911A1(0), M1917 S&W(1), … Laf34(112), PatrK15(116)
  └─ 64B レコード u16[0] = cbeNameIndex + 1（1-indexed 名称参照）

装備 UI @ 0x4240C 出力 member+0x3E = cbe index 直値（pool 変換不要）
```

> **訂正**: 旧「pool#67=M1 Ammobox, cbe=34」は **0x216E00 からの誤パース**（0xFF 域を
> cp932 カウント）。正しくは **pool#34 = cbe#34** @ 0x217224。

| 系統 | 件数 | ルール |
|------|------|--------|
| 正本 name chain | 462 | **pool_idx == cbe_idx** @ 0x2170EC |
| 拡張テーブル | 462 | cbe0 @ ext_idx **0** |
| identity 一致 | 456/462 | 名称も cbe_name_table と一致 |

**DATA u16 変換表**: 別途 **不要** — 名称列自体が cbe 順。

## 3 系統の使い分け

| 用途 | 参照 |
|------|------|
| stats / acceptsAmmo / 装填 | `cbeNameIndex` → cbe_name_table.json |
| 64B レコード名称 | u16[0] = cbe + 1 |
| 装備 UI リスト / 4240C | cbe index 直値 — 名称は chain[cbe] |

## 64B レコード u16[0]

| 検証 | 件数 |
|------|------|
| u16[0] == cbe+1 | 120/120 |
| u16[0] == pool+1 | 120/120 |

**結論**: u16[0] は **1-indexed cbe chain** 参照。pool 変換表は存在しない。

## 副装備 — index 一覧（pool==cbe）

| cbe | 名称 |
|-----|------|
| 31 | M2 Tripod |
| 32 | M1917 Tripod |
| 33 | M3 Tripod |
| 34 | M1 Ammobox |
| 35 | M2HB Ammobox |
| 36 | M3 Binocular |
| 112 | Laf34 |
| 113 | Laf42 |
| 115 | PatrK41 |
| 116 | PatrK15 |
| 117 | Fernglas |
| 142 | Binocolo |
| 183 | Tripod Mk2 |
| 184 | Tripod Mk4 |
| 186 | Binocular |
| 207 | M07 Laf |
| 208 | M07 PatrK |
| 250 | M1905Byt |
| 251 | John Byt |
| 252 | M4 Byt |
| 314 | Messer |

## DATA セグ走査

pool→cbe **別表は未検出**（同一チェーンのため不要）。

## 4240C 候補 index 列

ランタイム DATA 列 — file 0x270 は PE ヘッダ域（別セグにロード）。

## 未突合行

- #456: `%s`
- #457: `_C_FILE_INFO=`
- #458: `(`
- #459: `\`
- #460: `P`

## ST 利用

- 名称解決: 既存 `cbe_name_table.json` / `PL_AMMO_DATA` で十分
- `pl_cbe_pool_map.js`: identity マップ（冗長だが明示用）
- pool→cbe 変換ロジック **不要**

## 関連

- [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md)
- [PL_CBE_F7C8_RE.md](./PL_CBE_F7C8_RE.md)
