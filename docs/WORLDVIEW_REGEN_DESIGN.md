# 世界観抽出・タイル再生成 設計書 — hex_tiles_v7 見劣り群の KB3D 品質化

- 版: v1.0 (2026-07-17)
- 設計: Fable5（監督官）。実装: GPT-5.6 Terra。検収: Fable5。
- 姉妹編: `docs/KB3D_FORGE_DESIGN.md`（KB3D パーツ分解・再構築 — 実装済み・検収合格）
- 調査データ: `scratch/kb3d_study/`（ps_spl_list.txt / s9_ps_palette_stats.py ほか）

## 0. 目的

hex_tiles_v7 の非 kbres タイル群（手続き生成の建物ほか）は KB3D 焼きタイル（kbres）に対して
決定的に見劣りする。**KB3D の造形品質**と **Panzer Strike（Sudden Strike クローン）の画づくり文法**の
両方を「世界観」として抽出し、見劣り群を再生成する。
アセットのピクセル流用はしない — 抽出するのは文法・色域・語彙のみ（ユーザー方針）。

## 1. 抽出済みの世界観（実測・確定）

### 1.1 見劣りの正体（棚卸し: 591 タイル中）
目視比較（bldg_s1_d0 / church_d0 vs kbres / KB3D）による品質ギャップの要因:
1. 窓が「テクスチャの黒穴」— 枠・格子・鎧戸・奥行きが無い（KB3D は開口+蓋パーツ）
2. 屋根が「柄を貼った箱」— 瓦1枚の造形・軒の出・破風・煙突が無い
3. 部材ディテール（梁・トリム・雨樋）と汚し（デカール・退色）が無い
4. 生活感の小物・植生語彙が欠落（tree は枯れ枝のみ）

対象ファミリー（優先順）:
| 優先 | ファミリー | 枚数 | 対応 |
|---|---|---|---|
| P1 | bldg_s1..s5 / church / factory / cpair | 126 | KB3D Forge 生成物で全面置換 |
| P2 | tree / veg | 16 | 欧州樹種の生木語彙を新設（§3.2） |
| P3 | （新設）compose ビネット | - | KB3D prop の組合せ済み生活セット |
| P4 | 全タイル | 591+ | 色調統一パス（§3.3、kbres 含む） |
| 対象外 | 道路・遷移（scar/grn）・塹壕・地面 | ~330 | 「縁で静まる」設計資産。色調パスのみ |

### 1.2 Panzer Strike の色彩ドクトリン（spl 296 個 = 75,480 色の統計）
spl フォーマット: `uint32 size(1020) + 255 × [B,G,R,A]` のパレット。ver_NN = パレットスワップ。
| カテゴリ | 色相 | 彩度(中央値) | 明度(中央値) |
|---|---|---|---|
| Trees/Plants/Grass | yellow〜yel-green ~70% | 0.46 | 0.36-0.42 |
| Buildings | **orange 44% + red 43%** | 0.38 | 0.45 |
| Lands（地面） | orange/red 土色 | 0.15 | **0.07（非常に暗い）** |
| 全体 | 暖色軸。青系ほぼ不在 | p25/50/75 = 0.26/0.39/0.51 | p25/50/75 = 0.19/0.36/0.53 |

→ **ドクトリン: 「暗い大地 × 中彩度の黄緑植生 × 一段明るい赤茶建物（視覚アンカー）」**。
ハイライトは v0.53 程度で抑える（白飛び禁止）。

### 1.3 Panzer Strike の構図・語彙文法（添付スクリーンショット+Objects 語彙）
1. **地面が主役**（画面の~70%）: 草地・土道・菜園の畝（fieldrows）・花パッチのバリエーションが世界の豊かさを作る
2. **有機的な道**: 直線でなく緩くうねり、道端は草に暈けて馴染む
3. **柵の文法**: 木柵が敷地・菜園を縁取る。壊れ・途切れが混ざる
4. **生活ビネット（Stands 語彙 47 個）**: `compose_001..008`（小物の組合せ済みセット、各2-4 バリアント）+ 洗濯物・薪の山・井戸・荷車・ベンチ・記念碑。**単品でなく「組み合わせ済みのビネット」を撒く**のが生活感の正体
5. **樹木が語彙の 1/3（114 spl）**: 実在欧州樹種 — picea-abies(トウヒ), larix-decidua(カラマツ), tilia-europaea(ボダイジュ), ulmus-minor(ニレ), quercus(オーク), salix-babylonica(シダレヤナギ), robinia, populus, **prunus-cerasifera(ベニバスモモ=ピンク花木アクセント)**。針葉+広葉ミックス、樹種ごとに a-f バリアント
6. **破壊は生活の上に薄く乗る**: 無傷→損傷→骨組み→瓦礫のグラデーションが村の中に混在。全部廃墟にしない
7. バリアント相場: 建物 1 種につき ver 1-4（パレットスワップ）+ 破壊段階

