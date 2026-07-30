/** Run with: node tests/ps_objects_raised_hd.test.js */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const LAYER_SOURCE = fs.readFileSync(
  path.join(ROOT, 'phaser_ps_objects.js'),
  'utf8'
);
const TERRAIN_SOURCE = fs.readFileSync(
  path.join(ROOT, 'phaser_terrain_rural_v29.js'),
  'utf8'
);

const canonicalManifest = {
  schema: 'ps_object_assets/v1',
  sprites: {
    crate_s1: { file: 'crate_s1.png', w: 24, h: 14, ox: -12, oy: -6 },
    crate_s2: { file: 'crate_s2.png', w: 20, h: 30, ox: -10, oy: -20 },
    crate_s4: { file: 'crate_s4.png', w: 22, h: 12, ox: -8, oy: -4 },

    house_s2: { file: 'house_s2.png', w: 80, h: 90, ox: -40, oy: -70 },
    house_s3: { file: 'house_s3.png', w: 78, h: 84, ox: -39, oy: -64 },
    house_s4: { file: 'house_s4.png', w: 86, h: 42, ox: -35, oy: -12 },
    house_s5: { file: 'house_s5.png', w: 82, h: 40, ox: -33, oy: -10 },

    fence_s56: { file: 'fence_s56.png', w: 4, h: 23, ox: -2, oy: -22 },
    fence_s57: { file: 'fence_s57.png', w: 4, h: 20, ox: -2, oy: -19 },
    fence_s64: { file: 'fence_s64.png', w: 20, h: 28, ox: 1, oy: -18 },
    fence_s65: { file: 'fence_s65.png', w: 20, h: 28, ox: 1, oy: -18 },
    fence_s128: { file: 'fence_s128.png', w: 25, h: 15, ox: -20, oy: -11 },
    fence_s129: { file: 'fence_s129.png', w: 25, h: 15, ox: -20, oy: -11 },
    fence_s136: { file: 'fence_s136.png', w: 34, h: 15, ox: -11, oy: -2 },
    fence_s137: { file: 'fence_s137.png', w: 26, h: 9, ox: -8, oy: 2 },

    oak_s2: { file: 'oak_s2.png', w: 100, h: 150, ox: -50, oy: -145 },
    oak_s4: { file: 'oak_s4.png', w: 110, h: 60, ox: -35, oy: -12 }
  }
};

const raisedHdManifest = {
  schema: 'raised_hd_assets/v1',
  pixelRatio: 2,
  basePath: './',
  sprites: {
    crate_s1: {
      file: 'body/crate_s1_body_hd_v1.png',
      pixelRatio: 2,
      ox: -12,
      oy: -6,
      kind: 'body'
    },
    crate_s2: {
      file: 'body/crate_s2_body_hd_v1.png',
      pixelRatio: 2,
      ox: -10,
      oy: -20,
      kind: 'body'
    },
    house_s3: {
      file: 'body/house_s3_body_hd_v1.png',
      pixelRatio: 2,
      ox: -39,
      oy: -64,
      kind: 'body'
    },
    house_s5: {
      file: 'shadow/house_s5_shadow_hd_v1.png',
      pixelRatio: 2,
      ox: -33,
      oy: -10,
      kind: 'shadow'
    },
    fence_s56: {
      file: 'body/fence_s56_body_hd_v1.png',
      pixelRatio: 2,
      ox: -2,
      oy: -22,
      kind: 'body'
    },
    fence_s128: {
      file: 'body/fence_s128_body_hd_v1.png',
      pixelRatio: 2,
      ox: -20,
      oy: -11,
      kind: 'body'
    },
    fence_s136: {
      file: 'shadow/fence_s136_shadow_hd_v1.png',
      pixelRatio: 2,
      ox: -11,
      oy: -2,
      kind: 'shadow'
    }
  }
};

const treeHdManifest = {
  schema: 'raised-hd-manifest/v1',
  pixelRatio: 2,
  basePath: './',
  sprites: {
    oak_s2: {
      file: 'body/oak_s2_body_hd_v1.png',
      pixelRatio: 2,
      ox: -50,
      oy: -145,
      kind: 'body',
      family: 'tree'
    },
    oak_s4: {
      file: 'shadow/oak_s4_shadow_hd_v1.png',
      pixelRatio: 2,
      ox: -35,
      oy: -12,
      kind: 'shadow',
      family: 'tree'
    }
  }
};

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadLayer(
  hdManifest = null,
  globalManifest = null,
  secondaryTreeManifest = null
) {
  const sandbox = { console };
  if (globalManifest) sandbox.RAISED_HD_MANIFEST = globalManifest;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LAYER_SOURCE, sandbox, { filename: 'phaser_ps_objects.js' });
  const layer = sandbox.PsObjectLayer;
  layer.manifest = canonicalManifest;
  layer.hdManifest = hdManifest;
  layer.treeHdManifest = secondaryTreeManifest;
  return layer;
}

