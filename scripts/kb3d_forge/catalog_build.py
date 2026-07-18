"""Build the KB3D WW2 object parts catalog inside Blender."""

import argparse
import datetime
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import bpy
from mathutils import Vector


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from paths import DEFAULT_CATALOG_OUT


TARGET_SCENE = "KB3D_WorldWarTwo-Native"
NAME_RE = re.compile(r"^KB3D_WWT_([A-Za-z0-9]+?)_([A-Z])(?:_(.+))?$")

CORE_RE = re.compile(
    r"^(Building|Tower|Dome|Bridge|Platform|Mezzanine|CommsCenter|Shed|"
    r"MainTent|Tent|OPsTent|WaterTower|SpeakerTower|Porch|WoodenStructure|"
    r"CrateShak)"
)
OPENING_RE = re.compile(r"^(Door|Window|GateDoor)")
GROUND_RE = re.compile(r"^(Ground|Floor)")
STRUCT_RE = re.compile(
    r"^(PerimeterWall|Stairs|Archway|Corner|Guardrail|Awning|"
    r"MakeshiftBalcony|GateBase|Gate$|Well|StonePath|WoodDeck|Banners)"
)
MILITARY_RE = re.compile(
    r"(SandBag|Ammo|Barricade|MachineGun|Mortar|Rifle|Gun|Grenade|"
    r"AACannon|AAGun|Stretcher)",
    re.IGNORECASE,
)
CHURCH_RE = re.compile(r"(Altar|Pew|BookStand|Banners)", re.IGNORECASE)


def ascii_text(value):
    """Return a console-safe ASCII representation."""
    return str(value).encode("ascii", "backslashreplace").decode("ascii")


def parse_args():
    """Parse only arguments following Blender's double-dash separator."""
    argv = sys.argv
    script_args = argv[argv.index("--") + 1:] if "--" in argv else []

    parser = argparse.ArgumentParser(
        description="Build a KB3D WW2 parts catalog from the active blend."
    )
    parser.add_argument(
        "--out",
        default=str(DEFAULT_CATALOG_OUT),
        help="Output parts_catalog.json path.",
    )
    return parser.parse_args(script_args)


def parse_name(name):
    """Parse a KB3D object name into family, variant, and part."""
    match = NAME_RE.match(name)
    if not match:
        return None
    return {
        "family": match.group(1),
        "variant": match.group(2),
        "part": match.group(3),
    }


def classify_part(part):
    """Return the catalog class for a parsed part name."""
    if part is None:
        return None
    if CORE_RE.match(part):
        return "CORE"
    if OPENING_RE.match(part):
        return "OPENING"
    if part.startswith("Decal"):
        return "DECAL"
    if part.startswith("Debris"):
        return "DEBRIS"
    if GROUND_RE.match(part):
        return "GROUND"
    if STRUCT_RE.match(part):
        return "STRUCT"
    return "PROP"


def world_bbox_relative(obj, grp):
    """Measure an object's world-transformed bbox in group-local coordinates."""
    group_inverse = grp.matrix_world.inverted()
    corners = [
        group_inverse @ (obj.matrix_world @ Vector(corner))
        for corner in obj.bound_box
    ]
    minimum = [
        min(corner[index] for corner in corners)
        for index in range(3)
    ]
    maximum = [
        max(corner[index] for corner in corners)
        for index in range(3)
    ]
    return minimum, maximum


def vector_list(vector):
    """Convert a Blender vector to JSON-compatible floats."""
    return [float(vector.x), float(vector.y), float(vector.z)]


def bbox_dimensions(bb_minimum, bb_maximum):
    """Return bbox extents."""
    return [
        float(bb_maximum[index] - bb_minimum[index])
        for index in range(3)
    ]


def opening_kind(part, dimensions):
    """Classify an opening using its name and normalized bbox height."""
    if re.search(r"(Left|Right)", part):
        return "door_wing" if dimensions[2] >= 1.5 else "shutter"
    return "door"


def opening_cluster_id(kind, dimensions):
    """Build the stable opening dimension cluster identifier."""
    horizontal = sorted((abs(dimensions[0]), abs(dimensions[1])))
    width = horizontal[-1]
    height = abs(dimensions[2])
    return "{}_{:.1f}x{:.1f}".format(kind, width, height)


