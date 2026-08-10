# WW2廃墟都市マップシステム — 引き継ぎ文書

作成: 2026-07-14 / 対象: マップのブラッシュアップを担当する外部AI・開発者向け。
この文書だけで全体像が掴めるよう自己完結で書いてある。正本はコード側
(`logic_map_city.js` / `phaser_terrain_v7.js` / `scripts/hex_ruins/`)。

---

## 1. 概要

Phaser 3製RTwPヘックスウォーゲーム(index.html)の戦場マップ。
Sudden Strike / Panzer Strike風の「WW2欧州の廃墟市街地」ビジュアルが目標。

- **タイル方式**: Blender(Cycles)でプリレンダーした透過PNGヘックスタイル561枚
  (`asset/environment/hex_tiles_v7/`)を、実行時に手続き生成したレイアウトへ配置
- **生成**: 決定論的シード(FNV-1aハッシュ`h32`)ベース。同シード=同マップ
- **描画**: `phaser_terrain_v7.js`が参照タイルのみ実行時ロード(全載せ禁止)

## 2. 座標系と投影(最重要・全ての土台)

### 2.1 ゲーム側ヘックス座標
- **軸座標(axial) pointy-top**。`hexToPx(q,r) = { x: HEX_SIZE*√3*(q+r/2), y: HEX_SIZE*1.5*r }`
- `HEX_SIZE = 54`(px, 外接半径)。マップ`MAP_W×MAP_H = 20×20`
- 隣接方向 `DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]` — **インデックスkは
  世界角度60k°に対応**(k=0=東, k=1=北東, ... 反時計回り)。画面北=上

### 2.2 タイルのミリタリー投影
- 仰角55°のオルソカメラ + `pixel_aspect_x = 1/sin(55°)` — この組で**地面の平面図が
  無歪**になる(正六角形がそのまま出る)。壁など垂直要素だけが縦にせん断される
- タイル実寸: ヘックス外接半径 **R=9m**、キャンバス幅の実世界カバー **20.25m**
- **現行キャンバス 288×384px、アンカー(ヘックス中心)=(144, 234.5)、ヘックス半径128px**
  (2026-07-14に576×768から半減。576×768時代は約195MB、
  現行561枚のカタログは約44MB)
- **平面無歪の重要な帰結**: 地面上の任意の実世界オフセット(m)は
  `ppm = (SRC_W / 20.25) * (HEX_SIZE / 128)` の線形換算だけでスクリーンpxにできる。
  デカールの自由配置(§6.3)はこれで成立している
- 太陽: 南西上空(仰角62°、azimuth45°)。**影は画面の東(右)へ落ちる**。energy4.2、
  環境光0.58、Filmic High Contrast。ユニットの影・自作アセットは必ずこれに合わせる

## 3. タイル資産(hex_tiles_v7, 561枚)

命名規則: `<種類>_<パターン>_v<バリアント>_rot<回転деg>.png`(回転は焼き込み。
Phaser側でsetAngleすると陰影方向が破綻するため**実行時回転は禁止**)

