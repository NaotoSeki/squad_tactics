# -*- coding: utf-8 -*-
"""High-impact transparent detail overlays for HexKit v7.

This file is executed by ``batch_render.py`` after ``gen_extras.py`` so it can
reuse the established mesh/material/render helpers. All randomness uses fixed
integer seeds; Python's process-randomized ``hash()`` is intentionally avoided.
The live scene is calibrated to the current 288x384 contract but is never saved.
"""
import bpy
import bmesh
import json
import math
import os
import random
import re
from mathutils import Euler, Vector, noise


DETAIL_REQUIRED_HELPERS = (
    "new_obj", "get_kit_col", "ph_mat", "plain_mat", "noisy_mat",
    "add_box_at", "add_branch", "stage_and_render",
)
DETAIL_REQUIRED_TEXTURES = (
    "old_planks_02",
    "brick_gravel",
    "broken_brick_wall",
    "cobblestone_floor_01",
)
DETAIL_SOURCE_BLEND = "ww2_hex_module.blend"
DETAIL_OUT = "C:/Projects/squad_tactics/asset/environment/hex_tiles_v7"
DETAIL_WIDTH = 288
DETAIL_HEIGHT = 384
DETAIL_HEX_R_PX = 128
DETAIL_ANCHOR = (144.0, 234.5)
DETAIL_HEX_R_M = 9.0
DETAIL_VIEW_W = 20.25
DETAIL_THETA_DEG = 55.0
DETAIL_TARGET_Y = (DETAIL_ANCHOR[1] - DETAIL_HEIGHT / 2) / (
    DETAIL_WIDTH / DETAIL_VIEW_W
)

DETAIL_NAME_RE = re.compile(
    r"(?:tree_v[5-9]_rot0|veg_v[3-5]_rot0|"
    r"track_v[0-3]_rot(?:0|60|120)|"
    r"fieldrows_v[0-3]_rot(?:0|60|120)|"
    r"cobble_detail_v[0-5])\.png"
)


def _require_helpers():
    missing = [name for name in DETAIL_REQUIRED_HELPERS if name not in globals()]
    if missing:
        raise RuntimeError(
            "gen_detail.py must be loaded by batch_render.py after gen_extras.py; "
            "missing helpers: " + ", ".join(missing)
        )


def _texture_available(asset_id):
    matches = []
    for image in bpy.data.images:
        name = image.name.lower()
        if asset_id not in name or not ("diff" in name or "color" in name):
            continue
        external_ok = bool(image.filepath) and os.path.exists(bpy.path.abspath(image.filepath))
        if image.packed_file or external_ok:
            matches.append(image.name)
    return matches


