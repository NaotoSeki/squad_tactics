/**
 * tests/rtwp_battle.test.js -- 本編RTwP接ぎ木（logic_battle_rtwp.js）の受入テスト
 *
 * 要点は「logic_game.js を書き換えずに、シムの状態を gameLogic.units へ書き戻すだけで
 * 既存描画が追従する」こと。ここでは描画の代わりに units の中身を直接検証する。
 *
 * No framework. Run with `node tests/rtwp_battle.test.js`.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let passCount = 0;
let failCount = 0;
const failures = [];
function check(cond, label) {
  if (cond) { passCount++; console.log('PASS: ' + label); }
  else { failCount++; failures.push(label); console.log('FAIL: ' + label); }
}

// --- ブラウザ前提のファイルをサンドボックスへ、シム本体は require で注入 -------
function makeSandbox() {
  const sb = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} },
    Math: Math, JSON: JSON, Date: Date, Map: Map, Set: Set, Infinity: Infinity,
    location: { search: '' } };
  sb.window = sb;
  vm.createContext(sb);
  ['data.js', 'logic_math.js', 'logic_map_city.js', 'sim_battle_adapter.js']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f }));
  vm.runInContext('this.MAP_W = MAP_W; this.MAP_H = MAP_H; this.SIM_TUNING = SIM_TUNING; this.WPNS = WPNS;',
    sb, { filename: 'expose' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'loadout_weight.js'), 'utf8'),
    sb, { filename: 'loadout_weight.js' });

  const core = require(path.join(ROOT, 'sim_core.js'));
  sb.SimCore = core.SimCore; sb.mulberry32 = core.mulberry32; sb.toSimWeapon = core.toSimWeapon;
  sb.TraitPolicy = require(path.join(ROOT, 'sim_policy.js')).TraitPolicy;
  sb.CommsOrders = require(path.join(ROOT, 'sim_orders.js')).CommsOrders;
  sb.LeaderPolicy = require(path.join(ROOT, 'sim_leader.js')).LeaderPolicy;
  sb.SimActions = require(path.join(ROOT, 'sim_actions.js')).SimActions;

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'logic_battle_rtwp.js'), 'utf8'),
    sb, { filename: 'logic_battle_rtwp.js' });
  return sb;
}

const SB = makeSandbox();
const T = SB.SIM_TUNING;

/** 本編と同じ形のマップ（CityMap）と、最小限の gameLogic スタブを作る */
function makeGameLogic(opts) {
  opts = opts || {};
  SB.CityMap.fixedSeed = 42;
  const g = {};
  SB.CityMap.generate(g);

  // 通行可能な hex を集めて、左右に分けて配置する
  const api = SB.makePsBattleMapApi({ grid: g.map, W: SB.MAP_W, H: SB.MAP_H });
  const open = [];
  for (let q = 0; q < SB.MAP_W; q++) {
    for (let r = 0; r < SB.MAP_H; r++) {
      const h = { q: q, r: r };
      if (isFinite(api.moveCost(h, h))) open.push(h);
    }
  }
  // 交戦が起きる距離に置く。400hexの盤面で両端に置くと約19hex離れ、小銃射程(7)の
  // 外なので何も起きない — それでは「シムに追従する」ことを検証できない。
  const nP = opts.players != null ? opts.players : 3;
  const nE = opts.enemies != null ? opts.enemies : 3;
  const anchor = open[Math.floor(open.length / 2)];
  const near = open.slice().sort((a, b) => api.dist(anchor, a) - api.dist(anchor, b));
  const units = [];
  for (let i = 0; i < nP; i++) {
    units.push(mkUnit('P' + i, 'player', near[i], i === 0 ? ['Veteran'] : []));
  }
  // 味方の塊から 3〜6hex 離れた所に敵を置く（射程内・LOSも通りやすい）
  const foes = near.filter((h) => {
    const d = api.dist(anchor, h);
    return d >= 3 && d <= 6;
  });
  for (let i = 0; i < nE; i++) {
    units.push(mkUnit('E' + i, 'enemy', foes[i % Math.max(1, foes.length)] || near[nP + i], []));
  }
  if (opts.noWeaponFor != null) units[opts.noWeaponFor]._noWeapon = true;

  return {
    units: units,
    map: g.map,
    selectedUnit: units[0],
    state: 'PLAY',
    logs: [],
    ui: { log(m) { this.owner.logs.push(m); } },
    getVirtualWeapon(u) { return u._noWeapon ? null : { code: 'm1' }; },
    checkWin() { return false; },
  };
}
function mkUnit(id, team, hex, skills) {
  return { id: id, team: team, q: hex.q, r: hex.r, hp: 100, maxHp: 100,
    def: { isTank: false }, name: id, hands: [], bag: [], stance: 'stand',
    skills: skills || [], ap: 0, maxAp: 0 };
}
function attach(g) {
  g.ui.owner = g;
  SB.RtwpBattle.fixedSeed = 7;
  SB.RtwpBattle.detach();
  return SB.RtwpBattle.attach(g);
}

