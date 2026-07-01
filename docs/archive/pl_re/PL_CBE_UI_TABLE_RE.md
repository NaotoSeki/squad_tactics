# CBE UI テーブル追跡 — `@ 0x46CD4` / `equip_ui`

**生成**: 2026-05-31 — `python scripts/re_cbe_ui_table_trace.py`

## 回答メモ

- **ランタイム反映**（`pl_ammo_resolve.js` 等）は RE 確定後で問題なし。
- **資料写真** — 装備画面スクショ・マニュアル画像は解析可能（UI ラベル・スロット対応の補助に使う）。

## `equip_ui` 構造体（逆アセンブル確定分）

```c
// equip_ui — 装備画面ワーク（[bp+6]:offset, [bp+8]:seg）
struct equip_ui {
  u16 field_04;           // +0x04 → 武器コピー +0x28 へ
  u16 weapon_index;       // +0x40  選択武器 cbe index（装填時に shl 6 コピー元）
  u16 field_42;           // +0x42
  u16 field_44;           // +0x44
  u16 field_46;           // +0x46
  u16 mag_type_seed;      // +0x48  word — mag_type 照合 @ 0x46C65
  u16 field_4A;           // +0x4A
  // col0 @+0x40 = 武器 index（スカラー）
  // col1 @+0x48, col2 @+0x50 = 8B エントリ — @ 0x46CD4 が u26 照合（最大2件）
  struct { u16 link_index; u16 pad; u16 state_value; u16 pad2; } aux_col[2];  // +0x48,+0x50
  u16 roster_slot;        // +0x11E  走査中スロット index
  u16 field_8A;           // +0x8A  小隊員バッファ内 offset（ランタイム）
  weapon_rec copy;        // +0x120 64B CBE レコードコピー
};
```

### フィールド対応

| オフセット | 役割 | 根拠 |
|-----------|------|------|
| +0x40 | 武器 **cbe index**（`shl 6` コピー元） | @ 0x46C17 `add cx,0x40`; `mov di,[si]` |
| +0x48 (word) | **mag_type シード** | @ 0x46C65; 書込 @ 0x19A41 |
| +0x48,+0x50,+0x58… | **8B×N 予備リンク列** | @ 0xECCF `add ax,0x48/0x50`; loop @ 0x46CEB |
| +0x120 | **64B 武器レコード** コピー先 | @ 0x46C0D `add ax,0x120` |
| +0x8A | 小隊員レコード **ランタイム offset** | @ 0x46C75; 0x4240C 走査 |

### 8B 列エントリ（+0x34 走査）

```
[+0] u16 link_index  — weapon.u16[26] (+0x34) と cmp @ 0x46D01
[+4] u16 state_value — 一致時 weapon.+0x28 へ @ 0x46D37
stride 8; di=1..2 → ui+0x48, ui+0x50 の2列
```

## +0x48 列の構築経路

### 1. `@ 0x19A0E` — スカラー初期化

引数から +0x40..+0x4A を直接書込。`w21≠0` なら `[ui+0x48]=cx`、否则 `[ui+0x48]=di`（武器 index）。

```asm
0x019A03  lcall  0, 0xb25b ; call
0x019A21  mov    word ptr es:[bx + 0x40], di ; +0x40
0x019A41  mov    word ptr es:[bx + 0x48], cx ; +0x48
0x019A4E  mov    word ptr es:[bx + 0x48], di ; +0x48
0x019A69  lcall  0xb1fc, 0x5c10 ; call
```

### 2. `@ 0xECCF` / `@ 0xF126` — リスト列構築（**正本候補**）

`call 0xF7C8` / `call 0xF6C6` に **列先頭アドレス**（ui+0x40, +0x48, +0x50…）と
文字列リソース ID（**0x4C4**, **0x4C6**, **0x4C7**…）を渡して UI リストを埋める。

