import socket
import json

blender_code = """
import bpy
import os

paths = [
    r"C:\\Users\\aware.梨花のPC\\Downloads\\Kneel.Dying.fbx",
    r"C:\\Users\\aware.梨花のPC\\Downloads\\Kneel.Throw_Grenade.fbx",
    r"C:\\Users\\aware.梨花のPC\\Downloads\\Kneel_To_Prone.fbx",
    r"C:\\Users\\aware.梨花のPC\\Downloads\\Kneel_To_Stand.fbx",
    r"C:\\Users\\aware.梨花のPC\\Downloads\\Prone.Dying.fbx",
    r"C:\\Users\\aware.梨花のPC\\Downloads\\Prone.Throw_Grenade.fbx",
    r"C:\\Users\\aware.梨花のPC\\Downloads\\Prone_To_Kneel.fbx",
    r"C:\\Users\\aware.梨花のPC\\Downloads\\Stand.Dying.fbx",
    r"C:\\Users\\aware.梨花のPC\\Downloads\\Stand.Throw_Grenade.fbx",
    r"C:\\Users\\aware.梨花のPC\\Downloads\\Stand_To_Kneel.fbx"
]

def get_override():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == 'VIEW_3D':
                return {"window": window, "screen": window.screen, "area": area}
    return {}

override = get_override()

for p in paths:
    if not os.path.exists(p):
        print(f"Skipping missing: {p}")
        continue
    
    basename = os.path.basename(p)
    action_name = basename.replace('.fbx', '')
    
    old_objs = set(bpy.data.objects)
    old_actions = set(bpy.data.actions)
    
    try:
        with bpy.context.temp_override(**override):
            bpy.ops.import_scene.fbx(filepath=p)
    except Exception as e:
        print(f"Error importing {p}: {e}")
        continue
    
    new_objs = set(bpy.data.objects) - old_objs
    new_actions = set(bpy.data.actions) - old_actions
    
    if new_actions:
        action = list(new_actions)[0]
        action.name = action_name
        if not getattr(action, "is_action_legacy", True) and len(action.slots) > 0:
            action.slots[0].identifier = "OBArmature"
    
    # Rename bones on the newly imported armature so the Action's fcurves automatically update!
    for obj in new_objs:
        if obj.type == 'ARMATURE':
            for bone in obj.data.bones:
                if not bone.name.startswith("mixamorig:"):
                    bone.name = "mixamorig:" + bone.name
                    
    for obj in new_objs:
        bpy.data.objects.remove(obj, do_unlink=True)
        
    print(f"Successfully imported action: {action_name}")
"""

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('localhost', 9876))
payload = {
    "type": "execute_code",
    "params": {"code": blender_code}
}
s.sendall(json.dumps(payload).encode('utf-8'))
s.shutdown(socket.SHUT_WR)

response = b""
s.settimeout(10.0)
while True:
    try:
        chunk = s.recv(4096)
        if not chunk: break
        response += chunk
    except socket.timeout:
        break
print(response.decode('utf-8'))
s.close()
