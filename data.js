/** DATA: US Army Loadout & Mortar Definitions */

/**
 * REALISM PACK — 「1兵の重み」「楽しい制約」「パワーインフレ回避」のための再調整フラグ群。
 * 個別に true/false で切替可能（false にすれば元の挙動にロールバック）。
 */
const REALISM_PACK = {
    /** 補充兵（セクター報酬の新兵）に経験不足ペナルティを与える */
    REPLACEMENT_PENALTY: true,
    /** HP 25%未満で「重傷」状態（最大AP-1, 命中-10%） */
    WOUNDED_STATE: true,
    /** 敵の主武器も有限弾（999発の無限弾を廃止） */
    ENEMY_FINITE_AMMO: true,
};

const HEX_SIZE = 54;
const MAP_W = 20;
const MAP_H = 20;

/**
 * バトルスケール切替（詳細は BATTLE_SCALE_NOTES.md）
 * 'standard' = 標準（classicとchaosの中間, 既定） / 'chaos' = ドンパチ / 'classic' = 従来の小規模戦
 */
const BATTLE_SCALE_PRESET = 'standard';
// const BATTLE_SCALE_PRESET = 'chaos';   // ドンパチに戻す
// const BATTLE_SCALE_PRESET = 'classic'; // 従来の小規模戦に戻す

/** Phase 0: 知略ダイヤル morph（false = 従来の離散プリセットのみ） */
const FEATURE_TACTICS_MORPH = true;

/**
 * ダイヤル明示値。null のとき BATTLE_SCALE_PRESET から TACTICS_DIAL_FROM_PRESET へ。
 * d1: 0=classic … 1=chaos | d2: 0=defence … 1=attack | d3: 0=冷静 … 1=狂気
 */
const TACTICS_DIAL = null;

/** Phase A: 同一ヘックス装備渡し（false = 無効化してロールバック） */
const FEATURE_SAME_HEX_TRANSFER = true;

/** 複数ターン行軍プラン（森など移動力不足時）。false = 従来（1ターン到達のみ） */
const FEATURE_EXTENDED_MARCH = true;
/** Tanks remain defined for future reactivation, but are temporarily unavailable in gameplay. */
const FEATURE_TANK_UNITS = false;
/** 行軍プラン表示・移動の最大ターン数 */
const MARCH_PLAN_MAX_TURNS = 5;

const BATTLE_SCALE_PRESETS = {
  classic: {
    HEX_UNIT_CAP: 5,
    HEX_MOVE_BLOCK: 4,
    ENEMY_BASE: 4,
    ENEMY_PER_SECTOR: 0.7,
    ALLIED_REINFORCEMENTS: 0,
    DEPLOY_CARD_MAX: 2,
    AUTO_ATTACKS_PER_ACTOR: 1,
    ENEMY_ATTACKS_IN_AUTO: 1,
    ENEMY_TANK_CHANCE: 0.1,
    ENEMY_TANK_CHANCE_PER_SECTOR: 0.1,
    ENEMY_TIGER_CHANCE: 0,
    ENEMY_TIGER_CHANCE_PER_SECTOR: 0,
  },
  /**
   * classic と chaos の中間（既定）。敵8体規模で「1兵の重み」を残しつつ、
   * RT混戦層は維持する。戦車レアリティは chaos寄りの低確率を維持。
   */
  standard: {
    HEX_UNIT_CAP: 7,
    HEX_MOVE_BLOCK: 6,
    ENEMY_BASE: 8,
    ENEMY_PER_SECTOR: 0.9,
    ALLIED_REINFORCEMENTS: 4,
    DEPLOY_CARD_MAX: 4,
    AUTO_ATTACKS_PER_ACTOR: 2,
    ENEMY_ATTACKS_IN_AUTO: 2,
    ENEMY_TANK_CHANCE: 0.02,
    ENEMY_TANK_CHANCE_PER_SECTOR: 0.012,
    ENEMY_TIGER_CHANCE: 0.004,
    ENEMY_TIGER_CHANCE_PER_SECTOR: 0.003,
    /** feat/rt-tactics-fusion: 混戦リアルタイム層（chaosと同じ設定を継続） */
    RT_SIMULTANEOUS_AI: true,
    RT_DEFAULT_STANCE: 'prone',
    RT_DAMAGE_MULT: 0.72,
    RT_HIT_PENALTY: 14,
    RT_AI_WAVES: 5,
    RT_PARALLEL_FIRE_RATE: 14,
    RT_MOVE_STEP_MS: 22,
    RT_WAVE_GAP_MS: 35,
    RT_TURN_DELAY_MS: 500,
    RT_STAGGER_MIN_MS: 90,
    RT_STAGGER_MAX_MS: 480,
    RT_LOW_AMMO_RATIO: 0.35,
    /** 弾薬の緊張感（consumeAmmoで適用、ターン制/RT共通） */
    ammoBurnMult: 1.1,
  },
  chaos: {
    HEX_UNIT_CAP: 10,
    HEX_MOVE_BLOCK: 8,
    ENEMY_BASE: 14,
    ENEMY_PER_SECTOR: 1.2,
    ALLIED_REINFORCEMENTS: 8,
    DEPLOY_CARD_MAX: 8,
    AUTO_ATTACKS_PER_ACTOR: 3,
    ENEMY_ATTACKS_IN_AUTO: 2,
    ENEMY_TANK_CHANCE: 0.02,
    ENEMY_TANK_CHANCE_PER_SECTOR: 0.012,
    ENEMY_TIGER_CHANCE: 0.004,
    ENEMY_TIGER_CHANCE_PER_SECTOR: 0.003,
    /** feat/rt-tactics-fusion: 混戦リアルタイム層 */
    RT_SIMULTANEOUS_AI: true,
    RT_DEFAULT_STANCE: 'prone',
    RT_DAMAGE_MULT: 0.72,
    RT_HIT_PENALTY: 14,
    RT_AI_WAVES: 5,
    RT_PARALLEL_FIRE_RATE: 14,
    RT_MOVE_STEP_MS: 22,
    RT_WAVE_GAP_MS: 35,
    RT_TURN_DELAY_MS: 500,
    RT_STAGGER_MIN_MS: 90,
    RT_STAGGER_MAX_MS: 480,
    RT_LOW_AMMO_RATIO: 0.35,
  },
};

function resolveBattleScale() {
  const key = (typeof BATTLE_SCALE_PRESET === 'string' && BATTLE_SCALE_PRESETS[BATTLE_SCALE_PRESET])
    ? BATTLE_SCALE_PRESET
    : 'chaos';

  // 'standard' など classic/chaos 以外のプリセットは、ダイヤル明示値が無い限り
  // morphBattleScale（常に classic↔chaos間で補間）を経由せず定義値をそのまま採用する。
  const hasExplicitDial = (typeof TACTICS_DIAL !== 'undefined' && TACTICS_DIAL !== null);
  if (key !== 'classic' && key !== 'chaos' && !hasExplicitDial) {
    return Object.assign({ _preset: key }, BATTLE_SCALE_PRESETS[key]);
  }

  if (typeof FEATURE_TACTICS_MORPH !== 'undefined' && FEATURE_TACTICS_MORPH
      && typeof morphWithResonance === 'function') {
    const dial = (typeof resolveTacticsDial === 'function')
      ? resolveTacticsDial(TACTICS_DIAL, key)
      : { d1: 1, d2: 0.5, d3: 0.5 };
    return morphWithResonance(dial.d1, dial.d2, dial.d3, BATTLE_SCALE_PRESETS);
  }

  return Object.assign({ _preset: key }, BATTLE_SCALE_PRESETS[key]);
}

const BATTLE_SCALE = resolveBattleScale();

/** 自軍ポートレート最大枚数（asset/portraits/inf_us_001.jpg 〜 inf_us_NNN.jpg）。画像を追加するときはこの数までファイルを置けばよい。 */
const PORTRAIT_MAX = 99;
/** 実際に存在するポートレート画像枚数（この範囲でランダム・preload するため 404 を防ぐ）。 */
const PORTRAIT_AVAILABLE = 7;

