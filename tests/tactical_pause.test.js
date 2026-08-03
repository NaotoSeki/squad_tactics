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

// --- 強襲中・投擲中の表示 ---------------------------------------------------
assert.strictEqual(
  Overlay.describeSoldier({ hp: 100, state: 'assault' }).action, '強襲中');
assert.strictEqual(
  Overlay.describeSoldier({ hp: 100, state: 'throw' }).action, '投擲');
assert.strictEqual(
  Overlay.describeSoldier({ hp: 100, state: 'engage', engageHex: { q: 1, r: 1 } }).action,
  '制圧射撃');

// --- 命令確定のターゲットカーソル -------------------------------------------
// クリックが効いた感じを出すための表示。静的APIから積めること、
// フレームごとに減って必ず消えることを確かめる。
const flashOverlay = Object.assign({}, fakeOverlay, {
  flashes: new Map(),
  flashTarget: Overlay.prototype.flashTarget,
});
Overlay.current = flashOverlay;
Overlay.flash('B2');
assert.ok(flashOverlay.flashes.has('B2'), 'flash() は現行インスタンスへ積まれる');
const startFrames = flashOverlay.flashes.get('B2');
assert.ok(startFrames > 1, 'ターゲットカーソルは複数フレーム点滅する');
Overlay.current = null;
Overlay.flash('B3');   // インスタンスが無くても落ちない

// --- marching ants / 相撃ちの衝突 -------------------------------------------
// 実際に線を引かせ、破線が複数セグメントに割れること・一方通行には矢尻が付き
// 撃ち合いには付かない（代わりに衝突点を描く）ことを検証する。
function traceLines() {
  const ops = [];
  const g = {
    clear() {}, lineStyle(w, c, a) { ops.push(['style', c, a]); },
    beginPath() { ops.push(['begin']); },
    moveTo(x, y) { ops.push(['move', Math.round(x), Math.round(y)]); },
    lineTo(x, y) { ops.push(['line', Math.round(x), Math.round(y)]); },
    strokePath() { ops.push(['stroke']); },
    fillStyle(c, a) { ops.push(['fillStyle', c, a]); },
    fillTriangle() { ops.push(['triangle']); },
    strokeCircle() { ops.push(['circle']); },
    closePath() {}, fillPath() {},
  };
  return { g, ops };
}

const oneWay = traceLines();
Overlay.prototype._line.call(
  { scene: fakeOverlay.scene, lines: oneWay.g, frame: 0 },
  { x: 0, y: 0 }, { x: 200, y: 0 }, 0xffffff, 2, 0.9, 1);
assert.ok(oneWay.ops.filter((o) => o[0] === 'stroke').length > 1,
  '射線は破線（複数セグメント）で描かれる');
assert.ok(oneWay.ops.some((o) => o[0] === 'triangle'),
  '一方通行の射線には矢尻が付く（向きが分かる）');

const clashing = traceLines();
Overlay.prototype._line.call(
  { scene: fakeOverlay.scene, lines: clashing.g, frame: 0 },
  { x: 0, y: 0 }, { x: 200, y: 0 }, 0xffffff, 2, 0.9, 0.46);
assert.ok(!clashing.ops.some((o) => o[0] === 'triangle'),
  '撃ち合いの線は標的まで届かないので矢尻を付けない');
const reach = Math.max(...clashing.ops.filter((o) => o[0] === 'line').map((o) => o[1]));
assert.ok(reach < 120, '撃ち合いの線は中間手前で止まる: ' + reach);

// 位相が進めば破線の位置が変わる（＝流れて見える）
const framed = traceLines();
Overlay.prototype._line.call(
  { scene: fakeOverlay.scene, lines: framed.g, frame: 7 },
  { x: 0, y: 0 }, { x: 200, y: 0 }, 0xffffff, 2, 0.9, 1);
assert.notDeepStrictEqual(
  oneWay.ops.filter((o) => o[0] === 'move'),
  framed.ops.filter((o) => o[0] === 'move'),
  'フレームが進むと破線の位相がずれる（marching ants）');

// --- 戦雲の勢力重み ---------------------------------------------------------
// 頭数ではなく「維持できる火力」であること。弾切れ・釘付け・指揮からの孤立が
// それぞれ独立に勢力を痩せさせる。
sandbox.SIM_TUNING = { PINNED_AT: 80, COMMS_VOICE_RNG: 2 };
const W = (s, leader) => Overlay.prototype._weightOf.call({}, s, leader);
const base = { hp: 100, state: 'idle', q: 0, r: 0, team: 'A', suppression: 0,
  weapon: { magCap: 8 }, magRemaining: 8, magsLeft: 4 };
const leader = Object.assign({}, base, { id: 'L', q: 0, r: 0, isLeader: true });

assert.ok(W(Object.assign({}, base, { magRemaining: 0, magsLeft: 0 }), leader)
  < W(base, leader), '弾が少ない兵は勢力が痩せる');
assert.ok(W(Object.assign({}, base, { suppression: 70 }), leader)
  < W(base, leader), '制圧された兵は面を維持できない');
assert.ok(W(Object.assign({}, base, { q: 9 }), leader)
  < W(base, leader), '指揮から切れた兵は組織的な圧力にならない');
assert.strictEqual(W(Object.assign({}, base, { state: 'incap' }), leader), 0,
  '行動不能者は勢力に数えない');
assert.strictEqual(W(Object.assign({}, base, { hp: 0 }), leader), 0,
  '死者は勢力に数えない');

console.log('tactical_pause.test.js: passed');
