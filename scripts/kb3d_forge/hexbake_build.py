import argparse
import json
import math
import os
import sys
import time

import bmesh
import bpy
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import forge_build
from paths import DEFAULT_CATALOG_OUT


DEFAULT_OUT_DIR = "C:/Projects/squad_tactics/asset/environment/hex_tiles_v8"


def get_or_link_collection(scene, name):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
    if not any(child == col for child in scene.collection.children):
        scene.collection.children.link(col)
    return col


def link_object_to_collection(obj, collection):
    if not any(col == collection for col in obj.users_collection):
        collection.objects.link(obj)


def remove_object_if_wrong_type(name, obj_type):
    obj = bpy.data.objects.get(name)
    if obj is not None and obj.type != obj_type:
        bpy.data.objects.remove(obj, do_unlink=True)
        obj = None
    return obj


def ensure_camera(rig):
    cam = remove_object_if_wrong_type("HK_Camera", "CAMERA")
    if cam is None:
        data = bpy.data.cameras.new("HK_Camera")
        cam = bpy.data.objects.new("HK_Camera", data)
    link_object_to_collection(cam, rig)

    theta = math.radians(55.0)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 20.25
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.clip_start = 0.1
    cam.data.clip_end = 300.0
    cam.location = (
        0.0,
        3.0 - 60.0 * math.cos(theta),
        60.0 * math.sin(theta),
    )
    cam.rotation_euler = (math.radians(35.0), 0.0, 0.0)
    return cam


def ensure_sun(rig):
    sun = remove_object_if_wrong_type("HK_Sun", "LIGHT")
    if sun is None:
        data = bpy.data.lights.new("HK_Sun", "SUN")
        sun = bpy.data.objects.new("HK_Sun", data)
    elif sun.data.type != "SUN":
        bpy.data.objects.remove(sun, do_unlink=True)
        data = bpy.data.lights.new("HK_Sun", "SUN")
        sun = bpy.data.objects.new("HK_Sun", data)

    link_object_to_collection(sun, rig)
    sun.data.energy = 4.2
    sun.data.angle = math.radians(5.0)
    sun.data.color = (1.0, 0.93, 0.82)

    elevation = math.radians(62.0)
    azimuth = math.radians(45.0)
    direction = Vector((
        math.cos(elevation) * math.sin(azimuth),
        math.cos(elevation) * math.cos(azimuth),
        -math.sin(elevation),
    ))
    sun.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return sun


def ensure_shadow_catcher(rig):
    shadow = remove_object_if_wrong_type("HK_ShadowCatcher", "MESH")
    if shadow is None:
        mesh = bpy.data.meshes.new("HK_ShadowCatcher")
        shadow = bpy.data.objects.new("HK_ShadowCatcher", mesh)
    else:
        mesh = shadow.data
        mesh.clear_geometry()

    link_object_to_collection(shadow, rig)

    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    shadow.location = (0.0, 0.0, 0.0)
    shadow.rotation_euler = (0.0, 0.0, 0.0)
    shadow.scale = (1.0, 1.0, 1.0)
    shadow.is_shadow_catcher = True
    shadow.hide_render = False
    return shadow


def ensure_world():
    world = bpy.data.worlds.get("HK_World")
    if world is None:
        world = bpy.data.worlds.new("HK_World")
    world.use_nodes = True

    background = None
    for node in world.node_tree.nodes:
        if node.type == "BACKGROUND":
            background = node
            break
    if background is None:
        background = world.node_tree.nodes.new("ShaderNodeBackground")

    background.inputs["Color"].default_value = (0.45, 0.52, 0.62, 1.0)
    background.inputs["Strength"].default_value = 0.58
    return world


def configure_cycles(scene):
    # This host has no GPU (CUEW init fails); kbres tiles were baked on CPU.
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"
    scene.render.use_persistent_data = True


