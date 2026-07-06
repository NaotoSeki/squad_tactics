# CBE `lcall 0xD3B0` — 弾 index resolver 内部 RE

**生成**: 2026-05-31 — `python scripts/re_cbe_d3b0_resolve.py`

## 解決

| 項目 | 値 |
|------|-----|
| **本体 (file)** | **`0x048870`** |
| NE セグ | **seg5** @ `0x03B4C0` + `0xD3B0` |
| fixup | 各コールサイト **reloc なし** — `0x9858` 同様、**seg word = ロード時 CS** |

4 サイトは seg word が異なる (`0x256D` / `0xAF2A` / `0xCDC5` / `0xC133`) が、
いずれも **seg5+0xD3B0** に着地する同一関数。

## 呼び出しサイト

| file | 呼び出し元 seg | 文脈 |
|------|---------------|------|
| `0x03DFAC` | seg5 | build_ui_ammo_list epilogue @ 0x3DF64 — tag==0 のときのみ |
| `0x037F03` | seg4 | ui_refresh fallback @ 0x37EF4 |
| `0x00DE37` | seg1 | equip_early — weapon+0x83&0x80 |
| `0x00DF39` | seg1 | equip_early — weapon+0x83&0x80 |

### `build_ui_ammo_list` @ 0x3DFAC — **条件修正**

```asm
3DF64  mov    si, [bp-0x1a]     ; ループ全体の tag
3DF67  cmp    si, 9
3DF90  cmp    es:[0xad34], 5    ; UI モード
3DFA6  or     si, si
3DFA8  jne    3dfb6             ; tag!=0 → lcall スキップ
3DFAC  lcall  0x????, 0xd3b0
3DFB4  mov    si, ax            ; 返値 → 出力 index
```

| cap cmp @ 0x3DDFA | `[bp-0x1a]` | lcall |
|-------------------|-------------|-------|
| **一致** | **0**（初期値のまま） | **実行** |
| **不一致** | **0xC / 0xD** | **スキップ** |

> **訂正**: 以前の「cap 不一致 → lcall 置換」は **逆**。
> 273(cap10) vs Kar98k(cap5) の **不一致では lcall は走らない**。
> 272 問題の差替は **別経路**（mission pool / loadout builder / equip @ DE37）が正本候補。

## 関数 `@ 0x048870` — `ammo_substitute_resolver`（仮称）

**引数**: far ptr → ランタイム weapon/member 行（`[bp+6]` = ES:DI）

### 早期 return

| 条件 | 返値 ax |
|------|---------|
| `[+0x83] & 0x80 == 0` | **0** |
| bit 0x80 あり、`[+0x1a] < 4` | **0x1A (26)** |
| bit 0x80 あり、`[+0x1a] >= 4` | **0x1B (27)** |

equip_early @ DE37/DF39 は **tag ガード無し**で常に呼ぶ → 26/27 は slot/type id の可能性。
続く `lcall 0x6F0E` が cbe index へ変換。

### 本体 @ 0x048898 — テーブルスキャン

- 512B stride (`+0x200`) で最大 0x40 件 walk
- `lcall 0xDF20` で行検証
- スコア `di` vs `[+0xBE]` 加算で分岐
- 返値: **`es:[tbl+0x42BC]`** または **`es:[si+0x1E]`** から index 読出

### 副次関数

| file | 役割 |
|------|------|
| `@ 0x048960` | `[bx+0xAE]` vs weapon id — 一致レコード ptr を ax で返す |
| `@ 0x0489AE` | weapon の u16 候補列 walk — **`[+0x2a]` mag_type** + **`call 0x493E0`** |
| `@ 0x048C5C` | 同上だが **`cmp [bx+0x2a], weapon_mag_type`** 明示 |
| `@ 0x0493E0` | 行フラグ validator（`[+0x83]`, `[+0x26]`, `[+0x1a]`） |
| `@ 0x048CE8` | `[weapon+0x28]` cap → 別テーブル bit セット（index 返却ではない） |

### alt entry `@ 0x048850` (seg+0xD390)

