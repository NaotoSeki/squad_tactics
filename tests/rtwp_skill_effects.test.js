/** Deterministic RTwP checks for normalized skill and ability effects. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const box = { console, module: { exports: {} } };
box.window = box;
vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8')
  + '\n;this.SKILLS=SKILLS;this.SIM_TUNING=SIM_TUNING;this.WPNS=WPNS;', box);

const { SimCore, toSimWeapon } = require(path.join(ROOT, 'sim_core.js'));
const T = box.SIM_TUNING;
const map = {
  dist(a, b) { return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r)); },
  hasLos() { return true; }, cover() { return 0; }, moveCost() { return 1; },
  neighbors(h) { return [{ q: h.q + 1, r: h.r }]; },
};

function makeSim() {
  return new SimCore({ map, tuning: T, rng: () => 0.5 });
}
function add(sim, id, extra) {
  return sim.addSoldier(Object.assign({
    id, team: id[0], q: id[0] === 'A' ? 0 : 2, r: 0,
    weapon: toSimWeapon('m1', box.WPNS.m1, T), ammo: { mags: 4 },
    attrs: { action: 5, speed: 5, str: 5, morale: 5, aim: 5, throw: 5, melee: 5, recon: 5 },
  }, extra || {}));
}

// HighPower and Armor are applied once at the authoritative damage boundary.
{
  const sim = makeSim();
  add(sim, 'A0', { effects: { damageMult: 1.2 } });
  add(sim, 'B0', { effects: { armorFlat: 5 } });
  sim._applyDamage(sim._soldiers.get('B0'), 10, sim._soldiers.get('A0'));
  assert.strictEqual(sim.getSoldier('B0').hp, 93, '12 damage minus 5 armor');
}

// CQC multiplies the same melee power used by assault resolution.
{
  const sim = makeSim();
  add(sim, 'A0');
  add(sim, 'A1', { effects: { meleeMult: 1.25 } });
  const base = sim._meleePower(sim._soldiers.get('A0'), T).power;
  const cqc = sim._meleePower(sim._soldiers.get('A1'), T).power;
  assert.strictEqual(cqc, base * 1.25);
}

// Tempo, throw and aim abilities all influence live RTwP calculations.
{
  const sim = makeSim();
  add(sim, 'A0', { attrs: { action: 10, speed: 5, str: 5, morale: 5, aim: 10, throw: 10, melee: 5, recon: 5 } });
  const s = sim._soldiers.get('A0');
  assert.ok(sim._duration(s, 20, 'action', T.ATTR_ACT_RANGE) < 20, 'tempo shortens handling');
  assert.ok(sim._duration(s, 20, 'throw', T.ATTR_THR_RANGE) < 20, 'throw shortens preparation');
  assert.ok(sim._aimMult(s, T) > 1, 'aim increases hit multiplier');
}

// Mechanic recovery is time-based and inactive before the quiet delay.
{
  const sim = makeSim();
  add(sim, 'A0', { effects: { recoveryPerSecond: 1 } });
  add(sim, 'B0');
  const s = sim._soldiers.get('A0');
  s.hp = 50;
  s.quietT = T.SKILL_RECOVERY_DELAY_T - 2;
  sim._phaseSuppressionMorale();
  assert.strictEqual(s.hp, 50, 'no recovery before delay');
  for (let i = 0; i < 10; i++) sim._phaseSuppressionMorale();
  assert.ok(s.hp > 50, 'recovery begins after quiet delay');
}

// Hero and morale ability reduce losses without any AP or turn boundary.
{
  const sim = makeSim();
  add(sim, 'A0', { isLeader: true });
  add(sim, 'A1', { attrs: { action: 10, speed: 5, str: 5, morale: 10, aim: 5, throw: 5, melee: 5, recon: 5 },
    effects: { actionTimeMult: 0.9, moraleLossMult: 0.75 } });
  const hero = sim._soldiers.get('A1');
  sim._applyMoraleOnDeath(sim._soldiers.get('A0'));
  assert.ok(hero.morale > 100 + T.MORALE_LEADER_DOWN, 'hero/high morale loses less morale');
  assert.ok(sim._duration(hero, 20, 'action', T.ATTR_ACT_RANGE) < 15, 'Hero stacks with tempo');
}

console.log('rtwp_skill_effects.test.js: passed');
