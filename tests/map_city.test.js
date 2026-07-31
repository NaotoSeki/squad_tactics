/** Run with: node tests/map_city.test.js (default: 10,000 deterministic seeds). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const TILE_DIR = path.join(ROOT, 'asset', 'environment', 'hex_tiles_v7');
const MAP_W = 20;
const MAP_H = 20;
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const seedCount = Number(process.env.MAP_CITY_SEEDS || 10000);
const seedStart = Number(process.env.MAP_CITY_START || 0);
assert.ok(Number.isInteger(seedCount) && seedCount > 0, 'MAP_CITY_SEEDS must be a positive integer');
assert.ok(Number.isInteger(seedStart) && seedStart >= 0, 'MAP_CITY_START must be a non-negative integer');

const terrain = {
  VOID: { id: -1, name: 'void', cost: 99, cover: 0 },
  TOWN: { id: 4, name: 'town', cost: 2, cover: 30 },
  DIRT: { id: 1, name: 'dirt', cost: 2, cover: 0 },
  GRASS: { id: 0, name: 'grass', cost: 1, cover: 0 },
  ROAD: { id: 3, name: 'road', cost: 1, cover: 0 },
};

const sandbox = {
  console,
  MAP_W,
  MAP_H,
  TERRAIN: terrain,
  URLSearchParams,
  location: { search: '' },
  hexDist(a, b) {
    const dq = a.q - b.q, dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
const source = fs.readFileSync(path.join(ROOT, 'logic_map_city.js'), 'utf8');
vm.runInContext(source, sandbox, { filename: 'logic_map_city.js' });
const CityMap = sandbox.CityMap;
const assetNames = new Set(fs.readdirSync(TILE_DIR).filter(name => name.endsWith('.png')));
const key = (q, r) => q + ',' + r;

function requireAsset(file, seed, where) {
  assert.ok(assetNames.has(file), `seed ${seed}: missing asset ${file} (${where})`);
}

function topologyMask(q, r, member, outsideIncluded, invertMembership = false) {
  const out = new Set();
  DIRS.forEach(([dq, dr], d) => {
    const nq = q + dq, nr = r + dr;
    const outside = nq < 0 || nr < 0 || nq >= MAP_W || nr >= MAP_H;
    const included = outside ? outsideIncluded
      : (invertMembership ? !member.has(key(nq, nr)) : member.has(key(nq, nr)));
    if (included) out.add(d);
  });
  return out;
}

function components(grid, predicate) {
  const eligible = new Set();
  for (const cell of grid.values()) if (predicate(cell)) eligible.add(key(cell.q, cell.r));
  const unseen = new Set(eligible), result = [];
  while (unseen.size) {
    const first = unseen.values().next().value;
    unseen.delete(first);
    const component = new Set([first]), queue = [first];
    for (let i = 0; i < queue.length; i++) {
      const [q, r] = queue[i].split(',').map(Number);
      for (const [dq, dr] of DIRS) {
        const nk = key(q + dq, r + dr);
        if (!unseen.has(nk)) continue;
        unseen.delete(nk); component.add(nk); queue.push(nk);
      }
    }
    result.push(component);
  }
  result.sort((a, b) => b.size - a.size);
  return result;
}

function signature(grid) {
  return [...grid.values()].map(c => [
    c.q, c.r, c.ground, c.gfile, c.open, c.scar, c.green, c.void,
    c._defense || '', c.flat.join('|'), c.over.join('|'),
    c._fullVar ? `${c._fullVar.fam}:${c._fullVar.v}` : '',
  ].join('~')).join('\n');
}

function validateGeneratedAssets(grid, seed) {
  const nvar = { straight: 4, corner: 3, tee: 2, cross: 2 };
  for (const cell of grid.values()) {
    if (!cell.void) requireAsset(CityMap.groundFile(cell, seed), seed, key(cell.q, cell.r) + ' ground');
    for (const file of cell.flat) requireAsset(file, seed, key(cell.q, cell.r) + ' flat');
    for (const file of cell.over) {
      requireAsset(file, seed, key(cell.q, cell.r) + ' over');
      const m = file.match(CityMap.BLDG_RE);
      if (m) for (let damage = 0; damage <= 2; damage++)
        requireAsset(`${m[1]}_d${damage}_rot${m[3]}.png`, seed, 'building damage family');
    }
    const road = (cell.gfile || '').match(CityMap.ROAD_RE);
    if (road) for (let damage = 1; damage <= 2; damage++) {
      const variant = CityMap.h32(seed, cell.q, cell.r, 'rdv', damage - 1) % nvar[road[1]];
      requireAsset(`road_${road[1]}_v${variant}_d${damage}_rot${road[4]}.png`, seed, 'road damage family');
    }
  }
}

function validateSeed(seed, stats) {
  const grid = CityMap.genCity(seed, MAP_W, MAP_H);
  assert.strictEqual(grid.size, MAP_W * MAP_H, `seed ${seed}: wrong grid size`);
  assert.ok(CityMap.lastDiagnostics, `seed ${seed}: diagnostics missing`);
  for (const family of ['green', 'scar', 'road', 'roadRevisit'])
    assert.strictEqual(CityMap.lastDiagnostics[family].length, 0,
      `seed ${seed}: ${family} diagnostics ${JSON.stringify(CityMap.lastDiagnostics[family])}`);

  const core = new Set(), scars = new Set();
  for (const cell of grid.values()) {
    if (!cell.green && !cell.void) core.add(key(cell.q, cell.r));
    if (cell.scar) scars.add(key(cell.q, cell.r));
    if (cell.green) stats.greenCells++;
    if (cell.void) stats.voidCells++;
    if (cell.ground === 'road') stats.roadCells++;
    if (cell.gfile && /^cpair_v2_/.test(cell.gfile)) stats.cpairV2++;
    if (cell.gfile && /^cpair_v3_/.test(cell.gfile)) stats.cpairV3++;
    if (cell._defense) stats.defenseCells[cell._defense]++;
  }
  if ([...grid.values()].some(c => c.green)) stats.mapsWithGreen++;
  if ([...grid.values()].some(c => c.void)) stats.mapsWithVoid++;
  for (const kind of Object.keys(stats.defenseMaps))
    if ([...grid.values()].some(c => c._defense === kind)) stats.defenseMaps[kind]++;

  for (const cell of grid.values()) if (cell.green) {
    const mask = topologyMask(cell.q, cell.r, core, true, true);
    assert.ok(mask.size && CityMap.scarResolve(mask),
      `seed ${seed}: unresolved green at ${cell.q},${cell.r} mask=${[...mask]}`);
  }
  for (const cell of grid.values()) if (cell.scar && cell.ground !== 'pair') {
    const mask = topologyMask(cell.q, cell.r, scars, false);
    assert.ok(CityMap.scarResolve(mask),
      `seed ${seed}: unresolved scar at ${cell.q},${cell.r} mask=${[...mask]}`);
  }

  for (const cell of grid.values()) if (cell._fullVar) {
    for (const d of [0, 1, 2]) {
      const [dq, dr] = DIRS[d], neighbor = grid.get(key(cell.q + dq, cell.r + dr));
      if (!neighbor || !neighbor._fullVar) continue;
      assert.ok(cell._fullVar.fam !== neighbor._fullVar.fam || cell._fullVar.v !== neighbor._fullVar.v,
        `seed ${seed}: adjacent repeated ${cell._fullVar.fam} v${cell._fullVar.v} at ${cell.q},${cell.r}`);
    }
  }

  const terrainByKey = new Map();
  for (const cell of grid.values()) terrainByKey.set(key(cell.q, cell.r), CityMap.terrainForCell(cell));
  const infantry = components(grid, c => terrainByKey.get(key(c.q, c.r)).cost < 99);
  const infantryCount = [...terrainByKey.values()].filter(t => t.cost < 99).length;
  assert.ok(infantry.length === 1 && infantry[0].size === infantryCount,
    `seed ${seed}: infantry passable area split into ${infantry.length} components`);

  const vehicle = components(grid, c => {
    const t = terrainByKey.get(key(c.q, c.r));
    return t.cost < 99 && !t.tankBlocked;
  });
  assert.ok(vehicle.length, `seed ${seed}: no vehicle-passable component`);
  const largest = vehicle[0];
  const reachesNorth = [...largest].some(k => Number(k.split(',')[1]) < MAP_H / 2);
  const reachesSouth = [...largest].some(k => Number(k.split(',')[1]) >= MAP_H / 2);
  if (!reachesNorth || !reachesSouth) stats.vehicleSplitSeeds.push(seed);

  validateGeneratedAssets(grid, seed);
  return grid;
}

for (let v = 0; v < 4; v++) for (const side of ['a', 'b']) for (const rot of [0, 60, 120])
  requireAsset(`cpair_v${v}_${side}_rot${rot}.png`, 'catalog', 'cpair catalog');
for (let v = 0; v < 4; v++) requireAsset(`gnd_crater_v${v}.png`, 'catalog', 'crater damage family');

const stats = {
  greenCells: 0,
  voidCells: 0,
  roadCells: 0,
  mapsWithGreen: 0,
  mapsWithVoid: 0,
  cpairV2: 0,
  cpairV3: 0,
  defenseCells: { trench: 0, wire: 0, foxhole: 0, bocage: 0 },
  defenseMaps: { trench: 0, wire: 0, foxhole: 0, bocage: 0 },
  vehicleSplitSeeds: [],
};

const started = Date.now();
for (let offset = 0; offset < seedCount; offset++) validateSeed(seedStart + offset, stats);

const seed2554 = validateSeed(2554, {
  greenCells: 0, voidCells: 0, roadCells: 0, mapsWithGreen: 0, mapsWithVoid: 0,
  cpairV2: 0, cpairV3: 0,
  defenseCells: { trench: 0, wire: 0, foxhole: 0, bocage: 0 },
  defenseMaps: { trench: 0, wire: 0, foxhole: 0, bocage: 0 },
  vehicleSplitSeeds: [],
});
assert.ok([...seed2554.values()].some(c => c.ground === 'road'), 'seed 2554: road path was not painted');
assert.strictEqual(CityMap.lastDiagnostics.roadRevisit.length, 0, 'seed 2554: road path revisited a coordinate');

for (const seed of [0, 1, 42, 2554, 9999]) {
  const a = signature(CityMap.genCity(seed, MAP_W, MAP_H));
  const b = signature(CityMap.genCity(seed, MAP_W, MAP_H));
  assert.strictEqual(a, b, `seed ${seed}: generation is not deterministic`);
}

sandbox.location.search = '?seed=2554';
CityMap.fixedSeed = null;
const game = {};
assert.strictEqual(CityMap.generate(game), 2554, 'URL ?seed= must select the debug seed');
assert.strictEqual(game.map.length, MAP_W, 'debug-seed generate did not populate game.map');
sandbox.location.search = '';

const minDefenseMaps = Math.max(1, Math.floor(seedCount * 0.10));
for (const kind of Object.keys(stats.defenseMaps))
  assert.ok(stats.defenseMaps[kind] >= minDefenseMaps,
    `${kind} occurrence is trivial: ${stats.defenseMaps[kind]}/${seedCount}`);
assert.ok(stats.mapsWithGreen >= Math.max(1, Math.floor(seedCount * 0.80)),
  `green fringe occurrence too low: ${stats.mapsWithGreen}/${seedCount}`);
assert.ok(stats.mapsWithVoid >= Math.max(1, Math.floor(seedCount * 0.10)),
  `VOID occurrence too low: ${stats.mapsWithVoid}/${seedCount}`);
assert.ok(stats.greenCells / seedCount >= 20, `green average too low: ${stats.greenCells / seedCount}`);
assert.ok(stats.voidCells / seedCount >= 3, `VOID average too low: ${stats.voidCells / seedCount}`);
assert.ok(stats.cpairV2 > 0 && stats.cpairV3 > 0,
  `cpair v2/v3 were not both selected: v2=${stats.cpairV2}, v3=${stats.cpairV3}`);
assert.deepStrictEqual(stats.vehicleSplitSeeds, [],
  `largest vehicle component misses a map half for seeds: ${stats.vehicleSplitSeeds.slice(0, 25).join(',')}`);

const elapsedMs = Date.now() - started;
console.log(JSON.stringify({
  start: seedStart,
  seeds: seedCount,
  elapsedMs,
  pngCatalog: assetNames.size,
  average: {
    green: +(stats.greenCells / seedCount).toFixed(2),
    void: +(stats.voidCells / seedCount).toFixed(2),
    road: +(stats.roadCells / seedCount).toFixed(2),
  },
  defenseMaps: stats.defenseMaps,
  defenseCells: stats.defenseCells,
  cpair: { v2: stats.cpairV2, v3: stats.cpairV3 },
}, null, 2));
console.log('map_city tests passed');