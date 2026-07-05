/**
 * sim_policy.js -- WS-C (NORTH_STAR SS4.1 / SIM_CORE_SPEC.md SS13)
 *
 * Pure JS, zero dependencies, headless. No window/document/Phaser/setTimeout/Math.random.
 * Requireable from node, and exposed as a global in the browser (UMD-ish, see bottom).
 *
 * TraitPolicy implements the SS8 Policy contract (`decide(soldierView, worldView, rng)`).
 * Baseline behaviour mirrors sim_core.js's DefaultPolicy; `soldierView.traits` steers
 * the decision away from that baseline per SS13's trait table. All numeric knobs live
 * in TRAIT_MODS below -- no magic numbers inline.
 */

// ---------------------------------------------------------------------------
// TRAIT_MODS -- the sole table of trait-driven numeric offsets (SS13)
// ---------------------------------------------------------------------------

const TRAIT_MODS = {
  aggressive: {
    ENGAGE_RANGE_BONUS: 2,     // +2hex to the effective engagement range
    DEFAULT_FIRE_MODE: 'suppress', // default fireMode when no order present
  },
  cautious: {
    MIN_SELF_MOVE_COVER: 0.3,  // will not self-initiate a MOVE_TO into cover < this
  },
  calm: {
    ENGAGE_RANGE_FRACTION: 2 / 3, // withholds fire until dist <= rngMax * this fraction
    HARASS_FIRE_P: 0.15,            // harassing fire probability for suppressed targets (60% of default 0.25)
  },
  timid: {
    FREEZE_AT_SUPPRESSION: 40, // suppression >= this => self-initiated actions stop
  },
};

// ---------------------------------------------------------------------------
// TraitPolicy
// ---------------------------------------------------------------------------

