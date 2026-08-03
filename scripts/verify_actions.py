import socket
import json

blender_code = """
import bpy
import json
import socket

# Send the action names back to localhost:9877
actions = [a.name for a in bpy.data.actions]
try:
    s = socket.socket()
    s.connect(('localhost', 9877))
    s.sendall(json.dumps(actions).encode('utf-8'))
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
