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

  function firstShotWithWeapon(policy, traits, weapon, dist, seedN, opts) {
    opts = opts || {};
    const map = makeGridMap({ coverAt: () => 0.6 });
    const rng = mulberry32(seedN);
    const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: rng, policy: policy });
    sim.addSoldier({ id: 'shooter', team: 'A', q: 0, r: 0, weapon: weapon, ammo: { mags: 10 }, skill: 1.0, traits: traits, facing: { q: 1, r: 0 } });
    sim.addSoldier({ id: 'target', team: 'B', q: dist, r: 0, weapon: weapon, ammo: { mags: 10 }, skill: 1.0, traits: [], facing: { q: -1, r: 0 } });
    // 撃ち返されない状況を作る。calm の「引きつけ」は**自分が撃たれていない時**の
    // 規律なので、的が撃ってくると成立しない（2026-08-05 に意図を明文化）。
    if (opts.silentTarget) {
      const tg = sim._soldiers.get('target');
      tg.magRemaining = 0; tg.magsLeft = 0;
    }
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

  // 撃ってこない的が相手なら、従来どおり引きつける（これが calm の性格）
  const calmResult = firstShotWithWeapon(TraitPolicy, ['calm'], sniperWeapon, farDist, seed,
    { silentTarget: true });
  const defaultResult = firstShotWithWeapon(DefaultPolicy, [], sniperWeapon, farDist, seed,
    { silentTarget: true });

  check(calmResult.shotTick === null, `calm: does not open fire at dist=${farDist} (rngMax=${rngMax}, threshold=${(rngMax * 2 / 3).toFixed(1)}) (shotTick=${calmResult.shotTick})`);

  // **撃たれたら撃ち返す。** 引きつけを無条件にしていた版は、射程いっぱいで
  // 膠着した撃ち合いで calm の兵が一発も撃たずに終わっていた（2026-08-05 実測）。
  const calmReturnFire = firstShotWithWeapon(TraitPolicy, ['calm'], sniperWeapon, farDist, seed);
  check(calmReturnFire.shotTick !== null,
    `calm: 撃たれれば保留線の外でも撃ち返す (dist=${farDist}) (shotTick=${calmReturnFire.shotTick})`);
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

// ---------------------------------------------------------------------------
// calm: 引きつけの保留は「単独で判断している時」だけ
//
// 無条件に保留していた版は、射程いっぱいで膠着した撃ち合い（実戦で最も多い形）
// では間合いが詰まらず、冷静な兵が**一発も撃たないまま**戦闘が終わっていた
// （2026-08-05 実測: calm の兵が総発砲0発／非交戦理由の最大が この保留で全判断の
// 18%）。m1 は rngMax=7 で保留線は約4.7hex、撃ち合いは5〜7hexで安定するため
// 構造的に永久保留だった。分隊が撃っていれば加わり、撃たれていれば撃ち返す。
// ---------------------------------------------------------------------------
{
  const rifle = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
  // 遮蔽は厚めにする。薄い遮蔽で撃たれると自衛(GO_PRONE)が先に働き
  // （「撃ち返すより先に身を守る」＝設計どおり）、射撃判断まで到達しない。
  const map = makeGridMap({ coverAt: () => 0.6 });
  // 保留線(rngMax * 2/3)より遠く、射程内の距離に敵を置く
  const holdLine = rifle.rngMax * (2 / 3);
  const farButInRange = Math.min(rifle.rngMax, Math.ceil(holdLine) + 1);

  const calmSoldier = (over) => Object.assign({
    id: 'c', team: 'A', q: 0, r: 0, hp: 100, weapon: rifle, traits: ['calm'],
    magRemaining: 8, magsLeft: 4, suppression: 0, morale: 100, state: 'idle',
    prone: false, fireMode: 'aimed', underFireT: -9999, attrs: null,
  }, over || {});
  const foe = {
    id: 'e', team: 'B', q: farButInRange, r: 0, hp: 100, weapon: rifle,
    suppression: 0, state: 'idle', traits: [],
  };
  const mate = (id, q, r, state) => ({
    id: id, team: 'A', q: q, r: r, hp: 100, weapon: rifle,
    suppression: 0, state: state, traits: [], isLeader: false,
  });
  const world = (soldiers, tick) => ({
    soldiers: soldiers, map: map, tuning: SIM_TUNING, tick: tick != null ? tick : 1000,
  });
  const rng = mulberry32(4);

  // ① 単独: 従来どおり引きつける
  const alone = calmSoldier();
  const d1 = TraitPolicy.decide(alone, world([alone, foe]), rng);
  check(d1 && d1.type === 'HOLD_POS' && /冷静/.test(d1.note || ''),
    `calm は単独なら遠距離で射撃を保留する (d=${farButInRange})`);

  // ② 分隊が撃っている: 斉射へ加わる
  const joiner = calmSoldier();
  const firing = [joiner, foe, mate('m1', 1, 0, 'engage'), mate('m2', 0, 1, 'engage')];
  const d2 = TraitPolicy.decide(joiner, world(firing), rng);
  check(d2 && d2.type === 'TARGET' && d2.payload.targetId === 'e',
    'calm でも分隊が交戦していれば斉射に加わる');

  // ③ 自分が撃たれている: 撃ち返す
  const shotAt = calmSoldier({ underFireT: 995 });   // tick 1000 の直近
  const d3 = TraitPolicy.decide(shotAt, world([shotAt, foe]), rng);
  check(d3 && d3.type === 'TARGET' && d3.payload.targetId === 'e',
    'calm でも自分が撃たれていれば撃ち返す');

  // ④ 味方が1名だけ交戦: 閾値未満なので保留のまま（性格は残っている）
  const one = calmSoldier();
  const d4 = TraitPolicy.decide(one, world([one, foe, mate('m1', 1, 0, 'engage')]), rng);
  check(d4 && d4.type === 'HOLD_POS' && /冷静/.test(d4.note || ''),
    `味方1名の交戦では保留を解かない (CALM_JOIN_VOLLEY_N=${SIM_TUNING.CALM_JOIN_VOLLEY_N})`);

  // ⑤ 間合いが詰まれば単独でも撃つ（元からの挙動）
  const near = calmSoldier();
  const closeFoe = Object.assign({}, foe, { q: 1 });
  const d5 = TraitPolicy.decide(near, world([near, closeFoe]), rng);
  check(d5 && d5.type === 'TARGET', 'calm も保留線の内側なら単独で撃つ');
}

