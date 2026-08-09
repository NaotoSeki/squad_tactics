'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const M2 = require('../m2_mortar.js');
const { SimCore, toSimWeapon, mulberry32 } = require('../sim_core.js');

const ROOT = path.join(__dirname, '..');
const sb = { console };
sb.globalThis = sb;
sb.window = sb;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8')
  + '\nglobalThis.__T=SIM_TUNING;globalThis.__W=WPNS;', sb);
const T = sb.__T;
const mortar = toSimWeapon('m2_mortar', sb.__W.m2_mortar, T);

const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
function hexDist(a, b) {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs((a.q + a.r) - (b.q + b.r)));
}
function battleMap(coverFn) {
  return {
    dist: hexDist,
    cover: coverFn || (() => 0),
    hasLos: () => false,
    neighbors: (h) => DIRECTIONS.map(([q, r]) => ({ q: h.q + q, r: h.r + r })),
    moveCost: () => 1,
  };
}
function add(sim, id, team, q, r, weapon) {
  sim.addSoldier({ id, team, q, r, weapon: weapon || mortar, ammo: { mags: 3 }, skill: 1 });
}
function fire(rng, coverFn, extras) {
  const sim = new SimCore({ map: battleMap(coverFn), tuning: T, rng });
  add(sim, 'm', 'A', 0, 0);
  add(sim, 'direct', 'B', 4, 0);
  (extras || []).forEach((x) => add(sim, x.id, x.team || 'B', x.q, x.r));
  sim._resolveBurst(sim._soldiers.get('m'), sim._soldiers.get('direct'), T);
  return { sim, shot: sim.drainEvents().find((e) => e.type === 'SHOT') };
}

// Within-hex dispersion is deterministic and stays inside the normalized hex footprint.
{
  const seq = [0.9, 0.2, 0.81, 0.25];
  const impact = M2.resolveImpact({
    aimHex: { q: 4, r: 2 }, range: 6, minRange: 2, maxRange: 12, accuracy: 68,
    neighbors: (h) => battleMap().neighbors(h), rng: () => seq.shift()
  });
  assert.deepStrictEqual(impact.hex, { q: 4, r: 2 });
  assert.strictEqual(impact.adjacent, false);
  assert.ok(Math.hypot(impact.offsetQ, impact.offsetR) > 0);
  assert.ok(Math.hypot(impact.offsetQ, impact.offsetR) <= 0.42);
}

// A larger miss selects a real adjacent axial hex, never an arbitrary screen displacement.
{
  const seq = [0.0, 0.0, 0.25, 0.0];
  const impact = M2.resolveImpact({
    aimHex: { q: 4, r: 0 }, range: 10, minRange: 2, maxRange: 12, accuracy: 68,
    neighbors: (h) => battleMap().neighbors(h), rng: () => seq.shift()
  });
  assert.strictEqual(impact.adjacent, true);
  assert.deepStrictEqual(impact.hex, { q: 5, r: 0 });
  assert.strictEqual(hexDist(impact.aimHex, impact.hex), 1);
}

// Direct, adjacent and outside-radius damage are legible and use one resolved impact.
{
  const { sim, shot } = fire(() => 0.5, null, [
    { id: 'near', q: 5, r: 0 }, { id: 'far', q: 6, r: 0 }, { id: 'friendly', team: 'A', q: 4, r: 0 }
  ]);
  assert.ok(shot && shot.casualties);
  assert.strictEqual(sim.getSoldier('direct').hp, 0, 'open direct impact is decisive');
  assert.ok(sim.getSoldier('near').hp > 0 && sim.getSoldier('near').hp < 60,
    'adjacent blast is meaningful but has falloff');
  assert.strictEqual(sim.getSoldier('far').hp, 100, 'outside radius receives no HP damage');
  assert.strictEqual(sim.getSoldier('friendly').hp, 100, 'RTwP friendly-fire rule remains off');
}

// Cover mitigates blast damage rather than turning the entire explosion into a binary miss.
{
  const open = fire(() => 0.5, () => 0).shot.casualties.find((c) => c.id === 'direct').dmg;
  const covered = fire(() => 0.5, () => 0.5).shot.casualties.find((c) => c.id === 'direct').dmg;
  assert.ok(covered > 0 && covered < open, `cover reduces direct blast (${open} -> ${covered})`);
}

// Seeded runs resolve identical impact hex, sub-hex point and casualties.
{
  const a = fire(mulberry32(0x4d32), null, [{ id: 'near', q: 5, r: 0 }]).shot;
  const b = fire(mulberry32(0x4d32), null, [{ id: 'near', q: 5, r: 0 }]).shot;
  assert.deepStrictEqual(a.targetHex, b.targetHex);
  assert.deepStrictEqual(a.impactOffset, b.impactOffset);
  assert.deepStrictEqual(a.casualties, b.casualties);
}

// Mechanical event coordinates and visual conversion consume the same impact record.
{
  const shot = fire(mulberry32(77)).shot;
  const impact = { hex: shot.targetHex, offsetQ: shot.impactOffset.q, offsetR: shot.impactOffset.r };
  const toPx = (q, r) => ({ x: q * 100 + r * 50, y: r * 80 });
  const p = M2.impactScreenPoint(impact, toPx);
  const center = toPx(shot.targetHex.q, shot.targetHex.r);
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  assert.ok(p.x !== center.x || p.y !== center.y, 'sub-hex impact reaches VFX coordinates');
  const rtwpSource = fs.readFileSync(path.join(ROOT, 'logic_battle_rtwp.js'), 'utf8');
  assert.ok(rtwpSource.includes('M2Mortar.impactScreenPoint(impact'));
  const legacySource = fs.readFileSync(path.join(ROOT, 'logic_game.js'), 'utf8');
  assert.ok(legacySource.includes('Renderer.playExplosion(tx, ty, \'t2_grenade\', resolvedHex'));
  assert.ok(legacySource.includes('game.getUnitsInHex(resolvedHex.q, resolvedHex.r)'));
}

console.log('m2 mortar ballistics tests: OK');
