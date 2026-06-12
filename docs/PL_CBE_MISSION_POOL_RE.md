# CBE mission pool `DS:0x270` — 構築 RE

**生成**: 2026-05-31 — `python scripts/re_cbe_mission_pool.py`

## 結論

### runtime `DS:0x270` = **u16 cbe index 列**（`<0` 終端）

file 上の `0x270` は PE ヘッダ域 — **DATA セグロード後** ES:0x270 が正本。

### 構築パイプライン

```
init (42530 / 387DC):
  pool[0] = 0xFFFF                    ; 空プール
  push scenario_ptr                   ; 例 0x70B2 / 0xB979
  push 0x270                          ; pool offset
  lcall E02C → 0x0494EC

DE4A @ 0x0492AE (weapon_cap 引数):
  walk 4-byte シナリオ列 [di]:
    word0 = cbe index (→ shl 9 CBE load)
    word1 = slot/type flags (0x2000, 0x4000, si=1..6)
  call 49406 検証
  si 別 slot: lcall DE85/DE9A/DBD7 — cap/slot 依存
  出力: u16 index を pool に append; 失敗 → FFFF

post @ 0x038814:
  weapon_cap = [bp+6]
  pool walk — cap 不一致行を除去/スキップ
```

### `lcall DE4A` — slot / cap 分岐（確定）

| `si` (slot type) | 処理 |
|------------------|------|
| **5** | `lcall DE85` @ **`0x049345`** |
| **6** | `lcall DE5E` @ **`0x04931E`** |
| **3** | `lcall DE9A` @ **`0x04935A`** |
| **≥1** | `lcall DBD7(0x64)` @ **`0x04859A`** (IP=0xD0DA) → **`cmp cbe[+0x0A], ax`** @ 493362 |

詳細: [PL_CBE_DBD7_RE.md](./PL_CBE_DBD7_RE.md) — 返値 = **weapon u16_5 mod 100**、
`ammo.u16_5 >= ax` で reject。272/273(u16_5=0) は Kar98k(ax≈3) で **pass**。

### seg132 unit レコード形式（部分確定）

```
weapon_id, meta_a, meta_b, (cbe_idx, qty)*, …
```

file **`0x1DBF80`..`0x1DD9B6`** — NE seg132。

**Kar98k 窓** @ file `0x1DCAAC` header `[55, 58, 0]`:

| idx | qty | 名称 | cap |
|-----|-----|------|-----|
| **272** | 4 | 7.92-5 | 5 |
| **269** | 4 | ? | 1 |
| **273** | 6 | 7.92-10G | 10 |
| **314** | 1 | Messer | 0 |

> **273→272 正本**: シナリオが **272 と 273 を別 (idx,qty) で供給** →
> pool 構築 (DE4A) + post cap filter (38814) + downstream +0xA4 @ 4240C/3D410
> で cap10 の 273 が落ち、cap5 の 272 が残る。

### E02C 呼び出しサイト

| file | seg word |
|------|----------|
| `0x0387DC` | `0xBAFD` |
| `0x03D4A8` | `0x20A5` |
| `0x042566` | `0x68DB` |

### lcall 解決（E02C=seg word、他=offset word）

- **E02C_pool_build** → **`0x0494EC`** (off=`041D9B` seg=`0494EC`)
- **E02C_alt** → **`0x03AD2C`** (off=`0387FD` seg=`03AD2C`)
- **DBD7** → **`0x049097`** (off=`049097` seg=`04859A`)
- **DE85** → **`0x049345`** (off=`049345` seg=`04859A`)
- **DE9A** → **`0x04935A`** (off=`04935A` seg=`04859A`)
- **DE5E** → **`0x04931E`** (off=`04931E` seg=`04859A`)

### runtime DATA オフセット探索

**ES:0x70B2** シナリオ署名 — 0 ヒット
**ES:0xB979** シナリオ署名 — 0 ヒット

### seg132 unit loadout @ `0x1DCAAC`（確定サンプル）

- header: `[55, 58, 0]`

| idx | qty |
|-----|-----|
| 272 | 4 |
| 269 | 4 |
| 273 | 6 |
| 314 | 1 |
| 97 | 44 |

## DE4A 変換ループ @ 0x0492AE

