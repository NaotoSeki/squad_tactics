/** Run with: node tests/tank_availability.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const templates = {
  rifleman: { name: 'Rifleman' }, scout: { name: 'Scout' }, gunner: { name: 'Gunner' },
  sniper: { name: 'Sniper' }, mortar_gunner: { name: 'Mortar' }, aerial: { name: 'Aerial' },
  tank_pz4: { name: 'Panzer IV', isTank: true }, tank_tiger: { name: 'Tiger I', isTank: true },
};

function loadRuntime() {
  const timers = [];
  const box = {
    console, UNIT_TEMPLATES: templates, FEATURE_TANK_UNITS: false,
    Math: Object.create(Math), setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    document: { getElementById: () => null }, UIManager: class {}, EnemyAI: class {},
  };
  box.window = box;
  box.addEventListener = () => {};
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'logic_campaign.js'), 'utf8') +
    '\n;this.CampaignManagerForTest=CampaignManager;this.availableCardsForTest=AVAILABLE_CARDS;', box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'logic_game.js'), 'utf8'), box);
  return { box, timers };
}

{
  const { box } = loadRuntime();
  assert.deepStrictEqual(Array.from(box.availableCardsForTest),
    ['rifleman', 'scout', 'gunner', 'sniper', 'mortar_gunner', 'aerial']);
  assert.strictEqual(box.isUnitTemplateAvailable({ type: 'rifleman' }), true);
  assert.strictEqual(box.isUnitTemplateAvailable({ type: 'tank_pz4' }), false);
  const campaign = Object.create(box.CampaignManagerForTest.prototype);
  assert.strictEqual(campaign.createSoldier('tank_pz4', 'player'), null);
  assert.strictEqual(campaign.createSoldier('tank_tiger', 'enemy'), null);
}

{
  const { box } = loadRuntime();
  const game = Object.create(box.BattleLogic.prototype);
  game.sector = 99;
  box.BATTLE_SCALE = {
    ENEMY_TANK_CHANCE: 1, ENEMY_TANK_CHANCE_PER_SECTOR: 1,
    ENEMY_TIGER_CHANCE: 1, ENEMY_TIGER_CHANCE_PER_SECTOR: 1,
  };
  for (const roll of [0, 0.001, 0.1, 0.9, 0.999]) {
    box.Math.random = () => roll;
    assert.ok(!templates[game.pickEnemyTemplate()].isTank, `enemy roll ${roll} must stay infantry`);
  }
  assert.strictEqual(game.spawnUnitAt('enemy', 'tank_tiger'), false);
  assert.strictEqual(game.spawnUnitAt('player', 'tank_pz4'), false);
  assert.ok(!templates[game.pickAlliedTemplate()].isTank);
}

{
  const { box, timers } = loadRuntime();
  const dealt = [];
  box.Renderer = { game: {}, dealCards: (cards) => dealt.push(cards), centerMap() {} };
  box.BATTLE_SCALE = { ALLIED_REINFORCEMENTS: 0, RT_DEFAULT_STANCE: null };
  const carriedInfantry = { type: 'rifleman', fusionCount: 2 };
  const campaign = { carriedCards: [{ type: 'tank_pz4' }, carriedInfantry, 'tank_tiger'], isAutoMode: false };
  const game = Object.create(box.BattleLogic.prototype);
  game.campaign = campaign;
  game.units = [];
  game.sector = 1;
  game.ui = { log() {} };
  game.generateMap = () => {};
  game.spawnEnemies = () => {};
  game.spawnAlliedReinforcements = () => {};
  game.runAuto = () => {};
  game.init();
  while (timers.length) timers.shift()();
  assert.strictEqual(dealt.length, 1);
  assert.ok(dealt[0].every(card => !templates[card.type || card].isTank), 'dealt deck must contain no tank cards');
  assert.strictEqual(dealt[0][0], carriedInfantry, 'non-tank fused card must be preserved');
}

console.log('tank_availability.test.js: passed');
