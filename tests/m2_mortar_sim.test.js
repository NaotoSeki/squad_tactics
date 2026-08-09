'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { SimCore, toSimWeapon } = require('../sim_core.js');

const sandbox = { console };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
const dataText = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8')
  + '\nglobalThis.__M2_TUNING = SIM_TUNING; globalThis.__M2_WPNS = WPNS;';
vm.runInNewContext(dataText, sandbox, { filename: 'data.js' });
const T = sandbox.__M2_TUNING;
const mortar = toSimWeapon('m2_mortar', sandbox.__M2_WPNS.m2_mortar, T);

assert.strictEqual(mortar.indirect, true);
assert.strictEqual(mortar.area, true);
assert.strictEqual(mortar.rngMin, 2);
assert.strictEqual(mortar.rngMax, 12);
assert.strictEqual(mortar.magCap, 1);
assert.strictEqual(mortar.penBase, 190);
assert.strictEqual(mortar.blastRadius, 1);

function map(blocked) {
  return {
    dist(a, b) { return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs((a.q + a.r) - (b.q + b.r))); },
    cover() { return 0; },
    hasLos() { return !blocked; },
    neighbors() { return []; },
    moveCost() { return 1; },
  };
}

// Indirect fire must work through blocked direct LOS and damage/suppress the hex.
{
  const sim = new SimCore({ map: map(true), tuning: T, rng: () => 0 });
  sim.addSoldier({ id: 'm', team: 'A', q: 0, r: 0, weapon: mortar, ammo: { mags: 3 }, skill: 1 });
  sim.addSoldier({ id: 't1', team: 'B', q: 4, r: 0, weapon: mortar, ammo: { mags: 0 }, skill: 1 });
  sim.addSoldier({ id: 't2', team: 'B', q: 4, r: 0, weapon: mortar, ammo: { mags: 0 }, skill: 1 });
  sim.addSoldier({ id: 't3', team: 'B', q: 5, r: 0, weapon: mortar, ammo: { mags: 0 }, skill: 1 });
  const shooter = sim._soldiers.get('m');
  sim._resolveBurst(shooter, sim._soldiers.get('t1'), T);
  const shot = sim.drainEvents().find((event) => event.type === 'SHOT');
  assert.ok(shot, 'indirect mortar emits SHOT through blocked LOS');
  assert.strictEqual(shooter.magRemaining, 0);
  assert.ok(shot.spilled.includes('t2'), 'HE blast reaches another hostile in the impact hex');
  assert.ok(shot.spilled.includes('t3'), '60mm fragmentation reaches an adjacent hex');
}

// Effective speed zero is an absolute mobility lock, including direct MOVE_TO orders.
{
  const sim = new SimCore({ map: map(false), tuning: T, rng: () => 0 });
  sim.addSoldier({ id: 'm', team: 'A', q: 0, r: 0, weapon: mortar, ammo: { mags: 1 }, attrs: { speed: 0 } });
  sim.addSoldier({ id: 'e', team: 'B', q: 8, r: 0, weapon: mortar, ammo: { mags: 0 } });
  sim.issueOrder({ type: 'MOVE_TO', soldierIds: ['m'], payload: { path: [{ q: 1, r: 0 }], mode: 'walk' } });
  for (let i = 0; i < 200; i++) sim.tick();
  const soldier = sim.getSoldier('m');
  assert.strictEqual(soldier.q, 0);
  assert.strictEqual(soldier.r, 0);
  assert.strictEqual(sim.drainEvents().some((event) => event.type === 'MOVE' && event.id === 'm'), false);
}

// The 2-hex dead zone is enforced even though LOS is ignored.
{
  const sim = new SimCore({ map: map(true), tuning: T, rng: () => 0 });
  sim.addSoldier({ id: 'm', team: 'A', q: 0, r: 0, weapon: mortar, ammo: { mags: 1 }, skill: 1 });
  sim.addSoldier({ id: 'near', team: 'B', q: 1, r: 0, weapon: mortar, ammo: { mags: 0 }, skill: 1 });
  const shooter = sim._soldiers.get('m');
  sim._resolveBurst(shooter, sim._soldiers.get('near'), T);
  assert.strictEqual(sim.drainEvents().some((event) => event.type === 'SHOT'), false);
  assert.strictEqual(shooter.magRemaining, 1);
}

console.log('m2_mortar sim tests: OK');
