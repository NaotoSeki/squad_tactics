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
        
    # Boost brightness for brick
    if "Brick" in name:
        bsdf.inputs['Base Color'].default_value = (0.8, 0.4, 0.3, 1.0)
        
    return mat

def create_hex_base(parent, loc, radius, height, material=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=radius, depth=height, location=loc)
    hex_base = bpy.context.active_object
    hex_base.name = "HexBase"
    
    # 30 degree rotation for Pointy-Topped when viewed from standard Z=45 camera
    hex_base.rotation_euler[2] = math.radians(30)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    
    # Displace the top surface slightly to look like uneven mud
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=10)
    bpy.ops.object.mode_set(mode='OBJECT')
    
    mod = hex_base.modifiers.new("DisplaceMud", 'DISPLACE')
    if "MudNoise" not in bpy.data.textures:
        tex = bpy.data.textures.new("MudNoise", 'CLOUDS')
        tex.noise_scale = 0.5
    mod.texture = bpy.data.textures["MudNoise"]
    mod.strength = 0.1
    mod.direction = 'Z'
    bpy.context.view_layer.objects.active = hex_base
    bpy.ops.object.modifier_apply(modifier="DisplaceMud")
    
    if material:
        hex_base.data.materials.append(material)
        
    hex_base.parent = parent
    return hex_base

def create_ruined_wall_complex(parent, loc, rot_z, length, height, thickness, has_window=False, material=None, rebar_mat=None):
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
    
    # Optional window cutout
    if has_window:
        bpy.ops.mesh.primitive_cube_add(size=1)
        win_cutter = bpy.context.active_object
        win_cutter.scale = (thickness*2, length*0.3, height*0.4)
        win_cutter.location = (loc[0], loc[1], loc[2] + height*0.5)
        win_cutter.rotation_euler[2] = rot_z
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        
        bool_win = wall.modifiers.new("BooleanWin", 'BOOLEAN')
        bool_win.object = win_cutter
        bool_win.operation = 'DIFFERENCE'
        bpy.context.view_layer.objects.active = wall
        bpy.ops.object.modifier_apply(modifier="BooleanWin")
        
        bpy.ops.object.select_all(action='DESELECT')
        win_cutter.select_set(True)
        bpy.ops.object.delete()

    # Fracture edges
    num_cuts = random.randint(3, 5)
    for i in range(num_cuts):
        bpy.ops.mesh.primitive_cube_add(size=1)
        cutter = bpy.context.active_object
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.subdivide(number_cuts=5)
        bpy.ops.object.mode_set(mode='OBJECT')
        
        mod = cutter.modifiers.new("Displace", 'DISPLACE')
        if "VoronoiRuin" not in bpy.data.textures:
            tex = bpy.data.textures.new("VoronoiRuin", 'VORONOI')
            tex.noise_scale = 1.0
        mod.texture = bpy.data.textures["VoronoiRuin"]
        mod.strength = 1.0
        
        cutter.scale = (height*0.6, height*0.6, height*0.6)
        cut_z = height * random.uniform(0.7, 1.2)
        cut_y = loc[1] + random.uniform(-length*0.5, length*0.5)
        cutter.location = (loc[0], cut_y, loc[2] + cut_z)
        cutter.rotation_euler = (random.uniform(0, 3.14), random.uniform(0, 3.14), random.uniform(0, 3.14))
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        
        bool_mod = wall.modifiers.new("Boolean", 'BOOLEAN')
        bool_mod.object = cutter
        bool_mod.operation = 'DIFFERENCE'
        bpy.context.view_layer.objects.active = wall
        bpy.ops.object.modifier_apply(modifier="Boolean")
        
        bpy.ops.object.select_all(action='DESELECT')
        cutter.select_set(True)
        bpy.ops.object.delete()
        
        # Add rebar at the cut location
        if rebar_mat and random.random() > 0.3:
            for _ in range(random.randint(1, 3)):
                bpy.ops.mesh.primitive_cylinder_add(radius=0.02, depth=random.uniform(0.3, 0.8), location=(loc[0], cut_y + random.uniform(-0.3, 0.3), loc[2] + cut_z - 0.2))
                rebar = bpy.context.active_object
                rebar.rotation_euler = (random.uniform(0, 3.14), random.uniform(0, 3.14), random.uniform(0, 3.14))
                rebar.data.materials.append(rebar_mat)
                rebar.parent = parent
        
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
        scale_x = random.uniform(0.05, 0.3)
        scale_y = random.uniform(0.05, 0.3)
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
        rock.location = (
            center[0] + r * math.cos(angle),
            center[1] + r * math.sin(angle),
            scale_z / 2.0
        )
        rock.rotation_euler = (random.uniform(0, 3.14), random.uniform(0, 3.14), random.uniform(0, 3.14))
        if material:
            rock.data.materials.append(material)
        rock.parent = parent

