'use strict';

/**
 * HPゲージは戦場オブジェクトへオーバレイさせる（2026-08-05 ディレクター指摘:
 * 樹木の裏に隠れて負傷が読めない）。
 *
 * PS立体物は `depth = world Y` 規約でルート直下に置かれるので、ゲージ層の深度は
 * ワールドY（数百〜数千）を確実に超えている必要がある。逆に戦術ポーズ overlay
 * (phaser_tactical_pause.js の DEPTH) より上へ出てしまうと、ポーズ中の指揮図が
 * ゲージに刺される。この2つの不等式を固定する。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const bridge = fs.readFileSync(path.join(ROOT, 'phaser_bridge.js'), 'utf8');
const pause = fs.readFileSync(path.join(ROOT, 'phaser_tactical_pause.js'), 'utf8');

const declared = bridge.match(/const HP_OVERLAY_DEPTH\s*=\s*(\d+)/);
assert.ok(declared, 'phaser_bridge.js は HP_OVERLAY_DEPTH を定義する');
const hpDepth = Number(declared[1]);

assert.ok(/this\.hpGroup\.setDepth\(HP_OVERLAY_DEPTH\)/.test(bridge),
  'hpGroup は HP_OVERLAY_DEPTH を使う（生値の埋め込み禁止）');

// ワールド物より上。木・瓦礫・兵士本体・VFXの既知の深度をすべて超えること。
// （マーキー選択枠やゲート演出などのHUDは意図的にHPゲージより上なので除く）
const WORLD_LAYERS = ['hexGroup', 'decorGroup', 'unitGroup', 'rubbleFrontGroup',
  'treeGroup', 'crosshairGroup', 'vfxGraphics', 'overlayGraphics'];
WORLD_LAYERS.forEach((name) => {
  const hit = bridge.match(
    new RegExp('this\\.' + name + '\\s*=[^\\n]*?setDepth\\((-?\\d+(?:\\.\\d+)?)\\)'));
  assert.ok(hit, name + ' の深度指定を読めること');
  assert.ok(hpDepth > Number(hit[1]),
    'HPゲージ層は ' + name + ' より上: ' + hpDepth + ' vs ' + hit[1]);
});
// PS立体物の world Y 深度（マップ画素幅ぶん伸びる）にも余裕で勝つこと
assert.ok(hpDepth > 10000,
  'world Y 由来の深度（数千まで伸びる）を確実に超える: ' + hpDepth);

const pauseDepth = Number((pause.match(/const DEPTH\s*=\s*(\d+)/) || [])[1]);
assert.ok(Number.isFinite(pauseDepth), 'tactical pause の DEPTH を読めること');
assert.ok(hpDepth < pauseDepth,
  'ポーズ中の指揮図はHPゲージより上: ' + hpDepth + ' vs ' + pauseDepth);

console.log('hp_overlay_depth.test.js: passed');
