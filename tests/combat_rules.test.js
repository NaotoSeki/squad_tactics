/**
 * tests/combat_rules.test.js -- logic_combat_rules.js の受入テスト
 *
 * logic_game.js から切り出した規則を、ブラウザ抜きで検証する。切り出しの目的が
 * 「headless で検証できるようにする」ことなので、このテストの存在が成果そのもの。
 *
 * No framework. Run with `node tests/combat_rules.test.js`.
 */

const path = require('path');
const CombatRules = require(path.join(__dirname, '..', 'logic_combat_rules.js'));

let passCount = 0;
let failCount = 0;
const failures = [];
function check(cond, label) {
  if (cond) { passCount++; console.log('PASS: ' + label); }
  else { failCount++; failures.push(label); console.log('FAIL: ' + label); }
}

const R = CombatRules;

// --- magazineRatio ----------------------------------------------------------
{
  check(R.magazineRatio({}, null) === 0, '武器が無ければ充填率0');
  check(R.magazineRatio({}, { code: 'm1', current: 1 }) === 1,
    'cap 未設定なら 1 として扱う（current=1 で満タン）');
  check(R.magazineRatio({}, { code: 'm1', current: 1, cap: 2 }) === 0.5,
    '通常武器は current/cap');
  check(R.magazineRatio({}, { code: 'm1', current: 9, cap: 2 }) === 1,
    '1 を超えない（過剰装填でも満タン止まり）');
  check(R.magazineRatio({}, { code: 'm1', cap: 4 }) === 0,
    'current 未設定は 0 扱い');
}

// --- magazineRatio: 迫撃砲は「弾が1発でもあるか」の二値 ----------------------
{
  const w = { code: 'm2_mortar', current: 0 };
  check(R.magazineRatio({}, w, { findMortarShellTotal: () => 3 }) === 1,
    '迫撃砲は砲弾が残っていれば1');
  check(R.magazineRatio({}, w, { findMortarShellTotal: () => 0 }) === 0,
    '迫撃砲は砲弾が尽きれば0');
  check(R.magazineRatio({}, w, {}) === 0,
    '砲弾を数える関数が無ければ0（例外にしない）');
}

// --- magazineRatio: ベルト給弾は current + reserve ---------------------------
{
  const tripod = { usesBeltReserve: (code) => code === 'mg42' };
  check(R.magazineRatio({}, { code: 'mg42', current: 20, reserve: 30, cap: 100 }, { PlMgTripod: tripod }) === 0.5,
    'ベルト給弾は (current+reserve)/cap');
  check(R.magazineRatio({}, { code: 'mg42', current: 20, cap: 100 }, { PlMgTripod: tripod }) === 0.2,
    'reserve が無い個体はベルト扱いにしない（通常計算へ落ちる）');
  check(R.magazineRatio({}, { code: 'm1', current: 20, reserve: 30, cap: 100 }, { PlMgTripod: tripod }) === 0.2,
    'ベルト給弾でない武器は reserve を数えない');
}

// --- extraAmmoBurnRoll ------------------------------------------------------
{
  check(R.extraAmmoBurnRoll({ ammoBurnMult: 1, random: () => 0 }) === 0,
    '倍率1なら余剰消費は起きない');
  check(R.extraAmmoBurnRoll({ ammoBurnMult: 0.85, random: () => 0 }) === 0,
    '倍率が1未満でも余剰消費は起きない（節約側にはしない）');
  check(R.extraAmmoBurnRoll({ ammoBurnMult: 1.5, random: () => 0.4 }) === 1,
    '倍率1.5・乱数0.4 なら余剰消費1発');
  check(R.extraAmmoBurnRoll({ ammoBurnMult: 1.5, random: () => 0.6 }) === 0,
    '倍率1.5・乱数0.6 なら余剰消費なし');
  check(R.extraAmmoBurnRoll({ ammoBurnMult: 1.5, random: () => 0.5 }) === 0,
    '境界（乱数=extra）は余剰消費なし（元実装の < と同じ）');
  check(R.extraAmmoBurnRoll({ ammoBurnMult: 1.95, random: () => 0.94 }) === 1,
    '倍率1.95 はほぼ毎回余剰消費する');
}

// --- movementBudget ---------------------------------------------------------
//
// 戻り値は素の数値（移設元がそうなっている）。オブジェクトを返す形に「整理」しては
// いけない — 呼び出し側が数値前提。
{
  let seenAp = null;
  const lw = { getMovementBudget: (u, ap) => { seenAp = ap; return 99; } };
  check(R.movementBudget({ ap: 2 }, null, { LoadoutWeight: lw }) === 99,
    'LoadoutWeight があれば委譲し、その戻り値をそのまま返す');
  check(seenAp === 2, '委譲時は unit.ap を渡す');

  seenAp = null;
  R.movementBudget({ ap: 2 }, 5, { LoadoutWeight: lw });
  check(seenAp === 5, 'apOverride が unit.ap より優先される');

  // フォールバック: floor(ap * spd/5) で下限1
  check(R.movementBudget({ ap: 4, params: { speed: 5 } }, null, { LoadoutWeight: null }) === 4,
    'LoadoutWeight 無し・速度5なら ap そのまま');
  check(R.movementBudget({ ap: 4, params: { speed: 10 } }, null, { LoadoutWeight: null }) === 8,
    '速度10なら倍');
  check(R.movementBudget({ ap: 4, params: { speed: 2 } }, null, { LoadoutWeight: null }) === 1,
    '速度2なら floor(4*0.4)=1');
  check(R.movementBudget({ ap: 4, params: { speed: 0 } }, null, { LoadoutWeight: null }) === 0,
    'spd 0 ならフォールバック経路でも移動予算0');
  check(R.movementBudget({ ap: 0, params: { speed: 5 } }, null, { LoadoutWeight: null }) === 1,
    'AP0でも下限1（0にはならない）');
  check(R.movementBudget({ ap: 4 }, null, { LoadoutWeight: null }) === 4,
    'params 未設定なら速度5扱い');
  check(R.movementBudget({ ap: 2 }, 5, { LoadoutWeight: null }) === 5,
    'フォールバック側でも apOverride が効く');
}

// --- グローバル未定義でも落ちない -------------------------------------------
//
// node には BATTLE_SCALE も PlMgTripod も LoadoutWeight も無い。`window.X` だけを
// 見る書き方だと本番で undefined になる罠があるので、素の識別子を typeof で読めている
// ことをここで担保する（ARCHITECTURE.md §0-3）。
{
  let threw = false;
  try {
    R.magazineRatio({}, { code: 'm1', current: 1, cap: 2 });
    R.extraAmmoBurnRoll({ random: () => 0.9 });
    R.movementBudget({ ap: 2 }, null);
  } catch (e) { threw = true; }
  check(!threw, 'グローバルが1つも無い環境でも例外を出さない');
}

console.log('\n' + passCount + ' passed, ' + failCount + ' failed');
if (failCount) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
