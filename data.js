/** DATA: Unit & Weapon Definitions */

const RANKS = ['Pvt', 'Cpl', 'Sgt', 'Lt', 'Cpt', 'Maj', 'Col'];

const FIRST_NAMES = ['John', 'Jane', 'Mike', 'Emily', 'Chris', 'Sarah', 'David', 'Laura', 'Robert', 'Emma', 'James', 'Olivia', 'Arthur', 'Sophia', 'William', 'Isabella'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson'];

const UNIT_TEMPLATES = {
    rifleman: { name: "Rifleman", role: "infantry", hp: 100, ap: 4, main: "rifle", sub: "grenade" },
    scout: { name: "Scout", role: "infantry", hp: 80, ap: 6, main: "smg", sub: "medkit", stats: { mob: 2, aim: 1 } },
    gunner: { name: "Machine Gunner", role: "infantry", hp: 120, ap: 3, main: "lmg", sub: "ammo_box", stats: { str: 2, aim: -1 } },
    sniper: { name: "Sniper", role: "infantry", hp: 70, ap: 4, main: "sr", sub: "pistol", stats: { aim: 4, mob: -1 } },
    tank_pz4: { name: "Panzer IV", role: "tank", hp: 400, ap: 4, main: "kwk40", sub: "mg34", isTank: true, stats: { str: 5 } },
    tank_tiger: { name: "Tiger I", role: "tank", hp: 600, ap: 3, main: "kwk36", sub: "mg34", isTank: true, stats: { str: 8, mob: -2 } },
    // ★追加: 爆撃支援カード定義
    aerial: { name: "AERIAL SPT", role: "TACTIC", hp: "N/A", ap: 0, main: null }
};

const WPNS = {
    unarmed: { name: "Unarmed", type: "melee", rng: 1, dmg: 5, ap: 1, acc: 80 },
    rifle: { name: "M1 Garand", type: "bullet", rng: 6, dmg: 40, ap: 2, acc: 90, cap: 8, rld: 1, mag: 4 },
    smg: { name: "Thompson", type: "bullet", rng: 4, dmg: 25, ap: 2, acc: 75, burst: 3, cap: 30, rld: 2, mag: 3, modes:[1,3] },
    lmg: { name: "M1919 Browning", type: "bullet", rng: 5, dmg: 30, ap: 3, acc: 60, burst: 5, cap: 50, rld: 3, mag: 2, modes:[5], jam: 0.05 },
    sr: { name: "Springfield M1903", type: "bullet", rng: 9, dmg: 80, ap: 3, acc: 95, cap: 5, rld: 2, mag: 3, acc_drop: 0 },
    pistol: { name: "M1911", type: "bullet", rng: 3, dmg: 20, ap: 1, acc: 80, cap: 7, rld: 1, mag: 3 },
    kwk40: { name: "7.5cm KwK 40", type: "shell", rng: 8, dmg: 150, ap: 2, acc: 85, cap: 1, rld: 2, mag: 20 },
    kwk36: { name: "8.8cm KwK 36", type: "shell", rng: 10, dmg: 220, ap: 2, acc: 90, cap: 1, rld: 2, mag: 15 },
    mg34: { name: "MG34", type: "bullet", rng: 5, dmg: 20, ap: 2, acc: 65, burst: 6, cap: 999, rld: 0 },
    grenade: { name: "Mk2 Grenade", type: "shell_fast", rng: 4, dmg: 120, ap: 3, acc: 70, area: 1, isConsumable: true },
    medkit: { name: "Medkit", type: "item", ap: 2, effect: "heal", val: 50, isConsumable: true },
    ammo_box: { name: "Ammo Box", type: "item", ap: 2, effect: "supply", val: 100, isConsumable: true }
};

const MAG_VARIANTS = {
    smg: [{ name: "Stick Mag (30)", cap: 30, jam: 0.02 }, { name: "Drum Mag (50)", cap: 50, jam: 0.08 }],
    lmg: [{ name: "Belt (50)", cap: 50, jam: 0.05 }, { name: "Cloth Belt (100)", cap: 100, jam: 0.1 }]
};

const SKILLS = {
    "Hero": { name: "Hero", icon: "⭐", col: "#d4af37" },
    "Ace": { name: "Ace", icon: "♠", col: "#aaa" },
    "Mechanic": { name: "Mechanic", icon: "🔧", col: "#484" },
    "Medic": { name: "Medic", icon: "💊", col: "#d44" },
    "CQC": { name: "CQC", icon: "🔪", col: "#844" },
    "Sniper": { name: "Sniper", icon: "🎯", col: "#448" }
};

const SKILL_STYLES = SKILLS;

const TERRAIN = {
    VOID: { id: -1, name: "Void", cost: 99, cover: 0 },
    GRASS: { id: 0, name: "Grass", cost: 1, cover: 0 },
    FOREST: { id: 1, name: "Forest", cost: 2, cover: 30 },
    DIRT: { id: 2, name: "Dirt", cost: 1, cover: 5 },
    TOWN: { id: 4, name: "Ruins", cost: 2, cover: 60 },
    WATER: { id: 5, name: "Water", cost: 99, cover: 0 }
};

const MAP_W = 20;
const MAP_H = 12;
const HEX_SIZE = 54;
