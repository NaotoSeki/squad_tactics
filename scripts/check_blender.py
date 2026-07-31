import socket
import json

blender_code = """
import bpy
import json

try:
    timers = getattr(bpy.app.timers, "is_registered", "unknown")
    response = "Blender is alive."
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9879))
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
