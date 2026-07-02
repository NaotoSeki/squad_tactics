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
| PHIT_MOVING_OPEN_MULT | 4.0 | 開豁地を移動中の目標 |
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

## 11. 実装者への納品物と検収

1. `sim_core.js`（mulberry32・toSimWeapon・InstantOrders・DefaultPolicy 同梱）
2. data.js 末尾に `SIM_TUNING`（既存コードに影響しないこと — 追記のみ）
3. `tests/sim_core.test.js`（`node tests/sim_core.test.js` で T1〜T7、失敗時 exit 1）
4. `dev_sim.html`
5. 検収=メインが node でテスト実行 + dev_sim.html 目視。**テスト green の自己申告は検収に代えない**