def prepare_detail_rig():
    """Validate the packed source scene and apply the current live-only rig."""
    _require_helpers()
    if os.path.basename(bpy.data.filepath).lower() != DETAIL_SOURCE_BLEND.lower():
        raise RuntimeError(
            "detail render requires the packed source blend to be open first: "
            + DETAIL_SOURCE_BLEND
        )
    if "HexKit" not in bpy.data.scenes:
        raise RuntimeError("required scene is missing: HexKit")
    for name in ("KIT", "STAGE"):
        if name not in bpy.data.collections:
            raise RuntimeError("required collection is missing: " + name)
    for name in ("HK_Camera", "HK_Sun", "HK_ShadowCatcher"):
        if name not in bpy.data.objects:
            raise RuntimeError("required rig object is missing: " + name)
    if "HK_World" not in bpy.data.worlds:
        raise RuntimeError("required world is missing: HK_World")

    missing_textures = [
        asset_id for asset_id in DETAIL_REQUIRED_TEXTURES
        if not _texture_available(asset_id)
    ]
    if missing_textures:
        raise RuntimeError(
            "required packed/external texture datablocks are missing: "
            + ", ".join(missing_textures)
        )

    global scn, CFG, R, INRAD
    scn = bpy.data.scenes["HexKit"]
    bpy.context.window.scene = scn
    try:
        CFG = json.loads(scn.get("hexkit_cfg", "{}"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("HexKit hexkit_cfg is invalid JSON") from exc
    CFG.update({
        "theta_deg": DETAIL_THETA_DEG,
        "hex_R": DETAIL_HEX_R_M,
        "view_w": DETAIL_VIEW_W,
        "res_x": DETAIL_WIDTH,
        "res_y": DETAIL_HEIGHT,
        "target_y": DETAIL_TARGET_Y,
        "anchor_px": list(DETAIL_ANCHOR),
        "cam_dist": 60.0,
        "out_dir": DETAIL_OUT,
    })
    scn["hexkit_cfg"] = json.dumps(CFG)
    R = DETAIL_HEX_R_M
    INRAD = R * math.sqrt(3.0) / 2.0

    theta = math.radians(DETAIL_THETA_DEG)
    cam = bpy.data.objects["HK_Camera"]
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = DETAIL_VIEW_W
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.clip_start = 0.1
    cam.data.clip_end = 300.0
    distance = 60.0
    cam.location = (
        0.0,
        DETAIL_TARGET_Y - distance * math.cos(theta),
        distance * math.sin(theta),
    )
    cam.rotation_euler = (math.radians(90.0 - DETAIL_THETA_DEG), 0.0, 0.0)
    scn.camera = cam

    render = scn.render
    render.engine = 'CYCLES'
    render.resolution_x = DETAIL_WIDTH
    render.resolution_y = DETAIL_HEIGHT
    render.resolution_percentage = 100
    render.pixel_aspect_x = 1.0 / math.sin(theta)
    render.pixel_aspect_y = 1.0
    render.film_transparent = True
    render.image_settings.file_format = 'PNG'
    render.image_settings.color_mode = 'RGBA'
    render.use_persistent_data = True
    scn.cycles.samples = 96
    scn.cycles.use_denoising = True
    # This machine exposes only a CPU Cycles device; select it explicitly so a
    # stale GPU setting cannot make a long batch fail after several renders.
    scn.cycles.device = 'CPU'

    scn.view_settings.view_transform = 'Filmic'
    scn.view_settings.look = 'High Contrast'
    world = bpy.data.worlds["HK_World"]
    world.use_nodes = True
    backgrounds = [node for node in world.node_tree.nodes if node.type == 'BACKGROUND']
    if not backgrounds:
        raise RuntimeError("HK_World has no Background node")
    backgrounds[0].inputs[0].default_value = (0.45, 0.52, 0.62, 1.0)
    backgrounds[0].inputs[1].default_value = 0.58

    sun = bpy.data.objects["HK_Sun"]
    sun.data.energy = 4.2
    sun.data.angle = math.radians(5.0)
    sun.data.color = (1.0, 0.93, 0.82)
    elev = math.radians(62.0)
    azimuth = math.radians(45.0)
    direction = Vector((
        math.cos(elev) * math.sin(azimuth),
        math.cos(elev) * math.cos(azimuth),
        -math.sin(elev),
    ))
    sun.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.data.objects["HK_ShadowCatcher"].is_shadow_catcher = True

    os.makedirs(DETAIL_OUT, exist_ok=True)
    print(
        "DETAIL RIG OK:",
        f"{DETAIL_WIDTH}x{DETAIL_HEIGHT}",
        f"Rpx={DETAIL_HEX_R_PX}",
        f"anchor={DETAIL_ANCHOR}",
        f"target_y={DETAIL_TARGET_Y:.6f}",
        "source=", bpy.data.filepath,
    )


def _smooth_object(obj):
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def _add_lobe(bm, location, scale, rng, phase):
    result = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    sx, sy, sz = scale
    for vertex in result["verts"]:
        co = vertex.co.copy()
        rough = noise.noise(Vector((
            co.x * 2.7 + phase,
            co.y * 2.7 + phase * 0.37,
            co.z * 2.7 + phase * 0.19,
        )))
        factor = 1.0 + rough * rng.uniform(0.10, 0.22)
        vertex.co = Vector((co.x * sx, co.y * sy, co.z * sz)) * factor + location


def _add_root_flare(bm, base, rng, count=5):
    for _ in range(count):
        azimuth = rng.uniform(0.0, math.tau)
        length = rng.uniform(0.65, 1.15)
        result = bmesh.ops.create_cone(
            bm, cap_ends=True, segments=5,
            radius1=rng.uniform(0.12, 0.20), radius2=0.035, depth=length,
        )
        direction = Vector((math.cos(azimuth), math.sin(azimuth), -0.08)).normalized()
        matrix = direction.to_track_quat('Z', 'X').to_matrix().to_4x4()
        matrix.translation = base + direction * (length * 0.42) + Vector((0, 0, 0.15))
        bmesh.ops.transform(bm, matrix=matrix, verts=result["verts"])


def build_leafy_tree(variant, col):
    """Build tree_v5..9: textured woody structure plus varied leafy crowns."""
    if variant not in range(5, 10):
        raise ValueError("leafy tree variant must be 5..9")
    local = variant - 5
    rng = random.Random(31000 + local * 977)
    profiles = (
        # height, crown radius x/y, crown height, lobes, vertical bias, wind
        (7.8, 3.15, 2.85, 3.4, 18, 0.00, 0.10),   # rounded oak
        (9.1, 2.45, 2.30, 4.2, 20, 0.25, 0.05),   # tall beech
        (6.2, 3.45, 3.15, 2.7, 17, -0.25, 0.00),  # broad orchard tree
        (8.4, 2.85, 2.65, 4.6, 22, 0.10, -0.18),  # loose willow-like crown
        (7.3, 3.20, 2.55, 3.3, 16, 0.15, 0.42),   # wind-shaped tree
    )
    height, rx, ry, crown_h, lobes, z_bias, wind = profiles[local]
    base = Vector((rng.uniform(-0.55, 0.55), rng.uniform(-0.45, 0.45), 0.0))

    wood = new_obj(f"detail_tree_wood_{variant}", col)
    bm = bmesh.new()
    trunks = 2 if local == 3 else 1
    for trunk_index in range(trunks):
        offset = Vector(((trunk_index - (trunks - 1) / 2) * 0.34, 0.0, 0.0))
        lean = Vector((wind * 0.12 + rng.uniform(-0.06, 0.06),
                       rng.uniform(-0.08, 0.08), 1.0)).normalized()
        add_branch(
            bm,
            base + offset,
            lean,
            height * rng.uniform(0.78, 0.88),
            rng.uniform(0.28, 0.38) / trunks ** 0.35,
            3,
            rng,
            kink=0.20,
        )
    _add_root_flare(bm, base, rng, count=6)
    bm.to_mesh(wood.data)
    bm.free()
    _smooth_object(wood)
    wood.data.materials.append(ph_mat(
        f"MDT_Bark_{variant}", "old_planks_02", scale=0.85,
        tint=(0.055, 0.042, 0.028, 1), tint_fac=0.72, bump=0.48, grime=0.2,
    ))

    crown = new_obj(f"detail_tree_crown_{variant}", col)
    bm = bmesh.new()
    center_z = height * 0.76 + z_bias
    phase = rng.uniform(0.0, 80.0)
    for index in range(lobes):
        angle = rng.uniform(0.0, math.tau)
        radial = math.sqrt(rng.random())
        x = math.cos(angle) * rx * radial + wind * (0.8 + radial)
        y = math.sin(angle) * ry * radial
        z = center_z + rng.uniform(-crown_h * 0.38, crown_h * 0.45)
        if local == 3:
            z -= radial * rng.uniform(0.0, 1.0)  # slightly drooping outer lobes
        scale = (
            rng.uniform(0.72, 1.30),
            rng.uniform(0.68, 1.18),
            rng.uniform(0.58, 1.05),
        )
        _add_lobe(bm, base + Vector((x, y, z)), scale, rng, phase + index * 0.61)
    # A compact crown core keeps the canopy readable at gameplay zoom.
    for index in range(4):
        _add_lobe(
            bm,
            base + Vector((wind + rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6),
                           center_z + rng.uniform(-0.35, 0.55))),
            (1.35, 1.25, 1.05),
            rng,
            phase + 20 + index,
        )
    bm.to_mesh(crown.data)
    bm.free()
    _smooth_object(crown)
    palettes = (
        ((0.028, 0.070, 0.012), (0.120, 0.205, 0.045)),
        ((0.032, 0.078, 0.016), (0.145, 0.225, 0.055)),
        ((0.040, 0.088, 0.015), (0.175, 0.245, 0.050)),
        ((0.025, 0.065, 0.014), (0.105, 0.185, 0.052)),
        ((0.045, 0.078, 0.012), (0.155, 0.205, 0.035)),
    )
    crown.data.materials.append(noisy_mat(
        f"MDT_Leaves_{variant}", *palettes[local],
        scale=1.7 + local * 0.11, rough=0.92, bump=0.32,
    ))


def build_rich_shrub(variant, col):
    """Build veg_v3..5 as dense, readable multi-clump shrubs."""
    if variant not in range(3, 6):
        raise ValueError("rich shrub variant must be 3..5")
    local = variant - 3
    rng = random.Random(36000 + local * 1237)
    leaves = new_obj(f"detail_shrub_leaves_{variant}", col)
    wood = new_obj(f"detail_shrub_wood_{variant}", col)
    bm_leaf = bmesh.new()
    bm_wood = bmesh.new()
    cluster_count = (3, 4, 5)[local]
    phase = rng.uniform(0.0, 50.0)
    for cluster in range(cluster_count):
        angle = rng.uniform(0.0, math.tau)
        radial = rng.uniform(0.5, 4.2)
        center = Vector((math.cos(angle) * radial, math.sin(angle) * radial, 0.0))
        height = rng.uniform(0.9, 1.65) + local * 0.08
        for lobe in range(rng.randint(5, 8)):
            location = center + Vector((
                rng.uniform(-0.85, 0.85),
                rng.uniform(-0.75, 0.75),
                height * rng.uniform(0.40, 0.82),
            ))
            size = rng.uniform(0.42, 0.78)
            _add_lobe(
                bm_leaf,
                location,
                (size * rng.uniform(1.0, 1.45), size, size * rng.uniform(0.62, 0.92)),
                rng,
                phase + cluster * 3.1 + lobe,
            )
        for _ in range(rng.randint(5, 9)):
            twig_h = height * rng.uniform(0.65, 1.15)
            result = bmesh.ops.create_cone(
                bm_wood, cap_ends=True, segments=5,
                radius1=0.035, radius2=0.008, depth=twig_h,
            )
            direction = Vector((rng.uniform(-0.35, 0.35),
                                rng.uniform(-0.35, 0.35), 1.0)).normalized()
            matrix = direction.to_track_quat('Z', 'X').to_matrix().to_4x4()
            matrix.translation = center + direction * (twig_h * 0.47)
            bmesh.ops.transform(bm_wood, matrix=matrix, verts=result["verts"])
    bm_leaf.to_mesh(leaves.data)
    bm_leaf.free()
    _smooth_object(leaves)
    shrub_palettes = (
        ((0.025, 0.064, 0.010), (0.110, 0.185, 0.038)),
        ((0.035, 0.074, 0.012), (0.145, 0.205, 0.042)),
        ((0.028, 0.058, 0.015), (0.105, 0.165, 0.050)),
    )
    leaves.data.materials.append(noisy_mat(
        f"MDS_Leaves_{variant}", *shrub_palettes[local],
        scale=2.2, rough=0.94, bump=0.35,
    ))
    bm_wood.to_mesh(wood.data)
    bm_wood.free()
    wood.data.materials.append(plain_mat(
        f"MDS_Wood_{variant}", (0.035, 0.026, 0.016), rough=0.95,
    ))


def _add_ribbon(bm, points, widths, z=0.055):
    """Create a flat strip whose width can taper to visually quiet ends."""
    rows = []
    for index, point in enumerate(points):
        if index == 0:
            tangent = points[1] - point
        elif index == len(points) - 1:
            tangent = point - points[index - 1]
        else:
            tangent = points[index + 1] - points[index - 1]
        tangent.z = 0.0
        tangent.normalize()
        perpendicular = Vector((-tangent.y, tangent.x, 0.0))
        half = max(0.012, widths[index] * 0.5)
        rows.append((
            bm.verts.new((point + perpendicular * half + Vector((0, 0, z)))),
            bm.verts.new((point - perpendicular * half + Vector((0, 0, z)))),
        ))
    for index in range(len(rows) - 1):
        bm.faces.new((rows[index][0], rows[index + 1][0],
                      rows[index + 1][1], rows[index][1]))


def _add_irregular_disc(bm, center, rx, ry, z, rng, segments=14):
    middle = bm.verts.new((center.x, center.y, z))
    ring = []
    phase = rng.uniform(0.0, math.tau)
    for index in range(segments):
        angle = math.tau * index / segments
        wobble = 1.0 + 0.20 * math.sin(angle * 3.0 + phase) + rng.uniform(-0.08, 0.08)
        ring.append(bm.verts.new((
            center.x + math.cos(angle) * rx * wobble,
            center.y + math.sin(angle) * ry * wobble,
            z,
        )))
    for index in range(segments):
        bm.faces.new((middle, ring[index], ring[(index + 1) % segments]))


def build_track_overlay(variant, col):
    """Two tapering vehicle ruts plus baked tread impressions."""
    if variant not in range(4):
        raise ValueError("track variant must be 0..3")
    rng = random.Random(41000 + variant * 1291)
    amplitude = (0.10, 0.32, 0.58, 0.42)[variant]
    frequency = (1.0, 1.2, 1.0, 1.7)[variant]
    separation = (1.55, 1.75, 1.65, 1.90)[variant]
    phase = rng.uniform(-0.4, 0.4)
    y_offset = rng.uniform(-0.45, 0.45)
    rut = new_obj(f"detail_track_rut_{variant}", col)
    bm = bmesh.new()
    samples = 27
    paths = []
    for side in (-1, 1):
        path = []
        widths = []
        for index in range(samples):
            t = index / (samples - 1)
            x = -6.25 + 12.5 * t
            curve = amplitude * math.sin((t * frequency + phase) * math.tau)
            y = y_offset + curve + side * separation * 0.5
            path.append(Vector((x, y, 0.0)))
            fade = math.sin(math.pi * t) ** 0.72
            widths.append((0.52 + 0.12 * rng.random()) * fade)
        _add_ribbon(bm, path, widths, z=0.055)
        paths.append(path)
    bm.to_mesh(rut.data)
    bm.free()
    rut.data.materials.append(ph_mat(
        f"MDTrackSoil_{variant}", "brick_gravel", scale=0.72,
        tint=(0.055, 0.040, 0.025, 1), tint_fac=0.78, bump=0.45, grime=0.25,
    ))

    treads = new_obj(f"detail_track_treads_{variant}", col)
    bm = bmesh.new()
    step = (0.62, 0.54, 0.70, 0.58)[variant]
    x = -5.7
    while x <= 5.7:
        t = (x + 6.25) / 12.5
        derivative = amplitude * math.tau * frequency / 12.5 * math.cos(
            (t * frequency + phase) * math.tau
        )
        yaw = math.atan2(derivative, 1.0)
        center_y = y_offset + amplitude * math.sin((t * frequency + phase) * math.tau)
        for side in (-1, 1):
            if rng.random() < (0.93 if variant != 3 else 0.78):
                add_box_at(
                    bm,
                    rng.uniform(0.16, 0.24),
                    rng.uniform(0.54, 0.74),
                    0.035,
                    (x + rng.uniform(-0.05, 0.05),
                     center_y + side * separation * 0.5 + rng.uniform(-0.06, 0.06),
                     0.071),
                    (0.0, 0.0, yaw),
                )
        x += step
    bm.to_mesh(treads.data)
    bm.free()
    treads.data.materials.append(plain_mat(
        f"MDTrackDark_{variant}", (0.020, 0.014, 0.009), rough=0.98,
    ))

    churn = new_obj(f"detail_track_churn_{variant}", col)
    bm = bmesh.new()
    for _ in range(2 + variant):
        center = Vector((rng.uniform(-4.7, 4.7), y_offset + rng.uniform(-1.3, 1.3), 0.0))
        _add_irregular_disc(
            bm, center, rng.uniform(0.45, 1.15), rng.uniform(0.25, 0.60),
            0.048, rng, segments=12,
        )
    bm.to_mesh(churn.data)
    bm.free()
    churn.data.materials.append(noisy_mat(
        f"MDTrackChurn_{variant}", (0.035, 0.024, 0.014),
        (0.075, 0.052, 0.028), scale=2.6, rough=0.97, bump=0.25,
    ))


def build_field_rows(variant, col):
    """Cultivated soil ridges; later variants add seedlings or stubble."""
    if variant not in range(4):
        raise ValueError("field-row variant must be 0..3")
    rng = random.Random(47000 + variant * 1429)
    rows = (8, 9, 10, 8)[variant]
    spacing = (0.92, 0.82, 0.74, 0.96)[variant]
    ridges = new_obj(f"detail_field_rows_{variant}", col)
    bm = bmesh.new()
    row_positions = [(index - (rows - 1) / 2.0) * spacing for index in range(rows)]
    for row_index, row_y in enumerate(row_positions):
        points = []
        widths = []
        phase = rng.uniform(0.0, math.tau)
        for index in range(23):
            t = index / 22.0
            x = -6.1 + 12.2 * t
            y = row_y + 0.08 * math.sin(t * math.tau * 1.5 + phase)
            points.append(Vector((x, y, 0.0)))
            edge_fade = math.sin(math.pi * t) ** 0.70
            widths.append(rng.uniform(0.22, 0.34) * edge_fade)
        _add_ribbon(bm, points, widths, z=0.052 + 0.006 * (row_index % 2))
    bm.to_mesh(ridges.data)
    bm.free()
    ridges.data.materials.append(ph_mat(
        f"MDFieldSoil_{variant}", "brick_gravel", scale=0.48,
        offset=(rng.uniform(0, 8), rng.uniform(0, 8), 0),
        tint=(0.105, 0.067, 0.035, 1), tint_fac=0.67, bump=0.52, grime=0.18,
    ))

    if variant < 2:
        return
    plants = new_obj(f"detail_field_plants_{variant}", col)
    bm = bmesh.new()
    for row_index, row_y in enumerate(row_positions):
        x = -5.35 + rng.uniform(0.0, 0.35)
        while x < 5.35:
            if rng.random() < (0.78 if variant == 2 else 0.90):
                if variant == 2:
                    result = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
                    bmesh.ops.scale(
                        bm,
                        vec=(rng.uniform(0.10, 0.17), rng.uniform(0.07, 0.12),
                             rng.uniform(0.10, 0.18)),
                        verts=result["verts"],
                    )
                    bmesh.ops.translate(
                        bm,
                        vec=(x, row_y + rng.uniform(-0.08, 0.08), 0.14),
                        verts=result["verts"],
                    )
                else:
                    height = rng.uniform(0.16, 0.30)
                    result = bmesh.ops.create_cone(
                        bm, cap_ends=True, segments=4,
                        radius1=0.035, radius2=0.008, depth=height,
                    )
                    bmesh.ops.translate(
                        bm,
                        vec=(x, row_y + rng.uniform(-0.08, 0.08), height / 2 + 0.06),
                        verts=result["verts"],
                    )
            x += rng.uniform(0.44, 0.70)
    bm.to_mesh(plants.data)
    bm.free()
    if variant == 2:
        plants.data.materials.append(noisy_mat(
            f"MDFieldGreen_{variant}", (0.030, 0.075, 0.010),
            (0.120, 0.185, 0.035), scale=2.3, rough=0.94, bump=0.2,
        ))
    else:
        plants.data.materials.append(plain_mat(
            f"MDFieldStubble_{variant}", (0.155, 0.105, 0.038), rough=0.96,
        ))


def build_cobble_detail(variant, col):
    """Central stains, dust and restrained rubble for seam-breaking decals."""
    if variant not in range(6):
        raise ValueError("cobble detail variant must be 0..5")
    rng = random.Random(53000 + variant * 1597)
    stain_count = (2, 3, 1, 2, 4, 2)[variant]
    dust_count = (1, 2, 3, 1, 2, 3)[variant]
    rubble_count = (5, 9, 14, 7, 11, 18)[variant]

    stains = new_obj(f"detail_cobble_stain_{variant}", col)
    bm = bmesh.new()
    for _ in range(stain_count):
        angle = rng.uniform(0.0, math.tau)
        radial = math.sqrt(rng.random()) * 3.8
        center = Vector((math.cos(angle) * radial, math.sin(angle) * radial, 0.0))
        _add_irregular_disc(
            bm, center, rng.uniform(0.45, 1.45), rng.uniform(0.30, 0.95),
            0.043, rng,
        )
    bm.to_mesh(stains.data)
    bm.free()
    stains.data.materials.append(noisy_mat(
        f"MDCobbleStain_{variant}", (0.020, 0.017, 0.012),
        (0.052, 0.042, 0.027), scale=2.1, rough=0.98, bump=0.15,
    ))

    dust = new_obj(f"detail_cobble_dust_{variant}", col)
    bm = bmesh.new()
    for _ in range(dust_count):
        angle = rng.uniform(0.0, math.tau)
        radial = math.sqrt(rng.random()) * 4.2
        center = Vector((math.cos(angle) * radial, math.sin(angle) * radial, 0.0))
        _add_irregular_disc(
            bm, center, rng.uniform(0.6, 1.7), rng.uniform(0.28, 0.75),
            0.049, rng, segments=16,
        )
    bm.to_mesh(dust.data)
    bm.free()
    dust.data.materials.append(ph_mat(
        f"MDCobbleDust_{variant}", "brick_gravel", scale=0.65,
        tint=(0.145, 0.100, 0.060, 1), tint_fac=0.74, bump=0.28, grime=0.1,
    ))

    rubble = new_obj(f"detail_cobble_rubble_{variant}", col)
    bm = bmesh.new()
    for _ in range(rubble_count):
        angle = rng.uniform(0.0, math.tau)
        radial = math.sqrt(rng.random()) * 4.6
        size = rng.uniform(0.10, 0.32)
        add_box_at(
            bm,
            size * rng.uniform(0.7, 1.6),
            size * rng.uniform(0.55, 1.25),
            size * rng.uniform(0.35, 0.85),
            (math.cos(angle) * radial, math.sin(angle) * radial,
             0.055 + size * 0.24),
            (rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35),
             rng.uniform(0.0, math.tau)),
        )
    bm.to_mesh(rubble.data)
    bm.free()
    rubble.data.materials.append(ph_mat(
        f"MDCobbleRubble_{variant}", "broken_brick_wall", scale=0.55,
        tint=(0.22, 0.13, 0.075, 1), tint_fac=0.58, bump=0.48, grime=0.18,
    ))


