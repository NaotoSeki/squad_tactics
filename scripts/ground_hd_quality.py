"""Shared pixel-quality checks for normalized HD-ground assets."""

from __future__ import annotations

import numpy as np


VISIBLE_ALPHA_THRESHOLD = 16
MAGENTA_DOMINANCE_THRESHOLD = 70
MAGENTA_MIN_RED_BLUE = 160
CANONICAL_MAGENTA_SUPPORT = 40
CANONICAL_SUPPORT_MIN_RED_BLUE = 80
CANONICAL_NEIGHBORHOOD_RADIUS = 2


def _local_maximum(values: np.ndarray, radius: int) -> np.ndarray:
    if radius < 0:
        raise ValueError("radius must not be negative")
    if radius == 0:
        return values.copy()

    height, width = values.shape
    padded = np.pad(values, radius, constant_values=-255)
    result = np.full((height, width), -255, dtype=np.int16)
    for y_offset in range(radius * 2 + 1):
        for x_offset in range(radius * 2 + 1):
            np.maximum(
                result,
                padded[
                    y_offset : y_offset + height,
                    x_offset : x_offset + width,
                ],
                out=result,
            )
    return result


def conspicuous_magenta_spill(
    rgba: np.ndarray,
    canonical_rgba: np.ndarray,
) -> np.ndarray:
    """Find key-like magenta unsupported by the canonical PS artwork.

    Pink and purple flowers are valid canonical content. A raw ``R/B > G``
    check erases those details, so output magenta is only considered spill
    when the corresponding small canonical neighborhood has no magenta
    support at all.
    """

    if rgba.shape != canonical_rgba.shape:
        raise ValueError(
            f"output shape {rgba.shape} does not match canonical "
            f"shape {canonical_rgba.shape}"
        )
    if rgba.ndim != 3 or rgba.shape[2] != 4:
        raise ValueError("RGBA arrays must have shape (height, width, 4)")

    output = rgba.astype(np.int16, copy=False)
    canonical = canonical_rgba.astype(np.int16, copy=False)
    output_min_red_blue = np.minimum(output[:, :, 0], output[:, :, 2])
    output_dominance = output_min_red_blue - output[:, :, 1]
    output_key_like = (
        (output[:, :, 3] > VISIBLE_ALPHA_THRESHOLD)
        & (output_min_red_blue >= MAGENTA_MIN_RED_BLUE)
        & (output_dominance > MAGENTA_DOMINANCE_THRESHOLD)
    )

    canonical_min_red_blue = np.minimum(
        canonical[:, :, 0],
        canonical[:, :, 2],
    )
    canonical_dominance = (
        canonical_min_red_blue - canonical[:, :, 1]
    )
    canonical_supported = np.where(
        (
            (canonical[:, :, 3] > VISIBLE_ALPHA_THRESHOLD)
            & (
                canonical_min_red_blue
                >= CANONICAL_SUPPORT_MIN_RED_BLUE
            )
        ),
        canonical_dominance,
        -255,
    )
    local_canonical_dominance = _local_maximum(
        canonical_supported,
        CANONICAL_NEIGHBORHOOD_RADIUS,
    )
    return output_key_like & (
        local_canonical_dominance < CANONICAL_MAGENTA_SUPPORT
    )
