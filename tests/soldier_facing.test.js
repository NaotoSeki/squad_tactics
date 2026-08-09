/**
 * tests/soldier_facing.test.js -- 兵士が「向いている方向」の受入テスト
 *
 * 2026-08-03 ディレクター指摘:「バックステップで後退したり後ろ歩きしたり、
 * 移動先と方向、発砲している方角を向いてない」。原因は3つあり、いずれも
 * *向きの取得元* と *回頭速度* の問題だった:
 *
 *   1. 回頭が状況を問わず 45°/3tick 固定。180°の反転に0.9秒かかり、その間ずっと
 *      translate は進む = 0.75ヘックスぶん後ろ歩きしていた（実測）。
 *   2. 面制圧(TARGET_HEX)は engageTargetId が null なので、撃っている地点を
 *      向く根拠がどこにも無かった。
 *   3. 移動中の向きを画面のピクセル差分から取っていた。同じヘックスに味方が
 *      出入りすると散布オフセット(UnitView._calcUnitOffset)が組み替わり、その
 *      横滑りを「移動方向」と誤読して、その場で回れ右していた。
 *
 * No framework. Run with `node tests/soldier_facing.test.js`. Exits 0 on all-PASS.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}

// --- data.js / 描画クラスを sandbox へ ------------------------------------
const dataBox = { module: { exports: {} }, console: console };
dataBox.window = dataBox;
vm.createContext(dataBox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'), dataBox, { filename: 'data.js' });
vm.runInContext(';this.SIM_TUNING = SIM_TUNING; this.HEX_SIZE = HEX_SIZE;', dataBox, { filename: 'x' });

const box = { console: console, Math: Math, Date: Date, JSON: JSON };
box.window = box;
box.fetch = () => Promise.resolve({ ok: false });
box.SIM_TUNING = dataBox.SIM_TUNING;
box.HEX_SIZE = dataBox.HEX_SIZE;
vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'phaser_unit.js'), 'utf8')
  + ';this.__UnitView = UnitView;', box, { filename: 'phaser_unit.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'phaser_soldier_view.js'), 'utf8')
  + ';this.__SUV = SoldierUnitView; this.__dirFromFacing = soldierDirFromFacing;'
  + ' this.__dirFromDelta = soldierDirFromDelta;', box, { filename: 'phaser_soldier_view.js' });
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'asset/sprites/soldier/manifest.json'), 'utf8'));
box.SOLDIER_MANIFEST = manifest;

const SoldierUnitView = box.__SUV;
const dirFromFacing = box.__dirFromFacing;

const animKeys = new Set();
for (const n of Object.keys(manifest.actions)) {
  for (let d = 0; d < 8; d++) animKeys.add(`sold_${n}_${d}`);
}

/** 兵士はヘックスの辺沿いにしか動かないので、移動中に出る向きは6方向だけ。 */
const AXIAL = [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
               { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }];
const angDiff = (a, b) => Math.min((a - b + 8) % 8, (b - a + 8) % 8);

function makeRig(opts) {
  opts = opts || {};
  const tickRef = { _tick: 1000 };
  const v = Object.create(SoldierUnitView.prototype);
  v.scene = {
    anims: { exists: (k) => animKeys.has(k) },
    time: { now: 0 },
    sim: tickRef,
    map: { cover: () => 0 },
  };
  v.visuals = new Map(); v._faceDir = new Map(); v._oneShot = new Map();
  v._underFire = new Map(); v._corpses = [];
  const spr = {
    texture: { key: 'sold_stand_idle' },
    anims: { currentAnim: null, isPlaying: false, setProgress() {}, currentFrame: null },
    _soldierAnimHash: 3,
    play(k) { this.texture = { key: 'sold_' + /^sold_(.+)_[0-7]$/.exec(k)[1] }; },
    setOrigin() {}, setPosition() {},
  };
  const visual = {
    sprite: spr, container: { x: 0, y: 0 },
    lastDx: opts.lastDx || 0, lastDy: opts.lastDy || 0,
    postureLv: opts.postureLv != null ? opts.postureLv : 0, dispDir: opts.dispDir,
  };
  return { view: v, visual, spr, tickRef };
}

