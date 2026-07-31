# -*- coding: utf-8 -*-
# 1) fix sun azimuth (light FROM south-west, shadows to NE)
# 2) compact PolyHaven texture candidate listing
import bpy
import math
from mathutils import Vector

sun = bpy.data.objects.get("HK_Sun")
elev = math.radians(48.0)
az_to = math.radians(45.0)  # light travels toward NE
d = Vector((math.cos(elev) * math.sin(az_to),
            math.cos(elev) * math.cos(az_to),
            -math.sin(elev)))
sun.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
print("sun dir ->", tuple(round(v, 3) for v in d))

import requests
HEADERS = {"User-Agent": "blender-mcp"}
for cat in ["brick", "plaster", "concrete", "cobblestone", "roof", "gravel", "rock", "wood", "asphalt"]:
    try:
        r = requests.get("https://api.polyhaven.com/assets",
                         params={"type": "textures", "categories": cat},
                         headers=HEADERS, timeout=30)
        ids = list(r.json().keys())
        print(cat.upper(), len(ids), ":", ", ".join(ids[:40]))
    except Exception as e:
        print(cat.upper(), "ERROR", e)
