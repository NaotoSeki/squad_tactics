import socket
import json

blender_code = """
import bpy
res = ""
rig = bpy.data.objects.get("SpriteCamRig")
if rig:
    for obj in bpy.data.objects:
        if obj.type == 'LIGHT':
            obj.parent = rig
            obj.matrix_parent_inverse = rig.matrix_world.inverted()
            res += f"Parented {obj.name} to {rig.name}\\n"
else:
    res = "Rig not found"

import socket
try:
    s2 = socket.socket()
    s2.connect(('localhost', 9951))
    s2.sendall(res.encode())
    s2.close()
except: pass
"""

s = socket.socket()
s.connect(('localhost', 9876))
s.sendall(json.dumps({'type': 'execute_code', 'params': {'code': blender_code}}).encode())
s.close()
