# CBE 装備 UI 連鎖 RE — F7C8 / 8B 書込 / +0xA4 / 三脚列

**生成**: 2026-05-31 — `python scripts/re_cbe_equip_chain.py`

## 連鎖（確定）

```
open 装備画面
  @ 0xECCF  call 0xF7C8 ×4  → ui+0x40/48/50/58
  @ 0x4252C call 0x4240C    → 小隊員候補 ( +0xA4 mask, +0x3E 出力 )
  @ 0x467A1 call 0x46866     → 8B エントリ append
  @ 0x46C00 装備確定
      @ 0x46CD4  weapon.u26 ↔ ui+0x48/+0x50 列照合
```

## equip_ui レイアウト（修正版）

| ui+ | 列 | resource | +0xA4 bit | 内容 |
|-----|-----|----------|-----------|------|
| `0x40` | 0 | `0x04C4` | bit1 | 主武器 cbe index（スカラー） |
| `0x48` | 1 | `0x04C6` | bit2 | 弾薬箱 / u26 リンク — 46CD4 entry[0] |
| `0x50` | 2 | `0x04C7` | bit3 | 三脚 Laf34 等 — 46CD4 entry[1] |
| `0x58` | 3 | `0x04C8` | bit4 | 観測鏡 / その他副装備 |

**8B エントリ**（col1/col2 — `@ 0x46CD4` が走査）:

```
[+0] u16 link_index  — weapon.u16[26] (+0x34) と cmp
[+4] u16 state_value  — 一致時 weapon.+0x28 へ
stride 8; entry[0]@+0x48, entry[1]@+0x50
```

三脚 **Laf34(112)** は u26 ではなく **col2 (ui+0x50)**。
弾薬箱 **PatrK15(116)** は **col1 (ui+0x48)** + weapon.u26。

## `@ 0x4240C` — +0xA4 bitmask（確定）

```asm
0x042418  mov    si, word ptr es:[di + 0x28]   ; roster_slot
0x04241C  lea    ax, [si + 1]                  ; mask = slot+1
0x0424BA  test   word ptr es:[si + 0xa4], ax   ; member slot mask
0x0424FC  mov    ax, word ptr [si + 0x3e]      ; cbe index 出力
```

## `@ 0x46866` — 8B エントリ書込（確定）

呼び出し元: `0x0467A1`

```asm
0x046866  push   bp
0x046867  mov    bp, sp
0x046869  mov    bx, word ptr [bp + 6]
0x04686C  mov    ax, word ptr [bp + 0xa]
0x04686F  mov    es, word ptr [bp + 8]
0x046872  mov    word ptr es:[bx], ax
0x046875  mov    ax, word ptr [bp + 0xc]
0x046878  mov    word ptr es:[bx + 2], ax
0x04687C  mov    eax, dword ptr [bp + 0xe]
0x046880  mov    dword ptr es:[bx + 4], eax
0x046885  lea    ax, [bx + 8]
0x046888  mov    dx, word ptr [bp + 8]
0x04688B  leave  
0x04688C  retf    ; call
0x04688D  nop    
0x04688E  enter  0xa, 0
0x046892  push   di
0x046893  push   si
```

次エントリ pointer = `bx + 8` (@ 0x468885)。

## `@ 0x46CD4` — u26 ↔ col1/col2

```asm
0x046CD4  cmp    word ptr es:[bx + 0x34], 0 ; +0x34/u26
0x046CD9  je     0x46d42
0x046CDB  cmp    word ptr es:[bx + 0x28], 0 ; +0x28
0x046CE2  mov    di, 1
0x046CE5  mov    ax, word ptr [bp + 6]
0x046CE8  mov    dx, word ptr [bp + 8]
0x046CEB  add    ax, 0x48
0x046CEE  mov    bx, ax
0x046CF0  mov    word ptr [bp - 2], dx
0x046CF3  mov    cx, word ptr [bp - 8]
0x046CF6  mov    ds, word ptr [bp - 6]
0x046CF9  mov    es, word ptr [bp - 2]
0x046CFC  mov    ax, word ptr es:[bx]
0x046CFF  mov    si, cx
0x046D01  cmp    word ptr [si + 0x34], ax ; +0x34/u26
0x046D04  je     0x46d14
0x046D06  add    bx, 8
0x046D0A  cmp    di, 2
0x046D16  mov    bx, word ptr [bp + 6]
0x046D19  mov    ax, bx
0x046D1B  mov    dx, word ptr [bp + 8]
0x046D1E  mov    cx, di
0x046D23  add    ax, di
0x046D25  add    ax, 0x40
0x046D28  mov    word ptr [bp - 0xc], ax
0x046D2B  mov    word ptr [bp - 0xa], dx
0x046D2E  mov    es, dx
0x046D30  mov    si, ax
0x046D32  mov    word ptr es:[bx + 0x11e], cx
0x046D37  mov    ax, word ptr es:[si + 4]
0x046D3E  mov    word ptr es:[si + 0x28], ax ; +0x28
0x046D45  cmp    word ptr es:[bx + 0x28], 0 ; +0x28
0x046D4A  je     0x46d63
0x046D4F  mov    ax, word ptr es:[bx + 2]
```

