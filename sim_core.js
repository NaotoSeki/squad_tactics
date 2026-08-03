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

  // PL正本の武器統計（銃固有の命中率・命中低下・貫通力・貫通低下）。
  // 統計を持たない武器はクラス別の代表値へ落ちる。
  const pl = plStatsFor(code);
  const pick = (table, fallback) => {
    if (!table) return fallback;
    return (table[cls] != null) ? table[cls] : (table.rifle != null ? table.rifle : fallback);
  };
  const accPct = (pl && pl.acc != null) ? pl.acc : pick(T.PHIT_FALLBACK, 70);
  const accDropPct = (pl && pl.accDrop != null) ? pl.accDrop : pick(T.PHIT_FALLBACK_DROP, 6);
  const penBase = (pl && pl.pen != null) ? pl.pen : pick(T.PEN_FALLBACK, 72);
  const penDrop = (pl && pl.penDrop != null) ? pl.penDrop : pick(T.PEN_FALLBACK_DROP, 3);
  // 白兵専用の攻撃力。**弾丸の威力ではない**（PL正本のモデル）。
  // 「その物で殴れるか」を表す: 拳銃2(銃底)/小銃5(銃床)/重機関銃0(振り回せない)。
  // 銃剣は aux として加算される（M1903A1 の5 + 銃剣4 = 9）。
  // 現状の白兵解決(_resolveMelee)はまだこの値を見ていない。
  const meleeAttack = (pl && pl.melee != null) ? pl.melee : 0;

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
    // 命中率は 0..100（PL正本の尺度）。1ヘックスごとに accDropPct 下がる。
    accPct: accPct,
    accDropPct: accDropPct,
    // 弾丸の威力＝貫通力。1ヘックスごとに penDrop 下がる。
    penBase: penBase,
    penDrop: penDrop,
    meleeAttack: meleeAttack,
    hasPlStats: !!pl,
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
    suppression: s.suppression, morale: s.morale, underFireT: s.underFireT,
    magRemaining: s.magRemaining, magsLeft: s.magsLeft, fireMode: s.fireMode,
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
      // intent.payload.prone: suppressed/pinned handling stays with the
      // suppression phase; HOLD_POS here just cancels active engagement intent.
      if (s.state === 'engage') this._setState(s, 'idle');
      break;
    case 'ASSAULT': {
      const tg = this._soldiers.get(intent.payload.targetId);
      if (!tg || tg.hp <= 0) break;
      s.engageTargetId = intent.payload.targetId;
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
  const v = (s.attrs && Number(s.attrs[key])) || ref;
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
      case 'incap':
        // 赤ゲージ。撃たない・動かない・突撃しない
        break;
      default:
        break;
    }
  });
};

SimCore.prototype._actMove = function (s, T) {
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
  if (!s.weapon || dist > s.weapon.rngMax || !this.map.hasLos(here, hex)) {
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
    const roundsFired = Math.max(1, Math.min(s.magRemaining, (s.weapon.burstSize) || 1));
    s.magRemaining -= roundsFired;
    s.quietT = 0;
    s.facing = { q: hex.q - s.q, r: hex.r - s.r };
    this._emit('SHOT', {
      shooterId: s.id, targetId: null, targetHex: { q: hex.q, r: hex.r },
      roundsFired: roundsFired, hit: false, killed: false, area: true,
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
  if (s.currentOrder && s.currentOrder.type === 'TARGET_HEX') s.currentOrder = null;
  if (s.state === 'engage') this._setState(s, 'idle');
  this._emit('SUPPRESS_END', { id: s.id, reason: reason });
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

/** 指定hexに居て、射手から視線の通る敵。最も手強い（未制圧の）者を選ぶ。@private */
SimCore.prototype._visibleFoeAt = function (s, hex) {
  let best = null;
  this._soldiers.forEach((o) => {
    if (o.team === s.team || o.hp <= 0 || o.state === 'incap') return;
    if (o.q !== hex.q || o.r !== hex.r) return;
    if (!this.map.hasLos({ q: s.q, r: s.r }, { q: o.q, r: o.r })) return;
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

  // ⑤ 届かない・見えないなら前進する（走って詰める）
  const step = this._stepToward(s, goal);
  if (!step) { this._endAssault(s, 'unreachable'); return; }
  s.movePath = [step];
  s.moveMode = 'rush';
  this._actMove(s, T);
};

/**
 * 強襲の目標。指定ユニットが倒れても、**同じhexに残る敵が居る限り続ける**。
 * 全滅させたか、見失って周囲にも居なくなったら null（解除）。
 * @private
 */
SimCore.prototype._assaultObjective = function (s, T) {
  const named = this._soldiers.get(s.engageTargetId);
  const alive = (o) => o && o.hp > 0 && o.state !== 'incap' && o.state !== 'down';
  if (alive(named)) return { target: named };

  // 指定ユニットが落ちた: その最後の位置に残る敵を掃討し続ける
  const hex = s._assaultHex || (named ? { q: named.q, r: named.r } : null);
  if (hex) {
    let next = null;
    this._soldiers.forEach((o) => {
      if (next || o.team === s.team || !alive(o)) return;
      if (o.q === hex.q && o.r === hex.r) next = o;
    });
    if (next) { s.engageTargetId = next.id; return { target: next }; }
  }

  // 見失った: 周囲に敵が居るなら最寄りへ切り替え、居なければ解除
  const radius = (T.ASSAULT_LOST_RADIUS != null) ? T.ASSAULT_LOST_RADIUS : 4;
  let best = null, bestD = Infinity;
  this._soldiers.forEach((o) => {
    if (o.team === s.team || !alive(o)) return;
    const d = this.map.dist({ q: s.q, r: s.r }, { q: o.q, r: o.r });
    if (d <= radius && d < bestD) { bestD = d; best = o; }
  });
  if (best) { s.engageTargetId = best.id; return { target: best }; }
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
  s._assaultThrowT = 0; s._assaultSwapT = 0; s._assaultMeleeT = 0;
  s.movePath = null;
  s.moveMode = 'walk';
  if (s.currentOrder && s.currentOrder.type === 'ASSAULT') s.currentOrder = null;
  this._setState(s, 'idle');
  this._emit('ASSAULT_END', { id: s.id, reason: reason });
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
  // 側背からは伏せていても隠れる先が無い。
  if (!isFlank && target.prone && (target.state !== 'move' || crawling)) pHit *= T.PHIT_VS_PRONE;

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

  this._emit('SHOT', {
    shooterId: shooter.id,
    targetId: target.id,
    roundsFired: roundsFired,
    hits: hits,        // 命中弾数（連射の手応え・検証用）
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
    if (s.windedT > 0) s.windedT--;   // 突進後の息切れが抜けていく

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
    if (!teams.has(s.team)) teams.set(s.team, { leader: null, candidates: [] });
    const t = teams.get(s.team);
    if (s.isLeader) t.leader = s;
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
      // 行動不能だけが残ったチームは戦闘力を失っている（生存者数には数える）
      if (s.state !== 'rout' && s.state !== 'incap') t.active++;
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
