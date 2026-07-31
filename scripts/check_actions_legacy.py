import socket
import json

blender_code = """
import bpy
import json

response = "No match"
try:
    a1 = bpy.data.actions.get("Kneel.Forward")
    slots1 = [s.identifier for s in a1.slots] if hasattr(a1, "slots") else []
    
    a2 = bpy.data.actions.get("Stand.Throw_Grenade")
    slots2 = [s.identifier for s in a2.slots] if hasattr(a2, "slots") else []
    
    response = json.dumps({
        "Kneel.Forward_legacy": getattr(a1, "is_action_legacy", True),
        "Kneel.Forward_slots": slots1,
        "Stand.Throw_Grenade_legacy": getattr(a2, "is_action_legacy", True),
        "Stand.Throw_Grenade_slots": slots2
    })
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9904))
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
