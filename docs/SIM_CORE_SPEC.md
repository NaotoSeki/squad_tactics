# SIM_CORE 実装仕様 v1.0（WS-A）

**上位**: [NORTH_STAR.md](NORTH_STAR.md) §3・§7（本書は実装詳細。方針の矛盾は NORTH_STAR が勝つ）
**制定**: 2026-07-03
**実装レーン**: Sonnet（設計・検収はメイン、批判は critic）

## 0. スコープ

WS-A = `sim_core.js` + `sim_tuning`（data.js 末尾）+ `tests/sim_core.test.js` + `dev_sim.html`。
**含まない**: 伝達遅延（WS-B `sim_orders.js`）、トレイト（WS-C `sim_policy.js`）——ただし両者の**インターフェースは本書で確定**し、プレースホルダ実装を同梱する。
既存コード（logic_game.js 等）には**一切手を触れない**（Strangler Fig）。

## 1. 設計原則（NORTH_STAR §7.3 の具体化）

1. **純JS・依存ゼロ・ヘッドレス**: `sim_core.js` は `window`/`document`/Phaser/`setTimeout` を参照しない。node で `require` できる形（末尾に UMD 風エクスポート: `if (typeof module !== 'undefined') module.exports = {...}` + ブラウザでは グローバル公開）
2. **決定論**: RNG は注入（seeded）。同 seed → 同イベント列。`Math.random` 使用禁止
3. **シミュは描画を待たない**: tick() は同期関数。await・コールバック・タイマーなし。描画への出力はイベントバッファのみ
4. **意思決定は純関数評価**: 状態を試しに変更して評価する破壊的プローブ禁止
5. **数値は SIM_TUNING に集約**: 本書 §6 の表が唯一の初期値。コード内マジックナンバー禁止

## 2. 公開API

```js
const sim = new SimCore({
  map,      // §3 MapApi
  tuning,   // SIM_TUNING オブジェクト
  rng,      // () => [0,1) 決定論的乱数（mulberry32 を同梱）
  policy,   // §8 Policy（省略時 DefaultPolicy）
  orders,   // §8 OrdersApi（省略時 InstantOrders）
});
sim.addSoldier(spec)      // §4 SoldierSpec → soldierId
sim.tick()                // 100ms ぶん進める（同期）。ポーズ=呼ばない、2x=2回呼ぶ
sim.issueOrder(order)     // §8 Order。orders モジュール経由で配達される
sim.getSoldier(id) / sim.soldiers()   // 読み取り専用スナップショット（コピー）
sim.drainEvents()         // 前回 drain 以降の SimEvent[] を返しバッファを空に
sim.result()              // null | { winner, reason, tick }
```

## 3. MapApi（logic_map.js への依存を注入で切る）

```js
map = {
  dist(a, b),              // hex距離（{q,r}）
  hasLos(a, b),            // boolean
  cover(hex),              // 0..1（0=開豁、0.6=塹壕/建物級）
  moveCost(hex),           // 1..（99=不可）
  neighbors(hex),          // [{q,r}]
}
```
ブラウザでは logic_map.js / data.js 地形をラップするアダプタ、テストでは格子スタブを渡す。**sim_core は logic_map を直接 require しない。**

## 4. データ形

### SoldierSpec（入力）
```js
{ id, team, q, r, name,
  weapon: SimWeapon,          // §5 のアダプタ済み武器
  ammo: { mags: 5 },          // 予備弾倉数
  grenades: 1,
  skill: 1.0,                 // 命中スカラー 0.7(新兵)〜1.3(古参)
  isLeader: false,            // 分隊長（WS-Bの指揮ノード。routチェックにも使用）
  traits: [],                 // WS-Cへ素通しする文字列配列
}
```

### 内部状態（tickごとに更新）
```js
{ ...spec, hp: 100, state, stateT,        // state: NORTH_STAR §3.1 の9値, stateT: 現状態の経過tick
  suppression: 0..100, morale: 100,
  magRemaining, magsLeft, fireMode,        // 'aimed'|'suppress'|'hold'
  facing,                                  // 最後の射撃/移動方向（側面判定用）
  currentOrder, movePath, aimT, reloadT }
```

