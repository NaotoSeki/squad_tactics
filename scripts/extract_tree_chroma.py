#!/usr/bin/env python3
"""Extract foliage from a near-flat chroma background without color halos."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt


def smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    scaled = np.clip((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return scaled * scaled * (3.0 - 2.0 * scaled)


def estimate_key(rgb: np.ndarray) -> np.ndarray:
    border = np.concatenate(
        (rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]),
        axis=0,
    )
    return np.median(border, axis=0)


def minimum_physical_alpha(rgb: np.ndarray, key: np.ndarray) -> np.ndarray:
    """Smallest alpha that keeps the recovered foreground inside RGB gamut."""
    candidates = []
    for channel in range(3):
        background = key[channel]
        values = rgb[:, :, channel]
        if background >= 127.5:
            candidates.append((background - values) / max(background, 1.0))
        else:
            candidates.append((values - background) / max(255.0 - background, 1.0))
    return np.maximum.reduce(candidates)


def extract(
    image: Image.Image,
    alpha_gain: float,
    noise_distance: float,
    opaque_distance: float,
) -> tuple[Image.Image, np.ndarray]:
    rgb = np.asarray(image.convert("RGB")).astype(np.float32)
    key = estimate_key(rgb)
    distance = np.linalg.norm(rgb - key, axis=2)

    alpha = np.clip(minimum_physical_alpha(rgb, key) * alpha_gain, 0.0, 1.0)
    alpha *= smoothstep(noise_distance, noise_distance * 2.0, distance)
    alpha = np.maximum(
        alpha,
        smoothstep(opaque_distance * 0.72, opaque_distance, distance),
    )
    alpha[distance <= noise_distance] = 0.0

    # Leaves and twigs are opaque surfaces; partial alpha represents pixel
    # coverage. Pull their RGB from the nearest clean interior pixel instead
    # of retaining magenta-contaminated edge RGB.
    red = rgb[:, :, 0]
    green = rgb[:, :, 1]
    blue = rgb[:, :, 2]
    magenta_spill = (
        (red > (green * 1.18) + 12.0)
        & (blue > (green * 1.18) + 12.0)
    )
    opaque = (alpha >= 0.985) & ~magenta_spill
    visible = alpha > 0.0
    if not opaque.any():
        raise ValueError("no opaque foreground pixels found")
    nearest = distance_transform_edt(
        ~opaque,
        return_distances=False,
        return_indices=True,
    )
    clean_rgb = rgb.copy()
    edge = visible & (~opaque | magenta_spill)
    clean_rgb[edge] = rgb[nearest[0][edge], nearest[1][edge]]

    rgba = np.empty((*alpha.shape, 4), dtype=np.uint8)
    rgba[:, :, :3] = np.clip(clean_rgb, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = np.round(alpha * 255).astype(np.uint8)
    rgba[~visible, :3] = 0
    return Image.fromarray(rgba, "RGBA"), key


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--alpha-gain", type=float, default=1.25)
    parser.add_argument("--noise-distance", type=float, default=34.0)
    parser.add_argument("--opaque-distance", type=float, default=220.0)
    args = parser.parse_args()

    result, key = extract(
        Image.open(args.input),
        alpha_gain=args.alpha_gain,
        noise_distance=args.noise_distance,
        opaque_distance=args.opaque_distance,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.save(args.output, optimize=True)
    alpha = np.asarray(result.getchannel("A"))
    print(
        f"wrote {args.output}; key={tuple(round(float(v), 2) for v in key)}; "
        f"transparent={(alpha == 0).sum()}; partial={((alpha > 0) & (alpha < 255)).sum()}"
    )


if __name__ == "__main__":
    main()
