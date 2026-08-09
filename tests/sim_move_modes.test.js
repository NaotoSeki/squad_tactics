/**
 * tests/sim_move_modes.test.js -- 機動モード（walk/rush/crawl）と行動カタログ
 *
 * SIM_CORE_SPEC.md §14 宿題2「crawl/dash の機動技術」の受け入れテスト。
 * No framework. Run with `node tests/sim_move_modes.test.js`. Exits 0 on all-PASS.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const { SimCore, mulberry32, toSimWeapon, InstantOrders } =
  require(path.join(__dirname, '..', 'sim_core.js'));
const { TraitPolicy } = require(path.join(__dirname, '..', 'sim_policy.js'));
const { SimActions } = require(path.join(__dirname, '..', 'sim_actions.js'));

function loadDataJs() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const exposeTail = '\n;this.WPNS = WPNS; this.SIM_TUNING = SIM_TUNING;'
    + ' this.RIFLE_GRENADE_FOR_MAIN = RIFLE_GRENADE_FOR_MAIN;\n';
  const sandbox = { module: { exports: {} }, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'data.js' });
  // PL 実データ（pl_* の現物）は別ファイルで WPNS へ合流する。銃擲弾の適合先は
  // その現物なので、本編と同じ読み込み順を再現しないと参照できない。
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data', 'wpns_pl_master.js'), 'utf8'),
    sandbox, { filename: 'wpns_pl_master.js' });
  vm.runInContext(exposeTail, sandbox, { filename: 'expose' });
  return sandbox;
}
const dataSandbox = loadDataJs();
const WPNS = dataSandbox.WPNS;
const SIM_TUNING = dataSandbox.SIM_TUNING;

// --- 一様な平地マップ。地形要因を排して移動モードだけを測る -----------------
function flatMap(opts) {
  opts = opts || {};
  const cover = opts.cover != null ? opts.cover : 0;
  const los = opts.los !== false;
  return {
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
    },
    hasLos: () => los,
    cover: () => cover,
    moveCost: () => 1,
    neighbors: (h) => [
      { q: h.q + 1, r: h.r }, { q: h.q - 1, r: h.r },
      { q: h.q, r: h.r + 1 }, { q: h.q, r: h.r - 1 },
      { q: h.q + 1, r: h.r - 1 }, { q: h.q - 1, r: h.r + 1 },
    ],
  };
}

function rifle() { return toSimWeapon('m1', WPNS.m1 || { rng: 8, burst: 1, cap: 8 }, SIM_TUNING); }

function makeSim(mapOpts, policy) {
  const sim = new SimCore({
    map: flatMap(mapOpts), tuning: SIM_TUNING,
    rng: mulberry32(12345), policy: policy || TraitPolicy,
    orders: new InstantOrders(),
  });
  return sim;
}

function straight(from, n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ q: from.q + i, r: from.r });
  return out;
}

/** 経路 n hex を渡り切るのに要した tick を測る */
function ticksToCross(mode, traits) {
  const sim = makeSim({}, TraitPolicy);
  sim.addSoldier({
    id: 'a', team: 'A', q: 0, r: 0, weapon: rifle(),
    ammo: { mags: 4 }, traits: traits || [],
  });
  sim.issueOrder({
    type: 'MOVE_TO', soldierIds: ['a'],
    payload: { path: straight({ q: 0, r: 0 }, 4), mode: mode },
  });
  for (let t = 0; t < 800; t++) {
    sim.tick();
    const s = sim.getSoldier('a');
    if (s.q === 4) return t + 1;
  }
  return Infinity;
}

// ---------------------------------------------------------------------------

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}

// T1: rush は walk の約半分、crawl は約2.5倍の時間で渡る
const tWalk = ticksToCross('walk');
const tRush = ticksToCross('rush');
const tCrawl = ticksToCross('crawl');
check('T1a rush は walk より速い', tRush < tWalk, `walk=${tWalk} rush=${tRush}`);
check('T1b crawl は walk より遅い', tCrawl > tWalk, `walk=${tWalk} crawl=${tCrawl}`);
check('T1c 比率が MOVE_MODE_MULT に一致',
  Math.abs(tRush / tWalk - 0.5) < 0.25 && Math.abs(tCrawl / tWalk - 2.5) < 0.6,
  `walk=${tWalk} rush=${tRush} crawl=${tCrawl}`);

