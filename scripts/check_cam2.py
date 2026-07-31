import socket
import json

blender_code = """
import bpy
try:
    cam = bpy.context.scene.camera
    if cam:
        cam.data.ortho_scale = 12.0
        res = f"Set Ortho scale: {cam.data.ortho_scale}"
    else:
        res = "No active camera"
except Exception as e:
    res = f"Error: {e}"

import socket
try:
    s2 = socket.socket()
    s2.connect(('localhost', 9937))
    s2.sendall(res.encode())
    s2.close()
except: pass
"""

s = socket.socket()
s.connect(('localhost', 9876))
s.sendall(json.dumps({'type': 'execute_code', 'params': {'code': blender_code}}).encode())
s.close()
