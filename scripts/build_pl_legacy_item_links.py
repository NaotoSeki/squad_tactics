#!/usr/bin/env python3
"""Build the authoritative Platoon Leader item compatibility overlay.

The CBE 64-byte item records store linked item references as one-based raw
item IDs.  Squad Tactics uses zero-based ``cbeNameIndex`` values, therefore
every non-zero linked value must be normalized with ``raw_item_id - 1``.

This builder intentionally bypasses the older caliber-family heuristics. It
emits the exact weapon/ammunition/accessory relationships encoded by the old
game, including the AFV records in the same CBE table.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATS_PATH = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAMES_PATH = ROOT / "data" / "cbe_name_table.json"
TRIPOD_PATH = ROOT / "data" / "pl_mg_tripod.js"
OUT_JSON = ROOT / "data" / "pl_weapon_ammo_legacy_truth.json"
OUT_JS = ROOT / "data" / "pl_weapon_ammo_legacy_truth.js"

CAT_AMMO_BOX = 13
CAT_LOADABLE_AMMO = 18
LAST_INFANTRY_ITEM = 224
FIRST_MOUNTED_WEAPON = 395
LAST_MOUNTED_WEAPON = 409

# CBE u16[26] raw item IDs, captured from D:/PL/CBE.EXE before the drive was
# detached.  These are deliberately retained as raw one-based values.
U26_RAW_ITEM_IDS = {
    20: 35,
    22: 35,
    23: 35,
    24: 36,
    87: 117,
    88: 117,
    91: 116,
    92: 116,
    93: 116,
    94: 116,
    95: 117,
    137: 142,
    179: 186,
    199: 202,
    200: 203,
    206: 209,
    217: 116,
}

CORE_ST_BINDINGS = {
    "m1911": 0,
    "bar": 7,
    "m1": 8,
    "k98_scope": 6,  # historical key name; the runtime weapon is M1903A4
    "thompson": 17,
    "mg42": 94,
    "luger": 43,
}


def normalize_item_ref(raw_item_id: int) -> int:
    if raw_item_id <= 0:
        raise ValueError(f"linked item ID must be non-zero: {raw_item_id}")
    return raw_item_id - 1


def unique(values: list[int]) -> list[int]:
    out: list[int] = []
    seen: set[int] = set()
    for value in values:
        if value not in seen:
            seen.add(value)
            out.append(value)
    return out


def parse_tripod_map() -> dict[int, int]:
    text = TRIPOD_PATH.read_text(encoding="utf-8")
    block = re.search(r"TRIPOD_CODE_FOR_MAIN\s*=\s*\{([^}]+)\}", text, re.S)
    if not block:
        raise ValueError("TRIPOD_CODE_FOR_MAIN not found")
    result: dict[int, int] = {}
    for match in re.finditer(
        r"(?:['\"]?)(pl_\d+|mg42)(?:['\"]?)\s*:\s*['\"]?(pl_\d+)['\"]?",
        block.group(1),
    ):
        main = 94 if match.group(1) == "mg42" else int(match.group(1)[3:])
        result[main] = int(match.group(2)[3:])
    return result


def main() -> None:
    stats = json.loads(STATS_PATH.read_text(encoding="utf-8"))
    names = {int(k): str(v) for k, v in json.loads(NAMES_PATH.read_text(encoding="utf-8")).items()}
    by_index = {int(row["cbeNameIndex"]): row for row in stats}
    tripod_map = parse_tripod_map()

    def normalized_slots(row: dict) -> list[dict]:
        raw_values = row.get("ammo_raw_item_ids")
        if raw_values is None:
            # Current decoded file predates the schema correction: ammo_indices
            # still contains the raw one-based item IDs.
            raw_values = row.get("ammo_indices") or []
        slots: list[dict] = []
        for raw in raw_values:
            raw = int(raw)
            if raw == 0:
                continue
            idx = normalize_item_ref(raw)
            target = by_index.get(idx, {})
            slots.append(
                {
                    "rawItemId": raw,
                    "cbeNameIndex": idx,
                    "name": names.get(idx, f"#{idx}"),
                    "category": int(target.get("category_code") or 0),
                }
            )
        return slots

    boxes: dict[int, dict] = {}
    for idx, row in sorted(by_index.items()):
        if int(row.get("category_code") or 0) != CAT_AMMO_BOX:
            continue
        slots = normalized_slots(row)
        inner = [s["cbeNameIndex"] for s in slots if s["category"] == CAT_LOADABLE_AMMO]
        boxes[idx] = {"name": names.get(idx, row.get("name", f"#{idx}")), "innerAmmo": unique(inner)}

    def raw_u26_for_row(idx: int, row: dict) -> int | None:
        raw = row.get("u26_raw_item_id")
        if raw is not None:
            return int(raw)
        # Compatibility with the earlier 400-row decoded JSON. Once the CBE
        # decoder has been rerun, every row supplies its own raw u26 value.
        return U26_RAW_ITEM_IDS.get(idx)

    def build_weapon_row(idx: int, row: dict, *, mounted: bool = False) -> dict:
        slots = normalized_slots(row)
        direct = [s["cbeNameIndex"] for s in slots if s["category"] == CAT_LOADABLE_AMMO]
        aux = [s for s in slots if s["category"] != CAT_LOADABLE_AMMO]
        raw_u26 = raw_u26_for_row(idx, row)
        u26 = normalize_item_ref(raw_u26) if raw_u26 else None
        box_ammo = boxes.get(u26, {}).get("innerAmmo", []) if u26 is not None else []
        result = {
            "name": names.get(idx, row.get("name", f"#{idx}")),
            "category": int(row.get("category_code") or 0),
            "rawItemIds": [s["rawItemId"] for s in slots],
            "directAmmo": unique(direct),
            "ammoBox": u26 if u26 in boxes else None,
            "boxAmmo": unique(box_ammo),
            "effectiveAmmo": unique(direct + box_ammo),
            "auxRefs": aux,
            "tripod": None if mounted else tripod_map.get(idx),
        }
        if mounted:
            result["mountedRecord"] = True
            result["recordOffset"] = row.get("record_offset")
            if not result["effectiveAmmo"]:
                result["noInfantryItemFeed"] = True
        return result

    weapons: dict[int, dict] = {}
    for idx in range(LAST_INFANTRY_ITEM + 1):
        weapons[idx] = build_weapon_row(idx, by_index[idx])

    for idx in range(FIRST_MOUNTED_WEAPON, LAST_MOUNTED_WEAPON + 1):
        if idx not in by_index:
            raise ValueError(f"missing mounted CBE record {idx}; rerun the CBE decoder")
        weapons[idx] = build_weapon_row(idx, by_index[idx], mounted=True)

    payload = {
        "_meta": {
            "generated": date.today().isoformat(),
            "normalization": "nonzero raw item ID -> cbeNameIndex = raw - 1",
            "source": "D:/PL/CBE.EXE 64-byte item records 0..454 + Platoon Leader remodel code list (2003-11-05)",
            "policy": "exact legacy links; no caliber-family heuristic expansion",
            "loadableCategory": CAT_LOADABLE_AMMO,
        },
        "coreBindings": CORE_ST_BINDINGS,
        "boxes": {str(k): v for k, v in sorted(boxes.items())},
        "weapons": {str(k): v for k, v in sorted(weapons.items())},
    }
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    effective = {str(k): v["effectiveAmmo"] for k, v in sorted(weapons.items())}
    slots_map = {
        str(k): [
            {
                "slot": n,
                "ref": s["cbeNameIndex"],
                "cat": s["category"],
                "name": s["name"],
            }
            for n, s in enumerate(v["auxRefs"])
        ]
        for k, v in sorted(weapons.items())
        if v["auxRefs"]
    }
    box_js = {
        str(k): {"name": v["name"], "inner": v["innerAmmo"], "usedBy": []}
        for k, v in sorted(boxes.items())
    }
    u26_js: dict[str, dict] = {}
    aux_compat: dict[str, dict] = {}
    tripod_js: dict[str, int] = {}
    for idx, row in sorted(weapons.items()):
        if row.get("tripod") is not None:
            tripod_js[str(idx)] = int(row["tripod"])
        if row.get("ammoBox") is not None:
            box_idx = int(row["ammoBox"])
            u26_js[str(idx)] = {
                "idx": box_idx,
                "kind": "ammo_box",
                "name": boxes[box_idx]["name"],
                "inner": boxes[box_idx]["innerAmmo"],
            }
            box_js[str(box_idx)]["usedBy"].append(idx)
        if row.get("ammoBox") is not None or row.get("tripod") is not None:
            aux_compat[str(idx)] = {
                "u26": u26_js.get(str(idx)),
                "tripodCbe": row.get("tripod"),
                "ammoBoxCbe": row.get("ammoBox"),
                "opticCbe": None,
            }

    js_payload = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    effective_js = json.dumps(effective, ensure_ascii=False, separators=(",", ":"))
    slots_js = json.dumps(slots_map, ensure_ascii=False, separators=(",", ":"))
    boxes_js = json.dumps(box_js, ensure_ascii=False, separators=(",", ":"))
    u26_map_js = json.dumps(u26_js, ensure_ascii=False, separators=(",", ":"))
    aux_js = json.dumps(aux_compat, ensure_ascii=False, separators=(",", ":"))
    tripod_map_js = json.dumps(tripod_js, ensure_ascii=False, separators=(",", ":"))
    core_js = json.dumps(CORE_ST_BINDINGS, ensure_ascii=False, separators=(",", ":"))

    js = f"""/** Authoritative PL item links; generated by scripts/build_pl_legacy_item_links.py. */
