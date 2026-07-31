import socket
import json

blender_code = """
import bpy
import sys
import traceback

response = "Success"
try:
    script_path = "c:/Projects/squad_tactics/scripts/render_poses.py"
    with open(script_path, "r", encoding='utf-8') as f:
        code = f.read()
    exec(code)
except Exception as e:
    response = traceback.format_exc()

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9918))
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