### SimEvent（描画・ログ・テストの唯一の出力）
`{ tick, type, ...payload }`。type 一覧:
`SHOT { shooterId, targetId, hit, killed, crit }` / `SUPPRESSED { id }` / `PINNED { id }` / `RECOVERED { id }` /
`HIT { id, hp }` / `DOWN { id }` / `ROUT { id }` / `RELOAD_START/RELOAD_END { id }` /
`MOVE { id, from, to }` / `GRENADE { id, target }` / `ASSAULT { id, targetId, won }` /
`ORDER_DELIVERED { id, order }` / `STATE { id, from, to }` / `AMMO_OUT { id }` / `RESULT { winner, reason }`

## 5. 武器アダプタ

`toSimWeapon(wpnsEntry)` を sim_core 内に同梱。WPNS/PL マスタから:

```js
{ code, burstSize, burstIntervalT,  // 連射間隔（tick数）
  aimT,                             // 射撃開始前の照準tick
  magCap, reloadT, switchT,
  rngMax, rngMin,
  accBase,                          // §6 の pHit 基礎（武器クラス別）
  suppressPerBurst,                 // 制圧付与
  class: 'rifle'|'smg'|'mg'|'sniper'|'pistol'|'at' }
```
クラス判定は WPNS の type/burst/rng からのヒューリスティック + `SIM_TUNING.WEAPON_CLASS_OVERRIDES[code]`。v2.0スライスは rifle/smg/mg/sniper の4クラスが動けば合格。

## 6. SIM_TUNING 初期値（data.js 末尾に追加する唯一のテーブル）

| キー | 初期値 | 意味 |
|------|--------|------|
| TICK_MS | 100 | 1tick実時間 |
| DECISION_INTERVAL_T | 5 | AI意思決定周期（兵ごとに位相をずらす） |
| PHIT_BASE | rifle .04 / smg .05 / mg .05 / sniper .08 | 有効射程・遮蔽下の1バースト命中 |
| PHIT_RANGE_FALLOFF | 近(≤1/3 rng)×1.5 / 中×1.0 / 遠×0.5 | 距離帯倍率 |
| PHIT_EXPOSED_MULT | 3.0 | 遮蔽なし目標 |
| PHIT_MOVING_MULT | mg 4.0 / default 1.5 | 移動目標はhex遮蔽を享受しない。MGのみ強罰（§14 C裁定） |
| FOCUS_PHIT_PENALTY_PER_EXTRA / FLOOR | 0.15 / 0.4 | 同一目標へ3人以上→pHit逓減。集中射撃=速くpinするが殺せない（§14 D裁定） |
| PHIT_FLANK_MULT | 6.0 | 側面/背面（遮蔽無効化と排他でなく置換: cover を無視して ×6） |
| PHIT_SHOOTER_SUPPRESSED / PINNED | 0.5 / 0.25 | 射手が制圧下 |
| PHIT_AIMED / SUPPRESS_MODE | 1.5 / 0.6 | 射撃モード |
| CRIT_EXPOSED | 0.005 | 露出目標への即倒クリット/バースト |
| DMG_HIT | 40±20 | 被弾ダメージ（hp100） |
| SUPPRESS_PER_BURST | rifle 8 / smg 10 / mg 22 / sniper 15 | 至近弾の制圧付与 |
| SUPPRESS_DECAY | 6/秒（静穏3秒後から） | 減衰 |
| SUPPRESSED_AT / PINNED_AT | 50 / 80 | 閾値 |
| MORALE_CASUALTY_NEAR | -15（3hex内の味方死亡） | |
| MORALE_LEADER_DOWN | -25 | |
| MORALE_PINNED_DRAIN | -1/秒 | |
| ROUT_CHECK_BELOW | 30（5秒ごとに morale/100 判定） | |
| RELOAD_T | rifle 30 / mg 80 | tick |
| BURSTS_PER_MAG | rifle 12 / smg 12 / mg 28 / sniper 10 | 1マガジンのバースト数（実弾数w.capの直流しを廃止 — §14 B裁定） |
| DEFAULT_MAGS | rifle 6 / smg 4 / mg 4 / sniper 6 | 予備弾倉。MGが8〜10分で先に沈黙する配分 |
| SWITCH_T | 30 | 持ち替え |
| AIM_T | aimed 20 / suppress 8 | |
| BURST_INTERVAL_T | aimed: rifle 30 smg 25 mg 20 / suppress: 半分 | |
| GRENADE_RNG / FUSE_T / SUPPRESS / DMG | 2 / 30 / 60 / 70±30 | |
| ASSAULT_WIN_VS_PINNED / VS_ACTIVE | 0.85 / 0.30 | 突撃判定 |
| MOVE_T_PER_HEX | 8（×地形コスト、伏せ×2） | |

