/** Focused coverage for player-issued move-then-suppress orders. */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const { SimCore, mulberry32, toSimWeapon, InstantOrders } =
  require(path.join(__dirname, '..', 'sim_core.js'));
const { SimActions } = require(path.join(__dirname, '..', 'sim_actions.js'));

function loadData() {
  const sandbox = { module: { exports: {} }, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data', 'wpns_pl_master.js'), 'utf8'), sandbox);
  vm.runInContext(';this.WPNS=WPNS;this.SIM_TUNING=SIM_TUNING;', sandbox);
  return sandbox;
}

const DATA = loadData();
const TUNING = Object.assign({}, DATA.SIM_TUNING, {
  DECISION_INTERVAL_T: 1,
  MOVE_T_PER_HEX: 1,
  AIM_T: Object.assign({}, DATA.SIM_TUNING.AIM_T, { aimed: 1, suppress: 1 }),
});

function dist(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

function lineMap(options) {
  const opts = options || {};
  const width = opts.width || 12;
  const blocked = new Set(opts.blocked || []);
  return {
    _W: width,
    _H: 1,
    dist: dist,
    hasLos: (a, b) => opts.los === false ? false
      : !(opts.losBlocked && opts.losBlocked(a, b)),
    cover: (h) => (opts.cover && opts.cover[h.q]) || 0,
    moveCost: function (from, to) {
      const h = to || from;
      return h && h.q >= 0 && h.q < width && h.r === 0 && !blocked.has(h.q) ? 1 : 99;
    },
    neighbors: (h) => [{ q: h.q - 1, r: 0 }, { q: h.q + 1, r: 0 }],
  };
}

function rifle(range) {
  const w = toSimWeapon('m1', DATA.WPNS.m1, TUNING);
  w.rngMin = 0;
  w.rngMax = range == null ? 3 : range;
  w.reloadT = 1;
  w.burstIntervalT = 1;
  return w;
}

function actor(id, team, q, weapon) {
  return { id: id, team: team, q: q, r: 0, hp: 100, state: 'idle',
    weapon: weapon, attrs: { speed: 50 }, magRemaining: weapon.magCap, magsLeft: 4 };
}

function actionContext(map, shooter, targetHex, soldiers) {
  return { self: shooter, hex: targetHex, squad: [shooter],
    world: { soldiers: soldiers || [shooter], map: map, tuning: TUNING } };
}

const inertPolicy = {
  decide: () => null,
  vetMoveOrder: () => null,
  pickMoveStep: () => ({ mode: 'walk', observeT: 0 }),
};

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}

// Out of range is an executable intent when a firing position exists.
{
  const map = lineMap();
  const w = rifle(3);
  const shooter = actor('a', 'A', 0, w);
  const foe = actor('b', 'B', 8, rifle(3));
  const orders = SimActions.issue('SUPPRESS_HEX',
    actionContext(map, shooter, { q: 8, r: 0 }, [shooter, foe]));
  const order = orders[0];
  const end = order && order.payload.path[order.payload.path.length - 1];
  check('out-of-range selection becomes one compound order',
    orders.length === 1 && order.type === 'SUPPRESS_APPROACH',
    orders.map((o) => o.type).join(','));
  check('compound order preserves objective and planned firing position/path',
    order && order.payload.hex.q === 8 && end
      && end.q === order.payload.firingHex.q && dist(end, order.payload.hex) <= w.rngMax,
    JSON.stringify(order && order.payload));
}

// The compound order moves first, retains its original hex, then suppresses.
{
  const map = lineMap();
  const sim = new SimCore({ map: map, tuning: TUNING, rng: mulberry32(91),
    policy: inertPolicy, orders: new InstantOrders() });
  const aw = rifle(3), bw = rifle(3);
  sim.addSoldier({ id: 'a', team: 'A', q: 0, r: 0, weapon: aw,
    ammo: { mags: 20 }, attrs: { speed: 100 } });
  sim.addSoldier({ id: 'b', team: 'B', q: 8, r: 0, weapon: bw,
    ammo: { mags: 20 }, attrs: { speed: 100 } });
  const ctx = actionContext(map, sim.getSoldier('a'), { q: 8, r: 0 }, sim.soldiers());
  const order = SimActions.issue('SUPPRESS_HEX', ctx)[0];
  sim.issueOrder(order);
  const events = [];
  for (let i = 0; i < 80; i++) {
    sim.tick();
    events.push.apply(events, sim.drainEvents());
    if (events.some((e) => e.type === 'SHOT' && e.shooterId === 'a')) break;
  }
  const moveAt = events.findIndex((e) => e.type === 'MOVE' && e.id === 'a');
  const startAt = events.findIndex((e) => e.type === 'SUPPRESS_START' && e.id === 'a');
  const shotAt = events.findIndex((e) => e.type === 'SHOT' && e.shooterId === 'a');
  const a = sim.getSoldier('a');
  check('move happens before suppression starts and fires',
    moveAt >= 0 && startAt > moveAt && shotAt > startAt,
    `move=${moveAt} start=${startAt} shot=${shotAt}`);
  check('suppression begins from the planned position against the original hex',
    a.q === order.payload.firingHex.q
      && events[shotAt] && events[shotAt].targetId === 'b'
      && a.fireMode === 'suppress',
    `q=${a.q} firing=${order.payload.firingHex.q}`);
}

// No LOS from any reachable firing position is genuinely impossible.
{
  const map = lineMap({ los: false });
  const w = rifle(3);
  const shooter = actor('a', 'A', 0, w);
  const orders = SimActions.issue('SUPPRESS_HEX',
    actionContext(map, shooter, { q: 8, r: 0 }, [shooter]));
  check('impossible target remains forbidden', orders.length === 0,
    orders.map((o) => o.type).join(','));
}

// An in-range order keeps its existing TARGET_HEX contract.
{
  const map = lineMap();
  const w = rifle(3);
  const shooter = actor('a', 'A', 0, w);
  const orders = SimActions.issue('SUPPRESS_HEX',
    actionContext(map, shooter, { q: 3, r: 0 }, [shooter]));
  check('normal in-range suppression is unchanged',
    orders.length === 1 && orders[0].type === 'TARGET_HEX'
      && orders[0].payload.hex.q === 3,
    orders.map((o) => o.type).join(','));
}

// A later player order cancels the old compound state when it is delivered.
{
  const map = lineMap();
  const sim = new SimCore({ map: map, tuning: TUNING, rng: mulberry32(17),
    policy: inertPolicy, orders: new InstantOrders() });
  const w = rifle(3);
  sim.addSoldier({ id: 'a', team: 'A', q: 0, r: 0, weapon: w,
    ammo: { mags: 20 }, attrs: { speed: 100 } });
  sim.addSoldier({ id: 'b', team: 'B', q: 8, r: 0, weapon: rifle(3), ammo: { mags: 20 } });
  const approach = SimActions.issue('SUPPRESS_HEX',
    actionContext(map, sim.getSoldier('a'), { q: 8, r: 0 }, sim.soldiers()))[0];
  sim.issueOrder(approach);
  sim.tick();
  sim.drainEvents();
  const current = sim.getSoldier('a');
  sim.issueOrder({ type: 'MOVE_TO', soldierIds: ['a'],
    payload: { path: [{ q: Math.max(0, current.q - 1), r: 0 }], mode: 'walk' } });
  sim.tick();
  const replacementEvents = sim.drainEvents();
  const internal = sim._soldiers.get('a');
  check('replacement cancels stale suppression approach state',
    !internal._suppressApproachOrder && !internal._suppressObjectiveHex
      && replacementEvents.some((e) => e.type === 'ORDER_DELIVERED'
        && e.order && e.order.type === 'MOVE_TO'),
    JSON.stringify({ current: internal.currentOrder && internal.currentOrder.type,
      approach: !!internal._suppressApproachOrder }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
