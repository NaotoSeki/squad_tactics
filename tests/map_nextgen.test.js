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

function manySeedsPropertyTest() {
  const signatures = new Set();
  for (let seed = 0; seed < 1000; seed++) {
    const result = Generator.create(seed);
    assert.ok(result, `seed ${seed} must produce a valid battlefield`);
    assert.ok(result.validation.ok, `seed ${seed}: ${result.validation.errors.join(',')}`);
    assert.ok(result.validation.metrics.vehicleArea >= 288, `seed ${seed}: vehicle area`);
    assert.ok(result.validation.metrics.massRouteRuns >= 2, `seed ${seed}: mass routes`);
    assert.ok(result.spawns.player.length >= 12 && result.spawns.enemy.length >= 12);
    assert.ok(result.enemyInitial.every(p => p.r < 10), `seed ${seed}: enemy placement side`);
    signatures.add(signature(result));
  }
  assert.ok(signatures.size > 990, 'seeds should yield meaningfully different maps');
}

function noRecentRepeatTest() {
  Generator.recentSeeds.length = 0;
  const gameA = {}, gameB = {};
  assert.strictEqual(Generator.apply(gameA, 'same-run-seed'), true);
  assert.strictEqual(Generator.apply(gameB, 'same-run-seed'), true);
  assert.notStrictEqual(gameA.mapScenario.seed, gameB.mapScenario.seed);
  assert.notStrictEqual(signature({ map: gameA.map }), signature({ map: gameB.map }));
}

function fallbackIntegrationTest() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'logic_map.js'), 'utf8');
  let staticCalls = 0;
  const sandbox = {
    console, MAP_W: 2, MAP_H: 2,
    TERRAIN: { VOID: { id: -1, cost: 99 } },
    window: {
      NextGenMapGenerator: { enabled: true, active: true, apply: () => false },
      RuralV29Map: { enabled: true, active: false, generate: game => { staticCalls++; game.map = [['static']]; } },
      CityMap: { enabled: false, active: false }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source + '\n;this.MapSystemForTest=MapSystem;', sandbox);
  const game = {};
  new sandbox.MapSystemForTest(game).generate();
  assert.strictEqual(staticCalls, 1);
  assert.strictEqual(game.map[0][0], 'static');
}

reproducibilityTest();
manySeedsPropertyTest();
noRecentRepeatTest();
fallbackIntegrationTest();
console.log('map_nextgen.test.js: passed (1000 seeds)');
