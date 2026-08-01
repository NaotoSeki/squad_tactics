'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'phaser_tactical_pause.js'), 'utf8'),
  sandbox,
  { filename: 'phaser_tactical_pause.js' },
);

const Overlay = sandbox.TacticalPauseOverlay;
assert.ok(Overlay, 'tactical pause overlay must be exported');

const aimed = Overlay.describeSoldier({
  id: 'A1', hp: 100, state: 'engage', fireMode: 'aimed', engageTargetId: 'B2',
}, (id) => id === 'B2' ? 'Enemy Two' : id);
assert.strictEqual(aimed.action, '照準・射撃');
assert.strictEqual(aimed.targetId, 'B2');
assert.strictEqual(aimed.targetName, 'Enemy Two');

const suppress = Overlay.describeSoldier({
  id: 'A2', hp: 100, state: 'engage', fireMode: 'suppress', engageTargetId: 'B1',
});
assert.strictEqual(suppress.action, '制圧射撃');

const moving = Overlay.describeSoldier({
  id: 'A3', hp: 100, state: 'move', fireMode: 'hold',
  movePath: [{ q: 2, r: 3 }, { q: 4, r: 5 }],
});
assert.strictEqual(moving.action, '移動中');
assert.deepStrictEqual(JSON.parse(JSON.stringify(moving.moveGoal)), { q: 4, r: 5 });

assert.strictEqual(Overlay.describeSoldier({ hp: 100, state: 'reload' }).action, '再装填中');
assert.strictEqual(Overlay.describeSoldier({ hp: 100, state: 'pinned' }).action, '釘付け');
assert.strictEqual(Overlay.describeSoldier({ hp: 0 }).action, '戦闘不能');

console.log('tactical_pause.test.js: passed');
