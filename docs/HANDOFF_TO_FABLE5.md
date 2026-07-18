# HANDOFF — CodexからFable5へ

更新日: 2026-07-18  
対象: Squad Tactics / KB3D Forge / 30hex相談用レビュー盤  
引継ぎ先: Fable5

## 0. 最優先の停止条件

量産はここで停止する。v29は「方向性を確認できた凍結チェックポイント」であり、量産開始の合図ではない。

- 新規タイルの一括生成、既存タイル全体への機械的適用、数十〜数百アセットのバッチ生成を行わない。
- 次に着手する場合も、まず建物1件だけで見た目とナビゲーションを同時に実証し、オーナーへ比較画像とデバッグ表示を提示する。
- オーナーの明示承認を得るまで、30hex以外への展開、素材の全体置換、ゲームランタイムへの全面統合を始めない。
- v29の配置、カメラ、地形、道路、畑、植生、砲痕、他建物を勝手に動かさない。

## 1. 現在の到達点

相談用30hex盤は、初期候補Aから大幅に作り直し、v29で次の状態に到達した。

- Panzer Strike系の俯瞰盤面として読める、2000年代初頭のOperation Flashpointを思わせる素朴な立体感。
- 畑の畝と柵の角度を整合させ、道路と柵の貫通を解消。
- 左側廃屋を積み木状の箱壁から、残存壁・角欠損・崩落斜面・瓦礫帯を持つ破壊シルエットへ変更。
- 廃屋周囲の柵にも破損の濃淡を付け、家だけ壊れて柵だけ新品という不整合を解消。
- 壁面へ地際汚れ、雨垂れ、開口付近の弱い煤を追加。
- 瓦礫の一部だけを右奥の大きな欠損から外向きに偏らせ、崩壊方向を読めるようにした。

最終成果物:

- 画像: scratch/kb3d_review/round2_review_candidate_b_blender_internal_v29.png
- Blender: scratch/kb3d_review/round2_review_candidate_b_blender_internal_v29.blend
- 指標: scratch/kb3d_review/round2_review_candidate_b_blender_internal_v29.metrics.json
- 生成スクリプト: scripts/kb3d_forge/review_scene_b_blender.py
- 入力となる基礎Blender: scratch/kb3d_review/round1_review_candidate_a.blend
- 詳細な制作履歴: docs/RENDER_UPGRADE_WORKLOG.md

これらの主成果物は現時点でGit未追跡の可能性がある。クリーンアップ、reset、作業ツリー切替の前に必ず存在確認と退避を行うこと。

### 1.1 凍結確認用SHA-256

| 対象 | SHA-256 |
|---|---|
| review_scene_b_blender.py | A8BE567A8889C5B46D9F86BD667A9CFE4BCE54763705ED699B9A0F87217472D0 |
| round1_review_candidate_a.blend | CFABC28C668EA858DBB16A3A877951C1812D7FEA155C58710E70A7D8C59A81DC |
| v29 PNG | 3C32E48DFBE965462B45BC1D14C7960163A92DC408AE50160523EEC5AEF6129F |
| v29 blend | 18EE35734C0EA62813F8EC2CC9720CCF28C0C29E84A73BF7A1A3E258DEEBB7C8 |
| v29 metrics | 8FD7CCB31485C9DC7518C4B1847A7EFCAA5A6E9AE21E937E8CBAB67653DC78F3 |

ハッシュが違う場合は即失敗と決めつけず、まず意図した編集か、Blender保存時の差か、外部画像の解決差かを確認する。ただし「同じv29」を名乗る基準としては上記を使う。

## 2. Blender 5.0.1のヘッドレス実行

確認済みBlenderは5.0.1、ビルドハッシュは a3db93c5b259。レンダーエンジンはEevee Nextで、旧HexKitのCycles手順とは別系統である。

### 2.1 v29相当を基礎ファイルから再生成する

PowerShellで次を実行する。

