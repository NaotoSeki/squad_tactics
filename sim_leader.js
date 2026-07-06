/**
 * sim_leader.js -- WS-F (NORTH_STAR SS3.4 三現主義 / SIM_CORE_SPEC.md SS16)
 *
 * Pure JS, zero dependencies, headless. No window/document/Phaser/setTimeout/Math.random.
 * Requireable from node, and exposed as a global in the browser (UMD-ish, see bottom).
 *
 * LeaderPolicy.assess(leaderView, worldView, rng, state) is a pure function: it reads
 * leaderView/worldView and the caller-held `state` record, and RETURNS Order[] (SS8
 * shape) for the caller to feed into sim.issueOrder(). It never mutates sim state
 * itself and never queues orders directly -- all orders travel through CommsOrders,
 * same channel and same delay as player orders (that IS the "field leader is fast
 * because the voice carries" mechanic).
 *
 * `state` is caller-held per-squad memory: { lastDoctrine, lastOrderTick, playerLockUntil,
 * quietT }. quietT is LeaderPolicy's own bookkeeping (see HOLD_FIRE below) -- callers
 * should treat it as opaque and simply pass the same object back in on every call.
 */

// ---------------------------------------------------------------------------
// helpers (module-private, no side effects)
// ---------------------------------------------------------------------------

/**
 * Squad-average morale and casualty count for a team, from worldView snapshots.
 * @private
 */
function _squadStats(worldView, team) {
  let aliveMorale = 0;
  let aliveCount = 0;
  let dead = 0;
  for (const s of worldView.soldiers) {
    if (s.team !== team) continue;
    if (s.hp <= 0) { dead++; continue; }
    aliveMorale += s.morale;
    aliveCount++;
  }
  return {
    dead: dead,
    avgMorale: aliveCount > 0 ? aliveMorale / aliveCount : 100,
    aliveCount: aliveCount,
  };
}

/**
 * Ammo fraction approximation (SIM_CORE_SPEC.md SS16 design note):
 * sum(magRemaining + magsLeft*burstsPerMag) / sum(full magCap*(magsLeft_full+1)) with
 * magCap already expressed in bursts-per-mag terms by toSimWeapon -- so this reduces
 * to remaining bursts / (magCap * (DEFAULT_MAGS+1)) per soldier, summed.
 * @private
 */
function _squadAmmoFraction(worldView, team) {
  const T = worldView.tuning || {};
  const defaultMags = T.DEFAULT_MAGS || {};
  let have = 0;
  let full = 0;
  for (const s of worldView.soldiers) {
    if (s.team !== team || s.hp <= 0 || !s.weapon) continue;
    const magCap = s.weapon.magCap || 1;
    const startMags = (defaultMags[s.weapon.class] != null ? defaultMags[s.weapon.class] : s.magsLeft) + 1;
    have += (s.magRemaining || 0) + (s.magsLeft || 0) * magCap;
    full += magCap * startMags;
  }
  return full > 0 ? have / full : 1;
}

/**
 * Nearest living enemy to a hex, or null.
 * @private
 */
