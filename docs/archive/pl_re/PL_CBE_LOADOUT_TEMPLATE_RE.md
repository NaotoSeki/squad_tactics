# CBE loadout descriptor テンプレ — seg132 静的 dump RE

**生成**: 2026-05-31 — `python scripts/re_cbe_loadout_template.py`

## 結論

### 静的 descriptor 正本 = **NE seg132**（file `0x1DBF80`..`0x1DD9B6`）

runtime `DS:0x13BD` の **file マップはロード時パッチ依存**で単一確定できず。
しかし **Kar98k 装填 descriptor** は seg132 内に **明示的に存在**（mission/unit テーブルと同所）。

### Kar98k 確定ブロック @ `0x1DCAAC`

```
header = [weapon_id=55, mag_word=0x003A, pad=0]
mag_word & 0x800F = cx_gate **10**
  (raw mag_type 58 → masked **0x000A** = 10 — cmp 挙動要 runtime 確認)
class nibble = 10  →  buffer **B (0x18a)**
index pairs @ 0x1DCAB2
```

| idx | qty | CBE 名称 | mag_type | cap |
|-----|-----|----------|----------|-----|
| **272** | 4 | 7.92-5 | 58 | 5 |
| **269** | 4 | ? | 54 | 1 |
| **273** | 6 | 7.92-10G | 68 | 10 |
| **314** | 1 | Messer | 0 | 0 |

**272 と 273 が同一 mag58 グループ内に共存** — 3D540 では別 header 行（58 vs 68）で分岐。

### mag68 行 @ `0x1DC752`（参考）

- header mag_word `0x0044` cx_gate=**4** @ `0x1DC752`
- pairs 直前 u16: `[308, 2]`（308×2 — 用途未確定、pairs は `0x1DC75C` から）
- pairs: 274×2, 273×6, 314×1

### `weapon_key` 12B テーブル（`key*12+0x2CE`）

全 DATA seg 走査で pc/sc 妥当行: **0** 件。

- seg132 内 **0 件** — 12B 行は **別 seg（runtime DS）** の可能性大

### 3D42A との接続（復習）

```
3D72A: weapon_key = ad1c[+0xF0] → DS:+key*12+0x2CE → ad18+0x52 (12B)
3DBC2: ad18 テンプレ → ad1c+0x46 blob
3D42A: blob header → cx=&0x800F → cmp ammo[+0x2A] @ 3D540
         index 列は buffer A(0x128)/B(0x18a) — 3D4D7 class nibble
```

seg132 の (idx,qty) 列は **index buffer 内容**と整合 — header `0x003A`/`0x0044` は
`3D540` の cx 期待値そのもの。

### DS:0x13BD 探索

- seg103 `file~0x13Bxxx` file=`0x13B280` para=`0x4ECA0`

seg132 mag58/68 ヘッダ scan: **21** 件（先頭30件を JSON）

## ST 再現指針

1. **短期**: seg132 から unit 別 `(header, [(idx,qty)...])` を JSON export
2. **中期**: `3DBC2` 相当 — header stream + index buffer を blob 合成
3. **3D540**: `cx = header & 0x800F` — [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)

Kar98k ST 暫定:
```json
{
  "groups": [
    {
      "cx": 58,
      "indices": [
        272,
        269,
        273,
        314
      ]
    },
    {
      "cx": 68,
      "indices": [
        274,
        273,
        314
      ]
    }
  ]
}
```

## 未完了

1. runtime **DS:0x13BD → file seg** reloc / ローダマップ
2. **ad1c+0xF0** 書込箇所 — weapon_key と cbe 57 の対応
3. buffer **0x128/0x18a** の file/runtime ダンプ

## 関連

- [PL_CBE_3DBC2_RE.md](./PL_CBE_3DBC2_RE.md)
- [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)
- [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md)
- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)
