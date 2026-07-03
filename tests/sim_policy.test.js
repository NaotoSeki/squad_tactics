/**
 * tests/sim_policy.test.js -- WS-C acceptance tests (docs/SIM_CORE_SPEC.md SS13)
 * No framework. Run with `node tests/sim_policy.test.js`. Exits 0 on all-PASS, 1 on any FAIL.
 * Same grid-stub MapApi style as tests/sim_core.test.js (sim_core/sim_policy do not
 * require logic_map.js directly).
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const { SimCore, mulberry32, toSimWeapon, DefaultPolicy } =
  require(path.join(__dirname, '..', 'sim_core.js'));
const { TraitPolicy } = require(path.join(__dirname, '..', 'sim_policy.js'));

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
// Grid stub MapApi (axial hex coords) -- same shape as sim_core.test.js
// ---------------------------------------------------------------------------

function makeGridMap(opts) {
  opts = opts || {};
  const coverAt = opts.coverAt || (() => 0.6);
  const losBlocked = opts.losBlocked || (() => false);
  return {
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    },
    hasLos: (a, b) => !losBlocked(a, b),
    cover: (hex) => coverAt(hex),
    moveCost: () => 1,
    neighbors: (hex) => [
      { q: hex.q + 1, r: hex.r }, { q: hex.q - 1, r: hex.r },
      { q: hex.q, r: hex.r + 1 }, { q: hex.q, r: hex.r - 1 },
      { q: hex.q + 1, r: hex.r - 1 }, { q: hex.q - 1, r: hex.r + 1 },
    ],
  };
}

function firstShotTick(policy, traits, seed, opts) {
  opts = opts || {};
  const map = makeGridMap({ coverAt: () => 0.6 });
  const rng = mulberry32(seed);
  const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: rng, policy: policy });
  const rifleWeapon = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
  const dist = opts.dist != null ? opts.dist : 6;

  sim.addSoldier({
    id: 'shooter', team: 'A', q: 0, r: 0, weapon: rifleWeapon,
    ammo: { mags: 10 }, skill: 1.0, traits: traits, facing: { q: 1, r: 0 },
  });
  sim.addSoldier({
    id: 'target', team: 'B', q: dist, r: 0, weapon: rifleWeapon,
    ammo: { mags: 10 }, skill: 1.0, traits: [], facing: { q: -1, r: 0 },
  });
  // no orders issued -- both act purely on policy.decide()

  const totalTicks = 1200;
  let shotTick = null;
  for (let t = 0; t < totalTicks; t++) {
    sim.tick();
    const evs = sim.drainEvents();
    for (const ev of evs) {
      if (ev.type === 'SHOT' && ev.shooterId === 'shooter' && shotTick === null) {
        shotTick = ev.tick;
      }
    }
    if (shotTick !== null) break;
  }
  return shotTick;
}

// ===========================================================================
// T-aggressive: aggressive shooter opens fire no later than a DefaultPolicy
// shooter in the same scenario (extended engagement range + default suppress
// mode should not delay first contact).
// ===========================================================================

{
  const seed = 7;
  const rifleRng = toSimWeapon('m1', WPNS.m1, SIM_TUNING).rngMax;
  // place the target just beyond DefaultPolicy's engagement range but within
  // aggressive's rngMax+2 bonus, so only the aggressive trait can engage at all.
  const dist = rifleRng + 1;

  const aggressiveTick = firstShotTick(TraitPolicy, ['aggressive'], seed, { dist: dist });
  const defaultTick = firstShotTick(DefaultPolicy, [], seed, { dist: dist });

  check(aggressiveTick !== null, `aggressive: opens fire beyond default range (rng=${rifleRng} dist=${dist}) (tick=${aggressiveTick})`);
  check(defaultTick === null, `aggressive baseline sanity: DefaultPolicy does NOT engage beyond its range at dist=${dist}`);
}

{
  // Within normal range, aggressive should engage at least as fast as default
  // (both see the target immediately; this locks in "no slower" behaviour).
  const seed = 11;
  const dist = 4;
  const aggressiveTick = firstShotTick(TraitPolicy, ['aggressive'], seed, { dist: dist });
  const defaultTick = firstShotTick(DefaultPolicy, [], seed, { dist: dist });
  check(aggressiveTick !== null && defaultTick !== null && aggressiveTick <= defaultTick,
    `aggressive: first SHOT tick <= DefaultPolicy at normal range (aggressive=${aggressiveTick} default=${defaultTick})`);
}

// ===========================================================================
// T-cautious: does not self-initiate a MOVE_TO into cover < 0.3.
// TraitPolicy never self-issues MOVE_TO in this slice (movement is
// order-driven only), so we exercise the guard directly by handing decide()
// a soldierView carrying a pending movePath into open ground and asserting
// it refuses (HOLD_POS) instead of proceeding.
// ===========================================================================

{
  const map = makeGridMap({ coverAt: (hex) => (hex.q === 1 ? 0.1 : 0.6) });
  const soldierView = {
    id: 'c1', team: 'A', q: 0, r: 0, hp: 100, suppression: 0, morale: 100,
    magRemaining: 5, magsLeft: 5, weapon: toSimWeapon('m1', WPNS.m1, SIM_TUNING),
    traits: ['cautious'], movePath: [{ q: 1, r: 0 }],
  };
  const worldView = { soldiers: [soldierView], map: map, tuning: SIM_TUNING };
  const intent = TraitPolicy.decide(soldierView, worldView, mulberry32(1));
  check(intent.type === 'HOLD_POS', `cautious: refuses self-move into cover<0.3 (got type=${intent.type})`);
}

{
  // sanity: with adequate cover ahead, cautious does not block via this guard
  // (falls through to the no-target HOLD_POS path anyway, but not tagged with the note).
  const map = makeGridMap({ coverAt: () => 0.6 });
  const soldierView = {
    id: 'c2', team: 'A', q: 0, r: 0, hp: 100, suppression: 0, morale: 100,
    magRemaining: 5, magsLeft: 5, weapon: toSimWeapon('m1', WPNS.m1, SIM_TUNING),
    traits: ['cautious'], movePath: [{ q: 1, r: 0 }],
  };
  const worldView = { soldiers: [soldierView], map: map, tuning: SIM_TUNING };
  const intent = TraitPolicy.decide(soldierView, worldView, mulberry32(1));
  check(intent.note !== '慎重: 遮蔽の薄い地形への自発移動を拒否',
    'cautious: does not raise the low-cover guard when cover is adequate');
}

// ===========================================================================
// T-calm: withholds first SHOT until distance <= rngMax * 2/3.
// Use the sniper (k98_scope, long rngMax) so the "far but in range" band is
// wide enough to distinguish calm from default behaviour.
// ===========================================================================

{
  const seed = 5;
  const sniperWeapon = toSimWeapon('k98_scope', WPNS.k98_scope, SIM_TUNING);
  const rngMax = sniperWeapon.rngMax;
  const farDist = Math.max(1, Math.floor(rngMax * 0.9)); // in range, but beyond 2/3 threshold

  function firstShotWithWeapon(policy, traits, weapon, dist, seedN) {
    const map = makeGridMap({ coverAt: () => 0.6 });
    const rng = mulberry32(seedN);
    const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: rng, policy: policy });
    sim.addSoldier({ id: 'shooter', team: 'A', q: 0, r: 0, weapon: weapon, ammo: { mags: 10 }, skill: 1.0, traits: traits, facing: { q: 1, r: 0 } });
    sim.addSoldier({ id: 'target', team: 'B', q: dist, r: 0, weapon: weapon, ammo: { mags: 10 }, skill: 1.0, traits: [], facing: { q: -1, r: 0 } });
    let shotTick = null, lastDist = dist;
    const map2 = map;
    for (let t = 0; t < 2000; t++) {
      sim.tick();
      const evs = sim.drainEvents();
      for (const ev of evs) {
        if (ev.type === 'SHOT' && ev.shooterId === 'shooter' && shotTick === null) shotTick = ev.tick;
        if (ev.type === 'MOVE' && ev.id === 'shooter') lastDist = map2.dist({ q: ev.to.q, r: ev.to.r }, { q: dist, r: 0 });
      }
      if (shotTick !== null) break;
    }
    return { shotTick: shotTick, distAtShot: lastDist };
  }

  const calmResult = firstShotWithWeapon(TraitPolicy, ['calm'], sniperWeapon, farDist, seed);
  const defaultResult = firstShotWithWeapon(DefaultPolicy, [], sniperWeapon, farDist, seed);

  check(calmResult.shotTick === null, `calm: does not open fire at dist=${farDist} (rngMax=${rngMax}, threshold=${(rngMax * 2 / 3).toFixed(1)}) (shotTick=${calmResult.shotTick})`);
  check(defaultResult.shotTick !== null, `calm baseline sanity: DefaultPolicy DOES open fire at the same far-but-in-range distance (shotTick=${defaultResult.shotTick})`);

  // now place the target within the calm threshold -- calm should engage.
  const nearDist = Math.max(1, Math.floor(rngMax * 2 / 3) - 1);
  const calmNear = firstShotWithWeapon(TraitPolicy, ['calm'], sniperWeapon, nearDist, seed);
  check(calmNear.shotTick !== null, `calm: opens fire once dist<=rngMax*2/3 (dist=${nearDist}) (shotTick=${calmNear.shotTick})`);
}

// ===========================================================================
// T-timid: suppression >= 40 stops self-initiated action (HOLD_POS, no target).
// ===========================================================================

{
  const map = makeGridMap({ coverAt: () => 0.6 });
  const soldierView = {
    id: 't1', team: 'A', q: 0, r: 0, hp: 100, suppression: 40, morale: 100,
    magRemaining: 5, magsLeft: 5, weapon: toSimWeapon('m1', WPNS.m1, SIM_TUNING),
    traits: ['timid'],
  };
  const worldView = {
    soldiers: [
      soldierView,
      { id: 'e1', team: 'B', q: 2, r: 0, hp: 100 },
    ],
    map: map, tuning: SIM_TUNING,
  };
  const intent = TraitPolicy.decide(soldierView, worldView, mulberry32(1));
  check(intent.type === 'HOLD_POS' && intent.note === '臆病: 制圧下のため行動停止',
    `timid: freezes at suppression>=40 even with visible enemy (got type=${intent.type} note=${intent.note})`);
}

{
  // below threshold -- timid should behave like default and engage the visible enemy.
  const map = makeGridMap({ coverAt: () => 0.6 });
  const soldierView = {
    id: 't2', team: 'A', q: 0, r: 0, hp: 100, suppression: 39, morale: 100,
    magRemaining: 5, magsLeft: 5, weapon: toSimWeapon('m1', WPNS.m1, SIM_TUNING),
    traits: ['timid'],
  };
  const worldView = {
    soldiers: [
      soldierView,
      { id: 'e1', team: 'B', q: 2, r: 0, hp: 100 },
    ],
    map: map, tuning: SIM_TUNING,
  };
  const intent = TraitPolicy.decide(soldierView, worldView, mulberry32(1));
  check(intent.type === 'TARGET' && intent.payload.targetId === 'e1',
    `timid: engages normally below suppression threshold (got type=${intent.type})`);
}

// ===========================================================================
// T-determinism: same seed -> identical event-stream JSON across two runs,
// for a mixed-trait scenario driven entirely by TraitPolicy.
// ===========================================================================

function runDeterminismScenario(seed) {
  const map = makeGridMap({ coverAt: () => 0.6 });
  const rng = mulberry32(seed);
  const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: rng, policy: TraitPolicy });
  const rifleWeapon = toSimWeapon('m1', WPNS.m1, SIM_TUNING);

  sim.addSoldier({ id: 'agg', team: 'A', q: 0, r: 0, weapon: rifleWeapon, ammo: { mags: 10 }, skill: 1.0, traits: ['aggressive'], facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'caut', team: 'A', q: 0, r: 1, weapon: rifleWeapon, ammo: { mags: 10 }, skill: 1.0, traits: ['cautious'], facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'calm', team: 'A', q: 0, r: 2, weapon: rifleWeapon, ammo: { mags: 10 }, skill: 1.0, traits: ['calm'], facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'tim', team: 'A', q: 0, r: 3, weapon: rifleWeapon, ammo: { mags: 10 }, skill: 1.0, traits: ['timid'], facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'e0', team: 'B', q: 3, r: 0, weapon: rifleWeapon, ammo: { mags: 10 }, skill: 1.0, traits: [], facing: { q: -1, r: 0 } });
  sim.addSoldier({ id: 'e1', team: 'B', q: 3, r: 3, weapon: rifleWeapon, ammo: { mags: 10 }, skill: 1.0, traits: [], facing: { q: -1, r: 0 } });

  const allEvents = [];
  for (let t = 0; t < 900; t++) {
    sim.tick();
    const evs = sim.drainEvents();
    for (const ev of evs) allEvents.push(ev);
    if (sim.result()) break;
  }
  return allEvents;
}

{
  const seed = 999;
  const run1 = JSON.stringify(runDeterminismScenario(seed));
  const run2 = JSON.stringify(runDeterminismScenario(seed));
  check(run1 === run2, `determinism: identical event stream JSON for same seed (len1=${run1.length} len2=${run2.length})`);
  check(run1.length > 0, 'determinism: scenario actually produced events');
}

// ---------------------------------------------------------------------------

console.log(`\n${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
} else {
  process.exit(0);
}
