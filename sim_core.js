/**
 * sim_core.js -- WS-A (NORTH_STAR SS7.1 module layout / SIM_CORE_SPEC v1.0)
 *
 * Pure JS, zero dependencies, headless. No window/document/Phaser/setTimeout/Math.random.
 * Requireable from node, and exposed as a global in the browser (UMD-ish, see bottom).
 *
 * Public API (see docs/SIM_CORE_SPEC.md SS2 for details):
 *   new SimCore({ map, tuning, rng, policy, orders })
 *   sim.addSoldier(spec) -> soldierId
 *   sim.tick()                 // advance 100ms, synchronous
 *   sim.issueOrder(order)
 *   sim.getSoldier(id) / sim.soldiers()
 *   sim.drainEvents()
 *   sim.result()
 */

// ---------------------------------------------------------------------------
// mulberry32 -- deterministic seeded RNG (replacement for Math.random)
// ---------------------------------------------------------------------------

/**
 * mulberry32 PRNG factory.
 * @param {number} seed - 32bit integer seed
 * @returns {function(): number} function returning [0,1) each call
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// toSimWeapon -- WPNS/PL master data -> SimWeapon adapter (SS5)
// ---------------------------------------------------------------------------

/**
 * Heuristically classify a WPNS entry into a weapon class.
 * SIM_TUNING.WEAPON_CLASS_OVERRIDES[code] takes priority if present.
 * @param {string} code
 * @param {Object} wpnsEntry
 * @param {Object} tuning
 * @returns {'rifle'|'smg'|'mg'|'sniper'|'pistol'|'at'}
 */
function classifyWeapon(code, wpnsEntry, tuning) {
  const overrides = (tuning && tuning.WEAPON_CLASS_OVERRIDES) || {};
  if (overrides[code]) return overrides[code];

  const w = wpnsEntry || {};
  const type = w.type || 'bullet';
  const burst = w.burst || 1;
  const rng = w.rng || 0;
  const cap = w.cap || 0;

  if (type === 'melee') return 'rifle'; // fallback (unused class in this slice)
  if (type === 'rocket' || type === 'shell' || type === 'shell_fast') return 'at';
  if (burst >= 6 || cap >= 40) return 'mg';
  if (rng >= 9 && burst <= 1) return 'sniper';
  if (rng <= 5 && burst >= 2) return 'smg';
  if (cap <= 8 && burst === 1 && rng <= 4) return 'pistol';
  return 'rifle';
}

/**
 * Convert a WPNS/PL master entry into a SimWeapon (SS5).
 * @param {string} code - WPNS key
 * @param {Object} wpnsEntry - WPNS[code]
 * @param {Object} tuning - SIM_TUNING
 * @returns {Object} SimWeapon
 */
function toSimWeapon(code, wpnsEntry, tuning) {
  const w = wpnsEntry || {};
  const cls = classifyWeapon(code, w, tuning);
  const T = tuning;

  const burstIntervalTable = T.BURST_INTERVAL_T.aimed;
  const burstIntervalT = burstIntervalTable[cls] != null ? burstIntervalTable[cls] : burstIntervalTable.rifle;

  const reloadT = (T.RELOAD_T[cls] != null) ? T.RELOAD_T[cls] : T.RELOAD_T.rifle;
  const accBase = (T.PHIT_BASE[cls] != null) ? T.PHIT_BASE[cls] : T.PHIT_BASE.rifle;
  const suppressPerBurst = (T.SUPPRESS_PER_BURST[cls] != null) ? T.SUPPRESS_PER_BURST[cls] : T.SUPPRESS_PER_BURST.rifle;

  return {
    code: code,
    burstSize: Math.max(1, w.burst || 1),
    burstIntervalT: burstIntervalT,
    aimT: T.AIM_T.aimed,
    // Store real rounds. PL compatibility entries with no cap receive a safe
    // fallback derived from the former burst-based capacity.
    magCap: (w.cap != null && w.cap > 0)
      ? w.cap
      : Math.max(1, ((T.BURSTS_PER_MAG && T.BURSTS_PER_MAG[cls]) || 1)
        * Math.max(1, w.burst || 1)),
    reloadT: reloadT,
    switchT: T.SWITCH_T,
    rngMax: Math.max(1, w.rng || 1),
    rngMin: w.minRng || 0,
    accBase: accBase,
    suppressPerBurst: suppressPerBurst,
    class: cls,
  };
}

// ---------------------------------------------------------------------------
// InstantOrders -- WS-B placeholder (SS8). Immediate delivery.
// ---------------------------------------------------------------------------

/**
 * Immediate-delivery OrdersApi implementation. A queued Order is returned
 * on the very next deliveries(tick) call.
 */
function InstantOrders() {
  this._pending = [];
}
InstantOrders.prototype.queue = function (order, tick) {
  this._pending.push(order);
};
InstantOrders.prototype.deliveries = function (tick) {
  if (this._pending.length === 0) return [];
  const out = [];
  for (const order of this._pending) {
    for (const soldierId of order.soldierIds) {
      out.push({ soldierId: soldierId, order: order });
    }
  }
  this._pending = [];
  return out;
};

