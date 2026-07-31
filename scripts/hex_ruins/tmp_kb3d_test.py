# -*- coding: utf-8 -*-
# Kitbash3D 建物1棟のテスト焼き: append→2Kテクスチャへリマップ→原点センタリング→
# 寸法測定→HexKitリグでレンダー
import bpy
import json
import math
import os
from mathutils import Vector

KB = r"C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2\Kitbash3D - World War 2 [Blender Native]\kb3d_worldwartwo.blender.native\kb3d_worldwartwo-native.blend"
TEX2K = r"C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2\Kitbash3D - World War 2 [PNG 2k]\kb3d_worldwartwo.png.2k"
FAM = "KB3D_WWT_BldgMdResidential_A"

scn = bpy.data.scenes["HexKit"]
CFG = json.loads(scn["hexkit_cfg"])
os.makedirs(CFG["scratch"], exist_ok=True)

# ---- append ----
with bpy.data.libraries.load(KB, link=False) as (src, dst):
    dst.objects = [o for o in src.objects if o.startswith(FAM)]
appended = [o for o in bpy.data.objects if o.name.startswith(FAM) and o.library is None]
print("appended objects:", len(appended))

# ---- KITコレクションへ収容 ----
kit = bpy.data.collections["KIT"]
old = bpy.data.collections.get("KB_TEST")
if old:
    for o in list(old.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    col = old
else:
    col = bpy.data.collections.new("KB_TEST")
    kit.children.link(col)
for o in appended:
    for c in list(o.users_collection):
        c.objects.unlink(o)
    col.objects.link(o)

# ---- テクスチャを2Kへリマップ(4Kフォルダは空) ----
missing_before = sum(1 for img in bpy.data.images
                     if img.filepath and not os.path.exists(bpy.path.abspath(img.filepath)))
bpy.ops.file.find_missing_files(directory=TEX2K)
missing_after = sum(1 for img in bpy.data.images
                    if img.filepath and not os.path.exists(bpy.path.abspath(img.filepath)))
print(f"missing images: {missing_before} -> {missing_after}")

# ---- ワールドbboxを測って原点(接地)へセンタリング ----
mins = Vector((1e9, 1e9, 1e9))
maxs = Vector((-1e9, -1e9, -1e9))
for o in appended:
    if o.type != 'MESH':
        continue
    for corner in o.bound_box:
        w = o.matrix_world @ Vector(corner)
        mins = Vector(map(min, mins, w))
        maxs = Vector(map(max, maxs, w))
size = maxs - mins
center = (mins + maxs) / 2
print(f"bbox size: {size.x:.2f} x {size.y:.2f} x {size.z:.2f} m")

# 親を持たないルートだけ動かす(子は追従)
roots = [o for o in appended if o.parent is None or o.parent not in appended]
offset = Vector((-center.x, -center.y, -mins.z))
for o in roots:
    o.location = o.location + offset

# フットプリントがヘックス(対辺15.6m)を超えるなら縮小
foot = max(size.x, size.y)
scale = 1.0
if foot > 13.0:
    scale = 13.0 / foot
    for o in roots:
        o.scale = o.scale * scale
        o.location = Vector((o.location.x * scale, o.location.y * scale, o.location.z * scale))
print(f"applied scale: {scale:.3f}")

# ---- レンダー(STAGEにインスタンス、rot 0) ----
for n in bpy.data.worlds["HK_World"].node_tree.nodes:
    if n.type == 'BACKGROUND':
        n.inputs[1].default_value = 0.58
sun = bpy.data.lights["HK_Sun"]
sun.energy = 4.2
sun.angle = math.radians(5.0)
scn.view_settings.look = 'High Contrast'
scn.cycles.samples = 96
scn.render.use_persistent_data = True

stage = bpy.data.collections["STAGE"]
for ob in list(stage.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
inst = bpy.data.objects.new("stage_inst", None)
inst.instance_type = 'COLLECTION'
inst.instance_collection = col
stage.objects.link(inst)
bpy.data.objects["HK_ShadowCatcher"].hide_render = False
scn.render.filepath = CFG["scratch"] + "/kb3d_test_resA_rot0.png"
bpy.ops.render.render(write_still=True, scene="HexKit")
print("RENDERED", scn.render.filepath)