~~~powershell
& 'C:\Program Files\Blender Foundation\Blender 5.0\blender.exe' --background 'C:\Projects\squad_tactics\scratch\kb3d_review\round1_review_candidate_a.blend' --python 'C:\Projects\squad_tactics\scripts\kb3d_forge\review_scene_b_blender.py' -- --render 'C:\Projects\squad_tactics\scratch\kb3d_review\round2_review_candidate_b_blender_internal_v29_repro.png' --save-blend 'C:\Projects\squad_tactics\scratch\kb3d_review\round2_review_candidate_b_blender_internal_v29_repro.blend'
~~~

Blender自身の引数とスクリプト引数の境界は単独の -- である。これを外すと --render と --save-blend がスクリプトへ渡らない。

正常終了の目印:

~~~text
REVIEW_SCENE_B_BLENDER OK render=<出力PNG> blend=<出力blend>
~~~

処理順は、シーン構築、設定、sceneへのmetrics格納、blend保存、PNGレンダー、metrics JSON保存、成功マーカー出力である。PNGだけでなく、blendとmetrics JSONも揃って初めて再生成成功とみなす。

### 2.2 保存済みv29をそのまま再レンダーする

保存blendには複数シーンがあり得るため、REVIEW_ROUND1_RENDERを明示する。

~~~powershell
& 'C:\Program Files\Blender Foundation\Blender 5.0\blender.exe' --background 'C:\Projects\squad_tactics\scratch\kb3d_review\round2_review_candidate_b_blender_internal_v29.blend' --python-expr "import bpy; s=bpy.data.scenes['REVIEW_ROUND1_RENDER']; s.render.filepath=r'C:\Projects\squad_tactics\scratch\kb3d_review\v29_recheck.png'; bpy.ops.render.render(write_still=True,scene=s.name)"
~~~

### 2.3 基礎blendに必要な名前

review_scene_b_blender.pyは単体生成器ではない。基礎blend内の次のシーン、コレクション、オブジェクト名に依存する。

- scene: REVIEW_ROUND1_RENDER
- collection: REVIEW_WORLD
- object: RW_GroundContinuous
- object: RW_ReviewCamera
- object: RW_ReviewSun
- collections: ROUND1_FARMSTEAD_CLEAN、ROUND1_BARN、ROUND1_COTTAGE
- roots: RW_ASSET_FARMSTEAD_CURATED_CLEAN、RW_ASSET_BARN_CURATED、RW_ASSET_COTTAGE_BEAUTY
- optional collection: ROUND1_CAMP

名前変更、リンク解除、基礎blendの置換は、スクリプト側の対応変更なしに行わない。

### 2.4 外部画像依存

v29 blendは画像をパックしていない。監査時点でFILE画像493件、packed 0件、missing 0件。主な依存先は次の通り。

- C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2\Kitbash3D - World War 2 [PNG 2k]\kb3d_worldwartwo.png.2k
- scratch/kb3d_study/ps_reference/ 以下のPanzer Strike参照PNG
- asset/environment/terrain_forest.jpg
- asset/environment/terrain_dirt.jpg

内訳はKB3D 2Kテクスチャ458件、Panzer Strike参照PNG33件、プロジェクト地形JPEG2件。別PCへ渡す場合は、合法的に利用できる元アセットを同じ相対構成へ配置するか、BlenderのFind Missing Filesで再リンクする。欠落テクスチャの状態で出た絵を品質判断に使わない。

### 2.5 レンダー設定と既知の警告

- 出力: 1600×1220、RGB 8bit PNG、圧縮15
- カラーマネジメント: AgX、High Contrast、Exposure 0.75
- カメラ: orthographic、俯角55°、ortho scale 72
- 太陽影: 無効。黒く硬い大影を再導入しない
- BlenderMCPがbackground modeでは開始できない旨の警告は無害
- thumbnailのOpenImageIO書き込み失敗は、最終PNGが正常なら無害
- Material.use_nodes deprecation warningは現行出力を妨げない

Traceback、missing texture、成功マーカー欠落、PNG・blend・metricsの欠落、想定外の全画面差分は失敗として扱う。

### 2.6 再現性を壊しやすい箇所

使用seed:

| 用途 | seed |
|---|---:|
| 全体 | 41027 |
| 廃屋瓦礫 | 46427 |
| 壁面ウェザリング | 46437 |
| 被災柵 | 46637 |
| 牧歌的植生 | 46327 |

