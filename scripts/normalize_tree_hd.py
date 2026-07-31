#!/usr/bin/env python3
"""Normalize an AI tree cutout to the canonical PS sprite footprint."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt


def alpha_bbox(image: Image.Image, threshold: int) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    mask = alpha.point(lambda value: 255 if value > threshold else 0)
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError("input contains no visible pixels")
    return bbox


def repair_translucent_edge_colors(image: Image.Image) -> Image.Image:
    """Pull RGB for antialiased pixels from the nearest opaque subject pixel."""
    pixels = np.asarray(image).copy()
    alpha = pixels[:, :, 3]
    opaque = alpha >= 240
    edge = (alpha > 0) & ~opaque
    if not opaque.any() or not edge.any():
        return image

    nearest = distance_transform_edt(
        ~opaque,
        return_distances=False,
        return_indices=True,
    )
    pixels[edge, :3] = pixels[nearest[0][edge], nearest[1][edge], :3]
    return Image.fromarray(pixels, "RGBA")


def match_reference_color(
    image: Image.Image,
    reference: Image.Image,
) -> Image.Image:
    """Match opaque RGB channel statistics to the canonical PS reference."""
    pixels = np.asarray(image).astype(np.float32)
    reference_pixels = np.asarray(reference).astype(np.float32)
    source_mask = pixels[:, :, 3] >= 128
    reference_mask = reference_pixels[:, :, 3] >= 128
    if not source_mask.any() or not reference_mask.any():
        return image

    source_rgb = pixels[:, :, :3][source_mask]
    reference_rgb = reference_pixels[:, :, :3][reference_mask]
    source_mean = source_rgb.mean(axis=0)
    source_std = np.maximum(source_rgb.std(axis=0), 1.0)
    reference_mean = reference_rgb.mean(axis=0)
    reference_std = np.maximum(reference_rgb.std(axis=0), 1.0)

    pixels[:, :, :3] = (
        (pixels[:, :, :3] - source_mean)
        * (reference_std / source_std)
        + reference_mean
    )
    pixels[:, :, :3] = np.clip(pixels[:, :, :3], 0, 255)
    return Image.fromarray(pixels.astype(np.uint8), "RGBA")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scale", type=int, default=2)
    parser.add_argument("--alpha-threshold", type=int, default=8)
    args = parser.parse_args()

    if args.scale < 1:
        raise ValueError("--scale must be at least 1")

    reference = Image.open(args.reference).convert("RGBA")
    source = match_reference_color(
        repair_translucent_edge_colors(
            Image.open(args.input).convert("RGBA")
        ),
        reference,
    )
    source_bbox = alpha_bbox(source, args.alpha_threshold)
    reference_bbox = alpha_bbox(reference, args.alpha_threshold)

    target_size = (reference.width * args.scale, reference.height * args.scale)
    target_bbox = tuple(value * args.scale for value in reference_bbox)
    target_width = target_bbox[2] - target_bbox[0]
    target_height = target_bbox[3] - target_bbox[1]

    subject = source.crop(source_bbox).resize(
        (target_width, target_height),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", target_size, (0, 0, 0, 0))
    canvas.alpha_composite(subject, (target_bbox[0], target_bbox[1]))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output, optimize=True)
    print(
        f"normalized {source_bbox=} to {target_bbox=} "
        f"on {target_size[0]}x{target_size[1]}"
    )


if __name__ == "__main__":
    main()
