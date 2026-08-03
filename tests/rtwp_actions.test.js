/**
 * tests/rtwp_actions.test.js -- 行動カタログの本編UI経路（logic_battle_rtwp.js）
 *
 * 検証対象は「プレイヤーの操作が sim_actions.js の同じ表を通って命令になる」こと。
 * メニュー描画・対象待ち・ホットキー・切り戻しを、DOMスタブ越しに機械検証する。
 *
 * No framework. Run with `node tests/rtwp_actions.test.js`.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let passCount = 0;
let failCount = 0;
function check(cond, label, detail) {
  if (cond) { passCount++; console.log('PASS: ' + label); }
  else { failCount++; console.log('FAIL: ' + label + (detail ? ' -- ' + detail : '')); }
}

// --- サンドボックス（rtwp_battle.test.js と同じ組み立て + sim_actions） -------
function makeSandbox() {
  const sb = {
    module: { exports: {} }, console: { log() {}, warn() {}, error() {} },
    Math: Math, JSON: JSON, Date: Date, Map: Map, Set: Set, Infinity: Infinity,
    location: { search: '' },
  };
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
  sb.SimActions = require(path.join(ROOT, 'sim_actions.js')).SimActions;

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'logic_battle_rtwp.js'), 'utf8'),
    sb, { filename: 'logic_battle_rtwp.js' });
  return sb;
}

const SB = makeSandbox();
const T = SB.SIM_TUNING;

function mkUnit(id, team, hex) {
  return {
    id: id, name: id, team: team, q: hex.q, r: hex.r,
    hp: 100, maxHp: 100, ap: 6, skills: [], stance: 'stand',
    hands: [{ code: 'm1', current: 8, cap: 8 }], bag: [],
    def: { isTank: false },
  };
}

function makeGameLogic() {
  SB.CityMap.fixedSeed = 42;
  const g = {};
  SB.CityMap.generate(g);
  const api = SB.makePsBattleMapApi({ grid: g.map, W: SB.MAP_W, H: SB.MAP_H });
  const open = [];
  for (let q = 0; q < SB.MAP_W; q++) {
    for (let r = 0; r < SB.MAP_H; r++) {
      const h = { q: q, r: r };
      if (isFinite(api.moveCost(h, h))) open.push(h);
    }
  }
  const anchor = open[Math.floor(open.length / 2)];
  const near = open.slice().sort((a, b) => api.dist(anchor, a) - api.dist(anchor, b));
  const foes = near.filter((h) => { const d = api.dist(anchor, h); return d >= 3 && d <= 6; });

  const units = [mkUnit('P0', 'player', near[0]), mkUnit('P1', 'player', near[1]),
    mkUnit('E0', 'enemy', foes[0])];
  g.units = units;
  g.selectedUnit = null;
  g.interactionMode = 'SELECT';
  g.getVirtualWeapon = () => Object.assign({ code: 'm1' }, SB.WPNS.m1);
  g.setMode = (m) => { g.interactionMode = m; };
  g.clearSelection = () => { g.selectedUnit = null; };
  g.ui = { log() {}, hideActionMenu() {}, showActionMenu() {} };
  g.map = g.map || {};
  return g;
}

// --- DOM スタブ ---------------------------------------------------------------
function makeDom() {
  const mkEl = () => ({
    style: {}, className: '', textContent: '', title: '', innerHTML: '',
    children: [], onclick: null, parentNode: null,
    appendChild(el) { this.children.push(el); el.parentNode = this; return el; },
    removeChild(el) {
      const i = this.children.indexOf(el);
      if (i >= 0) this.children.splice(i, 1);
      if (el) el.parentNode = null;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
  });
  const menu = mkEl();
  menu.innerHTML = '<div class="cmd-btn" id="btn-move">移動</div>';
  const keyHandlers = [];
  const dom = {
    body: mkEl(),
    activeElement: null,
    hidden: false,
    addEventListener(type, fn) { if (type === 'keydown') keyHandlers.push(fn); },
    removeEventListener() {},
    getElementById(id) { return id === 'command-menu' ? menu : null; },
    createElement() { return mkEl(); },
    _menu: menu,
    _key(key) { keyHandlers.forEach((fn) => fn({ key: key, preventDefault() {} })); },
  };
  return dom;
}

function attach(g) {
  SB.RtwpBattle.fixedSeed = 7;
  const inst = SB.RtwpBattle.attach(g);
  if (!inst) throw new Error('attach failed');
  return inst;
}

// ---------------------------------------------------------------------------
// 1. 味方の左クリック = その兵にできることだけの短いメニュー
// ---------------------------------------------------------------------------
{
  const g = makeGameLogic();
  const dom = makeDom();
  SB.document = dom;
  const inst = attach(g);
  inst.installUi();

  const me = g.units.find((u) => u.team === 'player');
  g.selectedUnit = me;
  g.ui.showActionMenu(me, 100, 100);

  const labels = dom._menu.children.map((c) => c.textContent);
  check(labels.join('/') === '移動/制圧/強襲/CANCEL',
    '個人の語彙は 移動・制圧・強襲 の3つだけ', labels.join(' | '));
  check(!labels.some((t) => t === '走る' || t === '匍匐' || t === '射撃'
    || t === '手榴弾' || t === '銃擲弾'),
    '走る・匍匐・射撃・手榴弾・銃擲弾はメニューに出さない（行動の中身であって命令ではない）',
    labels.join(' | '));
  check(!labels.some((t) => /\d+\.\d秒/.test(t) || t.indexOf('射線') >= 0),
    '所要秒数や射線数をメニューに出さない', labels.join(' | '));
  check(!labels.some((t) => t.indexOf('集中射撃') >= 0 || t.indexOf('遮蔽に入れ') >= 0
    || t.indexOf('一帯') >= 0),
    '分隊命令は個別兵のメニューに混ざらない', labels.join(' | '));
  check(dom._menu.children.every((c) => !c.title),
    'tooltip（ALT文）を一切付けない', dom._menu.children.map((c) => c.title).join('|'));
  // 対象未指定でも選べる（選んでから対象をクリックする）
  check(dom._menu.children.slice(0, 3).every((c) => c.className.indexOf('disabled') < 0
    && typeof c.onclick === 'function'),
    '3つとも対象未指定の状態で選べる',
    dom._menu.children.map((c) => c.className).join('|'));

  inst.uninstallUi();
  SB.RtwpBattle.detach();
  delete SB.document;
}

// ---------------------------------------------------------------------------
// 2. メニューで選ぶ → 左クリックで行き先を指す
// ---------------------------------------------------------------------------
{
  const g = makeGameLogic();
  const dom = makeDom();
  SB.document = dom;
  const inst = attach(g);
  inst.installUi();
  const issued = [];
  const orig = inst.sim.issueOrder.bind(inst.sim);
  inst.sim.issueOrder = (o) => { issued.push(o); return orig(o); };

  const me = g.units.find((u) => u.team === 'player');
  g.selectedUnit = me;
  g.ui.showActionMenu(me, 0, 0);
  check(issued.length === 0, 'メニューを開いただけでは命令を出さない');

  dom._menu.children[0].onclick();   // 移動
  check(inst.pendingAction && inst.pendingAction.id === 'MOVE',
    '行動を選ぶと行き先待ちになる');
  check(issued.length === 0, '行き先が決まるまで命令は出ない');

  g.handleClick({ q: me.q + 2, r: me.r }, 0, 0);
  const move = issued.find((o) => o.type === 'MOVE_TO');
  check(!!move && move.payload.mode === 'auto',
    '移動命令はモードを指定しない（現場が1マスずつ決める）', move && move.payload.mode);
  check(!!move && move.payload.path && move.payload.path.length > 0,
    '経路は1hexずつ刻まれている（ワープしない）', move && JSON.stringify(move.payload.path));
  check(inst.pendingAction === null, '確定後に行き先待ちが解除される');

  // 右クリックは取り消しだけ。移動の意味を持たせない
  issued.length = 0;
  inst.armAction('MOVE', me);
  g.handleRightClick(0, 0, { q: me.q + 1, r: me.r });
  check(issued.length === 0 && inst.pendingAction === null,
    '右クリックは命令を出さず、選択中の行動を取り消すだけ', 'issued=' + issued.length);

  inst.uninstallUi();
  SB.RtwpBattle.detach();
  delete SB.document;
}

// ---------------------------------------------------------------------------
// 2b. 経路線: 選択中だけ出て、命令したら残り経路に切り替わり、終われば消える
// ---------------------------------------------------------------------------
{
  const g = makeGameLogic();
  const dom = makeDom();
  SB.document = dom;
  const inst = attach(g);
  inst.installUi();
  const me = g.units.find((u) => u.team === 'player');
  g.selectedUnit = me;
  g.path = []; g.reachableHexes = [];

  // 何も選んでいなければマーカーは出ない
  g.hoverHex = { q: me.q + 3, r: me.r };
  inst.updateMovePreview();
  check(g.reachableHexes.length === 0, '行動を選んでいない間はマーカーを出さない',
    'len=' + g.reachableHexes.length);

  // 行き先待ちの間だけカーソルのマスを指す
  inst.armAction('MOVE', me);
  inst.updateMovePreview();
  check(g.reachableHexes.length === 1 && g.reachableHexes[0].q === me.q + 3,
    '行き先を選んでいる間はカーソルのhexを指す', JSON.stringify(g.reachableHexes));
  check(g.path.length === 0, '経路線は一切引かない', 'len=' + g.path.length);

  // 命令を出したら、ホバーしたままでもカーソル追従は止まる
  g.handleClick({ q: me.q + 2, r: me.r }, 0, 0);
  g.hoverHex = { q: me.q + 5, r: me.r };
  inst.updateMovePreview();
  check(inst.pendingAction === null && g.reachableHexes.length === 1
    && g.reachableHexes[0].q === me.q + 2,
    '命令後のマーカーはカーソルでなく行き先を指す', JSON.stringify(g.reachableHexes));

  // PAUSE 中でも更新される（盤面を読んで命令を組み立てる時間だから）
  inst.setPaused(true);
  inst.update(T.TICK_MS);
  check(g.reachableHexes.length === 1, 'PAUSE中もマーカーが出る',
    JSON.stringify(g.reachableHexes));
  inst.setPaused(false);

  // 到着後は消える
  for (let i = 0; i < 600; i++) inst.update(T.TICK_MS);
  check(g.reachableHexes.length === 0, '到着したらマーカーが消える',
    'len=' + g.reachableHexes.length);

  inst.uninstallUi();
  SB.RtwpBattle.detach();
  delete SB.document;
}

// ---------------------------------------------------------------------------
// 3. ホットキーもメニューと同じカタログを引く
// ---------------------------------------------------------------------------
{
  const g = makeGameLogic();
  const dom = makeDom();
  SB.document = dom;
  const inst = attach(g);
  inst.installUi();
  const issued = [];
  const orig = inst.sim.issueOrder.bind(inst.sim);
  inst.sim.issueOrder = (o) => { issued.push(o); return orig(o); };

  const me = g.units.find((u) => u.team === 'player');
  const foe = g.units.find((u) => u.team === 'enemy');
  g.selectedUnit = me;

  // 制圧は地点を取る。目的語の無い命令を出させないのが要点
  dom._key('S');
  check(inst.pendingAction && inst.pendingAction.id === 'SUPPRESS_HEX',
    'S は「どの地点を制圧するか」の対象待ちになる');
  check(issued.length === 0, '地点が決まるまで制圧は発行されない');
  // 射線の通る地点を選ぶ（廃墟越しの地点は「射線が通らない」で正しく弾かれる）
  const spot = inst.map.neighbors({ q: me.q, r: me.r })[0];
  g.handleClick(spot, 0, 0);
  check(issued.some((o) => o.type === 'TARGET_HEX' && o.payload.hex.q === spot.q
    && o.payload.hex.r === spot.r),
    '地点をクリックするとその地点への制圧になる', 'issued=' + issued.length);

  // 射線の通らない地点は命令にならない（理由付きで弾く）
  issued.length = 0;
  const blocked = { q: foe.q, r: foe.r };
  if (!inst.map.hasLos({ q: me.q, r: me.r }, blocked)) {
    g.selectedUnit = me;
    dom._key('S');
    g.handleClick(blocked, 0, 0);
    check(issued.length === 0, '射線の通らない地点への制圧は発行されない',
      'issued=' + issued.length);
  } else {
    check(true, '射線の通らない地点のテスト: この配置では遮蔽が無いため省略');
  }

  // 強襲は敵ユニットを直接指定する
  issued.length = 0;
  g.selectedUnit = me;
  dom._key('V');
  check(inst.pendingAction && inst.pendingAction.id === 'ASSAULT',
    'V は「どの敵を強襲するか」の対象待ちになる');
  g.onUnitClick(foe);
  check(issued.some((o) => o.type === 'ASSAULT' && o.payload.targetId === String(foe.id)),
    '敵をクリックするとその敵への強襲になる', 'issued=' + issued.length);

  // A = 面制圧。地面を左クリックした地点へ TARGET_HEX が出る
  issued.length = 0;
  g.selectedUnit = me;
  dom._key('A');
  check(inst.pendingAction && inst.pendingAction.id === 'SUPPRESS_AREA',
    'A は「どの一帯か」の対象待ちになる');
  g.handleClick({ q: me.q + 2, r: me.r }, 0, 0);
  check(issued.some((o) => o.type === 'TARGET_HEX'),
    'A のあと地面を左クリックすると面制圧が出る', 'issued=' + issued.length);

  issued.length = 0;
  g.selectedUnit = me;
  dom._key('f');
  check(inst.pendingAction && inst.pendingAction.id === 'FOCUS_FIRE',
    'F（小文字でも）で集中射撃が対象待ちになる');
  dom._key('Escape');
  check(inst.pendingAction === null, 'Esc で対象待ちを取り消せる');

  issued.length = 0;
  dom._key('C');
  check(issued.some((o) => o.type === 'TAKE_COVER'), 'C で遮蔽命令が出る');

  inst.uninstallUi();
  SB.RtwpBattle.detach();
  delete SB.document;
}

// ---------------------------------------------------------------------------
// 4. 切り戻し: uninstallUi で旧メニューDOMと showActionMenu が戻る
// ---------------------------------------------------------------------------
{
  const g = makeGameLogic();
  const dom = makeDom();
  SB.document = dom;
  const before = dom._menu.innerHTML;
  const origShow = g.ui.showActionMenu;
  const inst = attach(g);
  inst.installUi();
  check(g.ui.showActionMenu !== origShow, 'RTwP中は showActionMenu が差し替わる');

  // 命令メニューは旧ターン制と同じく味方の左クリックで開く
  const me = g.units.find((u) => u.team === 'player');
  g.selectedUnit = me;
  g.ui.showActionMenu(me, 10, 10);
  check(dom._menu.children.length > 0,
    '味方の左クリックで命令メニューが開く', 'n=' + dom._menu.children.length);

  inst.uninstallUi();
  check(g.ui.showActionMenu === origShow, 'uninstallUi で元の showActionMenu へ戻る');
  check(dom._menu.innerHTML === before, 'uninstallUi で旧メニューDOMが復元される',
    dom._menu.innerHTML);
  SB.RtwpBattle.detach();
  delete SB.document;
}

// ---------------------------------------------------------------------------
// 5. 移動命令が最後まで届く（1hexで止まる回帰の再発防止）
// ---------------------------------------------------------------------------
{
  const g = makeGameLogic();
  const inst = attach(g);
  const me = g.units.find((u) => u.team === 'player');
  const s0 = inst.sim.getSoldier(String(me.id));
  const dest = { q: s0.q + 3, r: s0.r };
  const path = [];
  for (let i = 1; i <= 3; i++) path.push({ q: s0.q + i, r: s0.r });
  const reachable = path.every((h) => isFinite(inst.map.moveCost(h, h)));
  if (reachable) {
    inst.sim.issueOrder({
      type: 'MOVE_TO', soldierIds: [String(me.id)],
      payload: { path: path, mode: 'walk' },
    });
    for (let i = 0; i < 400; i++) inst.sim.tick();
    const s = inst.sim.getSoldier(String(me.id));
    check(s.q === dest.q && s.r === dest.r,
      '移動命令が目的地まで届く（1hexで止まらない）', `q=${s.q},r=${s.r} 目標 q=${dest.q}`);
  } else {
    check(true, '移動命令の到達テスト: 直線経路が塞がれていたため省略');
  }
  SB.RtwpBattle.detach();
}

// ---------------------------------------------------------------------------
// 6. 決着がキャンペーン進行へ渡る（敵を全滅させたのに次セクターへ行かない回帰）
// ---------------------------------------------------------------------------
{
  const g = makeGameLogic();
  const calls = { checkWin: 0, checkLose: 0, cleared: 0, gameOver: 0 };
  g.state = 'PLAY';
  g._victoryProcessed = false;
  g.checkWin = function () {
    calls.checkWin++;
    const enemies = g.units.filter((u) => u.team === 'enemy' && u.hp > 0);
    if (enemies.length) return false;
    g.state = 'WIN'; g._victoryProcessed = true;
    g.campaign.onSectorCleared(g.units.filter((u) => u.team === 'player' && u.hp > 0));
    return true;
  };
  g.checkLose = function () { calls.checkLose++; };
  let clearedWith = null;
  g.campaign = {
    onSectorCleared(survivors) { calls.cleared++; clearedWith = survivors; },
    onGameOver() { calls.gameOver++; },
  };

  const inst = attach(g);
  // 敵を全滅させる（sim 側で決着が立つ）
  inst.sim.soldiers().filter((s) => s.team === 'B').forEach((s) => {
    const internal = inst.sim._soldiers.get(String(s.id));
    internal.hp = 0; internal.state = 'down';
  });
  inst.sim.tick();
  check(!!inst.sim.result(), 'sim が決着を出す', JSON.stringify(inst.sim.result()));

  inst.update(T.TICK_MS);
  check(calls.checkWin > 0, '決着後に勝敗判定が呼ばれる', 'checkWin=' + calls.checkWin);
  check(calls.cleared === 1, 'セクター完了がキャンペーンへ届く', 'cleared=' + calls.cleared);
  check(g.units.filter((u) => u.team === 'enemy' && u.hp > 0).length === 0,
    '戦死者の hp が本編ユニットへ反映されている');
  // 生存者リストがそのまま promoteSurvivors（経験値・昇進・最大HP+30）の入力になる
  const expected = g.units.filter((u) => u.team === 'player' && u.hp > 0);
  check(Array.isArray(clearedWith) && clearedWith.length === expected.length
    && clearedWith.every((u) => u.team === 'player' && u.hp > 0),
    '生存者だけが昇進処理へ渡る',
    'got=' + (clearedWith ? clearedWith.length : 'null') + ' expected=' + expected.length);

  // 二重発火しない（毎フレーム update されるので必須）
  inst.update(T.TICK_MS);
  inst.update(T.TICK_MS);
  check(calls.cleared === 1, '決着処理は一度だけ走る', 'cleared=' + calls.cleared);

  // 決着したら自分を切り離す。残っていると次セクターへ繋ぎ直されず盤面が凍る
  check(SB.RtwpBattle.instance === null,
    '決着後にインスタンスが切り離される（次セクターが接続できる）',
    'instance=' + (SB.RtwpBattle.instance ? 'alive' : 'null'));

  // 次のセクター相当（新しい gameLogic）へ問題なく接続できる
  const g2 = makeGameLogic();
  const inst2 = SB.RtwpBattle.attach(g2);
  check(!!inst2 && inst2 !== inst && inst2.gameLogic === g2,
    '新しいセクターへ接続し直せる');
  check(!inst2._finished && !inst2.sim.result(),
    '新しいセクターは決着していない状態から始まる');
  SB.RtwpBattle.detach();
}

// 6b. 敗北側も同じ経路で伝わる
{
  const g = makeGameLogic();
  const calls = { checkLose: 0, gameOver: 0 };
  g.checkLose = function () {
    calls.checkLose++;
    if (!g.units.filter((u) => u.team === 'player' && u.hp > 0).length) g.campaign.onGameOver();
  };
  g.campaign = { onSectorCleared() {}, onGameOver() { calls.gameOver++; } };

  const inst = attach(g);
  inst.sim.soldiers().filter((s) => s.team === 'A').forEach((s) => {
    const internal = inst.sim._soldiers.get(String(s.id));
    internal.hp = 0; internal.state = 'down';
  });
  inst.sim.tick();
  inst.update(T.TICK_MS);
  check(calls.checkLose > 0, '自軍全滅で敗北判定が呼ばれる', 'checkLose=' + calls.checkLose);
  check(calls.gameOver === 1, 'ゲームオーバーがキャンペーンへ届く', 'gameOver=' + calls.gameOver);
  SB.RtwpBattle.detach();
}

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount === 0 ? 0 : 1);
