# スプライト変更予定メモ

## ダミー画像（M1911A1 が使い回されている）

以下の item スプライトは `item_0001.png`（M1911A1）と **バイト完全一致**（SHA256 同一）であり、
ダミー／プレースホルダとして使い回されている。正しい画像に差し替える必要がある。

**検証方法**: 全 396 ファイルの SHA256 ハッシュを比較
**基準ハッシュ** (`item_0001.png`): `c8e5d2b0df574a98652af1dd0a08d36067c4dd09ed6655e5546d6ebd015bae76`

| # | スプライト | cbeNameIndex | CBE名 | 備考 |
|---|---|---|---|---|
| 1 | item_0000.png | — | （インデックス範囲外） | ヘッダ/未使用スロット。M1911A1 ダミー |
| 2 | item_0001.png | 0 | M1911A1 | **基準画像** — 本物の M1911A1（差し替え不要） |
| 3 | item_0029.png | 28 | E1R1 Fl | 米軍 E1R1 火炎放射器のはず |
| 4 | item_0030.png | 29 | M1A1 Fl | 米軍 M1A1 火炎放射器のはず |
| 5 | item_0031.png | 30 | M2A1-7 Fl | 米軍 M2A1-7 火炎放射器のはず |
| 6 | item_0109.png | 108 | FmW35 | 独軍 Flammenwerfer 35 のはず |
| 7 | item_0110.png | 109 | FmW40 | 独軍 Flammenwerfer 40 のはず |
| 8 | item_0111.png | 110 | FmW41 | 独軍 Flammenwerfer 41 のはず |
| 9 | item_0112.png | 111 | FmW42 | 独軍 Flammenwerfer 42 のはず |
| 10 | item_0183.png | 182 | No1 Mk1 | 英軍 No.1 Mk1 火炎放射器 (Ack Pack) のはず |

**合計**: item_0001.png 本体を除き **9 ファイル**がダミー画像

### 傾向

ダミー画像はすべて **火炎放射器**（Flamethrower）カテゴリに集中している。
原作ゲーム (Platoon Leader) で火炎放射器の画像が用意されなかったため、
M1911A1 の画像がプレースホルダとして流用されたと推測される。

- 米軍: E1R1 Fl / M1A1 Fl / M2A1-7 Fl（3 件）
- 独軍: FmW35 / FmW40 / FmW41 / FmW42（4 件）
- 英軍: No1 Mk1（1 件）
- 不明: item_0000.png（1 件 — インデックス範囲外）

## 略称名の正式名称（目視・調査で判明）

| index | CBE名 | item_NNNN.png | 正式名称 |
|---|---|---|---|
| 3 | OSS | item_0004.png | FP-45 Liberator（OSS単発ピストル） |
| 112 | Laf34 | item_0113.png | Lafette 34（MG34/42用三脚架） |
| 113 | Laf42 | item_0114.png | Lafette 42（MG42用改良三脚架） |
| 114 | Sch08 | item_0115.png | Schlitten 08（MG08用そり型架台） |
| 115 | PatrK41 | item_0116.png | Patronenkasten 41（弾薬箱） |
| 116 | PatrK15 | item_0117.png | Patronenkasten 15（弾薬箱） |
| 117 | Fernglas | item_0118.png | Fernglas（双眼鏡） |
| 119 | SaniTo34 | item_0120.png | Sanitätstornister 34（衛生兵トルニスター） |
| 120 | Mkt35 | item_0121.png | Meldekartentasche 35（M35報告書類ケース） |
| 164 | S&W No2 | item_0165.png | Smith & Wesson No.2（英軍回転式拳銃） |
| 165 | Very | item_0166.png | Very pistol（信号拳銃） |
| 187 | Note | item_0188.png | ノート（命令書/メモ帳） |

## 今後の対応

- [x] ダミー画像のインデックスを全件洗い出す（ハッシュ比較で item_0001.png と同一の画像を検出） — **完了 (9件)**
- [ ] 火炎放射器等の正しい画像が他にあるか確認
- [ ] ゲーム内で表示する際、ダミー画像の武器は非表示またはフォールバックアイコンにする
- [ ] item_0000.png の用途を確認（未使用スロットか、別用途か）
