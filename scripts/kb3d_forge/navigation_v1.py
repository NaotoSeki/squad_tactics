#!/usr/bin/env python3
"""
Navigation v1 validator and serializer for Squad Tactics.

Usage:
  python scripts/kb3d_forge/navigation_v1.py <file.json>

Exits with 0 if valid, 1 if invalid.
"""

import json
import sys
from pathlib import Path
from typing import Any


def round_coordinate(coord: float) -> float:
    """Round coordinate to 3 decimal places using round-half-even."""
    return round(coord, 3)


def round_point(point: list) -> list:
    """Round point [x, y] to 3 decimal places."""
    return [round_coordinate(p) for p in point]


def round_points(points: list) -> list:
    """Round all points in array."""
    return [round_point(p) for p in points]


def ccw(A: list, B: list, C: list) -> float:
    """
    Counter-clockwise signed area * 2 for triangle ABC.
    > 0: CCW, < 0: CW, == 0: collinear.
    """
    return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])


def segments_intersect(p1: list, p2: list, p3: list, p4: list) -> bool:
    """
    Check if segments p1-p2 and p3-p4 intersect (not counting shared endpoints).
    Returns True only if they cross (not touching at endpoints).
    """
    ccw1 = ccw(p1, p3, p4)
    ccw2 = ccw(p2, p3, p4)
    ccw3 = ccw(p3, p1, p2)
    ccw4 = ccw(p4, p1, p2)

    # Strict intersection: opposite signs on both sides
    return (ccw1 * ccw2 < 0) and (ccw3 * ccw4 < 0)


def polygon_self_intersects(polygon: list) -> bool:
    """Check if polygon has self-intersecting edges (excluding shared endpoints)."""
    n = len(polygon)
    if n < 3:
        return True  # Not a valid polygon

    for i in range(n):
        p1 = polygon[i]
        p2 = polygon[(i + 1) % n]
        # Check against edges that don't share a vertex
        for j in range(i + 2, n):
            if j == (i - 1) % n:  # Adjacent edge, skip
                continue
            p3 = polygon[j]
            p4 = polygon[(j + 1) % n]
            if segments_intersect(p1, p2, p3, p4):
                return True
    return False


def polygon_area(polygon: list) -> float:
    """Calculate signed area of polygon using shoelace formula."""
    if len(polygon) < 3:
        return 0.0
    area = 0.0
    n = len(polygon)
    for i in range(n):
        j = (i + 1) % n
        area += polygon[i][0] * polygon[j][1]
        area -= polygon[j][0] * polygon[i][1]
    return abs(area) / 2.0