consume_v26_ruin_random_stream() と consume_v26_fence_random_stream() は古い乱数列を空送りする互換処理である。未使用コードに見えても削除しない。削ると変更対象外の草、石、植生、砲痕まで再配置され、限定比較が成立しなくなる。

### 2.7 最低限の検証

~~~powershell
python -m py_compile C:\Projects\squad_tactics\scripts\kb3d_forge\review_scene_b_blender.py
$env:PYTHONDONTWRITEBYTECODE='1'
python -m unittest tests.test_review_scene_round1 tests.test_ps_ssc_format tests.test_review_round1_build -v
~~~

監査時点では合計18テスト成功。変更時は、対象ROI外の画素差分が0か、意図した範囲だけかも確認する。

## 3. 座標系と「レビュー盤／製品タイル」の違い

ここを混同しないこと。

- v29の30hexレビュー盤はBOARD_R = 7.2を使う、5×6の見た目検討用シーン。
- 製品側HexKitはpointy-top axial、hex半径9mを基準にする。
- 製品multibakeの標準は1hexあたり288×384px、px_per_mは約14.222。
- Blenderの +r 方向はゲーム平面上の -Y に対応する。
- ランタイム表示は概ね6px/mだが、固定値を新設せず既存レンダー変換を正とする。
- 正式な変換処理は scripts/kb3d_forge/multibake.py を参照する。

したがって、ナビゲーションの原本は「アセットローカルのメートル座標」で持ち、space、hex_radius_m、rotation、originを必ず宣言する。レビュー盤のピクセル位置や半径7.2の座標を、製品用9mヘックスへ直接コピーしてはならない。

## 4. 現在のゲーム側の判定と限界

現行ランタイムは、主に game.map[q][r] のヘックス単位データを使う。

- cost: 移動コスト
- cover: 遮蔽
- building: 建物ヘックスか
- tankBlocked: 車両進入不可か

現状の歩兵は「建物ヘックス全体」へ入れる。扉、壁、内部、柵の切れ目というアセット内の局所判定はない。ユニット位置も基本はq,rである。表示側にはPNGのalphaを見て立ち位置を少し避ける処理があるが、これは見た目用で、正規の当たり判定ではない。

主な既存箇所:

- 地形とA*: scripts側ではなくゲームの logic_map.js 付近
- 移動コスト参照: logic_game.js の getTerrainMoveCost 系
- 表示上のalpha回避: phaser_terrain_v7.js と phaser_unit.js
- 都市建物設定: logic_map_city.js

正確な行番号は今後の編集で変わり得るため、関数名とプロパティ名でも検索すること。

特に現行 getTerrainMoveCost は Math.max(1, Math.ceil(base * mult)) 型の丸めを行うため、道路倍率を1未満にしても1歩ごとのボーナスが消える場合がある。道路ボーナス導入時は、経路全体を固定小数点で合算してからAPへ変換する設計が必要である。

## 5. 見た目とナビゲーションを分離する理由

PNGは「どう見えるか」を表し、ナビゲーション層は「どこを、誰が、どの状態で通れるか」を表す。両者を別成果物にしつつ、同じBlenderシーンと同じアセットIDから同時出力する。

これにより、次を防ぐ。

- NPC歩兵が屋根の上を歩く
- 壁を無視して建物内部へ出入りする
- 無傷の柵をすり抜ける
- 壊れた柵の実際の隙間を通れない
- 見た目だけ壊れたのに当たり判定が無傷のまま残る
- multihex建物のPNG断片ごとに当たり判定が重複する

原則は「レンダーPNGのalphaをゲームロジックの正としない」。alphaは視覚的余白や表示補助に使えても、壁、扉、屋内、壊れた柵を意味的に区別できない。

## 6. 推奨ナビゲーション成果物

各アセットに、既存のPNGとmultibake JSONに加えて次を出力する。

~~~text
<asset>.png
<asset>.multibake.json
<asset>.navigation.json
~~~

navigation JSONのschema IDは squad-tactics.navigation/v1 とする。最初から次の6種類を分ける。

