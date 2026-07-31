# -*- coding: utf-8 -*-
# HexKit rig: military-projection ortho camera + lighting + render settings.
# Runs inside Blender via bmcp_client. Non-destructive: builds its own scene "HexKit".
import bpy
import json
import math

# ---- config (single source of truth, stored on scene as custom prop) ----
CFG = {
    "theta_deg": 55.0,        # camera elevation from horizontal
    "hex_R": 9.0,             # hex circumradius (m), pointy-top
    "view_w": 20.25,          # world meters covered by canvas width (576/28.444)
    # 2026-07-13: 288x384へ半減(表示は~121x162pxなのに576x768は
    # 4倍相当のオーバースペック — 実測で501枚195MB→40MBに削減、画質劣化は
    # 2倍ズームでも実用範囲)。px_per_m・アンカー比は不変(全て半分にスケール済み)。
    "res_x": 288,
    "res_y": 384,
    "target_y": 3.0,          # camera aim point north-offset -> hex center sits low in frame
    "cam_dist": 60.0,
    "out_dir": "C:/Projects/squad_tactics/asset/environment/hex_tiles_v7",
    "scratch": "C:/Projects/squad_tactics/scratch/hexkit",
}

print("Blender", bpy.app.version_string)

# enable PolyHaven handlers for later texture downloads
for sc in bpy.data.scenes:
    if hasattr(sc, "blendermcp_use_polyhaven"):
        sc.blendermcp_use_polyhaven = True

# ---- scene ----
if "HexKit" in bpy.data.scenes:
    scn = bpy.data.scenes["HexKit"]
else:
    scn = bpy.data.scenes.new("HexKit")
bpy.context.window.scene = scn
scn["hexkit_cfg"] = json.dumps(CFG)

def get_col(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
    root = (parent or scn.collection)
    if col.name not in [c.name for c in root.children]:
        try:
            root.children.link(col)
        except RuntimeError:
            pass
    return col

col_stage = get_col("STAGE")   # what the camera sees
col_kit = get_col("KIT")       # module library, excluded from render
col_rig = get_col("RIG")

# exclude KIT from the view layer render
for lc in bpy.context.view_layer.layer_collection.children:
    if lc.name == "KIT":
        lc.exclude = True

# wipe previous rig objects (idempotent re-run)
for name in ["HK_Camera", "HK_Sun", "HK_ShadowCatcher", "HK_CalibHex"]:
    ob = bpy.data.objects.get(name)
    if ob:
        bpy.data.objects.remove(ob, do_unlink=True)

theta = math.radians(CFG["theta_deg"])

# ---- camera: ortho, elevation theta, pixel_aspect_x = 1/sin(theta) ----
# screen-y of world (Y,Z) = Y*sin(t)+Z*cos(t); horizontal stretch of PIXELS by
# 1/sin(t) via pixel_aspect_x shrinks covered view height so ground plan comes
# out undistorted (true-plan military projection). Hex footprint stays regular.
cam_data = bpy.data.cameras.new("HK_Camera")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = CFG["view_w"]
cam_data.sensor_fit = 'HORIZONTAL'
cam_data.clip_start = 0.1
cam_data.clip_end = 300.0
cam = bpy.data.objects.new("HK_Camera", cam_data)
col_rig.objects.link(cam)
D = CFG["cam_dist"]
cam.location = (0.0, CFG["target_y"] - D * math.cos(theta), D * math.sin(theta))
cam.rotation_euler = (math.radians(90.0 - CFG["theta_deg"]), 0.0, 0.0)
scn.camera = cam

# ---- render settings ----
r = scn.render
r.engine = 'CYCLES'
r.resolution_x = CFG["res_x"]
r.resolution_y = CFG["res_y"]
r.pixel_aspect_x = 1.0 / math.sin(theta)
r.pixel_aspect_y = 1.0
r.film_transparent = True
r.image_settings.file_format = 'PNG'
r.image_settings.color_mode = 'RGBA'

scn.cycles.samples = 128
scn.cycles.use_denoising = True
scn.cycles.device = 'GPU'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dev_type in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'NONE'):
        try:
            prefs.compute_device_type = dev_type
            break
        except TypeError:
            continue
    prefs.get_devices()
    names = []
    for d in prefs.devices:
        d.use = (d.type != 'CPU')
        if d.use:
            names.append("%s(%s)" % (d.name, d.type))
    print("GPU devices:", names if names else "none -> CPU fallback")
    if not names:
        scn.cycles.device = 'CPU'
