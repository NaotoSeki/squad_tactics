/**
 * tests/sim_policy_cover.test.js -- 自動Cover（反射）の受入テスト
 *
 * TraitPolicy.decide() を直接叩く。SimCore は currentOrder があれば decide を
 * 呼ばないので、「命令を上書きしない」性質は sim_core 側の構造で担保されている
 * （ここでは decide 単体の判断だけを検証する）。
 *
 * No framework. Run with `node tests/sim_policy_cover.test.js`.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const { TraitPolicy, TRAIT_MODS } = require(path.join(__dirname, '..', 'sim_policy.js'));

function loadDataJs() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const exposeTail = '\n;this.WPNS = WPNS; this.SIM_TUNING = SIM_TUNING;\n';
  const sandbox = { module: { exports: {} }, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + exposeTail, sandbox, { filename: 'data.js' });
  return sandbox;
}
const SIM_TUNING = loadDataJs().SIM_TUNING;

let passCount = 0;
let failCount = 0;
const failures = [];

function check(cond, label) {
  if (cond) { passCount++; console.log('PASS: ' + label); }
  else { failCount++; failures.push(label); console.log('FAIL: ' + label); }
}

const NEIGHBORS = [
  { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 },
  { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 1 },
];

/** coverMap: "q,r" -> cover(0..1)。未登録は defaultCover。 */
function makeMap(coverMap, defaultCover, blocked) {
  const key = (h) => h.q + ',' + h.r;
  return {
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    },
    hasLos: () => true,
    cover: (h) => (coverMap[key(h)] != null ? coverMap[key(h)] : defaultCover),
    moveCost: (from, to) => ((blocked && blocked[key(to)]) ? Infinity : 1),
    neighbors: (h) => NEIGHBORS.map((d) => ({ q: h.q + d.q, r: h.r + d.r })),
  };
}

function makeSoldier(over) {
  return Object.assign({
    id: 'a1', team: 'A', q: 0, r: 0,
    weapon: { rngMax: 10, cls: 'rifle' },
    traits: [], hp: 100, state: 'idle', suppression: 60, morale: 100,
    movePath: null, currentOrder: null,
  }, over || {});
}

function decide(soldier, map) {
  return TraitPolicy.decide(soldier, { soldiers: [soldier], map: map, tuning: SIM_TUNING }, () => 0.5);
}

// --- 1. 制圧され露出していれば、より濃い遮蔽へ退避する -----------------------
{
  const map = makeMap({ '0,0': 0.1, '1,0': 0.8 }, 0.1);
  const out = decide(makeSoldier(), map);
  check(out.type === 'MOVE_TO', '被制圧+露出 => MOVE_TO を自発する');
  check(out.payload && out.payload.path && out.payload.path.length === 1,
    'payload.path は1マスの配列（sim_core が movePath へ入れる形）');
  check(out.payload.path[0].q === 1 && out.payload.path[0].r === 0,
    '最も遮蔽の濃い隣接マスを選ぶ');
}

// --- 2. すでに十分な遮蔽に居るなら動かない -----------------------------------
{
  const map = makeMap({ '0,0': 0.7, '1,0': 0.9 }, 0.1);
  const out = decide(makeSoldier(), map);
  check(out.type !== 'MOVE_TO', '十分な遮蔽に居るなら退避しない（右往左往させない）');
}

// --- 3. わずかな改善では動かない（MIN_GAIN） ---------------------------------
{
  const map = makeMap({ '0,0': 0.1, '1,0': 0.15 }, 0.1);
  const out = decide(makeSoldier(), map);
  check(out.type !== 'MOVE_TO', '改善が COVER_SEEK_MIN_GAIN 未満なら動かない');
}

// --- 4. PINNED 以上は伏せたまま動かない --------------------------------------
{
  const map = makeMap({ '0,0': 0.1, '1,0': 0.9 }, 0.1);
  const out = decide(makeSoldier({ suppression: SIM_TUNING.PINNED_AT + 5 }), map);
  check(out.type !== 'MOVE_TO', 'PINNED 以上では開けた地面を走らない');
}

