/**
 * WPNS の装填互換は pl_st_weapon_ammo.js（生成元: cbe_weapon_ammo_explicit + build_pl_st_compat）を唯一の正とする。
 * ミッション JSON の validate ブロックは開発時の取りこぼし警告用（ゲームは止めない）。
 */
(function () {
  'use strict';

  function validatePlCatalogWeaponCodes(codes) {
    if (!codes || !Array.isArray(codes) || typeof WPNS === 'undefined') return;
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i];
      if (!WPNS[c]) {
        console.warn('[pl_item_catalog] WPNS に無い code:', c);
        continue;
      }
      if (!WPNS[c].plCompat) {
        console.warn('[pl_item_catalog] plCompat 未付与（pl_st バインド漏れ?）: ', c, WPNS[c].name || '');
      }
    }
  }

  function runMissionValidate() {
    var m = typeof window !== 'undefined' && window.__ST_MISSION__;
    if (!m || !m.validate) return;
    if (m.validate.weaponCodesExpectPlCompat) {
      validatePlCatalogWeaponCodes(m.validate.weaponCodesExpectPlCompat);
    }
  }

  if (typeof window !== 'undefined') {
    window.validatePlCatalogWeaponCodes = validatePlCatalogWeaponCodes;
    setTimeout(runMissionValidate, 0);
  }
})();