const ATTR = {
    MILITARY: 'Military forces', 
    SUPPORT: 'Fire support',     
    WEAPON: 'Weaponry',          
    RECOVERY: 'Recovery'         
};

const TERRAIN = {
    VOID:   { id: -1, name: "---",  cost: 99, cover: 0 },
    DIRT:   { id: 0,  name: "荒地", cost: 1,  cover: 0 },
    GRASS:  { id: 1,  name: "草原", cost: 1,  cover: 10 },
    FOREST: { id: 2,  name: "森林", cost: 2,  cover: 25 },
    ROAD:   { id: 3,  name: "道路", cost: 1,  cover: 35 },
    TOWN:   { id: 4,  name: "廃墟", cost: 1,  cover: 40 },
    WATER:  { id: 5,  name: "水域", cost: 99, cover: 0 }
};

const RANKS = ["Pvt", "Pfc", "Cpl", "Sgt", "SSgt", "Lt", "Cpt"];
const FIRST_NAMES = [
    "John", "Mike", "Robert", "James", "William", "David", "Richard", "Joseph", "Thomas", "Charles",
    "Daniel", "Matthew", "Donald", "Paul", "George", "Edward", "Frank", "Henry", "Jack", "Raymond",
    "Walter", "Harold", "Albert", "Arthur", "Eugene", "Ralph", "Howard", "Carl", "Louis", "Roy",
    "Samuel", "Ernest", "Lawrence", "Stanley", "Norman", "Russell", "Fred", "Clarence", "Herman", "Chester",
    "Leonard", "Lloyd", "Leo", "Victor", "Benjamin", "Sam", "Philip", "Milton", "Alfred", "Vincent",
    "Francis", "Marvin", "Anthony", "Gerald", "Kenneth", "Ray", "Gordon", "Warren", "Billy", "Bobby"
];
const MIDDLE_NAMES = [
    "Lee", "Ray", "Dean", "Earl", "Alan", "Wayne", "Gene", "Dale", "Glen", "Jay",
    "Roy", "Allen", "Edwin", "Fred", "Grant", "Hugh", "Ira", "Kent", "Lynn", "Max",
    "Neil", "Owen", "Reed", "Scott", "Troy", "Wade", "Bruce", "Clyde", "Dwight", "Ellis",
    "Floyd", "Guy", "Homer", "Ivan", "Jesse", "Keith", "Lance", "Miles", "Noah", "Otis"
];
const LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Jones", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor",
    "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Garcia", "Robinson", "Clark",
    "Rodriguez", "Lewis", "Lee", "Walker", "Hall", "Allen", "Young", "King", "Wright", "Scott",
    "Green", "Baker", "Adams", "Nelson", "Carter", "Mitchell", "Roberts", "Turner", "Phillips", "Campbell",
    "Parker", "Evans", "Edwards", "Collins", "Stewart", "Morris", "Murphy", "Cook", "Rogers", "Morgan",
    "Peterson", "Cooper", "Reed", "Bailey", "Bell", "Gomez", "Kelly", "Howard", "Ward", "Cox"
];

/** ミドルネーム付きになる確率（残りは「名 姓」の2語のみ） */
const MIDDLE_NAME_CHANCE = 0.38;

/** ランダムな兵士名。ミドルネーム無し（例: John Smith）も混在する */
function generateSoldierName() {
    const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    if (typeof MIDDLE_NAMES !== 'undefined' && MIDDLE_NAMES.length && Math.random() < MIDDLE_NAME_CHANCE) {
        const mid = MIDDLE_NAMES[Math.floor(Math.random() * MIDDLE_NAMES.length)];
        if (Math.random() < 0.35) return `${first} ${mid.charAt(0)}. ${last}`;
        return `${first} ${mid} ${last}`;
    }
    return `${first} ${last}`;
}
if (typeof window !== 'undefined') window.generateSoldierName = generateSoldierName;

const SKILLS = {
    "Precision": { name: "精密", desc: "命中+15%" },
    "Radio":     { name: "通信", desc: "支援効果UP" },
    "Ambush":    { name: "隠密", desc: "回避+15%" },
    "AmmoBox":   { name: "弾薬", desc: "予備弾数UP" },
    "HighPower": { name: "強装", desc: "Dmg+20%" },
    "Mechanic":  { name: "修理", desc: "毎ターン回復" },
    "Armor":     { name: "防弾", desc: "被ダメ-5" },
    "Hero":      { name: "英雄", desc: "AP+1" },
    "CQC":       { name: "白兵", desc: "近接反撃" }
};

/** マップ上バッジ表示用（スキルID → アイコン・色） */
const SKILL_STYLES = {
    "Precision": { icon: "🎯", col: "#4a9" },
    "Radio":     { icon: "📻", col: "#6af" },
    "Ambush":    { icon: "🌙", col: "#663" },
    "AmmoBox":   { icon: "📦", col: "#c84" },
    "HighPower": { icon: "💥", col: "#d44" },
    "Mechanic":  { icon: "🔧", col: "#8a8" },
    "Armor":     { icon: "🛡", col: "#88c" },
    "Hero":      { icon: "⭐", col: "#dc4" },
    "CQC":       { icon: "⚔", col: "#a6a" }
};

const WPNS = {
    m1: { name:"M1 Garand", rng:7, acc:85, acc_drop:3, dmg:76, cap:8, mag:6, ap:2, rld:1, wgt:4, type:'bullet', burst:2, overRangePenalty:10, desc:"米軍主力小銃。", weight: 9.5, attr: ATTR.WEAPON },
    thompson: { name:"M1A1 SMG", rng:5, acc:60, acc_drop:4, dmg:41, cap:30, mag:4, ap:2, rld:1, wgt:5, type:'bullet', burst:3, modes:[3, 7], overRangePenalty:22, desc:"近距離制圧用。", weight: 10, attr: ATTR.WEAPON },
    k98_scope: { name:"M1903 Scope", rng:9, acc:95, acc_drop:3, dmg:72, cap:5, mag:5, ap:2, rld:2, wgt:5, type:'bullet', burst:1, overRangePenalty:10, desc:"精密狙撃銃。", weight: 9, attr: ATTR.WEAPON },
    bar: { name:"M1918 BAR", rng:7, acc:55, acc_drop:3, dmg:45, cap:20, mag:5, ap:2, rld:2, wgt:9, type:'bullet', burst:2, modes:[2, 5], overRangePenalty:10, desc:"分隊支援火器。", weight: 19, attr: ATTR.WEAPON }, 
    m1911: { name:"Colt M1911", rng:3, acc:70, acc_drop:10, dmg:30, cap:7, mag:3, ap:2, rld:1, wgt:1, type:'bullet', burst:1, overRangePenalty:25, desc:"45口径拳銃。", weight: 2.4, attr: ATTR.WEAPON },
    luger: { name:"Luger P08", rng:3, acc:75, acc_drop:10, dmg:25, cap:8, mag:2, ap:2, rld:1, wgt:1, type:'bullet', burst:1, overRangePenalty:25, desc:"将校の拳銃。", weight: 1.9, attr: ATTR.WEAPON },
    knife: { name:"Combat Knife", rng:1, acc:90, dmg:35, cap:0, mag:0, ap:1, rld:0, wgt:0, type:'melee', burst:1, desc:"白兵戦用。", weight: 1, attr: ATTR.WEAPON },
    nade: { name:"Mk2 Grenade", rng:4, acc:60, dmg:80, cap:1, mag:2, ap:2, rld:0, wgt:1, type:'shell', area:true, desc:"破片手榴弾。", weight: 1.3, attr: ATTR.WEAPON },
    m8_rocket: { name:"M8 Rocket", rng:12, acc:50, dmg:45, cap:60, current:60, mag:60, ap:3, rld:0, wgt:0, type:'rocket', area:true, areaHexes:7, desc:"カリオペ風ロケット斉射。", weight: 0, attr: ATTR.WEAPON },
    
    mg42: { name:"MG42", rng:8, acc:45, acc_drop:4, dmg:25, cap:50, mag:99, ap:2, rld:3, wgt:12, type:'bullet', burst:10, modes:[2, 10], overRangePenalty:15, desc:"機関銃。", weight: 25, attr: ATTR.WEAPON },
    kwk: { name:"75mm KwK", rng:8, acc:70, acc_drop:2, dmg:150, cap:1, mag:99, ap:3, rld:0, wgt:0, type:'shell_fast', burst:1, overRangePenalty:4, desc:"戦車砲。", weight: 0, attr: ATTR.WEAPON },
    kwk88: { name:"88mm KwK36", rng:10, acc:85, acc_drop:1, dmg:250, cap:1, mag:99, ap:3, rld:0, wgt:0, type:'shell_fast', burst:1, overRangePenalty:3, desc:"重戦車砲。", weight: 0, attr: ATTR.WEAPON },

    // FM/TM figures are 12.8/16.4/12.8 lb, converted here to kilograms.
    'mortar_barrel': { name: "M2 Tube", type: "part", partType: "barrel", desc: "M2迫撃砲の砲身。", weight: 5.8, attr: ATTR.WEAPON },
    'mortar_bipod':  { name: "M2 Bipod", type: "part", partType: "bipod", desc: "M2迫撃砲の二脚。", weight: 7.4, attr: ATTR.WEAPON },
    'mortar_plate':  { name: "M2 Baseplate", type: "part", partType: "plate", desc: "M2迫撃砲の底板。", weight: 5.8, attr: ATTR.WEAPON },
    'm2_mortar': { name: "M2 60mm Mortar", type: "shell", rng: 12, minRng: 2, dmg: 190, ap: 4, acc: 68, acc_drop: 2, cap: 1, burst: 1, modes:[1, 2], rld: 0, area: true, indirect: true, blastRadius: 1, splashScale: 0.45, desc: "曲射弾道。", weight: 42, attr: ATTR.WEAPON },
    'mortar_shell_box': { name: "60mm Ammo Box", type: "ammo", ammoFor: "m2_mortar", cap: 12, current: 12, desc: "迫撃砲弾。", weight: 22.2, attr: ATTR.WEAPON, isConsumable: false }
};

