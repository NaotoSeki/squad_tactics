# 変更内容（スキル実装・SOLDIER DOSSIER削除）

## 1. SOLDIER DOSSIER の削除
- **phaser_sidebar.js**: 右ペイン最上部の「SOLDIER DOSSIER」ヘッダー（矩形＋テキスト）を削除。ユニット内容は `y = 12` から開始。
- **index.html**: 右サイドバー内の `SOLDIER DOSSIER` と書かれた `.panel-header` 要素を削除。

## 2. スキルシステム（data.js）
- `SKILL_STYLES` を追加。マップ上バッジ用のアイコン・色を定義。

## 3. 戦闘でのスキル効果（logic_game.js）
- Precision: 命中+15% / Ambush: 回避+15% / HighPower: 与ダメ+20% / Armor: 被ダメ-5
- Mechanic・CQC は既存どおり。CQC は `d.skills` 未定義時ガード済み。

## 4. セクター生存でスキル付与（logic_campaign.js）
- createSoldier: `skills: []`, `sectorsSurvived: 0` 付与。
- promoteSurvivors: 5セクターで Hero＋maxAp+1、70%でランダム1スキル（最大8）。`u.skills` 未定義ガード追加。

## 5. サイドバーでのスキル表示
- logic_ui.js: ユニット名・role 直下に付与スキル一覧を表示。
- phaser_sidebar.js: 名前・role 直下にスキル説明を1行表示。

## 6. マップ上のスキルバッジ（phaser_unit.js）
- HPバー直下に tiny な徽章を描画。`u.skills` 未定義・空はガード。yOffset=-38, scale 0.28。