// --- 5. 制圧されていなければ反射は起きない -----------------------------------
{
  const map = makeMap({ '0,0': 0.1, '1,0': 0.9 }, 0.1);
  const out = decide(makeSoldier({ suppression: 0 }), map);
  check(out.type !== 'MOVE_TO', '非制圧時は自発退避しない');
}

// --- 6. timid は竦んで動けない（SS13 の FREEZE_AT_SUPPRESSION） --------------
{
  const map = makeMap({ '0,0': 0.1, '1,0': 0.9 }, 0.1);
  const out = decide(makeSoldier({ traits: ['timid'] }), map);
  check(out.type !== 'MOVE_TO', 'timid は制圧下で自発行動が止まる');
}

// --- 7. cautious は薄い遮蔽へは退避しない ------------------------------------
{
  const thin = TRAIT_MODS.cautious.MIN_SELF_MOVE_COVER - 0.05;
  const map = makeMap({ '0,0': 0.0, '1,0': thin }, 0.0);
  const out = decide(makeSoldier({ traits: ['cautious'] }), map);
  check(out.type !== 'MOVE_TO', 'cautious は MIN_SELF_MOVE_COVER 未満へは退避しない');

  const map2 = makeMap({ '0,0': 0.0, '1,0': 0.9 }, 0.0);
  const out2 = decide(makeSoldier({ traits: ['cautious'] }), map2);
  check(out2.type === 'MOVE_TO', 'cautious でも十分濃い遮蔽へは退避する');
}

// --- 8. 進入不可マスは選ばない -----------------------------------------------
{
  const map = makeMap({ '0,0': 0.1, '1,0': 0.9, '0,1': 0.6 }, 0.1, { '1,0': true });
  const out = decide(makeSoldier(), map);
  check(out.type === 'MOVE_TO' && out.payload.path[0].q === 0 && out.payload.path[0].r === 1,
    '進入不可(moveCost=Infinity)は除外し次善のマスを選ぶ');
}

// --- 9. 移動中は割り込まない -------------------------------------------------
{
  const map = makeMap({ '0,0': 0.1, '1,0': 0.9 }, 0.1);
  const out = decide(makeSoldier({ state: 'move', movePath: [{ q: 5, r: 5 }] }), map);
  check(out.type !== 'MOVE_TO', '移動中の経路へ割り込まない');
}

// --- 10. neighbors を持たないマップでも落ちない ------------------------------
{
  const bare = { dist: () => 1, hasLos: () => true, cover: () => 0.1 };
  let threw = false;
  let out = null;
  try { out = decide(makeSoldier(), bare); } catch (e) { threw = true; }
  check(!threw && out && out.type !== 'MOVE_TO',
    'neighbors 未実装のマップでは例外を出さず退避もしない');
}

// ===========================================================================
// SimCore 統合: 射撃命令が立っていても自衛は割り込めること
//
// TARGET は一度も消費されず永続するため、これが効かないと「一度撃てと言われた
// 兵士は以後永久に自己判断せず、撃たれても遮蔽へ移らない」状態になる。
// 実機(sim_battle)で10名中9名がこの状態だったのが発見の経緯。
// ===========================================================================
const { SimCore, mulberry32, toSimWeapon } = require(path.join(__dirname, '..', 'sim_core.js'));
const { CommsOrders } = require(path.join(__dirname, '..', 'sim_orders.js'));

function loadWpns() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const sandbox = { module: { exports: {} }, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;this.WPNS = WPNS;\n', sandbox, { filename: 'data.js' });
  return sandbox.WPNS;
}
const WPNS = loadWpns();

/** 露出hex(0.05)の隣に濃い遮蔽(0.9)を1つ置いたマップ。 */
function exposedMap() {
  return makeMap({ '0,0': 0.05, '1,0': 0.9 }, 0.05);
}

