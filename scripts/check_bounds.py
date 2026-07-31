import socket
import json

blender_code = """
import bpy

armature = bpy.data.objects.get("Armature")
action = bpy.data.actions.get("Kneel.Dying")

if armature and action:
    armature.animation_data.action = action
    if not getattr(action, "is_action_legacy", True):
        armature.animation_data.action_slot_handle = action.slots[0].handle
    
    min_x, max_x = 999, -999
    min_y, max_y = 999, -999
    
    for frame in range(0, 50, 5):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for pb in armature.pose.bones:
            loc = armature.matrix_world @ pb.head
            if loc.x < min_x: min_x = loc.x
            if loc.x > max_x: max_x = loc.x
            if loc.y < min_y: min_y = loc.y
            if loc.y > max_y: max_y = loc.y
            
    response = f"Bounds X: {min_x:.2f} to {max_x:.2f}, Y: {min_y:.2f} to {max_y:.2f}"
else:
    response = "No armature or action"

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9931))
    s.sendall(response.encode())
    s.close()
except:
    pass
"""

s = socket.socket()
s.connect(('localhost', 9876))
s.sendall(json.dumps({"type": "execute_code", "params": {"code": blender_code}}).encode())
s.close()