// Loadout changes must replace the speed captured when the RTwP soldier was registered.
{
  const g = makeGameLogic({ players: 1, enemies: 1 });
  const u = g.units[0];
  u.params = { speed: 3, str: 6 };
  u.ap = 4;
  u.maxAp = 4;
  u.hands = ['mortar_barrel', 'mortar_bipod', 'mortar_plate']
    .map((code) => Object.assign({ code: code }, SB.WPNS[code]));
  const sidearm = Object.assign({ code: 'm1911' }, SB.WPNS.m1911);
  u.bag = [Object.assign({ code: 'mortar_shell_box' }, SB.WPNS.mortar_shell_box), sidearm];
  SB.LoadoutWeight.refreshUnitLoadout(u);
  const inst = attach(g);
  const soldier = inst.sim.getSoldier(String(u.id));
  soldier.attrs.speed = 0; // reproduce the stale value reported after changing equipment
  u.hands = [null, null, null];
  u.bag = [null, sidearm];
  SB.LoadoutWeight.refreshUnitLoadout(u);
  inst.syncUnitLoadout(u);
  const moveEntry = SB.SimActions.list(inst.actionContext(u, null, null))
    .find((entry) => entry.action.id === 'MOVE');
  check(u._carriedWeightKg === 2.4, 'M2 4カード解除後はM1911だけの2.4kg');
  check(u.params.effectiveSpeed === 3 && soldier.attrs.speed === 3,
    '装備解除直後にunitとRTwP soldierのspdを再同期');
  check(SB.LoadoutWeight.getMovementBudget(u, 4) === 2, 'M2 4カード解除で移動力2');
  check(!!moveEntry && moveEntry.ok === true, 'M2 4カード解除でRTwP移動メニュー有効');
}

// --- 1. 依存が欠けたら何もしない（旧ターン制が壊れない） ---------------------
{
  const saved = SB.SimCore;
  delete SB.SimCore;
  const g = makeGameLogic({});
  g.ui.owner = g;
  check(SB.RtwpBattle.attach(g) === null, '依存グローバルが欠けていれば attach は null（旧コアのまま）');
  SB.SimCore = saved;
}

// --- 2. ユニットが sim へ登録される -----------------------------------------
{
  const g = makeGameLogic({ players: 3, enemies: 3 });
  const inst = attach(g);
  check(!!inst, 'attach がインスタンスを返す');
  check(inst.sim.soldiers().length === 6, '生存ユニット6名が sim へ登録される');
  check(SB.RtwpBattle.active === true, 'active フラグが立つ');
  check(g.logs.some((m) => m.indexOf('REAL TIME') !== -1), '開始ログが出る');
}

// --- 3. 武器を持たないユニットはスキップされる -------------------------------
{
  const g = makeGameLogic({ players: 3, enemies: 3, noWeaponFor: 0 });
  const inst = attach(g);
  check(inst.sim.soldiers().length === 5, '武器なしユニットは登録されない');
  check(g.units[0]._rtwpSkipped === true, 'スキップした印が立つ');
}

// --- 4. team のマッピング ----------------------------------------------------
{
  const g = makeGameLogic({ players: 3, enemies: 3 });
  const inst = attach(g);
  const ss = inst.sim.soldiers();
  check(ss.filter((s) => s.team === 'A').length === 3, 'player -> A');
  check(ss.filter((s) => s.team === 'B').length === 3, 'enemy -> B');
  check(ss.filter((s) => s.team === 'A' && s.isLeader).length === 1, '各隊に分隊長が1名');
}

