/** DATA */
const HEX_SIZE = 34; const MAP_W = 24; const MAP_H = 20;
const RANKS = ["Pvt", "Cpl", "Sgt", "Lt", "Cpt", "Maj"];
const SKILLS = {
    "Precision": { name: "精密", desc: "命中+15%" },
    "Radio":     { name: "無線", desc: "支援効果UP" },
    "Ambush":    { name: "隠密", desc: "回避+15%" },
    "AmmoBox":   { name: "弾薬", desc: "連射数UP" },
    "HighPower": { name: "強装", desc: "ダメージ+20%" },
    "Mechanic":  { name: "修理", desc: "毎ターン回復" },
    "Armor":     { name: "装甲", desc: "被ダメ-10" },
    "Hero":      { name: "英雄", desc: "AP+1 (5戦生存)" }
};

const WPNS = {
    m1: { name:"M1 Garand", rng:6, acc:85, dmg:35, burst:2, type:'bullet' },
    nade: { name:"Grenade", rng:3, acc:70, dmg:80, burst:1, type:'shell', area:true },
    mg42: { name:"MG42", rng:7, acc:50, dmg:20, burst:12, type:'bullet' },
    luger: { name:"Luger P08", rng:3, acc:75, dmg:25, burst:1, type:'bullet' },
    k98: { name:"Scoped K98", rng:9, acc:95, dmg:80, burst:1, type:'bullet' },
    kwk: { name:"75mm AP", rng:7, acc:70, dmg:150, burst:1, type:'shell_fast' },
    he: { name:"75mm HE", rng:7, acc:60, dmg:100, burst:1, type:'shell', area:true },
    rocket380: { name:"380mm Rkt", rng:7, acc:60, dmg:400, burst:1, type:'rocket', area:true },
    coax: { name:"Coax MG", rng:1, acc:60, dmg:15, burst:5, type:'bullet' }
};
const UNITS = {
    infantry: { name:"Rifle Squad", hp:100, ap:4, wpn:"m1", alt:"nade", icon:"⚡", desc:"汎用歩兵分隊" },
    heavy:    { name:"MG Team", hp:120, ap:3, wpn:"mg42", alt:"luger", icon:"⛨", desc:"制圧射撃用重火器" },
    sniper:   { name:"Sniper", hp:60, ap:4, wpn:"k98", alt:"luger", icon:"◎", desc:"長距離狙撃手" },
    tank:     { name:"Panzer IV", hp:550, ap:5, wpn:"kwk", alt:"he", icon:"♜", desc:"中戦車 (姿勢固定)", isTank:true },
    mortar:   { name:"Assault Mortar", hp:400, ap:3, wpn:"rocket380", alt:"mg42", icon:"☢", desc:"突撃臼砲 (広範囲)", isTank:true }
};
const TERRAIN = {
    VOID: {id:-1, name:"", cost:99, cover:0, color:"#111"},
    DIRT: {id:0, name:"荒地", cost:1, cover:5, color:"#5a5245"},
    GRASS:{id:1, name:"草地", cost:1, cover:10, color:"#425030"},
    FOREST:{id:2, name:"森林", cost:2, cover:40, color:"#222e1b"},
    ROAD: {id:3, name:"道路", cost:1, cover:0, color:"#66605a"},
    TOWN: {id:4, name:"廃墟", cost:1, cover:35, color:"#504540"},
    WATER:{id:5, name:"水域", cost:99, cover:0, color:"#303840"}
};
