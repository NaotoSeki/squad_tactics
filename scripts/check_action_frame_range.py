import socket
import json

blender_code = """
import bpy
import json

response = "No match"
try:
    a = bpy.data.actions.get("Stand.Throw_Grenade")
    response = json.dumps({
        "frame_range": [a.frame_start, a.frame_end] if a else None
    })
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9911))
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
