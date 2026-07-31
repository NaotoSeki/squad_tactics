#!/usr/bin/env python3
"""Build a deterministic PS-calibrated cast shadow from a tree alpha matte."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def project_alpha(
    alpha: Image.Image,
    output_size: tuple[int, int],
    body_anchor: tuple[float, float],
    shadow_anchor: tuple[float, float],
    matrix: tuple[float, float, float, float],
    offset: tuple[float, float] = (0.0, 0.0),
) -> Image.Image:
    """Project body pixels to the ground with an anchor-preserving affine."""
    a, b, d, e = matrix
    determinant = (a * e) - (b * d)
    if abs(determinant) < 1e-8:
        raise ValueError("shadow projection matrix is singular")

    inverse_a = e / determinant
    inverse_b = -b / determinant
    inverse_d = -d / determinant
    inverse_e = a / determinant

    body_x, body_y = body_anchor
    shadow_x = shadow_anchor[0] + offset[0]
    shadow_y = shadow_anchor[1] + offset[1]
    inverse_c = body_x - inverse_a * shadow_x - inverse_b * shadow_y
    inverse_f = body_y - inverse_d * shadow_x - inverse_e * shadow_y

    return alpha.transform(
        output_size,
        Image.Transform.AFFINE,
        (
            inverse_a,
            inverse_b,
            inverse_c,
            inverse_d,
            inverse_e,
            inverse_f,
        ),
        resample=Image.Resampling.BICUBIC,
    )


def scale_to_reference_density(
    alpha: np.ndarray,
    support: np.ndarray,
    target_mean: float,
    max_alpha: float,
    minimum_visible_alpha: float,
) -> np.ndarray:
    """Tone-map coverage to the calibrated mean while retaining a true dark core."""
    peak = float(alpha[support].max()) if support.any() else 0.0
    if peak <= 0.0:
        return np.zeros_like(alpha)

    normalized = np.clip(alpha / peak, 0.0, 1.0)
    low = 0.05
    high = 256.0
    for _ in range(32):
        gamma = (low + high) / 2.0
        candidate = minimum_visible_alpha + (
            np.power(normalized, gamma) * (max_alpha - minimum_visible_alpha)
        )
        mean = candidate[support].mean() if support.any() else 0.0
        if mean > target_mean:
            low = gamma
        else:
            high = gamma
    result = minimum_visible_alpha + (
        np.power(normalized, high) * (max_alpha - minimum_visible_alpha)
    )
    result[~support] = 0.0
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("asset/environment/trees_hd/manifest.json"),
    )
    parser.add_argument(
        "--tree",
        type=Path,
        default=Path("asset/environment/trees_hd/quercus-cerris_a_02_hd_v2.png"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(
            "asset/environment/trees_hd/quercus-cerris_a_02_shadow_hd_v2.png"
        ),
    )
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    tree = manifest["overrides"][0]
    definition = manifest["generationDefinition"]["postprocess"]["shadowDefinition"]
    source = Image.open(args.tree).convert("RGBA")
    body_anchor = (
        float(tree["ox"]) * source.width,
        float(tree["oy"]) * source.height,
    )
    output_size = (int(tree["stw"]), int(tree["sth"]))
    shadow_anchor = (
        float(tree["sox"]) * output_size[0],
        float(tree["soy"]) * output_size[1],
    )
    source_array = np.asarray(source).astype(np.float32)
    source_alpha = source_array[:, :, 3]
    y, x = np.indices(source_alpha.shape)
    segmentation = definition["segmentation"]
    red = source_array[:, :, 0]
    green = source_array[:, :, 1]
    blue = source_array[:, :, 2]
    trunk_region = (
        (np.abs(x - body_anchor[0]) <= float(segmentation["trunkHalfWidthPx"]))
        & (y >= body_anchor[1] - float(segmentation["trunkHeightPx"]))
        & (green <= (red * float(segmentation["maxGreenToRedRatio"])))
        & (blue <= (green * float(segmentation["maxBlueToGreenRatio"])))
    )
    trunk_alpha_array = np.where(trunk_region, source_alpha, 0.0)
    canopy_alpha_array = np.where(trunk_region, 0.0, source_alpha)
    trunk_alpha = Image.fromarray(
        np.clip(np.round(trunk_alpha_array), 0, 255).astype(np.uint8),
        "L",
    )
    canopy_alpha = Image.fromarray(
        np.clip(np.round(canopy_alpha_array), 0, 255).astype(np.uint8),
        "L",
    )

    canopy_definition = definition["canopyProjection"]
    canopy = project_alpha(
        canopy_alpha,
        output_size,
        body_anchor,
        shadow_anchor,
        tuple(float(value) for value in canopy_definition["matrix"]),
        tuple(float(value) for value in canopy_definition["offsetPx"]),
    )
    canopy = canopy.filter(
        ImageFilter.GaussianBlur(float(canopy_definition["blurRadiusPx"]))
    )
    trunk_definition = definition["trunkProjection"]
    trunk = project_alpha(
        trunk_alpha,
        output_size,
        body_anchor,
        shadow_anchor,
        tuple(float(value) for value in trunk_definition["matrix"]),
        tuple(float(value) for value in trunk_definition["offsetPx"]),
    )
    trunk = trunk.filter(
        ImageFilter.GaussianBlur(float(trunk_definition["blurRadiusPx"]))
    )

    canopy_array = np.asarray(canopy).astype(np.float32) / 255.0
    trunk_array = np.asarray(trunk).astype(np.float32) / 255.0
    alpha = (1.0 - ((1.0 - canopy_array) * (1.0 - trunk_array))) * 255.0
    alpha[alpha < float(definition["alphaFloor"])] = 0.0
    support = alpha > 0.0
    alpha = scale_to_reference_density(
        alpha,
        support,
        float(definition["targetMeanVisibleAlpha"]),
        float(definition["maxAlpha"]),
        float(definition["alphaFloor"]),
    )
    alpha_u8 = np.clip(np.round(alpha), 0, 255).astype(np.uint8)

    color = np.asarray(definition["color"], dtype=np.uint8)
    rgba = np.empty((output_size[1], output_size[0], 4), dtype=np.uint8)
    rgba[:, :, :3] = color
    rgba[:, :, 3] = alpha_u8
    rgba[alpha_u8 == 0, :3] = 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(args.output, optimize=True)
    visible = alpha_u8 > 0
    print(
        f"wrote {args.output}; bbox={Image.fromarray(alpha_u8).getbbox()}; "
        f"max_alpha={alpha_u8.max()}; "
        f"mean_visible={alpha_u8[visible].mean():.2f}"
    )


if __name__ == "__main__":
    main()
