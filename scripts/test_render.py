import socket
import json

blender_code = """
import bpy
import os
import math

try:
    scene = bpy.context.scene
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    
    # Create absolute isolated camera
    cam_data = bpy.data.cameras.new("TestCamData")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 12.0
    cam = bpy.data.objects.new("TestCamObj", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    
    cam.location = (0, -5, 1.2)
    cam.rotation_euler = (math.radians(80), 0, math.radians(90)) # Angle 2
    
    bpy.context.scene.camera = cam
    
    # Set character pose
    armature = bpy.data.objects.get("Armature")
    action = bpy.data.actions.get("Kneel.Dying")
    armature.animation_data.action = action
    bpy.context.scene.frame_set(43)
    bpy.context.view_layer.update()
    
    # Render
    out_path = os.path.expanduser("~/Documents/output/renders_test/TEST_FRAME_43.png")
    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    
    # Remove camera
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cam_data)
    
    res = f"Rendered {out_path} with ortho_scale 12.0! File exists: {os.path.exists(out_path)}"
except Exception as e:
    res = f"Error: {e}"

import socket
try:
    s2 = socket.socket()
    s2.connect(('localhost', 9939))
    s2.sendall(res.encode())
    s2.close()
except: pass
"""

s = socket.socket()
s.connect(('localhost', 9876))
s.sendall(json.dumps({'type': 'execute_code', 'params': {'code': blender_code}}).encode())
s.close()
