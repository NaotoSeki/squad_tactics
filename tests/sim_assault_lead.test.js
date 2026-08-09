/**
 * tests/sim_assault_lead.test.js -- 強襲の迎撃（未来位置予測）
 *
 * 「目標が移動してる場合、強襲AIが古い過去位置めがけて移動しちゃう」
 * （2026-08-04 ディレクター指摘）への受け入れテスト。
 *
 * 追う側は目標の**実位置**ではなく、自分が着く頃に相手が居るであろう
 * **迎撃点**へ足を向ける。射撃・投擲・白兵・掃討地点は実位置のままで、
 * 変わるのは移動先だけ — その線引きも含めてここで固定する。
 *
 * No framework. Run with `node tests/sim_assault_lead.test.js`. Exits 0 on all-PASS.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const { SimCore, mulberry32, toSimWeapon, InstantOrders } =
  require(path.join(__dirname, '..', 'sim_core.js'));
const { TraitPolicy } = require(path.join(__dirname, '..', 'sim_policy.js'));

function loadDataJs() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const exposeTail = '\n;this.WPNS = WPNS; this.SIM_TUNING = SIM_TUNING;\n';
  const sandbox = { module: { exports: {} }, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data', 'wpns_pl_master.js'), 'utf8'),
    sandbox, { filename: 'wpns_pl_master.js' });
  vm.runInContext(exposeTail, sandbox, { filename: 'expose' });
  return sandbox;
}
const dataSandbox = loadDataJs();
const WPNS = dataSandbox.WPNS;
const SIM_TUNING = dataSandbox.SIM_TUNING;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (detail ? '  [' + detail + ']' : '')); }
}

// --- 一様な平地。地形要因を排して「追い方」だけを測る -----------------------
function hexDist(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}
function flatMap(blocked) {
  const isBlocked = (h) => !!(blocked && blocked.some((b) => b.q === h.q && b.r === h.r));
  return {
    dist: hexDist,
    hasLos: () => true,
    cover: () => 0,
    moveCost: (from, to) => (isBlocked(to || from) ? Infinity : 1),
    neighbors: (h) => [
      { q: h.q + 1, r: h.r }, { q: h.q - 1, r: h.r },
      { q: h.q, r: h.r + 1 }, { q: h.q, r: h.r - 1 },
      { q: h.q + 1, r: h.r - 1 }, { q: h.q - 1, r: h.r + 1 },
    ],
  };
}
function rifle() { return toSimWeapon('m1', WPNS.m1 || { rng: 8, burst: 1, cap: 8 }, SIM_TUNING); }

function makeSim(tuningOverrides, opts) {
  opts = opts || {};
  return new SimCore({
    map: flatMap(opts.blocked),
    tuning: Object.assign({}, SIM_TUNING, tuningOverrides || {}),
    rng: mulberry32(opts.seed || 777),
    policy: TraitPolicy,
    orders: new InstantOrders(),
  });
}

/** 弾を持たない兵（撃ち合いで足が止まらないので、詰め方だけを観察できる） */
function addDrySoldier(sim, id, team, q, r) {
  sim.addSoldier({
    id: id, team: team, q: q, r: r, weapon: rifle(), ammo: { mags: 0 },
    attrs: { speed: 5, recon: 5, str: 5, melee: 5 },
  });
  const s = sim._soldiers.get(id);
  s.magRemaining = 0; s.magsLeft = 0;
  return s;
}

/** 全滅で tick が止まらないよう、遠方に両軍1名ずつ置く */
function addBystanders(sim) {
  addDrySoldier(sim, '_watchA', 'A', -60, 0);
  addDrySoldier(sim, '_watchB', 'B', 120, 0);
}

function straightPath(n) {
  const p = [];
  for (let i = 1; i <= n; i++) p.push({ q: i, r: 0 });
  return p;
}

