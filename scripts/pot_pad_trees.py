#!/usr/bin/env python3
"""Pad trees_ps sprites to power-of-two canvases (no resampling).

WebGL1 can only generate mipmaps for POT textures. Content is copied 1:1:
bodies are bottom-centered (rendered with origin (0.5,1) — trunk base must
stay at bottom-center), shadows are centered (origin (0.5,0.5)).
Idempotent: already-POT files are skipped. manifest.json keeps CONTENT dims
(used as the scale reference in phaser_vegetation_layer.js) and is not touched.
Generated via GPT-5.6 lane, reviewed. See memory: ps-render-pipeline.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image


def next_power_of_two(value: int) -> int:
    return 1 << (value - 1).bit_length()


def is_power_of_two(value: int) -> bool:
    return value > 0 and (value & (value - 1)) == 0


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    target_dir = repo_root / "asset" / "environment" / "trees_ps"

    if not target_dir.is_dir():
        raise FileNotFoundError(f"Target directory not found: {target_dir}")

    padded = 0
    skipped = 0
    rows: list[tuple[str, int, int, int, int, str]] = []

    for path in sorted(target_dir.glob("*.png")):
        with Image.open(path) as source:
            image = source.convert("RGBA")
            width, height = image.size

            if is_power_of_two(width) and is_power_of_two(height):
                print(f"{path.name} ({width},{height}) already POT, skip")
                rows.append((path.name, width, height, width, height, "skipped"))
                skipped += 1
                continue

            padded_width = next_power_of_two(width)
            padded_height = next_power_of_two(height)

            if path.name.endswith("_shadow.png"):
                x = (padded_width - width) // 2
                y = (padded_height - height) // 2
            else:
                x = (padded_width - width) // 2
                y = padded_height - height

            canvas = Image.new("RGBA", (padded_width, padded_height), (0, 0, 0, 0))
            canvas.paste(image, (x, y))
            canvas.save(path, "PNG", optimize=True)

            rows.append(
                (path.name, width, height, padded_width, padded_height, "padded")
            )
            padded += 1

    print()
    print(f"{'Filename':<40} {'Original':>14} {'Padded':>14}  Status")
    print("-" * 80)
    for name, width, height, padded_width, padded_height, status in rows:
        print(
            f"{name:<40} "
            f"({width},{height}) -> ({padded_width},{padded_height})"
            f"{'':<3} {status}"
        )

    print()
    print(f"Total: {padded} padded, {skipped} skipped")


if __name__ == "__main__":
    main()
