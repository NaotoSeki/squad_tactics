/**
 * PL 武器アイコン: data/sprites/iteml/item_NNNN.png
 * スプライトファイル番号 = cbeNameIndex + 1（4桁ゼロ埋め）
 */
(function () {
  'use strict';
  window.PL_WEAPON_ICON_BASE = 'data/sprites/iteml';
  window.plCbeWeaponIconKey = function (cbeNameIndex) {
    return 'pl_cbe_wpn_' + cbeNameIndex;
  };
  window.plCbeWeaponIconPath = function (cbeNameIndex) {
    return window.PL_WEAPON_ICON_BASE + '/item_' + String(cbeNameIndex + 1).padStart(4, '0') + '.png';
  };
  /** cbeNameIndex があれば ITEML スプライトを表示（三脚・装備パーツ含む） */
  window.plItemHasWeaponIcon = function (item) {
    return !!(item && item.cbeNameIndex != null);
  };
})();