| 族 | ファイル | 意味 |
|---|---|---|
| 地面 | `gnd_cobble_v0-5` `gnd_street_v0-2` `gnd_grass_v0-5` `gnd_crater_v0-3` | 全面タイル(石畳/舗装広場/草地/砲痕クレーター) |
| 道路 | `road_{straight,corner,tee,cross}_v*_rot*` | 石畳背景+アスファルト帯。straight=対辺{a,a+3}, corner=120°辺{a,a+2}, tee={a,a+2,a+3}, cross={a,a+2,a+3,a+5} |
| 道路損傷 | `road_*_d{1,2}_rot*` | d1=瓦礫散乱、d2=クレーター寸断(着弾で進行) |
| スカー | `scar_{e1,e2a,e2o,e3,e4,full}_v*_rot*` | 石畳↔荒地のエッジマスク遷移。e1={0}, e2a={0,1}, e2o={0,3}, e3={0,1,2}, e4={0,1,2,3}, full=全面 |
| 大クレーター | `cpair_v{0-3}_{a,b}_rot{0,60,120}` | 2ヘックス跨ぎのセットピース。4 variants × a/b × 3回転 = 24 files |
| 草地遷移 | `grn_{e1..e4}_v{0,1}_rot*` | 石畳↔草地。scarと同じエッジマスク族 |
| 建物 | `bldg_s{1-5}_d{0-2}_rot*` `church_d*_rot*` `factory_d*_rot*` | 3段階損傷(d0→d1→d2、着弾で進行) |
| 陣地 | `trench_*` `foxhole_*` `bocage_*` `wire_*` | 塹壕/タコツボ/生垣土塁/鉄条網 |
| 小物 | `rubble_*` `prop_{hedgehog,sandbag,barrels}_*` `tree_v0-4` `veg_v0-2` | 瓦礫野・小物・既存植生 |
| 植生増強 | `tree_v5-9` `veg_v3-5` | 外周の葉樹5種と密な低木3種 |
| 地表ディテール | `track_v0-3_rot{0,60,120}` `fieldrows_v0-3_rot{0,60,120}` | 轍12枚・畝12枚。デカールとして任意位置へ配置 |
| デカール | `dirtpatch_v0-3` `cobble_detail_v0-5` | 土パッチ4枚と石畳継ぎ目用6枚。実行時オフセット配置 |

### 3.1 タイル設計の不変条件(壊すと全てが崩れる)
1. **「縁で静まる」**: 全タイルはヘックス縁~1.5-2mでノイズ/うねり/道幅が標準値に
   収束する。だから任意の組合せがシームレスに繋がる。地面メッシュはR+0.3~0.4の
   ブリードでAAエッジ線も消してある
2. **エッジマスク文法**: 遷移系(scar/grn)は「どの辺の向こうが同族か」の6bitマスクを
   回転込みで6パターン(e1/e2a/e2o/e3/e4/full)に解決する。`scarResolve()`が
   マスク→(パターン,回転)を返す。**解決不能なマスクを作らないのは生成側の責任**
3. **道路タイルの語彙は4つだけ**(straight/corner/tee/cross)。60°の急カーブ
   ({a,a+1}辺ペア)や行き止まりのタイルは**存在しない**。§5.3の文法制約参照
4. 異族同士(scar↔road↔grn等)は**すべて縁の標準cobbleを介して接続**するので互換

## 4. Blender生成パイプライン(scripts/hex_ruins/)

- **接続**: blender-mcpアドオンのソケット(localhost:9876)を`bmcp_client.py`で直叩き。
  `--code-file`でBlender内実行。**ライブGUI Blenderが必須**(PolyHavenテクスチャが
  アドオン経由でセッション内に載る前提)
- **手順**: ①`rig_setup.py`(シーンHexKit構築+較正レンダー) ②PolyHavenフラグを
  シーン作成**後**に再設定(rig_setupはシーン作成前に立てるバグあり—既知)
  ③必要テクスチャDL(`download_polyhaven_asset`) ④`batch_render.py`を
  `HEXKIT_PART=<part>`で実行(parts: s1-s5/grounds/extras/roads/roads_dmg/scar/
  `scar_pairs_extra`/green/patches/specials/`details_priority`/`details_trees`/
  `details_tracks`/`details_cobble`/`details_fields`/catalog)
- **大クレーター増強**: `scar_pairs_extra`はcpair v2/v3だけを各a/b×rot0/60/120で
  レンダーする専用入口。既存v0/v1を参照せず、既存出力への上書きも拒否する
- **詳細パック**: `gen_detail.py`が`tree_v5-9`・`veg_v3-5`・轍12枚・畝12枚・
  `cobble_detail_v0-5`を生成。入力`ww2_hex_module.blend`と必要テクスチャをfail-fast検証
- **カタログ正本**: `python -B scripts/hex_ruins/build_catalog.py`で再生成し、
  `python -B scripts/hex_ruins/build_catalog.py --check`で561 PNGの分類・寸法・完全行列を検証
- **主要テクスチャ**: cobblestone_floor_01(石畳)/road_damaged(アスファルト)/
  brick_gravel(スカー土)/broken_brick_wall(瓦礫)/aerial_grass_rock(草地)
