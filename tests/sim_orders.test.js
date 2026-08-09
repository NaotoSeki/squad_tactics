/**
 * tests/sim_orders.test.js -- WS-B acceptance tests (docs/SIM_CORE_SPEC.md SS12)
 * No framework. Run with `node tests/sim_orders.test.js`. Exits 0 on all-PASS, 1 on any FAIL.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const { CommsOrders } = require(path.join(__dirname, '..', 'sim_orders.js'));

// data.js targets the browser; load via vm and pull SIM_TUNING out.
function loadDataJs() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const exposeTail = '\n;this.SIM_TUNING = SIM_TUNING;\n';
  const sandbox = { module: { exports: {} }, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + exposeTail, sandbox, { filename: 'data.js' });
  return sandbox;
}
const SIM_TUNING = loadDataJs().SIM_TUNING;

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
// Grid stub MapApi (axial hex coords) -- mirrors tests/sim_core.test.js
// ---------------------------------------------------------------------------

function makeGridMap(opts) {
  opts = opts || {};
  const losBlocked = opts.losBlocked || (() => false);
  return {
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    },
    hasLos: (a, b) => !losBlocked(a, b),
    cover: () => 0,
    moveCost: () => 1,
    neighbors: (hex) => [
      { q: hex.q + 1, r: hex.r }, { q: hex.q - 1, r: hex.r },
      { q: hex.q, r: hex.r + 1 }, { q: hex.q, r: hex.r - 1 },
      { q: hex.q + 1, r: hex.r - 1 }, { q: hex.q - 1, r: hex.r + 1 },
    ],
  };
}

/**
 * Minimal soldier registry harness: a Map of id -> mutable soldier state,
 * exposing the getSoldier/soldiers functions CommsOrders expects.
 */
function makeRoster(list) {
  const m = new Map();
  for (const s of list) m.set(s.id, Object.assign({ hp: 100, isLeader: false, hasRadio: false }, s));
  return {
    map: m,
    getSoldier: (id) => m.get(id) || null,
    soldiers: () => Array.from(m.values()),
  };
}

// ===========================================================================
// Test 1: near (voice) -- leader within COMMS_VOICE_RNG + LOS -> COMMS_VOICE_DELAY_T
// ===========================================================================
(function testVoiceRange() {
  const map = makeGridMap();
  const roster = makeRoster([
    { id: 'leader', team: 'A', q: 0, r: 0, isLeader: true },
    { id: 'near', team: 'A', q: 2, r: 0 }, // dist 2 == COMMS_VOICE_RNG
  ]);
  const orders = new CommsOrders({ getSoldier: roster.getSoldier, soldiers: roster.soldiers, map, tuning: SIM_TUNING });

  check(orders.estimateDelay('near', 100) === SIM_TUNING.COMMS_VOICE_DELAY_T,
    'estimateDelay: UI reads the same live voice cost used by delivery');

  orders.queue({ type: 'HOLD_POS', soldierIds: ['near'], payload: {} }, 100);

  const before = orders.deliveries(100 + SIM_TUNING.COMMS_VOICE_DELAY_T - 1);
  check(before.length === 0, 'voice: no delivery before COMMS_VOICE_DELAY_T elapses');

  const at = orders.deliveries(100 + SIM_TUNING.COMMS_VOICE_DELAY_T);
  check(at.length === 1 && at[0].soldierId === 'near', 'voice: delivered exactly at tick+COMMS_VOICE_DELAY_T');
})();

// ===========================================================================
// Test 2: LOS-blocked within voice range falls back to runner (distance-proportional)
// ===========================================================================
(function testVoiceBlockedByLos() {
  const map = makeGridMap({ losBlocked: () => true });
  const roster = makeRoster([
    { id: 'leader', team: 'A', q: 0, r: 0, isLeader: true },
    { id: 'near', team: 'A', q: 1, r: 0 },
  ]);
  const orders = new CommsOrders({ getSoldier: roster.getSoldier, soldiers: roster.soldiers, map, tuning: SIM_TUNING });

  orders.queue({ type: 'HOLD_POS', soldierIds: ['near'], payload: {} }, 50);
  const expected = 50 + 1 * SIM_TUNING.COMMS_RUNNER_T_PER_HEX;
  const at = orders.deliveries(expected);
  check(at.length === 1, 'voice blocked by LOS: falls back to runner delay (dist x COMMS_RUNNER_T_PER_HEX)');
})();

