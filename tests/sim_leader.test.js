/**
 * tests/sim_leader.test.js -- WS-F acceptance tests (docs/SIM_CORE_SPEC.md SS16.4 F1-F6)
 * No framework. Run with `node tests/sim_leader.test.js`. Exits 0 on all-PASS, 1 on any FAIL.
 * Same grid-stub MapApi style as tests/sim_core.test.js / tests/sim_policy.test.js.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const { SimCore, mulberry32, toSimWeapon, DefaultPolicy } =
  require(path.join(__dirname, '..', 'sim_core.js'));
const { CommsOrders } = require(path.join(__dirname, '..', 'sim_orders.js'));
const { LeaderPolicy } = require(path.join(__dirname, '..', 'sim_leader.js'));

// data.js targets the browser (globals via `window`), so load it through vm with a
// minimal window stub and pull out WPNS / SIM_TUNING (mirrors tests/sim_core.test.js).
function loadDataJs() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const exposeTail = '\n;this.WPNS = WPNS; this.SIM_TUNING = SIM_TUNING;\n';
  const sandbox = { module: { exports: {} }, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + exposeTail, sandbox, { filename: 'data.js' });
  return sandbox;
}
const dataSandbox = loadDataJs();
const WPNS = dataSandbox.WPNS;
const SIM_TUNING = dataSandbox.SIM_TUNING;

let passCount = 0;
let failCount = 0;
const failures = [];

function check(cond, label) {
  if (cond) {
    passCount++;
    console.log('PASS: ' + label);
  } else {
    failCount++;
    failures.push(label);
    console.log('FAIL: ' + label);
  }
}

// ---------------------------------------------------------------------------
// Grid stub MapApi (axial hex coords) -- same shape as sim_core.test.js.
// GRID bounds are enforced via moveCost() >= 99 for out-of-range hexes, which
// is the clamp mechanism LeaderPolicy's FALL_BACK path-builder relies on
// (LeaderPolicy has no notion of map bounds beyond the SS3 MapApi).
// ---------------------------------------------------------------------------

function makeGridMap(opts) {
  opts = opts || {};
  const coverAt = opts.coverAt || (() => 0.6);
  const losBlocked = opts.losBlocked || (() => false);
  const bounds = opts.bounds || null; // { qMin, qMax, rMin, rMax }
  return {
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    },
    hasLos: (a, b) => !losBlocked(a, b),
    cover: (hex) => coverAt(hex),
    moveCost: (hex) => {
      if (bounds && (hex.q < bounds.qMin || hex.q > bounds.qMax || hex.r < bounds.rMin || hex.r > bounds.rMax)) {
        return 99;
      }
      return 1;
    },
    neighbors: (hex) => [
      { q: hex.q + 1, r: hex.r }, { q: hex.q - 1, r: hex.r },
      { q: hex.q, r: hex.r + 1 }, { q: hex.q, r: hex.r - 1 },
      { q: hex.q + 1, r: hex.r - 1 }, { q: hex.q - 1, r: hex.r + 1 },
    ],
  };
}

function freshLeaderState() {
  return { lastDoctrine: null, lastOrderTick: -Infinity, playerLockUntil: 0, quietT: 0 };
}

// ===========================================================================
// F1: squad without a leader (no isLeader soldier alive) issues zero doctrines.
// ===========================================================================

{
  const map = makeGridMap({ coverAt: () => 0.6 });
  const rifle = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
  // leaderView explicitly not isLeader -- assess() must refuse to act on its behalf.
  const leaderView = {
    id: 'A0', team: 'A', q: 0, r: 0, hp: 100, isLeader: false, suppression: 0, morale: 100,
    magRemaining: 5, magsLeft: 5, weapon: rifle,
  };
  const worldView = {
    tick: 500, map: map, tuning: SIM_TUNING,
    soldiers: [
      leaderView,
      { id: 'A1', team: 'A', q: 0, r: 1, hp: 100, suppression: 90, morale: 20, weapon: rifle, magRemaining: 0, magsLeft: 0 },
      { id: 'A2', team: 'A', q: 0, r: 2, hp: 100, suppression: 90, morale: 20, weapon: rifle, magRemaining: 0, magsLeft: 0 },
      { id: 'B0', team: 'B', q: 3, r: 0, hp: 0, suppression: 0, morale: 100, state: 'idle' },
    ],
  };
  const orders = LeaderPolicy.assess(leaderView, worldView, mulberry32(1), freshLeaderState());
  check(Array.isArray(orders) && orders.length === 0,
    `F1: leaderless squad issues zero doctrines (got ${orders.length})`);
}

{
  // sanity: dead leaderView (hp<=0) is guarded the same way.
  const map = makeGridMap({ coverAt: () => 0.6 });
  const leaderView = { id: 'A0', team: 'A', q: 0, r: 0, hp: 0, isLeader: true };
  const worldView = { tick: 500, map: map, tuning: SIM_TUNING, soldiers: [leaderView] };
  const orders = LeaderPolicy.assess(leaderView, worldView, mulberry32(1), freshLeaderState());
  check(orders.length === 0, 'F1 sanity: dead leaderView issues zero doctrines');
}

// ===========================================================================
// F2: 2 squadmates suppressed -> SUPPRESS_FIRE delivered within 30s (300 ticks),
// observed via ORDER_DELIVERED. Full SimCore + CommsOrders + LeaderPolicy loop.
// ===========================================================================

function runF2(seed) {
  const map = makeGridMap({ coverAt: () => 0.6 });
  const rng = mulberry32(seed);
  const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: rng, policy: DefaultPolicy });
  const orders = new CommsOrders({
    getSoldier: (id) => sim.getSoldier(id), soldiers: () => sim.soldiers(), map: map, tuning: SIM_TUNING,
  });
  sim.orders = orders;
  const rifle = toSimWeapon('m1', WPNS.m1, SIM_TUNING);

  sim.addSoldier({ id: 'A0', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, isLeader: true, facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'A1', team: 'A', q: 0, r: 1, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'A2', team: 'A', q: 0, r: 2, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'B0', team: 'B', q: 3, r: 0, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, facing: { q: -1, r: 0 } });

  const leaderState = freshLeaderState();
  const interval = SIM_TUNING.LEADER_ASSESS_INTERVAL_T;

  let orderDeliveredTick = null;
  const totalTicks = 300; // 30s
  for (let t = 0; t < totalTicks; t++) {
    sim.tick();
    // force both A1/A2 into a suppressed state directly (isolating the leader
    // doctrine trigger from needing a full firefight to build suppression up).
    if (t === 5) {
      const s1 = sim._soldiers.get('A1'); s1.suppression = 90;
      const s2 = sim._soldiers.get('A2'); s2.suppression = 90;
    }
    if (sim._tick % interval === 0) {
      const leaderView = sim.getSoldier('A0');
      const worldView = { tick: sim._tick, soldiers: sim.soldiers(), map: map, tuning: SIM_TUNING };
      const leaderOrders = LeaderPolicy.assess(leaderView, worldView, sim.rng, leaderState);
      for (const o of leaderOrders) sim.issueOrder(o);
    }
    const evs = sim.drainEvents();
    for (const ev of evs) {
      if (ev.type === 'ORDER_DELIVERED' && ev.order && ev.order.note === '制圧しろ！頭を上げさせるな！' && orderDeliveredTick === null) {
        orderDeliveredTick = ev.tick;
      }
    }
    if (orderDeliveredTick !== null) break;
  }
  return orderDeliveredTick;
}

{
  const tick = runF2(42);
  check(tick !== null && tick <= 300, `F2: SUPPRESS_FIRE ORDER_DELIVERED within 30s of 2 squadmates suppressed (tick=${tick})`);
}

// ===========================================================================
// F3: 2 dead + low morale -> FALL_BACK, all living soldiers move away from
// their nearest enemy.
// ===========================================================================

{
  const map = makeGridMap({ coverAt: () => 0.6, bounds: { qMin: 0, qMax: 20, rMin: 0, rMax: 20 } });
  const rifle = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
  const leaderView = {
    id: 'A0', team: 'A', q: 5, r: 5, hp: 100, isLeader: true, suppression: 0, morale: 30,
    magRemaining: 5, magsLeft: 5, weapon: rifle,
  };
  const teammate = {
    id: 'A1', team: 'A', q: 5, r: 6, hp: 100, isLeader: false, suppression: 0, morale: 30,
    magRemaining: 5, magsLeft: 5, weapon: rifle,
  };
  const worldView = {
    tick: 500, map: map, tuning: SIM_TUNING,
    soldiers: [
      leaderView, teammate,
      { id: 'A2', team: 'A', q: 5, r: 7, hp: 0, morale: 0, suppression: 0 },
      { id: 'A3', team: 'A', q: 5, r: 8, hp: 0, morale: 0, suppression: 0 },
      { id: 'B0', team: 'B', q: 8, r: 5, hp: 100, suppression: 0, morale: 100, state: 'idle', weapon: rifle },
    ],
  };
  const orders = LeaderPolicy.assess(leaderView, worldView, mulberry32(1), freshLeaderState());
  check(orders.length === 2, `F3: FALL_BACK issues MOVE_TO for both living squadmates (got ${orders.length})`);
  check(orders.every((o) => o.type === 'MOVE_TO'), 'F3: all FALL_BACK orders are MOVE_TO');
  check(orders.every((o) => o.note === '下がれ！下がれ！'), 'F3: FALL_BACK orders carry the retreat note');

  // enemy B0 is at q=8 (east of the squad); retreating should move west (lower q).
  for (const o of orders) {
    const soldier = worldView.soldiers.find((s) => s.id === o.soldierIds[0]);
    const path = o.payload.path;
    check(path.length > 0 && path[path.length - 1].q < soldier.q,
      `F3: ${soldier.id} retreat path moves away from enemy (from q=${soldier.q}, path=${JSON.stringify(path)})`);
  }
}

// ===========================================================================
// F4: right after a player order, the leader AI issues nothing while locked,
// and resumes once the lock has expired.
// ===========================================================================

{
  const map = makeGridMap({ coverAt: () => 0.6 });
  const rifle = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
  const leaderView = {
    id: 'A0', team: 'A', q: 0, r: 0, hp: 100, isLeader: true, suppression: 0, morale: 100,
    magRemaining: 5, magsLeft: 5, weapon: rifle,
  };
  const worldView = {
    tick: 100, map: map, tuning: SIM_TUNING,
    soldiers: [
      leaderView,
      { id: 'A1', team: 'A', q: 0, r: 1, hp: 100, suppression: 90, morale: 20, weapon: rifle, magRemaining: 5, magsLeft: 5 },
      { id: 'A2', team: 'A', q: 0, r: 2, hp: 100, suppression: 90, morale: 20, weapon: rifle, magRemaining: 5, magsLeft: 5 },
      { id: 'B0', team: 'B', q: 3, r: 0, hp: 100, suppression: 0, morale: 100, state: 'idle', weapon: rifle },
    ],
  };
  const lockUntil = 100 + SIM_TUNING.PLAYER_ORDER_LOCK_T;
  const state = freshLeaderState();
  state.playerLockUntil = lockUntil;

  const duringLock = LeaderPolicy.assess(leaderView, Object.assign({}, worldView, { tick: lockUntil - 1 }), mulberry32(1), state);
  check(duringLock.length === 0, `F4: leader AI silent while player lock is active (got ${duringLock.length})`);

  const afterLock = LeaderPolicy.assess(leaderView, Object.assign({}, worldView, { tick: lockUntil + 1 }), mulberry32(1), state);
  check(afterLock.length > 0, `F4: leader AI resumes issuing orders once the lock expires (got ${afterLock.length})`);
}

// ===========================================================================
// F5: determinism -- same seed, same event stream (including POLICY/ORDER_DELIVERED
// notes) across two independent runs of the F2-style integration loop.
// ===========================================================================

function runF5(seed) {
  const map = makeGridMap({ coverAt: () => 0.6 });
  const rng = mulberry32(seed);
  const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: rng, policy: DefaultPolicy });
  const orders = new CommsOrders({
    getSoldier: (id) => sim.getSoldier(id), soldiers: () => sim.soldiers(), map: map, tuning: SIM_TUNING,
  });
  sim.orders = orders;
  const rifle = toSimWeapon('m1', WPNS.m1, SIM_TUNING);

  sim.addSoldier({ id: 'A0', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, isLeader: true, facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'A1', team: 'A', q: 0, r: 1, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'A2', team: 'A', q: 0, r: 2, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'B0', team: 'B', q: 3, r: 0, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, facing: { q: -1, r: 0 } });
  sim.addSoldier({ id: 'B1', team: 'B', q: 3, r: 1, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, facing: { q: -1, r: 0 } });

  const leaderState = freshLeaderState();
  const interval = SIM_TUNING.LEADER_ASSESS_INTERVAL_T;
  const allEvents = [];
  for (let t = 0; t < 1500; t++) {
    sim.tick();
    if (sim._tick % interval === 0) {
      const leaderView = sim.getSoldier('A0');
      if (leaderView && leaderView.hp > 0) {
        const worldView = { tick: sim._tick, soldiers: sim.soldiers(), map: map, tuning: SIM_TUNING };
        const leaderOrders = LeaderPolicy.assess(leaderView, worldView, sim.rng, leaderState);
        for (const o of leaderOrders) sim.issueOrder(o);
      }
    }
    const evs = sim.drainEvents();
    for (const ev of evs) allEvents.push(ev);
    if (sim.result()) break;
  }
  return allEvents;
}

{
  const seed = 321;
  const run1 = JSON.stringify(runF5(seed));
  const run2 = JSON.stringify(runF5(seed));
  check(run1 === run2, `F5: identical event stream JSON for same seed (len1=${run1.length} len2=${run2.length})`);
  check(run1.length > 0, 'F5: scenario actually produced events');
}

// ===========================================================================
// F6: cooldown -- consecutive assess() calls never issue two doctrines closer
// together than DOCTRINE_COOLDOWN_T ticks.
// ===========================================================================

{
  const map = makeGridMap({ coverAt: () => 0.6 });
  const rifle = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
  const state = freshLeaderState();
  const interval = SIM_TUNING.LEADER_ASSESS_INTERVAL_T;
  const cooldownT = SIM_TUNING.DOCTRINE_COOLDOWN_T;

  const orderTicks = [];
  // 3 squadmates whose suppressed-count alternates 2/3 tick to tick, so the
  // SUPPRESS_FIRE "score" (suppressedCount) keeps changing and the same-doctrine
  // suppression rule never accounts for the silence on its own -- any gap seen
  // here must come from DOCTRINE_COOLDOWN_T (isolating the cooldown timer).
  for (let tick = interval; tick <= 1000; tick += interval) {
    const leaderView = {
      id: 'A0', team: 'A', q: 0, r: 0, hp: 100, isLeader: true, suppression: 0, morale: 100,
      magRemaining: 5, magsLeft: 5, weapon: rifle,
    };
    const thirdSuppressed = (tick % (interval * 2)) === 0;
    const worldView = {
      tick: tick, map: map, tuning: SIM_TUNING,
      soldiers: [
        leaderView,
        { id: 'A1', team: 'A', q: 0, r: 1, hp: 100, suppression: 90, morale: 100, weapon: rifle, magRemaining: 5, magsLeft: 5 },
        { id: 'A2', team: 'A', q: 0, r: 2, hp: 100, suppression: 90, morale: 100, weapon: rifle, magRemaining: 5, magsLeft: 5 },
        { id: 'A3', team: 'A', q: 0, r: 3, hp: 100, suppression: thirdSuppressed ? 90 : 0, morale: 100, weapon: rifle, magRemaining: 5, magsLeft: 5 },
        { id: 'B0', team: 'B', q: 3, r: 0, hp: 100, suppression: 0, morale: 100, state: 'idle', weapon: rifle },
      ],
    };
    const orders = LeaderPolicy.assess(leaderView, worldView, mulberry32(tick), state);
    if (orders.length > 0) orderTicks.push(tick);
  }

  check(orderTicks.length > 1, `F6: cooldown test produced multiple orders to compare (count=${orderTicks.length})`);
  let minGap = Infinity;
  for (let i = 1; i < orderTicks.length; i++) {
    minGap = Math.min(minGap, orderTicks[i] - orderTicks[i - 1]);
  }
  check(minGap >= cooldownT, `F6: no two doctrine orders fire closer than DOCTRINE_COOLDOWN_T=${cooldownT} apart (minGap=${minGap}, ticks=${JSON.stringify(orderTicks)})`);
}

// ---------------------------------------------------------------------------

console.log(`\n${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
} else {
  process.exit(0);
}
