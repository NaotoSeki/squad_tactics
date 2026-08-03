import bpy
import bmesh
import math
import random
import os

# ---------------------------------------------------------
# Utils
# ---------------------------------------------------------
def clear_scene():
    try:
        if bpy.context.active_object and bpy.context.active_object.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
    except:
        pass
    
    objects_to_delete = [obj for obj in bpy.context.scene.objects if obj.type in ['MESH', 'EMPTY', 'CURVE', 'LIGHT', 'CAMERA']]
    for obj in objects_to_delete:
        bpy.data.objects.remove(obj, do_unlink=True)

def load_image(filepath):
    if os.path.exists(filepath):
        return bpy.data.images.load(filepath)
    return None

def create_image_pbr_material(name, path_prefix, uv_scale=1.0):
    if name in bpy.data.materials:
        mat = bpy.data.materials[name]
    else:
        mat = bpy.data.materials.new(name=name)
    
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(bsdf.outputs[0], output.inputs['Surface'])
    
    color_img = load_image(f"{path_prefix}_Color.jpg")
    rough_img = load_image(f"{path_prefix}_Roughness.jpg")
    normal_img = load_image(f"{path_prefix}_NormalGL.jpg")
    if not normal_img:
        normal_img = load_image(f"{path_prefix}_NormalDX.jpg")
        
    tex_coord = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (uv_scale, uv_scale, uv_scale)
    links.new(tex_coord.outputs['Object'], mapping.inputs['Vector'])
    
    if color_img:
        tex_color = nodes.new('ShaderNodeTexImage')
        tex_color.image = color_img
        tex_color.projection = 'BOX'
        tex_color.extension = 'REPEAT'
        links.new(mapping.outputs['Vector'], tex_color.inputs['Vector'])
        links.new(tex_color.outputs['Color'], bsdf.inputs['Base Color'])
        
    if rough_img:
        tex_rough = nodes.new('ShaderNodeTexImage')
        tex_rough.image = rough_img
        tex_rough.image.colorspace_settings.name = 'Non-Color'
        tex_rough.projection = 'BOX'
        tex_rough.extension = 'REPEAT'
        links.new(mapping.outputs['Vector'], tex_rough.inputs['Vector'])
        links.new(tex_rough.outputs['Color'], bsdf.inputs['Roughness'])
        
    if normal_img:
        tex_normal = nodes.new('ShaderNodeTexImage')
        tex_normal.image = normal_img
        tex_normal.image.colorspace_settings.name = 'Non-Color'
        tex_normal.projection = 'BOX'
        tex_normal.extension = 'REPEAT'
        links.new(mapping.outputs['Vector'], tex_normal.inputs['Vector'])
        
        normal_map = nodes.new('ShaderNodeNormalMap')
        links.new(tex_normal.outputs['Color'], normal_map.inputs['Color'])
        links.new(normal_map.outputs['Normal'], bsdf.inputs['Normal'])
        
    return mat

def create_ruined_wall(parent, loc, rot_z, length, height, thickness, material=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,0))
    wall = bpy.context.active_object
    wall.name = "RuinedWall"
    
    wall.scale = (thickness, length, height)
    wall.location = (loc[0], loc[1], loc[2] + height/2.0)
    wall.rotation_euler[2] = rot_z
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=5)
    bpy.ops.object.mode_set(mode='OBJECT')
    
    num_cuts = random.randint(2, 4)
    for i in range(num_cuts):
        bpy.ops.mesh.primitive_cube_add(size=1)
        cutter = bpy.context.active_object
        
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.subdivide(number_cuts=8)
        bpy.ops.object.mode_set(mode='OBJECT')
        
        mod = cutter.modifiers.new("Displace", 'DISPLACE')
        if "VoronoiRuin" not in bpy.data.textures:
            tex = bpy.data.textures.new("VoronoiRuin", 'VORONOI')
            tex.noise_scale = 1.0
        mod.texture = bpy.data.textures["VoronoiRuin"]
        mod.strength = 0.8
        
        cutter.scale = (height*0.8, height*0.8, height*0.8)
        cut_z = height * random.uniform(0.5, 1.2)
        cut_y = loc[1] + random.uniform(-length*0.4, length*0.4)
        cutter.location = (loc[0], cut_y, loc[2] + cut_z)
        cutter.rotation_euler = (random.uniform(0, 3.14), random.uniform(0, 3.14), random.uniform(0, 3.14))
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        
        bool_mod = wall.modifiers.new("Boolean", 'BOOLEAN')
        bool_mod.object = cutter
        bool_mod.operation = 'DIFFERENCE'
        bool_mod.solver = 'EXACT'
        
        bpy.context.view_layer.objects.active = wall
        bpy.ops.object.modifier_apply(modifier="Boolean")
        
        bpy.ops.object.select_all(action='DESELECT')
        cutter.select_set(True)
        bpy.ops.object.delete()
        
    crack_mod = wall.modifiers.new("DisplaceCracks", 'DISPLACE')
    if "WallCracks" not in bpy.data.textures:
        tex = bpy.data.textures.new("WallCracks", 'VORONOI')
        tex.noise_scale = 0.3
    crack_mod.texture = bpy.data.textures["WallCracks"]
    crack_mod.strength = 0.05
    
    if material:
        wall.data.materials.append(material)
    
    wall.parent = parent
    return wall

