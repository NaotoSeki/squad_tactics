import socket
import json

blender_code = """
import bpy
import json

response = {}
try:
    a = bpy.data.actions.get("Stand.Throw_Grenade")
    if not a:
        response = "No Action Stand.Throw_Grenade"
    else:
        # Blender 5 Slotted Action API
        paths = []
        if getattr(a, "is_action_legacy", True):
            for fc in a.fcurves:
                paths.append(fc.data_path)
        else:
            for layer in a.layers:
                for strip in layer.strips:
                    if hasattr(strip, "fcurves"):
                        for fc in strip.fcurves:
                            paths.append(fc.data_path)
                            
        response = json.dumps({"is_legacy": getattr(a, "is_action_legacy", True), "paths": paths[:10]})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9889))
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
