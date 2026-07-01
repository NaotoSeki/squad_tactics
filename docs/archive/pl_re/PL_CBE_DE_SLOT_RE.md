# CBE DE4A slot dispatch — DE85 / DE9A / DE5E RE

**生成**: 2026-06-01 — `python scripts/re_cbe_de_slot_deep.py`

## 結論：再配置チェーンと「ゴーストスタブ」の解決

静的解析時に見つかった `DE5E` (`0x04931E`), `DE85` (`0x049345`), `DE9A` (`0x04935A`) のスタブ命令列は、**実在する関数ではなく、NEフォーマットの再配置チェーンデータ（Relocation Chain Pointer）を逆アセンブルした結果生じた「ゴースト」**であることが確定しました。

### 再配置チェーンの構造

Segment 5 の末尾に定義されている内部参照再配置（Reloc 6: TargetSeg=5）は、`DE4A` 分岐ループ内の各 `lcall` 命令のセグメントセレクタ領域を単一の片方向リストとして繋いでいます。

```
再配置チェーン: 
0xEA02 -> ... -> 0xE0FC -> 0xDE4A -> 0xDE5E -> 0xDE85 -> 0xDE9A -> 0xDBD7 -> ... -> 0xFFFF
```

- `0xDE4A` は `lcall` @ `0x049307` のセグメントセレクタ領域（`0x04930A`）
- `0xDE5E` は `lcall` @ `0x04931B` のセグメントセレクタ領域（`0x04931E`）
- `0xDE85` は `lcall` @ `0x049342` のセグメントセレクタ領域（`0x049345`）
- `0xDE9A` は `lcall` @ `0x049357` のセグメントセレクタ領域（`0x04935A`）

ローダーはこのチェーンを走査し、すべてのプレースホルダーを実際の **Segment 5 の実効セレクタ** に書き換えます。

### 実際の実行フロー

したがって、分岐内のすべての `lcall` は、実行時には **同一の関数 `DBD7` 本体 (`0x04859A`)** を呼び出します。
それぞれの分岐は、`lcall` からリターンした直後の実行ストリーム（スタック調整やレジスタ設定）のみが異なります。

| 分岐 | コール命令 | 実効ターゲット | リターン先 (戻り位置) | リターン後の処理 |
|------|-----------|--------------|-------------------|----------------|
| **Slot 6** | `lcall 0xde5e, 0xd0da` | `DBD7` (`0x04859A`) | `0x04930C` | `add sp, 2` / `si = ax` |
| **Slot 5** | `lcall 0xde85, 0xd0da` | `DBD7` (`0x04859A`) | `0x049320` | `add sp, 2` / `dec ax` / `si = ax` |
| **Slot 3-4** | `lcall 0xde9a, 0xd0da` | `DBD7` (`0x04859A`) | `0x049347` | `add sp, 2` / `si = ax` / `dec si` |
| **Slot 1-2** | `lcall 0xdbd7, 0xd0da` | `DBD7` (`0x04859A`) | `0x04935C` | `add sp, 2` / `les bx, [bp-4]` / `cmp es:[bx+0xa], ax` |

### DE4A @ `0x0492AE` — シナリオ word1 の slot type (`si`) で分岐

`si = (scenario_word1 & 0xDFFF)` — [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md) 確定。

**分岐フラグ** `byte es:[0xAD25] & 8`:

| 条件 | `si` | 処理 | 実効着地 offset |
|------|------|------|-----------|
| flag **set** | ≥6 | `lcall DBD7` (Slot 6 経由) | `0x04930C` (si=ax) |
| flag **set** | 5 | `lcall DBD7` (Slot 5 経由) | `0x049320` (dec ax->si) |
| flag **set** | 0–4 | `ax=0xFFFF` reject | — |
| flag **clear** | 6 | `si=1` 固定 | — |
| flag **clear** | 5 | `jmp` Slot 6 経路 (`0x049305`) | — |
| flag **clear** | 3–4 | `lcall DBD7` (Slot 3-4 経由) | `0x049347` (si=ax-1) |
| flag **clear** | 1–2 | `lcall DBD7` (Slot 1-2 経由) | `0x04935C` (u16_5 gate) |

### 各分岐の戻り先コード詳細

#### Slot 6 戻り先 @ `0x04930C` (Slot >= 6)
```asm
04930C  add    sp, 2
04930F  mov    si, ax ; si=ax
049311  jmp    0x4936f ; merge
049313  nop    
```
- `push 2` 引数を `add sp,2` で捨てる
- `si = ax` とし、そのままマージへ移行

#### Slot 5 戻り先 @ `0x049320` (Slot == 5)
```asm
049320  add    sp, 2
049323  dec    ax
049324  jmp    0x4930f ; si=ax
049326  mov    ax, 0xffff ; term
```
- `push 2` 引数を `add sp,2` で捨てる
- **`dec ax`** して `si = ax` へ移行（数量調整）

#### Slot 3-4 戻り先 @ `0x049347` (Slot == 3, 4)
```asm
049347  add    sp, 2
04934A  mov    si, ax
04934C  dec    si
04934D  jmp    0x4936f ; merge
04934F  nop    
```
- `push 2` 引数を `add sp,2` で捨てる
- `si = ax` とし、さらに **`dec si`** してマージへ移行

#### Slot 1-2 戻り先 @ `0x04935C` (Slot == 1, 2)
```asm
04935C  add    sp, 2
04935F  les    bx, ptr [bp - 4]
049362  cmp    word ptr es:[bx + 0xa], ax
049366  jge    0x4936c
049368  xor    si, si
04936A  jmp    0x4936f ; merge
04936C  mov    si, 0xffff ; term
04936F  or     si, si ; merge
```
- `push 0x64` (100) 引数を `add sp,2` で捨てる
- `es:[bx + 0x0a]` （弾薬 u16_5）が `ax`（武器 u16_5 % 100）未満なら `si=0` (Pass) 、それ以上なら `si=0xFFFF` (Reject)

## ST 再現指針

```
slot = scenario_word1 & 0xDFFF
if es_ad25_bit3:
  if slot >= 6:
    si = dbd7_gate_mod2(weapon)  # weapon.u16_5 % 2
  elif slot == 5:
    si = dbd7_gate_mod2(weapon) - 1
  else:
    reject
else:
  if slot >= 6:
    si = 1
  elif slot == 5:
    si = dbd7_gate_mod2(weapon) # slot 6 と同じ経路
  elif slot >= 3:
    si = dbd7_gate_mod2(weapon) - 1
  elif slot >= 1:
    # weapon.u16_5 % 100 に基づき判定
    si = (ammo.u16_5 < weapon.u16_5 % 100) ? 0 : -1
merge: write pool row or FFFF
```

## 未完了

1. **`lcall D0F0` @ 0x04859D** — 被除数 `ax` の厳密ソース（武器 `ES:[si+?]` 取得ロジック）
2. **E02C 入力 ptr 同一性** (DOSBox)
3. **`lcall D0F0` (DBD7被除数)** の調査

## 関連

- [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md)
- [PL_CBE_DBD7_RE.md](./PL_CBE_DBD7_RE.md)
- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)
