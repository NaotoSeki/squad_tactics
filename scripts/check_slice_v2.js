/**
 * scripts/check_slice_v2.js -- Vertical Slice v2.0 受入基準（NORTH_STAR §7.4）の実測
 *
 * §7.4 の戦術品質を「満たしたつもり」にせず、現行RTwPシムから数字を出す。
 *
 * 使い方:
 *   node scripts/check_slice_v2.js           # 現在地レポート（常に exit 0）
 *   node scripts/check_slice_v2.js --gate    # 門として使う（未達なら exit 1）
 *
 * ヘッドレスで測れるのは基準1/3/4。基準2(側面機動)・5(装備変更)・6(fps)は
 * 別手段（実機観察・ブラウザ計測）が要るので UNMEASURED として並べる。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SEEDS = [7, 42, 77, 1234, 31337];
const TICKS = 1800;             // 3分 @100ms/tick
const GATE = process.argv.indexOf('--gate') !== -1;

// --- 環境ロード（sim_battle.html と同じ順でグローバルに載せる） ---------------
function loadWorld() {
  const sandbox = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  ['data.js', 'logic_map_rural_v29.js', 'sim_battle_adapter.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
  // data.js は const 宣言なので sandbox のプロパティにならない。明示的に出す。
  vm.runInContext('this.WPNS = WPNS; this.SIM_TUNING = SIM_TUNING;', sandbox, { filename: 'expose' });
  return sandbox;
}
const W = loadWorld();
const { SimCore, mulberry32, toSimWeapon } = require(path.join(ROOT, 'sim_core.js'));
const { TraitPolicy, TRAIT_IDS } = require(path.join(ROOT, 'sim_policy.js'));
const { CommsOrders } = require(path.join(ROOT, 'sim_orders.js'));
const { LeaderPolicy } = require(path.join(ROOT, 'sim_leader.js'));

const T = W.SIM_TUNING;
const mapData = W.buildPsBattleMap();
const api = W.makePsBattleMapApi(mapData);
const spots = W.collectPlayableHexes(api, 0.2);
const TRAITS = [[]].concat(TRAIT_IDS.map((id) => [id]));
const rifle = toSimWeapon('m1', W.WPNS.m1, T);
const magsFor = (w) => (T.DEFAULT_MAGS[w.class] != null ? T.DEFAULT_MAGS[w.class] : 4);

function newSim(seed) {
  const sim = new SimCore({ map: api, tuning: T, rng: mulberry32(seed), policy: TraitPolicy });
  sim.orders = new CommsOrders({
    getSoldier: (id) => sim.getSoldier(id), soldiers: () => sim.soldiers(),
    map: api, tuning: T,
  });
  return sim;
}

/**
 * 基準1の前提は「**遮蔽で対峙する**両軍」。sim_battle の既定配置は自動Coverを
 * 見せるため A隊を意図的に開豁地へ置いており、その配置で基準1を測ると
 * 前提が違う（開豁地の隊が削られるのは仕様どおりの結果であって膠着の失敗ではない）。
 */
function deployCovered(sim) {
  const cov = spots.covered.slice().sort((a, b) => (a.q + a.r) - (b.q + b.r));
  const half = Math.floor(cov.length / 2);
  const A = cov.slice(0, half);
  const B = cov.slice(half).reverse();
  const n = Math.min(5, A.length, B.length);
  for (let i = 0; i < n; i++) {
    sim.addSoldier({ id: 'A' + i, team: 'A', q: A[i].q, r: A[i].r, weapon: rifle,
      ammo: { mags: magsFor(rifle) }, skill: 1.0, isLeader: i === 0, traits: TRAITS[i] });
    sim.addSoldier({ id: 'B' + i, team: 'B', q: B[i].q, r: B[i].r, weapon: rifle,
      ammo: { mags: magsFor(rifle) }, skill: 1.0, isLeader: i === 0, traits: TRAITS[(i + 2) % 5] });
  }
  return n;
}

/** 命令ノート以外＝無命令時のトレイト由来行動 */
const isTraitNote = (n) => n.indexOf('命令') !== 0 && n.indexOf('被制圧') !== 0;

