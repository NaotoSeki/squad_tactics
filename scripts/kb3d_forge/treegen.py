import argparse
import colorsys
import math
import os
import random
import sys
import time
import zlib

import bmesh
import bpy
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from hexbake_build import ensure_hexkit_rig


SPECIES = {
    "tilia": ("round", 9.0, 11.0, 6.0, 8.0, (0.23, 0.45, 0.40)),
    "quercus": ("wide", 8.0, 10.0, 7.0, 9.0, (0.21, 0.42, 0.36)),
    "ulmus": ("tall", 9.0, 11.0, 5.0, 7.0, (0.22, 0.44, 0.38)),
    "populus": ("tall", 11.0, 13.0, 3.0, 4.5, (0.20, 0.46, 0.42)),
    "salix": ("weeping", 7.0, 9.0, 6.0, 8.0, (0.19, 0.40, 0.44)),
    "picea": ("cone", 10.0, 13.0, 4.0, 6.0, (0.30, 0.40, 0.28)),
    "larix": ("sparse_cone", 9.0, 12.0, 4.0, 6.0, (0.16, 0.50, 0.42)),
    "prunus_pink": ("round", 4.0, 6.0, 4.0, 5.5, (0.93, 0.30, 0.75)),
}

ROTATIONS = (0, 60, 120, 180, 240, 300)
DEFAULT_OUT_DIR = "C:/Projects/squad_tactics/scratch/kb3d_forge/tree_raw"


def hsv_rgb(hsv):
    return colorsys.hsv_to_rgb(hsv[0], hsv[1], hsv[2])


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def clamp(value, low, high):
    return max(low, min(high, value))


def make_material(name, color, roughness):
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    principled.inputs["Roughness"].default_value = roughness
    return material


def link_mesh_object(stage, name, bm, material, meshes):
    mesh = bpy.data.meshes.new(name + "_MESH")
    bm.to_mesh(mesh)
    bm.free()
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    stage.objects.link(obj)
    meshes.append(mesh)
    return obj


def make_cone_part(stage, name, start, end, radius1, radius2, material, meshes):
    direction = end - start
    depth = direction.length
    if depth <= 0.0001:
        return None

    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        segments=8,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
    )
    obj = link_mesh_object(stage, name, bm, material, meshes)
    obj.location = (start + end) * 0.5
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(
        direction.normalized()
    )
    return obj


def make_crown_part(stage, name, center, radius, z_scale, material, meshes, rng):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=radius)

    large_noise_amount = radius * 0.22
    small_noise_amount = radius * 0.08
    for vert in bm.verts:
        vert.co.x += rng.uniform(-large_noise_amount, large_noise_amount)
        vert.co.y += rng.uniform(-large_noise_amount, large_noise_amount)
        vert.co.z += rng.uniform(-large_noise_amount, large_noise_amount)
        vert.co.x += rng.uniform(-small_noise_amount, small_noise_amount)
        vert.co.y += rng.uniform(-small_noise_amount, small_noise_amount)
        vert.co.z += rng.uniform(-small_noise_amount, small_noise_amount)
        vert.co.z *= z_scale

    obj = link_mesh_object(stage, name, bm, material, meshes)
    obj.location = center
    return obj


