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
        return bpy.data.materials[name]
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
        
    # Enhance brick color (make it less grey/washed out)
    if "Brick" in name:
        bsdf.inputs['Base Color'].default_value = (0.7, 0.35, 0.25, 1.0)
    
    return mat

def add_fracture(obj, parent, cutter_size, loc, rot, tex_name="VoronoiRuin", noise_scale=1.0, strength=1.0):
    bpy.ops.mesh.primitive_cube_add(size=1)
    cutter = bpy.context.active_object
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=5)
    bpy.ops.object.mode_set(mode='OBJECT')
    
    mod = cutter.modifiers.new("Displace", 'DISPLACE')
    if tex_name not in bpy.data.textures:
        tex = bpy.data.textures.new(tex_name, 'VORONOI')
        tex.noise_scale = noise_scale
    mod.texture = bpy.data.textures[tex_name]
    mod.strength = strength
    
    cutter.scale = cutter_size
    cutter.location = loc
    cutter.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    
    bool_mod = obj.modifiers.new("Boolean", 'BOOLEAN')
    bool_mod.object = cutter
    bool_mod.operation = 'DIFFERENCE'
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="Boolean")
    
    bpy.ops.object.select_all(action='DESELECT')
    cutter.select_set(True)
    bpy.ops.object.delete()

def create_ruined_wall(parent, loc, rot_z, length, height, thickness, material=None, rebar_mat=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,0))
    wall = bpy.context.active_object
    wall.name = "RuinedWall"
    
    wall.scale = (thickness, length, height)
    wall.location = (loc[0], loc[1], loc[2] + height/2.0)
    wall.rotation_euler[2] = rot_z
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=6)
    bpy.ops.object.mode_set(mode='OBJECT')
    
    # Major fracture at top
    cut_z = height * random.uniform(0.6, 1.1)
    cut_y = loc[1] + random.uniform(-length*0.5, length*0.5)
    add_fracture(wall, parent, (height*0.8, height*0.8, height*0.8), (loc[0], cut_y, loc[2] + cut_z), (random.uniform(0,3.14), random.uniform(0,3.14), random.uniform(0,3.14)))
    
    # Side fractures
    for _ in range(random.randint(1, 3)):
        cy = loc[1] + random.uniform(-length*0.5, length*0.5)
        cz = loc[2] + random.uniform(height*0.2, height*0.8)
        add_fracture(wall, parent, (thickness*3, height*0.4, height*0.4), (loc[0], cy, cz), (random.uniform(0,3.14), random.uniform(0,3.14), random.uniform(0,3.14)))

    # Add rebar sticking out
    if rebar_mat and random.random() > 0.3:
        for _ in range(random.randint(2, 5)):
            bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=random.uniform(0.4, 1.2), location=(loc[0]+random.uniform(-thickness, thickness), cut_y+random.uniform(-0.5, 0.5), loc[2]+cut_z-0.3))
            rebar = bpy.context.active_object
            rebar.rotation_euler = (random.uniform(0, 3.14), random.uniform(0, 3.14), random.uniform(0, 3.14))
            rebar.data.materials.append(rebar_mat)
            rebar.parent = parent
            
    # Surface displacement
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

def create_floor_slab(parent, loc, size_x, size_y, material=None, rebar_mat=None):
    bpy.ops.mesh.primitive_cube_add(size=1)
    slab = bpy.context.active_object
    slab.scale = (size_x, size_y, 0.2)
    slab.location = loc
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    
    add_fracture(slab, parent, (size_x*0.9, size_y*0.9, 1.0), (loc[0]+random.uniform(-0.5,0.5), loc[1]+random.uniform(-0.5,0.5), loc[2]), (0,0,random.uniform(0,3.14)))
    
    if material:
        slab.data.materials.append(material)
    slab.parent = parent

