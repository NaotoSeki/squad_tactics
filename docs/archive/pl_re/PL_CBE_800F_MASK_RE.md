# CBE `0x800F` mask @ `0x3D540` — 静的 RE 解決

**生成**: 2026-05-31 — `python scripts/re_cbe_800f_mask.py`

## 結論

### asm（**CONFIRMED** — EXE 内ユニーク）

- `and cx, 0x800F` — **1** 箇所のみ @ **`0x03D4F4`**
- `cmp es:[di+0x2A], cx` @ **`0x03D540`** — **弾側マスク無し**

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
03D4F2  mov    ax, cx
03D4F4  and    cx, 0x800f ; MASK
03D4F8  and    ax, 0xf0
03D4FB  sar    ax, 4
03D4FE  mov    word ptr [bp - 0xe], ax
03D501  add    si, 2
03D504  mov    word ptr [bp - 0xc], 1
03D509  mov    word ptr [bp - 0x12], si
03D50C  mov    word ptr [bp - 0xa], cx
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
03D540  cmp    word ptr es:[di + 0x2a], cx ; mag_type cmp
03D544  jne    0x3d514
03D546  cmp    word ptr es:[di + 0xba], 0
03D54C  jne    0x3d514
03D54E  mov    si, word ptr [bp - 0x12]
03D551  inc    word ptr es:[di + 0xba]
03D556  push   dx
03D557  push   ax
03D558  push   word ptr [bp - 0x10]
03D55B  push   si
03D55C  mov    word ptr [bp - 0x22], ax
```

### マスクの意味

`0x800F` = bit15 + bits0..3 を保持、**bits4..14 をクリア**。

| header / mag | raw | `& 0x800F` |
|--------------|-----|------------|
| mag58 `0x003A` (58) | 58 | **10** (`0x000A`) |
| mag68 `0x0044` (68) | 68 | **4** (`0x0004`) |
| 272 ammo | 58 | **10** |
| 273 ammo | 68 | **4** |

header word は **mag_type 定数そのもの**（58 / 68）。
レジスタ cx は **マスク後** の値（10 / 4）。

### Kar98k — 照合表

#### mag58 header `0x003A` → cx=**10**

| idx | mag_type | masked | cx | full cmp | masked cmp |
|-----|----------|--------|-----|----------|------------|
| **272** | 58 (0x003A) | 10 | 10 | FAIL | **PASS** |
| **269** | 54 (0x0036) | 6 | 10 | FAIL | FAIL |
| **273** | 68 (0x0044) | 4 | 10 | FAIL | FAIL |
| **314** | 0 (0x0000) | 0 | 10 | FAIL | FAIL |

#### mag68 header `0x0044` → cx=**4**

| idx | mag_type | masked | cx | full cmp | masked cmp |
|-----|----------|--------|-----|----------|------------|
| **274** | 72 (0x0048) | 8 | 4 | FAIL | FAIL |
| **273** | 68 (0x0044) | 4 | 4 | FAIL | **PASS** |
| **314** | 0 (0x0000) | 0 | 4 | FAIL | FAIL |

### 静的矛盾と解決

| 照合方式 | 272 vs mag58 | 273 vs mag68 | 269 vs mag58 | 314 vs mag58 |
|----------|--------------|--------------|--------------|--------------|
| **full**: `mag == cx` | FAIL (58≠10) | FAIL (68≠4) | FAIL | FAIL |
| **masked both**: `(mag&800F)==cx` | **PASS** | **PASS** | FAIL (6≠10) | FAIL (0≠10) |

**解釈（確定度: 高）**

1. **意図セマンティクス** = `(ammo[+0x2A] & 0x800F) == (header & 0x800F)`
   — Kar98k の 272/273 は各 group header で **masked PASS**
2. **生 asm** は弾側マスク無し → 272(58) vs cx(10) は **pass1 不通過**
   - ランタイム ES コピーで +0x2A が変換される、または
   - **第 2 パス @ `0x3D59C`**（mag_type cmp 無し）で 269/314 をリンク
3. **269 / 314** は mag58 group に列挙されるが masked PASS しない
   → pass1 対象外、pass2 / 副装列が正本

### blob packed 形式（復習）

```
byte0 @ si     — class nibble (low 4 bits); >=4 → buffer B (0x18a)
word0 @ si     — header mag_type 定数 (0x003A / 0x0044)
  cx = word0 & 0x800F
word1.. @ si+2 — cbe index 列 (-1 終端)
```

seg132 `[weapon_id, mag_word, 0]` + pairs は **テンプレ正本** —
[PL_CBE_LOADOUT_TEMPLATE_RE.md](./PL_CBE_LOADOUT_TEMPLATE_RE.md)

## ST 再現指針

```python
MASK = 0x800F

def loadout_mag_gate_pass(ammo_mag_type: int, header_word: int) -> bool:
    return (ammo_mag_type & MASK) == (header_word & MASK)

# Kar98k pass1 暫定
MAG58 = 0x003A
MAG68 = 0x0044
pass1_mag58 = [i for i in (272, 269, 273, 314)
               if loadout_mag_gate_pass(cbe[i].mag_type, MAG58)]
# → [272] のみ masked 一致
```

旧 doc の「cx=58 で pass」表記は **header raw=58** の意味論混同 —
レジスタ cx は **10**（masked）。

## 未完了

1. runtime ES:512B レコード @ +0x2A の実値（DOSBox ブレーク）
2. pass2 buffer @ `0x1EC` — 269/314 index 列の正本
3. `0x8000` bit — header に立つケースの cmp 挙動

## 関連

- [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)
- [PL_CBE_LOADOUT_TEMPLATE_RE.md](./PL_CBE_LOADOUT_TEMPLATE_RE.md)
- [PL_CBE_SEG132_EXPORT.md](./PL_CBE_SEG132_EXPORT.md)
- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)
