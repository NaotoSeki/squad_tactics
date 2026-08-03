/**
 * tests/soldier_run_motion.test.js -- 走り/歩き/匍匐の自動切替が画面まで届くか
 *
 * 走りのシート（stand_run / kneel_run）は 2026-07-30 から存在していたが、一度も
 * 表示されていなかった。原因は sim→描画の連絡で、以下の3点を機械で押さえる:
 *
 *   A. sim が「そのマスをどう渡っているか」(stepMode) をスナップショットへ出す。
 *      命令は「移動」1つで生の moveMode は 'auto' に据え置かれるため、これが無いと
 *      描画からは全員が歩きに見える。
 *   B. 描画がその実効モードで走行シートを選ぶ（匍匐中は走らない・伏せは自動で落ちる）。
 *   C. スプライトの滑る速度がモードに追従する。0.9px/frame 固定では歩きにすら
 *      追いつけず、走っても絵だけ速くて位置が置いていかれる。
 *
 * No framework. Run with `node tests/soldier_run_motion.test.js`. Exits 0 on all-PASS.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const { SimCore, mulberry32, toSimWeapon, InstantOrders } = require(path.join(ROOT, 'sim_core.js'));
const { TraitPolicy } = require(path.join(ROOT, 'sim_policy.js'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}

function loadDataJs() {
  const sandbox = { module: { exports: {} }, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'), sandbox, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data', 'wpns_pl_master.js'), 'utf8'),
    sandbox, { filename: 'wpns_pl_master.js' });
  vm.runInContext('\n;this.WPNS = WPNS; this.SIM_TUNING = SIM_TUNING; this.HEX_SIZE = HEX_SIZE;\n',
    sandbox, { filename: 'expose' });
  return sandbox;
}
const dataSandbox = loadDataJs();
const WPNS = dataSandbox.WPNS;
const SIM_TUNING = dataSandbox.SIM_TUNING;
const HEX_SIZE = dataSandbox.HEX_SIZE;

// --- A. sim 側の契約 -------------------------------------------------------
// 平地マップ。cover/los を差し替えて pickMoveStep の分岐だけを測る。
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
    cover: (h) => (typeof cover === 'function' ? cover(h) : cover),
    moveCost: () => 1,
    neighbors: (h) => [
      { q: h.q + 1, r: h.r }, { q: h.q - 1, r: h.r },
      { q: h.q, r: h.r + 1 }, { q: h.q, r: h.r - 1 },
      { q: h.q + 1, r: h.r - 1 }, { q: h.q - 1, r: h.r + 1 },
    ],
  };
}
function rifle() { return toSimWeapon('m1', WPNS.m1 || { rng: 8, burst: 1, cap: 8 }, SIM_TUNING); }

function autoMoveSim(mapOpts) {
  const sim = new SimCore({
    map: flatMap(mapOpts), tuning: SIM_TUNING,
    rng: mulberry32(4242), policy: TraitPolicy, orders: new InstantOrders(),
  });
  sim.addSoldier({ id: 'a', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  // 監視役の敵。pickMoveStep の「見られているか」は実在の敵の射線で決まる
  sim.addSoldier({ id: 'e', team: 'B', q: 6, r: 0, weapon: rifle(), ammo: { mags: 4 } });
  const path4 = [];
  for (let i = 1; i <= 4; i++) path4.push({ q: i, r: 0 });
  sim.issueOrder({ type: 'MOVE_TO', soldierIds: ['a'], payload: { path: path4, mode: 'auto' } });
  return sim;
}

// A1: 敵に見られている開豁地を渡るときは stepMode が rush になる（＝走る）
{
  const sim = autoMoveSim({ cover: 0, los: true });
  let sawRush = false, rawStayedAuto = false;
  for (let t = 0; t < 200 && !sawRush; t++) {
    sim.tick();
    const s = sim.getSoldier('a');
    if (s.stepMode === 'rush') { sawRush = true; rawStayedAuto = (s.moveMode === 'auto'); }
  }
  check('A1a 開豁地の横断で stepMode=rush が立つ', sawRush);
  check('A1b 生の moveMode は auto のまま（描画が見るべきは stepMode）', rawStayedAuto);
}

// A2: 遮蔽が続く経路は歩き。走りっぱなしにはしない
{
  const sim = autoMoveSim({ cover: 0.5, los: true });
  const seen = new Set();
  for (let t = 0; t < 200; t++) {
    sim.tick();
    const s = sim.getSoldier('a');
    if (s.state === 'move') seen.add(s.stepMode);
    if (s.q === 4) break;
  }
  check('A2 遮蔽伝いの経路は歩き（rush を含まない）',
    seen.has('walk') && !seen.has('rush'), 'modes=' + [...seen].join(','));
}

// A3: 制圧されたら何を命じられても匍匐（実効モードが crawl へ落ちる）
{
  const sim = autoMoveSim({ cover: 0, los: true });
  sim.tick();
  const raw = sim._soldiers.get('a');
  raw.suppression = SIM_TUNING.PINNED_AT + 5;
  sim.tick();
  check('A3 PINNED 帯では stepMode=crawl', sim.getSoldier('a').stepMode === 'crawl',
    'stepMode=' + sim.getSoldier('a').stepMode);
}

// A4: 遮蔽から開豁地へ出る一拍（様子見）が observeT としてスナップショットに出る
{
  // 現在地だけ遮蔽・行き先は開豁地
  const sim = autoMoveSim({ cover: (h) => (h.q <= 0 ? 0.5 : 0), los: true });
  let sawObserve = false;
  for (let t = 0; t < 60 && !sawObserve; t++) {
    sim.tick();
    if (sim.getSoldier('a').observeT > 0) sawObserve = true;
  }
  check('A4 遮蔽→開豁地の様子見が observeT>0 で見える', sawObserve);
}

// A5: 到着したらモードは残らない（走り続けている絵にしない）
{
  const sim = autoMoveSim({ cover: 0, los: false });
  let arrived = false;
  for (let t = 0; t < 400 && !arrived; t++) {
    sim.tick();
    if (sim.getSoldier('a').q === 4 && sim.getSoldier('a').state !== 'move') arrived = true;
  }
  const s = sim.getSoldier('a');
  check('A5 到着後の stepMode は walk へ戻る', arrived && s.stepMode === 'walk',
    'arrived=' + arrived + ' stepMode=' + s.stepMode);
}

// A6: 1マスの実所要tickを publish する（描画の滑走速度の正本）。
//     モードだけの概算だと重い地形・鈍足の兵で先に着いて待つ＝歩行アニメが途中で切れる。
{
  const seen = {};
  for (const mode of ['walk', 'rush', 'crawl']) {
    const sim = new SimCore({
      map: flatMap({ cover: 0.5, los: false }), tuning: SIM_TUNING,
      rng: mulberry32(9), policy: TraitPolicy, orders: new InstantOrders(),
    });
    // attrs 既定（ATTR_REF=5 ⇒ 倍率1.0）で地形コスト1。素の公式と直接突き合わせられる
    sim.addSoldier({ id: 'a', team: 'A', q: 0, r: 0, weapon: rifle(), ammo: { mags: 4 },
      attrs: { speed: SIM_TUNING.ATTR_REF, recon: SIM_TUNING.ATTR_REF, str: SIM_TUNING.ATTR_REF } });
    sim.issueOrder({ type: 'MOVE_TO', soldierIds: ['a'],
      payload: { path: [{ q: 1, r: 0 }, { q: 2, r: 0 }], mode: mode } });
    for (let t = 0; t < 60 && !seen[mode]; t++) {
      sim.tick();
      const s = sim.getSoldier('a');
      if (s.state === 'move' && s.stepTicks > 0) seen[mode] = s.stepTicks;
    }
  }
  const base = SIM_TUNING.MOVE_T_PER_HEX;
  check('A6a stepTicks = MOVE_T_PER_HEX × モード倍率（地形1・能力等倍）',
    Math.abs(seen.walk - base) < 1e-6
    && Math.abs(seen.rush - base * SIM_TUNING.MOVE_MODE_MULT.rush) < 1e-6
    && Math.abs(seen.crawl - base * SIM_TUNING.MOVE_MODE_MULT.crawl) < 1e-6,
    JSON.stringify(seen));
  check('A6b 走りは歩きの半分の時間で渡る', seen.rush * 2 === seen.walk,
    `walk=${seen.walk} rush=${seen.rush}`);
}

// --- B/C. 描画側 -----------------------------------------------------------
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'asset', 'sprites', 'soldier', 'manifest.json'), 'utf8'));

const box = { console: console, Math: Math, Date: Date, JSON: JSON };
box.window = box;
box.fetch = () => Promise.resolve({ ok: false });
box.HEX_SIZE = HEX_SIZE;
box.SIM_TUNING = SIM_TUNING;
vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'phaser_unit.js'), 'utf8')
  + '\n;this.__UnitView = UnitView;', box, { filename: 'phaser_unit.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'phaser_soldier_view.js'), 'utf8')
  + '\n;this.__SoldierUnitView = SoldierUnitView;', box, { filename: 'phaser_soldier_view.js' });
box.SOLDIER_MANIFEST = manifest;

const SoldierUnitView = box.__SoldierUnitView;
const UnitView = box.__UnitView;

// B0: 走りのシートが実在し、ループ扱いの語尾規約に載っている
{
  check('B0a stand_run / kneel_run が manifest にある',
    !!manifest.actions.stand_run && !!manifest.actions.kneel_run);
  const loopRe = /(_idle|_forward|_fire|_cower|_run)$/;
  check('B0b 走りはループ側に分類される（一回性だと1歩で止まる）',
    loopRe.test('stand_run') && loopRe.test('kneel_run'));
  check('B0c prone_run は持たない（伏せは匍匐へ落とす設計）', !manifest.actions.prone_run);
}

/** 実在アニメを manifest から引いた、最小のシーンスタブ。 */
function makeView(opts) {
  opts = opts || {};
  const keys = new Set();
  for (const name of Object.keys(manifest.actions)) {
    for (let d = 0; d < 8; d++) keys.add(`sold_${name}_${d}`);
  }
  const v = Object.create(SoldierUnitView.prototype);
  v.scene = {
    anims: { exists: (k) => keys.has(k) },
    time: { now: 0 },
    sim: { _tick: opts.tick || 1000 },
    map: { cover: () => (opts.cover != null ? opts.cover : 0) },
  };
  v.visuals = new Map();
  v._faceDir = new Map();
  v._oneShot = new Map();
  v._underFire = new Map();
  v._corpses = [];
  return v;
}