// ---------------------------------------------------------------------------
// DefaultPolicy -- WS-C placeholder (SS8)
// visible enemy in range -> engage / suppressed -> hold in current cover /
// out of ammo -> reload / otherwise -> idle
// ---------------------------------------------------------------------------

const DefaultPolicy = {
  /**
   * @param {Object} soldierView - read-only snapshot (self)
   * @param {Object} worldView - { soldiers: [...], map, tuning }
   * @param {function(): number} rng
   * @returns {Object} intent (same shape as Order)
   */
  decide: function (soldierView, worldView, rng) {
    const s = soldierView;

    if (s.magRemaining <= 0 && s.magsLeft <= 0) {
      return { type: 'HOLD_POS', soldierIds: [s.id], payload: {} };
    }
    if (s.magRemaining <= 0 && s.magsLeft > 0) {
      return { type: 'FIRE_MODE', soldierIds: [s.id], payload: { mode: 'reload' } };
    }
    if (s.suppression >= (worldView.tuning ? worldView.tuning.PINNED_AT : 80)) {
      return { type: 'HOLD_POS', soldierIds: [s.id], payload: { prone: true } };
    }

    const T = worldView.tuning || {};
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
      if (d > s.weapon.rngMax) continue;
      sawEnemy = true;
      // fire discipline: a target keeping its head down is not worth ammo
      // unless it is a close threat or on the move. suppressed targets are engaged
      // only probabilistically (harassing fire).
      if (other.suppression >= supAt && d > closeRng && other.state !== 'move') {
        const harassP = T.HARASS_FIRE_P != null ? T.HARASS_FIRE_P : 0.25;
        if (rng() >= harassP) continue;
      }
      // last magazine: only spend on worthwhile targets (moving / exposed / near)
      if (lastMag && !(other.state === 'move'
        || worldView.map.cover({ q: other.q, r: other.r }) < (T.DISCIPLINE_LAST_MAG_COVER_MAX || 0.3)
        || d <= s.weapon.rngMax / 3)) continue;
      if (d < bestDist) {
        bestDist = d;
        bestTarget = other;
      }
    }
    if (bestTarget) {
      return { type: 'TARGET', soldierIds: [s.id], payload: { targetId: bestTarget.id, mode: 'aimed' } };
    }
    if (sawEnemy) {
      return { type: 'HOLD_POS', soldierIds: [s.id], payload: {}, note: '射撃節制: 敵は頭を下げている' };
    }
    return { type: 'HOLD_POS', soldierIds: [s.id], payload: {} };
  },
};

// ---------------------------------------------------------------------------
// SimCore
// ---------------------------------------------------------------------------

const STATES = ['idle', 'move', 'engage', 'suppressed', 'pinned', 'reload', 'switch', 'assault', 'rout'];

/**
 * @param {Object} opts - { map, tuning, rng, policy, orders }
 */
function SimCore(opts) {
  opts = opts || {};
  if (!opts.map) throw new Error('SimCore: map is required');
  if (!opts.tuning) throw new Error('SimCore: tuning is required');
  if (!opts.rng) throw new Error('SimCore: rng is required');

  this.map = opts.map;
  this.tuning = opts.tuning;
  this.rng = opts.rng;
  this.policy = opts.policy || DefaultPolicy;
  this.orders = opts.orders || new InstantOrders();

  this._soldiers = new Map(); // id -> internal state
  this._events = [];
  this._tick = 0;
  this._result = null;
  this._nextAutoId = 1;
}

/**
 * Add a soldier.
 * @param {Object} spec - SoldierSpec (SS4). Also accepts an optional `facing`
 *   ({q,r} vector) to seed initial orientation for flank checks -- this is an
 *   implementation extension beyond the spec's field list, not a spec change.
 * @returns {string} soldierId
 */
SimCore.prototype.addSoldier = function (spec) {
  const id = spec.id != null ? spec.id : ('s' + (this._nextAutoId++));
  const s = {
    id: id,
    team: spec.team,
    q: spec.q,
    r: spec.r,
    name: spec.name || id,
    weapon: spec.weapon,
    ammo: { mags: spec.ammo && spec.ammo.mags != null ? spec.ammo.mags : 0 },
    grenades: spec.grenades || 0,
    skill: spec.skill != null ? spec.skill : 1.0,
    isLeader: !!spec.isLeader,
    traits: spec.traits || [],

    hp: 100,
    state: 'idle',
    stateT: 0,
    suppression: 0,
    morale: 100,
    magRemaining: spec.weapon ? spec.weapon.magCap : 0,
    magsLeft: spec.ammo && spec.ammo.mags != null ? spec.ammo.mags : 0,
    fireMode: 'hold',
    facing: spec.facing || null,
    currentOrder: null,
    movePath: null,
    aimT: 0,
    reloadT: 0,
    switchT: 0,
    engageTargetId: null,
    engageT: 0,
    quietT: 0, // ticks since last shot/hit (drives SUPPRESS_DECAY)
    routCheckT: 0,
    lastMoveHexOpen: false,
    decisionPhase: (this._soldiers.size % Math.max(1, this.tuning.DECISION_INTERVAL_T)),
  };
  this._soldiers.set(id, s);
  return id;
};

