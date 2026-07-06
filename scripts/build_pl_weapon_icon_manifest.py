# -*- coding: utf-8 -*-
"""asset/pl_weapons/cbe_NNN.png が存在する N を列挙し data/pl_weapon_icon_manifest.js を更新する。"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "asset" / "pl_weapons"
OUT = ROOT / "data" / "pl_weapon_icon_manifest.js"

PAT = re.compile(r"^cbe_(\d+)\.png$", re.I)


def main() -> int:
    indices: list[int] = []
    if ASSET_DIR.is_dir():
        for p in ASSET_DIR.iterdir():
            if not p.is_file():
                continue
            m = PAT.match(p.name)
            if m:
                indices.append(int(m.group(1)))
    indices.sort()
    body = (
        "/** 自動生成: python scripts/build_pl_weapon_icon_manifest.py */\n"
        "(function () {\n"
        "  'use strict';\n"
        f"  window.PL_WEAPON_ICON_INDICES = {indices!r};\n"
        "})();\n"
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(body, encoding="utf-8")
    print("Wrote", OUT, "count", len(indices))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
