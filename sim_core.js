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

function m2BallisticsApi() {
  if (typeof globalThis !== 'undefined' && globalThis.M2Mortar) return globalThis.M2Mortar;
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    try { return require('./m2_mortar.js'); } catch (e) { return null; }
  }
  return null;
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

// PL正本の武器統計（data/pl_weapon_stats.js）。sim_core は依存ゼロの契約なので
// import せず、明示セッターか globalThis 経由で受け取る。未設定なら
// SIM_TUNING の PHIT_FALLBACK 等（クラス別の代表値）へ落ちる。
let _plStats = null;
let _plAlias = null;

/** PL武器統計を注入する（テストは明示的に呼ぶ）。 */
function setPlWeaponStats(stats, alias) {
  _plStats = stats || null;
  _plAlias = alias || null;
}

/** WPNSコード -> PL統計。旧来の手書きコードは別名表を経由する。 @private */
function plStatsFor(code) {
  let stats = _plStats;
  let alias = _plAlias;
  if (!stats && typeof globalThis !== 'undefined' && globalThis.PL_WEAPON_STATS) {
    stats = globalThis.PL_WEAPON_STATS;
    alias = alias || globalThis.PL_WEAPON_STATS_ALIAS;
  }
  if (!stats || !code) return null;
  if (stats[code]) return stats[code];
  const aliased = alias && alias[code];
  return (aliased && stats[aliased]) || null;
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
  const suppressPerBurst = (T.SUPPRESS_PER_BURST[cls] != null) ? T.SUPPRESS_PER_BURST[cls] : T.SUPPRESS_PER_BURST.rifle;

  // 1トリガーの弾数（single/burst/auto）。**WPNS.burst は使わない** — 素データの
  // burst は連射段数として一貫していない（M2 HB HMG が burst:1、MG42 が burst:10、
  // M1917A1 MMG が burst:2）。正本は音源の実測に合わせたクラス表 ROUNDS_PER_PULL で、
  // これで初めて「鳴っている弾数」と「減る弾数」が一致する。
  // 表に無いクラス（at 等）は素データの burst へ落とす — rifle の値を当てると
  // 戦車砲が1トリガー2発になる。
  const roundsPerPull = T.ROUNDS_PER_PULL || {};
  const burstTable = roundsPerPull.burst || {};
  const burstRounds = Math.max(1, (burstTable[cls] != null)
    ? burstTable[cls]
    : Math.max(1, w.burst || 1));
  const autoOverrides = T.WEAPON_AUTO_OVERRIDES || {};
  const autoCapable = T.AUTO_CAPABLE || {};
  const canAuto = (typeof autoOverrides[code] === 'boolean')
    ? autoOverrides[code]
    : autoCapable[cls] === true;
  const autoRounds = canAuto ? ((roundsPerPull.auto || {})[cls] || 0) : 0;

  // PL正本の武器統計（銃固有の命中率・命中低下・貫通力・貫通低下）。
  // 統計を持たない武器はクラス別の代表値へ落ちる。
  const pl = plStatsFor(code);
  const pick = (table, fallback) => {
    if (!table) return fallback;
    return (table[cls] != null) ? table[cls] : (table.rifle != null ? table.rifle : fallback);
  };
  const bespokeMortar = code === 'm2_mortar';
  const accPct = (pl && pl.acc != null) ? pl.acc
    : (bespokeMortar && w.acc != null ? w.acc : pick(T.PHIT_FALLBACK, 70));
  const accDropPct = (pl && pl.accDrop != null) ? pl.accDrop
    : (bespokeMortar && w.acc_drop != null ? w.acc_drop : pick(T.PHIT_FALLBACK_DROP, 6));
  const penBase = (pl && pl.pen != null) ? pl.pen
    : (bespokeMortar && w.dmg != null ? w.dmg : pick(T.PEN_FALLBACK, 72));
  const penDrop = (pl && pl.penDrop != null) ? pl.penDrop
    : (bespokeMortar && w.pen_drop != null ? w.pen_drop : pick(T.PEN_FALLBACK_DROP, 3));
  // 白兵専用の攻撃力。**弾丸の威力ではない**（PL正本のモデル）。
  // 「その物で殴れるか」を表す: 拳銃2(銃底)/小銃5(銃床)/重機関銃0(振り回せない)。
  // 銃剣は aux として加算される（M1903A1 の5 + 銃剣4 = 9）。
  // 現状の白兵解決(_resolveMelee)はまだこの値を見ていない。
  const meleeAttack = (pl && pl.melee != null) ? pl.melee : 0;

  return {
    code: code,
    burstRounds: burstRounds,
    autoRounds: autoRounds,
    canAuto: canAuto,
    // 旧名。描画(phaser_vfx)・旧Action・音側が読むので burstRounds と同値で残す。
    burstSize: burstRounds,
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
    // 命中率は 0..100（PL正本の尺度）。1ヘックスごとに accDropPct 下がる。
    accPct: accPct,
    accDropPct: accDropPct,
    // 弾丸の威力＝貫通力。1ヘックスごとに penDrop 下がる。
    penBase: penBase,
    penDrop: penDrop,
    meleeAttack: meleeAttack,
    hasPlStats: !!pl,
    suppressPerBurst: w.area ? Math.max(26, suppressPerBurst) : suppressPerBurst,
    class: cls,
    indirect: !!w.indirect,
    area: !!w.area,
    blastRadius: Math.max(0, Number(w.blastRadius) || 0),
    splashScale: Math.max(0, Number(w.splashScale) || 0),
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
      if (!s.weapon.indirect && !worldView.map.hasLos({ q: s.q, r: s.r }, { q: other.q, r: other.r })) continue;
      const d = worldView.map.dist({ q: s.q, r: s.r }, { q: other.q, r: other.r });
      if (d > s.weapon.rngMax || d < (s.weapon.rngMin || 0)) continue;
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

const STATES = ['idle', 'move', 'engage', 'suppressed', 'pinned', 'reload', 'switch', 'assault', 'throw', 'rout', 'incap'];

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
  // 指揮継承（§3.4「指揮継承まで30秒のショック」）の台帳
  this._leaderGoneAt = new Map();
  this._hadLeader = new Set();
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
    rifleGrenades: spec.rifleGrenades || 0,
    skill: spec.skill != null ? spec.skill : 1.0,
    // 能力値（本編 params 由来）。移動の描き分けと息切れに効く
    attrs: spec.attrs || null,
    // 携行弾の実物性能（PL実データ由来）。無ければ SIM_TUNING.MUNITIONS の既定
    munitionSpec: spec.munitionSpec || null,
    // 副武装（拳銃）。強襲で主武器が尽きた時に持ち替える
    sidearm: spec.sidearm
      ? {
        weapon: spec.sidearm.weapon,
        magRemaining: spec.sidearm.weapon ? spec.sidearm.weapon.magCap : 0,
        magsLeft: spec.sidearm.mags != null ? spec.sidearm.mags : 1,
      }
      : null,
    isLeader: !!spec.isLeader,
    traits: spec.traits || [],

    hp: 100,
    // Persistent and per-sector attribution are kept by the sim so the
    // campaign report does not have to reconstruct kills from visual events.
    kills: Math.max(0, Number(spec.kills) || 0),
    battleKills: 0,
    state: 'idle',
    stateT: 0,
    suppression: 0,
    morale: 100,
    magRemaining: spec.weapon ? spec.weapon.magCap : 0,
    magsLeft: spec.ammo && spec.ammo.mags != null ? spec.ammo.mags : 0,
    fireMode: 'hold',
    // 直近のトリガーの撃ち方（single/burst/auto）。射撃するまでは null。
    // 意図(fireMode)とは別軸で、「この一撃で何発出たか」を表す。
    pullMode: null,
    facing: spec.facing || null,
    currentOrder: null,
    movePath: null,
    // 機動モード（walk/rush/crawl）。命令の payload.mode で指定され、兵の性格が
    // 上書きすることがある（TraitPolicy.vetMoveOrder）。速度・遮蔽の扱いが変わる。
    moveMode: 'walk',
    windedT: 0,   // 突進直後の息切れ。>0 の間は自分の命中率が落ちる
    aimT: 0,
    reloadT: 0,
    switchT: 0,
    engageTargetId: null,
    engageHex: null,   // 面制圧の目標地点（TARGET_HEX）。個体ではなく地帯を撃つ
    engageT: 0,
    // 姿勢。state とは独立したフラグなので、伏せたまま engage できる
    prone: false,
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
    weapon: s.weapon, ammo: { mags: s.magsLeft }, grenades: s.grenades,
    rifleGrenades: s.rifleGrenades, skill: s.skill, attrs: s.attrs,
    sidearm: s.sidearm ? { code: s.sidearm.weapon && s.sidearm.weapon.code } : null,
    isLeader: s.isLeader, traits: s.traits.slice(),
    hp: s.hp, state: s.state, stateT: s.stateT, prone: s.prone,
    kills: s.kills || 0, battleKills: s.battleKills || 0,
    suppression: s.suppression, morale: s.morale, underFireT: s.underFireT,
    magRemaining: s.magRemaining, magsLeft: s.magsLeft, fireMode: s.fireMode,
    pullMode: s.pullMode,
    facing: s.facing, engageTargetId: s.engageTargetId,
    engageHex: s.engageHex ? { q: s.engageHex.q, r: s.engageHex.r } : null,
    currentOrder: s.currentOrder, movePath: s.movePath ? s.movePath.slice() : null,
    aimT: s.aimT, reloadT: s.reloadT,
    moveMode: s.moveMode, windedT: s.windedT,
    // 実際にそのマスを渡っている作法（walk/rush/crawl）。命令は「移動」1つで
    // moveMode は 'auto' のまま据え置かれるので、描画も AI もこちらを見ないと
    // 全員が歩きに見える（走りのシートが一度も選ばれなかった原因）。
    stepMode: this._effectiveMoveMode(s, this.tuning),
    // 開豁地へ出る前の様子見／走行中に躓いた硬直。>0 の間は前進せず身を低くする。
    observeT: s._observeT || 0,
    // 今渡っている1マスの実所要tick（地形コスト・移動モード・脚の速さ込み）。
    // 描画のスプライト滑走速度はこれが正本。
    stepTicks: s._stepTicks || 0,
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
  this._phaseTrackMotion(); // 実移動が反映された直後に速度を測る（強襲の未来位置予測が使う）
  this._phaseBlasts(); // 信管の切れた投擲弾（_actThrow が積む）
  this._phaseSuppressionMorale();
  this._phaseCommand();
  this._phaseCheckResult();
};

// 1. collect orders.deliveries(tick)
SimCore.prototype._phaseDeliverOrders = function () {
  const deliveries = this.orders.deliveries(this._tick);
  for (const d of deliveries) {
    const s = this._soldiers.get(d.soldierId);
    if (!s || s.hp <= 0) continue;
    if (s._suppressApproachOrder && s._suppressApproachOrder !== d.order) {
      this._cancelSuppressApproach(s, 'replaced');
    }
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
    // 行動不能兵は自己判断も命令適用もしない（撃てず動けず、命令も受け付けない）
    // 行動不能兵・遂行中の兵は自己判断も命令適用もしない。'throw' は構えを
    // 中断させないためで、途中で割り込まれると信管の走った弾を持ったまま止まる。
    if (s.state === 'rout' || s.state === 'assault' || s.state === 'incap'
      || s.state === 'throw') return;
    // 強襲中の装填は「中断」ではない。ここで decide を走らせると、自衛の退避などが
    // 割り込んで突撃が装填のたびに解けてしまう。
    if (s._assaultResume) return;
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

    // 制圧に時間の寿命は無い。**指定hexに行動可能な敵が居る限り続き**、居なく
    // なった時点で _actEngageHex が解除する（2026-08-02 ディレクター定義）。
    // 弾切れも解除条件なので、無限に撃ち続けて終わらないということは起きない。

    let intent = null;
    if (s.currentOrder) {
      intent = s.currentOrder;
      // **接敵は移動命令に優先する。** 移動命令は currentOrder として残り続け、
      // policy.decide() を覆い隠すので、移動中の兵は的を探すことすらしない。
      // 結果、敵と1hexですれ違っても互いに一発も撃たなかった（2026-08-05
      // ディレクター報告「敵と対峙しても互いに素通りする」）。
      // 足を止めて撃つ。**経路は残す**ので、接敵が片付けば MOVE_TO の再適用が
      // 残りの経路から再開する（＝Attack Move ではなく「移動中に絡まれた」形）。
      // 撃てない兵（弾が尽きた／装填中）は足を止めさせない。止めても
      // _actEngage が AMMO_OUT で即 idle へ落とし、命令の再適用と往復するだけで、
      // 「撃たずにその場で固まる兵」が増える。装填は中断させない。
      const canShoot = (s.magRemaining > 0 || s.magsLeft > 0) && s.state !== 'reload';
      const atSuppressFiringHex = intent.type === 'SUPPRESS_APPROACH'
        && intent.payload && intent.payload.firingHex
        && s.q === intent.payload.firingHex.q && s.r === intent.payload.firingHex.r;
      if ((intent.type === 'MOVE_TO'
          || (intent.type === 'SUPPRESS_APPROACH' && !atSuppressFiringHex)) && canShoot) {
        const foe = this._contactFoe(s, T);
        if (foe) {
          s.engageTargetId = foe.id;
          if (s.fireMode === 'hold') s.fireMode = 'aimed';
          if (s.state !== 'engage') {
            this._setState(s, 'engage');
            s.aimT = (s.fireMode === 'suppress') ? T.AIM_T.suppress : T.AIM_T.aimed;
            this._emit('CONTACT', { id: s.id, targetId: foe.id });
          }
          return;
        }
      }
      // 自衛は命令に割り込める（NORTH_STAR §3.2「pinned: 自衛のみ」）。
      // TARGET は一度も消費されず永続するため、これが無いと「一度撃てと言われた兵士は
      // 以後永久に自己判断せず、撃たれても遮蔽へ移らない」状態になる。
      // 割り込むのは射撃系の命令だけ。MOVE_TO へは割り込まない（プレイヤーが意図した
      // 機動を二度手間にしない）。policy が selfPreserve を持たない場合は従来通り。
      if ((intent.type === 'TARGET' || intent.type === 'FIRE_MODE')
        && typeof this.policy.selfPreserve === 'function') {
        const preserve = this.policy.selfPreserve(this._snapshot(s), worldView, this.rng);
        // 退避(MOVE_TO)だけでなく「その場で伏せる(GO_PRONE)」も命令へ割り込ませる。
        // MOVE_TO しか通さないと、逃げ場の無い開豁地で射撃命令を受けた兵が
        // 棒立ちのまま撃ち合い続ける（自衛が一切効かない）ことになる。
        if (preserve && (preserve.type === 'MOVE_TO' || preserve.type === 'GO_PRONE')) {
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
    case 'TARGET_HEX':
      // 面制圧。「あの林を制圧しろ」— 見えている個体ではなく**地帯**を撃つ。
      // 命中判定は無く制圧値だけを撒く（§3.2「火力は殺す道具ではなく動きを止める
      // 道具」の最も純粋な形）。見えていない敵の潜む建物・林へ撃ち込めるのが単体
      // 制圧との違いで、代償は弾薬と「誰にも当たらないかもしれない」こと。
      s.engageHex = intent.payload.hex
        ? { q: intent.payload.hex.q, r: intent.payload.hex.r } : null;
      s.engageTargetId = null;
      s.fireMode = 'suppress';
      if (s.state === 'idle') {
        this._setState(s, 'engage');
        s.aimT = this.tuning.AIM_T.suppress;
      }
      break;
    case 'SUPPRESS_APPROACH': {
      const payload = intent.payload || {};
      const hex = payload.hex;
      const firingHex = payload.firingHex;
      if (!hex || !firingHex || !s.weapon) {
        if (s.currentOrder === intent) s.currentOrder = null;
        this._cancelSuppressApproach(s, 'invalid');
        this._emit('ORDER_REFUSED', { id: s.id, order: intent.type, reason: 'INVALID_PLAN' });
        break;
      }
      const here = { q: s.q, r: s.r };
      const dist = this.map.dist(here, hex);
      const atFiringHex = here.q === firingHex.q && here.r === firingHex.r;
      const ready = atFiringHex
        && dist <= s.weapon.rngMax && dist >= (s.weapon.rngMin || 0)
        && (s.weapon.indirect || this.map.hasLos(here, hex));
      s._suppressApproachOrder = intent;
      s._suppressObjectiveHex = { q: hex.q, r: hex.r };
      s._suppressFiringHex = { q: firingHex.q, r: firingHex.r };
      if (ready) {
        s.movePath = null;
        s._moveOrder = null;
        s.engageHex = { q: hex.q, r: hex.r };
        s.engageTargetId = null;
        s.fireMode = 'suppress';
        if (s.state !== 'engage') {
          this._setState(s, 'engage');
          s.aimT = this.tuning.AIM_T.suppress;
          this._emit('SUPPRESS_START', { id: s.id,
            hex: { q: hex.q, r: hex.r }, firingHex: { q: s.q, r: s.r } });
        }
        break;
      }
      if (atFiringHex) {
        if (s.currentOrder === intent) s.currentOrder = null;
        this._cancelSuppressApproach(s, 'interrupted');
        this._emit('ORDER_REFUSED', { id: s.id, order: intent.type,
          reason: 'FIRING_POSITION_INVALID' });
        break;
      }
      if (s._moveOrder === intent && s.movePath && s.movePath.length) {
        if (s.state !== 'move') this._setState(s, 'move');
        break;
      }
      const vetted = this._vetMove(s, intent, worldView);
      if (!vetted || !vetted.path || !vetted.path.length) {
        this._cancelSuppressApproach(s, 'interrupted');
        break;
      }
      s.engageHex = null;
      s.engageTargetId = null;
      s.fireMode = 'suppress';
      s.movePath = vetted.path;
      s.moveMode = vetted.mode;
      s._moveOrder = intent;
      this._setState(s, 'move');
      this._emit('SUPPRESS_APPROACH_START', { id: s.id,
        hex: { q: hex.q, r: hex.r }, firingHex: { q: firingHex.q, r: firingHex.r } });
      break;
    }
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
    case 'MOVE_TO': {
      // **同じ命令の経路を作り直さない。** MOVE_TO は currentOrder として残るため、
      // _phaseDecide が決定tick(0.5秒)ごとに再適用する。素直に payload の経路へ
      // 代入すると、進んだ分が毎回帳消しになって兵は2hex目へ永久に到達せず、
      // 'move' 状態で固まったまま撃ちも遮蔽へ移りもしなくなる（移動を命じた兵が
      // 静かに戦力から消える）。2026-08-02 に実測、コミット2bab6e1 にも存在した。
      // 中断（釘付け等）から復帰した時は**残りの経路**で再開する。
      if (s._moveOrder === intent && s.movePath && s.movePath.length) {
        if (s.state !== 'move') this._setState(s, 'move');
        break;
      }
      // 「どう渡るか」は命令されても現場で変わりうる。慎重な兵は走れと言われても
      // 這って寄るし、臆病な兵は制圧下だと動けない（§4.1 個性は命令への応答に出る）。
      const vetted = this._vetMove(s, intent, worldView);
      if (!vetted) break;   // 兵が拒んだ。命令は _vetMove 側で解除済み
      s.movePath = vetted.path;
      s.moveMode = vetted.mode;
      s._moveOrder = intent;
      this._setState(s, 'move');
      break;
    }
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
            s.moveMode = resolved.payload.mode || 'walk';
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
      // payload.prone を実際に適用する。policy は PINNED で prone:true を出して
      // いるのに、ここが「姿勢は制圧フェーズが持つ」と書いて読み捨てており、
      // 制圧フェーズも姿勢に触っていなかった。結果、**最も激しく撃たれている
      // pinned だけが棒立ち**という逆転が起きていた（2026-08-04 実測: 制圧55で
      // 伏せ99% / 制圧85で0%）。decide() は PINNED でここへ早期returnするので、
      // selfPreserve の GO_PRONE にも到達しない。
      if (intent.payload && intent.payload.prone && !s.prone) {
        s.prone = true;
        this._emit('PRONE', { id: s.id, prone: true });
      }
      if (s.state === 'engage') this._setState(s, 'idle');
      break;
    case 'ASSAULT': {
      const tg = this._soldiers.get(intent.payload.targetId);
      if (!tg || tg.hp <= 0) break;
      s.engageTargetId = intent.payload.targetId;
      // **任務の的。** 強襲は Attack Move なので、道中で接敵した敵へ目標が
      // 移っても、片付いたらここへ戻ってくる（_assaultObjective 参照）。
      s._assaultPrimaryId = intent.payload.targetId;
      // 同一hexの敵を全滅させるまで続けるので、目標地点を覚えておく
      s._assaultHex = { q: tg.q, r: tg.r };
      s._assaultThrowT = 0; s._assaultSwapT = 0; s._assaultMeleeT = 0;
      this._setState(s, 'assault');
      this._emit('ASSAULT_START', { id: s.id, targetId: tg.id });
      // **one-shot。** 命令を残すと決定tickごとに再適用され、装填中の兵を
      // assault へ引き戻して装填が永久に完了しない（MOVE_TO で踏んだ罠と同じ）。
      // 任務の継続は assault 状態そのものが担う（終了は _endAssault）。
      if (s.currentOrder === intent) s.currentOrder = null;
      break;
    }
    case 'GRENADE': {
      // 投擲・擲弾。**遮蔽が効かない**唯一の殺傷手段（§3.2 殺傷ベクトル2）。
      // 構え(prepT) → 手を離れる → 信管(fuseT) → 炸裂、の3段。構えている間は
      // 無防備で、信管の間に相手は逃げられる。だから「制圧してから投げる」になる。
      const kind = intent.payload.kind || 'grenade';
      const spec = this._munitionSpec(s, kind);
      const hex = intent.payload.hex;
      if (!spec || !hex || this._munitionCount(s, kind) <= 0) break;
      if (this.map.dist({ q: s.q, r: s.r }, hex) > spec.rng) break;
      if (!this.map.hasLos({ q: s.q, r: s.r }, hex)) break;
      s._throwKind = kind;
      s._throwHex = { q: hex.q, r: hex.r };
      s._throwT = spec.prepT;
      s.facing = { q: hex.q - s.q, r: hex.r - s.r };
      this._setState(s, 'throw');
      if (s.currentOrder === intent) s.currentOrder = null;
      break;
    }
    case 'GO_PRONE':
      // 逃げ場が無い時の自衛。状態は変えない（伏せたまま撃ち返せる）。
      if (!s.prone) {
        s.prone = true;
        this._emit('PRONE', { id: s.id, prone: true });
      }
      break;
    default:
      break;
  }
};

/**
 * 移動命令を現場の兵に通す。**命令に対してだけ**掛かる関門で、兵の性格が
 * 「どう渡るか」を変える（走れと言われても這う／制圧下では動けない）。
 *
 * 自発移動（policy 自身が決めた退避など）は素通りさせる — 自分の判断を自分で
 * 検閲することになり、二重にトレイト補正が乗ってしまう。呼び出し側の policy は
 * 自発 intent に `payload.selfInitiated` を立てる。
 *
 * @returns {{path: Array, mode: string}|null} null なら兵が拒否（命令は解除済み）
 * @private
 */
SimCore.prototype._vetMove = function (s, intent, worldView) {
  const payload = intent.payload || {};
  const path = payload.path ? payload.path.slice() : null;
  const requested = payload.mode || 'walk';
  const speed = s.attrs ? Number(s.attrs.speed) : NaN;
  if ((s.attrs && s.attrs.mortarDeployed) || (Number.isFinite(speed) && speed <= 0)) {
    if (s.currentOrder === intent) s.currentOrder = null;
    s.movePath = null;
    s._moveOrder = null;
    this._emit('ORDER_REFUSED', { id: s.id, order: intent.type, reason: 'NO_MOBILITY' });
    return null;
  }
  if (payload.selfInitiated || !worldView
    || !this.policy || typeof this.policy.vetMoveOrder !== 'function') {
    return { path: path, mode: requested };
  }

  let verdict = null;
  try {
    verdict = this.policy.vetMoveOrder(this._snapshot(s), worldView, this.rng,
      { path: path, mode: requested });
  } catch (e) { verdict = null; }
  if (!verdict) return { path: path, mode: requested };

  if (verdict.note && verdict.note !== s.lastPolicyNote) {
    s.lastPolicyNote = verdict.note;
    this._emit('POLICY', { id: s.id, note: verdict.note });
  }
  if (verdict.refuse) {
    // 拒否した命令を残すと毎決定tickで再評価され、その兵は以後まったく
    // 自己判断しなくなる（TARGET / TAKE_COVER で踏んだのと同じ罠）。
    if (s.currentOrder === intent) s.currentOrder = null;
    this._emit('ORDER_REFUSED', { id: s.id, order: intent.type, reason: verdict.note || '' });
    return null;
  }
  return { path: path, mode: verdict.mode || requested };
};

/**
 * 実際に適用される移動モード。制圧されている兵は何を命じられても這うしかない。
 * `auto` は1マスごとに現場が決めた `_stepMode` を使う。
 */
SimCore.prototype._effectiveMoveMode = function (s, T) {
  // 敗走は姿勢ごと決まっている。立って逃げる兵は居ない
  if (s.state === 'rout') return 'crawl';
  if (s.state === 'pinned' || s.suppression >= T.PINNED_AT) return 'crawl';
  if (s.moveMode === 'auto') return s._stepMode || 'walk';
  return s.moveMode || 'walk';
};

/**
 * 能力値の倍率。基準 ATTR_REF(5) で 1.0、高いほど range.min 側へ寄る。
 * @private
 */
SimCore.prototype._attrMult = function (s, key, range) {
  if (!range) return 1;
  const ref = this.tuning.ATTR_REF || 5;
  const raw = s.attrs ? Number(s.attrs[key]) : NaN;
  const v = Number.isFinite(raw) ? raw : ref;
  const t = Math.max(0, Math.min(2, v / Math.max(1, ref)));  // 0..2（5で1）
  // t=0 -> max（遅い/鈍い）, t=1 -> 1.0, t=2 -> min（速い/鋭い）
  return (t <= 1)
    ? range.max + (1 - range.max) * t
    : 1 + (range.min - 1) * (t - 1);
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
      case 'throw':
        this._actThrow(s, T);
        break;
      case 'suppressed':
      case 'pinned':
        // self-defense only: a suppressed shooter may still engage (pHit penalty applies)
        if (s.engageTargetId) this._actEngage(s, T);
        break;
      case 'rout':
        this._actRout(s, T);
        break;
      case 'incap':
        // 赤ゲージ。撃たない・動かない・突撃しない
        break;
      default:
        break;
    }
  });
};

/** 六方位（軸座標）。敗走の退がる向きを決めるのに使う。 */
const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/** ID から決まる安定した散らばり。乱数だと毎回ふらついて「散開」に見えない。 */
function routLane(id) {
  const str = String(id);
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return (Math.abs(h) % 3) - 1;   // -1, 0, +1
}

/**
 * 敗走。**伏せたまま、敵と反対の向きへ退がる。**
 *
 * 「30を切ったら匍匐のまま蜘蛛の子を散らすように後方へ散開」（2026-08-04
 * ディレクター定義）。旧実装は state を rout にするだけで act 側に分岐が無く、
 * 逃げもせずその場で凍りついていた（実測: 士気を100へ戻して600秒回しても
 * rout のまま1hexも動かない）。
 *
 * 散開は兵ごとの固定レーン(-1/0/+1)で退路を左右にずらして作る。乱数で毎tick
 * ふらつかせると酔っ払いになるので、ID由来の固定値にして「あいつは右へ、
 * こいつは左へ」と一貫して散らす。
 */
SimCore.prototype._actRout = function (s, T) {
  if (!s.prone) {
    s.prone = true;
    this._emit('PRONE', { id: s.id, prone: true });
  }
  if (!s.movePath || !s.movePath.length) {
    const path = this._routPath(s, T);
    if (!path) return;              // 退がる先が無い（敵が見えない/囲まれている）
    s.movePath = path;
  }
  this._actMove(s, T);
};

/**
 * 敗走の退路。最寄りの敵から離れる六方位を選び、兵ごとのレーンぶん回してから
 * 1マスずつ伸ばす。通れない/近づいてしまうマスに当たったら、そこで打ち切る。
 * @returns {Array<{q:number,r:number}>|null}
 */
SimCore.prototype._routPath = function (s, T) {
  const map = this.map;
  if (!map || typeof map.dist !== 'function' || typeof map.moveCost !== 'function') return null;

  let foe = null;
  let nearest = Infinity;
  this._soldiers.forEach((o) => {
    if (o.team === s.team || o.hp <= 0 || o.state === 'incap') return;
    const d = map.dist({ q: s.q, r: s.r }, { q: o.q, r: o.r });
    if (d < nearest) { nearest = d; foe = o; }
  });
  if (!foe) return null;

  const here = { q: s.q, r: s.r };
  const away = { q: foe.q, r: foe.r };
  // 敵から最も離れる向き
  let bestDir = 0;
  let bestD = -Infinity;
  for (let i = 0; i < HEX_DIRS.length; i++) {
    const n = { q: here.q + HEX_DIRS[i][0], r: here.r + HEX_DIRS[i][1] };
    const d = map.dist(n, away);
    if (d > bestD) { bestD = d; bestDir = i; }
  }
  const steps = (T.ROUT_FALLBACK_HEX != null) ? T.ROUT_FALLBACK_HEX : 6;
  const d0 = map.dist(here, away);
  const walk = (dir) => {
    const path = [];
    let cur = here;
    for (let i = 0; i < steps; i++) {
      const n = { q: cur.q + HEX_DIRS[dir][0], r: cur.r + HEX_DIRS[dir][1] };
      if (typeof map.inBounds === 'function' && !map.inBounds(n)) break;
      if (!isFinite(map.moveCost(cur, n))) break;
      if (map.dist(n, away) < map.dist(cur, away)) break;  // 敵へ近づく向きには退がらない
      path.push(n);
      cur = n;
    }
    return path;
  };

  // まず兵ごとのレーン（真後ろから±60°）で退がる。真横へ流れて敵との距離が
  // 縮まないレーンだったら、素直に真後ろへ退がる — 散開は目的ではなく、
  // 「隊列のまま一列で下がらない」ための手段なので、退がれない散開はしない。
  const lane = (bestDir + routLane(s.id) + HEX_DIRS.length) % HEX_DIRS.length;
  let path = walk(lane);
  if (!path.length || map.dist(path[path.length - 1], away) <= d0) {
    const straight = walk(bestDir);
    if (straight.length && (!path.length
      || map.dist(straight[straight.length - 1], away) > map.dist(path[path.length - 1], away))) {
      path = straight;
    }
  }
  return path.length ? path : null;
};

SimCore.prototype._actMove = function (s, T) {
  // Cover direct, assault and rout movement paths as well as vetted orders.
  const effectiveSpeed = s.attrs ? Number(s.attrs.speed) : NaN;
  if ((s.attrs && s.attrs.mortarDeployed) || (Number.isFinite(effectiveSpeed) && effectiveSpeed <= 0)) {
    s.movePath = null;
    s._moveOrder = null;
    if (s.currentOrder && s.currentOrder.type === 'MOVE_TO') s.currentOrder = null;
    if (s.state === 'move') this._setState(s, 'idle');
    return;
  }
  // 次の1マスをどう渡るかは、そのマスへ踏み出す直前に現場で決める。
  // 「移動」という1つの命令のまま、遮蔽伝い・様子見・開豁地のダッシュ・被弾して
  // 伏せ、が状況次第で切り替わる（§3.4 三現主義）。
  if (s.moveMode === 'auto' && s.movePath && s.movePath.length
    && this.policy && typeof this.policy.pickMoveStep === 'function') {
    if (s._stepHex == null || s._stepHex.q !== s.movePath[0].q || s._stepHex.r !== s.movePath[0].r) {
      let step = null;
      const worldView = { soldiers: this.soldiers(), map: this.map, tuning: T, tick: this._tick };
      try {
        step = this.policy.pickMoveStep(this._snapshot(s), worldView, s.movePath[0]);
      } catch (e) { step = null; }
      s._stepHex = { q: s.movePath[0].q, r: s.movePath[0].r };
      s._stepMode = (step && step.mode) || 'walk';
      // 遮蔽から開豁地へ出る前に、しゃがんで様子を窺う一拍
      s._observeT = Math.max(0, Math.round((step && step.observeT) || 0)
        * this._attrMult(s, 'recon', T.ATTR_RCN_RANGE));
      if (step && step.note && step.note !== s.lastPolicyNote) {
        s.lastPolicyNote = step.note;
        this._emit('POLICY', { id: s.id, note: step.note });
      }
    }
    if (s._observeT > 0) { s._observeT--; return; }
  }
  const mode = this._effectiveMoveMode(s, T);

  // 匍匐前進は伏せたまま。伏せていなければ、まず伏せる時間を払う（立ち上がりと同額）。
  if (mode === 'crawl') {
    if (!s.prone) {
      if (s._standupT == null || s._standupT <= 0) s._standupT = T.PRONE_STANDUP_T;
      s._standupT--;
      if (s._standupT > 0) return;
      s.prone = true;
      s._standupT = 0;
      this._emit('PRONE', { id: s.id, prone: true });
    }
  } else if (s.prone) {
    // 歩く・走るには立ち上がらないといけない。弾雨の下(pinned)では上の crawl 分岐に
    // 入るのでここへは来ない——立たせると逃げる途中で必ず撃たれる。
    if (s._standupT == null || s._standupT <= 0) s._standupT = T.PRONE_STANDUP_T;
    s._standupT--;
    if (s._standupT > 0) return;
    s.prone = false;
    s._standupT = 0;
    this._emit('PRONE', { id: s.id, prone: false });
  }
  if (!s.movePath || s.movePath.length === 0) {
    // path fulfilled: a MOVE_TO order is one-shot, so consume it here --
    // otherwise the persisting currentOrder re-applies the same path every
    // decision tick and the soldier "moves" in place forever
    if (s.currentOrder && s.currentOrder.type === 'MOVE_TO') s.currentOrder = null;
    s._moveOrder = null;
    // 強襲は自分で前進するために _actMove を呼ぶ。そこで idle へ落とすと
    // 突撃が1マスごとに解除される（状態の持ち主が違う）。
    if (s.state === 'move') this._setState(s, 'idle');
    return;
  }
  s._moveAccum = (s._moveAccum || 0) + 1;
  const next = s.movePath[0];
  const cost = this.map.moveCost(next) || 1;
  const modeTable = T.MOVE_MODE_MULT || {};
  const modeMult = (modeTable[mode] != null)
    ? modeTable[mode]
    : (s.prone ? T.PRONE_MOVE_MULT : 1);
  // 脚の速さ（params.speed）で所要時間が変わる
  const needed = T.MOVE_T_PER_HEX * cost * modeMult * this._attrMult(s, 'speed', T.ATTR_SPD_RANGE);
  // 描画はこの実所要時間からスプライトの滑走速度を逆算する。モードだけから
  // 概算すると、重い地形や脚の遅い兵で**先に着いて待つ**（歩行アニメが途中で
  // idle に落ちてカクつく）。地形コストと能力値まで込みの正本をここで publish する。
  s._stepTicks = needed;
  if (s._moveAccum >= needed) {
    const from = { q: s.q, r: s.r };
    s.q = next.q; s.r = next.r;
    s.facing = { q: next.q - from.q, r: next.r - from.r };
    s._moveAccum = 0;
    s.movePath.shift();
    this._emit('MOVE', { id: s.id, from: from, to: { q: s.q, r: s.r } });
    if (s.movePath.length === 0) {
      if (s.currentOrder && s.currentOrder.type === 'MOVE_TO') s.currentOrder = null;
      s._moveOrder = null;
      // 突進の代償は「速く渡れた代わりに、着いた直後は撃てない」。これが無いと
      // rush は walk の純粋な上位互換になり、モードを選ぶ判断が消える。
      if (mode === 'rush' && T.RUSH_WINDED_T) {
        // 体力(params.str)があるほど早く息が整う
        s.windedT = Math.round(T.RUSH_WINDED_T * this._attrMult(s, 'str', T.ATTR_STR_RANGE));
        this._emit('WINDED', { id: s.id, ticks: s.windedT });
      }
      s.moveMode = 'walk';
      s._stepHex = null; s._stepMode = null; s._observeT = 0; s._stepTicks = 0;
      if (s.state === 'move') this._setState(s, 'idle');
    }
  }
};

SimCore.prototype._actEngage = function (s, T) {
  if (!s.engageTargetId && s.engageHex) return this._actEngageHex(s, T);
  if (!s.engageTargetId) {
    // 撃つ相手も地点も無いのに engage のままだと、その兵は何もせず固まる
    if (s.state === 'engage') this._setState(s, 'idle');
    return;
  }
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

/**
 * 制圧の進行。撃つ先は個体ではなく hex。
 *
 * **見えている敵が居れば命中も取る。** 「エリアを制圧しながらユニット撃滅も
 * 着実に狙い、反撃の隙を与えない」（2026-08-02 ディレクター定義）。持続射撃
 * （suppress モード）なので手数は多く命中率は低い——時間をかけて確実に削る形。
 * 誰も見えていない時だけ純粋な面制圧（命中判定なし）へ落ちる。
 *
 * 指定hexに**行動可能な**敵が居る限り続き、居なくなれば自動で解除される。
 * @private
 */
SimCore.prototype._actEngageHex = function (s, T) {
  const hex = s.engageHex;
  const here = { q: s.q, r: s.r };
  const dist = this.map.dist(here, hex);
  if (!s.weapon || dist > s.weapon.rngMax || dist < (s.weapon.rngMin || 0)
      || (!s.weapon.indirect && !this.map.hasLos(here, hex))) {
    this._releaseHexOrder(s, 'unreachable');
    return;
  }
  // 行動可能（重傷・死亡でない）な敵が指定hexから消えたら任務完了。次の判断へ戻す。
  if (!this._hasActiveFoeAt(s, hex, 0)) {
    this._releaseHexOrder(s, 'cleared');
    return;
  }
  if (s.magRemaining <= 0) {
    if (s.magsLeft > 0) {
      this._setState(s, 'reload');
      s.reloadT = s.weapon.reloadT;
    } else {
      this._emit('AMMO_OUT', { id: s.id });
      this._releaseHexOrder(s, 'ammo_out');
      s.fireMode = 'hold';
    }
    return;
  }
  if (s.aimT > 0) { s.aimT--; return; }
  if (s._burstIntervalRemaining > 0) { s._burstIntervalRemaining--; return; }

  // 指定hexで**見えている**敵が居れば、そいつを撃つ（命中も取る）。
  // 「制圧しながら着実に撃滅する」の実体はここ。
  const victim = this._visibleFoeAt(s, hex);
  if (victim) {
    this._resolveBurst(s, victim, T);
  } else {
    // 誰も見えていない面制圧。撃ち方の判断は個体射撃と同じ表を通す — 伏せて
    // 見えない敵が2名以上潜んでいる hex なら掃射になる（それが「掃射」の意味）。
    const pull = this._selectPull(s, hex, T);
    const nominal = (pull === 'auto') ? s.weapon.autoRounds
      : (pull === 'burst') ? s.weapon.burstRounds : 1;
    const roundsFired = Math.max(1, Math.min(s.magRemaining, nominal || 1));
    s.pullMode = pull;
    s.magRemaining -= roundsFired;
    s.quietT = 0;
    s.facing = { q: hex.q - s.q, r: hex.r - s.r };
    this._emit('SHOT', {
      shooterId: s.id, targetId: null, targetHex: { q: hex.q, r: hex.r },
      roundsFired: roundsFired, hit: false, killed: false, area: true,
      pull: pull,
    });
  }

  // 着弾点の周囲へ制圧を撒く。**敵味方を問わない** — 自分の弾で味方の頭を
  // 下げさせてしまうのは制圧射撃の実際の代償で、射線と着弾点の管理を戦術にする。
  const radius = (T.SUPPRESS_AREA_RADIUS != null) ? T.SUPPRESS_AREA_RADIUS : 1;
  const mult = (T.SUPPRESS_AREA_MULT != null) ? T.SUPPRESS_AREA_MULT : 0.6;
  const spill = (T.SUPPRESS_HEX_SPILL != null) ? T.SUPPRESS_HEX_SPILL : 0.5;
  this._soldiers.forEach((o) => {
    if (o.hp <= 0 || o.id === s.id) return;
    if (victim && o.id === victim.id) return;   // 直撃対象は _resolveBurst 側で加算済み
    const d = this.map.dist({ q: o.q, r: o.r }, hex);
    if (d > radius) return;
    this._addSuppression(o, s.weapon.suppressPerBurst * mult * (d === 0 ? 1 : spill), T);
    o.underFireT = this._tick;
    o.quietT = 0;
    this._checkSuppressionThresholds(o, T);
  });

  const J = (T.BURST_JITTER != null) ? T.BURST_JITTER : 0;
  const base = Math.round(s.weapon.burstIntervalT / 2);   // 持続射撃＝手数を落とさない
  s._burstIntervalRemaining = Math.max(1, Math.round(base * (1 - J + this.rng() * 2 * J)));
};

/** 制圧任務の解除。次の最適な戦闘行動は自分で選ばせる。@private */
SimCore.prototype._releaseHexOrder = function (s, reason) {
  s.engageHex = null;
  if (s.currentOrder && (s.currentOrder.type === 'TARGET_HEX'
      || s.currentOrder.type === 'SUPPRESS_APPROACH')) s.currentOrder = null;
  if (s._suppressApproachOrder) this._cancelSuppressApproach(s, reason);
  if (s.state === 'engage') this._setState(s, 'idle');
  this._emit('SUPPRESS_END', { id: s.id, reason: reason });
};

/** Clear a queued/active approach without disturbing an unrelated new order. */
SimCore.prototype._cancelSuppressApproach = function (s, reason) {
  const old = s._suppressApproachOrder;
  if (old && s._moveOrder === old) {
    s.movePath = null;
    s._moveOrder = null;
  }
  if (old && s.currentOrder === old) s.currentOrder = null;
  s._suppressApproachOrder = null;
  s._suppressObjectiveHex = null;
  s._suppressFiringHex = null;
  if (reason === 'replaced' || reason === 'cancelled' || reason === 'interrupted') {
    s.engageHex = null;
    if (s.state === 'move' || s.state === 'engage') this._setState(s, 'idle');
  }
};

/** 指定hex（+半径）に**行動可能な**敵が居るか。重傷・死亡は数えない。@private */
SimCore.prototype._hasActiveFoeAt = function (s, hex, radius) {
  let found = false;
  this._soldiers.forEach((o) => {
    if (found || o.team === s.team || o.hp <= 0) return;
    if (o.state === 'incap' || o.state === 'down') return;
    if (this.map.dist({ q: o.q, r: o.r }, hex) <= (radius || 0)) found = true;
  });
  return found;
};

/** 指定hexに居る**行動可能な**敵の人数。掃射へ上げるかの判断に使う。@private */
SimCore.prototype._activeFoeCountAt = function (s, hex) {
  if (!hex) return 0;
  let count = 0;
  this._soldiers.forEach((o) => {
    if (o.team === s.team || o.hp <= 0) return;
    if (o.state === 'incap' || o.state === 'down') return;
    if (o.q === hex.q && o.r === hex.r) count++;
  });
  return count;
};

/**
 * このトリガーの撃ち方を決める。
 *
 * **基本はバースト。** 陸軍のマニュアルどおり短連射が既定で、単射と掃射は
 * そこからの逸脱として条件付きで選ばれる。掃射(auto)は「同一hexに固まった
 * 複数の敵へ浴びせる」時だけの例外で、弾倉を空にする勢いで撃つぶん、代償は
 * 直後の装填時間になる（MGなら8秒、その間は撃てず動けない）。
 *
 * @returns {'single'|'burst'|'auto'}
 * @private
 */
SimCore.prototype._selectPull = function (s, hex, T) {
  const tuning = T || {};
  const w = s.weapon;
  // ボルト小銃・狙撃・拳銃は構造上そもそも連射できない
  if (!w || Math.max(1, w.burstRounds || 1) <= 1) return 'single';

  // 射撃規律: 最終弾倉に入ったら1発ずつ撃つ（§3.3 弾薬経済）
  if (tuning.DISCIPLINE_LAST_MAG_SINGLE === true && s.magsLeft <= 0) return 'single';

  const minRounds = (tuning.AUTO_MIN_ROUNDS != null) ? tuning.AUTO_MIN_ROUNDS : 8;
  const minFoes = (tuning.AUTO_MIN_FOES_IN_HEX != null) ? tuning.AUTO_MIN_FOES_IN_HEX : 2;
  if (w.canAuto && w.autoRounds > 0
    && s.magRemaining >= minRounds
    && hex && this._activeFoeCountAt(s, hex) >= minFoes) {
    return 'auto';
  }

  return 'burst';
};

/** 指定hexに居て、射手から視線の通る敵。最も手強い（未制圧の）者を選ぶ。@private */
SimCore.prototype._visibleFoeAt = function (s, hex) {
  let best = null;
  this._soldiers.forEach((o) => {
    if (o.team === s.team || o.hp <= 0 || o.state === 'incap') return;
    if (o.q !== hex.q || o.r !== hex.r) return;
    if (!s.weapon.indirect && !this.map.hasLos({ q: s.q, r: s.r }, { q: o.q, r: o.r })) return;
    if (!best || o.suppression < best.suppression) best = o;
  });
  return best;
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
    // 強襲の途中の装填は「中断」ではない。idle へ落とすと _phaseDecide が
    // 走って目標を失い、突撃が装填のたびに解除されてしまう。
    if (s._assaultResume) { s._assaultResume = false; this._setState(s, 'assault'); }
    else this._setState(s, 'idle');
  }
};

/**
 * 走っている最中に被弾/被制圧したら、躓いて伏せ、匍匐へ切り替える。
 *
 * 「開豁地を走り抜けようとしたが、撃たれ続けて途中で伏せる」という一番よくある
 * 光景（2026-08-02 ディレクター指示）。走り切れると決めつけないのが要点で、
 * 突進が常に成功する世界だと開豁地の怖さが消える。
 * @private
 */
SimCore.prototype._maybeStumble = function (s, wasHit, T) {
  if (s.hp <= 0 || s.state !== 'move') return;
  if (this._effectiveMoveMode(s, T) !== 'rush') return;
  // 命中弾を受けた時か、制圧が閾値を越えた時
  if (!wasHit && s.suppression < (T.SUPPRESSED_AT != null ? T.SUPPRESSED_AT : 50)) return;
  s._stepMode = 'crawl';
  s.moveMode = 'auto';          // 以後もその場の判断で進む
  s._stepHex = null;            // 次のマスで改めて判断させる
  s._observeT = T.AUTO_MOVE_STUMBLE_T || 0;
  s._moveAccum = 0;             // 躓いた分の前進は失う
  if (!s.prone) {
    s.prone = true;
    this._emit('PRONE', { id: s.id, prone: true });
  }
  this._emit('STUMBLE', { id: s.id });
};

/**
 * 弾種の実効スペック。挙動（構え・信管・範囲）は SIM_TUNING、射程と威力は
 * その兵が実際に背負っている現物（PL実データ）が勝つ。
 * @private
 */
SimCore.prototype._munitionSpec = function (s, kind) {
  const base = (this.tuning.MUNITIONS || {})[kind];
  if (!base) return null;
  const own = s.munitionSpec && s.munitionSpec[kind];
  return own ? Object.assign({}, base, own) : base;
};

/** 携行数の参照（種別ごとの保管先を1箇所に閉じ込める）。@private */
SimCore.prototype._munitionCount = function (s, kind) {
  return (kind === 'rifle_grenade') ? (s.rifleGrenades || 0) : (s.grenades || 0);
};
SimCore.prototype._spendMunition = function (s, kind) {
  if (kind === 'rifle_grenade') s.rifleGrenades = Math.max(0, (s.rifleGrenades || 0) - 1);
  else s.grenades = Math.max(0, (s.grenades || 0) - 1);
};

/**
 * 構えている間の進行。撃てず動けず、終われば手を離れて信管が走り始める。
 * @private
 */
SimCore.prototype._actThrow = function (s, T) {
  s._throwT--;
  if (s._throwT > 0) return;
  const kind = s._throwKind || 'grenade';
  const spec = this._munitionSpec(s, kind);
  const hex = s._throwHex;
  s._throwT = 0; s._throwKind = null; s._throwHex = null;
  this._setState(s, 'idle');
  if (!spec || !hex || this._munitionCount(s, kind) <= 0) return;

  this._spendMunition(s, kind);
  this._emit('GRENADE', {
    id: s.id, kind: kind, from: { q: s.q, r: s.r }, target: { q: hex.q, r: hex.r },
    fuseT: spec.fuseT,
  });
  if (!this._blasts) this._blasts = [];
  this._blasts.push({
    at: this._tick + spec.fuseT, hex: hex, kind: kind, ownerId: s.id, spec: spec,
  });
};

/**
 * 信管の切れた弾を炸裂させる。
 *
 * **遮蔽を一切参照しない** — それがこの兵器の存在理由（§3.2 殺傷ベクトル2
 * 「面制圧・遮蔽ごと排除」）。撃ち合いでは絶対に落ちない遮蔽下の敵を殺せる
 * 唯一の手段なので、ここで遮蔽を効かせると決定打が1本も無くなる。
 * 敵味方を問わないのも同じ理由で、投げる位置が戦術になる。
 * @private
 */
SimCore.prototype._phaseBlasts = function () {
  if (!this._blasts || !this._blasts.length) return;
  const T = this.tuning;
  const edge = (T.MUNITION_EDGE_FALLOFF != null) ? T.MUNITION_EDGE_FALLOFF : 0.55;
  const due = [];
  this._blasts = this._blasts.filter((b) => {
    if (b.at <= this._tick) { due.push(b); return false; }
    return true;
  });

  due.forEach((b) => {
    const spec = b.spec || (T.MUNITIONS || {})[b.kind] || {};
    const radius = (spec.radius != null) ? spec.radius : 1;
    const casualties = [];
    this._soldiers.forEach((o) => {
      if (o.hp <= 0) return;
      const d = this.map.dist({ q: o.q, r: o.r }, b.hex);
      if (d > radius) return;
      const falloff = (d === 0) ? 1 : edge;
      const dmgSpec = spec.dmg || { base: 70, spread: 30 };
      const dmg = Math.max(1, Math.round(
        (dmgSpec.base + (this.rng() * 2 - 1) * dmgSpec.spread) * falloff));
      this._addSuppression(o, (spec.suppress || 60) * falloff, T);
      o.underFireT = this._tick;
      o.quietT = 0;
      const killed = this._applyDamage(o, dmg, this._soldiers.get(b.ownerId) || null);
      this._checkSuppressionThresholds(o, T);
      casualties.push({ id: o.id, dmg: dmg, killed: killed });
    });
    this._emit('BLAST', { hex: b.hex, kind: b.kind, ownerId: b.ownerId, casualties: casualties });
  });
};

/**
 * 強襲。**指定ユニットの撃滅がゴール**で、そのためにリスクを取る。
 *
 * ディレクター定義（2026-08-02）:
 *   「ターゲットせん滅のためならリスクを取り、持ちうるあらゆる攻撃手段
 *    （主武器・副武装の拳銃、手りゅう弾、擲弾、白兵）を使って特定ユニット撃滅を
 *    ゴールとする。ただし同一ヘックス内に複数の敵ユニットがいる場合、それらすべてを
 *    撃滅するまでは強襲行動を継続する。」
 *
 * 距離と手持ちで手段を選び直し続ける1つの状態。`_phaseDecide` は assault を
 * 飛ばすので自衛の反射も働かない — それが「リスクを取る」の実装。
 * @private
 */
SimCore.prototype._actAssault = function (s, T) {
  // 進行中の動作（投擲の構え・持ち替え・白兵の間合い）を先に消化する
  if (s._assaultThrowT > 0) { s._assaultThrowT--; if (s._assaultThrowT <= 0) this._assaultRelease(s, T); return; }
  if (s._assaultSwapT > 0) { s._assaultSwapT--; if (s._assaultSwapT <= 0) this._swapSidearm(s); return; }
  if (s._assaultMeleeT > 0) { s._assaultMeleeT--; if (s._assaultMeleeT <= 0) this._resolveMelee(s, T); return; }

  const objective = this._assaultObjective(s, T);
  if (!objective) { this._endAssault(s, 'cleared'); return; }
  const target = objective.target;
  const goal = { q: target.q, r: target.r };
  // 足は「今居る場所」ではなく「自分が着く頃に居る場所」へ向ける。
  // 撃つ・投げる・掃討すべき地点(goal)は実位置のままで、**移動だけ**が先を読む。
  const aim = this._interceptHex(s, target, T);
  s._assaultHex = { q: goal.q, r: goal.r };   // 掃討すべき地点は追随する
  const d = this.map.dist({ q: s.q, r: s.r }, goal);
  const los = this.map.hasLos({ q: s.q, r: s.r }, goal);
  s.facing = { q: goal.q - s.q, r: goal.r - s.r };

  // ① 間合い: **相手のヘックスへ入ってから**白兵。
  // 隣接で殴り合っていたのが「接敵して謎の死を遂げる」の正体だった
  // （2026-08-03 ディレクター指摘）。突入は相手の居る地点まで踏み込む。
  if (d === 0) {
    s._assaultMeleeT = T.ASSAULT_MELEE_T || 12;
    s._assaultMeleeTargetId = target.id;
    this._emit('MELEE_START', { id: s.id, targetId: target.id });
    return;
  }
  if (d === 1) {
    if (this._ownBlastHazardAt(s, goal)) return;
    // 最後の1歩は踏み込み。走って入る（止まって撃ち合う間合いではない）
    s.movePath = [{ q: goal.q, r: goal.r }];
    s.moveMode = 'rush';
    this._actMove(s, T);
    return;
  }

  // ② 遮蔽に潜っている相手は撃つより投げる（遮蔽が効かない手段を選ぶ）
  const cover = this.map.cover(goal);
  const nadeFloor = (T.ASSAULT_NADE_MIN_COVER != null) ? T.ASSAULT_NADE_MIN_COVER : 0.25;
  if (los && (cover >= nadeFloor || s.magRemaining <= 0)) {
    const kind = this._pickMunition(s, d);
    if (kind) {
      const spec = this._munitionSpec(s, kind);
      s._throwKind = kind;
      s._throwHex = goal;
      s._assaultThrowT = spec.prepT;
      return;
    }
  }

  // ③ 撃てるなら撃つ。ただし**最大射程から撃ち続けるのは強襲ではない** —
  //    確実に殺せる近距離帯（PHIT_RANGE_FALLOFF.near が効く rngMax/3）まで詰める。
  //    そこまで来れば命中率が1.5倍になり、側面に回れる目もある。
  const closeTo = Math.max(1, Math.round(s.weapon.rngMax / 3));
  if (los && d <= closeTo && s.magRemaining > 0) {
    if (s._burstIntervalRemaining > 0) { s._burstIntervalRemaining--; return; }
    s.fireMode = 'aimed';
    this._resolveBurst(s, target, T);
    const mult = (T.ASSAULT_FIRE_INTERVAL_MULT != null) ? T.ASSAULT_FIRE_INTERVAL_MULT : 0.7;
    s._burstIntervalRemaining = Math.max(1, Math.round(s.weapon.burstIntervalT * mult));
    return;
  }

  // ④ 主武器が尽きた: 装填 → それも無ければ拳銃へ持ち替える
  if (s.magRemaining <= 0) {
    if (s.magsLeft > 0) { this._setState(s, 'reload'); s.reloadT = s.weapon.reloadT; s._assaultResume = true; return; }
    if (s.sidearm && s.sidearm.magRemaining > 0) {
      s._assaultSwapT = T.ASSAULT_SWAP_T || 20;
      this._emit('SWAP', { id: s.id, to: s.sidearm.weapon.code });
      return;
    }
  }

  // ⑤ 届かない・見えないなら前進する（走って詰める）。
  //    向かうのは迎撃点。読み違えて詰まった時だけ実位置へ落とす。
  const normalStep = this._stepToward(s, aim) || this._stepToward(s, goal);
  const step = this._safeAssaultStepToward(s, aim) || this._safeAssaultStepToward(s, goal);
  // A pending friendly grenade is temporary, so waiting is not an unreachable
  // assault.  The blast queue is pruned on detonation and the next tick retries.
  if (!step && normalStep && this._ownBlastHazardAt(s, normalStep)) return;
  if (!step) { this._endAssault(s, 'unreachable'); return; }
  s.movePath = [step];
  s.moveMode = 'rush';
  this._actMove(s, T);
};

/**
 * 強襲の目標。**強襲は Attack Move である**（2026-08-05 ディレクター定義）:
 *
 *   「ターゲットを強襲している道すがら、敵の近くを通ったらそっちを攻撃して、
 *    戦闘不能まで陥れたら、最初のターゲットまでは自動で向かっていく」
 *
 * つまり任務の的(`_assaultPrimaryId`)は覚えたまま、道中で接敵した敵を先に片付ける。
 * 的だけを見て突っ走る旧実装は、脇を通り過ぎる敵に一発も撃たなかった。
 *
 * 指定ユニットが倒れても、**同じhexに残る敵が居る限り続ける**。
 * 全滅させたか、見失って周囲にも居なくなったら null（解除）。
 * @private
 */
/**
 * 接敵している敵（居なければ null）。**「脇を通り過ぎる」を構造的に禁じる規則**で、
 * 強襲の道中と、移動命令の遂行中の両方がこれを見る。
 *
 * 隣接(1)は射線が通らなくても接敵とする — 同じ生垣の中で鉢合わせているのに
 * 「見えていないから素通り」は起きてほしくない。
 * @private
 */
SimCore.prototype._contactFoe = function (s, T) {
  const alive = (o) => o && o.hp > 0 && o.state !== 'incap' && o.state !== 'down';
  const contact = (T.ASSAULT_CONTACT_RNG != null) ? T.ASSAULT_CONTACT_RNG : 2;
  const here = { q: s.q, r: s.r };
  let near = null, nearD = Infinity;
  this._soldiers.forEach((o) => {
    if (o.team === s.team || !alive(o)) return;
    const d = this.map.dist(here, { q: o.q, r: o.r });
    if (d > contact || d >= nearD) return;
    if (d > 1 && !this.map.hasLos(here, { q: o.q, r: o.r })) return;
    nearD = d; near = o;
  });
  return near;
};

SimCore.prototype._assaultObjective = function (s, T) {
  const alive = (o) => o && o.hp > 0 && o.state !== 'incap' && o.state !== 'down';
  // 任務の的。命令で指定された相手を、道中で目標が変わっても覚えておく
  if (!s._assaultPrimaryId) s._assaultPrimaryId = s.engageTargetId;
  const primary = this._soldiers.get(s._assaultPrimaryId);
  const here = { q: s.q, r: s.r };

  // 的が手の届く所に居るなら、寄り道せず任務を果たす（それが強襲の目的）
  const contact = (T.ASSAULT_CONTACT_RNG != null) ? T.ASSAULT_CONTACT_RNG : 2;
  if (alive(primary) && this.map.dist(here, { q: primary.q, r: primary.r }) <= contact) {
    s.engageTargetId = primary.id;
    return { target: primary };
  }

  // 道中の接敵。**的でなくても、脇に居る敵は無視できない。**
  const near = this._contactFoe(s, T);
  if (near) {
    if (s.engageTargetId !== near.id) {
      this._emit('ASSAULT_CONTACT', { id: s.id, targetId: near.id, primaryId: s._assaultPrimaryId });
    }
    s.engageTargetId = near.id;
    return { target: near };
  }

  // 接敵していない: 任務の的へ向かい直す（片付いたら自動で戻るのがここ）
  if (alive(primary)) { s.engageTargetId = primary.id; return { target: primary }; }

  const named = primary;
  // 指定ユニットが落ちた: その最後の位置に残る敵を掃討し続ける
  const hex = s._assaultHex || (named ? { q: named.q, r: named.r } : null);
  if (hex) {
    let next = null;
    this._soldiers.forEach((o) => {
      if (next || o.team === s.team || !alive(o)) return;
      if (o.q === hex.q && o.r === hex.r) next = o;
    });
    // 掃討で拾い直した相手が新しい任務の的になる（前の的はもう居ない）
    if (next) { s.engageTargetId = next.id; s._assaultPrimaryId = next.id; return { target: next }; }
  }

  // 見失った: 周囲に敵が居るなら最寄りへ切り替え、居なければ解除
  const radius = (T.ASSAULT_LOST_RADIUS != null) ? T.ASSAULT_LOST_RADIUS : 4;
  let best = null, bestD = Infinity;
  this._soldiers.forEach((o) => {
    if (o.team === s.team || !alive(o)) return;
    const d = this.map.dist({ q: s.q, r: s.r }, { q: o.q, r: o.r });
    if (d <= radius && d < bestD) { bestD = d; best = o; }
  });
  if (best) { s.engageTargetId = best.id; s._assaultPrimaryId = best.id; return { target: best }; }
  return null;
};

/** 距離に見合う投擲弾（残数のあるもの）。@private */
SimCore.prototype._pickMunition = function (s, dist) {
  const kinds = ['grenade', 'rifle_grenade'];
  let best = null;
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i];
    if (this._munitionCount(s, k) <= 0) continue;
    const spec = this._munitionSpec(s, k);
    if (!spec || dist > spec.rng) continue;
    // 届く中で最も射程の短い＝威力の高い手段を選ぶ（手榴弾優先）
    if (!best || spec.rng < best.rng) best = { kind: k, rng: spec.rng };
  }
  return best ? best.kind : null;
};

