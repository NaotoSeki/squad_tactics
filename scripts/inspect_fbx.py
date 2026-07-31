import socket
import json

blender_code = """
import bpy
import os

p = r"C:\\Users\\aware.梨花のPC\\Downloads\\Kneel.Dying.fbx"

def get_override():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == 'VIEW_3D':
                return {"window": window, "screen": window.screen, "area": area}
    return {}

try:
    old_objs = set(bpy.data.objects)
    with bpy.context.temp_override(**get_override()):
        bpy.ops.import_scene.fbx(filepath=p)
    new_objs = list(set(bpy.data.objects) - old_objs)
    
    arm = [o for o in new_objs if o.type == 'ARMATURE'][0]
    bones = [b.name for b in arm.data.bones][:5]
    action = arm.animation_data.action
    is_legacy = getattr(action, "is_action_legacy", True)
    
    response = json.dumps({
        "imported_bones": bones,
        "action_is_legacy": is_legacy,
        "action_name": action.name if action else None
    })
    
    # clean up
    for obj in new_objs:
        bpy.data.objects.remove(obj, do_unlink=True)
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9902))
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
