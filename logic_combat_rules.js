/**
 * LOGIC COMBAT RULES: logic_game.js から切り出した弾薬・移動の規則
 *
 * **なぜ切り出すか**: logic_game.js は2133行の1クラスで、ブラウザ環境（DOM・Phaser・
 * campaign）が無いと1行も検証できなかった。ここへ出したものは引数と戻り値だけで完結し、
 * node から直接テストできる（tests/combat_rules.test.js）。
 *
 * **挙動は移設前と同一**。ロジックの改善・変数名の整理・早期returnへの書き換えはしていない。
 * 呼び出し側（logic_game.js）は委譲するだけで、CombatRules 未ロード時は元の実装へ
 * フォールバックする（読み込み順の事故で本編が壊れないように）。
 *
 * グローバル（BATTLE_SCALE / PlMgTripod / LoadoutWeight）は `typeof X !== 'undefined'` で
 * 読む。**`window.X` だけを見る書き方は禁止** — data.js 等の const 宣言は window の
 * プロパティにならず、本番で必ず undefined になる（実績のある罠。ARCHITECTURE.md §0-3）。
 */

/**
 * 弾倉の充填率（0..1）。UI のバー表示と AI の判断が使う。
 * @param {Object} u - ユニット
 * @param {Object} w - 武器
 * @param {Object} [deps]
 * @param {function(Object):number} [deps.findMortarShellTotal] - 迫撃砲弾の総数を数える関数
 * @param {Object} [deps.PlMgTripod] - ベルト給弾判定。省略時はグローバルを見る
 * @returns {number}
 */
function magazineRatio(u, w, deps) {
  if (!w) return 0;
  if (w.code === 'm2_mortar') {
    const fn = deps && deps.findMortarShellTotal;
    const t = typeof fn === 'function' ? fn(u) : 0;
    return t > 0 ? 1 : 0;
  }
  const tripod = (deps && deps.PlMgTripod !== undefined)
    ? deps.PlMgTripod
    : (typeof PlMgTripod !== 'undefined' ? PlMgTripod : undefined);
  // truthy 判定にする。`typeof null` は 'object' なので typeof ガードだけだと
  // 依存を null で渡された時に素通りして落ちる（移設元はグローバル前提で null が
  // 来なかったため露見しなかった）。
  const belt = !!tripod && tripod.usesBeltReserve(w.code) && w.reserve !== undefined;
  if (belt) {
    const cap = w.cap || 50;
    const inGun = (w.current || 0) + (w.reserve || 0);
    return Math.min(1, inGun / Math.max(1, cap));
  }
  const cap = w.cap || 1;
  return Math.min(1, (w.current || 0) / cap);
}

/**
 * 弾薬の緊張感。BATTLE_SCALE.ammoBurnMult（0.85〜1.95程度）に応じて、通常弾の消費に
 * 追加で1発分の余剰消費が発生する確率を返す。ターン制/RT問わず適用。
 * @param {Object} [deps]
 * @param {number} [deps.ammoBurnMult] - 省略時はグローバル BATTLE_SCALE から読む
 * @param {function():number} [deps.random] - 省略時 Math.random（テストで差し替える）
 * @returns {0|1}
 */
function extraAmmoBurnRoll(deps) {
  const fromDeps = (deps && deps.ammoBurnMult !== undefined) ? deps.ammoBurnMult : undefined;
  const fromGlobal = (typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.ammoBurnMult) || undefined;
  const mult = (fromDeps !== undefined ? fromDeps : fromGlobal) || 1;
  const random = (deps && deps.random !== undefined) ? deps.random : Math.random;
  const extra = mult - 1;
  if (extra <= 0) return 0;
  return random() < extra ? 1 : 0;
}

/**
 * 移動予算（進める hex 数）。装備重量が効く場合は LoadoutWeight に委譲する。
 *
 * 戻り値は**数値**。移設元は `{budget, spd}` ではなく素の数を返しており、
 * 呼び出し側もそれを前提にしているので形を変えない。
 *
 * @param {Object} u
 * @param {number|null} apOverride
 * @param {Object} [deps]
 * @param {Object} [deps.LoadoutWeight] - 省略時はグローバル
 * @returns {number}
 */
function movementBudget(u, apOverride, deps) {
  const lw = (deps && deps.LoadoutWeight !== undefined)
    ? deps.LoadoutWeight
    : (typeof LoadoutWeight !== 'undefined' ? LoadoutWeight : undefined);
  // 同上: null を渡された時に typeof ガードを素通りしないよう truthy で見る
  if (lw) {
    return lw.getMovementBudget(u, apOverride != null ? apOverride : u.ap);
  }
  const spd = (u.params && u.params.speed != null) ? u.params.speed : 5;
  const ap = apOverride != null ? apOverride : u.ap;
  return Math.max(1, Math.floor(ap * (spd / 5)));
}

// ---------------------------------------------------------------------------

const CombatRulesModule = {
  magazineRatio: magazineRatio,
  extraAmmoBurnRoll: extraAmmoBurnRoll,
  movementBudget: movementBudget,
};

if (typeof module !== 'undefined' && module.exports) module.exports = CombatRulesModule;
if (typeof window !== 'undefined') { window.CombatRules = CombatRulesModule; }
