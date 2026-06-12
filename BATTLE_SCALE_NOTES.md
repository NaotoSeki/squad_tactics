# バトルスケール設定覚書

戦闘の人数・AUTO テンポ・戦車出現率は **`data.js` 先頭** で切り替えます。

**設計方針（知略ダイヤル UI ビジョン含む）**: [docs/DESIGN_DIRECTION.md](docs/DESIGN_DIRECTION.md)

## プリセットの切り替え

`data.js` の1行を変更してリロードしてください。

```javascript
const BATTLE_SCALE_PRESET = 'chaos';   // ドンパチ（現行デフォルト）
// const BATTLE_SCALE_PRESET = 'classic'; // 従来の小規模戦に戻す
```

| 項目 | `classic`（従来） | `chaos`（ドンパチ） |
|------|-------------------|---------------------|
| 開戦時の敵数 | 4 + sector×0.7 | 14 + sector×1.2 |
| 開戦時の味方増援 | なし | +8名 |
| 1ヘックス上限 | 5体 | 10体 |
| カード増援 | 2回 | 8回 |
| AUTO 1兵士あたり攻撃 | 1回 | 3回 |
| 敵戦車（Pz4）基礎確率 | 10% + sector×10% | **2%** + sector×1.2% |
| 敵タイガー | なし | **0.4%** + sector×0.3% |

※ ターン途中のウェーブ増援は廃止済み（開戦時スポーンのみ）。

## カスタム調整

プリセットをコピーして `BATTLE_SCALE_PRESETS` に追加するか、`chaos` 内の数値だけ編集します。

よく触るキー:

- `ENEMY_BASE` / `ENEMY_PER_SECTOR` … 開戦時の敵数
- `ALLIED_REINFORCEMENTS` … 開戦時の味方増援
- `ENEMY_TANK_CHANCE` / `ENEMY_TIGER_CHANCE` … 敵戦車の出現率
- `AUTO_ATTACKS_PER_ACTOR` … AUTO 時の1兵士あたり攻撃回数

## 戦車のレア化

敵の初期スポーンは **`pickEnemyTemplate()`**（`logic_game.js`）で抽選。  
味方の開戦増援は **歩兵のみ**（戦車なし）。

## 射撃アニメ

`actionAttack` の終了待ちは **弾数×発射間隔＋着弾時間** を見てから次処理へ進みます。  
AUTO 用にアニメ時間を極端に短縮しないこと（弾道 VFX が消える原因になる）。

## 関連ファイル

| ファイル | 内容 |
|----------|------|
| `data.js` | `BATTLE_SCALE_PRESET`, `BATTLE_SCALE_PRESETS` |
| `logic_game.js` | スポーン、`pickEnemyTemplate`、戦闘 |
| `logic_ai.js` | AUTO 攻撃回数 |

## 従来プレイへ戻す手順

1. `data.js` で `BATTLE_SCALE_PRESET = 'classic'`
2. ブラウザをハードリロード
3. 敵が約4体前後であることを確認
