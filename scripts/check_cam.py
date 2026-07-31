import socket
import json

blender_code = """
import bpy
res = ""
for c in bpy.data.cameras:
    res += f"{c.name}: {c.ortho_scale}, "

import socket
try:
    s2 = socket.socket()
    s2.connect(('localhost', 9935))
    s2.sendall(res.encode())
    s2.close()
except: pass
"""

s = socket.socket()
s.connect(('localhost', 9876))
s.sendall(json.dumps({'type': 'execute_code', 'params': {'code': blender_code}}).encode())
s.close()
