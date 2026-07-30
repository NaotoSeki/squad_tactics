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

// ===========================================================================
// 経路途中の露出リスク（2026-07-31）
//
// 移動中の目標は hex の遮蔽を享受しない（sim_core の射撃解決で遮蔽乗算が
// PHIT_MOVING_MULT に置き換わる）ため、退避経路の安全性は LOS だけで決まる。
// §3.2 殺傷ベクトル4「開豁地移動への持続射撃 = MGの存在意義」の policy 側の対。
//
// decide() は soldiers:[自分] しか渡さない = 敵が居ないので、既存テストは
// 露出コスト0のまま回帰しない。敵を置くテストは preserve() を直接叩く。
// ===========================================================================

function preserve(soldier, map, others) {
  return TraitPolicy.selfPreserve(
    soldier,
    { soldiers: [soldier].concat(others || []), map: map, tuning: SIM_TUNING, tick: 0 },
    () => 0.5
  );
}

function sameHex(a, q, r) {
  return a && a.q === q && a.r === r;
}

function mgWeight() {
  const weights = SIM_TUNING.COVER_SEEK_EXPOSURE_WEIGHT || {};
  return weights.mg != null ? weights.mg : (weights.default != null ? weights.default : 1);
}

function exposureCost() {
  return SIM_TUNING.COVER_SEEK_EXPOSURE_COST != null ? SIM_TUNING.COVER_SEEK_EXPOSURE_COST : 0.05;
}

function pinnedShooterFactor() {
  const factors = SIM_TUNING.PHIT_SHOOTER_SUPPRESSED_PINNED || {};
  return factors.pinned != null ? factors.pinned : 1;
}

function mg(id, q, r, state) {
  return {
    id: id, team: 'B', q: q, r: r, hp: 100,
    state: state || 'engage', weapon: { class: 'mg' }, suppression: 0,
  };
}

const testCoverSeekAt = SIM_TUNING.COVER_SEEK_AT != null ? SIM_TUNING.COVER_SEEK_AT
  : (SIM_TUNING.SUPPRESSED_AT != null ? SIM_TUNING.SUPPRESSED_AT : 50);
const testPinnedAt = SIM_TUNING.PINNED_AT != null ? SIM_TUNING.PINNED_AT : 80;
const testSeekGain = SIM_TUNING.COVER_SEEK_MIN_GAIN != null ? SIM_TUNING.COVER_SEEK_MIN_GAIN : 0.2;

// --- 11. 敵がいなければ露出は常に0で、従来どおり畑(0.15)→林(0.35)へ退避する ---
{
  const m = makeMap({ '0,0': 0.15, '1,0': 0.35 }, 0.15);
  const out = preserve(makeSoldier({ suppression: testCoverSeekAt }), m, []);
  check(out && out.type === 'MOVE_TO' && sameHex(out.payload.path[0], 1, 0),
    '敵がいなければ従来どおり退避する（露出評価の回帰）');
  check(out && out.note.indexOf('死角') === -1,
    '露出を評価していない時に「死角伝い」を名乗らない');
}

// --- 12. 1マス退避は「渡る地面」が無いので、見られていても常に成立する ---
//
// 実マップで最も自然な退避である 畑(0.15)→森林(0.25) は MIN_GAIN 込みで余裕ゼロ。
// 到達マスにも露出コストを課していた版では、見られている限りこれが永久に不可能で、
// 兵士は畑に伏せたまま動けなかった（2026-07-31 実マップで発見）。回帰防止。
{
  const here = 0.15, dest = here + testSeekGain;   // 余裕ゼロの最悪ケース
  const m = makeMap({ '0,0': here, '1,0': dest }, here);
  m.hasLos = () => true;   // 全方位から丸見え
  const out = preserve(makeSoldier({ suppression: testCoverSeekAt }), m, [mg('b1', 3, 0)]);
  check(out && out.type === 'MOVE_TO' && sameHex(out.payload.path[0], 1, 0),
    '隣接1マスへの退避は露出コストで妨げられない（渡る地面が無い）');
}

// --- 13. 2マス経路の中継地が見られている側を避け、死角側の同価値の退避先を選ぶ ---
//
// (2,0) は (1,0) 経由でしか、(-2,0) は (-1,0) 経由でしか届かない。MGは (1,0) だけ
// を射界に収めているので、遮蔽が同じなら死角側の (-2,0) が選ばれるはず。
{
  const dest = 0.30;
  const m = makeMap({ '0,0': 0, '2,0': dest, '-2,0': dest }, 0);
  m.hasLos = (a, b) => {
    if (sameHex(a, 0, 0) && sameHex(b, 5, 0)) return true;  // 敵が見えている
    if (sameHex(a, 5, 0) && sameHex(b, 1, 0)) return true;  // 中継地(1,0)が射線上
    return false;
  };
  const out = preserve(makeSoldier({ suppression: testCoverSeekAt }), m, [mg('b1', 5, 0)]);
  check(out && out.type === 'MOVE_TO' && out.payload.path.length === 2
    && sameHex(out.payload.path[1], -2, 0),
    'MGの射界に入る中継地を避け、死角側の経路を選ぶ');
}

