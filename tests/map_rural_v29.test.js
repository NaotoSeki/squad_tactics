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

// PS正本キャンバスのレジストリ(生成物)を先にロード。本番の index.html と同じ順序。
// これが無いと psNative バリアントは base テーブルへフォールバックしてしまう。
const registryPath = path.join(ROOT, 'asset/environment/maps/ps_battlefields.js');
if (fs.existsSync(registryPath)) {
  vm.runInContext(fs.readFileSync(registryPath, 'utf8'), sandbox, { filename: 'ps_battlefields.js' });
}

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

  // PS正本キャンバス(psNative)も同じ盤面契約を満たさねばならない。地形テーブルが
  // 手描きではなく配置台帳からの機械導出なので、閾値変更で盤面が壊れても
  // ここで捕まる(BLDGだらけで分断、道が消える等)。
  const locationKeys = ['loc_crossroad', 'loc_forest_farm', 'loc_shelled', 'loc_church_square'];
  // 生成済みPSキャンバスは generate() 時に自動登録される。テストの実行順に依存
  // させないよう、ここで明示的に取り込んでから検証対象へ加える。
  if (typeof RuralV29Map._registerPsBattlefields === 'function') {
    RuralV29Map._registerPsBattlefields();
  }
  if (sandbox.PS_BATTLEFIELDS) {
    for (const v of RuralV29Map.VARIANTS) {
      if (v.psNative && sandbox.PS_BATTLEFIELDS[v.psNative]) locationKeys.push(v.key);
    }
  }

  for (const key of locationKeys) {
    RuralV29Map.fixedVariant = key;
    const game = { map: null };
    RuralV29Map.generate(game);
    assert.strictEqual(RuralV29Map.lastVariant.key, key, `lastVariant should be ${key}`);

    const psBattlefield = sandbox.PS_BATTLEFIELDS && sandbox.PS_BATTLEFIELDS[key];
    const expectedCoords = psBattlefield ? new Set(
      psBattlefield.rows.flatMap(row => row[2].map((_, i) => `${row[1] + i},${row[0]}`))
    ) : boardCoords;

    let nonVoid = 0, roads = 0, blocked = 0, playerZone = 0, enemyZone = 0;
    for (let q = 0; q < MAP_W; q++) {
      for (let r = 0; r < MAP_H; r++) {
        const t = game.map[q][r];
        if (t.id === -1) continue;
        nonVoid++;
        assert.ok(expectedCoords.has(`${q},${r}`),
          `${key}: cell (${q},${r}) must be within its declared board footprint`);
        if (t.id === 3) roads++;
        if (t.cost >= 99) blocked++;
        if (t.cost < 99 && r >= 10) playerZone++;
        if (t.cost < 99 && r < 10) enemyZone++;
      }
    }
    assert.strictEqual(nonVoid, expectedCoords.size,
      `${key}: should have exactly ${expectedCoords.size} cells, got ${nonVoid}`);
    assert.ok(roads >= 3, `${key}: should have at least 3 road hexes`);
    // loc_church_squareは密な市街ブロック(教会+住宅2棟)につきBLDGが多め。他ロケーションは1-2。
    const blockedMax = Math.max(10, Math.ceil(expectedCoords.size * 0.35));
    assert.ok(blocked >= 1 && blocked <= blockedMax,
      `${key}: blocked(BLDG) hexes should be 1..${blockedMax}, got ${blocked}`);
    assert.ok(playerZone >= 5, `${key}: player spawn zone (r>=10) needs walkable hexes`);
    assert.ok(enemyZone >= 5, `${key}: enemy spawn zone (r<10) needs walkable hexes`);

    // 南北連結性: r7側とr12側の歩行可能hexが、歩行可能hexだけを辿って到達可能であること
    // (建物ブロックで盤面が完全分断されていないことを保証)
    const passable = (q, r) => {
      const t = game.map[q] && game.map[q][r];
      return !!t && t.cost < 99;
    };
    const start = [];
    for (let q = 0; q < MAP_W; q++) if (passable(q, 7)) start.push([q, 7]);
    assert.ok(start.length > 0, `${key}: r=7 row needs at least one walkable hex`);
    const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const visited = new Set(start.map(([q, r]) => `${q},${r}`));
    const queue = [...start];
    while (queue.length) {
      const [q, r] = queue.pop();
      for (const [dq, dr] of DIRS) {
        const nq = q + dq, nr = r + dr, k = `${nq},${nr}`;
        if (visited.has(k) || !passable(nq, nr)) continue;
        visited.add(k);
        queue.push([nq, nr]);
      }
    }
    let reachedSouth = false;
    for (let q = 0; q < MAP_W; q++) if (visited.has(`${q},12`)) reachedSouth = true;
    assert.ok(reachedSouth, `${key}: r=7 side must be able to reach r=12 side via walkable hexes only`);

    // 全walkable hexが単一の連結成分であること(孤立ポケットを許さない)
    let totalWalkable = 0;
    for (let q = 0; q < MAP_W; q++) {
      for (let r = 0; r < MAP_H; r++) {
        if (passable(q, r)) totalWalkable++;
      }
    }
    assert.strictEqual(visited.size, totalWalkable,
      `${key}: all walkable hexes must form a single connected component (found isolated pocket: visited=${visited.size} vs total=${totalWalkable})`);
  }
  RuralV29Map.fixedVariant = null;
  console.log('✓ testLocationTables passed');
}

