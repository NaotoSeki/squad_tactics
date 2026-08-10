'use strict';

const assert = require('assert');
const path = require('path');
const { SimBattleAdapter } = require(path.join(__dirname, '..', 'sim_battle_adapter.js'));

const snapshot = {
  id: 'A0', team: 'A', q: 2, r: 3, hp: 72, maxHp: 100,
  weapon: { code: 'm1', class: 'rifle' },
  skills: ['Precision', 'Radio'], traits: ['calm'],
  effects: { accuracyMult: 1.15 }, hasRadio: true,
  engageTargetId: 'B0',
};
const adapter = new SimBattleAdapter({ soldiers: () => [snapshot] });
const unit = adapter.units[0];

assert.deepStrictEqual(unit.skills, ['Precision', 'Radio']);
assert.deepStrictEqual(unit.traits, ['calm']);
assert.deepStrictEqual(unit.effects, { accuracyMult: 1.15 });
assert.strictEqual(unit.hasRadio, true);
assert.strictEqual(unit.maxHp, 100);
assert.strictEqual(unit._rtwpTargetId, 'B0');

unit.skills.push('CQC');
unit.effects.accuracyMult = 9;
assert.deepStrictEqual(snapshot.skills, ['Precision', 'Radio'],
  'adapter must not mutate the SimCore snapshot arrays');
assert.strictEqual(snapshot.effects.accuracyMult, 1.15,
  'adapter must not mutate the SimCore snapshot effects');

console.log('sim_battle_adapter_metadata: passed');
