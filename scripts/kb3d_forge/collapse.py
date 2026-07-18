"""Deterministic loose-part structural collapse for KB3D Forge.

The old destruction path subtracts round boolean cutters from a building.
This module instead removes connected mesh components with a directional,
top-down failure field. It deliberately keeps a share of long, thin pieces
so rafters and beams remain readable as the shell collapses.

Pure planning helpers stay importable outside Blender for fast tests. The
Blender entry point is apply_collapse().
"""

from __future__ import annotations

import hashlib
import math

try:  # Blender-only dependencies.
    import bmesh
    import bpy
    from mathutils import Vector
except ImportError:  # pragma: no cover - exercised inside Blender.
    bmesh = None
    bpy = None
    Vector = None


STAGE_THRESHOLDS = {0: 2.0, 1: 0.86, 2: 0.72, 3: 0.58, 4: 0.43}
STAGE_MAX_REMOVE = {0: 0.0, 1: 0.15, 2: 0.32, 3: 0.52, 4: 0.72}
DEFAULT_DEBRIS_PER_STAGE = (0, 3, 7, 12, 18)


def _clamp_stage(stage):
    stage = int(stage)
    if not 0 <= stage <= 4:
        raise ValueError("collapse stage must be in range 0..4")
    return stage


def _stable_unit(seed, component_index):
    payload = ("%s:%s" % (int(seed), int(component_index))).encode("ascii")
    value = int.from_bytes(hashlib.sha256(payload).digest()[:8], "big")
    return value / float((1 << 64) - 1)


def connected_components(vertex_count, edges):
    """Return sorted vertex-index tuples for an undirected mesh graph."""
    vertex_count = int(vertex_count)
    if vertex_count < 0:
        raise ValueError("vertex_count must be non-negative")

    adjacency = [[] for _ in range(vertex_count)]
    for edge in edges:
        a, b = int(edge[0]), int(edge[1])
        if not (0 <= a < vertex_count and 0 <= b < vertex_count):
            raise ValueError("edge vertex index is out of range")
        adjacency[a].append(b)
        adjacency[b].append(a)

    seen = [False] * vertex_count
    result = []
    for start in range(vertex_count):
        if seen[start]:
            continue
        seen[start] = True
        stack = [start]
        component = []
        while stack:
            current = stack.pop()
            component.append(current)
            for neighbour in adjacency[current]:
                if not seen[neighbour]:
                    seen[neighbour] = True
                    stack.append(neighbour)
        result.append(tuple(sorted(component)))
    return result


def component_metrics(coordinates, components):
    """Measure component bounds using plain x/y/z coordinates."""
    coordinates = [tuple(float(value) for value in coordinate) for coordinate in coordinates]
    result = []
    for index, component in enumerate(components):
        if not component:
            continue
        points = [coordinates[vertex_index] for vertex_index in component]
        minimum = tuple(min(point[axis] for point in points) for axis in range(3))
        maximum = tuple(max(point[axis] for point in points) for axis in range(3))
        dimensions = tuple(maximum[axis] - minimum[axis] for axis in range(3))
        center = tuple((minimum[axis] + maximum[axis]) * 0.5 for axis in range(3))
        ordered = sorted(dimensions, reverse=True)
        second = max(ordered[1], 1.0e-6)
        slenderness = ordered[0] / second
        result.append(
            {
                "index": index,
                "vertices": tuple(component),
                "minimum": minimum,
                "maximum": maximum,
                "dimensions": dimensions,
                "center": center,
                "slenderness": slenderness,
            }
        )
    return result


def plan_component_removal(metrics, stage, seed, direction=(1.0, 1.0)):
    """Select connected components for one structural collapse stage.

    The failure field is a diagonal plane biased toward high components, not
    a radial distance field. This creates a broken corner/roof line rather
    than a round hole. Selection is monotonic for one seed and direction.
    """
    stage = _clamp_stage(stage)
    metrics = list(metrics)
    if stage == 0 or not metrics:
        return []

    dx, dy = float(direction[0]), float(direction[1])
    length = math.hypot(dx, dy)
    if length <= 1.0e-9:
        raise ValueError("collapse direction must be non-zero")
    dx, dy = dx / length, dy / length

    global_min = [min(item["minimum"][axis] for item in metrics) for axis in range(3)]
    global_max = [max(item["maximum"][axis] for item in metrics) for axis in range(3)]
    spans = [max(global_max[axis] - global_min[axis], 1.0e-6) for axis in range(3)]
    candidates = []

    for item in metrics:
        cx, cy, cz = item["center"]
        fx = (cx - global_min[0]) / spans[0]
        fy = (cy - global_min[1]) / spans[1]
        fz = (cz - global_min[2]) / spans[2]
        projected = (dx * (2.0 * fx - 1.0) + dy * (2.0 * fy - 1.0)) / math.sqrt(2.0)
        side = max(0.0, min(1.0, 0.5 + 0.5 * projected))
        noise = _stable_unit(seed, item["index"])
        score = 0.52 * fz + 0.38 * side + 0.10 * noise

        if fz < 0.14 and stage < 4:
            continue

        beam_like = float(item.get("slenderness", 1.0)) >= 4.0
        if beam_like:
            score -= 0.16 if stage < 4 else 0.08

        if stage == 1 and fz < 0.62:
            continue

        if score >= STAGE_THRESHOLDS[stage]:
            candidates.append((score, item["index"]))

    candidates.sort(key=lambda pair: (-pair[0], pair[1]))
    cap = max(1, int(math.ceil(len(metrics) * STAGE_MAX_REMOVE[stage])))
    return sorted(component_index for _score, component_index in candidates[:cap])


