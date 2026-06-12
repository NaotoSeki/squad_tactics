# CBE loadout pass2 — buffer @ `0x1EC` RE

**生成**: 2026-05-31 — `python scripts/re_cbe_pass2_1ec.py`

## 結論

### pass2 @ **`0x03D59C`** — **mag_type cmp 無し**、**+0xBA 状態で +0x3E / +0x80 更新**

装填 UI 構築 `3D42A` の **第 2 ループ**。
入力列は **直前の `lcall E02C` が書いた u16[] @ `0x201F:0x1EC`**（`DS:0x270` とは別オフセット）。

```
3D42A open
  3D49A  mov ax,0x1EC; mov cx,0x201F
  3D4A8  lcall E02C          ← pool 構築（0x270 版と同系）
  3D4CA  pass1: blob [ad1c+0x46] → mag_type @ 3D540
  3D59C  pass2: walk 0x201F:0x1EC until -1
```

### pass2 本体

```asm
03D59C  mov    ax, word ptr [bp - 0x1e]
03D59F  mov    dx, word ptr [bp - 0x1c]
03D5A2  mov    di, ax
03D5A4  mov    word ptr [bp - 2], dx
03D5A7  mov    es, dx
03D5A9  mov    bx, ax
03D5AB  cmp    word ptr es:[bx], -1
03D5AF  je     0x3d5ff
03D5B1  mov    ax, 0x1e2d
03D5B4  mov    ds, ax
03D5B6  mov    si, di
03D5B8  add    di, 2
03D5BB  mov    si, word ptr es:[si]
03D5BE  shl    si, 9
03D5C1  mov    es, word ptr [0xad22]
03D5C5  add    si, word ptr [0xad20]
03D5C9  mov    bx, si
03D5CB  mov    word ptr [bp - 6], es
03D5CE  cmp    word ptr es:[si + 0xba], 0 ; +0xBA
03D5D4  jne    0x3d5e2
03D5D6  mov    dword ptr es:[bx + 0x80], 0 ; +0x80
03D5E0  jmp    0x3d5f4
03D5E2  mov    ax, si
03D5E4  sub    dx, dx
03D5E6  sub    ax, word ptr [0xad20]
03D5EA  sar    ax, 9
03D5ED  mov    es, word ptr [bp - 6]
03D5F0  mov    word ptr es:[bx + 0x3e], ax ; +0x3E
03D5F4  mov    es, word ptr [bp - 2]
03D5F7  cmp    word ptr es:[di], -1
03D5FB  jne    0x3d5b6
03D5FD  push   ss
03D5FE  pop    ds
03D5FF  lcall  0x216f, 0xa622
03D604  les    bx, ptr [bp - 0x1a]
03D607  les    bx, ptr es:[bx]
03D60A  xor    di, di
```

| 条件 | 動作 |
|------|------|
| `es:[rec+0xBA] == 0` | `dword [rec+0x80] ← 0`（未リンク行クリア） |
| `es:[rec+0xBA] != 0` | `word [rec+0x3E] ← cbe index`（pass1 でリンク済み行の確定） |

**mag_type / cap 照合なし。** index 列を walk してランタイム CBE 行のフラグだけ触る。

### `0x1EC` 列の供給元

| 経路 | file | 内容 |
|------|------|------|
| **E02C @ 3D4A8** | push `0x201F`, push **`0x1EC`** | loadout 開始時の pass2 用 pool（DE4A 系と同族） |
| **45C0C 挿入** | `0x045BD8` 等 push **`0x1EC`** | 装備チェーンから u16 列へ index **挿入** |
| pass1 descriptor | buffer **`0x128` / `0x18a`** | blob 内 index 列 — **pass2 とは別** |
| 3DBC2 第2出力 | `0x24CA:0x2304` | テンプレ blob — `3D7DA` ループで **別表** を生成 |

E02C サイト 3 件:

| file | pool offset | 用途 |
|------|-------------|------|
| `0x042566` | **0x270** | 小隊 init / squad scan 正本 |
| `0x0387DC` | **0x270** | 別 init + cap38814 |
| **`0x03D4A8`** | **`0x1EC`** | **loadout pass2 専用** |

runtime の **`0x201F:0x1EC` 中身**（272/273/269/314 の並び）は静的 file からは未ダンプ —
E02C 入力シナリオ ptr が `0x270` 版と同一なら **同一 index 集合**の可能性大。

### Kar98k → **7.92-5 (272)** — **もう明らか（pass2 外）**

| 問い | 答え | 確度 |
|------|------|------|
| UI に 272 が出る正本は？ | **mission pool `0x270` + cap/+0xA4** — 273(cap10) 落ち・272(cap5) 残り | **CONFIRMED** |
| pass2 が 273→272 する？ | **No** — mag/cap 見ない。+0xBA 済み行の +0x3E 書込のみ | **CONFIRMED** |
| 3D540 が 273→272 する？ | **No** — 272/273 は別 mag 行（58 vs 68） | **CONFIRMED** |
| seg132 データ | `[272×4, 269×4, 273×6, 314×1]` @ `0x1DCAAC` — **272/273 両方供給** | **CONFIRMED** |

詳細: [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)

pass2 が Kar98k で触るのは **pass1 後の確定処理**（例: 272 は +0xBA 済み → +0x3E 設定）。
**269 / 314** は pass1 masked gate 不一致 → pass2 で +0x80 クリア側の候補。

### 45C0C — index 列挿入ユーティリティ

```asm
045C0C  push   bp
045C0D  mov    bp, sp
045C0F  push   di
045C10  lds    bx, ptr [bp + 6]
045C13  cmp    word ptr [bx], 0
045C16  jge    0x45c1e
045C18  mov    di, word ptr [bp + 0xa]
045C1B  jmp    0x45c2d
045C1D  nop    
045C1E  mov    di, word ptr [bp + 0xa]
045C21  cmp    word ptr [bx], di
045C23  jge    0x45c2d
045C25  add    bx, 2
045C28  cmp    word ptr [bx], 0
045C2B  jge    0x45c21
045C2D  or     di, di
045C2F  jl     0x45c3e
045C31  mov    cx, word ptr [bx]
045C33  mov    word ptr [bx], di
045C35  add    bx, 2
045C38  mov    di, cx
045C3A  or     di, cx
045C3C  jge    0x45c31
045C3E  mov    word ptr [bx], 0xffff
045C42  push   ss
045C43  pop    ds
045C44  pop    di
045C45  leave  
045C46  retf   
045C47  nop    
045C48  enter  2, 0
```

装備経路 @ `0x045BD8`: `push …; push 0xA731; push 0x1EC; call 0x45C0C` —
既存 u16 列に **単一 index をソート挿入**（`0x18A` / `0x128` / `0x24E` も同型）。

## ST 再現指針

```python
# 273→272 — pass2 不要
candidates = mission_pool_filter_cap(pool_270, weapon_cap=5)

# pass2 相当 — mag 確定後のメタデータのみ
for idx in pool_1ec:
    rec = runtime_cbe[idx]
    if rec.linked_ba:  # +0xBA
        rec.slot_3e = idx
    else:
        rec.flag_80 = 0
```

## 未完了

1. runtime **`0x201F:0x1EC`** の実 index 列ダンプ（DOSBox）
2. E02C(0x1EC) と E02C(0x270) の **入力シナリオ ptr 同一性**
3. `3D7DA` テンプレ loop → `0x230E`/`0x14CA` 表と pass2 列の差

## 関連

- [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)
- [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)
- [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md)
- [PL_CBE_800F_MASK_RE.md](./PL_CBE_800F_MASK_RE.md)
- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)
