# SimCore 現行仕様

更新日: 2026-08-10

SimCore は本編戦闘の唯一の決定系である。キャンペーン、装備UI、描画は `logic_battle_rtwp.js` を介して接続し、HP、位置、弾薬、士気、制圧、命令、勝敗を別経路で決めない。

## 原則

1. 固定 tick の同期処理と注入 RNG により、同じ入力・seedから同じイベント列を得る。
2. 描画、DOM、Phaser、タイマーを参照しない。
3. 行動は `SimActions`、命令遅延は `CommsOrders`、自律判断とトレイトは `TraitPolicy`、数値は `SIM_TUNING` を正本にする。
4. 永続スキルは `SKILLS[].rtwp` から正規化された `effects` と `traits` だけを受け取る。SimCore は表示名や説明文を解釈しない。
5. AP、ラウンド境界、ターン終了を新しい効果や回復条件に使わない。

## 公開面

```js
const sim = new SimCore({ map, tuning, rng, policy, orders });

sim.addSoldier(spec);
sim.updateSoldierLoadout(id, loadoutSpec);
sim.issueOrder(order);
sim.queueExternalBlast(hex, blastSpec);
sim.tick();

sim.getSoldier(id);
sim.soldiers();
sim.drainEvents();
sim.getResult();
```

兵士 snapshot は少なくとも `id/team/q/r/hp/maxHp/state/prone/weapon/ammo/skills/traits/effects/hasRadio/morale/suppression` を持つ。装備交換は `updateSoldierLoadout` で武器、装填数、予備弾倉、投擲物、副武装、能力値を同時に更新する。

## tick順序

1. 到達した命令を配達する。
2. 現行命令または `TraitPolicy` から意図を決める。
3. 移動、照準、射撃、再装填、持替、投擲、強襲を進める。
4. 外部爆発を含む命中、ダメージ、制圧を解決する。
5. 士気、回復、指揮官継承、状態遷移を進める。
6. 勝敗を確定し、イベントを出す。

## 共有データ契約

| 正本 | 消費側 | 内容 |
|---|---|---|
| `SIM_TUNING` | SimCore / Orders / Policy | tick、射撃、移動、士気、通信、投擲 |
| `SKILLS[].rtwp` | RTwP接続層 | 永続スキルの正規化前メタデータ |
| `TRAIT_MODS` / `TRAIT_IDS` | Policy / scene / test | 行動トレイトと列挙 |
| `MUNITIONS` | SimCore | 手榴弾・銃擲弾の準備、信管、威力、制圧 |
| `SimActions` | UI / hotkey / RTwP接続層 | 表示する命令と実行関数 |

## 本編接続

`phaser_bridge.js` は戦場準備後に必ず `RtwpBattle.attach(gameLogic)` を呼ぶ。必要依存が欠けた場合は `RTWP_ERROR` として入力を閉じ、別の戦闘系へフォールバックしない。

`logic_battle_rtwp.js` は以下を担当する。

- キャンペーンユニットをRTwP兵へ登録する。
- `SKILLS` と能力値を正規化する。
- 戦闘中の装備変更をシムへ同期する。
- AERIAL支援を外部爆発イベントへ変換する。
- snapshotを本編ユニットへ戻し、描画と戦果報告を更新する。
- `RESULT` 確定後にシムを停止し、戦果画面へ渡す。

詳細な接続判定と削除項目は [RTWP_CONNECTION_AUDIT.md](RTWP_CONNECTION_AUDIT.md) を参照する。

## 検証

- `tests/sim_core.test.js`: 決定論、射撃、移動、弾薬、性能
- `tests/sim_orders.test.js`: 通信距離、Radio、指揮官喪失
- `tests/sim_policy.test.js`: トレイト差
- `tests/rtwp_skill_effects.test.js`: スキル・能力の戦闘差
- `tests/rtwp_battle.test.js`: 本編登録、装備交換、支援、勝敗同期
- `tests/rtwp_native_runtime.test.js`: RTwP以外の起動口がないこと
