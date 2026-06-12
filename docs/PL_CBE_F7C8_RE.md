# CBE `@ 0xF7C8` — UI リスト列 / 小隊候補走査

**生成**: 2026-05-31 — `python scripts/re_cbe_f7c8_disasm.py`

**正本**: CBE RE。攻略本 [PL_MANUAL_WEAPON_LIST_REF.md](./PL_MANUAL_WEAPON_LIST_REF.md) は一致時の安心材料のみ。

## 概要

装備画面で `equip_ui` の **+0x40/+0x48/+0x50/+0x58** 列（8B stride エントリ）を構築する。
`@ 0x46CD4` の +0x34 走査は **ui+0x48 列**（col1）を読む。

### 列ビルド `@ 0xECCF`（4 回 `call 0xF7C8`）

| リソース ID | ui オフセット | 役割 |
|-------------|---------------|------|
| `0x4C4` | +0x40 | col0 — ui+0x40 |
| `0x4C6` | +0x48 | col1 — ui+0x48 (+0x34 走査入力) |
| `0x4C7` | +0x50 | col2 — ui+0x50 |
| `0x4C8` | +0x58 | col3 — ui+0x58 |

各呼び出し: `push label_id; push ds; push fmt_ptr; push ui+col; push equip_ui; call 0xF7C8`

## `@ 0xF7C8` — リスト列ポインタ `[bp+0xA]`

```c
// retf 0xE — 7 words args
void ui_build_column(equip_ui *ui, void *col_base /*ui+0x40|0x48|…*/,
                     fmt_desc *desc /*ds:0x4DB etc*/, u16 resource_id);
if (desc->enabled == 0) { empty_column(); return; }
type = desc->word_at_2;
if (type == 0x8C00) { /* 特殊: 固定文字列 @ ds:0x56E */ }
else {
  compose_label(desc, flags);  // ds:0x577/0x57C/0x581…
  sprintf(buf, fmt[desc->index_at_6], …);  // fmt @ 0x590|0x592|0x596
  lcall … populate list → col_base 8B entries
}
lcall … merge into ui widget
```

**8B エントリ**（`@ 0x46CD4` 側）:

```
[+0] u16 link_index  — weapon.u16[26]; cmp @ 0x46D01
[+4] u16 state_value — → weapon.+0x28 @ 0x46D37
```

F7C8 自身は **表示文字列＋リスト UI** を組み立て、link_index の直接書込は下位 lcall（`0x105A` / `0xD47` 系、seg:off 実行時解決）側。

### 主要逆アセンブル

```asm
0x00F7D1  cmp    word ptr es:[bx], 0
0x00F7D5  je     0xf8cc
0x00F7D9  mov    ax, word ptr es:[bx + 2]
0x00F7DD  mov    word ptr [bp - 2], ax
0x00F7E0  cmp    ax, 0x8c00 ; type
0x00F7E3  jne    0xf804
0x00F7E5  mov    di, 0x56e
0x00F7EB  mov    cx, ds
0x00F7ED  mov    es, cx
0x00F7F0  mov    cx, 0xffff
0x00F808  je     0xf810
0x00F80A  mov    di, 0x577
0x00F810  mov    di, 0x57c
0x00F816  mov    cx, ds
0x00F818  mov    es, cx
0x00F81B  mov    cx, 0xffff
0x00F839  je     0xf840
0x00F83B  mov    di, 0x581
0x00F844  je     0xf84c
0x00F846  mov    di, 0x586
0x00F84C  mov    di, 0x58b
0x00F852  mov    cx, ds
0x00F854  mov    es, cx
0x00F857  mov    cx, 0xffff
0x00F860  mov    bx, cx
0x00F868  mov    cx, 0xffff
0x00F86E  mov    cx, bx
0x00F87C  cmp    word ptr es:[bx + 6], ax
0x00F880  jne    0xf888
0x00F882  mov    ax, 0x590
0x00F888  cmp    word ptr es:[bx + 6], 1
0x00F88D  jne    0xf894
0x00F88F  mov    ax, 0x592
0x00F894  mov    ax, 0x596
0x00F897  mov    word ptr [bp - 2], ds
0x00F8A8  lcall  0, 0xffff
0x00F8C1  lcall  0, 0x105a
0x00F8D9  lcall  0, 0xd47
0x00F8F0  lcall  0, 0xd74
0x00F900  mov    ax, 0x59e
```

