'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const rtwp = read('logic_battle_rtwp.js');
const legacy = read('logic_game.js');
const bridge = read('phaser_bridge.js');

assert.match(rtwp,
  /case 'BLAST':[\s\S]{0,360}playExplosion\(p\.x, p\.y - 8, 't2_grenade', ev\.hex, \{ visualOnly: true \}\)[\s\S]{0,160}addSmoke/,
  'normal grenade blast uses KHAOS T2 and keeps its post-blast smoke');

for (const [name, source] of [['logic_game.js', legacy], ['logic_battle_rtwp.js', rtwp]]) {
  assert.match(source,
    /playExplosion\([^\n]+['"]t2_grenade['"][\s\S]{0,220}psDecalTier:\s*'medium'[\s\S]{0,100}psDecalScale:\s*0\.50/,
    name + ' routes M2 impact to KHAOS T2 without changing its crater options');
  assert.match(source, /blastTier:\s*'t3_mortar60'/,
    name + ' preserves the M2 blast profile');
  assert.match(source, /persistentDecal:\s*true/,
    name + ' keeps a visible medium crater after the M2 animation');
}

assert.match(bridge,
  /const blastTier = \(opts && opts\.blastTier\) \|\| tier;[\s\S]{0,180}const visualOnly = !!\(opts && opts\.visualOnly\)/,
  'the renderer separates visual selection from blast/decal behavior');

assert.match(legacy,
  /playBulletImpact\(x, y, isMg\)[\s\S]{0,320}playExplosion\(x, y, 't1_12mm'/,
  'legacy bullet impact remains on KHAOS T1');
assert.match(bridge,
  /impact_rifle_[^\n]+[\s\S]{0,900}explosion_khaos_t1_12mm/,
  'RTwP bullet-impact sprites remain sourced from KHAOS T1');
assert.match(rtwp, /VFX\.addBulletImpact\(/,
  'RTwP shots still call the dedicated bullet-impact path');

console.log('VFX tier routing tests: OK');
