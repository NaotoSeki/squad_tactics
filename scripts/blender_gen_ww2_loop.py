import bpy
import bmesh
import math
import random
import os

def clear_scene():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if obj.type in ['MESH', 'EMPTY', 'CURVE', 'LIGHT']:
            obj.select_set(True)
    bpy.ops.object.delete()

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
    
    if not color_img and not rough_img:
        print(f"Textures not found for {path_prefix}")
        return mat
        
    tex_coord = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (uv_scale, uv_scale, uv_scale)
    links.new(tex_coord.outputs['UV'], mapping.inputs['Vector'])
    
    if color_img:
        tex_color = nodes.new('ShaderNodeTexImage')
        tex_color.image = color_img
        links.new(mapping.outputs['Vector'], tex_color.inputs['Vector'])
        links.new(tex_color.outputs['Color'], bsdf.inputs['Base Color'])
        
    if rough_img:
        tex_rough = nodes.new('ShaderNodeTexImage')
        tex_rough.image = rough_img
        tex_rough.image.colorspace_settings.name = 'Non-Color'
        links.new(mapping.outputs['Vector'], tex_rough.inputs['Vector'])
        links.new(tex_rough.outputs['Color'], bsdf.inputs['Roughness'])
        
    if normal_img:
        tex_normal = nodes.new('ShaderNodeTexImage')
        tex_normal.image = normal_img
        tex_normal.image.colorspace_settings.name = 'Non-Color'
        links.new(mapping.outputs['Vector'], tex_normal.inputs['Vector'])
        
        normal_map = nodes.new('ShaderNodeNormalMap')
        links.new(tex_normal.outputs['Color'], normal_map.inputs['Color'])
        links.new(normal_map.outputs['Normal'], bsdf.inputs['Normal'])
        
    return mat

def create_i_beam(length=1.5, width=0.1, thickness=0.02):
    bpy.ops.mesh.primitive_cube_add(size=1)
    web = bpy.context.active_object
    web.scale = (thickness, width, length)
    
    bpy.ops.mesh.primitive_cube_add(size=1)
    f1 = bpy.context.active_object
    f1.scale = (width, thickness, length)
    f1.location = (0, width/2.0, 0)
    
    bpy.ops.mesh.primitive_cube_add(size=1)
    f2 = bpy.context.active_object
    f2.scale = (width, thickness, length)
    f2.location = (0, -width/2.0, 0)
    
    bpy.ops.object.select_all(action='DESELECT')
    web.select_set(True)
    f1.select_set(True)
    f2.select_set(True)
    bpy.context.view_layer.objects.active = web
    bpy.ops.object.join()
    return web

def create_czech_hedgehog(loc, material=None):
    beam1 = create_i_beam()
    beam1.rotation_euler = (math.radians(45), math.radians(45), 0)
    
    beam2 = create_i_beam()
    beam2.rotation_euler = (math.radians(-45), math.radians(45), 0)
    
    beam3 = create_i_beam()
    beam3.rotation_euler = (0, math.radians(90), math.radians(45))
    
    bpy.ops.object.select_all(action='DESELECT')
    beam1.select_set(True)
    beam2.select_set(True)
    beam3.select_set(True)
    bpy.context.view_layer.objects.active = beam1
    bpy.ops.object.join()
    
    hedgehog = bpy.context.active_object
    hedgehog.name = "CzechHedgehog_Realistic"
    hedgehog.location = loc
    hedgehog.location.z = 0.5
    hedgehog.rotation_euler.z = random.uniform(0, math.pi)
    
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project()
    bpy.ops.object.mode_set(mode='OBJECT')
    
    if material:
        hedgehog.data.materials.append(material)
    return hedgehog

def create_ruined_wall(loc, rot_z, length, height, thickness, material=None):
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
    
    num_cuts = random.randint(3, 5)
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
        cut_z = height * random.uniform(0.4, 1.2)
        cut_y = loc[1] + random.uniform(-length*0.5, length*0.5)
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
        
    bpy.context.view_layer.objects.active = wall
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15)
    bpy.ops.object.mode_set(mode='OBJECT')
    
    if material:
        wall.data.materials.append(material)
        
    return wall

