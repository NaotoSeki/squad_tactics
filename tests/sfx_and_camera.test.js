/**
 * tests/sfx_and_camera.test.js -- 射撃音ラウンドロビンと、カメラ可動域の基礎
 *
 * どちらもレビュー指摘（2026-07-31）で「直接検証するテストが無い」と指摘された箇所。
 *  - variantGroups と実ファイルの二重管理によるドリフト
 *  - 武器コードから音プロファイルへの解決（似た名前の別武器へ誤流用しないこと）
 *  - カメラ可動域を論理グリッド全体から作ると VOID へパンできてしまう問題
 *
 * No framework. Run with `node tests/sfx_and_camera.test.js`.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let passCount = 0;
let failCount = 0;
const failures = [];
function check(cond, label) {
  if (cond) { passCount++; console.log('PASS: ' + label); }
  else { failCount++; failures.push(label); console.log('FAIL: ' + label); }
}

// --- Sfx をブラウザ想定のままサンドボックスで読む -----------------------------
function loadSfx(documentOverrides) {
  const doc = Object.assign({ addEventListener() {}, hidden: false, visibilityState: 'visible' }, documentOverrides || {});
  const sandbox = { console: console, Math: Math, Date: Date, Object: Object,
    document: doc,
    AudioContext: function () { throw new Error('AudioContext must not start in this test'); } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'phaser_sound.js'), 'utf8'),
    sandbox, { filename: 'phaser_sound.js' });
  sandbox.Sfx.__testDocument = doc;
  return sandbox.Sfx;
}
const Sfx = loadSfx();
const { validHexExtent } = require(path.join(ROOT, 'sim_battle_adapter.js'));

// Soldier sheet direction contract: columns are S,SW,W,NW,N,NE,E,SE.
{
  const unitBox = { console: console };
  unitBox.window = unitBox;
  vm.createContext(unitBox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'phaser_unit.js'), 'utf8')
    + '\n;this.__UnitView = UnitView;', unitBox, { filename: 'phaser_unit.js' });
  const directionIndex = unitBox.__UnitView.prototype._directionIndex;
  const vectors = [[0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1]];
  check(vectors.every((v, i) => directionIndex.call({}, v[0], v[1]) === i),
    '兵士スプライト8方向が射撃対象の画面方向と一致する');

  unitBox.fetch = () => Promise.resolve({ ok: false });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'phaser_soldier_view.js'), 'utf8')
    + '\n;this.__soldierDirFromDelta = soldierDirFromDelta; this.__SoldierUnitView = SoldierUnitView;',
    unitBox, { filename: 'phaser_soldier_view.js' });
  // 方向行の正本は manifest.dirOrder で、その dirOrder 自体は実シートのピクセルから
  // tests/test_soldier_dir_order.py が検証する。ここで期待値を直書きすると、2026-08-03 に
  // 実際に起きたように「誰も測っていない順序」をテストが固定してしまう（撃ち合う二人が
  // 互いに逆を向いていても99%一致と報告された）。
  {
    const dirOrder = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'asset', 'sprites', 'soldier', 'manifest.json'), 'utf8')).dirOrder;
    const screenVec = { S: [0, 1], SE: [1, 1], E: [1, 0], NE: [1, -1],
                        N: [0, -1], NW: [-1, -1], W: [-1, 0], SW: [-1, 1] };
    check(dirOrder.every((name, row) => {
      const v = screenVec[name];
      return unitBox.__soldierDirFromDelta(v[0], v[1]) === row;
    }), '写実兵の方向計算が manifest.dirOrder（実シート実測）と一致する');
  }

  const muzzleView = Object.create(unitBox.__UnitView.prototype);
  muzzleView.visuals = new Map([
    ['A', { container: { x: 100, y: 100 }, postureLv: 0,
      sprite: { x: 0, y: 0, texture: { key: 'sold_stand_fire' } } }],
    ['B', { container: { x: 200, y: 100 } }],
  ]);
  const muzzle = muzzleView.getMuzzlePoint({ id: 'A', weapon: { class: 'rifle' } }, { id: 'B' });
  check(muzzle && muzzle.x > 106 && muzzle.y < 92,
    '写実兵の銃口は足元ではなく肩・銃身の高さから出る');

  const rtwpSource = fs.readFileSync(path.join(ROOT, 'logic_battle_rtwp.js'), 'utf8');
  const simBattleSource = fs.readFileSync(path.join(ROOT, 'sim_battle.html'), 'utf8');
  const simSceneSource = fs.readFileSync(path.join(ROOT, 'sim_scene.js'), 'utf8');
  const vfxSource = fs.readFileSync(path.join(ROOT, 'phaser_vfx.js'), 'utf8');
  check(rtwpSource.indexOf('VFX.addTracer(') === -1
    && simBattleSource.indexOf('tracer') === -1
    && simSceneSource.indexOf('tracer') === -1
    && vfxSource.indexOf('tracer') === -1,
    '本番・検証画面とも射撃時の射線ラインを生成しない');

  check(vfxSource.indexOf('playBulletImpactBurst') !== -1
    && vfxSource.indexOf("'impact_rifle_' + index") !== -1
    && rtwpSource.indexOf('VFX.addBulletImpact') !== -1
    && rtwpSource.indexOf('ev.roundsFired || 1') !== -1
    && simBattleSource.indexOf('VFX.addBulletImpact') !== -1
    && simBattleSource.indexOf('ev.roundsFired || 1') !== -1,
    '発射弾数ぶんの小さなアニメ着弾を本番・検証画面へ渡す');

  const soldierSource = fs.readFileSync(path.join(ROOT, 'phaser_soldier_view.js'), 'utf8');
  check(soldierSource.indexOf('s.engageTargetId || u._rtwpPendingTargetId') !== -1
    && soldierSource.indexOf('targetVisual.container.x - visual.container.x') !== -1,
    '兵士の向きは命令中または交戦中の対象を継続して追う');

  const soldierManifest = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'asset/sprites/soldier/manifest.json'), 'utf8'));
  const idleActions = ['stand_idle', 'kneel_idle', 'prone_idle'];
  check(idleActions.every((name) => {
    const action = soldierManifest.actions[name];
    return action && action.stride === 1 && action.frames === action.srcFrames;
  }), '待機アニメーションは元の全フレームを使う');

  const indexSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const bridgeSource = fs.readFileSync(path.join(ROOT, 'phaser_bridge.js'), 'utf8');
  check(indexSource.indexOf('width: calc(var(--sidebar-width, 340px) - 16px)') !== -1
    && bridgeSource.indexOf('if (main.mapGenerated && main.centerMap) main.centerMap();') !== -1,
    'ログ幅とマップ再フィットが右ペイン幅へ追随する');
  const minimapSource = fs.readFileSync(path.join(ROOT, 'phaser_minimap.js'), 'utf8');
  check(indexSource.indexOf('phaser_minimap.js') !== -1
    && bridgeSource.indexOf('this.tacticalMinimap.update()') !== -1
    && minimapSource.indexOf('TACTICAL MAP') !== -1,
    '本番ビューがクリック移動可能な戦術ミニマップを持つ');

  const sidebarSource = fs.readFileSync(path.join(ROOT, 'phaser_sidebar.js'), 'utf8');
  check(sidebarSource.indexOf('RTWP AMMO') !== -1
    && sidebarSource.indexOf('this.currentUnit._rtwpAmmo') !== -1,
    '右ペインにRTwP実弾倉と予備弾数をライブ表示する');

  const psObjectSource = fs.readFileSync(path.join(ROOT, 'phaser_ps_objects.js'), 'utf8');
  const ruralTerrainSource = fs.readFileSync(path.join(ROOT, 'phaser_terrain_rural_v29.js'), 'utf8');
  check(psObjectSource.indexOf('if (this.HD_ONLY) return null') !== -1
    && ruralTerrainSource.indexOf('L.HD_ONLY = true') !== -1,
    '本番PS立体物は低解像度canonicalへフォールバックしない');
}

// ===========================================================================
// 1. ラウンドロビン群と実ファイルの一致（二重管理のドリフト検出）
// ===========================================================================
{
  const groups = Object.keys(Sfx.variantGroups);
  check(groups.length > 0, '音源群が登録されている');

  let missing = [];
  groups.forEach((g) => {
    Sfx.variantKeys(g).forEach((k) => {
      if (!fs.existsSync(path.join(ROOT, Sfx.variantPathOf(k)))) missing.push(k);
    });
  });
  check(missing.length === 0, '登録された全テイクの実ファイルが存在する'
    + (missing.length ? '（欠落: ' + missing.join(',') + '）' : ''));

  // 各群の manifest（生成ツールの台帳）と突合。件数がズレたら気付けるようにする。
  groups.forEach((group) => {
    const prefix = Sfx.variantGroups[group].prefix;
    const mf = path.join(ROOT, 'asset/audio/sfx/' + prefix + '_manifest.json');
    check(fs.existsSync(mf), group + ' のmanifestが存在する');
    if (!fs.existsSync(mf)) return;
    const d = JSON.parse(fs.readFileSync(mf, 'utf8'));
    check(d.shots.length === Sfx.variantKeys(group).length,
      group + ' のmanifest採用数と登録テイク数が一致する (' + d.shots.length + ')');
  });
}

// ===========================================================================
// 2. 武器コード -> 音プロファイルの解決
// ===========================================================================
{
  check(Sfx.groupFor('m1') === 'm1_garand', 'm1 は m1_garand 群へ解決される');
  check(Sfx.groupFor('m1_garand') === 'm1_garand', 'プロファイル名を直接渡しても解決される');
  check(Sfx.groupFor('k98_scope') === 'kar98k', 'Kar98K系はkar98k実録群へ解決される');
  // 武器コードだけでは、名前が似ている別武器へM1音を流用しない。
  ['thompson', 'bar', 'm1911', 'mg42'].forEach((code) => {
    check(Sfx.groupFor(code) === null, code + ' は M1 の音を使わない');
  });
  check(Sfx.pickVariant('thompson') === null, '未登録の武器では null（合成音へフォールバック）');
  check(Sfx.soundIdForWeapon({ code: 'm1', class: 'rifle' }) === 'm1',
    'M1は自身の実録音へ解決される');
  check(Sfx.soundIdForWeapon({ code: 'pl_8', class: 'rifle' }) === 'm1',
    '個別音源が無い本編rifleも製品ビュー基準のM1実録音へ解決される');
  check(Sfx.soundIdForWeapon({ code: 'thompson', class: 'smg' }) === 'thompson',
    'SMGをrifle実録音へ誤分類しない');
  check(Sfx.soundIdForWeapon({ code: 'mg42', class: 'mg' }) === 'mg42_single',
    'MG42の単発設定はsingle実録へ解決される');
  check(Sfx.soundIdForWeapon({ code: 'mg42', class: 'mg', burstSize: 10 }, 'aimed') === 'mg42_burst',
    'MG42の通常射撃はburst実録へ解決される');
  check(Sfx.soundIdForWeapon({ code: 'mg42', class: 'mg', burstSize: 10 }, 'suppress') === 'mg42_auto',
    'MG42の制圧射撃はauto実録へ解決される');
  check(Sfx.soundIdForWeapon({ code: 'mg42', burst: 10 }, 'aimed') === 'mg42_burst',
    '旧ActionのWPNS形（burst）でもMG42 Burst実録へ解決される');
  check(Sfx.soundIdForWeapon({ code: 'mg42', burst: 10 }, 'suppress') === 'mg42_auto',
    '旧Actionの制圧射撃でもMG42 Auto実録へ解決される');
  check(Sfx.soundIdForWeapon({ code: 'bar', class: 'mg', burstSize: 10 }, 'suppress') === 'bar',
    '別の機関銃へMG42実録音を誤流用しない');
  check(Sfx.soundIdForWeapon({ code: 'k98_scope', class: 'sniper', burstSize: 1 }) === 'k98_scope',
    'Kar98Kは明示マッピング経由で実録群へ解決される');
}

// 非アクティブ中はAudioContextを作らず、再生予約を一切積まない。
{
  const hiddenSfx = loadSfx({ hidden: true, visibilityState: 'hidden' });
  let threw = false;
  try { hiddenSfx.play('m1', 'shot'); } catch (e) { threw = true; }
  check(!threw && hiddenSfx.ctx === null, 'hidden中はAudioContext初期化前に再生を破棄する');
}

// ===========================================================================
// 3. ラウンドロビンの性質
// ===========================================================================
{
  const list = Sfx.variantKeys('m1_garand');
  const n = list.length;
  const picks = [];
  for (let i = 0; i < n * 100; i++) picks.push(Sfx.pickVariant('m1'));

  check(picks.every((p) => list.indexOf(p) !== -1), '常に登録済みのテイクを返す');

  let dup = 0;
  for (let i = 1; i < picks.length; i++) if (picks[i] === picks[i - 1]) dup++;
  check(dup === 0, '直前と同じテイクが連続しない（袋の作り直しをまたいでも）');

  const count = {};
  picks.forEach((p) => { count[p] = (count[p] || 0) + 1; });
  const vals = Object.values(count);
  check(Math.min(...vals) === 100 && Math.max(...vals) === 100,
    '袋方式なので出現回数が完全に均等（各' + Math.min(...vals) + '回）');
}

// ===========================================================================
// 4. カメラ可動域の基礎: 実体のある hex だけを範囲にする
// ===========================================================================
function gridOf(cells, W, H) {
  const g = [];
  for (let q = 0; q < W; q++) {
    g[q] = [];
    for (let r = 0; r < H; r++) g[q][r] = { id: -1 };   // 既定は VOID
  }
  cells.forEach((c) => { g[c.q][c.r] = { id: c.id != null ? c.id : 1 }; });
  return { grid: g, W: W, H: H };
}

{
  // 20x20 の論理グリッドの中に、実体は 3x3 の島だけ
  const cells = [];
  for (let q = 7; q <= 9; q++) for (let r = 8; r <= 10; r++) cells.push({ q: q, r: r });
  const ext = validHexExtent(gridOf(cells, 20, 20));
  check(ext && ext.count === 9, '実体のある hex 数を数える');
  check(ext.minQ === 7 && ext.maxQ === 9 && ext.minR === 8 && ext.maxR === 10,
    '範囲が島の座標に一致する（論理グリッド全体にならない）');
  const spanQ = ext.maxQ - ext.minQ + 1;
  check(spanQ < 20, '論理グリッド(20)より狭い範囲が返る — VOIDへパンできない前提');
}

{
  check(validHexExtent(gridOf([], 5, 5)) === null, '実体が無ければ null を返す（呼び出し側でフォールバック）');
}

{
  // 実マップでの回帰: PS広域盤は 20x20 のうち120hexだけが実体
  let real = null;
  try {
    const sandbox = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} },
      Math: Math, JSON: JSON, location: { search: '' } };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    ['data.js', 'asset/environment/maps/ps_battlefields.js',
      'logic_map_rural_v29.js', 'sim_battle_adapter.js'].forEach((f) => {
      vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
    });
    real = sandbox.validHexExtent(sandbox.buildPsBattleMap());
  } catch (e) { /* 生成できない環境ではスキップ */ }
  if (real) {
    check(real.count >= 120 && real.count < 180,
      'PS実マップの実体hexは論理グリッド(400)よりはるかに少ない (' + real.count + ')');
    check((real.maxQ - real.minQ + 1) <= 20 && (real.maxR - real.minR + 1) <= 20,
      'PS実マップの範囲が論理グリッド内に収まる');
  }
}

