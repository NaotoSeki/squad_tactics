/** M2 60mm mortar: shared loadout, ammo, and asset rules (browser + Node). */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.M2Mortar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PART_CODES = ['mortar_barrel', 'mortar_bipod', 'mortar_plate'];
  const ASSET_PATHS = {
    mortar_barrel: 'asset/mortar/m2_tube_slot.png',
    mortar_bipod: 'asset/mortar/m2_bipod_slot.png',
    mortar_plate: 'asset/mortar/m2_baseplate_slot.png',
    mortar_shell_box: 'asset/mortar/m2_ammo_box_slot.png',
    assembled: 'asset/mortar/m2_mortar_assembled.png',
    map: 'asset/mortar/m2_mortar_map.png',
  };
  const TEXTURE_KEYS = {
    mortar_barrel: 'm2_part_tube',
    mortar_bipod: 'm2_part_bipod',
    mortar_plate: 'm2_part_baseplate',
    mortar_shell_box: 'm2_ammo_box',
    map: 'm2_mortar_map',
  };
  const ASSEMBLED_SLICE_KEYS = ['m2_mortar_slice_top', 'm2_mortar_slice_mid', 'm2_mortar_slice_bottom'];
  // The source texture is square, but its opaque footprint is wide. 24px keeps
  // the assembled weapon slightly below the 20px-tall soldier silhouette.
  const MAP_DISPLAY_SIZE = 24;
  const BALLISTICS = Object.freeze({
    adjacentBase: 0.06,
    adjacentRange: 0.12,
    adjacentAccuracy: 0.08,
    adjacentSuppression: 0.14,
    adjacentMax: 0.32,
    withinHexRadiusMin: 0.10,
    withinHexRadiusRange: 0.20,
    withinHexRadiusSuppression: 0.10,
    directDamageScale: 0.62,
    coverMitigation: 0.65,
  });
  const ASSEMBLED_SLICE_PATHS = [
    'asset/mortar/m2_mortar_slot_top.png?v=gap-2',
    'asset/mortar/m2_mortar_slot_mid.png?v=gap-2',
    'asset/mortar/m2_mortar_slot_bottom.png?v=gap-2',
  ];

  function isAssembled(unit) {
    const codes = ((unit && unit.hands) || []).slice(0, 3).map(function (item) {
      return item && item.code;
    });
    return PART_CODES.every(function (code) { return codes.indexOf(code) >= 0; });
  }

  function ammoItems(unit) {
    const all = (((unit && unit.hands) || []).slice(0, 3)).concat((unit && unit.bag) || []);
    return all.filter(function (item) { return item && item.code === 'mortar_shell_box'; });
  }

  function ammoTotal(unit) {
    return ammoItems(unit).reduce(function (sum, item) {
      return sum + Math.max(0, Number(item.current) || 0);
    }, 0);
  }

  /** Writes a total back into the existing physical boxes without cloning/removing them. */
  function setAmmoTotal(unit, total) {
    let left = Math.max(0, Math.floor(Number(total) || 0));
    ammoItems(unit).forEach(function (item) {
      const cap = Math.max(0, Number(item.cap) || 0);
      item.current = Math.min(cap, left);
      left -= item.current;
    });
    return left;
  }

  function textureKeyForItem(code) { return TEXTURE_KEYS[code] || null; }
  function texturePathForItem(code) { return ASSET_PATHS[code] || null; }

  /** Resolve one deterministic mortar impact from the supplied RNG stream. */
  function resolveImpact(opts) {
    opts = opts || {};
    const aim = opts.aimHex || { q: 0, r: 0 };
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    const range = Math.max(0, Number(opts.range) || 0);
    const minRange = Math.max(0, Number(opts.minRange) || 0);
    const maxRange = Math.max(minRange + 1, Number(opts.maxRange) || minRange + 1);
    const rangeRatio = Math.max(0, Math.min(1, (range - minRange) / (maxRange - minRange)));
    const accuracy = Math.max(0, Math.min(100, Number(opts.accuracy) || 0));
    const accuracyPenalty = (100 - accuracy) / 100;
    const suppressionRatio = Math.max(0, Math.min(1, Number(opts.suppressionRatio) || 0));
    const adjacentChance = Math.min(BALLISTICS.adjacentMax,
      BALLISTICS.adjacentBase
      + BALLISTICS.adjacentRange * rangeRatio
      + BALLISTICS.adjacentAccuracy * accuracyPenalty
      + BALLISTICS.adjacentSuppression * suppressionRatio);

    const missRoll = rng();
    const directionRoll = rng();
    const radiusRoll = rng();
    const angleRoll = rng();
    let candidates = typeof opts.neighbors === 'function' ? (opts.neighbors(aim) || []) : [];
    if (typeof opts.isValidHex === 'function') candidates = candidates.filter(opts.isValidHex);
    const adjacent = missRoll < adjacentChance && candidates.length > 0;
    const hex = adjacent
      ? candidates[Math.min(candidates.length - 1, Math.floor(directionRoll * candidates.length))]
      : aim;
    const maxRadius = Math.min(0.42,
      BALLISTICS.withinHexRadiusMin
      + BALLISTICS.withinHexRadiusRange * rangeRatio
      + BALLISTICS.withinHexRadiusSuppression * suppressionRatio);
    const radius = Math.sqrt(Math.max(0, Math.min(1, radiusRoll))) * (adjacent ? maxRadius * 0.55 : maxRadius);
    const angle = angleRoll * Math.PI * 2;
    return {
      aimHex: { q: aim.q, r: aim.r },
      hex: { q: hex.q, r: hex.r },
      offsetQ: Math.cos(angle) * radius,
      offsetR: Math.sin(angle) * radius,
      adjacent: adjacent,
      adjacentChance: adjacentChance,
      rangeRatio: rangeRatio,
    };
  }

  /** Convert fractional axial offsets to the renderer's real hex geometry. */
  function impactScreenPoint(impact, hexToPx) {
    const h = impact && impact.hex ? impact.hex : impact;
    const center = hexToPx(h.q, h.r);
    if (!impact || (!impact.offsetQ && !impact.offsetR)) return { x: center.x, y: center.y };
    const qBasis = hexToPx(h.q + 1, h.r);
    const rBasis = hexToPx(h.q, h.r + 1);
    return {
      x: center.x + (qBasis.x - center.x) * impact.offsetQ + (rBasis.x - center.x) * impact.offsetR,
      y: center.y + (qBasis.y - center.y) * impact.offsetQ + (rBasis.y - center.y) * impact.offsetR,
    };
  }

  function blastDamageScale(distance) {
    if (distance < 0 || distance > 1) return 0;
    return BALLISTICS.directDamageScale * (distance === 0 ? 1 : 0.45);
  }

  return {
    PART_CODES,
    ASSET_PATHS,
    TEXTURE_KEYS,
    ASSEMBLED_SLICE_KEYS,
    ASSEMBLED_SLICE_PATHS,
    MAP_DISPLAY_SIZE,
    BALLISTICS,
    isAssembled,
    ammoItems,
    ammoTotal,
    setAmmoTotal,
    textureKeyForItem,
    texturePathForItem,
    resolveImpact,
    impactScreenPoint,
    blastDamageScale,
  };
});