function buildSim(orderType) {
  const map = exposedMap();
  const sim = new SimCore({
    map: map, tuning: SIM_TUNING, rng: mulberry32(7), policy: TraitPolicy,
  });
  sim.orders = new CommsOrders({
    getSoldier: (id) => sim.getSoldier(id),
    soldiers: () => sim.soldiers(),
    map: map, tuning: SIM_TUNING,
  });
  const w = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: w, traits: [], isLeader: true });
  sim.addSoldier({ id: 'b1', team: 'B', q: 6, r: 0, weapon: w, traits: [] });

  if (orderType === 'TARGET') {
    sim.issueOrder({ type: 'TARGET', soldierIds: ['a1'], payload: { targetId: 'b1', mode: 'aimed' } });
  } else if (orderType === 'MOVE_TO') {
    sim.issueOrder({ type: 'MOVE_TO', soldierIds: ['a1'], payload: { path: [{ q: 0, r: 3 }] } });
  }
  // 命令が伝達されるまで回す。到達判定のため経路をこの段階から記録する
  // （ウォームアップ中に命令先へ着いてしまうため、後半だけ見ると見落とす）
  sim._trail = [];
  for (let i = 0; i < 40; i++) {
    const c = sim._soldiers.get('a1');
    sim._trail.push(c.q + ',' + c.r);
    sim.tick();
  }
  return sim;
}

/**
 * a1 を撃たれ続けている状態で回し、**生成位置(0,0 / 遮蔽0.05)から遮蔽が改善したか**を見る。
 *
 * 検証を movePath の残存にしないこと: 隣接1マスの移動は1tickで完走するため
 * サンプル時点では空配列に戻っている。また新トリガ（撃たれた時刻）は反応が早く、
 * ウォームアップ中に退避が完了してしまう。よって「どこから撃たれ始めたか」ではなく
 * 「生成位置と比べて濃い遮蔽に居るか」で判定する（2026-07-30、両方で一度誤って落ちた）。
 */
const SPAWN_HEX = { q: 0, r: 0 };

function runUnderFire(sim) {
  const spawnCover = sim.map.cover(SPAWN_HEX);
  const visited = (sim._trail || []).slice();
  for (let i = 0; i < 30; i++) {
    const cur = sim._soldiers.get('a1');
    visited.push(cur.q + ',' + cur.r);
    if (cur.suppression < SIM_TUNING.PINNED_AT) {
      cur.suppression = (SIM_TUNING.COVER_SEEK_AT + SIM_TUNING.PINNED_AT) / 2;
    }
    sim.tick();
  }
  const end = sim._soldiers.get('a1');
  return {
    s: end,
    spawnCover: spawnCover,
    endCover: sim.map.cover({ q: end.q, r: end.r }),
    relocated: end.q !== SPAWN_HEX.q || end.r !== SPAWN_HEX.r,
    visited: visited,
    reached: (hex) => visited.indexOf(hex.q + ',' + hex.r) !== -1,
  };
}

{
  const sim = buildSim('TARGET');
  const before = sim._soldiers.get('a1');
  check(before.currentOrder && before.currentOrder.type === 'TARGET',
    'TARGET 命令が実際に立っている（前提確認）');
  const r = runUnderFire(sim);
  check(r.relocated && r.endCover > r.spawnCover,
    'TARGET 命令下でも、撃たれて露出していれば遮蔽へ退避する');
  check(r.s.lastPolicyNote && r.s.lastPolicyNote.indexOf('遮蔽') !== -1,
    '退避が POLICY ノートとして可視化される');
}

{
  // MOVE_TO 中は自衛が割り込まないこと。命令先は遮蔽の薄い (0,3)。
  // 検証は「命令先へ到達したか」で行う — 到達**後**に自衛が発動して濃い遮蔽へ
  // 移るのは命令の中断ではなく完了後の自己判断なので、最終位置では判定できない。
  const sim = buildSim('MOVE_TO');
  const r = runUnderFire(sim);
  check(r.reached({ q: 0, r: 3 }),
    'MOVE_TO 命令は自衛に中断されず命令先へ到達する');
}

{
  const sim = buildSim(null);
  const r = runUnderFire(sim);
  check(r.relocated && r.endCover > r.spawnCover,
    '無命令でも従来通り退避する（decide 経路の回帰確認）');
}

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
if (failCount) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
