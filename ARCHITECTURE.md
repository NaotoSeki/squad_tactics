# SQUAD TACTICS — アーキテクチャ（現状の地図）

**この文書の目的**: 初見の人（未来の自分・別レーンのAI含む）が、コードを読み始める前に
「どこに何があり、どれが生きていて、どこに罠があるか」を掴めるようにする。

**正本の序列**: 設計方針は [docs/NORTH_STAR.md](docs/NORTH_STAR.md) が最上位。この文書は
「今どうなっているか」の地図であり、「どうあるべきか」は NORTH_STAR が勝つ。
データ経路は [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md)（ランタイムは静的 data のみ）。

**鮮度の保証**: `node scripts/check_architecture_doc.js` が、この文書と実ファイルの
食い違い（未記載のルートJS／存在しないファイルへの言及）を検出する。
2026-08-01 に旧版を全面改稿した — 旧版は50行・12ファイル言及で、**当時44あったルートJSのうち37が
未記載**、しかも存在しないファイル（game .js）を案内していた。地図が territory の16%しか
覆っていないことが、繰り返し起きた「調べたら実は違った」の主因だった。

規模（2026-08-01 実測）: ルートJS **46ファイル / 20,372行**、docs 25、tests 66、scripts 257(py)。

---

## 0. 最初に知るべき5つの罠

過去に実際に踏んだもの。ここを読まずにコードへ入ると同じ穴に落ちる。

| # | 罠 | 実際 |
|---|---|---|
| 1 | **マップ生成が3系統ある** | `logic_map.js`(旧) / `logic_map_rural_v29.js`(PS農村盤面、現行120hex) / `logic_map_city.js`(廃墟都市400hex)。両方が enabled の現状は **RuralV29 が先に選ばれる**。実際の優先順は `logic_game.js` のマップ生成分岐を正とする |
| 2 | **戦闘コアが2系統ある** | `logic_game.js`(ターン制・AP経済) と `sim_*.js`(RTwP・100ms tick)。本編は現在RTwPが既定で、`?rtwp=0` の時だけ旧ターン制へ切り戻す（§3） |
| 3 | **`const` はグローバルだが `window` に載らない** | `data.js` の `WPNS` / `MAP_W` / `MAP_H` / `TERRAIN` は `const` 宣言。素の識別子では見えるが `window.WPNS` は **undefined**。依存チェックを `window[name]` だけで書くと本番で必ず失敗する |
| 4 | **地形idは本編TERRAIN空間で、拡張がある** | `TERRAIN`(data.js) は -1..5。`RuralV29Map` が **4=廃屋 / 6=建物 / 7=畑** を追加する。`SIM_TUNING.TERRAIN_COVER` のコメントは合成マップ時代の名前で書かれていて紛らわしい |
| 5 | **「v1簡略化」の名残が生きている場合がある** | 例: MapApi の `hasLos` は長らく `() => true` のスタブだった（2026-07-31に実装）。`// v1:` `簡略化` `暫定` を見たら**まだそのまま**かを疑う |

headless(node) で本編モジュールを読むときの順序: `data.js` → `logic_math.js`(hexDist) →
マップ生成 → `sim_battle_adapter.js`。`logic_math.js` を飛ばすと `hexDist is not defined` で落ちる。

---

## 1. 全体の流れ

```
index.html ──> logic_campaign.js  (キャンペーン/ラン構造・ユニット工場・永続化)
                    │
                    └─> logic_game.js  BattleLogic  (1戦闘。map/units/UI/AI を保持)
                            │
                            ├─ 生成: RuralV29Map or CityMap or MapSystem → game.map[q][r]
                            ├─ 描画: phaser_bridge.js (MainScene) ─> phaser_terrain*/phaser_unit/phaser_vfx
                            ├─ 入力: handleClick / handleRightClick
                            └─ 戦闘: [既定] logic_battle_rtwp.js が接ぎ木 / [?rtwp=0] 自前のターン処理
```

**接ぎ木の要（これだけは覚える）**: `phaser_unit.js` の `UnitView.update()` は毎フレーム
`window.gameLogic.units` を走査し、各ユニットの `q / r / hp` から描画を同期する。
したがって**units へ書き戻せば描画は自動的に追従する**。RTwP はこの1点だけで成立している。