/** 強襲中の投擲を手放す。@private */
SimCore.prototype._assaultRelease = function (s, T) {
  const kind = s._throwKind || 'grenade';
  const hex = s._throwHex;
  s._throwKind = null; s._throwHex = null;
  if (!hex || this._munitionCount(s, kind) <= 0) return;
  const spec = this._munitionSpec(s, kind);
  this._spendMunition(s, kind);
  this._emit('GRENADE', {
    id: s.id, kind: kind, from: { q: s.q, r: s.r }, target: hex, fuseT: spec.fuseT,
  });
  if (!this._blasts) this._blasts = [];
  this._blasts.push({ at: this._tick + spec.fuseT, hex: hex, kind: kind, ownerId: s.id, spec: spec });
};

/** Return true while an assault step would enter the thrower's own pending blast. */
SimCore.prototype._ownBlastHazardAt = function (s, hex) {
  if (!hex || !this._blasts || !this._blasts.length) return false;
  for (let i = 0; i < this._blasts.length; i++) {
    const blast = this._blasts[i];
    if (!blast || !blast.hex || blast.ownerId !== s.id) continue;
    const spec = blast.spec || (this.tuning.MUNITIONS || {})[blast.kind] || {};
    const radius = (spec.radius != null) ? spec.radius : 1;
    if (this.map.dist(hex, blast.hex) <= radius) return true;
  }
  return false;
};

