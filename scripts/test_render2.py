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
    
    # Create Rig
    rig = bpy.data.objects.new("TestRig", None)
    bpy.context.scene.collection.objects.link(rig)
    
    # Create absolute isolated camera
    cam_data = bpy.data.cameras.new("TestCamData")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 12.0
    cam = bpy.data.objects.new("TestCamObj", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    
    cam.parent = rig
    cam.location = (0, -5, 1.2)
    cam.rotation_euler = (math.radians(80), 0, 0)
    
    track = cam.constraints.new(type='TRACK_TO')
    track.target = rig
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    
    bpy.context.scene.camera = cam
    
    # Set character pose
    armature = bpy.data.objects.get("Armature")
    action = bpy.data.actions.get("Kneel.Dying")
    armature.animation_data.action = action
    
    for angle in range(8):
        rig.rotation_euler[2] = math.radians(360 / 8 * angle)
        bpy.context.scene.frame_set(43)
        bpy.context.view_layer.update()
        
        # Render
        out_path = os.path.expanduser(f"~/Documents/output/renders_test/TEST_FRAME_43_ang{angle}.png")
        scene.render.filepath = out_path
        bpy.ops.render.render(write_still=True)
    
    # Remove camera
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(rig)
    bpy.data.cameras.remove(cam_data)
    
    res = f"Rendered angles!"
except Exception as e:
    res = f"Error: {e}"

import socket
try:
    s2 = socket.socket()
    s2.connect(('localhost', 9940))
    s2.sendall(res.encode())
    s2.close()
except: pass
"""

s = socket.socket()
s.connect(('localhost', 9876))
s.sendall(json.dumps({'type': 'execute_code', 'params': {'code': blender_code}}).encode())
s.close()