- **ジェネレータ**: gen_building.py(建物) gen_ground.py(地面) gen_scar.py
  (スカー/道路/dirtpatch/cpair) gen_green.py(草地) gen_specials.py(教会/工場)
  gen_detail.py(葉樹/低木/轍/畝/石畳ディテール)
- レンダー: Cycles 96samples、CPU(GPUなし環境)。288×384なら1枚10-30秒

### 4.1 Blender側の既知の罠(実績あり)
- EXACTブーリアンは1メッシュ内の自己交差カッターを偶奇相殺する→カッターは分離
- tintはリニア値。sRGB感覚で書くと白飛び(暗い土=linear(0.09,0.07,0.05))
- Blender 5.0は`scene.node_tree`廃止→コンポジタ処理はPIL後処理で代替
- 接写系テクスチャ(grass_medium_01等)は上空視点でタイリング反復が丸見え→空撮系を使う
- マルチhexセットピースは「溶接1メッシュ+ステージオフセット2回レンダー」方式

## 5. 実行時マップ生成(logic_map_city.js / window.CityMap)

エントリ: `CityMap.generate(game)` → `game.map[q][r]`にTERRAIN互換オブジェクト
`{ id, name, cost, cover, building?, tankBlocked?, city: cell }` を格納。
cell = `{ q, r, ground, gfile, flat[], over[], wreck, dist, open, scar, green, void }`

生成パス(genCity, 順序が重要):
1. **市街地シルエット**: 中心からのランダムウォーカー(面積×0.9歩、分裂確率3.5%、
   **中心へのソフト引力=遊泳半径min(COLS,ROWS)×0.38をスクリーン空間距離で制限**)で
   core集合を成形 → 形態学的平滑化(充填≥4/触手除去≤2を3パス) → 最大連結成分のみ採用。
   **固定矩形は軸座標→画面変換で必ずひし形になる**ため廃止済み(2026-07-14)
2. **グリーンフリンジ(エッジ反転方式)**: coreの縁3リングを草地に。
   **coreの形はタイル語彙に合わせて変形しない**(§8.9の重要教訓)。語彙で表現
   できない緑マスク(凸角=core隣接1つのサイズ5等)はセルを全面草地へ昇格し、
   共有エッジの草をcore側セルのgrnタイル(石畳+草ローブ, `flippedCore`,
   open=false)で受ける — grnタイルは逆から読めば「石畳に草が食い込む」タイル。
   残留(実測1セル/マップ程度)は診断記録のみで続行。その外は**完全VOID**
   (id:-1, cost99, 非描画)
3. **A*道路**(§5.3): 幹線=西端→東端、支線=幹線の直進セルからT分岐して南北の遠い方へ
4. **荒地ブロブ+cpair**: 面積比例の個数、成長+マスク解決補修ループ
5. **道路タイル割当**: roadLinks(実接続グラフ)からマスク→`roadTile()`。
   未解決は石畳へ戻す安全網(現在は発生ゼロ)
6. **反復対策**: 全面タイル(cobble/grass/scar_full)を「隣接と同バリアント禁止」の
   貪欲割当(`cell._fullVar`)。3バリアント族は6へ増強済みで隣接重複ゼロ
7. **建物/瓦礫/教会/工場**: wreck(中心ほど破壊度大+ノイズ)でd0-d2を選択
8. **塹壕線+鉄条網+タコツボ、ボカージュ線、小物/植生**

### 5.1 地形パラメータ(terrainForCell)
| セル | cost | cover | 備考 |
|---|---|---|---|
| VOID | 99 | - | 不可侵・非描画 |
| 建物(bldg) | 3 | 65 | 歩兵進入可・`tankBlocked`(戦車のみ不可侵) |
| 教会/工場 | 4 | 70 | 同上 |
| ボカージュ | 99 | - | 完全不可侵 |
| 塹壕/タコツボ | 1 | 55 | |
| 鉄条網 | 3 | 5 | |
| 瓦礫 | 2 | 40 | |
| スカー/砲痕 | 2 | 15 | |
| 道路 | 1 | 35 | d2寸断でcost2 |
| 草地 | 1 | 10 | |
| 石畳 | 1 | 5 | |

経路探索は`BattleLogic.isHexBlockedForUnit(u,q,r)`(cost>=99 or 戦車×tankBlocked)
を全箇所(findPath/calcReachable/checkDeploy/getSafeSpawnPos)で使う。

