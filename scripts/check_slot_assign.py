import socket
import json

blender_code = """
import bpy
import json

response = {}
try:
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    anim_data = arm.animation_data
    action = bpy.data.actions[0]
    
    anim_data.action = action
    # try to assign the first slot
    try:
        anim_data.action_slot_handle = action.slots[0].handle
        success = True
    except Exception as e1:
        success = str(e1)
        
    response = json.dumps({"slot_success": success})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9891))
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
