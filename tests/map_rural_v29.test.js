/** Run with: node tests/map_rural_v29.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const MAP_W = 20;
const MAP_H = 20;

const terrain = {
  VOID: { id: -1, name: 'void', cost: 99, cover: 0 },
  GRASS: { id: 1, name: 'grass', cost: 1, cover: 10 },
  FOREST: { id: 2, name: 'forest', cost: 2, cover: 25 },
  ROAD: { id: 3, name: 'road', cost: 1, cover: 35 },
};

const sandbox = {
  console,
  MAP_W,
  MAP_H,
  TERRAIN: terrain,
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// logic_map_rural_v29.js をロード
const source = fs.readFileSync(path.join(ROOT, 'logic_map_rural_v29.js'), 'utf8');
vm.runInContext(source, sandbox, { filename: 'logic_map_rural_v29.js' });

const RuralV29Map = sandbox.RuralV29Map;

// 検証用ヘルパー
function testGenerate() {
  const game = { map: null };
  RuralV29Map.generate(game);

  // check: RuralV29Map.active = true
  assert.strictEqual(RuralV29Map.active, true, 'RuralV29Map.active should be true after generate()');

  // check: CityMap があれば active=false
  if (sandbox.window.CityMap) {
    assert.strictEqual(sandbox.window.CityMap.active, false, 'CityMap.active should be false');
  }

  // check: map is populated
  assert.ok(game.map && game.map.length === MAP_W, 'map should have MAP_W columns');
  for (let q = 0; q < MAP_W; q++) {
    assert.ok(game.map[q] && game.map[q].length === MAP_H, `map[${q}] should have MAP_H rows`);
  }

  // count non-VOID cells
  let nonVoidCount = 0;
  const foundCells = new Set();
  for (let q = 0; q < MAP_W; q++) {
    for (let r = 0; r < MAP_H; r++) {
      const cell = game.map[q][r];
      if (cell && cell.id !== -1) {
        nonVoidCount++;
        foundCells.add(`${q},${r}`);
      }
    }
  }

  // check: exactly 30 non-VOID cells
  assert.strictEqual(nonVoidCount, 30, `should have exactly 30 non-VOID cells, got ${nonVoidCount}`);

  // verify each cell from table
  const expectedCells = {
    // r=7
    '7,7': { name: 'FOREST', cost: 2, cover: 25 },
    '8,7': { name: 'ROAD', cost: 1, cover: 35 },
    '9,7': { name: 'BLDG', cost: 99, cover: 0 },
    '10,7': { name: 'BLDG', cost: 99, cover: 0 },
    '11,7': { name: 'FOREST', cost: 2, cover: 25 },
    // r=8
    '6,8': { name: 'FOREST', cost: 2, cover: 25 },
    '7,8': { name: 'ROAD', cost: 1, cover: 35 },
    '8,8': { name: 'ROAD', cost: 1, cover: 35 },
    '9,8': { name: 'GRASS', cost: 1, cover: 10 },
    '10,8': { name: 'FIELD', cost: 2, cover: 15 },
    // r=9
    '6,9': { name: 'RUIN', cost: 2, cover: 40 },
    '7,9': { name: 'ROAD', cost: 1, cover: 35 },
    '8,9': { name: 'ROAD', cost: 1, cover: 35 },
    '9,9': { name: 'GRASS', cost: 1, cover: 10 },
    '10,9': { name: 'FOREST', cost: 2, cover: 25 },
    // r=10
    '5,10': { name: 'GRASS', cost: 1, cover: 10 },
    '6,10': { name: 'GRASS', cost: 1, cover: 10 },
    '7,10': { name: 'ROAD', cost: 1, cover: 35 },
    '8,10': { name: 'FIELD', cost: 2, cover: 15 },
    '9,10': { name: 'FIELD', cost: 2, cover: 15 },
    // r=11
    '5,11': { name: 'GRASS', cost: 1, cover: 10 },
    '6,11': { name: 'ROAD', cost: 1, cover: 35 },
    '7,11': { name: 'FIELD', cost: 2, cover: 15 },
    '8,11': { name: 'FIELD', cost: 2, cover: 15 },
    '9,11': { name: 'FOREST', cost: 2, cover: 25 },
    // r=12
    '4,12': { name: 'ROAD', cost: 1, cover: 35 },
    '5,12': { name: 'GRASS', cost: 1, cover: 10 },
    '6,12': { name: 'FOREST', cost: 2, cover: 25 },
    '7,12': { name: 'FIELD', cost: 2, cover: 15 },
    '8,12': { name: 'FIELD', cost: 2, cover: 15 },
  };

  for (const [key, expected] of Object.entries(expectedCells)) {
    const [q, r] = key.split(',').map(Number);
    const cell = game.map[q][r];
    assert.ok(cell, `cell at ${key} should exist`);
    assert.strictEqual(cell.cost, expected.cost, `cell at ${key} should have cost=${expected.cost}, got ${cell.cost}`);
    assert.strictEqual(cell.cover, expected.cover, `cell at ${key} should have cover=${expected.cover}, got ${cell.cover}`);
  }

  // check: BLDG cells have tankBlocked property
  assert.strictEqual(game.map[9][7].tankBlocked, true, 'BLDG at (9,7) should have tankBlocked=true');
  assert.strictEqual(game.map[10][7].tankBlocked, true, 'BLDG at (10,7) should have tankBlocked=true');

  // check: all out-of-range cells are VOID with cost=99
  for (let q = 0; q < MAP_W; q++) {
    for (let r = 0; r < MAP_H; r++) {
      if (!foundCells.has(`${q},${r}`)) {
        const cell = game.map[q][r];
        assert.strictEqual(cell.cost, 99, `VOID cell at (${q},${r}) should have cost=99, got ${cell.cost}`);
      }
    }
  }

  // check: at least one non-VOID cell in r>=10 (player spawn zone)
  let hasPlayerZone = false;
  for (let q = 0; q < MAP_W; q++) {
    for (let r = 10; r < MAP_H; r++) {
      if (game.map[q][r].cost < 99) {
        hasPlayerZone = true;
        break;
      }
    }
    if (hasPlayerZone) break;
  }
  assert.ok(hasPlayerZone, 'should have at least one walkable hex in r>=10 (player spawn zone)');

  // check: at least one non-VOID cell in r<10 (enemy spawn zone)
  let hasEnemyZone = false;
  for (let q = 0; q < MAP_W; q++) {
    for (let r = 0; r < 10; r++) {
      if (game.map[q][r].cost < 99) {
        hasEnemyZone = true;
        break;
      }
    }
    if (hasEnemyZone) break;
  }
  assert.ok(hasEnemyZone, 'should have at least one walkable hex in r<10 (enemy spawn zone)');

  console.log('✓ All tests passed');
}

testGenerate();
