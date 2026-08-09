/**
 * tests/sim_assault_suppression.test.js -- 突撃は制圧では止まらない
 *
 * ディレクター定義（2026-08-04）:
 *   「制圧では止まらず、ヒットしたらもちろん倒れる。頭を下げさせられるのは
 *    釘付け(PINNED_AT)まで。」
 *
 * 旧実装では _checkSuppressionThresholds が assault 状態を suppressed で
 * 上書きしていたため、突撃兵は平野の中腹で**無言のまま突撃を失い**
 * （ASSAULT_END も出ず、engageTargetId と _assaultHex が残骸として残る）、
 * 制圧が抜けた後に policy が遮蔽へ連れ戻していた。盤面には「突っ込んだのに
 * 何もせず戻ってきた」だけが見えていた。ここはその再発防止。
 *
 * No framework. Run with `node tests/sim_assault_suppression.test.js`.
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

function makeSim() {
  return new SimCore({
    map: flatMap(), tuning: SIM_TUNING, rng: mulberry32(555),
    policy: TraitPolicy, orders: new InstantOrders(),
  });
}
function addSoldier(sim, id, team, q, r) {
  sim.addSoldier({
    id: id, team: team, q: q, r: r, weapon: rifle(), ammo: { mags: 0 },
    attrs: { speed: 5, recon: 5, str: 5, melee: 5 },
  });
  const s = sim._soldiers.get(id);
  s.magRemaining = 0; s.magsLeft = 0;   // 撃ち合いで足を止めさせない
  return s;
}

/** 突撃中の兵へ制圧値を直接載せ、閾値判定を通した結果を見る */
function assaultUnderSuppression(level) {
  const sim = makeSim();
  const hero = addSoldier(sim, 'hero', 'A', 0, 0);
  addSoldier(sim, 'foe', 'B', 10, 0);
  addSoldier(sim, '_watchA', 'A', -40, 0);
  addSoldier(sim, '_watchB', 'B', 60, 0);
  sim.issueOrder({ type: 'ASSAULT', soldierIds: ['hero'], payload: { targetId: 'foe' } });
  for (let t = 0; t < 20; t++) sim.tick();          // 突撃に乗せる
  const started = hero.state === 'assault';
  const qBefore = hero.q;

  hero.suppression = level;
  sim._checkSuppressionThresholds(hero, SIM_TUNING);
  const stateAfter = hero.state;

  const events = [];
  for (let t = 0; t < 40; t++) {
    hero.suppression = level;                        // 撃たれ続けている状況を維持
    sim.tick();
    sim.drainEvents().forEach((e) => { if (e.id === 'hero') events.push(e.type); });
  }
  return {
    started: started, stateAfter: stateAfter, hero: hero, events: events,
    advanced: hero.q - qBefore,
  };
}

// --- T1: 制圧(SUPPRESSED_AT)では突撃は止まらない ----------------------------
{
  const r = assaultUnderSuppression(SIM_TUNING.SUPPRESSED_AT + 5);
  check('T1a 前提: 突撃状態に入っている', r.started, '');
  check('T1b 制圧を浴びても assault のまま', r.stateAfter === 'assault', r.stateAfter);
  check('T1c 制圧下でも前進を続ける', r.advanced > 0, 'advanced=' + r.advanced);
  check('T1d 突撃は解除されない', r.events.indexOf('ASSAULT_END') < 0, r.events.join(','));
}

// --- T2: 釘付け(PINNED_AT)なら頓挫する。ただし正式に畳む -------------------
{
  const r = assaultUnderSuppression(SIM_TUNING.PINNED_AT + 5);
  check('T2a 釘付けまで浴びれば突撃は頓挫する', r.stateAfter === 'pinned', r.stateAfter);
  check('T2b 黙って消えるのではなく ASSAULT_END が出る',
    r.events.indexOf('ASSAULT_END') >= 0, r.events.join(','));
  check('T2c 残骸(engageTargetId)を残さない', r.hero.engageTargetId == null,
    String(r.hero.engageTargetId));
  check('T2d 残骸(_assaultHex)を残さない', r.hero._assaultHex == null,
    JSON.stringify(r.hero._assaultHex));
  check('T2e 装填の戻り札も残さない', r.hero._assaultResume === false,
    String(r.hero._assaultResume));
}

// --- T3: 弾は当たる。制圧に強いことと不死身は別 -----------------------------
{
  const sim = makeSim();
  const hero = addSoldier(sim, 'hero', 'A', 0, 0);
  addSoldier(sim, 'foe', 'B', 10, 0);
  addSoldier(sim, '_watchA', 'A', -40, 0);
  addSoldier(sim, '_watchB', 'B', 60, 0);
  sim.issueOrder({ type: 'ASSAULT', soldierIds: ['hero'], payload: { targetId: 'foe' } });
  for (let t = 0; t < 20; t++) sim.tick();
  hero.suppression = SIM_TUNING.SUPPRESSED_AT + 5;
  const hpBefore = hero.hp;
  sim._applyDamage(hero, 40, sim._soldiers.get('foe'));
  check('T3 制圧では止まらないが、被弾すればHPは減る',
    hero.hp === hpBefore - 40, `${hpBefore} -> ${hero.hp}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