1. obstacles: 建物外壁、閉じた大物、通過不能な本体
2. portals: 扉、門、破口など、領域間をつなぐ侵入点
3. regions: 建物内部、庭、塹壕内など、滞在可能な面領域
4. barriers: 柵、低い壁、線状障害
5. surfaces: 道路、畑、泥、瓦礫など、通行可能だが速度や姿勢に影響する面
6. slots: 待機、射撃、窓際、遮蔽利用などの推奨立ち位置

さらに、無傷、軽微損壊、大破、全壊を d0、d1、d2、destroyed のstate variantとして同じアセット内に保持する。状態ごとに別ファイルを乱造せず、同じ論理IDの変形として扱う。

## 7. navigation JSONの最小契約案

次は仕様の叩き台であり、実装前にJSON Schemaとして固定する。

~~~json
{
  "$schema": "squad-tactics.navigation/v1",
  "asset_id": "farmhouse_small_01",
  "space": {
    "units": "meter",
    "basis": "asset_local_xy",
    "hex_layout": "pointy_axial",
    "hex_radius_m": 9.0
  },
  "owner": {
    "base_cell": [0, 0],
    "occupied_cells": [[0, 0], [1, 0]]
  },
  "profiles": ["infantry", "vehicle"],
  "states": {
    "d0": {
      "obstacles": [
        {
          "id": "building_shell",
          "polygon": [[-3.4, -2.5], [3.4, -2.5], [3.4, 2.5], [-3.4, 2.5]],
          "profiles": ["infantry", "vehicle"],
          "blocks_los": true,
          "blocks_projectile": true,
          "height_m": 3.2
        }
      ],
      "portals": [
        {
          "id": "front_door",
          "segment": [[-0.55, -2.5], [0.55, -2.5]],
          "connects": ["exterior", "room_main"],
          "profiles": ["infantry"],
          "width_m": 1.1
        }
      ],
      "regions": [
        {
          "id": "room_main",
          "polygon": [[-3.0, -2.1], [3.0, -2.1], [3.0, 2.1], [-3.0, 2.1]],
          "profiles": ["infantry"],
          "movement_cost_milli": 1000,
          "capacity": 4,
          "allows": ["wait", "fire"]
        }
      ],
      "barriers": [
        {
          "id": "yard_fence_east",
          "polyline": [[4.1, -3.0], [4.1, 3.1]],
          "profiles": ["infantry", "vehicle"],
          "width_m": 0.12,
          "passable_gaps": []
        }
      ],
      "surfaces": [
        {
          "id": "field_south",
          "kind": "field",
          "polygon": [[-8.0, -8.0], [8.0, -8.0], [8.0, -3.2], [-8.0, -3.2]],
          "profiles": ["infantry", "vehicle"],
          "movement_cost_milli": 1350
        },
        {
          "id": "road_gate",
          "kind": "road",
          "polygon": [[-1.8, -10.0], [1.8, -10.0], [1.8, -3.0], [-1.8, -3.0]],
          "profiles": ["infantry", "vehicle"],
          "movement_cost_milli": 800
        }
      ],
      "slots": [
        {
          "id": "window_north_fire_01",
          "point": [-1.6, 1.8],
          "region": "room_main",
          "kind": "fire",
          "facing_deg": 90,
          "profiles": ["infantry"]
        }
      ]
    }
  },
  "source": {
    "blend": "farmhouse_small_01.blend",
    "generator": "kb3d_forge",
    "state": "d0"
  }
}
~~~

### 7.1 幾何とIDの規則

- polygonは自己交差禁止。頂点順を統一する。
- portalは必ず2領域を接続し、壁を横断する実際の開口へ置く。
- slotは必ず有効なregion内、または明示された外部領域内に置く。
- IDは同じアセットとstate内で一意。再出力しても意味が同じならIDを維持する。
- 配列順を決定的にし、小数桁を固定して、同入力からbyte-stableなJSONを出す。
- sourceへ生成元blend、generator version、seed、必要なら入力ハッシュを残す。
- 見た目に存在しない仮想扉や、PNGの透明部から推測しただけの室内を作らない。

