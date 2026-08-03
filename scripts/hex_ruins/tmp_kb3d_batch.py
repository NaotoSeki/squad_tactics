# -*- coding: utf-8 -*-
# Kitbash3D 住宅A-E × 6回転 = 30タイルのバッチ焼き。
# 出力: asset/environment/hex_tiles_v7/kbres_{a-e}_rot{0-300}.png
import bpy
import json
import math
import os
from mathutils import Vector

KB = r"C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2\Kitbash3D - World War 2 [Blender Native]\kb3d_worldwartwo.blender.native\kb3d_worldwartwo-native.blend"
TEX2K = r"C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2\Kitbash3D - World War 2 [PNG 2k]\kb3d_worldwartwo.png.2k"

scn = bpy.data.scenes["HexKit"]
CFG = json.loads(scn["hexkit_cfg"])
OUT = CFG["out_dir"]
os.makedirs(OUT, exist_ok=True)

for n in bpy.data.worlds["HK_World"].node_tree.nodes:
    if n.type == 'BACKGROUND':
        n.inputs[1].default_value = 0.58
sun = bpy.data.lights["HK_Sun"]
sun.energy = 4.2
sun.angle = math.radians(5.0)
scn.view_settings.look = 'High Contrast'
scn.cycles.samples = 96
scn.render.use_persistent_data = True

kit = bpy.data.collections["KIT"]
ROTS = [0, 60, 120, 180, 240, 300]

def prep_family(fam, colname):
    """append→2Kリマップ→原点センタリング(要view_layer.update)→13m内へ縮小"""
    existing = bpy.data.collections.get(colname)
    if existing:
        return existing   # テストで作成済み(A)を再利用
    with bpy.data.libraries.load(KB, link=False) as (src, dst):
        dst.objects = [o for o in src.objects if o.startswith(fam)]
    appended = [o for o in bpy.data.objects
                if o.name.startswith(fam) and o.library is None
                and not any(o.name in c.objects for c in kit.children)]
    col = bpy.data.collections.new(colname)
    kit.children.link(col)
    for o in appended:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
    bpy.ops.file.find_missing_files(directory=TEX2K)
    bpy.context.view_layer.update()   # append直後のmatrix_worldは未評価(白レンダー事故の教訓)
    meshes = [o for o in col.objects if o.type == 'MESH']
    mins = Vector((1e9,) * 3)
    maxs = Vector((-1e9,) * 3)
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector(map(min, mins, w))
            maxs = Vector(map(max, maxs, w))
    center = (mins + maxs) / 2
    names = set(x.name for x in col.objects)
    roots = [o for o in col.objects if o.parent is None or o.parent.name not in names]
    offset = Vector((-center.x, -center.y, -mins.z))
    for o in roots:
        o.location = o.location + offset
    size = maxs - mins
    foot = max(size.x, size.y)
    if foot > 13.0:
        s = 13.0 / foot
        for o in roots:
            o.scale = o.scale * s
            o.location = Vector((o.location.x * s, o.location.y * s, o.location.z * s))
    bpy.context.view_layer.update()
    print(f"prep {fam}: size {size.x:.1f}x{size.y:.1f}x{size.z:.1f} scale {min(1.0, 13.0/foot):.3f}")
    return col

def render_rot(col, rot, path):
    stage = bpy.data.collections["STAGE"]
    for ob in list(stage.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    inst = bpy.data.objects.new("stage_inst", None)
    inst.instance_type = 'COLLECTION'
    inst.instance_collection = col
    inst.rotation_euler = (0, 0, math.radians(rot))
    stage.objects.link(inst)
    bpy.data.objects["HK_ShadowCatcher"].hide_render = False
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True, scene="HexKit")

for letter in ["A", "B", "C", "D", "E"]:
    fam = f"KB3D_WWT_BldgMdResidential_{letter}"
    colname = "KB_TEST" if letter == "A" else f"KB_RES_{letter}"
    col = prep_family(fam, colname)
    for rot in ROTS:
        path = f"{OUT}/kbres_{letter.lower()}_rot{rot}.png"
        render_rot(col, rot, path)
        print(f"R kbres_{letter.lower()}_rot{rot}")
print("KB3D BATCH DONE")
