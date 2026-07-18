import argparse
import json
import math
import os
import random
import sys
import time
from pathlib import Path

try:
    import bpy
    from mathutils import Vector
except ModuleNotFoundError as exc:
    if exc.name not in {"bpy", "mathutils"}:
        raise
    bpy = None
    Vector = None

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from paths import DEFAULT_CATALOG_OUT, TEX2K_DIR


def blender_args():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1:]
    return []


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--recipe", required=True)
    parser.add_argument("--catalog", default=str(DEFAULT_CATALOG_OUT))
    return parser.parse_args(blender_args())


def remap_textures():
    """Remap unpacked image paths to the 2K texture folder (mandatory)."""
    bpy.ops.file.find_missing_files(directory=str(TEX2K_DIR))
    missing = 0
    for img in bpy.data.images:
        if img.filepath and not os.path.exists(bpy.path.abspath(img.filepath)):
            missing += 1
    return missing


def as_entry(item, parts_by_name):
    if isinstance(item, str):
        return parts_by_name.get(item)
    if isinstance(item, dict):
        name = item.get("name")
        if name in parts_by_name:
            return parts_by_name[name]
        return item
    return None


def bbox_world(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector((
            min(point.x for point in points),
            min(point.y for point in points),
            min(point.z for point in points),
        )),
        Vector((
            max(point.x for point in points),
            max(point.y for point in points),
            max(point.z for point in points),
        )),
    )


def catalog_bbox(entry):
    return (
        Vector(entry.get("bb_min_rel", (0.0, 0.0, 0.0))),
        Vector(entry.get("bb_max_rel", (0.0, 0.0, 0.0))),
    )


def bbox_center(bounds):
    return (bounds[0] + bounds[1]) * 0.5


def bbox_bottom_center(bounds):
    center = bbox_center(bounds)
    return Vector((center.x, center.y, bounds[0].z))


def horizontal_axis(entry):
    bb_min, bb_max = catalog_bbox(entry)
    return "X" if (bb_max.x - bb_min.x) >= (bb_max.y - bb_min.y) else "Y"


def horizontal_iou(bounds_a, bounds_b):
    ax0, ay0 = bounds_a[0].x, bounds_a[0].y
    ax1, ay1 = bounds_a[1].x, bounds_a[1].y
    bx0, by0 = bounds_b[0].x, bounds_b[0].y
    bx1, by1 = bounds_b[1].x, bounds_b[1].y

    ix = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    iy = max(0.0, min(ay1, by1) - max(ay0, by0))
    inter = ix * iy
    area_a = max(0.0, ax1 - ax0) * max(0.0, ay1 - ay0)
    area_b = max(0.0, bx1 - bx0) * max(0.0, by1 - by0)
    union = area_a + area_b - inter
    return inter / union if union > 0.0 else 0.0


def bbox_iou_3d(bounds_a, bounds_b):
    dx = max(0.0, min(bounds_a[1].x, bounds_b[1].x) - max(bounds_a[0].x, bounds_b[0].x))
    dy = max(0.0, min(bounds_a[1].y, bounds_b[1].y) - max(bounds_a[0].y, bounds_b[0].y))
    dz = max(0.0, min(bounds_a[1].z, bounds_b[1].z) - max(bounds_a[0].z, bounds_b[0].z))
    inter = dx * dy * dz
    vol_a = max(0.0, bounds_a[1].x - bounds_a[0].x) * max(0.0, bounds_a[1].y - bounds_a[0].y) * max(0.0, bounds_a[1].z - bounds_a[0].z)
    vol_b = max(0.0, bounds_b[1].x - bounds_b[0].x) * max(0.0, bounds_b[1].y - bounds_b[0].y) * max(0.0, bounds_b[1].z - bounds_b[0].z)
    union = vol_a + vol_b - inter
    return inter / union if union > 0.0 else 0.0


def item_name(item):
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        return item.get("name")
    return None


def select_template_cores(recipe, template_cores):
    """Validate recipe.core_keep and return the selected source core items."""
    cores = list(template_cores)
    if "core_keep" not in recipe:
        return cores

    requested = recipe["core_keep"]
    if not isinstance(requested, list) or not requested:
        raise ValueError(
            "recipe.core_keep must be a non-empty list of source core object names"
        )

    seen = set()
    for index, name in enumerate(requested):
        if not isinstance(name, str) or not name:
            raise ValueError(
                "recipe.core_keep[%d] must be a non-empty string" % index
            )
        if name in seen:
            raise ValueError("recipe.core_keep contains duplicate name: %s" % name)
        seen.add(name)

    available_names = {
        item_name(item) for item in cores if item_name(item) is not None
    }
    unknown = [name for name in requested if name not in available_names]
    if unknown:
        raise ValueError(
            "recipe.core_keep contains unknown template core name(s): %s"
            % ", ".join(unknown)
        )

    return [item for item in cores if item_name(item) in seen]


