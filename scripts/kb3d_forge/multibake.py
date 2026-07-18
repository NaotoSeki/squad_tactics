"""Equal-scale, multi-hex sprite baking for KB3D collections.

The geometry remains one collection in one Blender scene.  Each occupied hex
is rendered by moving that same collection instance so the requested cell is
under the fixed HexKit camera.  This is the generalized form of the welded
two-hex crater technique in ``scripts/hex_ruins/gen_scar.py``.

Geometry and manifest helpers in this module intentionally work without
Blender.  The rendering entry point imports Blender lazily, which keeps the
grid rules unit-testable with the normal Python interpreter.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence


# HexKit's military-projection contract.  These values must stay in sync with
# hexbake_build.ensure_hexkit_rig and scripts/hex_ruins/rig_setup.py.
CAMERA_ELEVATION_DEG = 55.0
HEX_RADIUS_M = 9.0
ORTHO_SCALE_M = 20.25
RENDER_WIDTH_PX = 288
RENDER_HEIGHT_PX = 384
PIXEL_ASPECT_X = 1.0 / math.sin(math.radians(CAMERA_ELEVATION_DEG))
TARGET_Y_M = 3.0
CAMERA_DISTANCE_M = 60.0
ANCHOR_X_PX = 144.0
ANCHOR_Y_PX = 234.5
PX_PER_M = RENDER_WIDTH_PX / ORTHO_SCALE_M

EXACT_SCALE = 1.0
ALLOWED_ROTATIONS = (0, 60, 120, 180, 240, 300)
# Camera-visible geometry extends slightly beyond the logical hex so adjacent
# antialiased pieces overlap instead of exposing a one-pixel background seam.
CAMERA_HEX_CLIP_OVERLAP_M = 0.125
MANIFEST_SCHEMA = "squad-tactics.multibake/v1"

_SQRT3 = math.sqrt(3.0)
_GEOMETRY_EPSILON = 1.0e-9


@dataclass(frozen=True)
class AxialCell:
    """A pointy-top axial hex coordinate."""

    q: int
    r: int

    def __post_init__(self) -> None:
        if isinstance(self.q, bool) or not isinstance(self.q, int):
            raise TypeError("q must be an integer")
        if isinstance(self.r, bool) or not isinstance(self.r, int):
            raise TypeError("r must be an integer")


@dataclass(frozen=True)
class WorldBounds:
    """Axis-aligned world-space bounds, in meters."""

    min_x: float
    max_x: float
    min_y: float
    max_y: float
    min_z: float = 0.0
    max_z: float = 0.0

    def __post_init__(self) -> None:
        values = (
            self.min_x,
            self.max_x,
            self.min_y,
            self.max_y,
            self.min_z,
            self.max_z,
        )
        if not all(math.isfinite(float(value)) for value in values):
            raise ValueError("world bounds must contain only finite numbers")
        if self.min_x > self.max_x or self.min_y > self.max_y:
            raise ValueError("world bounds minimum must not exceed maximum")
        if self.min_z > self.max_z:
            raise ValueError("world z minimum must not exceed maximum")

    @classmethod
    def coerce(
        cls,
        value: "WorldBounds | Mapping[str, float] | Sequence[float]",
    ) -> "WorldBounds":
        if isinstance(value, cls):
            return value
        if isinstance(value, Mapping):
            return cls(
                float(value["min_x"]),
                float(value["max_x"]),
                float(value["min_y"]),
                float(value["max_y"]),
                float(value.get("min_z", 0.0)),
                float(value.get("max_z", 0.0)),
            )
        values = tuple(float(item) for item in value)
        if len(values) == 4:
            return cls(values[0], values[1], values[2], values[3])
        if len(values) == 6:
            return cls(*values)
        raise ValueError("world bounds must contain four or six values")

    @property
    def center_xy(self) -> tuple[float, float]:
        return ((self.min_x + self.max_x) * 0.5,
                (self.min_y + self.max_y) * 0.5)

    def expanded_xy(self, padding: float) -> "WorldBounds":
        padding = float(padding)
        if not math.isfinite(padding) or padding < 0.0:
            raise ValueError("padding must be a finite non-negative number")
        return WorldBounds(
            self.min_x - padding,
            self.max_x + padding,
            self.min_y - padding,
            self.max_y + padding,
            self.min_z,
            self.max_z,
        )


def require_unit_scale(scale: float | Sequence[float]) -> tuple[float, float, float]:
    """Return the canonical unit scale, rejecting every rescale request.

    Deliberately no tolerance is used: 0.999999 is a rescale and must fail.
    Authored transforms inside the source collection are left untouched; this
    rule applies to the multi-bake stage instance.
    """

    if isinstance(scale, bool):
        raise ValueError("multi-hex baking requires scale exactly 1.0")
    if isinstance(scale, (int, float)):
        values = (float(scale),) * 3
    else:
        values = tuple(float(value) for value in scale)
        if len(values) != 3:
            raise ValueError("scale must be one number or an xyz triple")
    if any(not math.isfinite(value) or value != EXACT_SCALE for value in values):
        raise ValueError("multi-hex baking forbids rescaling; scale must be exactly 1.0")
    return (EXACT_SCALE, EXACT_SCALE, EXACT_SCALE)


def validate_rotation(rotation_deg: int) -> int:
    if isinstance(rotation_deg, bool) or not isinstance(rotation_deg, int):
        raise ValueError("rotation must be an integer multiple of 60 degrees")
    normalized = rotation_deg % 360
    if normalized not in ALLOWED_ROTATIONS:
        raise ValueError("rotation must be one of 0, 60, 120, 180, 240, 300")
    return normalized


def axial_to_world(
    cell: AxialCell | Sequence[int],
    radius: float = HEX_RADIUS_M,
) -> tuple[float, float]:
    """Return a pointy-top cell center using the board's +r-down convention.

    Blender world Y therefore decreases as board/odd-r rows increase.
    """

    cell = _coerce_cell(cell)
    radius = _positive_radius(radius)
    x = _SQRT3 * radius * (cell.q + cell.r * 0.5)
    y = -1.5 * radius * cell.r
    return (x, y)


def world_to_axial(
    x: float,
    y: float,
    radius: float = HEX_RADIUS_M,
) -> AxialCell:
    """Round a world-space point to its nearest pointy-top axial cell."""

    radius = _positive_radius(radius)
    q_fractional = (_SQRT3 / 3.0 * float(x) + float(y) / 3.0) / radius
    r_fractional = (-2.0 / 3.0 * float(y)) / radius
    return _round_axial(q_fractional, r_fractional)


def rotate_axial(cell: AxialCell | Sequence[int], steps_ccw: int) -> AxialCell:
    """Rotate a cell around axial origin in 60-degree CCW steps."""

    cell = _coerce_cell(cell)
    if isinstance(steps_ccw, bool) or not isinstance(steps_ccw, int):
        raise TypeError("rotation steps must be an integer")
    q, r = cell.q, cell.r
    for _ in range(steps_ccw % 6):
        # With +r mapped to negative world Y, this inverse of the usual
        # y-up axial step remains a positive Blender-world CCW rotation.
        q, r = q + r, -q
    return AxialCell(q, r)


def hex_vertices(
    cell: AxialCell | Sequence[int],
    radius: float = HEX_RADIUS_M,
) -> tuple[tuple[float, float], ...]:
    """World-space vertices for a pointy-top hex."""

    center_x, center_y = axial_to_world(cell, radius)
    radius = _positive_radius(radius)
    return tuple(
        (
            center_x + radius * math.cos(math.radians(30.0 + 60.0 * index)),
            center_y + radius * math.sin(math.radians(30.0 + 60.0 * index)),
        )
        for index in range(6)
    )


def pointy_hex_clip_metrics(
    x: float,
    y: float,
    radius: float = HEX_RADIUS_M,
) -> tuple[float, float]:
    """Return the two pointy-top hex half-plane values for world XY.

    The metrics are compared with limits from pointy_hex_clip_limits.  Camera
    rays use a small overlap while logical ownership remains exact.  The same
    expressions and limits are assembled by _inject_camera_hex_clip.
    """

    radius = _positive_radius(radius)
    abs_x = abs(float(x))
    abs_y = abs(float(y))
    return (abs_x, abs_y + abs_x / _SQRT3)


def pointy_hex_clip_limits(
    radius: float = HEX_RADIUS_M,
    *,
    overlap: float = 0.0,
) -> tuple[float, float]:
    """Return horizontal and diagonal limits for a pointy-top hex test."""

    radius = _positive_radius(radius)
    overlap = float(overlap)
    if not math.isfinite(overlap) or overlap < 0.0:
        raise ValueError("hex clip overlap must be a finite non-negative number")
    return (_SQRT3 * radius * 0.5 + overlap, radius + overlap)


def point_in_pointy_hex(
    x: float,
    y: float,
    radius: float = HEX_RADIUS_M,
    *,
    overlap: float = 0.0,
) -> bool:
    """Return whether world XY lies inside a pointy hex and optional overlap."""

    radius = _positive_radius(radius)
    horizontal, diagonal = pointy_hex_clip_metrics(x, y, radius)
    horizontal_limit, diagonal_limit = pointy_hex_clip_limits(
        radius, overlap=overlap)
    return horizontal < horizontal_limit and diagonal < diagonal_limit


def point_in_camera_clip_hex(
    x: float,
    y: float,
    radius: float = HEX_RADIUS_M,
) -> bool:
    """Pure equivalent of the seam-safe camera-ray shader clip."""

    return point_in_pointy_hex(
        x,
        y,
        radius,
        overlap=CAMERA_HEX_CLIP_OVERLAP_M,
    )


def occupied_cells_from_bounds(
    bounds: WorldBounds | Mapping[str, float] | Sequence[float],
    *,
    radius: float = HEX_RADIUS_M,
    padding: float = 0.0,
) -> tuple[AxialCell, ...]:
    """Conservatively map a world-space AABB to intersected hex cells.

    The source mesh is intentionally not split.  Its world AABB is used as a
    cheap, deterministic occupancy envelope; every hex with positive-area
    overlap is returned in stable row-major order.  This may reserve harmless
    extra cells for concave assets, but never rescales or clips their geometry.
    """

    radius = _positive_radius(radius)
    bounds = WorldBounds.coerce(bounds).expanded_xy(padding)
    half_width = _SQRT3 * radius * 0.5
    row_step = 1.5 * radius
    column_step = _SQRT3 * radius

    # +r rows point toward negative Blender Y to match the board compositor.
    r_min = math.ceil(
        (-bounds.max_y - radius) / row_step - _GEOMETRY_EPSILON)
    r_max = math.floor(
        (-bounds.min_y + radius) / row_step + _GEOMETRY_EPSILON)
    rectangle = (
        (bounds.min_x, bounds.min_y),
        (bounds.max_x, bounds.min_y),
        (bounds.max_x, bounds.max_y),
        (bounds.min_x, bounds.max_y),
    )

    occupied: list[AxialCell] = []
    for r in range(r_min, r_max + 1):
        q_min = math.ceil(
            (bounds.min_x - half_width) / column_step - r * 0.5
            - _GEOMETRY_EPSILON
        )
        q_max = math.floor(
            (bounds.max_x + half_width) / column_step - r * 0.5
            + _GEOMETRY_EPSILON
        )
        for q in range(q_min, q_max + 1):
            cell = AxialCell(q, r)
            if _convex_polygons_overlap(rectangle, hex_vertices(cell, radius)):
                occupied.append(cell)

    if not occupied:
        # Degenerate bounds exactly on a shared edge have no positive-area
        # intersection.  They still need one deterministic owner cell.
        occupied.append(world_to_axial(*bounds.center_xy, radius=radius))
    return tuple(sorted(set(occupied), key=_cell_sort_key))


def stage_offset_for_cell(
    cell: AxialCell | Sequence[int],
    *,
    radius: float = HEX_RADIUS_M,
) -> tuple[float, float, float]:
    """Translation that moves a cell center onto the fixed camera anchor."""

    center_x, center_y = axial_to_world(cell, radius)
    return (-center_x, -center_y, 0.0)


def normalize_asset_id(asset_id: str) -> str:
    """Create a stable filesystem-safe identifier."""

    if not isinstance(asset_id, str) or not asset_id.strip():
        raise ValueError("asset id must be a non-empty string")
    slug = re.sub(r"[^a-z0-9]+", "_", asset_id.strip().lower()).strip("_")
    if not slug:
        raise ValueError("asset id must contain at least one ASCII letter or digit")
    return slug


def piece_filename(
    asset_id: str,
    cell: AxialCell | Sequence[int],
    *,
    rotation_deg: int = 0,
) -> str:
    """Return a deterministic PNG filename for one multi-hex piece."""

    cell = _coerce_cell(cell)
    rotation_deg = validate_rotation(rotation_deg)
    return "%s__q%s_r%s_rot%d.png" % (
        normalize_asset_id(asset_id),
        _signed_coordinate(cell.q),
        _signed_coordinate(cell.r),
        rotation_deg,
    )


def build_manifest_entry(
    asset_id: str,
    bounds: WorldBounds | Mapping[str, float] | Sequence[float],
    *,
    cells: Iterable[AxialCell | Sequence[int]] | None = None,
    rotation_deg: int = 0,
    scale: float | Sequence[float] = EXACT_SCALE,
    padding: float = 0.0,
) -> dict:
    """Build one deterministic catalog entry for an atomic multi-cell asset."""

    require_unit_scale(scale)
    rotation_deg = validate_rotation(rotation_deg)
    source_bounds = WorldBounds.coerce(bounds)
    if cells is None:
        source_cells = occupied_cells_from_bounds(source_bounds, padding=padding)
    else:
        source_cells = tuple(sorted({_coerce_cell(cell) for cell in cells},
                                    key=_cell_sort_key))
        if not source_cells:
            raise ValueError("a multi-bake manifest requires at least one cell")

    rotation_steps = rotation_deg // 60
    rotated_cells = tuple(sorted(
        {rotate_axial(cell, rotation_steps) for cell in source_cells},
        key=_cell_sort_key,
    ))
    base_cell = _choose_base_cell(rotated_cells, source_bounds, rotation_deg)
    slug = normalize_asset_id(asset_id)

    pieces = []
    for cell in rotated_cells:
        center_x, center_y = axial_to_world(cell)
        stage_x, stage_y, stage_z = stage_offset_for_cell(cell)
        pieces.append({
            "cell": {"q": cell.q, "r": cell.r},
            "offset": {
                "q": cell.q - base_cell.q,
                "r": cell.r - base_cell.r,
            },
            "q": cell.q,
            "r": cell.r,
            "center_world_m": [center_x, center_y],
            "stage_offset_m": [stage_x, stage_y, stage_z],
            "file": piece_filename(slug, cell, rotation_deg=rotation_deg),
        })

    return {
        "schema": MANIFEST_SCHEMA,
        "id": slug,
        "asset_id": slug,
        "kind": "multihex",
        "atomic": True,
        "world_scale": EXACT_SCALE,
        "scale": EXACT_SCALE,
        "rotation_deg": rotation_deg,
        "origin": {"q": base_cell.q, "r": base_cell.r},
        "base_cell": {"q": base_cell.q, "r": base_cell.r},
        "occupied_cells": [piece["cell"] for piece in pieces],
        "piece_count": len(pieces),
        "pieces": pieces,
        "source_bounds_world_m": {
            "min_x": source_bounds.min_x,
            "max_x": source_bounds.max_x,
            "min_y": source_bounds.min_y,
            "max_y": source_bounds.max_y,
            "min_z": source_bounds.min_z,
            "max_z": source_bounds.max_z,
        },
        "projection": {
            "camera_elevation_deg": CAMERA_ELEVATION_DEG,
            "hex_radius_m": HEX_RADIUS_M,
            "ortho_scale_m": ORTHO_SCALE_M,
            "resolution_px": [RENDER_WIDTH_PX, RENDER_HEIGHT_PX],
            "pixel_aspect_x": PIXEL_ASPECT_X,
            "anchor_px": [ANCHOR_X_PX, ANCHOR_Y_PX],
            "px_per_m": PX_PER_M,
        },
    }


def write_manifest(path: str | Path, entry: Mapping) -> Path:
    """Write stable JSON with no timestamp or other nondeterministic fields."""

    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(entry, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return output_path


def collection_world_bounds(collection) -> WorldBounds:
    """Measure Blender collection mesh bounds in world space."""

    bpy, Vector = _require_blender()
    del bpy  # The collection carries the objects; Vector performs transforms.
    points = []
    for obj in collection.all_objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))
    if not points:
        raise ValueError("collection contains no renderable mesh bounds")
    return WorldBounds(
        min(point.x for point in points),
        max(point.x for point in points),
        min(point.y for point in points),
        max(point.y for point in points),
        min(point.z for point in points),
        max(point.z for point in points),
    )


def render_collection_multibake(
    collection,
    *,
    asset_id: str,
    out_dir: str | Path,
    rotation_deg: int = 0,
    scale: float | Sequence[float] = EXACT_SCALE,
    padding: float = 0.0,
    with_shadow_catcher: bool = True,
    manifest_path: str | Path | None = None,
    dry_run: bool = False,
) -> dict:
    """Render one intact Blender collection once per occupied hex.

    Like ``gen_ground.stage_and_render``, each pass clears STAGE, instances the
    same unsplit source collection, and changes only rotation and translation.
    Scaling is hard-locked to one.  No geometry is duplicated or separated.
    """

    unit_scale = require_unit_scale(scale)
    rotation_deg = validate_rotation(rotation_deg)
    bpy, _Vector = _require_blender()

    # Import only inside Blender so all geometry/manifest helpers remain usable
    # under normal CPython.
    script_dir = str(Path(__file__).resolve().parent)
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    import hexbake_build  # type: ignore

    scene, stage = hexbake_build.ensure_hexkit_rig()
    _validate_hexkit_scene(scene)
    bpy.context.view_layer.update()
    bounds = collection_world_bounds(collection)
    entry = build_manifest_entry(
        asset_id,
        bounds,
        rotation_deg=rotation_deg,
        scale=unit_scale,
        padding=padding,
    )

    output_dir = Path(out_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if not dry_run:
        rig_shadow_catcher = bpy.data.objects.get("HK_ShadowCatcher")
        original_catcher_hidden = (
            rig_shadow_catcher.hide_render
            if rig_shadow_catcher is not None else None
        )
        if rig_shadow_catcher is not None:
            # The stock 60m square would be present in every piece.  A fresh
            # origin-hex catcher below gives each cell sole ownership of its
            # part of the continuous, full-building shadow.
            rig_shadow_catcher.hide_render = True

        try:
            with _temporary_camera_hex_clip(collection, bpy):
                for piece in entry["pieces"]:
                    _clear_stage(stage, bpy)
                    instance = bpy.data.objects.new("HK_MultiBakeInstance", None)
                    instance.empty_display_type = "PLAIN_AXES"
                    instance.instance_type = "COLLECTION"
                    instance.instance_collection = collection
                    instance.scale = unit_scale
                    # Guard against later edits reintroducing fit-to-cell.
                    require_unit_scale(tuple(instance.scale))
                    instance.rotation_euler = (
                        0.0, 0.0, math.radians(rotation_deg))
                    instance.location = tuple(piece["stage_offset_m"])
                    stage.objects.link(instance)
                    if with_shadow_catcher:
                        _create_hex_shadow_catcher(stage, bpy)
                    bpy.context.view_layer.update()

                    scene.render.filepath = str(output_dir / piece["file"])
                    bpy.ops.render.render(write_still=True, scene=scene.name)
        finally:
            _clear_stage(stage, bpy)
            if rig_shadow_catcher is not None:
                rig_shadow_catcher.hide_render = original_catcher_hidden

    if manifest_path is None:
        manifest_path = output_dir / (entry["asset_id"] + ".multibake.json")
    write_manifest(manifest_path, entry)
    return entry


def _parse_blender_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    if argv is None:
        argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--collection",
        default="FORGE_OUT",
        help="Existing Blender collection to render (default: FORGE_OUT)",
    )
    parser.add_argument(
        "--recipe",
        help="Optional Forge recipe to build before measuring and baking",
    )
    parser.add_argument(
        "--catalog",
        help="Parts catalog used with --recipe (defaults to paths.py)",
    )
    parser.add_argument(
        "--skip-ground",
        action="store_true",
        help="Omit the source template ground when building --recipe",
    )
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--manifest")
    parser.add_argument("--rotation", type=int, default=0)
    parser.add_argument("--scale", type=float, default=EXACT_SCALE,
                        help="Must be exactly 1.0; any other value is rejected")
    parser.add_argument("--padding", type=float, default=0.0)
    parser.add_argument("--no-shadow-catcher", action="store_true")
    parser.add_argument("--dry-run", action="store_true",
                        help="Measure and write the manifest without rendering")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_blender_args(argv)
    require_unit_scale(args.scale)
    bpy, _Vector = _require_blender()

    if args.recipe:
        script_dir = str(Path(__file__).resolve().parent)
        if script_dir not in sys.path:
            sys.path.insert(0, script_dir)
        import forge_build  # type: ignore
        from paths import DEFAULT_CATALOG_OUT  # type: ignore

        recipe_path = Path(args.recipe)
        catalog_path = Path(args.catalog) if args.catalog else DEFAULT_CATALOG_OUT
        with recipe_path.open("r", encoding="utf-8") as handle:
            recipe = json.load(handle)
        with Path(catalog_path).open("r", encoding="utf-8") as handle:
            catalog = json.load(handle)
        result = forge_build.build_scene(
            recipe,
            catalog,
            skip_ground=bool(args.skip_ground),
        )
        if not result["verify_ok"]:
            raise RuntimeError("Forge recipe failed verification before multibake")
        collection = result["out_col"]
    else:
        collection = bpy.data.collections.get(args.collection)
        if collection is None:
            raise ValueError("Blender collection not found: %s" % args.collection)

    entry = render_collection_multibake(
        collection,
        asset_id=args.asset_id,
        out_dir=args.out_dir,
        rotation_deg=args.rotation,
        scale=args.scale,
        padding=args.padding,
        with_shadow_catcher=not args.no_shadow_catcher,
        manifest_path=args.manifest,
        dry_run=args.dry_run,
    )
    print("MULTIBAKE OK asset=%s cells=%d scale=1.000 dry_run=%s" % (
        entry["asset_id"], entry["piece_count"], bool(args.dry_run)))
    return 0


def _coerce_cell(cell: AxialCell | Sequence[int]) -> AxialCell:
    if isinstance(cell, AxialCell):
        return cell
    values = tuple(cell)
    if len(values) != 2:
        raise ValueError("axial cell must contain q and r")
    return AxialCell(values[0], values[1])


def _positive_radius(radius: float) -> float:
    radius = float(radius)
    if not math.isfinite(radius) or radius <= 0.0:
        raise ValueError("hex radius must be a finite positive number")
    return radius


def _round_axial(q_fractional: float, r_fractional: float) -> AxialCell:
    cube_x = q_fractional
    cube_z = r_fractional
    cube_y = -cube_x - cube_z
    rounded_x = round(cube_x)
    rounded_y = round(cube_y)
    rounded_z = round(cube_z)
    x_error = abs(rounded_x - cube_x)
    y_error = abs(rounded_y - cube_y)
    z_error = abs(rounded_z - cube_z)
    if x_error > y_error and x_error > z_error:
        rounded_x = -rounded_y - rounded_z
    elif y_error > z_error:
        rounded_y = -rounded_x - rounded_z
    else:
        rounded_z = -rounded_x - rounded_y
    return AxialCell(int(rounded_x), int(rounded_z))


def _cell_sort_key(cell: AxialCell) -> tuple[int, int]:
    return (cell.r, cell.q)


def _convex_polygons_overlap(
    polygon_a: Sequence[tuple[float, float]],
    polygon_b: Sequence[tuple[float, float]],
) -> bool:
    """Separating-axis test; edge-only contact is not occupancy."""

    axes = [(1.0, 0.0), (0.0, 1.0)]
    for polygon in (polygon_a, polygon_b):
        for index, point in enumerate(polygon):
            next_point = polygon[(index + 1) % len(polygon)]
            edge_x = next_point[0] - point[0]
            edge_y = next_point[1] - point[1]
            if abs(edge_x) <= _GEOMETRY_EPSILON and abs(edge_y) <= _GEOMETRY_EPSILON:
                continue
            axes.append((-edge_y, edge_x))

    for axis_x, axis_y in axes:
        projection_a = [x * axis_x + y * axis_y for x, y in polygon_a]
        projection_b = [x * axis_x + y * axis_y for x, y in polygon_b]
        if (max(projection_a) <= min(projection_b) + _GEOMETRY_EPSILON
                or max(projection_b) <= min(projection_a) + _GEOMETRY_EPSILON):
            return False
    return True


def _signed_coordinate(value: int) -> str:
    return ("p" if value >= 0 else "m") + ("%03d" % abs(value))


def _choose_base_cell(
    cells: Sequence[AxialCell],
    bounds: WorldBounds,
    rotation_deg: int,
) -> AxialCell:
    center_x, center_y = bounds.center_xy
    angle = math.radians(rotation_deg)
    rotated_center = (
        center_x * math.cos(angle) - center_y * math.sin(angle),
        center_x * math.sin(angle) + center_y * math.cos(angle),
    )
    preferred = world_to_axial(*rotated_center)
    if preferred in cells:
        return preferred
    return min(
        cells,
        key=lambda cell: (
            (axial_to_world(cell)[0] - rotated_center[0]) ** 2
            + (axial_to_world(cell)[1] - rotated_center[1]) ** 2,
            cell.r,
            cell.q,
        ),
    )


@contextmanager
def _temporary_camera_hex_clip(collection, bpy):
    """Override source slots with clipped material copies, then restore them.

    Only camera rays are made transparent outside the origin hex.  Shadow and
    other non-camera rays continue to see the original shader, so the intact
    equal-scale building casts one continuous shadow.  Source material node
    trees are never edited: every injected tree belongs to a temporary copy.
    """

    material_cache = {}
    copied_materials = []
    slot_states = []
    try:
        for obj in collection.all_objects:
            if obj.type != "MESH" or obj.hide_render:
                continue
            if not obj.material_slots:
                raise RuntimeError(
                    "cannot hex-clip materialless mesh: %s" % obj.name)
            for slot in obj.material_slots:
                original_material = slot.material
                if original_material is None:
                    raise RuntimeError(
                        "cannot hex-clip empty material slot: %s" % obj.name)
                key = original_material.as_pointer()
                clipped_material = material_cache.get(key)
                if clipped_material is None:
                    clipped_material = _make_camera_clipped_material(
                        original_material, bpy)
                    material_cache[key] = clipped_material
                    copied_materials.append(clipped_material)

                slot_states.append((slot, slot.link, original_material))
                # Object-link overrides avoid touching shared mesh-data slots.
                slot.link = "OBJECT"
                slot.material = clipped_material
        bpy.context.view_layer.update()
        yield
    finally:
        for slot, original_link, original_material in reversed(slot_states):
            # Reset the temporary object override before restoring DATA link.
            slot.link = "OBJECT"
            slot.material = original_material
            slot.link = original_link
        bpy.context.view_layer.update()
        for material in copied_materials:
            if material.users == 0:
                bpy.data.materials.remove(material)


def _make_camera_clipped_material(original_material, bpy):
    clipped = original_material.copy()
    clipped.name = "MULTIBAKE_CLIP__" + original_material.name
    if not clipped.use_nodes:
        clipped.use_nodes = True
        principled = clipped.node_tree.nodes.get("Principled BSDF")
        if principled is not None:
            principled.inputs["Base Color"].default_value = tuple(
                original_material.diffuse_color)
    _inject_camera_hex_clip(clipped, bpy)
    return clipped


def _inject_camera_hex_clip(material, bpy, radius=HEX_RADIUS_M):
    """Add the pure-function pointy-hex test to a copied material tree."""

    del bpy  # Kept explicit in the signature to mark this as Blender-only.
    radius = _positive_radius(radius)
    horizontal_limit, diagonal_limit = pointy_hex_clip_limits(
        radius, overlap=CAMERA_HEX_CLIP_OVERLAP_M)
    node_tree = material.node_tree
    if node_tree is None:
        raise RuntimeError("material has no node tree: %s" % material.name)
    nodes = node_tree.nodes
    links = node_tree.links

    outputs = [node for node in nodes if node.type == "OUTPUT_MATERIAL"]
    output = next(
        (node for node in outputs if getattr(node, "is_active_output", False)),
        outputs[0] if outputs else None,
    )
    if output is None:
        output = nodes.new("ShaderNodeOutputMaterial")
    surface = output.inputs.get("Surface")
    if surface is None:
        raise RuntimeError("material output has no Surface input: %s" % material.name)

    original_socket = surface.links[0].from_socket if surface.links else None
    for link in list(surface.links):
        links.remove(link)
    if original_socket is None:
        principled = nodes.new("ShaderNodeBsdfPrincipled")
        principled.name = "MULTIBAKE_OriginalSurface"
        principled.inputs["Base Color"].default_value = tuple(
            material.diffuse_color)
        original_socket = principled.outputs["BSDF"]

    geometry = nodes.new("ShaderNodeNewGeometry")
    geometry.name = "MULTIBAKE_WorldPosition"
    separate = nodes.new("ShaderNodeSeparateXYZ")
    separate.name = "MULTIBAKE_PositionXY"
    links.new(geometry.outputs["Position"], separate.inputs["Vector"])

    abs_x = nodes.new("ShaderNodeMath")
    abs_x.name = "MULTIBAKE_AbsX"
    abs_x.operation = "ABSOLUTE"
    links.new(separate.outputs["X"], abs_x.inputs[0])
    abs_y = nodes.new("ShaderNodeMath")
    abs_y.name = "MULTIBAKE_AbsY"
    abs_y.operation = "ABSOLUTE"
    links.new(separate.outputs["Y"], abs_y.inputs[0])

    horizontal_test = nodes.new("ShaderNodeMath")
    horizontal_test.name = "MULTIBAKE_HorizontalInside"
    horizontal_test.operation = "LESS_THAN"
    horizontal_test.inputs[1].default_value = horizontal_limit
    links.new(abs_x.outputs[0], horizontal_test.inputs[0])

    scaled_x = nodes.new("ShaderNodeMath")
    scaled_x.name = "MULTIBAKE_AbsXOverSqrt3"
    scaled_x.operation = "MULTIPLY"
    scaled_x.inputs[1].default_value = 1.0 / _SQRT3
    links.new(abs_x.outputs[0], scaled_x.inputs[0])
    diagonal = nodes.new("ShaderNodeMath")
    diagonal.name = "MULTIBAKE_DiagonalMetric"
    diagonal.operation = "ADD"
    links.new(abs_y.outputs[0], diagonal.inputs[0])
    links.new(scaled_x.outputs[0], diagonal.inputs[1])
    diagonal_test = nodes.new("ShaderNodeMath")
    diagonal_test.name = "MULTIBAKE_DiagonalInside"
    diagonal_test.operation = "LESS_THAN"
    diagonal_test.inputs[1].default_value = diagonal_limit
    links.new(diagonal.outputs[0], diagonal_test.inputs[0])

    inside = nodes.new("ShaderNodeMath")
    inside.name = "MULTIBAKE_InsideHex"
    inside.operation = "MULTIPLY"
    links.new(horizontal_test.outputs[0], inside.inputs[0])
    links.new(diagonal_test.outputs[0], inside.inputs[1])
    outside = nodes.new("ShaderNodeMath")
    outside.name = "MULTIBAKE_OutsideHex"
    outside.operation = "SUBTRACT"
    outside.inputs[0].default_value = 1.0
    links.new(inside.outputs[0], outside.inputs[1])

    light_path = nodes.new("ShaderNodeLightPath")
    light_path.name = "MULTIBAKE_LightPath"
    camera_outside = nodes.new("ShaderNodeMath")
    camera_outside.name = "MULTIBAKE_CameraOutsideHex"
    camera_outside.operation = "MULTIPLY"
    links.new(light_path.outputs["Is Camera Ray"], camera_outside.inputs[0])
    links.new(outside.outputs[0], camera_outside.inputs[1])

    transparent = nodes.new("ShaderNodeBsdfTransparent")
    transparent.name = "MULTIBAKE_OutsideTransparent"
    mix = nodes.new("ShaderNodeMixShader")
    mix.name = "MULTIBAKE_CameraHexClip"
    links.new(camera_outside.outputs[0], mix.inputs[0])
    links.new(original_socket, mix.inputs[1])
    links.new(transparent.outputs["BSDF"], mix.inputs[2])
    links.new(mix.outputs["Shader"], surface)


def _create_hex_shadow_catcher(stage, bpy, radius=HEX_RADIUS_M):
    """Create one exact origin-hex catcher for the current render pass."""

    radius = _positive_radius(radius)
    mesh = bpy.data.meshes.new("HK_MultiBakeShadowHexMesh")
    vertices = [
        (
            radius * math.cos(math.radians(30.0 + 60.0 * index)),
            radius * math.sin(math.radians(30.0 + 60.0 * index)),
            0.0,
        )
        for index in range(6)
    ]
    mesh.from_pydata(vertices, [], [tuple(range(6))])
    mesh.update()
    catcher = bpy.data.objects.new("HK_MultiBakeShadowCatcher", mesh)
    catcher["multibake_temporary_mesh"] = True
    catcher.is_shadow_catcher = True
    catcher.hide_render = False
    stage.objects.link(catcher)
    return catcher


def _require_blender():
    try:
        import bpy  # type: ignore
        from mathutils import Vector  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "Blender runtime required for collection measurement or rendering"
        ) from exc
    return bpy, Vector


def _validate_hexkit_scene(scene) -> None:
    camera = scene.camera
    if camera is None or camera.type != "CAMERA" or camera.data.type != "ORTHO":
        raise RuntimeError("HexKit requires an orthographic camera")
    checks = (
        (float(camera.data.ortho_scale), ORTHO_SCALE_M, "ortho scale"),
        (float(scene.render.pixel_aspect_x), PIXEL_ASPECT_X, "pixel aspect x"),
    )
    for actual, expected, label in checks:
        if not math.isclose(actual, expected, rel_tol=0.0, abs_tol=1.0e-6):
            raise RuntimeError("HexKit %s mismatch: %r != %r" %
                               (label, actual, expected))
    if (scene.render.resolution_x != RENDER_WIDTH_PX
            or scene.render.resolution_y != RENDER_HEIGHT_PX):
        raise RuntimeError("HexKit resolution must be 288x384")


def _clear_stage(stage, bpy) -> None:
    for obj in list(stage.objects):
        temporary_mesh = (
            obj.data
            if obj.type == "MESH" and obj.get("multibake_temporary_mesh")
            else None
        )
        bpy.data.objects.remove(obj, do_unlink=True)
        if temporary_mesh is not None and temporary_mesh.users == 0:
            bpy.data.meshes.remove(temporary_mesh)


if __name__ == "__main__":
    raise SystemExit(main())