### 5.2 破壊の進行(戦闘連動)
- T4/T5爆発の直撃: 建物d+1(`CityMap.damageBuilding`+スプライトsetTexture)、
  建物がなければ地面(`damageGround`: 道路d0→d1→d2 / 石畳→gnd_crater)。
  道路損傷時は**バリアントを抽選し直す**(縁互換なので可能、反復感も減る)
- 損傷段テクスチャは遅延ロード(マップ構築時にプリロードしない)

### 5.3 道路の文法制約(2026-07-14確立、最重要の学び)
hexの1セル幅経路では、**空間的な隣り合わせからマスクを推定すると交差点の
ナナメ隣で{a,a+1,a+3}等のタイル非対応マスクが幾何的に必ず発生**し、全面グレー
(gnd_street)フォールバックが湧く。解決手法:
- マスクは`roadLinks`(実際に敷いた経路の接続グラフ)から引く。空間隣接は見ない
- A*は状態=(セル,進行方向)で、方向変化を0°/±60°に制限(±120°/反転は禁止)
- 交差はT分岐のみ: 幹線の直進セル(前後同方向)から±120°方向へ分岐すると
  構築的にteeマスク{a,a+2,a+3}が保証される
- 道路端: 終端セルのリンクに「継続方向」の仮想エッジを足す=道はマップ外へ
  続いている扱い。行き止まりタイルは不要

## 6. 描画(phaser_terrain_v7.js / window.TerrainRenderV7)

- 定数: `SRC_W:288, SRC_H:384, HEX_R:128, ANCHOR:(144,234.5)`,
  `BACKDROP_PAD:3`, `DETAIL_PACK_READY:true`。表示スケール=`HEX_SIZE/128`
- **参照限定ロード**: `collectFiles()`は現マップが使う地面/flat/over/任意`cell.decals`、
  backdrop、dirtpatch、cobble detailだけを列挙する。建物は**現在の損傷段だけ**を読み、
  次段階は着弾時に遅延ロードする
- **build世代トークン**: `buildMap()`ごとにserialを進め、古い非同期load完了からの
  stale drawを拒否する。建物/地面の連続損傷も座標別tokenで古い差替callbackを拒否
- **3-ring apron**: VOIDセルとマップ外3リングへ決定論的`gnd_grass_v0-5`を敷き、
  fieldrows/vegを疎配置する。葉樹`tree_v5-9`はマップ外だけに置き、盤面の切れ目を隠す
- **描画順/Yソート**: 地面/低層(瓦礫・鉄条網・小物)→hexGroup。背高
  (建物/教会/工場/ボカージュ/樹木)は`scene.unitGroup`にdepth=worldY-0.5で同居し、
  兵士との前後関係を保つ
- **自由配置デカール**: `cell.decals`は`{file,wx,wy,scale,alpha,layer,tall}`を受け、
  `wx/wy`(m)を§2.2の線形換算でピクセルへ変換。layerとtallで低層/Yソートを選ぶ
- **石畳シーム**: cobble/road同士の共有辺を重複なしで走査し、決定論的28%に
  `cobble_detail_v0-5`をジッタ/scale/alpha付きで配置する
- 建物スプライトは`buildingSprites`、地面は`groundSprites`で保持し、損傷差替は
  setTexture一発(全面再描画禁止)
- `getBuildingSafeOffset(q,r)`はロード済み建物alphaをcanvasでサンプリングし、
  兵士が壁に重ならない空き地を求める

### 6.1 シームブレーカー(dirtpatch)
`_placeScarPatches()`: スカー同士の共有エッジ中点(k=0..2走査で重複なし)と、
所有セル+隣接2セルがすべてscarである**真の3-scar頂点**へ土パッチを配置する。
ジッタ±0.8m・42%間引き・スケール0.75-1.24。cpair内部辺(溶接済み)はスキップ。
デカール4枚の決定論的配置で、境界線とコーナースパイクを抑えつつ、同じseedなら
同じ結果を再現する。

## 7. 変遷(なぜ今の形か)

1. **v4-v5(2026-07-07~09)**: タイルセット確立。「縁で静まる」原則、
   スカーのエッジマスク族、2hexセットピース手法を確立
