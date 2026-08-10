const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const sb = { console: console };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8')
  + '\nthis.__WPNS = WPNS;', sb, { filename: 'data.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'loadout_weight.js'), 'utf8'),
  sb, { filename: 'loadout_weight.js' });

const expected = [
  ['mortar_barrel', 'M2 Tube', 5.8],
  ['mortar_bipod', 'M2 Bipod', 7.4],
  ['mortar_plate', 'M2 Baseplate', 5.8],
  ['mortar_shell_box', '60mm Ammo Box', 22.2],
];
for (const [code, name, kg] of expected) {
  assert.strictEqual(sb.__WPNS[code].name, name, code + ' formal name');
  assert.strictEqual(sb.__WPNS[code].weight, kg, code + ' real-world-derived kg');
}

const unit = {
  def: { isTank: false }, params: { speed: 3, str: 6 }, ap: 4,
  hands: expected.slice(0, 3).map(([code]) => Object.assign({ code }, sb.__WPNS[code])),
  bag: [Object.assign({ code: 'mortar_shell_box' }, sb.__WPNS.mortar_shell_box),
    Object.assign({ code: 'm1911' }, sb.__WPNS.m1911)],
};
sb.LoadoutWeight.refreshUnitLoadout(unit);
assert.strictEqual(unit._carriedWeightKg, 43.6, 'four-card M2 kit plus issued M1911');
assert.strictEqual(unit.params.effectiveSpeed, 0, 'assembled M2 must be deployed before it can move');
unit.hands = [null, null, null];
unit.bag = [null, unit.bag[1]];
sb.LoadoutWeight.refreshUnitLoadout(unit);
assert.strictEqual(unit._carriedWeightKg, 2.4, 'four M2 cards removed; M1911 retained');
assert.strictEqual(unit.params.effectiveSpeed, 3, 'empty loadout effective speed');
assert.strictEqual(sb.LoadoutWeight.getMovementBudget(unit, 4), 2,
  'empty M2 gunner movement budget');

const gameSource = fs.readFileSync(path.join(ROOT, 'logic_game.js'), 'utf8');
for (const method of ['swapEquipment', 'moveWeaponToDeck', 'equipWeaponFromDeck']) {
  const start = gameSource.indexOf('  ' + method + '(');
  const next = gameSource.indexOf('\n  }', start);
  assert.ok(gameSource.slice(start, next).includes('this.refreshLoadoutDerivedState(u)'),
    method + ' refreshes derived loadout state');
}

console.log('m2 loadout mobility tests: OK');