def _part_map(catalog):
    result = {}
    for part in catalog.get("parts", []):
        if isinstance(part, dict) and part.get("name"):
            result[part["name"]] = part
    return result


def _debris_candidates(catalog, parts_by_name):
    result = []
    for pool_entry in catalog.get("debris_pool", []):
        if not isinstance(pool_entry, dict):
            continue
        name = pool_entry.get("name")
        if name in parts_by_name and pool_entry.get("size_class") in ("S", "M"):
            result.append((name, parts_by_name[name]))
    return result


def _mesh_plan(obj, stage, seed, direction):
    mesh = obj.data
    edges = [(edge.vertices[0], edge.vertices[1]) for edge in mesh.edges]
    components = connected_components(len(mesh.vertices), edges)
    coordinates = [tuple(vertex.co) for vertex in mesh.vertices]
    metrics = component_metrics(coordinates, components)
    removed_indices = set(plan_component_removal(metrics, stage, seed, direction))
    removed_metrics = [item for item in metrics if item["index"] in removed_indices]
    removed_vertices = sorted(
        vertex_index
        for item in removed_metrics
        for vertex_index in item["vertices"]
    )
    return metrics, removed_metrics, removed_vertices


def _remove_vertices(obj, vertex_indices):
    if not vertex_indices:
        return
    mesh = obj.data
    edit_mesh = bmesh.new()
    try:
        edit_mesh.from_mesh(mesh)
        edit_mesh.verts.ensure_lookup_table()
        doomed = [edit_mesh.verts[index] for index in vertex_indices]
        bmesh.ops.delete(edit_mesh, geom=doomed, context="VERTS")
        edit_mesh.to_mesh(mesh)
        mesh.update()
    finally:
        edit_mesh.free()


def _world_ground_center(obj, removed_metrics):
    if not removed_metrics:
        return Vector((obj.location.x, obj.location.y, 0.0))
    local = Vector(
        tuple(
            sum(item["center"][axis] for item in removed_metrics) / len(removed_metrics)
            for axis in range(3)
        )
    )
    world = obj.matrix_world @ local
    world.z = 0.0
    return world


def _world_bounds(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        min(point.x for point in corners),
        max(point.x for point in corners),
        min(point.y for point in corners),
        max(point.y for point in corners),
        min(point.z for point in corners),
        max(point.z for point in corners),
    )


def _attachment_should_fail(obj, target_bounds, stage, direction):
    min_x, max_x, min_y, max_y, min_z, max_z = target_bounds
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    center = sum(corners, Vector()) / len(corners)
    margin = 0.75
    if not (
        min_x - margin <= center.x <= max_x + margin
        and min_y - margin <= center.y <= max_y + margin
        and min_z - margin <= center.z <= max_z + margin
    ):
        return False

    span_x = max(max_x - min_x, 1.0e-6)
    span_y = max(max_y - min_y, 1.0e-6)
    span_z = max(max_z - min_z, 1.0e-6)
    fx = (center.x - min_x) / span_x
    fy = (center.y - min_y) / span_y
    fz = (center.z - min_z) / span_z
    dx, dy = float(direction[0]), float(direction[1])
    length = max(math.hypot(dx, dy), 1.0e-6)
    dx, dy = dx / length, dy / length
    projected = (dx * (2.0 * fx - 1.0) + dy * (2.0 * fy - 1.0)) / math.sqrt(2.0)
    side = max(0.0, min(1.0, 0.5 + 0.5 * projected))
    score = 0.56 * fz + 0.44 * side
    if stage == 1 and fz < 0.62:
        return False
    return score >= STAGE_THRESHOLDS[stage] - 0.06


def _prune_unsupported_records(records, target_record, target_bounds, stage, direction):
    removed = 0
    removable_categories = {"OPENING", "DECAL", "PROP", "STRUCT"}
    for record in list(records):
        if record is target_record or record.get("category") not in removable_categories:
            continue
        obj = record.get("obj")
        if obj is None or obj.type != "MESH":
            continue
        if not _attachment_should_fail(obj, target_bounds, stage, direction):
            continue
        records.remove(record)
        bpy.data.objects.remove(obj, do_unlink=True)
        removed += 1
    if removed:
        bpy.context.view_layer.update()
    return removed


