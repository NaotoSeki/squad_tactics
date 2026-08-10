/** RTwP must not surface the legacy End Turn control. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const uiSource = fs.readFileSync(path.join(ROOT, 'logic_ui.js'), 'utf8')
  + '\n;this.__UIManager = UIManager;';
const phaserSidebar = fs.readFileSync(path.join(ROOT, 'phaser_sidebar.js'), 'utf8');

const unitInfo = { innerHTML: '' };
const sandbox = {
  console,
  Renderer: { generateFaceIcon() { return ''; } },
  document: { getElementById(id) { return id === 'unit-info' ? unitInfo : null; } },
};
sandbox.window = sandbox;
sandbox.getCurrentWeapon = () => null;
sandbox.gameLogic = { state: 'PLAY' };
vm.createContext(sandbox);
vm.runInContext(uiSource, sandbox, { filename: 'logic_ui.js' });

const unit = {
  id: 'P0', team: 'player', hp: 100, maxHp: 100, stance: 'stand',
  def: { isTank: false, role: 'Rifleman' }, hands: [null, null, null],
  bag: [], skills: [], ap: 0, maxAp: 0,
};
function render(active, state) {
  sandbox.RtwpBattle = { active };
  sandbox.gameLogic.state = state;
  unitInfo.innerHTML = '';
  sandbox.__UIManager.prototype.updateSidebar.call({}, unit, state, false);
  return unitInfo.innerHTML;
}

assert.ok(!render(true, 'PLAY').includes('End Turn'), 'live RTwP sidebar omits End Turn');
assert.ok(!render(false, 'WIN').includes('End Turn'), 'frozen result sidebar omits End Turn');
assert.ok(!render(false, 'REVIEW').includes('End Turn'), 'battle review sidebar omits End Turn');
assert.ok(!render(false, 'PLAY').includes('End Turn'), 'no legacy fallback exposes End Turn');
assert.ok(!render(false, 'PLAY').includes('<span>AP</span>'), 'no fallback exposes retired AP');
assert.ok(!/createButton\([^\n]*['"]End Turn['"]/.test(phaserSidebar),
  'Phaser sidebar no longer creates a legacy End Turn button');

console.log('rtwp_end_turn_ui: 6 passed');
