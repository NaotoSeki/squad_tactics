import socket
import json

blender_code = """
import bpy
import json

response = {}
try:
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    bone_names = [b.name for b in arm.data.bones][:5]
    
    a2 = bpy.data.actions.get("Stand.Throw_Grenade")
    paths = []
    if a2:
        for layer in a2.layers:
            for strip in layer.strips:
                if hasattr(strip, "fcurves"):
                    for fc in strip.fcurves:
                        paths.append(fc.data_path)
    
    response = json.dumps({"arm_bones": bone_names, "action_paths": paths[:5]})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9892))
    s.sendall(response.encode('utf-8'))
    s.close()
except:
    pass
"""

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('localhost', 9876))
payload = {
    "type": "execute_code",
    "params": {"code": blender_code}
}
s.sendall(json.dumps(payload).encode('utf-8'))
s.close()
