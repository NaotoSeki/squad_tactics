/**
 * tests/sim_incap_prone.test.js -- 行動不能(incap)・姿勢(prone)・自衛で伏せる の受入テスト
 *
 * 2026-08-02 追加分3機構の回帰テスト。No framework. Run with `node tests/sim_incap_prone.test.js`.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const { SimCore, mulberry32, toSimWeapon, InstantOrders } =
  require(path.join(__dirname, '..', 'sim_core.js'));
const { TraitPolicy } = require(path.join(__dirname, '..', 'sim_policy.js'));

// data.js targets the browser (globals via `window`), so load it through vm with a
// minimal window stub and pull out WPNS / SIM_TUNING.
function loadDataJs() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const exposeTail = '\n;this.WPNS = WPNS; this.SIM_TUNING = SIM_TUNING;\n';
  const sandbox = { module: { exports: {} }, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + exposeTail, sandbox, { filename: 'data.js' });
  return sandbox;
}
const dataSandbox = loadDataJs();
const WPNS = dataSandbox.WPNS;
const SIM_TUNING = dataSandbox.SIM_TUNING;

let passCount = 0;
let failCount = 0;
const failures = [];

function check(cond, label) {
  if (cond) {
    passCount++;
    console.log('PASS: ' + label);
  } else {
    failCount++;
    failures.push(label);
    console.log('FAIL: ' + label);
  }
}

// ---------------------------------------------------------------------------
// Grid stub MapApi (axial hex coords) -- mirrors tests/sim_core.test.js
// ---------------------------------------------------------------------------

function makeGridMap(opts) {
  opts = opts || {};
  const coverAt = opts.coverAt || (() => 0.6);
  const losBlocked = opts.losBlocked || (() => false);
  return {
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    },
    hasLos: (a, b) => !losBlocked(a, b),
    cover: (hex) => coverAt(hex),
    moveCost: () => 1,
    neighbors: (hex) => [
      { q: hex.q + 1, r: hex.r }, { q: hex.q - 1, r: hex.r },
      { q: hex.q, r: hex.r + 1 }, { q: hex.q, r: hex.r - 1 },
      { q: hex.q + 1, r: hex.r - 1 }, { q: hex.q - 1, r: hex.r + 1 },
    ],
  };
}

const rifle = toSimWeapon('m1', WPNS.m1, SIM_TUNING);

// ===========================================================================
// 1. incap: hp が INCAP_AT_HP 以下まで削られる（0より上）と state='incap'
// ===========================================================================

{
  const map = makeGridMap({ coverAt: () => 0.6 });
  const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: mulberry32(1) });
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 5 }, skill: 1.0, facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'b1', team: 'B', q: 3, r: 0, weapon: rifle, ammo: { mags: 5 }, skill: 1.0, facing: { q: -1, r: 0 } });
  const a1 = sim._soldiers.get('a1');
  const b1 = sim._soldiers.get('b1');

  a1.engageTargetId = 'b1';
  a1.currentOrder = { type: 'TARGET', soldierIds: ['a1'], payload: { targetId: 'b1', mode: 'aimed' } };
  a1.movePath = [{ q: 1, r: 0 }];
  a1.fireMode = 'aimed';

  const dmg = 100 - SIM_TUNING.INCAP_AT_HP; // hp を丁度 INCAP_AT_HP まで削る
  const killed = sim._applyDamage(a1, dmg, b1);
  const events = sim.drainEvents();
  const incapEv = events.find((ev) => ev.type === 'INCAP' && ev.id === 'a1');

  check(!killed, '前提: この一撃では死亡しない');
  check(a1.hp === SIM_TUNING.INCAP_AT_HP, `前提: hp が丁度 INCAP_AT_HP(=${SIM_TUNING.INCAP_AT_HP}) になっている`);
  check(a1.state === 'incap', 'INCAP_AT_HP 以下(0より上)まで削られると state が incap になる');
  check(!!incapEv, 'INCAP イベントが emit される');
  check(a1.engageTargetId === null, '行動不能で engageTargetId が消える');
  check(a1.currentOrder === null, '行動不能で currentOrder が消える');
  check(a1.movePath === null, '行動不能で movePath が消える');
  check(a1.fireMode === 'hold', '行動不能で fireMode が hold になる');
}

// ===========================================================================
// 2. hp が 0 まで落ちた場合は incap ではなく従来どおり down（死亡）
// ===========================================================================

{
  const map = makeGridMap({ coverAt: () => 0.6 });
  const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: mulberry32(2) });
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 5 }, skill: 1.0, facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'b1', team: 'B', q: 3, r: 0, weapon: rifle, ammo: { mags: 5 }, skill: 1.0, facing: { q: -1, r: 0 } });
  const a1 = sim._soldiers.get('a1');
  const b1 = sim._soldiers.get('b1');

  const killed = sim._applyDamage(a1, 100, b1);
  const events = sim.drainEvents();
  const downEv = events.find((ev) => ev.type === 'DOWN' && ev.id === 'a1');
  const incapEv = events.find((ev) => ev.type === 'INCAP' && ev.id === 'a1');

  check(killed, 'hp0まで削ると _applyDamage は true(死亡)を返す');
  check(a1.hp === 0, 'hp は 0');
  check(a1.state === 'down', 'hp0は incap ではなく従来どおり down になる');
  check(!!downEv, 'DOWN イベントが emit される');
  check(!incapEv, 'hp0のケースで INCAP イベントは出ない');
}

// ===========================================================================
// 3. 行動不能兵は以後 tick を回しても SHOT を出さない（_phaseAct / _phaseDecide の除外）
// ===========================================================================

{
  const map = makeGridMap({ coverAt: () => 0.6 });
  const sim = new SimCore({
    map: map, tuning: SIM_TUNING, rng: mulberry32(3), policy: TraitPolicy, orders: new InstantOrders(),
  });
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'b1', team: 'B', q: 3, r: 0, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, facing: { q: -1, r: 0 } });
  sim.issueOrder({ type: 'TARGET', soldierIds: ['a1'], payload: { targetId: 'b1', mode: 'aimed' } });

  // 少し回して engage 状態を確立させる
  for (let i = 0; i < 10; i++) sim.tick();
  sim.drainEvents();

  const a1 = sim._soldiers.get('a1');
  const b1 = sim._soldiers.get('b1');
  // 実装どおりの経路で incap を発生させる（_applyDamage の副作用に依存）。
  const dmg = a1.hp - SIM_TUNING.INCAP_AT_HP;
  sim._applyDamage(a1, dmg, b1);
  sim.drainEvents();
  check(a1.state === 'incap', '前提: a1 は incap になっている');

  let shotByA1 = false;
  for (let i = 0; i < 200; i++) {
    sim.tick();
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'SHOT' && ev.shooterId === 'a1') shotByA1 = true;
    }
  }
  check(!shotByA1, '行動不能兵は以後 tick を回しても SHOT を出さない');
  check(a1.state === 'incap', '行動不能状態は自己判断でも命令適用でも解除されない');
}

// ===========================================================================
// 4. 行動不能兵しか残っていないチームは result() で敗北側になる
// ===========================================================================

{
  const map = makeGridMap({ coverAt: () => 0.6 });
  const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: mulberry32(4) });
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 5 }, skill: 1.0, facing: { q: 1, r: 0 } });
  // 遠く離して以後の戦闘に関わらせない
  sim.addSoldier({ id: 'b1', team: 'B', q: 50, r: 50, weapon: rifle, ammo: { mags: 5 }, skill: 1.0, facing: { q: -1, r: 0 } });

  const a1 = sim._soldiers.get('a1');
  a1.hp = SIM_TUNING.INCAP_AT_HP;
  a1.state = 'incap';
  a1.engageTargetId = null;
  a1.currentOrder = null;
  a1.movePath = null;
  a1.fireMode = 'hold';

  let result = null;
  for (let i = 0; i < 5 && !result; i++) {
    sim.tick();
    result = sim.result();
  }
  check(!!result, '行動不能兵しか居ないチームがあると result() が確定する');
  check(result && result.winner === 'B', '行動不能兵しか残っていないAチームは敗北側になる（B勝利）');
}

// ===========================================================================
// 5. 行動不能な敵も目標候補に残る
//
// 一度は「撃つ価値がない」として除外したが、倒れた敵を撃つかどうかは戦場の
// 判断であって、AIが勝手に安全な相手と決めてよいものではない（オーナー指摘
// 2026-08-02）。射撃の節制は fire discipline 側の仕事。
// ===========================================================================

{
  function decide(soldier, others, map) {
    return TraitPolicy.decide(soldier, { soldiers: [soldier].concat(others), map: map, tuning: SIM_TUNING }, () => 0.5);
  }
  const map = makeGridMap({ coverAt: () => 0.2 });
  const shooter = {
    id: 'a1', team: 'A', q: 0, r: 0, weapon: { rngMax: 10, cls: 'rifle' },
    traits: [], hp: 100, state: 'idle', suppression: 0, morale: 100,
    movePath: null, currentOrder: null, magRemaining: 5, magsLeft: 5,
  };
  const incapEnemy = { id: 'b1', team: 'B', q: 2, r: 0, hp: 20, state: 'incap', suppression: 0 };
  const out = decide(shooter, [incapEnemy], map);
  check(out.type === 'TARGET' && out.payload.targetId === 'b1',
    '行動不能な敵も目標候補に残る（AIが勝手に無視しない）');
}

// ===========================================================================
// 6. GO_PRONE intent で prone が true になり、PRONE イベントが出る（重複emitなし）
// ===========================================================================

{
  const map = makeGridMap({ coverAt: () => 0.2 });
  const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: mulberry32(5) });
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 5 }, skill: 1.0, facing: { q: 1, r: 0 } });
  const a1 = sim._soldiers.get('a1');
  check(a1.prone === false, '前提: 初期状態は伏せていない');

  sim._applyIntent(a1, { type: 'GO_PRONE', soldierIds: ['a1'], payload: {} }, {});
  const events1 = sim.drainEvents();
  check(a1.prone === true, 'GO_PRONE intent で prone が true になる');
  check(events1.filter((ev) => ev.type === 'PRONE').length === 1, 'PRONE イベントが1件出る');
  check(events1.some((ev) => ev.type === 'PRONE' && ev.prone === true), 'PRONE イベントの prone は true');

  sim._applyIntent(a1, { type: 'GO_PRONE', soldierIds: ['a1'], payload: {} }, {});
  const events2 = sim.drainEvents();
  check(a1.prone === true, '既に伏せていれば prone のままtrue');
  check(events2.filter((ev) => ev.type === 'PRONE').length === 0, '既に伏せていれば PRONE を重複 emit しない');
}

// ===========================================================================
// 7. 伏せた目標への pHit が下がる(PHIT_VS_PRONE)。十分な試行回数で命中数を比較する。
// ===========================================================================

function runBurstTrials(seed, n, proneTarget) {
  const map = makeGridMap({ coverAt: () => 0.3 });
  const rng = mulberry32(seed);
  const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: rng });
  sim.addSoldier({ id: 'sh', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 999 }, skill: 1.0, facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'tg', team: 'B', q: 2, r: 0, weapon: rifle, ammo: { mags: 999 }, skill: 1.0, facing: { q: -1, r: 0 } });
  const shooter = sim._soldiers.get('sh');
  const target = sim._soldiers.get('tg');
  target.prone = proneTarget;

  let hits = 0;
  for (let i = 0; i < n; i++) {
    target.hp = 100;
    target.state = 'idle';
    shooter.magRemaining = shooter.weapon.magCap;
    sim._resolveBurst(shooter, target, SIM_TUNING);
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'SHOT' && ev.hit) hits++;
    }
  }
  return hits;
}

{
  const N = 2000;
  const hitsStanding = runBurstTrials(101, N, false);
  const hitsProne = runBurstTrials(101, N, true);
  check(hitsStanding > 0, `前提: 立っている的には十分な回数命中する (${hitsStanding}/${N})`);
  check(hitsProne < hitsStanding,
    `伏せた目標への命中数は立っている目標より少ない (prone=${hitsProne} standing=${hitsStanding} / ${N}回)`);
  const ratio = hitsStanding > 0 ? hitsProne / hitsStanding : 0;
  check(ratio < 0.8, `命中比が PHIT_VS_PRONE(=${SIM_TUNING.PHIT_VS_PRONE}) 相当に近い低さになる (ratio=${ratio.toFixed(2)})`);
}

// 動いている間は伏せていても的が小さくならない（PHIT_VS_PRONE は state!=='move' の時だけ効く）
{
  const map = makeGridMap({ coverAt: () => 0.3 });
  const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: mulberry32(102) });
  sim.addSoldier({ id: 'sh', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 999 }, skill: 1.0, facing: { q: 1, r: 0 } });
  sim.addSoldier({ id: 'tg', team: 'B', q: 2, r: 0, weapon: rifle, ammo: { mags: 999 }, skill: 1.0, facing: { q: -1, r: 0 } });
  const shooter = sim._soldiers.get('sh');
  const target = sim._soldiers.get('tg');
  target.prone = true;
  target.state = 'move';
  let hitsMoving = 0;
  const N = 1500;
  for (let i = 0; i < N; i++) {
    target.hp = 100;
    shooter.magRemaining = shooter.weapon.magCap;
    sim._resolveBurst(shooter, target, SIM_TUNING);
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'SHOT' && ev.hit) hitsMoving++;
    }
  }
  const map2 = makeGridMap({ coverAt: () => 0.3 });
  const sim2 = new SimCore({ map: map2, tuning: SIM_TUNING, rng: mulberry32(102) });
  sim2.addSoldier({ id: 'sh', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 999 }, skill: 1.0, facing: { q: 1, r: 0 } });
  sim2.addSoldier({ id: 'tg', team: 'B', q: 2, r: 0, weapon: rifle, ammo: { mags: 999 }, skill: 1.0, facing: { q: -1, r: 0 } });
  const shooter2 = sim2._soldiers.get('sh');
  const target2 = sim2._soldiers.get('tg');
  target2.prone = false;
  target2.state = 'move';
  let hitsMovingNotProne = 0;
  for (let i = 0; i < N; i++) {
    target2.hp = 100;
    shooter2.magRemaining = shooter2.weapon.magCap;
    sim2._resolveBurst(shooter2, target2, SIM_TUNING);
    for (const ev of sim2.drainEvents()) {
      if (ev.type === 'SHOT' && ev.hit) hitsMovingNotProne++;
    }
  }
  check(hitsMoving === hitsMovingNotProne,
    `移動中は prone でも PHIT_VS_PRONE が効かない (prone=${hitsMoving} 非prone=${hitsMovingNotProne})`);
}

// ===========================================================================
// 8. prone の兵が pinned でない状態で移動命令を受けると、PRONE_STANDUP_T tick は
//    動かず、その後 prone が false になって動き出す
// ===========================================================================

{
  const map = makeGridMap({ coverAt: () => 0.2 });
  const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: mulberry32(6) });
  sim.addSoldier({ id: 'p1', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 5 }, skill: 1.0, facing: { q: 1, r: 0 } });
  const s = sim._soldiers.get('p1');
  const T = SIM_TUNING;
  s.prone = true;
  s.state = 'move';
  s.movePath = [{ q: 1, r: 0 }];
  s.suppression = 0; // PINNED_AT 未満・state も pinned ではない -> crawling ではない

  for (let i = 0; i < T.PRONE_STANDUP_T - 1; i++) {
    sim._actMove(s, T);
  }
  check(s.prone === true, `PRONE_STANDUP_T(=${T.PRONE_STANDUP_T}) tick 未満では伏せたまま`);
  check(s.q === 0 && s.r === 0, '立ち上がりが終わるまでは移動しない');

  const beforeEvents = sim.drainEvents();
  check(beforeEvents.every((ev) => ev.type !== 'PRONE'), 'まだ PRONE(立ち上がり完了) イベントは出ていない');

  sim._actMove(s, T); // PRONE_STANDUP_T 回目: 立ち上がり完了
  const standEvents = sim.drainEvents();
  check(s.prone === false, `PRONE_STANDUP_T tick経過後に prone が false になる`);
  check(standEvents.some((ev) => ev.type === 'PRONE' && ev.prone === false),
    '立ち上がり完了時に PRONE{prone:false} が emit される');

  // 立ち上がった後、通常の移動所要tickをかけて実際に動き出す
  let moved = false;
  for (let i = 0; i < 30 && !moved; i++) {
    sim._actMove(s, T);
    if (s.q === 1 && s.r === 0) moved = true;
  }
  check(moved, '立ち上がった後は通常どおり動き出す');
}

// pinned(crawling) の場合は立ち上がらず匍匐のまま動く
{
  const map = makeGridMap({ coverAt: () => 0.2 });
  const sim = new SimCore({ map: map, tuning: SIM_TUNING, rng: mulberry32(7) });
  sim.addSoldier({ id: 'p1', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 5 }, skill: 1.0, facing: { q: 1, r: 0 } });
  const s = sim._soldiers.get('p1');
  const T = SIM_TUNING;
  s.prone = true;
  s.state = 'pinned';
  s.movePath = [{ q: 1, r: 0 }];
  s.suppression = T.PINNED_AT;

  let moved = false;
  let stayedProne = true;
  for (let i = 0; i < 60 && !moved; i++) {
    sim._actMove(s, T);
    if (!s.prone) stayedProne = false;
    if (s.q === 1 && s.r === 0) moved = true;
  }
  const events = sim.drainEvents();
  check(stayedProne, 'pinned(crawling)では立ち上がらず伏せたまま');
  check(moved, 'pinned でも匍匐前進で目的地へは動く');
  check(events.every((ev) => !(ev.type === 'PRONE' && ev.prone === false)),
    'pinned で匍匐している間は立ち上がりの PRONE イベントを出さない');
}

// ===========================================================================
// 9. selfPreserve が退避先の無い開豁地で GO_PRONE を返す
// ===========================================================================

const NEIGHBORS = [
  { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 },
  { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 1 },
];

/** coverMap: "q,r" -> cover(0..1)。未登録は defaultCover。tests/sim_policy_cover.test.js のヘルパを流用。 */
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
    traits: [], hp: 100, state: 'idle', suppression: SIM_TUNING.COVER_SEEK_AT, morale: 100,
    movePath: null, currentOrder: null,
  }, over || {});
}

