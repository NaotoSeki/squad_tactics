# CBE 273→272 実経路 RE

**生成**: 2026-05-31 — `python scripts/re_cbe_273_272_path.py`

## 結論

### 273→272 は **単一命令の差替ではない** — 3 段パイプライン

| 段 | 関数 (file) | 役割 |
|----|-------------|------|
| **1. 在庫供給** | `mission_pool_build` @ **`0x0494EC`** (lcall E02C) | シナリオ/小隊データ → **`DS:0x270`** u16 列。272/273 **両方** 載るデータあり |
| **2. cap フィルタ** | `squad_roster_pool_scan` @ **`0x04240C`** | `cmp pool_cap, weapon_cap` @ **424B1** — 不一致→422B8 / **+0xA4** |
| **2b. 差替試行** | `pool_cap_mismatch_substitute` @ **`0x042654`** | cap 不一致 → **lcall 493E0** + **41914**（4240C 空時） |
| **2c. UI 準備** | loadout prep @ **`0x03D410`** | cap 不一致 → **`or [rec+0xA4]`**（3D42A 直前） |
| **3. リスト化** | `loadout_ui_build` @ **`0x03D42A`** | **mag_type @ 3D540** のみ — **cap cmp / index 差替なし** |

> **Kar98k 静的 `ammo_indices`** = `[273,…]` だが、**mission pool に 272 が独立 entry として存在**すれば
> cap 不一致の 273 は **+0xA4 フラグ** / validate 落ち、**272 が採用**される。
> **build_ui_ammo_list の lcall D3B0** は cap **一致**時のみ — 273→272 本体 **ではない**（[PL_CBE_D3B0_SUBSTITUTE_RE.md](./PL_CBE_D3B0_SUBSTITUTE_RE.md)）。

### 静的 CBE データ

| | Kar98k (57) | 272 (7.92-5) | 273 (7.92-10G) |
|--|-------------|--------------|----------------|
| ammo_indices | `[273, 304, 305, 314]` | **indices 外** | `[0]` |
| mag_cap | **5** | **5** | **10** |
| mag_type (+0x2A) | **0** | **58** | **68** |
| u27 | **14** | **14** | **14** |

### シナリオ埋込データ（seg132）

file **`0x1DCAB2`** — 単位装備テーブル内に **272(qty4) と 273(qty6) が共存**:

**前後 u16 ウィンドウ** (272 @ center):

| file | u16 | 注 |
|------|-----|-----|
| `0x1DCAA2` | **4** |  |
| `0x1DCAA4` | **273** | 7.92-10G |
| `0x1DCAA6` | **6** |  |
| `0x1DCAA8` | **314** |  |
| `0x1DCAAA` | **1** |  |
| `0x1DCAAC` | **55** | Gew98? |
| `0x1DCAAE` | **58** |  |
| `0x1DCAB0` | **0** |  |
| `0x1DCAB2` | **272** | 7.92-5 |
| `0x1DCAB4` | **4** |  |
| `0x1DCAB6` | **269** |  |
| `0x1DCAB8` | **4** |  |
| `0x1DCABA` | **273** | 7.92-10G |
| `0x1DCABC` | **6** |  |
| `0x1DCABE` | **314** |  |
| `0x1DCAC0` | **1** |  |

**272 地点を (idx,qty) と解釈**:

| idx | qty |
|-----|-----|
| **272** | 4 |
| **269** | 4 |
| **273** | 6 |
| **314** | 1 |

- seg132 内 u16=**272**: 1 件 (`0x1DCAB2` …)
- seg132 内 u16=**273**: 40 件

## パイプライン詳細

```
scenario / unit table (seg132 等)
  └─ lcall E02C @ 0x0494EC  ← 42566 から
       push weapon_cap → lcall DE4A @ 0x04930A
       → DS:0x270[] = { cbe index, …, -1 }

装備/小隊 UI @ 0x4240C
  weapon_cap = member[+0x28]
  for idx in pool:
    if pool[idx].cap == weapon_cap → accept
    else test [rec+0xA4] & (slot+1); call 422B8 validate
  if empty → call 0x42654 (cap mismatch substitute)

装填 UI open (3D1BA)
  3D3DB: pool walk → cap≠ → or [rec+0xA4]
  3D42A: [ad1c+0x46] 記述子 → nested index
         cmp [cbe+0x2A], cx @ 3D540  (mag_type gate)
         → weapon_row +0xCE/+0xD0/+0xD2

gather @ 0x3D042 (別経路)
  pool → 6B entry; filter member+0x8A/+0x84 — cap 未使用
```