/** 途中で直角に曲がる経路（+q へ n/2、そこから +r へ n/2） */
function elbowPath(n) {
  const p = [];
  const half = Math.floor(n / 2);
  for (let i = 1; i <= half; i++) p.push({ q: i, r: 0 });
  for (let i = 1; i <= half; i++) p.push({ q: half, r: i });
  return p;
}

/** runner を走らせ、hunter に強襲させて、接敵(MELEE_START)までの tick を返す */
function timeToContact(lead, hunterHex, runnerPath, limit) {
  const sim = makeSim({ ASSAULT_LEAD_MAX_T: lead });
  addDrySoldier(sim, 'runner', 'B', 0, 0);
  addDrySoldier(sim, 'hunter', 'A', hunterHex.q, hunterHex.r);
  addBystanders(sim);
  sim.issueOrder({
    type: 'MOVE_TO', soldierIds: ['runner'],
    payload: { path: runnerPath.slice(), mode: 'rush', selfInitiated: true },
  });
  sim.issueOrder({ type: 'ASSAULT', soldierIds: ['hunter'], payload: { targetId: 'runner' } });
  for (let t = 1; t <= limit; t++) {
    sim.tick();
    const hit = sim.drainEvents().some((e) => e.type === 'MELEE_START' && e.id === 'hunter');
    if (hit) return t;
  }
  return null;
}

/** runner を n tick 走らせて速度履歴を作る。sim と両者の内部オブジェクトを返す */
function runUntilMoving(tuningOverrides, opts) {
  opts = opts || {};
  const sim = makeSim(tuningOverrides, opts);
  const runner = addDrySoldier(sim, 'runner', 'B', 0, 0);
  const hunter = addDrySoldier(sim, 'hunter', 'A', opts.hunter.q, opts.hunter.r);
  addBystanders(sim);
  sim.issueOrder({
    type: 'MOVE_TO', soldierIds: ['runner'],
    payload: { path: straightPath(40), mode: 'rush', selfInitiated: true },
  });
  for (let t = 0; t < (opts.ticks || 40); t++) sim.tick();
  return { sim: sim, runner: runner, hunter: hunter };
}

/**
 * 迎撃を素の入力で測るための台。目標の速度を直に置き、hunter は**進路の前方
 * 側方**（間に合う位置）に立たせる。実 sim を走らせると幾何が毎tick変わって
 * 何を測っているのか分からなくなるので、ここだけは合成入力で固定する。
 *
 * hunter(30,10) / target(0,0) が +q へ rush 相当（1hex=6tick）で走る配置では、
 * 両者とも 20 歩で (20,0) に着ける ＝ 迎撃が成立する幾何。
 */
function interceptBench(opts) {
  opts = opts || {};
  const sim = makeSim(opts.tuning, { blocked: opts.blocked });
  const hunter = addDrySoldier(sim, 'hunter', 'A', 30, 10);
  const target = addDrySoldier(sim, 'target', 'B', 0, 0);
  target._vel = { q: 1 / 6, r: 0 };                  // rush 1hex/6tick で +q へ
  target._moveIdleT = opts.idleT || 0;
  return { sim: sim, hunter: hunter, target: target };
}
/** 迎撃点が実位置からどれだけ前へ出ているか */
function leadDistance(bench) {
  const aim = bench.sim._interceptHex(bench.hunter, bench.target, bench.sim.tuning);
  return { aim: aim, lead: hexDist(aim, { q: bench.target.q, r: bench.target.r }) };
}

// --- T1: 動いている目標には「前方」を指す -----------------------------------
{
  const { sim, runner } = runUntilMoving({}, { hunter: { q: 0, r: 10 } });
  check('T1a 走っている兵の速度が実移動から測れている',
    Math.abs(runner._vel.q) > 0.01 && sim._tick > 0, JSON.stringify(runner._vel));

  const bench = interceptBench();
  const { aim } = leadDistance(bench);
  check('T1b 迎撃点は目標の実位置より進行方向(+q)の前方',
    aim.q > bench.target.q && aim.r === bench.target.r,
    `aim=(${aim.q},${aim.r}) target=(${bench.target.q},${bench.target.r})`);
  check('T1c 迎撃点は「双方が同時に着ける地点」になっている',
    Math.abs(hexDist(aim, { q: bench.hunter.q, r: bench.hunter.r }) - aim.q) <= 1,
    `hunter->aim=${hexDist(aim, { q: bench.hunter.q, r: bench.hunter.r })} target->aim=${aim.q}`);
}