// --- 5. update で units が sim に追従する（接ぎ木の要） ----------------------
{
  const g = makeGameLogic({ players: 2, enemies: 2 });
  const inst = attach(g);
  const h = { q: g.units[0].q, r: g.units[0].r };
  const cardUnit = mkUnit('CARD-REINFORCEMENT', 'player', h, ['Veteran']);
  g.units.push(cardUnit);
  inst.paused = true;
  inst.update(T.TICK_MS);
  const registered = inst.sim.getSoldier('CARD-REINFORCEMENT');
  check(!!registered && registered.team === 'A',
    'ポーズ中にカード配置した兵士もRTwPへ即時登録される');
  check(inst.unitById.get('CARD-REINFORCEMENT') === cardUnit,
    'カード配置兵が本編描画ユニットとRTwP兵で対応付く');
  check(inst.sim.soldiers().filter((s) => s.team === 'A' && s.isLeader).length === 1,
    'カード配置兵の追加で分隊長が重複しない');
}

// --- 6. update で units が sim に追従する（接ぎ木の要） ----------------------
{
  const g = makeGameLogic({ players: 4, enemies: 4 });
  const inst = attach(g);
  const before = g.units.map((u) => u.q + ',' + u.r + ':' + u.hp);
  // 決着すると finishBattle が自分を切り離す（inst.sim は null になる）。
  // ここで見たいのは「units が sim に追従するか」なので、sim の参照を先に取り、
  // 切り離されたら回すのをやめる。
  const sim6 = inst.sim;
  for (let i = 0; i < 400 && SB.RtwpBattle.instance; i++) inst.update(T.TICK_MS * 5);
  const after = g.units.map((u) => u.q + ',' + u.r + ':' + u.hp);
  check(sim6._tick > 0, 'sim が進んでいる (tick=' + sim6._tick + ')');
  check(before.join('|') !== after.join('|'), 'units の座標かHPが sim に追従して変化する');
  check(g.units.every((u) => u.hp >= 0 && u.hp <= u.maxHp), 'hp が 0..maxHp に収まる');
  check(g.units.some((u) => typeof u.suppression === 'number'), '制圧値が units へ書き戻される');
  check(g.units.some((u) => typeof u.simState === 'string'), 'sim の状態が units へ書き戻される');
}

// --- 6. 決着後は進まない -----------------------------------------------------
{
  const g = makeGameLogic({ players: 2, enemies: 2 });
  const inst = attach(g);
  inst.update(T.TICK_MS * 3);
  const sim7 = inst.sim;
  const t0 = sim7._tick;
  sim7.result = () => ({ winner: 'A', reason: 'test', tick: t0 });
  inst.update(T.TICK_MS * 20);
  check(sim7._tick === t0, '決着したら update が sim を進めない');
  check(SB.RtwpBattle.instance === null,
    '決着したインスタンスは切り離される（次セクターが接続できる）');
}

// --- 7. 一時停止 -------------------------------------------------------------
{
  const g = makeGameLogic({ players: 2, enemies: 2 });
  const inst = attach(g);
  inst.setPaused(true);
  const t0 = inst.sim._tick;
  inst.update(T.TICK_MS * 20);
  check(inst.sim._tick === t0, 'ポーズ中は tick が進まない');
  inst.setPaused(false);
  inst.update(T.TICK_MS * 5);
  check(inst.sim._tick > t0, '解除すると再開する');
}