{
  const doc = { hidden: false, visibilityState: 'visible', addEventListener() {} };
  const guarded = loadSfx(doc);
  let stopped = 0, disconnected = 0, suspended = 0, phaserStopped = 0;
  guarded._activeNodes.add({
    stop() { stopped++; },
    disconnect() { disconnected++; },
  });
  guarded.ctx = { state: 'running', suspend() { suspended++; this.state = 'suspended'; } };
  guarded._stopPhaserSounds = () => { phaserStopped++; };
  const oldEpoch = guarded.captureEpoch();
  guarded.__testDocument.hidden = true; guarded.__testDocument.visibilityState = 'hidden';
  guarded._handleVisibilityChange();
  check(stopped === 1 && disconnected === 1 && guarded._activeNodes.size === 0,
    'hidden transition stops and discards active synth nodes');
  check(suspended === 1 && phaserStopped === 1,
    'hidden transition stops both AudioContext and Phaser WAV sounds');

  guarded.__testDocument.hidden = false; guarded.__testDocument.visibilityState = 'visible';
  guarded._handleVisibilityChange();
  check(guarded.captureEpoch() !== oldEpoch && guarded._canPlay(oldEpoch) === false,
    'an Action from before deactivation cannot play after resume');
  check(guarded._canPlay() === false,
    'resume guard rejects timers flushed immediately after visibility returns');
}

{
  const guarded = loadSfx({ hidden: false, visibilityState: 'visible' });
  let phaserStopped = 0;
  guarded._stopPhaserSounds = () => { phaserStopped++; };
  guarded.bindLifecycle();
  const oldEpoch = guarded.captureEpoch();
  guarded._blurBound();
  check(guarded.isPageActive() === false && phaserStopped === 1,
    'window blur immediately marks the page inactive and stops WAV sounds');
  guarded._focusBound();
  check(guarded.isPageActive() === true && guarded.captureEpoch() !== oldEpoch,
    'window focus starts a fresh audio generation');
  check(guarded._canPlay(oldEpoch) === false && guarded._canPlay() === false,
    'blur-era callbacks and focus-time timer bursts are rejected');
}

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
if (failCount) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
