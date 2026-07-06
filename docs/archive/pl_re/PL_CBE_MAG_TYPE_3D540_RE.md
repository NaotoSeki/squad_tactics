# CBE loadout mag_type ゲート @ `0x3D540` RE

**生成**: 2026-05-31 — `python scripts/re_cbe_mag_type_3d540.py`

## 結論

### `@ 0x3D540` — **弾 CBE `+0x2A` == 記述子 `cx`（`header & 0x800F`）**

```asm
03D4D2  mov    al, byte ptr es:[si]
03D4D5  and    al, 0xf
03D4D7  cmp    al, 4
03D4D9  jge    0x3d4e4
03D4DB  mov    ax, 0x128
03D4DE  mov    dx, 0x2028
03D4E1  jmp    0x3d4ea
03D4E3  nop    
03D4E4  mov    ax, 0x18a
03D4E7  mov    dx, 0x19fc
03D4EA  mov    di, ax
03D4EC  mov    word ptr [bp - 2], dx
03D4EF  mov    cx, word ptr es:[si]
03D4F2  mov    ax, cx ; cx
03D4F4  and    cx, 0x800f
03D4F8  and    ax, 0xf0
03D4FB  sar    ax, 4
03D4FE  mov    word ptr [bp - 0xe], ax
03D501  add    si, 2
03D504  mov    word ptr [bp - 0xc], 1
03D509  mov    word ptr [bp - 0x12], si
03D50C  mov    word ptr [bp - 0xa], cx ; cx
03D50F  mov    word ptr [bp - 4], di
03D512  mov    si, di
03D514  mov    es, word ptr [bp - 2]
03D517  cmp    word ptr es:[si], -1
03D51B  jne    0x3d522
03D51D  mov    si, word ptr [bp - 0x12]
03D520  jmp    0x3d588
03D522  mov    ax, word ptr es:[si]
03D525  shl    ax, 9
03D528  mov    es, word ptr [0xa602]
03D52C  add    ax, word ptr es:[0xad20]
03D531  mov    dx, word ptr es:[0xad22]
03D536  mov    di, ax
03D538  mov    word ptr [bp - 6], dx
03D53B  add    si, 2
03D53E  mov    es, dx
03D540  cmp    word ptr es:[di + 0x2a], cx ; mag_type
03D544  jne    0x3d514
03D546  cmp    word ptr es:[di + 0xba], 0 ; +0xBA
03D54C  jne    0x3d514
03D54E  mov    si, word ptr [bp - 0x12]
03D551  inc    word ptr es:[di + 0xba] ; +0xBA
03D556  push   dx
03D557  push   ax
03D558  push   word ptr [bp - 0x10]
03D55B  push   si
03D55C  mov    word ptr [bp - 0x22], ax
03D55F  mov    word ptr [bp - 0x20], es
```

**packed 記述子 1 グループ**（`[ad1c+0x46]` blob 内）:

```
byte0 & 0x0F  — group class (<4 → index buffer A, ≥4 → buffer B)
word0 @ si    — header
  cx = header & 0x800F     ← @ 3D540 cmp 右辺
  group = (header & 0xF0)>>4 → リンク後 ammo[+0xAE]
word1.. @ si+2 — u16 cbe index 列（-1 終端）
```

内側ループ @ `3D514`: index 列を walk → CBE ロード →

| 命令 | 意味 |
|------|------|
| `cmp es:[di+0x2A], cx` | **弾 mag_type 完全一致**（マスク済み cx） |
| `cmp es:[di+0xBA], 0` | ランタイム **未リンク** のみ |
| `inc es:[di+0xBA]` | 採用マーク（二重リンク防止） |
| `jne 3D514` | 不一致 → 次 index |

### Kar98k — **w21=0 でも skip 無し**

装備経路 `0x046C5B` / UI `0x1805A` とは異なり、
**loadout 構築は武器 mag_type=0 でもゲート発火**する。

期待 mag_type は **武器 CBE からではなく記述子 header** が持つ:

| | Kar98k (57) | 272 | 273 |
|--|-------------|-----|-----|
| mag_type (+0x2A) | **0** | **58** | **68** |
| `& 0x800F` | 0 | 10 | 4 |

- 272 は **header `0x003A`（raw=58, cx=10）** の記述子行で masked PASS
- 273 は **header `0x0044`（raw=68, cx=4）** の記述子行で masked PASS
- 269/314 は mag58 列に居るが masked PASS しない → pass2 等
- 詳細: [PL_CBE_800F_MASK_RE.md](./PL_CBE_800F_MASK_RE.md)
- **273→272 差替は 3D540 では起きない** — 別 group 行の問題

### 第 2 パス @ `3D59C` — **mag_type cmp 無し**

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
03D5D6  mov    dword ptr es:[bx + 0x80], 0
03D5E0  jmp    0x3d5f4
03D5E2  mov    ax, si
03D5E4  sub    dx, dx
03D5E6  sub    ax, word ptr [0xad20]
03D5EA  sar    ax, 9
03D5ED  mov    es, word ptr [bp - 6]
03D5F0  mov    word ptr es:[bx + 0x3e], ax
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

blob 走査後、別 buffer（`bp-0x1E` / `0x1EC` 系）を **mag_type 照合なし** でリンク。
+0xBA==0 と `+0x3E` 書込のみ — **フォールバック列** の可能性。

### mission pool 直 walk（フラグ経路）

`es:[0xAD24] & 0x20` が立つと @ `3D441` から **DS:0x270 を直接 walk**
（記述子 mag_type ループを bypass）。通常 loadout UI は @ `3D484` 側。

### caller — `call 3D42A` @ **`0x03D23B`**

## 他経路対比

| 経路 | file | w21=0 | 照合 |
|------|------|-------|------|
| equip | `0x046C5B` | skip | — |
| UI slot | `0x1805A` | skip | — |
| loadout 確定 | `0x018BF3` | exact weapon↔ammo |
| **loadout 構築** | **`0x03D540`** | **no skip** | **descriptor cx ↔ ammo** |

## ST 再現指針

```python
def loadout_link_pass1(descriptor_groups, index_lists):
    MASK = 0x800F
    for hdr, indices in zip(descriptor_groups, index_lists):
        expected = hdr & MASK
        for cbe_idx in indices:
            ammo = load_cbe(cbe_idx)
            if (ammo.mag_type & MASK) != expected:
                continue
            if ammo.runtime.linked:  # +0xBA
                continue
            link(ammo, group=(hdr & 0xF0) >> 4)
```

Kar98k: ST は **descriptor blob**（`3DBC2` 生成）を持たないため、
暫定は mission pool + cap フィルタ。mag_type 列は **データ待ち**。

## 未完了

1. **`3DBC2`** — header word 生成表（58/68 行の静的ソース）
2. `0x8000` bit in header — cx に残るが cmp 意味（要 runtime）
3. 第 2 パス buffer @ `0x1EC` の index 列ソース

## 関連

- [PL_CBE_LOADOUT_CANDIDATE_RE.md](./PL_CBE_LOADOUT_CANDIDATE_RE.md)
- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)
- [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)
