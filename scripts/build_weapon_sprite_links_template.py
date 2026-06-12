# -*- coding: utf-8 -*-
"""
wpns_pl_master_table.csv から、武器スプライト紐づけ用の JSON を生成する。

  python scripts\\build_weapon_sprite_links_template.py

  -> data/weapon_sprite_links.json

各条は image_rgba: null から。正しい透過 PNG が得られた段階で path を入れる。
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "wpns_pl_master_table.csv"
OUT = ROOT / "data" / "weapon_sprite_links.json"


def main() -> int:
    if not CSV_PATH.is_file():
        print("missing", CSV_PATH)
        return 1
    rows: list[dict] = []
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            code = (row.get("wpns_code") or "").strip()
            if not code:
                continue
            cbe = row.get("cbeNameIndex", "")
            name = (row.get("name") or "").strip()
            cat = (row.get("plCategory") or "").strip()
            try:
                cbe_i = int(cbe) if str(cbe).isdigit() else None
            except ValueError:
                cbe_i = None
            rows.append(
                {
                    "wpns_code": code,
                    "cbeNameIndex": cbe_i,
                    "plCategory": cat,
                    "name": name,
                    "image_rgba": None,
                }
            )
    doc = {
        "_meta": {
            "source_csv": "data/wpns_pl_master_table.csv",
            "goal": "scripts/pl_decoded/GOAL_pl_weapon_sprites_ja.md",
            "note": "image_rgba はリポ内の相対パス推奨。例: asset/pl_weapons/by_cbe/NNN.png",
        },
        "weapons": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", OUT, "n=", len(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
