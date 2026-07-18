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

// 基本テスト: P1 固定、従来の地形テーブルが生成されること
function testGenerateP1Fixed() {
  RuralV29Map.fixedVariant = 'p1';
  const game = { map: null };
  RuralV29Map.generate(game);

  // check: RuralV29Map.active = true
  assert.strictEqual(RuralV29Map.active, true, 'RuralV29Map.active should be true after generate()');

  // check: lastVariant.key === 'p1'
  assert.strictEqual(RuralV29Map.lastVariant.key, 'p1', 'lastVariant should be p1');

  // check: CityMap があれば active=false
  if (sandbox.window.CityMap) {
    assert.strictEqual(sandbox.window.CityMap.active, false, 'CityMap.active should be false');
  }

  // check: map is populated
  assert.ok(game.map && game.map.length === MAP_W, 'map should have MAP_W columns');
  for (let q = 0; q < MAP_W; q++) {
    assert.ok(game.map[q] && game.map[q].length === MAP_H, `map[${q}] should have MAP_H rows`);
  }

  // count non-VOID cells (id !== -1 で判定、cost=99のBLDGもカウント)
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

  // verify each cell from table (P1基準)
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

  console.log('✓ testGenerateP1Fixed passed');
}

// rot180 座標変換テスト
function testRot180Mapping() {
  // P1テーブルの全セル座標集合
  const p1Coords = new Set();
  for (const entry of RuralV29Map._terrain_table_base) {
    p1Coords.add(`${entry.q},${entry.r}`);
  }

  // rot180変換を適用
  const rotatedTable = RuralV29Map._rotateTable180([...RuralV29Map._terrain_table_base]);
  const rotatedCoords = new Set();
  for (const entry of rotatedTable) {
    rotatedCoords.add(`${entry.q},${entry.r}`);
  }

  // 変換後の座標がすべて盤面内(0<=q<MAP_W, 0<=r<MAP_H)に収まることを確認
  for (const entry of rotatedTable) {
    const { q, r } = entry;
    assert.ok(q >= 0 && q < MAP_W && r >= 0 && r < MAP_H,
      `rotated cell (${q},${r}) should be within map bounds [0..${MAP_W-1}] x [0..${MAP_H-1}]`);
  }

  // rot180(rot180(P1)) === P1
  const double180 = RuralV29Map._rotateTable180(rotatedTable);
  const doubleCoords = new Set();
  for (const entry of double180) {
    doubleCoords.add(`${entry.q},${entry.r}`);
  }
  assert.deepStrictEqual([...doubleCoords].sort(), [...p1Coords].sort(),
    'double 180° rotation should equal original');

  console.log('✓ testRot180Mapping passed');
}

// (9,7) が rot180 で (6,12) に写像され、cost=99 であることを確認
function testRot180SpecificCell() {
  RuralV29Map.fixedVariant = 'p2'; // p2は rot180=true
  const game = { map: null };
  RuralV29Map.generate(game);

  // (9,7) は P1で BLDG (cost=99)
  // rot180で (15-9, 19-7) = (6, 12)
  assert.strictEqual(game.map[6][12].cost, 99, 'rotated BLDG at (6,12) should have cost=99');
  assert.strictEqual(game.map[6][12].building, true, 'rotated BLDG should have building=true');

  console.log('✓ testRot180SpecificCell passed');
}

// P2 固定選択テスト
function testFixedVariantP2() {
  RuralV29Map.fixedVariant = 'p2';
  const game = { map: null };
  RuralV29Map.generate(game);

  assert.strictEqual(RuralV29Map.lastVariant.key, 'p2', 'lastVariant should be p2');
  assert.strictEqual(RuralV29Map.lastVariant.rot180, true, 'p2 should have rot180=true');

  // 30セルがあることを確認 (id !== -1 で判定、cost=99のBLDGもカウント)
  let nonVoidCount = 0;
  for (let q = 0; q < MAP_W; q++) {
    for (let r = 0; r < MAP_H; r++) {
      if (game.map[q][r].id !== -1) {
        nonVoidCount++;
      }
    }
  }

  assert.strictEqual(nonVoidCount, 30, `p2 variant should have 30 non-VOID cells, got ${nonVoidCount}`);

  console.log('✓ testFixedVariantP2 passed');
}

