# -*- coding: utf-8 -*-
"""Validate and expose the deterministic Round-1 review-scene manifest.

This module deliberately does not render art.  It defines the stable semantic
contract that a later compositor must consume: one fixed 5x6 pointy-top grid,
world-space features that may cross hex boundaries, and Grade A presentation.
"""

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path


DEFAULT_MANIFEST = Path(__file__).with_name("review_scene_round1.json")
STABLE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
CELL_ID_RE = re.compile(r"^cell_r(?P<row>\d{2})_c(?P<col>\d{2})$")
AXIAL_NEIGHBORS = {
    (1, 0),
    (1, -1),
    (0, -1),
    (-1, 0),
    (-1, 1),
    (0, 1),
}


class ManifestValidationError(ValueError):
    """Raised when a review-scene manifest violates the fixed contract."""

    def __init__(self, errors):
        self.errors = tuple(errors)
        super().__init__("; ".join(self.errors))


def load_manifest(path=DEFAULT_MANIFEST):
    """Load a manifest without mutating or normalizing its authored values."""

    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def canonical_digest(manifest):
    """Return a repeatable digest for review hand-offs and compositor logs."""

    payload = json.dumps(
        manifest,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def odd_r_to_axial(col, row):
    """Convert pointy-top odd-r offset coordinates to axial coordinates."""

    return col - ((row - (row & 1)) // 2), row


def world_center_m(q, r, radius_m):
    """Return the canonical pointy-top axial center in world metres."""

    return (
        math.sqrt(3.0) * radius_m * (q + r * 0.5),
        1.5 * radius_m * r,
    )


def are_axial_neighbors(left, right):
    return (right[0] - left[0], right[1] - left[1]) in AXIAL_NEIGHBORS


def _append(errors, condition, message):
    if not condition:
        errors.append(message)


def _stable_unique_ids(items, label, errors):
    seen = set()
    for index, item in enumerate(items):
        item_id = item.get("id") if isinstance(item, dict) else None
        path = "%s[%d].id" % (label, index)
        _append(
            errors,
            isinstance(item_id, str) and bool(STABLE_ID_RE.match(item_id)),
            "%s must be a stable lowercase ID" % path,
        )
        if isinstance(item_id, str):
            _append(errors, item_id not in seen, "%s duplicates %s" % (path, item_id))
            seen.add(item_id)
    return seen


def _cell_references(value, path="manifest"):
    """Yield (path, cell_id) pairs from the compositor-facing reference keys."""

    if isinstance(value, dict):
        for key, child in value.items():
            child_path = "%s.%s" % (path, key)
            if key in ("anchor_cell",):
                yield child_path, child
            elif key in ("cells", "cell_path", "control_cells"):
                if isinstance(child, list):
                    for index, cell_id in enumerate(child):
                        yield "%s[%d]" % (child_path, index), cell_id
                else:
                    yield child_path, child
            else:
                yield from _cell_references(child, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _cell_references(child, "%s[%d]" % (path, index))


def _connected_cells(cell_ids, cell_lookup):
    if not cell_ids or any(cell_id not in cell_lookup for cell_id in cell_ids):
        return False

    remaining = set(cell_ids)
    visited = {next(iter(remaining))}
    frontier = list(visited)
    remaining -= visited

    while frontier:
        current = frontier.pop()
        current_axial = (cell_lookup[current]["q"], cell_lookup[current]["r"])
        linked = []
        for candidate in remaining:
            candidate_axial = (
                cell_lookup[candidate]["q"],
                cell_lookup[candidate]["r"],
            )
            if are_axial_neighbors(current_axial, candidate_axial):
                linked.append(candidate)
        for candidate in linked:
            remaining.remove(candidate)
            visited.add(candidate)
            frontier.append(candidate)

    return not remaining


def _path_is_continuous(cell_ids, cell_lookup):
    if len(cell_ids) < 2 or len(cell_ids) != len(set(cell_ids)):
        return False
    if any(cell_id not in cell_lookup for cell_id in cell_ids):
        return False

    for left_id, right_id in zip(cell_ids, cell_ids[1:]):
        left = cell_lookup[left_id]
        right = cell_lookup[right_id]
        if not are_axial_neighbors((left["q"], left["r"]), (right["q"], right["r"])):
            return False
    return True


def _compressed_horizontal_signs(cell_ids, cell_lookup):
    signs = []
    for left_id, right_id in zip(cell_ids, cell_ids[1:]):
        if left_id not in cell_lookup or right_id not in cell_lookup:
            continue
        delta = cell_lookup[right_id]["col"] - cell_lookup[left_id]["col"]
        if delta == 0:
            continue
        sign = 1 if delta > 0 else -1
        if not signs or signs[-1] != sign:
            signs.append(sign)
    return signs


def _one_feature(features, predicate, label, errors):
    matches = [feature for feature in features if predicate(feature)]
    _append(errors, len(matches) == 1, "expected exactly one %s feature" % label)
    return matches[0] if len(matches) == 1 else None


def _validate_multihex(feature, role, cell_lookup, errors):
    if feature is None:
        return
    prefix = feature.get("id", role)
    cells = feature.get("cells", [])
    _append(errors, len(cells) in (6, 7), "%s must occupy 6-7 cells" % prefix)
    _append(errors, len(cells) == len(set(cells)), "%s footprint repeats cells" % prefix)
    _append(errors, _connected_cells(cells, cell_lookup), "%s footprint is disconnected" % prefix)
    _append(errors, feature.get("anchor_cell") in cells, "%s anchor must be inside its footprint" % prefix)
    _append(errors, feature.get("scale") == 1.0, "%s must remain at exact scale 1.0" % prefix)
    _append(errors, feature.get("fit_to_cell") is False, "%s must forbid fit-to-cell scaling" % prefix)
    _append(
        errors,
        feature.get("placement_mode") == "world_space_then_hex_clip",
        "%s must be composed in world space before hex clipping" % prefix,
    )


def validate_manifest(manifest):
    """Return a deterministic list of contract violations; empty means valid."""

    errors = []
    if not isinstance(manifest, dict):
        return ["manifest root must be an object"]

    _append(errors, manifest.get("schema_version") == 1, "schema_version must be 1")
    _append(
        errors,
        isinstance(manifest.get("scene_id"), str)
        and bool(STABLE_ID_RE.match(manifest["scene_id"])),
        "scene_id must be a stable lowercase ID",
    )

    determinism = manifest.get("determinism", {})
    _append(
        errors,
        determinism.get("random_placement") is False,
        "determinism.random_placement must be false",
    )
    _append(errors, determinism.get("seed") is None, "determinism.seed must be null")
    _append(
        errors,
        determinism.get("asset_rotation_policy") == "rot0_only",
        "determinism.asset_rotation_policy must be rot0_only",
    )
    _append(
        errors,
        determinism.get("content_variation_between_presentations") is False,
        "presentations must not vary scene content",
    )

    grade = manifest.get("grade", {})
    _append(errors, grade.get("profile_id") == "A", "Round-1 grade must be A")
    _append(
        errors,
        grade.get("required_for_all_presentations") is True,
        "Grade A must be required for every presentation",
    )

    grid = manifest.get("grid", {})
    columns = grid.get("columns")
    rows = grid.get("rows")
    cells = grid.get("cells") if isinstance(grid.get("cells"), list) else []
    _append(errors, grid.get("orientation") == "pointy_top", "grid must be pointy_top")
    _append(
        errors,
        grid.get("coordinate_system") == "odd_r_offset_with_axial",
        "grid coordinate_system must be odd_r_offset_with_axial",
    )
    _append(errors, columns == 5 and rows == 6, "grid must be exactly 5x6")
    _append(errors, grid.get("cell_count") == 30, "grid.cell_count must be 30")
    _append(errors, len(cells) == 30, "grid.cells must contain exactly 30 cells")
    radius_m = grid.get("hex_radius_m")
    _append(
        errors,
        isinstance(radius_m, (int, float)) and radius_m > 0,
        "grid.hex_radius_m must be positive",
    )

    cell_ids = _stable_unique_ids(cells, "grid.cells", errors)
    cell_lookup = {
        cell.get("id"): cell
        for cell in cells
        if isinstance(cell, dict) and isinstance(cell.get("id"), str)
    }
    authored_coordinates = set()
    for index, cell in enumerate(cells):
        if not isinstance(cell, dict):
            errors.append("grid.cells[%d] must be an object" % index)
            continue
        col = cell.get("col")
        row = cell.get("row")
        cell_id = cell.get("id")
        in_bounds = (
            isinstance(col, int)
            and isinstance(row, int)
            and isinstance(columns, int)
            and isinstance(rows, int)
            and 0 <= col < columns
            and 0 <= row < rows
        )
        _append(errors, in_bounds, "grid.cells[%d] is out of bounds" % index)
        if not in_bounds:
            continue
        authored_coordinates.add((col, row))
        expected_id = "cell_r%02d_c%02d" % (row, col)
        _append(errors, cell_id == expected_id, "%s must use stable ID %s" % (cell_id, expected_id))
        expected_q, expected_r = odd_r_to_axial(col, row)
        _append(
            errors,
            cell.get("q") == expected_q and cell.get("r") == expected_r,
            "%s has inconsistent axial coordinates" % expected_id,
        )
        center = cell.get("world_center_m")
        if isinstance(radius_m, (int, float)) and radius_m > 0:
            expected_center = world_center_m(expected_q, expected_r, radius_m)
            center_ok = (
                isinstance(center, list)
                and len(center) == 2
                and all(isinstance(value, (int, float)) for value in center)
                and abs(center[0] - expected_center[0]) <= 1e-5
                and abs(center[1] - expected_center[1]) <= 1e-5
            )
            _append(errors, center_ok, "%s has inconsistent world_center_m" % expected_id)

    if columns == 5 and rows == 6:
        expected_coordinates = {(col, row) for row in range(rows) for col in range(columns)}
        _append(
            errors,
            authored_coordinates == expected_coordinates,
            "grid.cells must cover every 5x6 coordinate exactly once",
        )

    features = manifest.get("features")
    if not isinstance(features, list):
        errors.append("features must be a list")
        features = []
    feature_ids = _stable_unique_ids(features, "features", errors)
    feature_lookup = {
        feature.get("id"): feature
        for feature in features
        if isinstance(feature, dict) and isinstance(feature.get("id"), str)
    }

    for path, cell_id in _cell_references(features, "features"):
        _append(
            errors,
            isinstance(cell_id, str) and cell_id in cell_ids,
            "%s references unknown cell %r" % (path, cell_id),
        )
    for feature in features:
        if not isinstance(feature, dict):
            continue
        if "asset_rotation_deg" in feature:
            _append(
                errors,
                feature.get("asset_rotation_deg") == 0,
                "%s must use asset rotation 0" % feature.get("id", "feature"),
            )

    road = _one_feature(
        features,
        lambda feature: feature.get("type") == "road_spline",
        "road_spline",
        errors,
    )
    road_cells = set()
    if road is not None:
        road_path = road.get("cell_path", [])
        road_cells = set(road_path)
        _append(errors, road.get("shape") == "s_curve", "main road must declare s_curve shape")
        _append(errors, _path_is_continuous(road_path, cell_lookup), "main road path must be connected and non-repeating")
        path_rows = {cell_lookup[cell_id]["row"] for cell_id in road_path if cell_id in cell_lookup}
        _append(errors, 0 in path_rows and 5 in path_rows, "main road must cross from the top to bottom row")
        signs = _compressed_horizontal_signs(road_path, cell_lookup)
        _append(
            errors,
            len(signs) >= 3 and signs[0] == signs[2] and signs[0] != signs[1],
            "main road must reverse horizontal direction twice to form an S",
        )
        _append(
            errors,
            road.get("placement_mode") == "world_spline_then_hex_clip",
            "main road must be rasterized as one world spline before clipping",
        )
        surface = road.get("surface", {})
        _append(errors, surface.get("align_to_hex_edges") is False, "main road must not align to hex edges")
        _append(errors, surface.get("organic_edges") is True, "main road must use organic edges")

    camp = _one_feature(
        features,
        lambda feature: feature.get("type") == "multihex_cluster" and feature.get("role") == "camp",
        "camp multihex cluster",
        errors,
    )
    farm = _one_feature(
        features,
        lambda feature: feature.get("type") == "multihex_cluster" and feature.get("role") == "farmstead",
        "farmstead multihex cluster",
        errors,
    )
    _validate_multihex(camp, "camp", cell_lookup, errors)
    _validate_multihex(farm, "farmstead", cell_lookup, errors)

    field = _one_feature(
        features,
        lambda feature: feature.get("type") == "raised_field_parcel",
        "raised_field_parcel",
        errors,
    )
    field_cells = set()
    if field is not None:
        field_cells = set(field.get("cells", []))
        _append(errors, len(field_cells) in (5, 6), "raised field must occupy 5-6 cells")
        _append(errors, _connected_cells(field_cells, cell_lookup), "raised field footprint is disconnected")
        _append(errors, field.get("raised_rows") is True, "field rows must have physical elevation")
        _append(errors, field.get("include_crop_stocks") is True, "field rows must include crop stocks")
        _append(errors, field.get("hard_hex_edges") is False, "field parcel must not expose hard hex edges")

    hedgerow = _one_feature(
        features,
        lambda feature: feature.get("type") == "hedgerow_wood_edge",
        "hedgerow_wood_edge",
        errors,
    )
    if hedgerow is not None:
        hedge_path = hedgerow.get("cell_path", [])
        _append(errors, len(hedge_path) == 4, "hedgerow/wood edge must occupy 4 cells")
        _append(errors, _path_is_continuous(hedge_path, cell_lookup), "hedgerow/wood edge must be connected")
        _append(errors, hedgerow.get("align_to_hex_edges") is False, "hedgerow must not align to hex edges")

    road_crater = _one_feature(
        features,
        lambda feature: feature.get("type") == "contextual_crater" and feature.get("context") == "road",
        "road contextual crater",
        errors,
    )
    if road_crater is not None:
        _append(errors, road_crater.get("anchor_cell") in road_cells, "road crater must intersect the road")
        _append(errors, road_crater.get("shape") == "asymmetric", "road crater must be asymmetric")
        _append(
            errors,
            road_crater.get("preserve_underlying_context") is True,
            "road crater must preserve readable road context",
        )

    field_crater = _one_feature(
        features,
        lambda feature: feature.get("type") == "contextual_crater" and feature.get("context") == "field",
        "field contextual crater",
        errors,
    )
    if field_crater is not None:
        _append(errors, field_crater.get("anchor_cell") in field_cells, "field crater must intersect the field")
        _append(errors, field_crater.get("shape") == "asymmetric", "field crater must be asymmetric")
        _append(
            errors,
            field_crater.get("preserve_underlying_context") is True,
            "field crater must preserve readable field-row context",
        )

    vignettes = [
        feature for feature in features if feature.get("type") == "contextual_vignette"
    ]
    _append(errors, len(vignettes) >= 2, "Round-1 requires at least two contextual vignettes")
    for vignette in vignettes:
        vignette_id = vignette.get("id", "vignette")
        context_id = vignette.get("context_feature_id")
        context = feature_lookup.get(context_id)
        _append(errors, context_id in feature_ids, "%s has unknown context feature" % vignette_id)
        if context is not None:
            _append(
                errors,
                vignette.get("anchor_cell") in context.get("cells", []),
                "%s must be anchored inside its context footprint" % vignette_id,
            )

    compositor = manifest.get("compositor_contract", {})
    _append(
        errors,
        compositor.get("multihex_features_are_atomic") is True,
        "compositor must place multihex features atomically",
    )
    _append(
        errors,
        compositor.get("render_world_features_before_hex_clipping") is True,
        "compositor must render world features before clipping",
    )
    _append(
        errors,
        compositor.get("forbid_per_cell_fit_scaling") is True,
        "compositor must forbid per-cell fit scaling",
    )

    presentations = manifest.get("presentations")
    if not isinstance(presentations, list):
        errors.append("presentations must be a list")
        presentations = []
    _stable_unique_ids(presentations, "presentations", errors)
    _append(errors, len(presentations) == 3, "Round-1 must define clean, faint-hex, and labeled presentations")
    for presentation in presentations:
        _append(
            errors,
            presentation.get("grade_profile_id") == "A",
            "%s must use Grade A" % presentation.get("id", "presentation"),
        )

    return errors


def validate_or_raise(manifest):
    errors = validate_manifest(manifest)
    if errors:
        raise ManifestValidationError(errors)
    return manifest


def summary(manifest):
    road = next(
        feature for feature in manifest["features"] if feature["type"] == "road_spline"
    )
    return {
        "scene_id": manifest["scene_id"],
        "cells": len(manifest["grid"]["cells"]),
        "features": len(manifest["features"]),
        "road_cells": len(road["cell_path"]),
        "grade": manifest["grade"]["profile_id"],
        "sha256": canonical_digest(manifest),
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--print-manifest",
        action="store_true",
        help="Print the validated compositor manifest as JSON.",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    try:
        manifest = load_manifest(args.manifest)
        validate_or_raise(manifest)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("REVIEW_SCENE FAIL %s" % exc)
        return 2

    if args.print_manifest:
        print(json.dumps(manifest, indent=2, ensure_ascii=False))
    result = summary(manifest)
    print(
        "REVIEW_SCENE OK scene=%s cells=%d features=%d road_cells=%d grade=%s sha256=%s"
        % (
            result["scene_id"],
            result["cells"],
            result["features"],
            result["road_cells"],
            result["grade"],
            result["sha256"],
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
