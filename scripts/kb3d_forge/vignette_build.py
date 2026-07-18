import argparse
import json
import math
import random
import sys
import time
import zlib
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import paths
from hexbake_build import ensure_hexkit_rig


VIGNETTES = {
    "woodpile": [("WoodPlanks", 2, 1.0), ("Barrel", 2, 0.9), ("CrateA", 1, 0.8)],
    "cart": [("Wagon", 1, 0.0), ("Crate", 2, 1.4), ("Barrel", 1, 1.6)],
    "brokencart": [("Brokenwagon", 1, 0.0), ("WoodDebris", 1, 1.5), ("Barrel", 1, 1.7)],
    "defense": [("SandBags", 3, 1.2), ("AmmoBox", 2, 1.0), ("Barricade", 1, 2.0)],
    "camp_rest": [
        ("Stretcher", 1, 0.0),
        ("SleepingBag", 1, 1.5),
        ("Crate", 1, 1.8),
        ("Lantern", 1, 1.2),
    ],
    "market": [
        ("Table", 1, 0.0),
        ("Bench", 1, 1.3),
        ("Barrel", 1, 1.6),
        ("GlassBottles", 1, 0.5),
    ],
}

ROTATIONS = (0, 60, 120, 180, 240, 300)


def ascii_text(value):
    return str(value).encode("ascii", "ignore").decode("ascii")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--vignettes", default="all")
    parser.add_argument("--variants", type=int, default=2)
    parser.add_argument("--catalog", default=str(paths.DEFAULT_CATALOG_OUT))
    parser.add_argument(
        "--out-dir",
        default="C:/Projects/squad_tactics/scratch/kb3d_forge/vig_raw",
    )
    parser.add_argument("--smoke", action="store_true")
    return parser.parse_args(argv)


def load_catalog(catalog_path):
    with open(catalog_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def get_vig_collection():
    existing = bpy.data.collections.get("VIG_OUT")
    if existing is not None:
        bpy.data.collections.remove(existing)

    vig_collection = bpy.data.collections.new("VIG_OUT")
    # A collection outside every scene is not in the depsgraph, so its
    # instance renders empty (verified). Link it to the KB3D scene like
    # hexbake does with FORGE_OUT; that scene is never rendered here.
    bpy.data.scenes["KB3D_WorldWarTwo-Native"].collection.children.link(vig_collection)
    return vig_collection


def clear_vig_collection(vig_collection):
    for obj in list(vig_collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def remove_subsurf_modifiers(obj):
    for modifier in list(obj.modifiers):
        if modifier.type == "SUBSURF":
            obj.modifiers.remove(modifier)


def world_bbox_min_z(obj):
    return min((obj.matrix_world @ Vector(corner)).z for corner in obj.bound_box)


def spawn_part(source, vig_collection, location, rotation_degrees):
    obj = source.copy()
    if source.data is not None:
        obj.data = source.data
    obj.name = "VIG_" + source.name
    vig_collection.objects.link(obj)
    remove_subsurf_modifiers(obj)
    obj.parent = None  # source props hang under showroom grp Empties

    obj.location = location
    obj.rotation_euler[2] = math.radians(rotation_degrees)
    bpy.context.view_layer.update()

    obj.location.z -= world_bbox_min_z(obj)
    bpy.context.view_layer.update()
    return obj


def part_candidates(catalog, part):
    candidates = []
    for entry in catalog.get("parts", []):
        if entry.get("cls") != "PROP":
            continue
        if part.lower() not in entry.get("part", "").lower():
            continue
        name = entry.get("name")
        if name and bpy.data.objects.get(name) is not None:
            candidates.append(name)
    return candidates


def populate_vignette(catalog, vig_collection, vig_name, variant):
    seed = zlib.crc32((vig_name + str(variant)).encode("utf-8"))
    rng = random.Random(seed)
    parts = VIGNETTES[vig_name]

    for part, count, radius in parts:
        candidates = part_candidates(catalog, part)
        if not candidates:
            print("WARN no PROP match %s" % ascii_text(part))
            continue

        for index in range(count):
            source = bpy.data.objects[candidates[rng.randrange(len(candidates))]]

            if radius == 0.0:
                x = 0.0
                y = 0.0
            else:
                angle = math.tau * (index / count) + rng.uniform(-0.45, 0.45)
                jittered_radius = min(3.5, max(0.0, radius + rng.uniform(-0.4, 0.4)))
                x = math.cos(angle) * jittered_radius
                y = math.sin(angle) * jittered_radius

            spawn_part(
                source,
                vig_collection,
                (x, y, 0.0),
                rng.uniform(0.0, 360.0),
            )


def get_instance_empty(stage, vig_collection):
    instance = bpy.data.objects.get("VIG_STAGE_INSTANCE")
    if instance is None:
        instance = bpy.data.objects.new("VIG_STAGE_INSTANCE", None)
        instance.empty_display_type = "PLAIN_AXES"
        instance.empty_display_size = 0.01
        stage.objects.link(instance)
    elif instance.name not in stage.objects:
        stage.objects.link(instance)

    instance.instance_type = "COLLECTION"
    instance.instance_collection = vig_collection
    instance.location = (0.0, 0.0, 0.0)
    instance.rotation_euler = (0.0, 0.0, 0.0)
    return instance


def render_tile(scene, instance, out_dir, vig_name, variant, rotation):
    instance.rotation_euler[2] = math.radians(rotation)
    bpy.context.view_layer.update()

    filename = "vig_%s_v%d_rot%d.png" % (vig_name, variant, rotation)
    scene.render.filepath = str(out_dir / filename)
    bpy.ops.render.render(write_still=True, scene="HexKit")


def selected_vignettes(value):
    if value == "all":
        return list(VIGNETTES.keys())

    selected = [name.strip() for name in value.split(",") if name.strip()]
    invalid = [name for name in selected if name not in VIGNETTES]
    if invalid:
        raise ValueError("Unknown vignettes: " + ", ".join(invalid))
    return selected


def main():
    args = parse_args()
    start_time = time.time()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    bpy.ops.file.find_missing_files(directory=str(paths.TEX2K_DIR))

    catalog = load_catalog(args.catalog)
    scene, stage = ensure_hexkit_rig()
    vig_collection = get_vig_collection()
    instance = get_instance_empty(stage, vig_collection)

    if args.smoke:
        vignette_names = ["woodpile"]
        variants = [0]
        rotations = (0,)
    else:
        vignette_names = selected_vignettes(args.vignettes)
        variants = list(range(args.variants))
        rotations = ROTATIONS

    tiles = 0
    for vig_name in vignette_names:
        for variant in variants:
            populate_vignette(catalog, vig_collection, vig_name, variant)
            for rotation in rotations:
                render_tile(scene, instance, out_dir, vig_name, variant, rotation)
                tiles += 1
            clear_vig_collection(vig_collection)

    elapsed = time.time() - start_time
    print(
        "VIGNETTE OK vignettes=%d variants=%d tiles=%d time=%.1f"
        % (len(vignette_names), len(variants), tiles, elapsed)
    )


if __name__ == "__main__":
    main()
