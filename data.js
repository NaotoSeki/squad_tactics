/** DATA: Unit & Weapon Definitions */

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

const SKILL_STYLES = {
    "Precision": { col: "#2a6", icon: "🎯", name: "AIM" },
    "Radio":     { col: "#36c", icon: "📡", name: "COM" },
    "Ambush":    { col: "#556", icon: "👻", name: "HIDE" },
    "AmmoBox":   { col: "#b82", icon: "📦", name: "AMMO" },
    "HighPower": { col: "#c44", icon: "💥", name: "POW" },
    "Mechanic":  { col: "#883", icon: "🔧", name: "MECH" },
    "Armor":     { col: "#667", icon: "🛡", name: "ARM" },
    "Hero":      { col: "#da2", icon: "★", name: "HERO" },
    "CQC":       { col: "#a34", icon: "🔪", name: "CQC" }
};

// ★修正: ユーザー指定のスペックを反映
// pen(貫通) -> dmg, acc_drop -> 距離減衰, burst -> 発射数
const WPNS = {
    // M1 Garand: Pen 76, Drop 3, Burst 2
    m1: { name:"M1 Garand", rng:7, acc:85, acc_drop:3, dmg:76, cap:8, mag:6, ap:2, rld:1, wgt:4, type:'bullet', burst:2, desc:"米軍主力小銃。セミオート2連射。" },
    
    // Thompson: Pen 41, Drop 4, Burst 2 or 5
    thompson: { name:"M1A1 SMG", rng:5, acc:60, acc_drop:4, dmg:41, cap:30, mag:4, ap:2, rld:1, wgt:5, type:'bullet', burst:2, modes:[2, 5], desc:"近距離制圧用。射撃モード切替可。" },
    
    // Kar98 (Sniper): Pen 72, Drop 3, Burst 1
    k98_scope: { name:"Kar98k (Scope)", rng:9, acc:95, acc_drop:3, dmg:72, cap:5, mag:5, ap:2, rld:2, wgt:5, type:'bullet', burst:1, desc:"精密狙撃銃。一撃必殺。" },
    
    // BAR: 既存スペック維持しつつ調整
    bar: { name:"M1918 BAR", rng:7, acc:55, acc_drop:3, dmg:45, cap:20, mag:5, ap:2, rld:2, wgt:9, type:'bullet', burst:3, desc:"分隊支援火器。" }, 
    
    // Side Arms
    m1911: { name:"Colt M1911", rng:3, acc:70, acc_drop:10, dmg:30, cap:7, mag:3, ap:2, rld:1, wgt:1, type:'bullet', burst:1, desc:"45口径拳銃。" },
    luger: { name:"Luger P08", rng:3, acc:75, acc_drop:10, dmg:25, cap:8, mag:2, ap:2, rld:1, wgt:1, type:'bullet', burst:1, desc:"将校の拳銃。" },
    knife: { name:"Combat Knife", rng:1, acc:90, dmg:35, cap:0, mag:0, ap:1, rld:0, wgt:0, type:'melee', burst:1, desc:"白兵戦用ナイフ。" },

    // Explosives
    nade: { name:"Mk2 Grenade", rng:4, acc:60, dmg:80, cap:1, mag:2, ap:2, rld:0, wgt:1, type:'shell', area:true, desc:"破片手榴弾。" },
    
    // Heavy / Tank
    mg42: { name:"MG42", rng:8, acc:45, acc_drop:4, dmg:25, cap:50, mag:99, ap:2, rld:3, wgt:12, type:'bullet', burst:10, desc:"電動ノコギリ。" },
    kwk: { name:"75mm KwK", rng:8, acc:70, acc_drop:2, dmg:150, cap:1, mag:99, ap:2, rld:2, wgt:0, type:'shell_fast', burst:1, desc:"IV号戦車主砲。" },
    kwk88: { name:"88mm KwK36", rng:10, acc:85, acc_drop:1, dmg:250, cap:1, mag:99, ap:2, rld:2, wgt:0, type:'shell_fast', burst:1, desc:"Tiger I 主砲。" }
};

const UNIT_TEMPLATES = {
    rifleman: { name:"Rifleman", role:"infantry", main:"m1", sub:"m1911", opt:"nade", stats:{str:5, aim:5, mob:5, mor:5} },
    scout:    { name:"Scout", role:"infantry", main:"thompson", sub:"knife", opt:"nade", stats:{str:4, aim:4, mob:8, mor:6} },
    gunner:   { name:"Gunner", role:"infantry", main:"bar", sub:"m1911", opt:null, stats:{str:8, aim:4, mob:3, mor:5} },
    sniper:   { name:"Sniper", role:"infantry", main:"k98_scope", sub:"m1911", opt:null, stats:{str:3, aim:9, mob:4, mor:4} },
    
    tank_pz4: { name:"Panzer IV", role:"tank", main:"kwk", sub:"mg42", opt:null, hp:600, ap:5, isTank:true },
    tank_tiger: { name:"Tiger I", role:"tank", main:"kwk88", sub:"mg42", opt:null, hp:1200, ap:4, isTank:true, isBoss:true },
    // ★追加: 爆撃支援カード用テンプレート
    aerial: { name:"AERIAL SPT", role:"TACTIC", main:null, sub:null, opt:null, hp:"N/A", ap:0 }
};

const MAG_VARIANTS = {
    thompson: [ { name: "20rd Box", code: "45ACP20T", cap: 20, cost: 28, jam: 0.0 }, { name: "30rd Box", code: "45ACP30T", cap: 30, cost: 54, jam: 0.008 } ]
};
