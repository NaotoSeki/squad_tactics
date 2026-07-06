# CBE Segment 11 Dynamic Data Loader — scenario\*.dat ファイル読込 RE

**生成**: 2026-06-01

## 結論

実行時に武器カテゴリ（`0xCCA`）や三脚等の互換マスク（`0x24CA`）が参照される **`Segment 11` (空データセグメント: BSS)** は、ゲーム起動後にシナリオ選択等が行われたタイミングで、ディスク上のシナリオファイル等から動的にデータがロードされる領域であることが判明しました。

### データロード経路

```
[シナリオ選択 / ミッション読込]
       │
       ▼
Segment 4:0xDA1E (File: 0x03A71E)  ──(lcall)──▶ Segment 5:0x3888 (File: 0x03ED48)
                                                        │
                                                        ├─(rep stosd/w) 0xFFFFでバッファ初期化
                                                        ├─(lcall 0x3900:0xb5c4) シナリオファイル名生成
                                                        └─(lcall 0x3a2e:0xa438) ファイル読込 -> Seg 11へ格納
```

### 1. 呼び出し元: `Segment 4:0xDA1E` (File `0x03A71E`)
`Segment 4` の `0xDA0B` から始まるリロケーションチェーン（TargetSeg=11）により、スタックへ以下の FAR ポインタを引数として積みます。
- `push TargetSeg11:0x0011` (動的オフセット `ax` を伴う)
- `push TargetSeg11:0x0017` (オフセット `0x654A` を伴う)
- `push TargetSeg11:0x01E4` (オフセット `0x5D4A` を伴う)

これらは、`Segment 11` 内の 2048 バイトごとに確保されたデータバッファ領域を指しています。
- **バッファ1**: `Segment 11 : 0x554A` から 2048 バイト
- **バッファ2**: `Segment 11 : 0x5D4A` から 2048 バイト
- **バッファ3**: `Segment 11 : 0x654A` から 2048 バイト

### 2. データロード関数: `Segment 5:0x3888` (File `0x03ED48`)
スタックに積まれた `Segment 11` のバッファに対して、以下の処理を行います。

#### ① バッファのゼロ初期化 (0xFFFF埋め)
```asm
0x03ED7C  mov      ecx, 0x200
0x03ED82  mov      bx, word ptr [bp + 0xa]
0x03ED85  mov      dx, word ptr [bp + 0xc]
0x03ED88  mov      di, bx
0x03ED8A  mov      es, dx
0x03ED8C  rep stosd dword ptr es:[di], eax   ; 512 * 4 = 2048バイトを 0xFFFFFFFF で初期化
```
引数で渡された `Segment 11` のバッファを、ロード前に `0xFFFF` (-1) で完全に初期化します。

#### ② ファイル名の動的構築
`scenario\*.dat` (シナリオ/ミッションデータファイル) などのフォーマットを生成して、ローカルスタック上のバッファ `[bp - 0x20]` にファイル名を構築します。

#### ③ ファイルデータのロード
```asm
0x03EDB1  lea      ax, [bp - 0x20]
0x03EDB4  push     ss
0x03EDB5  push     ax                          ; ファイル名バッファ
0x03EDB6  push     dword ptr [bp + 0xa]        ; ロード先 (Segment 11:0x554A 等)
0x03EDBA  push     word ptr [bp - 0xa]
0x03EDBD  lcall    0x3a2e, 0xa438              ; ディスクからのファイルロード実行
```
構築したファイル名からデータを読み込み、`Segment 11` の初期化されたバッファ領域にデータを直接流し込みます。

## ST 再現指針

- `Squad Tactics` の実装において、`CBE.EXE` の静的バイナリデータ内に武器カテゴリフラグや互換テーブルが直接見つからなかったのは、これがディスク上のシナリオファイル等（`scenario\*.dat` など）から実行時に動的に読み込まれているためです。
- 武器カテゴリやオプション互換性を掌握するには、`CBE.EXE` 自体だけでなく、これらのシナリオファイル（データファイル）のバイナリ構造を解読する必要があります。

## 関連
- [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md)
- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)