/** 移動中の1フレームを回し、表示方向を返す */
function stepMoving(rig, u, isMoving) {
  rig.view.updateInfantryAnim(rig.visual, u, isMoving !== false);
  return rig.visual.dispDir;
}

// --- F0: 方向計算がシートの実際の行順と一致すること ------------------------
// 検証の鎖: tests/test_soldier_dir_order.py が manifest.dirOrder を**実シートの
// ピクセル**に突き合わせ、ここが soldierDirFromDelta を manifest.dirOrder に
// 突き合わせる。ここで期待値を直書きすると自己整合するだけで、2026-08-03 の
// 「撃ち合う二人が互いに逆を向く」（行順が鏡像かつ45°ずれ）を素通しする。
{
  const dirOrder = manifest.dirOrder;
  const screenVec = { S: [0, 1], SE: [1, 1], E: [1, 0], NE: [1, -1],
                      N: [0, -1], NW: [-1, -1], W: [-1, 0], SW: [-1, 1] };
  const bad = dirOrder.map((name, row) => {
    const v = screenVec[name];
    const got = box.__dirFromDelta(v[0], v[1]);
    return got === row ? null : `${name}: 期待row${row} 実際row${got}`;
  }).filter(Boolean);
  check('F0a 画面デルタ→行 が manifest.dirOrder と一致する', bad.length === 0, bad.join(' / '));

  // 軸座標(sim の facing)経由も同じ行になること
  const axialFor = { E: { q: 1, r: 0 }, W: { q: -1, r: 0 },
                     SE: { q: 0, r: 1 }, NW: { q: 0, r: -1 },
                     SW: { q: -1, r: 1 }, NE: { q: 1, r: -1 } };
  const badAx = Object.entries(axialFor).map(([name, f]) => {
    const row = dirOrder.indexOf(name);
    const got = dirFromFacing(f);
    return got === row ? null : `${name}: 期待row${row} 実際row${got}`;
  }).filter(Boolean);
  check('F0b 軸座標→行 も一致する（hexToPx と同じ射影）', badAx.length === 0, badAx.join(' / '));

  // 行→画面ベクトル（遮蔽の身乗り出しに使う）が逆写像になっていること
  const view0 = makeRig({ dispDir: 0 }).view;
  const badInv = dirOrder.map((name, row) => {
    const want = screenVec[name];
    const wl = Math.hypot(want[0], want[1]);
    const got = view0._dirToScreenVec(row);
    const dot = (want[0] / wl) * got.x + (want[1] / wl) * got.y;
    return dot > 0.99 ? null : `${name}(row${row}): dot=${dot.toFixed(2)}`;
  }).filter(Boolean);
  check('F0c 行→画面ベクトルが逆写像になっている（乗り出し方向）',
    badInv.length === 0, badInv.join(' / '));
}

