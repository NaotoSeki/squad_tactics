# CBE lcall DBD7 — DE4A 弾 u16_5 天井フィルタ RE

**生成**: 2026-05-31 — `python scripts/re_cbe_dbd7_deep.py`

## 結論

### エンコード訂正（重要）

DE4A @ `49357` の生バイト: **`9A DA D0 D7 DB`**

| フィールド | 値 | file 着地 |
|------------|-----|-----------|
| IP imm | **`0xD0DA`** | seg5+0xD0DA = **`0x04859A`** ← **DBD7 本体** |
| CS imm | `0xDBD7` | seg5+0xDBD7 = `0x049097` — **別 thunk** |

Capstone 表示 `lcall 0xdbd7, 0xd0da` は **オペランド順が逆**。

### DBD7 本体 @ `0x04859A` — **`weapon_u16_5 mod 100`**

```asm
04859A  push   bp
04859B  mov    bp, sp
04859D  lcall  0xd0f0, 0xab92
0485A2  cdq    
0485A3  idiv   word ptr [bp + 6]
0485A6  mov    ax, dx
0485A8  leave  
0485A9  retf   
0485AA  push   bp
0485AB  mov    bp, sp
0485AD  lcall  0xba06, 0xab92
0485B2  cdq    
0485B3  idiv   word ptr [bp + 6]
0485B6  mov    ax, dx
0485B8  leave  
0485B9  retf   
0485BA  enter  2, 0
0485BE  push   si
0485BF  mov    ax, word ptr [bp + 6]
0485C2  cmp    word ptr [bp + 0xa], ax
0485C5  jne    0x485dc
0485C7  mov    ax, word ptr [bp + 8]
```

DE4A 直前 `push 0x64` → `[bp+6]` = **除数 100**。
内部 `lcall D0F0` が武器コンテキストから被除数を `ax` に載せ、
**`ax % 100` の余り** を返す（`idiv` → `mov ax, dx`）。

Kar98k 武器 `+0x0A` = **3** → DBD7 返値 **ax ≈ 3**。

### DE4A 側判定 @ `49335F`（符号付き si）

```asm
049311  jmp    0x4936f
04932F  jl     0x49336
049331  mov    si, 1
049334  jmp    0x4936f
049336  cmp    si, 5
049339  je     0x49305
04933B  cmp    si, 3
04933E  jl     0x49350
049340  push   2
049342  lcall  0xde9a, 0xd0da
049347  add    sp, 2
04934A  mov    si, ax
04934C  dec    si
04934D  jmp    0x4936f
04934F  nop    
049350  cmp    si, 1
049353  jl     0x4936c
049355  push   0x64 ; div100
049357  lcall  0xdbd7, 0xd0da
04935C  add    sp, 2
04935F  les    bx, ptr [bp - 4]
049362  cmp    word ptr es:[bx + 0xa], ax
049366  jge    0x4936c
049368  xor    si, si
04936A  jmp    0x4936f
04936C  mov    si, 0xffff ; term
04936F  or     si, si
049371  jge    0x49386
049373  mov    es, word ptr [bp + 0xa]
049376  mov    word ptr es:[di], 0xffff ; term
04937B  les    bx, ptr [bp - 4]
04937E  and    byte ptr es:[bx + 0x80], 0xfd
```

| 条件 | 結果 |
|------|------|
| `ammo[+0x0A] >= ax` | **reject** — `si=0xFFFF`（-1）→ pool 行 `FFFF` |
| `ammo[+0x0A] < ax` | **pass** — `si=0` → 後段 49386 へ |

**弾 u16_5 は武器 u16_5 未満であること** が DBD7 ゲート。

| CBE | u16_5 | DBD7 vs Kar98k(ax≈3) |
|-----|-------|----------------------|
| Kar98k (57) | 3 | — |
| 272 7.92-5 | 0 | **pass** (0 < 3) |
| 273 7.92-10G | 0 | **pass** (0 < 3) |

> 273→272 分岐は DBD7 **では起きない**（両方 pass）。
> 273 落ちは downstream **cap 不一致** (+0xA4 / 38814 / 4240C) が正本。

### 混同していた `0x49082` 領域

file `0x049097`（seg+0xDBD7）付近は **別 thunk 群**（DC12/DB9C/49524）。
DE4A から直接 lcall される DBD7 **ではない**。

```asm
049082  push   bp
049083  mov    bp, sp
049085  push   si
049086  mov    si, word ptr [bp + 6]
049089  mov    es, word ptr [bp + 8]
04908C  or     byte ptr es:[si + 0x81], 0x74
049092  push   es
049093  push   si
049094  lcall  0xdc12, 0x5d74
049099  add    sp, 4
04909C  or     ax, ax
04909E  jne    0x490b5
0490A0  push   word ptr [bp + 8]
0490A3  push   si
0490A4  lcall  0xdb9c, 0x2d1c
0490A9  add    sp, 4
0490AC  mov    es, word ptr [0xa75e]
0490B0  inc    word ptr es:[0xad4c]
0490B5  push   word ptr [bp + 8]
0490B8  push   si
```

### caller — **1** 件

| file | raw |
|------|-----|
| `0x049357` | `9adad0d7db` |

## ST 再現指針

```
if ammo.u16_5 >= weapon.u16_5:  # DBD7 ceiling
    reject_from_pool()
```

Kar98k: 272/273 は u16_5=0 < 3 → **pool に残る** → cap 段で 273 のみ落ち。

## 未完了

1. DE85 / DE9A / DE5E — slot type 5/6/3 経路
2. `0x49082` thunk 群の呼び出し元

---

## 解決済み項目: lcall D0F0 (DBD7被除数ソース)
- **解明内容**: `lcall D0F0` (@ 0x04859D) の実体は、リロケーションにより MSVC LCG `rand()` 関数（Segment7:0xAB92）を呼び出すコードです。
- **ロジック**: `rand()` の戻り値（0〜32767）を 100 で割った余り（0〜99の乱数）を `ax` にロードして返します。
- **判定結果**: 呼び出し元の `DE4A` は、弾レコードの `+0x0A` (u16_5) の値をこの `ax` (0〜99) と比較し、弾の出現確率（％）を天井値（Ceiling）とするランダムな出現可否判定（`ammo.u16_5 < rand() % 100` であればパス）として機能しています。武器レコードに由来する被除数は存在せず、静的な乱数に基づく判定であることが確定しました。

## 関連

- [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md)
- [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)
