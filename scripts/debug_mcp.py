import socket
import json

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('localhost', 9876))
code = """
import bpy
import os
try:
    armature = None
    for obj in bpy.context.scene.objects:
        if obj.type == 'ARMATURE':
            armature = obj
            break
    print('Armature:', armature.name if armature else None)
    out_dir = bpy.path.abspath('//output/renders/')
    print('Output dir:', out_dir)
    print('Actions:', [a.name for a in bpy.data.actions])
except Exception as e:
    print('Error:', e)
"""
payload = {
    "type": "execute_code",
    "params": {"code": code}
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
        break
print("Response:", response.decode('utf-8'))
s.close()
