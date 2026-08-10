/** Result/review loadout UI must be inspection-only. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const sidebar = fs.readFileSync(path.join(root, 'phaser_sidebar.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'phaser_bridge.js'), 'utf8');

assert.match(sidebar, /canEditLoadout\(\)[\s\S]*?game\.state === 'PLAY'/,
  'only live PLAY permits loadout edits');
assert.match(sidebar, /if \(this\.dragSrc \|\| !this\.canEditLoadout\(\)\) return;/,
  'slot pointer-down cannot create a review drag ghost');
assert.match(sidebar, /!this\.dragSrc \|\| this\.dragGhost \|\| !this\.canEditLoadout\(\)/,
  'slot pointer-up cannot mutate a frozen result');
assert.match(sidebar, /if \(!this\.canEditLoadout\(\)\) \{[\s\S]*?this\.dragGhost\.destroy\(\)/,
  'a drag crossing into a result state is cancelled and cleaned up');
assert.match(sidebar, /useHandCursor: this\.canEditLoadout\(\) && !!item/,
  'review slots no longer advertise themselves as draggable');
assert.match(bridge, /_battleReviewReadOnly[\s\S]*?state === 'REVIEW'/,
  'hand-card dragging is also blocked in the review façade');
assert.match(bridge, /onDragEnd[\s\S]*?if \(review\) \{ this\.returnToHand\(\); return; \}/,
  'a card drag crossing into review cannot equip or deploy');

console.log('battle_review_loadout_readonly: 4 passed');
