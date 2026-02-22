/**
 * 支援効果の実行モジュール（データ駆動）。
 * 新規支援カード: data.js の SUPPORT_CARDS に定義を追加し、ここに effect 種別の runner を追加する。
 * logic_game.js の行は増やさない。
 */
(function() {
    'use strict';

    const SUPPORT_EFFECT_RUNNERS = {
        /** 中心＋隣接7ヘックスへ無作為に N 発着弾。海域・null も抽選対象に含め1ヘックスあたりの命中率を一定にする。 */
        bombardment(game, centerHex, params) {
            if (!game.isValidHex(centerHex.q, centerHex.r)) return;
            const strikeCount = params._strikeCount ?? params.strikeCount ?? 3;
            const damage = params.damage ?? 350;
            const logKey = params.logKey ?? '爆撃';
            const logLabel = params.logLabel ?? '航空支援要請';
            const logLabelFused = params.logLabelFused ?? '航空支援要請（融合・';
            game.ui.log(strikeCount >= (params.fusedStrikeCount || 6) ? `>> ${logLabelFused}${strikeCount}発）` : `>> ${logLabel}`);
            const neighbors = game.getNeighbors(centerHex.q, centerHex.r);
            const fullPool = [centerHex, ...neighbors];
            if (fullPool.length === 0) return;
            const hits = [];
            for (let i = 0; i < strikeCount; i++) hits.push(fullPool[Math.floor(Math.random() * fullPool.length)]);
            for (const hex of hits) {
                const pos = typeof Renderer !== 'undefined' ? Renderer.hexToPx(hex.q, hex.r) : { x: 0, y: 0 };
                const canHit = game.canAttackHex && game.canAttackHex(hex.q, hex.r);
                setTimeout(() => {
                    if (window.Sfx) Sfx.play('cannon');
                    if (typeof Renderer !== 'undefined' && Renderer.playExplosion) Renderer.playExplosion(pos.x, pos.y);
                    if (canHit) {
                        const units = game.getUnitsInHex(hex.q, hex.r);
                        units.forEach(u => { game.ui.log(`>> ${logKey}命中`); game.applyDamage(u, damage, logKey); });
                    }
                    game.updateSidebar();
                    if (window.VFX) VFX.addSmoke(pos.x, pos.y);
                }, Math.random() * 800);
            }
        }

        // 将来例: 機銃掃射（始点→終点の直線ヘックスにダメージ）
        // strafe(game, startHex, endHex, params) { ... }
    };

    /**
     * 支援カード効果を実行する。data.js の SUPPORT_CARDS と fusionData からパラメータを組み立て、対応 runner に委譲。
     * @param {Object} gameLogic - BattleLogic インスタンス
     * @param {string} cardType - カード種別（'aerial' など）
     * @param {{q:number,r:number}} target - 目標（bombardment の場合は中心ヘックス）
     * @param {Object} [fusionData] - 融合データ（aerialFused: true で融合時 6 発など）
     */
    window.runSupportEffect = function(gameLogic, cardType, target, fusionData) {
        const def = typeof SUPPORT_CARDS !== 'undefined' && SUPPORT_CARDS[cardType];
        if (!def || !def.effect || !SUPPORT_EFFECT_RUNNERS[def.effect]) return;
        const strikeCount = fusionData && fusionData._strikeCount != null
            ? fusionData._strikeCount
            : (fusionData && fusionData.aerialFused ? (def.fusedStrikeCount ?? 6) : (def.strikeCount ?? 3));
        const params = { ...def, strikeCount, _strikeCount: strikeCount };
        SUPPORT_EFFECT_RUNNERS[def.effect](gameLogic, target, params);
    };
})();
