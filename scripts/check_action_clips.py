import socket
import json

blender_code = """
import bpy
import json

response = {}
try:
    a = bpy.data.actions.get("Stand.Throw_Grenade")
    paths = []
    if a:
        for layer in a.layers:
            for strip in layer.strips:
                if hasattr(strip, "action"):
                    # action clip strip
                    clip = strip.action
                    if clip:
                        for fc in clip.fcurves:
                            paths.append(fc.data_path)
    
    response = json.dumps({"paths": paths[:10]})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9894))
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
