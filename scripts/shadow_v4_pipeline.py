#!/usr/bin/env python3
"""Direct, body-authoritative cast-shadow projection without bbox warping."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter
from scipy.optimize import minimize

try:
    from .raised_hd_pipeline import (
        LIGHTING_CONTRACT,
        PIXEL_RATIO,
        SHADOW_COLOR,
        SHADOW_VECTOR,
        _project_alpha,
        _scale_shadow_density,
        alpha_bbox,
        alpha_sha256,
        nearest_alpha_point,
    )
except ImportError:
    from raised_hd_pipeline import (
        LIGHTING_CONTRACT,
        PIXEL_RATIO,
        SHADOW_COLOR,
        SHADOW_VECTOR,
        _project_alpha,
        _scale_shadow_density,
        alpha_bbox,
        alpha_sha256,
        nearest_alpha_point,
    )


def _projection_samples(
    alpha: np.ndarray,
    *,
    threshold: int = 8,
    limit: int = 60_000,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    ys, xs = np.nonzero(alpha >= threshold)
    if not len(xs):
        ys, xs = np.nonzero(alpha > 0)
    if not len(xs):
        raise ValueError("body alpha is empty")
    weights = alpha[ys, xs].astype(np.float64)
    if len(xs) > limit:
        step = max(1, len(xs) // limit)
        xs = xs[::step]
        ys = ys[::step]
        weights = weights[::step]
    return xs.astype(np.float64), ys.astype(np.float64), weights


def fit_direct_projection(
    body_alpha: Image.Image,
    body_contact: tuple[float, float],
    shadow_contact: tuple[float, float],
    calibration: dict[str, Any],
) -> dict[str, Any]:
    """Fit physical projection parameters to numeric canonical measurements."""
    alpha = np.asarray(body_alpha, dtype=np.uint8)
    xs, ys, weights = _projection_samples(alpha)
    relative_x = xs - float(body_contact[0])
    height = float(body_contact[1]) - ys
    direction_length = math.hypot(*SHADOW_VECTOR)
    direction_x = SHADOW_VECTOR[0] / direction_length
    direction_y = SHADOW_VECTOR[1] / direction_length

    target_bbox = tuple(float(value) for value in calibration["targetBbox"])
    target_width = max(1.0, target_bbox[2] - target_bbox[0])
    target_height = max(1.0, target_bbox[3] - target_bbox[1])
    target_centroid = (
        float(calibration["referenceCentroid"][0]) * PIXEL_RATIO,
        float(calibration["referenceCentroid"][1]) * PIXEL_RATIO,
    )

    def transform(parameters: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        horizontal_scale, cross_scale, cast_rate = parameters
        target_x = (
            float(shadow_contact[0])
            + horizontal_scale * relative_x
            + direction_x * cast_rate * height
        )
        target_y = (
            float(shadow_contact[1])
            + cross_scale * relative_x
            + direction_y * cast_rate * height
        )
        return target_x, target_y

    def objective(parameters: np.ndarray) -> float:
        target_x, target_y = transform(parameters)
        projected_bbox = (
            float(target_x.min()),
            float(target_y.min()),
            float(target_x.max() + 1.0),
            float(target_y.max() + 1.0),
        )
        bbox_error = sum(
            (
                (actual - expected)
                / (target_width if index % 2 == 0 else target_height)
            )
            ** 2
            for index, (actual, expected) in enumerate(
                zip(projected_bbox, target_bbox)
            )
        )
        centroid = (
            float(np.average(target_x, weights=weights)),
            float(np.average(target_y, weights=weights)),
        )
        centroid_error = (
            ((centroid[0] - target_centroid[0]) / target_width) ** 2
            + ((centroid[1] - target_centroid[1]) / target_height) ** 2
        )
        # Keep the lateral ground-plane term restrained. It models isometric
        # depth, not an independent second light direction.
        regularization = (float(parameters[1]) / 0.35) ** 2 * 0.025
        return bbox_error * 3.5 + centroid_error * 1.25 + regularization

    result = minimize(
        objective,
        np.asarray((0.62, 0.06, 0.65), dtype=np.float64),
        method="Powell",
        bounds=((0.18, 1.35), (-0.42, 0.42), (0.08, 1.8)),
        options={"maxiter": 180, "xtol": 1e-5, "ftol": 1e-7},
    )
    horizontal_scale, cross_scale, cast_rate = (
        float(value) for value in result.x
    )
    matrix = (
        horizontal_scale,
        -direction_x * cast_rate,
        cross_scale,
        -direction_y * cast_rate,
    )
    projected_x, projected_y = transform(result.x)
    return {
        "matrix": matrix,
        "horizontalScale": horizontal_scale,
        "crossScale": cross_scale,
        "castRate": cast_rate,
        "objective": float(result.fun),
        "converged": bool(result.success),
        "iterations": int(result.nit),
        "rawProjectedBbox": [
            float(projected_x.min()),
            float(projected_y.min()),
            float(projected_x.max() + 1.0),
            float(projected_y.max() + 1.0),
        ],
        "rawProjectedCentroid": [
            float(np.average(projected_x, weights=weights)),
            float(np.average(projected_y, weights=weights)),
        ],
    }


def _weighted_shape(
    mask: Image.Image,
    *,
    threshold: int = 4,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    alpha = np.asarray(mask, dtype=np.uint8)
    xs, ys, weights = _projection_samples(alpha, threshold=threshold)
    centroid = np.asarray(
        (
            float(np.average(xs, weights=weights)),
            float(np.average(ys, weights=weights)),
        ),
        dtype=np.float64,
    )
    centered = np.column_stack((xs - centroid[0], ys - centroid[1]))
    covariance = (
        (centered * weights[:, None]).T @ centered
        / max(float(weights.sum()), 1.0)
    )
    return xs, ys, weights, centroid, covariance


def _fit_shape_projection(
    source_mask: Image.Image,
    source_anchor: tuple[float, float],
    target_anchor: tuple[float, float],
    calibration: dict[str, Any],
    *,
    floating_centroid: bool,
    family: str,
) -> dict[str, Any]:
    xs, ys, weights, source_centroid, source_covariance = _weighted_shape(
        source_mask
    )
    relative = np.column_stack(
        (
            xs - float(source_anchor[0]),
            ys - float(source_anchor[1]),
        )
    )
    target_bbox = np.asarray(calibration["targetBbox"], dtype=np.float64)
    target_width = max(1.0, target_bbox[2] - target_bbox[0])
    target_height = max(1.0, target_bbox[3] - target_bbox[1])
    target_centroid = (
        np.asarray(calibration["referenceCentroid"], dtype=np.float64)
        * PIXEL_RATIO
    )
    target_covariance = (
        np.asarray(calibration["referenceCovariance"], dtype=np.float64)
        * (PIXEL_RATIO**2)
    )
    target_trace = max(float(np.trace(target_covariance)), 1.0)

    if family in {"tree", "shrub"}:
        initial = np.asarray((0.95, 0.0, 0.06, 0.48), dtype=np.float64)
        bounds = ((0.28, 1.55), (-0.35, 0.35), (-0.4, 0.4), (0.1, 0.95))
    else:
        initial = np.asarray((0.95, 0.0, 0.08, 0.62), dtype=np.float64)
        bounds = ((0.2, 1.9), (-0.5, 0.5), (-0.6, 0.6), (0.12, 1.6))

    target_anchor_array = np.asarray(target_anchor, dtype=np.float64)

    def transform(
        parameters: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        matrix = np.asarray(
            (
                (parameters[0], parameters[1]),
                (parameters[2], parameters[3]),
            ),
            dtype=np.float64,
        )
        transformed_centroid = (
            target_anchor_array
            + matrix @ (source_centroid - np.asarray(source_anchor))
        )
        offset = (
            target_centroid - transformed_centroid
            if floating_centroid
            else np.zeros(2, dtype=np.float64)
        )
        points = relative @ matrix.T + target_anchor_array + offset
        covariance = matrix @ source_covariance @ matrix.T
        return points, covariance, offset, matrix

    def objective(parameters: np.ndarray) -> float:
        points, covariance, offset, matrix = transform(parameters)
        projected_bbox = np.asarray(
            (
                points[:, 0].min(),
                points[:, 1].min(),
                points[:, 0].max() + 1.0,
                points[:, 1].max() + 1.0,
            )
        )
        bbox_scale = np.asarray(
            (target_width, target_height, target_width, target_height)
        )
        bbox_error = float(
            np.mean(((projected_bbox - target_bbox) / bbox_scale) ** 2)
        )
        covariance_error = float(
            np.mean(
                ((covariance - target_covariance) / target_trace) ** 2
            )
        )
        centroid = np.average(points, axis=0, weights=weights)
        centroid_error = float(
            ((centroid[0] - target_centroid[0]) / target_width) ** 2
            + ((centroid[1] - target_centroid[1]) / target_height) ** 2
        )
        determinant = float(np.linalg.det(matrix))
        determinant_penalty = (
            ((0.035 - determinant) / 0.035) ** 2 * 4.0
            if determinant < 0.035
            else 0.0
        )
        shear_penalty = (
            (float(parameters[1]) / 0.5) ** 2
            + (float(parameters[2]) / 0.6) ** 2
        ) * 0.008
        offset_penalty = (
            float(np.dot(offset, offset))
            / max(target_width * target_width, target_height * target_height)
            * 0.04
        )
        return (
            bbox_error * 3.0
            + covariance_error * 10.0
            + centroid_error * 1.5
            + determinant_penalty
            + shear_penalty
            + offset_penalty
        )

    result = minimize(
        objective,
        initial,
        method="Powell",
        bounds=bounds,
        options={"maxiter": 240, "xtol": 1e-5, "ftol": 1e-8},
    )
    points, covariance, offset, matrix = transform(result.x)
    return {
        "matrix": tuple(float(value) for value in matrix.ravel()),
        "offset": tuple(float(value) for value in offset),
        "objective": float(result.fun),
        "converged": bool(result.success),
        "iterations": int(result.nit),
        "rawProjectedBbox": [
            float(points[:, 0].min()),
            float(points[:, 1].min()),
            float(points[:, 0].max() + 1.0),
            float(points[:, 1].max() + 1.0),
        ],
        "rawProjectedCentroid": [
            float(value)
            for value in np.average(points, axis=0, weights=weights)
        ],
        "projectedCovariance": [
            [float(value) for value in row] for row in covariance
        ],
    }


def _lower_envelope_mask(
    body_alpha: Image.Image,
    *,
    family: str,
) -> Image.Image:
    alpha = np.asarray(body_alpha, dtype=np.uint8)
    visible = alpha > 4
    output = np.zeros_like(alpha)
    bbox = body_alpha.getbbox()
    if not bbox:
        raise ValueError("body alpha is empty")
    height = bbox[3] - bbox[1]
    band_fraction = {
        "building": 0.04,
        "fence": 0.03,
        "large_prop": 0.012,
    }.get(family, 0.025)
    band = max(1 if family == "large_prop" else 2, round(height * band_fraction))
    for x in range(bbox[0], bbox[2]):
        column = np.nonzero(visible[bbox[1]:bbox[3], x])[0]
        if not len(column):
            continue
        bottom = bbox[1] + int(column[-1])
        top = max(bbox[1], bottom - band + 1)
        values = alpha[top:bottom + 1, x]
        output[top:bottom + 1, x] = np.maximum(values, 210)
    blur = 0.08 if family == "large_prop" else 0.32
    return Image.fromarray(output, "L").filter(ImageFilter.GaussianBlur(blur))


def _tree_layers(
    body: Image.Image,
    body_contact: tuple[float, float],
) -> tuple[Image.Image, Image.Image]:
    rgba = np.asarray(body.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[:, :, 3]
    height, width = alpha.shape
    visible = alpha > 4
    trunk = np.zeros_like(visible)
    center = float(body_contact[0])
    max_width = max(6, round(width * 0.09))
    max_step = max(4.0, width * 0.035)
    top_limit = max(0, round(body_contact[1] - height * 0.34))
    missing_rows = 0
    for row_y in range(min(height - 1, round(body_contact[1])), top_limit - 1, -1):
        row = np.nonzero(visible[row_y])[0]
        if not len(row):
            missing_rows += 1
            if missing_rows > 4:
                break
            continue
        runs = np.split(row, np.where(np.diff(row) > 1)[0] + 1)
        selected = min(
            runs,
            key=lambda run: (
                0.0
                if int(run[0]) <= center <= int(run[-1])
                else min(abs(float(run[0]) - center), abs(float(run[-1]) - center))
            ),
        )
        distance = (
            0.0
            if int(selected[0]) <= center <= int(selected[-1])
            else min(
                abs(float(selected[0]) - center),
                abs(float(selected[-1]) - center),
            )
        )
        if distance > max_step:
            missing_rows += 1
            if missing_rows > 4:
                break
            continue
        missing_rows = 0
        run_center = (float(selected[0]) + float(selected[-1])) * 0.5
        run_width = int(selected[-1] - selected[0] + 1)
        if run_width > max_width:
            # The shaft has reached the crown/branch mass. Do not carve an
            # arbitrary central corridor through the foliage.
            break
        left = int(selected[0])
        right = int(selected[-1])
        trunk[row_y, left:right + 1] = True
        center = (center * 0.72) + (run_center * 0.28)
    trunk_alpha = np.where(trunk, alpha, 0).astype(np.uint8)
    canopy_alpha = np.where(trunk, 0, alpha).astype(np.uint8)
    return (
        Image.fromarray(canopy_alpha, "L"),
        Image.fromarray(trunk_alpha, "L"),
    )


def _render_shape_projection(
    source_mask: Image.Image,
    target_size: tuple[int, int],
    source_anchor: tuple[float, float],
    target_anchor: tuple[float, float],
    fit: dict[str, Any],
    *,
    blur_radius: float,
) -> Image.Image:
    target_with_offset = (
        target_anchor[0] + fit["offset"][0],
        target_anchor[1] + fit["offset"][1],
    )
    projected = _project_alpha(
        source_mask,
        target_size,
        source_anchor,
        target_with_offset,
        tuple(float(value) for value in fit["matrix"]),
    )
    return projected.filter(ImageFilter.GaussianBlur(blur_radius))


def _foliage_occlusion(
    body: Image.Image,
    canopy_alpha: Image.Image,
) -> Image.Image:
    """Derive soft crown occlusion from the generated foliage, not a solid fill."""
    rgba = np.asarray(body.convert("RGBA"), dtype=np.float32)
    alpha = np.asarray(canopy_alpha, dtype=np.float32) / 255.0
    visible = alpha > 0.02
    if not np.any(visible):
        return canopy_alpha
    luminance = (
        rgba[:, :, 0] * 0.2126
        + rgba[:, :, 1] * 0.7152
        + rgba[:, :, 2] * 0.0722
    )
    low, high = np.percentile(luminance[visible], (7.0, 93.0))
    normalized = np.clip(
        (luminance - float(low)) / max(float(high - low), 1.0),
        0.0,
        1.0,
    )
    density = 0.62 + ((1.0 - normalized) * 0.38)
    occlusion = alpha * density * 255.0
    return Image.fromarray(
        np.clip(np.round(occlusion), 0, 255).astype(np.uint8),
        "L",
    )


def _trunk_base_width(
    trunk: Image.Image,
    body_contact: tuple[float, float],
) -> int:
    alpha = np.asarray(trunk, dtype=np.uint8)
    top = max(0, round(body_contact[1] - alpha.shape[0] * 0.12))
    bottom = min(alpha.shape[0], round(body_contact[1]) + 1)
    widths: list[int] = []
    for row_y in range(top, bottom):
        row = np.nonzero(alpha[row_y] > 4)[0]
        if len(row):
            widths.append(int(row[-1] - row[0] + 1))
    return max(2, round(float(np.median(widths)))) if widths else 2


def _visible_fill(image: Image.Image) -> float:
    bbox = image.getbbox()
    if not bbox:
        return 0.0
    alpha = np.asarray(image, dtype=np.uint8)
    return float(
        np.mean(alpha[bbox[1]:bbox[3], bbox[0]:bbox[2]] > 0)
    )


def _match_contact_fill(
    image: Image.Image,
    target_fill: float,
) -> tuple[Image.Image, int]:
    """Select a modest dilation that best matches numeric PS occupancy."""
    best = image
    best_kernel = 1
    best_error = abs(_visible_fill(image) - target_fill)
    for kernel in range(3, 26, 2):
        candidate = image.filter(ImageFilter.MaxFilter(kernel))
        error = abs(_visible_fill(candidate) - target_fill)
        if error < best_error:
            best = candidate
            best_kernel = kernel
            best_error = error
    return best, best_kernel


def synthesize_shadow_v4(
    body: Image.Image,
    body_origin: list[int] | tuple[int, int],
    body_contact: tuple[float, float],
    shadow_origin: list[int] | tuple[int, int],
    calibration: dict[str, Any],
    *,
    family: str,
    canonical_body: Image.Image | None = None,
    light_only: bool = False,
) -> tuple[Image.Image, dict[str, Any]]:
    """Render from the accepted body using the PS pair as transform calibration."""
    body = body.convert("RGBA")
    body_alpha = body.getchannel("A")
    if canonical_body is None:
        canonical_body = body
    else:
        canonical_body = canonical_body.convert("RGBA").resize(
            body.size,
            Image.Resampling.LANCZOS,
        )
    canonical_alpha = canonical_body.getchannel("A")
    target_size = tuple(int(value) for value in calibration["targetSize"])
    shadow_contact = (
        float(calibration["referenceContact"][0]) * PIXEL_RATIO,
        float(calibration["referenceContact"][1]) * PIXEL_RATIO,
    )
    layer_metrics: dict[str, Any]
    if family == "tree":
        canopy, trunk = _tree_layers(body, body_contact)
        canonical_canopy, _canonical_trunk = _tree_layers(
            canonical_body,
            body_contact,
        )
        # Fit the light/camera transform from the paired canonical BODY and
        # SHADOW. Apply that transform to the generated crown itself. A
        # three-pixel close only joins sub-pixel matte pinholes; it does not
        # replace the crown with a filled silhouette.
        canopy_kernel = 3
        canonical_fit_source = canonical_canopy.filter(
            ImageFilter.MaxFilter(canopy_kernel)
        )
        canopy_source = _foliage_occlusion(
            body,
            canopy.filter(ImageFilter.MaxFilter(canopy_kernel)),
        )
        fit = _fit_shape_projection(
            canonical_fit_source,
            body_contact,
            shadow_contact,
            calibration,
            floating_centroid=True,
            family=family,
        )
        canopy_shadow = _render_shape_projection(
            canopy_source,
            target_size,
            body_contact,
            shadow_contact,
            fit,
            blur_radius=max(
                0.85,
                float(calibration["blurRadiusPx"]) * 0.42,
            ),
        )
        projected_trunk_width = max(
            3,
            round(
                _trunk_base_width(trunk, body_contact)
                * abs(float(fit["matrix"][0]))
                * 0.78
            ),
        )
        # The PS pair places the trunk-base cutout above the ground contact;
        # the trunk cast begins at that contact and runs lower-right.
        notch = Image.new("L", target_size, 0)
        notch_draw = ImageDraw.Draw(notch)
        notch_draw.line(
            (
                (shadow_contact[0], 0),
                (shadow_contact[0], shadow_contact[1] + 1.0),
            ),
            fill=255,
            width=projected_trunk_width,
        )
        notch = notch.filter(ImageFilter.GaussianBlur(0.45))
        canopy_shadow = ImageChops.subtract(canopy_shadow, notch)
        direction_length = math.hypot(*SHADOW_VECTOR)
        trunk_rate = float(
            np.clip(
                max(target_size) / max(body.height, 1) * 0.38,
                0.16,
                0.42,
            )
        )
        trunk_matrix = (
            0.9,
            -(SHADOW_VECTOR[0] / direction_length) * trunk_rate,
            0.04,
            -(SHADOW_VECTOR[1] / direction_length) * trunk_rate,
        )
        trunk_shadow = _project_alpha(
            trunk,
            target_size,
            body_contact,
            shadow_contact,
            trunk_matrix,
        ).filter(ImageFilter.GaussianBlur(0.7))
        projected = ImageChops.lighter(canopy_shadow, trunk_shadow)
        layer_metrics = {
            "sourceLayer": (
                "generated canopy and trunk alpha; transform fitted from "
                "paired canonical BODY/SHADOW"
            ),
            "canopyFit": fit,
            "trunkProjectionMatrix": list(trunk_matrix),
            "canopyOcclusionKernel": canopy_kernel,
            "notchDirection": "canvas top to generated trunk-base contact",
            "projectedTrunkWidth": projected_trunk_width,
        }
        blur_radius = max(
            0.85,
            float(calibration["blurRadiusPx"]) * 0.42,
        )
    elif family == "shrub":
        fit = _fit_shape_projection(
            canonical_alpha,
            body_contact,
            shadow_contact,
            calibration,
            floating_centroid=True,
            family=family,
        )
        blur_radius = max(
            0.8,
            float(calibration["blurRadiusPx"]) * 0.4,
        )
        projected = _render_shape_projection(
            body_alpha,
            target_size,
            body_contact,
            shadow_contact,
            fit,
            blur_radius=blur_radius,
        )
        layer_metrics = {
            "sourceLayer": "generated shrub alpha",
            "shapeFit": fit,
        }
    else:
        contact_mask = _lower_envelope_mask(body_alpha, family=family)
        canonical_contact_mask = _lower_envelope_mask(
            canonical_alpha,
            family=family,
        )
        fit = _fit_shape_projection(
            canonical_contact_mask,
            body_contact,
            shadow_contact,
            calibration,
            floating_centroid=False,
            family=family,
        )
        blur_radius = max(
            0.32,
            float(calibration["blurRadiusPx"])
            * (
                0.22
                if family == "building"
                else 0.16
                if family == "fence"
                else 0.13
            ),
        )
        projected = _render_shape_projection(
            contact_mask,
            target_size,
            body_contact,
            shadow_contact,
            fit,
            blur_radius=blur_radius,
        )
        fill_kernel = 1
        if family in {"building", "fence"}:
            projected, fill_kernel = _match_contact_fill(
                projected,
                float(calibration["referenceFillRatio"]),
            )
        layer_metrics = {
            "sourceLayer": "generated lower-envelope contact alpha",
            "shapeFit": fit,
            "fillKernel": fill_kernel,
        }

    alpha = np.asarray(projected, dtype=np.float32)
    alpha[alpha < 0.75] = 0.0
    if family == "tree":
        support = alpha > 0
        peak = max(float(alpha[support].max()), 1.0)
        normalized = np.clip(alpha / peak, 0.0, 1.0)
        floor = float(calibration["alphaFloor"])
        core = min(
            float(calibration["targetMaxAlpha"]),
            float(calibration["targetMeanVisibleAlpha"]) * 1.16,
        )
        alpha = floor + np.power(normalized, 0.82) * (core - floor)
        alpha[~support] = 0.0
        mean = float(alpha[support].mean())
        if mean > 0:
            alpha[support] *= (
                float(calibration["targetMeanVisibleAlpha"]) / mean
            )
        alpha = np.clip(
            alpha,
            0.0,
            float(calibration["targetMaxAlpha"]),
        )
        contact_x = int(
            np.clip(round(shadow_contact[0]), 0, target_size[0] - 1)
        )
        contact_y = int(
            np.clip(round(shadow_contact[1]), 0, target_size[1] - 1)
        )
        alpha[contact_y, contact_x] = float(
            calibration["targetMaxAlpha"]
        )
    else:
        alpha = _scale_shadow_density(
            alpha,
            float(calibration["targetMeanVisibleAlpha"]),
            float(calibration["targetMaxAlpha"]),
            float(calibration["alphaFloor"]),
        )
    dark_core_removed = False
    light_knee_alpha = 52.0
    light_cap_alpha = 76.0
    if light_only:
        above = alpha > light_knee_alpha
        alpha[above] = light_knee_alpha + (
            (light_cap_alpha - light_knee_alpha)
            * (
                1.0
                - np.exp(
                    -(alpha[above] - light_knee_alpha)
                    / (light_cap_alpha - light_knee_alpha)
                )
            )
        )
        dark_core_removed = True
    alpha_u8 = np.clip(np.round(alpha), 0, 255).astype(np.uint8)
    if not np.any(alpha_u8):
        raise ValueError("direct body projection produced an empty shadow")

    rgba = np.zeros((target_size[1], target_size[0], 4), dtype=np.uint8)
    rgba[:, :, :3] = np.asarray(SHADOW_COLOR, dtype=np.uint8)
    rgba[:, :, 3] = alpha_u8
    rgba[alpha_u8 == 0, :3] = 0
    shadow = Image.fromarray(rgba, "RGBA")
    result_contact = nearest_alpha_point(shadow, shadow_contact, threshold=0)
    body_world_contact = (
        float(body_origin[0] * PIXEL_RATIO) + body_contact[0],
        float(body_origin[1] * PIXEL_RATIO) + body_contact[1],
    )
    shadow_world_contact = (
        float(shadow_origin[0] * PIXEL_RATIO) + shadow_contact[0],
        float(shadow_origin[1] * PIXEL_RATIO) + shadow_contact[1],
    )
    visible = alpha_u8 > 0
    metrics = {
        "method": (
            "family-specific projection from accepted generated BODY alpha; "
            "paired canonical BODY/SHADOW supplies transform calibration only"
        ),
        "version": "shadow-v4-paired-transform",
        "family": family,
        "bodyAlphaSha256": alpha_sha256(body),
        "canonicalShadowRole": calibration["referenceRole"],
        "canonicalShadowPixelsCopied": False,
        "lightingContract": LIGHTING_CONTRACT,
        "shadowScreenVector": list(SHADOW_VECTOR),
        "projectionMatrix": [
            round(float(value), 8) for value in fit["matrix"]
        ],
        "layers": layer_metrics,
        "bodyContact": [round(value, 4) for value in body_contact],
        "bodyWorldContact": [
            round(value, 4) for value in body_world_contact
        ],
        "shadowContact": [round(value, 4) for value in shadow_contact],
        "shadowContactWorld": [
            round(value, 4) for value in shadow_world_contact
        ],
        "contactWorldDelta": [
            round(shadow_world_contact[0] - body_world_contact[0], 4),
            round(shadow_world_contact[1] - body_world_contact[1], 4),
        ],
        "resultContact": [round(value, 4) for value in result_contact],
        "contactErrorPx": round(math.dist(shadow_contact, result_contact), 6),
        "resultBbox": list(alpha_bbox(shadow, threshold=0)),
        "targetMeanVisibleAlpha": calibration["targetMeanVisibleAlpha"],
        "meanVisibleAlpha": round(float(alpha_u8[visible].mean()), 6),
        "targetMaxAlpha": calibration["targetMaxAlpha"],
        "maxAlpha": int(alpha_u8.max()),
        "darkCoreRemoved": dark_core_removed,
        "lightOnlyKneeAlpha": (
            light_knee_alpha if dark_core_removed else None
        ),
        "lightOnlyCapAlpha": (
            light_cap_alpha if dark_core_removed else None
        ),
        "blurRadiusPx": round(
            blur_radius,
            6,
        ),
        "outputAlphaSha256": alpha_sha256(shadow),
    }
    return shadow, metrics


def _parity_bias(alpha: np.ndarray) -> float:
    """Measure even/odd row or column density bias from raster striping."""
    scores: list[float] = []
    for axis in (0, 1):
        means: list[float] = []
        for parity in (0, 1):
            sample = (
                alpha[parity::2, :]
                if axis == 0
                else alpha[:, parity::2]
            )
            visible = sample[sample > 0]
            means.append(float(visible.mean()) if len(visible) else 0.0)
        scores.append(
            abs(means[0] - means[1]) / max(float(np.mean(means)), 1.0)
        )
    return max(scores)


def validate_shadow_v4(
    shadow: Image.Image,
    canonical_shadow: Image.Image,
    calibration: dict[str, Any],
    derivation: dict[str, Any],
    *,
    family: str,
) -> dict[str, Any]:
    """Validate the approved paired-transform, light-only shadow contract."""
    shadow = shadow.convert("RGBA")
    canonical_shadow = canonical_shadow.convert("RGBA")
    expected_size = tuple(int(value) for value in calibration["targetSize"])
    if shadow.size != expected_size:
        raise ValueError(
            f"shadow size {shadow.size} is not exact 2x "
            f"{canonical_shadow.size}"
        )
    if derivation.get("version") != "shadow-v4-paired-transform":
        raise ValueError("shadow is not produced by the V4 paired transform")
    if derivation.get("canonicalShadowPixelsCopied") is not False:
        raise ValueError("canonical shadow pixel reuse must remain forbidden")
    if derivation.get("darkCoreRemoved") is not True:
        raise ValueError("V4 production shadow must use the light-only grade")

    alpha = np.asarray(shadow.getchannel("A"), dtype=np.uint8)
    visible = alpha > 0
    if not np.any(visible):
        raise ValueError("generated V4 shadow is empty")
    cap = int(round(float(derivation["lightOnlyCapAlpha"])))
    if int(alpha.max()) != cap or cap != 76:
        raise ValueError(
            f"light-only shadow peak must be 76, got {int(alpha.max())}"
        )

    canonical_lanczos = canonical_shadow.getchannel("A").resize(
        expected_size,
        Image.Resampling.LANCZOS,
    )
    canonical_nearest = canonical_shadow.getchannel("A").resize(
        expected_size,
        Image.Resampling.NEAREST,
    )
    if np.array_equal(alpha, np.asarray(canonical_lanczos)) or np.array_equal(
        alpha,
        np.asarray(canonical_nearest),
    ):
        raise ValueError(
            "V4 shadow equals canonical pixels; BODY derivation failed"
        )

    expected_contact = tuple(
        float(value) for value in derivation["shadowContact"]
    )
    actual_contact = nearest_alpha_point(
        shadow,
        expected_contact,
        threshold=0,
    )
    contact_error = math.dist(actual_contact, expected_contact)
    contact_limits = {
        "tree": 1.5,
        "shrub": 1.5,
    }
    contact_limit = contact_limits.get(family)
    if contact_limit is not None and contact_error > contact_limit:
        raise ValueError(
            f"{family} shadow contact drift is {contact_error:.3f}px "
            f"(limit {contact_limit:.1f}px)"
        )

    bias = _parity_bias(alpha)
    bias_limits = {
        "tree": 0.04,
        "shrub": 0.06,
        "building": 0.04,
    }
    bias_limit = bias_limits.get(family)
    if bias_limit is not None and bias > bias_limit:
        raise ValueError(
            f"{family} shadow parity bias is {bias:.4f} "
            f"(limit {bias_limit:.4f})"
        )

    if family == "tree":
        trunk_matrix = derivation["layers"]["trunkProjectionMatrix"]
        cast_vector = (-float(trunk_matrix[1]), -float(trunk_matrix[3]))
        direction_length = math.hypot(*SHADOW_VECTOR)
        cast_projection = (
            cast_vector[0] * SHADOW_VECTOR[0]
            + cast_vector[1] * SHADOW_VECTOR[1]
        ) / direction_length
        if cast_projection <= 0.0:
            raise ValueError("tree trunk shadow does not cast lower-right")
    else:
        cast_projection = None

    bbox = alpha_bbox(shadow, threshold=0)
    return {
        "contract": "shadow-v4-light-only",
        "size": list(shadow.size),
        "bbox": list(bbox),
        "visiblePixels": int(visible.sum()),
        "meanVisibleAlpha": round(float(alpha[visible].mean()), 6),
        "maxAlpha": int(alpha.max()),
        "darkCoreRemoved": True,
        "contact": [round(value, 4) for value in actual_contact],
        "expectedContact": [
            round(value, 4) for value in expected_contact
        ],
        "contactErrorPx": round(contact_error, 6),
        "parityBias": round(bias, 8),
        "lowerRightTrunkCastPerHeightPx": (
            round(float(cast_projection), 6)
            if cast_projection is not None
            else None
        ),
        "canonicalPixelIdentical": False,
    }