**全値は「要プレイテスト」**。実装は表を data.js の `const SIM_TUNING = {...}` として転記し、コードは参照のみ。

## 7. tick パイプライン（この順で固定）

1. **orders.deliveries(tick)** を回収 → 各兵の currentOrder 更新（`ORDER_DELIVERED`）
2. **意思決定**（DECISION_INTERVAL_T ごと・兵ごとに位相分散）: currentOrder があればそれに従う。なければ `policy.decide()`（§8）
3. **行動進行**: 状態ごとのタイマー消化 — move（1歩/MOVE_T）、engage（aimT→バースト解決→interval）、reload、switch、assault、grenade
4. **射撃解決**: pHit 計算（§6）→ hit/suppression 適用。弾消費。マガジン空→自動リロード（予備なし→`AMMO_OUT`→hold）
5. **制圧減衰・士気**: decay、閾値跨ぎイベント、rout チェック
6. **勝敗判定**: 片軍全滅/全rout → `RESULT`

## 8. WS-B / WS-C との契約（本書で確定、プレースホルダ同梱）

```js
// OrdersApi（WS-B が実装。WS-A は InstantOrders: 即時配達を同梱）
orders = { queue(order, tick), deliveries(tick) /* -> [{soldierId, order}] */ }

// Order
{ type: 'MOVE_TO'|'FIRE_MODE'|'TARGET'|'ASSAULT'|'GRENADE'|'HOLD_POS',
  soldierIds: [], payload: {...} }

// Policy（WS-C が実装。WS-A は DefaultPolicy を同梱:
//   射程内に可視敵→engage / 被制圧→現在遮蔽で伏せ / 弾切れ→reload / それ以外→idle）
policy = { decide(soldierView, worldView, rng) /* -> intent */ }
// soldierView/worldView は読み取り専用スナップショット。intent は Order と同形
```

## 9. テスト（tests/sim_core.test.js — フレームワークなし・node直実行・exit code）

| # | シナリオ | 合格条件（NORTH_STAR §7.4 対応） |
|---|---------|------|
| T1 膠着 | cover0.6 で対峙する 6v6、1800tick（3分） | 死者 各軍≤1・SHOT≥50・制圧イベント発生（基準1） |
| T2 側面 | T1+側面射手1名 | 側面射の命中数がシード20本平均で正面の≥4倍（基準2） |
| T3 制圧 | MG1→rifle1 持続射撃 | 30秒以内に PINNED、射撃停止15秒で RECOVERED |
| T4 弾薬 | suppress モード連射 | 約40秒で RELOAD_START、予備切れで AMMO_OUT→hold |
| T5 敗走 | pinned 側に死者2 | 30秒以内に ROUT 発生（シード20本中≥14） |
| T6 決定論 | 同シード2回実行 | イベント列の JSON 文字列が完全一致 |
| T7 性能 | 24名×1800tick | node で <500ms |

## 10. dev_sim.html（軽量ハーネス — 44KB精神）

