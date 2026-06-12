# -*- coding: utf-8 -*-
"""
data/mission_*.json を同期埋め込み JS に変換（file:// でも map 寸法が data.js より前に確定するため）。

  python scripts/embed_mission_json.py
  python scripts/embed_mission_json.py data/mission_pl_01.json missions/mission_embed_pl01.js
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IN = ROOT / "data" / "mission_pl_01.json"
DEFAULT_OUT = ROOT / "missions" / "mission_embed_pl01.js"


def main() -> None:
    inp = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_IN
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    obj = json.loads(inp.read_text(encoding="utf-8"))
    out.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(obj, ensure_ascii=False, indent=2)
    text = (
        "/** Auto from " + inp.as_posix().replace("\\", "/") + " — run: python scripts/embed_mission_json.py */\n"
        "(function () {\n"
        "  if (typeof window === 'undefined') return;\n"
        "  window.__ST_MISSION__ = "
        + body
        + ";\n"
        "})();\n"
    )
    out.write_text(text, encoding="utf-8")
    print("WROTE", out)


if __name__ == "__main__":
    main()
