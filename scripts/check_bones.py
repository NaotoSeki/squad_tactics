import socket
import json

blender_code = """
import bpy
import json

response = {}
try:
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    bone_name = arm.data.bones[0].name
    
    a1 = bpy.data.actions.get("Stand.Idle")
    dp1 = a1.fcurves[0].data_path if a1 else "No Action"
    
    a2 = bpy.data.actions.get("Stand.Throw_Grenade")
    dp2 = a2.fcurves[0].data_path if a2 else "No Action"
    
    response = json.dumps({"bone0": bone_name, "a1_path": dp1, "a2_path": dp2})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9886))
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
