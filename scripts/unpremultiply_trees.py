#!/usr/bin/env python3
"""DEPRECATED (2026-07-23): do NOT run against v3 assets.

This was a workaround for the broken alpha channel of the v2 extraction. The
differential-blit extraction (scripts/ps_extract/extract_trees_v3.py) recovers
true straight color + true coverage, which standard alpha blending reproduces
exactly — no un-premultiply needed. Running this on v3 sprites would corrupt
them (non-idempotent brightening). Kept for historical reference only.

Original description: Un-premultiply trees_ps sprites so Phaser's upload reproduces PS's blit.

PS art is premultiplied-authored (RGB = palette color pre-scaled for coverage,
alpha = coverage) and PS composites `out = rgb + dst*(1-a)` (src at full value).
Phaser premultiplies RGB by alpha at texture upload and blends with
(ONE, ONE_MINUS_SRC_ALPHA). Pre-dividing rgb' = rgb/(a/255) makes the uploaded
texel equal the original palette color, so the GPU blend becomes mathematically
identical to the PS blit. Mipmap generation then also averages in the correct
premultiplied space. NOT idempotent -> guarded by a .unpremultiplied marker.
Generated via GPT-5.6 lane, reviewed. See memory: ps-render-pipeline.
"""

from pathlib import Path

import numpy as np
from PIL import Image


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    target_dir = repo_root / "asset" / "environment" / "trees_ps"
    marker_path = target_dir / ".unpremultiplied"

    if marker_path.exists():
        print("already unpremultiplied, aborting")
        return

    if not target_dir.is_dir():
        raise FileNotFoundError(f"target directory not found: {target_dir}")

    for png_path in sorted(target_dir.glob("*.png")):
        with Image.open(png_path) as source:
            image = source.convert("RGBA")

        pixels = np.asarray(image, dtype=np.uint8)
        output = pixels.copy()

        rgb = pixels[..., :3].astype(np.float32)
        alpha = pixels[..., 3].astype(np.float32)
        nonzero_alpha = alpha > 0
        semi_transparent = (alpha > 0) & (alpha < 255)

        output[..., :3] = 0

        if np.any(nonzero_alpha):
            scaled_rgb = rgb[nonzero_alpha] * 255.0 / alpha[nonzero_alpha, None]
            clipped_pixels = int(np.count_nonzero(np.any(scaled_rgb > 255.0, axis=1)))
            output[..., :3][nonzero_alpha] = np.rint(
                np.clip(scaled_rgb, 0.0, 255.0)
            ).astype(np.uint8)
        else:
            clipped_pixels = 0

        modified_pixels = int(np.count_nonzero(semi_transparent))

        result = Image.fromarray(output, mode="RGBA")
        result.save(png_path, format="PNG", optimize=True)

        print(
            f"{png_path.name}: "
            f"{modified_pixels} semi-transparent pixels modified, "
            f"{clipped_pixels} clipped pixels"
        )

    marker_path.write_text("unpremultiplied\n", encoding="utf-8")


if __name__ == "__main__":
    main()
