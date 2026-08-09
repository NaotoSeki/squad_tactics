const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { SimCore, InstantOrders, toSimWeapon } = require(path.join(__dirname, '..', 'sim_core.js'));

function dist(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}
function map() {
  return {
    dist, hasLos: () => true, cover: () => 1, moveCost: () => 1,
    neighbors: h => [
      { q: h.q + 1, r: h.r }, { q: h.q - 1, r: h.r },
      { q: h.q, r: h.r + 1 }, { q: h.q, r: h.r - 1 },
      { q: h.q + 1, r: h.r - 1 }, { q: h.q - 1, r: h.r + 1 },
    ],
  };
}
const box = { window: null, console, module: { exports: {} } };
box.window = box;
vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8'), box);
vm.runInContext(';this.BASE_TUNING = SIM_TUNING;', box);
const tuning = Object.assign({}, box.BASE_TUNING, {
  MOVE_T_PER_HEX: 1, MOVE_MODE_MULT: { rush: 1 }, ATTR_REF: 5,
  ASSAULT_CONTACT_RNG: 2, ASSAULT_LOST_RADIUS: 8, ASSAULT_NADE_MIN_COVER: 0,
  ASSAULT_MELEE_T: 1, PINNED_AT: 9999, SUPPRESSED_AT: 9998,
  MUNITIONS: { grenade: { rng: 3, prepT: 1, fuseT: 5, radius: 1,
    suppress: 0, dmg: { base: 1, spread: 0 } } },
});
const weapon = toSimWeapon('test', { rng: 6, cap: 1, burst: 1, dmg: 1, acc: 0 }, tuning);
function add(sim, id, team, q, grenades) {
  sim.addSoldier({ id, team, q, r: 0, weapon, grenades: grenades || 0,
    ammo: { mags: 0 }, attrs: { speed: 5, recon: 5, str: 5, melee: 5 } });
  const s = sim.getSoldier(id); s.magRemaining = 0; s.magsLeft = 0; return s;
}
function assault(sim, ids) {
  sim.issueOrder({ type: 'ASSAULT', soldierIds: ids, payload: { targetId: 'enemy' } });
}

// The thrower knows its own pending blast; squad mates are not omniscient.
{
  const sim = new SimCore({ map: map(), tuning, orders: new InstantOrders(), rng: () => 0.5 });
  const thrower = add(sim, 'thrower', 'A', 0, 1);
  const mate = add(sim, 'mate', 'A', 0, 0);
  add(sim, 'enemy', 'B', 3, 0);
  assault(sim, ['thrower']);
  for (let i = 0; i < 20 && (!sim._blasts || !sim._blasts.length); i++) sim.tick();
  assert.ok(sim._blasts && sim._blasts.length === 1, 'assault did not release grenade');
  assault(sim, ['mate']);
  let mateWasExposed = false;
  while (sim._blasts.length) {
    sim.tick();
    assert.ok(dist(sim.getSoldier('thrower'), { q: 3, r: 0 }) > 1,
      'thrower entered its pending blast');
    if (dist(sim.getSoldier('mate'), { q: 3, r: 0 }) <= 1) mateWasExposed = true;
  }
  assert.ok(mateWasExposed, 'squad mate gained omniscient knowledge of another throw');
  assert.strictEqual(sim._blasts.length, 0, 'detonated hazard was not cleared');
  const before = sim.getSoldier('mate').q;
  sim.tick();
  const after = sim.getSoldier('mate');
  assert.ok(after.q > before || dist(after, { q: 3, r: 0 }) === 0,
    'assault did not resume after detonation');
}

// Multiple own hazards are all respected; cancellation/removal immediately unblocks.
{
  const sim = new SimCore({ map: map(), tuning, orders: new InstantOrders(), rng: () => 0.5 });
  const mate = add(sim, 'mate', 'A', 0, 0);
  add(sim, 'enemy', 'B', 3, 0);
  const spec = tuning.MUNITIONS.grenade;
  sim._blasts = [
    { at: 10, hex: { q: 2, r: 0 }, kind: 'grenade', ownerId: 'mate', spec },
    { at: 12, hex: { q: 3, r: 0 }, kind: 'grenade', ownerId: 'mate', spec },
  ];
  assault(sim, ['mate']); sim.tick();
  const held = sim.getSoldier('mate');
  assert.ok(dist(held, { q: 2, r: 0 }) > 1 && dist(held, { q: 3, r: 0 }) > 1,
    'overlapping own hazards were not all respected');
  sim._blasts = []; // projectile/hazard cancellation
  const before = sim.getSoldier('mate');
  for (let i = 0; i < 4 && sim.getSoldier('mate').q === before.q
    && sim.getSoldier('mate').r === before.r; i++) sim.tick();
  const after = sim.getSoldier('mate');
  assert.notDeepStrictEqual({ q: after.q, r: after.r }, { q: before.q, r: before.r },
    'cancelled hazard continued to block assault');
}

console.log('PASS: assault grenade safety');