```asm
0492DD  push   dx
0492DE  push   ax
0492DF  push   cs
0492E0  call   0x49406
0492E8  je     0x4939f
0492EC  test   si, 0x4000
0492F0  jne    0x4939f
0492F8  test   byte ptr es:[0xad25], 8
0492FE  je     0x4932c
049300  cmp    si, 6
049305  push   2
049307  lcall  0xde5e, 0xd0da
049314  cmp    si, 5
049317  jne    0x49326
049319  push   2
04931B  lcall  0xde85, 0xd0da
049326  mov    ax, 0xffff ; term
04932C  cmp    si, 6
049336  cmp    si, 5
049339  je     0x49305
04933B  cmp    si, 3
049340  push   2
049342  lcall  0xde9a, 0xd0da
049350  cmp    si, 1
049355  push   0x64
049357  lcall  0xdbd7, 0xd0da
049362  cmp    word ptr es:[bx + 0xa], ax
04936C  mov    si, 0xffff ; term
049376  mov    word ptr es:[di], 0xffff ; term
049394  jne    0x4939f
0493AA  jne    0x492ae
0493B1  retf   
0493B2  push   bp
0493B8  test   byte ptr [bx + 0x81], 0x80
0493BD  je     0x493da
0493CC  test   word ptr [bx + 0xa4], ax
0493D0  jne    0x493da
0493D5  push   ss
0493D8  retf   
0493DC  push   ss
0493DF  retf   
0493E0  push   bp
0493E3  push   si
0493EA  test   byte ptr es:[si + 0x83], 0x80
0493F0  jne    0x49401
0493F2  cmp    word ptr es:[si + 0x26], 3 ; +0x26
0493F9  cmp    word ptr es:[si + 0x1a], bx
0493FD  jne    0x49401
049405  retf   
049406  push   bp
049409  push   di
04940A  push   si
```

## pool init @ 0x042530

```asm
042530  push   di
042531  push   si
042538  mov    ax, word ptr es:[si + 0x28] ; cap
04253F  mov    ax, word ptr es:[si + 0x8a] ; +0x8A
04255B  mov    word ptr es:[bx], 0xffff ; term
042560  push   0x70b2
042563  push   0x270 ; pool
042566  lcall  0x68db, 0xe02c
```

## pool init @ 0x0387DC + post 38814

```asm
0387D6  push   0xb979
0387D9  push   0x270 ; pool
0387DC  lcall  0xbafd, 0xe02c
0387E8  mov    word ptr es:[0x374], 0xffff ; term
0387EF  push   es
0387F0  push   0x374
0387F6  push   ax
0387F7  push   si
0387FA  lcall  0xbb48, 0x6f4c
038804  push   word ptr es:[si + 0x28] ; cap
038808  push   cs
038809  call   0x38814
038812  retf   
038814  push   bp
```

## post cap filter @ 0x038814

```asm
038814  push   bp
03881B  test   byte ptr es:[0xad27], 0x80
038821  je     0x38837
038827  cmp    word ptr es:[0x374], 0
03882F  push   word ptr [bp + 6]
038832  lcall  0xbb88, 0xc2e6
038838  retf   
03883A  push   bp
03883D  push   si
038841  push   word ptr [bp + 8]
038844  push   si
038845  lcall  0xbb63, 0x634a
038851  test   byte ptr es:[0xad27], 0x80
038857  je     0x3889f
03885C  push   word ptr es:[si + 0x28] ; cap
038860  lcall  0xbaa4, 0xa3f8
03886A  jne    0x3889f
038879  je     0x3889f
03887B  cmp    byte ptr es:[si + 0x1ce], 0
038881  je     0x38890
038883  push   es
```

## pool append @ 0x049616

```asm
049616  push   bp
049619  push   di
04961A  push   si
049624  cmp    word ptr es:[bx], 0
049630  mov    word ptr es:[di + 0x8a], ax ; +0x8A
049648  test   byte ptr es:[di + 0x83], 0x80
04964E  je     0x4965c
04967B  cmp    word ptr es:[bx], 0
```

## entry validate @ 0x049406

```asm
049406  push   bp
049409  push   di
04940A  push   si
049410  test   byte ptr [si + 0x83], 0x80
049415  jne    0x49432
049417  test   byte ptr [si + 0x1d], 0x80
04941B  je     0x49432
049422  mov    di, word ptr [si + 0x28] ; cap
049427  test   byte ptr es:[di - 0x52d7], 0x40
04942D  je     0x49432
049434  push   ss
049439  retf   
04943A  enter  4, 0
04943E  push   di
04943F  push   si
049446  test   byte ptr es:[di + 0x81], 0x80
04944C  je     0x49456
049474  test   byte ptr es:[si + 0x81], 1
04947A  je     0x4948a
04948F  push   ss
049494  retf   
```