/** updateInfantryAnim を1回通し、実際に play されたアニメキーを返す。 */
function playedAnim(view, sim, opts) {
  opts = opts || {};
  let played = null;
  const spr = {
    texture: { key: 'sold_stand_idle' },
    anims: { currentAnim: null, isPlaying: false, setProgress() {} },
    _soldierAnimHash: 7,
    play(key) { played = key; this.texture = { key: 'sold_' + /^sold_(.+)_[0-7]$/.exec(key)[1] }; },
    setOrigin() {}, setPosition() {},
  };
  const visual = {
    sprite: spr,
    container: { x: 0, y: 0 },
    lastDx: 1, lastDy: 0,
    postureLv: opts.postureLv != null ? opts.postureLv : null,
    dispDir: 2,
  };
  const u = { id: sim.id, q: 0, r: 0, _sim: sim };
  view.updateInfantryAnim(visual, u, opts.isMoving !== false);
  return { key: played, visual };
}

// B1: 実効モードの解決（stepMode が正本、無ければ moveMode、auto は歩き扱い）
{
  const v = makeView();
  check('B1a stepMode が moveMode より優先される',
    v._effMoveMode({ stepMode: 'rush', moveMode: 'auto' }) === 'rush');
  check('B1b stepMode が無ければ moveMode（旧経路の互換）',
    v._effMoveMode({ moveMode: 'rush' }) === 'rush');
  check('B1c 生の auto は歩き扱い（走りっぱなしにしない）',
    v._effMoveMode({ moveMode: 'auto' }) === 'walk');
}

