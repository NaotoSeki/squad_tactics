/** Run with: node tests/terrain_rural_v29_pixel_ratio.test.js */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(
  path.join(ROOT, 'phaser_terrain_rural_v29.js'),
  'utf8'
);

function makeHarness(pixelRatio) {
  const projection = {
    scale: 0.84,
    topLeftX: 885.3516092068122,
    topLeftY: 509.1
  };
  const battlefield = {
    imageWidth: 620,
    imageHeight: 620,
    projection,
    rows: []
  };
  if (pixelRatio !== undefined) battlefield.pixelRatio = pixelRatio;

  const images = [];
  const groupItems = [];
  const decalCalls = [];
  const objectBuilds = [];
  const ledger = {
    objects: [],
    projection: {
      scale: 0.76,
      top_left_x: 901.25,
      top_left_y: 487.5
    }
  };
  const image = {
    setOrigin(x, y) { this.origin = [x, y]; return this; },
    setScale(x, y) { this.scale = [x, y]; return this; },
    setDepth(depth) { this.depth = depth; return this; }
  };
  const scene = {
    textures: {
      exists() { return true; }
    },
    add: {
      image(x, y, key) {
        const result = Object.create(image);
        result.position = [x, y];
        result.key = key;
        images.push(result);
        return result;
      }
    },
    cache: {
      json: {
        exists() { return true; },
        get() { return ledger; }
      }
    }
  };
  const sandbox = {
    console,
    HEX_SIZE: 54,
    Renderer: { hexToPx() { return { x: 0, y: 0 }; } },
    PS_BATTLEFIELDS: { test_map: battlefield },
    DecalLayer: {
      init(...args) { decalCalls.push(args); }
    },
    PsObjectLayer: {
      manifest: {},
      requiredSprites() { return []; },
      build(...args) { objectBuilds.push(args); }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'phaser_terrain_rural_v29.js' });

  const variant = {
    psNative: 'test_map',
    texture: 'test_map',
    file: 'asset/environment/maps/test_map.png'
  };
  const hexGroup = {
    add(item) { groupItems.push(item); }
  };
  sandbox.TerrainRenderRuralV29._buildMapPsNative(scene, hexGroup, variant);

  return {
    projection,
    ledger,
    images,
    groupItems,
    decalCalls,
    objectBuilds
  };
}

function testMissingPixelRatioIsBackwardCompatible() {
  const h = makeHarness(undefined);
  assert.strictEqual(h.images.length, 1);
  assert.deepStrictEqual(h.images[0].position, [
    h.projection.topLeftX,
    h.projection.topLeftY
  ]);
  assert.deepStrictEqual(h.images[0].scale, [0.84, 0.84]);
  assert.strictEqual(h.groupItems[0], h.images[0]);
  console.log('✓ missing pixelRatio keeps the legacy background projection');
}

function testTwoXBackgroundKeepsLogicalCoordinates() {
  const h = makeHarness(2);
  const image = h.images[0];
  assert.deepStrictEqual(image.position, [
    h.projection.topLeftX,
    h.projection.topLeftY
  ]);
  assert.deepStrictEqual(image.scale, [0.42, 0.42]);

  // Logical source coordinate (310, 245) and its 2x texture coordinate
  // (620, 490) must land on exactly the same world coordinate.
  const logical = {
    x: h.projection.topLeftX + 310 * h.projection.scale,
    y: h.projection.topLeftY + 245 * h.projection.scale
  };
  const hd = {
    x: image.position[0] + 620 * image.scale[0],
    y: image.position[1] + 490 * image.scale[1]
  };
  assert.deepStrictEqual(hd, logical);

  // Decals retain the original registry projection and logical dimensions.
  assert.strictEqual(h.decalCalls.length, 1);
  assert.strictEqual(h.decalCalls[0][1], h.projection);
  assert.strictEqual(h.decalCalls[0][2], 620);
  assert.strictEqual(h.decalCalls[0][3], 620);

  // Objects prefer their own saved PS-logical projection, normalized from
  // the existing snake_case ledger schema.
  assert.strictEqual(h.objectBuilds.length, 1);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(h.objectBuilds[0][2])),
    {
      scale: 0.76,
      topLeftX: 901.25,
      topLeftY: 487.5
    }
  );
  console.log('✓ pixelRatio 2 preserves background, decal, and object coordinates');
}

testMissingPixelRatioIsBackwardCompatible();
testTwoXBackgroundKeepsLogicalCoordinates();
console.log('✓ All tests passed');
