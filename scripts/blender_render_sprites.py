import bpy
import os
import math

# Configuration
OUTPUT_DIR = os.path.join(os.path.dirname(bpy.data.filepath), "renders")
RESOLUTION_X = 256
RESOLUTION_Y = 256
CAMERA_ELEVATION_DEG = 30  # 30-35 degrees for commercial isometric
DIRECTIONS = 8
# North-West lighting (45 degrees)
LIGHT_ROT_X = math.radians(45)
LIGHT_ROT_Y = 0
LIGHT_ROT_Z = math.radians(45)

def setup_scene():
    scene = bpy.context.scene
    
    # Render settings
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'RenderEngine') else 'BLENDER_EEVEE'
    scene.render.resolution_x = RESOLUTION_X
    scene.render.resolution_y = RESOLUTION_Y
    scene.render.film_transparent = True
    
    # Delete default camera and light if they exist
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.data.objects:
        if obj.type in ['CAMERA', 'LIGHT']:
            obj.select_set(True)
    bpy.ops.object.delete()
    
    # Setup Sun Light (Fixed NW 45 degree)
    bpy.ops.object.light_add(type='SUN', align='WORLD', location=(0, 0, 10))
    sun = bpy.context.active_object
    sun.rotation_euler = (LIGHT_ROT_X, LIGHT_ROT_Y, LIGHT_ROT_Z)
    sun.data.energy = 3.0
    sun.data.use_contact_shadow = True
    
    # Setup Orthographic Camera
    bpy.ops.object.camera_add(location=(0, -10, 10))
    cam = bpy.context.active_object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 5.0 # Adjust based on model size
    
    # Create an Empty to act as camera target (focus point)
    bpy.ops.object.empty_add(type='PLAIN_AXES', align='WORLD', location=(0, 0, 1)) # Aim at chest height
    target = bpy.context.active_object
    
    # Add TrackTo constraint so camera always points at target
    track_constraint = cam.constraints.new(type='TRACK_TO')
    track_constraint.target = target
    track_constraint.track_axis = 'TRACK_NEGATIVE_Z'
    track_constraint.up_axis = 'UP_Y'
    
    scene.camera = cam
    return cam, target

def render_8_directions(cam, target):
    scene = bpy.context.scene
    start_frame = scene.frame_start
    end_frame = scene.frame_end
    
    # Calculate distance for the camera from the target
    # To get 30 degree elevation, Z = r * sin(30), XY_dist = r * cos(30)
    # Let's pick a fixed radius of 15
    radius = 15.0
    elevation_rad = math.radians(CAMERA_ELEVATION_DEG)
    z_height = radius * math.sin(elevation_rad)
    xy_dist = radius * math.cos(elevation_rad)
    
    for direction in range(DIRECTIONS):
        # 0 = South, 1 = South-East, 2 = East, etc. (Depending on game coordinate system)
        angle_deg = direction * (360.0 / DIRECTIONS)
        angle_rad = math.radians(angle_deg)
        
        # Position camera in a circle around the target
        cam.location.x = target.location.x + xy_dist * math.sin(angle_rad)
        cam.location.y = target.location.y - xy_dist * math.cos(angle_rad)
        cam.location.z = target.location.z + z_height
        
        # Ensure constraint updates
        bpy.context.view_layer.update()
        
        dir_name = f"dir_{direction}"
        
        for frame in range(start_frame, end_frame + 1):
            scene.frame_set(frame)
            file_path = os.path.join(OUTPUT_DIR, dir_name, f"frame_{frame:04d}.png")
            scene.render.filepath = file_path
            print(f"Rendering Direction {direction}, Frame {frame} -> {file_path}")
            bpy.ops.render.render(write_still=True)

if __name__ == "__main__":
    print("--- Starting 3D-to-2D Isometric Render Pipeline ---")
    cam, target = setup_scene()
    render_8_directions(cam, target)
    print("--- Rendering Complete ---")
