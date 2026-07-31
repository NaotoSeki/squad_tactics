import socket
import json

blender_code = """
import bpy
import json

response = "No match"
try:
    a = bpy.data.actions.get("Stand.Throw_Grenade")
    if getattr(a, "is_action_legacy", True):
        paths = [fc.data_path for fc in a.fcurves]
    else:
        # For slotted actions, fcurves are actually inside the slots or bindings?
        paths = []
        for slot in a.slots:
            # slot has no fcurves, maybe slot.action ?
            if hasattr(slot, "action") and slot.action:
                for fc in slot.action.fcurves:
                    paths.append(fc.data_path)
            elif hasattr(slot, "bindings"):
                pass
            
    response = json.dumps({"dir_slot": dir(a.slots[0]) if a and hasattr(a, "slots") and len(a.slots) else None})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9895))
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