単一ファイル・canvas 2D・ライブラリなし・500行以内。機能: hex を色タイルで描画（cover 濃淡）/ 兵は丸+状態色+制圧バー / イベントログペイン / pause・1x・2x / seed 入力+再実行 / クリック選択→右クリック移動命令（InstantOrders 経由）。見た目は問わない。**手触り検証器**であり製品UIではない。

## 11. 実装者への納品物と検収（WS-A）

1. `sim_core.js`（mulberry32・toSimWeapon・InstantOrders・DefaultPolicy 同梱）
2. data.js 末尾に `SIM_TUNING`（既存コードに影響しないこと — 追記のみ）
3. `tests/sim_core.test.js`（`node tests/sim_core.test.js` で T1〜T7、失敗時 exit 1）
4. `dev_sim.html`
5. 検収=メインが node でテスト実行 + dev_sim.html 目視。**テスト green の自己申告は検収に代えない**

---

## 12. WS-B: sim_orders.js（命令伝達コスト — NORTH_STAR §3.4）

**触ってよいファイル**: `sim_orders.js`（新規）・`tests/sim_orders.test.js`（新規）・data.js の `SIM_TUNING` オブジェクト内へのキー追加のみ。**sim_core.js / dev_sim.html は変更禁止**（統合はメイン）。

```js
class CommsOrders {            // §8 OrdersApi を実装
  constructor({ getSoldier, soldiers, map, tuning })
  queue(order, tick)           // 配達予定 tick を計算して保持
  deliveries(tick)             // 期日到来分 [{soldierId, order}] を返す
}
```

遅延規則（対象兵ごとに個別計算。NORTH_STAR §3.4 の表を tick 化）:
1. `tick === 0`（作戦フェーズ）→ 遅延 0
2. 発令者 = 同チームの生存 `isLeader` 兵。`dist(leader, 対象) <= COMMS_VOICE_RNG(2)` かつ `hasLos` → `COMMS_VOICE_DELAY_T(10)`
3. それ以外 → `dist × COMMS_RUNNER_T_PER_HEX(10)`
4. 対象兵が `hasRadio`（SoldierSpec 任意フィールド、なければ false）→ 固定 `COMMS_RADIO_DELAY_T(30)`（2 より遠い場合のみ有利）
5. リーダー死亡 → 全遅延 ×`COMMS_LEADER_DOWN_MULT(3)`。死亡 tick から `COMMS_SHOCK_T(300)` の間は配達自体を停止（期日を後ろへずらす）

テスト（node 直実行・exit code・決定論）: 近傍1秒 / 遠隔の距離比例 / 無線 / リーダー死亡×3+ショック停止 / `node tests/sim_core.test.js` が引き続き green（回帰なし）。

## 13. WS-C: sim_policy.js（トレイト行動 — NORTH_STAR §4.1）

**触ってよいファイル**: `sim_policy.js`（新規）・`tests/sim_policy.test.js`（新規）のみ。**sim_core.js / data.js / dev_sim.html は変更禁止**。

`TraitPolicy` は §8 Policy を実装。baseline は sim_core 同梱 DefaultPolicy と同等の分岐から開始し、`soldierView.traits` で行動を変える。数値は `sim_policy.js` 内の `TRAIT_MODS` テーブルに集約（マジックナンバー禁止）。

| trait（英字コード） | 行動差（v1 は行動のみ。sim_core 側の数値変更は範囲外） |
|---|---|
| `aggressive` 攻撃的 | 交戦開始距離 +2hex。無命令時の既定 fireMode='suppress' |
| `cautious` 慎重 | cover < 0.3 の hex へ**自発的に**移動しない（明示命令には従う） |
| `calm` 冷静 | 距離が rngMax×2/3 以下になるまで射撃を開始しない |
| `timid` 臆病 | suppression ≥ 40 で自発行動を停止（現位置で沈黙） |

- intent に任意の `note: string`（例: `'攻撃的: 独断で射撃開始'`）を付けてよい。可視化（吹き出し/ログ）はメインが統合
- 鷹の目（crit 倍率）は sim_core 側対応が必要なため**範囲外**（メイン統合待ち）

