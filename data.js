/** DATA: Unit Templates, Weapons, Terrain, and New Attributes */

// ◆フェーズ1: 属性定義
const ATTR = {
    MILITARY: 'Military forces', // 兵力
    SUPPORT: 'Fire support',     // 火力支援
    WEAPON: 'Weaponry',          // 武器類
    RECOVERY: 'Recovery'         // 回復
};

const SKILLS = {
    "Sniper": { name: "狙撃手", desc: "射程+2 / 命中+15%" },
    "Scout": { name: "偵察", desc: "移動力+1 / 視界+2" },
    "Medic": { name: "衛生兵", desc: "治療効果+50%" },
    "Mechanic": { name: "工兵", desc: "修理速度2倍" },
    "CQC": { name: "近接格闘", desc: "白兵戦ダメージ+20% / 反撃" },
    "Hero": { name: "英雄", desc: "全ステータス+1 / 士気高揚" }
};

// 武器・アイテム定義
// weight: lbs (ポンド)
const WPNS = {
    // --- 既存武器 ---
    'unarmed': { name: "素手", type: "melee", rng: 1, dmg: 5, ap: 2, acc: 80, weight: 0, attr: ATTR.WEAPON },
    'rifle':   { name: "Kar98k", type: "bullet", rng: 5, dmg: 40, ap: 3, acc: 90, cap: 5, rld: 2, mag: 3, weight: 9, attr: ATTR.WEAPON },
    'smg':     { name: "MP40", type: "bullet", rng: 3, dmg: 25, ap: 3, acc: 70, cap: 32, rld: 2, burst: 3, mag: 3, weight: 9, attr: ATTR.WEAPON },
    'mg':      { name: "MG42", type: "bullet", rng: 5, dmg: 35, ap: 4, acc: 60, cap: 50, rld: 3, burst: 5, jam: 0.05, mag: 2, weight: 25, attr: ATTR.WEAPON },
    'sniper':  { name: "Kar98k Scope", type: "bullet", rng: 7, dmg: 90, ap: 4, acc: 95, cap: 5, rld: 2, mag: 2, weight: 11, attr: ATTR.WEAPON },
    'tank_gun':{ name: "75mm KwK 40", type: "shell", rng: 8, dmg: 120, ap: 2, acc: 85, cap: 1, rld: 1, area: 1, weight: 0, attr: ATTR.WEAPON },
    'tiger_gun':{ name: "88mm KwK 36", type: "shell_fast", rng: 9, dmg: 180, ap: 2, acc: 90, cap: 1, rld: 1, area: 1, weight: 0, attr: ATTR.WEAPON },

    // --- ◆フェーズ2: 迫撃砲パーツ & 弾薬 ---
    'mortar_barrel': { name: "M2 砲身", type: "part", partType: "barrel", weight: 13, attr: ATTR.WEAPON },
    'mortar_bipod':  { name: "M2 二脚", type: "part", partType: "bipod", weight: 16, attr: ATTR.WEAPON },
    'mortar_plate':  { name: "M2 底板", type: "part", partType: "plate", weight: 13, attr: ATTR.WEAPON },
    
    // 合体後の仮想武器データ
    'm2_mortar': { name: "M2 60mm迫撃砲", type: "shell", rng: 10, minRng: 2, dmg: 150, ap: 4, acc: 70, cap: 1, rld: 2, area: 2, indirect: true, weight: 42, attr: ATTR.WEAPON },

    // 迫撃砲弾 (1枠で複数持てる)
    'mortar_shell_box': { name: "60mm榴弾箱", type: "ammo", ammoFor: "m2_mortar", cap: 10, current: 10, weight: 12, attr: ATTR.WEAPON, isConsumable: false },

    // --- その他 ---
    'grenade': { name: "M24型手榴弾", type: "shell", rng: 3, dmg: 80, ap: 3, acc: 60, area: 1, isConsumable: true, weight: 1, attr: ATTR.WEAPON },
    'faust':   { name: "Panzerfaust", type: "rocket", rng: 2, dmg: 200, ap: 4, acc: 80, isConsumable: true, weight: 14, attr: ATTR.WEAPON }
};

// 弾倉バリエーション
const MAG_VARIANTS = {
    'rifle': [{ name: 'Stripper Clip', cap: 5, jam: 0.01 }],
    'smg': [{ name: 'Box Mag', cap: 32, jam: 0.05 }],
    'mg': [{ name: 'Belt', cap: 50, jam: 0.05 }, { name: 'Drum', cap: 50, jam: 0.1 }],
    'sniper': [{ name: 'Match Grade', cap: 5, jam: 0.0 }]
};

const TERRAIN = {
    VOID: { id: -1, name: "VOID", cost: 99, cover: 0 },
    GRASS: { id: 0, name: "平地", cost: 1, cover: 0 },
    FOREST: { id: 1, name: "森林", cost: 2, cover: 20 },
    TOWN: { id: 2, name: "市街地", cost: 1, cover: 30 },
    DIRT: { id: 3, name: "荒地", cost: 1, cover: 10 },
    WATER: { id: 5, name: "水面", cost: 99, cover: 0 }
};

// ユニットテンプレート
const UNIT_TEMPLATES = {
    'rifleman': { name: "小銃兵", role: "infantry", hp: 100, ap: 4, main: 'rifle', sub: 'grenade', opt: null, weight: 0, attr: ATTR.MILITARY },
    'scout':    { name: "偵察兵", role: "infantry", hp: 80, ap: 5, main: 'smg', sub: null, opt: null, stats: { mob: 2, aim: 1 }, weight: 0, attr: ATTR.MILITARY },
    'gunner':   { name: "機関銃手", role: "infantry", hp: 120, ap: 3, main: 'mg', sub: null, opt: null, stats: { str: 2 }, weight: 0, attr: ATTR.MILITARY },
    'sniper':   { name: "狙撃兵", role: "infantry", hp: 70, ap: 4, main: 'sniper', sub: null, opt: null, stats: { aim: 3 }, weight: 0, attr: ATTR.MILITARY },
    
    // ◆フェーズ2: デバッグ用 迫撃砲兵
    'mortar_gunner': { 
        name: "迫撃砲兵", 
        role: "infantry", 
        hp: 100, 
        ap: 3, 
        // 3つのパーツを装備
        hands: ['mortar_barrel', 'mortar_bipod', 'mortar_plate'], 
        // 弾薬箱を所持
        sub: 'mortar_shell_box', 
        opt: null, 
        weight: 0, 
        attr: ATTR.MILITARY 
    },

    'tank_pz4': { name: "IV号戦車", role: "tank", hp: 800, ap: 4, main: 'tank_gun', sub: null, isTank: true, weight: 0, attr: ATTR.MILITARY },
    'tank_tiger': { name: "VI号戦車", role: "tank", hp: 1200, ap: 3, main: 'tiger_gun', sub: null, isTank: true, weight: 0, attr: ATTR.MILITARY },
    
    // 支援カード
    'aerial': { name: "航空支援", role: "tactic", weight: 0, attr: ATTR.SUPPORT },
    'supply': { name: "補給物資", role: "tactic", weight: 0, attr: ATTR.RECOVERY }
};

const RANKS = ["Pvt", "Cpl", "Sgt", "Lt", "Cpt", "Maj"];
const FIRST_NAMES = ["Hans", "Fritz", "Karl", "Otto", "Heinz", "Paul", "Walter"];
const LAST_NAMES = ["Muller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer"];