// --- T2: 止まっている目標は先読みしない -------------------------------------
{
  const sim = makeSim({});
  const hunter = addDrySoldier(sim, 'hunter', 'A', 0, 0);
  const sitter = addDrySoldier(sim, 'sitter', 'B', 8, 0);
  addBystanders(sim);
  for (let t = 0; t < 60; t++) sim.tick();   // 動かないまま時間だけ進める
  const aim = sim._interceptHex(hunter, sitter, sim.tuning);
  check('T2 止まっている目標には実位置をそのまま返す',
    aim.q === sitter.q && aim.r === sitter.r, `aim=(${aim.q},${aim.r})`);
}

// --- T3: ASSAULT_LEAD_MAX_T:0 で従来の純追尾へ戻せる -------------------------
{
  const { sim, runner, hunter } = runUntilMoving({ ASSAULT_LEAD_MAX_T: 0 },
    { hunter: { q: 0, r: 10 } });
  const aim = sim._interceptHex(hunter, runner, sim.tuning);
  check('T3 LEAD_MAX_T=0 は予測を無効化する（実位置へ）',
    aim.q === runner.q && aim.r === runner.r, `aim=(${aim.q},${aim.r})`);
}

// --- T4: 足が止まったら予測が薄れ、STALE_T で完全に消える -------------------
// 「止まった」と断ずるまで満額で先読みし続けると、居もしない前方へ走り続けて
// かえって接敵が遅れる（実測 20〜35 tick）。だから崖ではなく線形に薄める。
{
  const staleT = 30;
  const tuning = { ASSAULT_LEAD_STALE_T: staleT };
  const lead0 = leadDistance(interceptBench({ tuning: tuning, idleT: 0 })).lead;
  const leadHalf = leadDistance(interceptBench({ tuning: tuning, idleT: staleT / 2 })).lead;
  const leadEnd = leadDistance(interceptBench({ tuning: tuning, idleT: staleT })).lead;
  check('T4a 走っている間は前方を指す', lead0 > 0, 'lead=' + lead0);
  check('T4b 足が止まってからの経過で予測は薄れる', leadHalf > 0 && leadHalf < lead0,
    `${lead0} -> ${leadHalf}`);
  check('T4c STALE_T を過ぎれば実位置へ戻る', leadEnd === 0, 'lead=' + leadEnd);
}

// --- T4x: 実際に走って止まった兵は、速度そのものが 0 に落ちる ---------------
{
  const sim = makeSim({ ASSAULT_LEAD_STALE_T: 20 });
  const s = addDrySoldier(sim, 'walker', 'A', 0, 0);
  addBystanders(sim);
  sim.issueOrder({
    type: 'MOVE_TO', soldierIds: ['walker'],
    payload: { path: straightPath(3), mode: 'rush', selfInitiated: true },
  });
  for (let t = 0; t < 30; t++) sim.tick();
  const moved = Math.abs(s._vel.q) > 0.01;
  for (let t = 0; t < 60; t++) sim.tick();            // 経路を使い切って停止
  check('T4d 走った兵は速度を持ち、止まれば 0 に戻る',
    moved && s._vel.q === 0 && s._vel.r === 0,
    `moved=${moved} vel=${JSON.stringify(s._vel)}`);
}

