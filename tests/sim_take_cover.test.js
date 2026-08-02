/**
 * tests/sim_take_cover.test.js -- 指示によるCover（TAKE_COVER 命令）の受入テスト
 *
 * NORTH_STAR §3.4「分隊長の采配」。TAKE_COVER は**行き先を持たない命令**で、
 * どこへ隠れるかは命令が届いた瞬間に現場の兵が決める（三現主義）。
 * 命令された移動は自衛の反射より大きな危険を受け入れる
 * （ORDERED_COVER_RISK_TOLERANCE）——「命を守る本能と、組織として攻めねば
 * ならない重圧のせめぎあい」の数値表現。
 *
 * No framework. Run with `node tests/sim_take_cover.test.js`.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const { TraitPolicy, TRAIT_MODS } = require(path.join(__dirname, '..', 'sim_policy.js'));
const { SimCore, mulberry32, toSimWeapon } = require(path.join(__dirname, '..', 'sim_core.js'));
const { CommsOrders } = require(path.join(__dirname, '..', 'sim_orders.js'));
const { LeaderPolicy } = require(path.join(__dirname, '..', 'sim_leader.js'));

function loadDataJs() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const sandbox = { module: { exports: {} }, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;this.WPNS = WPNS; this.SIM_TUNING = SIM_TUNING;\n',
    sandbox, { filename: 'data.js' });
  return sandbox;
}
const sandbox = loadDataJs();
const SIM_TUNING = sandbox.SIM_TUNING;
const WPNS = sandbox.WPNS;

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

function makeMap(coverMap, defaultCover, blocked) {
  const key = (h) => h.q + ',' + h.r;
  return {
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    },
    hasLos: () => true,
    cover: (h) => (coverMap[key(h)] != null ? coverMap[key(h)] : defaultCover),
    moveCost: (from, to) => ((blocked && blocked[key(to || from)]) ? Infinity : 1),
    neighbors: (h) => NEIGHBORS.map((d) => ({ q: h.q + d.q, r: h.r + d.r })),
  };
}

function makeSoldier(over) {
  return Object.assign({
    id: 'a1', team: 'A', q: 0, r: 0,
    weapon: { rngMax: 10, class: 'rifle' },
    traits: [], hp: 100, state: 'idle', suppression: 0, morale: 100,
    movePath: null, currentOrder: null,
  }, over || {});
}

function mg(id, q, r, state) {
  return {
    id: id, team: 'B', q: q, r: r, hp: 100,
    state: state || 'engage', weapon: { class: 'mg' }, suppression: 0, morale: 100,
  };
}

function order(soldier, map, others, payload) {
  return TraitPolicy.seekCoverForOrder(soldier,
    { soldiers: [soldier].concat(others || []), map: map, tuning: SIM_TUNING, tick: 0 },
    () => 0.5, payload || {});
}
function reflex(soldier, map, others) {
  return TraitPolicy.selfPreserve(soldier,
    { soldiers: [soldier].concat(others || []), map: map, tuning: SIM_TUNING, tick: 0 },
    () => 0.5);
}

const gain = SIM_TUNING.COVER_SEEK_MIN_GAIN;
const pinnedAt = SIM_TUNING.PINNED_AT;
const seekAt = SIM_TUNING.COVER_SEEK_AT;
const mgWeight = SIM_TUNING.COVER_SEEK_EXPOSURE_WEIGHT.mg;
const baseCost = SIM_TUNING.COVER_SEEK_EXPOSURE_COST;
const tolerance = SIM_TUNING.ORDERED_COVER_RISK_TOLERANCE;

// --- 1. 撃たれていなくても、命令されれば動く ---------------------------------
{
  const m = makeMap({ '0,0': 0.10, '1,0': 0.10 + gain }, 0.10);
  const s = makeSoldier({ suppression: 0 });
  check(reflex(s, m, []) === null, '前提: 撃たれていない兵は自衛の反射では動かない');
  const out = order(s, m, []);
  check(out && out.type === 'MOVE_TO', '撃たれていなくても命令なら遮蔽へ動く');
}

// --- 2. 改善できる遮蔽が無ければ、命令でも動かない ---------------------------
{
  const m = makeMap({}, 0.30);   // 見渡す限り同じ遮蔽
  check(order(makeSoldier(), m, []) === null, '改善先が無ければ命令でも動かない');
}

// --- 3. 場所を指す命令は経路を1マスずつ刻む（ワープしない） ------------------
//
// sim_core の移動は movePath の要素へ隣接判定なしで座標を代入するので、
// 遠い hex を要素1個の経路として渡すと兵士がワープする。回帰防止。
{
  const m = makeMap({}, 0.10);
  const goal = { q: 3, r: 0 };
  const out = order(makeSoldier(), m, [], { hex: goal });
  check(out && out.type === 'MOVE_TO', '場所を指す命令は MOVE_TO を返す');
  const p = out ? out.payload.path : [];
  check(p.length === 3, '3hex先への命令は3要素の経路になる（要素1個でワープしない）');
  const last = p[p.length - 1];
  check(last && last.q === goal.q && last.r === goal.r, '経路の終点が指示された地点');
  let contiguous = true;
  let prev = { q: 0, r: 0 };
  p.forEach((h) => { if (m.dist(prev, h) !== 1) contiguous = false; prev = h; });
  check(contiguous, '経路は隣接マスだけで繋がっている');
  check(out.note.indexOf('指示された地点') !== -1, '場所指定はノートで区別される');
}

// --- 4. 進入不可の地点を指されたら従えない -----------------------------------
{
  const m = makeMap({}, 0.10, { '3,0': true });
  check(order(makeSoldier(), m, [], { hex: { q: 3, r: 0 } }) === null,
    '進入不可の地点を指す命令は実行できない');
}

// --- 5. 命令は自衛の反射より危険を受け入れる ---------------------------------
//
// (2,0) へは (1,0) 経由でしか届かず、その中継地をMGが見ている。到達先の遮蔽を
// 「反射の罰なら届かず、命令の罰(×ORDERED_COVER_RISK_TOLERANCE)なら届く」高さに置く。
{
  const risk = mgWeight;                       // 中継地1マス × MG1挺
  const reflexPenalty = baseCost * risk;
  const orderedPenalty = baseCost * tolerance * risk;
  const dest = gain + (reflexPenalty + orderedPenalty) / 2;
  const m = makeMap({ '0,0': 0, '2,0': dest }, 0);
  m.hasLos = () => true;
  const enemies = [mg('b1', 5, 0)];
  const s = makeSoldier({ suppression: seekAt });
  // 渡らない結論は2通り — 動かない(null)か、その場で伏せる(GO_PRONE)。
  const reflexOut = reflex(s, m, enemies);
  check(reflexOut === null || reflexOut.type === 'GO_PRONE',
    '前提: 自衛の反射はこの射線を渡らない');
  const out = order(s, m, enemies);
  check(out && out.type === 'MOVE_TO' && out.payload.path.length === 2,
    '命令されれば同じ射線を渡って遮蔽へ向かう');
}

// --- 6. timid は命令が届いても竦んで動けない ---------------------------------
{
  const m = makeMap({ '0,0': 0, '1,0': 0.9 }, 0);
  const s = makeSoldier({ traits: ['timid'], suppression: TRAIT_MODS.timid.FREEZE_AT_SUPPRESSION });
  const out = order(s, m, []);
  check(out && out.type === 'HOLD_POS', 'timid は命令でも移動せず HOLD_POS を返す');
  check(out && out.note.indexOf('竦') !== -1, '命令が通らなかったことがノートで見える');
}

// --- 7. PINNED は匍匐なので1マスまで ------------------------------------------
{
  const m = makeMap({ '0,0': 0, '2,0': 0.9 }, 0);   // 遮蔽は2マス先だけ
  check(order(makeSoldier({ suppression: pinnedAt }), m, []) === null,
    'PINNED では2マス先の遮蔽へは向かわない（匍匐は1マスまで）');
  check(order(makeSoldier({ suppression: pinnedAt - 1 }), m, []) !== null,
    '前提: PINNED未満なら2マス先の遮蔽へ向かう');
}

// ===========================================================================
// SimCore 統合: 伝達遅延を経て届き、届いた時点で解決され、一度きりで消えること
// ===========================================================================
{
  const m = makeMap({ '0,0': 0.05, '1,0': 0.9 }, 0.05);
  const sim = new SimCore({ map: m, tuning: SIM_TUNING, rng: mulberry32(11), policy: TraitPolicy });
  sim.orders = new CommsOrders({
    getSoldier: (id) => sim.getSoldier(id),
    soldiers: () => sim.soldiers(),
    map: m, tuning: SIM_TUNING,
  });
  const w = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: w, traits: [], isLeader: true });

  for (let i = 0; i < 5; i++) sim.tick();      // tick 0 の「事前計画=遅延0」を避ける
  sim.issueOrder({ type: 'TAKE_COVER', soldierIds: ['a1'], payload: {} });

  // 命令は配達・適用・one-shot解除が同一tick内で起きるので、currentOrder は
  // tick境界では観測できない。代わりに「伝達遅延の間は動かず、遅延後に動く」で
  // 命令が実際に流れたことを確かめる（§7.4 基準3 の最小形でもある）。
  const notes = [];
  const voiceDelay = SIM_TUNING.COMMS_VOICE_DELAY_T;
  let movedBeforeDelay = false;
  for (let i = 0; i < 60; i++) {
    sim.tick();
    const cur = sim._soldiers.get('a1');
    if (i < voiceDelay - 1 && (cur.q !== 0 || cur.r !== 0)) movedBeforeDelay = true;
    sim.drainEvents().forEach((e) => { if (e.type === 'POLICY') notes.push(e.note); });
  }
  const end = sim._soldiers.get('a1');
  check(!movedBeforeDelay, '前提: 命令は伝達遅延の間は届かず、兵士は動かない');
  check(end.q === 1 && end.r === 0, 'TAKE_COVER で遮蔽の濃いマスへ実際に移動する');
  check(end.currentOrder === null, 'TAKE_COVER は一度きりで解除される（永続しない）');
  check(notes.some((n) => n && n.indexOf('命令') !== -1),
    '解決内容が POLICY ノートとして可視化される');
}

// ===========================================================================
// 分隊長ドクトリン: 開豁地で見られている部下が居るなら「遮蔽に入れ！」
// ===========================================================================
const minExposed = SIM_TUNING.TAKE_COVER_MIN_EXPOSED;
const coverMax = SIM_TUNING.TAKE_COVER_COVER_MAX;

function leaderWorld(map, squad, enemies) {
  return { soldiers: squad.concat(enemies), map: map, tuning: SIM_TUNING, tick: 5000 };
}

// --- 9. 露出兵が閾値以上なら TAKE_COVER を発令する ---------------------------
{
  const m = makeMap({}, 0);            // どこも遮蔽ゼロ = 全員露出
  const leader = makeSoldier({ id: 'L', q: 0, r: 0, isLeader: true });
  const squad = [leader];
  for (let i = 0; i < minExposed; i++) squad.push(makeSoldier({ id: 's' + i, q: i + 1, r: 0 }));
  const orders = LeaderPolicy.assess(leader, leaderWorld(m, squad, [mg('e1', 6, 0)]), () => 0.5, {});
  check(orders.length >= minExposed, '露出兵が閾値以上なら命令が出る');
  check(orders.length > 0 && orders.every((o) => o.type === 'TAKE_COVER'),
    '発令される命令の型が TAKE_COVER');
  check(orders.length > 0 && orders.every((o) => o.note === '遮蔽に入れ！'),
    '分隊長の号令がノートに乗る');
  check(orders.length > 0 && orders.every((o) => !o.payload.hex),
    '行き先は指定しない（どこへ隠れるかは現場の兵が決める）');
}

// --- 10. 露出兵が閾値未満なら発令しない --------------------------------------
{
  const safe = coverMax + 0.1;
  const m = makeMap({ '0,0': safe, '1,0': safe }, safe);   // 1名(2,0)だけ露出
  const cover2 = {}; cover2['2,0'] = 0;
  const m2 = makeMap(Object.assign({ '0,0': safe, '1,0': safe }, cover2), safe);
  const leader = makeSoldier({ id: 'L', q: 0, r: 0, isLeader: true });
  const squad = [leader, makeSoldier({ id: 's0', q: 1, r: 0 }), makeSoldier({ id: 's1', q: 2, r: 0 })];
  const orders = LeaderPolicy.assess(leader, leaderWorld(m2, squad, [mg('e1', 6, 0)]), () => 0.5, {});
  check(!orders.some((o) => o.type === 'TAKE_COVER'), '露出兵が閾値未満なら発令しない');
}

// --- 11. 敵から見えていない兵は動かす必要がない ------------------------------
{
  const m = makeMap({}, 0);            // 全員露出だが……
  m.hasLos = () => false;              // 誰からも見られていない
  const leader = makeSoldier({ id: 'L', q: 0, r: 0, isLeader: true });
  const squad = [leader];
  for (let i = 0; i < minExposed; i++) squad.push(makeSoldier({ id: 's' + i, q: i + 1, r: 0 }));
  const orders = LeaderPolicy.assess(leader, leaderWorld(m, squad, [mg('e1', 6, 0)]), () => 0.5, {});
  check(!orders.some((o) => o.type === 'TAKE_COVER'),
    '敵から見えていないなら開豁地に居ても遮蔽命令は出ない');
}

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
if (failCount) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
