# CBE cap 不一致 → 弾置換 / +0x187 UI フラグ

**生成**: 2026-05-31 — `python scripts/re_cbe_cap_substitute.py`

## 結論

### Kar98k → 272 の機構（RE 確定 + 解決先は外部 lcall）

| 段階 | 内容 |
|------|------|
| 静的 CBE | Kar98k `ammo_indices[0]` = **273** (cap10), 272 は indices 外 |
| 武器 cap | Kar98k `mag_cap` = **5** |
| 272 弾 | cap **5** — 武器と一致 |
| 273 弾 | cap **10** — 武器と **不一致** |

装填 UI リスト構築 **`build_ui_ammo_list` @ 0x3DC50** が本体:

1. `weapon_cap = weapon[+0x28]` を保存 (@ 0x3DC83)
2. 各候補 index について CBE 弾行をロード (`lcall 0xCB4C` 系)
3. **`cmp cbe_ammo[+0x28], weapon_cap`** (@ 0x3DDFA)
4. **不一致** → 内部タグ **`0x000C` または `0x000D`**（entry フラグ `+0x1D` bit6 で分岐）
5. タグ **`0`** かつ UI モード `ad34==5` → **`lcall 0xD3B0(weapon_ptr)`** → **返値 ax → si** (@ 0x3DFAC)

> **訂正 (2026-05-31)**: cap **不一致**は tag **0xC/0xD** をセット → **lcall スキップ**。
> lcall が走るのは **cap 一致**（tag 0 が維持）のとき。273→272 差替は **別経路** が正本候補。
> 詳細: [PL_CBE_D3B0_SUBSTITUTE_RE.md](./PL_CBE_D3B0_SUBSTITUTE_RE.md)

**lcall 本体**: seg5 **`0x048870`** — 272 即値なし。mag_type / +0x42BC テーブル参照型。

ST `pl_ammo_cbe_filters.py` の **u27 クラスタ + cap 一致** は、この外部 resolver の **データ側エミュレ** として整合。

### 3 系統の cap 不一致処理

| 経路 | アンカー | 不一致時 |
|------|---------|----------|
| **装填リスト構築** | `@ 0x3DDFA` / `@ 0x3DFAC` | 不一致→tag C/D（**差替なし**）；一致→lcall **0xD3B0** で canonical index |
| **装備 populate** | `@ 0x3C81A` | UI 行 **`+0x187` bit7** セット |
| **小隊員フラグ** | `@ 0x3E695` | member **`+0x187` bit7** セット |

### UI 行 `+0x187` bit7 — 表示コールバック

リスト行オブジェクト（`row[+0x28]` 経由）の **`+0x187`** bit7:

| 関数 | 効果 |
|------|------|
| `@ 0x10441A` | `and 0x7F` — **一致**側描画 |
| `@ 0x104436` | `or 0x80` — **不一致**側描画 |

populate @ 3C81A は **index 差替ではなく表示状態** を切替。差替本体は 3DC50 系。

## 疑似コード — `build_ui_ammo_list` @ 0x3DC50

```c
weapon_cap = weapon->u16[20];  // +0x28 magazine_capacity
for (entry : candidate_u16_list) {
  AmmoRec *a = load_cbe(entry.index);
  if (member->??[+0x28] != a->mag_cap) mismatch_ctr++;  // @ 3DD9E
  if (a->mag_cap != weapon_cap) {
    tag = entry.has_flag_0x40 ? 0xD : 0xC;
    if (tag == 0 && ui_mode == 5)
      entry.index = lcall_D3B0(weapon);  // cap 一致時のみ — 272 差替は別経路
  } else {
    clear_slot();
  }
  append_ui_row(entry.index, ...);
}
```

## 逆アセンブル

### weapon_cap 保存 @ 0x3DC83

```asm
03DC50  enter  0x22, 0
03DC7E  je     0x3dcc2
03DC83  mov    ax, word ptr es:[di + 0x28] ; cap
```

### cap 走査 @ 0x3DD97