const TraitPolicy = {
  /**
   * @param {Object} soldierView - read-only snapshot (self)
   * @param {Object} worldView - { soldiers: [...], map, tuning }
   * @param {function(): number} rng
   * @returns {Object} intent (same shape as Order), optionally with a `note`
   */
  decide: function (soldierView, worldView, rng) {
    const s = soldierView;
    const traits = s.traits || [];
    const has = function (t) { return traits.indexOf(t) !== -1; };
    const T = worldView.tuning || {};

    // ---------------------------------------------------------------------
    // Influence network (SIM_CORE_SPEC.md SS16.3, v1: 2 rules only).
    // Both are read-only observations of worldView.soldiers -- no mutation,
    // no probe. Only engage when a qualifying neighbour actually exists, so
    // scenarios without such neighbours (e.g. existing sim_policy tests) are
    // unaffected.
    // ---------------------------------------------------------------------
    const steadyRadius = T.LEADER_STEADY_RADIUS != null ? T.LEADER_STEADY_RADIUS : 2;
    const steadyBonus = T.LEADER_STEADY_BONUS != null ? T.LEADER_STEADY_BONUS : 20;
    const steadyFireMult = T.LEADER_STEADY_FIRE_MULT != null ? T.LEADER_STEADY_FIRE_MULT : 1.5;
    const joinFireMult = T.INFLUENCE_JOIN_FIRE_MULT != null ? T.INFLUENCE_JOIN_FIRE_MULT : 2.0;

    let nearLeader = false;
    let engagedNeighbours = 0;
    for (const other of worldView.soldiers) {
      if (other.id === s.id || other.team !== s.team || other.hp <= 0) continue;
      const d = worldView.map.dist({ q: s.q, r: s.r }, { q: other.q, r: other.r });
      if (other.isLeader && d <= steadyRadius) nearLeader = true;
      if (other.state === 'engage' && d <= 2) engagedNeighbours++;
    }
    let harassMult = 1.0;
    if (engagedNeighbours >= 2) harassMult *= joinFireMult;
    if (nearLeader) harassMult *= steadyFireMult;
    const applyHarassMult = function (p) { return Math.min(1.0, p * harassMult); };

    // timid: once suppression crosses the freeze threshold, stop all
    // self-initiated action and stay put (explicit orders still bypass
    // this because they arrive via s.currentOrder in sim_core, never
    // reaching policy.decide()). A steady leader nearby raises the
    // threshold -- "having the NCO close by settles the nerves".
    const timidFreezeAt = TRAIT_MODS.timid.FREEZE_AT_SUPPRESSION + (nearLeader ? steadyBonus : 0);
    if (has('timid') && s.suppression >= timidFreezeAt) {
      return {
        type: 'HOLD_POS', soldierIds: [s.id], payload: {},
        note: '臆病: 制圧下のため行動停止',
      };
    }

    // reload / out-of-ammo handling mirrors DefaultPolicy baseline.
    if (s.magRemaining <= 0 && s.magsLeft <= 0) {
      return { type: 'HOLD_POS', soldierIds: [s.id], payload: {} };
    }
    if (s.magRemaining <= 0 && s.magsLeft > 0) {
      return { type: 'FIRE_MODE', soldierIds: [s.id], payload: { mode: 'reload' } };
    }
    if (s.suppression >= (T.PINNED_AT != null ? T.PINNED_AT : 80)) {
      return { type: 'HOLD_POS', soldierIds: [s.id], payload: { prone: true } };
    }

    const effRangeBonus = has('aggressive') ? TRAIT_MODS.aggressive.ENGAGE_RANGE_BONUS : 0;

    // fire discipline (aggressive ignores it -- that IS the trait):
    // suppressed targets are not worth ammo unless close or moving;
    // on the last magazine only worthwhile targets get shot at.
    const disciplined = !has('aggressive');
    const supAt = T.SUPPRESSED_AT != null ? T.SUPPRESSED_AT : 50;
    const closeRng = T.DISCIPLINE_CLOSE_RNG != null ? T.DISCIPLINE_CLOSE_RNG : 2;
    const lastMag = s.magsLeft <= 0;

    let bestTarget = null;
    let bestDist = Infinity;
    let sawEnemy = false;
    for (const other of worldView.soldiers) {
      if (other.team === s.team || other.hp <= 0) continue;
      if (!worldView.map.hasLos({ q: s.q, r: s.r }, { q: other.q, r: other.r })) continue;
      const d = worldView.map.dist({ q: s.q, r: s.r }, { q: other.q, r: other.r });
      const effRange = s.weapon.rngMax + effRangeBonus;
      if (d > effRange) continue;
      sawEnemy = true;
      if (disciplined && other.suppression >= supAt && d > closeRng && other.state !== 'move') {
        let harassP = T.HARASS_FIRE_P != null ? T.HARASS_FIRE_P : 0.25;
        if (has('calm') && TRAIT_MODS.calm.HARASS_FIRE_P != null) {
          harassP = TRAIT_MODS.calm.HARASS_FIRE_P;
        }
        harassP = applyHarassMult(harassP);
        if (rng() >= harassP) continue;
      }
      if (disciplined && lastMag && !(other.state === 'move'
        || worldView.map.cover({ q: other.q, r: other.r }) < (T.DISCIPLINE_LAST_MAG_COVER_MAX || 0.3)
        || d <= s.weapon.rngMax / 3)) continue;
      if (d < bestDist) {
        bestDist = d;
        bestTarget = other;
      }
    }

    if (bestTarget) {
      // calm: withhold fire until well within range, regardless of trait
      // combos -- if calm's threshold is not yet met, fall through to idle.
      if (has('calm')) {
        const calmMaxDist = s.weapon.rngMax * TRAIT_MODS.calm.ENGAGE_RANGE_FRACTION;
        if (bestDist > calmMaxDist) {
          return {
            type: 'HOLD_POS', soldierIds: [s.id], payload: {},
            note: '冷静: 距離が詰まるまで射撃を保留',
          };
        }
      }

      const mode = has('aggressive') ? TRAIT_MODS.aggressive.DEFAULT_FIRE_MODE : 'aimed';
      const intent = {
        type: 'TARGET', soldierIds: [s.id],
        payload: { targetId: bestTarget.id, mode: mode },
      };
      if (has('aggressive')) intent.note = '攻撃的: 独断で射撃開始';
      return intent;
    }

    if (sawEnemy) {
      return { type: 'HOLD_POS', soldierIds: [s.id], payload: {}, note: '射撃節制: 敵は頭を下げている' };
    }

    // cautious: do not self-initiate a move into low-cover ground. TraitPolicy
    // never self-issues MOVE_TO in this slice (no self-initiated movement
    // exists in the baseline either), so this is a guard for future callers
    // that might route movement decisions through here.
    if (has('cautious') && s.movePath && s.movePath.length > 0) {
      const nextHex = s.movePath[0];
      const cover = worldView.map.cover(nextHex);
      if (cover < TRAIT_MODS.cautious.MIN_SELF_MOVE_COVER) {
        return {
          type: 'HOLD_POS', soldierIds: [s.id], payload: {},
          note: '慎重: 遮蔽の薄い地形への自発移動を拒否',
        };
      }
    }

    return { type: 'HOLD_POS', soldierIds: [s.id], payload: {} };
  },
};

// ---------------------------------------------------------------------------
// exports (UMD-ish: node module + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TraitPolicy: TraitPolicy,
    TRAIT_MODS: TRAIT_MODS,
  };
}
if (typeof window !== 'undefined') {
  window.TraitPolicy = TraitPolicy;
  window.TRAIT_MODS = TRAIT_MODS;
}