/** 能力値8種（1〜10）。行動=AP, 速度=移動ヘックス, 筋力=装備重量, 士気=命中等, 射撃/投擲/白兵/索敵 */
const PARAM_KEYS = ['action', 'speed', 'str', 'morale', 'aim', 'throw', 'melee', 'recon'];
/** レーダーチャート軸ラベル（PARAM_KEYS と同順） */
const PARAM_LABELS = ['act', 'spd', 'str', 'mrl', 'aim', 'thw', 'mle', 'rcn'];

/**
 * PARAM_KEYS の参照を統一するヘルパー。data.js 未読込時のみフォールバック配列を返す。
 * フォールバック配列はここ1箇所のみに定義。
 * @returns {string[]}
 */
window.getParamKeys = function() {
    return (typeof PARAM_KEYS !== 'undefined') ? PARAM_KEYS : ['action', 'speed', 'str', 'morale', 'aim', 'throw', 'melee', 'recon'];
};

/**
 * window.gameLogic.getVirtualWeapon への参照を統一するヘルパー。
 * gameLogic 未初期化時やメソッド未定義時は null を返す。
 * @param {Object} u - ユニット
 * @returns {Object|null}
 */
window.getCurrentWeapon = (u) => (window.gameLogic && window.gameLogic.getVirtualWeapon) ? window.gameLogic.getVirtualWeapon(u) : null;

/**
 * 武器名を返す薄いAPI。WPNS未定義/code未登録なら code（あれば）か '—' を返す。
 * 表示用途限定（戦闘ロジック内の WPNS 直接参照は対象外）。
 * @param {string} code - 武器コード
 * @returns {string}
 */
function getWeaponName(code) {
    if (typeof WPNS === 'undefined' || !code || !WPNS[code]) return code || '—';
    return WPNS[code].name;
}

/**
 * ユニットテンプレートの主武器名を返す薄いAPI。
 * main が未設定でも loadout（迫撃砲一式）がある場合は 'M2 Mortar'、それ以外は '—'。
 * @param {string} templateKey - UNIT_TEMPLATES のキー
 * @returns {string}
 */
function getTemplateMainWeaponName(templateKey) {
    const t = UNIT_TEMPLATES[templateKey];
    if (!t) return '—';
    if (t.main) return getWeaponName(t.main);
    return t.loadout ? 'M2 Mortar' : '—';
}

/**
 * レーダーチャート用の座標を共通計算（初期画面 canvas / 右ペイン Phaser で共用）。
 * 中心は (0,0)、半径 r のローカル座標で返す。呼び出し側で (cx, cy) を足して使用。
 * @param {Object} params - 能力値 { action, speed, ... }
 * @param {string[]} paramKeys - キー順（通常 PARAM_KEYS）
 * @param {number} radius - レーダー半径
 * @param {number} [labelOffset=8] - ラベルを軸先から外す距離
 * @returns {{ points: {x:number,y:number}[], labelPositions: {x:number,y:number}[], angles: number[] }}
 */
function getRadarPoints(params, paramKeys, radius, labelOffset) {
    const offset = labelOffset != null ? labelOffset : 8;
    const keys = paramKeys || PARAM_KEYS;
    const points = [];
    const labelPositions = [];
    const angles = [];
    for (let i = 0; i < keys.length; i++) {
        const angle = -Math.PI / 2 + (i / keys.length) * 2 * Math.PI;
        angles.push(angle);
        const v = Math.max(0, Math.min(10, params[keys[i]] != null ? params[keys[i]] : 5));
        const r = (v / 10) * radius;
        points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
        labelPositions.push({
            x: Math.cos(angle) * (radius + offset),
            y: Math.sin(angle) * (radius + offset)
        });
    }
    return { points, labelPositions, angles };
}

/**
 * 小銃 -> その銃に**実際に適合する**銃擲弾（PL実データ由来。捏造しない）。
 *
 * 出典は `data/pl_cbe_ammo_truth.json` の weapons[].pipeline.aux。M1 Rifle(cbeIdx 8)
 * の aux スロットは 245 "Mk2 GPA" / 246 "Mk2 Grd" / 251 "John Byt"(銃剣) で、
 * このうち擲弾は前2つ。適合しない銃には銃擲弾を持たせない — 「持てるはずのない
 * 装備が生えている」を作らないための表。
 */
const RIFLE_GRENADE_FOR_MAIN = {
    m1: ['pl_246', 'pl_245'],   // Mk2 Grd / Mk2 GPA（軽い方を既定に）
};