def _validate_render(path):
    image = bpy.data.images.load(path, check_existing=False)
    try:
        size = tuple(image.size)
        if size != (DETAIL_WIDTH, DETAIL_HEIGHT):
            raise RuntimeError(f"wrong output size for {path}: {size}")
        if image.channels != 4:
            raise RuntimeError(f"output is not RGBA for {path}: channels={image.channels}")
        pixels = image.pixels[:]
        alpha = pixels[3::4]
        if not alpha or max(alpha) <= 0.01:
            raise RuntimeError(f"output has empty alpha for {path}")
        if min(alpha) >= 0.99:
            raise RuntimeError(f"output has no transparent background for {path}")
        print(
            "VALID",
            os.path.basename(path),
            f"{size[0]}x{size[1]} RGBA",
            f"alpha={min(alpha):.3f}..{max(alpha):.3f}",
        )
    finally:
        bpy.data.images.remove(image)


def _render_detail(col, rotations, filename):
    rendered = []
    for rotation in rotations:
        name = filename.format(rot=rotation)
        if not DETAIL_NAME_RE.fullmatch(name):
            raise RuntimeError("refusing to render outside the detail pack: " + name)
        path = os.path.join(DETAIL_OUT, name)
        stage_and_render(col, rotation, path, with_catcher=True)
        _validate_render(path)
        rendered.append(path)
    return rendered