// KIT_PIECES の継ぎ目契約テスト: r9のq=7がROAD、r10のq=7もROAD
function testKitSeamContract() {
  const KIT_PIECES = RuralV29Map.KIT_PIECES;

  for (const northPiece of KIT_PIECES.north) {
    // r9(最後の行)のq=7がROADであることを確認
    const r9Row = northPiece.rows.find(([r]) => r === 9);
    assert.ok(r9Row, `north piece '${northPiece.key}' must have r=9 row`);
    const [r, q0, bases] = r9Row;
    const q7Index = 7 - q0;
    assert.ok(q7Index >= 0 && q7Index < bases.length,
      `north piece '${northPiece.key}' r=9 must include q=7 (found q0=${q0}, len=${bases.length})`);
    assert.strictEqual(bases[q7Index], 'ROAD',
      `north piece '${northPiece.key}' r=9 q=7 must be ROAD (contract: r9/r10 seam), got ${bases[q7Index]}`);
  }

  for (const southPiece of KIT_PIECES.south) {
    // r10(最初の行)のq=7がROADであることを確認
    const r10Row = southPiece.rows.find(([r]) => r === 10);
    assert.ok(r10Row, `south piece '${southPiece.key}' must have r=10 row`);
    const [r, q0, bases] = r10Row;
    const q7Index = 7 - q0;
    assert.ok(q7Index >= 0 && q7Index < bases.length,
      `south piece '${southPiece.key}' r=10 must include q=7 (found q0=${q0}, len=${bases.length})`);
    assert.strictEqual(bases[q7Index], 'ROAD',
      `south piece '${southPiece.key}' r=10 q=7 must be ROAD (contract: r9/r10 seam), got ${bases[q7Index]}`);
  }

  console.log('✓ testKitSeamContract passed');
}

// kit モード全組み合わせの接続性テスト
function testKitAllCombinationsConnectivity() {
  const KIT_PIECES = RuralV29Map.KIT_PIECES;
  const northPieces = KIT_PIECES.north;
  const southPieces = KIT_PIECES.south;

  // 各north×south組み合わせについて、結合テーブルの接続性を確認
  for (const northPiece of northPieces) {
    for (const southPiece of southPieces) {
      const allRows = [...northPiece.rows, ...southPiece.rows];
      const terrainTable = RuralV29Map._rowsToTable(allRows);

      // 30セルであることを確認
      assert.strictEqual(terrainTable.length, 30,
        `kit (${northPiece.key}+${southPiece.key}): should have exactly 30 cells, got ${terrainTable.length}`);

      // game.map を構築（テスト用）
      const game = { map: [] };
      for (let q = 0; q < MAP_W; q++) {
        game.map[q] = [];
        for (let r = 0; r < MAP_H; r++) {
          game.map[q][r] = sandbox.TERRAIN.VOID;
        }
      }

      // 地形を配置
      for (const entry of terrainTable) {
        const { q, r, base } = entry;
        if (q < 0 || q >= MAP_W || r < 0 || r >= MAP_H) continue;
        let terrainDef;
        if (base === 'FIELD') terrainDef = RuralV29Map.FIELD;
        else if (base === 'RUIN') terrainDef = RuralV29Map.RUIN;
        else if (base === 'BLDG') terrainDef = RuralV29Map.BLDG;
        else terrainDef = terrain[base];
        game.map[q][r] = { ...terrainDef };
      }

      // 接続性チェック: 全walkable hexが単一連結成分
      const passable = (q, r) => {
        const t = game.map[q] && game.map[q][r];
        return !!t && t.cost < 99;
      };

      const start = [];
      for (let q = 0; q < MAP_W; q++) if (passable(q, 7)) start.push([q, 7]);
      assert.ok(start.length > 0,
        `kit (${northPiece.key}+${southPiece.key}): r=7 row needs at least one walkable hex`);

      const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
      const visited = new Set(start.map(([q, r]) => `${q},${r}`));
      const queue = [...start];
      while (queue.length) {
        const [q, r] = queue.pop();
        for (const [dq, dr] of DIRS) {
          const nq = q + dq, nr = r + dr, k = `${nq},${nr}`;
          if (visited.has(k) || !passable(nq, nr)) continue;
          visited.add(k);
          queue.push([nq, nr]);
        }
      }

      // 全walkable hexが訪問されたことを確認（孤立なし）
      let totalWalkable = 0;
      for (let q = 0; q < MAP_W; q++) {
        for (let r = 0; r < MAP_H; r++) {
          if (passable(q, r)) totalWalkable++;
        }
      }
      assert.strictEqual(visited.size, totalWalkable,
        `kit (${northPiece.key}+${southPiece.key}): all walkable hexes must form single connected component ` +
        `(visited=${visited.size} vs total=${totalWalkable})`);
    }
  }

  console.log('✓ testKitAllCombinationsConnectivity passed');
}