```asm
0x00ECB8  push   word ptr es:[bx + 0x1c]
0x00ECBC  push   dword ptr [bp + 6]
0x00ECC0  push   cs
0x00ECC1  call   0xf692 ; call
0x00ECC4  push   0x4c4
0x00ECC7  push   ds
0x00ECC8  push   0x4db
0x00ECCF  add    ax, 0x40
0x00ECD2  push   eax
0x00ECD4  push   dword ptr [bp + 6]
0x00ECD8  push   cs
0x00ECD9  call   0xf7c8 ; call
0x00ECDC  push   0x4c6
0x00ECDF  push   ds
0x00ECE0  push   0x4dd
0x00ECE7  add    ax, 0x48
0x00ECEA  push   eax
0x00ECEC  push   dword ptr [bp + 6]
0x00ECF0  push   cs
0x00ECF1  call   0xf7c8 ; call
0x00ECF4  push   0x4c7
0x00ECF7  push   ds
0x00ECF8  push   0x4df
0x00ECFF  add    ax, 0x50
0x00ED02  push   eax
0x00ED04  push   dword ptr [bp + 6]
0x00ED08  push   cs
0x00ED09  call   0xf7c8 ; call
0x00ED0C  push   0x4c8
0x00ED0F  push   ds
0x00ED10  push   0x4e1
0x00ED17  add    ax, 0x58
0x00ED1A  push   eax
0x00ED1C  push   dword ptr [bp + 6]
0x00ED20  push   cs
0x00ED21  call   0xf7c8 ; call
0x00ED27  push   dword ptr es:[bx + 0xc4]
```

### 3. `@ 0x4240C` — 小隊ロスター走査（候補フィルタ）

ミッション小隊バッファ `es:[0xAD20]` 基準。各員 `+0x28`, `+0x8A`, `+0xA4`, `+0xBA` を参照し
装備可能 index 列を構築 → `[ui+0x8A]` 更新。@ 0x4252C から `call 0x4240C`。

### 4. `@ 0x57950` — クリア

新規装備 UI 前に +0x40..+0x4C 等を 0 初期化。

## `@ 0x46CD4` ループ ↔ UI 列

```asm
0x046CD4  cmp    word ptr es:[bx + 0x34], 0 ; +0x34
0x046CD9  je     0x46d42
0x046CDB  cmp    word ptr es:[bx + 0x28], 0 ; +0x28
0x046CE0  jne    0x46d42
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
0x046D01  cmp    word ptr [si + 0x34], ax ; +0x34
0x046D04  je     0x46d14
0x046D06  add    bx, 8
0x046D09  inc    di
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
0x046D55  je     0x46d63
0x046D5D  call   0x46dc0 ; call
```

1. `weapon[+0x34] ≠ 0` かつ `weapon[+0x28] == 0`
2. `bx = ui + 0x48`; loop: `ax=[bx]`, cmp `weapon[+0x34]`; `bx+=8`
3. 一致列の `[entry+4]` → `weapon[+0x28]`; `[ui+0x40+di*8]` にも反映

**MG 例**: 武器 u16[26]=35 (M2HB Ammobox) → ui+0x48 列に `{35, …}` エントリが
0xF7C8 経路で入っている前提。

## 装備関数 caller — `lcall …, 0xB740`（**9** 箇所）

| file | seg |
|------|-----|
| 0x039EB8 | 0xCDD4 |
| 0x03A014 | 0xD358 |
| 0x03A1EC | 0xD52B |
| 0x03A41D | 0xD72C |
| 0x03A43C | 0xD2D3 |
| 0x03A4E4 | 0xD4C8 |
| 0x03AE4E | 0xE1CC |
| 0x03D71F | 0x1F73 |
| 0x0494D6 | 0xE022 |

代表: `0x494D6`（小隊員装備確定）, `0x39EB8`, `0x3AE4E`。

## 未追跡

1. `0xF7C8` 内部 — 文字列 ID → 8B エントリ（link_index）の変換規則
2. 0x4C4/0x4C6/0x4C7 文字列 → 実 item index 対応（DATA セグ）
3. 小隊バッファ **`+0xA4`** bitmask — **確定** → [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md)
4. **8B 書込 `@ 0x46866`** — link_index @ [+0], state @ [+4]

## 関連

- [PL_CBE_AUX_UI_RE.md](./PL_CBE_AUX_UI_RE.md)
- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)
- [PL_AUX_EQUIPMENT.md](./PL_AUX_EQUIPMENT.md)