// --- 14. 唯一の2マス経路の中継地へMG3挺の射線が通れば、渡らず伏せたままになる ---
{
  const dest = 0.30;
  const m = makeMap({ '0,0': 0, '2,0': dest }, 0);
  const enemies = [mg('b1', 5, 0), mg('b2', 5, 1), mg('b3', 4, 1)];
  m.hasLos = () => true;
  const risk = 3 * mgWeight();   // 中継地(1,0)を3挺が見ている
  check(dest - exposureCost() * risk < testSeekGain, '前提: 露出コストで価値が要求を割る');
  const out = preserve(makeSoldier({ suppression: testCoverSeekAt }), m, enemies);
  check(out === null, '見られすぎた開豁地は渡らず伏せたままになる');
}

// --- 15. 経路が全マス死角なら、退避ノートに「死角」が現れる ---
{
  const dest = 0.30;
  const m = makeMap({ '0,0': 0, '2,0': dest }, 0);
  m.hasLos = (a, b) => sameHex(a, 0, 0) && sameHex(b, 5, 0);   // 敵は見えるが射線は通らない
  const out = preserve(makeSoldier({ suppression: testCoverSeekAt }), m, [mg('b1', 5, 0)]);
  check(out && out.type === 'MOVE_TO' && out.note.indexOf('死角') !== -1,
    '死角を通る退避はノートで区別される');
}

// --- 16. PINNED は匍匐が遅いぶん、這って入る先の射線も危険として数える ---
//
// PINNED は maxSteps=1 なので通過マスが存在しない。到達マスを数えなければ露出評価が
// まったく効かなくなるため、伏射前進のときだけ到達マスも算入する（includeDest）。
{
  const penalty = exposureCost() * mgWeight();
  const dest = testSeekGain + penalty * 0.5;   // 到達マスを数えなければ通り、数えると落ちる
  const m = makeMap({ '0,0': 0, '1,0': dest }, 0);
  m.hasLos = () => true;
  const normal = preserve(
    makeSoldier({ suppression: Math.max(testCoverSeekAt, testPinnedAt - 1) }), m, [mg('b1', 3, 0)]);
  const whenPinned = preserve(
    makeSoldier({ suppression: testPinnedAt }), m, [mg('b1', 3, 0)]);
  check(normal && normal.type === 'MOVE_TO', '前提: PINNED未満なら1マス先の遮蔽へ退避する');
  check(whenPinned === null, 'PINNED では見られている隣のマスへは這わない');
}

// --- 17. hasLos 未実装のマップでは露出評価を諦め、従来どおり退避する ---
{
  const dest = testSeekGain;
  const m = makeMap({ '0,0': 0, '1,0': dest }, 0);
  delete m.hasLos;
  let out = null;
  let threw = false;
  try { out = preserve(makeSoldier({ suppression: testCoverSeekAt }), m, [mg('b1', 3, 0)]); }
  catch (e) { threw = true; }
  check(!threw && out && out.type === 'MOVE_TO',
    'hasLos 未実装でも例外を出さず従来動作へ degrade する');
}

// --- 18. 同じMGでも制圧されていれば脅威が軽くなり、渡れなかった経路が渡れる ---
{
  const penalty = exposureCost() * mgWeight();
  // 等倍の脅威では割に合わず、pinned 係数を掛けた脅威なら通る高さに置く
  const dest = testSeekGain + (penalty + penalty * pinnedShooterFactor()) / 2;
  const m = makeMap({ '0,0': 0, '2,0': dest }, 0);
  m.hasLos = () => true;
  const s = makeSoldier({ suppression: testCoverSeekAt });
  const vsEngaging = preserve(s, m, [mg('b1', 5, 0, 'engage')]);
  const vsPinned = preserve(s, m, [mg('b1', 5, 0, 'pinned')]);
  check(vsEngaging === null, '前提: 撃ってくるMGの射界は渡らない');
  check(vsPinned && vsPinned.type === 'MOVE_TO',
    '制圧されたMGの射界なら渡る（脅威が PHIT_SHOOTER_SUPPRESSED_PINNED 倍に減る）');
}

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
if (failCount) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