### ゲーム状態（ターン制）
- `BattleLogic.state`: INIT → PLAY / ANIM / WIN
- `interactionMode`: SELECT / MOVE / ATTACK / MELEE
- `endTurn()` → 敵ターン → PLAY、AP回復。RTwP ではこの経路を通らない

### 主なグローバル
`window.gameLogic`(BattleLogic) / `window.campaign` / `Renderer`(phaser_bridge) /
`window.RtwpBattle` / `Sfx` / `VFX`。
**`WPNS` `TERRAIN` `SIM_TUNING` `MAP_W` `MAP_H` は `const`（window に無い）**。

---

## 2. ルートJS 一覧（全44ファイル）

### 2.1 エントリと基盤

| ファイル | 行 | 役割 |
|---|---:|---|
| `index.html` | 610 | 本編エントリ。全スクリプトの読み込み順を持つ（**順序に依存**） |
| `data.js` | 601 | 武器 `WPNS` / 地形 `TERRAIN` / 盤面 `MAP_W,MAP_H` / `BATTLE_SCALE` / **`SIM_TUNING`（RTwPの全数値）** |
| `logic_math.js` | 62 | 純粋な座標・距離・**命中率** (`computeHitChance`)。`hexDist` もここ |
| `logic_combat_rules.js` | 94 | logic_game.js から切り出した弾薬・移動の規則。headless テスト可 |
| `data_buildings.js` | 28 | Panzer Strike 抽出建物のカタログ |
| `mission_config.js` / `mission_loader.js` | 30 | ミッション埋め込みの既定値と読み込み |
| `tactics_morph.js` | 174 | 知略ダイヤル（classic/chaos プリセット間の lerp） |

### 2.2 メタゲーム / 戦闘（ターン制・既定）

| ファイル | 行 | 役割 |
|---|---:|---|
| `logic_campaign.js` | 797 | ラン構造・**ユニット工場（`unit` オブジェクトの形はここが正）**・報酬・永続化 |
| `logic_game.js` | **2154** | `BattleLogic`。1戦闘の全て。**最大の塊**。AP経済・`endTurn()`・命中・射撃・移動 |
| `logic_ai.js` | 381 | 敵AI（ターン制用）。**遮蔽を自衛に使う概念が無い**（RTwP側 `sim_policy` が担当） |
| `logic_ui.js` | 523 | サイドバー/ログ/コンテキストメニューのDOM生成。RTwP中のAction可否はsim弾薬を参照 |
| `logic_reaction.js` | 120 | 被弾リアクション規則 |
| `logic_support.js` | 60 | 支援効果（データ駆動） |
| `loadout_weight.js` | 158 | 装備重量 → 実効速度・移動コスト |
| `battle_cloud.js` | 528 | 「戦雲」= 同一hex＋隣接hexの密集を1つの塊として扱う |
| `battle_cloud_tactics.js` | 264 | 戦雲を踏まえた行動判断（味方・敵共通） |

### 2.3 RTwP コア（NORTH_STAR §7 の新コア。Phaser非依存・headless実行可）

| ファイル | 行 | 役割 |
|---|---:|---|
| `sim_core.js` | 986 | 固定tick・状態機械・射撃/制圧/士気。実弾数単位の弾倉経済。`SimCore` `toSimWeapon` `mulberry32` |
| `sim_policy.js` | 602 | 無命令時の行動（トレイト差分）・自動Cover・指示によるCover |
| `sim_orders.js` | 184 | 命令キューと**伝達遅延**（§3.4 の独自性の核） |
| `sim_leader.js` | 284 | 分隊長AIのドクトリン（後退/遮蔽/集中射撃/制圧/撃ち方やめ） |
| `sim_battle_adapter.js` | 492 | 本編の地形グリッド → sim の `MapApi`。**LOS(`hexLine`/`makeHasLos`)もここ**。戦術ポーズ中の敵クリックを命令として受けられる |
| `logic_battle_rtwp.js` | 724 | **本編への接ぎ木**。既定で起動（`?rtwp=0` で無効）。units への書き戻しとUI配線。手動射撃Action・カード増援・戦術ポーズ命令もRTwPへ接続 |
| `sim_scene.js` | 343 | sim 単体のPhaserビュー（`sim_battle.html` 以前の検証用） |

