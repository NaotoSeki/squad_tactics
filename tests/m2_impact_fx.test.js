'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('asset/environment/decals/manifest.json'));

assert.strictEqual(manifest.source, 'ps_sprites_canonical_v1');
assert.ok(Array.isArray(manifest.tiers.medium) && manifest.tiers.medium.length > 0,
  'PS-derived medium crater tier is available');
manifest.tiers.medium.forEach((entry) => {
  assert.ok(fs.existsSync(path.join(root, 'asset/environment/decals', entry.file)), entry.file);
});

const decals = read('phaser_decals.js');
assert.match(decals, /this\.TIER_MAP\[tier\] \|\| tier \|\| 'light'/,
  'decal layer accepts an explicit PS tier');
assert.match(decals, /opts && opts\.scale/,
  'decal layer accepts a per-impact scale without changing anchor data');

const bridge = read('phaser_bridge.js');
assert.match(bridge, /opts && opts\.psDecalTier/,
  'explosion bridge forwards the explicit PS crater tier');

for (const file of ['logic_game.js', 'logic_battle_rtwp.js']) {
  const source = read(file);
  assert.match(source, /t2_grenade[\s\S]{0,220}psDecalTier:\s*'medium'/,
    file + ' uses the shared grenade animation with the PS medium crater');
  assert.match(source, /psDecalScale:\s*0\.50/,
    file + ' keeps the M2 crater below one hex at native source resolution');
  assert.match(source, /blastTier:\s*'t3_mortar60'/,
    file + ' preserves the existing M2 blast radius while sharing the T2 visual');
  assert.match(source, /persistentDecal:\s*true/,
    file + 'requests a persistent visible M2 crater');
}

assert.match(bridge, /opts && opts\.persistentDecal[\s\S]{0,120}_stampPersistentImpactDecal/,
  'explosion bridge routes explicit persistent decals to a visible scene image');
assert.match(bridge, /if \(!visualOnly && \(\(opts && opts\.persistentDecal\)/,
  'persistent M2 crater does not depend on the PS-native RenderTexture being ready');
assert.match(bridge, /_stampPersistentImpactDecal\(x, y, tier, scale\)[\s\S]{0,700}setDepth\(0\.1\)/,
  'persistent crater is rendered above terrain without changing terrain state');

console.log('m2 impact FX tests: OK');