function makeScene(keys) {
  const images = [];
  const scene = {
    textures: {
      exists(key) { return keys.has(key); }
    },
    add: {
      image(x, y, key) {
        const image = {
          x,
          y,
          key,
          destroyed: false,
          setOrigin(originX, originY) {
            this.origin = [originX, originY];
            return this;
          },
          setScale(scale) {
            this.scale = scale;
            return this;
          },
          setDepth(depth) {
            this.depth = depth;
            return this;
          },
          destroy() {
            this.destroyed = true;
          }
        };
        images.push(image);
        return image;
      }
    }
  };
  return { scene, images };
}

function textureKeys(layer, ledger) {
  return new Set(layer.requiredSprites(ledger).map(item => item.key));
}

function almostEqual(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message}: expected ${expected}, got ${actual}`
  );
}

function testRequiredSpritesSelectsHdPerSlotAndPreservesFallbackShape() {
  const layer = loadLayer(raisedHdManifest);
  const ledger = {
    objects: [
      {
        asset: 'crate',
        body_slot: 2,
        shadow_slot: 4,
        states: { body: [2, 1], shadow: [4, null] }
      },
      {
        asset: 'fence',
        composite: true,
        body_slots: [56, 57],
        shadow_slots: [64, 65],
        crushed_slots: [128, 129],
        crushed_shadow_slots: [136, 137]
      }
    ]
  };

  const needed = layer.requiredSprites(ledger);
  const byKey = new Map(needed.map(item => [item.key, plain(item)]));
  assert.deepStrictEqual(byKey.get('pso_hd_crate_s2'), {
    key: 'pso_hd_crate_s2',
    file: 'body/crate_s2_body_hd_v1.png',
    path: 'asset/environment/raised_hd/body/crate_s2_body_hd_v1.png'
  });
  assert.deepStrictEqual(byKey.get('pso_crate_s4'), {
    key: 'pso_crate_s4',
    file: 'crate_s4.png'
  });
  assert.ok(byKey.has('pso_hd_crate_s1'), 'damage body should select HD');
  assert.ok(byKey.has('pso_hd_fence_s56'), 'composite standing body should select HD');
  assert.ok(byKey.has('pso_fence_s57'), 'missing composite body should fall back');
  assert.ok(byKey.has('pso_fence_s64'), 'missing composite shadow should fall back');
  assert.ok(byKey.has('pso_hd_fence_s128'), 'composite crushed body should select HD');
  assert.ok(byKey.has('pso_fence_s129'), 'missing crushed body should fall back');
  assert.ok(byKey.has('pso_hd_fence_s136'), 'crushed shadow should select HD');
  assert.ok(byKey.has('pso_fence_s137'), 'missing crushed shadow should fall back');

  // manifest.js uses this global instead of assigning layer.hdManifest.
  const globalLayer = loadLayer(null, raisedHdManifest);
  assert.strictEqual(
    globalLayer.requiredSprites(ledger)[0].key,
    'pso_hd_crate_s2'
  );
}

function testSimplePlacementKeepsLogicalOriginAndOnlyHalvesHdScale() {
  const layer = loadLayer(raisedHdManifest);
  const ledger = {
    objects: [{
      asset: 'crate',
      family: 'shrub',
      x: 50,
      y: 60,
      body_slot: 2,
      shadow_slot: 4,
      states: { body: [2, 1], shadow: [4, null] },
      hex: [3, 4]
    }]
  };
  const projection = { scale: 0.84, topLeftX: 100, topLeftY: 200 };
  const harness = makeScene(textureKeys(layer, ledger));

  assert.strictEqual(layer.build(harness.scene, ledger, projection), 1);
  const inst = layer._objects[0];
  const body = inst.bodies[0];
  const shadow = inst.shadows[0];

  assert.strictEqual(body.key, 'pso_hd_crate_s2');
  almostEqual(body.x, 100 + (50 - 10) * 0.84, 'HD body x');
  almostEqual(body.y, 200 + (60 - 20) * 0.84, 'HD body y');
  assert.strictEqual(body.scale, 0.42);
  assert.deepStrictEqual(body.origin, [0, 0]);
  almostEqual(body.depth, 200 + 60 * 0.84, 'body depth');

  assert.strictEqual(shadow.key, 'pso_crate_s4');
  almostEqual(shadow.x, 100 + (50 - 8) * 0.84, 'fallback shadow x');
  almostEqual(shadow.y, 200 + (60 - 4) * 0.84, 'fallback shadow y');
  assert.strictEqual(shadow.scale, 0.84);
  assert.deepStrictEqual(shadow.origin, [0, 0]);
  assert.strictEqual(shadow.depth, layer.SHADOW_DEPTH);

  assert.strictEqual(layer.damageObject(inst), true);
  const crushed = inst.bodies[0];
  assert.strictEqual(crushed.key, 'pso_hd_crate_s1');
  almostEqual(crushed.x, 100 + (50 - 12) * 0.84, 'damage body x');
  almostEqual(crushed.y, 200 + (60 - 6) * 0.84, 'damage body y');
  assert.strictEqual(crushed.scale, 0.42);
  assert.deepStrictEqual(crushed.origin, [0, 0]);
  assert.strictEqual(crushed.depth, layer.SHADOW_DEPTH + 1);
  assert.strictEqual(inst.shadows.length, 0);
}

function testDamageBodyAndShadowCanIndependentlySwitchToHd() {
  const layer = loadLayer(raisedHdManifest);
  const ledger = {
    objects: [{
      asset: 'house',
      family: 'building',
      x: 20,
      y: 30,
      body_slot: 2,
      shadow_slot: 4,
      states: { body: [2, 3], shadow: [4, 5] }
    }]
  };
  const harness = makeScene(textureKeys(layer, ledger));
  layer.build(
    harness.scene,
    ledger,
    { scale: 0.84, topLeftX: 10, topLeftY: 15 }
  );
  const inst = layer._objects[0];

  assert.strictEqual(inst.bodies[0].key, 'pso_house_s2');
  assert.strictEqual(inst.bodies[0].scale, 0.84);
  assert.strictEqual(inst.shadows[0].key, 'pso_house_s4');
  assert.strictEqual(inst.shadows[0].scale, 0.84);

  assert.strictEqual(layer.damageObject(inst), true);
  assert.strictEqual(inst.bodies[0].key, 'pso_hd_house_s3');
  assert.strictEqual(inst.bodies[0].scale, 0.42);
  assert.strictEqual(inst.shadows[0].key, 'pso_hd_house_s5');
  assert.strictEqual(inst.shadows[0].scale, 0.42);
  assert.deepStrictEqual(inst.bodies[0].origin, [0, 0]);
  assert.deepStrictEqual(inst.shadows[0].origin, [0, 0]);
}

function testCompositeStandingAndCrushedSlotsMixHdAndFallback() {
  const layer = loadLayer(raisedHdManifest);
  const ledger = {
    objects: [{
      asset: 'fence',
      family: 'fence',
      composite: true,
      x: 70,
      y: 80,
      body_slots: [56, 57],
      shadow_slots: [64, 65],
      crushed_slots: [128, 129],
      crushed_shadow_slots: [136, 137]
    }]
  };
  const harness = makeScene(textureKeys(layer, ledger));
  layer.build(
    harness.scene,
    ledger,
    { scale: 0.84, topLeftX: 0, topLeftY: 0 }
  );
  const inst = layer._objects[0];

  assert.deepStrictEqual(
    plain(inst.bodies.map(item => [item.key, item.scale])),
    [['pso_hd_fence_s56', 0.42], ['pso_fence_s57', 0.84]]
  );
  assert.deepStrictEqual(
    plain(inst.shadows.map(item => [item.key, item.scale])),
    [['pso_fence_s64', 0.84], ['pso_fence_s65', 0.84]]
  );

  assert.strictEqual(layer.damageObject(inst), true);
  assert.deepStrictEqual(
    plain(inst.bodies.map(item => [item.key, item.scale])),
    [['pso_hd_fence_s128', 0.42], ['pso_fence_s129', 0.84]]
  );
  assert.deepStrictEqual(
    plain(inst.shadows.map(item => [item.key, item.scale])),
    [['pso_hd_fence_s136', 0.42], ['pso_fence_s137', 0.84]]
  );
}

function testMissingOrInvalidHdManifestIsCanonicalCompatible() {
  const ledger = {
    objects: [{
      asset: 'crate',
      body_slot: 2,
      shadow_slot: 4,
      states: { body: [2, 1], shadow: [4, null] }
    }]
  };
  const layer = loadLayer();
  assert.deepStrictEqual(plain(layer.requiredSprites(ledger)), [
    { key: 'pso_crate_s2', file: 'crate_s2.png' },
    { key: 'pso_crate_s4', file: 'crate_s4.png' },
    { key: 'pso_crate_s1', file: 'crate_s1.png' }
  ]);

  // A wrong logical origin is incomplete/unsafe and falls back per-slot.
  layer.hdManifest = {
    pixelRatio: 2,
    sprites: {
      crate_s2: {
        file: 'body/bad_origin.png',
        pixelRatio: 2,
        ox: -9,
        oy: -20
      }
    }
  };
  assert.deepStrictEqual(plain(layer.requiredSprites(ledger)[0]), {
    key: 'pso_crate_s2',
    file: 'crate_s2.png'
  });
}

function testTerrainLoaderConsumesResolvedHdPath() {
  const loaded = [];
  let complete = null;
  const ledger = { objects: [] };
  const objectLayer = {
    manifest: {},
    requiredSprites() {
      return [
        {
          key: 'pso_hd_crate_s2',
          file: 'body/crate_s2_body_hd_v1.png',
          path: 'asset/environment/raised_hd/body/crate_s2_body_hd_v1.png'
        },
        { key: 'pso_crate_s4', file: 'crate_s4.png' }
      ];
    },
    build() {}
  };
  const scene = {
    textures: { exists() { return false; } },
    cache: {
      json: {
        exists() { return true; },
        get() { return ledger; }
      }
    },
    load: {
      image(key, file) { loaded.push([key, file]); },
      once(event, callback) {
        assert.strictEqual(event, 'complete');
        complete = callback;
      },
      start() {
        if (complete) complete();
      }
    }
  };
  const sandbox = {
    console,
    HEX_SIZE: 54,
    Renderer: { hexToPx() { return { x: 0, y: 0 }; } },
    PsObjectLayer: objectLayer
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(TERRAIN_SOURCE, sandbox, {
    filename: 'phaser_terrain_rural_v29.js'
  });

  sandbox.TerrainRenderRuralV29._buildPsObjects(
    scene,
    'fixture',
    { scale: 0.84, topLeftX: 0, topLeftY: 0 }
  );
  assert.deepStrictEqual(loaded, [
    [
      'pso_hd_crate_s2',
      'asset/environment/raised_hd/body/crate_s2_body_hd_v1.png'
    ],
    ['pso_crate_s4', 'asset/environment/ps_objects/crate_s4.png']
  ]);
}

function testSecondaryTreeManifestUsesTreeRootAndTrunkPivotSway() {
  const layer = loadLayer(raisedHdManifest, null, treeHdManifest);
  const ledger = {
    objects: [{
      asset: 'oak',
      family: 'tree',
      x: 100,
      y: 120,
      body_slot: 2,
      shadow_slot: 4,
      states: { body: [2], shadow: [4] }
    }]
  };
  const needed = layer.requiredSprites(ledger);
  assert.deepStrictEqual(plain(needed), [
    {
      key: 'pso_hd_oak_s2',
      file: 'body/oak_s2_body_hd_v1.png',
      path: (
        'asset/environment/trees_hd/production/' +
        'body/oak_s2_body_hd_v1.png'
      )
    },
    {
      key: 'pso_hd_oak_s4',
      file: 'shadow/oak_s4_shadow_hd_v1.png',
      path: (
        'asset/environment/trees_hd/production/' +
        'shadow/oak_s4_shadow_hd_v1.png'
      )
    }
  ]);

  const harness = makeScene(textureKeys(layer, ledger));
  let tween = null;
  harness.scene.tweens = {
    add(config) {
      tween = config;
      return config;
    }
  };
  const projection = { scale: 0.8, topLeftX: 10, topLeftY: 20 };
  layer.build(harness.scene, ledger, projection);
  const inst = layer._objects[0];
  const body = inst.bodies[0];
  const shadow = inst.shadows[0];

  assert.strictEqual(body.key, 'pso_hd_oak_s2');
  almostEqual(body.x, 10 + 100 * 0.8, 'tree trunk pivot x');
  almostEqual(body.y, 20 + 120 * 0.8, 'tree trunk pivot y');
  almostEqual(body.origin[0], 0.5, 'tree trunk pivot origin x');
  almostEqual(body.origin[1], 145 / 150, 'tree trunk pivot origin y');
  almostEqual(body.scale, 0.4, 'tree HD scale');
  assert.ok(tween, 'tree body should receive a sway tween');
  assert.strictEqual(tween.targets, body);
  assert.strictEqual(tween.scaleY, 0.4);
  assert.strictEqual(tween.repeat, -1);
  assert.strictEqual(tween.yoyo, true);

  assert.strictEqual(shadow.key, 'pso_hd_oak_s4');
  assert.deepStrictEqual(shadow.origin, [0, 0]);
  assert.notStrictEqual(tween.targets, shadow, 'shadow must remain static');
}

testRequiredSpritesSelectsHdPerSlotAndPreservesFallbackShape();
testSimplePlacementKeepsLogicalOriginAndOnlyHalvesHdScale();
testDamageBodyAndShadowCanIndependentlySwitchToHd();
testCompositeStandingAndCrushedSlotsMixHdAndFallback();
testMissingOrInvalidHdManifestIsCanonicalCompatible();
testTerrainLoaderConsumesResolvedHdPath();
testSecondaryTreeManifestUsesTreeRootAndTrunkPivotSway();
console.log('✓ PsObjectLayer raised HD override tests passed');