### 1.4 KB3D の品質要素（KB3D_FORGE_DESIGN.md §1.6 より）
部材単位モデリング / trim sheet PBR + displacement / 破壊3層（造形+デカール+瓦礫）/ 開口の蓋分離。

## 2. アーキテクチャ

```
[KB3D Forge] --recipes--> [HexBake] --PNG--> [Grade(色調統一)] --> hex_tiles_v8/
[TreeGen(樹種語彙)] -----> [HexBake] ----------^                    + catalog.json
[Vignette(compose)] -----> [HexBake] ----------^
```

- **HexBake** = HexKit リグ（scripts/hex_ruins/rig_setup.py の投影系: 仰角55°オルソ+pixel_aspect
  補正、hex R=9m pointy-top、288×384 現行規格）を **KB blend 内にその場構築**（rig_setup は
  非破壊・自己完結設計なので成立。ただし headless では `bpy.context.window.scene` 代入禁止）し、
  FORGE_OUT を STAGE にインスタンス化して 6 回転焼き。前例 = scripts/hex_ruins/tmp_kb3d_batch.py
  （kbres 30 枚の実績: look='High Contrast', samples 96, 環境光 0.58, sun 4.2/angle 5°）
- **Grade** = レンダー後 PNG への統一色調パス（§3.3）。**新規タイルも既存タイルも同一 LUT を通す**
  ことで「世界が揃う」— これが馴染ませの第一原理