def create_rubble(parent, center, radius, count, material=None):
    for i in range(count):
        bpy.ops.mesh.primitive_cube_add(size=1)
        rock = bpy.context.active_object
        
        scale_x = random.uniform(0.05, 0.25)
        scale_y = random.uniform(0.05, 0.25)
        scale_z = random.uniform(0.02, 0.15)
        rock.scale = (scale_x, scale_y, scale_z)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.subdivide(number_cuts=2)
        bpy.ops.object.mode_set(mode='OBJECT')
        
        mod = rock.modifiers.new("Displace", 'DISPLACE')
        if "RubbleVoronoi" not in bpy.data.textures:
            tex = bpy.data.textures.new("RubbleVoronoi", 'VORONOI')
            tex.noise_scale = 0.2
        mod.texture = bpy.data.textures["RubbleVoronoi"]
        mod.strength = 0.03
        
        bpy.context.view_layer.objects.active = rock
        bpy.ops.object.modifier_apply(modifier="Displace")
        
        angle = random.uniform(0, 2 * math.pi)
        r = radius * math.sqrt(random.uniform(0, 1))
        rock.location = (
            center[0] + r * math.cos(angle),
            center[1] + r * math.sin(angle),
            scale_z / 2.0
        )
        rock.rotation_euler = (random.uniform(0, 3.14), random.uniform(0, 3.14), random.uniform(0, 3.14))
        rock.name = "ConcreteChunk"
        
        if material:
            rock.data.materials.append(material)
            
        rock.parent = parent

def create_czech_hedgehog(parent, loc, material=None):
    bpy.ops.mesh.primitive_cube_add(size=1)
    beam1 = bpy.context.active_object
    beam1.scale = (0.05, 0.05, 1.2)
    beam1.rotation_euler = (math.radians(45), math.radians(45), 0)
    
    bpy.ops.mesh.primitive_cube_add(size=1)
    beam2 = bpy.context.active_object
    beam2.scale = (0.05, 0.05, 1.2)
    beam2.rotation_euler = (math.radians(-45), math.radians(45), 0)
    
    bpy.ops.mesh.primitive_cube_add(size=1)
    beam3 = bpy.context.active_object
    beam3.scale = (0.05, 0.05, 1.2)
    beam3.rotation_euler = (0, math.radians(90), math.radians(45))
    
    bpy.ops.object.select_all(action='DESELECT')
    beam1.select_set(True)
    beam2.select_set(True)
    beam3.select_set(True)
    bpy.context.view_layer.objects.active = beam1
    bpy.ops.object.join()
    
    hedgehog = bpy.context.active_object
    hedgehog.name = "CzechHedgehog"
    hedgehog.location = loc
    hedgehog.location.z = 0.4
    hedgehog.rotation_euler.z = random.uniform(0, math.pi)
    
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    
    if material:
        hedgehog.data.materials.append(material)
        
    hedgehog.parent = parent
    return hedgehog

# ---------------------------------------------------------
# Builders
# ---------------------------------------------------------

def build_corner_ruin(parent, mat_brick, mat_concrete, mat_metal):
    create_ruined_wall(parent, loc=(0.5, 0.5, 0), rot_z=math.radians(30), length=2.5, height=random.uniform(2.5, 3.5), thickness=0.4, material=mat_brick)
    create_ruined_wall(parent, loc=(0.5, 0.5, 0), rot_z=math.radians(120), length=2.5, height=random.uniform(2.5, 3.5), thickness=0.4, material=mat_brick)
    create_rubble(parent, center=(0.5, 0.5, 0), radius=1.8, count=random.randint(40, 70), material=mat_concrete)
    if random.random() > 0.5:
        create_czech_hedgehog(parent, loc=(-1.0, -0.5, 0), material=mat_metal)

def build_straight_road(parent, mat_brick, mat_concrete, mat_metal):
    # Walls on both sides of a path
    create_ruined_wall(parent, loc=(0, 1.2, 0), rot_z=0, length=4.0, height=random.uniform(2.0, 3.0), thickness=0.3, material=mat_brick)
    create_ruined_wall(parent, loc=(0, -1.2, 0), rot_z=0, length=4.0, height=random.uniform(2.0, 3.0), thickness=0.3, material=mat_brick)
    create_rubble(parent, center=(0, 1.0, 0), radius=1.0, count=random.randint(20, 40), material=mat_concrete)
    create_rubble(parent, center=(0, -1.0, 0), radius=1.0, count=random.randint(20, 40), material=mat_concrete)