// --- T5: 静止から動き直した兵の速度を測り直せる（dt 引き直しの保証） --------
// 引き直しを忘れると巨大な dt で割られ、以後その兵は永久に「止まっている奴」になる
{
  const sim = makeSim({ ASSAULT_LEAD_STALE_T: 10 });
  const s = addDrySoldier(sim, 'walker', 'A', 0, 0);
  addBystanders(sim);
  for (let t = 0; t < 200; t++) sim.tick();          // 長く静止させる
  check('T5a 長く静止した兵の速度は 0', s._vel.q === 0 && s._vel.r === 0,
    JSON.stringify(s._vel));
  sim.issueOrder({
    type: 'MOVE_TO', soldierIds: ['walker'],
    payload: { path: straightPath(10), mode: 'rush', selfInitiated: true },
  });
  for (let t = 0; t < 40; t++) sim.tick();
  check('T5b 動き直せば妥当な速度が測れる（dt を引き直している）',
    Math.abs(s._vel.q) > 0.05, JSON.stringify(s._vel));
}

// --- T6: 予測先が進入不可なら実位置へ落とす ---------------------------------
{
  const aimOpen = leadDistance(interceptBench()).aim;
  check('T6a 前提: 開けた地形では前方を指している', aimOpen.q > 0,
    `aim=(${aimOpen.q},${aimOpen.r})`);

  const walled = interceptBench({ blocked: [aimOpen] });
  const aimWalled = walled.sim._interceptHex(walled.hunter, walled.target, walled.sim.tuning);
  check('T6b その迎撃点が進入不可なら実位置へ落ちる',
    aimWalled.q === walled.target.q && aimWalled.r === walled.target.r,
    `aim=(${aimWalled.q},${aimWalled.r}) target=(${walled.target.q},${walled.target.r})`);
}

// --- T7: 迎撃点が自分の足元を指すことはない ---------------------------------
// 足元を指すと _stepToward が null を返し、強襲が 'unreachable' で自滅解除される
{
  const sim = makeSim({});
  const hunter = addDrySoldier(sim, 'hunter', 'A', 0, 0);
  const charger = addDrySoldier(sim, 'charger', 'B', 1, 0);
  addBystanders(sim);
  charger._vel = { q: -0.5, r: 0 };   // 猛烈にこちらへ突っ込んでくる
  charger._moveIdleT = 0;
  const aim = sim._interceptHex(hunter, charger, sim.tuning);
  check('T7 迎撃点が自分の足元になったら実位置へ落とす',
    !(aim.q === hunter.q && aim.r === hunter.r), `aim=(${aim.q},${aim.r})`);
}

// --- T8: 進路を変える目標へ、純追尾より明確に早く接敵する -------------------
{
  const withLead = timeToContact(SIM_TUNING.ASSAULT_LEAD_MAX_T, { q: 0, r: 12 }, elbowPath(60), 900);
  const pursuit = timeToContact(0, { q: 0, r: 12 }, elbowPath(60), 900);
  check('T8a 迎撃ありで接敵できる', withLead != null, 't=' + withLead);
  check('T8b 純追尾より 50 tick 以上早い',
    withLead != null && pursuit != null && (pursuit - withLead) >= 50,
    `迎撃 t=${withLead} / 純追尾 t=${pursuit}`);
}

// --- T9: 正面からの相互強襲は従来どおり白兵に持ち込む（回帰） ---------------
{
  const sim = makeSim({});
  addDrySoldier(sim, 'left', 'A', 0, 0);
  addDrySoldier(sim, 'right', 'B', 12, 0);
  addBystanders(sim);
  sim.issueOrder({ type: 'ASSAULT', soldierIds: ['left'], payload: { targetId: 'right' } });
  sim.issueOrder({ type: 'ASSAULT', soldierIds: ['right'], payload: { targetId: 'left' } });
  let melee = null;
  for (let t = 1; t <= 400 && melee == null; t++) {
    sim.tick();
    sim.drainEvents().forEach((e) => { if (e.type === 'MELEE_START' && melee == null) melee = t; });
  }
  check('T9 相互強襲は白兵にもつれ込む（すれ違わない）', melee != null, 't=' + melee);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
