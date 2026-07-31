import socket
import json

blender_code = """
import bpy
import json

response = ""
try:
    a1 = bpy.data.actions.get("Stand.Idle")
    a2 = bpy.data.actions.get("Stand.Throw_Grenade")
    
    dp1 = a1.fcurves[0].data_path if a1 and len(a1.fcurves) else "None"
    dp2 = a2.fcurves[0].data_path if a2 and len(a2.fcurves) else "None"
    
    response = json.dumps({"Stand.Idle": dp1, "Stand.Throw_Grenade": dp2})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9885))
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
