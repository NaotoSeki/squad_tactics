# CBE 装填 UI マッチ関数 — `lcall 0x9858` / `0x9698`

**生成**: 2026-05-31 — `python scripts/re_cbe_lcall_fixup_resolve.py`

## fixup 結論

| 項目 | 結果 |
|------|------|
| seg2 @ 0x980D / 0x9857 の reloc | **なし** |
| lcall 生バイト | `9A 58 98 00 00` / `9A 98 96 00 00` |
| 推定 | ロード時 **CS=seg1** パッチ。オフセットは seg1 内 byte |

## 解決した関数

| lcall off | 呼び出し元 | 関数 (file) | 副入口 (lcall 着地) |
|-----------|-----------|-------------|---------------------|
| `0x9698` | `0x180B4` | **`ammo_ui_match_main` @ `0xA6EA`** | `0xA758` (+0x6E) |
| `0x9858` | `0x1804E` | **`ammo_ui_match_helper` @ `0xA908`** | `0xA918` (+0x10) |

> 副入口着地は手書き asm 慣行。同一関数内で BP 前提が合う。

## `ammo_ui_match_main` @ 0xA6EA — 核心ロジック

**mag_type / u27 / cap の cmp は見つかっていない。** UI 矩形・エントリ種別。

```c
// retf 8 — args: weapon_row, es, ctx
if (ctx[+0x83] & 0x80) { ... fast path via +0x21D4 table ... }

si = weapon_row + 0xD2;   // 8B リスト（+0xCE ではない）
loop entries:
  if (entry[0]==0 || entry[0]==3 || entry[4]==-1) skip;
  if (entry[0]==1 || entry[0]==0x14)   // 0x14=20=cat?
    id = ammo_ui_match_helper(ctx, weapon);  // call 0xA908
  else
    id = ammo_ui_match_helper_alt(...);      // call 0xA934
  // 選択 id → weapon[+0x21C2] テーブル → 8B 行
  // 座標比較: +0x219E, +0x21A0, +0x217C — UI レイアウト
  return ax!=0 on success;
```

### エントリ種別 cmp（確定）

```asm
0xA77D  cmp  es:[si], 0
0xA783  cmp  es:[si], 3
0xA799  cmp  es:[si], 1
0xA79F  cmp  es:[si], 0x14    ; 20 dec
```

## `ammo_ui_match_helper` @ 0xA908

```asm
0xA90F  mov  bx, es:[di+0x8E]
0xA914  mov  cx, es:[di+0x82]
0xA91E  test ah, 1
0xA923  xor  cx, 1
0xA92A  add  bx, 4
0xA92D  mov  ax, bx
0xA931  retf 8
```

→ ctx フラグ (+0x8E/+0x82) から **インデックス算出**。弾種 cap ではない。

## パイプライン全体（更新）

```
0x1805A  w21==0? → skip mag gate
0x1804E  walk weapon[+0xCE]+0x40 list
  └─ lcall ammo_ui_match_*  ← 今回
       ├─ entry type 1/0x14 vs other
       ├─ helper 0xA908 / 0xA934
       └─ UI rect compare (+0x219E…)
0x18BF3  別経路: loadout 確定時 mag_type 完全一致
```

**cap / 272 問題**: マッチ関数内に cap cmp 無し。
候補: (a) リスト構築 0xF7C8 段階 (b) entry type 0x14 分岐 (c) 別テーブル walk

## 次（順番 2）: `0xF7C8`

文字列 ID 0x4C4/4C6/4C7 → 8B link_index。272 の注入点。

## 関連

- [PL_CBE_AMMO_UI_LOADLIST_RE.md](./PL_CBE_AMMO_UI_LOADLIST_RE.md)
- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)

## 逆アセンブル — `ammo_ui_match_main`