/**
 * Push an event onto the buffer.
 * @private
 */
SimCore.prototype._emit = function (type, payload) {
  const ev = Object.assign({ tick: this._tick, type: type }, payload);
  this._events.push(ev);
};

/**
 * Issue an order. Delivered via the orders module (SS8).
 * @param {Object} order
 */
SimCore.prototype.issueOrder = function (order) {
  this.orders.queue(order, this._tick);
};

/**
 * Read-only snapshot (copy) of a soldier.
 * @param {string} id
 * @returns {Object|null}
 */
SimCore.prototype.getSoldier = function (id) {
  const s = this._soldiers.get(id);
  if (!s) return null;
  return this._snapshot(s);
};

SimCore.prototype._snapshot = function (s) {
  return {
    id: s.id, team: s.team, q: s.q, r: s.r, name: s.name,
    weapon: s.weapon, ammo: { mags: s.magsLeft }, grenades: s.grenades, skill: s.skill,
    isLeader: s.isLeader, traits: s.traits.slice(),
    hp: s.hp, state: s.state, stateT: s.stateT,
    suppression: s.suppression, morale: s.morale, underFireT: s.underFireT,
    magRemaining: s.magRemaining, magsLeft: s.magsLeft, fireMode: s.fireMode,
    facing: s.facing, engageTargetId: s.engageTargetId,
    currentOrder: s.currentOrder, movePath: s.movePath ? s.movePath.slice() : null,
    aimT: s.aimT, reloadT: s.reloadT,
  };
};

/**
 * Read-only snapshots of all soldiers.
 * @returns {Object[]}
 */
SimCore.prototype.soldiers = function () {
  const out = [];
  this._soldiers.forEach((s) => out.push(this._snapshot(s)));
  return out;
};

/**
 * Return events queued since the last drain and clear the buffer.
 * @returns {Object[]}
 */
SimCore.prototype.drainEvents = function () {
  const out = this._events;
  this._events = [];
  return out;
};

/**
 * Outcome. null while undecided.
 * @returns {null|{winner:string, reason:string, tick:number}}
 */
SimCore.prototype.result = function () {
  return this._result;
};

// ---------------------------------------------------------------------------
// tick pipeline (SS7, fixed order)
// ---------------------------------------------------------------------------

SimCore.prototype.tick = function () {
  if (this._result) return; // stop progressing once decided

  this._tick++;

  this._phaseDeliverOrders();
  this._phaseDecide();
  this._phaseAct(); // includes fire resolution (SS7 step 3-4: engage state resolves bursts inline)
  this._phaseSuppressionMorale();
  this._phaseCheckResult();
};

// 1. collect orders.deliveries(tick)
SimCore.prototype._phaseDeliverOrders = function () {
  const deliveries = this.orders.deliveries(this._tick);
  for (const d of deliveries) {
    const s = this._soldiers.get(d.soldierId);
    if (!s || s.hp <= 0) continue;
    s.currentOrder = d.order;
    s.currentOrderT = this._tick;   // 失効判定用（下の _phaseDecide 参照）
    this._emit('ORDER_DELIVERED', { id: s.id, order: d.order });
  }
};