def render_detail_pack(part="details"):
    """Build/render one detail group or the full priority-ordered pack."""
    prepare_detail_rig()
    valid_parts = {
        "details",
        "details_priority",
        "details_trees",
        "details_tracks",
        "details_cobble",
        "details_fields",
    }
    if part not in valid_parts:
        raise ValueError("unknown detail render part: " + part)
    if part == "details":
        groups = ("trees", "tracks", "cobble", "fields")
    elif part == "details_priority":
        groups = ("trees", "tracks", "cobble")
    else:
        groups = (part.removeprefix("details_"),)

    rendered = []
    for group in groups:
        if group == "trees":
            for variant in range(5, 10):
                col = get_kit_col(f"XDETAIL_TREE_{variant}")
                build_leafy_tree(variant, col)
                rendered += _render_detail(col, (0,), f"tree_v{variant}_rot{{rot}}.png")
            for variant in range(3, 6):
                col = get_kit_col(f"XDETAIL_VEG_{variant}")
                build_rich_shrub(variant, col)
                rendered += _render_detail(col, (0,), f"veg_v{variant}_rot{{rot}}.png")
        elif group == "tracks":
            for variant in range(4):
                col = get_kit_col(f"XDETAIL_TRACK_{variant}")
                build_track_overlay(variant, col)
                rendered += _render_detail(
                    col, (0, 60, 120), f"track_v{variant}_rot{{rot}}.png"
                )
        elif group == "cobble":
            for variant in range(6):
                col = get_kit_col(f"XDETAIL_COBBLE_{variant}")
                build_cobble_detail(variant, col)
                rendered += _render_detail(col, (0,), f"cobble_detail_v{variant}.png")
        elif group == "fields":
            for variant in range(4):
                col = get_kit_col(f"XDETAIL_FIELD_{variant}")
                build_field_rows(variant, col)
                rendered += _render_detail(
                    col, (0, 60, 120), f"fieldrows_v{variant}_rot{{rot}}.png"
                )
    print("DETAIL PACK DONE:", part, len(rendered), "validated PNGs")
    return rendered


if globals().get("DETAIL_DEMO", False):
    render_detail_pack(globals().get("DETAIL_PART", "details_priority"))
