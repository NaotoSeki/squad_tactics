import socket
import json

blender_code = """
import bpy
import json

response = "No match"
try:
    a = bpy.data.actions.get("Stand.Throw_Grenade")
    has_fcurves = False
    fcurves_count = 0
    if a:
        for layer in a.layers:
            for strip in layer.strips:
                if hasattr(strip, "fcurves"):
                    has_fcurves = True
                    fcurves_count = len(strip.fcurves)
                
    response = json.dumps({"has_fcurves": has_fcurves, "count": fcurves_count})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9906))
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
