'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const created = [];
function makeImage(x, y, key, frame) {
  const image = {
    x, y, texture: { key }, frame: { name: frame }, active: true,
    originX: 0.5, originY: 1, scaleX: 1, scaleY: 1,
    displayHeight: 100, alpha: 1, visible: true, rotation: 0,
    setTexture(k, f) { this.texture.key = k; this.frame.name = f; return this; },
    setFrame(f) { this.frame.name = f; return this; },
    setOrigin(ox, oy) { this.originX = ox; this.originY = oy; return this; },
    setFlip(fx, fy) { this.flipX = fx; this.flipY = fy; return this; },
    setRotation(r) { this.rotation = r; return this; },
    setVisible(v) { this.visible = v; return this; },
    setScale(sx, sy) { this.scaleX = sx; this.scaleY = sy; return this; },
    setPosition(nx, ny) { this.x = nx; this.y = ny; return this; },
    setTint(t) { this.tint = t; return this; },
    setTintFill(t) { this.tintFill = t; return this; },
    setAlpha(a) { this.alpha = a; return this; },
    setDepth(d) { this.depth = d; return this; },
    setBlendMode(m) { this.blendMode = m; return this; },
    destroy() { this.active = false; },
  };
  created.push(image);
  return image;
}

const scene = {
  add: { image: makeImage },
  tweens: { entries: [], add(config) { this.entries.push(config); } },
};
const sandbox = {
  console,
  Phaser: { BlendModes: { NORMAL: 0, MULTIPLY: 7, ADD: 1 } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'phaser_alpha_light.js'), 'utf8'),
  sandbox,
  { filename: 'phaser_alpha_light.js' },
);

const source = makeImage(10, 20, 'house', 3);
source.displayHeight = 100;
source.originX = 0.5;
source.originY = 1;
const light = sandbox.AlphaLightSpace;
const shadow = light.createSunShadow(scene, source, { depth: -9980 });

assert.ok(shadow && shadow._alphaLightSunShadow, 'sun shadow must be alpha-derived');
assert.strictEqual(shadow.texture.key, 'house');
assert.strictEqual(shadow.frame.name, 3);
assert.strictEqual(shadow.blendMode, sandbox.Phaser.BlendModes.NORMAL);
assert.strictEqual(shadow.tintFill, 0x000000,
  'sun shadow must be a solid black alpha mask that darkens the ground');
assert.ok(shadow._alphaLightDarkensGround);
assert.strictEqual(shadow.depth, -9980);
assert.ok(shadow.x > source.x && shadow.y > source.y,
  'upper-left sun must cast the silhouette east/south-east');
assert.strictEqual(shadow.scaleY, source.scaleY * light.SUN.flatten);

source.frame.name = 4;
light.syncSunShadow(shadow, source, { flatten: 0.4 });
assert.strictEqual(shadow.frame.name, 4, 'moving animation frame updates its shadow alpha');
assert.strictEqual(shadow.scaleY, 0.4);

const beforeFlash = created.length;
const flashed = light.flashAlpha(scene, source, 0, 0, 80, {
  worldX: 10, worldY: 20, shadowDepth: -9979, rimDepth: 12,
});
const flashCopies = created.slice(beforeFlash);
assert.ok(flashed, 'nearby point light should affect the source');
assert.ok(flashCopies.some((copy) => copy._alphaLightPointShadow),
  'point light creates a short opposite alpha shadow');
assert.ok(flashCopies.some((copy) => copy._alphaLightRim),
  'point light creates a light-facing alpha rim');
assert.strictEqual(scene.tweens.entries.length, 2,
  'point shadow and rim both decay instead of accumulating');

console.log('alpha_light_space.test.js: passed');