## DBD7 @ resolved

```asm
04909E  jne    0x490b5
0490A0  push   word ptr [bp + 8]
0490A3  push   si
0490A4  lcall  0xdb9c, 0x2d1c
0490B5  push   word ptr [bp + 8]
0490B8  push   si
0490B9  push   cs
0490BA  call   0x49524
0490C2  retf   
0490C4  push   bp
0490C7  push   si
0490CB  push   word ptr [bp + 8]
0490CE  push   si
0490CF  lcall  0xdacd, 0x5d74
0490D9  jne    0x490e4
0490E4  push   word ptr [bp + 8]
0490E7  push   si
0490E8  push   cs
0490E9  call   0x49524
0490F1  retf   
0490F2  enter  0xd0, 0
0490F6  push   di
0490F7  push   si
04910A  je     0x4912a
049115  push   ds
04911D  push   ss
04912E  push   ss
04912F  push   ax
049130  push   word ptr [bp - 6]
049133  push   cs
049134  call   0x492a2
```

## DE85 @ resolved

```asm
049345  lcall  0x2c4, 0x83de
049350  cmp    si, 1
049355  push   0x64
049357  lcall  0xdbd7, 0xd0da
049362  cmp    word ptr es:[bx + 0xa], ax
04936C  mov    si, 0xffff ; term
049376  mov    word ptr es:[di], 0xffff ; term
049394  jne    0x4939f
0493AA  jne    0x492ae
0493B1  retf   
0493B2  push   bp
0493B8  test   byte ptr [bx + 0x81], 0x80
0493BD  je     0x493da
0493CC  test   word ptr [bx + 0xa4], ax
0493D0  jne    0x493da
0493D5  push   ss
0493D8  retf   
0493DC  push   ss
0493DF  retf   
0493E0  push   bp
0493E3  push   si
```

## DE9A @ resolved

```asm
049362  cmp    word ptr es:[bx + 0xa], ax
04936C  mov    si, 0xffff ; term
049376  mov    word ptr es:[di], 0xffff ; term
049394  jne    0x4939f
0493AA  jne    0x492ae
0493B1  retf   
0493B2  push   bp
0493B8  test   byte ptr [bx + 0x81], 0x80
0493BD  je     0x493da
0493CC  test   word ptr [bx + 0xa4], ax
0493D0  jne    0x493da
0493D5  push   ss
0493D8  retf   
```

## DE5E @ resolved

```asm
04931E  test   si, bx
049326  mov    ax, 0xffff ; term
04932C  cmp    si, 6
049336  cmp    si, 5
049339  je     0x49305
04933B  cmp    si, 3
049340  push   2
049342  lcall  0xde9a, 0xd0da
049350  cmp    si, 1
049355  push   0x64
049357  lcall  0xdbd7, 0xd0da
049362  cmp    word ptr es:[bx + 0xa], ax
04936C  mov    si, 0xffff ; term
049376  mov    word ptr es:[di], 0xffff ; term
```

## ST 再現指針

1. **mission pool** = シナリオ (idx,qty)[] → DE4A → u16 index[] + cap post-filter
2. Kar98k: シナリオに **272** が載っていれば ST は raw 273 から **置換不要**（pool 段階で分岐）
3. シナリオ無し ST 暫定: `applyMagCapSubstitute` — pool+filter の圧縮
4. **seg132 一括 export**: `python scripts/export_pl_cbe_mission_pool.py` → `data/pl_cbe_mission_pool.js`（36 weapon / 36 block + Kar98 系 propagate）

## 未完了

1. seg132 **レコード境界** — 可変長ヘッダ / ネスト (weapon 55→ammo 列)
2. `0x70B2` / `0xB979` → file offset マップ（runtime DATA セグ）
3. ~~DBD7~~ → [PL_CBE_DBD7_RE.md](./PL_CBE_DBD7_RE.md)
4. DE9A / DE85 返値テーブル
5. packed 記述子 `cx` @ 3D540 と mag_type=0

## 関連

- [PL_CBE_DBD7_RE.md](./PL_CBE_DBD7_RE.md)
- [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)
