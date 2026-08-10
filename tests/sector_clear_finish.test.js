/**
 * Deterministic RTwP result-handoff timing checks.
 *
 * Run with: node tests/sector_clear_finish.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'logic_battle_rtwp.js'), 'utf8');

function makeSandbox() {
  const sb = {
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
    Math, JSON, Date, Map, Set, Infinity,
    // The finish handoff only needs a timer seam; the simulation itself is
    // replaced with a tiny deterministic stub below.
    setTimeout() { throw new Error('timer stub not installed'); },
  };
  sb.window = sb;
  sb.SimCore = class {
    constructor() { this._soldiers = []; }
    soldiers() { return this._soldiers; }
    getSoldier() { return null; }
  };
  sb.TraitPolicy = {};
  sb.CommsOrders = class {};
  sb.makePsBattleMapApi = () => ({});
  sb.mulberry32 = () => () => 0.5;
  sb.toSimWeapon = () => ({});
  sb.SIM_TUNING = {};
  sb.WPNS = {};
  sb.MAP_W = 1;
  sb.MAP_H = 1;
  vm.createContext(sb);
  vm.runInContext(source, sb, { filename: 'logic_battle_rtwp.js' });
  return sb;
}

function runFinish(sb, winner) {
  const timers = [];
  const audio = [];
  const calls = [];
  sb.setTimeout = (fn, delay) => {
    timers.push({ fn, delay });
    return timers.length;
  };
  // Installing document after attach keeps the UI installer out of this
  // focused timing test while still selecting the browser handoff branch.
  sb.document = {};
  sb.Sfx = sb.window.Sfx = { play(id) { audio.push(id); } };
  const unit = { id: 'P0', team: 'player', hp: 100, maxHp: 100 };
  const g = {
    map: {},
    units: [unit],
    ui: { log() {} },
    campaign: winner === 'A'
      ? { onSectorCleared(survivors, transition) { calls.push({ type: 'win', survivors, transition }); } }
      : { onGameOver(reason, survivors) { calls.push({ type: 'loss', reason, survivors }); } },
  };
  const instance = sb.RtwpBattle.attach(g);
  assert.ok(instance, 'RTwP attach returns an instance for timing test');
  instance.sim.result = () => ({ winner, reason: winner === 'A' ? 'annihilation' : 'incapacitated', tick: 7 });
  instance.finishBattle();
  return { timers, audio, calls, g, instance };
}

const sb = makeSandbox();
assert.strictEqual(sb.RtwpBattle.finishTiming.victoryResolveMs, 900,
  'victory resolve beat is 900ms');
assert.strictEqual(sb.RtwpBattle.finishTiming.lossResultDelayMs, 500,
  'loss handoff remains 500ms');

const win = runFinish(sb, 'A');
assert.deepStrictEqual(win.audio, ['sector_clear'],
  'sector_clear starts as the victory transition begins');
assert.strictEqual(win.timers.length, 1, 'victory schedules one presentation handoff');
assert.strictEqual(win.timers[0].delay, 900, 'victory handoff waits for the resolve beat');
assert.strictEqual(win.calls.length, 0, 'victory presentation stays hidden during the resolve beat');
win.timers[0].fn();
assert.strictEqual(win.calls.length, 1, 'victory presentation appears after the resolve beat');
assert.strictEqual(win.calls[0].transition.jingleStarted, true,
  'campaign knows RTwP already started the victory jingle');

const loss = runFinish(sb, 'B');
assert.deepStrictEqual(loss.audio, [], 'loss handoff does not start the victory jingle');
assert.strictEqual(loss.timers.length, 1, 'loss schedules one presentation handoff');
assert.strictEqual(loss.timers[0].delay, 500, 'loss timing remains unchanged');
assert.strictEqual(loss.calls.length, 0, 'loss presentation waits for its existing handoff');
loss.timers[0].fn();
assert.strictEqual(loss.calls[0].type, 'loss', 'loss still routes to onGameOver');

console.log('sector_clear_finish: 13 passed');