/** Pick a forward step outside the thrower's own pending blasts. */
SimCore.prototype._safeAssaultStepToward = function (s, goal) {
  const direct = this._stepToward(s, goal);
  if (direct && !this._ownBlastHazardAt(s, direct)) return direct;

  const here = { q: s.q, r: s.r };
  const hereD = this.map.dist(here, goal);
  const cells = this.map.neighbors(here) || [];
  let best = null, bestD = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    let cost = Infinity;
    try { cost = this.map.moveCost(here, cell); } catch (e) { cost = Infinity; }
    if (!isFinite(cost) || cost <= 0 || this._ownBlastHazardAt(s, cell)) continue;
    const d = this.map.dist(cell, goal);
    if (d <= hereD && d < bestD) { best = cell; bestD = d; }
  }
  return best;
};

/** 主武器 <-> 拳銃の持ち替え（弾ごと入れ替える）。@private */
SimCore.prototype._swapSidearm = function (s) {
  if (!s.sidearm) return;
  const held = { weapon: s.weapon, magRemaining: s.magRemaining, magsLeft: s.magsLeft };
  s.weapon = s.sidearm.weapon;
  s.magRemaining = s.sidearm.magRemaining;
  s.magsLeft = s.sidearm.magsLeft;
  s.sidearm = held;
  s._burstIntervalRemaining = 0;
};

