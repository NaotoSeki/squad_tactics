/**
 * tests/sim_fire_modes.test.js -- 1トリガーの弾数モデル（単射 / バースト / 掃射）
 *
 * なぜ要るか（2026-08-04 ディレクター指摘「Autoのサウンドはほぼマガジン撃ち尽くし位」）:
 * 旧実装は1トリガーの消費弾数が WPNS.burst 固定で、鳴らすクリップは fireMode が
 * 'suppress' かどうかだけで auto/burst を選んでいた。この2つは別々の根拠で動いて
 * いたので、**構造的に一致し得なかった** — 制圧射撃の兵は2発しか消費しないのに
 * 30発ぶんの auto クリップを鳴らし続けていた。
 *
 * 直した後の契約は次の3つで、このファイルがその門になる:
 *   1. 撃ち方は single/burst/auto の三段で、**既定はバースト**（陸軍のマニュアル）
 *   2. 掃射は「同一hexに複数の敵」という条件付きの例外で、弾倉を一気に燃やす
 *   3. 鳴らすクリップは fireMode ではなく**実発射数**から引く
 *      ——シムの roundsFired と音源の実測発射数(Sfx.variantRounds)を突合する
 *
 * No framework. Run with `node tests/sim_fire_modes.test.js`.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const { SimCore, mulberry32, toSimWeapon } = require(path.join(ROOT, 'sim_core.js'));

// data.js はブラウザ向け（window 経由のグローバル）。vm で読んで WPNS/SIM_TUNING を取る。
function loadDataJs() {
  const code = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
  const sandbox = { module: { exports: {} }, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;this.WPNS = WPNS; this.SIM_TUNING = SIM_TUNING;\n',
    sandbox, { filename: 'data.js' });
  return sandbox;
}
const dataSandbox = loadDataJs();
const WPNS = dataSandbox.WPNS;
const SIM_TUNING = dataSandbox.SIM_TUNING;

// Sfx もブラウザ想定のままサンドボックスで読む（音を鳴らさず解決だけ使う）。
function loadSfx() {
  const sandbox = {
    console: console, Math: Math, Date: Date, Object: Object,
    document: { addEventListener() {}, hidden: false, visibilityState: 'visible' },
    AudioContext: function () { throw new Error('AudioContext must not start in this test'); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'phaser_sound.js'), 'utf8'),
    sandbox, { filename: 'phaser_sound.js' });
  return sandbox.Sfx;
}
const Sfx = loadSfx();

let passCount = 0;
let failCount = 0;
const failures = [];
function check(cond, label) {
  if (cond) { passCount++; console.log('PASS: ' + label); }
  else { failCount++; failures.push(label); console.log('FAIL: ' + label); }
}

function makeGridMap(opts) {
  opts = opts || {};
  const coverAt = opts.coverAt || (() => 0);
  return {
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    },
    hasLos: () => true,
    cover: (hex) => coverAt(hex),
    moveCost: () => 1,
    neighbors: (hex) => [
      { q: hex.q + 1, r: hex.r }, { q: hex.q - 1, r: hex.r },
      { q: hex.q, r: hex.r + 1 }, { q: hex.q, r: hex.r - 1 },
      { q: hex.q + 1, r: hex.r - 1 }, { q: hex.q - 1, r: hex.r + 1 },
    ],
  };
}

/** 射手1名 + 指定hexへ敵 n 名。SHOT を集めて返せる形で組む。 */
function makeScene(opts) {
  const o = opts || {};
  const sim = new SimCore({
    map: makeGridMap({ coverAt: () => o.cover || 0 }),
    tuning: SIM_TUNING,
    rng: mulberry32(o.seed != null ? o.seed : 1),
  });
  const weapon = toSimWeapon(o.code || 'thompson', WPNS[o.code || 'thompson'], SIM_TUNING);
  sim.addSoldier({
    id: 'S', team: 'A', q: 0, r: 0, weapon: weapon,
    ammo: { mags: o.mags != null ? o.mags : 4 }, skill: 1.0, facing: { q: 1, r: 0 },
  });
  const foes = [];
  for (let i = 0; i < (o.foes != null ? o.foes : 1); i++) {
    const id = 'E' + i;
    // **同一hexに重ねる**のが掃射の条件。座標をずらさないこと。
    sim.addSoldier({
      id: id, team: 'B', q: o.dist != null ? o.dist : 3, r: 0,
      weapon: toSimWeapon('m1', WPNS.m1, SIM_TUNING),
      ammo: { mags: 4 }, skill: 1.0, facing: { q: -1, r: 0 },
    });
    // 撃ち返させない。fireMode は policy が毎tick上書きするので、黙らせるには
    // 弾を空にするしかない（射手Sの撃ち方だけを観測したいため）。
    // **getSoldier() はスナップショットのコピーを返す** ので、状態をいじる時は
    // 生の _soldiers を触ること（コピーに書いても何も起きない）。
    const f = sim._soldiers.get(id);
    f.fireMode = 'hold';
    f.magRemaining = 0;
    f.magsLeft = 0;
    foes.push(id);
  }
  // イベントは tick ごとに drain する（SimCore に購読APIは無い）。
  // 集めるのは射手Sの発砲だけ — 敵の発砲が混じると撃ち方の判定が濁る。
  const shots = [];
  const run = (ticks) => {
    for (let t = 0; t < ticks; t++) {
      sim.tick();
      sim.drainEvents().forEach((ev) => {
        if (ev.type === 'SHOT' && ev.shooterId === 'S') shots.push(ev);
      });
    }
  };
  return { sim, shots, foes, weapon, run };
}