def create_floor_slab(parent, loc, size_x, size_y, material=None, rebar_mat=None):
    bpy.ops.mesh.primitive_cube_add(size=1)
    slab = bpy.context.active_object
    slab.scale = (size_x, size_y, 0.15)
    slab.location = loc
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    
    # Fracture slab
    bpy.ops.mesh.primitive_cube_add(size=1)
    cutter = bpy.context.active_object
    mod = cutter.modifiers.new("Displace", 'DISPLACE')
    if "VoronoiRuin" not in bpy.data.textures:
        tex = bpy.data.textures.new("VoronoiRuin", 'VORONOI')
        tex.noise_scale = 1.0
    mod.texture = bpy.data.textures["VoronoiRuin"]
    mod.strength = 1.0
    cutter.scale = (size_x*0.8, size_y*0.8, 1.0)
    cutter.location = (loc[0] + random.uniform(-size_x*0.4, size_x*0.4), loc[1] + random.uniform(-size_y*0.4, size_y*0.4), loc[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    
    bool_mod = slab.modifiers.new("Boolean", 'BOOLEAN')
    bool_mod.object = cutter
    bool_mod.operation = 'DIFFERENCE'
    bpy.context.view_layer.objects.active = slab
    bpy.ops.object.modifier_apply(modifier="Boolean")
    
    bpy.ops.object.select_all(action='DESELECT')
    cutter.select_set(True)
    bpy.ops.object.delete()
    
    if material:
        slab.data.materials.append(material)
    slab.parent = parent

# ---------------------------------------------------------
# Modular Builders
# ---------------------------------------------------------
def build_ground_rubble(parent, mats):
    # CREATE HEX BASE
    create_hex_base(parent, loc=(0,0,-0.1), radius=2.2, height=0.2, material=mats['mud'])
    create_rubble(parent, center=(0, 0, 0), radius=1.8, count=random.randint(40, 80), material=mats['concrete'])

def build_wall_base(parent, mats):
    create_ruined_wall_complex(parent, loc=(0.5, 0.5, 0), rot_z=math.radians(30), length=2.5, height=random.uniform(2.5, 3.5), thickness=0.4, material=mats['brick'], rebar_mat=mats['metal'])
    create_rubble(parent, center=(0.5, 0.5, 0), radius=1.0, count=random.randint(20, 40), material=mats['concrete'])

def build_wall_upper(parent, mats):
    create_floor_slab(parent, loc=(0,0,0), size_x=2.0, size_y=2.0, material=mats['concrete'], rebar_mat=mats['metal'])
    create_ruined_wall_complex(parent, loc=(0.5, 0.5, 0), rot_z=math.radians(30), length=2.5, height=random.uniform(2.0, 3.0), thickness=0.3, has_window=True, material=mats['brick'], rebar_mat=mats['metal'])

def build_chimney(parent, mats):
    create_ruined_wall_complex(parent, loc=(-0.5, -0.5, 0), rot_z=0, length=0.6, height=random.uniform(4.0, 5.0), thickness=0.6, material=mats['brick'], rebar_mat=mats['metal'])

# ---------------------------------------------------------
# Render Setup
# ---------------------------------------------------------
def setup_camera_and_render(output_dir):
    bpy.ops.object.camera_add(location=(10, -10, 10), rotation=(math.radians(54.736), 0, math.radians(45)))
    cam = bpy.context.active_object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 6.0
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
    
    out_dir = "C:/Projects/squad_tactics/asset/environment/hex_tiles_v3"
    os.makedirs(out_dir, exist_ok=True)
    setup_camera_and_render(out_dir)
    
    builders = [
        ("base_ground", build_ground_rubble),
        ("wall_level1", build_wall_base),
        ("wall_level2", build_wall_upper),
        ("chimney", build_chimney)
    ]
    
    variations_per_type = 4
    
    for b_name, b_func in builders:
        for v in range(variations_per_type):
            bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0,0,0))
            parent = bpy.context.active_object
            
            b_func(parent, mats)
            
            # アイソメ1方向固定
            out_path = os.path.join(out_dir, f"{b_name}_v{v}.png")
            bpy.context.scene.render.filepath = out_path
            bpy.ops.render.render(write_still=True)
            print(f"Rendered: {out_path}")
            
            bpy.ops.object.select_all(action='DESELECT')
            parent.select_set(True)
            for child in parent.children:
                child.select_set(True)
            bpy.ops.object.delete()

    print("Manufacture V3 complete!")

main()