// B2: 走行判定 — 匍匐では走らない
{
  const v = makeView();
  const tick = 1000;
  check('B2a rush は走る', v._isRunning({ id: 'x', stepMode: 'rush' }, tick));
  check('B2b walk は走らない', !v._isRunning({ id: 'x', stepMode: 'walk' }, tick));
  check('B2c crawl は走らない（伏せたまま進んでいる）',
    !v._isRunning({ id: 'x', stepMode: 'crawl' }, tick));
  const v2 = makeView();
  v2._underFire.set('x', tick);
  check('B2d 被弾中の移動は躍進として走る（stepMode 無しの旧経路）',
    v2._isRunning({ id: 'x' }, tick));
  const v3 = makeView();
  v3._underFire.set('x', tick);
  check('B2e 被弾中でも匍匐なら走らない',
    !v3._isRunning({ id: 'x', stepMode: 'crawl' }, tick));
}

// B3: 実際に走行シートが選ばれる（本題）
{
  const walk = playedAnim(makeView(), { id: 'w', state: 'move', suppression: 0, stepMode: 'walk' },
    { postureLv: 0 });
  check('B3a 歩きは stand_forward', /^sold_stand_forward_/.test(walk.key), 'key=' + walk.key);

  const run = playedAnim(makeView(), { id: 'r', state: 'move', suppression: 0, stepMode: 'rush' },
    { postureLv: 0 });
  check('B3b 走りは stand_run（これが一度も出ていなかった）',
    /^sold_stand_run_/.test(run.key), 'key=' + run.key);

  // 匍匐は sim が prone を立てる。走行シートは無いので prone_forward へ落ちる
  const crawl = playedAnim(makeView(),
    { id: 'c', state: 'move', suppression: 0, stepMode: 'crawl', prone: true }, { postureLv: 2 });
  check('B3c 匍匐は prone_forward（prone_run へは行かない）',
    /^sold_prone_forward_/.test(crawl.key), 'key=' + crawl.key);

  // しゃがみ走り: 制圧帯（伏せるほどではない）で走ると kneel_run
  const kneelRun = playedAnim(makeView(),
    { id: 'k', state: 'suppressed', suppression: SIM_TUNING.SUPPRESSED_AT + 1, stepMode: 'rush' },
    { postureLv: 1 });
  check('B3d しゃがみ帯の走りは kneel_run', /^sold_kneel_run_/.test(kneelRun.key),
    'key=' + kneelRun.key);

  // 止まれば idle。走行モードが残っていても静止は静止
  const stopped = playedAnim(makeView(), { id: 's', state: 'idle', suppression: 0, stepMode: 'rush' },
    { postureLv: 0, isMoving: false });
  check('B3e 止まれば idle（走行モードが残っていても）',
    /^sold_stand_idle_/.test(stopped.key), 'key=' + stopped.key);
}

