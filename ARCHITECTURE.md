# SQUAD TACTICS Architecture

更新日: 2026-08-10

## 1. 実行モデル

本編戦闘はRTwP専用で、`sim_core.js` の固定100ms tickが戦闘状態の正本です。`logic_game.js` の `BattleFacade` はキャンペーン、装備、マップ、描画との互換面を提供しますが、攻撃・移動・決着を進める戦闘ランタイムではありません。

```text
index.html
  ├─ data.js                         武器・能力・スキル・SIM_TUNING
  ├─ logic_campaign.js               編成・永続ユニット・セクター進行
  ├─ logic_game.js                   BattleFacade（本編接続面）
  ├─ sim_core.js                     戦闘状態と固定tick
  ├─ sim_policy.js                   個人判断・トレイト
  ├─ sim_orders.js                   命令伝達
  ├─ sim_leader.js                   分隊長AI
  ├─ sim_actions.js                  画面とホットキーの共有行動カタログ
  └─ logic_battle_rtwp.js            登録・入力変換・イベント・書戻し・決着
```

`logic_battle_rtwp.js` は各キャンペーンユニットをSimCore兵士へ登録し、毎frameの経過時間を固定tickへ変換します。tick後の座標、HP、弾薬、制圧、状態、向きを元ユニットへ書き戻すため、既存Phaser描画は戦闘計算を持たずに追従できます。

## 2. 正本と共有境界

| 正本 | 利用側 |
|---|---|
| `SKILLS` (`data.js`) | キャンペーン付与、サイドバー説明、バッジ、RTwP効果正規化 |
| `SIM_TUNING` (`data.js`) | SimCore、Policy、Orders、Leader、Actions |
| `SimActions` (`sim_actions.js`) | 個人メニュー、複数選択、ホットキー、命令生成 |
| `TRAIT_MODS` / `TRAIT_IDS` (`sim_policy.js`) | 個人判断、本編スキル由来トレイト、検証シーン |
| キャンペーンユニット | 名前、経歴、maxHp、装備、永続スキル、戦果 |
| SimCore兵士 | 戦闘中のHP比率、位置、武器、実弾倉、状態、士気、命令 |

スキルは接続層で `effects` と `traits` へ正規化します。SimCoreはスキルIDや表示文言へ分岐せず、命中、被命中、威力、装甲、弾薬、回復、通信、白兵、動作時間の数値だけを扱います。

## 3. 入力と命令

画面に出す命令は `sim_actions.js` のカタログだけから生成します。

- 個人: MOVE、SUPPRESS_HEX、ASSAULT
- 分隊: FOCUS_FIRE、SUPPRESS_AREA、TAKE_COVER
- 内部行動: 射撃、再装填、走行、匍匐、投擲、白兵

画面入力は命令を直接実行せず、`sim_orders.js` の伝達キューへ入れます。距離、見通し、分隊長、Radioスキルによって配達tickが変わります。

## 4. データ同期

### 戦闘開始

`RtwpInstance.registerUnit()` が武器、実弾倉、投擲物、副武装、能力、スキル効果、トレイト、初期姿勢をSimCoreへ渡します。キャンペーンmaxHpはSimCoreの100HPへ比率変換します。

### 戦闘中

`syncUnits()` がSimCoreから座標、HP、戦果、状態、弾薬を戻します。装備交換時は `syncUnitLoadout()` → `SimCore.updateSoldierLoadout()` が武器・弾薬・能力をまとめて更新します。

航空支援は `SimCore.queueExternalBlast()` に入り、通常爆発と同じtick、イベント、VFX、勝敗判定を通ります。キャンペーンユニットへ直接与えた一時的なダメージは正本になりません。

### 戦闘終了

SimCoreの `result()` が唯一の決着信号です。`finishBattle()` は最終状態を同期してからBattleReviewを保存し、キャンペーンの戦果報告またはゲームオーバーへ渡します。

## 5. テスト

JavaScriptテストはNodeから個別実行できます。

```text
node tests/rtwp_battle.test.js
node tests/rtwp_actions.test.js
node tests/rtwp_skill_effects.test.js
node tests/sim_core.test.js
node tests/sim_policy.test.js
node tests/sim_orders.test.js
```

接続監査の分類と検証門は `docs/RTWP_CONNECTION_AUDIT.md` を参照してください。
