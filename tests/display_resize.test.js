/**
 * Regression coverage for monitor/DPI-aware Phaser resizing.
 * Run with: node tests/display_resize.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'phaser_bridge.js'), 'utf8');

function extractMethod(name) {
  const start = source.indexOf(`    ${name}(`);
  assert.notStrictEqual(start, -1, `${name} method not found`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1).trim();
    }
  }
  throw new Error(`${name} closing brace not found`);
}

const view = {
  clientWidth: 1280,
  clientHeight: 720,
  rect: { width: 1280, height: 720 },
  getBoundingClientRect() { return this.rect; },
};
const sandbox = {
  document: { getElementById: (id) => id === 'game-view' ? view : null },
  window: { devicePixelRatio: 1 },
  Phaser: { Scale: { RESIZE: 5 } },
  Number,
  Math,
};
const methods = vm.runInNewContext(
  `({${extractMethod('_measureGameView')},${extractMethod('resize')},${extractMethod('_refreshInputBounds')},${extractMethod('_synchronizeSceneCameras')},${extractMethod('_resetWebGLViewport')}})`,
  sandbox,
  { filename: 'display_resize.methods.vm.js' },
);

const resizeCalls = [];
const canvas = {
  width: 1280,
  height: 720,
  rect: { width: 1280, height: 720 },
  getBoundingClientRect() { return this.rect; },
};
const renderer = {
  game: {
    canvas,
    renderer: { canvas, resolution: 1 },
    scale: {
      width: 1280,
      height: 720,
      resize(width, height) {
        resizeCalls.push([width, height]);
        this.width = width;
        this.height = height;
        canvas.width = width;
        canvas.height = height;
        canvas.rect = { width, height };
      },
    },
  },
  _lastAppliedViewport: { width: 1280, height: 720, dpr: 1 },
  _measureGameView: methods._measureGameView,
  _synchronizeSceneCameras(width, height) {
    this.synchronized = [width, height];
  },
  _resetWebGLViewport(width, height) {
    this.webglReset = [width, height];
  },
  _refreshInputBounds() {
    this.inputBoundsRefreshed = true;
  },
  resize: methods.resize,
};

assert.strictEqual(renderer.resize(), false, 'stable viewport should not resize repeatedly');
assert.strictEqual(renderer.resize(true), true, 'settled forced pass should refresh WebGL state');
assert.deepStrictEqual(resizeCalls.pop(), [1280, 720]);
assert.deepStrictEqual(renderer.synchronized, [1280, 720]);
assert.deepStrictEqual(renderer.webglReset, [1280, 720]);
assert.strictEqual(renderer.inputBoundsRefreshed, true);

// A monitor transition can change DPR before it changes CSS-pixel dimensions.
sandbox.window.devicePixelRatio = 1.5;
assert.strictEqual(renderer.resize(), true, 'DPR-only transition should refresh Phaser');
assert.deepStrictEqual(resizeCalls.pop(), [1280, 720]);

// The parent can settle later, after the original window resize event.
view.rect = { width: 1536.4, height: 863.6 };
assert.strictEqual(renderer.resize(), true, 'late parent resize should refresh Phaser');
assert.deepStrictEqual(resizeCalls.pop(), [1536, 864]);

// A stale or temporarily zero layout must not collapse the renderer.
view.rect = { width: 0, height: 0 };
view.clientWidth = 0;
view.clientHeight = 0;
assert.strictEqual(renderer.resize(), false, 'zero-sized transition frame should be ignored');
assert.strictEqual(resizeCalls.length, 0);

const displayScaleCalls = [];
const inputScale = {
  canvasBounds: { width: 1280, height: 720 },
  baseSize: { width: 1280, height: 720 },
  displayScale: { set(x, y) { displayScaleCalls.push([x, y]); } },
  updateBounds() { this.canvasBounds = { width: 640, height: 360 }; },
};
assert.strictEqual(methods._refreshInputBounds.call({ game: { scale: inputScale } }), true);
assert.deepStrictEqual(displayScaleCalls, [[2, 2]],
  'pointer mapping must be recalculated from the latest canvas DOM bounds');

// Only each Scene's main camera is normalized. A deliberately custom camera,
// such as the tactical minimap, must retain its own viewport.
const mainCameraCalls = [];
const uiCameraCalls = [];
const minimapCamera = { width: 200, height: 145 };
const mainScene = {
  cameras: {
    main: {
      setPosition(x, y) { mainCameraCalls.push(['position', x, y]); },
      setSize(w, h) { mainCameraCalls.push(['size', w, h]); },
    },
    cameras: [minimapCamera],
  },
  mapGenerated: false,
};
const uiScene = {
  cameras: {
    main: {
      setPosition(x, y) { uiCameraCalls.push(['position', x, y]); },
      setSize(w, h) { uiCameraCalls.push(['size', w, h]); },
    },
  },
};
methods._synchronizeSceneCameras.call({
  game: {
    scene: {
      scenes: [mainScene, uiScene],
      getScene: () => mainScene,
    },
  },
}, 1536, 864);
assert.deepStrictEqual(mainCameraCalls, [['position', 0, 0], ['size', 1536, 864]]);
assert.deepStrictEqual(uiCameraCalls, [['position', 0, 0], ['size', 1536, 864]]);
assert.deepStrictEqual(minimapCamera, { width: 200, height: 145 });

// Phaser 3.60 caches the current scissor separately from the default one.
// Both the cache and actual GL state must be full-canvas after a recovery.
const glCalls = [];
const gl = {
  FRAMEBUFFER: 0x8D40,
  SCISSOR_TEST: 0x0C11,
  drawingBufferHeight: 864,
  bindFramebuffer(...args) { glCalls.push(['bindFramebuffer', ...args]); },
  viewport(...args) { glCalls.push(['viewport', ...args]); },
  enable(...args) { glCalls.push(['enable', ...args]); },
  scissor(...args) { glCalls.push(['scissor', ...args]); },
};
const webglRenderer = {
  gl,
  defaultScissor: [0, 0, 1280, 720],
  currentScissor: [10, 10, 200, 145],
  scissorStack: [[10, 10, 200, 145]],
  resize(w, h) { this.resized = [w, h]; },
};
methods._resetWebGLViewport.call({ game: { renderer: webglRenderer } }, 1536, 864);
assert.deepStrictEqual(webglRenderer.resized, [1536, 864]);
assert.strictEqual(webglRenderer.currentScissor, webglRenderer.defaultScissor);
assert.deepStrictEqual(webglRenderer.scissorStack, [[0, 0, 1536, 864]]);
assert.ok(glCalls.some((call) => call[0] === 'viewport' && call[3] === 1536 && call[4] === 864));
assert.ok(glCalls.some((call) => call[0] === 'scissor' && call[3] === 1536 && call[4] === 864));

assert.ok(source.includes('new ResizeObserver(queue)'), 'game-view must be observed directly');
assert.ok(source.includes("window.visualViewport.addEventListener('resize', queue)"),
  'visual viewport resize must be observed');
assert.ok(source.includes('window.matchMedia(`(resolution: ${dpr}dppx)`)'),
  'monitor DPR changes must be observed');
assert.ok(source.includes('mode: Phaser.Scale.NONE'),
  'Phaser automatic resize must not race the settled monitor resize');
assert.ok(source.includes('}, 160);'),
  'monitor resize must debounce intermediate Windows viewport sizes');
assert.ok(source.includes('camera.setPosition(0, 0);') && source.includes('camera.setSize(width, height);'),
  'every active Scene main camera must be restored to the full canvas');
assert.ok(source.includes('renderer.currentScissor = full;'),
  'the cached WebGL scissor must be reset after monitor transitions');
assert.ok(source.includes("['pointerdown', 'pointermove', 'wheel']"),
  'input bounds must refresh before the first pointer event on a new monitor');
assert.ok(source.includes('scale.displayScale.set(base.width / bounds.width, base.height / bounds.height)'),
  'pointer coordinates must use the current displayed canvas bounds');
assert.ok(source.includes('[450, 1100].forEach'),
  'GPU surface state must be rechecked after the CSS viewport settles');
assert.ok(!source.includes('this.cameras.main.setViewport(0, 0, this.scale.width, this.scale.height)'),
  'the main camera must not use the custom-viewport path');

console.log('display_resize.test.js: passed');
