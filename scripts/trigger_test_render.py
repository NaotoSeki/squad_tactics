import socket
import json

blender_code = """
import bpy
import math
import os

OUTPUT_DIR = bpy.path.abspath("//output/temp_calib/")
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

scene = bpy.context.scene
scene.render.resolution_x = 256
scene.render.resolution_y = 256
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'

rig = bpy.data.objects.get("SpriteCamRig")
if not rig:
    # Use low level API instead of bpy.ops to avoid context errors
    rig = bpy.data.objects.new("SpriteCamRig", None)
    scene.collection.objects.link(rig)
    
    cam_data = bpy.data.cameras.new("SpriteCam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 3.2
    cam = bpy.data.objects.new("SpriteCam", cam_data)
    scene.collection.objects.link(cam)
    
    cam.location = (0, -5, 1.2)
    cam.rotation_euler = (math.radians(80), 0, 0)
    cam.parent = rig
    
scene.camera = bpy.data.objects.get("SpriteCam")

armature = None
for obj in bpy.context.scene.objects:
    if obj.type == 'ARMATURE':
        armature = obj
        break

if armature and not armature.animation_data:
    armature.animation_data_create()

def test_render(action_name, angle_idx):
    action = bpy.data.actions.get(action_name)
    if not action: return
    armature.animation_data.action = action
    frame = int(action.frame_range[0])
    scene.frame_set(frame)
    rig.rotation_euler[2] = math.radians(360 / 8 * angle_idx)
    bpy.context.view_layer.update()
    
    filename = f"{action_name}_ang{angle_idx}.png"
    scene.render.filepath = os.path.join(OUTPUT_DIR, filename)
    bpy.ops.render.render(write_still=True)
    print("Rendered:", filename)

test_render("Prone.Fire", 2)
test_render("Stand.Fire", 0)
test_render("Stand.Fire", 2)
test_render("Kneel.Fire", 2)
"""

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('localhost', 9876))
payload = {
    "type": "execute_code",
    "params": {"code": blender_code}
}
s.sendall(json.dumps(payload).encode('utf-8'))
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