// ===========================================================================
// 1. 弾数表そのもの（toSimWeapon が音源の実測に合わせた表を読んでいるか）
// ===========================================================================
{
  const smg = toSimWeapon('thompson', WPNS.thompson, SIM_TUNING);
  const mg = toSimWeapon('mg42', WPNS.mg42, SIM_TUNING);
  const rifle = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
  const sniper = toSimWeapon('k98_scope', WPNS.k98_scope, SIM_TUNING);
  const pistol = toSimWeapon('m1911', WPNS.m1911, SIM_TUNING);
  const cannon = toSimWeapon('kwk', WPNS.kwk, SIM_TUNING);

  check(smg.burstRounds === 3 && smg.canAuto && smg.autoRounds === 30,
    'SMGは3発バースト / 30発掃射');
  check(mg.burstRounds === 5 && mg.canAuto && mg.autoRounds === 30,
    'MGは5発バースト / 30発掃射');
  check(rifle.burstRounds === 2 && !rifle.canAuto && rifle.autoRounds === 0,
    '半自動小銃は2発速射まで。掃射はできない');
  check(!sniper.canAuto && sniper.burstRounds === 1, '狙撃銃は単射のみ');
  check(!pistol.canAuto && pistol.burstRounds === 1, '拳銃は単射のみ');
  // クラス表に無い at が rifle の値(2発)へ落ちると戦車砲が1トリガー2発になる。
  check(cannon.burstRounds === 1 && !cannon.canAuto,
    '戦車砲はクラス表に無くても1発（素データのburstへ落ちる）');
  check(smg.burstSize === smg.burstRounds && mg.burstSize === mg.burstRounds,
    '旧名 burstSize は burstRounds と同値（描画・旧Action・音側の互換）');
}

