import socket
import json

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('localhost', 9876))
payload = {
    "type": "execute_code",
    "params": {"code": "print('HELLO FROM MCP TEST')\nimport bpy\nprint('Scene:', bpy.context.scene.name)"}
}
s.sendall(json.dumps(payload).encode('utf-8'))
response = b""
s.settimeout(5.0)
while True:
    try:
        chunk = s.recv(4096)
        if not chunk:
            break
        response += chunk
    except Exception as e:
        print("Timeout or error:", e)
        break
print("Response:", response.decode('utf-8'))
s.close()
