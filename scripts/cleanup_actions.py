import socket
import json

blender_code = """
import bpy
import json

original_actions = [
    "Stand.Idle", "Stand.Forward", "Stand.Fire",
    "Kneel.Idle", "Kneel.Forward", "Kneel.Fire",
    "Prone.Idle", "Prone.Forward", "Prone.Fire"
]

removed = []
for action in list(bpy.data.actions):
    if action.name not in original_actions:
        removed.append(action.name)
        bpy.data.actions.remove(action)

response = json.dumps({"removed": removed})

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9915))
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
