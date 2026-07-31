import bpy
import os
import math

# Configuration
OUTPUT_DIR = bpy.path.abspath("//output/renders/")
ANGLES = 8 # Number of directions to render
RESOLUTION_X = 512
RESOLUTION_Y = 512
FRAME_STEP = 3

def setup_camera_rig():
    # Remove existing cameras and rigs
    for obj in bpy.data.objects:
        if obj.type == 'CAMERA' or obj.name.startswith("SpriteCamRig"):
            bpy.data.objects.remove(obj)
            
    # Remove all camera data blocks!
    for cam in list(bpy.data.cameras):
        bpy.data.cameras.remove(cam)
        
    # Clear timeline markers (prevent camera switching)
    bpy.context.scene.timeline_markers.clear()
    
    # Create Camera Rig (Empty)
    rig = bpy.data.objects.new("SpriteCamRig", None)
    bpy.context.scene.collection.objects.link(rig)
    
    # Create Camera
    cam_data = bpy.data.cameras.new("SpriteCam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 6.0
    cam = bpy.data.objects.new("SpriteCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    
    # Parent camera to rig
    cam.parent = rig
    cam.location = (0, -5, 1.2)
    cam.rotation_euler = (math.radians(80), 0, 0)
    
    # Set as active camera
    bpy.context.scene.camera = cam
    
    # Setup constraints
    track = cam.constraints.new(type='TRACK_TO')
    track.target = rig
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    
    # Parent lights to rig so they rotate with the camera
    for obj in bpy.data.objects:
        if obj.type == 'LIGHT':
            obj.parent = rig
            obj.matrix_parent_inverse = rig.matrix_world.inverted()
    
    return rig, cam

def render_sprite_poses():
    # Setup rendering parameters
    scene = bpy.context.scene
    scene.render.resolution_x = RESOLUTION_X
    scene.render.resolution_y = RESOLUTION_Y
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = 'RGBA'
    
    rig, cam = setup_camera_rig()
    
    armature = bpy.data.objects.get("Armature")
    if not armature:
        print("Armature not found!")
        return

    # To avoid rendering everything
    actions = bpy.data.actions
    if len(actions) == 0:
        print("No actions found.")
        return

    for action in actions:
        armature.animation_data.action = action
        if not getattr(action, "is_action_legacy", True) and len(action.slots) > 0:
            armature.animation_data.action_slot_handle = action.slots[0].handle
        
        action_name = action.name
        
        start_frame = int(action.frame_range[0])
        end_frame = int(action.frame_range[1])
        
        # In case the action has no frames (e.g. range 0 to 0)
        if end_frame < start_frame:
            end_frame = start_frame
        
        for frame in range(start_frame, end_frame + 1, FRAME_STEP):
            scene.frame_set(frame)
            
            # Rotate camera rig for each angle
            for angle_idx in range(ANGLES):
                rotation_z = math.radians(360 / ANGLES * angle_idx)
                rig.rotation_euler[2] = rotation_z
                bpy.context.view_layer.update()
                
                # FORCE CAMERA EXPLICITLY
                scene.camera = cam
                cam.data.type = 'ORTHO'
                cam.data.ortho_scale = 6.0
                
                # Setup output path
                filename = f"{action_name}_f{frame:04d}_ang{angle_idx}.png"
                scene.render.filepath = os.path.join(OUTPUT_DIR, filename)
                
                # Render
                bpy.ops.render.render(write_still=True)
                print(f"Rendered: {filename}")

render_sprite_poses()
