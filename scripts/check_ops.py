import socket
import json

blender_code = """
import bpy
import json

response = {}
try:
    anim_ops = dir(bpy.ops.anim)
    action_ops = dir(bpy.ops.action)
    response = json.dumps({"anim_ops": anim_ops, "action_ops": action_ops})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9898))
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