// B4: 様子見の一拍は身を屈める
{
  const v = makeView();
  check('B4a observeT>0 は最低でも膝立ち',
    v._postureLevelOf({ id: 'o', state: 'idle', suppression: 0, observeT: 10 }, 1000) >= 1);
  check('B4b observeT=0 の平時は立ち',
    v._postureLevelOf({ id: 'o', state: 'idle', suppression: 0, observeT: 0 }, 1000) === 0);
  check('B4c 伏せている兵を様子見で立たせない',
    v._postureLevelOf({ id: 'o', state: 'idle', suppression: 0, prone: true, observeT: 10 }, 1000) === 2);
}

// C: スプライトの滑る速度がモードに追従する
{
  const view = Object.create(UnitView.prototype);
  const pitch = Math.sqrt(3) * HEX_SIZE;
  const dt = 1000 / 60;
  const px = (mode) => view._infantryStepPx({ _sim: { stepMode: mode } }, dt, 1);
  const walk = px('walk'), run = px('rush'), crawl = px('crawl');

  // sim の所要時間から要求される速度（px/frame）
  const need = (mode) => pitch
    / (SIM_TUNING.MOVE_T_PER_HEX * SIM_TUNING.MOVE_MODE_MULT[mode] * (SIM_TUNING.TICK_MS / 1000))
    * (dt / 1000);
  check('C1a 歩きの滑走速度が sim の所要時間と一致する',
    Math.abs(walk - need('walk')) < 0.02, `got=${walk.toFixed(3)} need=${need('walk').toFixed(3)}`);
  check('C1b 走りは歩きの2倍（MOVE_MODE_MULT どおり）',
    Math.abs(run / walk - 2) < 0.05, `walk=${walk.toFixed(3)} run=${run.toFixed(3)}`);
  check('C1c 匍匐は歩きの2.5分の1', Math.abs(crawl / walk - 1 / 2.5) < 0.05,
    `walk=${walk.toFixed(3)} crawl=${crawl.toFixed(3)}`);
  // 旧実装は 0.9px/frame 固定。MOVE_T_PER_HEX を遅くした今でも歩きに届いておらず、
  // 走りには遠く及ばない（＝歩/走の差が画面に出なかった）
  check('C1d 旧固定値(0.9px/frame)は歩きにも追いつけていなかった',
    walk > 0.9 && run / 0.9 > 2, `walk=${walk.toFixed(3)} run=${run.toFixed(3)} old=0.900`);

  check('C2 sim を持たないターン制本編は従来の一定速度',
    view._infantryStepPx({}, dt, 1) === 0.9);

  // 遅れが1ヘックスを越えたら追走を速める。ただしワープさせない
  const behind = view._infantryStepPx({ _sim: { stepMode: 'walk' } }, dt, pitch * 4);
  check('C3a 大きく遅れたら追走が速まる', behind > walk, `behind=${behind.toFixed(3)}`);
  check('C3b 追走は3倍で頭打ち（瞬間移動しない）',
    Math.abs(behind / walk - 3) < 0.01, `ratio=${(behind / walk).toFixed(3)}`);

  // タブ復帰などで delta が跳ねても飛ばない
  check('C4 巨大な delta でも1フレームの移動量は頭打ち',
    view._infantryStepPx({ _sim: { stepMode: 'rush' } }, 5000, 1) <= run * (50 / dt) + 1e-6);

  // sim が publish する実所要tickが最優先。地形コスト・脚の速さで先に着いて待つのを防ぐ
  const heavy = view._infantryStepPx({ _sim: { stepMode: 'walk', stepTicks: SIM_TUNING.MOVE_T_PER_HEX * 2 } }, dt, 1);
  check('C5a stepTicks があればそちらから速度を出す（重い地形で半速）',
    Math.abs(heavy / walk - 0.5) < 0.02, `walk=${walk.toFixed(3)} heavy=${heavy.toFixed(3)}`);
  check('C5b stepTicks=0 はモードからの概算へ落ちる',
    view._infantryStepPx({ _sim: { stepMode: 'walk', stepTicks: 0 } }, dt, 1) === walk);
}