## 確定アンカー

### cap 不一致 @ squad scan — `0x0424B1`

```asm
042475  mov    bx, 0x270 ; pool
042481  cmp    word ptr es:[bx], 0
0424B1  cmp    word ptr es:[bx + 0x28], ax ; cap
0424B5  je     0x42509
0424BA  test   word ptr es:[si + 0xa4], ax ; +0xA4
0424BF  je     0x42509
0424C1  cmp    word ptr es:[si + 0xba], 0
0424C7  jne    0x42509
0424CF  add    bx, word ptr es:[si + 0x8a] ; +0x8A
0424DA  cmp    word ptr es:[bx + 0x2cca], 0 ; ammo
0424E0  jne    0x42509
0424EB  call   0x422b8
0424F3  je     0x42509
04250C  cmp    word ptr es:[di], 0
```

### cap 不一致 → substitute 試行 — `0x042654`

```asm
042654  enter  0xa, 0
04265C  mov    ax, 0x270 ; pool
042668  cmp    word ptr es:[di], bx
042698  cmp    word ptr es:[bx + 0x8a], di ; +0x8A
04269D  jne    0x426ca
0426A2  cmp    word ptr es:[bx + 0x28], ax ; cap
0426A6  je     0x426ca
0426AA  lcall  0x6e55, 0xdf20
0426B4  je     0x426ca
0426BB  call   0x41914
0426C3  je     0x426dc
0426CD  cmp    word ptr es:[si], 0
0426DB  retf   
```

### loadout 準備 cap フラグ — `0x03D410`

```asm
03D410  cmp    word ptr es:[si + 0x28], cx ; cap
03D414  je     0x3d41e
03D419  or     word ptr es:[di + 0xa4], ax ; +0xA4
03D41E  cmp    word ptr [bx], 0
03D428  retf   
03D42A  enter  0x22, 0
```

### mag_type ゲート（差替なし）— `0x03D540`

```asm
03D540  cmp    word ptr es:[di + 0x2a], cx ; mag_type
03D544  jne    0x3d514
03D546  cmp    word ptr es:[di + 0xba], 0
03D54C  jne    0x3d514
```

### pool 構築 cap push — `0x0495B5`

```asm
0495B5  push   word ptr es:[bx + 0x28] ; cap
0495B9  lcall  0xde4a, 0xa438
0495CC  cmp    word ptr es:[si], 0
0495F0  mov    ax, word ptr es:[di + 0x8a] ; +0x8A
0495F7  cmp    word ptr es:[bx + 0x8a], ax ; +0x8A
0495FC  jne    0x495c9
049601  cmp    word ptr es:[bx + 0x26], ax
04960C  retf   
```

## `@ 0x771E` cat18 / ammo_indices

near `call 0x771E`: **0 件** — 装填 UI 候補列とは **静的に未接続**。
cat18 時 `add ax,0x2C` → ammo_indices[0..3] と cmp — **別バイナリ/動的**の可能性。

## ST 再現指針

1. **正本**: mission pool に **272 と 273 が別 entry** → cap/mag_type/+0xA4 で 273 落ち 272 残る
2. **暫定 `applyMagCapSubstitute`**: pool 構築 + cap フィルタの **データ側圧縮** — 方向性は整合
3. **3D42A 単体**では 273→272 **起きない** — upstream pool が正本
4. **771E / ammo_indices 静的走査**は本 EXE では装填 UI に未接続

## 未完了

1. ~~seg132 テーブル → runtime `DS:0x270` コピー~~ → 部分確定 [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md)
2. ~~`lcall DE4A` 返値~~ — DBD7 @ `0x04859A` [PL_CBE_DBD7_RE.md](./PL_CBE_DBD7_RE.md)
3. ~~packed 記述子 `cx` nibble~~ → [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)

## 関連

- [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)
- [PL_CBE_D3B0_SUBSTITUTE_RE.md](./PL_CBE_D3B0_SUBSTITUTE_RE.md)
- [PL_CBE_CAP_SUBSTITUTE_RE.md](./PL_CBE_CAP_SUBSTITUTE_RE.md)
- [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md)
- [PL_CBE_VALIDATE_422B8_RE.md](./PL_CBE_VALIDATE_422B8_RE.md)