function _nearestEnemy(worldView, team, hex) {
  let best = null;
  let bestDist = Infinity;
  for (const s of worldView.soldiers) {
    if (s.team === team || s.hp <= 0) continue;
    const d = worldView.map.dist(hex, { q: s.q, r: s.r });
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}

/**
 * Build a 2-hex straight-line retreat path away from the nearest enemy, using the
 * same integer-rounding straight-line approach as dev_sim.html's right-click move
 * (see dev_sim.html contextmenu handler). Out-of-map hexes are clamped by refusing
 * to step onto a hex the MapApi reports as impassable (moveCost >= 99); LeaderPolicy
 * has no notion of map bounds beyond MapApi, so this is the only clamp available to
 * a pure function fed only the SS3 MapApi.
 * @private
 */
function _fallbackPath(worldView, soldier, retreatHexes) {
  const enemy = _nearestEnemy(worldView, soldier.team, { q: soldier.q, r: soldier.r });
  if (!enemy) return null;
  const dq = soldier.q - enemy.q;
  const dr = soldier.r - enemy.r;
  const mag = Math.max(Math.abs(dq), Math.abs(dr), 1);
  // unit-ish direction away from the enemy, then walk it out `retreatHexes` steps,
  // rounding each step the same way dev_sim's straight-line path builder does.
  const dirQ = dq / mag;
  const dirR = dr / mag;
  const path = [];
  let cq = soldier.q, cr = soldier.r;
  for (let i = 1; i <= retreatHexes; i++) {
    const nq = Math.round(soldier.q + dirQ * i);
    const nr = Math.round(soldier.r + dirR * i);
    const hex = { q: nq, r: nr };
    if (worldView.map.moveCost(hex) >= 99) break; // impassable/out-of-map: clamp here
    cq = nq; cr = nr;
    path.push({ q: cq, r: cr });
  }
  return path.length > 0 ? path : null;
}

// ---------------------------------------------------------------------------
// LeaderPolicy
// ---------------------------------------------------------------------------

const LeaderPolicy = {
  /**
   * @param {Object} leaderView - read-only snapshot of the squad leader (self)
   * @param {Object} worldView - { soldiers: [...], map, tuning }
   * @param {function(): number} rng
   * @param {Object} state - caller-held per-squad memory:
   *   { lastDoctrine, lastOrderTick, playerLockUntil, quietT }
   * @returns {Object[]} Order[] (SS8 shape), empty if standing pat this cycle
   */
  assess: function (leaderView, worldView, rng, state) {
    const T = worldView.tuning || {};
    const tick = worldView.tick != null ? worldView.tick : 0;
    const team = leaderView.team;

    state.lastOrderTick = state.lastOrderTick != null ? state.lastOrderTick : -Infinity;
    state.playerLockUntil = state.playerLockUntil != null ? state.playerLockUntil : 0;
    state.quietT = state.quietT != null ? state.quietT : 0;

    // no living leader -> no doctrine (F1: "squad without a leader" issues nothing).
    // The caller is expected to only call assess() for a squad's designated leader,
    // but a dead/missing leaderView is guarded here defensively.
    if (!leaderView || leaderView.hp <= 0 || !leaderView.isLeader) return [];

    // HOLD_FIRE's "no engagement for N ticks" proxy: LeaderPolicy holds no event
    // history, so it tracks "nobody on the squad is currently engaging" as a
    // running counter across assess() calls (SIM_CORE_SPEC.md SS16 design note).
    // Each assess() call represents one LEADER_ASSESS_INTERVAL_T-sized step.
    const interval = T.LEADER_ASSESS_INTERVAL_T != null ? T.LEADER_ASSESS_INTERVAL_T : 25;
    const anyEngaged = worldView.soldiers.some((s) => s.team === team && s.hp > 0 && s.state === 'engage');
    state.quietT = anyEngaged ? 0 : state.quietT + interval;

    // player order lock: NCO stays silent while the player's own order is fresh.
    if (tick < state.playerLockUntil) return [];

    const cooldownT = T.DOCTRINE_COOLDOWN_T != null ? T.DOCTRINE_COOLDOWN_T : 100;
    if (tick - state.lastOrderTick < cooldownT) return [];

    const doctrine = this._pickDoctrine(leaderView, worldView, T, state);
    if (!doctrine) return [];

    // no repeating the same doctrine back-to-back when nothing about the
    // situation score has moved (SS16.2 "same-doctrine suppression"). `score`
    // is a doctrine-specific severity number (e.g. casualty count, suppressed
    // count) -- same name AND same score means "nothing changed, stay quiet";
    // same name but a worse score (situation escalated) still re-issues.
    if (doctrine.name === state.lastDoctrine && doctrine.score === state.lastDoctrineScore) return [];

    state.lastDoctrine = doctrine.name;
    state.lastDoctrineScore = doctrine.score;
    state.lastOrderTick = tick;
    return doctrine.orders;
  },

  /**
   * Evaluate the SS16.2 doctrine table in priority order, first match wins.
   * @private
   */
  _pickDoctrine: function (leaderView, worldView, T, state) {
    const team = leaderView.team;
    const aliveSquad = worldView.soldiers.filter((s) => s.team === team && s.hp > 0);
    const aliveIds = aliveSquad.map((s) => s.id);
    if (aliveIds.length === 0) return null;

    // 1. FALL_BACK -- casualties + low morale.
    const stats = _squadStats(worldView, team);
    const fallbackCasualties = T.FALLBACK_CASUALTIES != null ? T.FALLBACK_CASUALTIES : 2;
    const fallbackMoraleBelow = T.FALLBACK_MORALE_BELOW != null ? T.FALLBACK_MORALE_BELOW : 50;
    if (stats.dead >= fallbackCasualties && stats.avgMorale < fallbackMoraleBelow) {
      const orders = [];
      for (const s of aliveSquad) {
        const path = _fallbackPath(worldView, s, 2);
        if (path) orders.push({ type: 'MOVE_TO', soldierIds: [s.id], payload: { path: path } });
      }
      if (orders.length > 0) {
        return { name: 'FALL_BACK', score: stats.dead, orders: this._withNote(orders, '下がれ！下がれ！') };
      }
    }

    // 2. FOCUS_FIRE -- an exposed/moving enemy within range of >= FOCUS_MIN_SHOOTERS.
    const focusMinShooters = T.FOCUS_MIN_SHOOTERS != null ? T.FOCUS_MIN_SHOOTERS : 3;
    const focusCoverMax = T.FOCUS_TARGET_COVER_MAX != null ? T.FOCUS_TARGET_COVER_MAX : 0.3;
    const enemies = worldView.soldiers.filter((s) => s.team !== team && s.hp > 0);
    for (const enemy of enemies) {
      const cover = worldView.map.cover({ q: enemy.q, r: enemy.r });
      const exposed = cover < focusCoverMax || enemy.state === 'move';
      if (!exposed) continue;
      const shooters = aliveSquad.filter((s) => s.weapon
        && worldView.map.dist({ q: s.q, r: s.r }, { q: enemy.q, r: enemy.r }) <= s.weapon.rngMax
        && worldView.map.hasLos({ q: s.q, r: s.r }, { q: enemy.q, r: enemy.r }));
      if (shooters.length >= focusMinShooters) {
        const orders = shooters.map((s) => ({
          type: 'TARGET', soldierIds: [s.id], payload: { targetId: enemy.id, mode: 'aimed' },
        }));
        return { name: 'FOCUS_FIRE', score: enemy.id, orders: this._withNote(orders, 'あの一点を潰せ！') };
      }
    }

    // 3. SUPPRESS_FIRE -- >= N squadmates currently suppressed.
    const suppressedAt = T.SUPPRESSED_AT != null ? T.SUPPRESSED_AT : 50;
    const suppressMin = T.SUPPRESS_DOCTRINE_MIN_SUPPRESSED != null ? T.SUPPRESS_DOCTRINE_MIN_SUPPRESSED : 2;
    const suppressedCount = aliveSquad.filter((s) => s.suppression >= suppressedAt).length;
    if (suppressedCount >= suppressMin) {
      const orders = [];
      for (const s of aliveSquad) {
        if (!s.weapon) continue;
        const enemy = _nearestEnemy(worldView, team, { q: s.q, r: s.r });
        if (!enemy) continue;
        const d = worldView.map.dist({ q: s.q, r: s.r }, { q: enemy.q, r: enemy.r });
        if (d > s.weapon.rngMax) continue;
        orders.push({ type: 'TARGET', soldierIds: [s.id], payload: { targetId: enemy.id, mode: 'suppress' } });
      }
      if (orders.length > 0) {
        return { name: 'SUPPRESS_FIRE', score: suppressedCount, orders: this._withNote(orders, '制圧しろ！頭を上げさせるな！') };
      }
    }

    // 4. HOLD_FIRE -- quiet for HOLDFIRE_QUIET_T and squad ammo fraction is low.
    const holdfireQuietT = T.HOLDFIRE_QUIET_T != null ? T.HOLDFIRE_QUIET_T : 300;
    const holdfireAmmoBelow = T.HOLDFIRE_AMMO_BELOW != null ? T.HOLDFIRE_AMMO_BELOW : 0.4;
    if (state.quietT >= holdfireQuietT && _squadAmmoFraction(worldView, team) < holdfireAmmoBelow) {
      const orders = aliveSquad.map((s) => ({ type: 'FIRE_MODE', soldierIds: [s.id], payload: { mode: 'hold' } }));
      return { name: 'HOLD_FIRE', orders: this._withNote(orders, '撃ち方やめ！') };
    }

    return null;
  },

  /** @private attach the same NCO note to every order in a batch (dev_sim renders it as a speech bubble) */
  _withNote: function (orders, note) {
    return orders.map((o) => Object.assign({}, o, { note: note }));
  },
};

// ---------------------------------------------------------------------------
// exports (UMD-ish: module.exports on node, global on browser)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LeaderPolicy: LeaderPolicy };
}
if (typeof window !== 'undefined') {
  window.LeaderPolicy = LeaderPolicy;
}