def _spawn_debris(center, direction, count, candidates, rng, spawn_fn):
    if not candidates or count <= 0:
        return 0
    dx, dy = float(direction[0]), float(direction[1])
    length = max(math.hypot(dx, dy), 1.0e-6)
    dx, dy = dx / length, dy / length
    tangent_x, tangent_y = -dy, dx
    added = 0

    for index in range(count):
        source_name, source_entry = rng.choice(candidates)
        record = spawn_fn(
            source_name,
            source_entry,
            "DEBRIS",
            expected_min_z=0.0,
        )
        if not record or record.get("obj") is None:
            continue
        obj = record["obj"]
        outward = rng.uniform(0.5, 3.8) * (0.35 + index / max(count, 1))
        lateral = rng.uniform(-2.4, 2.4)
        obj.location.x = center.x + dx * outward + tangent_x * lateral
        obj.location.y = center.y + dy * outward + tangent_y * lateral
        obj.rotation_euler.z = rng.uniform(0.0, math.tau)
        bpy.context.view_layer.update()
        lowest = min((obj.matrix_world @ Vector(corner)).z for corner in obj.bound_box)
        obj.location.z -= lowest
        bpy.context.view_layer.update()
        added += 1
    return added


def apply_collapse(records, recipe, catalog, rng, spawn_fn):
    """Apply recipe collapse settings to built CORE meshes.

    Returns removed-component count, debris count, and an ok flag. This
    function never creates or applies a boolean modifier.
    """
    if bpy is None or bmesh is None:
        raise RuntimeError("apply_collapse must run inside Blender")

    config = recipe.get("collapse", {})
    default_stage = _clamp_stage(config.get("stage", 0))
    default_direction = tuple(config.get("direction", (1.0, 1.0)))
    targets = config.get("targets")
    core_records = [record for record in records if record.get("category") == "CORE"]
    if not targets:
        targets = [
            {
                "core_index": index,
                "stage": default_stage,
                "direction": default_direction,
            }
            for index in range(len(core_records))
        ]

    parts_by_name = _part_map(catalog)
    debris_candidates = _debris_candidates(catalog, parts_by_name)
    debris_counts = tuple(config.get("debris_per_stage", DEFAULT_DEBRIS_PER_STAGE))
    if len(debris_counts) != 5:
        raise ValueError("collapse debris_per_stage must contain five values")

    removed_total = 0
    debris_total = 0
    ok = True
    touched = set()

    for target_order, target_config in enumerate(targets):
        core_index = int(target_config.get("core_index", -1))
        if not 0 <= core_index < len(core_records):
            print("WARN collapse core index out of range index=%d" % core_index)
            ok = False
            continue
        stage = _clamp_stage(target_config.get("stage", default_stage))
        if stage == 0:
            continue
        direction = tuple(target_config.get("direction", default_direction))
        target = core_records[core_index].get("obj")
        if target is None or target.type != "MESH":
            print("WARN collapse target is not mesh index=%d" % core_index)
            ok = False
            continue

        pointer = target.as_pointer()
        if pointer not in touched:
            target.data = target.data.copy()
            touched.add(pointer)
        before_vertices = len(target.data.vertices)
        target_bounds = _world_bounds(target)
        metrics, removed_metrics, removed_vertices = _mesh_plan(
            target,
            stage,
            int(recipe.get("seed", 0)) + target_order * 1009,
            direction,
        )
        if not removed_vertices:
            print("WARN collapse selected no parts index=%d stage=%d" % (core_index, stage))
            ok = False
            continue

        center = _world_ground_center(target, removed_metrics)
        _remove_vertices(target, removed_vertices)
        bpy.context.view_layer.update()
        after_vertices = len(target.data.vertices)
        removed_total += len(removed_metrics)
        unsupported_removed = _prune_unsupported_records(
            records,
            core_records[core_index],
            target_bounds,
            stage,
            direction,
        )

        if after_vertices < before_vertices * 0.20:
            print(
                "WARN collapse mesh retention failed index=%d before=%d after=%d" %
                (core_index, before_vertices, after_vertices)
            )
            ok = False

        if any(modifier.type == "BOOLEAN" for modifier in target.modifiers):
            print("WARN collapse boolean modifier present index=%d" % core_index)
            ok = False

        debris_total += _spawn_debris(
            center,
            direction,
            int(debris_counts[stage]),
            debris_candidates,
            rng,
            spawn_fn,
        )
        print(
            "COLLAPSE core=%d stage=%d parts=%d/%d vertices=%d/%d attachments=%d" %
            (
                core_index,
                stage,
                len(removed_metrics),
                len(metrics),
                before_vertices - after_vertices,
                before_vertices,
                unsupported_removed,
            )
        )

    return removed_total, debris_total, ok

