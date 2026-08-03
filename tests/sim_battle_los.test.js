/**
 * tests/sim_battle_los.test.js -- 実地形にもとづく視線判定(hasLos)の受入テスト
 *
 * これが入るまで MapApi の hasLos は常に true だった。その状態では
 * 「射線を避ける」「物陰に隠れる」が原理的に成立せず、§3.2 の側面機動・MGの射線・
 * §3.4 の「分隊長から2hex以内+LOSなら伝達1秒」が全て空回りしていた。
 *
 * No framework. Run with `node tests/sim_battle_los.test.js`.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

function loadInSandbox() {
  const root = path.join(__dirname, '..');
  const sandbox = { module: { exports: {} }, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  ['data.js', 'sim_battle_adapter.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
  });
  return sandbox;
}

const sandbox = loadInSandbox();
const SIM_TUNING = sandbox.SIM_TUNING;
const hexLine = sandbox.hexLine;
const makeHasLos = sandbox.makeHasLos;

let passCount = 0;
let failCount = 0;
const failures = [];

function check(cond, label) {
  if (cond) { passCount++; console.log('PASS: ' + label); }
  else { failCount++; failures.push(label); console.log('FAIL: ' + label); }
}

// 地形id: -1 VOID / 0 DIRT / 1 GRASS / 2 FOREST / 3 ROAD / 4 TOWN / 5 WATER
const DIRT = 0, FOREST = 2, TOWN = 4, VOID = -1;

function makeGrid(W, H, defaultId) {
  const grid = [];
  for (let q = 0; q < W; q++) {
    grid[q] = [];
    for (let r = 0; r < H; r++) grid[q][r] = { id: defaultId, cost: 1 };
  }
  return grid;
}

function setCell(grid, q, r, values) {
  grid[q][r] = Object.assign({}, grid[q][r], values);
}

function makeCellAt(grid, W, H) {
  return (hex) => {
    if (!hex || hex.q < 0 || hex.q >= W || hex.r < 0 || hex.r >= H) return null;
    const col = grid[hex.q];
    return col ? col[hex.r] : null;
  };
}

function hexDist(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

const W = 10, H = 10;
const forestBlock = SIM_TUNING.TERRAIN_SIGHT_BLOCK[FOREST];
const threshold = SIM_TUNING.LOS_BLOCK_THRESHOLD;

// --- 1. 開豁地は見通せる -----------------------------------------------------
{
  const grid = makeGrid(W, H, DIRT);
  const hasLos = makeHasLos(makeCellAt(grid, W, H));
  check(hasLos({ q: 0, r: 0 }, { q: 5, r: 0 }) === true, '開豁地は見通せる');
}

// --- 2. 建物は遮る -----------------------------------------------------------
{
  const grid = makeGrid(W, H, DIRT);
  setCell(grid, 3, 0, { id: TOWN });
  const hasLos = makeHasLos(makeCellAt(grid, W, H));
  check(hasLos({ q: 0, r: 0 }, { q: 5, r: 0 }) === false, '建物(TOWN)は視線を遮る');
}

// --- 3. 両端は数えないので、建物そのものは狙える -----------------------------
{
  const grid = makeGrid(W, H, DIRT);
  setCell(grid, 3, 0, { id: TOWN, building: { type: 'house' } });
  const hasLos = makeHasLos(makeCellAt(grid, W, H));
  check(hasLos({ q: 0, r: 0 }, { q: 3, r: 0 }) === true, '建物の手前までは見える（両端は数えない）');
}

// --- 4. 隣接は常に見える -----------------------------------------------------
{
  const grid = makeGrid(W, H, DIRT);
  setCell(grid, 1, 0, { id: TOWN, building: { type: 'house' } });
  const hasLos = makeHasLos(makeCellAt(grid, W, H));
  check(hasLos({ q: 0, r: 0 }, { q: 1, r: 0 }) === true, '隣接マスは中間が無いので常に見える');
}

// --- 5. 自分が林の中に居ても外は見える ---------------------------------------
{
  const grid = makeGrid(W, H, DIRT);
  setCell(grid, 0, 0, { id: FOREST });
  const hasLos = makeHasLos(makeCellAt(grid, W, H));
  check(hasLos({ q: 0, r: 0 }, { q: 5, r: 0 }) === true, '自分の居る林は自分の視線を遮らない');
}

// --- 6. 林は1枚なら透け、2枚で遮る（閾値は SIM_TUNING から算出） -------------
{
  const one = makeGrid(W, H, DIRT);
  setCell(one, 2, 0, { id: FOREST });
  const two = makeGrid(W, H, DIRT);
  setCell(two, 2, 0, { id: FOREST });
  setCell(two, 3, 0, { id: FOREST });

  check(makeHasLos(makeCellAt(one, W, H))({ q: 0, r: 0 }, { q: 5, r: 0 })
    === (forestBlock < threshold), '林1枚は透ける');
  check(makeHasLos(makeCellAt(two, W, H))({ q: 0, r: 0 }, { q: 5, r: 0 })
    === (forestBlock * 2 < threshold), '林2枚は遮る');
}

// --- 7. 盤外(VOID)は遮蔽物ではない -------------------------------------------
{
  const grid = makeGrid(W, H, DIRT);
  setCell(grid, 2, 0, { id: VOID, cost: 99 });
  const hasLos = makeHasLos(makeCellAt(grid, W, H), (cell) => !!cell && cell.id !== VOID);
  check(hasLos({ q: 0, r: 0 }, { q: 5, r: 0 }) === true, '盤外(VOID)は視線を遮らない');
}

// --- 8. cost>=99（建物フラグ無しの進入不可）も遮る ---------------------------
{
  const grid = makeGrid(W, H, DIRT);
  setCell(grid, 3, 0, { id: DIRT, cost: 99 });
  const hasLos = makeHasLos(makeCellAt(grid, W, H));
  check(hasLos({ q: 0, r: 0 }, { q: 5, r: 0 }) === false, 'cost>=99 のマスは視線を遮る');
}

// --- 9. 対称性: 見えるなら見られる -------------------------------------------
//
// hexLine の epsilon nudge は始点側にしか効かないため、素朴に実装すると
// a→b と b→a で通るマスが変わり「片側からだけ撃てる」不整合が起きる。
// makeHasLos が端点を正規化していることを、盤面の全ペアで確かめる。
{
  const grid = makeGrid(W, H, DIRT);
  let seed = 123456789;
  const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
  for (let q = 0; q < W; q++) {
    for (let r = 0; r < H; r++) {
      const roll = random();
      if (roll < 0.15) setCell(grid, q, r, { id: FOREST });
      else if (roll < 0.25) setCell(grid, q, r, { id: TOWN });
      else if (roll < 0.30) setCell(grid, q, r, { id: DIRT, cost: 99 });
    }
  }
  const hasLos = makeHasLos(makeCellAt(grid, W, H));

  let pairs = 0;
  let asymmetric = 0;
  let blockedPairs = 0;
  for (let q1 = 0; q1 < W; q1++) {
    for (let r1 = 0; r1 < H; r1++) {
      for (let q2 = 0; q2 < W; q2++) {
        for (let r2 = 0; r2 < H; r2++) {
          const a = { q: q1, r: r1 }, b = { q: q2, r: r2 };
          const ab = hasLos(a, b);
          pairs++;
          if (!ab) blockedPairs++;
          if (ab !== hasLos(b, a)) asymmetric++;
        }
      }
    }
  }
  check(asymmetric === 0, '全 ' + pairs + ' ペアで視線判定が対称（非対称 ' + asymmetric + ' 件）');
  // 遮蔽が一件も起きていないと上の対称性テストは無内容になるので前提を確認する
  check(blockedPairs > pairs * 0.1,
    '前提: 障害物入りの盤面で実際に視線が遮られている（' + blockedPairs + '/' + pairs + '）');
}

// --- 10. hexLine の健全性 ----------------------------------------------------
{
  const cases = [
    [{ q: 0, r: 0 }, { q: 5, r: 0 }],
    [{ q: 0, r: 0 }, { q: 0, r: 5 }],
    [{ q: 0, r: 0 }, { q: 5, r: -5 }],
    [{ q: 3, r: 2 }, { q: -2, r: 7 }],
    [{ q: 4, r: -2 }, { q: -1, r: -2 }],
    [{ q: 2, r: 3 }, { q: 2, r: 3 }],
  ];
  let lengthOk = true, endpointsOk = true, contiguousOk = true;
  cases.forEach((c) => {
    const a = c[0], b = c[1];
    const line = hexLine(a, b);
    if (line.length !== hexDist(a, b) + 1) lengthOk = false;
    if (line[0].q !== a.q || line[0].r !== a.r) endpointsOk = false;
    if (line[line.length - 1].q !== b.q || line[line.length - 1].r !== b.r) endpointsOk = false;
    for (let j = 1; j < line.length; j++) {
      if (hexDist(line[j - 1], line[j]) !== 1) contiguousOk = false;
    }
  });
  check(lengthOk, 'hexLine の長さが dist+1 になる');
  check(endpointsOk, 'hexLine の先頭と末尾が両端に一致する');
  check(contiguousOk, 'hexLine は隣接マスだけで繋がっている（飛びが無い）');
}

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
if (failCount) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
