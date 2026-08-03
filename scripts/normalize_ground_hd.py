#!/usr/bin/env python3
"""Normalize an AI-reconstructed ground decal to the canonical PS footprint."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def alpha_bbox(alpha: np.ndarray, threshold: int = 4) -> tuple[int, int, int, int]:
    visible_y, visible_x = np.where(alpha > threshold)
    if not len(visible_x):
        raise ValueError("image has no visible alpha")
    return (
        int(visible_x.min()),
        int(visible_y.min()),
        int(visible_x.max()) + 1,
        int(visible_y.max()) + 1,
    )


def weighted_stats(
    rgb: np.ndarray,
    alpha: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    weights = np.clip(alpha.astype(np.float32) / 255.0, 0.0, 1.0)
    total = float(weights.sum())
    if total <= 0.0:
        raise ValueError("cannot grade an empty image")
    mean = (rgb * weights[:, :, None]).sum(axis=(0, 1)) / total
    variance = (
        ((rgb - mean) ** 2) * weights[:, :, None]
    ).sum(axis=(0, 1)) / total
    return mean, np.sqrt(np.maximum(variance, 1.0))


def normalize(
    reference: Image.Image,
    generated: Image.Image,
    scale: int,
    detail_contrast: float,
) -> Image.Image:
    reference = reference.convert("RGBA")
    generated = generated.convert("RGBA")
    output_size = (reference.width * scale, reference.height * scale)
    canonical = reference.resize(output_size, Image.Resampling.LANCZOS)
    canonical_array = np.asarray(canonical).astype(np.float32)
    canonical_alpha = canonical_array[:, :, 3]
    target_bbox = alpha_bbox(canonical_alpha)

    generated_array = np.asarray(generated)
    source_bbox = alpha_bbox(generated_array[:, :, 3])
    generated_crop = generated.crop(source_bbox).resize(
        (
            target_bbox[2] - target_bbox[0],
            target_bbox[3] - target_bbox[1],
        ),
        Image.Resampling.LANCZOS,
    )
    generated_canvas = Image.new("RGBA", output_size)
    generated_canvas.paste(generated_crop, target_bbox[:2], generated_crop)
    generated_canvas_array = np.asarray(generated_canvas).astype(np.float32)

    generated_mix = np.clip(
        generated_canvas_array[:, :, 3:4] / 255.0,
        0.0,
        1.0,
    )
    rgb = (
        generated_canvas_array[:, :, :3] * generated_mix
        + canonical_array[:, :, :3] * (1.0 - generated_mix)
    )

    source_mean, source_std = weighted_stats(rgb, canonical_alpha)
    target_mean, target_std = weighted_stats(
        canonical_array[:, :, :3],
        canonical_alpha,
    )
    rgb = (
        (rgb - source_mean)
        * ((target_std * detail_contrast) / source_std)
        + target_mean
    )
    rgb = np.clip(np.round(rgb), 0, 255).astype(np.uint8)
    alpha = np.clip(np.round(canonical_alpha), 0, 255).astype(np.uint8)

    rgba = np.empty((output_size[1], output_size[0], 4), dtype=np.uint8)
    rgba[:, :, :3] = rgb
    rgba[:, :, 3] = alpha
    rgba[alpha == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--generated", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scale", type=int, default=2)
    parser.add_argument("--detail-contrast", type=float, default=1.08)
    args = parser.parse_args()

    if args.scale < 1:
        raise ValueError("--scale must be at least 1")
    result = normalize(
        Image.open(args.reference),
        Image.open(args.generated),
        args.scale,
        args.detail_contrast,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.save(args.output, optimize=True)
    print(
        f"wrote {args.output}; size={result.size}; "
        f"bbox={result.getchannel('A').getbbox()}"
    )


if __name__ == "__main__":
    main()
