/** Run with: node tests/map_nextgen.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const Generator = require('../logic_map_nextgen.js');

function signature(result) {
  return result.map.map(col => col.map(cell => cell.base + cell.elevation).join(',')).join('|');
}

function reproducibilityTest() {
  const a = Generator.create('repro-41027');
  const b = Generator.create('repro-41027');
  assert.ok(a && b);
  assert.strictEqual(signature(a), signature(b));
  assert.deepStrictEqual(a.spawns, b.spawns);
  assert.deepStrictEqual(a.enemyInitial, b.enemyInitial);
}

function seedCollisionRegressionTest() {
  assert.strictEqual(Generator.hashSeed('s31597'), Generator.hashSeed('s618190'), 'fixture must retain the old 32-bit collision');
  const a = Generator.create('s31597');
  const b = Generator.create('s618190');
  assert.ok(a && b && a.validation.ok && b.validation.ok);
  assert.notStrictEqual(signature(a), signature(b), 'distinct seeds must not collapse through the legacy 32-bit hash');
  const sectorA = Generator.create('s:sector:604327');
  const sectorB = Generator.create('s:sector:1169380');
  assert.notStrictEqual(signature(sectorA), signature(sectorB), 'distinct sectors in one run must not repeat from a hash collision');
}

function manySeedsPropertyTest() {
  const signatures = new Set();
  for (let seed = 0; seed < 1000; seed++) {
    const result = Generator.create(seed);
    assert.ok(result, `seed ${seed} must produce a valid battlefield`);
    assert.ok(result.validation.ok, `seed ${seed}: ${result.validation.errors.join(',')}`);
    assert.ok(result.validation.metrics.vehicleArea >= 288, `seed ${seed}: vehicle area`);
    assert.ok(result.validation.metrics.massRouteRuns >= 2, `seed ${seed}: mass routes`);
    assert.ok(result.validation.metrics.mortarOpenCenters >= 12, `seed ${seed}: mortar footprints`);
    assert.ok(result.validation.metrics.coveredApproachCover >= 13, `seed ${seed}: covered approach`);
    assert.strictEqual(result.validation.metrics.openLosLane, true, `seed ${seed}: LOS lane`);
    assert.ok(result.spawns.player.length >= 12 && result.spawns.enemy.length >= 12);
    assert.ok(result.enemyInitial.every(p => p.r < 10), `seed ${seed}: enemy placement side`);
    signatures.add(signature(result));
  }
  assert.ok(signatures.size > 990, 'seeds should yield meaningfully different maps');
}

function explicitSeedReplayTest() {
  Generator.recentSeeds.length = 0;
  const gameA = {}, gameB = {};
  assert.strictEqual(Generator.apply(gameA, 'same-run-seed'), true);
  assert.strictEqual(Generator.apply(gameB, 'same-run-seed'), true);
  assert.strictEqual(gameA.mapScenario.seed, gameB.mapScenario.seed);
  assert.strictEqual(signature({ map: gameA.map }), signature({ map: gameB.map }));
}

function directApplyFailureCleanupTest() {
  const game = { mapScenario: { source: 'nextgen', seed: 'stale' } };
  Generator.active = true;
  Generator.lastResult = { seed: 'stale' };
  assert.strictEqual(Generator.apply(game, 'forced-invalid', { maxAttempts: 0 }), false);
  assert.strictEqual(Generator.active, false);
  assert.strictEqual(Generator.lastResult, null);
  assert.strictEqual(game.mapScenario, undefined);
}

function campaignSeedTest() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'logic_campaign.js'), 'utf8');
  const sandbox = { console, URLSearchParams, location: { search: '' }, Math, Date,
    document: { readyState: 'loading', addEventListener() {} },
    window: { addEventListener() {} }, setTimeout() {} };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(source + '\n;this.CampaignManagerForTest=CampaignManager;', sandbox);
  const Campaign = sandbox.CampaignManagerForTest;
  const runA = new Campaign({ runSeed: 'run-A' });
  const replayA = new Campaign({ runSeed: 'run-A' });
  const runB = new Campaign({ runSeed: 'run-B' });
  const zeroA = new Campaign({ runSeed: 0 });
  const zeroB = new Campaign({ runSeed: 0 });
  assert.strictEqual(runA.getSectorSeed(17), replayA.getSectorSeed(17));
  assert.notStrictEqual(runA.getSectorSeed(17), runB.getSectorSeed(17));
  assert.notStrictEqual(runA.getSectorSeed(17), runA.getSectorSeed(18));
  assert.strictEqual(zeroA.runSeed, '0');
  assert.strictEqual(zeroA.getSectorSeed(17), zeroB.getSectorSeed(17));
  const a = Generator.create(runA.getSectorSeed(17));
  const replay = Generator.create(replayA.getSectorSeed(17));
  const b = Generator.create(runB.getSectorSeed(17));
  assert.strictEqual(signature(a), signature(replay));
  assert.notStrictEqual(signature(a), signature(b));
}

function fallbackIntegrationTest() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'logic_map.js'), 'utf8');
  let staticCalls = 0;
  const sandbox = {
    console, MAP_W: 2, MAP_H: 2,
    TERRAIN: { VOID: { id: -1, cost: 99 } },
    window: {
      NextGenMapGenerator: { enabled: true, active: true, apply: () => false },
      RuralV29Map: { enabled: true, active: false, generate: game => { staticCalls++; game.map = [['static']]; sandbox.window.RuralV29Map.active = true; sandbox.window.CityMap.active = false; } },
      CityMap: { enabled: false, active: false }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source + '\n;this.MapSystemForTest=MapSystem;', sandbox);
  const game = {};
  new sandbox.MapSystemForTest(game).generate();
  assert.strictEqual(staticCalls, 1);
  assert.strictEqual(game.map[0][0], 'static');
  assert.strictEqual(sandbox.window.RuralV29Map.active, true);
  assert.strictEqual(sandbox.window.CityMap.active, false);

  let cityCalls = 0;
  sandbox.window.NextGenMapGenerator.apply = () => { throw new Error('rejected hard'); };
  sandbox.window.RuralV29Map.enabled = false;
  sandbox.window.RuralV29Map.active = true;
  sandbox.window.CityMap = { enabled: true, active: false,
    generate: target => { cityCalls++; target.map = [['city']]; sandbox.window.CityMap.active = true; } };
  game.mapScenario = { source: 'nextgen', seed: 'exception-stale' };
  new sandbox.MapSystemForTest(game).generate();
  assert.strictEqual(cityCalls, 1);
  assert.strictEqual(game.map[0][0], 'city');
  assert.strictEqual(sandbox.window.NextGenMapGenerator.active, false);
  assert.strictEqual(sandbox.window.RuralV29Map.active, false);
  assert.strictEqual(sandbox.window.CityMap.active, true);
  assert.strictEqual(game.mapScenario, undefined, 'exception fallback clears scenario metadata');

  sandbox.window.NextGenMapGenerator = { enabled: false, active: true };
  sandbox.window.RuralV29Map.enabled = true;
  sandbox.window.CityMap.enabled = false;
  game.mapScenario = { source: 'nextgen', seed: 'stale' };
  new sandbox.MapSystemForTest(game).generate();
  assert.strictEqual(sandbox.window.NextGenMapGenerator.active, false, 'disable clears nextgen active state');
  assert.strictEqual(game.mapScenario, undefined, 'static fallback clears nextgen scenario metadata');

  sandbox.window.NextGenMapGenerator = { enabled: true, active: true, apply: () => false };
  game.mapScenario = { source: 'nextgen', seed: 'rejected' };
  new sandbox.MapSystemForTest(game).generate();
  assert.strictEqual(sandbox.window.NextGenMapGenerator.active, false, 'rejection clears nextgen active state');
  assert.strictEqual(game.mapScenario, undefined, 'rejection fallback clears scenario metadata');
}

function battleFacadeCapacityAndAdapterTest() {
  const sandbox = {
    console, MAP_W: 20, MAP_H: 20, Math: Object.create(Math),
    BATTLE_SCALE: { HEX_UNIT_CAP: 10, HEX_MOVE_BLOCK: 8, ENEMY_BASE: 14, ENEMY_PER_SECTOR: 1.2 },
    FEATURE_TANK_UNITS: false,
    UNIT_TEMPLATES: { rifleman: {}, gunner: {}, sniper: {} },
    TERRAIN: { VOID: { id: -1, cost: 99 } },
    UIManager: class { constructor() {} log() {} },
    document: { getElementById: () => null }, setTimeout() {}, clearTimeout() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'logic_map_nextgen.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'logic_map.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'logic_game.js'), 'utf8'), sandbox);
  sandbox.NextGenMapGenerator.enabled = true;
  let serial = 0;
  const campaign = {
    runSeed: 'capacity-run', getSectorSeed: sector => 'capacity-run:sector:' + sector,
    createSoldier: (key, team) => ({ id: team + '-' + (++serial), team, hp: 10, def: sandbox.UNIT_TEMPLATES[key] })
  };
  const game = new sandbox.BattleFacade(campaign, [], 80);
  game.generateMap();
  const tacticalResult = sandbox.NextGenMapGenerator.lastResult;
  assert.strictEqual(game.mapScenario.requestedSeed, campaign.getSectorSeed(80));
  assert.ok(game.mapScenario.supportedUnitsPerTeam >= 110);
  game.spawnEnemies();
  assert.strictEqual(game.units.length, 110, 'chaos sector 80 enemy force must fully spawn');
  const occupancy = new Map();
  game.units.forEach(unit => occupancy.set(unit.q + ',' + unit.r, (occupancy.get(unit.q + ',' + unit.r) || 0) + 1));
  assert.ok([...occupancy.values()].every(count => count <= 10), 'hex unit cap must be respected');
  assert.ok(game.units.every(unit => unit.r < 10), 'all enemies stay in enemy spawn half');
  assert.ok(game.mapScenario.enemyInitial.every(p => occupancy.has(p.q + ',' + p.r)),
    'actual spawnEnemies must consume the generated initial deployment');

  const high = new sandbox.BattleFacade(campaign, [], 2000);
  high.generateMap();
  const requested = high.getEnemySpawnCount();
  high.spawnEnemies();
  assert.ok(requested > high.mapScenario.sideCapacity.enemy, 'fixture must exceed finite map capacity');
  assert.strictEqual(high.units.length, high.mapScenario.sideCapacity.enemy, 'high sector fills deterministic capacity exactly');
  assert.strictEqual(high.mapScenario.enemyDeployment.requested, requested);
  assert.strictEqual(high.mapScenario.enemyDeployment.supported, high.mapScenario.sideCapacity.enemy);
  assert.strictEqual(high.mapScenario.enemyDeployment.spawned, high.mapScenario.sideCapacity.enemy);
  assert.strictEqual(high.mapScenario.enemyDeployment.truncated, true, 'capacity truncation must be explicit');
  const highOccupancy = new Map();
  high.units.forEach(unit => highOccupancy.set(unit.q + ',' + unit.r, (highOccupancy.get(unit.q + ',' + unit.r) || 0) + 1));
  assert.ok([...highOccupancy.values()].every(count => count === 10), 'every available enemy-side slot is filled to cap');

  const adapterSource = fs.readFileSync(path.join(__dirname, '..', 'sim_battle_adapter.js'), 'utf8');
  vm.runInContext(adapterSource, sandbox);
  const api = sandbox.makePsBattleMapApi({ grid: game.map, W: 20, H: 20 });
  const lane = tacticalResult.openLosLane;
  assert.strictEqual(api.hasLos(lane[0], lane[lane.length - 1]), true, 'runtime RTwP LOS sees open lane');
  const approach = tacticalResult.coveredApproach;
  assert.ok(approach.every(hex => Number.isFinite(api.moveCost(hex, hex))), 'covered approach is runtime-passable');
  assert.ok(approach.filter(hex => api.cover(hex) >= 0.15).length >= 13, 'runtime adapter sees covered approach');
}

reproducibilityTest();
seedCollisionRegressionTest();
manySeedsPropertyTest();
explicitSeedReplayTest();
directApplyFailureCleanupTest();
campaignSeedTest();
fallbackIntegrationTest();
battleFacadeCapacityAndAdapterTest();
console.log('map_nextgen.test.js: passed (1000 seeds)');
