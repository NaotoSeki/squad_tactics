/**
 * Reaction Rules Module
 * 被弾時の自動リアクション処理（伏せ、遮蔽への退避）
 * テスト可能な純関数。依存注入で hexmap ロジックを分離。
 */

window.ReactionRules = {
  /**
   * 歩兵が敵射撃で damage>=5 を受けたら伏せるか判定
   * @param {Object} unit - ユニット
   * @param {number} damage - 被弾ダメージ値
   * @returns {boolean} true = 伏せるべき
   */
  shouldGoProne(unit, damage) {
    if (!unit || !unit.def) return false;
    if (unit.def.isTank) return false; // 戦車は伏せない
    if (damage < 5) return false;
    return true;
  },

  /**
   * 遮蔽へ飛び込む先を選定
   * 現hexのcover が低い(< 30) ときのみ呼ぶ。
   * 隣接6hexから、passable && 定員有空 && cover >= (現cover+15) を満たすものを選ぶ。
   * 同coverなら攻撃者から遠い方を優先。
   * @param {Object} ctx - 依存注入コンテキスト
   *   - map: game.map（q,r座標の terrain オブジェクト）
   *   - neighbors: (q,r) => [{q,r}, ...] 隣接6hex
   *   - unitsInHex: (q,r) => unit[]
   *   - hexCap: Number ユニット定員/hex
   *   - hexDist: (a, b) => Number hex距離（攻撃者遠離度の判定用）
   * @param {Object} unit - 対象ユニット
   * @param {Object|null} attackerPos - {q, r} または null（攻撃元位置）
   * @returns {{q, r} | null} 移動先hex座標、無ければ null
   */
  pickCoverHex(ctx, unit, attackerPos) {
    if (!ctx || !unit) return null;
    const { map, neighbors, unitsInHex, hexCap, hexDist } = ctx;
    if (!map || !neighbors || !unitsInHex || !hexCap || !hexDist) return null;

    const currentHex = map[unit.q] ? map[unit.q][unit.r] : null;
    if (!currentHex) return null;
    const currentCover = currentHex.cover || 0;

    // 隣接6hex リスト
    const adjacent = neighbors(unit.q, unit.r);
    if (!Array.isArray(adjacent)) return null;

    // 候補フィルタリング
    const candidates = adjacent.filter(hex => {
      const terrain = map[hex.q] ? map[hex.q][hex.r] : null;
      if (!terrain) return false;
      // passable && 定員に空きあり && cover 十分
      const isTankBlocked = terrain.tankBlocked && unit.def && unit.def.isTank;
      if (isTankBlocked || terrain.cost >= 99) return false; // 通過不可
      const hexUnits = unitsInHex(hex.q, hex.r);
      const occupied = hexUnits ? hexUnits.filter(u => u.team === unit.team && u.hp > 0).length : 0;
      if (occupied >= hexCap) return false; // 満杯
      const newCover = terrain.cover || 0;
      if (newCover < currentCover + 15) return false; // cover不十分
      return true;
    });

    if (candidates.length === 0) return null;

    // 最適選択: cover 最大 → 同率なら attacker から遠い
    let best = candidates[0];
    for (const cand of candidates.slice(1)) {
      const bestCover = map[best.q][best.r].cover || 0;
      const candCover = map[cand.q][cand.r].cover || 0;
      if (candCover > bestCover) {
        best = cand;
      } else if (candCover === bestCover && attackerPos) {
        const bestDist = hexDist(best, attackerPos);
        const candDist = hexDist(cand, attackerPos);
        if (candDist > bestDist) {
          best = cand;
        }
      }
    }
    return best;
  },
};