```asm
03DD97  mov    ax, word ptr es:[bx + 0x28] ; cap
03DD9E  cmp    word ptr es:[si + 0x28], ax ; cap
03DDA2  je     0x3ddaa
03DDB3  lcall  0x2913, 0xcfcc ; call
03DDD0  lcall  0x2923, 0xc8ec ; call
03DDE0  lcall  0x292f, 0xd962 ; call
03DDEC  lcall  0x298f, 0xc8ec ; call
03DDFA  cmp    word ptr es:[si + 0x28], ax ; cap
03DDFE  je     0x3de16
03DE0A  je     0x3df1f
```

### 不一致分岐 @ 0x3DDFA

```asm
03DDFA  cmp    word ptr es:[si + 0x28], ax ; cap
03DDFE  je     0x3de16
03DE0A  je     0x3df1f
03DDFE  je     0x3de16              ; cap 一致 → クリア
03DE00  mov    word ptr [bp - 0x1a], 0xc   ; 不一致 tag C
03DE0E  mov    word ptr [bp - 0x1a], 0xd   ; 不一致 tag D
```

### 置換 lcall @ 0x3DFAC

```asm
03DF67  cmp    si, 9
03DF6A  jne    0x3df8c
03DF6C  cmp    word ptr [bp - 0x1c], 0
03DF70  je     0x3df7c
03DF7A  retf   
03DF7C  cmp    word ptr [bp - 0x1e], 0
03DF80  je     0x3dfb6
03DF8A  retf   
03DF90  cmp    word ptr es:[0xad34], 5
03DF96  jne    0x3dfb6
03DFA4  je     0x3dfb6
03DFA8  jne    0x3dfb6
03DFAC  lcall  0x256d, 0xd3b0 ; call
03DFBB  retf   
```

**`lcall 0xD3B0` サイト**: `0x00DE37 (seg=0xCDC5), 0x00DF39 (seg=0xC133), 0x037F03 (seg=0xAF2A), 0x03DFAC (seg=0x256D)`

### populate フラグ @ 0x3C81A

```asm
03C813  mov    ax, word ptr es:[si + 0x28] ; cap
03C81A  cmp    word ptr es:[di + 0x28], ax ; cap
03C81E  je     0x3c832
03C822  je     0x3c829
03C824  cmp    bx, 2
03C827  jne    0x3c832
03C82C  or     byte ptr es:[bx + 0x187], 0x80 ; +0x187
03C838  retf   
03C83A  enter  4, 0
```

### UI 描画 CB @ 0x104410

```asm
```

## ST 再現指針

1. **正本**: cap 不一致 → **別 cbe index に差替**（外部 0xD3B0 相当）
2. **暫定**: `applyMagCapSubstitute` — u27 クラスタ内 cap 一致（272 等）
3. **UI**: +0x187 相当は ST では「置換済み index を最初からリストに載せる」で足りる
4. **データ**: Kar98k raw indices は 273 先頭 — **差替後** effective = 272

## 未完了

1. ~~**`lcall 0xD3B0` 内部**~~ → [PL_CBE_D3B0_SUBSTITUTE_RE.md](./PL_CBE_D3B0_SUBSTITUTE_RE.md)（本体 @ 0x048870 解決）
2. **273→272 実経路** — [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)（mission pool + cap/+0xA4、3D42A は mag_type のみ）
3. tag **0xC / 0xD** の UI 列意味（entry `+0x1D` bit6）
4. member `[+0x28]` @ 3DD9E — ランタイム武器 cap コピーか要確認

## 関連

- [PL_CBE_D3B0_SUBSTITUTE_RE.md](./PL_CBE_D3B0_SUBSTITUTE_RE.md)
- [PL_CBE_LOADOUT_CANDIDATE_RE.md](./PL_CBE_LOADOUT_CANDIDATE_RE.md)
- [PL_CBE_F7C8_DEEP_RE.md](./PL_CBE_F7C8_DEEP_RE.md)
- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)