// --- F1: 移動中に後ろ歩きが1フレームも発生しないこと -----------------------
{
  let worstLag = 0, worstCase = null;
  for (const f of AXIAL) {
    const to = dirFromFacing(f);
    for (let from = 0; from < 8; from++) {
      const rig = makeRig({ dispDir: from,
        lastDx: Math.sqrt(3) * (f.q + f.r / 2) * 10, lastDy: 1.5 * f.r * 10 });
      const u = { id: 'a', q: 0, r: 0,
        _sim: { id: 'a', state: 'move', suppression: 0, stepMode: 'walk', facing: f } };
      // 歩き出しの最初のフレームで既に揃っていること
      const shown = stepMoving(rig, u);
      const lag = angDiff(shown, to);
      if (lag > worstLag) { worstLag = lag; worstCase = { from, to, shown }; }
    }
  }
  check('F1a 歩き出しの1フレーム目で移動方向を向く（後ろ歩きゼロ）',
    worstLag === 0, JSON.stringify(worstCase));

  // 経路の途中で向きが変わっても同じ（最悪ケースを総当たり）
  let maxFramesMisaligned = 0;
  for (const f0 of AXIAL) {
    for (const f1 of AXIAL) {
      const rig = makeRig({ dispDir: dirFromFacing(f0) });
      const u = { id: 'a', q: 0, r: 0,
        _sim: { id: 'a', state: 'move', suppression: 0, stepMode: 'walk', facing: f0 } };
      stepMoving(rig, u);
      u._sim.facing = f1;                      // 次の1マスで曲がった
      rig.visual.lastDx = Math.sqrt(3) * (f1.q + f1.r / 2) * 10;
      rig.visual.lastDy = 1.5 * f1.r * 10;
      let n = 0;
      const to = dirFromFacing(f1);
      while (angDiff(stepMoving(rig, u), to) >= 2 && n < 50) { n++; rig.tickRef._tick++; }
      maxFramesMisaligned = Math.max(maxFramesMisaligned, n);
    }
  }
  check('F1b 経路の途中で曲がっても、90°以上ズレたまま歩くフレームが無い',
    maxFramesMisaligned === 0, 'frames=' + maxFramesMisaligned);
}

// --- F2: 静止時の45°ステップ回頭は残す（演出として意図されたもの）----------
{
  const rig = makeRig({ dispDir: 0 });
  const u = { id: 'a', q: 0, r: 0,
    _sim: { id: 'a', state: 'idle', suppression: 0, stepMode: 'walk', facing: null } };
  rig.view._faceDir.set('a', 4);            // 180°反対を向かせる
  const seen = [];
  for (let i = 0; i < 40; i++) {
    seen.push(stepMoving(rig, u, false));
    rig.tickRef._tick++;
  }
  const uniq = [...new Set(seen)];
  check('F2a 静止時は一気に振り向かず段階的に回る', uniq.length > 2, 'seen=' + uniq.join(','));
  check('F2b 最終的には目標方向へ到達する', seen[seen.length - 1] === 4,
    'last=' + seen[seen.length - 1]);
  // 1フレームで2段以上飛ばない
  let jump = 0;
  for (let i = 1; i < seen.length; i++) jump = Math.max(jump, angDiff(seen[i], seen[i - 1]));
  check('F2c 静止時は45°ずつ刻む', jump <= 1, 'maxJump=' + jump);
}

// --- F3: 射撃中は即時スナップ（狙う相手へ即応する）------------------------
{
  const rig = makeRig({ dispDir: 0 });
  const target = { container: { x: -100, y: 0 } };   // 真西
  rig.view.visuals.set('t', target);
  const u = { id: 'a', q: 0, r: 0,
    _sim: { id: 'a', state: 'engage', suppression: 0, engageTargetId: 't', facing: null } };
  check('F3 射撃中は1フレームで対象を向く',
    stepMoving(rig, u, false) === box.__dirFromDelta(-100, 0));
}

// --- F4: 面制圧は「撃っている地点」を向く（engageTargetId が無い）----------
{
  for (const f of AXIAL) {
    const rig = makeRig({ dispDir: (dirFromFacing(f) + 4) % 8 });   // 真逆から始める
    const u = { id: 'a', q: 5, r: 5, _sim: { id: 'a', state: 'engage', suppression: 0,
      engageTargetId: null, engageHex: { q: 5 + f.q * 3, r: 5 + f.r * 3 }, facing: null } };
    const shown = stepMoving(rig, u, false);
    if (shown !== dirFromFacing(f)) {
      check('F4 面制圧で撃っている地点を向く', false,
        `hex dir=${dirFromFacing(f)} shown=${shown}`);
      break;
    }
  }
  if (fail === 0) check('F4 面制圧で撃っている地点を向く（全6方向）', true);
}

