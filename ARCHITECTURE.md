# アーキテクチャ概要

SQUAD TACTICS の起動フロー・主要モジュール・グローバル依存のメモです。

## 起動フロー

1. **index.html**  
   Phaser と各 JS を読み込み。順: data.js → phaser_sidebar.js → phaser_sound / vfx / unit → phaser_bridge.js → logic_ui / ai / map / campaign / game.js

2. **CampaignManager (logic_campaign.js)**  
   load で initSetupScreen()。Start で startMission() → BattleLogic 生成 → gameLogic.init()

3. **BattleLogic (logic_game.js)**  
   init() でマップ生成・配置・敵生成、state = 'PLAY'。setTimeout で Renderer.centerMap()、手札配布。

4. **Renderer (phaser_bridge.js)**  
   Phaser.Game 生成。MainScene（マップ・入力・オーバーレイ）、UIScene（手札）。notifySidebarResize で updateSidebar 等。

## ゲーム状態

- BattleLogic.state: INIT → PLAY / ANIM / WIN
- interactionMode: SELECT / MOVE / ATTACK / MELEE
- ターン: endTurn() → 敵ターン → PLAY、AP 回復

## サイドバー（右ペイン）

- PhaserSidebar (phaser_sidebar.js) がユニット情報・レーダー・IN HANDS / BACKPACK・End Turn を描画
- 幅: window.getSidebarWidth() / __sidebarWidth。リサイザーで更新
- End Turn は常に最下部固定、ユニット未選択時も表示

## 主なグローバル

- window.gameLogic … BattleLogic
- window.campaign … CampaignManager
- window.getSidebarWidth() … 右ペイン幅
- Renderer … hexToPx, centerMap, playExplosion 等
- PARAM_KEYS, PARAM_LABELS, getRadarPoints … data.js
- UNIT_TEMPLATES, WPNS … data.js

## ファイル責務

- data.js: 定数・テンプレート・getRadarPoints
- logic_campaign.js: セットアップ・createSoldier・startMission
- logic_game.js: 戦闘・ターン・攻撃・移動
- logic_map.js: MapSystem（経路・距離）
- logic_ui.js: UIManager（DOM メニュー・ログ）
- phaser_bridge.js: Phaser 初期化・MainScene
- phaser_sidebar.js: 右ペイン描画
