import socket
import json

script_path = "c:/Projects/squad_tactics/scripts/render_poses.py"
with open(script_path, "r", encoding='utf-8') as f:
    code = f.read()

# Make it synchronous by using the result port
code += """
import socket
try:
    s2 = socket.socket()
    s2.connect(('localhost', 9955))
    s2.sendall(b"DONE_OR_ERROR")
    s2.close()
except: pass
"""

s = socket.socket()
s.connect(('localhost', 9876))
s.sendall(json.dumps({'type': 'execute_code', 'params': {'code': code}}).encode())
s.close()