// ===========================================================================
// 2. 撃ち方の選択ドクトリン
// ===========================================================================
{
  // 既定はバースト。単独の敵にいきなり掃射はしない。
  const a = makeScene({ foes: 1 });
  a.sim.issueOrder({ type: 'TARGET', soldierIds: ['S'], payload: { targetId: 'E0', mode: 'aimed' } });
  a.run(120);
  check(a.shots.length > 0 && a.shots.every((s) => s.pull === 'burst'),
    '敵が1名なら常にバースト（陸軍のマニュアルが既定）');
  check(a.shots.every((s) => s.roundsFired === 3), 'SMGのバーストは3発');

  // 同一hexに2名 -> 掃射へ上げる。
  const b = makeScene({ foes: 2 });
  b.sim.issueOrder({ type: 'TARGET', soldierIds: ['S'], payload: { targetId: 'E0', mode: 'aimed' } });
  b.run(120);
  const autos = b.shots.filter((s) => s.pull === 'auto');
  check(autos.length > 0, '同一hexに敵が2名居れば掃射へ上げる');
  check(autos.every((s) => s.roundsFired >= SIM_TUNING.AUTO_MIN_ROUNDS),
    '掃射は弾倉を一気に燃やす（最低でも掃射下限ぶん）');
  check(autos.some((s) => s.roundsFired === 30), '弾倉が満ちていれば30発ぶん吐く');

  // 弾倉の残りが AUTO_MIN_ROUNDS 未満なら掃射へ上げない。
  const c = makeScene({ foes: 2 });
  c.sim._soldiers.get('S').magRemaining = SIM_TUNING.AUTO_MIN_ROUNDS - 1;
  c.sim.issueOrder({ type: 'TARGET', soldierIds: ['S'], payload: { targetId: 'E0', mode: 'aimed' } });
  c.run(40);
  check(c.shots.length > 0 && c.shots[0].pull !== 'auto',
    '弾倉の残りが閾値未満なら掃射へ上げない（最後の数発を掃射に使わない）');

  // 最終弾倉に入ったら単射。
  const d = makeScene({ foes: 2, mags: 0 });
  d.sim.issueOrder({ type: 'TARGET', soldierIds: ['S'], payload: { targetId: 'E0', mode: 'aimed' } });
  d.run(60);
  check(d.shots.length > 0 && d.shots.every((s) => s.pull === 'single' && s.roundsFired === 1),
    '最終弾倉に入ったら射撃規律で単射に落ちる（§3.3 弾薬経済）');

  // ボルトアクションは何があっても単射。
  const e = makeScene({ foes: 3, code: 'k98_scope' });
  e.sim.issueOrder({ type: 'TARGET', soldierIds: ['S'], payload: { targetId: 'E0', mode: 'aimed' } });
  e.run(120);
  check(e.shots.length > 0 && e.shots.every((s) => s.roundsFired === 1),
    'ボルトアクションは敵が固まっていても1発ずつ');
}

// ===========================================================================
// 3. 消費弾数の健全性（音と一致させる以前の前提）
// ===========================================================================
{
  const s = makeScene({ foes: 2, mags: 6 });
  const soldier = s.sim._soldiers.get('S');
  s.sim.issueOrder({ type: 'TARGET', soldierIds: ['S'], payload: { targetId: 'E0', mode: 'suppress' } });
  let everNegative = false;
  for (let t = 0; t < 600; t++) {
    s.run(1);
    if (soldier.magRemaining < 0) { everNegative = true; break; }
  }
  check(!everNegative, '弾倉の残弾がマイナスにならない');
  check(s.shots.every((sh) => sh.roundsFired >= 1), '1トリガーは必ず1発以上');
  check(s.shots.length > 0, '制圧モードでも射撃が発生する');
}

// ===========================================================================
// 4. 掃射の弾ばらけ（同一hexの複数へ回る）
// ===========================================================================
{
  // 遮蔽ゼロ・至近距離で命中を出しやすくし、掃射を何度も撃たせる。
  let sawSpill = false;
  let sawMultiVictim = false;
  for (let seed = 1; seed <= 12 && !(sawSpill && sawMultiVictim); seed++) {
    const s = makeScene({ foes: 3, dist: 1, mags: 8, seed: seed });
    s.sim.issueOrder({ type: 'TARGET', soldierIds: ['S'], payload: { targetId: 'E0', mode: 'aimed' } });
    s.run(900);
    const spilledShots = s.shots.filter((sh) => sh.spilled && sh.spilled.length > 0);
    if (spilledShots.length > 0) sawSpill = true;
    // 本来の的以外にもダメージが入っていること
    const hurtOthers = s.foes.slice(1).filter((id) => s.sim._soldiers.get(id).hp < 100);
    if (hurtOthers.length > 0) sawMultiVictim = true;
  }
  check(sawSpill, '掃射の余った命中が同一hexの他の敵へ回る（SHOT.spilled）');
  check(sawMultiVictim, '掃射で本来の的以外にも実際にダメージが入る');

  // ばらける相手数は上限で頭打ち。
  const cap = SIM_TUNING.AUTO_SPILL_MAX_TARGETS;
  let worst = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const s = makeScene({ foes: 6, dist: 1, mags: 8, seed: seed });
    s.sim.issueOrder({ type: 'TARGET', soldierIds: ['S'], payload: { targetId: 'E0', mode: 'aimed' } });
    s.run(600);
    s.shots.forEach((sh) => {
      if (sh.spilled) worst = Math.max(worst, sh.spilled.length + 1);
    });
  }
  check(worst > 0 && worst <= cap,
    '1回の掃射で弾が回る敵は AUTO_SPILL_MAX_TARGETS 名まで（実測 ' + worst + ' / 上限 ' + cap + '）');

  // バーストでは弾はばらけない（掃射だけの見返り）。
  const b = makeScene({ foes: 1, dist: 1, mags: 8 });
  b.sim.issueOrder({ type: 'TARGET', soldierIds: ['S'], payload: { targetId: 'E0', mode: 'aimed' } });
  b.run(300);
  check(b.shots.every((sh) => !sh.spilled || sh.spilled.length === 0),
    'バーストでは弾はばらけない');
}