- 出力は **hex_tiles_v8/**（v7 は温存。ゲーム側の切替は catalog 差し替えで行う）

## 3. コンポーネント設計

### 3.1 建物置換（P1）— forge→hex ブリッジ
- forge_grammar に「hex モード」を追加: 合成 footprint ≤ 21.5m の粗プレフィルタ
  （【2026-07-17 改訂】13m 厳格制約だと Residential 系=置換本命が全滅する実測。既存 kbres は
  13/footprint 縮小焼きの実績があり、288×384 タイル解像度ではテクセル劣化は視認不能 —
  よって**タイル焼きに限りスケール原則を緩和**し、hexbake がステージ時に実測 footprint から
  縮小率を決める: ≤13m は等倍、超過は 13/footprint、下限 0.6）、
  Ground/Floor は spawn しない（hex 側の地面と競合）、props/debris は密度高め
- 破壊段階を Sudden Strike 文法に合わせ 3 段作る: d0(無傷寄り=デカール少)、d1(損傷=破孔1-2+
  デカール中)、d2(半壊=破孔多+屋根欠け※)。同一 seed で openings/props を共有し
  destruction だけ変える（**同じ家が壊れていく**、が理想。v1 は「同一テンプレ・近縁レシピ」で可）
  ※屋根欠けカット（bbox 上部の斜めボックスカッター）は v1 で試み、破綻したら破孔+デカールのみに後退
- 旧 bldg_s1..s5 命名との互換: 新タイルは `kbldg_<template略称>_<seed>_d{0..2}_rot{0..300}` とし、
  ゲーム側 catalog で旧名→新名マップを提供
- 量産数の初期目標: 建物 8 レシピ × 3 損傷 × 6 回転 = 144 枚（church/factory/checkpoint 系を含む）

### 3.2 植生語彙（P2）— TreeGen
- 手段は実装フェーズで比較検証: (a) Blender Sapling アドオン（標準同梱、パラメトリック）
  (b) PolyHaven 樹木モデル DL（blendermcp ハンドラ実績あり）。**v1 は (a) を第一候補**
  （語彙をパラメータで制御でき、樹種リストの再現に向く）
- 語彙（PS 樹種リストの縮約、各 2-3 バリアント × 6 回転）:
  - 広葉樹大: tilia(丸冠), quercus(横張り), ulmus(楕円冠) — 村の中心木・並木
  - 広葉樹中: populus(細長), salix(枝垂れ・水辺)
  - 針葉樹: picea(円錐), larix(疎な円錐)
  - アクセント: **prunus_pink(ピンク花木)**, 果樹(小型丸冠)
  - 既存の枯れ木(tree_v0..)は「戦闘痕エリア用」として残す
- 葉はビルボード/パーティクルでなくメッシュ葉束（オルソ俯瞰で映えるボリューム重視)。
  PS 色統計に合わせ葉色は yellow-green（s~0.45, v~0.4）、彩度の暴れを抑える
- 出力: `tree_<species>_v<n>_rot<r>` + 大型は 2hex 跨ぎを検討（v1 は 1hex 内）

### 3.3 色調統一パス（P4）— Grade
- PIL による後処理 LUT。パラメータは PS 統計から:
  1. 白点圧縮: v > 0.85 を 0.85 へソフトニー（白飛び禁止）
  2. 全体明度を軽く下げる（γ 1.06-1.12、地面系はさらに -5%）
  3. 彩度の正規化: s を 0.9 倍 + 屋根赤〜橙域(H 0-40°)のみ 1.05 倍（アンカー温存）
  4. わずかな暖色シフト（WB +3% amber）
- 透過 PNG のアルファは不変。**パラメータは grade_config.json に置き、全タイル一括再適用可能に**
- 既存 v7 タイル（道路・地面・遷移含む）にも同一パスを適用して v8 へコピー —
  新旧の色世界を強制的に揃える
- 検収方法: compose_city.py（PIL 都市合成）で新旧混在マップを合成し、浮きの有無を目視

### 3.4 生活ビネット（P3）— Vignette
- KB3D prop から compose 式の組合せ済みセットを定義（rel 配置の JSON レシピ）:
  - vignette_woodpile: 薪相当（WoodPlanks/Crate）+ 樽 + 斧台代用 Crate
  - vignette_well: Well + バケツ代用 Barrel 小 + 石畳 StonePath
  - vignette_cart: Wagon/BrokenWagon + 木箱 + 樽
  - vignette_laundry: 洗濯物は KB3D に無い → FabricDirtA の布メッシュ+ロープで簡易モデリング
    （v1 で 1 回だけ試し、品質不足なら見送り。世界観上プラスだが必須ではない）
  - vignette_defense: SandBags + Barricade + AmmoBox（military 用）
- 出力: `vig_<name>_v<n>_rot<r>`（1hex の中央でなく**六角内のオフセット配置**で「余白のある点景」に）

## 4. 実装フェーズ（GPT-5.6 委譲単位 — 新方針: 太めに流す）

| フェーズ | 内容 | 成果物 |
|---|---|---|
| F1 | hex ブリッジ: forge_grammar --hex モード + hexbake_build.py（FORGE_OUT→HexKit 6回転焼き）+ 建物 144 枚 | scripts/kb3d_forge/hexbake_*.py, hex_tiles_v8/kbldg_* |
| F2 | Grade: grade.py + grade_config.json + v7 全タイルの v8 変換 | scripts/kb3d_forge/grade.py, hex_tiles_v8/* |
| F3 | TreeGen: treegen.py（Sapling ベース、樹種プリセット8種）+ 樹木タイル ~90 枚 | scripts/kb3d_forge/treegen.py, hex_tiles_v8/tree_* |
| F4 | Vignette: vignette_recipes.json + 焼き ~60 枚 | hex_tiles_v8/vig_* |
| F5 | catalog_v8.json + compose_city 検証合成 + 目視カタログ HTML | hex_tiles_v8/catalog.json, index.html |

- F1+F2 を最初の委譲ブロックにする（建物が最大の見劣り源。Grade は F1 の検収にも要る）
- 各フェーズの検収 = 実行 + サムネ/合成の目視（Fable5）+ §5 の機械検証

## 5. 検証ゲート

1. タイル規格: **288×384**（2026-07-13 に半減済みの現行規格。rig_setup.py の CFG が正）、
   hex アンカー位置、透過縁の AA（既存 v7 と同一規格）
2. 「縁で静まる」: タイル縁 1.5m 内に新規ジオメトリの突出がない（bbox チェック）
3. 色域: グレード後の各タイルの s/v ヒストグラムが PS 統計の p10-p90 帯に概ね収まる（自動レポート）
4. 目視: compose_city 合成で (a) 新旧タイルの色浮きなし (b) 添付スクショ比で「生活+戦争」の
   密度感に近づいたか — 最終判定はユーザー
5. 決定論: 同一 seed で同一タイル（Forge 由来の規律を継承）

## 6. 罠（本件固有の既知事項）

- HexKit リグ前提の各種教訓は `hex-ruins-pipeline` メモリと scripts/hex_ruins/ 参照
  （PolyHaven フラグ、tint はリニア、白飛び対策、view_layer.update、部材ごとブーリアン別パス）
- KB3D 側の罠は scripts/kb3d_forge/README.md §6（cp932 / テクスチャリマップ / EXACT 偶奇 /
  期待高度検証 / メッシュ共有 / subprocess UTF-8）
- スケール禁止原則（テクセル密度）— hex 13m 制約はテンプレ選別で解く
- Sapling アドオンは `--factory-startup` だと無効。有効化コード（addon_utils.enable）を焼きスクリプトに含める
- 本設計書のアセット出力先は hex_tiles_v8。**v7 に直接書かない**（ゲーム稼働中の資産）

## 7. 除外事項（スコープ外）

- Panzer Strike の ssc ピクセルデコード・流用（方針: 世界観のみ抽出）
- ゲームロジック側（logic_map.js 等）の v8 切替実装 — タイル完成後の別タスク
- 2hex 跨ぎ大型樹木・季節バリアント — v2
