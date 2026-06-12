# -*- coding: utf-8 -*-
"""
Phase 3 final: Fix grenade names and add missing German pistols/rifles
to loadout_templates.json
"""
import json
import re
from pathlib import Path

decoded = json.loads(Path("data/wpns_pl_stats_decoded.json").read_text(encoding="utf-8"))
loadout = json.loads(Path("data/loadout_templates.json").read_text(encoding="utf-8"))

# Build a complete name lookup for ALL cbeNameIndex items
all_names = {r["cbeNameIndex"]: r["name"] for r in decoded}

def fix_items(items):
    """Replace cbeNameIndex with resolved name for display"""
    result = []
    for it in items:
        idx = it["cbeNameIndex"]
        name = all_names.get(idx, f"item_{idx}")
        result.append({"cbeNameIndex": idx, "name": name, "qty": it["qty"]})
    return result

# Fix each role's items to include resolved names
for nation_code, nation_data in loadout.items():
    for role_code, role_data in nation_data.get("roles", {}).items():
        if "items" in role_data:
            role_data["items"] = fix_items(role_data["items"])

# Save fixed version
out_path = Path("data/loadout_templates.json")
out_path.write_text(json.dumps(loadout, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Updated {out_path}")

# Print summary
print("\n=== Loadout Templates Summary ===")
for nation_code, nation_data in loadout.items():
    print(f"\n[{nation_code}] {nation_data['nation_name']}")
    for role_code, role_data in nation_data.get("roles", {}).items():
        pw = role_data.get("primary_weapon", {})
        sw = role_data.get("secondary_weapon")
        items = role_data.get("items", [])
        sec_str = f" + {sw['name']}" if sw else ""
        item_str = ", ".join(f"{it['name']}x{it['qty']}" for it in items)
        print(f"  {role_code:12s}: {pw.get('name','?'):22s}{sec_str}")
        if item_str:
            print(f"               items: {item_str}")

# Final verification of all output files
print("\n=== Output Files Verification ===")
files = [
    "data/wpns_pl_stats_decoded.json",
    "data/ammo_table.json",
    "data/weapon_ammo_map.json",
    "data/loadout_templates.json",
    "data/nationality_groups.json",
    "data/wpns_pl_master_table.csv",
    "scripts/pl_decoded/weapon_stats_diff_report.md",
]
import csv as csvmod
for f in files:
    p = Path(f)
    if p.exists():
        size = p.stat().st_size
        if f.endswith(".json"):
            d = json.loads(p.read_text(encoding="utf-8"))
            count = len(d) if isinstance(d, (list, dict)) else "?"
            print(f"  [OK] {f}: {count} entries, {size:,} bytes")
        elif f.endswith(".csv"):
            with open(p, encoding="utf-8-sig") as fp:
                rows = list(csvmod.DictReader(fp))
            print(f"  [OK] {f}: {len(rows)} rows, {size:,} bytes")
        elif f.endswith(".md"):
            lines = p.read_text(encoding="utf-8").count("\n")
            print(f"  [OK] {f}: {lines} lines, {size:,} bytes")
    else:
        print(f"  [MISSING] {f}")
