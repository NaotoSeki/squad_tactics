# HANDOFF — ChatGPT(GPT-5.6/Codex)への引継ぎ文書: WW2戦場マップ生成の作り直し

- 日付: 2026-07-17
- 発行: Fable5（監督官）。宛先: ChatGPT/Codex実行レーン（1週間分のリソースを本日投入する前提）
- 本書が現時点の正本。旧設計書（KB3D_FORGE_DESIGN.md / WORLDVIEW_REGEN_DESIGN.md）は
  技術資産の参照用であり、§1の審美基準と矛盾する箇所はすべて本書が上書きする。

---

## 1. ミッションと審美基準（最上位。全タスクはここに従属する）

目標: **Panzer Strike / Sudden Strike の「自然で細やかな戦場マップ」を hex グリッド上に再現する。**
参照画像: `C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo` の実ゲーム画面
（農村・菜園の畝・有機的な土道・柵・生活痕・破壊が混在する、縮尺の揃った世界）。

ユーザー（プロジェクトオーナー）による確定審美基準:

1. **縮尺の統一が絶対**。全オブジェクトは同一縮尺で共存する。タイルに収めるための縮小は禁止。
2. **「1ヘックス=1オブジェクト群」の発想は悪手**（おもちゃになる）。ヘックスは論理グリッドで
   あって展示ケースではない。軍営地(camp)のような構成は 6〜7 ヘックスに自然に広がるべきで、
   オブジェクトはヘックス境界を跨いで流れてよい。
3. **崩壊の美学は人間の審美眼が最も見る場所**。丸穴・四角穴のブーリアン破壊は幼稚で不可。
   崩壊は構造的に（壁が層で崩れ、梁が折れて残り、瓦礫が裾に流れる）。
   回転バリエーション(6方位)より**崩壊段階バリエーション(3〜5段階)**に価値がある。
4. **道は有機的に流れる**。ヘックスタイルの幾何を意識させる道は不可。クレーターは真円不可、
   「元の道が崩壊した」文脈が要る。
5. **畝(fieldrows)は畝に見えること**。線を引いただけの表現は不可（現行v7は「ひっかき傷」）。
6. 全体として「細やかなマップ」であること。解像度の低さを言い訳にしない
   （Panzer Strike は低解像度でも細やかさを達成している — 密度と文脈の設計の問題）。
7. **Semantic mismatch is a challenge, not an automatic rejection.** A towered or fortress-like complex may be used
   in rural terrain when the combination is made spatially convincing through ground contact, approach roads,
   transition vegetation, shared weathering/material grade, scale cues, and narrative props. Such an asset should be
   retained as a challenge candidate and judged on the quality of its terrain interface; do not discard it merely
   because its nominal category differs from the surrounding terrain.

**方針転換（ユーザー明示指示）**: Panzer Strike の **ssc ピクセルデコード・流用を解禁**。
従来の「世界観のみ抽出」制約は撤廃された。実スプライトを素材・リファレンスとして使う。
（注: 抽出物の最終的な配布可否の権利判断はオーナー側事項。開発内利用として進める）

## 2. 却下された成果物（2026-07-17 検収。同じ穴に落ちないこと）

| 却下物 | 理由 |
|---|---|
| hex_tiles_v8 の camp 系建物タイル | 0.55倍縮小で縮尺破壊。「1hexに収める」設計自体が誤り |
| treegen.py の樹木144枚 | 全却下。葉が「膜の寄せ集め」で1枚1枚の葉を形成していない。幹が弱々しく単調。葉と幹の分離。他素材に対して品質が劣る |
| destruction.py の球ブーリアン破孔 | 「ニキビみたいに円形にベベルしただけ」。構造的崩壊になっていない |
| v7 の fieldrows(畝)・道・クレーター | 畝はひっかき傷。道はhexの幾何が透ける。クレーター真円 |
| board_demo の全体印象 | 縮尺不整合+密度不足で「細やかなマップ」になっていない |

**部分的に生きているもの**: kbldg_ 建物タイルのうち**等倍（HEXSCALE scale=1.000）で焼けた小型建物**
と、単体クオリティとしての KB3D 素材そのもの。ビネット(vig_)は縮尺は正しいが再評価待ち。

## 3. 技術資産（動くもの — 流用してよい）