// --- F5: 個体の標的があればそちらが優先（面制圧より狙撃が上位）-------------
{
  const rig = makeRig({ dispDir: 0 });
  rig.view.visuals.set('t', { container: { x: 0, y: 100 } });   // 画面下 = S
  const u = { id: 'a', q: 5, r: 5, _sim: { id: 'a', state: 'engage', suppression: 0,
    engageTargetId: 't', engageHex: { q: 8, r: 5 }, facing: null } };
  check('F5 個体の標的が面制圧hexより優先される',
    stepMoving(rig, u, false) === box.__dirFromDelta(0, 100));
}

// --- F5a: PAUSE中の未配達命令は古い移動・射撃方向より優先 -----------------
{
  const west = { q: -1, r: 0 };
  const east = { q: 1, r: 0 };
  const rig = makeRig({ dispDir: dirFromFacing(east), lastDx: 100, lastDy: 0 });
  const u = { id: 'a', q: 5, r: 5,
    _rtwpPendingTargetHex: { q: 2, r: 5 }, _rtwpPendingTargetMode: 'move',
    _sim: { id: 'a', state: 'move', suppression: 0, stepMode: 'walk', facing: east,
      engageTargetId: null, engageHex: null } };
  check('F5a 予約hexは配達前でも古い移動方向より優先される',
    stepMoving(rig, u, true) === dirFromFacing(west));

  const rig2 = makeRig({ dispDir: dirFromFacing(east) });
  const u2 = { id: 'b', q: 5, r: 5,
    _rtwpPendingTargetHex: { q: 2, r: 5 }, _rtwpPendingTargetMode: 'suppress',
    _sim: { id: 'b', state: 'idle', suppression: 0, facing: east,
      engageTargetId: null, engageHex: null } };
  check('F5a 予約制圧hexも配達前から射撃方向へ向く',
    stepMoving(rig2, u2, false) === dirFromFacing(west));

  const northEast = { q: 1, r: -1 };
  const rig3 = makeRig({ dispDir: dirFromFacing(west) });
  const u3 = { id: 'c', q: 5, r: 5,
    _rtwpPendingTargetHex: { q: 2, r: 5 },
    _rtwpPendingFiringHex: { q: 8, r: 2 },
    _rtwpPendingTargetMode: 'suppress',
    _sim: { id: 'c', state: 'idle', suppression: 0, facing: west,
      engageTargetId: null, engageHex: null } };
  check('F5a 接近制圧は目標hexでなく予定射撃位置を向く',
    stepMoving(rig3, u3, false) === dirFromFacing(northEast));
}

// --- F6: 散布オフセットの横滑りでは回れ右しない（バックステップの正体）-----
{
  const east = { q: 1, r: 0 };
  const rig = makeRig({ dispDir: dirFromFacing(east) });
  const u = { id: 'a', q: 0, r: 0,
    _sim: { id: 'a', state: 'move', suppression: 0, stepMode: 'walk', facing: east } };
  stepMoving(rig, u);
  // 味方が同じヘックスへ入って散布オフセットが組み替わり、画面上は西へ滑った。
  // sim の facing は東のまま = 実際に歩いている向きは東
  rig.visual.lastDx = -40; rig.visual.lastDy = 0;
  const shown = stepMoving(rig, u);
  check('F6a 画面の横滑りに引きずられて振り向かない',
    shown === dirFromFacing(east), `shown=${shown} east=${dirFromFacing(east)}`);

  // 到着後（movePath 消化済み・facing はそのまま）に寄り直しても向きは変わらない
  const rig2 = makeRig({ dispDir: dirFromFacing(east) });
  const u2 = { id: 'b', q: 0, r: 0,
    _sim: { id: 'b', state: 'idle', suppression: 0, stepMode: 'walk', facing: east } };
  stepMoving(rig2, u2);
  rig2.visual.lastDx = -40; rig2.visual.lastDy = 0;
  let last = null;
  for (let i = 0; i < 20; i++) { last = stepMoving(rig2, u2); rig2.tickRef._tick++; }
  check('F6b 到着後の寄り直しでも回れ右しない',
    last === dirFromFacing(east), `shown=${last}`);
}