// ===========================================================================
// 5. **音と弾数の突合** — このファイルの本丸
//
// シムが吐いた roundsFired を音側の解決へ通し、選ばれたクリップに実際に入って
// いる発射数（Sfx.variantRounds、scripts/audio/count_rounds.py の実測）と
// 比べる。旧実装ではここが 2発 vs 30発 で 15倍ずれていた。
// ===========================================================================
{
  // クリップの実測発射数と、そのクリップを選ぶ発射数レンジの整合。
  Object.keys(Sfx.variantRounds).forEach((family) => {
    const r = Sfx.variantRounds[family];
    check(r.single === 1, family + ': single クリップは1発');
    check(r.burst >= 2 && r.burst < Sfx.AUTO_SOUND_MIN_ROUNDS,
      family + ': burst クリップの実測発射数が burst レンジに収まる');
    check(r.auto >= Sfx.AUTO_SOUND_MIN_ROUNDS,
      family + ': auto クリップの実測発射数が auto レンジに収まる');
  });

  // シム側の閾値と音側の閾値が同じでないと、掃射なのに burst クリップが鳴る。
  check(SIM_TUNING.AUTO_MIN_ROUNDS === Sfx.AUTO_SOUND_MIN_ROUNDS,
    'シムの掃射下限(AUTO_MIN_ROUNDS)と音の掃射下限(AUTO_SOUND_MIN_ROUNDS)が一致する');

  // 実戦で出る roundsFired を集めて、1発ごとの誤差を測る。
  const MAX_RATIO = 1.6;   // 鳴っている弾数と撃った弾数の許容比
  const cases = [
    { label: 'SMG・単独の敵', code: 'thompson', foes: 1 },
    { label: 'SMG・同一hexに3名', code: 'thompson', foes: 3 },
    { label: 'MG・同一hexに3名', code: 'mg42', foes: 3 },
    { label: '小銃・単独の敵', code: 'm1', foes: 1 },
  ];
  cases.forEach((c) => {
    const s = makeScene({ code: c.code, foes: c.foes, dist: 2, mags: 6 });
    s.sim.issueOrder({ type: 'TARGET', soldierIds: ['S'], payload: { targetId: 'E0', mode: 'suppress' } });
    s.run(900);
    check(s.shots.length > 0, c.label + ': 射撃が発生する');

    let worstRatio = 1;
    let worstDetail = '';
    s.shots.forEach((sh) => {
      const id = Sfx.soundIdForWeapon(s.weapon, sh.fireMode, sh.roundsFired);
      const family = Sfx.familyOf(id);
      const table = Sfx.variantRounds[family];
      if (!table) return;   // 単発テイクしか無い群は playWeapon 側で連続再生する
      const kind = id.slice(family.length + 1);   // 'single' | 'burst' | 'auto'
      const clipRounds = table[kind];
      const ratio = Math.max(clipRounds / sh.roundsFired, sh.roundsFired / clipRounds);
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worstDetail = sh.roundsFired + '発撃って ' + id + '(' + clipRounds + '発) が鳴る';
      }
    });
    check(worstRatio <= MAX_RATIO,
      c.label + ': 鳴る弾数と撃つ弾数の比が ' + MAX_RATIO + ' 倍以内'
      + (worstDetail ? '（最悪ケース: ' + worstDetail + '）' : ''));
  });

  // 単発テイクしか持たない群（M1 Garand）は、撃った発数ぶん連続で鳴らす契約。
  // ここが無いと M1 は2発消費して1発ぶんしか鳴らない（旧実装の別の嘘）。
  const m1 = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
  check(Sfx.soundIdForWeapon(m1, 'aimed', 2) === 'm1'
    && !Sfx.variantRounds[Sfx.familyOf('m1')],
    'M1は連射テイクを持たない群なので、実発射数ぶん単発を重ねる経路へ入る');
}

