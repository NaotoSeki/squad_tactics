# CBE 装填 UI リスト — `@ 0x1805A` トレース

**生成**: 2026-05-31 — `python scripts/re_cbe_ammo_ui_loadlist.py`

## 結論（このセッション）

**0x1805A は装填リスト構築の入口ではない。**

```
if (weapon_row[+0x2A] == 0)  // w21 / mag_type
    return 0xFFFF;            // → 「制限なし」側へ
else
    walk list at weapon[+0xCE] + 0x40  (8 bytes × max 7)
```

| フェーズ | 関数 (file) | 役割 |
|---------|-------------|------|
| **リスト構築** | `0xF7C8` ← `0xECCF` | 文字列 ID 0x4C4/4C6/4C7… → UI 列 |
| **スロット検索 A** | `0x1804E` (**0x1805A** 内) | 構築済みリスト走査 + `lcall 0x9858` |
| **スロット検索 B** | `0x180B4` | 列 0..6 直試行 + `lcall 0x9698` |
| **装備 UI 反映** | `0x178A0` | precheck → find → `weapon[+0xE6]` → 名称描画 |

→ **lcall 先は解決済み** — [PL_CBE_AMMO_UI_MATCH_RE.md](./PL_CBE_AMMO_UI_MATCH_RE.md)（`0xA6EA`/`0xA908`。**cap cmp 無し**）
→ **F7C8 深掘り** — [PL_CBE_F7C8_DEEP_RE.md](./PL_CBE_F7C8_DEEP_RE.md)（+0xCE は `0x3D42A` 経由、F7C8 非直結）

## ランタイム `weapon_row` オフセット（装填 UI 行）

> 64B CBE テーブル行そのものではない（+0xCE=206 byte）。`equip_ui` 拡張ワーク。

| オフセット | 役割 | 根拠 |
|-----------|------|------|
| +0x2A | mag_type (w21) | @ 0x1805A cmp |
| +0xCE / +0xD0 | 装填リスト far ptr | @ 0x18061, 0x17997 |
| +0xE6 | 選択スロット index | @ 0x179B8 書込 |
| +0xCC | 表示用フィールド | @ 0x179DA |
| +0x14 | cbe index | push @ 0x17945 |

### リストエントリ（`list + 0x40 + slot×8`）

```
[+0] u16 link_index   // 0 ならスキップ @ 0x18078
[+4] u16 state_value // @ 0x185D9 参照
```

## コールグラフ

```
0xECCF / 0xF126
  └─ call 0xF7C8          … 列バッファ構築（正本候補）

0x178A0 equip_ui_ammo_refresh
  ├─ call 0x18166         … precheck
  ├─ call 0x1804E         … find_slot_by_list  ← 0x1805A
  └─ lcall 表示系         … 0x9198 / 0x91BC

0x17C3E / 0x17EAF / 0x185BD
  └─ call 0x180B4         … find_slot_by_column
```

## 偽コード

### `ammo_ui_find_slot_by_list` @ 0x1804E

```c
// @ 0x1804E — retf 8 — weapon_row @ (es:bp+6), ctx @ bp+0xA
if (weapon_row[+0x2A] == 0)          // @ 0x1805A
    return 0xFFFF;                   // mag_type 無制限（全スロット可?）
list = weapon_row[+0xCE];            // far ptr
es   = weapon_row[+0xD0];
si   = list + 0x40;                  // 第1エントリ
for (di = 0; di < 7; di++) {
    if ([es:si] == 0) { si += 8; continue; }
    ax,dx = ammo_ui_column_string(ctx, di);   // call 0x180FA
    if (lcall_match(0x9858, weapon, ax,dx, ctx))  // 要 fixup 解決
        return di;
    si += 8;
}
return 0xFFFF;
```

### `ammo_ui_find_slot_by_column` @ 0x180B4

```c
// @ 0x180B4 — リスト中身を見ず列 0..6 を試す
if (weapon_row[+0x2A] == 0)
    return 0xFFFF;
for (si = 0; si < 7; si++) {
    ax,dx = ammo_ui_column_string(ctx, si);
    if (lcall_match(0x9698, weapon, ax,dx, ctx))
        return si;
}
return 0xFFFF;
```

### `equip_ui_ammo_refresh` @ 0x178A0（抜粋）

```c
// @ 0x178A0 enter 0x26 — 装備 UI 行更新（game state gate @ 0x1796A）
if (es:[0xAD32]!=4 || es:[0x178]!=1) goto fail;
if (weapon[+0xCE]==0 && weapon[+0xD0]==0) goto fail;
if (!ammo_ui_precheck(weapon)) goto fail;          // 0x18166
slot = ammo_ui_find_slot_by_list(weapon, ctx);     // 0x1804E @ 0x179B2
weapon[+0xE6] = slot;
if (slot < 0) goto fail;                           // 0xFFFF → jl
// slot → UI 行アドレス: (slot<<3) + weapon[+0xCE] + 0x40  @ 0x179EF
// → 名称表示 lcall 0x9198 / 0x91BC / 0x923D
```

## 逆アセンブル — `@ 0x1805A` 核心

```asm
0x01804E  enter  4, 0 ; **
0x018052  push   di
0x018053  push   si
0x018054  mov    es, word ptr [bp + 8]
0x018057  mov    bx, word ptr [bp + 6]
0x01805A  cmp    word ptr es:[bx + 0x2a], 0 ; w21/mag_type
0x01805F  je     0x180aa
0x018061  mov    ax, word ptr es:[bx + 0xce] ; list_ptr
0x018066  mov    dx, word ptr es:[bx + 0xd0] ; list_ptr_hi
0x01806B  add    ax, 0x40
0x01806E  mov    si, ax
0x018070  mov    word ptr [bp - 2], dx
0x018073  xor    di, di
0x018075  mov    es, word ptr [bp - 2]
0x018078  cmp    word ptr es:[si], 0
0x01807C  je     0x18096
0x01807E  push   di
0x01807F  push   dword ptr [bp + 6]
0x018083  push   cs
0x018084  call   0x180fa ; **
0x018087  push   dx
0x018088  push   ax
0x018089  push   dword ptr [bp + 0xa]
0x01808D  lcall  0, 0x9858 ; **
0x018092  or     ax, ax
0x018094  jne    0x180a2
0x018096  add    si, 8
0x018099  inc    di
0x01809A  cmp    di, 7
0x01809D  jl     0x18075
0x01809F  jmp    0x180aa
0x0180A1  nop    
0x0180A2  mov    ax, di
0x0180A4  pop    si
0x0180A5  pop    di
0x0180A6  leave   ; **
0x0180A7  retf   8 ; **
0x0180AA  mov    ax, 0xffff
0x0180AD  pop    si
0x0180AE  pop    di
0x0180AF  leave   ; **
0x0180B0  retf   8 ; **
0x0180B3  nop    
0x0180B4  push   bp
```

## 未確定（次の RE）

1. lcall 0,0x9858 / 0,0x9698 の実アドレス（NE fixup / ITEML）
2. weapon_row +0xCE リストを誰が構築するか（0xECCF→0xF7C8 との接続）
3. lcall_match 内部 — mag_type 0x18BF3 / u27 / cap 照合の有無
4. 272 (7.92-5) が ammo_indices 無しで UI に出る経路

## 関連

- [PL_CBE_UI_TABLE_RE.md](./PL_CBE_UI_TABLE_RE.md) — 0xF7C8 / equip_ui
- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md) — cat18 / 0x18BF3
- [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md) — 0x4240C ロスター
- `scripts/pl_decoded/cbe_ammo_ui_loadlist_re.json`
