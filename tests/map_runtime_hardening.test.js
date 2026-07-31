/** Run with: node tests/map_runtime_hardening.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function vehicleSpawnTests() {
  const box = {
    window: {}, console, MAP_W: 6, MAP_H: 4,
    BATTLE_SCALE: { HEX_UNIT_CAP: 5 },
    Math: Object.create(Math), setTimeout, clearTimeout,
  };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'logic_game.js'), 'utf8'), box);

  const blocked = () => ({ id: -1, cost: 99, tankBlocked: true });
  const road = () => ({ id: 3, cost: 1, tankBlocked: false });
  const map = Array.from({ length: box.MAP_W }, () =>
    Array.from({ length: box.MAP_H }, blocked));
  for (let q = 0; q < 3; q++) {
    for (let r = 0; r < box.MAP_H; r++) map[q][r] = road();
  }
  for (let r = 0; r < box.MAP_H; r++) map[5][r] = road();

  const game = Object.create(box.window.BattleLogic.prototype);
  game.map = map;
  game.units = [];
  game.mapSystem = {
    isValidHex: (q, r) => q >= 0 && q < box.MAP_W && r >= 0 && r < box.MAP_H,
    getNeighbors(q, r) {
      return [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
        .map(([dq, dr]) => ({ q: q + dq, r: r + dr }))
        .filter((h) => this.isValidHex(h.q, h.r));
    },
  };

  const main = game.getMainVehiclePassableComponent();
  assert.strictEqual(main.size, 12);
  assert.ok(main.has('0,0') && main.has('2,3'));
  assert.ok(!main.has('5,3'), 'small vehicle island must not be a spawn component');

  box.Math.random = () => 0.999999;
  const fallback = game.getSafeSpawnPos('player', true);
  assert.deepStrictEqual({ q: fallback.q, r: fallback.r }, { q: 0, r: 2 });
  assert.ok(main.has(fallback.q + ',' + fallback.r));

  const samples = [0.2, 0.6];
  box.Math.random = () => samples.shift();
  const sampled = game.getSafeSpawnPos('player', true);
  assert.deepStrictEqual({ q: sampled.q, r: sampled.r }, { q: 1, r: 2 });
}

function campaignRuntime() {
  const timers = [];
  const elements = new Map();
  const box = {
    console, location: { search: '' }, URLSearchParams, Math, alert() {},
    document: {
      getElementById: (id) => elements.get(id) || null,
      createElement: () => ({ getContext: () => ({}), toDataURL: () => '' }),
      readyState: 'loading',
    },
    setTimeout(fn) { timers.push(fn); return timers.length; },
  };
  box.window = box;
  box.addEventListener = () => {};
  vm.createContext(box);
  const code = fs.readFileSync(path.join(ROOT, 'logic_campaign.js'), 'utf8');
  vm.runInContext(code + '\n;this.CampaignManagerForTest=CampaignManager;', box);
  return { box, timers, elements, CampaignManager: box.CampaignManagerForTest };
}

function autodeployTest() {
  const { box, timers, elements, CampaignManager } = campaignRuntime();
  const campaign = new CampaignManager();
  const button = { disabled: true };
  let selectedCount = 0;
  const cards = Array.from({ length: 3 }, () => {
    let selected = false;
    return {
      clicks: 0,
      classList: { contains: (name) => name === 'selected' && selected },
      click() {
        this.clicks++;
        if (!selected) {
          selected = true;
          if (++selectedCount === 3) button.disabled = false;
        }
      },
    };
  });
  elements.set('setup-cards', { querySelectorAll: () => cards });
  elements.set('btn-start', button);
  box.location.search = '?autodeploy';
  let starts = 0;
  box.gameLogic = {
    startCampaign() {
      starts++;
      campaign._startedMissionSector = campaign.sector;
      return true;
    },
  };

  assert.strictEqual(campaign.scheduleAutodeploy(), true);
  assert.strictEqual(campaign.scheduleAutodeploy(), false);
  while (timers.length) timers.shift()();
  assert.strictEqual(starts, 1);
  assert.deepStrictEqual(cards.map((card) => card.clicks), [1, 1, 1]);
  assert.strictEqual(campaign.scheduleAutodeploy(), false);
}

function sectorGuardTest() {
  const { box, elements, CampaignManager } = campaignRuntime();
  ['setup-screen', 'reward-screen', 'sidebar', 'resizer', 'sidebar-toggle'].forEach((id) =>
    elements.set(id, { style: {} }));
  let constructed = 0;
  let initialized = 0;
  box.BattleLogic = class {
    constructor() { constructed++; }
    init() { initialized++; }
  };
  const campaign = new CampaignManager();
  assert.strictEqual(campaign.startMission(), true);
  assert.strictEqual(campaign.startMission(), false);
  assert.strictEqual(constructed, 1);
  assert.strictEqual(initialized, 1);
  campaign.sector++;
  assert.strictEqual(campaign.startMission(), true);
  assert.strictEqual(constructed, 2);
  assert.strictEqual(initialized, 2);
}

vehicleSpawnTests();
autodeployTest();
sectorGuardTest();
console.log('map_runtime_hardening.test.js: passed');