def create_rubble_scatter(parent, center, radius, count, material=None):
    for i in range(count):
        bpy.ops.mesh.primitive_cube_add(size=1)
        rock = bpy.context.active_object
        scale_x = random.uniform(0.05, 0.4)
        scale_y = random.uniform(0.05, 0.4)
        scale_z = random.uniform(0.02, 0.2)
        rock.scale = (scale_x, scale_y, scale_z)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        
        mod = rock.modifiers.new("Displace", 'DISPLACE')
        if "RubbleVoronoi" not in bpy.data.textures:
            tex = bpy.data.textures.new("RubbleVoronoi", 'VORONOI')
            tex.noise_scale = 0.2
        mod.texture = bpy.data.textures["RubbleVoronoi"]
        mod.strength = 0.05
        bpy.context.view_layer.objects.active = rock
        bpy.ops.object.modifier_apply(modifier="Displace")
        
        angle = random.uniform(0, 2 * math.pi)
        r = radius * math.sqrt(random.uniform(0, 1))
        rock.location = (center[0] + r*math.cos(angle), center[1] + r*math.sin(angle), scale_z/2.0)
        rock.rotation_euler = (random.uniform(0, 3.14), random.uniform(0, 3.14), random.uniform(0, 3.14))
        if material:
            rock.data.materials.append(material)
        rock.parent = parent

def create_mud_plane(parent, material=None):
    # Create an organic looking mound/plane instead of a strict hex
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=2.2, depth=0.1, location=(0,0,-0.05))
    plane = bpy.context.active_object
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=10)
    bpy.ops.object.mode_set(mode='OBJECT')
    
    mod = plane.modifiers.new("DisplaceMud", 'DISPLACE')
    if "MudNoise" not in bpy.data.textures:
        tex = bpy.data.textures.new("MudNoise", 'CLOUDS')
        tex.noise_scale = 1.0
    mod.texture = bpy.data.textures["MudNoise"]
    mod.strength = 0.2
    
    if material:
        plane.data.materials.append(material)
    plane.parent = parent

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
    hedgehog.location = loc
    hedgehog.location.z = 0.4
    hedgehog.rotation_euler.z = random.uniform(0, math.pi)
    if material:
        hedgehog.data.materials.append(material)
    hedgehog.parent = parent

# ---------------------------------------------------------
# Modular Builders (V4)
# ---------------------------------------------------------
def build_crater_debris(parent, mats):
    create_mud_plane(parent, mats['mud'])
    create_rubble_scatter(parent, (0,0,0), 2.0, random.randint(60, 100), mats['concrete'])
    if random.random() > 0.7:
        create_czech_hedgehog(parent, (random.uniform(-1,1), random.uniform(-1,1), 0), mats['metal'])

def build_fortress(parent, mats):
    create_mud_plane(parent, mats['mud'])
    create_rubble_scatter(parent, (0,0,0), 2.0, 50, mats['concrete'])
    # Low bunker walls
    create_ruined_wall(parent, (0.8, 0, 0), math.radians(90), 2.0, 1.5, 0.6, mats['brick'], mats['metal'])
    create_ruined_wall(parent, (-0.8, 0, 0), math.radians(90), 2.0, 1.5, 0.6, mats['brick'], mats['metal'])
    for _ in range(3):
        create_czech_hedgehog(parent, (random.uniform(-1,1), random.uniform(-1.5,-0.5), 0), mats['metal'])

def build_tall_facade(parent, mats):
    create_mud_plane(parent, mats['mud'])
    create_rubble_scatter(parent, (0,0,0), 2.0, 70, mats['concrete'])
    # 3-4 story high single facade wall
    height = random.uniform(6.0, 9.0)
    create_ruined_wall(parent, (0, 0.5, 0), 0, 3.5, height, 0.4, mats['brick'], mats['metal'])
    # Floor slabs hanging off the back
    create_floor_slab(parent, (0, 0, 2.5), 3.0, 1.0, mats['concrete'], mats['metal'])
    if height > 5.5:
        create_floor_slab(parent, (0, 0, 5.0), 3.0, 1.0, mats['concrete'], mats['metal'])