def flatten_set_names(value):
    names = set()
    if isinstance(value, str):
        names.add(value)
    elif isinstance(value, dict):
        name = value.get("name")
        if name:
            names.add(name)
        for child in value.values():
            names.update(flatten_set_names(child))
    elif isinstance(value, (list, tuple, set)):
        for child in value:
            names.update(flatten_set_names(child))
    return names


def build_scene(recipe, catalog, skip_ground=False):
    """Assemble FORGE_OUT from a recipe inside the open KB blend.

    Runs texture remap, part assembly, structural damage, and mechanical checks.
    Rendering, blend export, and process exit stay with the caller.
    Returns {"records", "out_col", "root", "verify_ok"}.
    """
    templates_by_name = {
        template["name"]: template
        for template in catalog.get("templates", [])
        if template.get("name")
    }
    template_name = recipe["template"]
    template = templates_by_name[template_name]
    core_items = select_template_cores(recipe, template.get("cores", []))

    rng = random.Random(recipe["seed"])
    print("TEX missing=%d" % remap_textures())

    render_displacement = bool(
        recipe.get("quality", {}).get("render_displacement", False)
    )
    for obj in bpy.data.objects:
        for modifier in obj.modifiers:
            if modifier.type == "SUBSURF":
                modifier.show_viewport = False

    scene = bpy.data.scenes["KB3D_WorldWarTwo-Native"]
    output_cfg = recipe.get("output", {})
    output_name = output_cfg.get("collection") or "FORGE_OUT"
    out_col = bpy.data.collections.new(output_name)
    scene.collection.children.link(out_col)

    root = bpy.data.objects.new("FORGE_ROOT", None)
    root.empty_display_type = "PLAIN_AXES"
    root.location = (0.0, 0.0, 0.0)
    out_col.objects.link(root)

    parts_by_name = {
        part["name"]: part
        for part in catalog.get("parts", [])
        if part.get("name")
    }

    records = []

    def spawn(source_name, transform_entry, category, swapped=False, expected_min_z=None):
        source = bpy.data.objects.get(source_name)
        if source is None:
            raise RuntimeError("Missing source object: %s" % source_name)

        obj = source.copy()
        obj.name = "FORGE_" + source_name
        obj.hide_render = False
        # Keep a stable base cage for alignment, but retain displacement for
        # opt-in final beauty bakes instead of deleting surface detail.
        for leftover in list(obj.modifiers):
            if leftover.type == "SUBSURF":
                leftover.show_viewport = False
                leftover.show_render = render_displacement
        out_col.objects.link(obj)
        obj.parent = root
        obj.rotation_mode = "XYZ"
        obj.location = Vector(transform_entry.get("rel_loc", (0.0, 0.0, 0.0)))
        obj.rotation_euler = Vector(transform_entry.get("rot", (0.0, 0.0, 0.0)))
        obj.scale = Vector(transform_entry.get("scale", (1.0, 1.0, 1.0)))
        bpy.context.view_layer.update()

        if expected_min_z is None:
            expected_min_z = float(transform_entry.get("bb_min_rel", (0.0, 0.0, 0.0))[2])

        record = {
            "obj": obj,
            "entry": transform_entry,
            "category": category,
            "swapped": swapped,
            "expected_min_z": float(expected_min_z),
        }
        records.append(record)
        return record

    def spawn_aligned(source_entry, slot_entry, category, bottom_align):
        record = spawn(
            source_entry["name"], source_entry, category, swapped=True,
            expected_min_z=float(slot_entry.get("bb_min_rel", (0.0, 0.0, 0.0))[2]),
        )
        obj = record["obj"]

        if horizontal_axis(source_entry) != horizontal_axis(slot_entry):
            obj.rotation_euler.z += math.radians(90.0)

        bpy.context.view_layer.update()
        source_bounds = bbox_world(obj)
        target_bounds = catalog_bbox(slot_entry)

        if bottom_align:
            delta = bbox_bottom_center(target_bounds) - bbox_bottom_center(source_bounds)
        else:
            delta = bbox_center(target_bounds) - bbox_center(source_bounds)

        obj.location += delta
        bpy.context.view_layer.update()
        if bottom_align:
            # settle pass: re-measure and pin the bottom exactly to the slot.
            # Catches any residual drift (observed 0.43m on Camp_B MainTent).
            actual_min_z = bbox_world(obj)[0].z
            drift = record["expected_min_z"] - actual_min_z
            if abs(drift) > 0.01:
                print("WARN align settle name=%s drift=%.3f" % (obj.name, drift))
                obj.location.z += drift
                bpy.context.view_layer.update()
        return record

    ground_items = [] if skip_ground else template.get("ground", [])
    for item in ground_items:
        entry = as_entry(item, parts_by_name)
        if entry is not None:
            spawn(entry["name"], entry, "GROUND")

    core_swaps = recipe.get("core_swaps", {})
    for item in core_items:
        slot_entry = as_entry(item, parts_by_name)
        if slot_entry is None:
            continue
        replacement_name = core_swaps.get(slot_entry["name"])
        if replacement_name:
            replacement_entry = parts_by_name.get(replacement_name)
            if replacement_entry is None:
                raise RuntimeError("Missing core replacement: %s" % replacement_name)
            spawn_aligned(replacement_entry, slot_entry, "CORE", True)
        else:
            spawn(slot_entry["name"], slot_entry, "CORE")

    if recipe.get("struct", {}).get("keep", False):
        for item in template.get("struct", []):
            entry = as_entry(item, parts_by_name)
            if entry is not None:
                spawn(entry["name"], entry, "STRUCT")

    openings_by_anchor = {
        opening.get("anchor_id"): opening
        for opening in template.get("openings", [])
        if opening.get("anchor_id")
    }
    requested_openings = {
        opening.get("anchor_id"): opening
        for opening in recipe.get("openings", [])
        if opening.get("anchor_id")
    }
    filled_openings = 0

    for anchor_id, opening_op in requested_openings.items():
        anchor = openings_by_anchor.get(anchor_id)
        if anchor is None:
            continue

        occupant_name = anchor.get("occupant")
        occupant_entry = parts_by_name.get(occupant_name)
        operation = opening_op.get("op")

        if operation == "keep":
            if occupant_entry is not None:
                spawn(occupant_entry["name"], occupant_entry, "OPENING")
                filled_openings += 1
        elif operation == "swap":
            replacement_name = opening_op.get("with")
            replacement_entry = parts_by_name.get(replacement_name)
            if replacement_entry is None or occupant_entry is None:
                raise RuntimeError("Missing opening replacement: %s" % replacement_name)
            spawn_aligned(replacement_entry, occupant_entry, "OPENING", False)
            filled_openings += 1

    decal_cfg = recipe.get("decals", {})
    decal_density = min(float(decal_cfg.get("density", 0.0)), 1.0)
    selected_decal_names = set()
    damage_sets = catalog.get("damage_decal_sets", {})
    for set_name in decal_cfg.get("sets", []):
        selected_decal_names.update(flatten_set_names(damage_sets.get(set_name, [])))

    decal_population = []
    for item in template.get("decals", []):
        name = item_name(item)
        if name in selected_decal_names:
            entry = as_entry(item, parts_by_name)
            if entry is not None:
                decal_population.append(entry)

    decal_count = round(len(decal_population) * decal_density)
    for entry in rng.sample(decal_population, decal_count):
        spawn(entry["name"], entry, "DECAL")

    debris_cfg = recipe.get("debris", {})
    debris_density = min(float(debris_cfg.get("density", 0.0)), 1.0)
    debris_population = []
    for item in template.get("debris", []):
        entry = as_entry(item, parts_by_name)
        if entry is not None:
            debris_population.append(entry)

    debris_count = round(len(debris_population) * debris_density)
    for entry in rng.sample(debris_population, debris_count):
        spawn(entry["name"], entry, "DEBRIS")

    bpy.context.view_layer.update()
    ground_records = [record for record in records if record["category"] == "GROUND"]
    if ground_records:
        ground_bounds = [
            bbox_world(record["obj"])
            for record in ground_records
            if record["obj"].type == "MESH"
        ]
        ground_min_x = min(bounds[0].x for bounds in ground_bounds)
        ground_min_y = min(bounds[0].y for bounds in ground_bounds)
        ground_max_x = max(bounds[1].x for bounds in ground_bounds)
        ground_max_y = max(bounds[1].y for bounds in ground_bounds)

        def point_on_ground(x, y):
            """Ground bbox is a rectangle but the terrain mesh is freeform;
            ray-cast down so extra debris never floats off the terrain edge."""
            for ground_record in ground_records:
                gobj = ground_record["obj"]
                if gobj.type != "MESH":
                    continue
                inv = gobj.matrix_world.inverted()
                origin = inv @ Vector((x, y, 50.0))
                direction = (inv.to_3x3() @ Vector((0.0, 0.0, -1.0))).normalized()
                hit = gobj.ray_cast(origin, direction, distance=500.0)
                if hit[0]:
                    return True
            return False

        extra_pool = [
            entry for entry in catalog.get("debris_pool", [])
            if entry.get("size_class") in ("M", "L") and entry.get("name") in parts_by_name
        ]
        extra_count = int(debris_cfg.get("import_extra", 0))

        for extra_index in range(extra_count):
            if not extra_pool:
                print("WARN debris extra skipped no_pool")
                break

            accepted = False
            for attempt in range(10):
                drop_x = rng.uniform(ground_min_x, ground_max_x)
                drop_y = rng.uniform(ground_min_y, ground_max_y)
                if not point_on_ground(drop_x, drop_y):
                    continue
                pool_entry = rng.choice(extra_pool)
                source_entry = parts_by_name[pool_entry["name"]]
                candidate = spawn(source_entry["name"], source_entry, "DEBRIS")
                candidate_obj = candidate["obj"]
                candidate_obj.location = (drop_x, drop_y, 0.0)
                bpy.context.view_layer.update()
                candidate_bounds = bbox_world(candidate_obj)
                candidate_obj.location.z -= candidate_bounds[0].z
                candidate["expected_min_z"] = 0.0
                bpy.context.view_layer.update()
                candidate_bounds = bbox_world(candidate_obj)

                intersects = False
                for existing in records[:-1]:
                    if existing["obj"].type != "MESH":
                        continue
                    if horizontal_iou(candidate_bounds, bbox_world(existing["obj"])) > 0.3:
                        intersects = True
                        break

                if not intersects:
                    accepted = True
                    break

                records.pop()
                bpy.data.objects.remove(candidate_obj, do_unlink=True)
                bpy.context.view_layer.update()

            if not accepted:
                print("WARN debris extra skipped retries=%d" % (extra_index + 1))

    props_cfg = recipe.get("props", {})
    prop_density = float(props_cfg.get("density", 0.0))
    prop_theme = props_cfg.get("theme", "")
    themed_names = flatten_set_names(catalog.get("prop_themes", {}).get(prop_theme, []))

    for item in template.get("props", []):
        entry = as_entry(item, parts_by_name)
        if entry is None:
            continue
        probability = prop_density if entry["name"] in themed_names else prop_density * 0.4
        if rng.random() < probability:
            spawn(entry["name"], entry, "PROP")

    destruction_ok = True
    if "collapse" in recipe:
        from collapse import apply_collapse
        d_parts, d_debris, d_ok = apply_collapse(records, recipe, catalog, rng, spawn)
        destruction_ok = d_ok
        print("COLLAPSE parts=%d debris=%d ok=%s" % (d_parts, d_debris, d_ok))
    elif "destruction" in recipe:
        from destruction import apply_destruction
        d_holes, d_debris, d_ok = apply_destruction(records, recipe, catalog, rng, spawn)
        destruction_ok = d_ok
        print("DESTRUCTION holes=%d debris=%d ok=%s" % (d_holes, d_debris, d_ok))

    bpy.context.view_layer.update()

    elevation_ok = True
    elevation_bad = 0

    for record in records:
        if record["obj"].type != "MESH":
            continue
        world_min_z = bbox_world(record["obj"])[0].z
        deviation = world_min_z - record["expected_min_z"]
        if abs(deviation) > 0.15:
            elevation_ok = False
            elevation_bad += 1
            print(
                "VERIFY-DETAIL elevation name=%s min_z=%.3f expected=%.3f swapped=%s" %
                (record["obj"].name, world_min_z, record["expected_min_z"], record["swapped"])
            )

    print("VERIFY elevation=%s bad=%d" % ("PASS" if elevation_ok else "FAIL", elevation_bad))

    core_records = [record for record in records if record["category"] == "CORE"]
    core_iou_ok = True
    core_iou_bad = 0
    for swapped_record in [record for record in core_records if record["swapped"]]:
        swapped_bounds = bbox_world(swapped_record["obj"])
        for other_record in core_records:
            if other_record is swapped_record:
                continue
            if bbox_iou_3d(swapped_bounds, bbox_world(other_record["obj"])) > 0.35:
                core_iou_ok = False
                core_iou_bad += 1

    print("VERIFY core_iou=%s bad=%d" % ("PASS" if core_iou_ok else "FAIL", core_iou_bad))

    anchor_total = len(openings_by_anchor)
    opening_ok = filled_openings >= anchor_total * 0.4
    print(
        "VERIFY openings=%s filled=%d total=%d" %
        ("PASS" if opening_ok else "FAIL", filled_openings, anchor_total)
    )

    material_ok = True
    material_bad = 0
    for record in records:
        obj = record["obj"]
        if obj.type != "MESH":
            continue
        if len(obj.material_slots) == 0:
            material_ok = False
            material_bad += 1
            continue
        if any(slot.material is None for slot in obj.material_slots):
            material_ok = False
            material_bad += 1

    print("VERIFY materials=%s bad=%d" % ("PASS" if material_ok else "FAIL", material_bad))

    print("VERIFY destruction=%s" % ("PASS" if destruction_ok else "FAIL"))
    verify_ok = elevation_ok and core_iou_ok and opening_ok and material_ok and destruction_ok
    return {"records": records, "out_col": out_col, "root": root, "verify_ok": verify_ok}