場所: `C:\Projects\squad_tactics\scripts\kb3d_forge\`（各ファイルの罠一覧は同 README.md §6 が必読）

1. **parts_catalog.json**（`scratch/kb3d_forge/`）: KB3D WW2 全1540パーツの台帳
   （分類 CORE/OPENING/DECAL/DEBRIS/PROP/GROUND/STRUCT、grp相対座標、bbox、寸法、材質）。
   再生成: `blender -b <KB.blend> -P catalog_build.py`
2. **forge 系**: forge_grammar.py（seed決定論レシピ）/ forge_build.py（build_scene関数=組立+
   機械検証）/ hexbake_build.py の ensure_hexkit_rig()（軍事投影リグその場構築、headless安全）
3. **grade.py + grade_config.json**: PS色統計準拠の色調統一LUT（α>0のみ、numpy）
4. **PS 色彩統計**（spl 296個・75,480色の実測）: 世界は「暗い大地(v中央値0.07) × 黄緑植生(s0.46) ×
   一段明るい赤茶建物(orange44%+red43%, s0.38/v0.45)」。青系不在。白飛び禁止（v p90=0.53）
5. **KB3D 構造知見**: 躯体1メッシュ=部材1000〜1700個のloose parts集合（＝**部材単位の分解・
   間引きが可能** — 構造的崩壊表現の鍵）。trim sheet PBRで切り貼り自由。破壊断面用トリム
   `ConcreteDamagedEdgesTrimDark` あり。開口の蓋(ドア/鎧戸)は分離パーツ
6. **マルチヘックス焼きの実証済み技法**（scripts/hex_ruins/ の hex-ruins 知見）:
   「複数hexにまたがるオブジェクトは、**1つの溶接メッシュ+単一シーンで作り、ステージ
   オフセットを変えてN回レンダー**する」（2hexクレーターで実証済み。境界の法線不連続を
   避けるため分割はしない）。これを一般化すれば §5-T3 の等倍マルチヘックス焼きになる
7. HexKit リグ定数: 仰角55°オルソ、ortho_scale=20.25、pixel_aspect_x=1/sin55°、288×384/hex、
   hex R=9m pointy-top、px_per_m=14.222、タイル内アンカー(144, 234.5)、sun elev62°/az45°(SWから)
   energy4.2 color(1,0.93,0.82)、world(0.45,0.52,0.62)×0.58、Filmic High Contrast、Cycles CPU 96spl

## 4. Panzer Strike アセットの調査済み事実（ssc デコードの出発点）

- 場所: `C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\Data\Game\Common\Media\Objects\`
  （サブフォルダ: Buildings 39 / Trees 114 / Stands 47 / Lands 40 / Plants 26 / Grass / Craters /
  Terrains / Decors / Fences / Fields / Roads / Spots / Sticks / Stones / Tracks / Cliffs）
- **spl（解読済み）**: `uint32 size(=1020)` + `255 × [B,G,R,A]` = 1024バイトのパレット。
  `ver_01/02...` は同一スプライトのパレットスワップ（色替えバリアント）
- **ssc（未解読・本命）**: スプライト本体。平均146KB(Buildings)。ヘッダ先頭の実測 hex:
  - german_rural_house_001_ver_01.ssc: `0F 00 00 00 | 00 00 00 00 | 58 17 00 00 | D3 02 00 00 | 08 00 00 00 | 81 FF EF FF | E3 00 52 00 | 08 00 01 00 | DA 02 00 00 | E5 6F AA 92 ...`
  - german_village_barn_001_ver_01.ssc: `0C 00 00 00 | 35 02 00 00 | D3 02 00 00 | 08 00 00 00 | FB FF F0 FF | 59 00 20 00 | 08 00 01 00 | 53 02 00 00 | 68 BA 2D CB ...`
  - 観察: 先頭 uint32 は 15/12（フレーム/レイヤ数?）。`D3 02`(=723) が複数ファイルで共通。
    `08 00 00 00` 共通。インデックスカラー+何らかの圧縮（RLE系?）が有力。spl の255色を参照するはず
- 姉妹拡張子: sml×256（平均44KB）、sft×12（4.4MB — フォント?）、sdt（テキスト設定の可能性）
- 攻略ヒント: 同一スプライトの ver_01/ver_02 は「パレットだけ違い ssc はほぼ同一 or 完全同一」の
  はず — 2ファイルの ssc バイナリ diff が構造推定の強力な手がかりになる。また Demo なので
  ファイル数が少なく総当たり検証がしやすい

## 5. 推奨タスク分解（発注順。各タスクは独立に検収可能な成果物を持つ）

### T1: ssc フォーマット完全解読 → PNG 抽出ツール【最優先】
- 成果物: `scripts/ps_extract/ssc_decode.py`（ssc+spl → 透過PNG群、フレーム/アンカー情報含む
  metadata.json 付き）+ フォーマット仕様書 `docs/SSC_FORMAT.md`
- 受け入れ: Buildings/Trees/Lands の任意サンプル各3点が視覚的に正しく抽出できる
  （germanの農家が農家に見える）。全 985 ssc の一括抽出が完走する
- 進め方: ver_01/02 の diff → ヘッダフィールド総当たり → ランレングス仮説検証。
  Kaitai Struct 的な段階デコードで
- **これが取れると、数百点の「本物の細やかさ」を持つスプライトが素材化される**

### T2: 抽出スプライトの棚卸しと利用戦略
- 全抽出物のコンタクトシート(index.html)を作り、カテゴリ別に
  (a)そのまま流用可 (b)拡大・リタッチで流用可 (c)3D再制作のリファレンス、に3分類
- 特に Trees（114種、実在樹種）は (a) 最有力 — treegen の代替。
  Lands/Fields/Roads/Craters は畝・道・クレーター再設計の一次資料
- hex グリッドへの載せ方: スプライトは「タイルに焼き直す」のではなく、genCity 実行時に
  **地面タイルの上へ実行時合成するオーバーレイ素材**として使う案を第一候補に
  （回転が要らない: PS スプライト自体が全方位で成立する描き方をしている）

### T3: 等倍マルチヘックス焼きアーキテクチャ（KB3D側の再設計）
- 「1建物=1hex」を廃止。KB3D 建物・軍営地・教会・チェックポイントを**等倍のまま**、
  N ヘックスにまたがるタイルセットとして焼く:
  1つのシーンに等倍で置き、hex グリッドの各セル位置へステージ(カメラ)オフセットして
  セルごとに 288×384 を切り出す（§3-6 の実証済み技法の一般化）
- 成果物: multibake.py + catalog に「マルチヘックス構成」(base + cell offset q,r + 占有セル一覧)
  を記録するスキーマ。genCity 側はこの構成情報でセル群をアトミックに配置する
- camp は 6〜7 hex、教会は 4〜6 hex 等、実寸から自然に決まる。回転は捨ててよい（rot0 のみ）
- 受け入れ: camp_A を等倍で焼き、board 合成で縮尺が周囲（樹木・ビネット・道）と揃うこと

### T4: 構造的崩壊システム（球ブーリアン全廃）
- KB3D 躯体は loose parts（瓦1枚・梁1本・石1個）の集合体である事実（§3-5）を使う:
  - **部材間引き崩し**: 連結成分を解析し、屋根→上層壁→中層…の順に部材集合を確率的に
    除去/落下配置（残った梁・桁は残す=「骨が残る」壊れ方）
  - 断面には KB3D の断面トリム/デカール、裾には Debris 群を体積比例で流す
  - KB3D 自体の「壊れた造形」（BrokenChurch の崩壊断面など）を崩壊語彙のリファレンスにする
- 成果物: collapse.py（損傷度 0..1 → 段階的崩壊。d0〜d4 の5段階を1建物から生成）
- 受け入れ: 同一建物の5段階を並べ、丸穴が1つも無く、「同じ家が構造的に崩れていく」と
  人間の目で読めること（最終判定はオーナー）
- 参考実装: bmesh 連結成分分解は `scratch/kb3d_study/s7_deep_and_render.py` の loose_parts()

### T5: 地面・道・畝・クレーターの再設計（v7 置換）
- **道**: タイル単位で描かない。genCity のマップ全体でスプライン（道網グラフ）を引き、
  タイルへ焼き落とす or T2 の PS 道スプライトを実行時合成。轍・にじみ・道端の草を持つこと
- **畝**: 「列の盛り上がり+作物の株+土の質感」を持つ 3D 畝 or PS Fields スプライト流用。
  区画は柵(Fences)で縁取られ、向きが区画ごとに違う
- **クレーター**: 真円禁止。非対称リム・飛散土・道/畝の上に乗るときは元地形の破壊文脈を持つ
  （PS Craters スプライトのリファレンス/流用が近道）
- 受け入れ: board 合成で Panzer Strike スクリーンショットと並べ、地面の情報量が見劣りしないこと

### 共通の検収프ロセス
- 実行ログ+実レンダー/実抽出物の目視で検収（自己申告は不可）。機械検証は forge の
  VERIFY 流儀（exit code 0/2）を踏襲
- 各タスクの成果物は必ず「サンプル画像 → オーナー目視」のゲートを通してから量産する
  （今回の教訓: 量産してから却下されるのが最大の浪費）

## 6. 実行環境

- Blender 5.0.1: `C:\Program Files\Blender Foundation\Blender 5.0\blender.exe`（GPU無し、CPU Cycles）
- KB3D blend: `C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2\Kitbash3D - World War 2 [Blender Native]\kb3d_worldwartwo.blender.native\kb3d_worldwartwo-native.blend`（919MB）
  2Kテクスチャ: 同 `...\Kitbash3D - World War 2 [PNG 2k]\kb3d_worldwartwo.png.2k`（起動ごとに
  `bpy.ops.file.find_missing_files` でリマップ必須）
- Python 3.13 + PIL + numpy（ローカル）
- 本プロジェクト: `C:\Projects\squad_tactics\`（ゲーム本編は index.html + logic_*.js + phaser_*.js）
- 全技術罠: `scripts/kb3d_forge/README.md` §6（cp932/EXACT偶奇/bound_box=viewport評価/
  布シェル不可/浮きコレクション空レンダー/grp親オフセット/ps1はBOM必須/長時間バッチは
  デタッチ+ログ 等 — 全部実測済み。必読）

## 7. 今回の失敗の根本原因（新体制への申し送り）

1. **審美判断を機械検証(bbox/IoU/接地)に代行させた**。検証ゲートは破綻は防いだが
   「おもちゃっぽさ」は検出できない。人間の目に見せる頻度が量産の後になった —
   サンプル1点の目視承認を量産の前に置くこと
2. **制約(1hex/288px)に世界を合わせた**。正しくは世界(縮尺・文脈)が先で、タイルは
   切り出しの単位にすぎない
3. 「それらしく見える最小実装」（クランプ樹木・球ブーリアン・線畝）は Panzer Strike の
   密度の前では全て安物に見える。**本物(ssc)を素材化するか、本物に伍する造形だけを作る**