function preserve(soldier, map, others) {
  return TraitPolicy.selfPreserve(
    soldier,
    { soldiers: [soldier].concat(others || []), map: map, tuning: SIM_TUNING, tick: 0 },
    () => 0.5
  );
}

{
  // 全マス cover 0 の開豁地: どこへ動いても必要な遮蔽改善(COVER_SEEK_MIN_GAIN)を満たせない
  const map = makeMap({}, 0);
  const out = preserve(makeSoldier(), map, []);
  check(!!out && out.type === 'GO_PRONE', '退避先の無い開豁地では GO_PRONE を返す');
  check(out && out.note && out.note.indexOf('伏せる') !== -1, 'GO_PRONE のノートに「伏せる」が含まれる');
}

{
  // 既に伏せている兵には GO_PRONE を重ねて返さない（selfPreserve は !s.prone を条件にしている）
  const map = makeMap({}, 0);
  const out = preserve(makeSoldier({ prone: true }), map, []);
  check(out === null, '既に伏せていれば GO_PRONE を重ねて返さない（null）');
}

// ===========================================================================
// 10. _phaseDecide 統合: TARGET 命令下でも、退避先の無い開豁地では GO_PRONE が
//     割り込んで実際に伏せる（MOVE_TO だけでなく GO_PRONE も命令へ割り込む）
// ===========================================================================