// --- F5b: 本編の小数IDでも標的の visual を引けること ------------------------
// 本編のユニットIDは Math.random() 由来の小数で、sim へは String(id) で渡る。
// visuals のキーは数値のままなので、旧実装の /^\d+$/ フォールバックでは小数が
// 弾かれ、「狙っている相手を向き続ける」分岐が本編で一度も成立していなかった。
{
  const idNum = 0.31583097639978785;
  const rig = makeRig({ dispDir: 0 });
  rig.view.visuals.set(idNum, { container: { x: -100, y: 0 } });   // 真西
  const u = { id: 0.87, q: 0, r: 0, _sim: { id: 'a', state: 'engage', suppression: 0,
    engageTargetId: String(idNum), facing: null } };               // sim は文字列で持つ
  check('F5b 小数IDの標的でも向きを引ける（本編のID形式）',
    stepMoving(rig, u, false) === box.__dirFromDelta(-100, 0),
    'shown=' + rig.visual.dispDir);

  // 文字列キーで登録されている経路（sim_battle.html 形式）も従来どおり
  const rig2 = makeRig({ dispDir: 0 });
  rig2.view.visuals.set('A1', { container: { x: 0, y: -100 } });   // 真北
  const u2 = { id: 'A0', q: 0, r: 0, _sim: { id: 'A0', state: 'engage', suppression: 0,
    engageTargetId: 'A1', facing: null } };
  check('F5c 文字列IDの経路も従来どおり引ける',
    stepMoving(rig2, u2, false) === box.__dirFromDelta(0, -100));
}

// --- F6c: 倒れた兵は滑っても歩かない（散布オフセットの組み替えの副作用）----
{
  const east = { q: 1, r: 0 };
  // 姿勢遷移(stand_to_kneel 等)を先に消化させないと action の分岐まで到達しない。
  // 目標姿勢から始め、遷移が終わるまで回してから最終的なアクションを見る。
  const played = (state, hp) => {
    const prone = state === 'incap' || hp === 0;
    const rig = makeRig({ dispDir: dirFromFacing(east), lastDx: -40, lastDy: 0,
      postureLv: prone ? 2 : 0 });
    const u = { id: 'c', q: 0, r: 0, hp: hp == null ? 100 : hp,
      _sim: { id: 'c', state: state, suppression: 0, stepMode: 'walk', facing: east,
        prone: prone } };
    for (let i = 0; i < 6; i++) {                        // 画面上は滑り続けている
      rig.view.updateInfantryAnim(rig.visual, u, true);
      rig.spr.anims.currentAnim = null;                  // 遷移の完走を待たせない
      rig.tickRef._tick++;
    }
    return rig.spr.texture.key;
  };
  check('F6c 行動不能(incap)の兵は滑っても匍匐アニメを再生しない',
    !/_forward$/.test(played('incap')), 'key=' + played('incap'));
  check('F6d 生きて動いている兵は従来どおり移動アニメを出す',
    /_forward$|_run$/.test(played('move')), 'key=' + played('move'));
  check('F6e hp0 の兵も歩かない', !/_forward$/.test(played('idle', 0)), 'key=' + played('idle', 0));
}

// --- F7: ターン制本編（sim スナップショット無し）は従来どおり画面差分 -------
{
  const rig = makeRig({ dispDir: 0, lastDx: -100, lastDy: 0 });
  const u = { id: 'a', q: 0, r: 0, stance: 'stand' };   // _sim なし
  const seen = [];
  for (let i = 0; i < 30; i++) { seen.push(stepMoving(rig, u)); rig.tickRef._tick++; }
  check('F7 sim を持たない経路はピクセル差分で向く（従来動作）',
    seen[seen.length - 1] === box.__dirFromDelta(-100, 0), 'last=' + seen[seen.length - 1]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