命令の形は必ず `{ type, soldierIds: [...], payload: {...} }`。型は
`MOVE_TO` / `TARGET` / `FIRE_MODE` / `HOLD_POS` / `TAKE_COVER` / `ASSAULT` / `GRENADE`。

### 2.4 マップ生成（**3系統。どれが動くかを必ず確認する**）

| ファイル | 行 | 役割 | 状態 |
|---|---:|---|---|
| `logic_map_city.js` | 1165 | WW2廃墟都市。hex_tiles_v7 を組み合わせ **400hex全面**を決定論シードで生成 | **既定(enabled)** |
| `logic_map_rural_v29.js` | 427 | PS農村HD背景と地形台帳を使う盤面。現行生成物は **12列×10段・120hex**、論理背景1600×1000 | 条件付き（現行優先） |
| `logic_map.js` | 384 | 旧 `MapSystem`（経路・距離）。`CityMap.enabled=false` の時のフォールバック | 温存 |

### 2.5 描画（Phaser）

| ファイル | 行 | 役割 |
|---|---:|---|
| `phaser_bridge.js` | **1441** | `MainScene`。カメラ・入力・更新ループ。右ペイン幅変更時の再フィット、**RTwPと戦術ポーズ図の駆動もここから** |
| `phaser_unit.js` | 625 | `UnitView`。**units を読んで描画を同期する（接ぎ木の受け口）**。姿勢別の肩・銃身高を基準に銃口座標を出し、兵士影を共通アルファ光空間へ同期する |
| `phaser_soldier_view.js` | 702 | 本番・検証共通の19モーション実スプライト。manifestの8方向順と射撃対象への姿勢を対応させ、影も現在フレームへ同期する |
| `phaser_minimap.js` | 98 | 本番・検証共通の戦術ミニマップ。現在視野を枠表示し、クリック地点へ主カメラを移す |
| `phaser_terrain.js` | 724 | hex地形の基本描画 |
| `phaser_terrain_v7.js` | 449 | hex_tiles_v7（廃墟都市）レンダラ。**CityMap を描くのはこれ** |
| `phaser_terrain_rural_v29.js` | 346 | PS農村盤面（現行120hex）のHD背景画像レンダラ |
| `phaser_terrain_v1_bake.js` | 156 | v1地形のランタイム焼き込み |
| `phaser_alpha_light.js` | 207 | 建物・木・兵士を同じPNGアルファ空間で処理する共通光源。黒いアルファ減光マスクによる左上太陽投影影と、マズル閃光の輪郭光・逆向き短時間影を生成 |
| `phaser_tactical_pause.js` | 271 | 一時停止時の戦術判断レイヤー。戦場のグレー化、全兵士の行動札、射撃対象矢印、移動先、選択兵詳細を本編・検証画面で共用 |
| `phaser_ps_objects.js` | 584 | 立体物（建物/木/柵）を生きたスプライトで持つ層。地面直上の専用影レイヤー、破壊差し替え、共通アルファ太陽影、遮蔽付きマズル照明 |
| `phaser_vegetation_layer.js` | 457 | 植生層 |
| `phaser_decals.js` | 140 | 着弾痕の焼き込み |
| `phaser_scene_composition.js` | 113 | シーン合成（層の積み順） |
| `phaser_vfx.js` | 663 | 爆発・火花・既存煙アニメ・実弾数に対応する銃口発光・発砲時の地面反射/アルファ輪郭リム（射線ラインは廃止） |
| `phaser_sound.js` | 401 | 音。**武器コードでラウンドロビン**（`variantGroups` / `weaponSfx`）。非アクティブ化でWAV/シンセを停止し、古いAction世代を破棄 |
| `phaser_sidebar.js` | 785 | 右パネルをPhaserで描画（ユニット情報・LOADOUT・ログ・RTwP実弾倉/予備弾）。狭い画面では戦場幅を確保するよう可変 |
| `phaser_battle_cloud.js` | 728 | 戦雲の描画 |

### 2.6 PL（Panzer Strike 由来）武器データ

| ファイル | 行 | 役割 |
|---|---:|---|
| `pl_st_weapon_ammo.js` | 351 | **装填互換の唯一の正**（生成元: `scripts/build_pl_st_compat.py`） |
| `pl_item_catalog.js` | 34 | PL アイテムのカタログ |
| `pl_infantry_loadout.js` | 58 | 歩兵が主装備に持てる PL 武器の判定 |
| `pl_weapon_icon.js` | 19 | PL 武器アイコンの解決 |

