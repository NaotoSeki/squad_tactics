import socket
import json

blender_code = """
import bpy
import json

response = "No match"
try:
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    nla = []
    if arm.animation_data and arm.animation_data.nla_tracks:
        for t in arm.animation_data.nla_tracks:
            nla.append({
                "name": t.name,
                "is_solo": t.is_solo,
                "mute": t.mute,
                "strips": [s.name for s in t.strips]
            })
            
    response = json.dumps({"nla": nla})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9921))
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