def crown_components(form, height, crown_width, trunk_h, rng):
    components = []

    if form == "round":
        components.append((Vector((0.0, 0.0, height * 0.76)), crown_width * 0.30, 1.0))
        count = rng.randint(3, 5)
        for index in range(count):
            angle = (math.tau * index / count) + rng.uniform(-0.18, 0.18)
            distance = crown_width * rng.uniform(0.19, 0.25)
            center = Vector((
                math.cos(angle) * distance,
                math.sin(angle) * distance,
                height * rng.uniform(0.62, 0.70),
            ))
            components.append((center, crown_width * rng.uniform(0.17, 0.20), 1.0))

    elif form == "wide":
        count = rng.randint(4, 6)
        for index in range(count):
            fraction = -0.31 + (0.62 * index / max(1, count - 1))
            center = Vector((
                crown_width * fraction,
                crown_width * rng.uniform(-0.06, 0.06),
                height * rng.uniform(0.57, 0.66),
            ))
            components.append((center, crown_width * rng.uniform(0.135, 0.152), 1.0))

    elif form == "tall":
        count = rng.randint(2, 4)
        for index in range(count):
            fraction = index / max(1, count - 1)
            center = Vector((
                crown_width * rng.uniform(-0.18, 0.18),
                crown_width * rng.uniform(-0.10, 0.10),
                height * (0.58 + 0.29 * fraction),
            ))
            components.append((center, crown_width * rng.uniform(0.22, 0.256), 1.0))

    elif form == "cone":
        count = rng.randint(3, 5)
        for index in range(count):
            fraction = index / max(1, count - 1)
            radius_factor = 0.40 - (0.28 * fraction)
            center = Vector((
                crown_width * rng.uniform(-0.025, 0.025),
                crown_width * rng.uniform(-0.025, 0.025),
                height * (0.53 + 0.37 * fraction),
            ))
            components.append((center, crown_width * radius_factor, 1.0))

    elif form == "weeping":
        components.append((Vector((0.0, 0.0, height * 0.70)), crown_width * 0.24, 1.4))
        count = rng.randint(4, 6)
        for index in range(count):
            angle = (math.tau * index / count) + rng.uniform(-0.16, 0.16)
            distance = crown_width * rng.uniform(0.19, 0.25)
            center = Vector((
                math.cos(angle) * distance,
                math.sin(angle) * distance,
                height * rng.uniform(0.45, 0.53),
            ))
            components.append((center, crown_width * rng.uniform(0.17, 0.20), 1.4))

    elif form == "sparse_cone":
        for index, radius_factor in enumerate((0.40, 0.25, 0.14)):
            center = Vector((
                crown_width * rng.uniform(-0.025, 0.025),
                crown_width * rng.uniform(-0.025, 0.025),
                height * (0.58 + 0.16 * index),
            ))
            components.append((center, crown_width * radius_factor, 1.0))

    return components


def descendants(root):
    result = []

    def visit(obj):
        for child in obj.children:
            visit(child)
        result.append(obj)

    visit(root)
    return result


def world_bbox_min_z(root):
    minimum = None
    for obj in descendants(root):
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            if minimum is None or point.z < minimum:
                minimum = point.z
    return 0.0 if minimum is None else minimum


def build_tree(stage, species_name, variant):
    form, height_lo, height_hi, width_lo, width_hi, leaf_hsv = SPECIES[species_name]
    seed = zlib.crc32((species_name + str(variant)).encode("utf-8"))
    rng = random.Random(seed)

    height = rng.uniform(height_lo, height_hi)
    crown_width = rng.uniform(width_lo, min(width_hi, 8.8))
    trunk_ratio = 0.50 if form == "weeping" else rng.uniform(0.32, 0.38)
    trunk_h = height * trunk_ratio
    base_r = clamp(height * rng.uniform(0.018, 0.027), 0.12, 0.35)

    bark_color = hsv_rgb((0.07, 0.35, 0.22))
    leaf_hsv = (
        (leaf_hsv[0] + rng.uniform(-0.02, 0.02)) % 1.0,
        clamp(leaf_hsv[1] + rng.uniform(-0.05, 0.05), 0.0, 1.0),
        clamp(leaf_hsv[2] + rng.uniform(-0.05, 0.05), 0.0, 1.0),
    )
    leaf_color = hsv_rgb(leaf_hsv)
    leaf_dark_color = hsv_rgb((
        leaf_hsv[0],
        leaf_hsv[1],
        clamp(leaf_hsv[2] - rng.uniform(0.06, 0.10), 0.0, 1.0),
    ))
    bark_color = tuple(srgb_to_linear(channel) for channel in bark_color)
    leaf_color = tuple(srgb_to_linear(channel) for channel in leaf_color)
    leaf_dark_color = tuple(srgb_to_linear(channel) for channel in leaf_dark_color)

    bark_material = make_material("TREE_BARK", bark_color, 0.9)
    leaf_material = make_material("TREE_LEAF", leaf_color, 0.85)
    leaf_dark_material = make_material("TREE_LEAF_DARK", leaf_dark_color, 0.85)
    materials = [bark_material, leaf_material, leaf_dark_material]
    meshes = []

    root = bpy.data.objects.new("TREE_ROOT", None)
    stage.objects.link(root)

    trunk = make_cone_part(
        stage,
        "TREE_TRUNK",
        Vector((0.0, 0.0, 0.0)),
        Vector((0.0, 0.0, trunk_h)),
        base_r,
        base_r * 0.45,
        bark_material,
        meshes,
    )
    trunk.parent = root

    branch_count = rng.randint(2, 4)
    for index in range(branch_count):
        angle = (math.tau * index / branch_count) + rng.uniform(-0.35, 0.35)
        tilt = math.radians(rng.uniform(30.0, 55.0))
        start_z = trunk_h * rng.uniform(0.76, 0.94)
        length = min(crown_width * rng.uniform(0.20, 0.28), height * 0.19)
        start = Vector((0.0, 0.0, start_z))
        end = start + Vector((
            math.cos(angle) * math.sin(tilt) * length,
            math.sin(angle) * math.sin(tilt) * length,
            math.cos(tilt) * length,
        ))
        branch = make_cone_part(
            stage,
            "TREE_BRANCH_%02d" % index,
            start,
            end,
            base_r * rng.uniform(0.28, 0.42),
            base_r * 0.08,
            bark_material,
            meshes,
        )
        if branch is not None:
            branch.parent = root

    for index, (center, radius, z_scale) in enumerate(
        crown_components(form, height, crown_width, trunk_h, rng)
    ):
        crown = make_crown_part(
            stage,
            "TREE_CROWN_%02d" % index,
            center,
            radius,
            z_scale,
            leaf_material if rng.random() < 0.5 else leaf_dark_material,
            meshes,
            rng,
        )
        crown.parent = root

    bpy.context.view_layer.update()
    root.location.z -= world_bbox_min_z(root)
    bpy.context.view_layer.update()

    return root, meshes, materials


