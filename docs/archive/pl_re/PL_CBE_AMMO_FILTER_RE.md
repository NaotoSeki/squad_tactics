# CBE.EXE 装填フィルタ逆引き

**生成**: 2026-05-31 — `python scripts/re_cbe_ammo_filter_disasm.py`

## 確定ルール

（cat18 / ammo_indices 走査 / mag_type @ 0x18BF3 / w21==0 スキップ — 下記アンカー参照）

---

## ST 仮説 — magazine_capacity 照合（**RE 未確定・終わらない旅の途中**）

> 個別武器の cap 不一致を直すだけでは意味がない。  
> 本節は **データ相関 + 攻略本突合** から逆算した ST 側の暫定実装。  
> **CBE 内の単一確定アンカー（cmp/je + 偽コード）は未特定。**

### オフセット +0x28 の混同注意

| 文脈 | +0x28 の意味 |
|------|----------------|
| **CBE 静的テーブル** 64B レコード @ 0x1DDF00 | **u16[20] = magazine_capacity**（file +40） |
| **ランタイム武器コピー** @ 0x46C00 装備チェーン | **state_value / roster_slot**（entry+4 から書込 @ 0x46C57）— 装填数ではない |

`cmp word ptr [bx+0x28]` は 18 箇所あるが、装填 UI フィルタか roster 走査かは **未トレース**。

### ST 暫定実装（2026-05-25）

`scripts/pl_ammo_cbe_filters.py` / `pl_ammo_resolve.js` — `FEATURE_PL_MAG_CAP_FILTER`:

```
cat18 主弾が 1 種類（または複数 cat18 でも pack サイズが同一）のとき:
  ammo.magazine_capacity ≠ weapon.magazine_capacity
    → u27 形状クラスタ内で cap 一致の sibling に置換
    → 一致無し: 同一名称 prefix の *-1 クリップ（8M86-1 等）
複数 cat18 で pack サイズが異なる（PPSh 35/71、Thompson 30/50 等）→ 置換しない
```

| 武器 | raw | 置換後 | 根拠 |
|------|-----|--------|------|
| Kar98k | 7.92-10G (273, cap10) | **7.92-5 (272, cap5)** | wcap=5, u27=14 |
| M1903A1 | 3006-20B (230) | **3006-5 (229)** | wcap=5, u27=1 |
| PPD40 | 7.62T35h (370) | **7.62T71h (371)** | wcap=71, u27=14 |
| No4 Mk1 | 9Pb-32R (355) | **303Br-10 (353)** | wcap=10, u27=64 |
| F.Mle86/93 | 8M86-3 (338) | **8M86-1 (337)** | wcap=8, *-1 fallback |

### RE で閉じる条件（「これだ！整合取れてる！」）

1. **装填 UI リスト構築** — 索引 [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md) §2 + 個別 doc
2. **武器 cap vs 弾 pack** — populate **`@ 0x3C81A`** cmp `[di+0x28]` 確定（装備列経路）。装填 3D42A 本体は cap 無し
3. **u27 (+0x36)** — 現行 `pl_cbe_mag_shape.js` はデータ仮説、`mov_ax_bx_u27_54` ヒット 3 のみ
4. **41BD8 交差互換表** — 三脚以外の完全 ST 移植

---

### 第3フィルタ mag_type (+0x2A / u16[21]) — **CONFIRMED**

```
if (weapon.u21 == 0)
    → mag_type フィルタ適用しない（0x46C5B / 0x1805A / 0xB440）
else
    → weapon.u21 == ammo.a21 必須（0x18BF3 — cmp [bx+2Ah], ax）
       不一致 → lcall 0x9DF6（拒否）
```

**CBE 逆アセンブル根拠** — `@ file 0x18BF3`:

```asm
mov     ax, word ptr es:[bx + 0x2a]   ; ammo mag_type
cmp     word ptr es:[bx + 0x2a], ax   ; weapon mag_type
je      pass
lcall   reject_handler                ; 0x9DF6
```

### 第1フィルタ category (+0x02)

`@ 0x771E`: `category - 0x12 == 0` → cat **18**（装填候補）のみ ammo_indices 走査。

### ammo_indices 走査

`@ 0x771E`: `shl ax, 6` → レコード先頭 + **0x2C..0x32**（4×u16）を target index と照合。

### stride

`shl reg, 6` = index × **64** — テーブル @ file `0x1DDF00`（seg 134:+64)

## 未確定 / 要追跡

| 項目 | 状態 |
|------|------|
| **magazine_capacity 照合** | **確定**: `build_ui_ammo_list` @ **0x3DDFA** — 不一致→tag C/D、一致→lcall **0xD3B0** — [PL_CBE_CAP_SUBSTITUTE_RE.md](./PL_CBE_CAP_SUBSTITUTE_RE.md) / [PL_CBE_D3B0_SUBSTITUTE_RE.md](./PL_CBE_D3B0_SUBSTITUTE_RE.md) |
| **u27 形状フィルタ** | Thompson 仮説はデータと整合するが、CBE 内単一 cmp 未特定 |
| **Bren w21=184 vs a21=186** | 0x18BF3 完全一致と矛盾 → **`@ 0x46CA0` は mag_type 比較ではなく u21 を item index として間接レコードをマージ**（下記） |
| **7.92-5 (272)** | Kar98k raw=273 → **mission pool + cap/+0xA4** で 273 落ち 272 採用 — [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md) |

