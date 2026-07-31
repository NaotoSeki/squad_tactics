# -*- coding: utf-8 -*-
# B/C/D/E 再センタリング+再レンダー。append済みセッションで実行する(別exec
# なので matrix_world は評価済み — 同一exec内append直後は view_layer.update()
# でも未評価で bbox がズレる、が今回の教訓)。
import bpy
import json
import math
import os
from mathutils import Vector

scn = bpy.data.scenes["HexKit"]
CFG = json.loads(scn["hexkit_cfg"])
OUT = CFG["out_dir"]
ROTS = [0, 60, 120, 180, 240, 300]

scn.view_settings.look = 'High Contrast'
scn.cycles.samples = 96
scn.render.use_persistent_data = True

def recenter(colname):
    col = bpy.data.collections[colname]
    bpy.context.view_layer.update()
    meshes = [o for o in col.objects if o.type == 'MESH']
    mins = Vector((1e9,) * 3)
    maxs = Vector((-1e9,) * 3)
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector(map(min, mins, w))
            maxs = Vector(map(max, maxs, w))
    center = (mins + maxs) / 2
    size = maxs - mins
    names = set(x.name for x in col.objects)
    roots = [o for o in col.objects if o.parent is None or o.parent.name not in names]
    offset = Vector((-center.x, -center.y, -mins.z))
    for o in roots:
        o.location = o.location + offset
    # スケール(フットプリント13m制限)は移動後に世界原点基準で適用
    foot = max(size.x, size.y)
    if foot > 13.0:
        s = 13.0 / foot
        for o in roots:
            o.scale = o.scale * s
            o.location = Vector((o.location.x * s, o.location.y * s, o.location.z * s))
    bpy.context.view_layer.update()
    print(f"{colname}: size {size.x:.1f}x{size.y:.1f} scale {min(1.0, 13.0 / foot):.3f} offset {tuple(round(v,1) for v in offset)}")
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

for letter, colname in [("B", "KB_RES_B"), ("C", "KB_RES_C"), ("D", "KB_RES_D"), ("E", "KB_RES_E")]:
    col = recenter(colname)
    for rot in ROTS:
        render_rot(col, rot, f"{OUT}/kbres_{letter.lower()}_rot{rot}.png")
        print(f"R kbres_{letter.lower()}_rot{rot}")
print("RERENDER DONE")