テスト: 同一シナリオ・同一シードで DefaultPolicy と各トレイトのイベント列を比較 — aggressive が先に SHOT / cautious が開豁地へ MOVE しない / calm の初 SHOT が近距離まで出ない / timid が sup≥40 で行動停止 / 決定論（同シード同列）。

---

## 14. バランス検収記録（critic 2026-07-03）と宿題

外部調査（Gemini産・弾薬タイムライン）を critic が検収した裁定の要約。詳細な数値根拠は本節の値が反映済み。

- **A 史実性**: 「長時間戦闘の実態は膠着＋断続突撃」（主張5）は膠着設計の裏付けとして採用。弾薬数は**桁のみ採用**（一次裏取りなし。レンジを仕様に直書きしない）
- **B 弾薬経済**: magCap=実弾数の直流しは意味論崩壊 → BURSTS_PER_MAG 新設。MG=分隊火力の主柱が先に沈黙し「制圧が消えた瞬間に膠着が動く」締め付け構造
- **C 移動致死**: 「移動中は遮蔽を失う」を採用しつつ、MGのみ×4・他×1.5（全武器×4は側面機動を自殺行為化し §7.4 基準2 と矛盾するため却下）
- **D 集中射撃**: 史実妥当だが膠着設計の最大の破壊者 → pHit重複ペナルティで「集中=速くpin、殺すのは機動/手榴弾/突撃」を維持

### 宿題（未実装・要設計）

1. **弾切れ→決断の機構**: AMMO_OUT 後の兵は hold で固まるだけ。「終盤に突撃/白兵/後退の決断を迫る」ドラマは弾薬値だけでは生まれない（policy/命令側の設計課題。銃剣突撃・弾薬融通・後退命令）
2. **crawl/dash の機動技術**: 伏せ移動（遅いが移動ペナルティ減免）と遮蔽間短距離ダッシュ減免。機動の正解ルートを作る
3. **射撃分配命令**: 「班にゾーンを与える」粒度の分配（集中射撃の対、NCO采配個性の軸）

---

## 15. WS-D: Phaser 製品ビュー接続（sim_scene.js + sim_game.html）

**上位**: NORTH_STAR §7.1「phaser_bridge 拡張」/ §7.4 基準6。**目的**: dev_sim の手触りを、既存アセット（地形タイル・兵士スプライト・VFX）で描く製品ビューにする。

**Strangler Fig 原則**: index.html（凍結ターン制ビルド）と phaser_bridge.js の MainScene には**一切触れない**。sim_core を描く**新規シーン**を並列エントリとして作る。

### 15.1 再利用マップ（結合度調査に基づく確定）

| モジュール | 結合度 | 扱い |
|-----------|--------|------|
| phaser_vfx.js（`window.VFX` = VFXSystem シングルトン） | ターン制状態への結合ゼロ | **直接再利用**。`VFX.update()`→`VFX.draw(graphics)` 毎フレーム。`addBulletImpact`/`addExplosion`/`addRocket`/`addSmoke` |
| phaser_sound.js（`window.Sfx`） | ほぼゼロ | 直接再利用 |
| phaser_terrain.js（`window.TerrainRender.buildMap`） | ゼロ | D2で再利用。D1は簡易hexタイル |
| phaser_unit.js（UnitView） | `gameLogic.units` を毎フレーム走査（9箇所） | **再利用しない**。sim兵士は形が違う。sim_scene が独自の軽量スプライト管理を持つ（soldier_crawl等のアセットは共用） |
| phaser_bridge.js MainScene | ターン制オーケストレーション | **触らない** |

### 15.2 駆動ループ（最重要 — 「シミュは描画を待たない」の技術的強制）

