# リファクタリング: reloadWeapon 修正 & hands 3スロット前提

## 適用方法

このフォルダ内の修正済みファイルを、クローンした squad_tactics リポジトリに反映してください。

```powershell
# 1. リポジトリをクローン（未実施の場合）
git clone https://github.com/NaotoSeki/squad_tactics.git
cd squad_tactics

# 2. 新規ブランチを作成
git checkout -b refactor/reloadWeapon-and-hands-3slot

# 3. 修正ファイルをコピー（このフォルダのパスに置き換えてください）
# 例: ユーザーホーム直下に squad_tactics がある場合
Copy-Item -Path "$env:USERPROFILE\squad_tactics\*.js" -Destination . -Force

# 4. 変更をコミット
git add logic_game.js logic_ai.js logic_map.js
git commit -m "fix: reloadWeapon 構文エラー修正、hands を3スロット配列前提にリファクタ"
```

---

## 主な変更点

### 1. reloadWeapon 構文エラー修正 (logic_game.js)

**問題**: 417行付近の壊れたコード
```javascript
// 修正前（構文エラー）
if(u.ap i&&i.type==='ammo'&&i.ammoFor===w.code);
if(magIndex===-1){ ...
```

**修正後**:
```javascript
if (u.ap < cost) { this.ui.log("AP不足"); return; }
const magIndex = u.bag.findIndex(i => i && i.type === 'ammo' && i.ammoFor === w.code);
if (magIndex === -1) { this.ui.log("予備弾なし"); return; }
```

### 2. reloadWeapon のシグネチャ拡張 (logic_game.js)

- **AI対応**: `reloadWeapon(unit, manual)` でユニットを明示指定可能に
- 手動リロード: `reloadWeapon(undefined, true)` または `reloadWeapon(true)`（従来通り selectedUnit を使用）

### 3. hands を常に3スロット配列として扱う

- **getVirtualWeapon**: `!Array.isArray(u.hands) || u.hands.length < 3` で早期 return
- **logic_map.js**: `getVirtualWeapon` に一本化、fallback 削除
- **logic_ai.js**: `reloadWeapon(actor, false)`、`swapEquipment(..., actor)` で対象ユニットを渡す

### 4. swapEquipment の拡張 (logic_game.js)

- **AI用**: 第3引数 `unitOverride` で対象ユニットを指定可能
- `src.index` / `tgt.index` 未指定時は main は `0` をデフォルト使用

### 5. toggleFireMode の安全化 (logic_game.js)

- `u.hands.modes` → `u.hands[0]?.modes`（配列前提で正しく参照）

---

## 動作確認の推奨項目

- [ ] 歩兵のリロード（マガジン交換）
- [ ] 戦車のリロード
- [ ] 迫撃砲兵の砲撃・弾薬消費
- [ ] 敵AIの武器持ち替え（戦車 vs 歩兵）
- [ ] 敵AIのリロード
- [ ] サイドバーでの装備スワップ（D&D）
- [ ] 白兵攻撃・修理・治療