{
  const map = makeGridMap({ coverAt: () => 0 }); // どこにも十分な遮蔽が無い
  const sim = new SimCore({
    map: map, tuning: SIM_TUNING, rng: mulberry32(8), policy: TraitPolicy, orders: new InstantOrders(),
  });
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, facing: { q: 1, r: 0 }, isLeader: true });
  sim.addSoldier({ id: 'b1', team: 'B', q: 6, r: 0, weapon: rifle, ammo: { mags: 10 }, skill: 1.0, facing: { q: -1, r: 0 } });
  sim.issueOrder({ type: 'TARGET', soldierIds: ['a1'], payload: { targetId: 'b1', mode: 'aimed' } });
  sim.tick(); // 即時配達
  sim.drainEvents();

  const a1 = sim._soldiers.get('a1');
  check(a1.currentOrder && a1.currentOrder.type === 'TARGET', '前提: TARGET 命令が立っている');

  let becameProne = false;
  for (let i = 0; i < 60 && !becameProne; i++) {
    if (a1.suppression < SIM_TUNING.COVER_SEEK_AT) {
      a1.suppression = SIM_TUNING.COVER_SEEK_AT;
    }
    sim.tick();
    sim.drainEvents();
    if (a1.prone) becameProne = true;
  }
  check(becameProne, 'TARGET 命令下でも、退避先の無い開豁地では GO_PRONE に割り込まれて伏せる');
}

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
if (failCount) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
