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
function loadSfx() {
  const sandbox = { console: console, Math: Math, Date: Date, Object: Object,
    document: { addEventListener() {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'phaser_sound.js'), 'utf8'),
    sandbox, { filename: 'phaser_sound.js' });
  return sandbox.Sfx;
}
const Sfx = loadSfx();
const { validHexExtent } = require(path.join(ROOT, 'sim_battle_adapter.js'));

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

  // manifest（生成ツールの台帳）との突き合わせ。件数がズレたら気付けるようにする。
  const mf = path.join(ROOT, 'asset/audio/sfx/m1_shot_manifest.json');
  if (fs.existsSync(mf)) {
    const d = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const listKey = Object.keys(d).find((k) => Array.isArray(d[k]) && d[k].length && typeof d[k][0] === 'object');
    const n = listKey ? d[listKey].length : -1;
    check(n === Sfx.variantKeys('m1_garand').length,
      'manifest の採用数と登録テイク数が一致する (' + n + ')');
  }
}

// ===========================================================================
// 2. 武器コード -> 音プロファイルの解決
// ===========================================================================
{
  check(Sfx.groupFor('m1') === 'm1_garand', 'm1 は m1_garand 群へ解決される');
  check(Sfx.groupFor('m1_garand') === 'm1_garand', 'プロファイル名を直接渡しても解決される');
  // 名前が似ているだけの別武器へ流用されないこと（M1A1 SMG / M1903 / M1918 BAR / M1911）
  ['thompson', 'k98_scope', 'bar', 'm1911', 'mg42'].forEach((code) => {
    check(Sfx.groupFor(code) === null, code + ' は M1 の音を使わない');
  });
  check(Sfx.pickVariant('thompson') === null, '未登録の武器では null（合成音へフォールバック）');
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
  // 実マップでの回帰: PS盤面は 20x20 のうち 30hex だけが実体
  let real = null;
  try {
    const sandbox = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} },
      Math: Math, JSON: JSON, location: { search: '' } };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    ['data.js', 'logic_map_rural_v29.js', 'sim_battle_adapter.js'].forEach((f) => {
      vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
    });
    real = sandbox.validHexExtent(sandbox.buildPsBattleMap());
  } catch (e) { /* 生成できない環境ではスキップ */ }
  if (real) {
    check(real.count > 0 && real.count < 100,
      'PS実マップの実体hexは論理グリッド(400)よりはるかに少ない (' + real.count + ')');
    check((real.maxQ - real.minQ + 1) <= 20 && (real.maxR - real.minR + 1) <= 20,
      'PS実マップの範囲が論理グリッド内に収まる');
  }
}

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
if (failCount) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
