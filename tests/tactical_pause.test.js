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
assert.strictEqual(Overlay.COMPACT_DETAIL_AT, 24,
  'large battles must switch to a compact personal-detail view');

const overlaySource = fs.readFileSync(
  path.join(__dirname, '..', 'phaser_tactical_pause.js'), 'utf8');
assert.ok(overlaySource.includes('const compact = alive.length >= COMPACT_DETAIL_AT;'));
assert.ok(overlaySource.includes('const showDetail = !compact || isPrimary || isHovered'));

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
  detail: {
    setScale() { return this; }, setPosition() { return this; },
    setText(t) { this.text = t; }, setVisible(v) { this.visible = v; },
  },
  lines: { clear() {} },
  labels: new Map(),
  domUi: null,
  _setDetail: Overlay.prototype._setDetail,
};
Overlay.prototype.update.call(fakeOverlay);
assert.deepStrictEqual(shadeCalls, [
  ['position', 100, 200],
  ['size', 500, 250],
]);

// 未選択・采配なしの時は詳細パネルを出さない。操作説明（「味方兵をクリック」）は
// チュートリアルの領分で、常設HUDには置かない。
assert.strictEqual(fakeOverlay.detail.text, '');
assert.strictEqual(fakeOverlay.detail.visible, false);

// 未配達の一括命令は、PAUSE中の意思決定図では古いsim命令より先に表示する。
function pendingOrderLine(mode, approach) {
  const calls = [];
  const label = {
    setText() { return this; }, setScale() { return this; },
    setPosition() { return this; }, setVisible() { return this; },
  };
  const soldier = { id: 'A1', team: 'A', hp: 100, q: 0, r: 0,
    state: 'move', movePath: [{ q: -3, r: 0 }], fireMode: 'hold' };
  const overlay = Object.assign({}, fakeOverlay, {
    frame: 0,
    labels: new Map(),
    cloud: null,
    flashes: new Map(),
    options: {
      getSoldiers: () => [soldier], getSelectedId: () => null,
      getPendingTargetId: () => null,
      getPendingTargetHex: () => ({ q: 7, r: 3 }),
      getPendingTargetMode: () => mode,
      getPendingFiringHex: () => approach ? ({ q: 5, r: 1 }) : null,
      getPendingApproachPath: () => approach
        ? [{ q: 2, r: 0 }, { q: 5, r: 1 }] : null,
    },
    lines: {
      clear() {}, lineStyle() {}, strokeCircle() {}, beginPath() {},
      moveTo() {}, lineTo() {}, strokePath() {},
    },
    _position: () => ({ x: 0, y: 0 }),
    _label: () => label,
    _name: (id) => id,
    _line: (from, to, color) => calls.push({ from, to, color }),
    _drawPlan() {},
  });
  sandbox.Renderer = { hexToPx: (q, r) => ({ x: q * 10, y: r * 10 }) };
  Overlay.prototype.update.call(overlay);
  return calls;
}

const pendingMoveLines = pendingOrderLine('move');
assert.strictEqual(pendingMoveLines.length, 1, '予約移動はMarching Antsを1本描く');
assert.deepStrictEqual(pendingMoveLines[0].to, { x: 70, y: 30 });
assert.strictEqual(pendingMoveLines[0].color, 0x7fe7ff, '予約移動は移動色で描く');

const pendingSuppressLines = pendingOrderLine('suppress');
assert.strictEqual(pendingSuppressLines.length, 1, '予約制圧はMarching Antsを1本描く');
assert.deepStrictEqual(pendingSuppressLines[0].to, { x: 70, y: 30 });
assert.strictEqual(pendingSuppressLines[0].color, 0xff8a38, '予約制圧は制圧色で描く');

const pendingApproachLines = pendingOrderLine('suppress', true);
assert.strictEqual(pendingApproachLines.length, 3,
  '接近→制圧は経路2区間と射撃位置→目標を別々に描く');
assert.deepStrictEqual(pendingApproachLines[0].to, { x: 20, y: 0 });
assert.deepStrictEqual(pendingApproachLines[1].to, { x: 50, y: 10 });
assert.deepStrictEqual(pendingApproachLines[2].from, { x: 50, y: 10 });
assert.deepStrictEqual(pendingApproachLines[2].to, { x: 70, y: 30 });
assert.strictEqual(pendingApproachLines[0].color, 0x7fe7ff,
  '射撃位置までの経路は移動色で描く');
assert.strictEqual(pendingApproachLines[2].color, 0xff8a38,
  '射撃位置から本来の目標までは制圧色で描く');

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

