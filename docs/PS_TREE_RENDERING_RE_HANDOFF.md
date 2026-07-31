# Panzer Strike 木描画 完全再現 — RE進捗・引き継ぎ書

> 作成: 2026-07-23 / 監督官: Fable5 (Claude Code) / 並行レビュー依頼先: GPT-5.6(Terra)
> 目的: **Panzer Strike (PS) 実機の木/植生描画アルゴリズムを完全再現**し、自作ゲーム
> Squad Tactics (Phaser/WebGL1) で同等の「水彩画のような」樹木を出す。
> このドキュメントは GPT に判断を仰ぐための自己完結コンテキスト。数値・結論は全て
> 「実機の中から」実測で得たもの／未検証の仮定を明示的に区別している。

## 2026-07-30 HDアセット＋薄影V4 引継ぎ（Claude最優先）

> **この節が現在のライブ状態。** ユーザー承認済みの判断は
> 「V4薄影版を採用し、ゲーム実装はClaudeが行う」。Codexは画像アセット、マニフェスト、
> 検証、14マップのオフライン再描画まで完了した。ゲーム側JavaScriptは今回変更していない。

### 確定した採用仕様

- BODYは生成済みHD版を正本とする。影は正本影の複製ではない。
- 各アセットの**正本BODY→正本SHADOWの投影関係だけ**を校正し、その変換を生成BODYへ適用する。
- 建物・柵・小物は生成BODYの接地輪郭、低木は生成シルエット、樹木は生成した樹冠と幹を
  分離して投影する。
- 光源契約は `ps-overcast-upper-left-v1`、影方向はscreen lower-right。
- ユーザー判断により濃い影コアは不採用。alpha 52から圧縮し、最大alphaを76/255に制限する。
- 樹木BODYだけが幹根元pivotで微揺れする。影は静止し、同じ世界座標の根元を共有する。
- ブラウザ実行時に影を生成しない。V4薄影PNGをロードする。

### 反映済みの生産物

| 系統 | BODY | V4薄影 | 状態 |
| --- | ---: | ---: | --- |
| 地面 | 238 | — | HD地面マップへ反映済み |
| 建物・柵・低木・小物 | 287 | 252 | production-complete |
| 量産樹木 | 57 | 57 | production-complete |
| 承認済み樹木サンプル | 1 | 1 | V4薄影へ更新済み |

主要ファイル:

```text
asset/environment/raised_hd/manifest.json
asset/environment/trees_hd/production/manifest.json
asset/environment/trees_hd/production/runtime_ps_manifest.json
asset/environment/trees_hd/manifest.json
asset/environment/trees_hd/quercus-cerris_a_02_shadow_hd_v4_light.json
scripts/shadow_v4_pipeline.py
scripts/rebuild_raised_hd_shadows_v4.py
scripts/package_tree_hd_runtime.py
docs/RAISED_HD_FINALIZATION.md
```

旧影・旧メタデータの退避先:

```text
output/shadow_v4_light_backup_20260730/
```

### Claudeがゲーム側で行うこと

1. `asset/environment/raised_hd/manifest.json` を非樹木のHD BODY/SHADOW差替え元にする。
2. PSオブジェクト経路の樹木は
   `asset/environment/trees_hd/production/runtime_ps_manifest.json` を使う。
3. 植生レイヤ経路の樹木は `asset/environment/trees_hd/manifest.json` の`overrides`を使う。
4. 全manifest entryの`pixelRatio: 2`を尊重し、論理origin `ox/oy`は正本値のまま扱う。
   HD PNGだからoriginを2倍してmanifestへ書き戻してはいけない。
5. 描画順は地面→静止影→Y-sort BODY。樹木のsway tween対象へ影を含めない。
6. 旧V2影キャッシュが残る場合はテクスチャキー／ブラウザキャッシュを更新し、
   `shadowVersion: shadow-v4-paired-transform`、
   `darkCoreRemoved: true`、`maxAlpha: 76`を実データで確認する。
7. 実装後はSeed 3101を最初の目視ゲートにする。基準画像:
   `output/raised_hd_maps/ps_seed_3101_ground_raised_hd_x2.png`。

### 検証済み

