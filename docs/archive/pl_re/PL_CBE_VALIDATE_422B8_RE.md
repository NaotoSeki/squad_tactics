# CBE `@ 0x422B8` — 装備候補 validate

**生成**: 2026-05-31 — `python scripts/re_cbe_validate_422b8.py`

## 呼び出し元

`@ 0x4240C` 小隊走査 — 各候補で `call 0x422B8`。
`ax != 0` なら `member+0x3E`（cbe index）を出力列へ。

## 疑似コード

```c
// retf — validate_422B8(equip_ui *ui, member *m, ui_ds, member_es)
// 4240C: push ui; push member; call 422B8 → ax!=0 で候補採用
bool validate_422B8(ui, member) {
  if (ui->equipOff (+0x8A) == member->equipOff (+0x8A))
    return true;                          // @ 0x422CC 同一スロット

  if (member->flags (+0x81) & 0x18)       // @ 0x422DC
    return false;

  if (slot_col_flags(ui) || slot_col_flags(ui_ds))  // 41914 ×2
    return false;

  req = lcall_compat(ui->equipOff, member->equipOff);  // 0xA452
  u26 = weapon_u26_req(member_weapon);    // 41764
  if (u26 < req) return false;            // @ 0x42328

  col_ui   = weapon_col_type(ui);         // 41942
  col_mem  = weapon_col_type(member);     // 41942
  return cross_compat_table(col_mem, col_ui, member->equipOff);  // 41BD8
}

// 41970 — u26 副装備一致（MG 系）
bool u26_aux_check(weapon_rec *w, candidate_type ax) {
  if (w[+0x26] >= 5) return false;        // カテゴリ閾値（LMG未満）
  if (slot_col_flags(w)) return false;
  if (w->u26 (+0x34) == ax) return true;  // **u26 リンク一致**
  if (w->flags (+0x81) & 0x18) return false;
  ...
}
```

## ST 実装ルール（422B8 から抽出）

| 列 kind | 422B8 / 41970 根拠 | ST ルール |
|---------|-------------------|-----------|
| `ammo_box` col1 | u26 @ +0x34 一致 | `PL_COMPOSITE_U26[weapon].idx` |
| `tripod` col2 | 41BD8 交差表 + 非 u26 | `TRIPOD_CODE_FOR_MAIN` / cbe map |
| `optic` col3 | u26 観測鏡行 | composite u26 kind=optic |
| 主弾 col0 | cat18 パイプライン | `finalizeWeaponAmmoIndices` |

## `@ 0x422B8` 逆アセンブル

```asm
0x0422C4  mov    ax, word ptr es:[si + 0x8a] ; +0x8A equipOff
0x0422CC  cmp    word ptr [di + 0x8a], ax ; +0x8A equipOff
0x0422D0  jne    0x422dc ; *
0x0422DA  retf    ; *
0x0422DC  test   byte ptr es:[si + 0x81], 0x18 ; +0x81 flags
0x0422E2  jne    0x42330 ; *
0x0422E9  call   0x41914 ; *
0x0422F1  jne    0x42368 ; *
0x0422F8  call   0x41914 ; *
0x042300  jne    0x42368 ; *
0x042305  push   word ptr es:[di + 0x8a] ; +0x8A equipOff
0x04230D  push   word ptr es:[si + 0x8a] ; +0x8A equipOff
0x042312  lcall  0x70a9, 0xa452 ; *
0x042322  call   0x41764 ; *
0x042328  cmp    ax, word ptr [bp - 2] ; *
0x042339  call   0x41942 ; *
0x042343  push   word ptr es:[di + 0x8a] ; +0x8A equipOff
0x04234D  call   0x41942 ; *
0x042357  push   word ptr es:[si + 0x8a] ; +0x8A equipOff
0x04235D  call   0x41bd8 ; *
0x042366  retf    ; *
0x04236D  retf    ; *
```

## `@ 0x41970` u26 副装備チェック

```asm
0x041981  cmp    word ptr es:[si + 0x26], 5 ; +0x26 cat?
0x041988  mov    bx, word ptr es:[si + 0x8a] ; +0x8A equipOff
0x04199C  call   0x41914 ; *
0x0419A4  jne    0x419d9 ; *
0x0419A9  cmp    word ptr es:[si + 0x34], ax ; +0x34 u26
0x0419AD  je     0x419d9 ; *
0x0419AF  test   byte ptr es:[si + 0x81], 0x18 ; +0x81 flags
0x0419B5  jne    0x419d9 ; *
0x0419BA  call   0x41764 ; *
0x0419C8  push   word ptr es:[si + 0x8a] ; +0x8A equipOff
0x0419CE  call   0x419e0 ; *
0x0419DF  retf    ; *
```

## `@ 0x41BD8` — 交差互換（三脚等）

固定テーブル `@ 0x4CA` + `es:[rec+0x24CA]` ビットマスク — 全件 ST 移植は
`pl_cbe_aux_compat.js`（u26 + tripod cbe map）で近似。

## 関連

- [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md)
- [PL_CBE_POOL_CBE_RE.md](./PL_CBE_POOL_CBE_RE.md)