def remove_tree(root, meshes, materials):
    for obj in descendants(root):
        bpy.data.objects.remove(obj, do_unlink=True)

    for mesh in meshes:
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)

    for material in materials:
        if material.users == 0:
            bpy.data.materials.remove(material)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--species", default="all")
    parser.add_argument("--variants", type=int, default=3)
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args(argv)

    if args.variants < 1:
        parser.error("--variants must be at least 1")

    if args.species == "all":
        selected = list(SPECIES.keys())
    else:
        selected = [item.strip() for item in args.species.split(",") if item.strip()]
        invalid = [item for item in selected if item not in SPECIES]
        if invalid:
            parser.error("unknown species: %s" % ",".join(invalid))
        if not selected:
            parser.error("--species must not be empty")

    return args, selected


def render_tree(scene, root, output_path, rotation):
    root.rotation_mode = "XYZ"
    root.rotation_euler.z = math.radians(rotation)
    bpy.context.view_layer.update()
    scene.render.filepath = output_path
    bpy.ops.render.render(write_still=True, scene="HexKit")


def main():
    args, selected_species = parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    scene, stage = ensure_hexkit_rig()

    if args.smoke:
        root = None
        meshes = []
        materials = []
        try:
            root, meshes, materials = build_tree(stage, "picea", 0)
            output_path = os.path.join(args.out_dir, "tree_picea_v0_rot0.png")
            render_tree(scene, root, output_path, 0)
        finally:
            if root is not None:
                remove_tree(root, meshes, materials)
        print("TREEGEN SMOKE OK")
        return

    started = time.perf_counter()
    tiles = 0

    for species_name in selected_species:
        for variant in range(args.variants):
            root = None
            meshes = []
            materials = []
            try:
                root, meshes, materials = build_tree(stage, species_name, variant)
                for rotation in ROTATIONS:
                    output_name = "tree_%s_v%d_rot%d.png" % (
                        species_name,
                        variant,
                        rotation,
                    )
                    output_path = os.path.join(args.out_dir, output_name)
                    render_tree(scene, root, output_path, rotation)
                    tiles += 1
            finally:
                if root is not None:
                    remove_tree(root, meshes, materials)

    elapsed = time.perf_counter() - started
    print(
        "TREEGEN OK species=%d variants=%d tiles=%d time=%.1f"
        % (len(selected_species), args.variants, tiles, elapsed)
    )


if __name__ == "__main__":
    main()