## 間接参照 `@ 0x46CA0`（2026-05-31 追記）

`0x18BF3` の mag_type 完全一致とは **別経路**。装備処理 `@ 0x46C00` 内:

```asm
cmp     word ptr es:[bx + 0x2a], 0    ; w21==0 → スキップ
mov     di, word ptr es:[si + 0x2a]   ; u21 フィールド
shl     di, 6                         ; ×64 = 別 item レコードへ
mov     es, [0xa724]                  ; ランタイム item テーブル seg
mov     eax, dword ptr es:[di + 0x12] ; 間接行からコピー
```

- 武器側 u21 @+42 は **ammo の mag_type_group とは別意味**（`sub_action_items[0]` = **別 item の cbe index**）。
- 例: Bren w21=**184** → テーブル行 184 = Tripod Mk4（三脚行）— mag_type 184≠186 問題の正体はここ。
- 続く `@ 0x46CD4` は **+0x34** フィールド走査（弾薬箱/予備弾列候補）— MG↔Ammobox 追跡先。

副装備互換の正本は **cat フィルタ + ammo_indices スロット + この間接マージ** の合成。→ [PL_AUX_EQUIPMENT.md](./PL_AUX_EQUIPMENT.md)

## アンカー一覧

### `mag_type_pair_cmp` — file `0x18BF3` (seg2:+A373) — **CONFIRMED**

weapon[+0x2A] == ammo[+0x2A] — 不一致なら lcall 0x9DF6 で拒否

```c
ammo = resolve_record(arg_weapon);  // lcall 0x90CC
if (weapon->u16[21] != ammo->u16[21]) reject_loadout();
```

```asm
0x018BDB  les    bx, ptr [bp + 6]
0x018BDE  push   word ptr es:[bx + 0x14]
0x018BE2  push   0
0x018BE4  lcall  0, 0x90cc
0x018BE9  les    bx, ptr [bp - 4]
0x018BEC  mov    ax, word ptr es:[bx + 0x2a] ; +42 mag_type
0x018BF0  les    bx, ptr [bp - 8]
0x018BF3  cmp    word ptr es:[bx + 0x2a], ax ; +42 mag_type
0x018BF7  je     0x18c04
0x018BF9  push   0
0x018BFB  push   dword ptr [bp - 4]
0x018BFF  lcall  0x9df6, 0xb156
0x018C04  les    bx, ptr [bp - 8]
0x018C07  push   word ptr es:[bx + 0x14]
0x018C0B  lea    ax, [bp - 0x14]
0x018C0E  push   ss
0x018C0F  push   ax
```

### `mag_type_zero_skip` — file `0x46C5B` (seg5:+B79B) — **CONFIRMED**

if (record[+0x2A] == 0) je skip — w21=0 なら mag_type ブロック省略

```c
if (weapon_mag_type == 0) goto after_mag_filter;
```

```asm
0x046C43  mov    ecx, 0x10
0x046C49  rep movsd dword ptr es:[di], dword ptr [si]
0x046C4C  pop    ds
0x046C4D  les    bx, ptr [bp - 0xc]
0x046C50  mov    ax, word ptr es:[bx + 4]
0x046C54  les    bx, ptr [bp - 8]
0x046C57  mov    word ptr es:[bx + 0x28], ax
0x046C5B  cmp    word ptr es:[bx + 0x2a], 0 ; +42 mag_type
0x046C60  je     0x46cd1
0x046C62  les    bx, ptr [bp + 6]
0x046C65  mov    ax, word ptr es:[bx + 0x48]
0x046C69  les    bx, ptr [bp - 8]
0x046C6C  cmp    word ptr es:[bx + 0x2a], ax ; +42 mag_type
0x046C70  jne    0x46cd1
0x046C72  les    si, ptr [bp + 6]
0x046C75  mov    si, word ptr es:[si + 0x8a]
```

### `mag_type_zero_skip_ui` — file `0x1805A` (seg2:+97DA) — **CONFIRMED**

UI 装填リスト構築 — w21=0 なら 0xFFFF 返却（制限なし）

```asm
0x018042  lcall  0x94c7, 0x5c10
0x018047  pop    si
0x018048  pop    di
0x018049  leave  
0x01804A  retf   0xa
0x01804D  nop    
0x01804E  enter  4, 0
0x018052  push   di
0x018053  push   si
0x018054  mov    es, word ptr [bp + 8]
0x018057  mov    bx, word ptr [bp + 6]
0x01805A  cmp    word ptr es:[bx + 0x2a], 0 ; +42 mag_type
0x01805F  je     0x180aa
0x018061  mov    ax, word ptr es:[bx + 0xce]
0x018066  mov    dx, word ptr es:[bx + 0xd0]
0x01806B  add    ax, 0x40
0x01806E  mov    si, ax
0x018070  mov    word ptr [bp - 2], dx
0x018073  xor    di, di
0x018075  mov    es, word ptr [bp - 2]
```