ループは **ui+0x48 から最大 2 エントリ** → col1(弾薬箱) + col2(三脚)。

## `@ 0x105A` (seg5) — populate / 検証

```asm
0x03C553  call   0x3c652 ; call
0x03C578  lcall  0x10f2, 0xa2bc ; call
0x03C5AF  lcall  0x1187, 0xd0da ; call
0x03C5F4  mov    ax, word ptr es:[bx + 0x42ea] ; +4 state
0x03C602  call   0x3c618 ; call
0x03C617  retf    ; call
```

`[ui+0x40+n×8]` の word を cbe index として `shl 6` 参照。

## F7C8 下位 lcall（seg5 解決）

| seg5+off | file | 役割 |
|---------|------|------|
| `0x105A` | `0x03C51A` | F7C8→lcall — 列項目追加・8B 検証 |
| `0x0D47` | `0x03C207` | リスト表示マージ @ seg5+0xD47 |
| `0x0D74` | `0x03C234` | ウィジェット更新 |

列ラベル（DGROUP）:

| ds:off | label | enabled/type words |
|--------|-------|---------------------|
| `0x04DB` | 1 | 0x0031, 0x0032, 0x0033, 0x0034 |
| `0x04DD` | 2 | 0x0032, 0x0033, 0x0034, 0x7325 |
| `0x04DF` | 3 | 0x0033, 0x0034, 0x7325, 0x7325 |
| `0x04E1` | 4 | 0x0034, 0x7325, 0x7325, 0x2528 |

## MG 完成形 — CBE マッピング

| 武器 | col0 主武器 | col1 u26/箱 | col2 三脚(cbe) |
|------|-------------|-------------|----------------|
| M1919A6 LMG (20) | — | M2HB Ammobox (35) | Laf* (None) |
| M1917A1 MMG (22) | — | M2HB Ammobox (35) | Laf* (32) |
| M1919A4 MMG (23) | — | M2HB Ammobox (35) | Laf* (32) |
| M2 HB HMG (24) | — | M3 Binocular (36) | Laf* (31) |
| MG08/15 (87) | — | Fernglas (117) | Laf* (None) |
| MG08/18 (88) | — | Fernglas (117) | Laf* (None) |
| MG34 (91) | — | PatrK15 (116) | Laf* (112) |
| MG34S (92) | — | PatrK15 (116) | Laf* (112) |
| MG34/41 (93) | — | PatrK15 (116) | Laf* (112) |
| MG42 (94) | — | PatrK15 (116) | Laf* (113) |

## 未完了

1. **pool_idx → cbe index** — **確定: identity** @ 0x2170EC → [PL_CBE_POOL_CBE_RE.md](./PL_CBE_POOL_CBE_RE.md)
2. **`@ 0x422B8` validate** — [PL_CBE_VALIDATE_422B8_RE.md](./PL_CBE_VALIDATE_422B8_RE.md) → `pl_cbe_aux_compat.js`
3. **ST ランタイム** — `pl_ammo_resolve.js` + マスタ再ビルド（composite 入り）

## 関連

- [PL_CBE_F7C8_RE.md](./PL_CBE_F7C8_RE.md)
- [PL_CBE_UI_TABLE_RE.md](./PL_CBE_UI_TABLE_RE.md)
- [PL_WEAPON_COMPOSITE_LINK.md](./PL_WEAPON_COMPOSITE_LINK.md)