Phaser の `update(time, delta)` 内で**固定タイムステップ・アキュムレータ**:
```
acc += delta * speed          // speed: 0(pause)/1/2
let n = 0
while (acc >= TICK_MS && n < MAX_CATCHUP) { sim.tick(); acc -= TICK_MS; n++ }  // MAX_CATCHUP=5 でスパイラル防止
dispatch(sim.drainEvents())   // イベント→VFX/SFX/フロートテキスト
renderSprites()               // スプライト位置は hex目標へ lerp（10Hzシミュを60fpsで滑らかに）
VFX.update(); VFX.draw(g)
```
- **sim は10Hz、描画は60fps、スプライトは補間**。これが v1 の軽快さと RTwP の両立点。
- tick は同期・副作用は drainEvents 経由のみ（sim_core の鉄則を破らない）。

### 15.3 イベント→ビジュアル対応

| SimEvent | ビジュアル（実在API） |
|----------|----------------------|
| SHOT (miss) | 曳光線 shooter→target（graphics線, 3〜4フレーム） + マズル閃光 |
| SHOT (hit) | 上記 + `VFX.addBulletImpact(tx,ty,burst)` |
| DOWN | `VFX.addExplosion(x,y,'#c33',6)` + スプライト死亡表現（伏せ+暗色） |
| GRENADE | `VFX.addRocket(sx,sy,ex,ey,onHit)` → onHit で `addExplosion` |
| PINNED/SUPPRESSED | スプライト tint（土色）+ `addSmoke` 散発 |
| POLICY / ORDER_DELIVERED | 頭上フロートテキスト（吹き出し、6秒フェード） |
| ROUT | フロート「敗走!」+ スプライト後退 |

### 15.4 受け入れ基準（§7.4 基準6）

1. sim_game.html が 5v5 塹壕戦を**実地形タイル + 兵士スプライト + VFX曳光/着弾**で描く
2. pause / 1x / 2x、クリック選択 + 右クリック移動命令（CommsOrders経由の遅延つき）
3. **≥55fps**（Phaserデバッグや `performance` で確認）、強制待機ゼロ（await なし）
4. MG★・トレイト・射撃節制の吹き出しが製品ビューでも読める
5. **VFX再利用率を報告**（新規描画コード行 vs phaser_vfx 流用）
6. index.html / phaser_bridge.js を diff �ーロで無変更

### 15.5 分割

- **D1（メイン直轄・本スプリント）**: 駆動ループ + シーン骨格 + 兵士スプライト + VFX曳光/マズル/着弾 + 入力 + 簡易hexタイル
- **D2（委譲可）**: TerrainRender.buildMap の統合（美麗タイル）、soldier_crawl 8方向アニメ、サイドバー（phaser_sidebar 流用検討）

---

## 16. WS-F: sim_leader.js — 現場分隊長AIと影響ネットワーク（NORTH_STAR §3.4 三現主義）

**設計思想（ディレクター 2026-07-05）**: 兵士は全員が個人AI（TraitPolicy）を持ち、**周囲の兵士同士がInfluenceし合う。分隊長は特別な機構ではなく、影響ネットワークで最も重みが大きいノード**にすぎない。プレイヤーは神視点だが、命令はWW2通信で遅れて届く——見えているのに介入できないもどかしさが体験の核。

**触ってよいファイル**: `sim_leader.js`（新規）・`tests/sim_leader.test.js`（新規）・`sim_policy.js`（影響ルール追加のみ）・data.js の SIM_TUNING キー追加・dev_sim.html（統合）。**sim_core.js / sim_orders.js は変更禁止。**

### 16.1 LeaderPolicy（分隊長AI）

```js
// sim_leader.js — 純JS・依存ゼロ・決定論（Math.random禁止）
const LeaderPolicy = {
  // 分隊長個体の意思決定周期（LEADER_ASSESS_INTERVAL_T ごと）に呼ばれる。
  // 戻り値: Order[]（sim.issueOrder へそのまま流せる形; 0件なら空配列）
  assess(leaderView, worldView, rng, state) { ... }
};
```
- **命令は必ず CommsOrders を通る**（プレイヤーと同じ経路・同じ遅延）。分隊長が「現場で速い」のは声が届く距離にいるから——三現主義の機構的表現
- **state**（呼び出し側が保持する分隊長ごとの記憶）: `{ lastDoctrine, lastOrderTick, playerLockUntil }`