def build_tall_corner_ruin(parent, mats):
    create_mud_plane(parent, mats['mud'])
    create_rubble_scatter(parent, (0,0,0), 2.0, 90, mats['concrete'])
    
    height = random.uniform(5.0, 8.0)
    # L-shape walls
    create_ruined_wall(parent, (0.5, 0.5, 0), math.radians(30), 3.0, height, 0.4, mats['brick'], mats['metal'])
    create_ruined_wall(parent, (0.5, 0.5, 0), math.radians(120), 3.0, height * random.uniform(0.6, 1.0), 0.4, mats['brick'], mats['metal'])
    
    # Corner floors
    create_floor_slab(parent, (0, 0, 2.5), 2.0, 2.0, mats['concrete'], mats['metal'])
    if height > 5.5:
        create_floor_slab(parent, (0, 0, 5.0), 2.0, 2.0, mats['concrete'], mats['metal'])
    
    # Broken chimney
    create_ruined_wall(parent, (-0.2, -0.2, 0), 0, 0.6, height + random.uniform(1.0, 3.0), 0.6, mats['brick'], mats['metal'])

# ---------------------------------------------------------
# Render Setup
# ---------------------------------------------------------
def setup_camera_and_render(output_dir):
    bpy.ops.object.camera_add(location=(12, -12, 12), rotation=(math.radians(54.736), 0, math.radians(45)))
    cam = bpy.context.active_object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 8.0  # Larger to fit tall buildings
    bpy.context.scene.camera = cam
    
    bpy.ops.object.light_add(type='SUN', radius=1, align='WORLD', location=(5, 5, 10), rotation=(math.radians(45), math.radians(45), 0))
    bpy.context.active_object.data.energy = 5.0
    
    bpy.ops.object.light_add(type='AREA', radius=5, align='WORLD', location=(-5, -5, 5), rotation=(math.radians(45), math.radians(0), math.radians(135)))
    bpy.context.active_object.data.energy = 100.0

    bpy.context.scene.render.engine = 'CYCLES'
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
    mats = {
        'brick': create_image_pbr_material("RealBrick", base_dir + "Bricks076A/Bricks076A_1K-JPG", uv_scale=1.5),
        'concrete': create_image_pbr_material("RealConcrete", base_dir + "Concrete031/Concrete031_1K-JPG", uv_scale=2.0),
        'metal': create_image_pbr_material("RealMetal", base_dir + "Metal040/Metal040_1K-JPG", uv_scale=1.0),
        'mud': create_image_pbr_material("RealMud", base_dir + "Ground037/Ground037_1K-JPG", uv_scale=1.5)
    }
    
    out_dir = "C:/Projects/squad_tactics/asset/environment/hex_tiles_v4"
    os.makedirs(out_dir, exist_ok=True)
    setup_camera_and_render(out_dir)
    
    builders = [
        ("crater", build_crater_debris),
        ("fortress", build_fortress),
        ("ruin_facade", build_tall_facade),
        ("ruin_corner", build_tall_corner_ruin)
    ]
    
    variations_per_type = 8
    
    for b_name, b_func in builders:
        for v in range(variations_per_type):
            bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0,0,0))
            parent = bpy.context.active_object
            
            b_func(parent, mats)
            
            # Since these are complete organic buildings, we will randomly spin the whole object
            # to give variety in the map view, but keeping the isometric perspective.
            # We spin it in increments of 60 degrees to align with hex grid.
            parent.rotation_euler.z = math.radians(random.choice([0, 60, 120, 180, 240, 300]))
            
            out_path = os.path.join(out_dir, f"{b_name}_v{v}.png")
            bpy.context.scene.render.filepath = out_path
            bpy.ops.render.render(write_still=True)
            print(f"Rendered: {out_path}")
            
            bpy.ops.object.select_all(action='DESELECT')
            parent.select_set(True)
            for child in parent.children:
                child.select_set(True)
            bpy.ops.object.delete()

    print("Manufacture V4 complete!")

main()