(function (global) {{
  'use strict';
  const truth = {js_payload};
  const effective = {effective_js};
  const coreBindings = {core_js};

  global.PL_LEGACY_ITEM_LINKS = truth;
  global.PL_CBE_WEAPON_AMMO_CANONICAL = effective;
  global.PL_CBE_WEAPON_SLOTS = {slots_js};
  global.PL_COMPOSITE_BOXES = {boxes_js};
  global.PL_COMPOSITE_U26 = {u26_map_js};
  global.PL_CBE_AUX_COMPAT = {aux_js};
  global.PL_CBE_TRIPOD_FOR_WEAPON = {tripod_map_js};

  // The exact old-game rows are final.  Heuristic shape/cap/pool expansion
  // previously changed correct feeds into unrelated same-caliber magazines.
  global.FEATURE_PL_MAG_SHAPE_FILTER = false;
  global.FEATURE_PL_MAG_CAP_FILTER = false;
  global.FEATURE_PL_MISSION_POOL_CAP_FILTER = false;
  global.FEATURE_PL_CANONICAL_AMMO_FILTER = false;
  global.FEATURE_PL_CATEGORY_FILTER = true;
  global.FEATURE_PL_COMPOSITE_AMMO = true;

  const overrides = {{}};
  Object.keys(effective).forEach(function (key) {{
    overrides[key] = {{
      acceptsAmmoPlIndices: effective[key].slice(),
      source: 'PL legacy raw item ID minus one'
    }};
  }});
  global.PL_AMMO_WEAPON_OVERRIDES = overrides;

  function bind(code, cbeIndex) {{
    if (typeof WPNS === 'undefined' || !WPNS[code]) return;
    const row = truth.weapons[String(cbeIndex)];
    if (!row) return;
    const ammo = row.effectiveAmmo.slice();
    WPNS[code].cbeNameIndex = cbeIndex;
    WPNS[code].plCbeWeaponIndex = cbeIndex;
    WPNS[code].acceptsAmmo = ammo;
    WPNS[code].plCompat = {{
      plCbeWeaponIndex: cbeIndex,
      plWeaponName: row.name,
      acceptsAmmoPlIndices: ammo.slice(),
      source: 'PL legacy raw item ID minus one'
    }};
  }}

  Object.keys(truth.weapons).forEach(function (key) {{
    bind('pl_' + key, Number(key));
  }});
  Object.keys(coreBindings).forEach(function (code) {{
    bind(code, Number(coreBindings[code]));
  }});
}})(typeof window !== 'undefined' ? window : globalThis);
"""
    OUT_JS.write_text(js, encoding="utf-8")
    print(f"Wrote {OUT_JSON.relative_to(ROOT)} ({len(weapons)} weapon rows)")
    print(f"Wrote {OUT_JS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
