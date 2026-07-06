/**
 * LOGIC MATH: 純粋な座標・距離・命中率計算（引数 → 戻り値のみ、window/DOM に依存しない）。
 * 単体テストや他モジュールからの参照のために切り出し。
 * 読み込み順: data.js より前（index.html 参照）。
 */

/**
 * 2つのヘックス座標（軸座標 q, r）間の距離。
 * MapSystem.hexDist / BattleLogic.hexDist から委譲される。
 * @param {{q:number,r:number}} a
 * @param {{q:number,r:number}} b
 * @returns {number}
 */
function hexDist(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/**
 * 命中率計算の数式コア（引数 → 数値のみ）。BattleLogic.getEstimatedHitChance から委譲される。
 * 呼び出し側で武器・地形・能力値・RT設定・撃ち分け補正などを解決した上で渡す。
 * @param {Object} opts
 * @param {number} opts.dist - 攻撃者から目標ヘックスまでの距離
 * @param {Object} opts.w - 武器オブジェクト（acc, acc_drop, rng, area, overRangePenalty, code 等）
 * @param {number} opts.terrainCover - 目標ヘックスの地形カバー値
 * @param {number} opts.coverMult - カバー倍率（BATTLE_SCALE.coverMult、なければ1）
 * @param {number} opts.aimVal - 攻撃者の aim 値
 * @param {number} opts.throwVal - 攻撃者の throw 値
 * @param {number} opts.moraleMod - 士気補正（morale/10、未設定時1）
 * @param {Object|null} opts.targetUnit - 狙うユニット（stance のみ参照）。null ならエリア射撃扱い
 * @param {number} opts.rtHitPenalty - RTタクティクスの命中率ペナルティ（なければ0）
 * @param {boolean} opts.wounded - 重傷状態か（REALISM_PACK.WOUNDED_STATE && attacker.wounded）
 * @param {boolean} opts.applyBurstPenalty - 撃ち分け最大モード選択時の-5補正を適用するか
 * @returns {{ hit: number, isArea: boolean }}
 */
function computeHitChance(opts) {
    const {
        dist, w, terrainCover, coverMult,
        aimVal, throwVal, moraleMod,
        targetUnit, rtHitPenalty, wounded, applyBurstPenalty
    } = opts;

    const baseAcc = (w.area && !targetUnit) ? throwVal * 2 : aimVal * 2;
    let hit = baseAcc + (w.acc || 0) - (dist * (w.acc_drop || 5)) - terrainCover * coverMult;
    hit = Math.round(hit * moraleMod);

    const overRange = Math.max(0, dist - (w.rng || 0));
    hit -= overRange * (w.overRangePenalty ?? 15);

    if (targetUnit) {
        if (targetUnit.stance === 'prone') hit -= 20;
        if (targetUnit.stance === 'crouch') hit -= 10;
        if (rtHitPenalty) hit -= rtHitPenalty;
    } else if (w.area) {
        hit += 20;
    }

    if (wounded) hit -= 10;
    if (applyBurstPenalty) hit -= 5;

    hit = Math.max(0, Math.min(100, Math.round(hit)));
    return { hit, isArea: !!w.area && !targetUnit };
}