// ランダム選択テスト
// 注意: ロジックはvmサンドボックス内で動くため、テスト側の Math.random を
// 差し替えても届かない。スタブは必ず vm.runInContext でサンドボックス側に当てる。
function testRandomVariantSelection() {
  RuralV29Map.fixedVariant = null; // ランダム選択
  const originalReady = RuralV29Map.VARIANTS.map(v => v.ready);

  // サンドボックス内 Math.random を 0.0 に固定 → 先頭の ready バリアント
  vm.runInContext('globalThis.__origRandom = Math.random; Math.random = () => 0.0;', sandbox);
  RuralV29Map.generate({ map: null });
  const firstReady = RuralV29Map.VARIANTS.filter(v => v.ready)[0];
  assert.strictEqual(RuralV29Map.lastVariant.key, firstReady.key,
    'should select first ready variant when random is 0.0');

  // 0.999 に固定 → 末尾の ready バリアント
  vm.runInContext('Math.random = () => 0.999;', sandbox);
  RuralV29Map.generate({ map: null });
  const readyList = RuralV29Map.VARIANTS.filter(v => v.ready);
  assert.strictEqual(RuralV29Map.lastVariant.key, readyList[readyList.length - 1].key,
    'should select last ready variant when random is 0.999');
  vm.runInContext('Math.random = globalThis.__origRandom; delete globalThis.__origRandom;', sandbox);

  // ready=false のバリアントは選ばれない（p1のみreadyにして10回生成）
  RuralV29Map.VARIANTS.forEach((v, i) => { v.ready = (i === 0); });
  for (let i = 0; i < 10; i++) {
    RuralV29Map.generate({ map: null });
    assert.strictEqual(RuralV29Map.lastVariant.key, 'p1',
      'only ready variants may be selected');
  }

  // ready フラグを復元
  for (let i = 0; i < originalReady.length; i++) {
    RuralV29Map.VARIANTS[i].ready = originalReady[i];
  }

  console.log('✓ testRandomVariantSelection passed');
}

// 別ロケーション地形テーブルの検証
function testLocationTables() {
  // 盤面の正当なセル集合 = P1基準テーブルの座標集合
  const boardCoords = new Set();
  for (const e of RuralV29Map._terrain_table_base) boardCoords.add(`${e.q},${e.r}`);

  for (const key of ['loc_crossroad', 'loc_forest_farm', 'loc_shelled']) {
    RuralV29Map.fixedVariant = key;
    const game = { map: null };
    RuralV29Map.generate(game);
    assert.strictEqual(RuralV29Map.lastVariant.key, key, `lastVariant should be ${key}`);

    let nonVoid = 0, roads = 0, blocked = 0, playerZone = 0, enemyZone = 0;
    for (let q = 0; q < MAP_W; q++) {
      for (let r = 0; r < MAP_H; r++) {
        const t = game.map[q][r];
        if (t.id === -1) continue;
        nonVoid++;
        assert.ok(boardCoords.has(`${q},${r}`),
          `${key}: cell (${q},${r}) must be within the 30hex board footprint`);
        if (t.id === 3) roads++;
        if (t.cost >= 99) blocked++;
        if (t.cost < 99 && r >= 10) playerZone++;
        if (t.cost < 99 && r < 10) enemyZone++;
      }
    }
    assert.strictEqual(nonVoid, 30, `${key}: should have exactly 30 cells, got ${nonVoid}`);
    assert.ok(roads >= 3, `${key}: should have at least 3 road hexes`);
    assert.ok(blocked >= 1 && blocked <= 4, `${key}: blocked(BLDG) hexes should be 1..4, got ${blocked}`);
    assert.ok(playerZone >= 5, `${key}: player spawn zone (r>=10) needs walkable hexes`);
    assert.ok(enemyZone >= 5, `${key}: enemy spawn zone (r<10) needs walkable hexes`);
  }
  RuralV29Map.fixedVariant = null;
  console.log('✓ testLocationTables passed');
}

// メインテスト実行
testGenerateP1Fixed();
testRot180Mapping();
testRot180SpecificCell();
testFixedVariantP2();
testRandomVariantSelection();
testLocationTables();

console.log('✓ All tests passed');