/**
 * 手持ちのうち白兵で一番強い武器の攻撃力。
 *
 * PL正本の `melee_attack` は「その物で殴れるか」を表す（拳銃2=銃底 / 小銃5=銃床 /
 * 重機関銃0=振り回せない）。銃剣は aux として加算される想定。
 * 主武器と副武装から最良を選ぶ。何も無ければ素手。
 * @private
 */
SimCore.prototype._bestMeleeWeapon = function (s, T) {
  const bare = (T.MELEE_BARE_HANDS != null) ? T.MELEE_BARE_HANDS : 1;
  let best = bare;
  let code = 'bare';
  const consider = (w) => {
    if (w && typeof w.meleeAttack === 'number' && w.meleeAttack > best) {
      best = w.meleeAttack;
      code = w.code || code;
    }
  };
  consider(s.weapon);
  if (s.sidearm) consider(s.sidearm.weapon);
  return { power: best, code: code };
};

/** 兵の白兵力＝武器の白兵攻撃力 × 本人の白兵能力値。 @private */
SimCore.prototype._meleePower = function (s, T) {
  const w = this._bestMeleeWeapon(s, T);
  const ref = T.ATTR_REF || 5;
  const attr = (s.attrs && Number(s.attrs.melee)) || ref;
  return { power: w.power * attr, weapon: w.code, weaponPower: w.power, attr: attr };
};