## `@ 0x4240C` — 小隊ロスター → 候補 index 列

ミッション小隊 `es:[0xAD20]` + `(member_index << 9)` で各員レコードを走査。

```c
mask = (roster_slot + 1);  // lea ax,[si+1]
for each candidate_item_index in mission_table:
  member = squad[member_index];
  if (member.u16[20] == roster_slot) skip;     // +0x28
  if (!(member.u16[0xA4] & mask)) skip;        // スロット bitmask
  if (member.u16[0xBA] != 0) skip;             // 割当済みカウンタ
  if (!validate_422B8(member, ui)) skip;
  output_list.push(member.u16[0x3E]);           // cbe item index
  member.u16[0xBA]++;
output_list.push(0xFFFF);
```

### フィルタ `@ 0x424B1`

```asm
0x0424B1  cmp    word ptr es:[bx + 0x28], ax ; +0x28
0x0424B5  je     0x42509
0x0424BA  test   word ptr es:[si + 0xa4], ax ; +0xA4 mask
0x0424BF  je     0x42509
0x0424C1  cmp    word ptr es:[si + 0xba], 0 ; +0xBA ctr
0x0424C7  jne    0x42509
0x0424CF  add    bx, word ptr es:[si + 0x8a] ; +0x8A
0x0424DA  cmp    word ptr es:[bx + 0x2cca], 0
0x0424E0  jne    0x42509
0x0424EB  call   0x422b8 ; call
0x0424F3  je     0x42509
0x0424F8  inc    word ptr [si + 0xba] ; +0xBA ctr
0x0424FC  mov    ax, word ptr [si + 0x3e] ; +0x3E idx
0x04250C  cmp    word ptr es:[di], 0
```

**+0xA4**: 装備スロット可用 **bitmask**（`test [member+0xA4], (slot+1)`）。
**+0xBA**: 列ごとの割当 **カウンタ**（重複防止）。
**+0x3E**: 出力する **cbe item index**（名称は別プール参照）。

## 名称プール `@ 0x217000`（表示用）

連続 null 終端 ASCII 文字列 **462** 件。
**pool_idx == cbeNameIndex** @ 0x2170EC（旧 0x216E00 誤パースを訂正）。

### 副装備関連（攻略本と一致 — 安心材料）

| pool# | 名称 |
|-------|------|
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
| 183 | Tripod Mk2 |
| 184 | Tripod Mk4 |
| 186 | Binocular |
| 207 | M07 Laf |
| 208 | M07 PatrK |
| 250 | M1905Byt |
| 251 | John Byt |
| 252 | M4 Byt |
| 314 | Messer |

攻略本: M1919→M1 Ammobox+M1917 Tripod、M2 HB→M2 Ammobox+M3 Tripod。
CBE u16[26]: M1919→35 M2HB Ammobox、M2 HB→36 **M3 Binocular**（表記/リンク差 — CBE 正本）。

## 未完了

1. ~~**pool_idx → cbe index**~~ — identity @ 0x2170EC → [PL_CBE_POOL_CBE_RE.md](./PL_CBE_POOL_CBE_RE.md)
2. `ds:0x4DB` 等 **列ラベル文字列** の CP932 デコード（フォーマット記述子）
3. **装填 +0xCE 接続** — `@ 0x3D68F` / `@ 0x3D42A` → [PL_CBE_F7C8_DEEP_RE.md](./PL_CBE_F7C8_DEEP_RE.md)（F7C8 直結ではない）

**確定済み** → [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md):
- +0xA4 bitmask = (roster_slot+1)
- `@ 0x46866` 8B 書込
- 三脚 = col2 (ui+0x50), 弾薬箱 = col1 (ui+0x48)

## 関連

- [PL_CBE_UI_TABLE_RE.md](./PL_CBE_UI_TABLE_RE.md)
- [PL_CBE_AUX_UI_RE.md](./PL_CBE_AUX_UI_RE.md)
- [PL_MANUAL_WEAPON_LIST_REF.md](./PL_MANUAL_WEAPON_LIST_REF.md)