### 16.2 ドクトリン判定（v1 は4種 + 静観）

優先度順に評価し、**最初に条件を満たした1つだけ**発令。条件は全て SIM_TUNING キー:

| 優先 | ドクトリン | 発火条件（初期値） | 発令内容 |
|---|---|---|---|
| 1 | **FALL_BACK 下がれ!** | 自軍死者≥2 かつ 平均morale<50 | 全員に MOVE_TO（最寄り敵から離れる方向へ2hex、直線パス） |
| 2 | **FOCUS_FIRE あの一点を潰せ!** | 敵1名が露出(cover<0.3)or移動中 かつ 味方≥3名の射程内 | 射程内全員に TARGET(aimed, その敵) |
| 3 | **SUPPRESS_FIRE 頭を上げさせるな!** | 自軍の被制圧者≥2（suppression≥SUPPRESSED_AT） | 各兵に最寄り敵へ TARGET(suppress) |
| 4 | **HOLD_FIRE 撃ち方やめ!** | 交戦なし30秒 かつ 分隊残弾率<40% | 全員に FIRE_MODE(hold) |
| - | 静観 | 上記いずれも不成立 | 空配列 |

- **クールダウン**: 発令後 DOCTRINE_COOLDOWN_T(100tick=10秒) は再評価しても発令しない（命令スパム防止）
- **同一ドクトリン連発禁止**: lastDoctrine と同じで戦況スコアが変わらないなら発令しない
- **プレイヤー命令ロック**: プレイヤー発の命令が届いたら PLAYER_ORDER_LOCK_T(150tick=15秒) は分隊長AIは発令しない（上意下達）。呼び出し側が state.playerLockUntil を更新
- 全発令は `POLICY` イベント相当の note を伴う（「制圧しろ！頭を上げさせるな！」等、吹き出しで分隊長の思考が読める）

### 16.3 影響ネットワーク（sim_policy.js への追加、v1 は2ルールのみ）

一般化した影響グラフは**作らない**（機構の蜜壺）。v1 は効果が読める2ルールだけ:

1. **連鎖射撃**: 2hex以内の味方が2名以上 engage 中なら、散発射撃確率(HARASS_FIRE_P)を INFLUENCE_JOIN_FIRE_MULT(2.0)倍 — 「周りが撃ち始めたら自分も撃つ」
2. **分隊長の存在**: 生存分隊長が LEADER_STEADY_RADIUS(2hex)内にいる兵は、timid の凍結閾値 +LEADER_STEADY_BONUS(20)、散発射撃確率 1.5倍 — 「班長がそばにいると肝が据わる」

将来の拡張（保留棚）: 古参(skill高)の周囲影響、敗走の伝染、NCOドクトリン個性（集中型/分配型/慎重型の重み差）。

### 16.4 テスト（tests/sim_leader.test.js）

| # | シナリオ | 合格条件 |
|---|---|---|
| F1 | 分隊長不在の分隊 | ドクトリン発令ゼロ |
| F2 | 自軍2名が被制圧 | 30秒以内に SUPPRESS_FIRE 発令（ORDER_DELIVERED観測） |
| F3 | 死者2+低morale | FALL_BACK 発令、全員が敵から離れる方向へ移動 |
| F4 | プレイヤー命令直後 | ロック中は分隊長AI発令ゼロ、ロック明けに再開 |
| F5 | 決定論 | 同シード2回で発令列一致 |
| F6 | クールダウン | 連続tickで発令が DOCTRINE_COOLDOWN_T 未満の間隔にならない |

### 16.5 dev_sim 統合

- 各チームの分隊長で LEADER_ASSESS_INTERVAL_T(25tick)ごとに LeaderPolicy.assess を呼び、返った Order を sim.issueOrder へ
- プレイヤーの F/S/移動命令発行時に該当チームの state.playerLockUntil を更新
- 分隊長の発令 note は吹き出し+ログに必ず出す（プレイヤーがNCOの判断を読めることが体験の核）
