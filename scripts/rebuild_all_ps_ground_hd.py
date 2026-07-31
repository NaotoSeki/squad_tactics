#!/usr/bin/env python3
"""Rebuild every checked-in PS seed background with the production HD ground set."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from build_ground_hd_map_review import build_review


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--inventory",
        type=Path,
        default=Path("asset/environment/ground_hd/inventory.json"),
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("asset/environment/ground_hd/manifest.json"),
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("output/ground_hd_maps"),
    )
    parser.add_argument("--pixel-ratio", type=int, default=2)
    parser.add_argument(
        "--review",
        type=Path,
        default=Path("output/ground_hd_review/all_maps_original_vs_hd.png"),
    )
    args = parser.parse_args()

    inventory = json.loads(args.inventory.read_text(encoding="utf-8"))
    map_names = inventory["sources"]["maps"]
    seeds = [int(name.removeprefix("ps_seed_")) for name in map_names]
    args.out_dir.mkdir(parents=True, exist_ok=True)

    generator = Path(__file__).with_name("gen_ps_seed_map.py")
    for position, seed in enumerate(seeds, start=1):
        print(f"[{position}/{len(seeds)}] seed {seed}", flush=True)
        subprocess.run(
            [
                sys.executable,
                str(generator),
                "--seed",
                str(seed),
                "--out-dir",
                str(args.out_dir),
                "--ground-hd-manifest",
                str(args.manifest),
                "--pixel-ratio",
                str(args.pixel_ratio),
            ],
            check=True,
        )

    review = build_review(
        args.out_dir,
        Path("asset/environment/maps"),
        args.review,
    )
    print(f"review: {review}")


if __name__ == "__main__":
    main()