// --- 8. 命令が sim の契約どおりの形で出る -----------------------------------
{
  const g = makeGameLogic({ players: 3, enemies: 3 });
  const inst = attach(g);
  const seen = [];
  const orig = inst.sim.issueOrder.bind(inst.sim);
  inst.sim.issueOrder = (o) => { seen.push(o); return orig(o); };

  const me = g.units[0];
  const s = inst.sim.getSoldier(String(me.id));
  const dest = inst.map.neighbors({ q: s.q, r: s.r }).find((h) => isFinite(inst.map.moveCost({ q: s.q, r: s.r }, h)));
  const moved = dest ? inst.orderMove(me, dest.q, dest.r) : false;
  const mv = seen.find((o) => o.type === 'MOVE_TO');
  check(moved && !!mv, 'orderMove が MOVE_TO を発行する');
  check(!!mv && Array.isArray(mv.soldierIds) && mv.payload && Array.isArray(mv.payload.path),
    '命令の形が sim の契約どおり {type, soldierIds, payload}');

  // 遠くの hex を指しても1hexずつ刻まれること（ワープ防止）
  seen.length = 0;
  const far = { q: Math.min(SB.MAP_W - 1, s.q + 5), r: s.r };
  inst.orderMove(me, far.q, far.r);
  const mv2 = seen.find((o) => o.type === 'MOVE_TO');
  let contiguous = true;
  if (mv2) {
    let prev = { q: s.q, r: s.r };
    mv2.payload.path.forEach((h) => {
      if (inst.map.dist(prev, h) !== 1) contiguous = false;
      prev = h;
    });
  }
  check(contiguous, '経路は1hexずつ刻まれている（要素1個でワープしない）');

  seen.length = 0;
  const foe = g.units.find((u) => u.team === 'enemy');
  inst.orderFocusFire(foe);
  const tg = seen.find((o) => o.type === 'TARGET');
  check(!!tg && tg.payload.mode === 'aimed' && tg.payload.targetId === String(foe.id),
    'orderFocusFire が TARGET(aimed) を全員へ出す');

  seen.length = 0;
  inst.orderAttack(me, foe, 'aimed');
  const manual = seen.find((o) => o.type === 'TARGET');
  check(!!manual && manual.soldierIds.length === 1 && manual.soldierIds[0] === String(me.id)
    && manual.payload.targetId === String(foe.id) && manual.payload.mode === 'aimed',
    '手動射撃Actionは選択兵1名のTARGET(aimed)命令へ変換される');

  seen.length = 0;
  inst.orderAttack(me, foe, 'suppress');
  const manualSuppress = seen.find((o) => o.type === 'TARGET');
  check(!!manualSuppress && manualSuppress.payload.mode === 'suppress',
    '手動制圧ActionもRTwPのTARGET(suppress)命令へ変換される');

  seen.length = 0;
  inst.orderSuppress();
  const sup = seen.filter((o) => o.type === 'TARGET' && o.payload.mode === 'suppress');
  check(sup.length >= 0, 'orderSuppress が例外を出さない');

  seen.length = 0;
  inst.orderTakeCover();
  const tc = seen.find((o) => o.type === 'TAKE_COVER');
  check(!!tc && !tc.payload.hex, 'orderTakeCover は行き先を指定しない（現場判断）');
}

// --- 9. 演出グローバルが無くても落ちない -------------------------------------
{
  const g = makeGameLogic({ players: 3, enemies: 3 });
  const inst = attach(g);
  delete SB.VFX; delete SB.Sfx; delete SB.Renderer;
  let threw = false;
  try { for (let i = 0; i < 200; i++) inst.update(T.TICK_MS * 5); } catch (e) { threw = true; }
  check(!threw, 'VFX/Sfx/Renderer が未定義でも update が例外を出さない');
}

// --- 10. イベントログは sim_battle.html と同じ文言 ---------------------------
{
  const g = makeGameLogic({ players: 2, enemies: 2 });
  const inst = attach(g);
  g.logs.length = 0;
  inst.dispatch([
    { tick: 12, type: 'SHOT', shooterId: 'P0', targetId: 'E0', hit: false, killed: false },
    { tick: 13, type: 'POLICY', id: 'P1', note: '攻撃的: 独断で射撃開始' },
    { tick: 14, type: 'ORDER_DELIVERED', id: 'P0', order: { type: 'MOVE_TO' } },
  ]);
  check(g.logs.includes('t12 SHOT P0->E0 miss'), '射撃ログが tick・射手・標的・命中結果を保持する');
  check(g.logs.includes('t13 POLICY P1 「攻撃的: 独断で射撃開始」'), 'POLICY文言がsim_battleと一致する');
  check(g.logs.includes('t14 ORDER_DELIVERED P0 MOVE_TO'), '命令到達ログがsim_battleと一致する');
}

