# CBE `call 0x3DBC2` — loadout descriptor blob 構築 RE

**生成**: 2026-05-31 — `python scripts/re_cbe_3dbc2.py`

## 結論

### 役割 — **ad18 テンプレ → ad1c セッション内 blob 2 本**

`prepare_loadout_ad1c` @ **`0x3D72A`** が `3DBC2` を **2 回** call:

| # | caller | 出力先 (推定) | ソース |
|---|--------|---------------|--------|
| 1 | `0x3D797` | ad1c **`+0x46/+0x48`** far ptr | `es:[ad1c+0xF2]` + dest `0x1CCA:0x22ED` |
| 2 | `0x3D7B3` | 第 2 buffer | `es:[ad1c+0xF6]` + dest `0x24CA:0x2304` |

この blob が @ `0x3D42A` → **`3D540` mag_type ゲート** の入力。

### `3DBC2` 本体 @ `0x03DBC2`

```asm
03DBC2  enter  6, 0
03DBC6  push   di
03DBC7  push   si
03DBC8  mov    ax, 0x2786
03DBCB  mov    ds, ax
03DBCD  mov    eax, dword ptr [bp + 6]
03DBD1  mov    dword ptr [bp - 4], eax
03DBD5  mov    word ptr [bp - 6], 0
03DBDA  les    bx, ptr [0xad18] ; ad18
03DBDE  cmp    word ptr es:[bx + 0x58], 0 ; +58
03DBE3  jg     0x3dbec
03DBE5  push   ss
03DBE6  pop    ds
03DBE7  pop    si
03DBE8  pop    di
03DBE9  leave  
03DBEA  retf   
03DBEB  nop    
03DBEC  xor    cx, cx
03DBEE  les    bx, ptr [0xad18] ; ad18
03DBF2  cmp    word ptr es:[bx + 0x56], cx ; +56
03DBF6  jle    0x3dc22
03DBF8  mov    bx, word ptr [bp + 0xa]
03DBFB  mov    di, word ptr [bp - 4]
03DBFE  mov    es, word ptr [bp + 0xc]
03DC01  mov    si, bx
03DC03  add    bx, 2
03DC06  mov    ax, word ptr es:[si]
03DC09  mov    es, word ptr [bp - 2]
03DC0C  mov    si, di
03DC0E  add    di, 2
03DC11  mov    word ptr es:[si], ax
03DC14  inc    cx
03DC15  les    si, ptr [0xad18] ; ad18
03DC19  cmp    word ptr es:[si + 0x56], cx ; +56
03DC1D  jg     0x3dbfe
03DC1F  mov    word ptr [bp + 0xa], bx
03DC22  push   ss
03DC23  pop    ds
03DC24  add    word ptr [bp + 6], 0x40 ; +64
03DC28  mov    eax, dword ptr [bp + 6]
03DC2C  mov    dword ptr [bp - 4], eax
03DC30  inc    word ptr [bp - 6]
03DC33  mov    ax, word ptr [bp - 6]
03DC36  mov    es, word ptr [0xa5fc]
03DC3A  les    bx, ptr es:[0xad18] ; ad18
03DC3F  cmp    word ptr es:[bx + 0x58], ax ; +58
03DC43  jle    0x3dc4c
03DC45  mov    ax, 0x1ee3
03DC48  mov    ds, ax
03DC4A  jmp    0x3dbec
03DC4C  pop    si
03DC4D  pop    di
03DC4E  leave  
03DC4F  retf   
```

疑似コード:

```
template = ES:0xAD18
pair_count = template[+0x56]   // 1 セクションあたり u16 ペア数
section_count = template[+0x58]

for section in 0 .. section_count-1:
    for i in 0 .. pair_count-1:
        dest[i] = src[i]         // word copy
    dest += 0x40               // 次セクション (+64B stride)
```

- **header word（mag_type 期待値）** は template 先頭から **そのままコピー**
- @ `3D540` の `cx = header & 0x800F` は **テンプレ静的データ** 由来

### テンプレ武器インデックス — @ `3D72A` 先頭

```asm
03D730  mov    es, word ptr [0xa60a]
03D734  les    bx, ptr es:[0xad1c] ; ad1c
03D739  mov    ax, word ptr es:[bx + 0xf0]
03D73E  mov    cx, ax
03D740  add    ax, ax
03D742  add    ax, cx
03D744  shl    ax, 2
03D747  add    ax, 0x2ce
03D74A  mov    cx, 0x13bd
03D74D  mov    es, word ptr [0xa5fc]
03D751  les    bx, ptr es:[0xad18] ; ad18
03D756  push   ds
03D757  lea    di, [bx + 0x52]
03D75A  mov    si, ax
03D75C  mov    ds, cx
03D75E  mov    ecx, 3
03D764  rep movsd dword ptr es:[di], dword ptr [si]
03D767  pop    ds
03D768  mov    eax, 0xffffffff
03D76E  mov    bx, 0x1cca
03D771  mov    dx, 0x22ed
03D774  mov    ecx, 0x200
03D77A  mov    di, bx
03D77C  mov    es, dx
03D77E  rep stosd dword ptr es:[di], eax
03D781  mov    es, word ptr [0xa60a]
03D785  les    si, ptr es:[0xad1c] ; ad1c
03D78A  push   dword ptr es:[si + 0xf2]
03D790  push   dx
03D791  push   bx
03D792  mov    si, dx
03D794  mov    di, bx
03D796  push   cs
03D797  call   0x3dbc2
03D79A  add    sp, 8
03D79D  mov    es, word ptr [0xa60a]
03D7B2  push   cs
03D7B3  call   0x3dbc2
03D7B6  add    sp, 8
03D7B9  mov    word ptr [bp - 2], si
03D7BC  mov    word ptr [bp - 0xc], 0xcca
```

```
weapon_key = es:[ad1c+0xF0]
template_off = weapon_key * 12 + 0x2CE   // rep movsd ×3
copy from DS:0x13BD + template_off → ad18+0x52
```

→ **武器種別ごとの descriptor テンプレ** が file 内 DS セグ（seg `0x13BD` 相当）に存在。
Kar98k の mag58/mag68 行は **このテーブル行** に埋込。

### 関連 runtime ポインタ

| ES:off | 用途 |
|--------|------|
| **`0xAD18`** | loadout テンプレ workspace |
| **`0xAD1C`** | loadout セッション（+0x46 blob far ptr, +0xF0 weapon key） |
| `0xAD24` | フラグ（bit5=pool直walk @ 3D441） |

### callers — **`0x03D797, 0x03D7B3`**（いずれも `3D72A` 内）

## ST 再現指針

1. 武器 `weapon_key`（ad1c+0xF0）→ テンプレ table lookup
2. `3DBC2` 相当: テンプレを blob buffer に section×pair コピー
3. `3D42A` / `3D540` — [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md) 参照

ST 暫定: テーブル未抽出のため **mission pool + cap** のみ。

## 未完了

1. ~~**DS:0x13BD + 0x2CE**~~ → seg132 [PL_CBE_LOADOUT_TEMPLATE_RE.md](./PL_CBE_LOADOUT_TEMPLATE_RE.md)；runtime DS マップ未了
2. template `+0x56/+0x58` と packed 記述子 group class の対応
3. 第 2 buffer（0x24CA:0x2304）→ @ `3D59C` 第 2 パスとの接続

## 関連

- [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)
- [PL_CBE_LOADOUT_CANDIDATE_RE.md](./PL_CBE_LOADOUT_CANDIDATE_RE.md)
- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)
