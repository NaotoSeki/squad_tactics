/** DATA: US Army Loadout & Mortar Definitions */

const HEX_SIZE = 54;
const MAP_W = 20;
const MAP_H = 20;

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
    TOWN:   { id: 4,  name: "廃墟", cost: 1,  cover: 40 },
    WATER:  { id: 5,  name: "水域", cost: 99, cover: 0 }
};

const RANKS = ["Pvt", "Pfc", "Cpl", "Sgt", "SSgt", "Lt", "Cpt"];
const FIRST_NAMES = ["John", "Mike", "Robert", "James", "William", "David", "Richard", "Joseph", "Thomas", "Charles", "Daniel", "Matthew", "Donald", "Paul", "George"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Jones", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor", "Anderson", "Thomas", "Jackson", "White", "Harris"];

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
    
    mg42: { name:"MG42", rng:8, acc:45, acc_drop:4, dmg:25, cap:50, mag:99, ap:2, rld:3, wgt:12, type:'bullet', burst:15, overRangePenalty:15, desc:"機関銃。", weight: 25, attr: ATTR.WEAPON },
    kwk: { name:"75mm KwK", rng:8, acc:70, acc_drop:2, dmg:150, cap:1, mag:99, ap:3, rld:0, wgt:0, type:'shell_fast', burst:1, overRangePenalty:4, desc:"戦車砲。", weight: 0, attr: ATTR.WEAPON },
    kwk88: { name:"88mm KwK36", rng:10, acc:85, acc_drop:1, dmg:250, cap:1, mag:99, ap:3, rld:0, wgt:0, type:'shell_fast', burst:1, overRangePenalty:3, desc:"重戦車砲。", weight: 0, attr: ATTR.WEAPON },

    'mortar_barrel': { name: "M2 Tube", type: "part", partType: "barrel", desc: "M2迫撃砲の砲身。", weight: 12.8, attr: ATTR.WEAPON },
    'mortar_bipod':  { name: "M2 Bipod", type: "part", partType: "bipod", desc: "M2迫撃砲の二脚。", weight: 16.4, attr: ATTR.WEAPON },
    'mortar_plate':  { name: "M2 Baseplate", type: "part", partType: "plate", desc: "M2迫撃砲の底板。", weight: 12.8, attr: ATTR.WEAPON },
    'm2_mortar': { name: "M2 60mm Mortar", type: "shell", rng: 12, minRng: 2, dmg: 150, ap: 4, acc: 65, cap: 1, burst: 1, modes:[1, 2], rld: 0, area: true, indirect: true, desc: "曲射弾道。", weight: 42, attr: ATTR.WEAPON },
    'mortar_shell_box': { name: "60mm Ammo Box", type: "ammo", ammoFor: "m2_mortar", cap: 12, current: 12, desc: "迫撃砲弾。", weight: 20, attr: ATTR.WEAPON, isConsumable: false }
};

const UNIT_TEMPLATES = {
    rifleman: { name:"Rifleman", role:"infantry", main:"m1", sub:"m1911", opt:"nade", stats:{str:5, aim:5, mob:5, mor:5}, weight: null, attr: ATTR.MILITARY },
    scout:    { name:"Scout", role:"infantry", main:"thompson", sub:"knife", opt:"nade", stats:{str:4, aim:4, mob:8, mor:6}, weight: null, attr: ATTR.MILITARY },
    gunner:   { name:"Gunner", role:"infantry", main:"bar", sub:"m1911", opt:null, stats:{str:8, aim:4, mob:3, mor:5}, weight: null, attr: ATTR.MILITARY },
    sniper:   { name:"Sniper", role:"infantry", main:"k98_scope", sub:"m1911", opt:null, stats:{str:3, aim:9, mob:4, mor:4}, weight: null, attr: ATTR.MILITARY },
    
    // 迫撃砲兵 (初期装備: パーツ3点 + 弾薬箱)
    mortar_gunner: { 
        name: "Mortar Gunner", 
        role: "infantry", 
        main: null,
        loadout: ['mortar_barrel', 'mortar_bipod', 'mortar_plate'],
        sub: "mortar_shell_box", 
        opt: "m1911", 
        stats: {str:6, aim:4, mob:3, mor:5}, 
        weight: null, 
        attr: ATTR.MILITARY 
    },

    tank_pz4: { name:"Panzer IV", role:"tank", main:"kwk", sub:"mg42", opt:null, hp:600, ap:5, isTank:true, weight: null, attr: ATTR.MILITARY },
    tank_tiger: { name:"Tiger I", role:"tank", main:"kwk88", sub:"mg42", opt:null, hp:1200, ap:4, isTank:true, isBoss:true, weight: null, attr: ATTR.MILITARY },
    aerial: { name:"AERIAL SPT", role:"TACTIC", main:null, sub:null, opt:null, hp:"N/A", ap:0, weight: null, attr: ATTR.SUPPORT }
};

const MAG_VARIANTS = {
    thompson: [ { name: "20rd Box", code: "45ACP20T", cap: 20, cost: 28, jam: 0.0 }, { name: "30rd Box", code: "45ACP30T", cap: 30, cost: 54, jam: 0.008 } ]
};