// Known target + blocked LOS: bounded, covered approach instead of indefinite idle.
{
  const rifle = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
  const coverMap = (h) => (h.q === 1 && h.r === 0 ? 0.05 : 0.55);
  const map = makeGridMap({
    coverAt: coverMap,
    losBlocked: (a, b) => {
      const targetSide = (a.q === 5 && a.r === 0) || (b.q === 5 && b.r === 0);
      const other = (a.q === 5 && a.r === 0) ? b : a;
      return targetSide && other.q < 2;
    },
  });
  const foe = { id: 'known', team: 'B', q: 5, r: 0, hp: 100, state: 'idle',
    weapon: rifle, suppression: 0, traits: [] };
  const makeScout = (id, r) => ({ id: id, team: 'A', q: 0, r: r, hp: 100,
    state: 'idle', weapon: rifle, magRemaining: 8, magsLeft: 4, suppression: 0,
    morale: 100, traits: [], engageTargetId: 'known', prone: false, fireMode: 'aimed' });
  const a = makeScout('approach-a', 0);
  const b = makeScout('approach-b', 1);
  const world = { soldiers: [a, b, foe], map: map, tuning: SIM_TUNING, tick: 100 };
  const da = TraitPolicy.decide(a, world, mulberry32(30));
  const db = TraitPolicy.decide(b, world, mulberry32(31));
  check(da && da.type === 'MOVE_TO' && da.payload.path.length > 0,
    'known target + blocked LOS initiates cautious movement instead of idle');
  const enda = da && da.payload.path[da.payload.path.length - 1];
  check(enda && map.cover(enda) >= 0.25 && map.dist(enda, foe) < map.dist(a, foe),
    'cautious approach advances to useful cover');
  check(enda && map.hasLos(enda, foe), 'covered approach can reach a firing position with LOS');
  const endb = db && db.payload.path && db.payload.path[db.payload.path.length - 1];
  check(enda && endb && (enda.q !== endb.q || enda.r !== endb.r),
    'squad members choose dispersed cover destinations instead of stacking');

  const exposedMap = makeGridMap({
    coverAt: (h) => (h.q === 1 ? 0.05 : 0.55),
    losBlocked: (x, y) => {
      const targetSide = (x.q === 5 && x.r === 0) || (y.q === 5 && y.r === 0);
      const other = (x.q === 5 && x.r === 0) ? y : x;
      return targetSide && other.q < 2;
    },
  });
  const lone = makeScout('approach-crawl', 0);
  const exposedWorld = { soldiers: [lone, foe], map: exposedMap, tuning: SIM_TUNING, tick: 100 };
  const cautious = TraitPolicy.decide(lone, exposedWorld, mulberry32(32));
  check(cautious && cautious.type === 'MOVE_TO' && cautious.payload.mode === 'crawl',
    'an unavoidable low-cover crossing uses crawl instead of a blind standing charge');

  const visibleMap = makeGridMap({ coverAt: () => 0.55 });
  const visibleWorld = { soldiers: [a, foe], map: visibleMap, tuning: SIM_TUNING, tick: 100 };
  const fire = TraitPolicy.decide(a, visibleWorld, mulberry32(33));
  check(fire && fire.type === 'TARGET' && fire.payload.targetId === 'known',
    'unit that regains LOS resumes firing decision');

  const cautiousTrait = Object.assign({}, makeScout('approach-trait', 0), { traits: ['cautious'] });
  const thinMap = makeGridMap({ coverAt: () => 0.26, losBlocked: () => true });
  const thinWorld = { soldiers: [cautiousTrait, foe], map: thinMap,
    tuning: SIM_TUNING, tick: 100 };
  const refusesThin = TraitPolicy.decide(cautiousTrait, thinWorld, mulberry32(34));
  check(refusesThin && refusesThin.type === 'HOLD_POS',
    'cautious trait keeps its existing 0.3 minimum cover during approach');
}

console.log(`\n${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
} else {
  process.exit(0);
}
