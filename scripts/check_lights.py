import socket
import json

blender_code = """
import bpy
res = ""
for obj in bpy.data.objects:
    if obj.type == 'LIGHT':
        res += f"{obj.name} (parent: {obj.parent.name if obj.parent else 'None'})\\n"

import socket
try:
    s2 = socket.socket()
    s2.connect(('localhost', 9950))
    s2.sendall(res.encode())
    s2.close()
except: pass
"""

s = socket.socket()
s.connect(('localhost', 9876))
s.sendall(json.dumps({'type': 'execute_code', 'params': {'code': blender_code}}).encode())
s.close()