// ===========================================================================
// 6. **絵と音の刻みが一致すること**
//
// 銃口炎と着弾煙は1発ずつ間隔を空けて並べる。その間隔がクリップの連射レートと
// 別の値だと、掃射のたびに閃光だけ先に終わる（2026-08-04 ディレクター指摘:
// 「マズルフラッシュも、音と一致してないですよ」。旧実装はクラス固定値
// MG34ms/SMG46ms/他72ms で、実測レート 46/78/134ms のどれとも合っていなかった）。
// ===========================================================================
{
  // Sfx 側: 1発あたりの間隔が、鳴らすクリップの実測レートそのものであること。
  const smgW = toSimWeapon('thompson', WPNS.thompson, SIM_TUNING);
  const mgW = toSimWeapon('mg42', WPNS.mg42, SIM_TUNING);
  const rifleW = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  check(near(Sfx.roundIntervalMs(smgW, 30), 1000 / Sfx.variantRate.thompson, 0.01),
    'SMGの1発間隔が thompson クリップの実測レートと一致する');
  check(near(Sfx.roundIntervalMs(mgW, 30), 1000 / Sfx.variantRate.mg42, 0.01),
    'MGの1発間隔が mg42 クリップの実測レートと一致する');
  check(Sfx.roundIntervalMs(rifleW, 2) === Sfx.SEMI_REPEAT_MS,
    '連射テイクを持たない小銃は半自動の速射間隔を返す');

  // VFX 側: 固定値ではなく Sfx から引いていること。ブラウザ想定のまま vm で読む。
  const vfxBox = {
    console: console, Math: Math, Date: Date, Object: Object, isFinite: isFinite,
    document: { createElement: () => ({ getContext: () => ({}) }) },
    setTimeout: () => 0,
  };
  vfxBox.window = vfxBox;
  vfxBox.Sfx = Sfx;
  vm.createContext(vfxBox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'phaser_vfx.js'), 'utf8'),
    vfxBox, { filename: 'phaser_vfx.js' });
  const VFX = vfxBox.window.VFX;

  [[smgW, 30, 'SMGの掃射'], [mgW, 30, 'MGの掃射'], [smgW, 3, 'SMGのバースト'],
   [rifleW, 2, '小銃の速射']].forEach(([w, n, label]) => {
    const spacing = VFX._roundSpacing(w, n);
    const audio = Sfx.roundIntervalMs(w, n);
    check(near(spacing, audio, 0.01), label + ': 銃口炎の刻みが音の刻みと一致する');
    // 見た目と音の「終わる時刻」のずれ。旧実装はここが1秒近くあった。
    const visualMs = (n - 1) * spacing;
    const audioMs = (n - 1) * audio;
    check(Math.abs(visualMs - audioMs) < 50,
      label + ': 閃光と音の終わりのずれが50ms未満（' + Math.round(visualMs) + 'ms 対 '
      + Math.round(audioMs) + 'ms）');
  });

  // Sfx が居ない環境でも描画は落ちない（フォールバック経路）。
  const noSfx = vfxBox.window.Sfx;
  vfxBox.window.Sfx = null;
  const fallback = VFX._roundSpacing(smgW, 30);
  vfxBox.window.Sfx = noSfx;
  check(isFinite(fallback) && fallback > 0, 'Sfx 不在でも銃口炎の刻みは有限値へ落ちる');
}

// ===========================================================================
console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
process.exit(0);
