# リファクタリング提案（全体）

ここまで追加した機能を踏まえ、保守性・一貫性・テストしやすさの観点で提案です。**必須ではなく「やると良さそう」な案**です。

---

## 1. 重複の解消

### 1.1 レーダーチャート描画ロジックの共通化
- **現状**: `logic_campaign.js` の `drawRadarCanvas`（2D canvas）と `phaser_sidebar.js` の updateSidebar 内（Phaser Graphics）で、同じ「8軸・角度・値→座標」の計算が二重に書かれている。
- **提案**: `data.js` または `utils/radar.js` に **座標計算だけ** を出す。
  - 例: `getRadarPoints(params, paramKeys, centerX, centerY, radius)` → `{ points, labelPositions }` を返す。
  - 初期画面は `getRadarPoints` の結果を canvas に描画、右ペインは Phaser で描画。角度・半径の式を一箇所にまとめられる。

### 1.2 PARAM_KEYS / PARAM_LABELS の参照の統一
- **現状**: 複数ファイルで `(typeof PARAM_KEYS !== 'undefined') ? PARAM_KEYS : ['action', ...]` のようなフォールバックが繰り返されている。
- **提案**: `data.js` で `function getParamKeys()` を export（または window に置く）し、常にそこから取得する。未読込時は中でフォールバックを1回だけ書く。

### 1.3 gameLogic / getVirtualWeapon のアクセス統一
- **現状**: `window.gameLogic && window.gameLogic.getVirtualWeapon ? window.gameLogic.getVirtualWeapon(u) : null` が logic_ui / phaser_sidebar などに散在。
- **提案**: 短いヘルパーを一箇所に定義する（例: `window.getCurrentWeapon = (u) => (window.gameLogic && window.gameLogic.getVirtualWeapon) ? window.gameLogic.getVirtualWeapon(u) : null`）。呼び出し側は `getCurrentWeapon(u)` に統一。

---

## 2. 責務の分離（大きなファイルの分割）

### 2.1 logic_game.js（約 1286 行）
- **現状**: 戦闘・ターン・攻撃・ダメージ・武器・移動・モード・UI コールバックが一つのクラスに集中している。
- **提案**:
  - **攻撃・ダメージ・弾消費**を `logic_combat.js` に切り出す（例: `actionAttack`, `applyDamage`, `getAttackWeapon`, `consumeAmmo`, `canFireAgain`, `triggerM8Rocket` など）。`BattleLogic` はそれを呼ぶだけにする。
  - または「武器判定」だけ `logic_weapons.js` に分離（`getVirtualWeapon`, `getAttackWeapon`, `consumeAmmo`, `canFireAgain`）し、戦闘ロジックは `logic_game.js` に残す。
- **効果**: 変更時の影響範囲が分かりやすくなり、攻撃まわりだけの単体テストが書きやすくなる。

### 2.2 phaser_bridge.js（約 986 行）
- **現状**: 初期化・マップ・入力・ヘックス・ユニット・カード・コンテキストメニュー・オーバーレイが同じシーンに同居。
- **提案**: 「オーバーレイ（移動可能範囲・攻撃ライン・照準）」と「入力（クリック・右クリック・ホバー）」を別クラス/別ファイルに切り、MainScene から委譲する。無理に分けなくても、**オーバーレイ描画だけ**関数化するだけでも読みやすくなる。

---

## 3. グローバル依存の明示

- **現状**: `window.gameLogic`, `window.getSidebarWidth`, `Renderer`, `Sfx`, `VFX`, `WPNS`, `UNIT_TEMPLATES` などが多数のファイルから直接参照されている。
- **提案**:
  - **コードの変更は最小**にしつつ、**ARCHITECTURE.md** または **REFACTOR_NOTES.md** に「グローバル一覧」と「どのモジュールが何に依存しているか」を短く書く。将来のリファクタや新人が読みやすくなる。
  - 余裕があれば、`BattleLogic` のコンストラクタで `ui`, `mapSystem`, `ai` を引数で受け取る形にし、テスト時にモックを差し替えやすくする（`window.gameLogic = this` は互換のため残してもよい）。

---

## 4. 定数・マジックナンバーの集約

- **現状**: レーダーまわり（108, 88, 130, 36, 44, 58, 82 など）やスロット高さ（130, 100, 90, 54）が各所に直接書かれている。
- **提案**:
  - **phaser_sidebar.js** の先頭で `RADAR_OFFSET_BASE = 108`, `RADAR_R_MAX = 130`, `RADAR_R_MIN = 36`, `GAUGE_TOP = 38`, `BAG_SLOT_H = 54` などを定数化。意味が名前で分かるようにする。
  - レーダーの「段階表示しきい値」（44, 58, 70, 82）も `RADAR_SHOW_GRID_AT`, `RADAR_SHOW_VALUES_AT` のように名前を付けると意図が残る。

---

## 5. データ層の薄い API

- **現状**: 武器名は `WPNS[code].name`、テンプレート主武器は `UNIT_TEMPLATES[k].main` + `WPNS[t.main].name` など、呼び出し側で分岐が散る。
- **提案**: `data.js` にヘルパーを足す（例: `getWeaponName(code)`, `getTemplateMainWeaponName(templateKey)`）。未定義時は `'—'` や `code` を返す。表示用の取り回しが一箇所になり、null チェックの重複が減る。

---

## 6. テスト・デバッグのしやすさ

- **現状**: `BattleLogic` や `MapSystem` は `window` / DOM に依存しており、そのままでは Node で簡単にテストしづらい。
- **提案**:
  - **純粋な計算**（例: `hexDist`, レーダーの点座標計算, `getEstimatedHitChance` の数式部分）だけを「引数だけ見て結果を返す関数」に切り出し、別ファイル（例: `logic_math.js` や `utils/hex.js`）に置く。そこだけ先に単体テストを書ける。
  - 既存の `logic_support.js` のように、**データ駆動＋小さな runner** の形で効果を分離できている部分はそのまま活かすとよい。

---

## 7. ドキュメント

- **提案**:
  - **ARCHITECTURE.md**: 起動フロー（index.html → campaign → BattleLogic → Renderer）、メインループ、サイドバー（Phaser vs DOM）の役割を短く記載。
  - **REFACTOR_NOTES.md**: 上記の「いつかやりたいリファクタ」と、既にやった変更のメモを残す。今回の提案もここに要約しておくと、あとで優先度を決めやすい。

---

## 優先度の目安

| 優先度 | 項目 | 理由 |
|--------|------|------|
| 高 | 1.1 レーダー座標の共通化 | バグ修正や仕様変更が一箇所で済む |
| 高 | 4. 定数・マジックナンバーの集約 | 可読性がすぐ上がり、変更も安全 |
| 中 | 1.2 / 1.3 参照の統一 | ボイラープレート削減と一貫性 |
| 中 | 5. データ層の薄い API | 表示まわりの null チェック削減 |
| 低 | 2. ファイル分割 | 行数がさらに増えてからでも遅くない |
| 低 | 3. グローバル明示・6. テスト・7. ドキュメント | 時間があるときに少しずつ |

「まず手を付けやすいもの」としては **1.1（レーダー共通化）** と **4（定数化）** から進めるのがおすすめです。
