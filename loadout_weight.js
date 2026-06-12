/**
 * 装備重量 → 実効 spd / 移動コスト
 * 所持重量の合計で段階的に spd が低下（レーダーチャートで可視化）。
 */
(function () {
    'use strict';

  /** この重量までほぼペナルティなし（軽装） */
  const COMFORT_KG = 12;
  /** この重量で spd≈1（移動困難）— 50kg 前後が限界想定 */
  const HARD_KG = 55;
  /** これ以上は spd 0 */
  const IMMOBILE_KG = 70;
  /** 筋力 1 あたり上記閾値のシフト (kg) */
  const KG_PER_STR = 2;
  const MAX_MOVE_COST_MULT = 1.85;

  function getStrKgShift(unit) {
    const str = (unit.params && unit.params.str != null) ? unit.params.str : 5;
    return (str - 5) * KG_PER_STR;
  }

  function getWeightThresholds(unit) {
    const shift = getStrKgShift(unit);
    return {
      comfort: COMFORT_KG + shift,
      hard: HARD_KG + shift,
      immobile: IMMOBILE_KG + shift,
    };
  }

  function smoothstep(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  }

  function getItemWeightKg(item) {
    if (!item) return 0;
    if (typeof PlMgTripod !== 'undefined' && PlMgTripod.getItemWeightKg) {
      const tw = PlMgTripod.getItemWeightKg(item);
      if (tw != null) return tw;
    }
    if (typeof item.weight === 'number' && item.weight > 0) {
      if (item.code && typeof WPNS !== 'undefined' && WPNS[item.code]) {
        const m = WPNS[item.code];
        if (typeof PlMgTripod !== 'undefined' && PlMgTripod.isTripodCode && PlMgTripod.isTripodCode(item.code)) {
          /* 雛形 weight:1 は無視し TRIPOD_WEIGHT_KG を正本とする */
        } else if (m.plCategory === 'mg' && typeof m.wgt === 'number' && m.wgt > 0) {
          return m.wgt;
        } else if (m.statTemplate === 'part_gear' && item.weight <= 1.5) {
          /* part_gear 雛形 1kg — 三脚以外の補助品は後段 fallback */
        } else {
          return item.weight;
        }
      } else {
        return item.weight;
      }
    }
    if (item.code && typeof WPNS !== 'undefined' && WPNS[item.code]) {
      const m = WPNS[item.code];
      if (typeof m.wgt === 'number' && m.wgt > 0) {
        if (m.plCategory === 'mg') return m.wgt;
        if (m.statTemplate === 'part_gear') return 0;
        return m.wgt * 2.5;
      }
    }
    if (item.type === 'ammo') return 1.2;
    if (item.type === 'part') return 2;
    return 0;
  }

  function getUnitCarriedWeightKg(unit) {
    if (!unit || unit.def?.isTank) return 0;
    let total = 0;
    const add = (it) => { total += getItemWeightKg(it); };
    (unit.hands || []).forEach(add);
    (unit.bag || []).forEach(add);
    return Math.round(total * 10) / 10;
  }

  function getLoadCapacityKg(unit) {
    return getWeightThresholds(unit).hard;
  }

  function getOverweightKg(unit) {
    const load = getUnitCarriedWeightKg(unit);
    const comfort = getWeightThresholds(unit).comfort;
    return Math.max(0, load - comfort);
  }

  function getEffectiveSpeed(unit) {
    const base = (unit.params && unit.params.speed != null) ? unit.params.speed : 5;
    if (unit.def?.isTank) return base;
    const totalKg = getUnitCarriedWeightKg(unit);
    const { comfort, hard, immobile } = getWeightThresholds(unit);

    if (totalKg <= comfort) return base;
    if (totalKg >= immobile) return 0;

    if (totalKg <= hard) {
      const t = (totalKg - comfort) / Math.max(1, hard - comfort);
      const penalty = smoothstep(t) * (base - 1);
      return Math.max(1, Math.floor(base - penalty));
    }

    const t2 = (totalKg - hard) / Math.max(1, immobile - hard);
    return Math.max(0, Math.floor(1 - t2));
  }

  function getTerrainCostMultiplier(unit) {
    if (unit.def?.isTank) return 1;
    const totalKg = getUnitCarriedWeightKg(unit);
    const { comfort, hard } = getWeightThresholds(unit);
    if (totalKg <= comfort) return 1;
    const t = Math.min(1, (totalKg - comfort) / Math.max(1, hard - comfort));
    return 1 + t * (MAX_MOVE_COST_MULT - 1);
  }

  function refreshUnitLoadout(unit) {
    if (!unit || !unit.params) return;
    unit.params.effectiveSpeed = getEffectiveSpeed(unit);
    unit._carriedWeightKg = getUnitCarriedWeightKg(unit);
    unit._loadCapacityKg = getLoadCapacityKg(unit);
  }

  window.LoadoutWeight = {
    getItemWeightKg,
    getUnitCarriedWeightKg,
    getLoadCapacityKg,
    getOverweightKg,
    getEffectiveSpeed,
    getTerrainCostMultiplier,
    refreshUnitLoadout,

    /** レーダーチャート用: 装備重量で低下した実効 spd を反映 */
    getRadarDisplayParams(unit) {
      if (!unit || !unit.params) return {};
      const display = { ...unit.params };
      if (unit.def?.isTank) return display;
      refreshUnitLoadout(unit);
      const baseSpd = unit.params.speed != null ? unit.params.speed : 5;
      const effSpd = unit.params.effectiveSpeed != null ? unit.params.effectiveSpeed : getEffectiveSpeed(unit);
      display._baseSpeed = baseSpd;
      display.speed = effSpd;
      display._loadDebuff = effSpd < baseSpd;
      display._carriedWeightKg = unit._carriedWeightKg;
      return display;
    },

    /** AP から換算する移動予算。装備重量で実効 spd が下がる */
    getMovementBudget(unit, ap) {
      const spd = getEffectiveSpeed(unit);
      const budgetAp = ap != null ? ap : (unit.ap || 0);
      if (spd <= 0) return 0;
      return Math.max(1, Math.floor(budgetAp * (spd / 5)));
    }
  };
})();
