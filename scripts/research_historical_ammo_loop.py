# -*- coding: utf-8 -*-
"""
【廃止 2026-05-31】史実×CBE 提案リスト — 誤提案が多いため生成停止。

代替: python scripts/export_pl_cbe_ammo_truth.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    print("DEPRECATED: research_historical_ammo_loop.py は廃止されました。")
    print("  代替: python scripts/export_pl_cbe_ammo_truth.py")
    print("  参照: docs/PL_CBE_AMMO_TRUTH.md")
    sys.exit(1)


if __name__ == "__main__":
    main()
