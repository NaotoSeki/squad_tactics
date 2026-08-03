# -*- coding: utf-8 -*-
# KB_TEST 再センタリング(view_layer.update()してから測る)+再レンダー
import bpy
import json
import math
from mathutils import Vector

scn = bpy.data.scenes["HexKit"]
CFG = json.loads(scn["hexkit_cfg"])
col = bpy.data.collections["KB_TEST"]

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
print("before:", tuple(round(v, 1) for v in mins), tuple(round(v, 1) for v in maxs))

roots = [o for o in col.objects if o.parent is None or o.parent.name not in
         set(x.name for x in col.objects)]
offset = Vector((-center.x, -center.y, -mins.z))
for o in roots:
    o.location = o.location + offset
bpy.context.view_layer.update()

mins2 = Vector((1e9,) * 3)
maxs2 = Vector((-1e9,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mins2 = Vector(map(min, mins2, w))
        maxs2 = Vector(map(max, maxs2, w))
print("after:", tuple(round(v, 1) for v in mins2), tuple(round(v, 1) for v in maxs2))

scn.view_settings.look = 'High Contrast'
scn.cycles.samples = 96
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
print("RENDERED")
