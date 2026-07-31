import socket
import json

blender_code = """
import bpy
import json

response = "Failed"
try:
    has_opt = hasattr(bpy.context.preferences.edit, "use_slotted_actions_by_default")
    response = json.dumps({"has_opt": has_opt})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9899))
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