def decal_theme(part):
    """Return the configured damage decal set name, or None."""
    lowered = part.lower()
    if "bulletholes" in lowered:
        return "bullet"
    if "crack" in lowered:
        return "crack"
    if "decaldamage" in lowered:
        return "damage"
    if "grunge" in lowered or "leakes" in lowered or "leaks" in lowered:
        return "grunge"
    return None


def debris_size_class(vertex_count):
    """Return the configured debris size class."""
    if vertex_count < 500:
        return "S"
    if vertex_count < 5000:
        return "M"
    return "L"


def prop_theme(part):
    """Return the configured prop theme."""
    if MILITARY_RE.search(part):
        return "military"
    if CHURCH_RE.search(part):
        return "church"
    return "domestic"


def object_materials(obj):
    """Return non-empty material names in slot order."""
    if not hasattr(obj, "material_slots"):
        return []
    return [
        slot.material.name
        for slot in obj.material_slots
        if slot.material is not None
    ]


def build_catalog(scene):
    """Scan the target scene and return the catalog dictionary and warnings."""
    warnings = []
    groups = {}
    templates = {}

    for obj in sorted(scene.objects, key=lambda item: item.name):
        if not obj.name.startswith("KB3D_WWT_") or not obj.name.endswith("_grp"):
            continue

        parsed = parse_name(obj.name)
        if parsed is None or parsed["part"] != "grp":
            warnings.append((obj.name, "invalid_group_name"))
            continue

        groups[obj.name] = obj
        template_name = "{}_{}".format(parsed["family"], parsed["variant"])
        templates[obj.name] = {
            "name": template_name,
            "grp": obj.name,
            "cores": [],
            "ground": [],
            "struct": [],
            "openings": [],
            "decals": [],
            "debris": [],
            "props": [],
        }

    parts = []
    part_by_name = {}
    class_counts = Counter()

    for obj in sorted(scene.objects, key=lambda item: item.name):
        if not obj.name.startswith("KB3D_WWT_") or obj.name.endswith("_grp"):
            continue

        parsed = parse_name(obj.name)
        if parsed is None or parsed["part"] is None:
            warnings.append((obj.name, "unparsed_part_name"))
            family = ""
            variant = ""
            part = obj.name
            cls = "PROP"
            grp_name = ""
            grp = None
        else:
            family = parsed["family"]
            variant = parsed["variant"]
            part = parsed["part"]
            cls = classify_part(part)
            if cls is None:
                warnings.append((obj.name, "missing_part_component"))
                cls = "PROP"
            grp_name = "KB3D_WWT_{}_{}_grp".format(family, variant)
            grp = groups.get(grp_name)
            if grp is None:
                warnings.append((obj.name, "missing_group"))

        if grp is not None:
            relative_matrix = grp.matrix_world.inverted() @ obj.matrix_world
            rel_loc = vector_list(relative_matrix.translation)
            bb_minimum, bb_maximum = world_bbox_relative(obj, grp)
        else:
            rel_loc = vector_list(obj.matrix_world.translation)
            bb_minimum = rel_loc[:]
            bb_maximum = rel_loc[:]

        dimensions = bbox_dimensions(bb_minimum, bb_maximum)
        vertex_count = (
            len(obj.data.vertices)
            if obj.type == "MESH" and obj.data is not None
            else 0
        )

        record = {
            "name": obj.name,
            "family": family,
            "variant": variant,
            "part": part,
            "cls": cls,
            "grp": grp_name,
            "rel_loc": rel_loc,
            "rot": [
                float(obj.rotation_euler.x),
                float(obj.rotation_euler.y),
                float(obj.rotation_euler.z),
            ],
            "scale": [
                float(obj.scale.x),
                float(obj.scale.y),
                float(obj.scale.z),
            ],
            "dim": dimensions,
            "bb_min_rel": bb_minimum,
            "bb_max_rel": bb_maximum,
            "verts": vertex_count,
            "mats": object_materials(obj),
        }
        parts.append(record)
        part_by_name[obj.name] = record
        class_counts[cls] += 1

    cluster_members = defaultdict(list)
    damage_sets = {
        "bullet": [],
        "crack": [],
        "damage": [],
        "grunge": [],
    }
    debris_pool = []
    prop_themes = {
        "military": [],
        "domestic": [],
        "church": [],
    }

    for record in parts:
        template = templates.get(record["grp"])
        if template is not None:
            if record["cls"] == "CORE":
                template["cores"].append(record["name"])
            elif record["cls"] == "GROUND":
                template["ground"].append(record["name"])
            elif record["cls"] == "STRUCT":
                template["struct"].append(record["name"])
            elif record["cls"] == "DECAL":
                template["decals"].append(record["name"])
            elif record["cls"] == "DEBRIS":
                template["debris"].append(record["name"])
            elif record["cls"] == "PROP":
                template["props"].append(record["name"])
            elif record["cls"] == "OPENING":
                kind = opening_kind(record["part"], record["dim"])
                cluster = opening_cluster_id(kind, record["dim"])
                cluster_members[cluster].append(record["name"])
                template["openings"].append(
                    {
                        "anchor_id": "",
                        "occupant": record["name"],
                        "kind": kind,
                        "rel_loc": record["rel_loc"],
                        "rot": record["rot"],
                        "dim": record["dim"],
                        "cluster": cluster,
                    }
                )

        if record["cls"] == "DECAL":
            theme = decal_theme(record["part"])
            if theme is not None:
                damage_sets[theme].append(record["name"])

        if record["cls"] == "DEBRIS":
            debris_pool.append(
                {
                    "name": record["name"],
                    "dim": record["dim"],
                    "verts": record["verts"],
                    "size_class": debris_size_class(record["verts"]),
                }
            )

        if record["cls"] == "PROP":
            prop_themes[prop_theme(record["part"])].append(record["name"])

    for template in templates.values():
        template["cores"].sort()
        template["ground"].sort()
        template["struct"].sort()
        template["decals"].sort()
        template["debris"].sort()
        template["props"].sort()
        template["openings"].sort(key=lambda opening: opening["occupant"])

        for index, opening in enumerate(template["openings"]):
            opening["anchor_id"] = "{}_op_{:02d}".format(
                template["name"], index
            )

    opening_clusters = {}
    for cluster_name in sorted(cluster_members):
        members = sorted(cluster_members[cluster_name])
        opening_clusters[cluster_name] = {
            "members": members,
            "swappable": len(members) >= 2,
        }

    for values in damage_sets.values():
        values.sort()
    for values in prop_themes.values():
        values.sort()
    debris_pool.sort(key=lambda item: item["name"])

    catalog = {
        "meta": {
            "source": bpy.data.filepath,
            "generated": datetime.datetime.now(
                datetime.timezone.utc
            ).replace(microsecond=0).isoformat(),
            "blender": bpy.app.version_string,
        },
        "parts": parts,
        "templates": [
            templates[name]
            for name in sorted(
                templates,
                key=lambda group_name: templates[group_name]["name"],
            )
        ],
        "opening_clusters": opening_clusters,
        "damage_decal_sets": damage_sets,
        "debris_pool": debris_pool,
        "prop_themes": prop_themes,
    }
    return catalog, class_counts, warnings