// D: 歩調の上下動（サイン波）
{
  const v = makeView();
  const bobOf = (action, frame, nFrames) => v._gaitBob({
    anims: {
      currentAnim: { key: `sold_${action}_2`, frames: new Array(nFrames || 20) },
      currentFrame: { index: frame + 1 },   // Phaser の frame.index は1始まり
    },
  });
  const N = 20;
  const walkSeries = [], runSeries = [];
  for (let f = 0; f < N; f++) {
    walkSeries.push(bobOf('stand_forward', f, N));
    runSeries.push(bobOf('stand_run', f, N));
  }
  const amp = (a) => (Math.max(...a) - Math.min(...a)) / 2;

  check('D1a 歩きに上下動が付く（元クリップは頭頂の変位0px だった）', amp(walkSeries) > 0.5);
  check('D1b 走りの方が大きく弾む', amp(runSeries) > amp(walkSeries),
    `walk=${amp(walkSeries).toFixed(2)} run=${amp(runSeries).toFixed(2)}`);
  check('D1c 「ごくわずか」の範囲に収まる（表示20px の兵士に対し片振幅1.5px未満）',
    amp(runSeries) < 1.5, 'amp=' + amp(runSeries).toFixed(2));

  check('D2 匍匐は跳ねない', bobOf('prone_forward', 3, N) === 0 && bobOf('prone_idle', 3, N) === 0);
  check('D3 静止・射撃・遮蔽姿勢も跳ねない',
    bobOf('stand_idle', 3, N) === 0 && bobOf('stand_fire', 3, N) === 0
    && bobOf('kneel_cover_idle', 3, N) === 0 && bobOf('stand_reload', 3, N) === 0);
  check('D4 姿勢遷移クリップ中は跳ねない（接地が崩れる）',
    bobOf('kneel_to_stand', 3, N) === 0 && bobOf('trans_stand_idle__stand_fire', 3, N) === 0);

  // 位相: 焼き込み済みの上下（谷 p=0 / 山 p=0.25）と同位相であること。
  // 逆位相だと打ち消し合って、上下しているのにぼやける。y は下向き正 = 正が「低い」
  check('D5a 接地(p=0)で最も低い', walkSeries[0] === Math.max(...walkSeries),
    'p0=' + walkSeries[0].toFixed(2));
  check('D5b p=0.25 で最も高い', walkSeries[N / 4] === Math.min(...walkSeries),
    'p25=' + walkSeries[N / 4].toFixed(2));
  check('D5c 1ループで2歩ぶん上下する（cx曲線の実測に一致）',
    Math.abs(walkSeries[N / 2] - walkSeries[0]) < 1e-9,
    `p0=${walkSeries[0].toFixed(3)} p50=${walkSeries[N / 2].toFixed(3)}`);
  check('D5d 上下の平均はほぼ0（接地面そのものはずらさない）',
    Math.abs(walkSeries.reduce((a, b) => a + b, 0) / N) < 0.05);

  // 影は接地させたまま — 体だけが弾む
  {
    const shadowY = [];
    const spr = {
      x: 0, y: 0, texture: { key: 'sold_stand_run' }, alpha: 1,
      originX: 0.5, originY: 1, scaleX: 1, scaleY: 1, displayHeight: 20,
      setOrigin() {}, setPosition(x, y) { this.x = x; this.y = y; },
      anims: {
        currentAnim: { key: 'sold_stand_run_2', frames: new Array(N) },
        currentFrame: { index: 1 },
      },
    };
    const sh = {
      x: 0, y: 0, texture: { key: 'sold_stand_run' }, setTexture() {},
      setOrigin() {}, setScale() {}, setAlpha() {},
      setPosition(x, y) { this.x = x; this.y = y; },
    };
    const visual = { sprite: spr, shadowSprite: sh };
    const bodyY = [];
    for (let f = 0; f < N; f++) {
      spr.anims.currentFrame = { index: f + 1 };
      v._syncShadowTex(visual, spr);
      bodyY.push(spr.y); shadowY.push(sh.y);
    }
    const spread = (a) => Math.max(...a) - Math.min(...a);
    check('D6a 体は上下する', spread(bodyY) > 1, 'spread=' + spread(bodyY).toFixed(2));
    check('D6b 影は接地したまま動かない（跳ねると足元が浮く）',
      spread(shadowY) < 1e-9, 'spread=' + spread(shadowY).toFixed(3));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