// 2. decision making (every DECISION_INTERVAL_T ticks, phase-staggered per soldier)
SimCore.prototype._phaseDecide = function () {
  const T = this.tuning;
  const interval = Math.max(1, T.DECISION_INTERVAL_T);
  // tick は policy が「今撃たれているか」(underFireT との差) を判定するのに使う
  const worldView = { soldiers: this.soldiers(), map: this.map, tuning: T, tick: this._tick };

  this._soldiers.forEach((s) => {
    if (s.hp <= 0) return;
    if (s.state === 'rout' || s.state === 'assault') return;
    if ((this._tick + s.decisionPhase) % interval !== 0) return;

    // 命令の失効。TARGET は他の命令型と違い誰も消費しないため、放置すると
    // **永続する**。すると decide() が二度と呼ばれず、その兵士は以後まったく
    // 自己判断しなくなる — §3.4「命令が届くまでの間、兵は自分のトレイトに従って
    // 行動する」も §7.4 基準4「無命令時間にトレイト由来の行動」も、無命令時間が
    // 存在しないので原理的に成立しなくなる（2026-07-31 実測: 分隊長AIありで
    // トレイト行動を見せた兵は5シードとも0名、AIを止めると4〜7名）。
    // 下士官の「あいつを狙え」は永久命令ではない。的が死ぬか、一定時間で失効する。
    if (s.currentOrder && s.currentOrder.type === 'TARGET') {
      const expireT = T.ORDER_TARGET_EXPIRE_T;
      const targetId = s.currentOrder.payload && s.currentOrder.payload.targetId;
      const target = targetId ? this._soldiers.get(targetId) : null;
      const targetGone = !target || target.hp <= 0;
      // 制圧射撃(suppress)には寿命を課さない。制圧は定義上**持続させる**任務で、
      // 途中で「やっぱり自分で考えます」と抜けたら頭が上がってしまう
      // （§3.3 の弾薬経済の前提もここに乗る: tests/sim_core.test.js T4）。
      // 照準射撃は区切りのある行為なので、時間が経てば自分の判断へ戻ってよい。
      // ※「engage 状態でないこと」を条件にしていた版は、観測休止(FIRE_OBSERVE_T)の
      //   間も engage のままなので実質いつまでも失効せず、無命令時間が消えた。
      const timedOut = expireT != null && s.fireMode !== 'suppress'
        && (this._tick - (s.currentOrderT || 0)) >= expireT;
      if (targetGone || timedOut) {
        s.currentOrder = null;
        this._emit('ORDER_LAPSED', { id: s.id, reason: targetGone ? 'target_down' : 'expired' });
      }
    }

    let intent = null;
    if (s.currentOrder) {
      intent = s.currentOrder;
      // 自衛は命令に割り込める（NORTH_STAR §3.2「pinned: 自衛のみ」）。
      // TARGET は一度も消費されず永続するため、これが無いと「一度撃てと言われた兵士は
      // 以後永久に自己判断せず、撃たれても遮蔽へ移らない」状態になる。
      // 割り込むのは射撃系の命令だけ。MOVE_TO へは割り込まない（プレイヤーが意図した
      // 機動を二度手間にしない）。policy が selfPreserve を持たない場合は従来通り。
      if ((intent.type === 'TARGET' || intent.type === 'FIRE_MODE')
        && typeof this.policy.selfPreserve === 'function') {
        const preserve = this.policy.selfPreserve(this._snapshot(s), worldView, this.rng);
        if (preserve && preserve.type === 'MOVE_TO') {
          intent = preserve;
          if (preserve.note && preserve.note !== s.lastPolicyNote) {
            s.lastPolicyNote = preserve.note;
            this._emit('POLICY', { id: s.id, note: preserve.note });
          }
        }
      }
    } else {
      intent = this.policy.decide(this._snapshot(s), worldView, this.rng);
      // trait visibility: surface policy notes as events, once per distinct note
      if (intent && intent.note && intent.note !== s.lastPolicyNote) {
        s.lastPolicyNote = intent.note;
        this._emit('POLICY', { id: s.id, note: intent.note });
      }
    }
    this._applyIntent(s, intent, worldView);
  });
};

SimCore.prototype._applyIntent = function (s, intent, worldView) {
  if (!intent) return;
  switch (intent.type) {
    case 'TARGET':
      s.engageTargetId = intent.payload.targetId;
      s.fireMode = intent.payload.mode || 'aimed';
      // Do not interrupt reload/switch/move with a re-applied TARGET intent
      // (currentOrder persists and is re-evaluated every decision tick).
      if (s.state === 'idle') {
        this._setState(s, 'engage');
        s.aimT = (s.fireMode === 'suppress') ? this.tuning.AIM_T.suppress : this.tuning.AIM_T.aimed;
      }
      break;
    case 'FIRE_MODE':
      if (intent.payload.mode === 'reload') {
        if (s.state !== 'reload' && s.magsLeft > 0) {
          this._setState(s, 'reload');
          s.reloadT = s.weapon.reloadT;
        }
      } else {
        s.fireMode = intent.payload.mode;
      }
      // one-shot: fireMode is now soldier state; if the order persisted it
      // would shadow policy.decide forever (e.g. a hold-fire order would
      // leave the soldier unable to ever fight back on his own judgement)
      if (s.currentOrder === intent) s.currentOrder = null;
      break;
    case 'MOVE_TO':
      s.movePath = intent.payload.path ? intent.payload.path.slice() : null;
      this._setState(s, 'move');
      break;
    case 'TAKE_COVER': {
      // 「遮蔽へ入れ」。行き先は命令に含まれず、**届いた瞬間に現場で**決める
      // （NORTH_STAR §3.4 三現主義）。伝達遅延があるので、発令時に解決すると
      // 届く頃には無意味な地点を指していることになる。
      if (worldView && this.policy && typeof this.policy.seekCoverForOrder === 'function') {
        const resolved = this.policy.seekCoverForOrder(
          this._snapshot(s), worldView, this.rng, intent.payload || {});
        if (resolved) {
          if (resolved.type === 'MOVE_TO') {
            s.movePath = resolved.payload.path ? resolved.payload.path.slice() : null;
            this._setState(s, 'move');
          } else if (resolved.type === 'HOLD_POS') {
            if (s.state === 'engage') this._setState(s, 'idle');
          }
          if (resolved.note && resolved.note !== s.lastPolicyNote) {
            s.lastPolicyNote = resolved.note;
            this._emit('POLICY', { id: s.id, note: resolved.note });
          }
        }
      }
      // one-shot: 解決できたか否かに関わらず必ず解除する。TARGET のように永続
      // させると毎決定tickで再解決され、兵士が以後まったく自己判断しなくなる
      // （同じ罠を TARGET で踏んでいる。sim_policy.selfPreserve のコメント参照）。
      if (s.currentOrder === intent) s.currentOrder = null;
      break;
    }
    case 'HOLD_POS':
      // intent.payload.prone: suppressed/pinned handling stays with the
      // suppression phase; HOLD_POS here just cancels active engagement intent.
      if (s.state === 'engage') this._setState(s, 'idle');
      break;
    case 'ASSAULT':
      s.engageTargetId = intent.payload.targetId;
      this._setState(s, 'assault');
      break;
    case 'GRENADE':
      // Simplified beyond v2.0 slice scope; handled in the action phase.
      s.pendingGrenadeTarget = intent.payload.target;
      break;
    default:
      break;
  }
};