## 8. 標準セマンティクス

| 見た目の要素 | ナビゲーション上の役割 | 歩兵 | 車両 | 補足 |
|---|---|---:|---:|---|
| 建物本体・外壁 | obstacle | 不可 | 不可 | LOS・弾道遮蔽を別フラグで持つ |
| 扉 | portal | 可 | 原則不可 | 建物内部への正規侵入点 |
| 壁の破口 | portal | 幅と状態次第 | 幅と状態次第 | d1/d2で追加され得る |
| 建物内部 | region | 可 | 不可 | 待機、射撃、収容数、遮蔽を定義 |
| 屋根 | ground navigationなし | 不可 | 不可 | 梯子等を実装するまで歩かせない |
| 無傷の柵 | barrier | 不可 | 不可 | 乗越えを実装するなら別action |
| 壊れた柵の隙間 | barrier内gap | 可 | 幅次第 | 実際の切れ目だけ通す |
| 倒れた柵材 | surfaceまたは低障害 | 遅い／跨ぐ | 原則不可 | 見た目と一致させる |
| 畑 | surface: field | 可・遅い | 可・さらに遅い場合あり | 基準1000に対し1300〜1450 |
| 道路 | surface: road | 可・速い | 可・速い | 基準1000に対し750〜850 |
| 瓦礫 | surface: rubble | 可・遅い | 状態次第 | 1500〜1800、遮蔽を付与可能 |
| 待機位置 | slot: wait | 可 | 用途次第 | 混雑と重なりを防ぐ |
| 射撃位置 | slot: fire | 可 | 用途次第 | 向き、窓、遮蔽を関連付ける |

移動倍率は浮動小数の逐次丸めを避け、1000を通常地形とする固定小数点値で経路全体へ累積する。最後にAPへ変換する。1歩ごとにceilすると道路ボーナスが消えるため禁止。

## 9. Blender内のオーサリング方法

見た目用メッシュとは別に、レンダーされない低ポリゴンproxy collectionを置く。

- NAV_BLOCKER
- NAV_INTERIOR
- NAV_PORTAL
- NAV_BARRIER
- NAV_SURFACE
- NAV_SLOT

これらは hide_render = true とし、各objectへcustom propertyを持たせる。

| property | 例 | 用途 |
|---|---|---|
| nav_kind | obstacle / portal / region | 書き出し種別 |
| nav_id | front_door | 永続ID |
| nav_profiles | infantry,vehicle | 対象移動profile |
| nav_state | d0 | 対象破壊状態 |
| nav_cost_milli | 1350 | surface移動コスト |
| nav_blocks_los | true | 視線遮蔽 |
| nav_blocks_projectile | true | 弾道遮蔽 |
| nav_connects | exterior,room_main | portal接続先 |
| nav_capacity | 4 | region収容数 |
| nav_slot_kind | wait / fire | slot用途 |

Forge側にはすでにCORE、STRUCT、OPENING等の分類、door anchorのrel_loc・rot・dim、object transformとbboxがある。これらから建物殻と扉portalの初期proxyを自動生成できる。ただし、室内regionを建物bboxやPNG alphaだけで自動確定してはならない。壁厚、家具、崩壊、複数室を無視するため、テンプレートごとに低ポリproxyを人が確認する。

v29生成器にも、道路幅、畑の中心・寸法・角度、柵区間、被災柵の残存材・傾斜材・落下材、建物中心、廃屋開口などの意味データがある。試作時のseedには使えるが、レビュー盤座標を製品タイルへ直写ししない。

## 10. 建物生成と同時にナビゲーションを出力する

将来アセットが何百種類になっても見た目とルールを一致させるため、visual buildとnavigation exportを同じビルド単位にする。

推奨順序:

1. 同じasset definition、transform、state、seedから見た目メッシュとNAV proxyを構築する。
2. Blender内でNAV proxyの幾何と参照IDを検証する。
3. 見た目のblendを保存し、PNGをレンダーする。
4. 同じシーンからnavigation JSONを書き出す。
5. PNG、multibake JSON、navigation JSONへ同じasset_id、state、source hashを埋める。
6. 3成果物が揃い、schema validationと整合テストを通った場合だけstagingへ公開する。
7. オーナー承認前はproduction catalogへ登録しない。