// _selectKitPieces フォールバックテスト
function testSelectKitPiecesFallback() {
  const originalNorthReady = RuralV29Map.KIT_PIECES.north.map(p => p.ready);
  const originalSouthReady = RuralV29Map.KIT_PIECES.south.map(p => p.ready);

  // ケース1: north ready=0, south ready≥1 → null が返される
  RuralV29Map.KIT_PIECES.north.forEach(p => { p.ready = false; });
  RuralV29Map.KIT_PIECES.south.forEach((p, i) => { p.ready = (i === 0); });
  assert.strictEqual(RuralV29Map._selectKitPieces(), null,
    'should return null when no ready north pieces');

  // ケース2: north ready≥1, south ready=0 → null が返される
  RuralV29Map.KIT_PIECES.north.forEach((p, i) => { p.ready = (i === 0); });
  RuralV29Map.KIT_PIECES.south.forEach(p => { p.ready = false; });
  assert.strictEqual(RuralV29Map._selectKitPieces(), null,
    'should return null when no ready south pieces');

  // ケース3: 両方ready≥1 → 選択される
  RuralV29Map.KIT_PIECES.north.forEach((p, i) => { p.ready = (i === 0); });
  RuralV29Map.KIT_PIECES.south.forEach((p, i) => { p.ready = (i === 0); });
  const result = RuralV29Map._selectKitPieces();
  assert.ok(result, 'should return { north, south } when both have ready pieces');
  assert.ok(result.north && result.south, 'result should have north and south properties');

  // ready フラグを復元
  for (let i = 0; i < originalNorthReady.length; i++) {
    RuralV29Map.KIT_PIECES.north[i].ready = originalNorthReady[i];
  }
  for (let i = 0; i < originalSouthReady.length; i++) {
    RuralV29Map.KIT_PIECES.south[i].ready = originalSouthReady[i];
  }

  console.log('✓ testSelectKitPiecesFallback passed');
}

// PS背景レジストリの任意pixelRatioが自動登録バリアントへ伝播すること。
// 未指定エントリにはプロパティを足さず、従来の1x契約を保つ。
function testPsRegistryPixelRatioPropagation() {
  const startLength = RuralV29Map.VARIANTS.length;
  const rows = [[7, 7, ['GRASS', 'GRASS', 'GRASS', 'GRASS', 'GRASS']]];
  sandbox.PS_BATTLEFIELDS.ps_ratio_legacy_probe = {
    image: 'legacy_probe.png',
    rows,
    projection: { scale: 0.84, topLeftX: 0, topLeftY: 0 }
  };
  sandbox.PS_BATTLEFIELDS.ps_ratio_hd_probe = {
    image: 'hd_probe.png',
    pixelRatio: 2,
    rows,
    projection: { scale: 0.84, topLeftX: 0, topLeftY: 0 }
  };

  RuralV29Map._registerPsBattlefields();
  const legacy = RuralV29Map.VARIANTS.find(v => v.key === 'ps_ratio_legacy_probe');
  const hd = RuralV29Map.VARIANTS.find(v => v.key === 'ps_ratio_hd_probe');
  assert.ok(legacy, 'legacy registry entry should be registered');
  assert.ok(hd, 'HD registry entry should be registered');
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(legacy, 'pixelRatio'),
    false,
    'missing pixelRatio must remain omitted'
  );
  assert.strictEqual(hd.pixelRatio, 2, 'pixelRatio 2 should propagate to the background variant');

  RuralV29Map.VARIANTS.splice(startLength);
  delete sandbox.PS_BATTLEFIELDS.ps_ratio_legacy_probe;
  delete sandbox.PS_BATTLEFIELDS.ps_ratio_hd_probe;
  console.log('✓ testPsRegistryPixelRatioPropagation passed');
}

// メインテスト実行
testGenerateP1Fixed();
testRot180Mapping();
testRot180SpecificCell();
testFixedVariantP2();
testRandomVariantSelection();
testLocationTables();
testKitSeamContract();
testKitAllCombinationsConnectivity();
testSelectKitPiecesFallback();
testPsRegistryPixelRatioPropagation();

console.log('✓ All tests passed');
