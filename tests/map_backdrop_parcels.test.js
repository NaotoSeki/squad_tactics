/** Run with: node tests/map_backdrop_parcels.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const WIDTH = 80;
const HEIGHT = 80;
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const FIELD_RE = /^fieldrows_v[0-3]_rot(?:0|60|120)\.png$/;
const VEG_RE = /^veg_v[3-5]_rot0\.png$/;

function stableH32(...parts) {
  let h = 2166136261;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  return h >>> 0;
}

function loadRenderer(seed) {
  const CityMap = {
    lastSeed: seed,
    DIRS,
    BLDG_RE: /^bldg_/,
    h32: stableH32,
    groundFile: () => 'gnd_grass_v0.png',
  };
  const box = {
    window: { CityMap, gameLogic: {} },
    console,
    MAP_W: WIDTH,
    MAP_H: HEIGHT,
    HEX_SIZE: 128,
    Renderer: { hexToPx: (q, r) => ({ x: q, y: r }) },
    document: {},
  };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'phaser_terrain_v7.js'), 'utf8'), box);
  return { renderer: box.window.TerrainRenderV7, CityMap };
}

function voidMap() {
  return Array.from({ length: WIDTH }, () =>
    Array.from({ length: HEIGHT }, () => ({ city: { void: true } })));
}

function snapshot(seed) {
  const { renderer, CityMap } = loadRenderer(seed);
  const items = [];
  renderer._forEachBackdrop(voidMap(), (item) => {
    items.push({
      q: item.q,
      r: item.r,
      outside: item.outside,
      flat: Array.from(item.flat),
      tall: Array.from(item.tall),
    });
  });
  return { items, CityMap };
}

function fieldFile(item) {
  return item.flat.find((file) => FIELD_RE.test(file));
}

function fieldComponents(items) {
  const fieldKeys = new Set(items.filter(fieldFile).map((item) => `${item.q},${item.r}`));
  const sizes = [];
  while (fieldKeys.size) {
    const start = fieldKeys.values().next().value;
    fieldKeys.delete(start);
    const queue = [start];
    let size = 0;
    for (let i = 0; i < queue.length; i++) {
      const [q, r] = queue[i].split(',').map(Number);
      size++;
      for (const [dq, dr] of DIRS) {
        const key = `${q + dq},${r + dr}`;
        if (!fieldKeys.delete(key)) continue;
        queue.push(key);
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

function parcelCoherenceTest() {
  const seed = 918273;
  const { items, CityMap } = snapshot(seed);
  const byParcel = new Map();
  let fieldHexes = 0;
  let vegHexes = 0;

  for (const item of items) {
    for (const file of item.flat) {
      assert.ok(FIELD_RE.test(file) || VEG_RE.test(file), `unexpected backdrop asset: ${file}`);
    }
    const px = Math.floor(item.q / 4);
    const pz = Math.floor(item.r / 4);
    const parcelKey = `${px},${pz}`;
    const file = fieldFile(item);
    if (file) {
      fieldHexes++;
      if (!byParcel.has(parcelKey)) byParcel.set(parcelKey, new Set());
      byParcel.get(parcelKey).add(file);
    }
    const veg = item.flat.find((asset) => VEG_RE.test(asset));
    if (veg) {
      vegHexes++;
      assert.ok(CityMap.h32(seed, px, pz, 'backdrop-field') % 100 >= 60,
        'vegetation must stay in a non-field parcel');
    }
  }

  assert.ok(fieldHexes > 1000, 'expected a substantial field backdrop');
  assert.ok(vegHexes > 100, 'expected macro vegetation clusters');
  for (const [parcel, files] of byParcel) {
    assert.strictEqual(files.size, 1, `field file changed inside parcel ${parcel}`);
  }

  let candidates = 0;
  let filled = 0;
  for (let px = 0; px < WIDTH / 4; px++) {
    for (let pz = 0; pz < HEIGHT / 4; pz++) {
      if (CityMap.h32(seed, px, pz, 'backdrop-field') % 100 >= 60) continue;
      candidates++;
      const count = items.filter((item) =>
        Math.floor(item.q / 4) === px && Math.floor(item.r / 4) === pz && fieldFile(item)).length;
      assert.ok(count >= 8 && count <= 16, `field fill is not parcel-like at ${px},${pz}: ${count}`);
      filled += count;
    }
  }
  const candidateRatio = candidates / ((WIDTH / 4) * (HEIGHT / 4));
  assert.ok(candidateRatio >= 0.54 && candidateRatio <= 0.66,
    `field parcel ratio drifted from about 60%: ${candidateRatio}`);
  assert.ok(filled / (candidates * 16) >= 0.84,
    'field parcel fill drifted too far below 90%');

  const components = fieldComponents(items);
  assert.ok(components.length > 0, 'no field components');
  assert.ok(components[0] >= 16, `fields did not form a continuous component: ${components[0]}`);
  const connectedHexes = components.filter((size) => size >= 4).reduce((sum, size) => sum + size, 0);
  assert.ok(connectedHexes / fieldHexes > 0.9, 'field rows regressed to isolated hex noise');
}

function determinismTest() {
  const first = snapshot(314159).items;
  const second = snapshot(314159).items;
  assert.deepStrictEqual(second, first, 'same seed must reproduce backdrop parcels exactly');
  const changed = snapshot(314160).items;
  assert.notDeepStrictEqual(changed, first, 'different seeds should change parcel layout');
}

parcelCoherenceTest();
determinismTest();
console.log('map_backdrop_parcels.test.js: passed');
