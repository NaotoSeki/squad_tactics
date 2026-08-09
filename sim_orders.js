/**
 * sim_orders.js -- WS-B (NORTH_STAR SS3.4 comms delay / SIM_CORE_SPEC v1.0 SS12)
 *
 * Pure JS, zero dependencies, headless. No window/document/Phaser/setTimeout/Math.random.
 * Requireable from node, and exposed as a global in the browser (UMD-ish, see bottom).
 *
 * Implements the OrdersApi contract (SIM_CORE_SPEC.md SS8):
 *   orders = { queue(order, tick), deliveries(tick) -> [{soldierId, order}] }
 *
 * CommsOrders computes a per-target delivery tick at queue() time, based on
 * distance to the issuing team's living leader, LOS, radio equipment, and
 * leader-down shock state. sim_core.js is not required by this module.
 */

/**
 * @param {Object} opts
 * @param {function(string): Object|null} opts.getSoldier - id -> soldier snapshot/state
 *   (must expose at least { id, team, q, r, isLeader, hp, hasRadio }).
 * @param {function(): Object[]} opts.soldiers - all soldiers snapshot/state array.
 * @param {Object} opts.map - MapApi (SS3): dist(a,b), hasLos(a,b).
 * @param {Object} opts.tuning - SIM_TUNING (SS6/SS12 COMMS_* keys).
 */
function CommsOrders(opts) {
  opts = opts || {};
  if (!opts.getSoldier) throw new Error('CommsOrders: getSoldier is required');
  if (!opts.soldiers) throw new Error('CommsOrders: soldiers is required');
  if (!opts.map) throw new Error('CommsOrders: map is required');
  if (!opts.tuning) throw new Error('CommsOrders: tuning is required');

  this.getSoldier = opts.getSoldier;
  this.soldiers = opts.soldiers;
  this.map = opts.map;
  this.tuning = opts.tuning;

  // pending[tick] = [{soldierId, order}]
  this._pending = new Map();
  // per-team leader-down shock tracking: team -> deathTick (last observed)
  this._leaderDeathTick = new Map();
  // per-team last known living-leader position, retained after death so that
  // rule 3 (runner, distance-proportional) still has a reference point once
  // the leader is gone.
  this._lastLeaderPos = new Map();
}

/**
 * Find the living, isLeader soldier for a team (SS12 rule 2/5).
 * @private
 * @param {string} team
 * @returns {Object|null}
 */
CommsOrders.prototype._findLeader = function (team) {
  const all = this.soldiers();
  for (const s of all) {
    // incap の分隊長からは声が出ない（sim_core の昇格待ちと同じ扱い）
    if (s.team === team && s.isLeader && s.hp > 0 && s.state !== 'incap') {
      this._lastLeaderPos.set(team, { q: s.q, r: s.r });
      return s;
    }
  }
  return null;
};

/**
 * Track leader death per team so that the SS12 rule-5 shock window
 * (COMMS_SHOCK_T after the death tick) can be applied consistently even
 * across multiple queue() calls issued at different ticks.
 * @private
 * @param {string} team
 * @param {number} tick
 * @returns {number|null} death tick recorded for this team, or null if leader alive/never existed
 */
CommsOrders.prototype._leaderDeathTickFor = function (team, tick) {
  const leader = this._findLeader(team);
  if (leader) {
    // leader currently alive -> no shock state (if a leader was replaced/revived
    // this simplistic model has no continuity concept beyond "alive now")
    this._leaderDeathTick.delete(team);
    return null;
  }
  // no living leader: does the team have (had) any leader at all?
  const all = this.soldiers();
  const hadLeader = all.some((s) => s.team === team && s.isLeader);
  if (!hadLeader) return null;

  if (!this._leaderDeathTick.has(team)) {
    // first time we observe the leader missing; approximate death tick as "now".
    this._leaderDeathTick.set(team, tick);
  }
  return this._leaderDeathTick.get(team);
};

/** Read-only estimate used by UI; queue() uses the same calculation. */
CommsOrders.prototype.estimateDelay = function (soldierId, tick) {
  const target = this.getSoldier(soldierId);
  if (!target || target.hp <= 0) return null;
  return this._delayFor(target, tick, false);
};

CommsOrders.prototype._delayFor = function (target, tick, recordLeaderLoss) {
  const T = this.tuning;
  if (tick === 0) return 0;
  const leader = this._findLeader(target.team);
  const targetPos = { q: target.q, r: target.r };
  let delay;
  if (leader && this.map.dist({ q: leader.q, r: leader.r }, targetPos) <= T.COMMS_VOICE_RNG &&
      this.map.hasLos({ q: leader.q, r: leader.r }, targetPos)) {
    delay = T.COMMS_VOICE_DELAY_T;
  } else {
    const refPos = leader ? { q: leader.q, r: leader.r } : this._lastLeaderPos.get(target.team);
    const dist = refPos ? this.map.dist(refPos, targetPos) : 0;
    delay = dist * T.COMMS_RUNNER_T_PER_HEX;
  }
  if (target.hasRadio) {
    const withinVoice = leader &&
      this.map.dist({ q: leader.q, r: leader.r }, targetPos) <= T.COMMS_VOICE_RNG &&
      this.map.hasLos({ q: leader.q, r: leader.r }, targetPos);
    if (!withinVoice && T.COMMS_RADIO_DELAY_T < delay) delay = T.COMMS_RADIO_DELAY_T;
  }
  let deathTick = null;
  if (!leader) {
    deathTick = recordLeaderLoss ? this._leaderDeathTickFor(target.team, tick)
      : (this._leaderDeathTick.has(target.team) ? this._leaderDeathTick.get(target.team) : tick);
  }
  if (deathTick != null) {
    delay *= T.COMMS_LEADER_DOWN_MULT;
    const shockEnd = deathTick + T.COMMS_SHOCK_T;
    if (tick + delay < shockEnd) delay = shockEnd - tick;
  }
  return delay;
};

/**
 * Queue an order for delivery. Computes a delivery tick per target soldier
 * (SS12 rules 1-5) and stores it in the pending map.
 * @param {Object} order - { type, soldierIds, payload }
 * @param {number} tick - current sim tick at issue time
 */
CommsOrders.prototype.queue = function (order, tick) {
  for (const soldierId of order.soldierIds) {
    const target = this.getSoldier(soldierId);
    if (!target || target.hp <= 0) continue;
    // Keep visualization and delivery on one authoritative calculation.
    const delay = this._delayFor(target, tick, true);
    const deliveryTick = tick + delay;
    if (!this._pending.has(deliveryTick)) this._pending.set(deliveryTick, []);
    this._pending.get(deliveryTick).push({ soldierId: soldierId, order: order });
  }
};

/**
 * Return deliveries due exactly at `tick` (and flush anything that was
 * scheduled for a tick already passed, defensively) and clear them from
 * the pending map.
 * @param {number} tick
 * @returns {Array<{soldierId: string, order: Object}>}
 */
CommsOrders.prototype.deliveries = function (tick) {
  const out = [];
  for (const [dueTick, list] of this._pending) {
    if (dueTick <= tick) {
      for (const item of list) out.push(item);
      this._pending.delete(dueTick);
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// exports (UMD-ish: module.exports on node, global on browser)
// ---------------------------------------------------------------------------

const SimOrdersModule = {
  CommsOrders: CommsOrders,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SimOrdersModule;
}
if (typeof window !== 'undefined') {
  window.CommsOrders = CommsOrders;
}