2. **本編統合(2026-07-12)**: プレビューHTMLのgenCityを本編へ移植。
   建物不可侵(当時cost99)・KHAOS爆発連動・3段階破壊
3. **Yソート/兵士スケール/建物進入(2026-07-13)**: 兵士20px(建物実寸から逆算した
   物理値9pxの2倍=ウォーゲーム可読性ブースト)。歩兵は建物内へ、壁際に隠れる
4. **軽量化(2026-07-14)**: 576→288半減で約195MB→現行約44MB。生成自体は10-27msで軽く、
   遅さの正体はタイルDLだった。※パレット化(256色)はCyclesの連続階調に
   ほぼ無効(10-30%減)と実測済み — 解像度が効く
5. **ひし形廃止(2026-07-14)**: 固定矩形→ランダムウォーカー+VOID縁取り。
   道路も機械的ジグザグ→文法制約付きA*
6. **境目・反復対策(2026-07-14)**: §5.3の道路文法+隣接バリアント禁止+dirtpatch
7. **詳細パック完成(2026-07-14)**: 石畳継ぎ目6、轍12、畝12、葉樹5、低木3を追加。
   cpairもv2/v3を追加して4 variants・24 filesになり、主要な反復不足を解消
8. **描画外周/非同期堅牢化(2026-07-14)**: 3-ring apron、自由配置decals、
   cobble seam、build serial、現在損傷段だけの遅延ロードを統合
9. **ひし形回帰の修正=エッジ反転方式(2026-07-15)**: GPT-4.6版の
   「green境界トポロジ正規化」(境界マスクが語彙外ならcoreを変形して直す)は
   ひし形回帰を起こして廃止。原因は語彙の根本制約 — **grn/scar族に「凸角」
   (core隣接1つ=マスクサイズ5)を表現するタイルが存在しない**ため、正規化は
   ほぼ凸の巨大な塊(≒グリッド全面)にしか収束できない(実測: core167→335)。
   さらに引力なしウォーカーは網状に広がり、網の穴はどこを削っても連結が
   切れるため充填一辺倒になる連鎖も確認。現行解: ①ウォーカーに中心引力
   ②形は変えず、語彙外の緑セルを全面草地へ昇格して共有エッジの草を
   core側grnローブで受ける(§5生成パス2)。**境界形状をタイル語彙に合わせて
   変形する発想は再導入しないこと**

## 8. 既知の課題・改善候補(描画/アセット)

1. **スカー外周のサワトゥース(残存軽微)**: 3-scar頂点パッチでほぼ隠れたが、根治は
   scar族の再レンダー(境界ノイズを縁で0に+深さ標準化)
2. **水域**: v7に水タイルなし(旧v1タイルセットにのみ存在)。岸辺遷移の
   エッジマスク族を作れば追加可能
3. **grn遷移とscar遷移の直接隣接**: どちらも縁はcobbleに収束するので破綻は
   しないが、「草→石畳→土」と1hexでcobbleを挟む見た目になる。草↔土の
   直接遷移族は未作成
4. **大規模化時のVRAM**: 現行カタログは561枚だが、実行時は参照分と建物の現在段だけを
   ロードする。マップ面積や同時参照数を大きく増やす場合はアトラス化を検討

## 9. 検証手法(このプロジェクトの流儀)

- **Node.jsヘッドレス**: `tests/map_city.test.js` と地形系テストから生成器を直接読み込み、
  未解決マスク、連結性、隣接重複を検証する。戦闘結果の検証はSimCore/RTwP統合テストへ分離する
- **ブラウザ実機**: Browser paneは`visibilityState=hidden`でPhaserが止まる →
  `setInterval(()=>phaserGame.loop.step(performance.now()),33)`で強制駆動。
  スクリーンショットは`phaserGame.renderer.snapshot`→canvas縮小→dataURL
- **アセット正本**: `python -B scripts/hex_ruins/build_catalog.py --check`。
  `561 PNGs (288x384)`、未分類0、cpair 4 variants/24 filesを満たすこと
- サーバー: `npx http-server -p 8788/8789 -c-1`(.claude/launch.json)または
  ユーザーのpython http.server
