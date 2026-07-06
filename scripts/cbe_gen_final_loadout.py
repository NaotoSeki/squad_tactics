# -*- coding: utf-8 -*-
"""
Phase 3 Final: Generate clean loadout_templates.json and nationality_groups.json
"""
import json
import re
from pathlib import Path

decoded = json.loads(Path("data/wpns_pl_stats_decoded.json").read_text(encoding="utf-8"))
ammo_raw = json.loads(Path("data/weapon_ammo_map.json").read_text(encoding="utf-8"))

all_names = {r["cbeNameIndex"]: r["name"] for r in decoded}
ammo_link = {e["cbeNameIndex"]: [a["cbeNameIndex"] for a in e.get("ammo_details", [])] for e in ammo_raw}

# ================================================================
# Nationality rules (specific first)
# ================================================================
RULES = [
    ("AUT", "Austria/Hungary", [r"^S-18/", r"^M07[/ ]", r"^MP34\(", r"^M30 ", r"^M30$"]),
    ("SPA", "Spain",           [r"^C/96", r"^Astra[0-9]", r"^Astra4"]),
    ("ITA", "Italy",           [r"^Beretta\s", r"^Breda\s", r"^MAB\s", r"^M1934$", r"^M38[A-Z]",
                                 r"^Bodeo", r"^Glisenti", r"^T\. Breda", r"^[FM]\. mod[0-9]",
                                 r"SRCM", r"OTO m35"]),
    ("FRA", "France",          [r"^Mle[0-9]", r"^MAS[0-9 ]", r"^MAC[0-9 ]", r"^Lebel",
                                 r"^Unique\s", r"^FR mod", r"MAC24", r"^F\. Mle", r"^M\. Mle",
                                 r"^F\. MAS", r"^M\. MAS"]),
    ("GBR", "UK",              [r"^No[0-9]", r"^Sten\s", r"^Bren\s", r"^Boys\s", r"^PIAT$",
                                 r"^Lewis\s", r"^Vickers\s", r"^Webley\s", r"^Very$"]),
    ("SOV", "USSR",            [r"^PPD", r"^PPSh", r"^PPS4", r"^DP$", r"^SVT", r"^TT33",
                                 r"^obr", r"^pat\.", r"^DShK", r"^PM1910"]),
    ("CZE", "Czechoslovakia",  [r"^ZB[0-9 ]", r"^CZ\s", r"^lk ZB", r"^tk ZB", r"^ZK[0-9]"]),
    ("POL", "Poland",          [r"^VIS\s", r"^wz[0-9]"]),
    ("GER", "Germany",         [r"^P08$", r"^P38$", r"^PPK$", r"^HSc$", r"^PP$", r"^Beholla$",
                                 r"^MP[0-9]", r"^MP3008", r"^MG[0-9]", r"^MG08",
                                 r"^FG42", r"^Kar", r"^Gew[0-9 ]", r"^PzB", r"^GrB",
                                 r"^VG[0-9-]", r"^VK-", r"^StG", r"^MKb", r"^MP4[0-9]",
                                 r"^MP2[0-9]", r"^MP3[5-9]", r"^MP41", r"^EMP$",
                                 r"^FmW", r"^RPzB", r"^PF[0-9]", r"^Laf[0-9]", r"^Sch08",
                                 r"^PatrK", r"^27mm", r"^Zf ", r"Potsdam"]),
    ("USA", "USA",             [r"^M1911", r"^M1917\s", r"^M1917C", r"^M1918", r"^M1919",
                                 r"^M1903", r"^M1928", r"^M1 ", r"^M1A1\s", r"^M1C\s",
                                 r"^M1D\s", r"^M1941", r"^M2 ", r"^M2A", r"^M2HB",
                                 r"^M3 ", r"^M3A", r"^M9 RL", r"^AN-M", r"^E1R",
                                 r"^SCR", r"^OSS", r"Cbn"]),
]

def classify(name):
    for code, label, patterns in RULES:
        for p in patterns:
            if re.search(p, name, re.IGNORECASE):
                return code, label
    return "UNK", "Unknown"

# Build groups
groups = {}
cat_filter = {12, 13, 14, 15, 16, 17}  # tripod, ammo_box, binoculars, radio, medical, document

for r in decoded:
    cat = r["category_code"]
    if 1 <= cat <= 15 and cat not in cat_filter:
        code, label = classify(r["name"])
        if code not in groups:
            groups[code] = {"label": label, "weapons": []}
        groups[code]["weapons"].append({
            "cbeNameIndex": r["cbeNameIndex"],
            "name": r["name"],
            "category_name": r["category_name"],
            "initial_hit_rate": r["initial_hit_rate"],
            "initial_penetration": r["initial_penetration"],
            "purchase_cost": r["purchase_cost"],
            "magazine_capacity": r["magazine_capacity"],
            "auto_fire": r["auto_fire"],
            "ammo_indices": ammo_link.get(r["cbeNameIndex"], []),
        })

print("=== Nationality Groups ===")
for code, g in sorted(groups.items()):
    print(f"  [{code}] {g['label']}: {len(g['weapons'])} weapons")