SimCore.prototype._setState = function (s, newState) {
  if (s.state === newState) return;
  const from = s.state;
  s.state = newState;
  s.stateT = 0;
  this._emit('STATE', { id: s.id, from: from, to: newState });
};

// 3. action progression (per-state timers)
SimCore.prototype._phaseAct = function () {
  const T = this.tuning;
  this._soldiers.forEach((s) => {
    if (s.hp <= 0) return;
    s.stateT++;

    switch (s.state) {
      case 'move':
        this._actMove(s, T);
        break;
      case 'engage':
        this._actEngage(s, T);
        break;
      case 'reload':
        this._actReload(s, T);
        break;
      case 'switch':
        s.switchT--;
        if (s.switchT <= 0) this._setState(s, 'idle');
        break;
      case 'assault':
        this._actAssault(s, T);
        break;
      case 'suppressed':
      case 'pinned':
        // self-defense only: a suppressed shooter may still engage (pHit penalty applies)
        if (s.engageTargetId) this._actEngage(s, T);
        break;
      default:
        break;
    }
  });
};

SimCore.prototype._actMove = function (s, T) {
  if (!s.movePath || s.movePath.length === 0) {
    // path fulfilled: a MOVE_TO order is one-shot, so consume it here --
    // otherwise the persisting currentOrder re-applies the same path every
    // decision tick and the soldier "moves" in place forever
    if (s.currentOrder && s.currentOrder.type === 'MOVE_TO') s.currentOrder = null;
    this._setState(s, 'idle');
    return;
  }
  s._moveAccum = (s._moveAccum || 0) + 1;
  const next = s.movePath[0];
  const cost = this.map.moveCost(next) || 1;
  const proneMult = (s.state === 'pinned' || s.suppression >= T.PINNED_AT) ? 2 : 1;
  const needed = T.MOVE_T_PER_HEX * cost * proneMult;
  if (s._moveAccum >= needed) {
    const from = { q: s.q, r: s.r };
    s.q = next.q; s.r = next.r;
    s.facing = { q: next.q - from.q, r: next.r - from.r };
    s._moveAccum = 0;
    s.movePath.shift();
    this._emit('MOVE', { id: s.id, from: from, to: { q: s.q, r: s.r } });
    if (s.movePath.length === 0) {
      if (s.currentOrder && s.currentOrder.type === 'MOVE_TO') s.currentOrder = null;
      this._setState(s, 'idle');
    }
  }
};

SimCore.prototype._actEngage = function (s, T) {
  if (!s.engageTargetId) return;
  const target = this._soldiers.get(s.engageTargetId);
  if (!target || target.hp <= 0) {
    s.engageTargetId = null;
    if (s.state === 'engage') this._setState(s, 'idle');
    return;
  }
  if (s.magRemaining <= 0) {
    if (s.magsLeft > 0) {
      this._setState(s, 'reload');
      s.reloadT = s.weapon.reloadT;
    } else {
      this._emit('AMMO_OUT', { id: s.id });
      this._setState(s, 'idle');
      s.fireMode = 'hold';
    }
    return;
  }

  if (s.aimT > 0) {
    s.aimT--;
    return;
  }
  if (!s._burstIntervalRemaining || s._burstIntervalRemaining <= 0) {
    this._resolveBurst(s, target, T);
    let base = (s.fireMode === 'suppress')
      ? Math.round(s.weapon.burstIntervalT / 2)
      : s.weapon.burstIntervalT;

    // 制圧は命中率だけでなく**手数**も奪う。pHit だけを罰していた版では、
    // 制圧されても発砲リズムが変わらないため「撃ち合いの潮目」が生まれず、
    // 両軍が一定間隔で撃ち続ける定常ノイズになっていた。
    if (s.state === 'pinned' || s.suppression >= T.PINNED_AT) {
      base *= (T.FIRE_INTERVAL_PINNED_MULT || 1);
    } else if (s.state === 'suppressed' || s.suppression >= T.SUPPRESSED_AT) {
      base *= (T.FIRE_INTERVAL_SUPPRESSED_MULT || 1);
    }

    const J = (T.BURST_JITTER != null) ? T.BURST_JITTER : 0;
    let interval = Math.max(1, Math.round(base * (1 - J + this.rng() * 2 * J)));

    // ひと区切り撃ったら効果を観測する休止を入れる。等間隔の連射だけだと、
    // 独立した射手が重なって「止まらない定常ノイズ」になる（実測 Fano係数 0.79 =
    // ポアソンより規則的、最長の沈黙2.0秒）。数発撃って様子を見る、が銃撃戦の形。
    // ただし制圧射撃には掛けない。制圧は定義上**持続させる**もので、様子を見て
    // 止めたら頭が上がってしまい意味が無い（§3.3「suppress は約1弾倉/40秒を
    // 燃やす」という弾薬経済の前提もここに乗っている）。結果として、制圧を
    // 命じると撃ち合いの音そのものが変わる — 散発的な応射が持続射撃に変わる。
    const V = T.FIRE_VOLLEY_BURSTS;
    const O = T.FIRE_OBSERVE_T;
    if (V && O && s.fireMode !== 'suppress') {
      const pick = (r) => r.min + Math.floor(this.rng() * (r.max - r.min + 1));
      if (!s._volleySize) s._volleySize = pick(V);
      s._burstsInVolley = (s._burstsInVolley || 0) + 1;
      if (s._burstsInVolley >= s._volleySize) {
        s._burstsInVolley = 0;
        s._volleySize = pick(V);
        interval += pick(O);
      }
    }
    s._burstIntervalRemaining = interval;
  } else {
    s._burstIntervalRemaining--;
  }
};

