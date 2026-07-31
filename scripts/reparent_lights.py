import socket
import json

blender_code = """
import bpy

rig = bpy.data.objects.get("SpriteCamRig")
if rig:
    key = bpy.data.objects.get("SpriteLight_Key")
    fill = bpy.data.objects.get("SpriteLight_Fill")
    if key and key.parent != rig:
        key.parent = rig
    if fill and fill.parent != rig:
        fill.parent = rig
    print("Reparented lights to rig.")
"""

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('localhost', 9876))
payload = {
    "type": "execute_code",
    "params": {"code": blender_code}
}
s.sendall(json.dumps(payload).encode('utf-8'))
s.shutdown(socket.SHUT_WR)
s.close()