---

## 3. RTwP はどう接ぎ木されているか

NORTH_STAR §7 の Strangler Fig。**`logic_game.js` は一行も書き換えていない。**

```
index.html（RTwP既定。旧ターン制だけ `?rtwp=0`）
   └─ phaser_bridge.js MainScene.update()
        ├─ RtwpBattle.attach(gameLogic)        ← 初回のみ
        └─ RtwpBattle.instance.update(delta)   ← 毎フレーム
              ├─ sim.tick() を最大5回/frame（固定100ms）
              ├─ LeaderPolicy.assess() → sim.issueOrder()（伝達遅延あり）
              ├─ drainEvents() → VFX / Sfx / ui.log
              └─ syncUnits(): sim の q,r,hp,suppression を **units へ書き戻す**
                              → UnitView が勝手に追従する
```

UI は `gameLogic` の**インスタンスメソッドを包む**方式（クラスは触らない）:
- 右クリック → `orderMove`　/　END TURN → 一時停止トグル
- Space=停止 / 1,2,3=速度 / F=集中射撃 / S=制圧射撃 / C=遮蔽に入れ
- `RtwpBattle.detach()` で**元の実装とDOMが完全に戻る**

切り戻し: URLへ `?rtwp=0` を付ける。または `RtwpBattle.enabled = false`。

---

## 4. 検証の仕組み（prose ではなく機構）

| コマンド | 何を見るか |
|---|---|
| `node tests/rtwp_battle.test.js` 等 | 各ユニットテスト（`tests/` に66件。フレームワーク非依存） |
| `node scripts/check_slice_v2.js` | NORTH_STAR §7.4 受入基準の実測（RTwP移行の門） |
| `node scripts/check_flanking.js` | §7.4 基準2（側面機動）。盤面が狭いと測れない旨も出す |
| `node scripts/check_architecture_doc.js` | **この文書と実ファイルの食い違い** |
| `python scripts/audio/wav_chop.py` | 長尺WAV → 単発音の切り出し（`scripts/audio/README.md`） |

既知の失敗: `tests/map_city.test.js`（石畳flip。`logic_map_city.js` 作業中の既存failure）。

---

## 5. 今の未了・既知の穴

- **§7.4 の門は未通過**: 基準1=4/5、基準2は盤面規模の問題で未達、基準5未測定。
  旧ターン制コアの退役はまだ早い（`scripts/check_slice_v2.js` で現在地が出る）。
- **RTwP はキャンペーン本流で起動・操作確認済み**: 2026-08-01、RuralV29上で停止/再開・移動命令・ログ/UI配線を実ブラウザ確認。
- **戦車は RTwP 未対応**: 武器解決できないユニットは登録をスキップする（`_rtwpSkipped`）。
- **三大の塊**: `logic_game.js` 2088 / `phaser_bridge.js` 1444 / `logic_map_city.js` 1165。
  分割の第一候補（§6）。

---

## 6. リファクタの方針（未着手・提案）

**原則**: 動いているものを止めない。分割は「新モジュールへ切り出して旧を残す」→
「呼び出しを移す」→「旧を消す」の3段で、各段でテストを通す。
**着手前に作業ツリーの未コミット分を整理すること**（衝突事故の実績あり）。

1. ~~`logic_game.js` から純粋計算を抽出~~ → **第1段 完了（2026-08-01）**。
   `logic_combat_rules.js`（弾倉充填率・弾薬余剰消費・移動予算）。
   命中率は既に `logic_math.js` にあった（着手前に実測して判明）。
   委譲後と移設元を91ケースで突合し不一致0件。`tests/combat_rules.test.js` 27件。
   **次に測るべき塊**: `consumeAmmo`(87行/this参照3) — 弾種ごとの消費規則。
   `logic_game.js` のメソッド別行数は `python scripts/profile_methods.py` で出せる
2. `phaser_bridge.js` から**入力**を `phaser_input.js` へ分離（RTwP/ターン制の分岐が入り組む）
3. マップ3系統の**選択ロジックを1箇所へ**（現状は各所で `CityMap.active` 等を個別に見ている）
4. `logic_game.js` のターン処理は **RTwP が §7.4 を通ってから**退役（NORTH_STAR §7 の順序）