```asm
0x00A771  jmp    0xa86d
0x00A774  lea    si, [bx + 0xd2] ; list@+D2
0x00A778  mov    bx, si
0x00A77A  mov    word ptr [bp - 2], es
0x00A77D  cmp    word ptr es:[si], 0
0x00A781  je     0xa7dc
0x00A783  cmp    word ptr es:[bx], 3
0x00A787  je     0xa7dc
0x00A789  cmp    word ptr es:[bx], 0
0x00A78D  je     0xa796
0x00A78F  cmp    word ptr es:[bx + 4], -1
0x00A794  je     0xa7dc
0x00A796  mov    es, word ptr [bp - 2]
0x00A799  cmp    word ptr es:[bx], 1
0x00A79D  je     0xa7ce
0x00A79F  cmp    word ptr es:[bx], 0x14
0x00A7A3  je     0xa7ce
0x00A7A5  mov    ax, word ptr es:[bx + 4]
0x00A7A9  mov    cx, ax
0x00A7AB  add    ax, ax
0x00A7AD  add    ax, cx
0x00A7AF  add    ax, ax
0x00A7B1  mov    si, word ptr es:[bx + 2]
0x00A7B5  shl    si, 2
0x00A7B8  mov    es, word ptr [0xa186]
0x00A7BC  les    si, ptr es:[si + 0x39c]
0x00A7C1  add    si, ax
0x00A7C3  mov    ax, word ptr es:[si]
0x00A7C6  mov    word ptr [bp - 6], ax
0x00A7C9  mov    si, word ptr [bp + 6]
0x00A7CC  jmp    0xa7ec
0x00A7CE  push   dword ptr [bp + 0xa]
0x00A7D2  push   dword ptr [bp + 6]
0x00A7D6  push   cs
0x00A7D7  call   0xa934 ; CALL
0x00A7DA  jmp    0xa7c6
0x00A7DC  mov    si, word ptr [bp + 6]
0x00A7DF  push   es
0x00A7E0  push   dword ptr [bp + 8]
0x00A7E4  push   si
0x00A7E5  push   cs
0x00A7E6  call   0xa908 ; CALL
0x00A7E9  mov    word ptr [bp - 6], ax
0x00A7EC  mov    es, word ptr [bp + 8]
0x00A7EF  les    bx, ptr es:[si + 0x21c2]
0x00A7F4  mov    di, ax
0x00A7F6  shl    di, 3
0x00A7F9  mov    ax, es
0x00A7FB  mov    es, word ptr [bp + 8]
0x00A7FE  mov    cx, es
0x00A800  mov    es, ax
0x00A802  lea    ax, [bx + di]
0x00A804  mov    word ptr [bp - 0x22], ax
0x00A807  mov    word ptr [bp - 0x20], es
0x00A80A  mov    es, cx
0x00A80C  mov    ax, word ptr es:[si + 0x219e]
0x00A811  les    bx, ptr [bp - 0x22]
0x00A814  sub    ax, word ptr es:[bx]
0x00A817  mov    word ptr [bp - 8], ax
0x00A81A  mov    es, cx
0x00A81C  mov    di, word ptr es:[si + 0x21a0]
0x00A821  mov    es, word ptr [bp - 0x20]
0x00A824  sub    di, word ptr es:[bx + 2]
0x00A828  mov    ax, word ptr es:[bx + 4]
0x00A82C  mov    word ptr [bp - 0xa], ax
0x00A82F  mov    ax, word ptr es:[bx + 6]
0x00A833  mov    word ptr [bp - 4], ax
0x00A836  les    bx, ptr [bp + 0xa]
0x00A839  test   byte ptr es:[bx + 0x81], 0x10
0x00A83F  je     0xa86d
0x00A841  push   es
0x00A842  push   bx
0x00A843  push   cx
0x00A844  push   si
0x00A845  lcall  0x9205, 0xab22 ; CALL
0x00A84A  mov    word ptr [bp - 2], ax
0x00A84D  mov    es, word ptr [bp + 8]
0x00A850  mov    ax, word ptr es:[si + 0x217c]
0x00A855  add    ax, word ptr [bp - 2]
0x00A858  cmp    ax, di
0x00A85A  jle    0xa86d
0x00A85C  mov    ds, word ptr [bp + 8]
0x00A85F  mov    ax, word ptr [si + 0x217c]
0x00A863  sub    ax, di
0x00A865  add    ax, word ptr [bp - 2]
0x00A868  add    word ptr [bp - 4], ax
0x00A86B  add    di, ax
0x00A86D  mov    ax, 0x94b9
0x00A870  mov    es, ax
0x00A872  test   byte ptr es:[0xad27], 0x40
0x00A878  je     0xa88e
0x00A87A  les    bx, ptr [bp + 0xa]
0x00A87D  mov    cx, word ptr es:[bx + 0x86]
0x00A882  add    cx, cx
0x00A884  mov    bx, word ptr es:[bx + 0x88]
0x00A889  add    bx, bx
0x00A88B  jmp    0xa89b
0x00A88D  nop    
0x00A88E  les    bx, ptr [bp + 0xa]
0x00A891  mov    cx, word ptr es:[bx + 0x86]
0x00A896  mov    bx, word ptr es:[bx + 0x88]
0x00A89B  sub    cx, word ptr [bp - 8]
0x00A89E  mov    word ptr [bp - 0x12], cx
0x00A8A1  sub    bx, di
0x00A8A3  mov    word ptr [bp - 0x10], bx
0x00A8A6  mov    ax, word ptr [bp - 0xa]
0x00A8A9  mov    word ptr [bp - 0x16], ax
0x00A8AC  mov    ax, word ptr [bp - 4]
0x00A8AF  mov    word ptr [bp - 0x14], ax
0x00A8B2  mov    eax, dword ptr [bp - 0x16]
0x00A8B6  mov    dx, word ptr [bp - 0x14]
0x00A8B9  mov    dword ptr [bp - 4], eax
0x00A8BD  mov    ax, cx
0x00A8BF  mov    word ptr [bp - 8], cx
0x00A8C2  mov    word ptr [bp - 6], bx
0x00A8C5  mov    word ptr [bp - 0x1e], cx
0x00A8C8  add    ax, word ptr [bp - 4]
0x00A8CB  mov    word ptr [bp - 0x1a], ax
0x00A8CE  mov    ax, bx
0x00A8D0  mov    word ptr [bp - 0x1c], bx
0x00A8D3  add    ax, dx
0x00A8D5  mov    word ptr [bp - 0x18], ax
0x00A8D8  mov    ax, 0
0x00A8DB  mov    cx, 0xffff
0x00A8DE  push   ds
0x00A8DF  mov    di, ax
0x00A8E1  lea    si, [bp - 0x1e]
0x00A8E4  mov    es, cx
0x00A8E6  push   ss
0x00A8E7  pop    ds
0x00A8E8  movsd  dword ptr es:[di], dword ptr [si]
0x00A8EA  movsd  dword ptr es:[di], dword ptr [si]
0x00A8EC  pop    ds
0x00A8ED  mov    dx, cx
0x00A8EF  push   ss
0x00A8F0  pop    ds
0x00A8F1  pop    si
0x00A8F2  pop    di
0x00A8F3  leave   ; CALL
0x00A8F4  retf   8 ; CALL
0x00A8F7  nop    
0x00A8F8  push   bp
0x00A8F9  mov    bp, sp
0x00A8FB  les    bx, ptr [bp + 0xa]
0x00A8FE  mov    ax, word ptr es:[bx + 0x8c]
0x00A903  leave   ; CALL
```
