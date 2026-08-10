/**
 * scripts/check_flanking.js -- NORTH_STAR §7.4 基準2「側面機動で膠着が破れる」の実測
 *
 * §3.2 の殺傷ベクトル1は「側面/背面射撃 — 遮蔽無効化で pHit ×5〜10。機動こそ殺傷力」。
 * これが本当に効いているかを、正面撃ち合いだけの対照と比較して測る。
 *
 * ## 測り方の要点（ここを外すと逆の結論が出る）
 *
 * 1. **配置ではなく機動を測る。** 開始時点から背後に置くと、B隊は最寄りの敵＝
 *    その2名へ即座に向き直り、側面の利が消えたうえに孤立した2名が袋叩きになる。
 *    正面で膠着を成立させてから機動させないと「膠着を破る」を測ったことにならない。
 *
 * 2. **主指標は死者数ではなく側面射撃の発生数と与ダメージ。** 3分の戦闘で死者は
 *    0〜2人しか出ず、5シードの死者数で戦術効果を検出しようとすると信号が雑音に
 *    埋もれる。sim_core の `_isFlank` と同じ式を、射撃が起きた tick の facing で
 *    再現して数える。
 *
 * 3. **facing は撃つたびに標的へ向く**（sim_core が射撃解決時に更新）。つまり
 *    側面射撃は「敵が別の相手に釘付けの間だけ」成立する。これは仕様どおりで、
 *    正面を固定する主力が要るという設計そのもの。イベント後の facing で判定すると
 *    既に振り向いた後を見てしまうので、**tick 前のスナップショット**で判定する。
 *
 * 使い方:
 *   node scripts/check_flanking.js           # レポート（常に exit 0）
 *   node scripts/check_flanking.js --gate    # 門として使う（未達なら exit 1）
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SEEDS = [7, 42, 77, 1234, 31337];
const TICKS = 1800;              // 3分
const MANEUVER_AT = 500;         // 50秒: 正面の撃ち合いが成立してから動き出す
const GATE = process.argv.indexOf('--gate') !== -1;

function loadWorld() {
  const sandbox = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  ['data.js', 'logic_map_rural_v29.js', 'sim_battle_adapter.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
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

/** check_slice_v2.js と同じ「双方とも遮蔽で対峙」配置 */
function deploy(sim) {
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

/** 進入可能な hex を1マスずつ辿る経路（sim_core は経路要素へ隣接判定なしで移動するため） */
function pathTo(start, goal, maxSteps) {
  const key = (h) => h.q + ',' + h.r;
  if (key(start) === key(goal)) return null;
  const seen = {};
  seen[key(start)] = true;
  let frontier = [{ hex: start, path: [] }];
  for (let d = 0; d < maxSteps; d++) {
    const next = [];
    for (const node of frontier) {
      for (const cell of (api.neighbors(node.hex) || [])) {
        const k = key(cell);
        if (seen[k]) continue;
        seen[k] = true;
        if (!isFinite(api.moveCost(node.hex, cell))) continue;
        const p = node.path.concat([{ q: cell.q, r: cell.r }]);
        if (k === key(goal)) return p;
        next.push({ hex: cell, path: p });
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return null;
}

const centroid = (list) => ({
  q: list.reduce((a, s) => a + s.q, 0) / list.length,
  r: list.reduce((a, s) => a + s.r, 0) / list.length,
});

/**
 * B隊の背後（A隊主力から見てBの向こう側）で、進入可能かつ遮蔽のある hex を選ぶ。
 * ここへ回り込ませることで、正面に釘付けのB隊に対し dot<0 の射線を取る。
 */
function rearHexes(soldiers, count) {
  const A = soldiers.filter((s) => s.team === 'A' && s.hp > 0);
  const B = soldiers.filter((s) => s.team === 'B' && s.hp > 0);
  if (!A.length || !B.length) return [];
  const ca = centroid(A), cb = centroid(B);
  const dq = cb.q - ca.q, dr = cb.r - ca.r;
  const cand = [];
  for (let q = 0; q < mapData.W; q++) {
    for (let r = 0; r < mapData.H; r++) {
      const cell = mapData.grid[q] && mapData.grid[q][r];
      if (!cell || cell.id === -1 || cell.building) continue;
      const h = { q: q, r: r };
      if (!isFinite(api.moveCost(h, h))) continue;
      // Bの重心から見て、A主力とは反対側（内積が正）にあること
      const vq = q - cb.q, vr = r - cb.r;
      if (vq * dq + vr * dr <= 0) continue;
      const d = api.dist(h, cb);
      if (d < 2 || d > 6) continue;               // 近すぎず、射程内
      cand.push({ hex: h, cover: api.cover(h), d: d });
    }
  }
  cand.sort((x, y) => (y.cover - x.cover) || (x.d - y.d));
  return cand.slice(0, count).map((c) => c.hex);
}

/** sim_core._isFlank と同じ式 */
function isFlank(shooter, target) {
  if (!target.facing) return false;
  const tq = shooter.q - target.q, tr = shooter.r - target.r;
  const fq = target.facing.q, fr = target.facing.r;
  return tq * fq + tr * fr + 0.5 * (tq * fr + tr * fq) < 0;
}

function battle(seed, maneuver) {
  const sim = new SimCore({ map: api, tuning: T, rng: mulberry32(seed), policy: TraitPolicy });
  sim.orders = new CommsOrders({ getSoldier: (id) => sim.getSoldier(id), soldiers: () => sim.soldiers(), map: api, tuning: T });
  const n = deploy(sim);
  const st = { A: {}, B: {} };
  let flankShots = 0, totalShots = 0, flankHits = 0, maneuverIssued = 0;
  const hp0 = {};
  sim.soldiers().forEach((s) => (hp0[s.id] = s.hp));

  for (let t = 0; t < TICKS; t++) {
    if (t % T.LEADER_ASSESS_INTERVAL_T === 0) {
      ['A', 'B'].forEach((tm) => {
        const wv = { soldiers: sim.soldiers(), map: api, tuning: T, tick: t };
        const ld = wv.soldiers.find((s) => s.team === tm && s.isLeader && s.hp > 0);
        if (ld) LeaderPolicy.assess(ld, wv, () => 0.5, st[tm]).forEach((o) => sim.issueOrder(o));
      });
    }

    // 正面の撃ち合いが固まってから、A隊の2名を背後へ回す
    if (maneuver && t === MANEUVER_AT) {
      const ss = sim.soldiers();
      const goals = rearHexes(ss, 2);
      const movers = ss.filter((s) => s.team === 'A' && s.hp > 0 && !s.isLeader).slice(0, goals.length);
      movers.forEach((m, i) => {
        const p = pathTo({ q: m.q, r: m.r }, goals[i], 14);
        if (p) { sim.issueOrder({ type: 'MOVE_TO', soldierIds: [m.id], payload: { path: p } }); maneuverIssued++; }
      });
    }

    // 射撃解決で facing が更新されるので、判定は **tick 前** の姿勢で行う
    const before = {};
    sim.soldiers().forEach((s) => (before[s.id] = { q: s.q, r: s.r, facing: s.facing }));
    sim.tick();
    sim.drainEvents().forEach((e) => {
      if (e.type !== 'SHOT') return;
      totalShots++;
      const sh = before[e.shooterId], tg = before[e.targetId];
      if (sh && tg && isFlank(sh, tg)) { flankShots++; if (e.hit) flankHits++; }
    });
  }

  const ss = sim.soldiers();
  const dmg = (team) => ss.filter((s) => s.team === team).reduce((a, s) => a + (hp0[s.id] - s.hp), 0);
  return {
    perTeam: n, maneuverIssued: maneuverIssued,
    deadA: ss.filter((s) => s.team === 'A' && s.hp <= 0).length,
    deadB: ss.filter((s) => s.team === 'B' && s.hp <= 0).length,
    dmgToA: dmg('A'), dmgToB: dmg('B'),
    totalShots: totalShots, flankShots: flankShots, flankHits: flankHits,
  };
}

// ---------------------------------------------------------------------------

const rows = SEEDS.map((sd) => ({ seed: sd, front: battle(sd, false), flank: battle(sd, true) }));
const line = (n) => '-'.repeat(n);

// 盤面が機動を許す広さかを先に測る。ここが足りていないと、この先の数字は
// 「側面機動の効果」ではなく「盤面に機動の余地が無いこと」を測っているだけになる。
const playable = [];
for (let q = 0; q < mapData.W; q++) {
  for (let r = 0; r < mapData.H; r++) {
    const c = mapData.grid[q] && mapData.grid[q][r];
    if (c && c.id !== -1) playable.push({ q: q, r: r });
  }
}
let span = 0;
playable.forEach((a) => playable.forEach((b) => { const d = api.dist(a, b); if (d > span) span = d; }));

console.log('\nNORTH_STAR §7.4 基準2 — 側面機動で膠着が破れるか');
console.log(line(76));
console.log('盤面: PS正本 進入可能 ' + playable.length + " hex / 最大差し渡し " + span + ' hex');
console.log('兵力: ' + rows[0].front.perTeam + ' vs ' + rows[0].front.perTeam + ' / ' + (TICKS / 10) + '秒');
console.log('対照: 正面撃ち合いのみ vs ' + (MANEUVER_AT / 10) + '秒後にA隊2名をB隊背後へ機動');
if (span <= rifle.rngMax) {
  console.log('');
  console.log('!! 盤面の最大差し渡し(' + span + ') <= 小銃の最大射程(' + rifle.rngMax + ')');
  console.log('!! 盤上のどこに居ても全員が撃ち合えるため、「正面から外れる」場所が存在しない。');
  console.log('!! この条件では側面機動は幾何的に成立せず、以下の数字は機構の可否ではなく');
  console.log('!! 盤面の狭さを測っている。基準2の判定には広い盤面が要る。');
}
console.log('※ §7.4 の指定兵力は 9 vs 12。5v5 では正面を固定する主力も割きにくい。');
console.log(line(76));

let flankWorks = 0, breaksStalemate = 0;
rows.forEach((r) => {
  const f = r.flank, n = r.front;
  const flankRate = f.totalShots ? (100 * f.flankShots / f.totalShots).toFixed(0) : '0';
  const nRate = n.totalShots ? (100 * n.flankShots / n.totalShots).toFixed(0) : '0';
  if (f.flankShots > n.flankShots * 1.5) flankWorks++;
  if (f.dmgToB > n.dmgToB && f.deadA <= n.deadA) breaksStalemate++;
  console.log('\n  seed ' + String(r.seed).padStart(5) + '  (機動命令 ' + f.maneuverIssued + '件)');
  console.log('    正面のみ  側面射撃 ' + String(n.flankShots).padStart(3) + '/' + n.totalShots
    + ' (' + nRate + '%)  B被害 ' + String(n.dmgToB).padStart(3) + '  A被害 ' + String(n.dmgToA).padStart(3)
    + '  死者 A' + n.deadA + '/B' + n.deadB);
  console.log('    側面機動  側面射撃 ' + String(f.flankShots).padStart(3) + '/' + f.totalShots
    + ' (' + flankRate + '%)  B被害 ' + String(f.dmgToB).padStart(3) + '  A被害 ' + String(f.dmgToA).padStart(3)
    + '  死者 A' + f.deadA + '/B' + f.deadB);
});

const half = Math.ceil(SEEDS.length / 2);
console.log('\n' + line(76));
console.log('側面射撃が実際に増えたシード: ' + flankWorks + '/' + SEEDS.length
  + '   （機構が働いているか）');
console.log('B被害が増え A被害が増えなかったシード: ' + breaksStalemate + '/' + SEEDS.length
  + '   （膠着を破れたか）');
const pass = flankWorks >= half && breaksStalemate >= half;
console.log('\n[基準2] 側面機動で膠着が破れる ... ' + (pass ? 'PASS' : 'FAIL'));
console.log(line(76) + '\n');

if (GATE && !pass) process.exit(1);
