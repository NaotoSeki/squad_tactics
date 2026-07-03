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

    'mortar_barrel': { name: "M2 Tube", type: "part", partType: "barrel", desc: "M2迫撃砲の砲身。", weight: 12.8, attr: ATTR.WEAPON },
    'mortar_bipod':  { name: "M2 Bipod", type: "part", partType: "bipod", desc: "M2迫撃砲の二脚。", weight: 16.4, attr: ATTR.WEAPON },
    'mortar_plate':  { name: "M2 Baseplate", type: "part", partType: "plate", desc: "M2迫撃砲の底板。", weight: 12.8, attr: ATTR.WEAPON },
    'm2_mortar': { name: "M2 60mm Mortar", type: "shell", rng: 12, minRng: 2, dmg: 150, ap: 4, acc: 65, cap: 1, burst: 1, modes:[1, 2], rld: 0, area: true, indirect: true, desc: "曲射弾道。", weight: 42, attr: ATTR.WEAPON },
    'mortar_shell_box': { name: "60mm Ammo Box", type: "ammo", ammoFor: "m2_mortar", cap: 12, current: 12, desc: "迫撃砲弾。", weight: 20, attr: ATTR.WEAPON, isConsumable: false }
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

const UNIT_TEMPLATES = {
    rifleman: {
        name:"Rifleman", role:"infantry", main:"m1", sub:"m1911", opt:"nade",
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

    PHIT_BASE: { rifle: 0.04, smg: 0.05, mg: 0.05, sniper: 0.08 },
    PHIT_RANGE_FALLOFF: { near: 1.5, mid: 1.0, far: 0.5 },
    PHIT_EXPOSED_MULT: 3.0,
    // 移動中の目標はhexの遮蔽を享受しない。持続射撃できるMGだけが移動を強く罰する
    // （殺傷ベクトル4「開豁地移動へのMGの持続射撃」— critic検収 2026-07-03）
    PHIT_MOVING_MULT: { mg: 4.0, default: 1.5 },
    PHIT_FLANK_MULT: 6.0,
    // 集中射撃は「速くpinする道具」であって「殺す道具」ではない:
    // 同一目標を3人以上が同時射撃すると狙いが重複しpHitが逓減（制圧蓄積はフル）
    FOCUS_PHIT_PENALTY_PER_EXTRA: 0.15,
    FOCUS_PHIT_FLOOR: 0.4,
    PHIT_SHOOTER_SUPPRESSED_PINNED: { suppressed: 0.5, pinned: 0.25 },
    PHIT_AIMED: 1.5,
    PHIT_SUPPRESS_MODE: 0.6,
    CRIT_EXPOSED: 0.005,

    DMG_HIT: { base: 40, spread: 20 },

    SUPPRESS_PER_BURST: { rifle: 8, smg: 10, mg: 22, sniper: 15 },
    SUPPRESS_DECAY: 6, // /秒（静穏3秒後から）
    SUPPRESSED_AT: 50,
    PINNED_AT: 80,

    MORALE_CASUALTY_NEAR: -15, // 3hex内の味方死亡
    MORALE_LEADER_DOWN: -25,
    MORALE_PINNED_DRAIN: -1, // /秒
    ROUT_CHECK_BELOW: 30, // 5秒ごとに morale/100 判定

    RELOAD_T: { rifle: 30, smg: 30, mg: 80, sniper: 30 },
    SWITCH_T: 30,
    AIM_T: { aimed: 20, suppress: 8 },
    BURST_INTERVAL_T: {
        aimed: { rifle: 30, smg: 25, mg: 18, sniper: 30 },
        // suppress: 半分（sim_core側で aimed値の半分として算出）
    },

    // 弾薬経済（critic検収 2026-07-03）: magCap=実弾数の直流しを廃し、
    // 「1マガジンで撃てるバースト数」をクラス別に定義。MG（分隊火力の主柱）が
    // 8〜10分で先に沈黙し、小銃はリロード頻度で締まる配分。
    BURSTS_PER_MAG: { rifle: 12, smg: 12, mg: 28, sniper: 10 },
    DEFAULT_MAGS: { rifle: 6, smg: 4, mg: 4, sniper: 6 },

    GRENADE_RNG: 2,
    GRENADE_FUSE_T: 30,
    GRENADE_SUPPRESS: 60,
    GRENADE_DMG: { base: 70, spread: 30 },

    ASSAULT_WIN_VS_PINNED: 0.85,
    ASSAULT_WIN_VS_ACTIVE: 0.30,

    MOVE_T_PER_HEX: 8, // ×地形コスト、伏せ×2

    /** classifyWeapon() の自動判定を上書きしたい武器コードのみ列挙（既定は空） */
    WEAPON_CLASS_OVERRIDES: {},

    // WS-B: sim_orders.js（命令伝達コスト SS12 / NORTH_STAR SS3.4）
    COMMS_VOICE_RNG: 2, // 分隊長からこの距離以内 + LOS で声/手信号
    COMMS_VOICE_DELAY_T: 10, // 1秒
    COMMS_RUNNER_T_PER_HEX: 10, // 1秒/hex
    COMMS_RADIO_DELAY_T: 30, // 3秒（無線手のいる班、声より遠い場合のみ有利）
    COMMS_LEADER_DOWN_MULT: 3,
    COMMS_SHOCK_T: 300, // 30秒（分隊長死亡直後は配達自体を停止）
};
if (typeof module !== 'undefined' && module.exports) {
    module.exports.SIM_TUNING = SIM_TUNING;
}
if (typeof window !== 'undefined') {
    window.SIM_TUNING = SIM_TUNING;
}
