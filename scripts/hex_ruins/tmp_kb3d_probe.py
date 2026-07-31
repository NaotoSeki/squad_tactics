# -*- coding: utf-8 -*-
# Kitbash3D WW2 ライブラリの中身を「読み込まずに」列挙する(ヘッダのみ参照、964MBでも高速)
import bpy

KB = r"C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2\Kitbash3D - World War 2 [Blender Native]\kb3d_worldwartwo.blender.native\kb3d_worldwartwo-native.blend"

with bpy.data.libraries.load(KB, link=False, assets_only=False) as (src, dst):
    cols = list(src.collections)
    objs = list(src.objects)
    scenes = list(src.scenes)

print("SCENES:", scenes)
print("COLLECTIONS (%d):" % len(cols))
for c in sorted(cols):
    print("  C:", c)
print("OBJECT COUNT:", len(objs))
# オブジェクト名の接頭辞分布(命名規則の把握)
from collections import Counter
pref = Counter()
for o in objs:
    parts = o.split("_")
    pref["_".join(parts[:3]) if len(parts) >= 3 else o] += 1
for name, n in sorted(pref.items(), key=lambda x: -x[1])[:40]:
    print("  O: %-40s x%d" % (name, n))
print("PROBE DONE")