def point_in_polygon(point: list, polygon: list) -> bool:
    """Check if point is inside or on boundary of polygon using ray casting."""
    x, y = point
    n = len(polygon)
    inside = False

    p1x, p1y = polygon[0]
    for i in range(1, n + 1):
        p2x, p2y = polygon[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y

    # Check if point is on boundary
    for i in range(n):
        p1 = polygon[i]
        p2 = polygon[(i + 1) % n]
        # Check if point is on segment p1-p2
        cross = (point[1] - p1[1]) * (p2[0] - p1[0]) - (point[0] - p1[0]) * (p2[1] - p1[1])
        if abs(cross) < 1e-9:
            dot = (point[0] - p1[0]) * (p2[0] - p1[0]) + (point[1] - p1[1]) * (p2[1] - p1[1])
            squared_len = (p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2
            if 0 <= dot <= squared_len:
                return True

    return inside


def validate_navigation(doc: dict) -> list[str]:
    """
    Validate navigation document.
    Returns list of error messages (empty = valid).
    """
    errors = []

    # Check schema
    if doc.get("$schema") != "squad-tactics.navigation/v1":
        errors.append("$schema must be 'squad-tactics.navigation/v1'")

    # Check asset_id
    if not isinstance(doc.get("asset_id"), str) or not doc.get("asset_id"):
        errors.append("asset_id must be non-empty string")

    # Check space
    space = doc.get("space", {})
    if space.get("units") != "meter":
        errors.append("space.units must be 'meter'")
    if space.get("hex_layout") != "pointy_axial":
        errors.append("space.hex_layout must be 'pointy_axial'")
    if not isinstance(space.get("basis"), str) or not space.get("basis"):
        errors.append("space.basis must be non-empty string")
    if not isinstance(space.get("hex_radius_m"), (int, float)) or space.get("hex_radius_m", 0) <= 0:
        errors.append("space.hex_radius_m must be positive number")

    # Check owner
    owner = doc.get("owner", {})
    base_cell = owner.get("base_cell")
    occupied_cells = owner.get("occupied_cells", [])
    if not isinstance(base_cell, list) or len(base_cell) != 2:
        errors.append("owner.base_cell must be [int, int]")
    if not isinstance(occupied_cells, list) or len(occupied_cells) == 0:
        errors.append("owner.occupied_cells must be non-empty array of [q, r] cells")
    else:
        # Check occupied_cells contains base_cell
        if base_cell not in occupied_cells:
            errors.append("owner.occupied_cells must include base_cell")
        # Check for duplicates
        if len(occupied_cells) != len(set(tuple(c) for c in occupied_cells)):
            errors.append("owner.occupied_cells must have no duplicates")

    # Check profiles
    profiles = doc.get("profiles", [])
    if not isinstance(profiles, list) or len(profiles) == 0:
        errors.append("profiles must be non-empty array")
    elif len(profiles) != len(set(profiles)):
        errors.append("profiles must have no duplicates")

    # Check states
    states = doc.get("states", {})
    if not states:
        errors.append("states must be non-empty object")

    profile_set = set(profiles) if profiles else set()

    for state_name, state_data in states.items():
        if state_name not in ("d0", "d1", "d2", "destroyed"):
            errors.append(f"state '{state_name}' invalid; must be d0, d1, d2, or destroyed")
            continue

        if not isinstance(state_data, dict):
            errors.append(f"states.{state_name} must be object")
            continue

        # Collect all IDs in this state
        state_ids = {}

        # Validate obstacles
        obstacles = state_data.get("obstacles", [])
        for i, obs in enumerate(obstacles):
            if not isinstance(obs, dict):
                errors.append(f"states.{state_name}.obstacles[{i}] must be object")
                continue

            # Check id
            obs_id = obs.get("id")
            if not isinstance(obs_id, str) or not obs_id:
                errors.append(f"states.{state_name}.obstacles[{i}].id must be non-empty string")
            else:
                if obs_id in state_ids:
                    errors.append(f"states.{state_name}: duplicate id '{obs_id}'")
                else:
                    state_ids[obs_id] = "obstacle"

            # Check profiles
            obs_profiles = obs.get("profiles", [])
            if not isinstance(obs_profiles, list) or len(obs_profiles) == 0:
                errors.append(f"states.{state_name}.obstacles[{i}].profiles must be non-empty array")
            elif not set(obs_profiles).issubset(profile_set):
                errors.append(f"states.{state_name}.obstacles[{i}].profiles not subset of top-level profiles")

            # Check polygon
            polygon = obs.get("polygon")
            if not isinstance(polygon, list):
                errors.append(f"states.{state_name}.obstacles[{i}].polygon must be array")
            elif len(polygon) < 3:
                errors.append(f"states.{state_name}.obstacles[{i}].polygon must have 3+ vertices")
            else:
                if polygon_self_intersects(polygon):
                    errors.append(f"states.{state_name}.obstacles[{i}].polygon has self-intersection")
                if polygon_area(polygon) < 1e-9:
                    errors.append(f"states.{state_name}.obstacles[{i}].polygon has zero area")

        # Validate portals
        portals = state_data.get("portals", [])
        region_ids = set(r.get("id") for r in state_data.get("regions", []) if isinstance(r, dict) and r.get("id"))

        for i, portal in enumerate(portals):
            if not isinstance(portal, dict):
                errors.append(f"states.{state_name}.portals[{i}] must be object")
                continue

            # Check id
            portal_id = portal.get("id")
            if not isinstance(portal_id, str) or not portal_id:
                errors.append(f"states.{state_name}.portals[{i}].id must be non-empty string")
            else:
                if portal_id in state_ids:
                    errors.append(f"states.{state_name}: duplicate id '{portal_id}'")
                else:
                    state_ids[portal_id] = "portal"

            # Check profiles
            portal_profiles = portal.get("profiles", [])
            if not isinstance(portal_profiles, list) or len(portal_profiles) == 0:
                errors.append(f"states.{state_name}.portals[{i}].profiles must be non-empty array")
            elif not set(portal_profiles).issubset(profile_set):
                errors.append(f"states.{state_name}.portals[{i}].profiles not subset of top-level profiles")

            # Check segment
            segment = portal.get("segment")
            if not isinstance(segment, list) or len(segment) != 2:
                errors.append(f"states.{state_name}.portals[{i}].segment must be [p1, p2]")
            elif segment[0] == segment[1]:
                errors.append(f"states.{state_name}.portals[{i}].segment endpoints must differ")

            # Check connects
            connects = portal.get("connects", [])
            if not isinstance(connects, list) or len(connects) != 2:
                errors.append(f"states.{state_name}.portals[{i}].connects must have 2 elements")
            else:
                if connects[0] == "exterior" and connects[1] == "exterior":
                    errors.append(f"states.{state_name}.portals[{i}].connects cannot be ['exterior', 'exterior']")
                for j, conn in enumerate(connects):
                    if conn != "exterior" and conn not in region_ids:
                        errors.append(f"states.{state_name}.portals[{i}].connects references unknown region '{conn}'")

        # Validate regions
        regions = state_data.get("regions", [])
        for i, region in enumerate(regions):
            if not isinstance(region, dict):
                errors.append(f"states.{state_name}.regions[{i}] must be object")
                continue

            # Check id
            region_id = region.get("id")
            if not isinstance(region_id, str) or not region_id:
                errors.append(f"states.{state_name}.regions[{i}].id must be non-empty string")
            else:
                if region_id in state_ids:
                    errors.append(f"states.{state_name}: duplicate id '{region_id}'")
                else:
                    state_ids[region_id] = "region"

            # Check profiles
            region_profiles = region.get("profiles", [])
            if not isinstance(region_profiles, list) or len(region_profiles) == 0:
                errors.append(f"states.{state_name}.regions[{i}].profiles must be non-empty array")
            elif not set(region_profiles).issubset(profile_set):
                errors.append(f"states.{state_name}.regions[{i}].profiles not subset of top-level profiles")

            # Check polygon
            polygon = region.get("polygon")
            if not isinstance(polygon, list):
                errors.append(f"states.{state_name}.regions[{i}].polygon must be array")
            elif len(polygon) < 3:
                errors.append(f"states.{state_name}.regions[{i}].polygon must have 3+ vertices")
            else:
                if polygon_self_intersects(polygon):
                    errors.append(f"states.{state_name}.regions[{i}].polygon has self-intersection")
                if polygon_area(polygon) < 1e-9:
                    errors.append(f"states.{state_name}.regions[{i}].polygon has zero area")

        # Validate barriers
        barriers = state_data.get("barriers", [])
        for i, barrier in enumerate(barriers):
            if not isinstance(barrier, dict):
                errors.append(f"states.{state_name}.barriers[{i}] must be object")
                continue

            # Check id
            barrier_id = barrier.get("id")
            if not isinstance(barrier_id, str) or not barrier_id:
                errors.append(f"states.{state_name}.barriers[{i}].id must be non-empty string")
            else:
                if barrier_id in state_ids:
                    errors.append(f"states.{state_name}: duplicate id '{barrier_id}'")
                else:
                    state_ids[barrier_id] = "barrier"

            # Check profiles
            barrier_profiles = barrier.get("profiles", [])
            if not isinstance(barrier_profiles, list) or len(barrier_profiles) == 0:
                errors.append(f"states.{state_name}.barriers[{i}].profiles must be non-empty array")
            elif not set(barrier_profiles).issubset(profile_set):
                errors.append(f"states.{state_name}.barriers[{i}].profiles not subset of top-level profiles")

            # Check polyline
            polyline = barrier.get("polyline")
            if not isinstance(polyline, list):
                errors.append(f"states.{state_name}.barriers[{i}].polyline must be array")
            elif len(polyline) < 2:
                errors.append(f"states.{state_name}.barriers[{i}].polyline must have 2+ points")

        # Validate surfaces
        surfaces = state_data.get("surfaces", [])
        for i, surface in enumerate(surfaces):
            if not isinstance(surface, dict):
                errors.append(f"states.{state_name}.surfaces[{i}] must be object")
                continue

            # Check id
            surface_id = surface.get("id")
            if not isinstance(surface_id, str) or not surface_id:
                errors.append(f"states.{state_name}.surfaces[{i}].id must be non-empty string")
            else:
                if surface_id in state_ids:
                    errors.append(f"states.{state_name}: duplicate id '{surface_id}'")
                else:
                    state_ids[surface_id] = "surface"

            # Check profiles
            surface_profiles = surface.get("profiles", [])
            if not isinstance(surface_profiles, list) or len(surface_profiles) == 0:
                errors.append(f"states.{state_name}.surfaces[{i}].profiles must be non-empty array")
            elif not set(surface_profiles).issubset(profile_set):
                errors.append(f"states.{state_name}.surfaces[{i}].profiles not subset of top-level profiles")

            # Check kind
            if not isinstance(surface.get("kind"), str) or not surface.get("kind"):
                errors.append(f"states.{state_name}.surfaces[{i}].kind must be non-empty string")

            # Check polygon
            polygon = surface.get("polygon")
            if not isinstance(polygon, list):
                errors.append(f"states.{state_name}.surfaces[{i}].polygon must be array")
            elif len(polygon) < 3:
                errors.append(f"states.{state_name}.surfaces[{i}].polygon must have 3+ vertices")
            else:
                if polygon_self_intersects(polygon):
                    errors.append(f"states.{state_name}.surfaces[{i}].polygon has self-intersection")
                if polygon_area(polygon) < 1e-9:
                    errors.append(f"states.{state_name}.surfaces[{i}].polygon has zero area")

            # Check movement_cost_milli
            cost = surface.get("movement_cost_milli")
            if not isinstance(cost, int) or cost <= 0:
                errors.append(f"states.{state_name}.surfaces[{i}].movement_cost_milli must be positive int")

        # Validate slots
        slots = state_data.get("slots", [])
        for i, slot in enumerate(slots):
            if not isinstance(slot, dict):
                errors.append(f"states.{state_name}.slots[{i}] must be object")
                continue

            # Check id
            slot_id = slot.get("id")
            if not isinstance(slot_id, str) or not slot_id:
                errors.append(f"states.{state_name}.slots[{i}].id must be non-empty string")
            else:
                if slot_id in state_ids:
                    errors.append(f"states.{state_name}: duplicate id '{slot_id}'")
                else:
                    state_ids[slot_id] = "slot"

            # Check profiles
            slot_profiles = slot.get("profiles", [])
            if not isinstance(slot_profiles, list) or len(slot_profiles) == 0:
                errors.append(f"states.{state_name}.slots[{i}].profiles must be non-empty array")
            elif not set(slot_profiles).issubset(profile_set):
                errors.append(f"states.{state_name}.slots[{i}].profiles not subset of top-level profiles")

            # Check point
            point = slot.get("point")
            if not isinstance(point, list) or len(point) != 2:
                errors.append(f"states.{state_name}.slots[{i}].point must be [x, y]")

            # Check region
            region_ref = slot.get("region")
            if not isinstance(region_ref, str) or not region_ref:
                errors.append(f"states.{state_name}.slots[{i}].region must be non-empty string")
            elif region_ref != "exterior" and region_ref not in region_ids:
                errors.append(f"states.{state_name}.slots[{i}].region references unknown region '{region_ref}'")

            # Check kind
            if not isinstance(slot.get("kind"), str) or not slot.get("kind"):
                errors.append(f"states.{state_name}.slots[{i}].kind must be non-empty string")

            # Check point in region
            if isinstance(point, list) and len(point) == 2 and isinstance(region_ref, str) and region_ref:
                if region_ref != "exterior":
                    # Find the region polygon
                    for region in regions:
                        if isinstance(region, dict) and region.get("id") == region_ref:
                            region_polygon = region.get("polygon")
                            if isinstance(region_polygon, list) and len(region_polygon) >= 3:
                                if not point_in_polygon(point, region_polygon):
                                    errors.append(f"states.{state_name}.slots[{i}].point not in region '{region_ref}'")
                            break

    # Check source
    source = doc.get("source", {})
    if not isinstance(source, dict):
        errors.append("source must be object")
    elif not isinstance(source.get("generator"), str):
        errors.append("source.generator must be string")

    return errors


def serialize_navigation(doc: dict) -> str:
    """
    Deterministically serialize navigation document.
    - Sort keys alphabetically
    - Round coordinates to 3 decimal places
    - Indent 2
    - End with single newline
    """
    def round_value(v: Any) -> Any:
        """Recursively round coordinates in nested structures."""
        if isinstance(v, dict):
            return {k: round_value(v[k]) for k in sorted(v.keys())}
        elif isinstance(v, list):
            # Check if this looks like a point/coordinate
            if len(v) == 2 and all(isinstance(x, (int, float)) for x in v):
                # Could be [x, y]
                if all(-1000 <= x <= 1000 for x in v):  # Heuristic for coordinates
                    try:
                        return [round_coordinate(x) for x in v]
                    except (TypeError, ValueError):
                        pass
            # Otherwise recurse for general arrays
            return [round_value(item) for item in v]
        elif isinstance(v, float):
            return round_coordinate(v)
        else:
            return v

    rounded = round_value(doc)
    result = json.dumps(rounded, sort_keys=True, indent=2)
    if not result.endswith('\n'):
        result += '\n'
    return result


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python scripts/kb3d_forge/navigation_v1.py <file.json>", file=sys.stderr)
        return 1

    file_path = Path(sys.argv[1])

    if not file_path.exists():
        print(f"Error: file not found: {file_path}", file=sys.stderr)
        return 1

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            doc = json.load(f)
    except json.JSONDecodeError as e:
        print(f"Error: invalid JSON: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    errors = validate_navigation(doc)

    if errors:
        for error in errors:
            print(error)
        return 1

    asset_id = doc.get("asset_id", "unknown")
    print(f"NAVIGATION_V1 OK {asset_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