/**
 * 白兵の決着（2026-08-03 全面改訂）。
 *
 * 旧実装は**隣接**で「制圧されているか否かだけのコイン投げ→即死」で、
 * 武器も能力値も見ていなかった（接敵した兵が理由の分からない即死を遂げる原因）。
 * 現在は**同一ヘックスに踏み込んだ上で**、
 *   ダメージ = 武器の白兵攻撃力 × 本人の白兵能力値 × MELEE_DMG_SCALE
 * を、**speed の速い側から**打ち合う。倒れた側は反撃できない。
 * 制圧されている側は反撃に回れない（§3.2 殺傷ベクトル3「頭を下げた相手は刺せる」）。
 * @private
 */
SimCore.prototype._resolveMelee = function (s, T) {
  const target = this._soldiers.get(s._assaultMeleeTargetId);
  s._assaultMeleeTargetId = null;
  if (!target || target.hp <= 0 || s.hp <= 0) return;

  const scale = (T.MELEE_DMG_SCALE != null) ? T.MELEE_DMG_SCALE : 1.0;
  const spread = (T.MELEE_DMG_SPREAD != null) ? T.MELEE_DMG_SPREAD : 0.2;
  const ref = T.ATTR_REF || 5;
  const speedOf = (x) => (x.attrs && Number(x.attrs.speed)) || ref;

  // 速い方が先に手を出す。同値は突入した側（勢いがある）
  const attackerFirst = speedOf(s) >= speedOf(target);
  const order = attackerFirst ? [s, target] : [target, s];

  const swing = (actor, victim) => {
    if (actor.hp <= 0 || victim.hp <= 0) return false;
    // 制圧されている側は反撃に回れない
    if (actor !== s && (actor.state === 'pinned' || actor.state === 'incap'
      || actor.suppression >= (T.PINNED_AT || 80))) return false;
    const mp = this._meleePower(actor, T);
    const dmg = Math.max(1, Math.round(
      mp.power * scale * (1 + (this.rng() * 2 - 1) * spread)));
    const down = this._applyDamage(victim, dmg, actor);
    this._emit('MELEE_HIT', {
      id: actor.id, targetId: victim.id, dmg: dmg,
      weapon: mp.weapon, weaponPower: mp.weaponPower, attr: mp.attr, down: down,
    });
    return down;
  };

  swing(order[0], order[1]);
  swing(order[1], order[0]);

  this._emit('ASSAULT', {
    id: s.id, targetId: target.id,
    won: target.hp <= 0 || target.state === 'incap',
    first: order[0].id,
  });
};

