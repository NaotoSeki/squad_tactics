/**
 * Static contract for the RTwP decisive-shot accent.
 * Run with: node tests/final_shot_audio_accent.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const sfx = fs.readFileSync(path.join(root, 'phaser_sound.js'), 'utf8');
const battle = fs.readFileSync(path.join(root, 'logic_battle_rtwp.js'), 'utf8');

assert.match(sfx, /finalShotAccent\(\)/, 'Sfx exposes a dedicated decisive-shot accent');
assert.match(sfx, /createDelay\(0\.25\)/, 'accent uses a bounded Web Audio delay node');
assert.match(sfx, /delay\.delayTime\.setValueAtTime\(0\.105/, 'accent is a short 105ms reflection');
assert.match(sfx, /distance\.type = 'lowpass'/, 'reflection darkens with distance');
assert.match(sfx, /gain\.gain\.setValueAtTime\(0\.075/, 'reflection stays substantially quieter than the shot');
assert.match(battle, /!this\._finalShotAccentPlayed && ev\.killed && result/, 'accent is gated to a final killing shot');
assert.match(battle, /result\.winner === sh\.team/, 'accent only plays for the winning side');
assert.match(battle, /window\.Sfx\.finalShotAccent\(\)/, 'RTwP dispatch triggers the dedicated accent');

console.log('final_shot_audio_accent: 8 passed');