# ================================================================
# Loadout helpers
# ================================================================
def best(weapons, cat, sniper=False):
    cands = [w for w in weapons if w["category_name"] == cat]
    if not cands: return None
    if sniper:
        scoped = [c for c in cands if re.search(r"Zf |A4|/D| D |PU|\(T\)", c["name"])]
        if scoped: cands = scoped
        cands.sort(key=lambda x: -x["initial_hit_rate"])
    else:
        cands.sort(key=lambda x: -x["initial_penetration"])
    return cands[0]

def best_pistol(weapons):
    return best(weapons, "pistol")

def ammo_items(wpn, qty):
    if not wpn: return []
    idxs = wpn.get("ammo_indices", [])
    # prefer category 18 (pure ammo)
    ammo_cat = {r["cbeNameIndex"]: r["category_code"] for r in decoded if r["cbeNameIndex"] >= 225}
    regular = [i for i in idxs if ammo_cat.get(i, 18) == 18]
    if not regular: regular = idxs[:1]
    if regular:
        idx = regular[0]
        return [{"cbeNameIndex": idx, "name": all_names.get(idx, f"ammo_{idx}"), "qty": qty}]
    return []

def nade(idx, qty=2):
    return [{"cbeNameIndex": idx, "name": all_names.get(idx, f"item_{idx}"), "qty": qty}]

# ================================================================
# Nation configurations
# ================================================================
NATIONS = {
    "USA": ("US Army",      "rifleman smg_man bar_man sniper mg_crew at_rifle rl_man flamethrower", 246),
    "GER": ("German Army",  "rifleman smg_man bar_man sniper mg_crew at_rifle rl_man flamethrower", 305),
    "ITA": ("Italian Army", "rifleman smg_man bar_man mg_crew", 328),
    "FRA": ("French Army",  "rifleman smg_man bar_man mg_crew", 345),
    "GBR": ("British Army", "rifleman smg_man bar_man mg_crew at_rifle", 361),
    "SOV": ("Soviet Army",  "rifleman smg_man bar_man mg_crew", None),
}

ROLE_CONFIG = {
    "rifleman":     ("rifle",          False, 3),
    "smg_man":      ("smg",            False, 4),
    "bar_man":      ("lmg",            False, 3),
    "sniper":       ("rifle",          True,  2),
    "mg_crew":      ("mmg",            False, 1),
    "at_rifle":     ("at_rifle",       False, 3),
    "flamethrower": ("flamethrower",   False, 1),
    "rl_man":       ("rocket_launcher",False, 3),
}

loadout_templates = {}
for nation_code, (nation_name, roles_str, grenade_idx) in NATIONS.items():
    if nation_code not in groups:
        continue
    wpns = groups[nation_code]["weapons"]
    nation_entry = {"nation_code": nation_code, "nation_name": nation_name, "roles": {}}
    
    print(f"\n=== {nation_name} ===")
    for role in roles_str.split():
        cat, sniper_flag, ammo_qty = ROLE_CONFIG[role]
        primary = best(wpns, cat, sniper=sniper_flag)
        if not primary: continue
        secondary = best_pistol(wpns) if role in ("rifleman", "smg_man", "bar_man", "sniper") else None
        
        items = ammo_items(primary, ammo_qty)
        if secondary:
            items += ammo_items(secondary, 2)
        if grenade_idx:
            items += nade(grenade_idx)
        
        nation_entry["roles"][role] = {
            "role_en": role.replace("_", " ").title(),
            "primary_weapon": {"cbeNameIndex": primary["cbeNameIndex"], "name": primary["name"]},
            "secondary_weapon": {"cbeNameIndex": secondary["cbeNameIndex"], "name": secondary["name"]} if secondary else None,
            "items": items,
        }
        
        sec_str = f" + {secondary['name']}" if secondary else ""
        item_str = ", ".join(f"{it['name']}x{it['qty']}" for it in items)
        print(f"  {role:12s}: {primary['name']:22s}{sec_str}")
        if item_str: print(f"               -> {item_str}")
    
    loadout_templates[nation_code] = nation_entry

# Save
Path("data/loadout_templates.json").write_text(
    json.dumps(loadout_templates, ensure_ascii=False, indent=2), encoding="utf-8"
)
Path("data/nationality_groups.json").write_text(
    json.dumps(groups, ensure_ascii=False, indent=2), encoding="utf-8"
)

print("\n=== Output Files ===")
files = {
    "data/wpns_pl_stats_decoded.json": "weapon stats (400 records)",
    "data/ammo_table.json": "ammo table",
    "data/weapon_ammo_map.json": "weapon-ammo map",
    "data/loadout_templates.json": f"loadout templates ({len(loadout_templates)} nations)",
    "data/nationality_groups.json": f"nationality groups ({len(groups)} nations)",
    "scripts/pl_decoded/weapon_stats_diff_report.md": "diff report",
}
import csv as csvmod
for f, desc in files.items():
    p = Path(f)
    if p.exists():
        size = p.stat().st_size
        print(f"  [OK] {f}: {size:,} bytes - {desc}")
    else:
        print(f"  [MISSING] {f}")
