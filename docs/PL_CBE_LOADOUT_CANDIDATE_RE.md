# CBE 装填 UI — 候補 index 列 RE（0x3D42A 上流）

**生成**: 2026-05-31 — `python scripts/re_cbe_loadout_candidate.py`

## 結論

### 272 / Kar98k — データ vs UI 経路

| 項目 | 値 |
|------|-----|
| Kar98k (cbe **57**) `ammo_indices` | `[273, 304, 305, 314]` |
| Kar98k `mag_cap` (+0x28) | **5** |
| 7.92-5 (**272**) cat / cap | cat **18**, cap **5** |
| 7.92-10G (**273**) cat / cap | cat **18**, cap **10** |

**静的 CBE テーブルに 272 は Kar98k の ammo_indices に無い（先頭は 273）。**
UI に 272 が出るなら、**mission pool（0x270 列）** か **populate cap 置換** が経路。

### パイプライン（確定）

```
mission pool  DS:0x270  (u16[] until <0)
  @ 0x3CC54  mission_pool_iterate
  @ 0x3D042  gather_mission_candidates
      filter: member[+0x8A], member[+0x84/+0x8E]
      output: u16 cbe index[] + 0xFFFF
      ※ cat18 / ammo_indices / 771E 未使用

  @ 0x3BFFE  attach_candidate_list → 3B758 互換検証

open loadout UI
  @ 0x3D1BA  open_loadout_ui_session
  @ 0x3D72A  prepare_loadout_ad1c
      ad18 テンプレ copy → es:[ad1c]
      call 0x3DBC2 ×2  … +0x46/+0x48 列 blob
  @ 0x3D42A  loadout_ui_build_and_link
      read far ptr [ad1c+0x46]
      walk packed 記述子 → nested u16 index
      @ 0x3D540  mag_type gate
      @ 0x3D68F  widget → weapon_row +0xCE/+0xD0/+0xD2

装備 composite 列（別系統）
  @ 0xF7C8 / populate 0x3C652
      @ 0x3C81A  cmp [di+0x28] magazine_capacity  ← cap 照合はここ
```

### cap 照合 — **初の確定 cmp**

`@ 0x3C81A`（populate / `call 0x3C652` 経路 — F7C8 装備列）:

```asm
mov    ax, word ptr es:[si + 0x28]
cmp    word ptr es:[di + 0x28], ax   ; weapon cap vs ref cap
je     skip_flag
... or byte ptr es:[bx + 0x187], 0x80
```

**3D42A 装填リスト構築本体に cap cmp は無し。** mag_type @ 0x3D540 のみ。

### `@ 0x771E` cat18 / ammo_indices

near `call 0x771E`: **0 件** — 本 EXE 静的解析では呼び出し元不明。
装填 UI 候補列（3D042）とは **別経路** の可能性大（loadout 確定 / 未使用コード）。

## near call  xref

| 関数 | 呼び出し元 |
|------|-----------|
| `3D042` | `0x03C028` |
| `3BFFE` | `—` |
| `iter_3CC54` | `0x03C9D0, 0x03CB8C` |
| `3D72A` | `0x03D22F` |
| `3D42A` | `0x03D23B` |
| `771E` | `—` |
| `type_18BF3` | `—` |

## `@ 0x3D042` gather（mission pool → index 列）

```asm
03D04D  mov    ax, 0x270 ; pool
03D059  cmp    word ptr es:[bx], 0
03D090  cmp    word ptr es:[bx + 0x8a], ax ; +0x8A
03D09F  cmp    word ptr es:[bx + 0x84], ax ; +0x84
03D0BC  lcall  0x1c1e, 0xd0da ; call
03D0D0  cmp    word ptr es:[di], 0
03D0EC  lcall  0xffff, 0xa958 ; call
```

## `@ 0x3CC79` mission pool iterate

```asm
03CC79  mov    ax, 0x270 ; pool
03CC83  cmp    word ptr [si], 0
03CCC0  cmp    word ptr es:[bx + 0x8a], ax ; +0x8A
03CCD5  lcall  0x1843, 0xd0da ; call
03CCDD  cmp    ax, word ptr [bp + 0xc]
03CD00  lcall  0x18be, 0xa31c ; call
```

## `@ 0x3C81A` populate cap cmp

```asm
03C813  mov    ax, word ptr es:[si + 0x28] ; cap/+0x28
03C81A  cmp    word ptr es:[di + 0x28], ax ; cap/+0x28
03C824  cmp    bx, 2
03C838  retf   
03C83A  enter  4, 0
```

## `@ 0x3D4B4` loadout 記述子 read

```asm
03D4B4  les    bx, ptr es:[0xad1c] ; ad1c
03D4B9  mov    ax, word ptr es:[bx + 0x46] ; +0x46
03D4CA  cmp    word ptr es:[bx], -1
03D4D7  cmp    al, 4
03D517  cmp    word ptr es:[si], -1
```

## ST 暫定 magCap フィルタとの関係

- CBE 静的: Kar98k → **273**（cap10）、272（cap5）は indices 外
- ST 仮説「272 置換」は **データ整合 + 攻略本** — populate @ 3C81A が UI 側 cap ゲートの正本候補
- 装填 **候補列そのもの** は mission pool 由来 — **シナリオ/ミッション在庫** が 272 を含むかが次のデータ RE

## 次の RE

1. ~~**273→272 実経路**~~ → [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)
2. ~~**mission pool `DS:0x270`**~~ → [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md)（DE4A / seg132 部分）
3. ~~packed 記述子 `cx` nibble @ 3D540~~ → [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)
4. `@ 0x771E` — 動的呼び出し or 別バイナリ（loadout 確定のみ？）

## 引き継ぎ

**全体索引**: [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)

## 関連

- [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)
- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)
- [PL_CBE_AMMO_UI_LOADLIST_RE.md](./PL_CBE_AMMO_UI_LOADLIST_RE.md)