### `ammo_index_cat18_scan` — file `0x771E` (seg1:+665E) — **CONFIRMED**

index<<6; category-0x12==0 → ammo_indices[+0x2C..+0x32] 4スロット走査

```c
rec = table[index << 6];
if (rec.category == 18) {
  for (slot = 0; slot < 4; slot++)
    if (rec.ammo_indices[slot] == target) return slot;
} else if (rec.category == 24) { ... +0x32 cmp ... }
```

```asm
0x007706  stc    
0x007707  pop    es
0x007708  jl     0x76f7
0x00770A  jmp    0x7714
0x00770C  mov    ax, cx
0x00770E  pop    si
0x00770F  pop    di
0x007710  leave  
0x007711  retf   0xa
0x007714  mov    ax, 0xffff
0x007717  pop    si
0x007718  pop    di
0x007719  leave  
0x00771A  retf   0xa
0x00771D  nop    
0x00771E  enter  0x14, 0
0x007722  push   di
0x007723  push   si
0x007724  les    bx, ptr [bp + 0xa]
0x007727  mov    ax, word ptr es:[bx]
0x00772A  mov    word ptr [bp - 0xe], ax
0x00772D  or     ax, ax
0x00772F  je     0x77c4
0x007733  mov    word ptr [bp - 8], 0
0x007738  mov    ax, word ptr [bp + 0xe]
0x00773B  mov    dx, word ptr [bp + 0x10]
```

### `record_copy_shl6` — file `0x46C31` (seg5:+B771) — **CONFIRMED**

shl di,6; rep movsd 16 — CBE 64byte レコード丸ごとコピー

```asm
0x046C19  inc    ax
0x046C1A  mov    word ptr [bp - 0xc], cx
0x046C1D  mov    word ptr [bp - 0xa], dx
0x046C20  les    si, ptr [bp + 6]
0x046C23  mov    word ptr es:[si + 0x11e], 0
0x046C2A  mov    si, cx
0x046C2C  mov    es, dx
0x046C2E  mov    di, word ptr es:[si]
0x046C31  shl    di, 6
0x046C34  add    di, 0
0x046C38  mov    ax, 0xb8d6
0x046C3B  push   ds
0x046C3C  mov    si, di
0x046C3E  mov    ds, ax
0x046C40  les    di, ptr [bp - 8]
0x046C43  mov    ecx, 0x10
0x046C49  rep movsd dword ptr es:[di], dword ptr [si]
0x046C4C  pop    ds
0x046C4D  les    bx, ptr [bp - 0xc]
```

### `mag_type_indirect_table` — file `0x46CA0` (seg5:+B7E0) — **HYPOTHESIS**

w21!=0: di=record[+0x2A]; shl di,6 — 間接テーブル参照（Bren +2 差の説明候補）

```c
ext = mag_type_table[weapon.u21 << 6]; /* 要追跡 */
```

```asm
0x046C88  retf   0x80c
0x046C8B  jne    0x46cd1
0x046C8D  test   bl, 1
0x046C90  jne    0x46c9d
0x046C92  les    bx, ptr [bp + 6]
0x046C95  cmp    word ptr es:[bx + 0x8e], 0
0x046C9B  je     0x46cd1
0x046C9D  les    si, ptr [bp - 8]
0x046CA0  mov    di, word ptr es:[si + 0x2a] ; +42 mag_type
0x046CA4  shl    di, 6
0x046CA7  add    di, 0
0x046CAB  mov    es, word ptr [0xa724]
0x046CAF  mov    bx, di
0x046CB1  mov    word ptr [bp - 2], es
0x046CB4  mov    eax, dword ptr es:[di + 0x12]
0x046CB9  mov    es, word ptr [bp - 6]
```

## 精密パターン出現数

| パターン | ヒット |
|----------|--------|
| `mov_ax_bx_cat02` | 38 |
| `shl_bx_6` | 36 |
| `shl_ax_6` | 26 |
| `cmp_bx_mag42_zero` | 13 |
| `mov_ax_bx_ammo44` | 10 |
| `shl_di_6` | 7 |
| `cmp_bx_mag42_ax` | 6 |
| `mov_ax_bx_mag42` | 5 |
| `mov_ax_bx_u27_54` | 3 |

## ST への反映

1. `passes_mag_type`: **w21=0 → True**; else **a21==w21**（0x18BF3 準拠）
2. Bren/MG 等の +2 差 — 間接テーブル解明まで `FEATURE_PL_MAG_TYPE_FILTER` はオフ
3. u27 — 現行 `pl_cbe_mag_shape.js` 仮説を維持

## 関連

- [PL_CBE_AUX_UI_RE.md](./PL_CBE_AUX_UI_RE.md) — +0x34 予備弾 / cat24 UI
- [PL_MAG_TYPE_FILTER.md](./PL_MAG_TYPE_FILTER.md)
- [PL_CBE_AMMO_TRUTH.md](./PL_CBE_AMMO_TRUTH.md)
- `scripts/pl_decoded/cbe_ammo_filter_re.json`