/** axial距離。**小数座標でも使える**連続量として測れるのが map.dist との違い。 */
function axialDist(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/** 小数の axial 座標を最寄りの hex へ丸める（cube round）。 */
function cubeRound(q, r) {
  let x = q;
  let z = r;
  let y = -x - z;
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);

  // 一番ずれた軸を、残る2軸から復元する（x+y+z=0 を保つ）
  if (dx > dy && dx > dz) x = -ry - rz;
  else if (dy > dz) y = -rx - rz;
  else z = -rx - ry;

  return { q: Math.round(x), r: Math.round(z) };
}

/**
 * 各兵の**実移動**から速度ベクトル（hex/tick）を起こして持たせる。
 *
 * 命令された経路ではなく、地形・様子見・立ち上がり・被弾を経た**結果の位置**を
 * 測るのが要点。「あいつは実際どちらへどれだけ走れているか」だけが、追う側に
 * とって意味のある情報だから（命令は見えないし、途中で頓挫もする）。
 * @private
 */
SimCore.prototype._phaseTrackMotion = function () {
  const T = this.tuning || {};
  const alpha = (T.ASSAULT_LEAD_EMA != null) ? T.ASSAULT_LEAD_EMA : 0.5;
  const staleT = (T.ASSAULT_LEAD_STALE_T != null) ? T.ASSAULT_LEAD_STALE_T : 30;

  this._soldiers.forEach(function (s) {
    if (s.hp <= 0) return;

    if (!s._trackHex) {
      s._trackHex = { q: s.q, r: s.r };
      s._trackTick = this._tick;
      s._vel = { q: 0, r: 0 };
      return;
    }

    if (s.q !== s._trackHex.q || s.r !== s._trackHex.r) {
      const dt = Math.max(1, this._tick - s._trackTick);
      const vq = (s.q - s._trackHex.q) / dt;
      const vr = (s.r - s._trackHex.r) / dt;
      const old = s._vel || { q: 0, r: 0 };
      s._vel = {
        q: old.q + (vq - old.q) * alpha,
        r: old.r + (vr - old.r) * alpha,
      };
      s._trackHex = { q: s.q, r: s.r };
      s._trackTick = this._tick;
      s._moveIdleT = 0;
      return;
    }

    // 足が止まってからの経過。追う側はこれで予測を薄める（下記 _interceptHex）
    s._moveIdleT = (s._moveIdleT || 0) + 1;

    if (this._tick - s._trackTick >= staleT) {
      // しばらく動いていない相手は「止まった」とみなして慣性を捨てる。
      // **同時に時刻も引き直す** — これを忘れると、長く伏せていた兵が次の一歩を
      // 踏んだ時に巨大な dt で割られて速度がほぼ 0 になり、以後永久に
      // 「止まっている奴」として扱われる。
      s._vel = { q: 0, r: 0 };
      s._trackTick = this._tick;
    }
  }, this);
};

/**
 * 迎撃点。**目標が今の速度で走り続けるとして、自分が全力で走った時に出会う地点。**
 *
 * 追う側が「相手が今居るhex」を目指すと、着いた頃には相手はそこに居ない。横切る
 * 相手に対しては永久に尻を追いかけることになり、決着がつかない（2026-08-04
 * ディレクター指摘「古い過去位置めがけて移動しちゃう」）。到着時刻と目標の変位を
 * 相互に解いて、**出会う場所**を出す。
 *
 * 予測が当てにならない場面（相手が止まっている・自分の脚が読めない・予測先が
 * 進入不可・予測先が自分の足元）では、素直に実位置を返して従来の追尾へ落ちる。
 * @private
 */
SimCore.prototype._interceptHex = function (s, target, T) {
  const here = { q: target.q, r: target.r };
  const raw = target._vel;
  if (!raw || Math.abs(raw.q) + Math.abs(raw.r) < 1e-4) return here;

  // **止まった相手を先読みし続けない。** 足が止まってからの経過で予測を薄める。
  // 「止まった」と断ずるまで待って一気に切ると、その間ずっと居もしない前方へ
  // 走り、実測で接敵が 20〜35 tick 遅れた（2026-08-04 A/B 計測）。
  const staleT = (T.ASSAULT_LEAD_STALE_T != null) ? T.ASSAULT_LEAD_STALE_T : 30;
  const fade = Math.max(0, 1 - (target._moveIdleT || 0) / Math.max(1, staleT));
  if (fade <= 0) return here;
  const v = { q: raw.q * fade, r: raw.r * fade };
  if (Math.abs(v.q) + Math.abs(v.r) < 1e-4) return here;

  const rushMult = (T.MOVE_MODE_MULT && T.MOVE_MODE_MULT.rush != null)
    ? T.MOVE_MODE_MULT.rush : 0.5;
  const ticksPerHex = T.MOVE_T_PER_HEX * rushMult * this._attrMult(s, 'speed', T.ATTR_SPD_RANGE);
  if (!isFinite(ticksPerHex) || ticksPerHex <= 0) return here;
  const speed = 1 / ticksPerHex;   // hex/tick

  const maxLead = (T.ASSAULT_LEAD_MAX_T != null) ? T.ASSAULT_LEAD_MAX_T : 300;
  if (maxLead <= 0) return here;   // 0 で予測を無効化＝従来の純追尾

  // **一番早く出会える点**を採る。等速だと「間に合う点」は一続きに存在するので、
  // 不動点反復で解くと一番遠い＝一番遅い解へ寄り、純追尾より遅れる（実測）。
  // 経路の地形コストは先読みできないので平地(1)として到着時刻を見積もる。
  const probe = Math.max(1, ticksPerHex / 2);   // 半hex刻みで走査すれば十分
  let leadT = -1;
  for (let tt = probe; tt <= maxLead; tt += probe) {
    const cand = { q: here.q + v.q * tt, r: here.r + v.r * tt };
    if (axialDist({ q: s.q, r: s.r }, cand) <= tt * speed) { leadT = tt; break; }
  }
  // 間に合う点が無い（真後ろから同速で追う等）なら先読みしない。追いつけない
  // 相手の前方へ回り込もうとしても、居ない場所へ走る分だけ遅れるだけ。
  if (leadT < 0) return here;

  const p = { q: here.q + v.q * leadT, r: here.r + v.r * leadT };
  const aim = cubeRound(p.q, p.r);
  // 足元を指した予測は使えない。_stepToward が「近づける隣接hexなし」で null を
  // 返し、強襲が 'unreachable' で解除されてしまう。
  if (aim.q === s.q && aim.r === s.r) return here;

  let cost = Infinity;
  try { cost = this.map.moveCost(here, aim); } catch (e) { cost = Infinity; }
  if (!isFinite(cost) || cost <= 0) return here;

  return aim;
};

/** 目標へ1マス寄る（進入可能な隣接hexのうち最も近づくもの）。@private */
SimCore.prototype._stepToward = function (s, goal) {
  const cells = this.map.neighbors({ q: s.q, r: s.r }) || [];
  let best = null, bestD = this.map.dist({ q: s.q, r: s.r }, goal);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    let cost = Infinity;
    try { cost = this.map.moveCost({ q: s.q, r: s.r }, c); } catch (e) { cost = Infinity; }
    if (!isFinite(cost) || cost <= 0) continue;
    const d = this.map.dist(c, goal);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
};

/** 強襲の終了。次の最適な戦闘行動は自分で選ばせる。@private */
SimCore.prototype._endAssault = function (s, reason) {
  s.engageTargetId = null;
  s._assaultHex = null;
  s._assaultPrimaryId = null;
  s._assaultThrowT = 0; s._assaultSwapT = 0; s._assaultMeleeT = 0;
  // 装填で中断していた突撃の「戻り札」も捨てる。残すと、畳んだはずの突撃が
  // 装填完了で勝手に再開する（釘付けで頓挫させた兵が立ち上がって走り出す）。
  s._assaultResume = false;
  s.movePath = null;
  s.moveMode = 'walk';
  if (s.currentOrder && s.currentOrder.type === 'ASSAULT') s.currentOrder = null;
  this._setState(s, 'idle');
  this._emit('ASSAULT_END', { id: s.id, reason: reason });
};

