# CBE `@ 0xF7C8` 深掘り — populate / +0xCE 接続

**生成**: 2026-05-31 — `python scripts/re_cbe_f7c8_deep.py`

## 結論

### 1. F7C8 は薄い「列ビルダー」

`0xECCF` から 4 回呼ばれ、`equip_ui` の **+0x40/+0x48/+0x50/+0x58** を初期化する。
本体ロジックは **`seg5+0x105A` (`0x3C51A`)** の populate — F7C8 はラベル文字列と lcall 3 発のラッパ。

### 2. 装填リスト (+0xCE) は F7C8 とは別パイプライン

| パイプライン | 入口 | 出力 |
|-------------|------|------|
| **装備 composite 列** | `0xECCF` → `0xF7C8` | `equip_ui` 8B 列（武器/弾箱/三脚） |
| **装填 UI リスト** | `0x3D1BA` → `0x3D42A` | `weapon_row` **+0xCE/+0xD0/+0xD2** far ptr |

装填 refresh (`0x178A0`) は **構築済み +0xCE** を読むだけ — **F7C8 を呼ばない**。

### 3. +0xCE 確定アンカー — `@ 0x3D68F`

```asm
lcall  … → si = UI widget blob
mov    ax, word ptr es:[si + 0x20]
mov    word ptr es:[bx + 0xce], ax   ; list offset
mov    ax, word ptr es:[si + 0x1e]
mov    word ptr es:[bx + 0xd0], ax   ; list segment
mov    ax, word ptr es:[si + 0x22]
mov    word ptr es:[bx + 0xd2], ax   ; match 用副 ptr
```

widget 自体は `@ 0x2CD00` で生成（+0xCE ゼロクリア → lcall UI create）。

### 4. populate 内 CBE ゲート（cat18 ではない）

`@ 0x3C5A5` — 列エントリ `list+0x40` 走査中:

```asm
mov    bx, word ptr es:[si]     ; cbe index
shl    bx, 6
cmp    word ptr es:[bx + 2], 9  ; category == 9 のみ通過
cmp    word ptr es:[si + 6], 2  ; entry type >= 2
```

**cat18 / ammo_indices (`0x771E`) は populate 直 call 無し** — 装填候補の絞り込みは
`0x3D42A` 上流（候補 index 列）か外部 lcall 側。272/cap はここにも cmp 無し。

### 5. loadout builder `@ 0x3D42A` — mag_type 確定

```asm
0x03D540  cmp    word ptr es:[di + 0x2a], cx   ; member mag_type 一致
0x03D546  cmp    word ptr es:[di + 0xba], 0    ; 割当カウンタ
… 8B stride ループ @ 0x3D614..672 …
0x03D674  lcall  → widget ptr
0x03D68F  → weapon_row +0xCE/+0xD0/+0xD2
```

## 呼び出しグラフ（確定）

```
装備画面 open
  0xECCF  call 0xF7C8 ×4
    └─ lcall 0x105A  populate (cat==9 gate @ 3C5A5)
    └─ lcall 0xD47   merge widget
    └─ lcall 0xD74   refresh
  0x4240C 小隊員候補 index
  0x46866 8B append (composite 列)

装填 UI open / refresh
  0x3D1BA  open_loadout_ui_session
    call 0x3D72A
    call 0x3D42A  loadout_ui_build_and_link
      mag_type @ 3D540
      widget → +0xCE/+0xD0/+0xD2 @ 3D68F
  0x178A0  equip_ui_ammo_refresh
    call 0x18166 precheck
    call 0x1804E  walk weapon[+0xCE]+0x40
    mov weapon[+0xE6], slot
```

**call 0xF7C8**: `0x00ECD9, 0x00ECF1, 0x00ED09, 0x00ED21`

### +0xCE mov 書込（コードセグメント走査）