// --- 11. 非アクティブ中と復帰直後の巨大deltaを捨てる --------------------------
{
  const g = makeGameLogic({ players: 2, enemies: 2 });
  const inst = attach(g);
  const t0 = inst.sim._tick;
  SB.document = { hidden: true };
  inst.update(T.TICK_MS * 100);
  check(inst.sim._tick === t0 && inst.acc === 0, 'hidden中はsimを進めずdeltaを蓄積しない');
  SB.document.hidden = false;
  inst.update(T.TICK_MS * 100);
  check(inst.sim._tick === t0 && inst.acc === 0, '復帰直後の巨大deltaを1回捨てる');
  delete SB.document;
}

// --- 12. 実際の手動Action入口も旧攻撃ではなくRTwP命令へ接続される ------------
{
  const g = makeGameLogic({ players: 2, enemies: 2 });
  let legacyAttackCalls = 0;
  g.actionAttack = () => { legacyAttackCalls++; };
  g.onUnitClick = (unit) => { g.selectedUnit = unit; };
  g.setMode = (mode) => { g.interactionMode = mode; };
  g.ui.hideActionMenu = () => {};
  const inst = attach(g);
  const issued = [];
  const origIssue = inst.sim.issueOrder.bind(inst.sim);
  inst.sim.issueOrder = (o) => { issued.push(o); return origIssue(o); };

  const fakeBody = {
    appendChild(el) { el.parentNode = this; },
    removeChild(el) { if (el) el.parentNode = null; },
  };
  SB.document = {
    body: fakeBody,
    activeElement: null,
    hidden: false,
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; },
    createElement() { return { style: {}, parentNode: null, innerHTML: '' }; },
  };
  inst.installUi();
  const me = g.units.find((u) => u.team === 'player');
  const foe = g.units.find((u) => u.team === 'enemy');
  inst.setPaused(true);
  g.selectedUnit = me;
  g.onUnitClick(foe);
  check(g.selectedUnit === me,
    '戦術ポーズ中の敵クリックは味方選択を維持する');
  check(issued.some((o) => o.type === 'TARGET' && o.soldierIds[0] === String(me.id)
    && o.payload.targetId === String(foe.id)),
    '戦術ポーズ中の敵クリックが個別射撃命令を発行する');
  g.actionAttack(me, foe);
  const manual = issued.find((o) => o.type === 'TARGET');
  check(legacyAttackCalls === 0, '手動Actionから旧ターン制actionAttackを呼ばない');
  check(!!manual && manual.soldierIds[0] === String(me.id)
    && manual.payload.targetId === String(foe.id) && manual.payload.mode === 'aimed',
    '手動Action入口が選択兵のRTwP TARGET命令を発行する');
  check(me._rtwpPendingTargetId === String(foe.id),
    '手動Actionは伝達中から射撃対象を向きへ反映する');
  inst.setPaused(false);
  for (let i = 0; i < 30; i++) inst.update(T.TICK_MS);
  check(me._sim && me._sim.engageTargetId === String(foe.id),
    '手動Actionがsimへ配達され配置兵へ同期される');
  inst.uninstallUi();
  delete SB.document;
}

// --- 13. RTwP Action menu ignores legacy AP/ammo and uses sim ammo ------------
{
  const uiSource = fs.readFileSync(path.join(__dirname, '..', 'logic_ui.js'), 'utf8')
    + '\n;this.__UIManager = UIManager;';
  const makeButton = () => ({
    style: {},
    classList: {
      values: new Set(['disabled']),
      add(v) { this.values.add(v); },
      remove(v) { this.values.delete(v); },
      contains(v) { return this.values.has(v); },
    },
    querySelector() { return null; },
  });
  const buttons = {
    'btn-move': makeButton(), 'btn-attack': makeButton(),
    'btn-repair': makeButton(), 'btn-melee': makeButton(), 'btn-heal': makeButton(),
  };
  const group = { style: {} };
  const menu = { style: {}, querySelector: () => group };
  const uiBox = {
    console, setTimeout: () => 0,
    document: { getElementById: (id) => id === 'command-menu' ? menu : buttons[id] },
    getCurrentWeapon: () => ({ ap: 2, current: 0, reserve: 0 }),
    gameLogic: { getUnitsInHex: () => [] },
    RtwpBattle: {
      active: true,
      instance: { sim: { getSoldier: () => ({ hp: 100, weapon: {}, magRemaining: 7, magsLeft: 0 }) } },
    },
  };
  uiBox.window = uiBox;
  vm.createContext(uiBox);
  vm.runInContext(uiSource, uiBox, { filename: 'logic_ui.js' });
  uiBox.__UIManager.prototype.showActionMenu.call({ menuSafeLock: false }, {
    id: 'player-1', ap: 0, q: 0, r: 0, hands: [], def: { isTank: false },
  }, 10, 10);
  check(!buttons['btn-attack'].classList.contains('disabled'),
    'RTwP手動射撃ボタンは旧AP=0でもsim弾薬があれば有効');
}

