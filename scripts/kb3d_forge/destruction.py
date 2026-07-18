import bpy
import bmesh
from mathutils import Vector


def _ascii_text(value):
    return str(value).encode("ascii", "backslashreplace").decode("ascii")


def _world_bbox(obj):
    return [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]


def _bbox_bounds(obj):
    corners = _world_bbox(obj)
    return (
        min(corner.x for corner in corners),
        max(corner.x for corner in corners),
        min(corner.y for corner in corners),
        max(corner.y for corner in corners),
        min(corner.z for corner in corners),
        max(corner.z for corner in corners),
    )


def _make_cutter(center, radius, rng, cut_material):
    mesh = bpy.data.meshes.new("FORGE_CUTTER")
    bm = bmesh.new()
    try:
        try:
            bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
        except TypeError:
            bmesh.ops.create_icosphere(bm, subdivisions=2, diameter=radius * 2.0)

        for vert in bm.verts:
            vert.co += Vector((
                rng.uniform(-1.0, 1.0),
                rng.uniform(-1.0, 1.0),
                rng.uniform(-1.0, 1.0),
            )) * (0.35 * radius)

        bm.to_mesh(mesh)
    finally:
        bm.free()

    cutter = bpy.data.objects.new("FORGE_CUTTER", mesh)
    bpy.context.scene.collection.objects.link(cutter)
    cutter.location = center

    if cut_material is not None:
        mesh.materials.append(cut_material)

    return cutter


def _remove_cutter(cutter):
    mesh = cutter.data if cutter is not None else None
    if cutter is not None and cutter.name in bpy.data.objects:
        bpy.data.objects.remove(cutter, do_unlink=True)
    if mesh is not None and mesh.users == 0:
        bpy.data.meshes.remove(mesh)


def _part_map(catalog):
    parts = catalog.get("parts", [])
    if isinstance(parts, dict):
        return dict(parts)

    result = {}
    for part in parts:
        if isinstance(part, dict) and part.get("name"):
            result[part["name"]] = part
    return result


def _debris_candidates(catalog, parts_by_name):
    candidates = []
    for pool_entry in catalog.get("debris_pool", []):
        if isinstance(pool_entry, str):
            name = pool_entry
            part = parts_by_name.get(name)
            size_class = part.get("size_class") if isinstance(part, dict) else None
        elif isinstance(pool_entry, dict):
            name = pool_entry.get("name")
            part = parts_by_name.get(name)
            size_class = pool_entry.get("size_class")
            if size_class is None and isinstance(part, dict):
                size_class = part.get("size_class")
        else:
            continue

        if name and isinstance(part, dict) and size_class in ("S", "M"):
            candidates.append((name, part))

    return candidates


def _side_candidates(bounds):
    min_x, max_x, min_y, max_y, min_z, max_z = bounds
    width_x = max_x - min_x
    width_y = max_y - min_y
    height = max_z - min_z

    sides = [
        ("x", min_x, width_y * height),
        ("x", max_x, width_y * height),
        ("y", min_y, width_x * height),
        ("y", max_y, width_x * height),
    ]
    sides.sort(key=lambda item: item[2], reverse=True)
    return sides[:2]


def _hole_center(bounds, side, rng):
    min_x, max_x, min_y, max_y, min_z, max_z = bounds
    axis, fixed_value, _area = side
    z = min_z + (max_z - min_z) * rng.uniform(0.25, 0.65)

    if axis == "x":
        y = min_y + (max_y - min_y) * rng.uniform(0.2, 0.8)
        return Vector((fixed_value, y, z))

    x = min_x + (max_x - min_x) * rng.uniform(0.2, 0.8)
    return Vector((x, fixed_value, z))


def _spawn_debris(center, debris_count, candidates, rng, spawn_fn):
    added = 0

    for _index in range(debris_count):
        source_name, part_entry = rng.choice(candidates)
        record = spawn_fn(
            source_name,
            part_entry,
            "DEBRIS",
            expected_min_z=0.0,
        )
        if not record or record.get("obj") is None:
            continue

        obj = record["obj"]
        obj.location.x = center.x + rng.uniform(-1.2, 1.2)
        obj.location.y = center.y + rng.uniform(-1.2, 1.2)
        obj.rotation_euler.z = rng.uniform(0.0, 6.283)

        bpy.context.view_layer.update()
        min_z = _bbox_bounds(obj)[4]
        obj.location.z -= min_z
        bpy.context.view_layer.update()

        added += 1

    return added


