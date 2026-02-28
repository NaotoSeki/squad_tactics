# リファクタリングメモ

実施した内容と、今後の候補を短くまとめています。

---

## 実施済み

### レーダー座標の共通化
- **data.js** に `getRadarPoints(params, paramKeys, radius, labelOffset)` を追加。  
  戻り値: `{ points, labelPositions, angles }`（いずれも中心 0,0 のローカル座標）。
- **logic_campaign.js** の `drawRadarCanvas` と **phaser_sidebar.js** のレーダー描画の両方で `getRadarPoints` を利用。  
  角度・値→座標の計算は一箇所に集約済み。

### 定数化
- **phaser_sidebar.js** の先頭で以下を定義し、マジックナンバーを置き換え済み。  
  - レーダー: `RADAR_R_MAX`, `RADAR_R_MIN`, `RADAR_OFFSET_BASE`, `RADAR_OFFSET_RADIUS_THRESHOLD`, `RADAR_OFFSET_RADIUS_FACTOR`  
  - 段階表示: `RADAR_SHOW_GRID_AT`, `RADAR_SHOW_GRID_DETAIL_AT`, `RADAR_SHOW_VALUES_AT`, `RADAR_SHOW_FULL_GRID_AT`  
  - ラベル: `RADAR_LABEL_OFFSET_BASE`, `RADAR_LABEL_OFFSET_EXTRA`, `RADAR_LABEL_OFFSET_RADIUS_THRESHOLD`  
  - その他: `RADAR_VALUE_POS_RATIO`, `RADAR_BOTTOM_MARGIN`, `GAUGE_TOP`, `BAG_SLOT_H`, `END_TURN_BUTTON_BOTTOM_OFFSET`
- **logic_campaign.js** の `drawRadarCanvas` では `RADAR_MARGIN = 12` を定義して使用。

---

## 今後の候補（任意）

- **PARAM_KEYS / getVirtualWeapon の参照統一**  
  フォールバックや `window.gameLogic.getVirtualWeapon` の繰り返しを、ヘルパー1本にまとめる。
- **logic_game.js の分割**  
  攻撃・ダメージ・弾消費を `logic_combat.js` や `logic_weapons.js` に切り出し、テストしやすくする。
- **データ層の薄い API**  
  `getWeaponName(code)` や `getTemplateMainWeaponName(key)` を data.js に追加し、表示まわりの null チェックを減らす。
- **純粋計算の切り出し**  
  `hexDist` や命中率計算などを「引数→戻り値」の関数にし、単体テスト可能にする。

詳細な提案は **REFACTOR_PROPOSAL.md** を参照。