「見た目を先に量産し、あとから当たり判定を手作業で追いかける」工程にしない。生成と同時に出力すれば、扉移動、柵破損、建物回転、破壊state変更が片側だけ取り残される事故を防げる。

現時点ではこのnavigation exporterとruntime層は未実装である。本書は次担当が実装する契約案であり、完成済み機能として扱わないこと。

### 10.1 破壊状態の同期契約

建物や柵がd0からd1、d2、destroyedへ変わるときは、一つの処理で次を行う。

- visual asset stateを切り替える。
- 同じasset_idのnavigation stateを切り替える。
- 新しい扉、破口、柵gap、瓦礫surfaceを有効化する。
- navigationRevisionを増やす。
- 影響範囲の経路、車両連結成分、配置候補、AI評価をinvalidateする。
- 既存ユニットが新しいobstacle内に取り残された場合の退避規則を適用する。

見た目だけ、または当たり判定だけを先に更新するAPIを外部へ公開しない。

## 11. ランタイム統合案

ヘックス判定の上にasset-local navigationを合成するNavigationLayerを置く。

推奨API:

~~~text
canEnter(profile, fromPose, toPose)
movementCostMilli(profile, fromPose, toPose)
resolvePortal(profile, fromPose, toPose)
findStandSlot(profile, regionId, intent)
coverAt(pose, facing)
blocksLineOfSight(fromPose, toPose)
blocksProjectile(fromPose, toPose)
setAssetState(assetInstanceId, state)
invalidate(assetInstanceId)
~~~

### 11.1 ユニット位置

既存q,rを捨てず、次を加える。

~~~text
q, r
regionId
slotId
localMeters: [x, y]
~~~

q,rは戦略的な所属ヘックス、regionIdとlocalMetersは建物内部や柵の切れ目を含む局所位置を表す。Phaser表示はnavigationが返したstand pointを使い、PNG alphaを見て論理位置を決めない。

### 11.2 multihexアセット

multihex建物はbase cellが1つのasset instanceとnavigationを所有し、occupied cellsはそのinstanceを参照する。PNGの分割片ごとに同じ建物殻や室内を複製しない。

回転、反転、配置offsetは、visualとnavigationへ同じtransformを一度だけ適用する。0°だけでなく全許可回転をテストする。

### 11.3 既存参照の集約

A*だけ直して終わりではない。現在cost、building、tankBlockedを直接読む次の系統を、段階的に同じNavigationLayerへ集約する。

- 歩兵A*と移動可能範囲
- 車両A*と車両用連結成分cache
- spawn候補
- deployment候補
- AIの到達性、位置評価、退路評価
- 射線、遮蔽、弾道
- クリック先解決と表示上のstand point

移行中は旧ヘックス判定をfallbackとして残してよいが、同じ局面で旧判定と新判定が別々の答えを返さないよう、優先順位とfeature flagを明示する。

## 12. デバッグ表示と必須検証

### 12.1 デバッグoverlay

オーナーがPNGと同時に判定を目視確認できるoverlayを用意する。

- obstacle: 半透明赤
- interior region: 半透明緑
- portal / breach: シアン
- barrier / fence: 紫
- road surface: 青
- field surface: 黄
- rubble surface: 橙
- wait / fire slot: 白い記号と向き線

通常PNG、navigation overlay、両者合成の3枚を同じカメラ・同じtransformで出す。見た目の承認だけで判定を暗黙承認しない。

### 12.2 自動テスト

最低限、次を通す。

- 歩兵が外壁を横断できない。
- 歩兵が扉または有効な破口だけから室内へ入れる。
- 地上歩兵が屋根へ配置されない。
- 室内で待機slotと射撃slotを取得できる。
- 車両が通常の建物内部へ入れない。
- 無傷の柵を横断できない。
- 壊れた柵は実際のgapだけ通れる。
- gap幅より大きいprofileは通れない。
- 畑は通常地面より遅い。
- 道路は通常地面より速く、丸めで効果が消えない。
- d0からd2への変更でvisualとnavigationが同時更新される。
- state変更で経路cacheと車両連結成分cacheが無効化される。
- 全許可回転とmultihex transformでvisualとnavigationが一致する。
- 同じ入力からnavigation JSONが決定的に再生成される。
- PNGのalphaや色だけを変えてもnavigation結果は変わらない。
- 欠落portal、自己交差polygon、region外slot、重複IDをvalidatorが拒否する。

