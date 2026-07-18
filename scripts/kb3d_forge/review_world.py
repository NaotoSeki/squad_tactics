# -*- coding: utf-8 -*-
"""Build the deterministic Round-1 thirty-hex review world.

The manifest describes *world* features, not a bag of independent tile
sprites.  This module therefore builds one continuous terrain and lays a
single road, field parcel, hedgerow, and contextual damage across it.  All
planning code works in stock Python; Blender is imported only by
``build_blender_world`` so geometry and determinism can be tested cheaply.

Typical Blender invocation (the input blend is already open)::

    blender scene.blend --background --python review_world.py -- \
        --manifest review_scene_round1.json --save-blend review_world.blend

Use ``python review_world.py --plan-only`` for a Blender-free contract check.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


DEFAULT_MANIFEST = Path(__file__).with_name("review_scene_round1.json")
COLLECTION_NAME = "REVIEW_WORLD"
RENDER_SCENE_NAME = "REVIEW_WORLD_RENDER"
ROTATION_DEG = 0
REVIEW_CAMERA_ELEVATION_DEG = 55.0
REVIEW_CAMERA_DISTANCE_M = 180.0
REVIEW_RENDER_WIDTH_PX = 1280
REVIEW_RENDER_HEIGHT_PX = 960
REVIEW_RENDER_SAMPLES = 64
REVIEW_PIXEL_ASPECT_X = 1.0 / math.sin(
    math.radians(REVIEW_CAMERA_ELEVATION_DEG)
)
REVIEW_FRAME_MARGIN = 1.12
REVIEW_CONTENT_MIN_Z_M = -1.10
REVIEW_CONTENT_MAX_Z_M = 12.00
REVIEW_SUN_ENERGY = 2.60
REVIEW_WORLD_STRENGTH = 0.50
REVIEW_EXPOSURE = 1.05
REVIEW_BACKGROUND_SRGB = (0.15, 0.17, 0.18, 1.0)
REVIEW_HEX_LINE_WIDTH_M = 0.055
REVIEW_HEX_LINE_LIFT_M = 0.085
REVIEW_PALETTE_SRGB = {
    "grass": (0.22, 0.265, 0.065, 1.0),
    "worn": (0.20, 0.115, 0.045, 1.0),
    "field": (0.150, 0.080, 0.030, 1.0),
    "edge": (0.055, 0.032, 0.012, 1.0),
    "shoulder": (0.25, 0.18, 0.100, 1.0),
    "road": (0.34, 0.25, 0.140, 1.0),
    "rut": (0.26, 0.17, 0.085, 1.0),
    "row": (0.225, 0.095, 0.025, 1.0),
    "crop": (0.42, 0.385, 0.080, 1.0),
    "bank": (0.16, 0.090, 0.040, 1.0),
    "leaf": (0.15, 0.30, 0.070, 1.0),
    "leaf_dark": (0.08, 0.20, 0.040, 1.0),
    "bark": (0.12, 0.070, 0.035, 1.0),
    "crater_road": (0.090, 0.030, 0.006, 1.0),
    "crater_field": (0.065, 0.018, 0.004, 1.0),
    "hex_line": (0.12, 0.105, 0.045, 1.0),
}
REVIEW_MATERIAL_TEXTURE = {
    "grass": (0.34, 0.18, 0.20, 0.070),
    "worn": (0.48, 0.16, 0.18, 0.060),
    "field": (0.62, 0.20, 0.24, 0.075),
    "edge": (0.30, 0.10, 0.08, 0.035),
    "shoulder": (0.72, 0.14, 0.18, 0.050),
    "road": (0.86, 0.16, 0.22, 0.055),
    "rut": (1.10, 0.10, 0.16, 0.035),
    "row": (0.95, 0.18, 0.24, 0.060),
    "crop": (1.80, 0.12, 0.10, 0.025),
    "bank": (0.80, 0.18, 0.22, 0.065),
    "leaf": (1.55, 0.16, 0.16, 0.035),
    "leaf_dark": (1.35, 0.14, 0.14, 0.030),
    "bark": (1.20, 0.14, 0.18, 0.040),
    "crater_road": (0.90, 0.18, 0.24, 0.070),
    "crater_field": (0.90, 0.18, 0.24, 0.070),
    "hex_line": (0.0, 0.0, 0.0, 0.0),
}
GROUND_GRID_STEP_M = 1.35
ROAD_SAMPLES_PER_SEGMENT = 12
HEDGE_SAMPLES_PER_SEGMENT = 12
ROAD_END_EXTENSION_M = 10.0
FIELD_EDGE_INSET_SCALE = 0.91
FIELD_ROW_END_MARGIN_M = 0.48
CROP_SPACING_M = 1.25
EPSILON = 1.0e-9

def srgb_channel_to_linear(value: float) -> float:
    value = max(0.0, min(1.0, float(value)))
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def srgb_rgba_to_linear(
    color: Sequence[float],
) -> tuple[float, float, float, float]:
    if len(color) != 4:
        raise ValueError("an RGBA color requires four channels")
    return (
        *(srgb_channel_to_linear(channel) for channel in color[:3]),
        max(0.0, min(1.0, float(color[3]))),
    )


@dataclass(frozen=True)
class Point2:
    x: float
    y: float


@dataclass(frozen=True)
class Bounds2:
    min_x: float
    max_x: float
    min_y: float
    max_y: float


@dataclass(frozen=True)
class CameraFit:
    target_xyz: tuple[float, float, float]
    location_xyz: tuple[float, float, float]
    ortho_scale_m: float
    projected_width_m: float
    projected_height_m: float
    elevation_deg: float
    distance_m: float
    resolution_px: tuple[int, int]
    pixel_aspect_x: float
    pixel_aspect_y: float
    frame_margin: float

    @property
    def display_aspect(self) -> float:
        return (
            (self.resolution_px[0] * self.pixel_aspect_x)
            / (self.resolution_px[1] * self.pixel_aspect_y)
        )


def camera_fit_for_bounds(
    bounds: Bounds2,
    *,
    min_z_m: float = REVIEW_CONTENT_MIN_Z_M,
    max_z_m: float = REVIEW_CONTENT_MAX_Z_M,
    elevation_deg: float = REVIEW_CAMERA_ELEVATION_DEG,
    resolution_px: tuple[int, int] = (
        REVIEW_RENDER_WIDTH_PX,
        REVIEW_RENDER_HEIGHT_PX,
    ),
    pixel_aspect_x: float = REVIEW_PIXEL_ASPECT_X,
    pixel_aspect_y: float = 1.0,
    frame_margin: float = REVIEW_FRAME_MARGIN,
    minimum_distance_m: float = REVIEW_CAMERA_DISTANCE_M,
) -> CameraFit:
    """Fit a horizontal-sensor orthographic camera around the board AABB.

    The military camera looks along +Y from a 55-degree elevation. Its screen
    up coordinate is ``Y*sin(elevation) + Z*cos(elevation)``. The returned
    horizontal ``ortho_scale_m`` therefore accounts for the rendered pixel
    aspect as well as the tallest authored review feature.
    """

    values = (
        bounds.min_x,
        bounds.max_x,
        bounds.min_y,
        bounds.max_y,
        min_z_m,
        max_z_m,
        elevation_deg,
        pixel_aspect_x,
        pixel_aspect_y,
        frame_margin,
        minimum_distance_m,
    )
    if not all(math.isfinite(float(value)) for value in values):
        raise ValueError("camera fit values must be finite")
    if bounds.min_x >= bounds.max_x or bounds.min_y >= bounds.max_y:
        raise ValueError("camera bounds must have positive area")
    if min_z_m >= max_z_m:
        raise ValueError("camera z bounds must have positive height")
    if not 0.0 < elevation_deg < 90.0:
        raise ValueError("camera elevation must be between zero and ninety")
    if len(resolution_px) != 2 or any(
        isinstance(value, bool) or not isinstance(value, int) or value <= 0
        for value in resolution_px
    ):
        raise ValueError("camera resolution must contain two positive integers")
    if pixel_aspect_x <= 0.0 or pixel_aspect_y <= 0.0:
        raise ValueError("camera pixel aspect must be positive")
    if frame_margin < 1.0:
        raise ValueError("camera frame margin must be at least one")
    if minimum_distance_m <= 0.0:
        raise ValueError("camera distance must be positive")

    theta = math.radians(elevation_deg)
    projected_width = bounds.max_x - bounds.min_x
    projected_height = (
        (bounds.max_y - bounds.min_y) * math.sin(theta)
        + (max_z_m - min_z_m) * math.cos(theta)
    )
    display_aspect = (
        resolution_px[0] * pixel_aspect_x
    ) / (resolution_px[1] * pixel_aspect_y)
    ortho_scale = max(
        projected_width,
        projected_height * display_aspect,
    ) * frame_margin
    target = (
        (bounds.min_x + bounds.max_x) * 0.5,
        (bounds.min_y + bounds.max_y) * 0.5,
        (min_z_m + max_z_m) * 0.5,
    )
    distance_m = max(minimum_distance_m, ortho_scale * 1.5)
    location = (
        target[0],
        target[1] - distance_m * math.cos(theta),
        target[2] + distance_m * math.sin(theta),
    )
    return CameraFit(
        target_xyz=target,
        location_xyz=location,
        ortho_scale_m=ortho_scale,
        projected_width_m=projected_width,
        projected_height_m=projected_height,
        elevation_deg=elevation_deg,
        distance_m=distance_m,
        resolution_px=resolution_px,
        pixel_aspect_x=pixel_aspect_x,
        pixel_aspect_y=pixel_aspect_y,
        frame_margin=frame_margin,
    )


def project_point_to_review_camera(
    fit: CameraFit,
    point_xyz: tuple[float, float, float],
) -> tuple[float, float]:
    """Return camera-plane XY in metres for a pure-Python fit assertion."""

    theta = math.radians(fit.elevation_deg)
    dx = point_xyz[0] - fit.target_xyz[0]
    dy = point_xyz[1] - fit.target_xyz[1]
    dz = point_xyz[2] - fit.target_xyz[2]
    return (dx, dy * math.sin(theta) + dz * math.cos(theta))


@dataclass(frozen=True)
class CellPoint:
    cell_id: str
    center: Point2


@dataclass(frozen=True)
class CraterPlan:
    feature_id: str
    context: str
    anchor_cell: str
    center: Point2
    radius_x_m: float
    radius_y_m: float
    depth_m: float
    rim_height_m: float
    rotation_deg: int = ROTATION_DEG
    shape: str = "asymmetric_broken_rim_with_ejecta_fan"


@dataclass(frozen=True)
class RoadPlan:
    feature_id: str
    cell_ids: tuple[str, ...]
    cell_points: tuple[Point2, ...]
    control_points: tuple[Point2, ...]
    samples: tuple[Point2, ...]
    width_m: float
    shoulder_m: float
    rut_offsets_m: tuple[float, ...]
    rotation_deg: int = ROTATION_DEG


@dataclass(frozen=True)
class FieldRow:
    row_index: int
    offset_m: float
    start: Point2
    end: Point2


@dataclass(frozen=True)
class FieldRowSegment:
    row_index: int
    part_index: int
    start: Point2
    end: Point2


@dataclass(frozen=True)
class CropStalk:
    row_index: int
    ordinal: int
    point: Point2
    height_m: float


@dataclass(frozen=True)
class FieldPlan:
    feature_id: str
    cell_ids: tuple[str, ...]
    polygon: tuple[Point2, ...]
    bearing_deg: float
    row_spacing_m: float
    row_height_m: float
    rows: tuple[FieldRow, ...]
    visible_segments: tuple[FieldRowSegment, ...]
    crop_stalks: tuple[CropStalk, ...]
    rotation_deg: int = ROTATION_DEG

    @property
    def row_count(self) -> int:
        return len(self.rows)


@dataclass(frozen=True)
class HedgePlan:
    feature_id: str
    cell_ids: tuple[str, ...]
    samples: tuple[Point2, ...]
    bank_width_m: float
    hedge_width_m: float
    brush_stations: tuple[Point2, ...]
    tree_stations: tuple[Point2, ...]
    foliage_style: str = "irregular_ribbon_leaf_cards_sparse_branch_trees"
    rotation_deg: int = ROTATION_DEG


@dataclass(frozen=True)
class ReservedFootprint:
    role: str
    cell_ids: tuple[str, ...]
    polygon: tuple[Point2, ...]


@dataclass(frozen=True)
class WorldPlan:
    scene_id: str
    manifest_sha256: str
    rotation_deg: int
    hex_radius_m: float
    cells: tuple[CellPoint, ...]
    ground_bounds: Bounds2
    road: RoadPlan
    field: FieldPlan
    hedge: HedgePlan
    craters: tuple[CraterPlan, ...]
    reserved_footprints: tuple[ReservedFootprint, ...]


@dataclass(frozen=True)
class MeshData:
    vertices: tuple[tuple[float, float, float], ...]
    faces: tuple[tuple[int, ...], ...]
    material_indices: tuple[int, ...]


def load_manifest(path: str | Path = DEFAULT_MANIFEST) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _manifest_digest(manifest: Mapping[str, Any]) -> str:
    payload = json.dumps(
        manifest,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _feature(
    manifest: Mapping[str, Any],
    feature_type: str,
    *,
    role: str | None = None,
    context: str | None = None,
) -> Mapping[str, Any]:
    matches = []
    for item in manifest.get("features", []):
        if item.get("type") != feature_type:
            continue
        if role is not None and item.get("role") != role:
            continue
        if context is not None and item.get("context") != context:
            continue
        matches.append(item)
    if len(matches) != 1:
        raise ValueError(
            "expected one %s feature (role=%r context=%r), found %d"
            % (feature_type, role, context, len(matches))
        )
    return matches[0]


def _validate_contract(manifest: Mapping[str, Any]) -> None:
    determinism = manifest.get("determinism", {})
    grid = manifest.get("grid", {})
    if determinism.get("random_placement") is not False:
        raise ValueError("review world forbids random placement")
    if determinism.get("asset_rotation_policy") != "rot0_only":
        raise ValueError("review world requires rot0_only")
    if determinism.get("seed") is not None:
        raise ValueError("review world does not accept a random seed")
    if grid.get("columns") != 5 or grid.get("rows") != 6:
        raise ValueError("review world requires the fixed 5x6 manifest")
    if len(grid.get("cells", [])) != 30:
        raise ValueError("review world requires exactly 30 cells")
    if grid.get("orientation") != "pointy_top":
        raise ValueError("review world requires pointy-top hexes")


def _add(a: Point2, b: Point2) -> Point2:
    return Point2(a.x + b.x, a.y + b.y)


def _sub(a: Point2, b: Point2) -> Point2:
    return Point2(a.x - b.x, a.y - b.y)


def _scale(point: Point2, scalar: float) -> Point2:
    return Point2(point.x * scalar, point.y * scalar)


def _dot(a: Point2, b: Point2) -> float:
    return a.x * b.x + a.y * b.y


def _cross(a: Point2, b: Point2) -> float:
    return a.x * b.y - a.y * b.x


def _length(vector: Point2) -> float:
    return math.hypot(vector.x, vector.y)


def distance(a: Point2, b: Point2) -> float:
    return _length(_sub(a, b))


def _normalized(vector: Point2) -> Point2:
    magnitude = _length(vector)
    if magnitude <= EPSILON:
        raise ValueError("cannot normalize a zero-length vector")
    return Point2(vector.x / magnitude, vector.y / magnitude)


def _lerp(a: Point2, b: Point2, amount: float) -> Point2:
    return Point2(
        a.x + (b.x - a.x) * amount,
        a.y + (b.y - a.y) * amount,
    )


def _cell_centers(manifest: Mapping[str, Any]) -> dict[str, Point2]:
    result = {}
    for cell in manifest["grid"]["cells"]:
        center = cell["world_center_m"]
        result[cell["id"]] = Point2(float(center[0]), float(center[1]))
    return result


def _hex_vertices(center: Point2, radius_m: float) -> tuple[Point2, ...]:
    return tuple(
        Point2(
            center.x + radius_m * math.cos(math.radians(30.0 + 60.0 * index)),
            center.y + radius_m * math.sin(math.radians(30.0 + 60.0 * index)),
        )
        for index in range(6)
    )


def convex_hull(points: Iterable[Point2]) -> tuple[Point2, ...]:
    """Return a counter-clockwise hull with no repeated closing point."""

    unique = sorted({(float(point.x), float(point.y)) for point in points})
    if len(unique) < 3:
        raise ValueError("a polygon needs at least three unique points")

    def turn(o: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for point in unique:
        while len(lower) >= 2 and turn(lower[-2], lower[-1], point) <= 0.0:
            lower.pop()
        lower.append(point)
    upper: list[tuple[float, float]] = []
    for point in reversed(unique):
        while len(upper) >= 2 and turn(upper[-2], upper[-1], point) <= 0.0:
            upper.pop()
        upper.append(point)
    return tuple(Point2(x, y) for x, y in lower[:-1] + upper[:-1])


def _scaled_polygon(polygon: Sequence[Point2], scale: float) -> tuple[Point2, ...]:
    center = Point2(
        sum(point.x for point in polygon) / len(polygon),
        sum(point.y for point in polygon) / len(polygon),
    )
    return tuple(_add(center, _scale(_sub(point, center), scale)) for point in polygon)


def point_in_convex_polygon(point: Point2, polygon: Sequence[Point2]) -> bool:
    sign = 0
    for start, end in zip(polygon, polygon[1:] + polygon[:1]):
        value = _cross(_sub(end, start), _sub(point, start))
        if abs(value) <= 1.0e-7:
            continue
        current = 1 if value > 0.0 else -1
        if sign and current != sign:
            return False
        sign = current
    return True


def catmull_rom(
    points: Sequence[Point2],
    samples_per_segment: int,
) -> tuple[Point2, ...]:
    """Sample a uniform Catmull-Rom spline, including every authored point."""

    if len(points) < 2:
        raise ValueError("Catmull-Rom needs at least two points")
    if samples_per_segment < 2:
        raise ValueError("samples_per_segment must be at least two")
    result: list[Point2] = []
    for segment in range(len(points) - 1):
        p0 = points[segment - 1] if segment > 0 else points[segment]
        p1 = points[segment]
        p2 = points[segment + 1]
        p3 = points[segment + 2] if segment + 2 < len(points) else p2
        for step in range(samples_per_segment):
            t = step / samples_per_segment
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * (
                2.0 * p1.x
                + (-p0.x + p2.x) * t
                + (2.0 * p0.x - 5.0 * p1.x + 4.0 * p2.x - p3.x) * t2
                + (-p0.x + 3.0 * p1.x - 3.0 * p2.x + p3.x) * t3
            )
            y = 0.5 * (
                2.0 * p1.y
                + (-p0.y + p2.y) * t
                + (2.0 * p0.y - 5.0 * p1.y + 4.0 * p2.y - p3.y) * t2
                + (-p0.y + 3.0 * p1.y - 3.0 * p2.y + p3.y) * t3
            )
            result.append(Point2(x, y))
    result.append(points[-1])
    return tuple(result)


def _extend_path(points: Sequence[Point2], distance_m: float) -> tuple[Point2, ...]:
    first_direction = _normalized(_sub(points[0], points[1]))
    last_direction = _normalized(_sub(points[-1], points[-2]))
    return (
        _add(points[0], _scale(first_direction, distance_m)),
        *points,
        _add(points[-1], _scale(last_direction, distance_m)),
    )


def _nearest_point_on_polyline(point: Point2, samples: Sequence[Point2]) -> Point2:
    best_point = samples[0]
    best_distance = distance(point, best_point)
    for start, end in zip(samples, samples[1:]):
        delta = _sub(end, start)
        denominator = _dot(delta, delta)
        if denominator <= EPSILON:
            candidate = start
        else:
            amount = max(0.0, min(1.0, _dot(_sub(point, start), delta) / denominator))
            candidate = _add(start, _scale(delta, amount))
        candidate_distance = distance(point, candidate)
        if candidate_distance < best_distance:
            best_distance = candidate_distance
            best_point = candidate
    return best_point


def _point_at_fraction(samples: Sequence[Point2], fraction: float) -> Point2:
    lengths = [distance(start, end) for start, end in zip(samples, samples[1:])]
    total = sum(lengths)
    target = max(0.0, min(1.0, fraction)) * total
    traversed = 0.0
    for index, length_m in enumerate(lengths):
        if traversed + length_m >= target:
            amount = 0.0 if length_m <= EPSILON else (target - traversed) / length_m
            return _lerp(samples[index], samples[index + 1], amount)
        traversed += length_m
    return samples[-1]


def crater_normalized_radius(point: Point2, crater: CraterPlan) -> float:
    """Asymmetric radial coordinate; one is near the broken outer rim."""

    dx = (point.x - crater.center.x) / crater.radius_x_m
    dy = (point.y - crater.center.y) / crater.radius_y_m
    angle = math.atan2(dy, dx)
    modulation = (
        1.0
        + 0.105 * math.cos(3.0 * angle)
        + 0.052 * math.sin(5.0 * angle)
        + 0.035 * math.cos(angle)
    )
    return math.hypot(dx, dy) / modulation


def crater_height(point: Point2, crater: CraterPlan) -> float:
    radius = crater_normalized_radius(point, crater)
    if radius < 0.52:
        amount = radius / 0.52
        return -crater.depth_m * (1.0 - amount * amount)
    if radius < 0.72:
        return crater.rim_height_m * ((radius - 0.52) / 0.20)
    if radius < 1.15:
        return crater.rim_height_m * (1.0 - (radius - 0.72) / 0.43)
    return 0.0


def ground_height(point: Point2, craters: Sequence[CraterPlan]) -> float:
    # The two authored craters do not overlap. Summation also keeps this a
    # smooth, deterministic height field should their outer ejecta meet.
    return sum(crater_height(point, crater) for crater in craters)


def _line_polygon_segment(
    polygon: Sequence[Point2],
    direction: Point2,
    normal: Point2,
    offset: float,
) -> tuple[Point2, Point2] | None:
    origin = _scale(normal, offset)
    parameters: list[float] = []
    for start, end in zip(polygon, polygon[1:] + polygon[:1]):
        edge = _sub(end, start)
        denominator = _cross(edge, direction)
        if abs(denominator) <= EPSILON:
            continue
        edge_amount = _cross(_sub(origin, start), direction) / denominator
        if -1.0e-8 <= edge_amount <= 1.0 + 1.0e-8:
            line_amount = _cross(_sub(origin, start), edge) / denominator
            parameters.append(line_amount)
    if len(parameters) < 2:
        return None
    start_amount = min(parameters) + FIELD_ROW_END_MARGIN_M
    end_amount = max(parameters) - FIELD_ROW_END_MARGIN_M
    if end_amount - start_amount <= 0.5:
        return None
    return (
        _add(origin, _scale(direction, start_amount)),
        _add(origin, _scale(direction, end_amount)),
    )


def _subtract_crater_from_segment(
    start: Point2,
    end: Point2,
    crater: CraterPlan,
    margin: float,
) -> tuple[tuple[Point2, Point2], ...]:
    """Subtract an expanded ellipse from a line segment analytically."""

    rx = crater.radius_x_m * margin
    ry = crater.radius_y_m * margin
    sx = (start.x - crater.center.x) / rx
    sy = (start.y - crater.center.y) / ry
    dx = (end.x - start.x) / rx
    dy = (end.y - start.y) / ry
    a = dx * dx + dy * dy
    b = 2.0 * (sx * dx + sy * dy)
    c = sx * sx + sy * sy - 1.0
    discriminant = b * b - 4.0 * a * c
    if a <= EPSILON or discriminant <= 0.0:
        midpoint = _lerp(start, end, 0.5)
        if ((midpoint.x - crater.center.x) / rx) ** 2 + ((midpoint.y - crater.center.y) / ry) ** 2 < 1.0:
            return ()
        return ((start, end),)
    root = math.sqrt(discriminant)
    enter = (-b - root) / (2.0 * a)
    leave = (-b + root) / (2.0 * a)
    clipped_enter = max(0.0, min(1.0, enter))
    clipped_leave = max(0.0, min(1.0, leave))
    if clipped_leave <= 0.0 or clipped_enter >= 1.0 or clipped_enter >= clipped_leave:
        return ((start, end),)
    pieces: list[tuple[Point2, Point2]] = []
    if clipped_enter > 0.015:
        pieces.append((start, _lerp(start, end, clipped_enter)))
    if clipped_leave < 0.985:
        pieces.append((_lerp(start, end, clipped_leave), end))
    return tuple(pieces)


def _polygon_for_cells(
    cell_ids: Sequence[str],
    centers: Mapping[str, Point2],
    radius_m: float,
    scale: float,
) -> tuple[Point2, ...]:
    points = [
        vertex
        for cell_id in cell_ids
        for vertex in _hex_vertices(centers[cell_id], radius_m)
    ]
    return _scaled_polygon(convex_hull(points), scale)


def _build_road(
    manifest: Mapping[str, Any],
    centers: Mapping[str, Point2],
) -> RoadPlan:
    feature = _feature(manifest, "road_spline")
    cell_ids = tuple(feature["cell_path"])
    cell_points = tuple(centers[cell_id] for cell_id in cell_ids)
    controls = _extend_path(cell_points, ROAD_END_EXTENSION_M)
    samples = catmull_rom(controls, ROAD_SAMPLES_PER_SEGMENT)
    surface = feature["surface"]
    width_m = float(surface["width_m"])
    rut_count = int(surface["rut_count"])
    if rut_count != 2:
        raise ValueError("Round-1 review road requires exactly two wheel ruts")
    rut_offset = width_m * 0.215
    return RoadPlan(
        feature_id=str(feature["id"]),
        cell_ids=cell_ids,
        cell_points=cell_points,
        control_points=controls,
        samples=samples,
        width_m=width_m,
        shoulder_m=float(surface["shoulder_m"]),
        rut_offsets_m=(-rut_offset, rut_offset),
    )


def _build_craters(
    manifest: Mapping[str, Any],
    centers: Mapping[str, Point2],
    road: RoadPlan,
) -> tuple[CraterPlan, ...]:
    road_feature = _feature(manifest, "contextual_crater", context="road")
    field_feature = _feature(manifest, "contextual_crater", context="field")
    road_anchor = centers[str(road_feature["anchor_cell"])]
    road_centerline = _nearest_point_on_polyline(road_anchor, road.samples)
    # Fixed offsets break radial symmetry without introducing a seed or an
    # arbitrary asset rotation. Both craters remain in their authored context.
    road_center = _add(road_centerline, Point2(0.42, -0.28))
    field_center = _add(
        centers[str(field_feature["anchor_cell"])], Point2(-0.58, 0.36)
    )
    return (
        CraterPlan(
            feature_id=str(road_feature["id"]),
            context="road",
            anchor_cell=str(road_feature["anchor_cell"]),
            center=road_center,
            radius_x_m=2.75,
            radius_y_m=2.15,
            depth_m=0.74,
            rim_height_m=0.28,
        ),
        CraterPlan(
            feature_id=str(field_feature["id"]),
            context="field",
            anchor_cell=str(field_feature["anchor_cell"]),
            center=field_center,
            radius_x_m=3.15,
            radius_y_m=2.45,
            depth_m=0.86,
            rim_height_m=0.32,
        ),
    )


def _build_field(
    manifest: Mapping[str, Any],
    centers: Mapping[str, Point2],
    radius_m: float,
    field_crater: CraterPlan,
) -> FieldPlan:
    feature = _feature(manifest, "raised_field_parcel")
    cell_ids = tuple(feature["cells"])
    polygon = _polygon_for_cells(
        cell_ids, centers, radius_m, FIELD_EDGE_INSET_SCALE
    )
    bearing_deg = float(feature["row_bearing_deg"])
    angle = math.radians(bearing_deg)
    direction = Point2(math.cos(angle), math.sin(angle))
    normal = Point2(-direction.y, direction.x)
    spacing = float(feature["row_spacing_m"])
    offsets = [_dot(point, normal) for point in polygon]
    first_offset = math.ceil((min(offsets) + 0.60) / spacing) * spacing
    last_offset = max(offsets) - 0.60

    rows: list[FieldRow] = []
    segments: list[FieldRowSegment] = []
    offset = first_offset
    row_index = 0
    while offset <= last_offset + 1.0e-8:
        endpoints = _line_polygon_segment(polygon, direction, normal, offset)
        if endpoints is not None:
            row = FieldRow(row_index, offset, endpoints[0], endpoints[1])
            rows.append(row)
            visible = _subtract_crater_from_segment(
                row.start, row.end, field_crater, margin=1.08
            )
            for part_index, (start, end) in enumerate(visible):
                if distance(start, end) >= 0.7:
                    segments.append(
                        FieldRowSegment(
                            row_index=row.row_index,
                            part_index=part_index,
                            start=start,
                            end=end,
                        )
                    )
            row_index += 1
        offset += spacing

    stalks: list[CropStalk] = []
    ordinal = 0
    for segment in segments:
        vector = _sub(segment.end, segment.start)
        length_m = _length(vector)
        unit = _normalized(vector)
        phase = 0.38 + (0.23 if segment.row_index % 2 else 0.0)
        cursor = phase
        while cursor < length_m - 0.30:
            point = _add(segment.start, _scale(unit, cursor))
            if crater_normalized_radius(point, field_crater) >= 1.04:
                height = 0.82 + 0.045 * ((segment.row_index * 3 + ordinal) % 5)
                stalks.append(CropStalk(segment.row_index, ordinal, point, height))
                ordinal += 1
            cursor += CROP_SPACING_M

    return FieldPlan(
        feature_id=str(feature["id"]),
        cell_ids=cell_ids,
        polygon=polygon,
        bearing_deg=bearing_deg,
        row_spacing_m=spacing,
        row_height_m=float(feature["row_height_m"]),
        rows=tuple(rows),
        visible_segments=tuple(segments),
        crop_stalks=tuple(stalks),
    )


def _build_hedge(
    manifest: Mapping[str, Any],
    centers: Mapping[str, Point2],
    radius_m: float,
) -> HedgePlan:
    feature = _feature(manifest, "hedgerow_wood_edge")
    cell_ids = tuple(feature["cell_path"])
    # Keep the path inside the four authored eastern cells while placing it
    # visibly toward the map edge. The authored zig-zag is smoothed as one bank.
    authored = tuple(
        _add(centers[cell_id], Point2(radius_m * 0.40, 0.0))
        for cell_id in cell_ids
    )
    samples = catmull_rom(authored, HEDGE_SAMPLES_PER_SEGMENT)
    brush = tuple(samples[index] for index in range(2, len(samples) - 2, 3))
    trees = tuple(_point_at_fraction(samples, fraction) for fraction in (0.18, 0.56, 0.86))
    return HedgePlan(
        feature_id=str(feature["id"]),
        cell_ids=cell_ids,
        samples=samples,
        bank_width_m=1.75,
        hedge_width_m=0.88,
        brush_stations=brush,
        tree_stations=trees,
    )


def build_world_plan(
    manifest_or_path: Mapping[str, Any] | str | Path = DEFAULT_MANIFEST,
) -> WorldPlan:
    """Return the complete immutable, deterministic Blender-free plan."""

    if isinstance(manifest_or_path, Mapping):
        manifest = dict(manifest_or_path)
    else:
        manifest = load_manifest(manifest_or_path)
    _validate_contract(manifest)
    radius_m = float(manifest["grid"]["hex_radius_m"])
    centers = _cell_centers(manifest)
    ordered_cells = tuple(
        CellPoint(cell["id"], centers[cell["id"]])
        for cell in manifest["grid"]["cells"]
    )
    all_vertices = [
        vertex
        for cell in ordered_cells
        for vertex in _hex_vertices(cell.center, radius_m)
    ]
    margin = 1.35
    bounds = Bounds2(
        min(point.x for point in all_vertices) - margin,
        max(point.x for point in all_vertices) + margin,
        min(point.y for point in all_vertices) - margin,
        max(point.y for point in all_vertices) + margin,
    )
    road = _build_road(manifest, centers)
    craters = _build_craters(manifest, centers, road)
    field_crater = next(crater for crater in craters if crater.context == "field")
    field = _build_field(manifest, centers, radius_m, field_crater)
    hedge = _build_hedge(manifest, centers, radius_m)

    footprints = []
    for role in ("camp", "farmstead"):
        cluster = _feature(manifest, "multihex_cluster", role=role)
        cell_ids = tuple(cluster["cells"])
        footprints.append(
            ReservedFootprint(
                role=role,
                cell_ids=cell_ids,
                polygon=_polygon_for_cells(cell_ids, centers, radius_m, 0.84),
            )
        )

    return WorldPlan(
        scene_id=str(manifest["scene_id"]),
        manifest_sha256=_manifest_digest(manifest),
        rotation_deg=ROTATION_DEG,
        hex_radius_m=radius_m,
        cells=ordered_cells,
        ground_bounds=bounds,
        road=road,
        field=field,
        hedge=hedge,
        craters=craters,
        reserved_footprints=tuple(footprints),
    )


def _canonical_value(value: Any) -> Any:
    if dataclasses.is_dataclass(value):
        return _canonical_value(dataclasses.asdict(value))
    if isinstance(value, dict):
        return {key: _canonical_value(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [_canonical_value(item) for item in value]
    if isinstance(value, float):
        return round(value, 9)
    return value


def plan_digest(plan: WorldPlan) -> str:
    payload = json.dumps(
        _canonical_value(plan),
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _point_in_world_hex(
    point: Point2,
    center: Point2,
    radius_m: float,
) -> bool:
    dx = abs(point.x - center.x)
    dy = abs(point.y - center.y)
    return (
        dx <= math.sqrt(3.0) * radius_m * 0.5 + 1.0e-7
        and dy + dx / math.sqrt(3.0) <= radius_m + 1.0e-7
    )


def terrain_surface_height(plan: WorldPlan, point: Point2) -> float:
    undulation = 0.025 * math.sin(point.x * 0.19) * math.cos(point.y * 0.17)
    return undulation + ground_height(point, plan.craters)


def _ground_material_index(plan: WorldPlan, point: Point2) -> int:
    if not any(
        _point_in_world_hex(point, cell.center, plan.hex_radius_m)
        for cell in plan.cells
    ):
        return 3
    if point_in_convex_polygon(point, plan.field.polygon):
        return 2
    if any(
        point_in_convex_polygon(point, footprint.polygon)
        for footprint in plan.reserved_footprints
    ):
        return 1
    return 0


def build_ground_mesh_data(
    plan: WorldPlan,
    step_m: float = GROUND_GRID_STEP_M,
) -> MeshData:
    """Return one shared-vertex rectangular terrain grid for all 30 hexes."""

    if step_m <= 0.0:
        raise ValueError("ground grid step must be positive")
    bounds = plan.ground_bounds
    x_segments = max(1, math.ceil((bounds.max_x - bounds.min_x) / step_m))
    y_segments = max(1, math.ceil((bounds.max_y - bounds.min_y) / step_m))
    x_step = (bounds.max_x - bounds.min_x) / x_segments
    y_step = (bounds.max_y - bounds.min_y) / y_segments
    vertices: list[tuple[float, float, float]] = []
    for row in range(y_segments + 1):
        y = bounds.min_y + row * y_step
        for column in range(x_segments + 1):
            x = bounds.min_x + column * x_step
            point = Point2(x, y)
            z = terrain_surface_height(plan, point)
            vertices.append((x, y, z))

    faces: list[tuple[int, ...]] = []
    materials: list[int] = []
    stride = x_segments + 1
    for row in range(y_segments):
        for column in range(x_segments):
            lower_left = row * stride + column
            face = (
                lower_left,
                lower_left + 1,
                lower_left + stride + 1,
                lower_left + stride,
            )
            faces.append(face)
            center = Point2(
                bounds.min_x + (column + 0.5) * x_step,
                bounds.min_y + (row + 0.5) * y_step,
            )
            materials.append(_ground_material_index(plan, center))
    return MeshData(tuple(vertices), tuple(faces), tuple(materials))


def build_hex_overlay_mesh_data(plan: WorldPlan) -> MeshData:
    """Return one faint ribbon per unique edge in the fixed 30-hex board."""

    unique_edges = {}
    for cell in plan.cells:
        corners = _hex_vertices(cell.center, plan.hex_radius_m)
        for start, end in zip(corners, corners[1:] + corners[:1]):
            start_key = (round(start.x, 4), round(start.y, 4))
            end_key = (round(end.x, 4), round(end.y, 4))
            key = tuple(sorted((start_key, end_key)))
            unique_edges.setdefault(key, (start, end))

    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    half_width = REVIEW_HEX_LINE_WIDTH_M * 0.5
    for start, end in unique_edges.values():
        tangent = _normalized(_sub(end, start))
        normal = Point2(-tangent.y, tangent.x)
        points = (
            _add(start, _scale(normal, half_width)),
            _add(start, _scale(normal, -half_width)),
            _add(end, _scale(normal, -half_width)),
            _add(end, _scale(normal, half_width)),
        )
        base = len(vertices)
        for point in points:
            vertices.append((
                point.x,
                point.y,
                terrain_surface_height(plan, point) + REVIEW_HEX_LINE_LIFT_M,
            ))
        faces.append((base, base + 1, base + 2, base + 3))
    return MeshData(tuple(vertices), tuple(faces), (0,) * len(faces))


def _sample_normal(samples: Sequence[Point2], index: int) -> Point2:
    if index == 0:
        tangent = _sub(samples[1], samples[0])
    elif index == len(samples) - 1:
        tangent = _sub(samples[-1], samples[-2])
    else:
        tangent = _sub(samples[index + 1], samples[index - 1])
    tangent = _normalized(tangent)
    return Point2(-tangent.y, tangent.x)


def _road_mesh_data(plan: WorldPlan, shoulder: bool) -> MeshData:
    road_crater = next(crater for crater in plan.craters if crater.context == "road")
    if shoulder:
        half = plan.road.width_m * 0.5 + plan.road.shoulder_m
        offsets = (-half, -plan.road.width_m * 0.58, 0.0, plan.road.width_m * 0.58, half)
        lifts = (0.018, 0.045, 0.052, 0.045, 0.018)
        strip_materials = (0, 0, 0, 0)
    else:
        half = plan.road.width_m * 0.5
        rut = abs(plan.road.rut_offsets_m[0])
        groove = 0.12
        offsets = (-half, -rut - groove, -rut, -rut + groove, 0.0,
                   rut - groove, rut, rut + groove, half)
        lifts = (0.082, 0.080, 0.012, 0.080, 0.086,
                 0.080, 0.012, 0.080, 0.082)
        strip_materials = (0, 1, 1, 0, 0, 1, 1, 0)

    vertices: list[tuple[float, float, float]] = []
    for index, center in enumerate(plan.road.samples):
        normal = _sample_normal(plan.road.samples, index)
        organic = 1.0 + 0.025 * math.sin(index * 0.71) + 0.012 * math.sin(index * 0.19)
        for offset, lift in zip(offsets, lifts):
            point = _add(center, _scale(normal, offset * organic))
            vertices.append(
                (point.x, point.y, ground_height(point, plan.craters) + lift)
            )

    faces: list[tuple[int, ...]] = []
    materials: list[int] = []
    width = len(offsets)
    for index in range(len(plan.road.samples) - 1):
        midpoint = _lerp(plan.road.samples[index], plan.road.samples[index + 1], 0.5)
        if crater_normalized_radius(midpoint, road_crater) < 0.79:
            continue
        for strip in range(width - 1):
            base = index * width + strip
            faces.append((base, base + 1, base + width + 1, base + width))
            materials.append(strip_materials[strip])
    return MeshData(tuple(vertices), tuple(faces), tuple(materials))


def _field_rows_mesh_data(plan: WorldPlan) -> MeshData:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    materials: list[int] = []
    angle = math.radians(plan.field.bearing_deg)
    normal = Point2(-math.sin(angle), math.cos(angle))
    half_width = min(0.29, plan.field.row_spacing_m * 0.34)
    for segment in plan.field.visible_segments:
        base = len(vertices)
        for endpoint in (segment.start, segment.end):
            for offset, lift in (
                (-half_width, 0.025),
                (0.0, plan.field.row_height_m),
                (half_width, 0.025),
            ):
                point = _add(endpoint, _scale(normal, offset))
                vertices.append(
                    (
                        point.x,
                        point.y,
                        ground_height(point, plan.craters) + 0.035 + lift,
                    )
                )
        faces.extend(((base, base + 1, base + 4, base + 3),
                      (base + 1, base + 2, base + 5, base + 4)))
        materials.extend((0, 0))
    return MeshData(tuple(vertices), tuple(faces), tuple(materials))


def _append_tapered_segment(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    materials: list[int],
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    radius_start: float,
    radius_end: float,
    material_index: int,
    sides: int = 6,
) -> None:
    dx, dy, dz = end[0] - start[0], end[1] - start[1], end[2] - start[2]
    magnitude = math.sqrt(dx * dx + dy * dy + dz * dz)
    if magnitude <= EPSILON:
        return
    direction = (dx / magnitude, dy / magnitude, dz / magnitude)
    reference = (0.0, 0.0, 1.0) if abs(direction[2]) < 0.9 else (1.0, 0.0, 0.0)
    ux = direction[1] * reference[2] - direction[2] * reference[1]
    uy = direction[2] * reference[0] - direction[0] * reference[2]
    uz = direction[0] * reference[1] - direction[1] * reference[0]
    u_length = math.sqrt(ux * ux + uy * uy + uz * uz)
    ux, uy, uz = ux / u_length, uy / u_length, uz / u_length
    vx = direction[1] * uz - direction[2] * uy
    vy = direction[2] * ux - direction[0] * uz
    vz = direction[0] * uy - direction[1] * ux
    base = len(vertices)
    for center, radius in ((start, radius_start), (end, radius_end)):
        for side in range(sides):
            angle = math.tau * side / sides
            cx = math.cos(angle) * radius
            cy = math.sin(angle) * radius
            vertices.append((
                center[0] + ux * cx + vx * cy,
                center[1] + uy * cx + vy * cy,
                center[2] + uz * cx + vz * cy,
            ))
    for side in range(sides):
        next_side = (side + 1) % sides
        faces.append((base + side, base + next_side,
                      base + sides + next_side, base + sides + side))
        materials.append(material_index)


def _crop_mesh_data(plan: WorldPlan) -> MeshData:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    materials: list[int] = []
    for stalk in plan.field.crop_stalks:
        z = ground_height(stalk.point, plan.craters) + plan.field.row_height_m + 0.05
        _append_tapered_segment(
            vertices,
            faces,
            materials,
            (stalk.point.x, stalk.point.y, z),
            (stalk.point.x, stalk.point.y, z + stalk.height_m),
            0.026,
            0.012,
            0,
            sides=4,
        )
        # One fixed leaf blade gives the crop a readable silhouette. Its world
        # orientation is authored at rot0 and never varied per instance.
        base = len(vertices)
        leaf_z = z + stalk.height_m * 0.56
        vertices.extend((
            (stalk.point.x, stalk.point.y, leaf_z),
            (stalk.point.x + 0.18, stalk.point.y + 0.035, leaf_z + 0.12),
            (stalk.point.x + 0.05, stalk.point.y + 0.015, leaf_z + 0.25),
        ))
        faces.append((base, base + 1, base + 2))
        materials.append(0)
    return MeshData(tuple(vertices), tuple(faces), tuple(materials))


def _hedge_bank_mesh_data(plan: WorldPlan) -> MeshData:
    offsets = (-0.875, -0.44, 0.0, 0.44, 0.875)
    lifts = (0.01, 0.18, 0.34, 0.18, 0.01)
    vertices: list[tuple[float, float, float]] = []
    for index, center in enumerate(plan.hedge.samples):
        normal = _sample_normal(plan.hedge.samples, index)
        for offset, lift in zip(offsets, lifts):
            point = _add(center, _scale(normal, offset))
            vertices.append((point.x, point.y, ground_height(point, plan.craters) + lift))
    faces: list[tuple[int, ...]] = []
    for index in range(len(plan.hedge.samples) - 1):
        for strip in range(len(offsets) - 1):
            base = index * len(offsets) + strip
            faces.append((base, base + 1, base + len(offsets) + 1,
                          base + len(offsets)))
    return MeshData(tuple(vertices), tuple(faces), (0,) * len(faces))


def _hedge_body_mesh_data(plan: WorldPlan) -> MeshData:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    width = plan.hedge.hedge_width_m
    for index, center in enumerate(plan.hedge.samples):
        normal = _sample_normal(plan.hedge.samples, index)
        left = _add(center, _scale(normal, -width * 0.5))
        right = _add(center, _scale(normal, width * 0.5))
        base_z = ground_height(center, plan.craters) + 0.29
        top = base_z + 0.76 + 0.14 * math.sin(index * 1.37) + 0.07 * math.sin(index * 0.43)
        vertices.extend((
            (left.x, left.y, base_z),
            (right.x, right.y, base_z),
            (left.x, left.y, top - 0.05),
            (right.x, right.y, top + 0.04),
        ))
    for index in range(len(plan.hedge.samples) - 1):
        base = index * 4
        nxt = base + 4
        faces.extend((
            (base, nxt, nxt + 2, base + 2),
            (base + 1, base + 3, nxt + 3, nxt + 1),
            (base + 2, nxt + 2, nxt + 3, base + 3),
        ))
    return MeshData(tuple(vertices), tuple(faces), (0,) * len(faces))


def _append_leaf_cards(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    materials: list[int],
    center: tuple[float, float, float],
    width: float,
    height: float,
    material_index: int,
) -> None:
    for angle_deg in (0.0, 60.0, 120.0):
        angle = math.radians(angle_deg)
        horizontal = (math.cos(angle) * width * 0.5, math.sin(angle) * width * 0.5)
        base = len(vertices)
        vertices.extend((
            (center[0] - horizontal[0], center[1] - horizontal[1], center[2]),
            (center[0], center[1], center[2] + height * 0.52),
            (center[0] + horizontal[0], center[1] + horizontal[1], center[2]),
            (center[0], center[1], center[2] - height * 0.48),
        ))
        faces.extend(((base, base + 1, base + 2), (base, base + 2, base + 3)))
        materials.extend((material_index, material_index))


def _hedge_woody_mesh_data(plan: WorldPlan) -> MeshData:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    materials: list[int] = []

    for index, point in enumerate(plan.hedge.brush_stations):
        ground_z = ground_height(point, plan.craters) + 0.31
        lean = -0.24 if index % 2 else 0.24
        top = (point.x + lean, point.y + 0.10 * ((index % 3) - 1), ground_z + 1.15)
        _append_tapered_segment(
            vertices, faces, materials,
            (point.x, point.y, ground_z), top,
            0.045, 0.012, 0, sides=5,
        )
        if index % 2 == 0:
            _append_leaf_cards(vertices, faces, materials, top, 0.72, 0.58, 1)

    for tree_index, point in enumerate(plan.hedge.tree_stations):
        base_z = ground_height(point, plan.craters) + 0.32
        height = 4.6 + tree_index * 0.42
        trunk_top = (point.x, point.y, base_z + height * 0.72)
        _append_tapered_segment(
            vertices, faces, materials,
            (point.x, point.y, base_z), trunk_top,
            0.17, 0.07, 0, sides=7,
        )
        for branch_index, angle_deg in enumerate((28.0, 148.0, 268.0)):
            angle = math.radians(angle_deg)
            branch_start = (
                point.x,
                point.y,
                base_z + height * (0.49 + branch_index * 0.075),
            )
            branch_end = (
                point.x + math.cos(angle) * (1.18 + tree_index * 0.08),
                point.y + math.sin(angle) * (1.18 + tree_index * 0.08),
                base_z + height * (0.75 + branch_index * 0.055),
            )
            _append_tapered_segment(
                vertices, faces, materials,
                branch_start, branch_end,
                0.075, 0.018, 0, sides=5,
            )
            _append_leaf_cards(
                vertices, faces, materials, branch_end,
                1.65, 1.42, 1 + ((tree_index + branch_index) % 2),
            )
        _append_leaf_cards(
            vertices, faces, materials,
            (trunk_top[0], trunk_top[1], trunk_top[2] + 0.55),
            1.85, 1.65, 2,
        )
    return MeshData(tuple(vertices), tuple(faces), tuple(materials))


def _crater_rim_mesh_data(plan: WorldPlan) -> MeshData:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    materials: list[int] = []
    segments = 48
    for crater_index, crater in enumerate(plan.craters):
        base = len(vertices)
        for ring_scale in (0.55, 0.73, 1.13):
            for index in range(segments):
                angle = math.tau * index / segments
                modulation = 1.0 + 0.105 * math.cos(3.0 * angle) + 0.052 * math.sin(5.0 * angle) + 0.035 * math.cos(angle)
                point = Point2(
                    crater.center.x + math.cos(angle) * crater.radius_x_m * ring_scale * modulation,
                    crater.center.y + math.sin(angle) * crater.radius_y_m * ring_scale * modulation,
                )
                z = ground_height(point, plan.craters) + 0.024
                vertices.append((point.x, point.y, z))
        broken = {9, 10, 11, 12, 30, 31} if crater_index == 0 else {6, 7, 26, 27, 28}
        for ring in range(2):
            for index in range(segments):
                if index in broken:
                    continue
                nxt = (index + 1) % segments
                lower = base + ring * segments
                upper = base + (ring + 1) * segments
                faces.append((lower + index, lower + nxt, upper + nxt, upper + index))
                materials.append(crater_index)
    return MeshData(tuple(vertices), tuple(faces), tuple(materials))


def _crater_ejecta_mesh_data(plan: WorldPlan) -> MeshData:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    materials: list[int] = []
    angles = (-24.0, -12.0, 0.0, 13.0, 25.0)
    for crater_index, crater in enumerate(plan.craters):
        for fan_index, angle_deg in enumerate(angles):
            angle = math.radians(angle_deg)
            distance_m = crater.radius_x_m * (1.08 + fan_index * 0.13)
            center = Point2(
                crater.center.x + math.cos(angle) * distance_m,
                crater.center.y + math.sin(angle) * distance_m,
            )
            direction = Point2(math.cos(angle), math.sin(angle))
            normal = Point2(-direction.y, direction.x)
            half_length = 0.62 + 0.08 * fan_index
            half_width = 0.24 + 0.025 * (4 - fan_index)
            points = (
                _add(center, _scale(direction, -half_length)),
                _add(center, _scale(normal, half_width)),
                _add(center, _scale(direction, half_length)),
                _add(center, _scale(normal, -half_width)),
            )
            base = len(vertices)
            for point in points:
                vertices.append((point.x, point.y, ground_height(point, plan.craters) + 0.035))
            faces.append((base, base + 1, base + 2, base + 3))
            materials.append(crater_index)
    return MeshData(tuple(vertices), tuple(faces), tuple(materials))


def _ensure_material(
    bpy: Any,
    name: str,
    srgb_color: tuple[float, float, float, float],
    roughness: float = 0.9,
    *,
    noise_scale: float = 0.0,
    variation: float = 0.0,
    bump_strength: float = 0.0,
    bump_distance: float = 0.0,
) -> Any:
    """Create one deterministic, physically dark review material."""

    material = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
    base_color = srgb_rgba_to_linear(srgb_color)
    material.diffuse_color = base_color
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (620.0, 0.0)
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (340.0, 0.0)
    principled.inputs["Roughness"].default_value = roughness
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])

    if noise_scale > 0.0 and variation > 0.0:
        coordinates = nodes.new("ShaderNodeTexCoord")
        coordinates.location = (-720.0, 60.0)
        noise = nodes.new("ShaderNodeTexNoise")
        noise.location = (-500.0, 60.0)
        noise.noise_dimensions = "3D"
        noise.inputs["Scale"].default_value = noise_scale
        noise.inputs["Detail"].default_value = 3.0
        noise.inputs["Roughness"].default_value = 0.68
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.location = (-210.0, 90.0)
        dark = tuple(channel * (1.0 - variation) for channel in base_color[:3])
        light = tuple(min(1.0, channel * (1.0 + variation)) for channel in base_color[:3])
        ramp.color_ramp.elements[0].position = 0.24
        ramp.color_ramp.elements[0].color = (*dark, base_color[3])
        ramp.color_ramp.elements[1].position = 0.76
        ramp.color_ramp.elements[1].color = (*light, base_color[3])
        links.new(coordinates.outputs["Object"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], principled.inputs["Base Color"])

        if bump_strength > 0.0 and bump_distance > 0.0:
            bump = nodes.new("ShaderNodeBump")
            bump.location = (80.0, -180.0)
            bump.inputs["Strength"].default_value = bump_strength
            bump.inputs["Distance"].default_value = bump_distance
            links.new(noise.outputs["Fac"], bump.inputs["Height"])
            links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    else:
        principled.inputs["Base Color"].default_value = base_color

    material["review_palette_srgb"] = list(srgb_color)
    material["review_noise_scale"] = noise_scale
    return material


def _mesh_object(
    bpy: Any,
    collection: Any,
    name: str,
    data: MeshData,
    materials: Sequence[Any],
    *,
    smooth: bool = False,
) -> Any:
    mesh = bpy.data.meshes.new(name + "_MESH")
    mesh.from_pydata(data.vertices, (), data.faces)
    mesh.update()
    for material in materials:
        mesh.materials.append(material)
    if len(data.material_indices) != len(mesh.polygons):
        raise RuntimeError("material index count mismatch for %s" % name)
    for polygon, material_index in zip(mesh.polygons, data.material_indices):
        polygon.material_index = int(material_index)
        polygon.use_smooth = smooth
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.scale = (1.0, 1.0, 1.0)
    return obj


def _prepare_collection(bpy: Any, scene: Any, name: str) -> Any:
    collection = bpy.data.collections.get(name)
    if collection is None:
        collection = bpy.data.collections.new(name)
    if scene.collection.children.get(name) is None:
        scene.collection.children.link(collection)
    for obj in list(collection.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for child in list(collection.children):
        collection.children.unlink(child)
        if child.users == 0:
            bpy.data.collections.remove(child)
    return collection


def build_blender_world(
    manifest_or_path: Mapping[str, Any] | str | Path = DEFAULT_MANIFEST,
    *,
    scene: Any | None = None,
    collection_name: str = COLLECTION_NAME,
    include_hex_overlay: bool = True,
) -> Any:
    """Create or replace ``REVIEW_WORLD`` in the currently loaded blend."""

    try:
        import bpy  # type: ignore
    except ImportError as exc:  # pragma: no cover - exercised only in Blender
        raise RuntimeError("build_blender_world must run inside Blender") from exc

    plan = build_world_plan(manifest_or_path)
    target_scene = scene or bpy.context.scene
    if target_scene is None:
        raise RuntimeError("the blend contains no active scene")
    collection = _prepare_collection(bpy, target_scene, collection_name)

    def material(key: str, name: str, roughness: float) -> Any:
        texture = REVIEW_MATERIAL_TEXTURE[key]
        return _ensure_material(
            bpy,
            name,
            REVIEW_PALETTE_SRGB[key],
            roughness,
            noise_scale=texture[0],
            variation=texture[1],
            bump_strength=texture[2],
            bump_distance=texture[3],
        )

    materials = {
        "grass": material("grass", "RW_Grass", 0.96),
        "worn": material("worn", "RW_WornEarth", 0.98),
        "field": material("field", "RW_FieldSoil", 0.98),
        "edge": material("edge", "RW_BoardEdgeEarth", 1.0),
        "shoulder": material("shoulder", "RW_RoadShoulder", 0.99),
        "road": material("road", "RW_CompactedDirt", 0.97),
        "rut": material("rut", "RW_RutDark", 1.0),
        "row": material("row", "RW_RaisedRow", 1.0),
        "crop": material("crop", "RW_CropStalk", 0.88),
        "bank": material("bank", "RW_HedgeBank", 0.98),
        "leaf": material("leaf", "RW_HedgeLeaf", 0.92),
        "leaf_dark": material("leaf_dark", "RW_HedgeLeafDark", 0.95),
        "bark": material("bark", "RW_HedgeBark", 1.0),
        "crater_road": material("crater_road", "RW_RoadCraterSoil", 1.0),
        "crater_field": material("crater_field", "RW_FieldCraterSoil", 1.0),
        "hex_line": material("hex_line", "RW_FaintHexLine", 1.0),
    }

    ground = _mesh_object(
        bpy, collection, "RW_GroundContinuous",
        build_ground_mesh_data(plan),
        (materials["grass"], materials["worn"], materials["field"], materials["edge"]),
        smooth=True,
    )
    ground["semantic"] = "single_connected_30hex_ground"
    if include_hex_overlay:
        overlay = _mesh_object(
            bpy, collection, "RW_Faint30HexOverlay",
            build_hex_overlay_mesh_data(plan),
            (materials["hex_line"],), smooth=False,
        )
        overlay["semantic"] = "optional_faint_unique_hex_edges"
        overlay["line_width_m"] = REVIEW_HEX_LINE_WIDTH_M

    shoulder = _mesh_object(
        bpy, collection, "RW_RoadShoulder",
        _road_mesh_data(plan, shoulder=True),
        (materials["shoulder"],), smooth=True,
    )
    shoulder["semantic"] = "continuous_compacted_road_shoulders"
    road = _mesh_object(
        bpy, collection, "RW_RoadCompacted_Rutted",
        _road_mesh_data(plan, shoulder=False),
        (materials["road"], materials["rut"]), smooth=True,
    )
    road["semantic"] = "continuous_catmull_rom_road_two_physical_ruts"
    rows = _mesh_object(
        bpy, collection, "RW_FieldRows",
        _field_rows_mesh_data(plan), (materials["row"],), smooth=True,
    )
    rows["bearing_deg"] = plan.field.bearing_deg
    rows["row_count"] = plan.field.row_count
    crops = _mesh_object(
        bpy, collection, "RW_CropStalks",
        _crop_mesh_data(plan), (materials["crop"],), smooth=False,
    )
    crops["placement"] = "fixed_spacing_no_randomness"
    bank = _mesh_object(
        bpy, collection, "RW_HedgeBank",
        _hedge_bank_mesh_data(plan), (materials["bank"],), smooth=True,
    )
    bank["semantic"] = "continuous_earth_bank"
    body = _mesh_object(
        bpy, collection, "RW_HedgeLowBody",
        _hedge_body_mesh_data(plan), (materials["leaf_dark"],), smooth=False,
    )
    body["foliage_style"] = plan.hedge.foliage_style
    woody = _mesh_object(
        bpy, collection, "RW_HedgeBrushAndSparseTrees",
        _hedge_woody_mesh_data(plan),
        (materials["bark"], materials["leaf"], materials["leaf_dark"]),
        smooth=False,
    )
    woody["uses_icospheres"] = False
    rims = _mesh_object(
        bpy, collection, "RW_ContextCraterBrokenRims",
        _crater_rim_mesh_data(plan),
        (materials["crater_road"], materials["crater_field"]),
        smooth=True,
    )
    rims["contexts"] = "road,field"
    ejecta = _mesh_object(
        bpy, collection, "RW_ContextCraterEjectaFans",
        _crater_ejecta_mesh_data(plan),
        (materials["crater_road"], materials["crater_field"]),
        smooth=False,
    )
    ejecta["rotation_deg"] = ROTATION_DEG

    collection["scene_id"] = plan.scene_id
    collection["manifest_sha256"] = plan.manifest_sha256
    collection["plan_sha256"] = plan_digest(plan)
    collection["rotation_deg"] = ROTATION_DEG
    collection["random_placement"] = False
    collection["reserved_footprints"] = json.dumps(
        {footprint.role: list(footprint.cell_ids) for footprint in plan.reserved_footprints},
        sort_keys=True,
        separators=(",", ":"),
    )
    collection["buildings_placed"] = False
    collection["hex_overlay_enabled"] = bool(include_hex_overlay)
    return collection


def _clear_render_scene_links(bpy: Any, scene: Any) -> None:
    """Reset only the generated review scene, never the loaded source scene."""

    for obj in list(scene.collection.objects):
        scene.collection.objects.unlink(obj)
        if obj.users == 0:
            bpy.data.objects.remove(obj)
    for child in list(scene.collection.children):
        scene.collection.children.unlink(child)


def _isolated_render_scene(
    bpy: Any,
    review_collection: Any,
    scene_name: str = RENDER_SCENE_NAME,
) -> Any:
    """Return a clean CLI scene containing only the generated world."""

    scene = bpy.data.scenes.get(scene_name)
    if scene is None:
        scene = bpy.data.scenes.new(scene_name)
    _clear_render_scene_links(bpy, scene)
    scene.collection.children.link(review_collection)
    return scene


def _review_world_background(bpy: Any) -> Any:
    world = bpy.data.worlds.get("RW_ReviewWorld")
    if world is None:
        world = bpy.data.worlds.new("RW_ReviewWorld")
    world.use_nodes = True
    background = next(
        (node for node in world.node_tree.nodes if node.type == "BACKGROUND"),
        None,
    )
    if background is None:
        background = world.node_tree.nodes.new("ShaderNodeBackground")
    background.inputs["Color"].default_value = srgb_rgba_to_linear(REVIEW_BACKGROUND_SRGB)
    background.inputs["Strength"].default_value = REVIEW_WORLD_STRENGTH
    return world


def configure_review_render_scene(
    scene: Any,
    plan: WorldPlan,
) -> tuple[Any, CameraFit]:
    """Install a deterministic 55-degree review rig into ``scene``."""

    try:
        import bpy  # type: ignore
    except ImportError as exc:  # pragma: no cover - Blender-only entry point
        raise RuntimeError("review rendering must run inside Blender") from exc

    fit = camera_fit_for_bounds(plan.ground_bounds)

    rig_name = scene.name + "_RW_RENDER_RIG"
    rig = bpy.data.collections.get(rig_name)
    if rig is None:
        rig = bpy.data.collections.new(rig_name)
    for obj in list(rig.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for child in list(rig.children):
        rig.children.unlink(child)
    if scene.collection.children.get(rig.name) is None:
        scene.collection.children.link(rig)

    camera_data = bpy.data.cameras.new("RW_ReviewCamera")
    camera_data.type = "ORTHO"
    camera_data.sensor_fit = "HORIZONTAL"
    camera_data.ortho_scale = fit.ortho_scale_m
    camera_data.clip_start = 0.1
    camera_data.clip_end = max(500.0, fit.distance_m * 3.0)
    camera = bpy.data.objects.new("RW_ReviewCamera", camera_data)
    rig.objects.link(camera)
    camera.location = fit.location_xyz
    camera.rotation_euler = (
        math.radians(90.0 - fit.elevation_deg),
        0.0,
        0.0,
    )
    camera["target_xyz"] = fit.target_xyz
    camera["military_projection_elevation_deg"] = fit.elevation_deg
    scene.camera = camera

    sun_data = bpy.data.lights.new("RW_ReviewSun", "SUN")
    sun_data.energy = REVIEW_SUN_ENERGY
    sun_data.angle = math.radians(5.0)
    sun_data.color = (1.0, 0.93, 0.82)
    sun = bpy.data.objects.new("RW_ReviewSun", sun_data)
    rig.objects.link(sun)
    sun.rotation_euler = (
        math.radians(42.0),
        math.radians(-18.0),
        math.radians(-32.0),
    )

    scene.world = _review_world_background(bpy)
    scene.render.engine = "CYCLES"
    scene.cycles.samples = REVIEW_RENDER_SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"
    scene.render.use_persistent_data = True
    scene.render.resolution_x = REVIEW_RENDER_WIDTH_PX
    scene.render.resolution_y = REVIEW_RENDER_HEIGHT_PX
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = fit.pixel_aspect_x
    scene.render.pixel_aspect_y = fit.pixel_aspect_y
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15
    try:
        scene.view_settings.view_transform = "AgX"
    except (TypeError, ValueError):
        scene.view_settings.view_transform = "Filmic"
    for look in ("AgX - Medium High Contrast", "Medium High Contrast", "High Contrast"):
        try:
            scene.view_settings.look = look
            break
        except (TypeError, ValueError):
            continue
    scene.view_settings.exposure = REVIEW_EXPOSURE
    scene.view_settings.gamma = 1.0
    return scene, fit


def render_review_world(
    scene: Any,
    plan: WorldPlan,
    output_path: str | Path,
) -> Path:
    """Render an opaque 1280x960 Cycles CPU review PNG."""

    try:
        import bpy  # type: ignore
    except ImportError as exc:  # pragma: no cover - Blender-only entry point
        raise RuntimeError("review rendering must run inside Blender") from exc

    scene, fit = configure_review_render_scene(scene, plan)
    destination = Path(output_path).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(destination)
    scene["review_plan_sha256"] = plan_digest(plan)
    scene["review_ortho_scale_m"] = fit.ortho_scale_m
    scene["review_resolution"] = "%dx%d" % fit.resolution_px
    bpy.ops.render.render(write_still=True, scene=scene.name)
    return destination


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--collection-name", default=COLLECTION_NAME)
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--render", type=Path, help="Render a 1280x960 review PNG.")
    parser.add_argument(
        "--no-hex-overlay",
        action="store_true",
        help="Omit the faint engineering-review hex borders.",
    )
    parser.add_argument("--save-blend", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = _parse_args(argv)
    plan = build_world_plan(args.manifest)
    digest = plan_digest(plan)
    if args.plan_only:
        print(
            "REVIEW_WORLD PLAN OK scene=%s cells=%d road_samples=%d field_rows=%d "
            "crops=%d rotation=%d sha256=%s"
            % (
                plan.scene_id,
                len(plan.cells),
                len(plan.road.samples),
                plan.field.row_count,
                len(plan.field.crop_stalks),
                plan.rotation_deg,
                digest,
            )
        )
        return 0

    collection = build_blender_world(
        args.manifest,
        collection_name=args.collection_name,
        include_hex_overlay=not args.no_hex_overlay,
    )
    if args.render is not None:
        import bpy  # type: ignore

        render_scene = _isolated_render_scene(bpy, collection)
        rendered_path = render_review_world(
            render_scene, plan, args.render
        )
        print(
            "REVIEW_WORLD RENDER OK path=%s size=%dx%d samples=%d device=CPU"
            % (rendered_path, REVIEW_RENDER_WIDTH_PX,
               REVIEW_RENDER_HEIGHT_PX, REVIEW_RENDER_SAMPLES)
        )
    if args.save_blend is not None:
        import bpy  # type: ignore

        args.save_blend.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.save_blend.resolve()))
    print(
        "REVIEW_WORLD BUILD OK collection=%s objects=%d rotation=0 sha256=%s"
        % (collection.name, len(collection.objects), digest)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