// 4. fire resolution (pHit calculation, SS6)
SimCore.prototype._resolveMortarBurst = function (shooter, target, T) {
  const api = m2BallisticsApi();
  if (!api || !api.resolveImpact) return false;
  const aimHex = { q: target.q, r: target.r };
  const from = { q: shooter.q, r: shooter.r };
  const range = this.map.dist(from, aimHex);
  if (range < (shooter.weapon.rngMin || 0) || range > shooter.weapon.rngMax) return true;

  const pinAt = Math.max(1, Number(T.PINNED_AT || T.SUPPRESS_PINNED || 70));
  const impact = api.resolveImpact({
    aimHex: aimHex,
    range: range,
    minRange: shooter.weapon.rngMin || 0,
    maxRange: shooter.weapon.rngMax,
    accuracy: shooter.weapon.accPct,
    suppressionRatio: Math.max(0, Number(shooter.suppression) || 0) / pinAt,
    neighbors: (hex) => this.map.neighbors(hex),
    rng: this.rng,
  });

  const roundsFired = Math.max(1, Math.min(shooter.magRemaining, 1));
  shooter.pullMode = 'single';
  shooter.magRemaining -= roundsFired;
  shooter.quietT = 0;
  target.quietT = 0;
  shooter.facing = { q: aimHex.q - shooter.q, r: aimHex.r - shooter.r };

  const casualties = [];
  const spilled = [];
  const blastRadius = Math.max(1, shooter.weapon.blastRadius || 1);
  const directScale = api.BALLISTICS ? api.BALLISTICS.directDamageScale : 0.62;
  const coverMitigation = api.BALLISTICS ? api.BALLISTICS.coverMitigation : 0.65;
  this._soldiers.forEach((o) => {
    // Preserve RTwP's established rule: area weapon spill does not hurt friendlies.
    if (o.team === shooter.team || o.hp <= 0 || o.state === 'incap') return;
    const blastDist = this.map.dist({ q: o.q, r: o.r }, impact.hex);
    if (blastDist > blastRadius) return;
    let cover = 0;
    try { cover = Math.max(0, Math.min(1, Number(this.map.cover({ q: o.q, r: o.r })) || 0)); } catch (e) { cover = 0; }
    const radialScale = directScale * (blastDist === 0 ? 1 : (shooter.weapon.splashScale || 0.45));
    const effectivePen = shooter.weapon.penBase * radialScale * Math.max(0.35, 1 - cover * coverMitigation);
    const before = o.hp;
    const killed = this._applyDamage(o, this._rollDamage(T, effectivePen), shooter);
    const dmg = Math.max(0, before - o.hp);
    this._addSuppression(o, shooter.weapon.suppressPerBurst * (blastDist === 0 ? 1 : 0.7), T);
    o.underFireT = this._tick;
    o.quietT = 0;
    this._checkSuppressionThresholds(o, T);
    casualties.push({ id: o.id, dmg: dmg, killed: killed, distance: blastDist, cover: cover });
    if (o.id !== target.id) spilled.push(o.id);
  });

  const targetCasualty = casualties.find((c) => c.id === target.id);
  this._emit('SHOT', {
    shooterId: shooter.id,
    targetId: target.id,
    aimHex: impact.aimHex,
    targetHex: impact.hex,
    impactOffset: { q: impact.offsetQ, r: impact.offsetR },
    scatter: { adjacent: impact.adjacent, chance: impact.adjacentChance },
    roundsFired: roundsFired,
    hits: targetCasualty && targetCasualty.dmg > 0 ? 1 : 0,
    hit: !!(targetCasualty && targetCasualty.dmg > 0),
    killed: !!(targetCasualty && targetCasualty.killed),
    crit: false,
    pull: 'single',
    area: true,
    casualties: casualties,
    spilled: spilled,
  });
  return true;
};

SimCore.prototype._resolveBurst = function (shooter, target, T) {
  const dist = this.map.dist({ q: shooter.q, r: shooter.r }, { q: target.q, r: target.r });
  const cover = this.map.cover({ q: target.q, r: target.r });
  const hasLos = (shooter.weapon && shooter.weapon.indirect)
    || this.map.hasLos({ q: shooter.q, r: shooter.r }, { q: target.q, r: target.r });

  // A blocked shot is not fired, so it must not spend rounds or create a
  // flash/tracer that has no matching projectile event.
  if (!hasLos || (shooter.weapon && dist < (shooter.weapon.rngMin || 0))) return;
  if (shooter.weapon && shooter.weapon.code === 'm2_mortar'
      && this._resolveMortarBurst(shooter, target, T)) return;

  // 1トリガーの弾数は撃ち方で決まる（single/burst/auto）。弾倉が尽きかけていれば
  // 最後の一撃だけ自然に短くなる。**この roundsFired が音側の正本でもある** —
  // 描画・SFX は SHOT イベントのこの値からクリップを選ぶので、鳴っている弾数と
  // 減る弾数が構造的に食い違えない。
  const pull = this._selectPull(shooter, { q: target.q, r: target.r }, T);
  const nominal = (pull === 'auto') ? shooter.weapon.autoRounds
    : (pull === 'burst') ? shooter.weapon.burstRounds : 1;
  const roundsFired = Math.max(1, Math.min(shooter.magRemaining, nominal || 1));
  shooter.pullMode = pull;
  shooter.magRemaining -= roundsFired;
  shooter.quietT = 0;
  target.quietT = 0;

  // 銃固有の命中率を上限に、状況で減らしていく（すべて ≤1 の乗算）。
  // 旧モデルはクラス定数へボーナスを掛け上げる構造で、銃ごとの命中率も
  // 距離低下率も使われていなかった（2026-08-03 ディレクター指摘）。
  const w = shooter.weapon;
  let acc = w.accPct - w.accDropPct * dist;
  // 射程超過はさらに急に落ちる（拳銃で7hex先に当て続けない）
  if (dist > w.rngMax) acc -= (T.PHIT_OVER_RANGE_DROP || 12) * (dist - w.rngMax);
  let pHit = Math.max(0, acc) / 100;

  // flank/rear (replaces cover rather than stacking) and exposure
  //
  // 匍匐前進(crawl)は例外的に**遮蔽を失わない**。塀や畑の陰を這って渡るのが
  // 匍匐の存在意義そのもので、これが無いと crawl は「2.5倍遅いだけの walk」に
  // なり、MGの射線(×4.0)を渡る手段が機動側に一つも存在しなくなる。
  const isFlank = this._isFlank(shooter, target);
  const crawling = target.state === 'move'
    && this._effectiveMoveMode(target, T) === 'crawl';
  // 露出(遮蔽なし)が基準の 1.0。側背は遮蔽と伏せの両方を無効化する
  // ——背後からは体の全面が見えるので、これが「側面から叩く」の報酬になる。
  if (isFlank) {
    /* 側背: 正面減衰も遮蔽も無い。ここが機動の報酬 */
  } else if (target.state === 'move' && !crawling) {
    // 動く的は遮蔽を捨てる。追随の難しさだけ引き、MGは苦にしない
    const mv = T.PHIT_MOVER_TRACK || {};
    pHit *= (mv[shooter.weapon.class] != null) ? mv[shooter.weapon.class] : (mv.default || 0.8);
  } else if (cover > 0) {
    pHit *= (1 - cover);
  }
  // 伏せた目標は的が小さい。立って動いている間は効かないが、匍匐中は伏せている。
  // **側背でも伏せの補正は残す** — 伏せは「隠れる」ではなく「シルエットが小さい」
  // 話なので、背後へ回っても的の大きさは変わらない。側背が無効化するのは遮蔽だけ。
  if (target.prone && (target.state !== 'move' || crawling)) pHit *= T.PHIT_VS_PRONE;

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

  // 突進直後は息が上がっていて狙えない（rush の代償）
  if (shooter.windedT > 0 && T.PHIT_WINDED != null) pHit *= T.PHIT_WINDED;

  // skill
  pHit *= shooter.skill;

  // fire mode
  pHit *= (shooter.fireMode === 'suppress') ? T.PHIT_SUPPRESS_MODE : T.PHIT_AIMED;

  pHit = Math.max(0, Math.min(1, pHit));

  // **判定は発ごと。** 旧実装は1斉射＝1判定で、MG42が10発撃ってもSMGが3発でも
  // 命中機会は1回きりだった（「数撃てば当たる」が存在しなかった）。
  // ただし全弾が一人へ吸い込まれるのは非現実的なので、ダメージを通す命中数に
  // 上限を置く。超過分は制圧にだけ効く。
  const maxDmgHits = Math.max(1, T.MAX_DMG_HITS_PER_BURST || 3);
  let hits = 0;
  for (let i = 0; i < roundsFired; i++) {
    if (this.rng() < pHit) hits++;
  }
  const hit = hits > 0;

  // 弾丸の威力は貫通力で表す（PL正本のモデル）。距離で貫通が落ちるので、
  // 遠くの敵は「当たっても効かない」が成立する。
  const penAt = Math.max(0, w.penBase - w.penDrop * dist);

  let killed = false;
  let crit = false;
  if (hit) {
    if (cover <= 0) {
      crit = this.rng() < T.CRIT_EXPOSED;
    }
    if (crit) {
      killed = this._applyDamage(target, target.hp, shooter);
    } else {
      const effective = Math.min(hits, maxDmgHits);
      for (let i = 0; i < effective && !killed; i++) {
        killed = this._applyDamage(target, this._rollDamage(T, penAt), shooter);
      }
    }
  }

  // 掃射が弾倉1本を燃やす見返り。同一hexに固まった敵へ余った弾が回る。
  // これが無いと30発撃っても27発は制圧値にしかならず（MAX_DMG_HITS_PER_BURST の
  // 頭打ち）、「同一hexの複数兵士に浴びせる」が機構として存在しない。
  // クリティカルは本来の的にだけ効く — ばら撒いた弾に頭部命中は乗らない。
  const spilled = [];
  // HE fragmentation affects every hostile sharing the impact hex. The direct
  // target keeps the normal hit roll; nearby occupants receive a reduced roll.
  if (w.area) {
    this._soldiers.forEach((o) => {
      if (o.id === target.id || o.team === shooter.team || o.hp <= 0 || o.state === 'incap') return;
      const blastDist = this.map.dist({ q: o.q, r: o.r }, { q: target.q, r: target.r });
      const blastRadius = Math.max(0, w.blastRadius || 0);
      if (blastDist > blastRadius) return;
      const dmgScale = blastDist === 0 ? 0.75 : (w.splashScale || 0.45);
      const splashHit = blastDist === 0 ? Math.max(0.28, pHit * 0.8) : Math.max(0.22, pHit * 0.55);
      if (this.rng() < splashHit) {
        this._applyDamage(o, this._rollDamage(T, penAt * dmgScale), shooter);
        spilled.push(o.id);
      }
      this._addSuppression(o, w.suppressPerBurst * (blastDist === 0 ? 1 : 0.7), T);
      o.underFireT = this._tick;
      o.quietT = 0;
      this._checkSuppressionThresholds(o, T);
    });
  }
  if (pull === 'auto' && hits > maxDmgHits) {
    const maxTargets = (T.AUTO_SPILL_MAX_TARGETS != null) ? T.AUTO_SPILL_MAX_TARGETS : 3;
    const room = Math.max(0, maxTargets - 1);   // 本来の的を含めた総数の上限
    const victims = [];
    this._soldiers.forEach((o) => {
      if (victims.length >= room) return;
      if (o.id === target.id || o.team === shooter.team || o.hp <= 0) return;
      if (o.state === 'incap' || o.state === 'down') return;
      if (o.q !== target.q || o.r !== target.r) return;
      if (!this.map.hasLos({ q: shooter.q, r: shooter.r }, { q: o.q, r: o.r })) return;
      victims.push(o);
    });
    let spare = hits - maxDmgHits;
    for (let i = 0; i < victims.length && spare > 0; i++) {
      const o = victims[i];
      const share = Math.min(spare, maxDmgHits);
      spare -= share;
      spilled.push(o.id);
      for (let j = 0; j < share; j++) {
        if (this._applyDamage(o, this._rollDamage(T, penAt), shooter)) break;
      }
      this._addSuppression(o, shooter.weapon.suppressPerBurst, T);
      o.underFireT = this._tick;
      o.quietT = 0;
      this._checkSuppressionThresholds(o, T);
    }
  }

  this._emit('SHOT', {
    shooterId: shooter.id,
    targetId: target.id,
    roundsFired: roundsFired,
    hits: hits,        // 命中弾数（連射の手応え・検証用）
    hit: hit,
    killed: killed,
    crit: crit,
    pull: pull,        // 'single'|'burst'|'auto'。音側はこれではなく roundsFired を見る
    spilled: spilled   // 掃射で巻き込んだ同一hexの敵
  });

  // 制圧は浴びた弾量に比例する。単射1発は怖くないし、掃射は撃ち込まれた分だけ怖い。
  // 基準はバースト(=1.0)。上限は SUPPRESS_MAX_PER_SEC と二重に効くので、
  // 掃射を連発しても制圧ゲージが一瞬で飽和することはない。
  const burstBase = Math.max(1, shooter.weapon.burstRounds || 1);
  const suppressCap = (T.AUTO_SUPPRESS_MULT_CAP != null) ? T.AUTO_SUPPRESS_MULT_CAP : 2.5;
  const suppressMult = Math.min(roundsFired / burstBase, suppressCap);
  this._addSuppression(target, shooter.weapon.suppressPerBurst * suppressMult, T);
  // 「今撃たれている」時刻。自衛の反射は制圧値ではなくこの時刻で判定する
  // （弾が来たから動く、が自然）。
  target.underFireT = this._tick;
  this._checkSuppressionThresholds(target, T);
  this._maybeStumble(target, hit, T);

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

/**
 * 1発ぶんのダメージ。**弾丸の威力は貫通力で表す**（PL正本のモデル）。
 * 命中したら必ず効く。どれだけ効くかがその距離での貫通力。
 * `penAt` が無い呼び出し（旧経路・白兵など）は従来の DMG_HIT へ落ちる。
 * @private
 */
SimCore.prototype._rollDamage = function (T, penAt) {
  if (penAt != null) {
    const scale = (T.DMG_PER_PEN != null) ? T.DMG_PER_PEN : 1.0;
    const spread = (T.DMG_PEN_SPREAD != null) ? T.DMG_PEN_SPREAD : 0.18;
    const base = penAt * scale;
    return Math.max(1, Math.round(base * (1 + (this.rng() * 2 - 1) * spread)));
  }
  const base = T.DMG_HIT.base;
  const spread = T.DMG_HIT.spread;
  return Math.max(1, Math.round(base + (this.rng() * 2 - 1) * spread));
};

/**
 * Apply damage. Returns true if it kills the target.
 * @private
 */
SimCore.prototype._applyDamage = function (target, dmg, source) {
  const T = this.tuning;
  if (target.hp <= 0) return false;
  target.hp = Math.max(0, target.hp - dmg);
  this._emit('HIT', { id: target.id, hp: target.hp });
  if (target.hp <= 0) {
    if (source && source.id != null && source.id !== target.id) {
      source.kills = (source.kills || 0) + 1;
      source.battleKills = (source.battleKills || 0) + 1;
    }
    this._emit('DOWN', { id: target.id });
    target.state = 'down';
    target.stateT = 0;
    this._applyMoraleOnDeath(target);
    return true;
  }
  // 赤ゲージまで削られたら戦闘継続できない。撃てず動けず、命令も受け付けない。
  // 死亡と違って盤上に残るので、プレイヤーは救うか見捨てるかを選ぶことになる。
  if (target.hp <= T.INCAP_AT_HP && target.state !== 'incap') {
    this._setState(target, 'incap');
    this._emit('INCAP', { id: target.id, hp: target.hp });
    // 倒れる。立ったまま行動不能というのは有り得ないし、描画も姿勢フラグを見る。
    if (!target.prone) {
      target.prone = true;
      this._emit('PRONE', { id: target.id, prone: true });
    }
    target.engageTargetId = null;
    target.movePath = null;
    target.currentOrder = null;
    target.fireMode = 'hold';
  }
  return false;
};

/**
 * 戦死による士気への影響。
 *
 * 「3hex内の味方戦死 -15」は廃止した（2026-08-04 ディレクター判断）。1人倒れる
 * たびに周囲全員が削れるため、序盤の1名損耗から分隊全体が坂を転げ落ちていた。
 * 残すのは指揮官を失った時だけ。
 */
SimCore.prototype._applyMoraleOnDeath = function (deadSoldier) {
  const T = this.tuning;
  if (!deadSoldier.isLeader) return;
  this._soldiers.forEach((s) => {
    if (s.hp <= 0 || s.team !== deadSoldier.team || s.id === deadSoldier.id) return;
    s.morale = Math.max(0, s.morale + T.MORALE_LEADER_DOWN);
  });
};

SimCore.prototype._checkSuppressionThresholds = function (s, T) {
  // 敗走・行動不能は制圧で上書きしない。どちらも「もう戦列に居ない」状態で、
  // ここで pinned を被せると敗走が解けたように見え、行動不能が起き上がる。
  if (s.state === 'rout' || s.state === 'incap' || s.state === 'down') return;

  // **突撃は制圧では止まらない**（2026-08-04 ディレクター定義）。
  //
  // ここが assault を suppressed で上書きしていたため、突撃兵は平野の中腹で
  // 無言のまま突撃を失っていた（ASSAULT_END も出ず、engageTargetId と
  // _assaultHex が残骸として残る）。制圧が抜けた後は policy が引き取って
  // 遮蔽へ帰るので、盤面には「突っ込んだのに何もせず戻ってきた」だけが見える。
  // _phaseDecide が「強襲は自衛の反射も働かない＝リスクを取る」と宣言している
  // のに、その宣言を裏から無効化していたのがこの1行だった。
  //
  // 頭を下げさせられるのは**釘付け(PINNED_AT)まで**。そこまで浴びたら突撃は
  // 頓挫するが、黙って消えるのではなく _endAssault で正式に畳んでから伏せる。
  // 弾が当たれば当然倒れる — それは制圧ではなく _applyDamage の領分。
  if (s.state === 'assault' || s._assaultResume) {
    if (s.suppression >= T.PINNED_AT) {
      this._endAssault(s, 'pinned');
      this._setState(s, 'pinned');
      this._emit('PINNED', { id: s.id });
    }
    return;
  }

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
    if (s.windedT > 0) s.windedT--;   // 突進後の息切れが抜けていく

    if (s.suppression > 0 && s.quietT >= quietThresholdT) {
      const before = s.suppression;
      s.suppression = Math.max(0, s.suppression - decayPerTick);
      // **立ち直りで書き換えてよいのは、制圧が伏せさせた状態だけ。**
      //
      // 無条件に _setState していたため、制圧値が閾値を割った兵は今どんな状態でも
      // idle へ引き戻されていた。最悪なのが行動不能で、赤ゲージで倒れた兵が
      // 制圧の抜けた瞬間に**起き上がる**（2026-08-04 実測: incap の分隊長が
      // t=46 で idle に戻り、以後ずっと「生きている指揮官」と見なされた）。
      // 表示は遺体に指揮官の印を描き直し、_phaseCommand は後任を立てるのをやめる
      // — ディレクター報告「指揮官が死んでも指揮官円が遺体の上に残る」の正体。
      // 敗走・突撃・移動も同じ経路で無言のうちに解除されていた（敗走の立ち直りは
      // 士気(ROUT_RALLY_ABOVE)が決めるのであって、制圧の減衰ではない）。
      const liftable = (s.state === 'suppressed' || s.state === 'pinned');
      if (before >= T.PINNED_AT && s.suppression < T.PINNED_AT) {
        if (liftable) {
          this._emit('RECOVERED', { id: s.id });
          this._setState(s, (s.suppression >= T.SUPPRESSED_AT) ? 'suppressed' : 'idle');
        }
      } else if (before >= T.SUPPRESSED_AT && s.suppression < T.SUPPRESSED_AT) {
        if (liftable) {
          this._emit('RECOVERED', { id: s.id });
          this._setState(s, 'idle');
        }
      }
    }

    // 釘付けの間だけ削れ、解けている間は戻る（2026-08-04 ディレクター定義）。
    // 回復があるので「一度崩れたら終わり」ではなくなり、退がって落ち着いた兵が
    // 戦列へ戻れる。敗走中は pinned にならない（下の _checkSuppressionThresholds
    // ガード）ので、退がっている間に立ち直っていく。
    if (s.state === 'pinned') {
      // **加算**する。MORALE_PINNED_DRAIN は -1（他の士気定数と同じく「加える差分」）
      // なので、減算すると符号が反転して**釘付けの兵の士気が上がっていた**
      // （2026-08-04 実測: 120秒釘付けで 100 -> 220）。敗走が実戦でまず起きなかった
      // のはこれが原因。
      s.morale = Math.max(0, s.morale + (T.MORALE_PINNED_DRAIN / ticksPerSec));
    } else if (s.state !== 'incap') {
      const rec = (T.MORALE_RECOVER != null) ? T.MORALE_RECOVER : 0;
      if (rec > 0) s.morale = Math.min(100, s.morale + (rec / ticksPerSec));
    }

    if (s.state === 'down' || s.state === 'incap') return;

    // 敗走は確率判定をやめ、**30を切った時点で確定**（2026-08-04）。
    // 立ち直りは上に離した閾値で見る — 同じ値だと境目で敗走と復帰が交互に出る。
    if (s.state === 'rout') {
      if (s.morale >= (T.ROUT_RALLY_ABOVE != null ? T.ROUT_RALLY_ABOVE : 45)) {
        s._routGoal = null;
        this._setState(s, 'idle');
        this._emit('RALLY', { id: s.id, morale: Math.round(s.morale) });
      }
    } else if (s.morale < T.ROUT_CHECK_BELOW) {
      s._routGoal = null;
      this._setState(s, 'rout');
      // 弾雨の中を立って逃げる兵は居ない。伏せたまま退がる
      if (!s.prone) {
        s.prone = true;
        this._emit('PRONE', { id: s.id, prone: true });
      }
      s.engageTargetId = null;
      s.movePath = null;
      s.currentOrder = null;
      s.fireMode = 'hold';
      this._emit('ROUT', { id: s.id });
    }
  });
};

