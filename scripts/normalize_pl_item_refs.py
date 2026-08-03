#!/usr/bin/env python3
"""Normalize linked Platoon Leader item references in the decoded JSON.

The executable stores a non-zero link as a one-based item ID, while Squad
Tactics identifies the same row by zero-based cbeNameIndex. This migration is
idempotent: it preserves the original values in ammo_raw_item_ids and writes
the normalized values to ammo_indices. The auxiliary u26 link is normalized
the same way when present.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PATH = ROOT / "data" / "wpns_pl_stats_decoded.json"


def migrate(rows: list[dict]) -> list[dict]:
    migrated: list[dict] = []
    for row in rows:
        raw_values = row.get("ammo_raw_item_ids")
        if raw_values is None:
            raw_values = row.get("ammo_indices") or []
        raw_values = [int(value) for value in raw_values]
        if any(value <= 0 for value in raw_values):
            raise ValueError(
                f"invalid raw linked item ID at cbeNameIndex={row.get('cbeNameIndex')}: "
                f"{raw_values}"
            )
        normalized = [value - 1 for value in raw_values]

        out: dict = {}
        links_written = False
        for key, value in row.items():
            if key in {"ammo_raw_item_ids", "ammo_indices"}:
                if not links_written:
                    out["ammo_raw_item_ids"] = raw_values
                    out["ammo_indices"] = normalized
                    links_written = True
                continue
            out[key] = value
        if not links_written:
            out["ammo_raw_item_ids"] = raw_values
            out["ammo_indices"] = normalized
        raw_u26 = row.get("u26_raw_item_id")
        if raw_u26 is not None:
            raw_u26 = int(raw_u26)
            if raw_u26 <= 0:
                raise ValueError(
                    f"invalid u26 raw linked item ID at cbeNameIndex={row.get('cbeNameIndex')}: "
                    f"{raw_u26}"
                )
            out["u26_raw_item_id"] = raw_u26
            out["u26_index"] = raw_u26 - 1
        migrated.append(out)
    return migrated


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_PATH)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if the file still needs normalization without rewriting it",
    )
    args = parser.parse_args()

    rows = json.loads(args.path.read_text(encoding="utf-8"))
    migrated = migrate(rows)
    changed = migrated != rows
    if args.check:
        if changed:
            raise SystemExit(f"not normalized: {args.path}")
        print(f"OK: {args.path} ({len(rows)} rows)")
        return

    if changed:
        args.path.write_text(
            json.dumps(migrated, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"normalized: {args.path} ({len(rows)} rows)")
    else:
        print(f"unchanged: {args.path} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