function runBattle(seed, useLeader) {
  const sim = newSim(seed);
  const perTeam = deployCovered(sim);
  const st = { A: {}, B: {} };
  const noteBy = {};
  const perMin = [];
  const sup = [];
  let shots = 0;
  for (let t = 0; t < TICKS; t++) {
    if (useLeader && t % T.LEADER_ASSESS_INTERVAL_T === 0) {
      ['A', 'B'].forEach((tm) => {
        const wv = { soldiers: sim.soldiers(), map: api, tuning: T, tick: t };
        const ld = wv.soldiers.find((s) => s.team === tm && s.isLeader && s.hp > 0);
        if (ld) LeaderPolicy.assess(ld, wv, () => 0.5, st[tm]).forEach((o) => sim.issueOrder(o));
      });
    }
    sim.tick();
    sim.drainEvents().forEach((e) => {
      if (e.type === 'SHOT') shots++;
      if (e.type === 'POLICY') (noteBy[e.id] = noteBy[e.id] || new Set()).add(e.note);
    });
    if (t % 100 === 99) sup.push(sim.soldiers().filter((s) => s.hp > 0).map((s) => s.suppression));
    if (t % 600 === 599) { perMin.push(shots); shots = 0; }
  }
  const ss = sim.soldiers();
  const flat = [].concat.apply([], sup);
  const traitActors = Object.keys(noteBy).filter((id) => [...noteBy[id]].some(isTraitNote));
  const traitKinds = new Set();
  Object.keys(noteBy).forEach((id) => [...noteBy[id]].filter(isTraitNote).forEach((n) => traitKinds.add(n)));
  return {
    perTeam: perTeam,
    deadA: ss.filter((s) => s.team === 'A' && s.hp <= 0).length,
    deadB: ss.filter((s) => s.team === 'B' && s.hp <= 0).length,
    perMin: perMin,
    midPct: 100 * flat.filter((v) => v > 0 && v < 100).length / Math.max(1, flat.length),
    traitActors: traitActors.length,
    traitKinds: [...traitKinds],
  };
}

/** 基準3: 分隊長からの距離で伝達遅延が変わること */
function measureComms() {
  const sim = newSim(5);
  const all = spots.exposed.concat(spots.covered);
  const near = all[0];
  const far = all.reduce((b, h) => (api.dist(h, near) > api.dist(b, near) ? h : b), all[0]);
  const nb = api.neighbors(near)[0];
  sim.addSoldier({ id: 'L', team: 'A', q: near.q, r: near.r, weapon: rifle, ammo: { mags: 6 }, isLeader: true, traits: [] });
  sim.addSoldier({ id: 'NEAR', team: 'A', q: nb.q, r: nb.r, weapon: rifle, ammo: { mags: 6 }, traits: [] });
  sim.addSoldier({ id: 'FAR', team: 'A', q: far.q, r: far.r, weapon: rifle, ammo: { mags: 6 }, traits: [] });
  for (let i = 0; i < 5; i++) sim.tick();
  const t0 = sim._tick;
  sim.issueOrder({ type: 'FIRE_MODE', soldierIds: ['NEAR', 'FAR'], payload: { mode: 'suppress' } });
  const arrive = {};
  for (let i = 0; i < 300; i++) {
    sim.tick();
    ['NEAR', 'FAR'].forEach((id) => {
      if (arrive[id] == null && sim._soldiers.get(id).fireMode === 'suppress') arrive[id] = sim._tick - t0;
    });
  }
  return { nearHex: api.dist(near, nb), farHex: api.dist(near, far), arrive: arrive };
}

// ---------------------------------------------------------------------------

const withLeader = SEEDS.map((s) => runBattle(s, true));
const noLeader = SEEDS.map((s) => runBattle(s, false));
const comms = measureComms();

const c1 = withLeader.map((r) => ({
  r: r, ok: r.deadA <= 1 && r.deadB <= 1 && r.perMin.every((n) => n > 0) && r.midPct > 5,
}));
const c1pass = c1.filter((x) => x.ok).length;
// 基準4は「**無命令時間に**」なので、分隊長AIを止めた対照も測る
const c4pass = withLeader.filter((r) => r.traitActors >= 2 && r.traitKinds.length >= 2).length;
const c4passNoLeader = noLeader.filter((r) => r.traitActors >= 2 && r.traitKinds.length >= 2).length;