const UNIT_TEMPLATES = {
    rifleman: {
        name:"Rifleman", role:"infantry", main:"m1", sub:"m1911", opt:"nade", rifleGrenade:true,
        stats:{str:5, aim:5, mob:5, mor:5},
        params: { action:5, speed:5, str:5, morale:5, aim:5, throw:5, melee:5, recon:4 },
        weight: null, attr: ATTR.MILITARY
    },
    scout: {
        name:"Scout", role:"infantry", main:"thompson", sub:"knife", opt:"nade",
        stats:{str:4, aim:4, mob:8, mor:6},
        params: { action:4, speed:8, str:4, morale:6, aim:4, throw:5, melee:4, recon:7 },
        weight: null, attr: ATTR.MILITARY
    },
    gunner: {
        name:"Gunner", role:"infantry", main:"bar", sub:"m1911", opt:null,
        stats:{str:8, aim:4, mob:3, mor:5},
        params: { action:4, speed:3, str:8, morale:5, aim:4, throw:4, melee:6, recon:3 },
        weight: null, attr: ATTR.MILITARY
    },
    sniper: {
        name:"Sniper", role:"infantry", main:"k98_scope", sub:"m1911", opt:null,
        stats:{str:3, aim:9, mob:4, mor:4},
        params: { action:4, speed:4, str:3, morale:4, aim:9, throw:4, melee:3, recon:6 },
        weight: null, attr: ATTR.MILITARY
    },
    mortar_gunner: {
        name: "Mortar Gunner", role: "infantry", main: null,
        loadout: ['mortar_barrel', 'mortar_bipod', 'mortar_plate'],
        sub: "mortar_shell_box", opt: "m1911",
        stats: {str:6, aim:4, mob:3, mor:5},
        params: { action:4, speed:3, str:6, morale:5, aim:4, throw:5, melee:4, recon:4 },
        weight: null, attr: ATTR.MILITARY
    },
    tank_pz4: {
        name:"Panzer IV", role:"tank", main:"kwk", sub:"mg42", opt:null, hp:600, ap:5, isTank:true,
        params: { action:5, speed:4, str:10, morale:6, aim:6, throw:0, melee:0, recon:5 },
        weight: null, attr: ATTR.MILITARY
    },
    tank_tiger: {
        name:"Tiger I", role:"tank", main:"kwk88", sub:"mg42", opt:null, hp:1200, ap:4, isTank:true, isBoss:true,
        params: { action:4, speed:3, str:10, morale:6, aim:7, throw:0, melee:0, recon:5 },
        weight: null, attr: ATTR.MILITARY
    },
    aerial: { name:"AERIAL SPT", role:"TACTIC", main:null, sub:null, opt:null, hp:"N/A", ap:0, weight: null, attr: ATTR.SUPPORT }
};

const MAG_VARIANTS = {
    thompson: [ { name: "20rd Box", code: "45ACP20T", cap: 20, cost: 28, jam: 0.0 }, { name: "30rd Box", code: "45ACP30T", cap: 30, cost: 54, jam: 0.008 } ]
};

/**
 * SIM_TUNING — WS-A sim_core.js の数値パラメータ集約テーブル。
 * docs/SIM_CORE_SPEC.md §6 の表を転記。sim_core.js はこのテーブル参照のみでマジックナンバーを持たない。
 * 全値は「要プレイテスト」（仕様書注記どおり）。
 */