def build_crater(parent, mat_brick, mat_concrete, mat_metal):
    # Mostly rubble
    create_rubble(parent, center=(0, 0, 0), radius=2.2, count=random.randint(80, 120), material=mat_concrete)
    for _ in range(random.randint(1, 3)):
        create_czech_hedgehog(parent, loc=(random.uniform(-1,1), random.uniform(-1,1), 0), material=mat_metal)

def build_checkpoint(parent, mat_brick, mat_concrete, mat_metal):
    # Heavy barricades
    create_ruined_wall(parent, loc=(1.0, 0, 0), rot_z=math.radians(90), length=1.5, height=1.5, thickness=0.6, material=mat_brick)
    create_ruined_wall(parent, loc=(-1.0, 0, 0), rot_z=math.radians(90), length=1.5, height=1.5, thickness=0.6, material=mat_brick)
    create_rubble(parent, center=(0, 0, 0), radius=1.5, count=40, material=mat_concrete)
    create_czech_hedgehog(parent, loc=(0, 0.5, 0), material=mat_metal)
    create_czech_hedgehog(parent, loc=(0, -0.5, 0), material=mat_metal)
    create_czech_hedgehog(parent, loc=(0.5, 0, 0), material=mat_metal)

# ---------------------------------------------------------
# Render Setup
# ---------------------------------------------------------

def setup_camera_and_render(output_dir):
    bpy.ops.object.camera_add(location=(5, -5, 5), rotation=(math.radians(60), 0, math.radians(45)))
    cam = bpy.context.active_object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 5.0
    bpy.context.scene.camera = cam
    
    # Lighting
    bpy.ops.object.light_add(type='SUN', radius=1, align='WORLD', location=(5, 5, 10), rotation=(math.radians(45), math.radians(45), 0))
    bpy.context.active_object.data.energy = 5.0
    
    bpy.ops.object.light_add(type='AREA', radius=5, align='WORLD', location=(-5, -5, 5), rotation=(math.radians(45), math.radians(0), math.radians(135)))
    bpy.context.active_object.data.energy = 100.0

    # Render settings
    bpy.context.scene.render.engine = 'CYCLES'  # CYCLES for best PBR, or EEVEE
    bpy.context.scene.cycles.samples = 32
    bpy.context.scene.render.resolution_x = 512
    bpy.context.scene.render.resolution_y = 512
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.render.image_settings.color_mode = 'RGBA'
    bpy.context.scene.render.image_settings.file_format = 'PNG'

# ---------------------------------------------------------
# Main Batch Loop
# ---------------------------------------------------------

def main():
    clear_scene()
    
    base_dir = "C:/Projects/squad_tactics/asset/environment/pbr/"
    mat_brick = create_image_pbr_material("RealBrick", base_dir + "Bricks076A/Bricks076A_1K-JPG", uv_scale=1.5)
    mat_concrete = create_image_pbr_material("RealConcrete", base_dir + "Concrete031/Concrete031_1K-JPG", uv_scale=2.0)
    mat_metal = create_image_pbr_material("RealMetal", base_dir + "Metal040/Metal040_1K-JPG", uv_scale=1.0)
    
    out_dir = "C:/Projects/squad_tactics/asset/environment/hex_tiles"
    os.makedirs(out_dir, exist_ok=True)
    
    setup_camera_and_render(out_dir)
    
    builders = [
        ("corner", build_corner_ruin),
        ("straight", build_straight_road),
        ("crater", build_crater),
        ("checkpoint", build_checkpoint)
    ]
    
    variations_per_type = 2
    
    for b_name, b_func in builders:
        for v in range(variations_per_type):
            # Create a parent empty to hold this variation
            bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0,0,0))
            parent = bpy.context.active_object
            
            b_func(parent, mat_brick, mat_concrete, mat_metal)
            
            for angle_idx in range(6):
                deg = angle_idx * 60
                parent.rotation_euler.z = math.radians(deg)
                
                # Render
                out_path = os.path.join(out_dir, f"{b_name}_v{v}_rot{deg}.png")
                bpy.context.scene.render.filepath = out_path
                bpy.ops.render.render(write_still=True)
                print(f"Rendered: {out_path}")
            
            # Clean up children and parent
            bpy.ops.object.select_all(action='DESELECT')
            parent.select_set(True)
            for child in parent.children:
                child.select_set(True)
            bpy.ops.object.delete()

    print("Manufacture complete!")

main()