// ===========================================================================
// Test 3: far (runner) -- distance-proportional delay
// ===========================================================================
(function testRunnerDistanceProportional() {
  const map = makeGridMap();
  const roster = makeRoster([
    { id: 'leader', team: 'A', q: 0, r: 0, isLeader: true },
    { id: 'far', team: 'A', q: 7, r: 0 },
  ]);
  const orders = new CommsOrders({ getSoldier: roster.getSoldier, soldiers: roster.soldiers, map, tuning: SIM_TUNING });

  orders.queue({ type: 'HOLD_POS', soldierIds: ['far'], payload: {} }, 0 + 1); // tick=1, not the free planning tick
  const dist = 7;
  const expected = 1 + dist * SIM_TUNING.COMMS_RUNNER_T_PER_HEX;

  const before = orders.deliveries(expected - 1);
  check(before.length === 0, 'runner: no delivery before dist x COMMS_RUNNER_T_PER_HEX elapses');
  const at = orders.deliveries(expected);
  check(at.length === 1, 'runner: delivered exactly at issue_tick + dist x COMMS_RUNNER_T_PER_HEX');
})();

// ===========================================================================
// Test 4: tick 0 (planning phase) -- always free, regardless of distance
// ===========================================================================
(function testPlanningPhaseFree() {
  const map = makeGridMap();
  const roster = makeRoster([
    { id: 'leader', team: 'A', q: 0, r: 0, isLeader: true },
    { id: 'far', team: 'A', q: 20, r: 0 },
  ]);
  const orders = new CommsOrders({ getSoldier: roster.getSoldier, soldiers: roster.soldiers, map, tuning: SIM_TUNING });

  orders.queue({ type: 'HOLD_POS', soldierIds: ['far'], payload: {} }, 0);
  const at = orders.deliveries(0);
  check(at.length === 1 && at[0].soldierId === 'far', 'planning phase (tick 0): delivered immediately regardless of distance');
})();

// ===========================================================================
// Test 5: radio -- fixed COMMS_RADIO_DELAY_T, beneficial only beyond voice range
// ===========================================================================
(function testRadioBeneficialWhenFar() {
  const map = makeGridMap();
  const roster = makeRoster([
    { id: 'leader', team: 'A', q: 0, r: 0, isLeader: true },
    { id: 'radioFar', team: 'A', q: 20, r: 0, hasRadio: true }, // runner delay would be huge
  ]);
  const orders = new CommsOrders({ getSoldier: roster.getSoldier, soldiers: roster.soldiers, map, tuning: SIM_TUNING });

  orders.queue({ type: 'HOLD_POS', soldierIds: ['radioFar'], payload: {} }, 10);
  const expected = 10 + SIM_TUNING.COMMS_RADIO_DELAY_T;
  const before = orders.deliveries(expected - 1);
  check(before.length === 0, 'radio (far): no delivery before COMMS_RADIO_DELAY_T elapses');
  const at = orders.deliveries(expected);
  check(at.length === 1, 'radio (far): delivered at issue_tick + COMMS_RADIO_DELAY_T (beats runner distance delay)');
})();

(function testRadioNotBeneficialWhenNear() {
  const map = makeGridMap();
  const roster = makeRoster([
    { id: 'leader', team: 'A', q: 0, r: 0, isLeader: true },
    { id: 'radioNear', team: 'A', q: 1, r: 0, hasRadio: true }, // within voice range, LOS clear
  ]);
  const orders = new CommsOrders({ getSoldier: roster.getSoldier, soldiers: roster.soldiers, map, tuning: SIM_TUNING });

  orders.queue({ type: 'HOLD_POS', soldierIds: ['radioNear'], payload: {} }, 10);
  const expectedVoice = 10 + SIM_TUNING.COMMS_VOICE_DELAY_T;
  const at = orders.deliveries(expectedVoice);
  check(at.length === 1, 'radio (near): voice delay used instead of radio (radio only helps beyond voice range)');
})();

// ===========================================================================
// Test 6: leader death -> all delays x COMMS_LEADER_DOWN_MULT, plus shock window
// halts delivery until COMMS_SHOCK_T after the death tick.
// ===========================================================================
(function testLeaderDownMultAndShock() {
  const map = makeGridMap();
  const roster = makeRoster([
    { id: 'leader', team: 'A', q: 0, r: 0, isLeader: true },
    { id: 'near', team: 'A', q: 1, r: 0 },
  ]);
  const orders = new CommsOrders({ getSoldier: roster.getSoldier, soldiers: roster.soldiers, map, tuning: SIM_TUNING });
  // Establish the leader's last-known position before they die.
  orders._findLeader('A');
  roster.map.get('leader').hp = 0; // leader dies

  const issueTick = 5;
  orders.queue({ type: 'HOLD_POS', soldierIds: ['near'], payload: {} }, issueTick);

  // shock window: death observed at issueTick (first observation), so delivery is
  // held back until issueTick + COMMS_SHOCK_T regardless of the x3 base delay
  // (base delay x3 would be smaller than the shock window here).
  const shockEnd = issueTick + SIM_TUNING.COMMS_SHOCK_T;

  const duringShock = orders.deliveries(shockEnd - 1);
  check(duringShock.length === 0, 'leader down: no delivery during COMMS_SHOCK_T window');

  const afterShock = orders.deliveries(shockEnd);
  check(afterShock.length === 1, 'leader down: delivery released once COMMS_SHOCK_T has elapsed');
})();