def ensure_hexkit_rig():
    scene = bpy.data.scenes.get("HexKit")
    if scene is None:
        scene = bpy.data.scenes.new("HexKit")

    stage = get_or_link_collection(scene, "STAGE")
    rig = get_or_link_collection(scene, "RIG")

    camera = ensure_camera(rig)
    ensure_sun(rig)
    ensure_shadow_catcher(rig)

    scene.camera = camera
    scene.world = ensure_world()
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = 288
    scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100

    theta = math.radians(55.0)
    scene.render.pixel_aspect_x = 1.0 / math.sin(theta)
    scene.render.pixel_aspect_y = 1.0
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "High Contrast"
    configure_cycles(scene)
    return scene, stage


def clear_stage(stage):
    for obj in list(stage.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def mesh_world_points(collection):
    points = []
    for obj in collection.all_objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))
    return points


def bounds_xy(points):
    if not points:
        raise RuntimeError("FORGE_OUT contains no mesh bounds")
    xs = [point.x for point in points]
    ys = [point.y for point in points]
    return min(xs), max(xs), min(ys), max(ys)


def instanced_bounds_xy(source_points, inst):
    points = [inst.matrix_world @ point for point in source_points]
    return bounds_xy(points)


def center_instance_xy(source_points, inst):
    bpy.context.view_layer.update()
    min_x, max_x, min_y, max_y = instanced_bounds_xy(source_points, inst)
    inst.location.x -= (min_x + max_x) * 0.5
    inst.location.y -= (min_y + max_y) * 0.5
    bpy.context.view_layer.update()


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--recipe", required=True)
    parser.add_argument("--catalog", default=str(DEFAULT_CATALOG_OUT))
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    return parser.parse_args(argv)


def main():
    args = parse_args()
    started = time.time()

    with open(args.recipe, "r", encoding="utf-8") as handle:
        recipe = json.load(handle)
    with open(args.catalog, "r", encoding="utf-8") as handle:
        catalog = json.load(handle)

    result = forge_build.build_scene(
        recipe,
        catalog,
        skip_ground=bool(recipe.get("hex")),
    )
    if not result.get("verify_ok"):
        print("VERIFY FAIL reason=mechanical_check")
        sys.exit(2)

    scene, stage = ensure_hexkit_rig()
    clear_stage(stage)

    out_col = result["out_col"]
    inst = bpy.data.objects.new("HK_ForgeInstance", None)
    inst.empty_display_type = "PLAIN_AXES"
    inst.instance_type = "COLLECTION"
    inst.instance_collection = out_col
    stage.objects.link(inst)

    source_points = mesh_world_points(out_col)
    min_x, max_x, min_y, max_y = bounds_xy(source_points)
    foot = max(max_x - min_x, max_y - min_y)
    scale = 1.0

    if foot > 13.0:
        scale = 13.0 / foot
        # kbres precedent had no floor and Residential tiles at ~0.55 looked
        # right at 288x384; 0.5 only rejects the giant set pieces (Checkpoint).
        if scale < 0.5:
            print("SKIP too large foot=%.1f" % foot)
            sys.exit(3)

    print("HEXSCALE foot=%.2f scale=%.3f" % (foot, scale))

    os.makedirs(args.out_dir, exist_ok=True)
    tile = recipe["name"].lower().replace("forge_", "kbldg_", 1)

    for rot in (0, 60, 120, 180, 240, 300):
        inst.location = (0.0, 0.0, 0.0)
        inst.scale = (scale, scale, scale)
        inst.rotation_euler = (0.0, 0.0, math.radians(rot))
        center_instance_xy(source_points, inst)

        scene.render.filepath = os.path.join(
            args.out_dir,
            "%s_rot%d.png" % (tile, rot),
        )
        bpy.ops.render.render(write_still=True, scene="HexKit")

    print(
        "HEXBAKE OK name=%s tiles=6 time=%.1f"
        % (recipe["name"], time.time() - started)
    )


if __name__ == "__main__":
    main()