const SIM_TUNING = {
    TICK_MS: 100,
    DECISION_INTERVAL_T: 5,
    // 命令の寿命（2026-07-31）。TARGET は他の命令型と違い誰も消費しないので、
    // 放置すると永続し、その兵士は以後まったく自己判断しなくなる。下士官の
    // 「あいつを狙え」は永久命令ではない — 的が倒れるか、この時間で失効して
    // 兵は自分の判断へ戻る。§3.4「命令が届くまでの間、兵は自分のトレイトに
    // 従って行動する」が成立するには、無命令時間が実際に発生する必要がある。
    // 200 = 20秒。分隊長の再評価周期(25)とドクトリン冷却(100)より長く取り、
    // 「命令→遂行→やがて自分の判断へ」の周期が観察できる長さにしてある。
    ORDER_TARGET_EXPIRE_T: 200,

    // --- 命中・貫通は PL正本の武器統計を使う（2026-08-03 ディレクター指摘）---------
    //
    // 旧モデルは PHIT_BASE のクラス定数(0.058〜0.115)に ×3.0(露出)・×1.5(狙撃)・
    // ×6.0(側背) と**ボーナスを掛け上げる**構造だった。そのため:
    //   ・銃固有の命中率(PL: 45〜95)も距離低下率も威力も**一切使われていなかった**
    //   ・ルガーとガーランドの基本命中が同じ（PHIT_BASE に pistol が無く rifle へ落ちる）
    //   ・**1斉射＝命中判定1回**。MG42が10発撃ってもSMGが3発でも判定は1回で、
    //     「数撃てば当たる」が原理的に存在しなかった
    //
    // 構造を反転させ、**銃の命中率を上限として状況で減らす**形にした:
    //   pHit(1発) = 命中率(距離減衰込み)/100 × 状況（すべて ≤1）
    // 判定は発ごと。連射は当たる機会がその弾数だけ増える。
    //
    // 弾丸の威力は PL正本のモデルどおり**貫通力とその距離低下**で表す
    // （命中すれば必ず効く。どれだけ効くかが貫通力）。`melee_attack` は白兵専用で、
    // 弾丸の威力ではない。値は data/pl_weapon_stats.js（270挺）。
    // 統計を持たない武器は下の既定値へ落ちる（壊さないため）。
    PHIT_FALLBACK: { rifle: 70, smg: 75, mg: 65, sniper: 65, pistol: 88, at: 60 },
    PHIT_FALLBACK_DROP: { rifle: 6, smg: 12, mg: 8, sniper: 3, pistol: 14, at: 8 },
    PEN_FALLBACK: { rifle: 72, smg: 41, mg: 73, sniper: 76, pistol: 39, at: 150 },
    PEN_FALLBACK_DROP: { rifle: 3, smg: 4, mg: 3, sniper: 3, pistol: 5, at: 1 },
    // 射程を超えた分の追加減衰（PL の overRangePenalty 相当）。拳銃で7hex先に
    // 当たり続けるのを止める。
    PHIT_OVER_RANGE_DROP: 12,
    // 露出＝減衰なし(1.0)が基準。遮蔽は (1-cover) で引く。
    // 側背は遮蔽と伏せの両方を無効化する（背後からは体全体が見える）。
    PHIT_MOVER_TRACK: { mg: 1.0, default: 0.8 },
    // 側背の報酬: 確率は1.0で頭打ちなので、旧 PHIT_FLANK_MULT=6.0 のような
    // 「掛け上げ」は作れない。代わりに**側背は遮蔽と伏せの両方を無効化する**
    // （背後からは隠れる先も伏せる意味も無い）。遮蔽0.45＋伏せなら約3.3倍で、
    // 6倍よりは穏やかだが、地形modで遮蔽が濃くなったぶん実効差は大きい。
    // 1斉射で同一目標へ通せるダメージ弾数の上限。連射の弾は的の周りに散るので、
    // 全弾が一人へ吸い込まれるのは非現実的（MG42の10発が全部当たると即死する）。
    // 上限を超えた命中は制圧にだけ効く。
    MAX_DMG_HITS_PER_BURST: 3,

    // ---- 1トリガーの弾数モデル（2026-08-04）--------------------------------
    // **音源の実測値が正本。** ここが食い違うと「auto の音が30発鳴っているのに
    // 弾は2発しか減らない」という嘘になる（2026-08-04 まで実際そうだった。
    // 旧実装は WPNS.burst 固定の弾数で撃ち、音は fireMode だけで auto/burst を
    // 選んでいたので、両者が構造的に一致し得なかった）。
    // 実測は scripts/audio/count_rounds.py（オンセット検出＋自己相関）:
    //   mg42_auto 33.7発/1304rpm・mg42_burst 4.8発
    //   thompson_auto 30.6発/769rpm・thompson_burst 2〜3発
    //   stg44_auto 18.9発/448rpm・stg44_burst 2〜3発
    // レートが実銃の公称値（MG42 1200-1500 / Thompson 700 / StG44 500）と
    // 一致するので、この検出は信用してよい。
    ROUNDS_PER_PULL: {
        single: 1,
        // **基本はこれ。** 陸軍のマニュアルどおり短連射で撃つのが既定で、
        // 単射と掃射はそこからの逸脱として条件付きで選ばれる。
        burst: { rifle: 2, smg: 3, mg: 5, sniper: 1, pistol: 1, at: 1 },
        // 掃射＝弾倉を空にする勢い。撃てば当然すぐ弾切れ・装填になる。
        auto: { smg: 30, mg: 30, rifle: 20 },
    },
    // 構造上 auto が撃てるクラス。ボルト小銃・狙撃・拳銃は不可。rifle も既定は
    // 不可（M1 Garand は半自動）。StG44 のような自動小銃は下の表で個別に開ける。
    AUTO_CAPABLE: { smg: true, mg: true, rifle: false, sniper: false, pistol: false },
    WEAPON_AUTO_OVERRIDES: {},   // 武器コード -> true/false（クラス既定より優先）
    // auto へ上げる条件。基本がバーストである以上、ここは**例外の門**。
    AUTO_MIN_FOES_IN_HEX: 2,   // 同一hexに行動可能な敵がこれ以上＝浴びせる価値がある
    AUTO_MIN_ROUNDS: 8,        // 弾倉の残りがこれ未満なら auto へ上げない
    //（＝「最後の数発を掃射に使う」をさせない。音の側も8発以上を auto クリップの
    //   下限にしているので、この門は音と弾数の一致条件でもある）
    AUTO_SPILL_MAX_TARGETS: 3, // 掃射1回で弾が回る敵の上限（本来の的を含む）
    AUTO_SUPPRESS_MULT_CAP: 2.5, // 弾数比で伸びる制圧の上限（burst基準の倍率）
    // 射撃規律: 最終弾倉に入ったら単射へ落とす（§3.3 弾薬経済）
    DISCIPLINE_LAST_MAG_SINGLE: true,

    // 貫通力 -> HPダメージの換算。1.0 = 貫通力がそのまま効き目。
    // HP100・INCAP_AT_HP=25 なので、Kar98k(貫通72)はゼロ距離で1発が致命傷、
    // P08(貫通41)は2発で行動不能、という読み。**ここが致死性の主つまみ。**
    DMG_PER_PEN: 1.0,
    DMG_PEN_SPREAD: 0.18,
    // 赤ゲージ（HP25%以下）で行動不能。撃てず動けず、命令も受け付けない
    INCAP_AT_HP: 25,
    INCAP_DRAG_ALLOWED: false, // 将来の担送用。今は未使用
    // 姿勢。伏せは state ではなくフラグで、engage しながら伏せていられる
    PHIT_VS_PRONE: 0.55,   // 伏せた目標は当たりにくい
    PRONE_MOVE_MULT: 2.5,  // 匍匐前進の遅さ（立ち上がらずに動く時だけ効く）
    PRONE_STANDUP_T: 8,    // 立ち上がりに要するtick
    PRONE_DROP_UNDER_FIRE: true,
    // 集中射撃は「速くpinする道具」であって「殺す道具」ではない:
    // 同一目標を3人以上が同時射撃すると狙いが重複しpHitが逓減（制圧蓄積はフル）
    FOCUS_PHIT_PENALTY_PER_EXTRA: 0.15,
    FOCUS_PHIT_FLOOR: 0.4,
    PHIT_SHOOTER_SUPPRESSED_PINNED: { suppressed: 0.5, pinned: 0.25 },
    // 狙って撃つのが基準(1.0)。制圧射撃は当てにいかない
    PHIT_AIMED: 1.0,
    PHIT_SUPPRESS_MODE: 0.55,
    CRIT_EXPOSED: 0.005,

    DMG_HIT: { base: 40, spread: 20 },

    SUPPRESS_PER_BURST: { rifle: 8, smg: 10, mg: 22, sniper: 15 },
    SUPPRESS_DECAY: 6, // /秒（静穏3秒後から）
    // 制圧値の1秒あたり加算上限（2026-07-30）。集中射撃で複数人が同一目標へ撃つと
    // 素の加算では 0→100 が一瞬で、ゲージが二値になっていた（§7.4 基準1
    // 「制圧ゲージが観察できる」に反する）。26 なら PINNED(80) まで最短約3秒かかり、
    // suppressed(50) を経由する中間帯が生まれて自衛の反射も効くようになる。
    // 単発の武器差(SUPPRESS_PER_BURST)は従来どおり効く（mg22 は1バーストで通る）。
    SUPPRESS_MAX_PER_SEC: 26,
    SUPPRESSED_AT: 50,
    PINNED_AT: 80,
    // 自動Cover（反射／2026-07-30）: 制圧 [COVER_SEEK_AT, PINNED_AT) の帯で、
    // 現在地の遮蔽が COVER_SEEK_MAX_COVER 未満なら隣接のより濃い遮蔽へ自発退避する。
    // PINNED 以上は伏せたまま動かない（NORTH_STAR §3.2「自衛のみ」）。
    // 命令があっても自衛は割り込む（sim_core が selfPreserve を別途参照）。
    //
    // 実測調整（2026-07-30、PS seed 3102 で観察）:
    // - AT=50 だと発火しなかった。制圧値は実戦だと 0 か 100 に張り付き、[50,80) を
    //   ほぼ通過しない。30 にして「初弾が来た時点で動く」= 制圧されきる前に退避させる。
    //   timid の FREEZE_AT_SUPPRESSION(40) との間に窓ができ、性格差も出る。
    // - MIN_GAIN=0.2 も過大だった。地形の遮蔽値は圧縮されていて
    //   （草0.10 / 畑0.15 / 林0.25 / 道0.35 / 町0.40）、**畑から林へ移る**という
    //   最も自然な行動が +0.10 しかなく弾かれていた。0.10 なら通り、
    //   草→畑(+0.05)のような無意味な移動は依然弾く。
    // 主トリガ: 最後に撃たれてから何tick以内なら「今撃たれている」とみなすか。
    // 30tick = 3秒(100ms/tick)。制圧値の帯(COVER_SEEK_AT)は補助トリガとして残す。
    COVER_SEEK_UNDER_FIRE_T: 30,
    COVER_SEEK_AT: 30,
    COVER_SEEK_MAX_COVER: 0.35,
    COVER_SEEK_MIN_GAIN: 0.10,
    // 遮蔽を探す最大距離(hex)。1hex先しか見ないと大きな畑の中では隣接6マスすべてが
    // 同じ薄い遮蔽で逃げ場が無く動けない（2026-07-30 実測）。PINNED 時は匍匐扱いで
    // 1hex に制限される（policy 側）。
    COVER_SEEK_MAX_STEPS: 4,
    // 経路途中の露出（2026-07-31）: 移動中の目標は hex の遮蔽を享受しないため
    // （PHIT_MOVING_MULT が遮蔽乗算を置き換える）、退避経路の安全性は「敵から
    // 見えているか」だけで決まる。見られている経路マスに遮蔽換算のコストを課し、
    // 遠回りで死角を通る／そもそも動かない、という判断を成立させる。
    // §3.2 殺傷ベクトル4「開豁地移動への持続射撃 = MGの存在意義」の policy 側の対。
    // 0.05 = 敵1人(小銃)に1マス見られると遮蔽0.05相当を失う。MG3挺に3マス晒される
    // 経路は 0.05×2.5×9 = 1.125 相当となり、事実上どんな遮蔽でも割に合わなくなる。
    COVER_SEEK_EXPOSURE_COST: 0.05,
    COVER_SEEK_EXPOSURE_WEIGHT: { mg: 2.5, sniper: 2.0, default: 1.0 },
    // 露出計算に使う敵の上限（近い順）。LOS 呼び出し回数の上限を決める安全弁。
    COVER_SEEK_MAX_THREATS: 6,

    // 指示によるCover（2026-07-31 / §3.4 分隊長の采配）: 「遮蔽へ入れ」と命じる。
    // **行き先は指定しない** — どこへ入るかは現場の兵が決める（三現主義）。命令は
    // 伝達遅延を経て届くので、届いた頃には状況が変わっている可能性がある。
    TAKE_COVER_MIN_EXPOSED: 2,        // 露出した部下がこれ以上いたら分隊長が発令
    TAKE_COVER_COVER_MAX: 0.20,       // これ未満を「露出している」とみなす
    // 命令された移動は自衛の反射より危険を受け入れる。§3.4「命を守る本能と、
    // 組織として攻めねばならない重圧のせめぎあい」の数値表現。露出コストに掛ける
    // 係数で、1.0 なら反射と同じ慎重さ、0 なら射線を完全に無視して突っ込む。
    ORDERED_COVER_RISK_TOLERANCE: 0.5,
    ORDERED_COVER_MAX_STEPS: 6,       // 命令なら反射(4)より遠くまで行く

    // 士気（2026-08-04 改訂）。旧版は「近くで味方が死ぬたび -15」で坂を転げ落ち、
    // 一度崩れたら二度と戻らないザル実装だった。削る要因を減らし、回復を入れて、
    // 崩れる→退がる→立ち直る、が回るようにする。
    //   ・3hex内の味方戦死ペナルティは**廃止**（ディレクター判断）
    //   ・指揮官喪失は -25 → -15
    //   ・釘付けの間だけ削れ、解ければ 0.5 秒に 1 ずつ戻る
    MORALE_LEADER_DOWN: -15,
    MORALE_PINNED_DRAIN: -1,   // /秒（釘付けの間だけ）
    MORALE_RECOVER: 2,         // /秒（釘付けが解けている間 = 0.5秒に1）
    // 30 を切ったら敗走。確率判定ではなく確定で、下回った時点で崩れる。
    ROUT_CHECK_BELOW: 30,
    // 立ち直る閾値。割れると 30 の境目で敗走と復帰が交互に出るので、上に離す。
    ROUT_RALLY_ABOVE: 45,
    // 敗走中の散開: 敵から離れる向きへ匍匐で退がる。1人ずつ向きをずらして
    // 「蜘蛛の子を散らす」ようにし、隊列のまま後退するのを防ぐ。
    ROUT_FALLBACK_HEX: 6,      // どこまで退がろうとするか（hex）

    RELOAD_T: { rifle: 30, smg: 30, mg: 80, sniper: 30 },
    SWITCH_T: 30,
    AIM_T: { aimed: 20, suppress: 8 },
    BURST_INTERVAL_T: {
        aimed: { rifle: 30, smg: 25, mg: 18, sniper: 30 },
        // suppress: 半分（sim_core側で aimed値の半分として算出）
    },

    // 弾薬経済: cap が無い互換武器だけ、旧「1マガジンで撃てるバースト数」から
    // 実弾数を復元する。本編武器は WPNS.cap を実弾数として使い、DEFAULT_MAGS は
    // 予備弾倉数（したがって総弾数は cap * (1 + DEFAULT_MAGS)）。
    BURSTS_PER_MAG: { rifle: 12, smg: 12, mg: 28, sniper: 10 },
    DEFAULT_MAGS: { rifle: 6, smg: 4, mg: 4, sniper: 6 },

    // 射撃規律（2026-07-04）: 敵が頭を下げている（制圧≥SUPPRESSED_AT）間は、
    // 近距離の脅威か移動中の的でない限り撃たない。放置=全員弾切れではなく
    // 「散発的な撃ち合いの膠着」へ（史実: 長時間戦闘は撃たない時間が支配的）
    DISCIPLINE_CLOSE_RNG: 2,          // この距離以内の敵は制圧中でも撃ってよい
    DISCIPLINE_LAST_MAG_COVER_MAX: 0.3, // 最終弾倉時、これ以上の遮蔽の的には撃たない
    HARASS_FIRE_P: 0.25,   // 制圧済みの敵への散発射撃確率（意思決定サイクル毎）
    BURST_JITTER: 0.25,    // バースト間隔の±ゆらぎ率（機械的な等間隔射撃を崩す）

    // 射撃のリズム（2026-07-31）。BURST_JITTER だけでは足りなかった。
    // 実測(scratch): Fano係数0.79 = ポアソン(完全ランダム)より**規則的**、
    // 無発砲の秒は180秒中14秒だけ、最長の沈黙2.0秒。10人が独立した等間隔
    // メトロノームを刻み、重なって毎秒2.5発の定常ノイズになっていた。
    // 実際の銃撃戦は「数発撃つ→様子を見る」の繰り返しで、沈黙が支配的。
    //
    // ①斉射と観測: FIRE_VOLLEY_BURSTS 発でひと区切りつけ、FIRE_OBSERVE_T 休む。
    //   これがバースト性(clustering)を作り、Fano を 1 より上へ押し上げる。
    FIRE_VOLLEY_BURSTS: { min: 2, max: 4 },
    FIRE_OBSERVE_T: { min: 40, max: 110 },   // 4〜11秒
    // ②制圧は手数も奪う: 従来は pHit だけを罰していたので、制圧されても発砲
    //   リズムが変わらず「撃ち合いの潮目」が生まれなかった。頭を下げている兵は
    //   撃つ回数自体が減る。これで一方が制圧されると火力が実際に細り、
    //   押す/押されるの波が出る（§3.2「火力は動きを止める道具」の時間表現）。
    FIRE_INTERVAL_SUPPRESSED_MULT: 2.0,
    FIRE_INTERVAL_PINNED_MULT: 4.0,

    // WS-F: sim_leader.js 分隊長AI + 影響ネットワーク（SIM_CORE_SPEC.md SS16）
    LEADER_ASSESS_INTERVAL_T: 25,     // 分隊長の意思決定周期（2.5秒）
    DOCTRINE_COOLDOWN_T: 100,         // 発令後の再発令禁止期間（10秒、命令スパム防止）
    PLAYER_ORDER_LOCK_T: 150,         // プレイヤー命令直後、分隊長AIが沈黙する期間（15秒）
    FALLBACK_CASUALTIES: 2,           // FALL_BACK 発火: 自軍死者がこの数以上
    FALLBACK_MORALE_BELOW: 50,        // FALL_BACK 発火: 自軍平均moraleがこの値未満
    FOCUS_MIN_SHOOTERS: 3,            // FOCUS_FIRE 発火: 射程内の味方数がこの数以上
    FOCUS_TARGET_COVER_MAX: 0.3,      // FOCUS_FIRE 発火: 敵の遮蔽がこの値未満（露出扱い）
    SUPPRESS_DOCTRINE_MIN_SUPPRESSED: 2, // SUPPRESS_FIRE 発火: 自軍の被制圧者数がこの数以上
    HOLDFIRE_QUIET_T: 300,            // HOLD_FIRE 発火: 交戦なし継続期間（30秒）
    HOLDFIRE_AMMO_BELOW: 0.4,         // HOLD_FIRE 発火: 分隊残弾率がこの値未満
    INFLUENCE_JOIN_FIRE_MULT: 2.0,    // 連鎖射撃: 周囲2名以上engageで散発射撃確率を倍加
    LEADER_STEADY_RADIUS: 2,          // 分隊長の存在: この距離内の兵が影響を受ける
    LEADER_STEADY_BONUS: 20,          // 分隊長の存在: timid凍結閾値への加算
    LEADER_STEADY_FIRE_MULT: 1.5,     // 分隊長の存在: 散発射撃確率の倍率

    // 攻勢ドクトリン（2026-08-02）。**これだけが「勝ちに行く」采配**で、他の
    // ドクトリン（後退・遮蔽・集中射撃・制圧・射撃中止）は全て受け身だった。
    // 制圧班が頭を下げさせ、その窓で突入班が仕留める — 火力と機動の二本立て。
    //   PUSH_MIN_AMMO       これ未満の残弾率では攻めない（撃ち尽くして止まらない）
    //   PUSH_MIN_SHOOTERS   制圧班に要る最低人数。これを割ると攻勢は成立しない
    //   PUSH_READY_RATIO    クラスタの何割が制圧されたら突入させるか
    //   PUSH_ASSAULT_MAX    突入班の人数上限（出しすぎると制圧が細る）
    //   PUSH_APPROACH_W     突入者選びで「経路の遮蔽」を何倍重く見るか（地形を読む係数）
    // 冷静な兵が斉射へ加わる閾値（2026-08-05）。周囲2hex以内でこの人数が
    // 交戦していれば、引きつけの保留を解いて撃ち始める。「冷静」は無駄弾を
    // 惜しむ性格であって、分隊が撃っている横で傍観する性格ではない。
    CALM_JOIN_VOLLEY_N: 2,

    // 采配リングの賞味期限（2026-08-05）。指した hex からこの距離内に生きた敵が
    // 居なくなったら、その采配は捨てて盤面から消す。名指しの的が生きている間は
    // リングがその的に追随する（古い hex を指したままにしない）。
    PLAN_STALE_RADIUS: 1,

    PUSH_MIN_AMMO: 0.3,
    PUSH_MIN_SHOOTERS: 2,
    PUSH_READY_RATIO: 0.5,
    PUSH_ASSAULT_MAX: 2,
    PUSH_APPROACH_W: 2.0,

    // 接敵前進。これが無いと両軍は視線の通らない距離で睨み合ったまま決着しない
    // （2026-08-02 実測: 9v9・9000tick で両軍とも無傷）。一度に詰めず躍進させる。
    ADVANCE_STEPS: 4,      // 1回の采配で寄る hex 数
    ADVANCE_COVER_W: 1.5,  // 経路選択で遮蔽を距離の何倍重く見るか（塀伝いに寄る）

    // 面制圧（2026-08-02）。「あの林を制圧しろ」= 個体ではなく地帯を撃つ。
    // **命中判定を行わない** ので、これで敵が減ることは無い。頭を下げさせて、
    // その隙に誰かが動くための道具（§3.2「火力は動きを止める道具」）。
    // 制圧値は着弾点から SUPPRESS_AREA_RADIUS 以内へ、単体射撃の SUPPRESS_AREA_MULT 倍。
    // 敵味方を問わず掛かる — 自分の弾で味方の頭を下げるのは面制圧の実際の代償。
    SUPPRESS_AREA_RADIUS: 1,
    SUPPRESS_AREA_MULT: 0.6,
    // 時間による失効は設けない。制圧は「指定hexに行動可能な敵が居る限り続ける」
    // 任務で、終わるのは①敵が居なくなった②弾が尽きた③射線を失った のいずれか。

    // 投擲・擲弾（§3.2 殺傷ベクトル2「手榴弾・迫撃砲 — 面制圧・遮蔽ごと排除」）。
    // **遮蔽が効かない**のがこの兵器の存在理由。撃ち合いでは絶対に落ちない遮蔽下の
    // 敵を、唯一まともに殺せる手段として設計する。代償は射程の短さ（＝接近する
    // 必要がある）と、信管の数秒（＝制圧できていない敵は逃げられる）と、携行数。
    //   prepT  構え〜投げるまで。この間は無防備
    //   fuseT  手を離れてから炸裂まで。長いほど相手に逃げる時間を与える
    //   radius 効果範囲(hex)。中心は全威力、外周は EDGE_FALLOFF 倍
    MUNITIONS: {
        grenade: {
            label: '手榴弾', rng: 3, prepT: 12, fuseT: 25, radius: 1,
            dmg: { base: 70, spread: 30 }, suppress: 60,
        },
        // 銃擲弾は遠いが装着に時間がかかる。撃ち合いを続けたまま使える兵器ではない
        rifle_grenade: {
            label: '銃擲弾', rng: 7, prepT: 32, fuseT: 8, radius: 1,
            dmg: { base: 55, spread: 25 }, suppress: 50,
        },
    },
    MUNITION_EDGE_FALLOFF: 0.55,  // 中心以外のhexが受ける威力・制圧の倍率

    GRENADE_RNG: 2,
    GRENADE_FUSE_T: 30,
    GRENADE_SUPPRESS: 60,
    GRENADE_DMG: { base: 70, spread: 30 },

    ASSAULT_WIN_VS_PINNED: 0.85,
    ASSAULT_WIN_VS_ACTIVE: 0.30,

    // 強襲（2026-08-02 ディレクター指示）。**特定ユニットの撃滅をゴールに、
    // 持ちうるあらゆる手段を使う**行動。リスクを取る（自衛の反射が働かない）。
    // 同一hexに複数居るなら全滅させるまで続く。
    //   MELEE_T        白兵の1回あたり所要
    //   NADE_MIN_COVER 相手がこの遮蔽以上なら、撃つより投げる
    //   LOST_RADIUS    見失った時、この距離内に敵が居なければ強襲解除
    //   SWAP_T         主武器が尽きた時、拳銃へ持ち替える時間
    ASSAULT_MELEE_T: 12,
    // 白兵（2026-08-03 ディレクター指示）。**同一ヘックスへ踏み込んでから**、
    // 手持ちで一番白兵攻撃力の高い武器を使い、speed の速い側から打ち合う。
    //   ダメージ = 武器の白兵攻撃力(PL melee_attack) × 本人の白兵能力値 × MELEE_DMG_SCALE
    // 小銃(5)×能力5 = 25 で、HP100・INCAP25 なら3撃で戦闘不能。
    // 銃剣付き(9)なら2撃。重機関銃(0)は振り回せないので素手へ落ちる。
    MELEE_DMG_SCALE: 1.0,
    MELEE_DMG_SPREAD: 0.2,
    MELEE_BARE_HANDS: 1,   // 殴れる物が何も無い時（重機関銃手など）
    ASSAULT_NADE_MIN_COVER: 0.25,
    ASSAULT_LOST_RADIUS: 4,
    // 接敵と見なす距離（2026-08-05 ディレクター定義「強襲は Attack Move」）。
    // 任務の的へ向かう道中、この距離まで寄った敵は的でなくても先に片付ける。
    // 脇を敵が通り過ぎるのに一発も撃たない、が起きなくなる。隣接(1)は射線が
    // 通らなくても接敵扱い（同じ生垣の中で鉢合わせている）。
    ASSAULT_CONTACT_RNG: 2,
    ASSAULT_SWAP_T: 20,
    // 撃滅を優先するので、通常の射撃規律（観測休止・弾薬節制）を外す
    ASSAULT_FIRE_INTERVAL_MULT: 0.7,

    // 迎撃（2026-08-04 ディレクター指摘「古い過去位置めがけて移動しちゃう」）。
    // 動いている目標へは、現在位置ではなく**着く頃に相手が居る位置**へ向かう。
    //   LEAD_MAX_T    先読みの上限（tick）。これ以上先の合流は当てにしない。
    //                 突撃の走行距離ぶん（数十hex）先まで見ないと、そもそも
    //                 「間に合う合流点」が視野に入らない。40 では 6hex 相当しか
    //                 見えず予測が一度も成立しなかった（2026-08-04 実測）。
    //                 **0 にすると予測が無効化され、従来の純追尾に戻る**
    //   LEAD_STALE_T  この tick 数 hex が変わらなければ「止まっている」とみなす
    //                 （そこへ向けて予測は線形に薄れていく）
    //   LEAD_EMA      速度の平滑化係数（0..1。大きいほど直近の一歩を信じる）
    ASSAULT_LEAD_MAX_T: 300,
    ASSAULT_LEAD_STALE_T: 30,
    ASSAULT_LEAD_EMA: 0.5,

    // 制圧（2026-08-02）。指定hexを制圧しつつ、見えている敵は着実に削る。
    // 反撃の隙を与えないよう持続射撃で、命中も取る（面制圧＝命中なし とは別物）。
    // 指定hexに**行動可能な**敵が居る限り継続し、居なくなれば自動解除される。
    SUPPRESS_HEX_SPILL: 0.5,   // 隣接hexへ回り込む制圧値の割合

    // ×地形コスト、×移動モード（下記）、×脚の速さ(ATTR_SPD_RANGE)。
    // 2026-08-03: 8 → 12（ディレクター指摘「重みが感じられない」）。ヘックス間隔は
    // √3·HEX_SIZE ≈ 93.5px なので、歩き 1.2秒/hex ＝ 約78px/s・走り 156px/s になる。
    // ここを触ると**戦術も動く**（開豁地を渡る間に浴びる弾数がそのまま増える）ので、
    // 見た目だけ遅くしたい時にこの値をいじらないこと — 描画側は所要時間から速度を
    // 逆算しており(UnitView._infantryStepPx)、片方だけずらすと兵士が論理位置から千切れる。
    MOVE_T_PER_HEX: 12,

    // 機動技術（2026-08-02 / SIM_CORE_SPEC §14 宿題2「crawl/dash の機動技術」）。
    // 移動を3モードに割る。速度と「渡る間の身の隠し方」がトレードオフになる:
    //   walk  — 従来の移動。遮蔽を失い(PHIT_MOVING_MULT)、等倍の時間だけ晒される
    //   rush  — 半分の時間で渡る = 浴びるバースト数が半分。ただし到着時に息が
    //           上がり、数秒は自分の照準が鈍る（PHIT_WINDED）
    //   crawl — 2.5倍遅いが**遮蔽を失わない**。伏せたままなので的も小さい
    //
    // 「開豁地をMGに見られながら渡る」時の危険量（浴びる弾数×1発の命中率）は
    //   walk 4.0 / rush 2.0 / 匍匐(林 cover0.4) 0.83
    // 逆に相手が小銃なら rush が最良（1.5 → 0.75）。**走るか這うかは、誰に
    // 見られているかで決まる** — §3.2 殺傷ベクトル4（MGの存在意義）に対する
    // 現実的な対抗手段を機動側に用意するのがこの表の狙い。
    MOVE_MODE_MULT: { walk: 1, rush: 0.5, crawl: 2.5 },
    RUSH_WINDED_T: 40,   // 突進の到着後、息が上がっている時間（4秒）
    PHIT_WINDED: 0.5,    // 息切れ中に自分が撃った時の命中率倍率

    // 移動の自動描き分け（2026-08-02 ディレクター指示）。
    // **プレイヤーは「移動」としか言わない。** 敵が居る戦場で「歩け」と命じるのは
    // 不自然で、遮蔽伝いに寄るか・様子を窺うか・開豁地を走り抜けるかは、その場に
    // 居る兵が1マスごとに決めること（§3.4 三現主義）。
    //   AUTO_MOVE_OPEN_COVER  これ未満の遮蔽を「開豁地」とみなす
    //   AUTO_MOVE_OBSERVE_T   遮蔽から開豁地へ出る前の様子見（しゃがんで窺う）
    //   AUTO_MOVE_STUMBLE_T   走行中に被弾した時、躓いて伏せるまでの硬直
    AUTO_MOVE_OPEN_COVER: 0.2,
    AUTO_MOVE_OBSERVE_T: 14,
    AUTO_MOVE_STUMBLE_T: 6,

    // 能力値の効き（params: speed / recon / str）。基準値5で等倍。
    //   spd 移動速度（速い兵は同じ距離を短時間で渡る）
    //   rcn 様子見の短さ（勘のいい兵は迷わず頃合いを掴む）
    //   str 息切れの短さ（体力のある兵は走ってもすぐ撃てる）
    ATTR_REF: 5,
    ATTR_SPD_RANGE: { min: 0.7, max: 1.4 },   // 移動所要時間の倍率（小さいほど速い）
    ATTR_RCN_RANGE: { min: 0.4, max: 1.6 },   // 様子見時間の倍率
    ATTR_STR_RANGE: { min: 0.5, max: 1.5 },   // 息切れ時間の倍率

    // 平野に突っ立たせない（2026-08-02 ディレクター指摘「いまだに平野に突っ立ってる
    // 兵士も多い」）。撃たれる前でも、敵に見られている開豁地に居るなら身を隠す。
    // 撃たれてから動くのでは遅い、というのが歩兵の常識。
    OPEN_GROUND_SEEK_COVER: true,
    OPEN_GROUND_COVER_MAX: 0.18,

    /** classifyWeapon() の自動判定を上書きしたい武器コードのみ列挙（既定は空） */
    WEAPON_CLASS_OVERRIDES: {},

    // WS-B: sim_orders.js（命令伝達コスト SS12 / NORTH_STAR SS3.4）
    COMMS_VOICE_RNG: 2, // 分隊長からこの距離以内 + LOS で声/手信号
    COMMS_VOICE_DELAY_T: 10, // 1秒
    COMMS_RUNNER_T_PER_HEX: 10, // 1秒/hex
    COMMS_RADIO_DELAY_T: 30, // 3秒（無線手のいる班、声より遠い場合のみ有利）
    COMMS_LEADER_DOWN_MULT: 3,
    COMMS_SHOCK_T: 300, // 30秒（分隊長死亡直後は配達自体を停止）

    // WS-G: sim_battle_adapter.js — 実地形(TERRAIN, data.js)id -> sim_core cover(0..1)。
    // TERRAIN.cover（0..40の相対スケール、logic_game.jsの命中式専用）とは別テーブル。
    // ディレクター指摘: 地形毎のcover定数調整はここで行う（sim_core側は参照のみ）。
    TERRAIN_COVER: {
        [-1]: 0,     // VOID（不使用マスだが安全側で0）
        0: 0.12,     // DIRT 荒地・開豁地
        1: 0.2,      // GRASS 草原
        2: 0.4,      // FOREST 森林
        3: 0.05,     // ROAD 道路（露出）
        4: 0.5,      // TOWN 廃墟・建物
        5: 0,        // WATER 水域（通行不可想定・cover概念なし）
    },

    // 視線遮蔽（2026-07-31）: hex 直線上の中間マスが持つ「遮光度」。累積が
    // LOS_BLOCK_THRESHOLD 以上になった時点で視線が通らなくなる。
    //
    // これが無い間、MapApi の hasLos は常に true だった。その状態では
    // 「射線を避ける」も「物陰に隠れる」も原理的に成立せず、§3.2 の側面機動・
    // MGの射線・§3.4 の「分隊長から2hex以内+LOSなら伝達1秒」が全て空回りする。
    //
    // FOREST=0.5 は「林の縁までは見えるが、2マス分の林越しには見えない」を作る。
    // 建物・廃墟は1枚で完全遮蔽。両端のマス（射手と目標）は数えない
    // ——自分の居る林から外は見えるし、林の中の敵も林の縁からなら見える。
    //
    // キーは **本編 TERRAIN の id 空間**（この上の TERRAIN_COVER と同じ空間だが、
    // TERRAIN_COVER 側のコメントは合成マップ時代の名前で書かれている点に注意）。
    // 実マップ(RuralV29Map)は TERRAIN を id 4/6/7 で拡張する:
    //   4=廃屋(cover40) / 6=建物(cost99,building) / 7=畑(cover15)
    // id 6 は building フラグでも強制遮蔽されるが、表にも明示しておく
    // （フラグの有無に実装が依存していると、地形追加時に静かに素通りする）。
    TERRAIN_SIGHT_BLOCK: {
        [-1]: 0,     // VOID 盤外（島の外側。遮蔽物ではないので通す）
        0: 0,        // 荒地
        1: 0,        // 草原
        2: 0.5,      // 森林 — 1枚は透け、2枚重なると遮る
        3: 0,        // 道路
        4: 1.0,      // 廃墟・廃屋
        5: 0,        // 水域
        6: 1.0,      // 建物（RuralV29Map 拡張）
        7: 0,        // 畑（RuralV29Map 拡張）
    },
    LOS_BLOCK_THRESHOLD: 1.0,
};
if (typeof module !== 'undefined' && module.exports) {
    module.exports.SIM_TUNING = SIM_TUNING;
}
if (typeof window !== 'undefined') {
    window.SIM_TUNING = SIM_TUNING;
    window.RIFLE_GRENADE_FOR_MAIN = RIFLE_GRENADE_FOR_MAIN;
}