def create_rubble(center, radius, count, material=None):
    for i in range(count):
        bpy.ops.mesh.primitive_cube_add(size=1)
        rock = bpy.context.active_object
        
        scale_x = random.uniform(0.05, 0.3)
        scale_y = random.uniform(0.05, 0.3)
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
        mod.strength = 0.05
        
        bpy.context.view_layer.objects.active = rock
        bpy.ops.object.modifier_apply(modifier="Displace")
        
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project()
        bpy.ops.object.mode_set(mode='OBJECT')
        
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

def setup_lighting():
    bpy.ops.object.light_add(type='SUN', radius=1, align='WORLD', location=(0, -10, 15), rotation=(math.radians(60), 0, math.radians(45)))
    sun = bpy.context.active_object
    sun.data.energy = 6.0
    
    bpy.ops.object.light_add(type='AREA', radius=10, align='WORLD', location=(0, 10, 10), rotation=(math.radians(45), 0, math.radians(225)))
    fill = bpy.context.active_object
    fill.data.energy = 200.0

def main():
    clear_scene()
    setup_lighting()
    
    base_dir = "C:/Projects/squad_tactics/asset/environment/pbr/"
    
    mat_brick = create_image_pbr_material("RealBrick", base_dir + "Bricks076A/Bricks076A_1K-JPG", uv_scale=1.5)
    mat_concrete = create_image_pbr_material("RealConcrete", base_dir + "Concrete031/Concrete031_1K-JPG", uv_scale=2.0)
    mat_metal = create_image_pbr_material("RealMetal", base_dir + "Metal040/Metal040_1K-JPG", uv_scale=1.0)
    
    patterns = 5
    spacing = 5.0
    
    for i in range(patterns):
        loc_x = i * spacing - (patterns * spacing / 2.0)
        
        pattern_type = random.choice(['RUIN_CORNER', 'DEFENSE_LINE', 'CRATER', 'ROAD'])
        
        if pattern_type == 'RUIN_CORNER':
            wall1 = create_ruined_wall(loc=(loc_x+0.5, 0.5, 0), rot_z=math.radians(30), length=2.5, height=random.uniform(2.5, 3.5), thickness=0.4, material=mat_brick)
            wall2 = create_ruined_wall(loc=(loc_x+0.5, 0.5, 0), rot_z=math.radians(120), length=2.5, height=random.uniform(2.5, 3.5), thickness=0.4, material=mat_brick)
            create_rubble(center=(loc_x+0.5, 0.5, 0), radius=1.8, count=50, material=mat_concrete)
            create_czech_hedgehog(loc=(loc_x-1.0, -0.5, 0), material=mat_metal)
            
        elif pattern_type == 'DEFENSE_LINE':
            wall1 = create_ruined_wall(loc=(loc_x, 0, 0), rot_z=math.radians(0), length=4.0, height=1.5, thickness=0.5, material=mat_brick)
            create_rubble(center=(loc_x, 0, 0), radius=1.0, count=30, material=mat_concrete)
            create_czech_hedgehog(loc=(loc_x-0.8, -1.0, 0), material=mat_metal)
            create_czech_hedgehog(loc=(loc_x+0.8, -1.0, 0), material=mat_metal)
            
        elif pattern_type == 'CRATER':
            create_rubble(center=(loc_x, 0, 0), radius=1.5, count=80, material=mat_concrete)
            create_czech_hedgehog(loc=(loc_x, 0, 0), material=mat_metal)
            
        elif pattern_type == 'ROAD':
            create_rubble(center=(loc_x-1.0, 0, 0), radius=0.8, count=20, material=mat_concrete)
            create_rubble(center=(loc_x+1.0, 0, 0), radius=0.8, count=20, material=mat_concrete)

    print("WW2 Hex Modules (Loop with Real Textures) generated successfully!")

main()
