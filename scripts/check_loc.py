import socket
import json

blender_code = """
import bpy
armature = bpy.data.objects.get("Armature")
if armature:
    response = f"Armature Loc: {armature.location}"`n    import socket; s2=socket.socket(); s2.connect(("localhost", 9932)); s2.sendall(response.encode()); s2.close()
"""

s = socket.socket()
s.connect(('localhost', 9876))
s.sendall(json.dumps({'type': 'execute_code', 'params': {'code': blender_code}}).encode())
s.close()
