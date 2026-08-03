import socket
import json

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('localhost', 9876))
script_path = "c:/Projects/squad_tactics/scripts/render_poses.py"
with open(script_path, "r", encoding='utf-8') as f:
    code = f.read()

payload = {
    "type": "execute_code",
    "params": {"code": code}
}
s.sendall(json.dumps(payload).encode('utf-8'))
s.shutdown(socket.SHUT_WR)
print("Render command sent to Blender. Blender will now process it asynchronously.")
s.close()
