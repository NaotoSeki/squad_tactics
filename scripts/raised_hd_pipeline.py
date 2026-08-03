#!/usr/bin/env python3
"""Shared finalization helpers for photorealistic raised PS assets.

The canonical body is geometry calibration only.  The normalized body alpha
always comes from the accepted ImageGen cutout.  Likewise, a canonical shadow
is reduced to numeric calibration measurements before the accepted body alpha
is projected; canonical shadow pixels are never copied into an HD shadow.
"""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
from typing import Any, Iterator

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

try:
    from .ground_hd_quality import conspicuous_magenta_spill
    from .normalize_tree_hd import (
        match_reference_color,
        repair_translucent_edge_colors,
    )
except ImportError:
    from ground_hd_quality import conspicuous_magenta_spill
    from normalize_tree_hd import (
        match_reference_color,
        repair_translucent_edge_colors,
    )


PIXEL_RATIO = 2
ALPHA_THRESHOLD = 8
LIGHTING_CONTRACT = "ps-overcast-upper-left-v1"
SHADOW_VECTOR = (0.72, 0.69)
SHADOW_COLOR = (16, 13, 26)
BODY_VERSION = "v1"
METADATA_SCHEMA = "raised-hd-job/v1"
MANIFEST_SCHEMA = "raised-hd-manifest/v1"


