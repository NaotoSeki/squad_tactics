'use strict';

const assert = require('assert');
const M = require('../m2_mortar.js');

function part(code) { return { code }; }

assert.strictEqual(M.isAssembled({ hands: [part('mortar_barrel'), part('mortar_bipod'), part('mortar_plate')] }), true);
assert.strictEqual(M.isAssembled({ hands: [part('mortar_plate'), part('mortar_barrel'), part('mortar_bipod')] }), true,
  'part order must not matter');
assert.strictEqual(M.isAssembled({ hands: [part('mortar_barrel'), part('mortar_bipod'), null] }), false,
  'one missing part must fall back to component art');

const unit = {
  hands: [part('mortar_barrel'), part('mortar_bipod'), part('mortar_plate')],
  bag: [
    { code: 'mortar_shell_box', cap: 12, current: 9 },
    { code: 'mortar_shell_box', cap: 12, current: 4 },
  ],
};
assert.strictEqual(M.ammoTotal(unit), 13);
assert.strictEqual(M.setAmmoTotal(unit, 7), 0);
assert.deepStrictEqual(unit.bag.map((x) => x.current), [7, 0]);
assert.strictEqual(M.setAmmoTotal(unit, 14), 0);
assert.deepStrictEqual(unit.bag.map((x) => x.current), [12, 2]);
assert.strictEqual(M.ASSEMBLED_SLICE_KEYS.length, 3);
assert.strictEqual(M.MAP_DISPLAY_SIZE, 24, 'map mortar footprint remains slightly smaller than a soldier');

const buildScript = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'build_m2_mortar_ui_assets.py'), 'utf8');
assert.match(buildScript, /M2_VIRTUAL_GAP\s*=\s*round/,
  'assembled slices are sampled through a measured virtual gap');
assert.match(buildScript, /index \* \(M2_SLICE_SIZE\[1\] \+ M2_VIRTUAL_GAP\)/,
  'each slice advances past the undrawn UI gap instead of using a simple third');

console.log('m2_mortar tests: OK');
