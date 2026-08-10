# バトルスケール設定

戦闘人数と配置密度は `data.js` の `BATTLE_SCALE_PRESET` で切り替える。射撃、移動、命令、士気などの実時間戦闘値は `SIM_TUNING` が唯一の正本であり、スケールプリセットには持たせない。

```javascript
const BATTLE_SCALE_PRESET = 'standard';
// const BATTLE_SCALE_PRESET = 'chaos';   // 大規模
// const BATTLE_SCALE_PRESET = 'classic'; // 小規模
```

| 項目 | classic | standard（既定） | chaos |
|---|---:|---:|---:|
| 開戦時の敵数 | 4 + sector×0.7 | 8 + sector×0.9 | 14 + sector×1.2 |
| 開戦時の味方増援 | 0 | 4 | 8 |
| 1ヘックス上限 | 5 | 7 | 10 |
| 配置カード上限 | 2 | 4 | 8 |

`FEATURE_TACTICS_MORPH` が有効なら、classic と chaos の人数・密度値を知略ダイヤルで補間する。`standard` はダイヤル明示値がない限り表の値をそのまま使う。

戦車ユニットは `FEATURE_TANK_UNITS=false` の間は候補、配置カード、増援から除外される。再有効化する場合は、先に武器・移動・被弾を SimCore のRTwP経路へ接続してテストする。旧戦闘メソッドを復活させてはならない。

関連する正本:

- 人数・密度: `BATTLE_SCALE_PRESETS`
- 実時間戦闘値: `SIM_TUNING`
- スキル効果: `SKILLS[].rtwp`
- 接続監査: `docs/RTWP_CONNECTION_AUDIT.md`