```asm
48858  mov    bx, es:[di+0x40]
4885C  shl    bx, 6          ; CBE 64B stride
48864  mov    bx, es:[bx+0x38]
48869  mov    ax, bx         ; index 返却
```

D3B0 本体とは別入口。`jmp 0x48869` で合流。

## 静的 CBE データ

| | Kar98k (57) | 273 | 272 |
|--|-------------|-----|-----|
| cap | **5** | **10** | **5** |
| u27 | **14** | **14** | **14** |
| mag_type | **0** | **68** | **58** |
| ammo_indices | [273, 304, 305, 314] | — | indices 外 |

## 即値 272/273

resolver 本体 (`0x048870`..`+0x800`) に **272/273 即値なし**。
ランタイムテーブル (`+0x42BC`, `shl 6/9` 先) 参照型。

## `@ 0x048870` 入口

```asm
048879  test   byte ptr es:[si + 0x83], 0x80
04887F  je     0x48893
048881  cmp    word ptr es:[si + 0x1a], 4
04888E  leave   ; flow
04888F  retf    ; flow
048896  leave   ; flow
048897  retf    ; flow
048898  enter  8, 0 ; flow
0488BD  test   byte ptr es:[si + 0x81], 0x80
0488C3  je     0x488f7
0488C7  lcall  0xd293, 0xdf20 ; flow
0488D1  je     0x488f7
0488D9  test   byte ptr es:[si + 0x83], 0x80
0488DF  je     0x488e7
0488E7  test   byte ptr es:[si + 0x82], 1
0488ED  jne    0x488f4
0488F1  jmp    0x488f7 ; flow
0488FE  jne    0x488ba
```

## `@ 0x048C5C` mag_type 走査

```asm
048C5C  enter  0xc, 0 ; flow
048C75  cmp    word ptr es:[bx], dx
048C88  shl    bx, 9 ; scale
048CA2  cmp    word ptr es:[bx + 0x2a], ax ; mag_type
048CA6  jne    0x48cd5
048CAB  call   0x493e0 ; flow
048CB3  je     0x48cd5
048CB5  cmp    dword ptr [bp - 4], 0
048CBA  je     0x48ccc
048CBF  mov    ax, word ptr es:[bx + 0x22] ; rank
048CC6  cmp    word ptr es:[si + 0x22], ax ; rank
048CD8  cmp    word ptr es:[di], 0
048CE6  leave   ; flow
048CE7  retf    ; flow
```

## `@ 0x0493E0` validator

```asm
0493EA  test   byte ptr es:[si + 0x83], 0x80
0493F0  jne    0x49401
0493F2  cmp    word ptr es:[si + 0x26], 3
0493F9  cmp    word ptr es:[si + 0x1a], bx
0493FD  jne    0x49401
049404  leave   ; flow
049405  retf    ; flow
049410  test   byte ptr [si + 0x83], 0x80
049415  jne    0x49432
049417  test   byte ptr [si + 0x1d], 0x80
04941B  je     0x49432
049422  mov    di, word ptr [si + 0x28] ; cap
049427  test   byte ptr es:[di - 0x52d7], 0x40
04942D  je     0x49432
049438  leave   ; flow
049439  retf    ; flow
04943A  enter  4, 0 ; flow
```

## ST 再現指針

1. **`applyMagCapSubstitute`** — データ側エミュレ（u27 クラスタ + cap）。CBE 1:1 未確定のまま有効。
2. **正本 resolver** — mag_type (+0x2a) + rank (+0x22) + 493E0 フラグ + 42BC テーブル。
3. **build_ui_ammo_list の lcall** — cap 一致時の canonical index 確定用。**不一致差替ではない**。

## 未完了

1. `lcall 0x6F0E` / `0x6F00` — ax=26/27 → cbe index 変換
2. `+0x42BC` / `+0xAE` ランタイムテーブル静的抽出
3. ~~273→272 の **実経路**~~ → [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)

## 関連

- [PL_CBE_CAP_SUBSTITUTE_RE.md](./PL_CBE_CAP_SUBSTITUTE_RE.md)
- [PL_CBE_LOADOUT_CANDIDATE_RE.md](./PL_CBE_LOADOUT_CANDIDATE_RE.md)
- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)
