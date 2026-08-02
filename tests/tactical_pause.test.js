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

// The pause shade must follow the camera world view. A screen-space rectangle
// is still transformed by camera zoom and becomes detached strips after a
// monitor-driven viewport change.
const shadeCalls = [];
const fakeOverlay = {
  active: true,
  scene: {
    cameras: {
      main: {
        x: 0, y: 0, width: 1000, height: 500, zoom: 2,
        getWorldPoint(x, y) { return { x: 100 + x / 2, y: 200 + y / 2 }; },
      },
    },
    scale: { width: 1000, height: 500 },
  },
  options: { getSoldiers: () => [], getSelectedId: () => null },
  shade: {
    setPosition(x, y) { shadeCalls.push(['position', x, y]); return this; },
    setSize(w, h) { shadeCalls.push(['size', w, h]); return this; },
  },
  banner: { setScale() { return this; }, setPosition() { return this; } },
  help: { setScale() { return this; }, setPosition() { return this; } },
  detail: { setScale() { return this; }, setPosition() { return this; }, setText() {} },
  lines: { clear() {} },
  labels: new Map(),
  domUi: null,
};
Overlay.prototype.update.call(fakeOverlay);
assert.deepStrictEqual(shadeCalls, [
  ['position', 100, 200],
  ['size', 500, 250],
]);

console.log('tactical_pause.test.js: passed');
