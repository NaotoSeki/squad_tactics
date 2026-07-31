import socket
import json

blender_code = """
import bpy
import json
import mathutils

response = "No match"
try:
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    action = bpy.data.actions.get("Stand.Throw_Grenade")
    
    arm.animation_data.action = action
    if not getattr(action, "is_action_legacy", True) and len(action.slots) > 0:
        arm.animation_data.action_slot_handle = action.slots[0].handle
        
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    pos1 = arm.pose.bones["mixamorig:RightHand"].matrix.translation.copy()
    
    bpy.context.scene.frame_set(50)
    bpy.context.view_layer.update()
    pos2 = arm.pose.bones["mixamorig:RightHand"].matrix.translation.copy()
    
    diff = (pos1 - pos2).length
    
    # Check if the slot identifier is the problem
    slot_id = action.slots[0].identifier if hasattr(action, "slots") and len(action.slots) > 0 else None
    
    # Try creating a new legacy action from the slotted one
    paths = []
    if hasattr(action, "layers"):
        for layer in action.layers:
            for strip in layer.strips:
                if hasattr(strip, "channelbags"):
                    for bag in strip.channelbags:
                        for fc in bag.fcurves:
                            paths.append(fc.data_path)
                            break
    
    response = json.dumps({
        "pos1": [pos1.x, pos1.y, pos1.z],
        "pos2": [pos2.x, pos2.y, pos2.z],
        "diff": diff,
        "slot_id": slot_id,
        "sample_path": paths[0] if paths else None
    })
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9919))
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