def write_catalog(catalog, output_path):
    """Write UTF-8 JSON with the configured indentation."""
    output = Path(output_path)
    if output.parent != Path("."):
        output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        json.dump(catalog, handle, ensure_ascii=False, indent=1)
        handle.write("\n")


def main():
    """Run the catalog build."""
    args = parse_args()
    scene = bpy.data.scenes.get(TARGET_SCENE)
    if scene is None:
        raise RuntimeError("Target scene not found: {}".format(TARGET_SCENE))

    bpy.context.view_layer.update()

    catalog, class_counts, warnings = build_catalog(scene)
    write_catalog(catalog, args.out)

    print("STATS parts={}".format(len(catalog["parts"])))
    for cls in ("CORE", "OPENING", "DECAL", "DEBRIS", "GROUND", "STRUCT", "PROP"):
        print("STATS class_{}={}".format(cls, class_counts.get(cls, 0)))
    print("STATS templates={}".format(len(catalog["templates"])))
    print("STATS clusters={}".format(len(catalog["opening_clusters"])))
    print("STATS warnings={}".format(len(warnings)))

    for name, reason in warnings:
        print(
            "WARN name={} reason={}".format(
                ascii_text(name),
                ascii_text(reason),
            )
        )

    print("DONE out={}".format(ascii_text(args.out)))


if __name__ == "__main__":
    main()
