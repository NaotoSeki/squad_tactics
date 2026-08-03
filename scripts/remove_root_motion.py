import socket
import json

blender_code = """
import bpy

removed_count = 0
for action in bpy.data.actions:
    is_legacy = getattr(action, "is_action_legacy", True)
    
    if is_legacy:
        curves_to_remove = []
        for fc in action.fcurves:
            if "location" in fc.data_path and ("Hips" in fc.data_path or "Root" in fc.data_path or fc.data_path == "location"):
                if fc.array_index in [0, 1]:  # X and Y
                    curves_to_remove.append(fc)
        for fc in curves_to_remove:
            action.fcurves.remove(fc)
            removed_count += 1
    else:
        # Slotted actions
        for layer in action.layers:
            for strip in layer.strips:
                if hasattr(strip, "channelbags"):
                    for bag in strip.channelbags:
                        if hasattr(bag, "fcurves"):
                            curves_to_remove = []
                            for fc in bag.fcurves:
                                if "location" in fc.data_path and ("Hips" in fc.data_path or "Root" in fc.data_path or fc.data_path == "location"):
                                    if fc.array_index in [0, 1]:
                                        curves_to_remove.append(fc)
                            for fc in curves_to_remove:
                                bag.fcurves.remove(fc)
                                removed_count += 1

print(f"Removed {removed_count} root motion curves.")
"""

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('localhost', 9876))
payload = {
    "type": "execute_code",
    "params": {"code": blender_code}
}
s.sendall(json.dumps(payload).encode('utf-8'))
s.close()