```text
raised HD: 287 BODY / 252 shadow / 35 shadowless state
tree HD:   57 BODY / 57 shadow
runtime:   58 map-priority trees / 116 PS runtime sprites
14 maps:   4,248 HD draws / tree fallback 0
canonical shadow pixels copied: false
V4 light-only max alpha: 76
```

実行コマンド:

```powershell
python scripts/validate_raised_hd.py --sync-manifest --require-complete
python scripts/validate_raised_hd.py `
  --output-root asset/environment/trees_hd/production `
  --inventory asset/environment/trees_hd/tree_inventory.json `
  --sync-manifest --require-complete
python scripts/package_tree_hd_runtime.py
python scripts/build_raised_hd_map_review.py
python -m unittest tests.test_tree_hd_shadow `
  tests.test_tree_hd_runtime_package `
  tests.test_shadow_v4_light_production
node tests/ps_objects_raised_hd.test.js
node tests/terrain_rural_v29_pixel_ratio.test.js
```

対象テストは合格。全Python 123件では今回と無関係な
`test_review_round1_build.py`のKB3Dレビュー資産数（期待4・現状7）2件だけが既知失敗。

### 禁止事項

- 旧`raised_hd_pipeline.synthesize_shadow()`やV2影を本番へ戻さない。
- 正本影PNGを拡大・転写・再着色してHD影として使わない。
- alpha 76を超える濃い影コアを復活させない。
- BODYへ影を焼き込まない。BODYと影の独立レイヤ契約を維持する。
- Web/JSで毎フレーム影を生成しない。負荷と再現性の両面でPNG保持が正解。

## 2026-07-25 時点の旧ライブ状態（履歴）

> この章は2026-07-25時点の履歴。現在の作業状態は上の2026-07-30節を優先すること。

### 目的と到達点

目標は、PSの実アセット・実マップ・実行時状態から、次の三つを一つの系として再現すること。

1. **正本マップ再構成** — PSMの座標とSSCのスロット／原点に従い、PSの農村をそのまま描く。
2. **新規シードマップ** — 正本から測定した「家＋庭＋柵＋道＋植生」の局所配置文法を組み替え、
   ローグライク用の初期情景を作る。
3. **戦場キャンバス** — 戦闘中の轍、倒伏物、建物損傷、クレーター、残骸、死体を、同じキャンバスへ
   不可逆に積み上げる。

現時点で **1は主要な復元規則を実装済み、2はv2の実証生成済み、3はPSセーブ差分から状態モデルを
確定済み**。Squad Tactics本編への完全統合はまだ行わない。まず正本との画面照合と生成品質を詰める段階である。

### 最重要の確定事項

#### PSMは論理座標の配置台帳である

`demo_campaign_battle_01.psm`は256×256の論理マップであり、主要レコードは次の通り。

```text
MAP_DECORS    catalog:u8, asset:u16, x:u32, y:u32
MAP_OBJECTS   catalog:u8, asset:u16, x:u32, y:u32, extra:u32
MAP_BUILDINGS asset:u16, x:u32, y:u32, orientation:u32
```

投影は実測済み。

```text
screen_x = logical_x - logical_y + map_height * 40
screen_y = (logical_x + logical_y) / 2
sprite_left = screen_x + ssc.origin_x
sprite_top  = screen_y + ssc.origin_y
```

PNGの中心揃え、任意の拡縮、独自の色調補正は正本再構成では禁止。SSC由来のorigin、body slot、shadow slotを
そのまま使う。地表→独立影→screen Y順の立体物という順で描く。

#### 実行時の状態は既にスロット／マップブロックに現れる

- 通常オブジェクトは`MAP_OBJECTS.extra`の上位1 byteが実行時body slotを表す。
  保存データで値がない場合の標準はslot 2（立体本体）。
- 植生などは概ねslot 1=倒伏地表、slot 2=立体本体、slot 4=立体影。
- 建物は同一SSC内に無傷→損傷→破壊の状態列を持つ。`orientation/state`のbit 21..22から
  `damage_state = (raw >> 21) & 0x03`を得る。
- `village_fence_frontage`は完成画像1枚ではない。支柱と4方向の半柵を隣接セルに応じて接続する。

この規則で、PS実マップの北部・南部集落を実アセットだけで再描画できている。

### 実装済みの成果物

| 目的 | 成果物 | 状態 |
| --- | --- | --- |
| PSM読取・正本再描画 | `scripts/ps_extract/render_ps_native_crop.py` | 実装・検証済み |
| SSC slot可視化 | `scripts/ps_extract/ssc_slot_atlas.py` | 実装済み |
| 正本配置から局所クラスタ抽出 | `scripts/ps_extract/extract_ps_placement_grammar.py` | 実装済み |
| 新規シード生成 | `scripts/gen_ps_seed_map.py` | 実装・検証済み(v2の5クラスタ方式は廃止・削除) |
| 戦闘前後PSM差分 | `scripts/ps_extract/compare_psm_battle_state.py` | 実装・検証済み |
| 正本再描画の比較ページ | `ps_native_isometric_compare.html` | 作成済み |
| 戦場状態差分の比較ページ | `ps_battlefield_state_diff.html` | 作成済み |
| 本編マップ生成(正本クロップ) | `scripts/build_ps_battlefield.py` | 実装・検証済み |
| 本編の木アセット生成 | `scripts/build_trees_ps_canonical.py` | 実装・検証済み |

正本アセットのルートは以下。

```text
scratch/ps_sprites_canonical_v1/                 # SSCスロット由来PNG
scratch/ps_sprites_canonical_v1/canonical_manifest.json
scratch/ps_sprites_v2/catalog.json               # 既存カタログの補助参照
scratch/ps_placement_grammar/ps_demo_building_clusters_v1.json
```

### 戦場キャンバスの直接証拠

正規マップ`demo_campaign_battle_01.psm`と戦闘途中セーブ
`e0001784766970313[demo_campaign_battle_01].psm`を比較済み。

- `MAP_DECORS`: 32,880 → 34,928（+2,048）
- `MAP_OBJECTS`: 56,499 → 53,686（-2,813）
- `MAP_BUILDINGS`: 186 → 186（位置は維持）
- 2,048件は、同座標の`MAP_OBJECTS`から`MAP_DECORS`への一対一移行。
  小麦、低木、花、柵、小物が倒伏／破壊後に地表記録となる。
- 建物は23件が損傷1、4件が損傷2へ進行。
- `tracks_tank` 62種と`crater_gun` 9種がセーブで追加される。

従ってSquad Tacticsの上位原則は「戦闘前画像／戦闘後画像の切替」ではない。
平和な初期マップの上に、イベント結果を決定的な永続状態として追記する
**巨大な戦場キャンバス**である。詳細な状態設計は
[`PS_BATTLEFIELD_STATE_MODEL.md`](PS_BATTLEFIELD_STATE_MODEL.md)を参照。

### 新規シード生成（2026-07-25 全面置換。以下のv2記述は履歴）

> **v2（クラスタ5個移植）は廃止した。** 後継は `scripts/gen_ps_seed_map.py`。
> 廃止理由: contentがクラスタ5個分に固定されるため、キャンバスを盤面サイズ(620x620)へ
> 広げると73%が地色のまま残った。さらに、盤としての妥当性（連結性・スポーン地帯・
> 道の連続）を一切保証していなかった。
>
> 後継はフローを反転する。**先に30hexの盤面計画を立て（ゲーム契約を構成的に保証）、
> 絵をその計画に従わせる**。実測クラスタは地図そのものではなく「建物の周り」を供給する
> 部品ライブラリとして使い、建物をどこへ置くかは計画が決める（1 BLDG hex = 1 建物）。
> 実測値: 地色露出 73% → 0.00%、盤面は単一連結。
> `render_ps_seed_map.py` と評価UI `ps_cluster_seed_blind_review.html` は削除済み
> （コミット72082e1に保全）。

以下は廃止したv2の記述。`render_ps_seed_map.py`は、実マップの建物中心クラスタを5個選び、
教会・家・農場・補助要素を新しい論理座標へ移植する。個別小物を一様乱数で撒く方式ではない。

- コア: 各建物の半径180論理単位。最も近い隣接建物だけを保持。
- 地表: 半径360までの`terrain`/`grass`/`ground_feature`/`ground_spot`を使う。
  5つの移植先へのVoronoi所有判定で重複を防ぎ、実測の地表散布を継ぐ。
- 建物: アンカーは保護し、移植された隣接建物だけを画面距離82未満で除外。
- 描画: 正本SSC、補間なし、無傷建物、柵の半接続を使う。

出力済みシードと地表基調色が残った画素率:

| seed | 配置数 | 基調色率 | 備考 |
| ---: | ---: | ---: | --- |
| 20260724 | 516 | 4.75% | 角部に少量残る |
| 20260725 | 682 | 1.89% | 現在の代表例 |
| 20260726 | 619 | 0.73% | 建物近接の検査が次課題 |

画像・台帳:

```text
scratch/ps_seed_maps/ps_cluster_seed_20260724_r180_g360_v2_native.png
scratch/ps_seed_maps/ps_cluster_seed_20260725_r180_g360_v2_native.png
scratch/ps_seed_maps/ps_cluster_seed_20260726_r180_g360_v2_native.png
scratch/ps_seed_maps/*_v2_ledger.json
```

### 重要: 評価ページの画像は「実機スクリーンショット」ではない

これは次担当が最も誤解しやすい点である。

`ps_cluster_seed_blind_review.html`の5枚は**すべて我々の復元レンダー**である。

- Scene 1 / 3: PS実マップの配置をそのまま用いた「実配置の正の対照」。
- Scene 2 / 4 / 5: その実配置クラスタを新規に組み替えたシード。

このページで測れるのは、同一のアセット／描画器を前提とする**配置文法の自然さ**であって、
PS実機の最終ピクセルへの忠実度ではない。以前の表示「PS正本」は誤解を招いたため、
v2では「PS実マップ配置の復元レンダー」と明記した。

実機画面との忠実度比較は、Steam JPEGを別系統のground truthとして行うこと。

```text
C:\Program Files (x86)\Steam\userdata\85655539\760\remote\4787810\screenshots\
scratch/psreal_20260722194348_1.jpg  # 木単体の観察に特に有用
```

評価UIはv2で入力時に自動保存する。旧v1は「この評価を保存」を押したシーンだけを書き出していたため、
`C:\Users\aware.梨花のPC\Downloads\ps_cluster_seed_review.json`が空の`reviews`になった。
これはユーザー操作の問題ではなくUIの欠陥だった。v2は書出し直前にも現在の入力を保存する。

### 未解決: 塩コショウ状に見える植生

ユーザーがScene 1〜5すべてに、細かい高コントラストの「塩コショウの木」を観察した。
共通の復元レンダーに出るため、**新規クラスタ生成だけの問題ではない**。

- `shrub_carpinus-betulus_b_01..03`は単体で細粒・高コントラストに見えやすい。
- 新規シードv2では、隔離配置時だけ実PSの低コントラスト低木
  `shrub_syringa-vulgaris_a_01/b_02`へ置換する品質ゲートを入れた。
- これは生成品質を守る一時措置であり、PSの本来の描画を解明したことにはならない。
- Steam実機JPEGを見直すと、細粒の葉表現はあっても復元画ほど一様に強くは目立たない。
  同一オブジェクト・同一カメラでの完全一致比較はまだないため、原因は未確定。

**禁止事項:** この問題をGaussian blur、生成AIのインペイント、勝手なLANCZOS縮小で隠さない。
ユーザーは「本家の中に答えがある」方針を明示している。SSC slot、palette、coverage、実機の最終合成、
表示スケールを正本画面との同地点比較で切り分けること。

### 次に行う順序

1. **実機画面との同地点比較を作る。** Steam JPEGの地物・道路・家を手掛かりに、同じPSM座標・
   カメラ範囲を復元して並べる。配置評価ページと混ぜない。
2. **塩コショウ植生を原因別に検証する。** 同一資産のslot/palette/alphaと画面表示倍率を比較し、
   復元器の誤りか、正本アセットの局所的表現か、実行時合成差かを確定する。
3. **シードの構図制約を強化する。** 建物footprint衝突・道路連続・畑境界を、アンカー間距離ではなく
   実スプライトの占有範囲で評価する。seed 20260726の教会周辺は建物近接の改善対象。
4. **評価の還流。** `*_review.json`の数値／タグを台帳化し、置換・衝突・地表密度の重みを更新する。
5. **本編統合はその後。** PSの連続キャンバスを視覚層、Platoon Leader由来のヘックス・指揮・
   士気・射線を不可視の戦術層として分離し、操作時だけヘックスをオーバーレイする。
   物理的な六角タイル絵をPS農村へ焼き込まない。

### 作業上の注意

- ワークツリーには、PS以外のユーザー作業・未コミット変更が多数ある。無関係な変更をリセット、
  削除、整形しない。
- PS本体は現在通常起動へ戻っている。過去に追加したapitrace起動オプションは解除済み。
- D3D9キャプチャ／GPUサンプラ解析は未完だが、今すぐの最優先ではない。まず上記の
  **実機画面対復元画の位置合わせ**で、何をキャプチャする必要があるかを狭める。

---

## 0. GPTに一番聞きたいこと（結論を先に）

1. **GPUフレームキャプチャに進むのが妥当か？** 静的解析はCPUコーデックまでで行き止まり。
   「275pxのスプライトが画面上~430pxかつ滑らか」を成立させる機構は D3D9サンプラの
   mipmap/LODバイアス状態にあり、それは動作中のGPUフレームにしか無い、という判断。
   ただし **RenderDocはD3D9非対応**（重要: 過去メモの「RenderDocブロック」の真因はこれの
   可能性）。D3D9キャプチャの現実的な手段（apitrace / d3d9プロキシDLL / Intel GPA /
   旧PIX）のうち何が筋が良いか、あるいは別ルートか。
2. **そもそも「拡大でディザは溶けない→GPU mipmapが唯一の平滑化機構」という私の推論に
   穴はないか？** 反例（拡大でも滑らかにできる機構）を見落としていないか検証してほしい。
3. **代替の "エンジン内mipmap再現"（RenderTextureにネイティブ解像度で描き mipmap生成→
   trilinear提示）で十分実機同等になるなら、GPUキャプチャを省略できるのでは？** という
   選択肢の妥当性。

---

## 1. リファレンス資料（GPTが参照すべき現物）

### 実機スクリーンショット（Ground Truth・最重要）
- `scratch/psreal_20260722190247_1.jpg` (1920x1200) — 村・畑・木々
- `scratch/psreal_20260722190300_1.jpg` — 同上別アングル
- `scratch/psreal_20260722191049_1.jpg` — 村
- `scratch/psreal_20260722194348_1.jpg` — **開けた草地に孤立した松＋柳。木単体の質感判定に最良**
- `scratch/psreal_thumbs.jpg` — 上記4枚のサムネ一覧
- Steam userdata由来: `C:\Program Files (x86)\Steam\userdata\85655539\760\remote\4787810\screenshots\`

### 解析用クロップ
- `scratch/crop_pines_right.png` — 実機の松2本（画面上~430px）
- `scratch/real_vs_our_pixel.png` — **決定的**: 実機canopy/trunkを6x等倍 vs 我々のスプライト6x等倍。
  実機は1pxディザ皆無・連続階調、我々は1px市松ディザ。これが問題の本質を一枚で示す。

### PS本体（インストール先）
- ルート: `C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\`
- **描画設定**: `PanzerStrike.sdt`（全文を §3 に転記）
- 木テンプレ: `Data/Game/Common/Configs/Templates/Objects/trees.sdt`
  （= `visual + palette + hit:tree` のみ。描画属性ゼロ＝全部エンジン任せ）
- 木ソース: `Data/Game/Common/Media/Objects/Trees/*.ssc`（スプライト）+ `*.spl`（パレット）
- **ドライバDLL**: `Drivers/Driver.Direct3D9.dll`（64bit・ソフトレンダラ→D3D9出力。ctypesで呼べる）

### 我々のプロジェクト側
- `phaser_vegetation_layer.js` — 植生散布・描画（FOREST hexに木をlive配置）
- `phaser_scene_composition.js` — `window.SceneComposition`。postFX(gamma/luma-sharpen)＋premult blend
- `phaser_bridge.js:131` — Phaser config（`render:{mipmapFilter:'LINEAR_MIPMAP_LINEAR'}`追加済み）
- 抽出パイプ: `scripts/ps_extract/extract_trees_v3.py`（差分blit抽出・後述）
  → **廃止**。後継は `scripts/build_trees_ps_canonical.py`（正本スロット抽出が入力）
- メモリ（正本の知見）: `~/.claude/projects/C--Projects-squad-tactics/memory/ps-render-pipeline.md`

---

## 2. これまでの思考の流れ（時系列・何を試して何が分かったか）

### フェーズA: 「ディザノイズ」の犯人探し（数日にわたり迷走）
1. 当初仮説「NPOTテクスチャの縮小エイリアシング」→ 木を長辺160pxにLANCZOS事前縮小。
   **オーナー却下**: 「苔ブロブ・ディテール喪失」。→ **リグレッションと判明、撤回**。
2. 「拡大bilinearがディザを溶かす」仮説 → Pythonシミュで棄却（後述の決定的実測）。
3. premultiplied-over合成の誤り修正（unpremultiply_trees.py）→ **これも対症療法と判明、撤回**。

### フェーズB: 決定的な実測（ここから確度が上がる）
4. **差分blit法**で真のカバレッジ/色を抽出（§4）。v2抽出のαが壊れていたのは事実だが、
   ディザ自体は残る。
5. **ディザはドライバのCPUコーデック出力そのものに実在**することを確認（§4-C）。
   黒地/白地/灰地にblitしてもディザが出る＝私の除算アーティファクトではない。
6. **拡大では絶対に溶けないことを実測**（§4-D）: bilinear 1.5x/2.5x ともディザ残存。
   → 前回「水彩に見えた」比較画像は、シート整形時のLANCZOS縮小が偶然溶かしていただけの
   **私の誤認**だった。
7. **実機スクショを6x等倍で凝視**（`real_vs_our_pixel.png`）: 実機は1pxディザ皆無・連続階調・
   やや柔らかい。我々は1px市松。→ **実機は明確に平滑化を通している**。

### フェーズC: 設定ファイルの現物確認
8. `PanzerStrike.sdt` を実際に読む（§3）: `scale game:100`, `colors{gamma:100, sharpness:100}`。
   **スーパーサンプル・AA・mipmapのトグルは存在しない**。
   → 平滑化は `device:hardware / direct3d9` のGPUハードウェア・テクスチャフィルタに内在。

### フェーズD: オーナー矯正（重要）
9. 私がPython gaussianデディザ(σ0.7)を実装 → **オーナー強く却下**:
   「自前pythonで近づけるな。実機のやり方を完全再現せよ。本家の中に答えはある」。
   → デディザ撤回・スプライトは生ディザに戻した・sharpenも0.55に戻した（現状）。

---

## 3. PanzerStrike.sdt（描画設定・全文転記）

```
display
[
	device: hardware
	driver: direct3d9
	monitor: 0
	fullscreen: True
	vsync: True
	window: 800, 600
	scale
	[
		game: 100
		gui: 75
	]
	colors
	[
		brightness: 0
		contrast: 0
		gamma: 100
		sharpness: 100
	]
]
core [ updates_per_second: 30 ... ]
```

解釈: game scale 100%（1:1）、gamma/sharpness=100（スライダ値、後処理シェーダのパラメータ）。
**明示的な超解像・mipmap・AA設定は無い。**

---

## 4. 確定した技術事実（実測ベース・数値付き）

### A. スプライトフォーマット（.ssc）
- fmt723, depth:8。スロット構成: slot2=body, slot4=shadow(fmt934), 他は空。
- 各画素 = `[coverage(α), color_index]` の2バイト。行=RLE。8bppパレット参照。
- 例: `quercus-cerris_a_02`: body 181x208 origin(-92,-204) / shadow 192x107 origin(-73,-22)
- 例: `pinus-jeffreyi_b_01`: body 120x275 origin(-63,-272) / shadow 134x91
- **大型未使用スプライトあり**: `quercus-cerris_t_01`(247x236), `pinus-jeffreyi`系(275-290px)

### B. ドライバのブリッタ合成式（逆アセンブル＋差分blitで確定）
- コーデック `PixelBufferSpriteDraw8Bpp`（export RVA 0x2710）。
- 合成: `out = palette[idx]*cov相当 + dst*(1-cov)` の premultiplied-over。
- **差分blit法**（黒地/白地の2回blitで真値逆算）で検証:
  `pinus-jeffreyi_b_01` body: touched=12810px, **cov中央値=0.941**（樹冠はほぼ不透明）,
  channel-inconsistent=833px（cov>1のsuper-premultハイライト＝加算成分の存在）。

### C. ★ディザは実機コーデック出力に実在（除算アーティファクトではない）
- `quercus-cerris_a_02` を黒地/白地/**灰地(0x787e58)** にblit（灰地＝除算不要の実表示画素）:
  - over-grey canopy hi-freq mean|Δx| = **44.63**
  - premult(over-black) canopy hi-freq = **42.01**
  - → 除算しない灰地blitでも高周波ディザが同等に存在＝**ソースアート自体が1px市松ディザ**。
- 視覚確認: `scratch/codec_raw_zoom.png`（canopy/trunkを6x NEAREST）で市松が明白。
  magentaの孤立画素も散見（パレットの特定index）。

### D. ★拡大ではディザは溶けない（実測）
- `quercus-cerris_a_02` を PIL bilinear で拡大:
  - 1.5x BILINEAR → ディザ残存（`scratch/melt_test.png` 左）
  - 2.5x BILINEAR → ディザ残存
  - 1.5x + gaussian0.8 → 溶ける
  - 0.5x downsample→3x up → 溶ける（ローパス経由のみ）
- 結論: **1px市松を溶かすには「2px以上のsource支持を持つローパス（縮小平均/ぼかし/mipmap）」が
  数学的に必須。拡大（bilinear magnification）は原理的に不可能。**

### E. ★実機は平滑・我々は生ディザ（6x等倍直接比較）
- `scratch/real_vs_our_pixel.png`: 実機canopy=連続階調でやや柔らか、実機trunk=滑らかな単色塊。
  我々のスプライト=canopy/trunkとも1px市松。オーナーの「幹と枝葉が同じ質感」指摘の正体。

### F. スケール関係（未確定・要検証）
- 実機松スクショ ≈ 画面上430px。ソースspriteネイティブ ≈ 275px。→ **画面上は約1.56x拡大**。
- **矛盾**: 拡大なのに滑らか。§4-Dより拡大では溶けないはず。
  → この矛盾を解く唯一の機構が「mipmap付きテクスチャをLODバイアス付きでサンプル」or
  「内部高解像度バッファ→縮小提示」。**どちらもGPUサンプラ状態＝キャプチャ必須。**

---

## 5. 現在のパイプライン実装状態

### v3抽出・ビルド（実装済み・動作確認済み）
- `scripts/ps_extract/extract_trees_v3.py`: **差分blit抽出**。全114 ssc→228フレーム(body+shadow)、
  エラー0。出力 `scratch/ps_trees_v3/*.png` + `catalog_v3.json`(origin/cov記録)。
  真の straight色 + 真の coverage α。
- `scripts/build_trees_ps_canonical.py`（旧 build_trees_ps_v3.py は削除）:
  h>=110の木を選択、蛍光種(podocarpus/sciadopitys/heteromeles)除外、
  **POTキャンバスへ中央pad**（WebGL1 mipmap要件）、**アンカーorigin分率**をmanifestに記録。
  出力 `asset/environment/trees_ps/`（**81種**: conifer40/broadleaf41）。
  ※ **デディザ工程は撤去済み**（生ディザ・オーナー指示）。

### エンジン側（実装済み）
- `phaser_vegetation_layer.js`:
  - native 1:1スケール(0.9-1.15、PS流。旧: 高さ正規化は廃止)
  - `setOrigin(tree.ox, tree.oy)` / 影も真origin・α加工なし(真の~0.5内蔵)
  - 散布: 2本/hex, min_spacing 0.85hex
- `phaser_bridge.js:131`: `render:{mipmapFilter:'LINEAR_MIPMAP_LINEAR'}`
- `phaser_scene_composition.js`: postFX(gamma/luma-sharpen sharp=0.55) + premult blend。
  GL実測でtree textureのMIN=LINEAR_MIPMAP_LINEAR(9987), MAG=LINEAR(9729)を確認済み。

### ★現状の描画結果（未解決）
- 木は依然ノイズ（生ディザ）。**mipmapは生成されているが、木を拡大描画しているためmip0が
  表示され、ディザが溶けない**（§4-F矛盾の実地確認）。
- 現在 git 上、`asset/environment/trees_ps/` は v3で大量に変更/追加/削除された未コミット状態。
  未使用の旧v2アセット削除＋v3新規81種＋影。**まだコミットしていない。**

---

## 6. 廃止した誤ったアプローチ（二度とやらない）
1. LANCZOS事前縮小(160px) — ディテール喪失・オーナー却下
2. unpremultiply_trees.py — v2の壊れたαへの対症療法（削除済み）
3. Python gaussianデディザ(σ0.7) — 「実機の機構ではない近似」・オーナー却下・撤去済み
4. pot_pad_trees.py — ビルダーに統合され不要（削除済み）
5. **差分blit抽出(extract_trees_v3)を本編アセットに使うこと** — straight色=S/covの除算が
   低カバレッジ画素のノイズを増幅し、1px市松を焼き付ける。オーナー指摘「塩コショウ」の実体。
   実測(全81種の樹冠hi-freq平均): 差分blit 42.37 → 正本スロット抽出 17.75。
   本編アセットは必ず `scratch/ps_sprites_canonical_v1` から作る。

---

## 7. 未検証の仮定・可能性で進んでいる箇所（正直に）
- **[仮定]** 平滑化がGPU mipmap/LODバイアスであること。→ 状況証拠（設定にAA無し・device:hardware・
  拡大では溶けない）からの**推論であり、GPUキャプチャで未確認**。
- **[仮定]** 実機がスプライトを個別GPUテクスチャとして描く（vs ソフトバッファ全体を1テクスチャで提示）。
  データフローが未確定。前者ならmipmap melt成立、後者だと別機構。**キャプチャで判別可能。**
- **[未確定]** 内部レンダ解像度→提示アップスケールの有無（§4-F）。
- **[未確定]** 実機のカメラズーム（スクショが標準ズームか拡大か）。430pxの絶対値の解釈に影響。
- **[未着手]** ドライバのGPUテクスチャ経路(DeviceCreateTexture/DrawStreamTextureRegion)を
  ctypesで駆動して実機サンプラのフィルタ済み画素を読む案（オーナー選択肢②、今回は未選択）。

## 8. RE完了/未完のマップ
| 項目 | 状態 |
|---|---|
| .ssc/.splフォーマット | ✅ 完了 |
| CPUコーデック合成式(premult-over) | ✅ 完了(disasm+差分blit) |
| 真のcoverage/color抽出(差分blit) | ✅ 完了・全114種 |
| ディザがソース実在の確認 | ✅ 完了 |
| 拡大で溶けない証明 | ✅ 完了 |
| 描画設定(sdt) | ✅ 完了(現物確認) |
| postFXシェーダ(gamma/luma-sharpen) | ✅ 完了(ps_3_0 disasm)・ただし平滑化ではなくsharpen |
| **GPUサンプラ状態(mipmap/LOD/内部解像度)** | ❌ **未着手＝今回の焦点** |
| データフロー(個別tex vs 全体バッファ) | ❌ 未確定 |

---

## 9. 環境（キャプチャ手段の現状）
- GPU: AMD Radeon (TM) Graphics
- **RenderDoc**: `C:\Program Files\RenderDoc\` にインストール済み。
  ただし **RenderDocはD3D9を非対応**（D3D11/12/GL/Vulkanのみ）。過去メモの「ブロック」の真因は
  これの可能性が高い。
- apitrace / Intel GPA / 旧Microsoft PIX(D3D9対応): **未確認（インストール無し）**。
- D3D9プロキシDLL方式（system d3d9.dll を wrapperで差し替えCall dump）: 未着手だが有力候補。
- 注意: ツールのダウンロード/実行はオーナー承認が必要（安全規則）。

---

## 10. 提案する次の一手（GPTの判断待ち）
- **本命**: D3D9対応キャプチャで実機1フレームを捕捉し、木スプライトの
  (a)テクスチャ寸法とmip有無 (b)サンプラ状態(MIN/MAG/MIP filter, LODバイアス, max anisotropy)
  (c)描画時のスケール を直接読む。手段は apitrace(d3dretrace) か d3d9プロキシが現実的。
- **対抗**: GPUキャプチャを省き、「エンジン内でGPU mipmapに溶かさせる」再現
  （植生をRenderTextureにネイティブ解像度で描く→mipmap生成→trilinear提示）。
  これが実機同等なら工数小。ただし「実機のサンプラ状態を知らずに作る」ため、オーナーの
  「完全再現」要求を満たすかは、まず(a)で答え合わせしてからが筋、というのが現時点の私の見解。
```
