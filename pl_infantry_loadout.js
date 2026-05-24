/**
 * 歩兵が主装備として持てる PL 武器の判定（ランダム装備・カード配布の共通ルール）。
 * 現物主義: 戦車砲(KwK/PaK等)・牽引火砲・弾種未整備・非歩兵カテゴリは除外。
 */
(function () {
    'use strict';

    const INFANTRY_MAIN_CATEGORIES = ['rifle', 'carbine', 'smg', 'auto_rifle', 'sniper', 'mg'];

    /** 歩兵携行不能（車載砲・対戦車砲・榴弾砲・高射砲・牽引用など） */
    function isNonInfantryPortableName(name) {
        const n = (name || '').trim();
        if (!n) return true;
        if (/\bKwK\s*\d|\bKwK\d/i.test(n)) return true;
        if (/\bPaK\s*\d|\bPaK\d/i.test(n)) return true;
        if (/\bStK\s*\d|\bStH\s*\d|\bGrW\s*\d/i.test(n)) return true;
        if (/\bFla?K\s*\d/i.test(n)) return true;
        if (/\d+\s*mm\s*(KwK|PaK|Gun|How|Cann|Obice|GrW)/i.test(n)) return true;
        if (/\d+inGun\b/i.test(n)) return true;
        if (/\d+\/\d+\s*Cann/i.test(n)) return true;
        if (/\d+mm\s+Gun\b/i.test(n)) return true;
        if (/\d+mm\s+How\b/i.test(n)) return true;
        if (/\bObice\b/i.test(n)) return true;
        if (/\bCann\.\b/i.test(n)) return true;
        return false;
    }

    window.isPlausibleInfantryMainWeapon = function (code) {
        const w = typeof WPNS !== 'undefined' ? WPNS[code] : null;
        if (!w || w.partType || w.type !== 'bullet') return false;
        if (typeof ATTR !== 'undefined' && w.attr === ATTR.RECOVERY) return false;
        if (!((w.cap || 0) > 0)) return false;
        if (!INFANTRY_MAIN_CATEGORIES.includes(w.plCategory)) return false;

        const n = (w.name || '').trim();
        if (isNonInfantryPortableName(n)) return false;

        if (/^45ACP/i.test(n)) return false;
        if (/^PF/i.test(n)) return false;
        if (/^GrB/i.test(n)) return false;
        if (/^FmW/i.test(n)) return false;
        if (/^AN-M/i.test(n)) return false;
        if (/^30Cbn|^3006-|^7\.92-|^6\.5-|^7\.5-|^8mm/i.test(n)) return false;

        if (Array.isArray(w.acceptsAmmo) && w.acceptsAmmo.length === 0) return false;

        return true;
    };

    /** サイドバー用: ITEML スプライトがロード済みか（任意の厳格チェック） */
    window.plWeaponHasLoadedIcon = function (w) {
        if (!w || w.cbeNameIndex == null || typeof window.plCbeWeaponIconKey !== 'function') return false;
        const game = window.phaserGame;
        const scene = game && game.scene ? game.scene.getScene('MainScene') : null;
        if (!scene || !scene.textures) return false;
        return scene.textures.exists(window.plCbeWeaponIconKey(w.cbeNameIndex));
    };
})();
