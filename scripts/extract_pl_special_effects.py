#!/usr/bin/env python3
"""Extract every PL explosive / special-effect profile from decoded CBE rows."""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CBE = Path("D:/PL/CBE.EXE")
STATS = ROOT / "data" / "wpns_pl_stats_decoded.json"
OUT_JSON = ROOT / "data" / "pl_special_effects_decoded.json"
OUT_CSV = ROOT / "data" / "pl_special_effects_decoded.csv"

SPECIAL_CATEGORIES = {
    2,   # grenade-launcher weapon
    3,   # signal / smoke weapon
    9,   # flamethrower
    10,  # rocket launcher
    11,  # Panzerfaust
    19,  # rifle grenade
    20,  # hand grenade
    21,  # magnetic mine
    22,  # demolition charge
    23,  # smoke payload
    27,  # gun (may contain AP + HE profiles)
    28,  # howitzer / mortar HE profile
}

KIND_LABELS = {
    "kinetic": "通常徹甲・直射",
    "special_or_shaped_charge": "成形炸薬・特殊効果",
    "explosive": "榴弾・爆風・炸薬",
    "flame_direct": "火炎直撃",
    "flame_area": "火炎範囲",
}


def main() -> None:
    rows = json.loads(STATS.read_text(encoding="utf-8"))
    selected = []
    for row in rows:
        category = int(row.get("category_code") or 0)
        u6 = int(row.get("special_penetration_u6") or 0)
        u7 = int(row.get("special_penetration_u7") or 0)
        if category not in SPECIAL_CATEGORIES and not u6 and not u7:
            continue

        profiles = []
        for profile in row.get("effect_profiles", []):
            profile = dict(profile)
            profile["label"] = KIND_LABELS.get(profile["kind"], profile["kind"])
            profiles.append(profile)

        selected.append({
            "cbeNameIndex": row["cbeNameIndex"],
            "name": row["name"],
            "category_code": category,
            "category_name": row.get("category_name"),
            "effect_mode_raw": int(row.get("effect_mode_raw") or 0),
            "effect_mode_hex": f"0x{int(row.get('effect_mode_raw') or 0):04X}",
            "raw_u4_plus08": int(row.get("initial_penetration_raw_u4") or 0),
            "raw_u5_plus10_decay": int(row.get("penetration_decay_rate") or 0),
            "raw_u6_plus12": u6,
            "raw_u7_plus14": u7,
            "resolved_initial_penetration": int(row.get("initial_penetration") or 0),
            "resolved_source": row.get("penetration_source"),
            "hit_rate": int(row.get("initial_hit_rate") or 0),
            "hit_decay_per_hex": int(row.get("hit_decay_rate") or 0),
            "malfunction_rate": int(row.get("malfunction_rate") or 0),
            "malfunction_modifier": int(row.get("malfunction_rate") or 0)
            if category == 18 else 0,
            "profiles": profiles,
            "linked_raw_item_ids": row.get("ammo_raw_item_ids", []),
            "linked_cbe_indices": row.get("ammo_indices", []),
            "record_offset": row.get("record_offset"),
        })

    payload = {
        "_meta": {
            "source": str(CBE),
            "source_sha256": hashlib.sha256(CBE.read_bytes()).hexdigest().upper(),
            "record_count": len(selected),
            "rule": "+08=u4 normal/kinetic, +12=u6 special/shaped-charge, +14=u7 explosive/area; preserve all simultaneous profiles",
        },
        "records": selected,
    }
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=[
            "cbeNameIndex", "name", "category_code", "category_name",
            "effect_mode_hex", "raw_u4_plus08", "raw_u5_plus10_decay",
            "raw_u6_plus12", "raw_u7_plus14", "resolved_initial_penetration",
            "resolved_source", "hit_rate", "hit_decay_per_hex",
            "malfunction_rate", "malfunction_modifier", "profiles",
            "linked_cbe_indices", "record_offset",
        ])
        writer.writeheader()
        for row in selected:
            flat = dict(row)
            flat["profiles"] = " | ".join(
                f"{p['label']}={p['value']} decay={p['decay_per_hex']} ({p['source']})"
                for p in row["profiles"]
            )
            flat["linked_cbe_indices"] = ",".join(map(str, row["linked_cbe_indices"]))
            flat.pop("linked_raw_item_ids", None)
            flat.pop("effect_mode_raw", None)
            writer.writerow(flat)

    print(f"Wrote {OUT_JSON.relative_to(ROOT)} ({len(selected)} special rows)")
    print(f"Wrote {OUT_CSV.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