SimCore.prototype._actReload = function (s, T) {
  if (s.reloadT === s.weapon.reloadT) {
    this._emit('RELOAD_START', { id: s.id });
  }
  s.reloadT--;
  if (s.reloadT <= 0) {
    s.magsLeft--;
    s.magRemaining = s.weapon.magCap;
    this._emit('RELOAD_END', { id: s.id });
    this._setState(s, 'idle');
  }
};

SimCore.prototype._actAssault = function (s, T) {
  if (s._assaultT == null) s._assaultT = 10; // simplified: fixed ticks to resolve
  s._assaultT--;
  if (s._assaultT > 0) return;
  const target = this._soldiers.get(s.engageTargetId);
  s._assaultT = null;
  if (!target || target.hp <= 0) {
    this._setState(s, 'idle');
    return;
  }
  const winP = (target.state === 'pinned') ? T.ASSAULT_WIN_VS_PINNED : T.ASSAULT_WIN_VS_ACTIVE;
  const won = this.rng() < winP;
  this._emit('ASSAULT', { id: s.id, targetId: target.id, won: won });
  if (won) {
    this._applyDamage(target, target.hp, s);
  } else {
    this._applyDamage(s, s.hp, target);
  }
  this._setState(s, 'idle');
};

// 4. fire resolution (pHit calculation, SS6)
SimCore.prototype._resolveBurst = function (shooter, target, T) {
  const dist = this.map.dist({ q: shooter.q, r: shooter.r }, { q: target.q, r: target.r });
  const cover = this.map.cover({ q: target.q, r: target.r });
  const hasLos = this.map.hasLos({ q: shooter.q, r: shooter.r }, { q: target.q, r: target.r });

  // A blocked shot is not fired, so it must not spend rounds or create a
  // flash/tracer that has no matching projectile event.
  if (!hasLos) return;

  // One resolution is one burst; consume the actual projectiles in it. A
  // nearly empty magazine naturally produces a shorter final burst.
  const roundsFired = Math.max(1, Math.min(
    shooter.magRemaining,
    (shooter.weapon && shooter.weapon.burstSize) || 1
  ));
  shooter.magRemaining -= roundsFired;
  shooter.quietT = 0;
  target.quietT = 0;

  let pHit = shooter.weapon.accBase;

  // range band multiplier
  const near = shooter.weapon.rngMax / 3;
  if (dist <= near) pHit *= T.PHIT_RANGE_FALLOFF.near;
  else if (dist <= shooter.weapon.rngMax) pHit *= T.PHIT_RANGE_FALLOFF.mid;
  else pHit *= T.PHIT_RANGE_FALLOFF.far;

  // flank/rear (replaces cover rather than stacking) and exposure
  const isFlank = this._isFlank(shooter, target);
  if (isFlank) {
    pHit *= T.PHIT_FLANK_MULT;
  } else if (target.state === 'move') {
    // movers forfeit hex cover; sustained-fire weapons (MG) punish movement hardest
    const mv = T.PHIT_MOVING_MULT || {};
    const mult = (mv[shooter.weapon.class] != null) ? mv[shooter.weapon.class] : (mv.default || 1.5);
    pHit *= mult;
  } else if (cover <= 0) {
    pHit *= T.PHIT_EXPOSED_MULT;
  } else {
    pHit *= (1 - cover);
  }

  // overlapping aim: 3+ shooters on one target pin it fast but do not kill fast
  if (T.FOCUS_PHIT_PENALTY_PER_EXTRA) {
    let others = 0;
    this._soldiers.forEach((o) => {
      if (o.hp > 0 && o.id !== shooter.id && o.team === shooter.team
        && o.engageTargetId === target.id && o.state === 'engage') others++;
    });
    if (others >= 2) {
      pHit *= Math.max(T.FOCUS_PHIT_FLOOR || 0.4, 1 - T.FOCUS_PHIT_PENALTY_PER_EXTRA * (others - 1));
    }
  }

  // shooter's own suppression
  if (shooter.state === 'pinned') pHit *= T.PHIT_SHOOTER_SUPPRESSED_PINNED.pinned;
  else if (shooter.state === 'suppressed') pHit *= T.PHIT_SHOOTER_SUPPRESSED_PINNED.suppressed;

  // skill
  pHit *= shooter.skill;

  // fire mode
  pHit *= (shooter.fireMode === 'suppress') ? T.PHIT_SUPPRESS_MODE : T.PHIT_AIMED;

  pHit = Math.max(0, Math.min(1, pHit));

  const hitRoll = this.rng();
  const hit = hitRoll < pHit;

  let killed = false;
  let crit = false;
  if (hit) {
    if (cover <= 0) {
      crit = this.rng() < T.CRIT_EXPOSED;
    }
    const dmg = crit ? target.hp : this._rollDamage(T);
    killed = this._applyDamage(target, dmg, shooter);
  }

  this._emit('SHOT', {
    shooterId: shooter.id,
    targetId: target.id,
    roundsFired: roundsFired,
    hit: hit,
    killed: killed,
    crit: crit
  });

  // suppression (applied on hit or miss -- near-misses suppress too)
  this._addSuppression(target, shooter.weapon.suppressPerBurst, T);
  // 「今撃たれている」時刻。自衛の反射は制圧値ではなくこの時刻で判定する
  // （弾が来たから動く、が自然）。
  target.underFireT = this._tick;
  this._checkSuppressionThresholds(target, T);

  shooter.facing = { q: target.q - shooter.q, r: target.r - shooter.r };
};

