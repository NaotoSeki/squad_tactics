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
    offsetWidth: 0, offsetHeight: 0,   // placeMenu の画面端判定用（既定は「測れない」）
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

  // 現在地から射線が通らなくても、射撃位置へ安全に接近できるなら複合命令になる。
  issued.length = 0;
  const blocked = { q: foe.q, r: foe.r };
  if (!inst.map.hasLos({ q: me.q, r: me.r }, blocked)) {
    g.selectedUnit = me;
    dom._key('S');
    g.handleClick(blocked, 0, 0);
    const approach = issued.find((o) => o.type === 'SUPPRESS_APPROACH');
    check(!!approach && approach.payload.hex.q === blocked.q
      && approach.payload.hex.r === blocked.r && approach.payload.path.length > 0,
    '射線外の地点でも射撃位置があれば接近→制圧を発行する',
    'issued=' + issued.map((o) => o.type).join(','));
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

// ===========================================================================
// 矩形選択（左ドラッグ）-> 単一選択と同じメニューを、選んだ全員へ適用する
// ===========================================================================
{
  const g = makeGameLogic();
  const dom = makeDom();
  SB.document = dom;
  const inst = attach(g);
  inst.installUi();
  const players = g.units.filter((u) => u.team === 'player');
  check(players.length >= 2, '前提: 自軍が2名以上いる');
  const menu = dom.getElementById('command-menu');

  // DOMスタブの innerHTML='' は children を消さないので、毎回手で空にする
  const reset = () => { menu.children.length = 0; };
  // 見出し(cmd-head)を除いた**命令ボタンだけ**を比べる。要点は語彙が増えないこと。
  const labels = () => menu.children
    .filter((c) => c.className.indexOf('cmd-btn') >= 0).map((c) => c.textContent);
  reset();
  inst.showSoldierMenu(players[0], 10, 10);
  const single = labels();
  check(g.selectedUnits === null, '単一選択で開くと矩形の集合が解ける');
  reset();
  inst.showSquadSelectionMenu(players, 10, 10);
  const multi = labels();
  check(JSON.stringify(single) === JSON.stringify(multi),
    '複数選択でも命令の並びは単一選択とまったく同じ',
    JSON.stringify(single) + ' vs ' + JSON.stringify(multi));

  const head = menu.children.filter((c) => c.className === 'cmd-head');
  check(head.length === 1 && menu.children[0] === head[0]
    && head[0].textContent === players.length + '人を選択',
    '先頭の見出しに選択人数が出る',
    JSON.stringify(menu.children.map((c) => c.textContent)));
  check(head.length === 1 && !head[0].onclick, '見出しは押せない（命令ではない）');
  check(!!g.selectedUnits && g.selectedUnits.length === players.length,
    '選択表示用の集合が gameLogic 側にも入る', JSON.stringify(g.selectedUnits));

  reset();
  inst.showSquadSelectionMenu(players, 10, 10);
  const moveBtn = menu.children.find((c) => c.onclick && /移動/.test(c.textContent));
  check(!!moveBtn, '移動が選べる');
  moveBtn.onclick();
  check(inst.pendingAction && inst.pendingAction.unitIds
    && inst.pendingAction.unitIds.length === players.length,
    '複数選択の対象待ちが全員ぶん積まれる', JSON.stringify(inst.pendingAction));

  players.forEach((u) => { u._startQ = u.q; u._startR = u.r; });
  // 到達可能なマスを選ぶ（島の外や建物だと runAction が経路を作れず false を返す）
  const s0 = inst.sim.getSoldier(String(players[0].id));
  const cands = [{ q: s0.q + 2, r: s0.r }, { q: s0.q - 2, r: s0.r },
                 { q: s0.q, r: s0.r + 2 }, { q: s0.q, r: s0.r - 2 }];
  const dest = cands.find((h) => isFinite(inst.map.moveCost(h, h))) || cands[0];
  inst.consumePendingAction(players[0], null, dest);
  // 検証したいのは「1回のクリックが全員へ配られたか」。実際に何マス進めるかは
  // 各自の経路次第（塞がっていて動けない兵も居る）なので、配布の方を見る。
  const ordered = players.filter((u) => u._rtwpOrderedPath && u._rtwpOrderedPath.length);
  check(ordered.length === players.length,
    '1回のクリックで選択した全員へ移動命令が配られる',
    ordered.length + '/' + players.length);
  // 伝達遅延ぶん回して、実際に動き出すことも確かめる
  for (let i = 0; i < 300; i++) inst.sim.tick();
  const moving = players.filter((u) => {
    const s = inst.sim.getSoldier(String(u.id));
    return s && (s.state === 'move' || (s.movePath && s.movePath.length)
      || u.q !== u._startQ || u.r !== u._startR);
  });
  check(moving.length > 0, '配られた命令が実際に実行される',
    moving.length + '/' + players.length);
  check(inst.pendingAction === null, '消費後は対象待ちが解除される');

  reset();
  g.handleMarqueeSelect(players, 10, 10);
  check(!!g.selectedUnits && g.selectedUnits.length === players.length
    && players.indexOf(g.selectedUnit) >= 0,
    '矩形選択の経路でも選択集合が gameLogic に載る');

  // hp が残っているのに何も押せない兵が居る、という実プレイ報告（2026-08-04）。
  // 原因は state='incap'/'rout' で、可否は**代表1名**の文脈で決まるため、矩形の
  // 先頭がそれだと分隊ごと灰色になっていた。
  //
  // getSoldier() はスナップショットを返すので、状態は実体側へ入れる。
  // ここまでで sim を300tick進めてあるため、全員の状態を明示的に置き直す。
  const live = (u) => inst.sim._soldiers.get(String(u.id));
  const prevStates = players.map((u) => live(u).state);
  const cmdBtns = () => menu.children.filter(
    (c) => c.className.indexOf('cmd-btn') >= 0 && c.textContent !== 'CANCEL');
  const armed = () => cmdBtns().filter((c) => !!c.onclick);

  // 300tick の間に撃たれて hp が落ちている兵が居るので、そこも戻す
  players.forEach((u) => { u.hp = 100; live(u).hp = 100; live(u).state = 'idle'; });
  live(players[0]).state = 'incap';
  reset();
  inst.showSquadSelectionMenu(players, 10, 10);
  check(armed().length > 0, '先頭が行動不能でも分隊メニューは押せる',
    JSON.stringify(cmdBtns().map((c) => c.className + ':' + c.textContent)));
  check(inst._firstActionable(players) !== players[0],
    '可否の代表には動ける兵が立つ', String(inst._firstActionable(players).id));

  // 全員が行動不能なら、押せない理由そのものを見出しに出す
  players.forEach((u) => { live(u).state = 'incap'; });
  reset();
  inst.showSoldierMenu(players[0], 10, 10);
  const why = menu.children.find((c) => c.className === 'cmd-head');
  check(!!why && /行動不能/.test(why.textContent),
    '押せない時は理由が見出しに出る', why ? why.textContent : '(見出しなし)');
  check(armed().length === 0, '理由が出ている時は実際にどの行動も押せない',
    JSON.stringify(cmdBtns().map((c) => c.className + ':' + c.textContent)));
  check(menu.children.some((c) => c.textContent === 'CANCEL' && c.onclick),
    'CANCEL だけは常に押せる');
  players.forEach((u, i) => { live(u).state = prevStates[i]; });

  reset();
  inst.showSquadSelectionMenu([players[0]], 10, 10);
  check(!menu.children.some((c) => c.className === 'cmd-head'),
    '1名なら見出しは出ない');
  const one = menu.children.find((c) => c.onclick && /移動/.test(c.textContent));
  one.onclick();
  check(inst.pendingAction && !inst.pendingAction.unitIds,
    '1名だけの矩形選択は従来どおり単体として扱う');
  inst.pendingAction = null;
  SB.RtwpBattle.detach();
}

// ===========================================================================
// 対象ドラッグ: 複数hexへ最短配分 / ユニット直指定は集中
// ===========================================================================
{
  const g = makeGameLogic();
  const dom = makeDom();
  SB.document = dom;
  const inst = attach(g);
  inst.installUi();
  const players = g.units.filter((u) => u.team === 'player');
  g.selectedUnit = players[0];

  const open = [];
  for (let q = 0; q < inst.map._W; q++) {
    for (let r = 0; r < inst.map._H; r++) {
      const h = { q, r };
      if (isFinite(inst.map.moveCost(h, h))) open.push(h);
    }
  }
  const fullPathTo = (u, h) => {
    const path = inst.actionContext(u, null, h).path || [];
    const last = path[path.length - 1];
    return last && last.q === h.q && last.r === h.r;
  };
  const h0 = open.filter((h) => fullPathTo(players[0], h))
    .sort((a, b) => inst.map.dist(players[0], a) - inst.map.dist(players[0], b))
    .find((h) => inst.map.dist(players[0], h) >= 2);
  const h1 = open.filter((h) => h0 && (h.q !== h0.q || h.r !== h0.r) && fullPathTo(players[1], h))
    .sort((a, b) => inst.map.dist(players[1], a) - inst.map.dist(players[1], b))
    .find((h) => inst.map.dist(players[1], h) >= 2);
  check(!!h0 && !!h1, '複数移動の検証用に到達可能な2地点がある');

  inst.setPaused(true);
  inst.armActionForUnits('MOVE', players);
  const movePlan = inst.planPendingTargets([], [h0, h1], false);
  const assignedCost = movePlan.assignments.reduce((sum, a) => sum + inst.map.dist(a.unit, a.hex), 0);
  const validMoveCost = (u, h) => SB.SimActions.issue('MOVE', inst.actionContext(u, null, h)).length
    ? inst.map.dist(u, h) : Infinity;
  const swappedCost = validMoveCost(players[0], h1) + validMoveCost(players[1], h0);
  const straightCost = validMoveCost(players[0], h0) + validMoveCost(players[1], h1);
  check(movePlan.assignments.every((a) => a.valid)
    && assignedCost === Math.min(swappedCost, straightCost),
    '複数hexは実行可能な組み合わせの中で総移動距離を最小化する',
    `${assignedCost} vs min(${straightCost},${swappedCost})`);
  check(movePlan.targetKind === 'hex' && movePlan.hexes.length === 2,
    '地面ドラッグのプレビューはhex対象として2地点を保持する');
  check(inst.consumePendingTargets([], [h0, h1], false) && inst.pendingAction === null,
    '複数hexを確定すると割り当て済み移動命令を消費する');
  const moveEnds = players.map((u) => {
    const path = u._rtwpOrderedPath || [];
    const last = path[path.length - 1];
    return last ? last.q + ',' + last.r : '';
  }).sort();
  check(JSON.stringify(moveEnds) === JSON.stringify([h0.q + ',' + h0.r, h1.q + ',' + h1.r].sort()),
    '各兵の移動命令は別々の選択hexへ届く', JSON.stringify(moveEnds));
  check(players.every((u) => {
    const path = u._rtwpOrderedPath || [];
    const end = path[path.length - 1];
    return end && u._rtwpPendingTargetHex
      && u._rtwpPendingTargetHex.q === end.q && u._rtwpPendingTargetHex.r === end.r
      && u._rtwpPendingTargetMode === 'move';
  }), '一括移動の確定直後から各兵の表示用目標hexが割当先を指す');

  inst.armActionForUnits('SUPPRESS_HEX', players);
  const usedSuppressHexes = new Set();
  const suppressDestinations = [];
  players.forEach((u) => {
    const h = open.find((candidate) => {
      const key = candidate.q + ',' + candidate.r;
      return !usedSuppressHexes.has(key)
        && SB.SimActions.issue('SUPPRESS_HEX', inst.actionContext(u, null, candidate)).length;
    });
    if (h) {
      suppressDestinations.push(h);
      usedSuppressHexes.add(h.q + ',' + h.r);
    }
  });
  const suppressPlan = inst.planPendingTargets([], suppressDestinations, false);
  check(!!suppressPlan, '複数制圧の検証用に射撃可能な2地点がある');
  check(suppressDestinations.length === players.length
    && suppressPlan.assignments.every((a) => a.valid),
    '各兵へ割り当て可能な制圧地点が揃う');
  check(inst.consumePendingTargets([], suppressDestinations, false),
    'PAUSE中に複数hexへの制圧命令を確定できる');
  check(players.every((u) => {
    const assigned = suppressPlan.assignments.find((a) => a.unit === u);
    return assigned && u._rtwpPendingTargetHex
      && u._rtwpPendingTargetHex.q === assigned.hex.q
      && u._rtwpPendingTargetHex.r === assigned.hex.r
      && u._rtwpPendingTargetMode === 'suppress';
  }), '一括制圧の確定直後から各兵の表示用目標hexが割当先を指す');

  // 2体目の敵を盤上へ足し、面指定なら分散、姿を直接押した時は集中することを確認。
  // A single squad suppression target is intentionally a cheap marker while
  // hovering: route planning happens after the player commits the order.
  inst.armActionForUnits('SUPPRESS_HEX', players);
  const simpleSuppressPreview = inst.previewPendingTargets([], [suppressDestinations[0]], false);
  check(simpleSuppressPreview && simpleSuppressPreview.simplePreview
    && simpleSuppressPreview.assignments.length === 0,
    'single-target squad suppression preview avoids per-soldier route plans');
  inst.pendingAction = null;
  g.targetPreview = null;

  inst.armActionForUnits('MOVE', players);
  const simpleMovePreview = inst.previewPendingTargets([], [h0, h1], false);
  check(simpleMovePreview && simpleMovePreview.simplePreview
    && simpleMovePreview.assignments.length === 0
    && simpleMovePreview.hexes.length === 1,
    'mass movement preview uses one intent marker instead of route assignment');
  inst.pendingAction = null;
  g.targetPreview = null;

  const foe0 = g.units.find((u) => u.team === 'enemy');
  const foeHex = open.find((h) => h.q !== foe0.q || h.r !== foe0.r);
  const foe1 = mkUnit('E1', 'enemy', foeHex);
  g.units.push(foe1);
  inst.registerUnit(foe1);
  inst.armActionForUnits('ASSAULT', players);
  const simpleAssaultPreview = inst.previewPendingTargets([foe0], [{ q: foe0.q, r: foe0.r }], true);
  check(simpleAssaultPreview && simpleAssaultPreview.simplePreview
    && simpleAssaultPreview.assignments.length === 0
    && simpleAssaultPreview.hoverUnit === foe0,
    'mass assault preview uses a target marker instead of per-soldier arrows');
  const areaPlan = inst.planPendingTargets([], [
    { q: foe0.q, r: foe0.r }, { q: foe1.q, r: foe1.r },
  ], false);
  check(new Set(areaPlan.assignments.map((a) => a.target && a.target.id)).size === 2,
    '強襲の複数hex指定は複数の敵へ攻撃兵を分散する');

  const directPlan = inst.planPendingTargets([foe0], [{ q: foe0.q, r: foe0.r }], true);
  check(directPlan.targetKind === 'unit'
    && directPlan.assignments.every((a) => a.target && a.target.id === foe0.id),
    'ユニットを直接選ぶと選択兵全員がその1体を対象にする');
  inst.consumePendingTargets([foe0], [{ q: foe0.q, r: foe0.r }], true);
  check(players.every((u) => u._rtwpPendingTargetId === foe0.id),
    'ユニット直指定の強襲命令が全選択兵へ届く');
  check(players.every((u) => !u._rtwpPendingTargetHex),
    'ユニット直指定へ切り替えると以前の予約hexを残さない');
  check(g.targetPreview === null, '確定後は対象プレビューを消す');

  inst.armActionForUnits('MOVE', players);
  const hover = g.handleTargetHover(h0, null);
  check(hover && hover.targetKind === 'hex' && g.targetPreview === hover,
    'hexホバーだけでクリック対象と割り当てプレビューが作られる');
  g.handleRightClick();
  check(g.targetPreview === null, '取り消しでホバープレビューも消える');
  SB.RtwpBattle.detach();
}

// ===========================================================================
// メニューが画面外へ埋もれない（画面下端・右端でクリックした時）
// ===========================================================================
{
  const P = SB.RtwpBattle.placeMenu;
  const el = () => ({ style: {}, offsetWidth: 140, offsetHeight: 180 });
  const VW = 1280, VH = 720, M = 8;
  const prevW = SB.innerWidth, prevH = SB.innerHeight;
  SB.innerWidth = VW; SB.innerHeight = VH;

  const mid = P(el(), 400, 300);
  check(mid.left === 420 && mid.top === 250,
    '画面中央では従来どおりカーソルの右上に出る', JSON.stringify(mid));

  const bottom = P(el(), 400, VH - 10);
  check(bottom.top + 180 <= VH - M && bottom.top >= M,
    '画面下端でも下辺が画面内に収まる',
    'top=' + bottom.top + ' 下辺=' + (bottom.top + 180) + ' 画面高=' + VH);

  const right = P(el(), VW - 10, 300);
  check(right.left + 140 <= VW - M && right.left >= M,
    '画面右端でも右辺が画面内に収まる',
    'left=' + right.left + ' 右辺=' + (right.left + 140) + ' 画面幅=' + VW);
  check(right.left < VW - 10, '右端では カーソルの左側へ返す', 'left=' + right.left);

  const corner = P(el(), VW - 2, VH - 2);
  check(corner.left >= M && corner.left + 140 <= VW - M
    && corner.top >= M && corner.top + 180 <= VH - M,
    '右下の角でも全体が画面内に収まる', JSON.stringify(corner));

  const topLeft = P(el(), 4, 4);
  check(topLeft.left >= M && topLeft.top >= M,
    '左上でも画面外へ出ない', JSON.stringify(topLeft));

  // 寸法が測れない時（display:none のまま等）は従来位置を壊さない
  const unmeasured = P({ style: {}, offsetWidth: 0, offsetHeight: 0 }, 400, 300);
  check(unmeasured.left === 420 && unmeasured.top === 250,
    '寸法が測れない時は従来位置のまま', JSON.stringify(unmeasured));

  SB.innerWidth = prevW; SB.innerHeight = prevH;
}

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount === 0 ? 0 : 1);