const line = (n) => '-'.repeat(n);
console.log('\nNORTH_STAR §7.4 Vertical Slice v2.0 受入基準 — 実測');
console.log(line(72));
console.log('盤面: PS正本 ' + mapData.W + 'x' + mapData.H + ' / 兵力 ' + withLeader[0].perTeam
  + ' vs ' + withLeader[0].perTeam + ' / ' + (TICKS / 10) + '秒 x ' + SEEDS.length + 'シード');
console.log('※ §7.4 の指定兵力は 9 vs 12。現在の sim_battle は 5 vs 5 で、規模が未達。');
console.log(line(72));

console.log('\n[基準1] 遮蔽で対峙する両軍が無操作で3分膠着   ... ' + (c1pass === SEEDS.length ? 'PASS' : 'FAIL')
  + '  (' + c1pass + '/' + SEEDS.length + ')');
c1.forEach((x, i) => console.log('   seed ' + String(SEEDS[i]).padStart(5) + ': 死者 A' + x.r.deadA + '/B' + x.r.deadB
  + '  射撃毎分 ' + x.r.perMin.join('-') + '  制圧中間帯 ' + x.r.midPct.toFixed(0) + '%  ' + (x.ok ? 'ok' : 'NG')));

console.log('\n[基準2] 側面機動で膠着が破れる                 ... UNMEASURED（機動シナリオ未実装）');

const nearS = comms.arrive.NEAR / 10, farS = comms.arrive.FAR / 10;
const c3ok = comms.arrive.NEAR != null && comms.arrive.FAR != null
  && nearS >= 1 && nearS <= 2 && farS >= 5;
console.log('\n[基準3] 命令が伝達遅延後に実行される           ... ' + (c3ok ? 'PASS' : 'FAIL'));
console.log('   近傍(' + comms.nearHex + 'hex): ' + nearS + 's   遠隔(' + comms.farHex + 'hex): ' + farS
  + 's   （基準: 近傍1〜2秒 / 遠隔5秒+）');

console.log('\n[基準4] 無命令時にトレイト由来の行動が2名以上  ... ' + (c4pass === SEEDS.length ? 'PASS' : 'FAIL')
  + '  (' + c4pass + '/' + SEEDS.length + ')');
console.log('   分隊長AIあり: トレイト行動兵 ' + withLeader.map((r) => r.traitActors).join(',')
  + '  種類 ' + withLeader.map((r) => r.traitKinds.length).join(','));
console.log('   分隊長AIなし: トレイト行動兵 ' + noLeader.map((r) => r.traitActors).join(',')
  + '  種類 ' + noLeader.map((r) => r.traitKinds.length).join(',')
  + '   -> ' + (c4passNoLeader > c4pass ? '命令が無ければ出る = 「無命令時間」が足りない' : '命令の有無に依らず不足'));
const kinds = new Set();
noLeader.concat(withLeader).forEach((r) => r.traitKinds.forEach((k) => kinds.add(k)));
console.log('   観測されたトレイトノート: ' + ([...kinds].join(' / ') || 'なし'));

console.log('\n[基準5] 装備変更ログ <= 2回/兵/戦闘            ... UNMEASURED（sim_battleに持ち替えが無い）');
console.log('[基準6] 55fps以上・強制待機1.5秒以下          ... 要ブラウザ計測（2026-07-31: 61fps 実測）');

const measured = [c1pass === SEEDS.length, c3ok, c4pass === SEEDS.length];
const passed = measured.filter(Boolean).length;
console.log('\n' + line(72));
console.log('測定できた3基準のうち ' + passed + '/3 達成。基準2/5 は未測定、基準6 はブラウザ側。');
console.log(passed === 3 ? '現行RTwPの測定済み基準はすべて達成。' : '現行RTwPには未達の戦術品質基準が残る。');
console.log(line(72) + '\n');

if (GATE && passed < 3) process.exit(1);