/**
 * 制圧値を加算する。**単位時間あたりの上限**を掛けるのが本体。
 *
 * 集中射撃で複数人が同一目標へ撃つと、素の加算だと 0 から 100 へ即座に飽和し、
 * 制圧ゲージが 0/100 の二値になっていた（2026-07-30 実測: 10名が
 * 0,0,0,0,4,6,26,0,100,100）。これは NORTH_STAR §7.4 基準1「散発射撃と制圧ゲージが
 * 観察できる」に反し、中間帯を条件にした自衛の反射も原理的に発火しなくなる。
 *
 * 「人はどれだけ多人数に撃たれても、単位時間あたりに怖くなれる量には上限がある」と
 * 解釈して 1秒窓の加算量を頭打ちにする。武器ごとの差(SUPPRESS_PER_BURST)は
 * 単発では従来どおり効く。
 */
SimCore.prototype._addSuppression = function (target, amount, T) {
  const maxPerSec = T.SUPPRESS_MAX_PER_SEC;
  let add = amount;

  if (maxPerSec != null && maxPerSec > 0) {
    const ticksPerSec = 1000 / (T.TICK_MS || 100);
    if (target.supWinStartT == null || (this._tick - target.supWinStartT) >= ticksPerSec) {
      target.supWinStartT = this._tick;
      target.supWinSum = 0;
    }
    const room = Math.max(0, maxPerSec - (target.supWinSum || 0));
    add = Math.min(add, room);
    target.supWinSum = (target.supWinSum || 0) + add;
  }

  target.suppression = Math.min(100, target.suppression + add);
};

SimCore.prototype._isFlank = function (shooter, target) {
  if (!target.facing) return false;
  // Dot product of (target -> shooter) with target.facing (target's front direction).
  // Negative = shooter is behind/to the side of target's facing = flank/rear shot.
  //
  // hex の axial 基底は 60度 で**直交していない**ので、`aq*bq + ar*br` は幾何的な
  // 内積にならない。実座標 x=√3(q+r/2), y=1.5r で展開すると交差項が出る:
  //   dot ∝ aq*bq + ar*br + (aq*br + ar*bq)/2
  // これが無い版は相対位置の 8.7% で判定を誤り、隣接6方向のうち背面と見なす向きが
  // 6方位中4方位で 3方向 -> 2方向 に狭まっていた。§3.2 の殺傷ベクトル1
  // 「機動こそ殺傷力」の判定そのものなので、狭いと機動の価値が丸ごと目減りする。
  const toShooterQ = shooter.q - target.q;
  const toShooterR = shooter.r - target.r;
  const fq = target.facing.q, fr = target.facing.r;
  const dot = toShooterQ * fq + toShooterR * fr + 0.5 * (toShooterQ * fr + toShooterR * fq);
  return dot < 0;
};

SimCore.prototype._rollDamage = function (T) {
  const base = T.DMG_HIT.base;
  const spread = T.DMG_HIT.spread;
  return Math.max(1, Math.round(base + (this.rng() * 2 - 1) * spread));
};

/**
 * Apply damage. Returns true if it kills the target.
 * @private
 */
SimCore.prototype._applyDamage = function (target, dmg, source) {
  if (target.hp <= 0) return false;
  target.hp = Math.max(0, target.hp - dmg);
  this._emit('HIT', { id: target.id, hp: target.hp });
  if (target.hp <= 0) {
    this._emit('DOWN', { id: target.id });
    target.state = 'down';
    target.stateT = 0;
    this._applyMoraleOnDeath(target);
    return true;
  }
  return false;
};

