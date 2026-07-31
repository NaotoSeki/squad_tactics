# -*- coding: utf-8 -*-
# 建物ファミリーごとのバリアント構造を把握
import bpy
from collections import Counter

KB = r"C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2\Kitbash3D - World War 2 [Blender Native]\kb3d_worldwartwo.blender.native\kb3d_worldwartwo-native.blend"

with bpy.data.libraries.load(KB, link=False, assets_only=False) as (src, dst):
    objs = list(src.objects)

fams = ["BldgMdResidential", "BldgSmCamp", "BldgLgFarmhouse", "BldgMdBunker",
        "BldgLgBrokenChurch", "BldgSmHideout", "BldgMdHideout", "BldgSmBunker",
        "BldgLgCheckpoint", "BldgLgSniperTower"]
for fam in fams:
    matches = [o for o in objs if fam in o]
    pref = Counter()
    for o in matches:
        # KB3D_WWT_BldgMdResidential の後の1トークン(バリアント文字)まで
        tail = o.split(fam, 1)[1]
        token = tail.split("_")[1] if tail.startswith("_") and len(tail.split("_")) > 1 else tail[:4]
        pref[token] += 1
    print(fam, dict(sorted(pref.items())))
print("PROBE2 DONE")