def main():
    started = time.time()
    args = parse_args()
    recipe_path = Path(args.recipe)
    catalog_path = Path(args.catalog)

    with recipe_path.open("r", encoding="utf-8") as handle:
        recipe = json.load(handle)
    with catalog_path.open("r", encoding="utf-8") as handle:
        catalog = json.load(handle)

    result = build_scene(recipe, catalog)
    if not result["verify_ok"]:
        print("VERIFY FAIL reason=mechanical_check")
        sys.exit(2)

    records = result["records"]
    out_col = result["out_col"]
    scene = bpy.data.scenes["KB3D_WorldWarTwo-Native"]
    output_cfg = recipe.get("output", {})

    thumb_path_text = output_cfg.get("thumb") or ""
    if thumb_path_text:
        thumb_path = Path(thumb_path_text)
        thumb_path.parent.mkdir(parents=True, exist_ok=True)

        world = bpy.data.worlds.get("World") or bpy.data.worlds.new("StudyWorld")
        scene.world = world
        world.use_nodes = True
        backgrounds = [node for node in world.node_tree.nodes if node.type == "BACKGROUND"]
        if backgrounds:
            backgrounds[0].inputs[0].default_value = (0.75, 0.78, 0.82, 1.0)
            backgrounds[0].inputs[1].default_value = 0.6

        sun_data = bpy.data.lights.new("FSun", "SUN")
        sun_data.energy = 3.5
        sun_data.angle = math.radians(8)
        sun = bpy.data.objects.new("FSun", sun_data)
        scene.collection.objects.link(sun)
        sun.rotation_euler = (math.radians(50), 0.0, math.radians(30))

        cam_data = bpy.data.cameras.new("FCam")
        cam = bpy.data.objects.new("FCam", cam_data)
        scene.collection.objects.link(cam)
        scene.camera = cam

        scene.render.engine = "CYCLES"
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
        scene.render.resolution_x = 960
        scene.render.resolution_y = 720

        for obj in bpy.data.objects:
            if obj.type == "MESH":
                obj.hide_render = obj.name not in {record["obj"].name for record in records}

        forge_mesh_bounds = [
            bbox_world(record["obj"])
            for record in records
            if record["obj"].type == "MESH"
        ]
        scene_min = Vector((
            min(bounds[0].x for bounds in forge_mesh_bounds),
            min(bounds[0].y for bounds in forge_mesh_bounds),
            min(bounds[0].z for bounds in forge_mesh_bounds),
        ))
        scene_max = Vector((
            max(bounds[1].x for bounds in forge_mesh_bounds),
            max(bounds[1].y for bounds in forge_mesh_bounds),
            max(bounds[1].z for bounds in forge_mesh_bounds),
        ))
        center = (scene_min + scene_max) * 0.5
        diag = (scene_max - scene_min).length
        radius = max(diag * 1.15, 1.0)
        azimuth = math.radians(35)
        elevation = math.radians(32)

        cam.location = center + Vector((
            radius * math.cos(elevation) * math.cos(azimuth),
            -radius * math.cos(elevation) * math.sin(azimuth),
            radius * math.sin(elevation),
        ))
        direction = center - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

        scene.render.filepath = str(thumb_path)
        bpy.ops.render.render(write_still=True, scene=scene.name)

    save_blend_text = output_cfg.get("save_blend") or ""
    if save_blend_text:
        save_blend_path = Path(save_blend_text)
        save_blend_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.data.libraries.write(str(save_blend_path), {out_col}, fake_user=True)

    elapsed = time.time() - started
    print(
        "BUILD OK name=%s parts=%d time=%.2f" %
        (recipe.get("name", ""), len(out_col.objects), elapsed)
    )


if __name__ == "__main__":
    main()