/**
 * 指揮継承。**分隊長が死んでも誰も後を継がなかった**（§3.4 は「指揮継承まで30秒の
 * ショック」と定めているのに、継承そのものが実装されていなかった）。結果、一度
 * 分隊長を失った分隊は最後まで指揮官不在のまま戦い、伝達遅延は永久に×3のままで、
 * 分隊長AIも沈黙し続けていた。
 *
 * ショック期間(COMMS_SHOCK_T)を過ぎたら、生き残りのうち最も士気の高い者が継ぐ。
 * @private
 */
SimCore.prototype._phaseCommand = function () {
  const T = this.tuning;
  const shockT = (T.COMMS_SHOCK_T != null) ? T.COMMS_SHOCK_T : 300;
  const teams = new Map();
  this._soldiers.forEach((s) => {
    if (s.isLeader) this._hadLeader.add(s.team);
    if (s.hp <= 0) return;
    if (!teams.has(s.team)) teams.set(s.team, { leader: null, candidates: [], fallen: null });
    const t = teams.get(s.team);
    // 赤ゲージ(incap)の分隊長は指揮を執れない。ここで leader として数え続けると
    // 昇格タイマーが**永久に始まらず**、倒した後もその兵が指揮官のまま残る
    // （2026-08-04 ディレクター報告「指揮官の円がしばらく残る」の正体）。
    // incap は回復経路の無い終端状態なので、抜けたものとして扱ってよい。
    if (s.isLeader) { if (s.state === 'incap') t.fallen = s; else t.leader = s; }
    else if (s.state !== 'rout' && s.state !== 'incap') t.candidates.push(s);
  });

  teams.forEach((t, team) => {
    if (t.leader) { this._leaderGoneAt.delete(team); return; }
    // 元から分隊長を置いていない編成（テスト等）に勝手な昇格はしない
    if (!this._hadLeader.has(team) || !t.candidates.length) return;
    if (!this._leaderGoneAt.has(team)) { this._leaderGoneAt.set(team, this._tick); return; }
    if (this._tick - this._leaderGoneAt.get(team) < shockT) return;

    let next = t.candidates[0];
    for (let i = 1; i < t.candidates.length; i++) {
      if (t.candidates[i].morale > next.morale) next = t.candidates[i];
    }
    next.isLeader = true;
    // 昇格したら前任の印を落とす。2人が isLeader のままだと、表示も命令伝達も割れる
    if (t.fallen) t.fallen.isLeader = false;
    this._leaderGoneAt.delete(team);
    this._emit('LEADER_CHANGED', { id: next.id, team: team });
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
      // 行動不能だけが残ったチームは戦闘力を失っている（生存者数には数える）。
      //
      // 敗走は**戦闘力ありとして数える**（2026-08-04）。士気に回復を入れた以上、
      // 敗走は一時的な状態で、退がって落ち着けば戦列へ戻る。旧版のように敗走を
      // 無力と数えると、分隊全員が一瞬30を割った時点でセクターが即決着してしまう
      // （実測: 全員敗走した瞬間に RESULT が出てシムが停止した）。決着は戦死と
      // 行動不能だけで決まる。
      if (s.state !== 'incap') t.active++;
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
    // 生存者ゼロなら全滅、そうでなければ「立っている者が居ない」＝戦闘継続不能。
    // 敗走は数えなくなったので、この分岐に来るのは行動不能だけが残った場合。
    const reason = teams.get(defeated[0]).alive === 0 ? 'annihilation' : 'incapacitated';
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
  setPlWeaponStats: setPlWeaponStats,
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
  window.setPlWeaponStats = setPlWeaponStats;
  window.InstantOrders = InstantOrders;
  window.DefaultPolicy = DefaultPolicy;
}