def apply_destruction(records, recipe, catalog, rng, spawn_fn):
    """Apply recipe['destruction'] to built CORE objects."""
    destruction = recipe.get("destruction", {})
    hole_entries = destruction.get("holes", [])
    debris_range = destruction.get("debris_per_hole", [0, 0])
    cut_material_name = destruction.get("cut_section_mat")

    cut_material = bpy.data.materials.get(cut_material_name)
    if cut_material is None:
        print(
            "WARN cut section material missing name=%s" %
            _ascii_text(cut_material_name)
        )

    core_records = [
        record for record in records
        if record.get("category") == "CORE"
    ]
    parts_by_name = _part_map(catalog)
    debris_candidates = _debris_candidates(catalog, parts_by_name)

    holes_applied = 0
    debris_added = 0
    ok = True
    copied_objects = set()

    for hole_entry in hole_entries:
        core_index = hole_entry.get("core_index")
        if not isinstance(core_index, int) or not (0 <= core_index < len(core_records)):
            print(
                "WARN destruction core index out of range index=%s cores=%d" %
                (_ascii_text(core_index), len(core_records))
            )
            continue

        target = core_records[core_index].get("obj")
        if target is None or target.type != "MESH":
            print(
                "WARN destruction core is not mesh index=%d" %
                core_index
            )
            continue

        lowered = target.name.lower()
        if "tent" in lowered or "tarp" in lowered:
            # Thin open fabric shells break EXACT difference: the cutter
            # sphere's cross-section patch survives outside the shell and
            # can reach below ground (MainTent sank to -0.395 in prod).
            print(
                "WARN destruction skip fabric target name=%s" %
                _ascii_text(target.name)
            )
            continue

        target_key = target.as_pointer()
        if target_key not in copied_objects:
            target.data = target.data.copy()
            copied_objects.add(target_key)
            # modifier_apply evaluates the viewport stack, so a leftover
            # SUBSURF "Subdiv for displacement" (only show_render=False)
            # would bake displaced geometry into the cut and break the
            # elevation check (MainTent sagged -0.4m in production).
            for leftover in list(target.modifiers):
                if leftover.type == "SUBSURF":
                    target.modifiers.remove(leftover)

        radius_range = hole_entry.get("radius", [0.0, 0.0])
        hole_count = hole_entry.get("count", 0)

        for _index in range(hole_count):
            bpy.context.view_layer.update()
            bounds = _bbox_bounds(target)
            sides = _side_candidates(bounds)
            if not sides:
                continue

            center = _hole_center(bounds, rng.choice(sides), rng)
            radius = rng.uniform(radius_range[0], radius_range[1])
            cutter = None
            applied = False

            try:
                cutter = _make_cutter(center, radius, rng, cut_material)

                modifier = target.modifiers.new("FORGE_CUT", "BOOLEAN")
                modifier.object = cutter
                modifier.operation = "DIFFERENCE"
                modifier.solver = "EXACT"
                modifier.use_hole_tolerant = True

                if hasattr(modifier, "material_mode"):
                    modifier.material_mode = "TRANSFER"
                else:
                    print(
                        "WARN boolean material transfer unavailable name=%s" %
                        _ascii_text(target.name)
                    )

                before_polys = len(target.data.polygons)
                try:
                    with bpy.context.temp_override(
                        object=target,
                        active_object=target,
                        selected_editable_objects=[target],
                    ):
                        bpy.ops.object.modifier_apply(modifier=modifier.name)
                    applied = True
                except Exception as exc:
                    print(
                        "WARN boolean apply failed name=%s error=%s" %
                        (_ascii_text(target.name), _ascii_text(exc))
                    )
                    if modifier.name in target.modifiers:
                        target.modifiers.remove(modifier)

                if applied:
                    after_polys = len(target.data.polygons)
                    if after_polys < before_polys * 0.5:
                        ok = False
                        print(
                            "WARN boolean poly collapse name=%s before=%d after=%d" %
                            (_ascii_text(target.name), before_polys, after_polys)
                        )

                    holes_applied += 1

                    if debris_candidates:
                        debris_count = rng.randint(
                            debris_range[0],
                            debris_range[1],
                        )
                        debris_added += _spawn_debris(
                            center,
                            debris_count,
                            debris_candidates,
                            rng,
                            spawn_fn,
                        )
            finally:
                _remove_cutter(cutter)

    return holes_applied, debris_added, ok
