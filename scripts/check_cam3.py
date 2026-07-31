import socket
import json

blender_code = """
import bpy
bpy.context.scene.frame_set(43)
res = bpy.context.scene.camera.name

import socket
try:
    s2 = socket.socket()
    s2.connect(('localhost', 9942))
    s2.sendall(res.encode())
    s2.close()
except: pass
"""

s = socket.socket()
s.connect(('localhost', 9876))
s.sendall(json.dumps({'type': 'execute_code', 'params': {'code': blender_code}}).encode())
s.close()
