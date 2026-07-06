# -*- coding: utf-8 -*-
"""
CBE 副装備互換 — composite u26 + 三脚 cbe map → pl_cbe_aux_compat.js

422B8 RE 根拠:
  col1 ammo_box → weapon.u26
  col2 tripod   → TRIPOD_CODE_FOR_MAIN (cbe)
  col3 optic    → weapon.u26 (kind=optic)

実行: python scripts/export_pl_cbe_aux_compat.py
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMP = ROOT / "data" / "pl_composite_links.json"
TRIPOD_JS = ROOT / "data" / "pl_mg_tripod.js"
OUT_JS = ROOT / "data" / "pl_cbe_aux_compat.js"


def parse_tripod_cbe_map() -> dict[int, int]:
    text = TRIPOD_JS.read_text(encoding="utf-8")
    out: dict[int, int] = {}
    block = re.search(r"TRIPOD_CODE_FOR_MAIN\s*=\s*\{([^}]+)\}", text, re.S)
    if not block:
        return out
    for m in re.finditer(r"(?:['\"]?)(pl_\d+|mg42)(?:['\"]?)\s*:\s*['\"]?(pl_\d+)['\"]?", block.group(1)):
        main = m.group(1)
        trip = m.group(2)
        if main == "mg42":
            main_cbe = 94
        else:
            main_cbe = int(main.replace("pl_", ""))
        trip_cbe = int(trip.replace("pl_", ""))
        out[main_cbe] = trip_cbe
    return out


def main() -> None:
    comp = json.loads(COMP.read_text(encoding="utf-8")) if COMP.exists() else {}
    tripod = parse_tripod_cbe_map()

    u26: dict[str, dict] = {}
    optic: dict[str, int] = {}
    ammo_box: dict[str, int] = {}

    for w in comp.get("weapons") or []:
        wi = w["weaponIdx"]
        link = w.get("u26Link")
        if not link:
            continue
        kind = link.get("kind") or "other"
        idx = int(link["idx"])
        u26[str(wi)] = {"idx": idx, "kind": kind, "name": link.get("name")}
        if kind == "ammo_box":
            ammo_box[str(wi)] = idx
        elif kind == "optic":
            optic[str(wi)] = idx

    all_wi = sorted({int(k) for k in u26} | set(tripod.keys()))
    by_weapon: dict[str, dict] = {}
    for wi in all_wi:
        by_weapon[str(wi)] = {
            "u26": u26.get(str(wi)),
            "tripodCbe": tripod.get(wi),
            "ammoBoxCbe": ammo_box.get(str(wi)),
            "opticCbe": optic.get(str(wi)),
        }

    lines = [
        "/** CBE 副装備互換 — @ 0x422B8 / equip col1..3",
        " *  regen: python scripts/export_pl_cbe_aux_compat.py",
        " */",
        "(function () {",
        "    'use strict';",
        "    window.PL_CBE_AUX_COMPAT = " + json.dumps(by_weapon, ensure_ascii=False, indent=4) + ";",
        "    window.PL_CBE_TRIPOD_FOR_WEAPON = " + json.dumps(
            {str(k): v for k, v in sorted(tripod.items())}, indent=4
        ) + ";",
        "})();",
        "",
    ]
    OUT_JS.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_JS.relative_to(ROOT)} ({len(by_weapon)} weapons)")


if __name__ == "__main__":
    main()