SimCore.prototype._applyMoraleOnDeath = function (deadSoldier) {
  const T = this.tuning;
  this._soldiers.forEach((s) => {
    if (s.hp <= 0 || s.team !== deadSoldier.team || s.id === deadSoldier.id) return;
    const d = this.map.dist({ q: s.q, r: s.r }, { q: deadSoldier.q, r: deadSoldier.r });
    if (d <= 3) {
      s.morale = Math.max(0, s.morale + T.MORALE_CASUALTY_NEAR);
    }
    if (deadSoldier.isLeader) {
      s.morale = Math.max(0, s.morale + T.MORALE_LEADER_DOWN);
    }
  });
};

SimCore.prototype._checkSuppressionThresholds = function (s, T) {
  const wasSuppressed = s.state === 'suppressed' || s.state === 'pinned';
  const wasPinned = s.state === 'pinned';

  if (s.suppression >= T.PINNED_AT && !wasPinned) {
    this._setState(s, 'pinned');
    this._emit('PINNED', { id: s.id });
  } else if (s.suppression >= T.SUPPRESSED_AT && !wasSuppressed) {
    this._setState(s, 'suppressed');
    this._emit('SUPPRESSED', { id: s.id });
  }
};

// 5. suppression decay & morale (decay, threshold crossing, rout check)
SimCore.prototype._phaseSuppressionMorale = function () {
  const T = this.tuning;
  const ticksPerSec = 1000 / T.TICK_MS;
  const quietThresholdT = 3 * ticksPerSec;
  const decayPerTick = T.SUPPRESS_DECAY / ticksPerSec;

  this._soldiers.forEach((s) => {
    if (s.hp <= 0) return;
    s.quietT++;

    if (s.suppression > 0 && s.quietT >= quietThresholdT) {
      const before = s.suppression;
      s.suppression = Math.max(0, s.suppression - decayPerTick);
      if (before >= T.PINNED_AT && s.suppression < T.PINNED_AT) {
        this._emit('RECOVERED', { id: s.id });
        this._setState(s, (s.suppression >= T.SUPPRESSED_AT) ? 'suppressed' : 'idle');
      } else if (before >= T.SUPPRESSED_AT && s.suppression < T.SUPPRESSED_AT) {
        this._emit('RECOVERED', { id: s.id });
        this._setState(s, 'idle');
      }
    }

    if (s.state === 'pinned') {
      s.morale = Math.max(0, s.morale - (T.MORALE_PINNED_DRAIN / ticksPerSec));
    }

    // rout check (below ROUT_CHECK_BELOW, rolled every 5 seconds)
    s.routCheckT++;
    const routCheckIntervalT = 5 * ticksPerSec;
    if (s.morale < T.ROUT_CHECK_BELOW && s.routCheckT >= routCheckIntervalT) {
      s.routCheckT = 0;
      if (this.rng() < (1 - s.morale / 100)) {
        if (s.state !== 'rout' && s.state !== 'down') {
          this._setState(s, 'rout');
          this._emit('ROUT', { id: s.id });
        }
      }
    } else if (s.routCheckT >= routCheckIntervalT) {
      s.routCheckT = 0;
    }
  });
};

// 6. outcome check
SimCore.prototype._phaseCheckResult = function () {
  if (this._result) return;
  const teams = new Map(); // team -> { alive, active }
  this._soldiers.forEach((s) => {
    if (!teams.has(s.team)) teams.set(s.team, { alive: 0, active: 0 });
    const t = teams.get(s.team);
    if (s.hp > 0) {
      t.alive++;
      if (s.state !== 'rout') t.active++;
    }
  });

  const teamList = Array.from(teams.keys());
  if (teamList.length < 2) return;

  const defeated = [];
  teams.forEach((t, team) => {
    if (t.alive === 0 || t.active === 0) defeated.push(team);
  });

  if (defeated.length === 0) return;

  const survivors = teamList.filter((t) => defeated.indexOf(t) === -1);
  if (survivors.length === 1) {
    const anyAlive = teams.get(survivors[0]).alive > 0;
    const reason = teams.get(defeated[0]).alive === 0 ? 'annihilation' : 'rout';
    this._result = { winner: anyAlive ? survivors[0] : null, reason: reason, tick: this._tick };
    this._emit('RESULT', { winner: this._result.winner, reason: this._result.reason });
  } else if (survivors.length === 0) {
    this._result = { winner: null, reason: 'mutual', tick: this._tick };
    this._emit('RESULT', { winner: null, reason: 'mutual' });
  }
};

// ---------------------------------------------------------------------------
// exports (UMD-ish: module.exports on node, global on browser)
// ---------------------------------------------------------------------------

const SimCoreModule = {
  SimCore: SimCore,
  mulberry32: mulberry32,
  toSimWeapon: toSimWeapon,
  InstantOrders: InstantOrders,
  DefaultPolicy: DefaultPolicy,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SimCoreModule;
}
if (typeof window !== 'undefined') {
  window.SimCore = SimCore;
  window.mulberry32 = mulberry32;
  window.toSimWeapon = toSimWeapon;
  window.InstantOrders = InstantOrders;
  window.DefaultPolicy = DefaultPolicy;
}