// --- 14. detach で後片付けされる ---------------------------------------------
{
  const g = makeGameLogic({ players: 2, enemies: 2 });
  attach(g);
  SB.RtwpBattle.detach();
  check(SB.RtwpBattle.active === false && SB.RtwpBattle.instance === null, 'detach で切り離される');
  check(g.units.every((u) => u._rtwpHpScale === undefined), '一時プロパティが消える');
  check(g.units.every((u) => u._sim === undefined && u._rtwpPendingTargetId === undefined),
    'detach でsim同期と伝達中ターゲットも消える');
}

{
  const g = makeGameLogic({ players: 2, enemies: 2 });
  const inst = attach(g);
  const t0 = inst.sim._tick;
  SB.Sfx = { isPageActive() { return false; } };
  SB.document = { hidden: false, visibilityState: 'visible' };
  inst.update(T.TICK_MS * 100);
  check(inst.sim._tick === t0 && inst.acc === 0,
    'window blur state stops RTwP simulation and event-log progress');
  delete SB.Sfx;
  delete SB.document;
}

// --- 15. 非アクティブは PAUSE に入り、復帰しても自動再開しない ----------------
{
  const g = makeGameLogic({ players: 2, enemies: 2 });
  const inst = attach(g);
  check(inst.paused === false, '開始直後は動いている');

  inst.onWindowActivity('blur');
  check(inst.paused === true, 'ウィンドウ非アクティブで PAUSE に入る');

  const t0 = inst.sim._tick;
  inst.update(T.TICK_MS * 100);
  check(inst.sim._tick === t0, 'PAUSE 中はシムが進まない');

  inst.onWindowActivity('focus');
  check(inst.paused === true, 'フォーカスが戻っても自動再開しない（Spaceを待つ）');
  inst.update(T.TICK_MS * 100);
  check(inst.sim._tick === t0, '復帰フレームでもシムは止まったまま');

  inst.setPaused(false);
  // 復帰直後の1フレームは溜まった巨大deltaを捨てるため進まない（_skipNextDelta）
  inst.update(T.TICK_MS * 100);
  check(inst.sim._tick === t0, '再開した最初のフレームは溜まったdeltaを消化しない');
  inst.update(T.TICK_MS * 3);
  check(inst.sim._tick > t0, '次のフレームからシムが進む');
}

// --- 16. タブ可視のまま document.hidden になった場合も PAUSE ------------------
{
  const g = makeGameLogic({ players: 2, enemies: 2 });
  const inst = attach(g);
  SB.document = { hidden: true, visibilityState: 'hidden' };
  inst.onWindowActivity('visibilitychange');
  check(inst.paused === true, 'visibilitychange(hidden) でも PAUSE に入る');
  delete SB.document;
}

// --- 17. resolving tick result freezes before leader AI or another tick --------
{
  const g = makeGameLogic({ players: 2, enemies: 2 });
  const inst = attach(g);
  const sim = inst.sim;
  let ticks = 0, leaderAiCalls = 0;
  sim.tick = function () {
    ticks++;
    this._tick++;
    this._result = { winner: 'A', reason: 'annihilation', tick: this._tick };
    this._events.push({ type: 'RESULT', tick: this._tick, winner: 'A', reason: 'annihilation' });
  };
  inst.runLeaderAI = function () { leaderAiCalls++; };
  inst.update(T.TICK_MS * 5);
  check(ticks === 1, '決着tickの同一フレームで追加tickを実行しない');
  check(leaderAiCalls === 0, '決着後にリーダーAIや命令発行へ進まない');
  check(SB.RtwpBattle.instance === null, '決着tick内でfreezeしてRTwPを切り離す');
}

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
if (failCount) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