## 13. Fable5が次に進める実装順

### Phase 0: 凍結保持

- v29成果物とハッシュを確認する。
- 量産ジョブを起動しない。
- review_scene_b_blender.pyの乱数互換処理を保つ。

### Phase 1: schemaとvalidatorのみ

- squad-tactics.navigation/v1 のJSON Schemaを作る。
- polygon、portal接続、ID、profile、state、座標宣言を検証する。
- deterministic serializationのgolden testを作る。
- この段階ではゲーム挙動を変えない。

### Phase 2: 小型農家1件の縦切り実証

- 製品半径9mの小型農家1件だけ選ぶ。
- d0、d1またはd2、destroyedの最低3状態を作る。
- 建物殻、扉、室内region、待機／射撃slot、隣接する短い柵、畑、道路を含める。
- PNG、navigation overlay、合成画像を出す。
- 歩兵1体の侵入、待機、射撃、退出と、車両の排除を小さなデモで確認する。
- オーナーへ提示し、ここで停止して方向性を協議する。

### Phase 3: v29レビュー盤の意味データ化

Phase 2が明示承認された場合だけ、v29の道路、畑、柵、廃屋へ同じ意味体系を試す。見た目は固定し、navigation overlayだけを比較する。

### Phase 4: runtime adapter

- NavigationLayerをfeature flag付きで導入する。
- A*、spawn、deployment、AI、Phaser stand pointを一系統ずつ移行する。
- 旧セーブ互換とfallbackを検証する。
- state変更とcache invalidationを結ぶ。

### Phase 5: オーナーゲート

1件の完全縦切りデモ、テスト結果、PNG比較、overlayを提示する。オーナーが明示的に量産を承認するまで、catalog展開とバッチ生成へ進まない。

## 14. 禁止する近道

- PNG alphaを建物内部や扉の正規当たり判定にする。
- 建物bbox全体をそのまま室内regionにする。
- 扉が見えるという理由だけで、壁との接続を検証せずportalを置く。
- multihexの各PNG断片へnavigationを複製する。
- 道路ボーナスを1歩ごとのceilで消す。
- 無傷と破壊後で同じ柵barrierを使い続ける。
- 見た目とnavigationを別々の手作業バッチで量産する。
- v29レビュー盤の半径7.2座標を製品半径9mへそのまま流用する。
- seed互換関数を整理目的で削る。
- オーナー確認前に「同じ方向性」と推測して大量展開する。

## 15. 引継ぎ時チェックリスト

- [ ] docs/RENDER_UPGRADE_WORKLOG.mdを読む。
- [ ] v29 PNG、blend、metrics、基礎blend、生成スクリプトの存在とハッシュを確認する。
- [ ] 外部画像493件にmissingがないことを確認する。
- [ ] Blender 5.0.1 headlessで再レンダーし、成功マーカーと3成果物を確認する。
- [ ] 18テストを実行する。
- [ ] 量産停止を維持する。
- [ ] navigation/v1 schemaとvalidatorから始める。
- [ ] 製品半径9mの建物1件だけで試作する。
- [ ] 通常PNG、navigation overlay、合成画像を提示する。
- [ ] 見た目と判定の両方についてオーナー承認を待つ。

## 16. 完了条件

次の担当の最初の成功は「大量の新しいPNG」ではない。小型建物1件について、同じBlender生成から見た目とnavigation JSONが決定的に出力され、歩兵が扉から入り室内で待機・射撃でき、車両は排除され、無傷／破壊後の柵と地表速度が見た目どおりに切り替わること。その通常レンダーとoverlayをオーナーへ見せ、明示承認を得るところまでである。

その承認が得られるまで、量産は停止したままにする。