def read_inventory(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_reference(inventory_path: Path, value: str) -> Path:
    return (inventory_path.parent / value).resolve()


def find_job(
    inventory_path: Path,
    asset_id: str,
    body_slot: int,
) -> dict[str, Any]:
    """Resolve one body variant without consulting already-generated files."""
    inventory = read_inventory(inventory_path)
    asset = next(
        (item for item in inventory["assets"] if item["id"] == asset_id),
        None,
    )
    if asset is None:
        raise KeyError(f"unknown raised asset id: {asset_id}")

    variant = next(
        (
            item
            for item in asset["bodyVariants"]
            if int(item["bodySlot"]) == int(body_slot)
        ),
        None,
    )
    if variant is None:
        raise KeyError(f"{asset_id} has no body slot {body_slot}")

    canonical = {
        int(item["slot"]): item for item in asset["canonicalSlots"]
    }
    body = canonical[int(body_slot)]
    shadow_slot = variant["pairedShadowSlot"]
    shadow = canonical[int(shadow_slot)] if shadow_slot is not None else None
    return {
        "jobId": f"{asset_id}_s{int(body_slot)}",
        "id": asset_id,
        "family": asset["family"],
        "roles": variant["roles"],
        "bodySlot": int(body_slot),
        "pairedShadowSlot": (
            int(shadow_slot) if shadow_slot is not None else None
        ),
        "reference": body["reference"],
        "referenceAbsolute": str(
            resolve_reference(inventory_path, body["reference"])
        ),
        "referenceSize": body["referenceSize"],
        "origin": body["origin"],
        "shadowReference": shadow["reference"] if shadow else None,
        "shadowReferenceAbsolute": (
            str(resolve_reference(inventory_path, shadow["reference"]))
            if shadow
            else None
        ),
        "shadowReferenceSize": shadow["referenceSize"] if shadow else None,
        "shadowOrigin": shadow["origin"] if shadow else None,
        "pixelRatio": PIXEL_RATIO,
        "lightingContract": LIGHTING_CONTRACT,
        "shadowMethod": "generated-body-derived",
    }


def alpha_bbox(
    image: Image.Image,
    threshold: int = ALPHA_THRESHOLD,
) -> tuple[int, int, int, int]:
    alpha = (
        np.asarray(image)
        if image.mode in {"1", "L", "I", "F"}
        else np.asarray(image.convert("RGBA").getchannel("A"))
    )
    ys, xs = np.nonzero(alpha > threshold)
    if not len(xs):
        raise ValueError("image contains no visible alpha")
    return (
        int(xs.min()),
        int(ys.min()),
        int(xs.max()) + 1,
        int(ys.max()) + 1,
    )


def alpha_sha256(image: Image.Image) -> str:
    alpha = np.asarray(image.convert("RGBA").getchannel("A"), dtype=np.uint8)
    return hashlib.sha256(alpha.tobytes()).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def nearest_alpha_point(
    image: Image.Image,
    expected: tuple[float, float],
    threshold: int = ALPHA_THRESHOLD,
) -> tuple[float, float]:
    """Return the alpha-weighted closest support point to an expected anchor."""
    alpha = np.asarray(image.convert("RGBA").getchannel("A"))
    ys, xs = np.nonzero(alpha > threshold)
    if not len(xs):
        raise ValueError("image contains no visible alpha")
    distance = (
        (xs.astype(np.float64) - expected[0]) ** 2
        + (ys.astype(np.float64) - expected[1]) ** 2
    )
    minimum = float(distance.min())
    selected = distance <= minimum + 1.25
    weights = alpha[ys[selected], xs[selected]].astype(np.float64)
    weights = np.maximum(weights, 1.0)
    return (
        float(np.average(xs[selected], weights=weights)),
        float(np.average(ys[selected], weights=weights)),
    )


def canonical_contact(
    reference: Image.Image,
    origin: list[int] | tuple[int, int],
) -> tuple[float, float]:
    anchor = (-float(origin[0]), -float(origin[1]))
    return nearest_alpha_point(reference, anchor)


def _source_contact(
    source: Image.Image,
    source_bbox: tuple[int, int, int, int],
    reference_bbox: tuple[int, int, int, int],
    reference_contact: tuple[float, float],
) -> tuple[float, float]:
    ref_width = max(1.0, reference_bbox[2] - reference_bbox[0] - 1.0)
    ref_height = max(1.0, reference_bbox[3] - reference_bbox[1] - 1.0)
    x_fraction = (reference_contact[0] - reference_bbox[0]) / ref_width
    y_fraction = (reference_contact[1] - reference_bbox[1]) / ref_height
    expected = (
        source_bbox[0]
        + x_fraction * max(1.0, source_bbox[2] - source_bbox[0] - 1.0),
        source_bbox[1]
        + y_fraction * max(1.0, source_bbox[3] - source_bbox[1] - 1.0),
    )
    return nearest_alpha_point(source, expected)


def normalize_body(
    cutout: Image.Image,
    reference: Image.Image,
    origin: list[int] | tuple[int, int],
    *,
    scale: int = PIXEL_RATIO,
) -> tuple[Image.Image, dict[str, Any]]:
    """Fit generated alpha to canonical geometry while preserving its contour."""
    if scale != PIXEL_RATIO:
        raise ValueError(f"raised HD pixel ratio must be {PIXEL_RATIO}")

    reference = reference.convert("RGBA")
    source = match_reference_color(
        repair_translucent_edge_colors(cutout.convert("RGBA")),
        reference,
    )
    source_bbox = alpha_bbox(source)
    reference_bbox = alpha_bbox(reference)
    reference_contact = canonical_contact(reference, origin)
    source_contact = _source_contact(
        source,
        source_bbox,
        reference_bbox,
        reference_contact,
    )

    target_size = (reference.width * scale, reference.height * scale)
    target_bbox = tuple(int(value * scale) for value in reference_bbox)
    target_contact = (
        float(reference_contact[0] * scale),
        float(reference_contact[1] * scale),
    )
    source_span_x = max(1.0, source_bbox[2] - source_bbox[0] - 1.0)
    source_span_y = max(1.0, source_bbox[3] - source_bbox[1] - 1.0)
    target_span_x = max(1.0, target_bbox[2] - target_bbox[0] - 1.0)
    target_span_y = max(1.0, target_bbox[3] - target_bbox[1] - 1.0)
    scale_x = target_span_x / source_span_x
    scale_y = target_span_y / source_span_y

    # Inverse affine: the source contact maps exactly to the canonical contact.
    inverse = (
        1.0 / scale_x,
        0.0,
        source_contact[0] - target_contact[0] / scale_x,
        0.0,
        1.0 / scale_y,
        source_contact[1] - target_contact[1] / scale_y,
    )
    result = source.transform(
        target_size,
        Image.Transform.AFFINE,
        inverse,
        resample=Image.Resampling.BICUBIC,
        fillcolor=(0, 0, 0, 0),
    )
    pixels = np.asarray(result).copy()
    pixels[pixels[:, :, 3] == 0, :3] = 0
    result = Image.fromarray(pixels, "RGBA")
    result_contact = nearest_alpha_point(result, target_contact)

    metrics = {
        "sourceSize": list(source.size),
        "sourceBbox": list(source_bbox),
        "sourceContact": [round(value, 4) for value in source_contact],
        "canonicalBbox": list(reference_bbox),
        "canonicalContact": [
            round(value, 4) for value in reference_contact
        ],
        "targetSize": list(target_size),
        "targetBbox": list(target_bbox),
        "targetContact": [round(value, 4) for value in target_contact],
        "resultBbox": list(alpha_bbox(result)),
        "resultContact": [round(value, 4) for value in result_contact],
        "scale": [round(scale_x, 8), round(scale_y, 8)],
        "generatedAlphaSha256": alpha_sha256(source),
        "normalizedAlphaSha256": alpha_sha256(result),
        "canonicalAlphaSha256": alpha_sha256(reference),
        "alphaAuthority": "accepted generated cutout",
        "canonicalAlphaRole": "numeric bbox/contact calibration only",
    }
    return result, metrics


def validate_body(
    body: Image.Image,
    reference: Image.Image,
    origin: list[int] | tuple[int, int],
) -> dict[str, Any]:
    reference = reference.convert("RGBA")
    body = body.convert("RGBA")
    expected_size = (
        reference.width * PIXEL_RATIO,
        reference.height * PIXEL_RATIO,
    )
    if body.size != expected_size:
        raise ValueError(
            f"body size {body.size} is not exact 2x {reference.size}"
        )

    body_array = np.asarray(body)
    visible = body_array[:, :, 3] > ALPHA_THRESHOLD
    if not visible.any():
        raise ValueError("normalized body is fully transparent")
    reference_lanczos = reference.resize(
        expected_size,
        Image.Resampling.LANCZOS,
    )
    reference_nearest = reference.resize(
        expected_size,
        Image.Resampling.NEAREST,
    )
    output_alpha = body_array[:, :, 3]
    if np.array_equal(
        output_alpha,
        np.asarray(reference_lanczos.getchannel("A")),
    ) or np.array_equal(
        output_alpha,
        np.asarray(reference_nearest.getchannel("A")),
    ):
        raise ValueError(
            "body alpha equals canonical alpha; generated contour was not used"
        )

    canonical_rgba = np.asarray(reference_lanczos)
    magenta = conspicuous_magenta_spill(body_array, canonical_rgba)
    magenta_count = int(magenta.sum())
    magenta_limit = max(2, round(int(visible.sum()) * 0.0001))
    if magenta_count > magenta_limit:
        raise ValueError(
            f"normalized body retains {magenta_count} magenta pixels "
            f"(limit {magenta_limit})"
        )

    expected_contact = canonical_contact(reference, origin)
    expected_contact = tuple(value * PIXEL_RATIO for value in expected_contact)
    actual_contact = nearest_alpha_point(body, expected_contact)
    contact_error = math.dist(expected_contact, actual_contact)
    if contact_error > 2.25:
        raise ValueError(
            f"body contact drift is {contact_error:.3f}px (limit 2.25px)"
        )

    body_area = int(visible.sum())
    canonical_area = int(
        (np.asarray(reference_nearest.getchannel("A")) > ALPHA_THRESHOLD).sum()
    )
    coverage_ratio = body_area / max(1, canonical_area)
    if not 0.12 <= coverage_ratio <= 3.0:
        raise ValueError(
            f"generated alpha coverage ratio {coverage_ratio:.3f} is implausible"
        )
    return {
        "size": list(body.size),
        "bbox": list(alpha_bbox(body)),
        "visiblePixels": body_area,
        "canonicalVisiblePixels": canonical_area,
        "coverageRatio": round(coverage_ratio, 6),
        "contact": [round(value, 4) for value in actual_contact],
        "expectedContact": [
            round(value, 4) for value in expected_contact
        ],
        "contactErrorPx": round(contact_error, 6),
        "magentaSpillPixels": magenta_count,
        "magentaSpillLimit": magenta_limit,
        "canonicalAlphaIdentical": False,
    }


def calibrate_shadow(
    reference: Image.Image,
    origin: list[int] | tuple[int, int],
) -> dict[str, Any]:
    """Reduce a canonical shadow to permitted numeric calibration values."""
    reference = reference.convert("RGBA")
    alpha = np.asarray(reference.getchannel("A"), dtype=np.float32)
    support = alpha > 0
    if not support.any():
        raise ValueError("canonical shadow is empty")
    bbox = alpha_bbox(reference, threshold=0)
    visible = alpha[support]
    maximum = float(visible.max())
    partial_fraction = float(
        np.count_nonzero((visible > 0) & (visible < maximum * 0.78))
        / visible.size
    )
    blur_radius = float(
        np.clip(
            (0.45 + partial_fraction * 2.2) * PIXEL_RATIO,
            0.7,
            3.2,
        )
    )
    anchor = (-float(origin[0]), -float(origin[1]))
    contact = nearest_alpha_point(reference, anchor, threshold=0)
    ys, xs = np.nonzero(support)
    weights = np.maximum(alpha[ys, xs], 1.0)
    centroid = (
        float(np.average(xs, weights=weights)),
        float(np.average(ys, weights=weights)),
    )
    centered = np.column_stack(
        (
            xs.astype(np.float64) - centroid[0],
            ys.astype(np.float64) - centroid[1],
        )
    )
    covariance = (
        (centered * weights[:, None]).T @ centered
        / max(float(weights.sum()), 1.0)
    )
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    major_axis = eigenvectors[:, int(np.argmax(eigenvalues))]
    major_axis_angle = math.degrees(
        math.atan2(float(major_axis[1]), float(major_axis[0]))
    )
    bbox_width = max(1, bbox[2] - bbox[0])
    bbox_height = max(1, bbox[3] - bbox[1])
    return {
        "referenceSize": list(reference.size),
        "targetSize": [
            reference.width * PIXEL_RATIO,
            reference.height * PIXEL_RATIO,
        ],
        "referenceOrigin": [int(origin[0]), int(origin[1])],
        "worldOriginLocal": [
            round(-float(origin[0]) * PIXEL_RATIO, 4),
            round(-float(origin[1]) * PIXEL_RATIO, 4),
        ],
        "referenceBbox": list(bbox),
        "targetBbox": [int(value * PIXEL_RATIO) for value in bbox],
        "referenceContact": [round(value, 4) for value in contact],
        "referenceCentroid": [round(value, 4) for value in centroid],
        "referenceCovariance": [
            [round(float(value), 6) for value in row]
            for row in covariance
        ],
        "referenceMajorAxisAngleDeg": round(major_axis_angle, 6),
        "referenceFillRatio": round(
            float(support[bbox[1]:bbox[3], bbox[0]:bbox[2]].mean()),
            6,
        ),
        "referenceAspectRatio": round(
            math.sqrt(
                max(float(eigenvalues.max()), 1e-9)
                / max(float(eigenvalues.min()), 1e-9)
            ),
            6,
        ),
        "referenceBboxAspectRatio": round(
            float(bbox_width / bbox_height),
            6,
        ),
        "targetMeanVisibleAlpha": round(float(visible.mean()), 6),
        "targetMaxAlpha": int(round(maximum)),
        "alphaFloor": int(
            np.clip(round(float(np.percentile(visible, 5))), 2, 8)
        ),
        "visiblePixels": int(support.sum()),
        "targetVisiblePixels": int(support.sum() * PIXEL_RATIO**2),
        "partialAlphaFraction": round(partial_fraction, 6),
        "blurRadiusPx": round(blur_radius, 6),
        "referenceRole": (
            "numeric world-origin/contact/bbox/extent/penumbra/density "
            "calibration only"
        ),
        "forbiddenPixelReuse": True,
    }


def _project_alpha(
    alpha: Image.Image,
    output_size: tuple[int, int],
    body_contact: tuple[float, float],
    shadow_contact: tuple[float, float],
    matrix: tuple[float, float, float, float],
) -> Image.Image:
    a, b, d, e = matrix
    determinant = a * e - b * d
    if abs(determinant) < 1e-8:
        raise ValueError("shadow projection matrix is singular")
    inverse_a = e / determinant
    inverse_b = -b / determinant
    inverse_d = -d / determinant
    inverse_e = a / determinant
    inverse_c = (
        body_contact[0]
        - inverse_a * shadow_contact[0]
        - inverse_b * shadow_contact[1]
    )
    inverse_f = (
        body_contact[1]
        - inverse_d * shadow_contact[0]
        - inverse_e * shadow_contact[1]
    )
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


def _anchor_preserving_bbox_warp(
    source: Image.Image,
    source_anchor: tuple[float, float],
    target_size: tuple[int, int],
    target_anchor: tuple[float, float],
    target_bbox: tuple[int, int, int, int],
) -> Image.Image:
    source_array = np.asarray(source, dtype=np.float32)
    source_bbox = alpha_bbox(source, threshold=0)
    ys, xs = np.nonzero(source_array > 0)
    values = source_array[ys, xs]
    x_relative = xs.astype(np.float64) - source_anchor[0]
    y_relative = ys.astype(np.float64) - source_anchor[1]
    target_x = np.where(
        x_relative < 0,
        target_anchor[0]
        + x_relative
        * max(1.0, target_anchor[0] - target_bbox[0])
        / max(1.0, source_anchor[0] - source_bbox[0]),
        target_anchor[0]
        + x_relative
        * max(1.0, target_bbox[2] - 1 - target_anchor[0])
        / max(1.0, source_bbox[2] - 1 - source_anchor[0]),
    )
    target_y = np.where(
        y_relative < 0,
        target_anchor[1]
        + y_relative
        * max(1.0, target_anchor[1] - target_bbox[1])
        / max(1.0, source_anchor[1] - source_bbox[1]),
        target_anchor[1]
        + y_relative
        * max(1.0, target_bbox[3] - 1 - target_anchor[1])
        / max(1.0, source_bbox[3] - 1 - source_anchor[1]),
    )

    # Forward bilinear splatting retains very thin fence/leg silhouettes that
    # an inverse rectangular resample can miss along a long diagonal.
    output = np.zeros((target_size[1], target_size[0]), dtype=np.float32)
    x0 = np.floor(target_x).astype(np.int32)
    y0 = np.floor(target_y).astype(np.int32)
    fraction_x = target_x - x0
    fraction_y = target_y - y0
    nearest_x = np.rint(target_x).astype(np.int32)
    nearest_y = np.rint(target_y).astype(np.int32)
    nearest_valid = (
        (nearest_x >= target_bbox[0])
        & (nearest_x < target_bbox[2])
        & (nearest_y >= target_bbox[1])
        & (nearest_y < target_bbox[3])
    )
    np.maximum.at(
        output,
        (nearest_y[nearest_valid], nearest_x[nearest_valid]),
        values[nearest_valid],
    )
    for dx, dy, weight in (
        (0, 0, (1.0 - fraction_x) * (1.0 - fraction_y)),
        (1, 0, fraction_x * (1.0 - fraction_y)),
        (0, 1, (1.0 - fraction_x) * fraction_y),
        (1, 1, fraction_x * fraction_y),
    ):
        output_x = x0 + dx
        output_y = y0 + dy
        valid = (
            (output_x >= target_bbox[0])
            & (output_x < target_bbox[2])
            & (output_y >= target_bbox[1])
            & (output_y < target_bbox[3])
        )
        np.maximum.at(
            output,
            (output_y[valid], output_x[valid]),
            values[valid] * weight[valid],
        )
    return Image.fromarray(
        np.clip(np.round(output), 0, 255).astype(np.uint8),
        "L",
    )


def _anchor_preserving_bbox_inverse_warp(
    source: Image.Image,
    source_anchor: tuple[float, float],
    target_size: tuple[int, int],
    target_anchor: tuple[float, float],
    target_bbox: tuple[int, int, int, int],
) -> Image.Image:
    """Continuously resample a shadow without forward-splat scanline gaps."""
    source_array = np.asarray(source, dtype=np.float32)
    source_bbox = alpha_bbox(source, threshold=0)
    source_left = float(source_bbox[0])
    source_top = float(source_bbox[1])
    source_right = float(source_bbox[2] - 1)
    source_bottom = float(source_bbox[3] - 1)
    target_left, target_top, target_right_edge, target_bottom_edge = target_bbox
    target_right = float(target_right_edge - 1)
    target_bottom = float(target_bottom_edge - 1)

    source_anchor_x = float(
        np.clip(source_anchor[0], source_left, source_right)
    )
    source_anchor_y = float(
        np.clip(source_anchor[1], source_top, source_bottom)
    )
    target_anchor_x = float(
        np.clip(target_anchor[0], target_left, target_right)
    )
    target_anchor_y = float(
        np.clip(target_anchor[1], target_top, target_bottom)
    )

    target_x = np.arange(target_left, target_right_edge, dtype=np.float32)
    target_y = np.arange(target_top, target_bottom_edge, dtype=np.float32)
    source_x = np.where(
        target_x <= target_anchor_x,
        source_left
        + (target_x - target_left)
        * (source_anchor_x - source_left)
        / max(1.0, target_anchor_x - target_left),
        source_anchor_x
        + (target_x - target_anchor_x)
        * (source_right - source_anchor_x)
        / max(1.0, target_right - target_anchor_x),
    )
    source_y = np.where(
        target_y <= target_anchor_y,
        source_top
        + (target_y - target_top)
        * (source_anchor_y - source_top)
        / max(1.0, target_anchor_y - target_top),
        source_anchor_y
        + (target_y - target_anchor_y)
        * (source_bottom - source_anchor_y)
        / max(1.0, target_bottom - target_anchor_y),
    )
    sample_x, sample_y = np.meshgrid(source_x, source_y)
    x0 = np.floor(sample_x).astype(np.int32)
    y0 = np.floor(sample_y).astype(np.int32)
    x1 = np.minimum(x0 + 1, source_array.shape[1] - 1)
    y1 = np.minimum(y0 + 1, source_array.shape[0] - 1)
    fraction_x = sample_x - x0
    fraction_y = sample_y - y0
    sampled = (
        source_array[y0, x0]
        * (1.0 - fraction_x)
        * (1.0 - fraction_y)
        + source_array[y0, x1] * fraction_x * (1.0 - fraction_y)
        + source_array[y1, x0] * (1.0 - fraction_x) * fraction_y
        + source_array[y1, x1] * fraction_x * fraction_y
    )

    output = np.zeros((target_size[1], target_size[0]), dtype=np.uint8)
    output[
        target_top:target_bottom_edge,
        target_left:target_right_edge,
    ] = np.clip(np.round(sampled), 0, 255).astype(np.uint8)
    return Image.fromarray(output, "L")


def _scale_shadow_density(
    alpha: np.ndarray,
    target_mean: float,
    maximum: float,
    floor: float,
) -> np.ndarray:
    support = alpha > 0
    if not support.any():
        return np.zeros_like(alpha)
    peak = float(alpha[support].max())
    normalized = np.clip(alpha / max(peak, 1.0), 0.0, 1.0)
    low, high = 0.03, 256.0
    for _ in range(36):
        gamma = (low + high) / 2.0
        candidate = floor + np.power(normalized, gamma) * (maximum - floor)
        mean = float(candidate[support].mean())
        if mean > target_mean:
            low = gamma
        else:
            high = gamma
    result = floor + np.power(normalized, high) * (maximum - floor)
    result[~support] = 0.0
    return result


def synthesize_shadow(
    body: Image.Image,
    body_origin: list[int] | tuple[int, int],
    body_contact: tuple[float, float],
    shadow_origin: list[int] | tuple[int, int],
    calibration: dict[str, Any],
    family: str | None = None,
) -> tuple[Image.Image, dict[str, Any]]:
    """Project only accepted body alpha into a PS-calibrated HD shadow."""
    body = body.convert("RGBA")
    body_alpha = body.getchannel("A")
    is_tree = family == "tree"
    projection_alpha = (
        body_alpha.filter(ImageFilter.GaussianBlur(1.15))
        if is_tree
        else body_alpha
    )
    body_bbox = alpha_bbox(body)
    body_world_contact = (
        float(body_origin[0] * PIXEL_RATIO) + body_contact[0],
        float(body_origin[1] * PIXEL_RATIO) + body_contact[1],
    )
    # The PS shadow contact can legitimately differ from the object's logical
    # origin (notably for wide building footprints).  Preserve that measured
    # contact while the canvas origins continue to share the same world frame.
    shadow_contact = (
        float(calibration["referenceContact"][0]) * PIXEL_RATIO,
        float(calibration["referenceContact"][1]) * PIXEL_RATIO,
    )
    shadow_contact_world = (
        float(shadow_origin[0] * PIXEL_RATIO) + shadow_contact[0],
        float(shadow_origin[1] * PIXEL_RATIO) + shadow_contact[1],
    )
    target_size = tuple(int(value) for value in calibration["targetSize"])
    target_bbox = tuple(int(value) for value in calibration["targetBbox"])

    direction_length = math.hypot(*SHADOW_VECTOR)
    direction = (
        SHADOW_VECTOR[0] / direction_length,
        SHADOW_VECTOR[1] / direction_length,
    )
    target_corners = (
        (target_bbox[0], target_bbox[1]),
        (target_bbox[2] - 1, target_bbox[1]),
        (target_bbox[0], target_bbox[3] - 1),
        (target_bbox[2] - 1, target_bbox[3] - 1),
    )
    far_extent = max(
        1.0,
        max(
            (x - shadow_contact[0]) * direction[0]
            + (y - shadow_contact[1]) * direction[1]
            for x, y in target_corners
        ),
    )
    body_height = max(1.0, body_contact[1] - body_bbox[1])
    cast_rate = float(np.clip(far_extent / body_height, 0.18, 1.8))
    horizontal_scale = 0.62
    cross_scale = 0.06
    matrix = (
        horizontal_scale,
        -direction[0] * cast_rate,
        cross_scale,
        -direction[1] * cast_rate,
    )

    work_edge = int(
        max(
            192,
            3
            * (
                body.width
                + body.height
                + target_size[0]
                + target_size[1]
            )
            / 2,
        )
    )
    work_size = (work_edge, work_edge)
    work_anchor = (work_edge / 2.0, work_edge / 2.0)
    projected = _project_alpha(
        projection_alpha,
        work_size,
        body_contact,
        work_anchor,
        matrix,
    )
    projected = projected.filter(
        ImageFilter.GaussianBlur(float(calibration["blurRadiusPx"]))
    )
    projected_array = np.asarray(projected).copy()
    projected_array[projected_array < 1] = 0
    projected = Image.fromarray(projected_array, "L")

    if not is_tree:
        # A second, shallow ground-plane projection of the same BODY alpha
        # keeps feet, posts, wheels, and building footprints attached. Trees
        # deliberately skip this: flattening an entire crown creates the
        # conspicuous horizontal comb pattern seen in map-scale shadows.
        body_crop = body_alpha.crop(body_bbox)
        footprint_width = max(
            2,
            round((body_bbox[2] - body_bbox[0]) * 0.86),
        )
        footprint_height = max(
            2,
            min(
                round((body_bbox[3] - body_bbox[1]) * 0.11),
                max(2, round((target_bbox[3] - target_bbox[1]) * 0.28)),
            ),
        )
        footprint = body_crop.resize(
            (footprint_width, footprint_height),
            Image.Resampling.LANCZOS,
        )
        body_fraction_x = (
            (body_contact[0] - body_bbox[0])
            / max(1.0, body_bbox[2] - body_bbox[0] - 1.0)
        )
        footprint_contact_x = body_fraction_x * max(1, footprint_width - 1)
        footprint_position = (
            round(work_anchor[0] - footprint_contact_x),
            round(work_anchor[1] - footprint_height * 0.45),
        )
        footprint_layer = Image.new("L", work_size, 0)
        footprint_layer.paste(footprint, footprint_position, footprint)
        footprint_layer = footprint_layer.filter(
            ImageFilter.GaussianBlur(
                max(0.45, float(calibration["blurRadiusPx"]) * 0.32)
            )
        )
        projected = ImageChops.lighter(projected, footprint_layer)
    if projected.getbbox() is None:
        raise ValueError("generated body alpha produced an empty shadow")

    if is_tree:
        warped = _anchor_preserving_bbox_inverse_warp(
            projected,
            work_anchor,
            target_size,
            shadow_contact,
            target_bbox,
        )
        warped = warped.filter(ImageFilter.MaxFilter(3)).filter(
            ImageFilter.GaussianBlur(
                max(1.35, float(calibration["blurRadiusPx"]) * 0.8)
            )
        )
        warped_array = np.asarray(warped).copy()
        outside = np.ones(warped_array.shape, dtype=bool)
        outside[
            target_bbox[1]:target_bbox[3],
            target_bbox[0]:target_bbox[2],
        ] = False
        warped_array[outside] = 0
        warped = Image.fromarray(warped_array, "L")
    else:
        warped = _anchor_preserving_bbox_warp(
            projected,
            work_anchor,
            target_size,
            shadow_contact,
            target_bbox,
        )
    alpha = np.asarray(warped, dtype=np.float32)
    floor = float(calibration["alphaFloor"])
    alpha[alpha < 0.5] = 0.0
    alpha = _scale_shadow_density(
        alpha,
        float(calibration["targetMeanVisibleAlpha"]),
        float(calibration["targetMaxAlpha"]),
        floor,
    )
    alpha_u8 = np.clip(np.round(alpha), 0, 255).astype(np.uint8)

    rgba = np.zeros((target_size[1], target_size[0], 4), dtype=np.uint8)
    rgba[:, :, :3] = np.asarray(SHADOW_COLOR, dtype=np.uint8)
    rgba[:, :, 3] = alpha_u8
    rgba[alpha_u8 == 0, :3] = 0
    result = Image.fromarray(rgba, "RGBA")
    result_bbox = alpha_bbox(result, threshold=0)
    result_contact = nearest_alpha_point(
        result,
        shadow_contact,
        threshold=0,
    )
    visible = alpha_u8 > 0
    metrics = {
        "method": (
            "tree occlusion projection from accepted generated BODY alpha"
            if is_tree
            else "affine projection from accepted generated BODY alpha"
        ),
        "rasterization": (
            "inverse bilinear bbox resample with post-projection integration"
            if is_tree
            else "forward bilinear bbox splat"
        ),
        "bodyAlphaSha256": alpha_sha256(body),
        "canonicalShadowRole": calibration["referenceRole"],
        "canonicalShadowPixelsCopied": False,
        "lightingContract": LIGHTING_CONTRACT,
        "shadowScreenVector": list(SHADOW_VECTOR),
        "projectionMatrix": [round(value, 8) for value in matrix],
        "bodyContact": [round(value, 4) for value in body_contact],
        "bodyWorldContact": [
            round(value, 4) for value in body_world_contact
        ],
        "shadowContact": [round(value, 4) for value in shadow_contact],
        "shadowContactWorld": [
            round(value, 4) for value in shadow_contact_world
        ],
        "contactWorldDelta": [
            round(shadow_contact_world[0] - body_world_contact[0], 4),
            round(shadow_contact_world[1] - body_world_contact[1], 4),
        ],
        "resultContact": [round(value, 4) for value in result_contact],
        "contactErrorPx": round(
            math.dist(shadow_contact, result_contact),
            6,
        ),
        "targetBbox": list(target_bbox),
        "resultBbox": list(result_bbox),
        "targetMeanVisibleAlpha": calibration["targetMeanVisibleAlpha"],
        "meanVisibleAlpha": round(float(alpha_u8[visible].mean()), 6),
        "targetMaxAlpha": calibration["targetMaxAlpha"],
        "maxAlpha": int(alpha_u8.max()),
        "blurRadiusPx": calibration["blurRadiusPx"],
        "outputAlphaSha256": alpha_sha256(result),
    }
    return result, metrics


def validate_shadow(
    shadow: Image.Image,
    canonical_shadow: Image.Image,
    shadow_contact: tuple[float, float],
    calibration: dict[str, Any],
    projection_matrix: list[float] | tuple[float, float, float, float],
) -> dict[str, Any]:
    shadow = shadow.convert("RGBA")
    canonical_shadow = canonical_shadow.convert("RGBA")
    expected_size = tuple(int(value) for value in calibration["targetSize"])
    if shadow.size != expected_size:
        raise ValueError(
            f"shadow size {shadow.size} is not exact 2x "
            f"{canonical_shadow.size}"
        )
    alpha = np.asarray(shadow.getchannel("A"))
    visible = alpha > 0
    if not visible.any():
        raise ValueError("generated shadow is empty")
    if int(alpha.max()) != int(calibration["targetMaxAlpha"]):
        raise ValueError("generated shadow peak density missed calibration")
    mean_error = abs(
        float(alpha[visible].mean())
        - float(calibration["targetMeanVisibleAlpha"])
    )
    if mean_error > 0.75:
        raise ValueError(
            f"generated shadow mean alpha error is {mean_error:.3f}"
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
            "HD shadow equals canonical pixels; generated-body derivation failed"
        )

    actual_contact = nearest_alpha_point(
        shadow,
        shadow_contact,
        threshold=0,
    )
    contact_error = math.dist(actual_contact, shadow_contact)
    if contact_error > 3.0:
        raise ValueError(
            f"shadow contact drift is {contact_error:.3f}px (limit 3px)"
        )
    bbox = alpha_bbox(shadow, threshold=0)
    target_bbox = tuple(int(value) for value in calibration["targetBbox"])
    extent_error = max(
        abs(actual - target)
        for actual, target in zip(bbox, target_bbox)
    )
    if extent_error > 3:
        raise ValueError(
            f"shadow bbox extent drift is {extent_error}px (limit 3px)"
        )

    ys, xs = np.nonzero(visible)
    weights = alpha[ys, xs].astype(np.float64)
    centroid = (
        float(np.average(xs, weights=weights)),
        float(np.average(ys, weights=weights)),
    )
    direction_length = math.hypot(*SHADOW_VECTOR)
    direction_projection = (
        (centroid[0] - shadow_contact[0]) * SHADOW_VECTOR[0]
        + (centroid[1] - shadow_contact[1]) * SHADOW_VECTOR[1]
    ) / direction_length
    if len(projection_matrix) != 4:
        raise ValueError("shadow projection matrix must contain 4 values")
    _a, height_to_x, _d, height_to_y = (
        float(value) for value in projection_matrix
    )
    # Source pixels above the contact have a negative Y delta.  Therefore the
    # cast displacement for one positive unit of height is (-b, -e).  This is
    # the reliable lighting-direction invariant.  A whole-shadow centroid is
    # not: wide buildings, woodpiles, and fence composites can place their
    # calibrated contact near the lower-right edge, leaving the centroid to
    # its upper-left even though every elevated point casts lower-right.
    cast_vector = (-height_to_x, -height_to_y)
    cast_projection = (
        cast_vector[0] * SHADOW_VECTOR[0]
        + cast_vector[1] * SHADOW_VECTOR[1]
    ) / direction_length
    if cast_projection <= 0.0:
        raise ValueError(
            "generated shadow projection travels against screen lower-right"
        )
    return {
        "size": list(shadow.size),
        "bbox": list(bbox),
        "targetBbox": list(target_bbox),
        "extentErrorPx": int(extent_error),
        "visiblePixels": int(visible.sum()),
        "meanVisibleAlpha": round(float(alpha[visible].mean()), 6),
        "meanAlphaError": round(mean_error, 6),
        "maxAlpha": int(alpha.max()),
        "contact": [round(value, 4) for value in actual_contact],
        "expectedContact": [
            round(value, 4) for value in shadow_contact
        ],
        "contactErrorPx": round(contact_error, 6),
        "centroid": [round(value, 4) for value in centroid],
        "lowerRightProjectionPx": round(direction_projection, 6),
        "lowerRightCastPerHeightPx": round(cast_projection, 6),
        "canonicalPixelIdentical": False,
    }


def checkerboard(
    size: tuple[int, int],
    cell: int = 12,
) -> Image.Image:
    canvas = Image.new("RGBA", size, (90, 92, 85, 255))
    draw = ImageDraw.Draw(canvas)
    colors = ((82, 84, 78, 255), (112, 114, 105, 255))
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            draw.rectangle(
                (
                    x,
                    y,
                    min(size[0], x + cell),
                    min(size[1], y + cell),
                ),
                fill=colors[((x // cell) + (y // cell)) % 2],
            )
    return canvas


def make_world_review(
    body: Image.Image,
    body_origin: list[int] | tuple[int, int],
    output: Path,
    *,
    job_label: str,
    shadow: Image.Image | None = None,
    shadow_origin: list[int] | tuple[int, int] | None = None,
    body_contact: tuple[float, float] | None = None,
    shadow_contact: tuple[float, float] | None = None,
) -> dict[str, Any]:
    """Composite BODY and derived shadow at their exact doubled world origins."""
    layers: list[tuple[Image.Image, tuple[int, int]]] = []
    if shadow is not None:
        if shadow_origin is None:
            raise ValueError("shadow_origin is required with a shadow")
        layers.append(
            (
                shadow.convert("RGBA"),
                (
                    int(shadow_origin[0] * PIXEL_RATIO),
                    int(shadow_origin[1] * PIXEL_RATIO),
                ),
            )
        )
    layers.append(
        (
            body.convert("RGBA"),
            (
                int(body_origin[0] * PIXEL_RATIO),
                int(body_origin[1] * PIXEL_RATIO),
            ),
        )
    )
    min_x = min(origin[0] for _image, origin in layers)
    min_y = min(origin[1] for _image, origin in layers)
    max_x = max(origin[0] + image.width for image, origin in layers)
    max_y = max(origin[1] + image.height for image, origin in layers)
    margin = 30
    header = 38
    content_size = (
        max_x - min_x + margin * 2,
        max_y - min_y + margin * 2,
    )
    canvas = checkerboard((content_size[0], content_size[1] + header))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, canvas.width, header), fill=(40, 44, 37, 255))
    state = "BODY + generated-alpha shadow" if shadow else "BODY / shadowless"
    draw.text(
        (12, 12),
        f"{job_label} | {state} | {LIGHTING_CONTRACT}",
        fill=(238, 235, 214, 255),
    )
    layer_offset = (margin - min_x, header + margin - min_y)
    for image, origin in layers:
        canvas.alpha_composite(
            image,
            (
                layer_offset[0] + origin[0],
                layer_offset[1] + origin[1],
            ),
        )

    world_origin = (
        layer_offset[0],
        layer_offset[1],
    )
    cross = 9
    draw.ellipse(
        (
            world_origin[0] - 4,
            world_origin[1] - 4,
            world_origin[0] + 4,
            world_origin[1] + 4,
        ),
        outline=(255, 186, 62, 255),
        width=1,
    )
    draw.line(
        (
            world_origin[0] - cross,
            world_origin[1],
            world_origin[0] + cross,
            world_origin[1],
        ),
        fill=(255, 186, 62, 255),
        width=1,
    )
    draw.line(
        (
            world_origin[0],
            world_origin[1] - cross,
            world_origin[0],
            world_origin[1] + cross,
        ),
        fill=(255, 186, 62, 255),
        width=1,
    )
    arrow_end = (
        round(world_origin[0] + SHADOW_VECTOR[0] * 34),
        round(world_origin[1] + SHADOW_VECTOR[1] * 34),
    )
    draw.line(
        (world_origin[0], world_origin[1], arrow_end[0], arrow_end[1]),
        fill=(99, 220, 239, 255),
        width=2,
    )
    draw.text(
        (arrow_end[0] + 3, arrow_end[1]),
        "shadow",
        fill=(99, 220, 239, 255),
    )
    contact_markers: dict[str, list[float]] = {}
    if body_contact is not None:
        body_world = (
            float(body_origin[0] * PIXEL_RATIO) + body_contact[0],
            float(body_origin[1] * PIXEL_RATIO) + body_contact[1],
        )
        body_marker = (
            layer_offset[0] + body_world[0],
            layer_offset[1] + body_world[1],
        )
        draw.ellipse(
            (
                body_marker[0] - 3,
                body_marker[1] - 3,
                body_marker[0] + 3,
                body_marker[1] + 3,
            ),
            outline=(101, 244, 133, 255),
            width=2,
        )
        contact_markers["bodyWorld"] = [
            round(body_world[0], 4),
            round(body_world[1], 4),
        ]
    if (
        shadow_contact is not None
        and shadow_origin is not None
        and shadow is not None
    ):
        shadow_world = (
            float(shadow_origin[0] * PIXEL_RATIO) + shadow_contact[0],
            float(shadow_origin[1] * PIXEL_RATIO) + shadow_contact[1],
        )
        shadow_marker = (
            layer_offset[0] + shadow_world[0],
            layer_offset[1] + shadow_world[1],
        )
        draw.rectangle(
            (
                shadow_marker[0] - 3,
                shadow_marker[1] - 3,
                shadow_marker[0] + 3,
                shadow_marker[1] + 3,
            ),
            outline=(246, 104, 205, 255),
            width=2,
        )
        contact_markers["shadowWorld"] = [
            round(shadow_world[0], 4),
            round(shadow_world[1], 4),
        ]
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, optimize=True)
    return {
        "file": output.as_posix(),
        "size": list(canvas.size),
        "worldOriginMarker": list(world_origin),
        "shadowVector": list(SHADOW_VECTOR),
        "contactMarkers": contact_markers,
    }


def relative_posix(path: Path, base: Path) -> str:
    return path.resolve().relative_to(base.resolve()).as_posix()


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


@contextmanager
def manifest_lock(path: Path) -> Iterator[None]:
    """Cross-process one-byte lock for concurrent finalizer processes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        stream.seek(0, os.SEEK_END)
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def sync_manifest(
    output_root: Path,
    inventory_path: Path,
    manifest_path: Path | None = None,
    *,
    _lock_held: bool = False,
) -> dict[str, Any]:
    """Rebuild a deterministic runtime manifest from per-job sidecars."""
    output_root = output_root.resolve()
    inventory_path = inventory_path.resolve()
    manifest_path = (
        manifest_path.resolve()
        if manifest_path
        else output_root / "manifest.json"
    )
    if not _lock_held:
        lock_key = hashlib.sha256(
            str(manifest_path).casefold().encode("utf-8")
        ).hexdigest()[:20]
        lock_path = (
            Path(tempfile.gettempdir())
            / "squad_tactics_raised_hd_locks"
            / f"{lock_key}.lock"
        )
        with manifest_lock(lock_path):
            return sync_manifest(
                output_root,
                inventory_path,
                manifest_path,
                _lock_held=True,
            )
    metadata_dir = output_root / "metadata"
    metadata_records: list[dict[str, Any]] = []
    if metadata_dir.is_dir():
        for path in sorted(metadata_dir.glob("*.json")):
            record = json.loads(path.read_text(encoding="utf-8"))
            if record.get("schema") != METADATA_SCHEMA:
                raise ValueError(f"unsupported metadata schema in {path}")
            metadata_records.append(record)

    sprites: dict[str, dict[str, Any]] = {}
    shadow_count = 0
    shadow_versions: set[str] = set()
    light_only_shadow_count = 0
    for record in metadata_records:
        body_key = f"{record['id']}_s{record['bodySlot']}"
        body_entry: dict[str, Any] = {
            "file": record["outputs"]["body"],
            "pixelRatio": PIXEL_RATIO,
            "ox": int(record["bodyOrigin"][0]),
            "oy": int(record["bodyOrigin"][1]),
            "kind": "body",
            "family": record["family"],
            "lightingContract": LIGHTING_CONTRACT,
            "quality": record["outputs"]["metadata"],
        }
        if record["pairedShadowSlot"] is not None:
            shadow_key = f"{record['id']}_s{record['pairedShadowSlot']}"
            body_entry["pairedShadowKey"] = shadow_key
            derivation = record["shadow"].get("derivation", {})
            shadow_version = str(derivation.get("version", "legacy"))
            shadow_versions.add(shadow_version)
            dark_core_removed = bool(
                derivation.get("darkCoreRemoved", False)
            )
            if dark_core_removed:
                light_only_shadow_count += 1
            shadow_entry = {
                "file": record["outputs"]["shadow"],
                "pixelRatio": PIXEL_RATIO,
                "ox": int(record["shadowOrigin"][0]),
                "oy": int(record["shadowOrigin"][1]),
                "kind": "shadow",
                "family": record["family"],
                "derivedFrom": body_key,
                "lightingContract": LIGHTING_CONTRACT,
                "quality": record["outputs"]["metadata"],
                "shadowVersion": shadow_version,
                "darkCoreRemoved": dark_core_removed,
            }
            if dark_core_removed:
                shadow_entry["maxAlpha"] = int(
                    derivation["lightOnlyCapAlpha"]
                )
            if shadow_key in sprites:
                raise ValueError(f"duplicate generated shadow key {shadow_key}")
            sprites[shadow_key] = shadow_entry
            shadow_count += 1
        if body_key in sprites:
            raise ValueError(f"duplicate generated body key {body_key}")
        sprites[body_key] = body_entry

    inventory = read_inventory(inventory_path)
    expected_bodies = int(inventory["summary"]["bodyVariantCount"])
    expected_shadows = int(inventory["summary"]["pairedShadowVariantCount"])
    v4_light_only = (
        shadow_count > 0
        and shadow_versions == {"shadow-v4-paired-transform"}
        and light_only_shadow_count == shadow_count
    )
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "status": (
            "production-complete"
            if len(metadata_records) == expected_bodies
            and shadow_count == expected_shadows
            else "production-in-progress"
        ),
        "source": (
            "built-in ImageGen BODY + deterministic V4 light-only shadows"
            if v4_light_only
            else "built-in ImageGen + local chroma extraction"
        ),
        "inventory": "inventory.json",
        "pixelRatio": PIXEL_RATIO,
        "basePath": "./",
        "lightingContract": {
            "id": LIGHTING_CONTRACT,
            "keyOrigin": "screen upper-left",
            "shadowDirection": "screen lower-right",
            "shadowScreenVector": list(SHADOW_VECTOR),
        },
        "shadowPolicy": {
            "method": (
                "paired-canonical-body-transform-v4-light-only"
                if v4_light_only
                else "generated-body-derived"
            ),
            "bodyAuthority": "accepted generated BODY alpha",
            "canonicalShadowRole": (
                "paired canonical BODY-to-SHADOW transform calibration only; "
                "no canonical shadow pixels are copied"
                if v4_light_only
                else (
                    "numeric world-origin/contact/bbox/extent/penumbra/density "
                    "calibration only"
                )
            ),
            "canonicalShadowPixelsCopied": False,
            "version": (
                "shadow-v4-paired-transform"
                if v4_light_only
                else "legacy"
            ),
            "darkCoreRemoved": v4_light_only,
            "lightOnlyKneeAlpha": 52 if v4_light_only else None,
            "lightOnlyCapAlpha": 76 if v4_light_only else None,
        },
        "quality": {
            "metadataPath": "metadata/",
            "reviewPath": "review/",
            "completedBodyCount": len(metadata_records),
            "expectedBodyCount": expected_bodies,
            "completedShadowCount": shadow_count,
            "expectedShadowCount": expected_shadows,
            "shadowVersions": sorted(shadow_versions),
            "lightOnlyShadowCount": light_only_shadow_count,
        },
        "sprites": dict(sorted(sprites.items())),
    }
    atomic_write_json(manifest_path, manifest)
    return manifest
