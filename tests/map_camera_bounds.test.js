/**
 * Regression coverage for MainScene.centerMap render bounds.
 * Run with: node tests/map_camera_bounds.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HEX_SIZE = 54;
const MAP_W = 20;
const MAP_H = 20;

function hexToPx(q, r) {
  return {
    x: HEX_SIZE * Math.sqrt(3) * (q + r / 2),
    y: HEX_SIZE * 1.5 * r,
  };
}

function extractCenterMap() {
  const source = fs.readFileSync(path.join(ROOT, 'phaser_bridge.js'), 'utf8');
  const classStart = source.indexOf('class MainScene extends Phaser.Scene');
  assert.notStrictEqual(classStart, -1, 'MainScene class not found');

  const methodStart = source.indexOf('    centerMap() {', classStart);
  assert.notStrictEqual(methodStart, -1, 'MainScene.centerMap not found');

  const braceStart = source.indexOf('{', methodStart);
  let depth = 0;
  let methodEnd = -1;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        methodEnd = i;
        break;
      }
    }
  }
  assert.notStrictEqual(methodEnd, -1, 'MainScene.centerMap closing brace not found');

  const methodSource = source.slice(methodStart, methodEnd + 1).trim();
  const sandbox = {
    window: { gameLogic: null },
    Renderer: { hexToPx },
    Phaser: {
      Math: {
        Clamp(value, min, max) {
          return Math.max(min, Math.min(max, value));
        },
      },
    },
  };
  const centerMap = vm.runInNewContext(
    '({' + methodSource + '}).centerMap',
    sandbox,
    { filename: 'MainScene.centerMap.vm.js' },
  );
  return { centerMap, sandbox };
}

function runCenterMap(runtime, map, width, height, initialZoom, sidebarWidth) {
  const centers = [];
  const bounds = [];
  const camera = {
    width,
    height,
    zoom: initialZoom == null ? 1 : initialZoom,
    centerOn(x, y) {
      centers.push({ x, y });
    },
    setBounds(x, y, w, h, centerOn) {
      bounds.push({ x, y, w, h, centerOn });
    },
  };
  runtime.sandbox.window.gameLogic = { map };
  const scene = { cameras: { main: camera } };
  if (Number.isFinite(sidebarWidth)) scene._battlefieldSidebarWidth = () => sidebarWidth;
  runtime.centerMap.call(scene);
  return { camera, centers, bounds };
}

function almostEqual(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    message + ': expected ' + expected + ', got ' + actual,
  );
}

const runtime = extractCenterMap();
const fullMap = Array.from(
  { length: MAP_W },
  () => Array.from({ length: MAP_H }, () => ({ id: 0 })),
);
const viewport = { width: 1200, height: 700 };
const full = runCenterMap(runtime, fullMap, viewport.width, viewport.height);

const minX = hexToPx(0, 0).x - 61;
const maxX = hexToPx(MAP_W - 1, MAP_H - 1).x + 61;
const minY = hexToPx(0, 0).y - 100;
const maxY = hexToPx(MAP_W - 1, MAP_H - 1).y + 45;
const expectedCenter = {
  x: (minX + maxX) / 2,
  y: (minY + maxY) / 2,
};
const expectedZoom = Math.max(
  viewport.width / (maxX - minX),
  viewport.height / (maxY - minY),
) * 1.01;

assert.strictEqual(full.centers.length, 1, 'camera should center exactly once');
almostEqual(full.centers[0].x, expectedCenter.x, 'axial X center');
almostEqual(full.centers[0].y, expectedCenter.y, 'asymmetric tall-tile Y center');
almostEqual(full.camera.zoom, expectedZoom, 'edge-to-edge ground zoom');
assert.ok(full.camera.zoom * (maxX - minX) >= viewport.width,
  'ground should cover the viewport width');
assert.ok(full.camera.zoom * (maxY - minY) >= viewport.height,
  'ground should cover the viewport height');

const oldCenter = {
  x: MAP_W * HEX_SIZE * Math.sqrt(3) / 2,
  y: MAP_H * HEX_SIZE * 1.5 / 2,
};
const oldError = Math.hypot(
  oldCenter.x - expectedCenter.x,
  oldCenter.y - expectedCenter.y,
);
const newError = Math.hypot(
  full.centers[0].x - expectedCenter.x,
  full.centers[0].y - expectedCenter.y,
);
assert.ok(oldError > 300, 'regression fixture must expose the old axial-center error');
almostEqual(newError, 0, 'new center error');

// The WebGL camera stays full-canvas to avoid stale scissor state, while map
// fitting and centering reserve the opaque Phaser sidebar logically.
const sidebarWidth = 340;
const sidebarViewport = { width: 1400, height: 600 };
const withSidebar = runCenterMap(
  runtime, fullMap, sidebarViewport.width, sidebarViewport.height, 1, sidebarWidth,
);
const expectedSidebarZoom = Math.max(
  (sidebarViewport.width - sidebarWidth) / (maxX - minX),
  sidebarViewport.height / (maxY - minY),
) * 1.01;
almostEqual(withSidebar.camera.zoom, expectedSidebarZoom, 'sidebar-aware zoom');
almostEqual(
  withSidebar.centers[0].x,
  expectedCenter.x + sidebarWidth / (2 * expectedSidebarZoom),
  'map center shifts into the visible battlefield area',
);
almostEqual(withSidebar.centers[0].y, expectedCenter.y, 'sidebar keeps Y center');
almostEqual(
  withSidebar.bounds[0].w,
  (maxX - minX) + sidebarWidth / expectedSidebarZoom,
  'camera bounds reserve covered sidebar world width',
);
assert.strictEqual(withSidebar.bounds[0].centerOn, false,
  'bounds must not override the sidebar-aware center');

// City metadata marks a rendered tile even if its legacy terrain id is VOID.
const cityMap = Array.from({ length: 8 }, () => []);
cityMap[0][0] = { id: -1 };
cityMap[7][4] = { id: -1, city: {} };
const city = runCenterMap(runtime, cityMap, 5000, 5000);
const cityAnchor = hexToPx(7, 4);
assert.strictEqual(city.centers.length, 1, 'city tile should be included');
almostEqual(city.centers[0].x, cityAnchor.x, 'single-city-tile X center');
almostEqual(city.centers[0].y, cityAnchor.y - 27.5, 'single-city-tile Y center');
assert.strictEqual(city.camera.zoom, 4, 'zoom should clamp to upper limit');

const tinyViewport = runCenterMap(runtime, fullMap, 20, 20);
assert.strictEqual(tinyViewport.camera.zoom, 0.24, 'zoom should clamp to lower limit');

const voidMap = [[{ id: -1 }]];
const untouched = runCenterMap(runtime, voidMap, 800, 600, 1.5);
assert.strictEqual(untouched.centers.length, 0, 'VOID-only map should not recenter');
assert.strictEqual(untouched.camera.zoom, 1.5, 'VOID-only map should not change zoom');

console.log(
  'map_camera_bounds.test.js: old center error ' + oldError.toFixed(2) +
  'px; new center error ' + newError.toFixed(2) + 'px',
);
console.log('map_camera_bounds.test.js: passed');