| file | 命令 |
|------|------|
| `0x02CD0B` | `mov dword ptr es:[si + 0xce], 0` |
| `0x0330BA` | `mov word ptr es:[si + 0xce], 0` |
| `0x0330D8` | `mov word ptr es:[si + 0xce], 1` |
| `0x0330F3` | `mov word ptr es:[si + 0xce], 2` |
| `0x03310D` | `mov word ptr es:[si + 0xce], 3` |
| `0x033127` | `mov word ptr es:[si + 0xce], 4` |
| `0x033A3A` | `mov ax, word ptr es:[si + 0xce]` |
| `0x033F53` | `mov ax, word ptr es:[si + 0xce]` |
| `0x037BC3` | `mov word ptr es:[bx + 0xce], 0xffff` |
| `0x037DAC` | `mov word ptr es:[si + 0xce], ax` |
| `0x03D68F` | `mov word ptr es:[bx + 0xce], ax` |

+0xCE 参照総数（code seg）: **12**

## `@ 0x2CD00` weapon_row UI init

```asm
0x02CD0B  mov    dword ptr es:[si + 0xce], 0 ; +0xCE
0x02CD19  mov    dword ptr es:[si + 0xd2], eax ; +0xD2
0x02CD73  lcall  0x7f, 0xa55a ; call
```

## populate cat gate `@ 0x3C580`

```asm
0x03C5A5  cmp    word ptr es:[bx + 2], 9 ; cmp
0x03C5AF  lcall  0x1187, 0xd0da ; call
0x03C5B7  cmp    ax, 0x19 ; cmp
0x03C5BF  cmp    word ptr es:[si + 6], 2 ; cmp
0x03C5CA  cmp    di, 3 ; cmp
0x03C5E5  cmp    word ptr [bp - 6], 0 ; cmp
0x03C5F4  mov    ax, word ptr es:[bx + 0x42ea] ; +0x42EA
0x03C602  call   0x3c618 ; call
```

## `@ 0x3D68F` ptr copy

```asm
0x03D674  lcall  0x2207, 0xaa98 ; call
0x03D68F  mov    word ptr es:[bx + 0xce], ax ; +0xCE
0x03D6A1  mov    word ptr es:[bx + 0xd0], ax ; +0xD0
0x03D6B3  mov    word ptr es:[bx + 0xd2], ax ; +0xD2
```

## `@ 0x3D200` loadout session → 3D42A

```asm
0x03D210  call   0x3d940 ; call
0x03D219  lcall  0x1d65, 0x9768 ; call
0x03D222  lcall  0x1c2f, 0xab7a ; call
0x03D22F  call   0x3d72a ; call
0x03D235  lcall  0x1d91, 0xbcdc ; call
0x03D23B  call   0x3d42a ; call
0x03D242  test   byte ptr es:[0xad27], 0x80 ; cmp
0x03D24B  call   0x3d34c ; call
```

## ST 再現への示唆

CBE から抽出すべき「良いところ」:

- **段階的ゲート**: 候補列挙 → mag_type → UI 確定（データとロジックの分離）
- **composite 装備**: 主武器 + 弾箱 + 三脚を独立 CBE 行で束ねる発想
- **別ベクトルで**: UI blob far ptr / 矩形マッチ / DOS セグメント演算は ST では不要

272 / cap: **3D42A 無し** — populate @ **0x3C81A** に cap cmp 確定 → [PL_CBE_LOADOUT_CANDIDATE_RE.md](./PL_CBE_LOADOUT_CANDIDATE_RE.md)

## 次の RE

1. ~~`0x3D42A` の **候補 index 列**の供給元~~ → [PL_CBE_LOADOUT_CANDIDATE_RE.md](./PL_CBE_LOADOUT_CANDIDATE_RE.md)
2. populate @ **0x3C81A** cap cmp — [PL_CBE_CAP_SUBSTITUTE_RE.md](./PL_CBE_CAP_SUBSTITUTE_RE.md)（272 差替は `0x3DC50` + lcall `0xD3B0`）
3. widget `+0x20/+0x1e/+0x22` と list blob `+0x40` 8B 列の同一性
4. mission pool `DS:0x270` 静的データ / シナリオロード

## 関連

- [PL_CBE_F7C8_RE.md](./PL_CBE_F7C8_RE.md)
- [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md)
- [PL_CBE_AMMO_UI_LOADLIST_RE.md](./PL_CBE_AMMO_UI_LOADLIST_RE.md)
- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)
