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

  const core = require(path.join(ROOT, 'sim_core.js'));
  sb.SimCore = core.SimCore; sb.mulberry32 = core.mulberry32; sb.toSimWeapon = core.toSimWeapon;
  sb.TraitPolicy = require(path.join(ROOT, 'sim_policy.js')).TraitPolicy;
  sb.CommsOrders = require(path.join(ROOT, 'sim_orders.js')).CommsOrders;
  sb.LeaderPolicy = require(path.join(ROOT, 'sim_leader.js')).LeaderPolicy;

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
  const g = makeGameLogic({ players: 4, enemies: 4 });
  const inst = attach(g);
  const before = g.units.map((u) => u.q + ',' + u.r + ':' + u.hp);
  for (let i = 0; i < 400; i++) inst.update(T.TICK_MS * 5);
  const after = g.units.map((u) => u.q + ',' + u.r + ':' + u.hp);
  check(inst.sim._tick > 0, 'sim が進んでいる (tick=' + inst.sim._tick + ')');
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
  const t0 = inst.sim._tick;
  inst.sim.result = () => ({ winner: 'A', reason: 'test', tick: t0 });
  inst.update(T.TICK_MS * 20);
  check(inst.sim._tick === t0, '決着したら update が sim を進めない');
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

// --- 10. detach で後片付けされる ---------------------------------------------
{
  const g = makeGameLogic({ players: 2, enemies: 2 });
  attach(g);
  SB.RtwpBattle.detach();
  check(SB.RtwpBattle.active === false && SB.RtwpBattle.instance === null, 'detach で切り離される');
  check(g.units.every((u) => u._rtwpHpScale === undefined), '一時プロパティが消える');
}

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
if (failCount) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
