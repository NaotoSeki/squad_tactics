import socket
import json

blender_code = """
import bpy
import json

response = "No actions"
try:
    action = bpy.data.actions.get("Kneel.Forward")
    if action:
        curves = []
        for fc in action.fcurves:
            if "location" in fc.data_path:
                curves.append(f"{fc.data_path} [{fc.array_index}]")
        response = json.dumps(curves)
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9878))
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
