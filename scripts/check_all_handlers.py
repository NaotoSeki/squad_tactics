import socket
import json

blender_code = """
import bpy
res = ""
for name in dir(bpy.app.handlers):
    if not name.startswith("_"):
        val = getattr(bpy.app.handlers, name)
        if isinstance(val, list) and len(val) > 0:
            res += f"{name}: {val}, "
if not res: res = "No handlers"

import socket
try:
    s2 = socket.socket()
    s2.connect(('localhost', 9938))
    s2.sendall(res.encode())
    s2.close()
except: pass
"""

s = socket.socket()
s.connect(('localhost', 9876))
s.sendall(json.dumps({'type': 'execute_code', 'params': {'code': blender_code}}).encode())
s.close()