(function testLeaderDownMultWithoutShockOverride() {
  // Leader already dead well before the order is queued (long past the shock
  // window), so the x3 multiplier applies to the runner-distance delay without
  // the shock window pushing it further out.
  const map = makeGridMap();
  const roster = makeRoster([
    { id: 'leader', team: 'A', q: 0, r: 0, isLeader: true },
    { id: 'far', team: 'A', q: 10, r: 0 },
  ]);
  const orders = new CommsOrders({ getSoldier: roster.getSoldier, soldiers: roster.soldiers, map, tuning: SIM_TUNING });
  // Establish the leader's last-known position before they die.
  orders._findLeader('A');
  roster.map.get('leader').hp = 0; // leader dies

  // First, queue+drain a dummy order far in the past so CommsOrders records the
  // leader-death tick early (simulating that the leader died long ago).
  orders.queue({ type: 'HOLD_POS', soldierIds: ['far'], payload: {} }, 1);
  orders.deliveries(1 + SIM_TUNING.COMMS_SHOCK_T); // drain past shock window fully

  // Now issue a fresh order well after the shock window has elapsed relative to
  // the recorded death tick (tick=1).
  const issueTick = 2 + SIM_TUNING.COMMS_SHOCK_T;
  orders.queue({ type: 'HOLD_POS', soldierIds: ['far'], payload: {} }, issueTick);

  const dist = 10;
  const baseDelay = dist * SIM_TUNING.COMMS_RUNNER_T_PER_HEX;
  const expected = issueTick + baseDelay * SIM_TUNING.COMMS_LEADER_DOWN_MULT;

  const before = orders.deliveries(expected - 1);
  check(before.length === 0, 'leader down (post-shock): x3 multiplier delays delivery beyond base runner delay');
  const at = orders.deliveries(expected);
  check(at.length === 1, 'leader down (post-shock): delivered at issue_tick + base_delay x COMMS_LEADER_DOWN_MULT');
})();

// ===========================================================================
// Test 7: determinism -- two independent CommsOrders instances given the same
// sequence of queue/deliveries calls produce identical delivery event streams.
// ===========================================================================
(function testDeterminism() {
  function runScenario() {
    const map = makeGridMap();
    const roster = makeRoster([
      { id: 'leader', team: 'A', q: 0, r: 0, isLeader: true },
      { id: 'a', team: 'A', q: 1, r: 0 },
      { id: 'b', team: 'A', q: 5, r: 0 },
      { id: 'c', team: 'A', q: 5, r: 0, hasRadio: true },
    ]);
    const orders = new CommsOrders({ getSoldier: roster.getSoldier, soldiers: roster.soldiers, map, tuning: SIM_TUNING });
    const log = [];
    orders.queue({ type: 'MOVE_TO', soldierIds: ['a', 'b', 'c'], payload: { q: 3, r: 0 } }, 10);
    for (let t = 10; t <= 200; t++) {
      const d = orders.deliveries(t);
      for (const item of d) log.push({ t, soldierId: item.soldierId, type: item.order.type });
    }
    return JSON.stringify(log);
  }
  const a = runScenario();
  const b = runScenario();
  check(a === b, 'determinism: identical queue/deliveries sequences produce identical delivery logs');
})();

// ===========================================================================
// Regression: sim_core.test.js must still be green (run as a subprocess).
// ===========================================================================
(function runSimCoreRegression() {
  const { execFileSync } = require('child_process');
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'sim_core.test.js')], { stdio: 'pipe' });
    check(true, 'regression: tests/sim_core.test.js exits 0 (no regression from sim_orders.js changes)');
  } catch (e) {
    check(false, 'regression: tests/sim_core.test.js exits 0 (no regression from sim_orders.js changes)');
    console.log(String((e.stdout || '') + (e.stderr || '')));
  }
})();

// ---------------------------------------------------------------------------
console.log('');
console.log(passCount + ' passed, ' + failCount + ' failed');
if (failCount > 0) {
  console.log('Failures: ' + failures.join(', '));
  process.exit(1);
}
process.exit(0);
