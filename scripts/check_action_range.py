import socket
import json

blender_code = """
import bpy
res = ""
action = bpy.data.actions.get("Kneel.Dying")
if action:
    res = f"Frame range: {action.frame_range[0]} to {action.frame_range[1]}"
else:
    res = "Not found"

import socket
try:
    s2 = socket.socket()
    s2.connect(('localhost', 9945))
    s2.sendall(res.encode())
    s2.close()
except: pass
"""

s = socket.socket()
s.connect(('localhost', 9876))
s.sendall(json.dumps({'type': 'execute_code', 'params': {'code': blender_code}}).encode())
s.close()
