/**
 * Phase 0: 知略ダイヤル — classic/chaos プリセット間の lerp + 共振項
 * @see docs/DESIGN_DIRECTION.md
 *
 * d1: 0=classic … 1=chaos（組織様式）
 * d2: 0=defence … 1=attack（作戦姿勢）
 * d3: 0=冷静 … 1=狂気（心理）
 */

function tacticsClamp01(x) {
  return Math.max(0, Math.min(1, Number(x) || 0));
}

function tacticsLerp(a, b, t) {
  return a + (b - a) * t;
}

function tacticsLerpInt(a, b, t) {
  return Math.round(tacticsLerp(a, b, t));
}

function tacticsResonancePeak(d, center, width) {
  const x = (d - center) / Math.max(0.05, width);
  return Math.exp(-x * x);
}

function tacticsTriResonance(d1, d2, d3, c1, c2, c3, width) {
  return tacticsResonancePeak(d1, c1, width)
    * tacticsResonancePeak(d2, c2, width)
    * tacticsResonancePeak(d3, c3, width);
}

/** d1 で lerp するスカラー keys（classic ↔ chaos） */
const TACTICS_D1_SCALAR_KEYS = [
  'HEX_UNIT_CAP',
  'HEX_MOVE_BLOCK',
  'ENEMY_BASE',
  'ENEMY_PER_SECTOR',
  'ALLIED_REINFORCEMENTS',
  'DEPLOY_CARD_MAX',
  'ENEMY_TANK_CHANCE',
  'ENEMY_TANK_CHANCE_PER_SECTOR',
  'ENEMY_TIGER_CHANCE',
  'ENEMY_TIGER_CHANCE_PER_SECTOR',
];

/**
 * @param {number} d1 chaos axis
 * @param {number} d2 attack axis
 * @param {number} d3 madness axis
 * @param {{ classic: object, chaos: object }} presets
 */
function morphBattleScale(d1, d2, d3, presets) {
  const c = presets.classic;
  const h = presets.chaos;
  d1 = tacticsClamp01(d1);
  d2 = tacticsClamp01(d2);
  d3 = tacticsClamp01(d3);

  const out = {
    _preset: 'morph',
    _dial: { d1, d2, d3 },
  };

  TACTICS_D1_SCALAR_KEYS.forEach(function (key) {
    const cv = c[key] != null ? c[key] : 0;
    const hv = h[key] != null ? h[key] : cv;
    if (Number.isInteger(cv) && Number.isInteger(hv)) {
      out[key] = tacticsLerpInt(cv, hv, d1);
    } else {
      out[key] = tacticsLerp(cv, hv, d1);
    }
  });

  return out;
}

function morphWithResonance(d1, d2, d3, presets) {
  const base = morphBattleScale(d1, d2, d3, presets);
  const assaultPeak = tacticsTriResonance(d1, d2, d3, 0.85, 0.85, 0.75, 0.12);
  const trenchPeak = tacticsTriResonance(d1, d2, d3, 0.90, 0.15, 0.90, 0.15);

  base._resonance = {
    assault: assaultPeak,
    trench: trenchPeak,
    label: assaultPeak >= trenchPeak && assaultPeak > 0.35
      ? 'Assault Doctrine'
      : (trenchPeak > 0.35 ? 'Trench Barrage' : null),
  };
  return base;
}

/** 離散プリセット名 → ダイヤル初期値（後方互換） */
const TACTICS_DIAL_FROM_PRESET = {
  classic: { d1: 0, d2: 0.45, d3: 0.25 },
  chaos: { d1: 1, d2: 0.55, d3: 0.45 },
};

function resolveTacticsDial(explicitDial, presetKey) {
  if (explicitDial && typeof explicitDial === 'object') {
    return {
      d1: tacticsClamp01(explicitDial.d1),
      d2: tacticsClamp01(explicitDial.d2),
      d3: tacticsClamp01(explicitDial.d3),
    };
  }
  const fromPreset = TACTICS_DIAL_FROM_PRESET[presetKey] || TACTICS_DIAL_FROM_PRESET.chaos;
  return { d1: fromPreset.d1, d2: fromPreset.d2, d3: fromPreset.d3 };
}

function formatTacticsDialLabel(scale) {
  if (!scale || !scale._dial) return scale && scale._preset ? scale._preset : 'chaos';
  const d = scale._dial;
  const parts = [
    'd1=' + d.d1.toFixed(2),
    'd2=' + d.d2.toFixed(2),
    'd3=' + d.d3.toFixed(2),
  ];
  if (scale._resonance && scale._resonance.label) {
    parts.push(scale._resonance.label);
  }
  return parts.join(' ');
}
