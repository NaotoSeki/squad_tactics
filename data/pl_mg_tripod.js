/**
 * PL 準拠: 三脚／ベルト給弾／MMG 制限／射撃モード（CBE 0x1DDF00 由来の分類）
 */
(function (global) {
  /** 主兵装 WPNS キー → 三脚架 WPNS キー */
  const TRIPOD_CODE_FOR_MAIN = {
    mg42: 'pl_113',
    pl_94: 'pl_113',
    pl_91: 'pl_112', pl_92: 'pl_112', pl_93: 'pl_112',
    pl_20: 'pl_31',
    pl_22: 'pl_32',
    pl_23: 'pl_31',
    pl_24: 'pl_33',
    pl_95: 'pl_114',
    pl_176: 'pl_183', pl_177: 'pl_183', pl_178: 'pl_183',
    pl_179: 'pl_184',
    pl_136: 'pl_139', pl_137: 'pl_139',
    pl_138: 'pl_140',
    pl_156: 'pl_157',
    pl_206: 'pl_207',
    pl_216: 'pl_218',
    pl_217: 'pl_219',
  };

  /** PL category mmg (code 7): 三脚なしは連射2以下・命中大幅低下 */
  const MMG_CODES = new Set([
    'pl_22', 'pl_23', 'pl_24', 'pl_95',
    'pl_136', 'pl_137', 'pl_138', 'pl_156', 'pl_179',
    'pl_199', 'pl_200', 'pl_206', 'pl_217',
    'pl_395', 'pl_396', 'pl_397', 'pl_398',
  ]);

  /** ベルト reserve を使う主兵装（MMG + MG42 系） */
  const BELT_FEED_CODES = new Set([
    'mg42', 'pl_94', 'pl_402', 'pl_403',
    ...MMG_CODES,
  ]);

  const BELT_RESERVE_ROUNDS = {
    mg42: 300, pl_94: 300, pl_402: 300, pl_403: 300,
    pl_23: 200, pl_395: 200, pl_396: 200, pl_397: 200,
    pl_24: 110, pl_398: 110,
    pl_95: 100, pl_179: 250, pl_408: 250,
    pl_22: 200, pl_199: 250, pl_200: 50,
    pl_136: 50, pl_137: 50, pl_138: 20, pl_156: 24,
    pl_206: 100, pl_217: 100,
  };

  /** 三脚アイテム WPNS キー（主兵装とペア） */
  const TRIPOD_ITEM_CODES = new Set(Object.values(TRIPOD_CODE_FOR_MAIN));

  /** LOADOUT 副スロット（hands[1] / hands[2]）。hands[0] は主兵装専用 */
  const TRIPOD_LOADOUT_SLOT_MIN = 1;
  const TRIPOD_LOADOUT_SLOT_MAX = 2;

  const TRIPOD_WEIGHT_KG = {
    pl_31: 8.5, pl_32: 24.1, pl_33: 20.0,
    pl_112: 21, pl_113: 21, pl_114: 34.9,
    pl_139: 21.5, pl_140: 18.8, pl_157: 27.2,
    pl_183: 13.6, pl_184: 22.7, pl_207: 19.8,
    pl_218: 13.6, pl_219: 22.7,
  };

  /** 三脚アイテム側 shots_per_action（架設時の連射上限の目安） */
  const TRIPOD_MOUNTED_BURST = {
    pl_31: 5, pl_32: 6, pl_33: 6,
    pl_112: 2, pl_113: 15, pl_114: 5,
    pl_139: 2, pl_140: 5, pl_157: 6,
    pl_183: 2, pl_184: 5,
    pl_207: 4, pl_218: 2, pl_219: 5,
  };

  /** PL 射撃セレクター（短点射 / 連射）— modes 未設定の WPNS へ付与 */
  const FIRE_MODES = {
    mg42: [2, 10], pl_94: [2, 10], pl_402: [2, 10], pl_403: [2, 10],
    pl_91: [2, 15], pl_92: [2, 17], pl_93: [2, 15], pl_400: [2, 15], pl_401: [2, 17],
    pl_20: [2, 5], pl_21: [2, 2],
    pl_22: [2, 15], pl_23: [2, 15], pl_24: [2, 6], pl_395: [2, 15], pl_396: [2, 15], pl_397: [2, 15], pl_398: [2, 6],
    pl_87: [2, 5], pl_88: [2, 5], pl_89: [2, 2], pl_90: [2, 10],
    pl_95: [2, 5],
    pl_176: [2, 15], pl_177: [2, 15], pl_178: [2, 15],
    pl_179: [2, 5], pl_408: [2, 5],
    pl_198: [2, 6], pl_155: [2, 2],
    pl_136: [2, 1], pl_137: [2, 1], pl_138: [2, 3], pl_156: [2, 3],
    pl_206: [2, 2], pl_217: [2, 2],
    pl_71: [2, 5], pl_72: [2, 5],
  };

  const MMG_NO_TRIPOD_BURST_CAP = 2;
  const MMG_NO_TRIPOD_HIT_PENALTY = 40;
  const MMG_NO_TRIPOD_ACC_DELTA = -25;

  /**
   * 射撃セレクター用モードを正規化。重複・1件以下・非正数は null（UI 非表示）。
   * @param {number[]|null} modes
   * @returns {number[]|null}
   */
  function normalizeFireModes(modes) {
    if (!Array.isArray(modes)) return null;
    const seen = new Set();
    const unique = [];
    for (let i = 0; i < modes.length; i++) {
      const v = Number(modes[i]);
      if (!Number.isFinite(v) || v <= 0 || seen.has(v)) continue;
      seen.add(v);
      unique.push(v);
    }
    unique.sort(function (a, b) { return a - b; });
    return unique.length >= 2 ? unique : null;
  }

  function getTripodCode(mainCode) {
    return TRIPOD_CODE_FOR_MAIN[mainCode] || null;
  }

  function isTripodCode(code) {
    return !!code && TRIPOD_ITEM_CODES.has(code);
  }

  function isTripodLoadoutSlot(index) {
    return index >= TRIPOD_LOADOUT_SLOT_MIN && index <= TRIPOD_LOADOUT_SLOT_MAX;
  }

  /** hands[0] の主兵装 code（Recovery/三脚は除外） */
  function getMainWeaponCode(u) {
    if (!u || !u.hands || !u.hands[0]) return null;
    const slot0 = u.hands[0];
    if (!slot0.code) return null;
    if (isTripodCode(slot0.code)) return null;
    const recoveryAttr = typeof ATTR !== 'undefined' ? ATTR.RECOVERY : 'Recovery';
    const weaponAttr = typeof ATTR !== 'undefined' ? ATTR.WEAPON : 'Weaponry';
    const master0 = typeof WPNS !== 'undefined' ? WPNS[slot0.code] : null;
    if (master0 && master0.attr === recoveryAttr) return null;
    if (slot0.type === 'part' && slot0.partType === 'other' && master0 && master0.attr === recoveryAttr) return null;
    if (slot0.attr === weaponAttr || (master0 && master0.attr === weaponAttr)) return slot0.code;
    if (slot0.type !== 'part' && master0 && master0.attr === weaponAttr) return slot0.code;
    return null;
  }

  function findTripodInLoadout(u, tripCode) {
    if (!u || !u.hands || !tripCode) return -1;
    for (let i = TRIPOD_LOADOUT_SLOT_MIN; i <= TRIPOD_LOADOUT_SLOT_MAX; i++) {
      const it = u.hands[i];
      if (it && it.code === tripCode) return i;
    }
    return -1;
  }

  function findEmptyTripodLoadoutSlot(u) {
    if (!u || !u.hands) return -1;
    for (let i = TRIPOD_LOADOUT_SLOT_MIN; i <= TRIPOD_LOADOUT_SLOT_MAX; i++) {
      if (!u.hands[i]) return i;
    }
    return -1;
  }

  /** 主兵装と三脚のペア成立（hands[1-2] に対応三脚＝展開済み） */
  function unitHasTripod(u, mainCode) {
    const trip = getTripodCode(mainCode);
    if (!trip || !u) return false;
    return findTripodInLoadout(u, trip) >= 0;
  }

  /** 三脚を所持（bag 含む＝未展開も可） */
  function unitCarriesTripod(u, mainCode) {
    const trip = getTripodCode(mainCode);
    if (!trip || !u) return false;
    if (findTripodInLoadout(u, trip) >= 0) return true;
    return (u.bag || []).some((it) => it && it.code === trip);
  }

  function findTripodInBag(u, tripCode) {
    if (!u || !u.bag || !tripCode) return -1;
    return u.bag.findIndex((it) => it && it.code === tripCode);
  }

  function tripodMatchesMain(tripodCode, mainCode) {
    if (!tripodCode || !mainCode) return false;
    return getTripodCode(mainCode) === tripodCode;
  }

  /** 装備スロットへ置けるか（swap 前の item 単体） */
  function canPlaceItemInSlot(u, type, index, item) {
    if (!item || !item.code) return true;
    if (isTripodCode(item.code)) {
      if (type === 'main' && index === 0) return false;
      if (type === 'main' && isTripodLoadoutSlot(index)) {
        const mainCode = getMainWeaponCode(u);
        if (!mainCode) return false;
        return tripodMatchesMain(item.code, mainCode);
      }
      if (type === 'bag') return true;
      return false;
    }
    return true;
  }

  /** swap 後の hands/bag 全体が三脚ルールを満たすか */
  function validateLoadoutState(u) {
    if (!u) return { ok: false, reason: 'ユニットなし' };
    const hands = u.hands || [];
    const mainCode = getMainWeaponCode(u);
    for (let i = 0; i < hands.length; i++) {
      const it = hands[i];
      if (!it || !it.code) continue;
      if (isTripodCode(it.code)) {
        if (i === 0) {
          return { ok: false, reason: '三脚は主兵装スロットに置けません' };
        }
        if (isTripodLoadoutSlot(i)) {
          if (!mainCode) {
            return { ok: false, reason: '主兵装がないと三脚を展開できません' };
          }
          if (!tripodMatchesMain(it.code, mainCode)) {
            return { ok: false, reason: 'この三脚は現在の主兵装と組み合わせ不可' };
          }
        } else {
          return { ok: false, reason: '三脚は LOADOUT 副スロット（2・3）か BACKPACK へ' };
        }
      }
    }
    return { ok: true };
  }

  /** 単一スロットへ item を置いた後の状態を検証（ユニット間受け渡し用） */
  function validateItemPlacement(u, type, index, item) {
    if (!u) return { ok: false, reason: 'ユニットなし' };
    const simHands = (u.hands || []).slice();
    const simBag = (u.bag || []).slice();
    if (type === 'main') simHands[index] = item;
    else simBag[index] = item;
    return validateLoadoutState({ hands: simHands, bag: simBag, def: u.def });
  }

  /** swap 後の配置が三脚ルールを満たすか */
  function validateEquipmentSwap(u, src, tgt, item1, item2) {
    if (!u) return { ok: false, reason: 'ユニットなし' };
    const simHands = (u.hands || []).slice();
    const simBag = (u.bag || []).slice();
    const put = (type, idx, item) => {
      if (type === 'main') simHands[idx] = item;
      else simBag[idx] = item;
    };
    const srcIdx = src.type === 'main' ? (src.index ?? 0) : src.index;
    const tgtIdx = tgt.type === 'main' ? (tgt.index ?? 0) : tgt.index;
    put(src.type, srcIdx, item2);
    put(tgt.type, tgtIdx, item1);
    return validateLoadoutState({ hands: simHands, bag: simBag, def: u.def });
  }

  function getItemWeightKg(item) {
    if (!item || !item.code) return null;
    if (TRIPOD_WEIGHT_KG[item.code] != null) return TRIPOD_WEIGHT_KG[item.code];
    return null;
  }

  function usesBeltReserve(code) {
    return !!code && BELT_FEED_CODES.has(code);
  }

  function isMmgCode(code) {
    return !!code && MMG_CODES.has(code);
  }

  function getDefaultBeltReserve(code) {
    return BELT_RESERVE_ROUNDS[code] != null ? BELT_RESERVE_ROUNDS[code] : 200;
  }

  function applyItemDefaults(item, key, isTank) {
    if (!item || !key) return item;
    const modes = normalizeFireModes(FIRE_MODES[key]);
    if (modes) {
      if (!normalizeFireModes(item.modes)) item.modes = modes.slice();
      if (item.burst == null || item.burst < modes[0]) item.burst = modes[0];
    }
    if (!isTank && usesBeltReserve(key) && item.reserve === undefined) {
      item.reserve = getDefaultBeltReserve(key);
      if (item.type === 'bullet' && (item.current == null || item.current === item.cap)) {
        item.current = item.cap;
      }
    }
    return item;
  }

  /**
   * 戦闘用に burst / 命中補正を付けたコピーを返す（hands 実体は変更しない）
   */
  function enrichWeaponForCombat(u, w) {
    if (!w || !w.code) return w;
    const out = { ...w };
    const code = w.code;
    const mounted = unitHasTripod(u, code);
    const tripCode = getTripodCode(code);
    const tripBurst = tripCode ? TRIPOD_MOUNTED_BURST[tripCode] : null;

    out._hitBonus = 0;
    out._hitPenalty = 0;

    if (isMmgCode(code) && !mounted) {
      out.burst = Math.min(out.burst || 15, MMG_NO_TRIPOD_BURST_CAP);
      out._hitPenalty = MMG_NO_TRIPOD_HIT_PENALTY;
      out.acc = (out.acc != null ? out.acc : 45) + MMG_NO_TRIPOD_ACC_DELTA;
    } else if (mounted && tripBurst != null) {
      out.burst = Math.max(out.burst || 1, tripBurst);
      if (tripCode === 'pl_113') out._hitBonus = 10;
    }

    if (usesBeltReserve(code) && !(u && u.def && u.def.isTank)) {
      out.usesBelt = true;
    }

    return out;
  }

  function getFireModes(w, u) {
    if (!w) return null;
    const code = w.code;
    if (u && unitHasTripod(u, code)) {
      const trip = getTripodCode(code);
      const tripBurst = trip ? TRIPOD_MOUNTED_BURST[trip] : null;
      const mounted = normalizeFireModes(tripBurst > 2 ? [2, tripBurst] : null);
      if (mounted) return mounted;
    }
    const fromItem = normalizeFireModes(w.modes);
    if (fromItem) return fromItem;
    return normalizeFireModes(FIRE_MODES[code]);
  }

  const api = {
    TRIPOD_CODE_FOR_MAIN,
    TRIPOD_ITEM_CODES,
    TRIPOD_LOADOUT_SLOT_MIN,
    TRIPOD_LOADOUT_SLOT_MAX,
    TRIPOD_WEIGHT_KG,
    MMG_CODES,
    BELT_FEED_CODES,
    BELT_RESERVE_ROUNDS,
    TRIPOD_MOUNTED_BURST,
    FIRE_MODES,
    getTripodCode,
    isTripodCode,
    isTripodLoadoutSlot,
    getMainWeaponCode,
    findTripodInLoadout,
    findTripodInBag,
    findEmptyTripodLoadoutSlot,
    unitHasTripod,
    unitCarriesTripod,
    tripodMatchesMain,
    canPlaceItemInSlot,
    validateLoadoutState,
    validateItemPlacement,
    validateEquipmentSwap,
    getItemWeightKg,
    usesBeltReserve,
    isMmgCode,
    getDefaultBeltReserve,
    applyItemDefaults,
    enrichWeaponForCombat,
    getFireModes,
    normalizeFireModes,
  };

  global.PlMgTripod = api;
  global.TRIPOD_CODE_FOR_MAIN = TRIPOD_CODE_FOR_MAIN;
})(typeof window !== 'undefined' ? window : globalThis);
