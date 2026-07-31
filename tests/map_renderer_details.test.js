/** Run with: node tests/map_renderer_details.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

function loadRenderer(width, height) {
  const CityMap = {
    lastSeed: 17,
    DIRS,
    BLDG_RE: /^bldg_/,
    groundFile: (cell) => cell.gfile || 'gnd_cobble_v0.png',
    h32(seed, q, r) {
      const tag = arguments[arguments.length - 1];
      if (tag === 'backdrop-field') return ((q + r) & 1) === 0 ? 0 : 99;
      if (tag === 'backdrop-veg' || tag === 'backdrop-tree') return 0;
      if (tag === 'cobble-detail-use') return 0;
      return 0;
    },
  };
  const box = {
    window: { CityMap, gameLogic: {} },
    console,
    MAP_W: width,
    MAP_H: height,
    HEX_SIZE: 128,
    Renderer: { hexToPx: (q, r) => ({ x: q * 100, y: r * 80 }) },
    document: {},
  };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'phaser_terrain_v7.js'), 'utf8'), box);
  return { box, CityMap, renderer: box.window.TerrainRenderV7 };
}

function collectFilesTest() {
  const { renderer } = loadRenderer(2, 1);
  const current = 'bldg_s1_v0_d1_rot0.png';
  const decal = 'track_v2_rot60.png';
  const map = [[{ city: {
    ground: 'road', gfile: 'road_straight_v0_rot0.png', flat: [],
    over: [current], decals: [{ file: decal }],
  }}], [{ city: {
    ground: 'cobble', gfile: 'gnd_cobble_v0.png', flat: [], over: [],
  }}]];
  const files = renderer.collectFiles(map);
  assert.ok(files.has(current), 'current building stage must be collected');
  assert.ok(!files.has('bldg_s1_v0_d0_rot0.png'));
  assert.ok(!files.has('bldg_s1_v0_d2_rot0.png'), 'future damage stage must stay lazy');
  assert.ok(files.has(decal), 'cell decal must be collected');
  assert.ok([...files].some((f) => /^gnd_grass_v/.test(f)), 'backdrop grass');
  assert.ok([...files].some((f) => /^fieldrows_v/.test(f)), 'backdrop field rows');
  assert.ok([...files].some((f) => /^veg_v/.test(f)), 'backdrop vegetation');
  assert.ok([...files].some((f) => /^tree_v/.test(f)), 'backdrop trees');
  assert.ok([...files].some((f) => /^cobble_detail_v/.test(f)), 'cobble seam detail');
}

function decalDrawTest() {
  const { renderer } = loadRenderer(1, 1);
  const low = { name: 'hex' }, tall = { name: 'tall' };
  const calls = [];
  renderer._addTile = (scene, group, file, x, y, depth) => {
    const image = {
      scaleX: 2, scaleY: 3, alpha: 1,
      setScale(sx, sy) { this.scaleX = sx; this.scaleY = sy; return this; },
      setAlpha(alpha) { this.alpha = alpha; return this; },
    };
    calls.push({ group, file, x, y, depth, image });
    return image;
  };
  renderer._drawDecals({}, low, tall, { decals: [
    { file: 'tree_v5_rot0.png', wx: 2, wy: 3, scale: 0.5, alpha: 1.7, tall: true, layer: 7 },
    { file: 'track_v0_rot0.png', wx: -1, wy: 0, scale: 2, alpha: -1, tall: false, layer: 'overlay' },
  ] }, { x: 100, y: 200 });

  const ppm = 288 / 20.25;
  assert.strictEqual(calls[0].group, tall);
  assert.ok(Math.abs(calls[0].x - (100 + 2 * ppm)) < 1e-9);
  assert.ok(Math.abs(calls[0].y - (200 - 3 * ppm)) < 1e-9);
  assert.ok(Math.abs(calls[0].depth - (calls[0].y - 0.45 + 0.007)) < 1e-9);
  assert.strictEqual(calls[0].image.scaleX, 1);
  assert.strictEqual(calls[0].image.scaleY, 1.5);
  assert.strictEqual(calls[0].image.alpha, 1, 'alpha clamps high');
  assert.strictEqual(calls[1].group, low);
  assert.ok(Math.abs(calls[1].depth - (2000 + calls[1].y)) < 1e-9);
  assert.strictEqual(calls[1].image.scaleX, 4);
  assert.strictEqual(calls[1].image.alpha, 0, 'alpha clamps low');
}

function buildSerialTest() {
  const { renderer } = loadRenderer(1, 1);
  const callbacks = [];
  const draws = [];
  renderer.collectFiles = () => new Set(['one.png']);
  renderer._draw = (scene, group, map, serial) => draws.push(serial);
  const scene = {
    textures: { exists: () => false },
    load: { image() {}, once(event, fn) { callbacks.push(fn); }, start() {} },
    sys: { isActive: () => true },
  };
  renderer.buildMap(scene, {}, []);
  renderer.buildMap(scene, {}, []);
  assert.strictEqual(callbacks.length, 2);
  callbacks[0]();
  callbacks[1]();
  assert.deepStrictEqual(draws, [2], 'stale async build must not draw');
}

function damageSerialTest() {
  const { CityMap, renderer } = loadRenderer(1, 1);
  const loaded = new Set();
  const callbacks = [];
  const scene = {
    textures: { exists: (key) => loaded.has(key) },
    load: { image() {}, once(event, fn) { callbacks.push(fn); }, start() {} },
  };
  const buildingStages = ['bldg_s1_v0_d1_rot0.png', 'bldg_s1_v0_d2_rot0.png'];
  const groundStages = ['road_straight_v0_d1_rot0.png', 'road_straight_v0_d2_rot0.png'];
  CityMap.damageBuilding = () => ({ file: buildingStages.shift() });
  CityMap.damageGround = () => ({ file: groundStages.shift() });
  const buildingTextures = [], groundTextures = [];
  const building = { scene: {}, setTexture: (key) => buildingTextures.push(key) };
  const ground = { scene: {}, setTexture: (key) => groundTextures.push(key) };
  renderer.buildingSprites.set('0,0', building);
  renderer.groundSprites.set('0,0', ground);

  assert.strictEqual(renderer.damageBuilding(scene, 0, 0), true);
  assert.strictEqual(renderer.damageBuilding(scene, 0, 0), true);
  loaded.add('v7_bldg_s1_v0_d1_rot0.png');
  loaded.add('v7_bldg_s1_v0_d2_rot0.png');
  callbacks[1]();
  callbacks[0]();
  assert.deepStrictEqual(buildingTextures, ['v7_bldg_s1_v0_d2_rot0.png']);

  assert.strictEqual(renderer.damageGround(scene, 0, 0), true);
  assert.strictEqual(renderer.damageGround(scene, 0, 0), true);
  loaded.add('v7_road_straight_v0_d1_rot0.png');
  loaded.add('v7_road_straight_v0_d2_rot0.png');
  callbacks[3]();
  callbacks[2]();
  assert.deepStrictEqual(groundTextures, ['v7_road_straight_v0_d2_rot0.png']);
}

collectFilesTest();
decalDrawTest();
buildSerialTest();
damageSerialTest();
console.log('map_renderer_details.test.js: passed');