except Exception as e:
    print("GPU setup failed, CPU fallback:", e)
    scn.cycles.device = 'CPU'

# grim WW2 palette: Filmic, slightly raised contrast
scn.view_settings.view_transform = 'Filmic'
scn.view_settings.look = 'Medium High Contrast'

# ---- lighting: warm key sun from SW + cool sky ambient ----
# elev 62deg keeps baked shadows short enough to stay inside the canvas
from mathutils import Vector
sun_data = bpy.data.lights.new("HK_Sun", 'SUN')
sun_data.energy = 4.2
sun_data.angle = math.radians(5.0)
sun_data.color = (1.0, 0.93, 0.82)
sun = bpy.data.objects.new("HK_Sun", sun_data)
col_rig.objects.link(sun)
sun_elev = math.radians(62.0)
az_to = math.radians(45.0)      # light travels toward NE (comes from SW)
d = Vector((math.cos(sun_elev) * math.sin(az_to),
            math.cos(sun_elev) * math.cos(az_to),
            -math.sin(sun_elev)))
sun.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

world = bpy.data.worlds.get("HK_World") or bpy.data.worlds.new("HK_World")
scn.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wl = world.node_tree.links
wn.clear()
bg = wn.new("ShaderNodeBackground")
bg.inputs[0].default_value = (0.45, 0.52, 0.62, 1.0)  # cool overcast sky
bg.inputs[1].default_value = 0.55
wout = wn.new("ShaderNodeOutputWorld")
wl.new(bg.outputs[0], wout.inputs[0])

# ---- shadow catcher ground ----
import bmesh
mesh = bpy.data.meshes.new("HK_ShadowCatcher")
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30.0)
bm.to_mesh(mesh)
bm.free()
catcher = bpy.data.objects.new("HK_ShadowCatcher", mesh)
catcher.is_shadow_catcher = True
col_rig.objects.link(catcher)

# ---- calibration hex (pointy-top, circumradius hex_R) + poles ----
R = CFG["hex_R"]
mesh = bpy.data.meshes.new("HK_CalibHex")
verts = [(R * math.cos(math.radians(90 + 60 * i)),
          R * math.sin(math.radians(90 + 60 * i)), 0.05) for i in range(6)]
faces = [tuple(range(6))]

def add_box(cx, cy, w, d, h):
    base = len(verts)
    for dz in (0.05, h):
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append((cx + sx * w / 2, cy + sy * d / 2, dz))
    quads = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    for q in quads:
        faces.append(tuple(base + i for i in q))

add_box(0, 0, 0.4, 0.4, 12.0)   # center pole 12m
add_box(0, R, 0.4, 0.4, 3.0)    # north-point pole 3m
mesh.from_pydata(verts, [], faces)
calib = bpy.data.objects.new("HK_CalibHex", mesh)
col_stage.objects.link(calib)
mat = bpy.data.materials.get("HK_Calib") or bpy.data.materials.new("HK_Calib")
mat.use_nodes = True
nodes = mat.node_tree.nodes
nodes.clear()
em = nodes.new("ShaderNodeEmission")
em.inputs[0].default_value = (1.0, 0.1, 0.1, 1.0)
em.inputs[1].default_value = 2.0
out = nodes.new("ShaderNodeOutputMaterial")
mat.node_tree.links.new(em.outputs[0], out.inputs[0])
calib.data.materials.append(mat)

# ---- calibration render ----
import os
os.makedirs(CFG["scratch"], exist_ok=True)
scn.render.filepath = CFG["scratch"] + "/calib.png"
bpy.ops.render.render(write_still=True, scene="HexKit")
print("calib render ->", scn.render.filepath)
print("DONE rig_setup")
