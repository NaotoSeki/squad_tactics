/**
 * tests/sim_assault_attackmove.test.js -- 強襲は Attack Move
 *
 * ディレクター定義（2026-08-05）:
 *   「ターゲットを強襲している道すがら、敵の近くを通ったらそっちを攻撃して、
 *    戦闘不能まで陥れたら、最初のターゲットまでは自動で向かっていく」
 *
 * 旧実装は指定された的しか見ておらず、脇を通り過ぎる敵に一発も撃たなかった。
 * ここで固定するのは3点:
 *   ① 任務の的(primary)は道中で目標が変わっても保持される
 *   ② 接敵した敵は、的でなくても先に攻撃する
 *   ③ その敵が戦闘不能になったら、自動で元の的へ向かい直す
 *
 * No framework. Run with `node tests/sim_assault_attackmove.test.js`.
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

function flatMap() {
  return {
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
    },
    hasLos: () => true,
    cover: () => 0,
    moveCost: () => 1,
    neighbors: (h) => [
      { q: h.q + 1, r: h.r }, { q: h.q - 1, r: h.r },
      { q: h.q, r: h.r + 1 }, { q: h.q, r: h.r - 1 },
      { q: h.q + 1, r: h.r - 1 }, { q: h.q - 1, r: h.r + 1 },
    ],
  };
}
function rifle() { return toSimWeapon('m1', WPNS.m1 || { rng: 8, burst: 1, cap: 8 }, SIM_TUNING); }

function makeSim(seed) {
  return new SimCore({
    map: flatMap(), tuning: SIM_TUNING, rng: mulberry32(seed || 99),
    policy: TraitPolicy, orders: new InstantOrders(),
  });
}
function add(sim, id, team, q, r, opts) {
  opts = opts || {};
  sim.addSoldier({
    id: id, team: team, q: q, r: r, weapon: rifle(), ammo: { mags: 6 },
    attrs: { speed: 5, recon: 5, str: 5, melee: 5 },
  });
  const s = sim._soldiers.get(id);
  if (opts.dry) { s.magRemaining = 0; s.magsLeft = 0; }
  return s;
}

// --- T1: 道中の敵へ目標が移り、片付いたら元の的へ戻る ----------------------
{
  const sim = makeSim(3);
  const hero = add(sim, 'hero', 'A', 0, 0);
  const far = add(sim, 'far', 'B', 20, 0, { dry: true });      // 任務の的（遠い）
  const bump = add(sim, 'bump', 'B', 5, 0, { dry: true });     // 道中で脇を通る敵
  add(sim, 'watchA', 'A', -40, 0, { dry: true });
  add(sim, 'watchB', 'B', 60, 0, { dry: true });

  sim.issueOrder({ type: 'ASSAULT', soldierIds: ['hero'], payload: { targetId: 'far' } });
  for (let t = 0; t < 5; t++) sim.tick();
  check('T1a 任務の的を覚えている', hero._assaultPrimaryId === 'far', hero._assaultPrimaryId);
  check('T1b 出だしは的を狙っている', hero.engageTargetId === 'far', hero.engageTargetId);

  // 接敵するまで進ませる
  let switched = null, contactEv = null;
  for (let t = 0; t < 400 && !switched; t++) {
    sim.tick();
    sim.drainEvents().forEach((e) => {
      if (e.type === 'ASSAULT_CONTACT' && e.id === 'hero' && !contactEv) contactEv = e;
    });
    if (hero.engageTargetId === 'bump') switched = { t: t, q: hero.q };
  }
  check('T1c 道中の敵へ目標が移る', !!switched, JSON.stringify(switched));
  check('T1d 任務の的は保持されたまま', hero._assaultPrimaryId === 'far', hero._assaultPrimaryId);
  check('T1e 接敵をイベントで通知する',
    !!contactEv && contactEv.targetId === 'bump' && contactEv.primaryId === 'far',
    JSON.stringify(contactEv));
  check('T1f まだ的の手前で切り替わっている', switched && switched.q < 20,
    switched && 'q=' + switched.q);

  // 道中の敵を戦闘不能にすると、自動で元の的へ向かい直す
  bump.hp = 0; bump.state = 'down';
  let resumed = null;
  for (let t = 0; t < 200 && !resumed; t++) {
    sim.tick();
    if (hero.engageTargetId === 'far') resumed = { t: t, q: hero.q };
  }
  check('T1g 片付いたら自動で元の的へ戻る', !!resumed, JSON.stringify(resumed));
  check('T1h 強襲は続いている（解除されていない）', hero.state === 'assault', hero.state);

  const qAtResume = resumed ? resumed.q : hero.q;
  for (let t = 0; t < 200; t++) sim.tick();
  check('T1i 元の的へ向かって前進を再開する', hero.q > qAtResume,
    `${qAtResume} -> ${hero.q}`);
}

// --- T2: 接敵した相手には実際に撃つ（素通りしない） ------------------------
{
  const sim = makeSim(5);
  const hero = add(sim, 'hero', 'A', 0, 0);                    // 弾あり
  add(sim, 'far', 'B', 20, 0, { dry: true });
  const bump = add(sim, 'bump', 'B', 4, 0, { dry: true });
  add(sim, 'watchA', 'A', -40, 0, { dry: true });
  add(sim, 'watchB', 'B', 60, 0, { dry: true });

  sim.issueOrder({ type: 'ASSAULT', soldierIds: ['hero'], payload: { targetId: 'far' } });
  let shotsAtBump = 0, meleeAtBump = 0;
  for (let t = 0; t < 500; t++) {
    sim.tick();
    // SHOT の撃ち手は shooterId（id ではない）
    sim.drainEvents().forEach((e) => {
      if (e.type === 'SHOT' && e.shooterId === 'hero' && e.targetId === 'bump') shotsAtBump++;
      if (e.type === 'MELEE_START' && e.id === 'hero' && e.targetId === 'bump') meleeAtBump++;
    });
    if (bump.hp <= 0 || bump.state === 'incap') break;
  }
  check('T2 脇の敵を素通りせず攻撃する', shotsAtBump + meleeAtBump > 0,
    `shots=${shotsAtBump} melee=${meleeAtBump} bumpHp=${bump.hp}`);
}

// --- T3: 的が接敵距離に居るなら寄り道しない -------------------------------
// 「近くに別の敵が居るから」で任務を放り出したら強襲にならない
{
  const sim = makeSim(7);
  const hero = add(sim, 'hero', 'A', 0, 0, { dry: true });
  add(sim, 'target', 'B', 1, 0, { dry: true });     // 的が目の前
  add(sim, 'other', 'B', 1, -1, { dry: true });     // 別の敵も同じくらい近い
  add(sim, 'watchA', 'A', -40, 0, { dry: true });
  add(sim, 'watchB', 'B', 60, 0, { dry: true });

  sim.issueOrder({ type: 'ASSAULT', soldierIds: ['hero'], payload: { targetId: 'target' } });
  for (let t = 0; t < 10; t++) sim.tick();
  check('T3 的が手の届く所に居れば的を優先する', hero.engageTargetId === 'target',
    hero.engageTargetId);
}

// --- T4: 遠くの敵には引っ張られない（接敵距離の外） ------------------------
{
  const sim = makeSim(11);
  const hero = add(sim, 'hero', 'A', 0, 0, { dry: true });
  add(sim, 'far', 'B', 20, 0, { dry: true });
  const contact = SIM_TUNING.ASSAULT_CONTACT_RNG;
  add(sim, 'aside', 'B', 0, contact + 3, { dry: true });   // 接敵距離の外に居る
  add(sim, 'watchA', 'A', -40, 0, { dry: true });
  add(sim, 'watchB', 'B', 60, 0, { dry: true });

  sim.issueOrder({ type: 'ASSAULT', soldierIds: ['hero'], payload: { targetId: 'far' } });
  for (let t = 0; t < 10; t++) sim.tick();
  check('T4a 前提: 強襲に入っている', hero.state === 'assault', hero.state);
  check('T4b 接敵距離の外の敵には目標を移さない', hero.engageTargetId === 'far',
    `engage=${hero.engageTargetId} contactRng=${contact}`);
}

// --- T5: 移動命令の遂行中でも、接敵したら足を止めて撃つ --------------------
// 移動命令は currentOrder として残り policy.decide() を覆い隠すので、移動中の兵は
// 的を探すことすらしなかった。結果、敵と1hexですれ違っても互いに無発砲だった
// （2026-08-05 ディレクター報告「敵と対峙しても互いに素通りする」。実測: 両軍の
// 前進が交差して700tick走らせても総発砲0）。
{
  const sim = makeSim(21);
  const walker = add(sim, 'walker', 'A', 0, 0);            // 弾あり
  const foe = add(sim, 'foe', 'B', 5, 0, { dry: true });   // 経路上の脇に居る
  add(sim, 'watchA', 'A', -40, 0, { dry: true });
  add(sim, 'watchB', 'B', 60, 0, { dry: true });

  const route = [];
  for (let i = 1; i <= 20; i++) route.push({ q: i, r: 0 });
  sim.issueOrder({
    type: 'MOVE_TO', soldierIds: ['walker'],
    payload: { path: route, mode: 'walk', selfInitiated: true },
  });

  let contactEv = null, shots = 0, stoppedAtQ = null;
  for (let t = 0; t < 400; t++) {
    sim.tick();
    sim.drainEvents().forEach((e) => {
      if (e.type === 'CONTACT' && e.id === 'walker' && !contactEv) {
        contactEv = e; stoppedAtQ = walker.q;
      }
      if (e.type === 'SHOT' && e.shooterId === 'walker' && e.targetId === 'foe') shots++;
    });
    if (shots > 0) break;
  }
  check('T5a 移動中に接敵すると足を止める', !!contactEv && walker.state === 'engage',
    `contact=${!!contactEv} state=${walker.state}`);
  check('T5b 素通りせず撃つ', shots > 0, 'shots=' + shots);
  check('T5c 通り過ぎる前に止まっている', stoppedAtQ != null && stoppedAtQ <= foe.q + 1,
    `stoppedAt q=${stoppedAtQ} foe q=${foe.q}`);

  // 接敵が片付けば、残りの経路で移動を再開する（命令は捨てていない）
  foe.hp = 0; foe.state = 'down';
  let resumed = false;
  const qAtStop = walker.q;
  for (let t = 0; t < 300; t++) {
    sim.tick();
    if (walker.q > qAtStop) { resumed = true; break; }
  }
  check('T5d 片付いたら残りの経路で移動を再開する', resumed,
    `q ${qAtStop} -> ${walker.q}`);
}

// --- T6: 撃てない兵は足を止めない（止めても撃てず往復するだけ） -------------
{
  const sim = makeSim(23);
  const walker = add(sim, 'walker', 'A', 0, 0, { dry: true });   // 弾切れ
  add(sim, 'foe', 'B', 5, 0, { dry: true });
  add(sim, 'watchA', 'A', -40, 0, { dry: true });
  add(sim, 'watchB', 'B', 60, 0, { dry: true });
  const route = [];
  for (let i = 1; i <= 20; i++) route.push({ q: i, r: 0 });
  sim.issueOrder({
    type: 'MOVE_TO', soldierIds: ['walker'],
    payload: { path: route, mode: 'walk', selfInitiated: true },
  });
  for (let t = 0; t < 400; t++) sim.tick();
  check('T6 弾の無い兵は接敵しても止まらず通り抜ける', walker.q > 6,
    `q=${walker.q} state=${walker.state}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