// 蟻は射手→標的へ流れる（逆走していると、静止画で撃っている側を読み違える）。
// 破線の先頭位置がフレームとともに前進することで確かめる。
function dashHeads(frame) {
  const xs = [];
  const g = {
    lineStyle() {}, beginPath() {}, strokePath() {}, closePath() {}, fillPath() {},
    moveTo(x) { xs.push(x); }, lineTo() {}, fillStyle() {}, fillTriangle() {},
  };
  Overlay.prototype._line.call(
    { scene: fakeOverlay.scene, lines: g, frame },
    { x: 0, y: 0 }, { x: 400, y: 0 }, 0xffffff, 2, 0.9, 1);
  return xs;
}
// zoom=2 → dash 4.5 / gap 3 / period 7.5、1フレーム 0.8px 進む。1周期未満で比較する。
const heads0 = dashHeads(0);
const heads1 = dashHeads(1);
const heads2 = dashHeads(2);
assert.ok(heads0.length > 1 && heads1.length > 1, '破線が引かれている');
// 先頭の断片は始点で切り落とされるので、2本目以降で位相の進みを見る
assert.ok(heads1[1] > heads0[1] && heads2[1] > heads1[1],
  'marching ants は射手→標的の向きに流れる: '
  + [heads0[1], heads1[1], heads2[1]].join(' -> '));

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

// ---------------------------------------------------------------------------
// 采配リング: 狙っていた敵が倒れたら**その場で**描かれなくなる
//
// state.plan は分隊長が次の采配を出した時にしか書き換わらないので、的が倒れても
// 計画は残る。LeaderPolicy 側の検算は数秒に1回・生きた分隊長が居る時だけなので
// 「倒した瞬間に消える」を保証できない。描画側の毎フレーム検算が最後の砦
// （2026-08-05 ディレクター報告4回目「遺体の上／誰も居ない所に円が残る」）。
// ここでは実物の _drawPlan を呼び、描かれた図形の数を数える。
// ---------------------------------------------------------------------------
sandbox.SIM_TUNING = { PINNED_AT: 80, COMMS_VOICE_RNG: 2, PLAN_STALE_RADIUS: 1 };
sandbox.Renderer = { hexToPx: (q, r) => ({ x: q * 10, y: r * 10 }) };

function drawPlanCalls(plan, soldiers) {
  const calls = { circles: 0, paths: 0 };
  const lines = {
    lineStyle() {}, beginPath() { }, moveTo() {}, lineTo() {},
    strokePath() { calls.paths++; }, strokeCircle() { calls.circles++; },
  };
  const self = {
    lines: lines,
    frame: 0,
    scene: { cameras: { main: { zoom: 1 } } },
    _position: (id, s) => ({ x: s.q * 10, y: s.r * 10 }),
    _line() { calls.paths++; },
    _planHasLiveFoe: Overlay.prototype._planHasLiveFoe,
  };
  const byId = new Map(soldiers.filter((s) => s.hp > 0).map((s) => [String(s.id), s]));
  Overlay.prototype._drawPlan.call(self, plan, byId);
  return calls;
}

const foeAlive = { id: 'B1', team: 'B', q: 6, r: 0, hp: 100, state: 'engage' };
const mateA = { id: 'A1', team: 'A', q: 0, r: 0, hp: 100, state: 'engage' };
const planAt6 = { name: 'PUSH_SUPPRESS', label: '制圧', phase: 'suppress',
  hex: { q: 6, r: 0 }, baseIds: ['A1'], assaultIds: [], targetId: null };

assert.ok(drawPlanCalls(planAt6, [mateA, foeAlive]).circles > 0,
  '敵が居る采配リングは描かれる');

assert.strictEqual(
  drawPlanCalls(planAt6, [mateA, Object.assign({}, foeAlive, { hp: 0 })]).circles, 0,
  '狙っていた敵が戦死したら采配リングは描かれない');

assert.strictEqual(
  drawPlanCalls(planAt6, [mateA, Object.assign({}, foeAlive, { state: 'incap' })]).circles, 0,
  '行動不能だけが残った hex に采配リングを描かない（遺体の上に残さない）');

assert.strictEqual(
  drawPlanCalls(planAt6, [mateA, Object.assign({}, foeAlive, { q: 20 })]).circles, 0,
  '敵が離れた hex の采配リングは描かない（誰も居ない所に残さない）');

// 采配が消えれば、そこへ伸びていた火力/機動の線も消える
assert.strictEqual(
  drawPlanCalls(planAt6, [mateA, Object.assign({}, foeAlive, { hp: 0 })]).paths, 0,
  '采配が無効なら制圧班の線も描かれない');

// 名指しの的が生きていれば、hex の更新が1フレーム遅れてもリングは瞬かない
const planNamed = Object.assign({}, planAt6, { targetId: 'B1', hex: { q: 99, r: 99 } });
assert.ok(drawPlanCalls(planNamed, [mateA, foeAlive]).circles > 0,
  '名指しの的が生きていれば hex がずれていてもリングは残る');

console.log('tactical_pause.test.js: passed');
