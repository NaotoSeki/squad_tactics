import socket
import json

blender_code = """
import bpy
import json

response = "Failed"
try:
    a = bpy.data.actions.get("Stand.Throw_Grenade")
    slots = [s.identifier for s in a.slots] if hasattr(a, "slots") else []
    
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    action_slot_handle = arm.animation_data.action_slot_handle
    
    response = json.dumps({"slots": slots[:10], "arm_slot_handle": action_slot_handle})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9901))
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