// T2: 突進の到着後は息が上がり、命中率が落ちる
{
  const sim = makeSim({});
  sim.addSoldier({ id: 'a', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.issueOrder({
    type: 'MOVE_TO', soldierIds: ['a'],
    payload: { path: straight({ q: 0, r: 0 }, 2), mode: 'rush' },
  });
  let winded = false;
  for (let t = 0; t < 300; t++) {
    sim.tick();
    if (sim.drainEvents().some((e) => e.type === 'WINDED')) winded = true;
    if (winded) break;
  }
  check('T2 rush 到着で WINDED が立つ', winded && sim.getSoldier('a').windedT > 0,
    'windedT=' + sim.getSoldier('a').windedT);
}

// T3: 匍匐中の目標は遮蔽を失わない（walk 中は失う）
//     同一シード・同一条件で、匍匐する的への命中数が歩く的より少ないこと。
function hitsAgainstMover(mode, shooterCode) {
  const sim = new SimCore({
    map: flatMap({ cover: 0.4 }), tuning: SIM_TUNING,
    rng: mulberry32(777), policy: TraitPolicy, orders: new InstantOrders(),
  });
  const w = shooterCode
    ? toSimWeapon(shooterCode, WPNS[shooterCode], SIM_TUNING) : rifle();
  sim.addSoldier({ id: 'shooter', team: 'B', q: 0, r: 0, weapon: w, ammo: { mags: 400 } });
  sim.addSoldier({ id: 'target', team: 'A', q: 3, r: 0, weapon: rifle(), ammo: { mags: 400 } });
  const tg = sim._soldiers.get('target');
  const sh = sim._soldiers.get('shooter');
  sh.engageTargetId = 'target';
  sh.fireMode = 'suppress';
  sh.state = 'engage';

  let hits = 0, bursts = 0;
  for (let t = 0; t < 6000; t++) {
    // 的を「渡っている最中」に固定する。実際に歩かせると到着・再命令のたびに
    // 状態が揺れ、両モードで同じ乱数列を消費してしまい比較にならない。
    tg.state = 'move';
    tg.moveMode = mode;
    tg.prone = (mode === 'crawl');
    tg.hp = 100;                 // 死んで打ち切られると試行数が揃わない
    tg.suppression = 0;
    sim.tick();
    sim.drainEvents().forEach((e) => {
      if (e.type === 'SHOT' && e.shooterId === 'shooter') { bursts++; if (e.hit) hits++; }
    });
    if (sh.magRemaining <= 0 && sh.magsLeft <= 0) break;
  }
  return { hits, bursts };
}
{
  const walkR = hitsAgainstMover('walk');
  const crawlR = hitsAgainstMover('crawl');
  const walkRate = walkR.hits / Math.max(1, walkR.bursts);
  const crawlRate = crawlR.hits / Math.max(1, crawlR.bursts);
  check('T3a 匍匐中の的は歩く的より当たりにくい（遮蔽を失わない）', crawlRate < walkRate,
    `walk=${walkRate.toFixed(4)}(${walkR.hits}/${walkR.bursts}) crawl=${crawlRate.toFixed(4)}(${crawlR.hits}/${crawlR.bursts})`);

  // §3.2 殺傷ベクトル4 の対: MG の射線では、匍匐と走りの差が最も大きくなる
  const mgCode = Object.keys(WPNS).find((c) => {
    const e = WPNS[c];
    return e && (e.burst >= 6 || e.cap >= 40) && e.type !== 'melee';
  });
  if (mgCode) {
    const mgWalk = hitsAgainstMover('walk', mgCode);
    const mgCrawl = hitsAgainstMover('crawl', mgCode);
    const wr = mgWalk.hits / Math.max(1, mgWalk.bursts);
    const cr = mgCrawl.hits / Math.max(1, mgCrawl.bursts);
    check('T3b MG相手では匍匐の優位が小銃相手より大きい',
      cr < wr && (wr - cr) > (walkRate - crawlRate),
      `${mgCode}: walk=${wr.toFixed(4)} crawl=${cr.toFixed(4)} / rifle差=${(walkRate - crawlRate).toFixed(4)} MG差=${(wr - cr).toFixed(4)}`);
  }
}

// T4: 性格が「どう渡るか」を変える（露出のある経路でのみ）
{
  // 露出あり: 敵が見ている（flatMap の hasLos は常に true）
  const sim = makeSim({});
  sim.addSoldier({ id: 'cautious', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 }, traits: ['cautious'] });
  sim.addSoldier({ id: 'foe', team: 'B', q: 9, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.issueOrder({
    type: 'MOVE_TO', soldierIds: ['cautious'],
    payload: { path: straight({ q: 0, r: 0 }, 3), mode: 'rush' },
  });
  sim.tick(); sim.tick(); sim.tick(); sim.tick(); sim.tick(); sim.tick();
  const s = sim.getSoldier('cautious');
  check('T4a 慎重は「走れ」を匍匐へ降格する', s.moveMode === 'crawl', 'mode=' + s.moveMode);
}
{
  const sim = makeSim({});
  sim.addSoldier({ id: 'aggro', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 }, traits: ['aggressive'] });
  sim.addSoldier({ id: 'foe', team: 'B', q: 9, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.issueOrder({
    type: 'MOVE_TO', soldierIds: ['aggro'],
    payload: { path: straight({ q: 0, r: 0 }, 3), mode: 'walk' },
  });
  for (let t = 0; t < 6; t++) sim.tick();
  const s = sim.getSoldier('aggro');
  check('T4b 攻撃的は「歩け」を駆け足へ格上げする', s.moveMode === 'rush', 'mode=' + s.moveMode);
}
{
  // 臆病は制圧下で命令を拒む
  const sim = makeSim({});
  sim.addSoldier({ id: 'timid', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 }, traits: ['timid'] });
  const internal = sim._soldiers.get('timid');
  internal.suppression = 60;
  sim.issueOrder({
    type: 'MOVE_TO', soldierIds: ['timid'],
    payload: { path: straight({ q: 0, r: 0 }, 3), mode: 'walk' },
  });
  let refused = false;
  for (let t = 0; t < 12; t++) {
    sim.tick();
    if (sim.drainEvents().some((e) => e.type === 'ORDER_REFUSED')) refused = true;
  }
  check('T4c 臆病は制圧下で移動命令を拒む', refused && sim.getSoldier('timid').q === 0,
    'q=' + sim.getSoldier('timid').q);
}

// T5: 自発移動（selfInitiated）は関門を素通りする — 自分の判断を検閲しない
{
  const sim = makeSim({});
  sim.addSoldier({ id: 'cautious', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 }, traits: ['cautious'] });
  sim.addSoldier({ id: 'foe', team: 'B', q: 9, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.issueOrder({
    type: 'MOVE_TO', soldierIds: ['cautious'],
    payload: { path: straight({ q: 0, r: 0 }, 3), mode: 'rush', selfInitiated: true },
  });
  for (let t = 0; t < 6; t++) sim.tick();
  check('T5 自発 rush は降格されない', sim.getSoldier('cautious').moveMode === 'rush',
    'mode=' + sim.getSoldier('cautious').moveMode);
}

// --- 行動カタログ -----------------------------------------------------------

function catalogCtx(sim, selfId, targetId, hex, pathArr) {
  const soldiers = sim.soldiers();
  const self = sim.getSoldier(selfId);
  return {
    self: self,
    target: targetId ? sim.getSoldier(targetId) : null,
    hex: hex || null,
    path: pathArr || null,
    squad: soldiers.filter((s) => s.team === self.team && s.hp > 0),
    world: { soldiers: soldiers, map: sim.map, tuning: SIM_TUNING },
  };
}

{
  const sim = makeSim({});
  sim.addSoldier({ id: 'a', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.addSoldier({ id: 'b', team: 'A', q: 1, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.addSoldier({ id: 'e', team: 'B', q: 4, r: 0, weapon: rifle(), ammo: { mags: 4 } });

  const listed = SimActions.list(catalogCtx(sim, 'a'));
  check('T6a カタログが表示順どおり全行動を返す',
    listed.length === SimActions.ORDER.length
    && listed[0].action.id === 'MOVE',
    listed.map((e) => e.action.id).join(','));

  const rushOrders = SimActions.issue('RUSH', catalogCtx(sim, 'a', null, { q: 3, r: 0 },
    straight({ q: 0, r: 0 }, 3)));
  check('T6b RUSH が mode:rush の MOVE_TO を出す',
    rushOrders.length === 1 && rushOrders[0].type === 'MOVE_TO'
    && rushOrders[0].payload.mode === 'rush',
    JSON.stringify(rushOrders));

  const focus = SimActions.issue('FOCUS_FIRE', catalogCtx(sim, 'a', 'e'));
  check('T6c FOCUS_FIRE が射程内の全員へ TARGET を出す',
    focus.length === 2 && focus.every((o) => o.type === 'TARGET' && o.payload.targetId === 'e'),
    'orders=' + focus.length);

  // 射程外の敵は理由付きで弾かれる
  sim.addSoldier({ id: 'far', team: 'B', q: 40, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  const verdict = SimActions.get('FIRE').available(catalogCtx(sim, 'a', 'far'));
  check('T6d 射程外は理由付きで非活性', !verdict.ok && verdict.reason === '射程外',
    JSON.stringify(verdict));

  check('T6e ホットキーが引ける',
    SimActions.byHotkey('s') === SimActions.get('SUPPRESS_HEX')
    && SimActions.byHotkey('V') === SimActions.get('ASSAULT'), '');
  check('T6f 個人の語彙は移動・制圧・強襲の3つ',
    SimActions.ORDER.filter((id) => SimActions.get(id).scope === 'self').join(',')
      === 'MOVE,SUPPRESS_HEX,ASSAULT',
    SimActions.ORDER.join(','));
  check('T6g 行動の中身（走る・射撃・投擲）は命令語彙から外れている',
    ['RUSH', 'CRAWL', 'FIRE', 'GRENADE', 'RIFLE_GRENADE']
      .every((id) => SimActions.ORDER.indexOf(id) < 0 && SimActions.HIDDEN.indexOf(id) >= 0),
    SimActions.HIDDEN.join(','));
}

// T7: 弾切れの兵はカタログ上でも撃てない（UI側で条件を再実装しないための保証）
{
  const sim = makeSim({});
  sim.addSoldier({ id: 'dry', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 0 } });
  sim.addSoldier({ id: 'e', team: 'B', q: 2, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  const internal = sim._soldiers.get('dry');
  internal.magRemaining = 0;
  const v = SimActions.get('FIRE').available(catalogCtx(sim, 'dry', 'e'));
  check('T7 弾切れは「弾切れ」理由で非活性', !v.ok && v.reason === '弾切れ', JSON.stringify(v));
}

// --- 面制圧（TARGET_HEX） ----------------------------------------------------

// T8: 地点を撃つと、その周囲の兵に制圧値が乗る。だが**誰も減らない**
{
  const sim = makeSim({});
  sim.addSoldier({ id: 'gunner', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 20 } });
  sim.addSoldier({ id: 'hidden', team: 'B', q: 4, r: 0, weapon: rifle(), ammo: { mags: 20 } });
  const hidden = sim._soldiers.get('hidden');
  hidden.fireMode = 'hold';   // 撃ち返させない（制圧の出所を一意にする）

  sim.issueOrder({
    type: 'TARGET_HEX', soldierIds: ['gunner'],
    payload: { hex: { q: 4, r: 0 }, mode: 'suppress' },
  });
  let areaShots = 0;
  for (let t = 0; t < 120; t++) {
    sim.tick();
    sim.drainEvents().forEach((e) => { if (e.type === 'SHOT' && e.area) areaShots++; });
  }
  const tgt = sim.getSoldier('hidden');
  check('T8a 面制圧が着弾点周囲へ制圧値を乗せる', tgt.suppression > 0,
    'suppression=' + tgt.suppression.toFixed(1) + ' shots=' + areaShots);
  check('T8b 面制圧は殺さない（命中判定を行わない）', tgt.hp === 100, 'hp=' + tgt.hp);
  // 2026-08-03: 致死性上昇で観測前に決着するようになった主張を撤去（ディレクター裁定）
}

// T9: 制圧に時間の寿命は無い（敵が居る限り続く）が、弾が尽きれば解除される
{
  const sim = makeSim({});
  sim.addSoldier({ id: 'gunner', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 1 } });
  sim.addSoldier({ id: 'foe', team: 'B', q: 4, r: 0, weapon: rifle(), ammo: { mags: 20 } });
  const foeS = sim._soldiers.get('foe');
  foeS.magRemaining = 0; foeS.magsLeft = 0;   // 撃ち返させない（見たいのは解除条件）
  anchorTeams(sim);
  sim.issueOrder({
    type: 'TARGET_HEX', soldierIds: ['gunner'],
    payload: { hex: { q: 4, r: 0 }, mode: 'suppress' },
  });
  let released = null;
  let hadAmmoAt150 = false;
  for (let t = 1; t <= 4000; t++) {
    sim.tick();
    sim.drainEvents().forEach((e) => { if (e.type === 'SUPPRESS_END' && !released) released = { t: t, reason: e.reason }; });
    // 旧仕様では 150tick で時間失効していた。そこを越えて継続することを確かめる
    if (t === 150) hadAmmoAt150 = sim.getSoldier('gunner').engageHex !== null;
  }
  // 2026-08-03: 致死性上昇で観測前に決着するようになった主張を撤去（ディレクター裁定）
}

// T10: 射程外・視線が通らない地点への面制圧は成立しない
{
  const sim = makeSim({ los: false });
  sim.addSoldier({ id: 'gunner', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 20 } });
  sim.issueOrder({
    type: 'TARGET_HEX', soldierIds: ['gunner'],
    payload: { hex: { q: 4, r: 0 }, mode: 'suppress' },
  });
  let shots = 0;
  for (let t = 0; t < 60; t++) {
    sim.tick();
    sim.drainEvents().forEach((e) => { if (e.type === 'SHOT') shots++; });
  }
  check('T10 視線の通らない地点は撃たない', shots === 0, 'shots=' + shots);
}

// --- 投擲弾（手榴弾・銃擲弾） ------------------------------------------------

function throwSim(kind, opts) {
  opts = opts || {};
  const sim = new SimCore({
    map: flatMap({ cover: opts.cover != null ? opts.cover : 0.5 }), tuning: SIM_TUNING,
    rng: mulberry32(4242), policy: TraitPolicy, orders: new InstantOrders(),
  });
  sim.addSoldier({
    id: 'thrower', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 },
    grenades: opts.grenades != null ? opts.grenades : 2,
    rifleGrenades: opts.rifleGrenades != null ? opts.rifleGrenades : 3,
  });
  const spec = SIM_TUNING.MUNITIONS[kind];
  const at = { q: Math.min(spec.rng, 3), r: 0 };
  sim.addSoldier({ id: 'victim', team: 'B', q: at.q, r: at.r, weapon: rifle(), ammo: { mags: 4 } });
  sim._soldiers.get('victim').fireMode = 'hold';
  sim.issueOrder({
    type: 'GRENADE', soldierIds: ['thrower'], payload: { hex: at, kind: kind },
  });
  const events = [];
  for (let t = 0; t < 200; t++) { sim.tick(); events.push.apply(events, sim.drainEvents()); }
  return { sim: sim, events: events, at: at };
}

{
  const r = throwSim('grenade');
  const thrown = r.events.find((e) => e.type === 'GRENADE');
  const blast = r.events.find((e) => e.type === 'BLAST');
  check('T11a 手榴弾が投擲され炸裂する', !!thrown && !!blast,
    'GRENADE=' + !!thrown + ' BLAST=' + !!blast);
  check('T11b 携行数が1減る', r.sim.getSoldier('thrower').grenades === 1,
    'grenades=' + r.sim.getSoldier('thrower').grenades);
  // cover 0.5 の的に確実にダメージが入る = 遮蔽を無視している証拠
  check('T11c 遮蔽下の敵にも効く（遮蔽を参照しない）',
    r.sim.getSoldier('victim').hp < 100,
    'hp=' + r.sim.getSoldier('victim').hp);
  check('T11d 構え→信管の順に時間がかかる',
    thrown && blast && blast.tick > thrown.tick
    && thrown.tick >= SIM_TUNING.MUNITIONS.grenade.prepT,
    'throw@' + (thrown && thrown.tick) + ' blast@' + (blast && blast.tick));
}

{
  const r = throwSim('rifle_grenade');
  const thrown = r.events.find((e) => e.type === 'GRENADE');
  check('T12a 銃擲弾も同じ経路で飛ぶ', !!thrown && thrown.kind === 'rifle_grenade',
    thrown && thrown.kind);
  check('T12b 銃擲弾の残数が減る', r.sim.getSoldier('thrower').rifleGrenades === 2,
    'rfg=' + r.sim.getSoldier('thrower').rifleGrenades);
  check('T12c 銃擲弾は手榴弾より構えが長い',
    SIM_TUNING.MUNITIONS.rifle_grenade.prepT > SIM_TUNING.MUNITIONS.grenade.prepT, '');
  check('T12d 銃擲弾は手榴弾より遠く届く',
    SIM_TUNING.MUNITIONS.rifle_grenade.rng > SIM_TUNING.MUNITIONS.grenade.rng, '');
}

// T13: 残数ゼロなら投げられない / 射程外へは投げられない
{
  const r = throwSim('grenade', { grenades: 0 });
  check('T13a 残数ゼロでは投擲が起きない',
    !r.events.some((e) => e.type === 'GRENADE'), '');

  const sim = makeSim({});
  sim.addSoldier({ id: 't', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 }, grenades: 2 });
  sim.issueOrder({
    type: 'GRENADE', soldierIds: ['t'],
    payload: { hex: { q: 20, r: 0 }, kind: 'grenade' },
  });
  let any = false;
  for (let i = 0; i < 60; i++) { sim.tick(); if (sim.drainEvents().some((e) => e.type === 'GRENADE')) any = true; }
  check('T13b 射程外へは投げない', !any && sim.getSoldier('t').grenades === 2,
    'grenades=' + sim.getSoldier('t').grenades);
}

// T14: 味方も巻き込む（投げる位置が戦術になる）
{
  const sim = new SimCore({
    map: flatMap({ cover: 0.5 }), tuning: SIM_TUNING,
    rng: mulberry32(99), policy: TraitPolicy, orders: new InstantOrders(),
  });
  sim.addSoldier({ id: 'thrower', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 }, grenades: 2 });
  sim.addSoldier({ id: 'buddy', team: 'A', q: 3, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim._soldiers.get('buddy').fireMode = 'hold';
  sim.issueOrder({
    type: 'GRENADE', soldierIds: ['thrower'],
    payload: { hex: { q: 3, r: 0 }, kind: 'grenade' },
  });
  for (let t = 0; t < 200; t++) { sim.tick(); sim.drainEvents(); }
  check('T14 味方も巻き込む', sim.getSoldier('buddy').hp < 100,
    'hp=' + sim.getSoldier('buddy').hp);
}

// --- 移動の自動描き分け（mode:'auto'） --------------------------------------

/** 遮蔽値を hex ごとに指定できるマップ */
function terrainMap(coverOf, losOf) {
  return {
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
    },
    hasLos: (a, b) => (losOf ? losOf(a, b) : true),
    cover: (h) => coverOf(h),
    moveCost: () => 1,
    neighbors: (h) => [
      { q: h.q + 1, r: h.r }, { q: h.q - 1, r: h.r },
      { q: h.q, r: h.r + 1 }, { q: h.q, r: h.r - 1 },
      { q: h.q + 1, r: h.r - 1 }, { q: h.q - 1, r: h.r + 1 },
    ],
  };
}

function stepDecision(opts) {
  const map = terrainMap(opts.coverOf, opts.losOf);
  const self = {
    id: 'a', team: 'A', q: 0, r: 0, hp: 100, state: 'move', suppression: opts.suppression || 0,
    underFireT: opts.underFireT, traits: [], weapon: rifle(), prone: false,
  };
  const foe = { id: 'e', team: 'B', q: 6, r: 0, hp: 100, state: 'idle', weapon: rifle() };
  const world = {
    soldiers: [self, foe], map: map, tuning: SIM_TUNING, tick: opts.tick != null ? opts.tick : 100,
  };
  return TraitPolicy.pickMoveStep(self, world, opts.next);
}

// T15: 開豁地は走る / 遮蔽の中は歩く / 撃たれていれば這う
{
  const openStep = stepDecision({
    coverOf: (h) => (h.q === 1 ? 0.05 : 0.4),   // 現在地は林、次は開豁地
    next: { q: 1, r: 0 },
  });
  check('T15a 遮蔽から開豁地へ出る時は走る', openStep.mode === 'rush',
    JSON.stringify(openStep));
  check('T15b その直前にしゃがんで様子を窺う', openStep.observeT > 0,
    'observeT=' + openStep.observeT);

  const coveredStep = stepDecision({
    coverOf: () => 0.4,
    next: { q: 1, r: 0 },
  });
  check('T15c 遮蔽伝いなら歩く', coveredStep.mode === 'walk', JSON.stringify(coveredStep));

  const underFire = stepDecision({
    coverOf: () => 0.05, next: { q: 1, r: 0 }, tick: 100, underFireT: 95,
  });
  check('T15d 撃たれている間は匍匐', underFire.mode === 'crawl', JSON.stringify(underFire));

  const unseen = stepDecision({
    coverOf: () => 0.05, next: { q: 1, r: 0 }, losOf: () => false,
  });
  check('T15e 誰にも見られていない開豁地は走らない（歩き）', unseen.mode === 'walk',
    JSON.stringify(unseen));
}

// T16: 走行中に被弾すると躓いて伏せ、匍匐へ切り替わる
{
  const sim = new SimCore({
    map: flatMap({ cover: 0 }), tuning: SIM_TUNING,
    rng: mulberry32(5), policy: TraitPolicy, orders: new InstantOrders(),
  });
  sim.addSoldier({ id: 'runner', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  const runner = sim._soldiers.get('runner');
  runner.state = 'move';
  runner.moveMode = 'auto';
  runner._stepMode = 'rush';
  runner.movePath = [{ q: 1, r: 0 }, { q: 2, r: 0 }];
  sim._maybeStumble(runner, true, SIM_TUNING);
  check('T16 走行中の被弾で躓いて伏せる',
    runner.prone === true && runner._stepMode === 'crawl',
    'prone=' + runner.prone + ' step=' + runner._stepMode);
}

// T17: 能力値が効く（速い兵は同じ距離を短時間で渡る／体力があれば息切れが短い）
{
  function crossTicks(attrs) {
    const sim = new SimCore({
      map: flatMap({ cover: 0.4 }), tuning: SIM_TUNING,
      rng: mulberry32(3), policy: TraitPolicy, orders: new InstantOrders(),
    });
    sim.addSoldier({
      id: 'a', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 }, attrs: attrs,
    });
    sim.issueOrder({
      type: 'MOVE_TO', soldierIds: ['a'],
      payload: { path: straight({ q: 0, r: 0 }, 3), mode: 'walk' },
    });
    for (let t = 0; t < 900; t++) { sim.tick(); if (sim.getSoldier('a').q === 3) return t + 1; }
    return Infinity;
  }
  const slow = crossTicks({ speed: 2 });
  const fast = crossTicks({ speed: 9 });
  check('T17a speed が高いほど速く渡る', fast < slow, `speed2=${slow} speed9=${fast}`);

  function windedAfterRush(str) {
    const sim = new SimCore({
      map: flatMap({ cover: 0 }), tuning: SIM_TUNING,
      rng: mulberry32(3), policy: TraitPolicy, orders: new InstantOrders(),
    });
    sim.addSoldier({
      id: 'a', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 }, attrs: { str: str },
    });
    sim.issueOrder({
      type: 'MOVE_TO', soldierIds: ['a'],
      payload: { path: straight({ q: 0, r: 0 }, 2), mode: 'rush' },
    });
    for (let t = 0; t < 400; t++) {
      sim.tick();
      const ev = sim.drainEvents().find((e) => e.type === 'WINDED');
      if (ev) return ev.ticks;
    }
    return -1;
  }
  const weak = windedAfterRush(2);
  const strong = windedAfterRush(9);
  check('T17b str が高いほど息切れが短い', strong < weak && strong > 0,
    `str2=${weak} str9=${strong}`);
}

// T18: 平野に突っ立たない — 撃たれる前でも身を隠す
{
  const map = terrainMap((h) => (h.q === 0 && h.r === 0 ? 0.05 : 0.4));
  const self = {
    id: 'a', team: 'A', q: 0, r: 0, hp: 100, state: 'idle', suppression: 0,
    traits: [], weapon: rifle(), prone: false, magRemaining: 8, magsLeft: 4,
  };
  const foe = { id: 'e', team: 'B', q: 5, r: 0, hp: 100, state: 'idle', weapon: rifle(), suppression: 0 };
  const world = { soldiers: [self, foe], map: map, tuning: SIM_TUNING, tick: 500 };
  const intent = TraitPolicy.seekCoverIfExposed(self, world, mulberry32(1));
  check('T18a 開豁地で見られていたら遮蔽へ移る',
    intent && intent.type === 'MOVE_TO' && intent.payload.mode === 'auto',
    JSON.stringify(intent && intent.type));

  // 逃げ場が無いなら、せめて伏せる
  const flat = terrainMap(() => 0.05);
  const world2 = {
    soldiers: [self, foe], map: flat, tuning: SIM_TUNING, tick: 500,
  };
  const intent2 = TraitPolicy.seekCoverIfExposed(self, world2, mulberry32(1));
  check('T18b 逃げ場が無ければ伏せる',
    intent2 && intent2.type === 'GO_PRONE', JSON.stringify(intent2 && intent2.type));

  // 見られていなければ何もしない
  const hidden = terrainMap(() => 0.05, () => false);
  const world3 = { soldiers: [self, foe], map: hidden, tuning: SIM_TUNING, tick: 500 };
  check('T18c 見られていなければ動かない',
    TraitPolicy.seekCoverIfExposed(self, world3, mulberry32(1)) === null, '');
}

// T19: 銃擲弾は「その銃に適合する現物」だけ（PL実データ由来）
{
  const table = dataSandbox.RIFLE_GRENADE_FOR_MAIN;
  check('T19a M1 の適合銃擲弾表が存在する',
    !!table && Array.isArray(table.m1) && table.m1.length === 2, JSON.stringify(table));
  const codes = (table && table.m1) || [];
  check('T19b 参照先は PL 実データの現物（Mk2 Grd / Mk2 GPA）',
    codes.every((c) => WPNS[c] && WPNS[c].area === true),
    codes.map((c) => WPNS[c] && WPNS[c].name).join(','));
  check('T19c 適合表に無い銃には銃擲弾を配らない',
    !table.thompson && !table.bar, Object.keys(table).join(','));

  // 現物の射程・威力がスペックを上書きする
  const sim = makeSim({});
  const rg = WPNS[codes[0]];
  sim.addSoldier({
    id: 't', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 },
    rifleGrenades: 3,
    munitionSpec: { rifle_grenade: { rng: rg.rng, dmg: { base: rg.dmg, spread: 10 } } },
  });
  const spec = sim._munitionSpec(sim._soldiers.get('t'), 'rifle_grenade');
  check('T19d 現物の射程・威力がチューニング既定を上書きする',
    spec.rng === rg.rng && spec.dmg.base === rg.dmg
    && spec.prepT === SIM_TUNING.MUNITIONS.rifle_grenade.prepT,
    `rng=${spec.rng} dmg=${spec.dmg.base} prepT=${spec.prepT}`);
}

// --- 制圧（TARGET_HEX）: 削りながら反撃させない / 敵が消えたら自動解除 -------

/**
 * 両軍に遠方の生存者を1名ずつ置く。片軍が全滅すると sim は決着を出して tick を
 * 止めるため、任務の解除を観測する前にシムが死ぬ。戦闘の終わりと任務の終わりは
 * 別物なので、検証したい方だけを残すための足場。
 */
function anchorTeams(sim) {
  ['A', 'B'].forEach((team, i) => {
    sim.addSoldier({
      id: 'anchor' + team, team: team, q: 40 + i * 3, r: 40,
      weapon: rifle(), ammo: { mags: 2 },
    });
    sim._soldiers.get('anchor' + team).fireMode = 'hold';
  });
}

function suppressScenario(opts) {
  opts = opts || {};
  const sim = new SimCore({
    map: flatMap({ cover: opts.cover != null ? opts.cover : 0.2 }), tuning: SIM_TUNING,
    rng: mulberry32(opts.seed || 11), policy: TraitPolicy, orders: new InstantOrders(),
  });
  sim.addSoldier({ id: 'gunner', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 60 } });
  sim.addSoldier({ id: 'foe', team: 'B', q: 3, r: 0, weapon: rifle(), ammo: { mags: 60 } });
  sim._soldiers.get('foe').fireMode = 'hold';
  // 遠方の錨。片軍が全滅すると _phaseCheckResult が決着を出して tick が止まり、
  // 解除の観測ができなくなる（検証したいのは戦闘の終わりではなく任務の終わり）。
  anchorTeams(sim);
  sim.issueOrder({
    type: 'TARGET_HEX', soldierIds: ['gunner'],
    payload: { hex: { q: 3, r: 0 }, mode: 'suppress' },
  });
  return sim;
}

// T20: 見えている敵は着実に削られる（面制圧＝命中なし とは別物）
{
  const sim = suppressScenario({});
  let hits = 0;
  for (let t = 0; t < 6000; t++) {
    sim.tick();
    sim.drainEvents().forEach((e) => {
      if (e.type === 'SHOT' && e.shooterId === 'gunner' && e.hit) hits++;
    });
    if (sim.getSoldier('foe').hp <= 0) break;
  }
  // 2026-08-03: 致死性上昇で観測前に決着するようになった主張を撤去（ディレクター裁定）
}

// T21: 指定hexから行動可能な敵が消えたら自動解除される
{
  const sim = suppressScenario({});
  for (let t = 0; t < 40; t++) sim.tick();
  sim.drainEvents();
  const foe = sim._soldiers.get('foe');
  foe.q = 9; foe.r = 0;                 // 敵がその地点から離脱した
  let released = false;
  for (let t = 0; t < 60; t++) {
    sim.tick();
    if (sim.drainEvents().some((e) => e.type === 'SUPPRESS_END' && e.reason === 'cleared')) released = true;
  }
  check('T21a 敵が居なくなれば制圧は自動解除される', released, '');
  check('T21b 解除後は命令が残らず自己判断へ戻る',
    sim.getSoldier('gunner').engageHex === null
    && sim.getSoldier('gunner').currentOrder === null, '');
}

// T22: 重傷（incap）だけが残っても解除される — 「アクティブな敵がいる限り」
{
  const sim = suppressScenario({});
  for (let t = 0; t < 30; t++) sim.tick();
  sim.drainEvents();
  const foe = sim._soldiers.get('foe');
  foe.hp = 10; foe.state = 'incap';
  let released = false;
  for (let t = 0; t < 60; t++) {
    sim.tick();
    if (sim.drainEvents().some((e) => e.type === 'SUPPRESS_END')) released = true;
  }
  check('T22 重傷者しか残っていなければ制圧は解除される', released, '');
}

// --- 強襲（ASSAULT）: あらゆる手段で撃滅、hexを全滅させるまで継続 -----------

function assaultSim(opts) {
  opts = opts || {};
  const sim = new SimCore({
    map: flatMap({ cover: opts.cover != null ? opts.cover : 0.1 }), tuning: SIM_TUNING,
    rng: mulberry32(opts.seed || 77), policy: TraitPolicy, orders: new InstantOrders(),
  });
  sim.addSoldier({
    id: 'hero', team: 'A', q: 0, r: 0, weapon: rifle(),
    ammo: { mags: opts.mags != null ? opts.mags : 6 },
    grenades: opts.grenades != null ? opts.grenades : 2,
    rifleGrenades: opts.rifleGrenades != null ? opts.rifleGrenades : 0,
    sidearm: opts.sidearm ? { weapon: toSimWeapon('m1911', WPNS.m1911, SIM_TUNING), mags: 2 } : null,
    attrs: { speed: 5, recon: 5, str: 5 },
  });
  (opts.foes || [{ q: 4, r: 0 }]).forEach((h, i) => {
    sim.addSoldier({ id: 'foe' + i, team: 'B', q: h.q, r: h.r, weapon: rifle(), ammo: { mags: 6 } });
    const f = sim._soldiers.get('foe' + i);
    // 既定では撃ち返させない。fireMode は policy が上書きするので、撃たせない
    // には弾を空にするしかない（強襲側の挙動だけを見たいテストのため）。
    if (!opts.foesShoot) { f.magRemaining = 0; f.magsLeft = 0; }
  });
  anchorTeams(sim);   // 全滅で tick が止まると解除を観測できない
  sim.issueOrder({ type: 'ASSAULT', soldierIds: ['hero'], payload: { targetId: 'foe0' } });
  return sim;
}

// T23: 強襲は目標へ詰め、撃滅するまで続く
{
  const sim = assaultSim({ foes: [{ q: 6, r: 0 }] });
  const start = sim.getSoldier('hero').q;
  let ended = null;
  const seen = {};
  for (let t = 0; t < 1500; t++) {
    sim.tick();
    sim.drainEvents().forEach((e) => {
      seen[e.type] = true;
      if (e.type === 'ASSAULT_END') ended = e;
    });
    if (ended) break;
  }
  check('T23a 強襲は開始イベントを出す', seen.ASSAULT_START === true, '');
  check('T23b 目標へ詰める（前進する）', sim.getSoldier('hero').q > start,
    `q=${sim.getSoldier('hero').q} start=${start}`);
  check('T23c 撃滅すると自動解除される',
    !!ended && ended.reason === 'cleared' && sim.getSoldier('foe0').hp <= 0,
    ended && ended.reason);
  check('T23d 解除後は命令が残らず自己判断へ戻る',
    sim.getSoldier('hero').currentOrder === null
    && sim.getSoldier('hero').state !== 'assault', sim.getSoldier('hero').state);
}

// T24: 同一hexに複数居るなら、全滅させるまで続く
{
  const sim = assaultSim({ foes: [{ q: 4, r: 0 }, { q: 4, r: 0 }, { q: 4, r: 0 }] });
  let ended = null;
  for (let t = 0; t < 3000; t++) {
    sim.tick();
    const ev = sim.drainEvents().find((e) => e.type === 'ASSAULT_END');
    if (ev) { ended = ev; break; }
  }
  const alive = ['foe0', 'foe1', 'foe2'].filter((id) => sim.getSoldier(id).hp > 0
    && sim.getSoldier(id).state !== 'incap');
  check('T24 同一hexの敵を全滅させるまで解除されない',
    !!ended && alive.length === 0, 'ended=' + (ended && ended.reason) + ' alive=' + alive.length);
}

// T25: 手段の使い分け — 遮蔽に潜った相手には投げる
{
  const sim = assaultSim({ cover: 0.5, foes: [{ q: 2, r: 0 }], grenades: 3 });
  let threw = false;
  for (let t = 0; t < 600; t++) {
    sim.tick();
    if (sim.drainEvents().some((e) => e.type === 'GRENADE')) { threw = true; break; }
  }
  check('T25 遮蔽に潜った相手には手榴弾を使う', threw,
    'grenades=' + sim.getSoldier('hero').grenades);
}

// T26: 主武器が尽きたら拳銃へ持ち替える
{
  const sim = assaultSim({ mags: 0, grenades: 0, sidearm: true, foes: [{ q: 3, r: 0 }] });
  sim._soldiers.get('hero').magRemaining = 0;
  let swapped = false;
  for (let t = 0; t < 600; t++) {
    sim.tick();
    if (sim.drainEvents().some((e) => e.type === 'SWAP')) { swapped = true; break; }
  }
  check('T26 主武器が尽きたら拳銃へ持ち替える', swapped,
    'weapon=' + (sim.getSoldier('hero').weapon || {}).code);
}

// T27: 間合いに入れば白兵
{
  const sim = assaultSim({ foes: [{ q: 1, r: 0 }], mags: 0, grenades: 0 });
  sim._soldiers.get('hero').magRemaining = 0;
  let melee = false;
  for (let t = 0; t < 400; t++) {
    sim.tick();
    if (sim.drainEvents().some((e) => e.type === 'ASSAULT' && e.targetId === 'foe0')) { melee = true; break; }
  }
  check('T27 隣接すれば白兵で決着をつける', melee, '');
}

// T28: 見失い、周囲にも敵が居なければ解除される
{
  const sim = assaultSim({ foes: [{ q: 6, r: 0 }] });
  for (let t = 0; t < 20; t++) sim.tick();
  sim.drainEvents();
  const foe = sim._soldiers.get('foe0');
  foe.hp = 0; foe.state = 'down';        // 見失った扱い（周囲に他の敵も居ない）
  let ended = null;
  for (let t = 0; t < 200; t++) {
    sim.tick();
    const ev = sim.drainEvents().find((e) => e.type === 'ASSAULT_END');
    if (ev) { ended = ev; break; }
  }
  check('T28 周囲に敵が居なくなれば強襲は解除される', !!ended, ended && ended.reason);
}

// --- 指揮継承 ---------------------------------------------------------------
// §3.4 は「指揮継承まで30秒のショック」と定めているのに継承が未実装で、一度
// 分隊長を失った分隊は最後まで指揮官不在のままだった（伝達遅延が永久に×3）。
{
  const sim = makeSim({});
  sim.addSoldier({ id: 'lead', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 }, isLeader: true });
  sim.addSoldier({ id: 'a1', team: 'A', q: 1, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.addSoldier({ id: 'a2', team: 'A', q: 2, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.addSoldier({ id: 'b1', team: 'B', q: 30, r: 30, weapon: rifle(), ammo: { mags: 4 } });
  ['a1', 'a2', 'b1'].forEach((id) => { const s = sim._soldiers.get(id); s.magRemaining = 0; s.magsLeft = 0; });
  sim._soldiers.get('a2').morale = 90;
  sim._soldiers.get('a1').morale = 50;

  sim.tick();
  sim._soldiers.get('lead').hp = 0;      // 分隊長が倒れる
  const shock = SIM_TUNING.COMMS_SHOCK_T;

  let promotedAt = null;
  for (let t = 0; t < shock * 2 + 60; t++) {
    // 士気は回復するようになった（2026-08-04）。放っておくと全員100で並び、
    // 「誰が継ぐか」の差が消えてこのテストの前提が崩れるので、差を保ち続ける。
    sim._soldiers.get('a2').morale = 90;
    sim._soldiers.get('a1').morale = 50;
    sim.tick();
    const ev = sim.drainEvents().find((e) => e.type === 'LEADER_CHANGED');
    if (ev && !promotedAt) promotedAt = { t: t, id: ev.id };
  }
  check('T29a 分隊長が倒れたら後任が立つ', !!promotedAt, JSON.stringify(promotedAt));
  check('T29b 士気の高い者が継ぐ', promotedAt && promotedAt.id === 'a2',
    promotedAt && promotedAt.id);
  check('T29c ショック期間を過ぎてから継承される',
    promotedAt && promotedAt.t >= shock - 2, promotedAt && promotedAt.t + ' >= ' + shock);
  check('T29d 継承後は指揮官が1名だけ存在する',
    sim.soldiers().filter((s) => s.team === 'A' && s.isLeader && s.hp > 0).length === 1, '');
}

// T30: 元から分隊長を置いていない編成へ勝手な昇格はしない
{
  const sim = makeSim({});
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.addSoldier({ id: 'b1', team: 'B', q: 30, r: 30, weapon: rifle(), ammo: { mags: 4 } });
  ['a1', 'b1'].forEach((id) => { const s = sim._soldiers.get(id); s.magRemaining = 0; s.magsLeft = 0; });
  let any = false;
  for (let t = 0; t < SIM_TUNING.COMMS_SHOCK_T + 60; t++) {
    sim.tick();
    if (sim.drainEvents().some((e) => e.type === 'LEADER_CHANGED')) any = true;
  }
  check('T30 分隊長を置かない編成では昇格しない', !any, '');
}

// T31: 赤ゲージ(incap)で倒れた分隊長も「抜けた」扱いにする。
// incap は hp>0 のまま盤上に残るので、isLeader を持ったままだと昇格タイマーが
// 一度も始まらず、**倒しても永久に指揮官のまま**だった（2026-08-04 実測: ショック
// 期間の3倍回しても後任ゼロ／タイマー未起動）。表示側の「指揮官の円が残る」も
// これが正体で、円は嘘をついていなかった。
{
  const sim = makeSim({});
  sim.addSoldier({ id: 'lead', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 }, isLeader: true });
  sim.addSoldier({ id: 'a1', team: 'A', q: 1, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.addSoldier({ id: 'a2', team: 'A', q: 2, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.addSoldier({ id: 'b1', team: 'B', q: 30, r: 30, weapon: rifle(), ammo: { mags: 4 } });
  ['a1', 'a2', 'b1'].forEach((id) => { const s = sim._soldiers.get(id); s.magRemaining = 0; s.magsLeft = 0; });
  sim._soldiers.get('a2').morale = 90;
  sim._soldiers.get('a1').morale = 50;

  sim.tick();
  const lead = sim._soldiers.get('lead');
  lead.hp = 10;                       // 死んではいない。盤上に残る
  sim._setState(lead, 'incap');

  let promotedAt = null;
  for (let t = 0; t < SIM_TUNING.COMMS_SHOCK_T * 2 + 60; t++) {
    sim._soldiers.get('a2').morale = 90;   // T29 と同じ理由（回復で差が消える）
    sim._soldiers.get('a1').morale = 50;
    sim.tick();
    const ev = sim.drainEvents().find((e) => e.type === 'LEADER_CHANGED');
    if (ev && !promotedAt) promotedAt = { t: t, id: ev.id };
  }
  check('T31a 行動不能になった分隊長でも後任が立つ', !!promotedAt, JSON.stringify(promotedAt));
  check('T31b 後任は士気の高い者', promotedAt && promotedAt.id === 'a2', promotedAt && promotedAt.id);
  check('T31c 倒れた前任は指揮官でなくなる',
    lead.isLeader === false, 'hp=' + lead.hp + ' state=' + lead.state + ' isLeader=' + lead.isLeader);
  check('T31d 指揮官は1名だけ（前任と後任が並立しない）',
    sim.soldiers().filter((s) => s.team === 'A' && s.isLeader && s.hp > 0).length === 1,
    JSON.stringify(sim.soldiers().filter((s) => s.isLeader).map((s) => s.id)));
  check('T31e 前任は盤上に残っている（死亡ではない）',
    lead.hp > 0 && lead.state === 'incap', 'hp=' + lead.hp + ' state=' + lead.state);
}

// --- 士気と敗走（2026-08-04 改訂） ----------------------------------------
// 旧実装の穴を3つ潰した上での挙動を固定する。
//   ・pinned なのに伏せない（policy は prone:true を出しているのに誰も読まない）
//   ・MORALE_PINNED_DRAIN が減算されていて、釘付けの兵の士気が**上がる**
//   ・敗走に act の分岐が無く、逃げずにその場で永久に凍る
{
  // T32: 釘付けなら必ず伏せる。制圧55で伏せて85で立ったまま、という逆転だった。
  const sim = makeSim({});
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.addSoldier({ id: 'b1', team: 'B', q: 6, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  const s = sim._soldiers.get('a1');
  sim._soldiers.get('b1').magRemaining = 0;
  sim._soldiers.get('b1').magsLeft = 0;
  let proneT = 0;
  const total = 120;
  for (let t = 0; t < total; t++) {
    s.suppression = SIM_TUNING.PINNED_AT + 5;
    s.quietT = 0;
    sim._checkSuppressionThresholds(s, SIM_TUNING);
    sim.tick();
    if (s.prone) proneT++;
  }
  check('T32a 釘付けの兵は伏せる', s.prone, 'state=' + s.state + ' prone=' + s.prone);
  check('T32b 釘付けの間はほぼ伏せている', proneT > total * 0.8, proneT + '/' + total);
  check('T32c 釘付けは士気を削る（上げない）', s.morale < 100, 'morale=' + s.morale.toFixed(1));
}

{
  // T33: 釘付けが解ければ士気が戻る
  const sim = makeSim({});
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.addSoldier({ id: 'b1', team: 'B', q: 20, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  ['a1', 'b1'].forEach((id) => { const x = sim._soldiers.get(id); x.magRemaining = 0; x.magsLeft = 0; });
  const s = sim._soldiers.get('a1');
  s.morale = 50;
  for (let t = 0; t < 100; t++) sim.tick();   // 10秒
  const expected = 50 + SIM_TUNING.MORALE_RECOVER * 10;
  check('T33 釘付けでなければ士気が回復する',
    Math.abs(s.morale - Math.min(100, expected)) < 1.5,
    'morale=' + s.morale.toFixed(1) + ' 期待=' + Math.min(100, expected));
}

{
  // T34: 30 を切ったら敗走。伏せたまま敵と反対へ退がり、隊列のまま下がらない。
  const sim = makeSim({});
  const ids = ['a1', 'a2', 'a3', 'a4', 'a5'];
  ids.forEach((id, i) => sim.addSoldier({
    id: id, team: 'A', q: 0, r: i, weapon: rifle(), ammo: { mags: 4 },
  }));
  sim.addSoldier({ id: 'b1', team: 'B', q: 12, r: 2, weapon: rifle(), ammo: { mags: 4 } });
  ids.concat('b1').forEach((id) => { const x = sim._soldiers.get(id); x.magRemaining = 0; x.magsLeft = 0; });
  const men = ids.map((id) => sim._soldiers.get(id));
  const foe = sim._soldiers.get('b1');
  const start = men.map((s) => ({ q: s.q, r: s.r }));
  const d0 = men.map((s) => sim.map.dist({ q: s.q, r: s.r }, { q: foe.q, r: foe.r }));

  men.forEach((s) => { s.morale = 25; });
  sim.tick();
  check('T34a 士気が30を切ったら敗走する', men.every((s) => s.state === 'rout'),
    men.map((s) => s.state).join(','));
  check('T34b 敗走に入ったら伏せる', men.every((s) => s.prone),
    men.map((s) => (s.prone ? '伏' : '立')).join(''));

  // 立ち直らせずに退路だけ見る（回復で戻ってしまうと移動が観察できない）
  for (let t = 0; t < 300; t++) { men.forEach((s) => { s.morale = 25; }); sim.tick(); }
  const d1 = men.map((s) => sim.map.dist({ q: s.q, r: s.r }, { q: foe.q, r: foe.r }));
  const movedAway = men.filter((s, i) => d1[i] > d0[i]).length;
  check('T34c 敗走中は敵から離れる向きへ退がる', movedAway === men.length,
    d0.map((d, i) => d + '->' + d1[i]).join(', '));
  check('T34d 匍匐のまま退がる', men.every((s) => s.prone), '');
  const moved = men.filter((s, i) => s.q !== start[i].q || s.r !== start[i].r).length;
  check('T34e 全員がその場から動く（凍りつかない）', moved === men.length, moved + '/' + men.length);
  // 「蜘蛛の子を散らす」= 全員が同じ向きへ一列で下がらないこと
  const dirs = new Set(men.map((s, i) => (s.q - start[i].q) + ',' + (s.r - start[i].r)));
  check('T34f 退路が1方向に揃わない（散開する）', dirs.size >= 2,
    JSON.stringify([...dirs]));
  // 全員敗走でセクターが即決着しないこと（回復して戻る余地を残す）
  check('T34g 全員敗走でも決着しない', sim.result() == null, JSON.stringify(sim.result()));
}

{
  // T35: 落ち着けば戦列へ戻る
  const sim = makeSim({});
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.addSoldier({ id: 'b1', team: 'B', q: 20, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  ['a1', 'b1'].forEach((id) => { const x = sim._soldiers.get(id); x.magRemaining = 0; x.magsLeft = 0; });
  const s = sim._soldiers.get('a1');
  s.morale = 25;
  sim.tick();
  check('T35a 前提: 敗走している', s.state === 'rout', s.state);
  let rallied = null;
  for (let t = 0; t < 600 && rallied === null; t++) {
    sim.tick();
    if (s.state !== 'rout') rallied = t;
  }
  check('T35b 士気が戻れば敗走から復帰する', rallied !== null,
    'state=' + s.state + ' morale=' + s.morale.toFixed(1));
  check('T35c 復帰は立ち直り閾値を超えてから',
    rallied !== null && s.morale >= SIM_TUNING.ROUT_RALLY_ABOVE - 1,
    'morale=' + s.morale.toFixed(1) + ' 閾値=' + SIM_TUNING.ROUT_RALLY_ABOVE);
}

{
  // T36: 3hex内の味方戦死ペナルティは廃止した
  const sim = makeSim({});
  sim.addSoldier({ id: 'a1', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.addSoldier({ id: 'a2', team: 'A', q: 1, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  sim.addSoldier({ id: 'b1', team: 'B', q: 20, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  ['a1', 'a2', 'b1'].forEach((id) => { const x = sim._soldiers.get(id); x.magRemaining = 0; x.magsLeft = 0; });
  const survivor = sim._soldiers.get('a1');
  survivor.morale = 80;
  const before = survivor.morale;
  sim._applyMoraleOnDeath(sim._soldiers.get('a2'));   // 隣の味方が戦死（非指揮官）
  check('T36a 隣で味方が倒れても士気は下がらない', survivor.morale === before,
    before + ' -> ' + survivor.morale);
  const lead = sim._soldiers.get('a2');
  lead.isLeader = true;
  sim._applyMoraleOnDeath(lead);
  check('T36b 指揮官の戦死だけは効く',
    Math.abs(survivor.morale - (before + SIM_TUNING.MORALE_LEADER_DOWN)) < 0.01,
    before + ' -> ' + survivor.morale + ' (期待 ' + (before + SIM_TUNING.MORALE_LEADER_DOWN) + ')');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
