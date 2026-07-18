# -*- coding: utf-8 -*-
"""Dense Blender rebuild for the 30-hex Candidate B review."""

from __future__ import annotations
import argparse
import json
import math
from pathlib import Path
import random
import sys

import bpy
import bmesh
from mathutils import Vector, noise

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "scratch/kb3d_study/ps_reference"
DEFAULT_RENDER = ROOT / "scratch/kb3d_review/round2_review_candidate_b_blender.png"
DEFAULT_BLEND = ROOT / "scratch/kb3d_review/round2_review_candidate_b_blender.blend"
SCENE = "REVIEW_ROUND1_RENDER"
GROUND_Z = 0.08
SEED = 41027
VARIANT = "v29"
SWAP_BUILDINGS = False
BOARD_R = 7.2
BOARD_CENTERS = tuple(
    (6.8 + math.sqrt(3)*BOARD_R*(q + (0.5 if r%2 else 0.0)),
     8.0 + 1.5*BOARD_R*r)
    for q in range(5) for r in range(6)
)

# 180deg self-mapping of the 5x6 offset-hex board (BOARD_R=7.2).
ROT_A = 13.6 + math.sqrt(3) * BOARD_R * 4.5   # ~= 69.7185
ROT_B = 70.0                                   # y_r = 8 + 10.8r, r=0..5


def T(point):
    """Layout coordinate transform selected by --variant.

    v29 (default) is the identity: the original tuple is returned
    unchanged (no arithmetic at all), so the default render stays
    bit-identical to the pre-variant output. rot180 rotates a point
    180deg about the board center; only the x/y pair is touched.
    """
    if VARIANT != "rot180":
        return point
    return (ROT_A - point[0], ROT_B - point[1])


def T3(point):
    """Like T() but preserves a trailing z (or any 3rd component)."""
    x, y = T((point[0], point[1]))
    return (x, y, point[2])


def T_angle(angle):
    """Building/bearing angle transform paired with T(); v29 is the identity."""
    return angle if VARIANT != "rot180" else angle + 180


def T_bounds(x0, y0, x1, y1):
    """Transform an axis-aligned rect's two corners, then re-derive min/max.

    Used for hardcoded exclusion boxes that must stay axis-aligned under a
    180deg board rotation. v29 returns the bounds unchanged.
    """
    p0, p1 = T((x0, y0)), T((x1, y1))
    return (min(p0[0], p1[0]), max(p0[0], p1[0]),
            min(p0[1], p1[1]), max(p0[1], p1[1]))


def inside_board(point,margin=0.0):
    radius=max(.1,BOARD_R-margin)
    for cx,cy in BOARD_CENTERS:
        dx,dy=abs(point[0]-cx),abs(point[1]-cy)
        if dx<=math.sqrt(3)*radius/2 and dy<=radius and dx/math.sqrt(3)+dy<=radius:
            return True
    return False


def lin(value):
    value = float(value) / 255.0 if value > 1.0 else float(value)
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def rgba(color):
    return (lin(color[0]), lin(color[1]), lin(color[2]), 1.0)


def ao_multiply(nodes,links,color_socket,distance=1.8,strength=.22):
    """Subtle material AO for contact depth without reintroducing hard sun shadows."""
    try:
        ao=nodes.new("ShaderNodeAmbientOcclusion")
    except RuntimeError:
        return color_socket
    if "Distance" in ao.inputs:
        ao.inputs["Distance"].default_value=distance
    if "Samples" in ao.inputs:
        ao.inputs["Samples"].default_value=8
    mix=nodes.new("ShaderNodeMixRGB")
    mix.blend_type="MULTIPLY"
    mix.inputs[0].default_value=strength
    links.new(color_socket,mix.inputs[1])
    links.new(ao.outputs["Color"],mix.inputs[2])
    return mix.outputs["Color"]



def clear_collection(scene, name):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if scene.collection.children.get(name) is None:
        scene.collection.children.link(col)
    for obj in list(col.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for child in list(col.children):
        col.children.unlink(child)
        if child.users == 0:
            bpy.data.collections.remove(child)
    return col


def base_material(name, dark, light=None, scale=1.0, bump=0.2, rough=0.95):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = rough
    links.new(shader.outputs["BSDF"], out.inputs["Surface"])
    if light is None:
        shader.inputs["Base Color"].default_value = rgba(dark)
    else:
        coord = nodes.new("ShaderNodeTexCoord")
        noise = nodes.new("ShaderNodeTexNoise")
        noise.noise_dimensions = "3D"
        noise.inputs["Scale"].default_value = scale
        noise.inputs["Detail"].default_value = 5.5
        noise.inputs["Roughness"].default_value = 0.72
        noise.inputs["Distortion"].default_value = 0.16
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.22
        ramp.color_ramp.elements[0].color = rgba(dark)
        ramp.color_ramp.elements[1].position = 0.78
        ramp.color_ramp.elements[1].color = rgba(light)
        links.new(coord.outputs["Object"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        shaded=ao_multiply(nodes,links,ramp.outputs["Color"],1.8,.22)
        links.new(shaded, shader.inputs["Base Color"])
        if bump:
            bump_node = nodes.new("ShaderNodeBump")
            bump_node.inputs["Strength"].default_value = bump
            bump_node.inputs["Distance"].default_value = 0.16
            links.new(noise.outputs["Fac"], bump_node.inputs["Height"])
            links.new(bump_node.outputs["Normal"], shader.inputs["Normal"])
    mat.diffuse_color = rgba(light or dark)
    return mat

def ruin_weathered_material(name="RWB_RuinWallWeathered"):
    """Deterministic shader-only age, soot, dampness, and rain streaks."""
    mat=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes=True
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    nodes.clear()
    out=nodes.new("ShaderNodeOutputMaterial")
    shader=nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value=.95
    weather_rng=random.Random(SEED+5410)
    weather_phase=tuple(weather_rng.uniform(-3.0,3.0) for _ in range(3))
    links.new(shader.outputs["BSDF"],out.inputs["Surface"])

    coord=nodes.new("ShaderNodeTexCoord")
    base_noise=nodes.new("ShaderNodeTexNoise")
    base_noise.noise_dimensions="3D"
    base_noise.inputs["Scale"].default_value=1.35
    base_noise.inputs["Detail"].default_value=5.5
    base_noise.inputs["Roughness"].default_value=.72
    base_noise.inputs["Distortion"].default_value=.16
    base_ramp=nodes.new("ShaderNodeValToRGB")
    base_ramp.color_ramp.elements[0].position=.20
    base_ramp.color_ramp.elements[0].color=rgba((58,50,38))
    base_ramp.color_ramp.elements[1].position=.80
    base_ramp.color_ramp.elements[1].color=rgba((143,119,84))
    links.new(coord.outputs["Object"],base_noise.inputs["Vector"])
    links.new(base_noise.outputs["Fac"],base_ramp.inputs["Fac"])
    base_shaded=ao_multiply(nodes,links,base_ramp.outputs["Color"],1.8,.22)

    rain_mapping=nodes.new("ShaderNodeMapping")
    rain_mapping.inputs["Scale"].default_value=(2.8,2.8,.16)
    rain_mapping.inputs["Location"].default_value=weather_phase
    rain_noise=nodes.new("ShaderNodeTexNoise")
    rain_noise.noise_dimensions="3D"
    rain_noise.inputs["Scale"].default_value=3.0
    rain_noise.inputs["Detail"].default_value=3.2
    rain_noise.inputs["Roughness"].default_value=.68
    rain_noise.inputs["Distortion"].default_value=.12
    rain_ramp=nodes.new("ShaderNodeValToRGB")
    rain_ramp.color_ramp.elements[0].position=.30
    rain_ramp.color_ramp.elements[0].color=rgba((78,66,48))
    rain_ramp.color_ramp.elements[1].position=.70
    rain_ramp.color_ramp.elements[1].color=rgba((245,240,225))
    rain_mix=nodes.new("ShaderNodeMixRGB")
    rain_mix.blend_type="MULTIPLY"
    rain_mix.inputs[0].default_value=.13
    links.new(coord.outputs["Object"],rain_mapping.inputs["Vector"])
    links.new(rain_mapping.outputs["Vector"],rain_noise.inputs["Vector"])
    links.new(rain_noise.outputs["Fac"],rain_ramp.inputs["Fac"])
    links.new(base_shaded,rain_mix.inputs[1])
    links.new(rain_ramp.outputs["Color"],rain_mix.inputs[2])

    separate=nodes.new("ShaderNodeSeparateXYZ")
    damp_gradient=nodes.new("ShaderNodeMapRange")
    damp_gradient.inputs["From Min"].default_value=GROUND_Z
    damp_gradient.inputs["From Max"].default_value=GROUND_Z+1.70
    damp_gradient.inputs["To Min"].default_value=.22
    damp_gradient.inputs["To Max"].default_value=0.0
    damp_gradient.clamp=True
    damp_noise=nodes.new("ShaderNodeTexNoise")
    damp_noise.noise_dimensions="3D"
    damp_noise.inputs["Scale"].default_value=3.0
    damp_noise.inputs["Detail"].default_value=2.4
    damp_noise.inputs["Roughness"].default_value=.62
    damp_mask=nodes.new("ShaderNodeMath")
    damp_mask.operation="MULTIPLY"
    damp_mix=nodes.new("ShaderNodeMixRGB")
    damp_mix.blend_type="MULTIPLY"
    damp_mix.inputs[2].default_value=rgba((112,96,72))
    links.new(coord.outputs["Object"],separate.inputs[0])
    links.new(separate.outputs["Z"],damp_gradient.inputs["Value"])
    links.new(coord.outputs["Object"],damp_noise.inputs["Vector"])
    links.new(damp_gradient.outputs["Result"],damp_mask.inputs[0])
    links.new(damp_noise.outputs["Fac"],damp_mask.inputs[1])
    links.new(damp_mask.outputs[0],damp_mix.inputs[0])
    links.new(rain_mix.outputs["Color"],damp_mix.inputs[1])

    soot_offset=nodes.new("ShaderNodeVectorMath")
    soot_offset.operation="SUBTRACT"
    soot_offset.inputs[1].default_value=(16.99,38.81,2.40)
    soot_flatten=nodes.new("ShaderNodeVectorMath")
    soot_flatten.operation="MULTIPLY"
    soot_flatten.inputs[1].default_value=(1.0,1.0,.45)
    soot_distance=nodes.new("ShaderNodeVectorMath")
    soot_distance.operation="LENGTH"
    soot_radius=nodes.new("ShaderNodeMapRange")
    soot_radius.inputs["From Min"].default_value=.18
    soot_radius.inputs["From Max"].default_value=2.25
    soot_radius.inputs["To Min"].default_value=.20
    soot_radius.inputs["To Max"].default_value=0.0
    soot_radius.clamp=True
    soot_mapping=nodes.new("ShaderNodeMapping")
    soot_mapping.inputs["Scale"].default_value=(.85,.85,.30)
    soot_mapping.inputs["Location"].default_value=tuple(-v*.37 for v in weather_phase)
    soot_noise=nodes.new("ShaderNodeTexNoise")
    soot_noise.noise_dimensions="3D"
    soot_noise.inputs["Scale"].default_value=1.8
    soot_noise.inputs["Detail"].default_value=2.0
    soot_noise.inputs["Roughness"].default_value=.58
    soot_noise.inputs["Distortion"].default_value=.34
    soot_irregular=nodes.new("ShaderNodeMapRange")
    soot_irregular.inputs["From Min"].default_value=0.0
    soot_irregular.inputs["From Max"].default_value=1.0
    soot_irregular.inputs["To Min"].default_value=.55
    soot_irregular.inputs["To Max"].default_value=1.0
    soot_amount=nodes.new("ShaderNodeMath")
    soot_amount.operation="MULTIPLY"
    soot_mix=nodes.new("ShaderNodeMixRGB")
    soot_mix.blend_type="MULTIPLY"
    soot_mix.inputs[2].default_value=rgba((70,61,52))
    links.new(coord.outputs["Object"],soot_offset.inputs[0])
    links.new(soot_offset.outputs[0],soot_flatten.inputs[0])
    links.new(soot_flatten.outputs[0],soot_distance.inputs[0])
    links.new(soot_distance.outputs["Value"],soot_radius.inputs["Value"])
    links.new(coord.outputs["Object"],soot_mapping.inputs["Vector"])
    links.new(soot_mapping.outputs["Vector"],soot_noise.inputs["Vector"])
    links.new(soot_noise.outputs["Fac"],soot_irregular.inputs["Value"])
    links.new(soot_radius.outputs["Result"],soot_amount.inputs[0])
    links.new(soot_irregular.outputs["Result"],soot_amount.inputs[1])
    links.new(soot_amount.outputs[0],soot_mix.inputs[0])
    links.new(damp_mix.outputs["Color"],soot_mix.inputs[1])
    links.new(soot_mix.outputs["Color"],shader.inputs["Base Color"])
    bump=nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value=.34
    bump.inputs["Distance"].default_value=.16
    links.new(base_noise.outputs["Fac"],bump.inputs["Height"])
    links.new(bump.outputs["Normal"],shader.inputs["Normal"])
    mat.diffuse_color=rgba((105,90,66))
    return mat



def photo_ground_material(name,path,tile_m=8.0,bump=.24,rough=.97,
                          tint=(.42,.62,.45),tint_fac=.28,
                          saturation=.82,value=1.15):
    mat=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes=True
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    nodes.clear()
    out=nodes.new("ShaderNodeOutputMaterial")
    shader=nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value=rough
    coord=nodes.new("ShaderNodeTexCoord")
    mapping=nodes.new("ShaderNodeMapping")
    texture_scale=1/max(.1,tile_m)
    mapping.inputs["Scale"].default_value=(texture_scale,texture_scale,texture_scale)
    image_node=nodes.new("ShaderNodeTexImage")
    image_node.image=bpy.data.images.load(str(path.resolve()),check_existing=True)
    image_node.extension="REPEAT"
    image_node.interpolation="Linear"
    grade=nodes.new("ShaderNodeHueSaturation")
    grade.inputs["Saturation"].default_value=saturation
    grade.inputs["Value"].default_value=value
    olive=nodes.new("ShaderNodeMixRGB")
    olive.blend_type="MULTIPLY"
    olive.inputs[0].default_value=tint_fac
    olive.inputs[2].default_value=(*tint,1)
    gray=nodes.new("ShaderNodeRGBToBW")
    bump_node=nodes.new("ShaderNodeBump")
    bump_node.inputs["Strength"].default_value=bump
    bump_node.inputs["Distance"].default_value=.10
    links.new(coord.outputs["Object"],mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"],image_node.inputs["Vector"])
    links.new(image_node.outputs["Color"],grade.inputs["Color"])
    links.new(grade.outputs["Color"],olive.inputs[1])
    shaded=ao_multiply(nodes,links,olive.outputs["Color"],2.3,.26)
    links.new(shaded,shader.inputs["Base Color"])
    links.new(image_node.outputs["Color"],gray.inputs["Color"])
    links.new(gray.outputs["Val"],bump_node.inputs["Height"])
    links.new(bump_node.outputs["Normal"],shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"],out.inputs["Surface"])
    mat.diffuse_color=(.19,.22,.10,1)
    return mat
def soft_contact_material(name="RWB_SoftContact", strength=.18):
    """Camera-safe feathered contact tone; avoids Eevee's black sun shadows."""
    mat=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes=True
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    nodes.clear()
    out=nodes.new("ShaderNodeOutputMaterial")
    mix=nodes.new("ShaderNodeMixShader")
    transparent=nodes.new("ShaderNodeBsdfTransparent")
    shader=nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value=rgba((35,29,22))
    shader.inputs["Roughness"].default_value=1.0
    coord=nodes.new("ShaderNodeTexCoord")
    subtract=nodes.new("ShaderNodeVectorMath")
    subtract.operation="SUBTRACT"
    subtract.inputs[1].default_value=(.5,.5,0)
    length=nodes.new("ShaderNodeVectorMath")
    length.operation="LENGTH"
    fade=nodes.new("ShaderNodeMapRange")
    fade.inputs["From Min"].default_value=.10
    fade.inputs["From Max"].default_value=.70
    fade.inputs["To Min"].default_value=strength
    fade.inputs["To Max"].default_value=0.0
    fade.clamp=True
    links.new(coord.outputs["Generated"],subtract.inputs[0])
    links.new(subtract.outputs[0],length.inputs[0])
    links.new(length.outputs["Value"],fade.inputs["Value"])
    links.new(transparent.outputs[0],mix.inputs[1])
    links.new(shader.outputs[0],mix.inputs[2])
    links.new(fade.outputs["Result"],mix.inputs[0])
    links.new(mix.outputs[0],out.inputs[0])
    try:
        mat.surface_render_method="DITHERED"
    except Exception:
        pass
    mat.use_backface_culling=False
    return mat





def materials(ground):
    mats = {
        "grass": photo_ground_material("RWB_Grass",ROOT/"asset/environment/terrain_forest.jpg",8.0,.22,.97,(.42,.62,.45),.28,.82,1.08),
        "worn": photo_ground_material("RWB_Worn",ROOT/"asset/environment/terrain_dirt.jpg",4.5,.18,.96,(.78,.58,.36),.34,.75,1.15),
        "field": photo_ground_material("RWB_Field",ROOT/"asset/environment/terrain_dirt.jpg",4.0,.26,.97,(.72,.45,.25),.45,.70,1.05),
        "edge": base_material("RWB_Edge", (22, 21, 17), (51, 43, 30), 0.9, 0.22),
        "mottle": base_material("RWB_Mottle", (43, 45, 29), (72, 69, 41), .55, .09),
        "meadow_dark": base_material("RWB_MeadowDark", (35, 39, 26), (57, 61, 36), 2.4, .10),
        "meadow_gold": base_material("RWB_MeadowGold", (48, 45, 29), (75, 68, 40), 2.8, .08),
        "contact": soft_contact_material(),
        "shoulder": photo_ground_material("RWB_Shoulder",ROOT/"asset/environment/terrain_dirt.jpg",4.0,.16,.96,(.62,.50,.36),.36,.72,.98),
        "road": photo_ground_material("RWB_Road",ROOT/"asset/environment/terrain_dirt.jpg",3.0,.20,.95,(.56,.42,.29),.43,.72,.92),
        "mud": photo_ground_material("RWB_Mud",ROOT/"asset/environment/terrain_dirt.jpg",2.4,.24,.97,(.54,.38,.24),.40,.68,.90),
        "rut_mud": photo_ground_material("RWB_RutMud",ROOT/"asset/environment/terrain_dirt.jpg",1.8,.28,.98,(.43,.31,.20),.52,.70,.80),
        "road_dry": photo_ground_material("RWB_RoadDry",ROOT/"asset/environment/terrain_dirt.jpg",2.1,.16,.97,(.72,.57,.36),.42,.66,1.02),
        "rut": base_material("RWB_Rut", (46, 39, 29), (76, 61, 42), 2.6, 0.10),
        "row": base_material("RWB_Row", (42, 29, 18), (79, 50, 29), 2.1, 0.27),
        "crop0": base_material("RWB_Crop0", (32, 46, 21), (65, 75, 31), 2.8, 0.07, 0.86),
        "crop1": base_material("RWB_Crop1", (42, 52, 23), (78, 82, 34), 3.1, 0.05, 0.86),
        "crop2": base_material("RWB_Crop2", (37, 50, 24), (88, 90, 38), 3.4, 0.05, 0.88),
        "wood": base_material("RWB_Wood", (38, 27, 18), (88, 59, 33), 2.2, 0.16),
        "ruin_wall": base_material("RWB_RuinWall", (60, 52, 40), (139, 118, 84), 1.35, 0.34),
        "ruin_wall_weathered": ruin_weathered_material(),
        "roof_tile": base_material("RWB_RoofTile", (65, 31, 21), (133, 73, 42), 2.6, 0.22),
        "blade0": base_material("RWB_Blade0", (48, 58, 27), (83, 90, 38), 3.2, 0.05),
        "blade1": base_material("RWB_Blade1", (70, 75, 34), (106, 98, 45), 3.0, 0.04),
        "flower": base_material("RWB_Flower", (154, 137, 88), rough=0.8),
        "crater": base_material("RWB_Crater", (32, 26, 21), (70, 50, 32), 2.35, 0.28),
        "crater_dark": base_material("RWB_CraterDark", (25, 21, 18), (43, 33, 25), 3.1, .24),
        "ejecta": base_material("RWB_Ejecta", (45, 36, 27), (73, 58, 40), 2.7, .24),
        "stone": base_material("RWB_Stone", (62, 59, 50), (151, 134, 101), 2.4, 0.24),
        "puddle": base_material("RWB_Puddle", (29, 31, 27), (61, 65, 54), 3.4, 0.03, 0.32),
        "bark": base_material("RWB_Bark", (31, 24, 18), (75, 55, 33), 3.0, 0.34),
        "leaf0": base_material("RWB_Leaf0", (24, 39, 16), (74, 88, 34), 2.5, 0.22),
        "leaf1": base_material("RWB_Leaf1", (31, 48, 18), (91, 101, 39), 2.9, 0.20),
        "leaf2": base_material("RWB_Leaf2", (42, 52, 20), (112, 105, 43), 2.7, 0.18),
    }
    ground.data.materials.clear()
    for key in ("grass", "worn", "field", "edge"):
        ground.data.materials.append(mats[key])
    return mats


def mesh_obj(col, name, verts, faces, mats, indices=None, smooth=False):
    mesh = bpy.data.meshes.new(name + "_MESH")
    mesh.from_pydata(verts, (), faces)
    mesh.update()
    for mat in mats:
        mesh.materials.append(mat)
    if indices is not None:
        for poly, index in zip(mesh.polygons, indices):
            poly.material_index = int(index)
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    return obj


def hex_board_ground(col,mats):
    verts=[]
    vertex_map={}
    top_faces=[]
    edge_counts={}
    for center in BOARD_CENTERS:
        face=[]
        for index in range(6):
            angle=math.radians(30+index*60)
            x=center[0]+math.cos(angle)*BOARD_R
            y=center[1]+math.sin(angle)*BOARD_R
            key=(round(x,6),round(y,6))
            if key not in vertex_map:
                vertex_map[key]=len(verts)
                verts.append((x,y,GROUND_Z))
            face.append(vertex_map[key])
        top_faces.append(tuple(face))
        for a,b in zip(face,face[1:]+face[:1]):
            edge=tuple(sorted((a,b)))
            edge_counts[edge]=edge_counts.get(edge,0)+1
    top_count=len(verts)
    verts.extend((x,y,GROUND_Z-.52) for x,y,_ in verts[:])
    side_faces=[]
    for (a,b),count in edge_counts.items():
        if count==1:
            side_faces.append((a,b,b+top_count,a+top_count))
    faces=top_faces+side_faces
    indices=[0]*len(top_faces)+[1]*len(side_faces)
    obj=mesh_obj(col,"RWB_ThirtyHexGround",verts,faces,
                 (mats["grass"],mats["edge"]),indices)
    obj["logical_hex_count"]=30
    obj["internal_grid_visible"]=False
    return obj


def patch(col, name, center, rx, ry, mat, rng, z, n=28):
    verts = [(center[0], center[1], z)]
    for i in range(n):
        a = math.tau * i / n
        k = 1.0 + rng.uniform(-0.17, 0.15)
        verts.append((center[0] + math.cos(a) * rx * k,
                      center[1] + math.sin(a) * ry * k,
                      z + rng.uniform(-0.01, 0.01)))
    faces = [(0, i + 1, (i + 1) % n + 1) for i in range(n)]
    return mesh_obj(col, name, verts, faces, (mat,), smooth=True)


def catmull(ctrl, samples=9):
    out = []
    for i in range(len(ctrl) - 1):
        p0, p1 = ctrl[max(0, i - 1)], ctrl[i]
        p2, p3 = ctrl[i + 1], ctrl[min(len(ctrl) - 1, i + 2)]
        for s in range(samples):
            t = s / samples
            t2, t3 = t * t, t * t * t
            out.append((
                0.5 * (2*p1[0] + (-p0[0]+p2[0])*t +
                       (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 +
                       (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
                0.5 * (2*p1[1] + (-p0[1]+p2[1])*t +
                       (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 +
                       (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
            ))
    out.append(ctrl[-1])
    return out


def normals(points):
    result = []
    for i in range(len(points)):
        a, b = points[max(0, i-1)], points[min(len(points)-1, i+1)]
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = max(1e-6, math.hypot(dx, dy))
        result.append((-dy/length, dx/length))
    return result


def strip(col, name, points, widths, mat, z, offset=0.0):
    ns, verts = normals(points), []
    for point, normal, width in zip(points, ns, widths):
        cx, cy = point[0] + normal[0]*offset, point[1] + normal[1]*offset
        verts += [(cx-normal[0]*width, cy-normal[1]*width, z),
                  (cx+normal[0]*width, cy+normal[1]*width, z)]
    faces = [(i*2, i*2+1, i*2+3, i*2+2) for i in range(len(points)-1)]
    return mesh_obj(col, name, verts, faces, (mat,), smooth=True)


def seg_distance(p, a, b):
    vx, vy = b[0]-a[0], b[1]-a[1]
    length2 = vx*vx + vy*vy
    if length2 < 1e-9:
        return math.hypot(p[0]-a[0], p[1]-a[1])
    t = max(0.0, min(1.0, ((p[0]-a[0])*vx + (p[1]-a[1])*vy)/length2))
    return math.hypot(p[0]-(a[0]+vx*t), p[1]-(a[1]+vy*t))


def path_distance(p, path_points):
    return min(seg_distance(p, a, b) for a, b in zip(path_points, path_points[1:]))

def path_network_distance(point, paths):
    """Distance to one route or to a tuple/list of independent routes."""
    if not paths:
        return 9999.0
    if isinstance(paths[0][0], (int, float)):
        return path_distance(point, paths)
    return min(path_distance(point, path) for path in paths)



def box(verts, faces, center, dims, angle):
    base = len(verts)
    hx, hy, hz = dims[0]/2, dims[1]/2, dims[2]/2
    c, s = math.cos(angle), math.sin(angle)
    for z in (-hz, hz):
        for y in (-hy, hy):
            for x in (-hx, hx):
                verts.append((center[0]+x*c-y*s, center[1]+x*s+y*c, center[2]+z))
    faces += [
        (base,base+1,base+3,base+2), (base+4,base+6,base+7,base+5),
        (base,base+4,base+5,base+1), (base+2,base+3,base+7,base+6),
        (base,base+2,base+6,base+4), (base+1,base+5,base+7,base+3),
    ]


def fences(col, segments, mat, rng):
    verts, faces = [], []
    for si, (a, b) in enumerate(segments):
        dx, dy = b[0]-a[0], b[1]-a[1]
        length, angle = math.hypot(dx, dy), math.atan2(dy, dx)
        count = max(2, int(length/2.3)+1)
        for i in range(count):
            if si % 3 == 1 and i == count//2:
                continue
            t = i/max(1, count-1)
            height = rng.uniform(1.25, 1.62)
            box(verts, faces,
                (a[0]+dx*t+rng.uniform(-.08,.08), a[1]+dy*t+rng.uniform(-.08,.08),
                 GROUND_Z+height/2), (.16,.16,height), angle+rng.uniform(-.05,.05))
        chunks = 3 if length > 8 else 2
        for i in range(chunks):
            if si % 4 == 2 and i == 1:
                continue
            t0, t1 = i/chunks, (i+.92)/chunks
            center = (a[0]+dx*(t0+t1)/2, a[1]+dy*(t0+t1)/2)
            for height in (.58, 1.12):
                box(verts, faces, (center[0],center[1],GROUND_Z+height),
                    (length*(t1-t0),.11,.11), angle)
    return mesh_obj(col, "RWB_BrokenFences", verts, faces, (mat,))

def consume_v26_fence_random_stream(rng,segments):
    """Advance the shared RNG exactly as the v26 fence pass did."""
    for segment_index,(a,b) in enumerate(segments):
        length=math.hypot(b[0]-a[0],b[1]-a[1])
        count=max(2,int(length/2.3)+1)
        for post_index in range(count):
            if segment_index%3==1 and post_index==count//2:
                continue
            rng.uniform(1.25,1.62)
            rng.uniform(-.08,.08)
            rng.uniform(-.08,.08)
            rng.uniform(-.05,.05)


def fence_effective_clearance(segment,path,widths,safety=.135):
    """Minimum fence-to-road-edge clearance, including post jitter and rail radius."""
    result=float("inf")
    a,b=segment
    for sample_index in range(97):
        ratio=sample_index/96
        point=(a[0]+(b[0]-a[0])*ratio,a[1]+(b[1]-a[1])*ratio)
        for path_index,(p0,p1) in enumerate(zip(path,path[1:])):
            vx,vy=p1[0]-p0[0],p1[1]-p0[1]
            length2=vx*vx+vy*vy
            if length2<1e-9:
                along=0.0
            else:
                along=max(0.0,min(1.0,
                    ((point[0]-p0[0])*vx+(point[1]-p0[1])*vy)/length2))
            near=(p0[0]+vx*along,p0[1]+vy*along)
            width=widths[path_index]+(widths[path_index+1]-widths[path_index])*along
            result=min(result,math.hypot(point[0]-near[0],point[1]-near[1])
                       -width-safety)
    return result




def damaged_ruin_fences(col,mats):
    """Localized blast/structural damage around the cottage ruin only."""
    survivors=tuple((T(a),T(b)) for a,b in (
        ((12.00,35.50),(14.55,35.39)),
        ((21.85,35.10),(24.00,35.00)),
        ((24.00,35.00),(24.22,37.35)),
        ((11.50,38.50),(11.50,40.30)),
        ((11.50,44.80),(11.50,47.00))))
    survivor_rng=random.Random(SEED+5610)
    survivor_obj=fences(col,survivors,mats["wood"],survivor_rng)
    survivor_obj.name="RWB_RuinFenceSurvivors"

    leaning=tuple((T3(a),T3(b)) for a,b in (
        ((14.65,35.40,.08),(15.20,35.78,.94)),
        ((20.95,35.16,.08),(20.38,35.74,.78)),
        ((24.25,37.55,.08),(23.62,38.10,.90)),
        ((11.50,40.48,.08),(12.16,40.92,.76)),
        ((11.50,44.58,.08),(12.02,44.06,.70))))
    fallen=tuple((T3(a),T3(b)) for a,b in (
        ((14.72,35.34,.12),(18.08,34.86,.17)),
        ((18.35,35.02,.11),(21.18,35.72,.16)),
        ((23.94,37.52,.13),(22.30,40.16,.19)),
        ((11.58,40.36,.12),(13.02,43.34,.18)),
        ((11.42,44.38,.12),(13.48,43.62,.16)),
        ((16.10,35.22,.10),(16.72,36.46,.15))))
    def raised(path):
        return tuple((x,y,GROUND_Z+z) for x,y,z in path)
    for index,path in enumerate(leaning):
        curve_ridge(col,"RWB_RuinFenceLeaningPost_%02d"%index,
                    raised(path),.070,mats["wood"])
    for index,path in enumerate(fallen):
        curve_ridge(col,"RWB_RuinFenceFallenRail_%02d"%index,
                    raised(path),.055 if index<5 else .068,mats["wood"])
    damage_segments=tuple(((a[0],a[1]),(b[0],b[1])) for a,b in leaning+fallen)
    original_length=12.0+math.hypot(.66,7.25)+8.5
    surviving_length=sum(math.hypot(b[0]-a[0],b[1]-a[1]) for a,b in survivors)
    return {"damaged_logical_sections":3,
            "surviving_fragments":len(survivors),
            "original_length_m":round(original_length,3),
            "surviving_length_m":round(surviving_length,3),
            "rail_loss_ratio":round(1-surviving_length/original_length,3),
            "leaning_posts":len(leaning),"fallen_members":len(fallen),
            "dedicated_rng_seed":SEED+5610,"shared_rng_preserved":True,
            "damage_gradient":"mixed survival; strongest beside collapsed shell"},survivors,damage_segments


def field(col, name, center, size, bearing, count, mats, rng):
    patch(col, name+"_Soil", center, size[0]*.56, size[1]*.57,
          mats["field"], rng, GROUND_Z+.025, 32)
    angle = math.radians(bearing)
    ux, uy = (math.cos(angle),math.sin(angle)), (-math.sin(angle),math.cos(angle))
    verts, faces, cv, cf, ci = [], [], [], [], []
    spacing = size[1]/count
    for row in range(count):
        across = (row-(count-1)/2)*spacing
        length = size[0]*rng.uniform(.84,.98)
        cx = center[0]+uy[0]*across+rng.uniform(-.15,.15)
        cy = center[1]+uy[1]*across+rng.uniform(-.15,.15)
        pieces = 3
        piece_len = length/pieces*.92
        for piece in range(pieces):
            if (row*3+piece) % 17 == 0:
                continue
            along = (piece-(pieces-1)/2)*length/pieces
            box(verts, faces,
                (cx+ux[0]*along,cy+ux[1]*along,GROUND_Z+.105),
                (piece_len,min(.74,spacing*.68),.13),angle)
        stocks = max(5,int(length/1.05))
        for stock in range(stocks):
            t = (stock+.5)/stocks-.5
            x = cx+ux[0]*length*t+rng.uniform(-.12,.12)
            y = cy+ux[1]*length*t+rng.uniform(-.12,.12)
            h, w = rng.uniform(.65,1.14), rng.uniform(.18,.30)
            base = len(cv)
            cv += [(x-ux[0]*w,y-ux[1]*w,GROUND_Z+.2),
                   (x+ux[0]*w,y+ux[1]*w,GROUND_Z+.2),
                   (x+ux[0]*w*.25,y+ux[1]*w*.25,GROUND_Z+h),
                   (x-ux[0]*w*.25,y-ux[1]*w*.25,GROUND_Z+h)]
            cf.append((base,base+1,base+2,base+3))
            ci.append((row+stock)%4==0)
    rows = mesh_obj(col, name+"_Rows", verts, faces, (mats["row"],))
    bevel = rows.modifiers.new("SoftRows", "BEVEL")
    bevel.width, bevel.segments = .11, 3
    mesh_obj(col, name+"_Crops", cv, cf, (mats["crop0"],mats["crop1"]), ci)


def grass(col, roads, mats, rng, count=720):
    verts, faces, indices, fv, ff = [], [], [], [], []
    accepted = attempts = 0
    excl1 = T_bounds(32,4,68,40)
    excl2 = T_bounds(48,40,66,55)
    while accepted < count and attempts < count*7:
        attempts += 1
        x, y = rng.uniform(3,67), rng.uniform(.5,75)
        if (not inside_board((x,y),.35) or path_network_distance((x,y),roads) < 3.2
                or (excl1[0]<x<excl1[1] and excl1[2]<y<excl1[3])
                or (excl2[0]<x<excl2[1] and excl2[2]<y<excl2[3])):
            continue
        h, w, angle = rng.uniform(.14,.39), rng.uniform(.07,.18), rng.random()*math.tau
        for cross in (0,math.pi/2):
            a = angle+cross
            dx, dy = math.cos(a)*w, math.sin(a)*w
            base = len(verts)
            verts += [(x-dx,y-dy,GROUND_Z+.03),(x+dx,y+dy,GROUND_Z+.03),
                      (x,y,GROUND_Z+h)]
            faces.append((base,base+1,base+2))
            indices.append(accepted%5==0)
        if accepted%9==0:
            base=len(fv)
            petal=rng.uniform(.16,.25)
            fv += [(x-petal,y,GROUND_Z+h*.76),(x+petal,y,GROUND_Z+h*.76),
                   (x,y,GROUND_Z+h+rng.uniform(.16,.25))]
            ff.append((base,base+1,base+2))
        accepted += 1
    mesh_obj(col,"RWB_GrassClumps",verts,faces,(mats["blade0"],mats["blade1"]),indices)
    mesh_obj(col,"RWB_Flowers",fv,ff,(mats["flower"],))


def sprite_path(item, slot):
    meta_path = next((REF/item).glob("*.metadata.json"))
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    for frame in meta["frames"]:
        if frame["slot"] == slot and frame.get("png"):
            return REF/item/frame["png"]
    raise RuntimeError("missing sprite %s:%d" % (item,slot))


def sprite_mat(path):
    name = "RWB_SP_"+path.stem
    found = bpy.data.materials.get(name)
    if found:
        return found
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out, mix = nodes.new("ShaderNodeOutputMaterial"), nodes.new("ShaderNodeMixShader")
    transparent, shader = nodes.new("ShaderNodeBsdfTransparent"), nodes.new("ShaderNodeBsdfPrincipled")
    image_node = nodes.new("ShaderNodeTexImage")
    image_node.image = bpy.data.images.load(str(path), check_existing=True)
    image_node.interpolation = "Linear"
    shader.inputs["Roughness"].default_value = .9
    grade=nodes.new("ShaderNodeHueSaturation")
    grade.inputs["Saturation"].default_value=.82
    grade.inputs["Value"].default_value=.76
    links.new(image_node.outputs["Color"],grade.inputs["Color"])
    links.new(grade.outputs["Color"],shader.inputs["Base Color"])
    if "Emission Color" in shader.inputs:
        links.new(grade.outputs["Color"],shader.inputs["Emission Color"])
        shader.inputs["Emission Strength"].default_value=.025
    links.new(transparent.outputs[0],mix.inputs[1])
    links.new(shader.outputs[0],mix.inputs[2])
    links.new(image_node.outputs["Alpha"],mix.inputs[0])
    links.new(mix.outputs[0],out.inputs[0])
    try:
        mat.surface_render_method="DITHERED"
    except Exception:
        pass
    mat.use_backface_culling=False
    return mat


def ground_sprite_mat(path,opacity=.13):
    """Low-opacity olive grade used only by horizontal PS surface decals."""
    name="RWB_GD_%s_%02d"%(path.stem,round(opacity*100))
    found=bpy.data.materials.get(name)
    if found:
        return found
    mat=bpy.data.materials.new(name)
    mat.use_nodes=True
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    nodes.clear()
    out=nodes.new("ShaderNodeOutputMaterial")
    mix=nodes.new("ShaderNodeMixShader")
    transparent=nodes.new("ShaderNodeBsdfTransparent")
    shader=nodes.new("ShaderNodeBsdfPrincipled")
    image_node=nodes.new("ShaderNodeTexImage")
    image_node.image=bpy.data.images.load(str(path),check_existing=True)
    image_node.interpolation="Linear"
    grade=nodes.new("ShaderNodeHueSaturation")
    grade.inputs["Saturation"].default_value=.58
    grade.inputs["Value"].default_value=.70
    olive=nodes.new("ShaderNodeMixRGB")
    olive.blend_type="MULTIPLY"
    olive.inputs[0].default_value=.30
    olive.inputs[2].default_value=(.39,.46,.25,1)
    alpha=nodes.new("ShaderNodeMath")
    alpha.operation="MULTIPLY"
    alpha.inputs[1].default_value=opacity
    shader.inputs["Roughness"].default_value=.96
    links.new(image_node.outputs["Color"],grade.inputs["Color"])
    links.new(grade.outputs["Color"],olive.inputs[1])
    links.new(olive.outputs["Color"],shader.inputs["Base Color"])
    links.new(image_node.outputs["Alpha"],alpha.inputs[0])
    links.new(transparent.outputs[0],mix.inputs[1])
    links.new(shader.outputs[0],mix.inputs[2])
    links.new(alpha.outputs[0],mix.inputs[0])
    links.new(mix.outputs[0],out.inputs[0])
    try:
        mat.surface_render_method="DITHERED"
    except Exception:
        pass
    mat.use_backface_culling=False
    return mat



def billboard(col, name, item, slot, pos, scale=1.0):
    path = sprite_path(item,slot)
    image = bpy.data.images.load(str(path),check_existing=True)
    width, height = image.size[0]/10.5*scale, image.size[1]/10.5*scale*1.12
    verts=[(-width/2,0,0),(width/2,0,0),(width/2,0,height),(-width/2,0,height)]
    mesh=bpy.data.meshes.new(name+"_MESH")
    mesh.from_pydata(verts,(),[(0,1,2,3)])
    uv=mesh.uv_layers.new(name="UVMap")
    coords=((0,0),(1,0),(1,1),(0,1))
    for loop in mesh.loops:
        uv.data[loop.index].uv=coords[loop.vertex_index]
    mesh.materials.append(sprite_mat(path))
    obj=bpy.data.objects.new(name,mesh)
    col.objects.link(obj)
    obj.location=(pos[0],pos[1],GROUND_Z+.05)
    obj.rotation_euler.z=0
    try:
        obj.visible_shadow=False
    except AttributeError:
        pass
    obj["review_casts_shadow"]=False
    return obj


def ground_decal(col, name, item, slot, pos, scale=1.0, bearing=0.0, z=.105, opacity=.13):
    """Lay an alpha PS sprite on the board as fixed-angle surface vocabulary."""
    path=sprite_path(item,slot)
    image=bpy.data.images.load(str(path),check_existing=True)
    width=image.size[0]/10.5*scale
    height=image.size[1]/10.5*scale/0.82
    verts=[(-width/2,-height/2,0),(width/2,-height/2,0),
           (width/2,height/2,0),(-width/2,height/2,0)]
    mesh=bpy.data.meshes.new(name+"_MESH")
    mesh.from_pydata(verts,(),[(0,1,2,3)])
    uv=mesh.uv_layers.new(name="UVMap")
    coords=((0,0),(1,0),(1,1),(0,1))
    for loop in mesh.loops:
        uv.data[loop.index].uv=coords[loop.vertex_index]
    mesh.materials.append(ground_sprite_mat(path,opacity))
    obj=bpy.data.objects.new(name,mesh)
    col.objects.link(obj)
    obj.location=(pos[0],pos[1],z)
    obj.rotation_euler.z=math.radians(bearing)
    try:
        obj.visible_shadow=False
    except AttributeError:
        pass
    obj["review_casts_shadow"]=False
    obj["review_sprite_role"]="Panzer Strike ground vocabulary"
    return obj


def add_ps_ground_vocabulary(col,rng):
    grass_specs=(
        ("grass_base_a",0,(13,12)),("grass_base_b",1,(19,16)),
        ("grass_flowers",0,(27,10)),("forest_floor",0,(12,27)),
        ("grass_base_b",0,(8,49)),("grass_flowers",1,(14,58)),
        ("forest_floor",0,(23,61)),("grass_base_a",1,(32,62)),
        ("grass_flowers",0,(43,63)),("grass_base_b",1,(56,61)),
        ("forest_floor",0,(61,55)),("grass_base_a",0,(61,43)),
        ("grass_flowers",1,(30,49)),("grass_base_b",0,(42,44)),
        ("grass_base_a",1,(44,13)),("grass_flowers",0,(61,15)),
        ("forest_floor",0,(26,54)))
    for index,(item,slot,pos) in enumerate(grass_specs):
        ground_decal(col,"RWB_PSGroundGrass_%02d"%index,item,slot,pos,
                     rng.uniform(.24,.36),rng.uniform(0,360),.108)
    soil_specs=(("soil_a",(20,41)),("soil_b",(25,44)),("soil_c",(31,38)),
                ("yard_a",(36,47)),("yard_b",(46,49)),("yard_entrance",(54,50)))
    for index,(item,pos) in enumerate(soil_specs):
        ground_decal(col,"RWB_PSGroundSoil_%02d"%index,item,0,pos,
                     rng.uniform(.22,.31),rng.uniform(0,360),.112)
    return {"grass_overlays":len(grass_specs),"soil_yard_overlays":len(soil_specs)}



def sprite_vocabulary(col,rng):
    trees=["tree_oak","tree_linden","tree_willow","tree_poplar",
           "tree_robinia","tree_fir","tree_spruce","tree_blossom"]
    positions=[(2,10),(5,18),(8,27),(3,36),(7,59),(13,67),(61,4),(68,10),
               (66,19),(70,28),(65,67),(57,70),(18,8),(27,7),(48,12),(58,25),
               (55,33),(8,45),(17,39),(45,60),(37,69),(25,58),(48,30),(31,35)]
    for i,pos in enumerate(positions):
        billboard(col,"RWB_Tree_%03d"%i,trees[i%len(trees)],2,pos,(.9,1,1.08)[i%3])
    shrubs=[("bush_big",2),("bush_medium",0),("bush_medium",1),("bush_small",0),
            ("flower_phlox",0),("flower_phlox",1),("flower_primula",0),("fern",2)]
    for i in range(72):
        item,slot=shrubs[i%len(shrubs)]
        billboard(col,"RWB_Shrub_%03d"%i,item,slot,
                  (rng.uniform(2,69),rng.uniform(3,68)),rng.uniform(.82,1.08))
    life=[("washing",2,(31,28.5)),("well",2,(37.5,32)),("woodpile",2,(17.5,50)),
          ("cart",2,(23.5,58.5)),("compose_farm_a",1,(42,44)),
          ("compose_farm_b",2,(14,55.5)),("barrel",2,(35,23)),("bench",2,(26,42))]
    for i,(item,slot,pos) in enumerate(life):
        billboard(col,"RWB_Life_%02d"%i,item,slot,pos,.94)
    return {"trees":len(positions),"understory":72,"life":len(life)}


def rotated_patch(col,name,center,size,bearing,mat,rng,z):
    angle=math.radians(bearing)
    ux,uy=(math.cos(angle),math.sin(angle)),(-math.sin(angle),math.cos(angle))
    hx,hy=size[0]/2,size[1]/2
    perimeter=[]
    corners=[(-hx,-hy),(hx,-hy),(hx,hy),(-hx,hy)]
    for edge in range(4):
        a,b=corners[edge],corners[(edge+1)%4]
        for step in range(6):
            t=step/6
            x=a[0]+(b[0]-a[0])*t
            y=a[1]+(b[1]-a[1])*t
            jitter=rng.uniform(-.24,.24)
            if edge in (0,2):
                y+=jitter
            else:
                x+=jitter
            perimeter.append((center[0]+ux[0]*x+uy[0]*y,
                              center[1]+ux[1]*x+uy[1]*y,
                              z+rng.uniform(-.008,.008)))
    verts=[(center[0],center[1],z)]+perimeter
    faces=[(0,i+1,(i+1)%len(perimeter)+1) for i in range(len(perimeter))]
    return mesh_obj(col,name,verts,faces,(mat,),smooth=True)


def curve_ridge(col,name,points,radius,mat):
    curve=bpy.data.curves.new(name+"_CURVE","CURVE")
    curve.dimensions="3D"
    curve.resolution_u=2
    curve.bevel_depth=radius
    curve.bevel_resolution=3
    curve.use_fill_caps=True
    spline=curve.splines.new("POLY")
    spline.points.add(len(points)-1)
    for point,co in zip(spline.points,points):
        point.co=(co[0],co[1],co[2],1)
    obj=bpy.data.objects.new(name,curve)
    col.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def target_field(col,name,center,size,bearing,count,mats,rng,holes=()):
    rotated_patch(col,name+"_Soil",center,size,bearing,mats["field"],rng,GROUND_Z+.028)
    angle=math.radians(bearing)
    ux,uy=(math.cos(angle),math.sin(angle)),(-math.sin(angle),math.cos(angle))
    field_overlay_count=0
    overlay_scale=.40*math.sqrt(size[0]/25.0)
    for overlay_index,along_factor in enumerate((-.30,0,.30)):
        cross_factor=(-.10,.12,-.06)[overlay_index]*size[1]
        pos=(center[0]+ux[0]*along_factor*size[0]+uy[0]*cross_factor,
             center[1]+ux[1]*along_factor*size[0]+uy[1]*cross_factor)
        ground_decal(col,"%s_PSField_%02d"%(name,overlay_index),
                     ("field_a","field_b","field_c")[overlay_index],0,pos,
                     overlay_scale,bearing,GROUND_Z+.111)
        field_overlay_count+=1
    spacing=size[1]/count
    crop_verts,crop_faces,crop_indices=[],[],[]
    crop_count=0
    ps_leaf_tufts=0
    ridge_segments=0

    def in_hole(x,y,margin=1.0):
        for hx,hy,hrx,hry in holes:
            if ((x-hx)/(hrx*margin))**2+((y-hy)/(hry*margin))**2 < 1.0:
                return True
        return False

    for row in range(count):
        across=(row-(count-1)/2)*spacing+rng.uniform(-.16,.16)
        length=size[0]*rng.uniform(.78,.96)
        gap_center=rng.uniform(-length*.18,length*.18)
        gap=rng.uniform(.45,1.15)
        spans=[(-length/2,length/2)]
        if row%4 in (1,3):
            spans=[(-length/2,gap_center-gap/2),(gap_center+gap/2,length/2)]
        for piece,(start,end) in enumerate(spans):
            if end-start<1.0:
                continue
            points=[]
            groups=[]
            for step in range(19):
                t=step/18
                along=start+(end-start)*t
                wobble=math.sin((row*.71+step)*.67)*.13+rng.uniform(-.055,.055)
                x=center[0]+ux[0]*along+uy[0]*(across+wobble)
                y=center[1]+ux[1]*along+uy[1]*(across+wobble)
                if in_hole(x,y,1.08):
                    if len(points)>=3:
                        groups.append(points)
                    points=[]
                else:
                    points.append((x,y,GROUND_Z+.135))
            if len(points)>=3:
                groups.append(points)
            for group_index,group in enumerate(groups):
                curve_ridge(col,"%s_Row_%02d_%d_%d"%(name,row,piece,group_index),
                            group,.10,mats["row"])
                ridge_segments+=1
        stocks=max(7,int(length/.82))
        for stock in range(stocks):
            if rng.random()<.16:
                continue
            along=(stock+.5)/stocks*length-length/2+rng.uniform(-.12,.12)
            x=center[0]+ux[0]*along+uy[0]*(across+rng.uniform(-.12,.12))
            y=center[1]+ux[1]*along+uy[1]*(across+rng.uniform(-.12,.12))
            if in_hole(x,y,1.18):
                continue
            base_z=GROUND_Z+.17
            height=rng.uniform(.18,.30)
            width=rng.uniform(.38,.58)
            leaf_count=5+(1 if (row+stock)%3==0 else 0)
            phase=rng.uniform(-.25,.25)
            for leaf_index in range(leaf_count):
                leaf_angle=angle+phase+math.tau*leaf_index/leaf_count+rng.uniform(-.10,.10)
                direction=(math.cos(leaf_angle),math.sin(leaf_angle))
                base=len(crop_verts)
                perpendicular=(-direction[1],direction[0])
                leaf_length=width*rng.uniform(.78,1.02)
                mid=(x+direction[0]*leaf_length*.52,y+direction[1]*leaf_length*.52)
                tip=(x+direction[0]*leaf_length,y+direction[1]*leaf_length)
                root_spread=width*.050
                mid_spread=width*rng.uniform(.18,.25)
                mid_z=base_z+height*rng.uniform(.62,.88)
                crop_verts += [
                    (x-perpendicular[0]*root_spread,y-perpendicular[1]*root_spread,base_z),
                    (mid[0]-perpendicular[0]*mid_spread,mid[1]-perpendicular[1]*mid_spread,mid_z),
                    (tip[0],tip[1],base_z+height*rng.uniform(.14,.30)),
                    (mid[0]+perpendicular[0]*mid_spread,mid[1]+perpendicular[1]*mid_spread,
                     mid_z+rng.uniform(-.025,.025)),
                    (x+perpendicular[0]*root_spread,y+perpendicular[1]*root_spread,base_z)]
                crop_faces.append((base,base+1,base+2,base+3,base+4))
                crop_indices.append((row+stock+leaf_index//2)%3)
            marker=stock+row*2
            item=None
            if "South" in name and marker%4==0:
                item,slot,scale="wheat_ripe",2,rng.uniform(.12,.16)
            elif "Garden" in name and marker%6==0:
                if ps_leaf_tufts%4==0:
                    item,slot,scale="sunflower",2,rng.uniform(.10,.13)
                else:
                    item,slot,scale="bush_small",0,rng.uniform(.085,.11)
            elif marker%8==0:
                if ps_leaf_tufts%4==0:
                    item,slot,scale="fern",2,rng.uniform(.055,.072)
                else:
                    item,slot,scale="bush_small",0,rng.uniform(.085,.11)
            if item is not None:
                billboard(col,"%s_PSTuft_%03d"%(name,ps_leaf_tufts),item,slot,
                          (x+rng.uniform(-.12,.12),y+rng.uniform(-.12,.12)),scale)
                ps_leaf_tufts+=1
            crop_count+=1
    mesh_obj(col,name+"_Crops",crop_verts,crop_faces,
             (mats["crop0"],mats["crop1"],mats["crop2"]),crop_indices)
    return {"rows":count,"ridge_segments":ridge_segments,"crops":crop_count,
            "ps_field_overlays":field_overlay_count,"ps_leaf_tufts":ps_leaf_tufts,
            "blast_holes":len(holes)}


def terrain_mottle(col,mats,rng):
    for i in range(76):
        large=i<18
        rx=rng.uniform(.70,1.75) if large else rng.uniform(.20,.72)
        ry=rx*rng.uniform(.42,.78)
        while True:
            center=(rng.uniform(3,67),rng.uniform(.5,75))
            if inside_board(center,min(1.6,rx*.72)):
                break
        mat=(mats["worn"],mats["meadow_dark"],mats["grass"],mats["meadow_gold"])[i%4]
        patch(col,"RWB_GroundMottle_%03d"%i,center,rx,ry,mat,rng,
              GROUND_Z+.010,16 if large else 10)
    return 76


def stone_scatter(col,mats,rng,count=190):
    verts,faces=[],[]
    for i in range(count):
        while True:
            x,y=rng.uniform(3,67),rng.uniform(.5,75)
            if inside_board((x,y),.25):
                break
        rx,ry=rng.uniform(.08,.30),rng.uniform(.07,.24)
        h=rng.uniform(.045,.18)
        a=rng.uniform(0,math.tau)
        ca,sa=math.cos(a),math.sin(a)
        ex=(ca*rx,sa*rx)
        ey=(-sa*ry,ca*ry)
        z=GROUND_Z+.12
        base=len(verts)
        verts += [(x+ex[0],y+ex[1],z),(x-ex[0],y-ex[1],z),
                  (x+ey[0],y+ey[1],z),(x-ey[0],y-ey[1],z),
                  (x,y,z+h),(x,y,z-.02)]
        faces += [(base,base+2,base+4),(base+2,base+1,base+4),
                  (base+1,base+3,base+4),(base+3,base,base+4),
                  (base+2,base,base+5),(base+1,base+2,base+5),
                  (base+3,base+1,base+5),(base,base+3,base+5)]
    return mesh_obj(col,"RWB_StoneScatter",verts,faces,(mats["stone"],),smooth=True)


def segmented_ruts(col,road,mats,rng,name="RWB_Rut"):
    """Broken, slightly wandering wheel depressions instead of ruler-straight rails."""
    ns=normals(road)
    made=0
    for side_index,side in enumerate((-1,1)):
        wheel_path=[]
        for index,(point,normal) in enumerate(zip(road,ns)):
            lateral=side*(.50+.055*math.sin(index*.47+side_index))
            lateral+=math.sin(index*1.63+side_index*2.1)*.022
            wheel_path.append((point[0]+normal[0]*lateral,
                               point[1]+normal[1]*lateral))
        start=1+rng.randint(0,2)
        while start<len(wheel_path)-4:
            length=rng.randint(4,9)
            end=min(len(wheel_path)-1,start+length)
            segment=wheel_path[start:end]
            if len(segment)>=3:
                mud_widths=[.20+.055*math.sin((start+i)*.61+side_index)
                            +rng.uniform(-.018,.025) for i in range(len(segment))]
                strip(col,"%s_Mud_%d_%02d"%(name,side_index,made),segment,mud_widths,
                      mats["rut_mud"],GROUND_Z+.116)
                widths=[.075+.022*math.sin((start+i)*.83+side_index)
                        +rng.uniform(-.009,.012) for i in range(len(segment))]
                strip(col,"%s_%d_%02d"%(name,side_index,made),segment,widths,
                      mats["rut"],GROUND_Z+.125+side_index*.002)
                made+=1
            start=end+rng.randint(3,7)
    return made


def road_edge_scars(col,road,mats,rng):
    ns=normals(road)
    made=0
    for index in range(6,len(road)-3,7):
        side=-1 if index%3 else 1
        center=(road[index][0]+ns[index][0]*rng.uniform(1.30,1.95)*side,
                road[index][1]+ns[index][1]*rng.uniform(1.30,1.95)*side)
        patch(col,"RWB_RoadEdgeScar_%02d"%made,center,
              rng.uniform(.48,1.05),rng.uniform(.20,.46),
              mats["grass"],rng,GROUND_Z+.104,14)
        made+=1
    mud_swaths=0
    for index in range(4,len(road)-3,4):
        before,after=road[index-1],road[index+1]
        bearing=math.degrees(math.atan2(after[1]-before[1],after[0]-before[0]))
        offset=rng.uniform(-.48,.48)
        center=(road[index][0]+ns[index][0]*offset,
                road[index][1]+ns[index][1]*offset)
        rotated_patch(col,"RWB_RoadMud_%02d"%mud_swaths,center,
                      (rng.uniform(.95,2.35),rng.uniform(.28,.68)),bearing,
                      mats["mud"],rng,GROUND_Z+.121)
        mud_swaths+=1
    dry_swaths=0
    for index in range(9,len(road)-4,9):
        before,after=road[index-1],road[index+1]
        bearing=math.degrees(math.atan2(after[1]-before[1],after[0]-before[0]))
        center=(road[index][0]+ns[index][0]*rng.uniform(-.65,.65),
                road[index][1]+ns[index][1]*rng.uniform(-.65,.65))
        rotated_patch(col,"RWB_RoadDry_%02d"%dry_swaths,center,
                      (rng.uniform(1.0,2.4),rng.uniform(.20,.48)),bearing,
                      mats["road_dry"],rng,GROUND_Z+.123)
        dry_swaths+=1
    center_growth=0
    for index in range(11,len(road)-5,10):
        before,after=road[index-1],road[index+1]
        bearing=math.degrees(math.atan2(after[1]-before[1],after[0]-before[0]))
        rotated_patch(col,"RWB_RoadCenterGrowth_%02d"%center_growth,road[index],
                      (rng.uniform(1.2,2.6),rng.uniform(.24,.55)),bearing,
                      mats["meadow_gold"] if index%3==0 else mats["meadow_dark"],rng,
                      GROUND_Z+.126)
        center_growth+=1
    return {"edge_scars":made,"mud_swaths":mud_swaths,
            "dry_swaths":dry_swaths,"center_growth":center_growth}



def road_puddles(col,road,mats,rng):
    made=0
    for index in (13,27,43,59,73):
        if index>=len(road)-1:
            continue
        a,b=road[index-1],road[index+1]
        bearing=math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]))
        rotated_patch(col,"RWB_Puddle_%02d"%made,road[index],
                      (rng.uniform(.8,1.7),rng.uniform(.28,.62)),
                      bearing,mats["puddle"],rng,GROUND_Z+.13)
        made+=1
    return made


def road_ps_vocabulary(col,paths,rng):
    """Use restrained Panzer Strike road pixels as grain, not as a replacement road."""
    rng=random.Random(SEED+5200)
    surfaces=0
    for path_index,path in enumerate(paths):
        ns=normals(path)
        surface_step=10 if path_index==0 else 7
        for index in range(6,len(path)-5,surface_step):
            before,after=path[index-1],path[index+1]
            bearing=math.degrees(math.atan2(after[1]-before[1],after[0]-before[0]))
            pos=(path[index][0]+ns[index][0]*rng.uniform(-.20,.20),
                 path[index][1]+ns[index][1]*rng.uniform(-.20,.20))
            ground_decal(col,"RWB_PSRoad_%d_%02d"%(path_index,surfaces),
                         "road_straight",0,pos,rng.uniform(.21,.25),bearing,
                         GROUND_Z+.108,.16)
            surfaces+=1
    fork=paths[1][0]
    fork_index=min(range(len(paths[0])),key=lambda i:math.hypot(
        paths[0][i][0]-fork[0],paths[0][i][1]-fork[1]))
    before=paths[0][max(0,fork_index-1)]
    after=paths[0][min(len(paths[0])-1,fork_index+1)]
    bearing=math.degrees(math.atan2(after[1]-before[1],after[0]-before[0]))
    ground_decal(col,"RWB_PSRoadFork","road_fork",0,fork,.34,bearing,
                 GROUND_Z+.109,.20)
    surfaces+=1
    return {"surface_stamps":surfaces,"track_stamps":0}



def add_branch_mesh(bm,base,direction,length,radius,depth,rng,kink=.25):
    mid=(direction+Vector((rng.uniform(-kink,kink),
                           rng.uniform(-kink,kink),
                           rng.uniform(-kink*.25,kink*.5)))).normalized()
    seg1,seg2=length*.56,length*.44
    parts=((base,direction,seg1,radius,radius*.72),
           (base+direction*seg1,mid,seg2,radius*.72,radius*.34))
    for start,direction_part,seg,r0,r1 in parts:
        made=bmesh.ops.create_cone(bm,cap_ends=True,segments=7,
                                   radius1=r0,radius2=r1,depth=seg)
        matrix=direction_part.to_track_quat("Z","X").to_matrix().to_4x4()
        matrix.translation=start+direction_part*(seg/2)
        bmesh.ops.transform(bm,matrix=matrix,verts=made["verts"])
    if depth<=0:
        return
    for _ in range(rng.randint(2,3)):
        t=rng.uniform(.38,.92)
        if t<.56:
            start=base+direction*(length*t)
            parent=direction
        else:
            start=base+direction*seg1+mid*(seg2*(t-.56)/.44)
            parent=mid
        tilt=rng.uniform(.42,.9)
        azimuth=rng.uniform(0,math.tau)
        child=(parent+Vector((math.cos(azimuth)*tilt,
                             math.sin(azimuth)*tilt,
                             rng.uniform(-.12,.28)))).normalized()
        add_branch_mesh(bm,start,child,length*rng.uniform(.40,.56),
                        radius*.50,depth-1,rng,kink*.92)


def add_crown_lobe(bm,location,scale,rng,phase):
    made=bmesh.ops.create_icosphere(bm,subdivisions=2,radius=1.0)
    sx,sy,sz=scale
    for vertex in made["verts"]:
        co=vertex.co.copy()
        rough=noise.noise(Vector((co.x*2.5+phase,
                                  co.y*2.5+phase*.37,
                                  co.z*2.5+phase*.19)))
        factor=1+rough*rng.uniform(.10,.20)
        vertex.co=Vector((co.x*sx,co.y*sy,co.z*sz))*factor+location


def build_target_tree(col,name,pos,variant,mats,seed):
    rng=random.Random(seed)
    profiles=((7.7,2.65,2.35,3.0,15,0.0),
              (9.0,2.15,2.05,3.8,16,.18),
              (6.4,2.85,2.65,2.6,14,-.18),
              (8.2,2.45,2.25,4.1,17,.08),
              (7.2,2.75,2.20,3.1,14,.12))
    height,rx,ry,crown_h,lobes,z_bias=profiles[variant%len(profiles)]
    height*=rng.uniform(.91,1.08)
    base=Vector((pos[0],pos[1],GROUND_Z+.06))
    wood_mesh=bpy.data.meshes.new(name+"_WOOD_MESH")
    wood_obj=bpy.data.objects.new(name+"_Wood",wood_mesh)
    col.objects.link(wood_obj)
    wood_bm=bmesh.new()
    lean=Vector((rng.uniform(-.07,.07),rng.uniform(-.07,.07),1)).normalized()
    add_branch_mesh(wood_bm,base,lean,height*.83,rng.uniform(.22,.34),2,rng)
    for _ in range(5):
        azimuth=rng.uniform(0,math.tau)
        direction=Vector((math.cos(azimuth),math.sin(azimuth),-.06)).normalized()
        made=bmesh.ops.create_cone(wood_bm,cap_ends=True,segments=5,
                                   radius1=rng.uniform(.10,.17),radius2=.025,
                                   depth=rng.uniform(.55,.95))
        matrix=direction.to_track_quat("Z","X").to_matrix().to_4x4()
        matrix.translation=base+direction*.30+Vector((0,0,.08))
        bmesh.ops.transform(wood_bm,matrix=matrix,verts=made["verts"])
    wood_bm.to_mesh(wood_mesh)
    wood_bm.free()
    wood_mesh.materials.append(mats["bark"])
    for polygon in wood_mesh.polygons:
        polygon.use_smooth=True
    crown_mesh=bpy.data.meshes.new(name+"_CROWN_MESH")
    crown_obj=bpy.data.objects.new(name+"_Crown",crown_mesh)
    col.objects.link(crown_obj)
    crown_bm=bmesh.new()
    center_z=base.z+height*.76+z_bias
    phase=rng.uniform(0,70)
    for index in range(lobes):
        angle=rng.uniform(0,math.tau)
        radial=math.sqrt(rng.random())
        location=Vector((base.x+math.cos(angle)*rx*radial,
                         base.y+math.sin(angle)*ry*radial,
                         center_z+rng.uniform(-crown_h*.35,crown_h*.42)))
        scale=(rng.uniform(.65,1.14),rng.uniform(.62,1.08),rng.uniform(.52,.92))
        add_crown_lobe(crown_bm,location,scale,rng,phase+index*.67)
    for index in range(4):
        location=Vector((base.x+rng.uniform(-.55,.55),
                         base.y+rng.uniform(-.55,.55),
                         center_z+rng.uniform(-.25,.55)))
        add_crown_lobe(crown_bm,location,(1.25,1.18,.92),rng,phase+30+index)
    crown_bm.to_mesh(crown_mesh)
    crown_bm.free()
    crown_mesh.materials.append(mats["leaf%d"%(variant%3)])
    for polygon in crown_mesh.polygons:
        polygon.use_smooth=True
    return wood_obj,crown_obj


def collection_xy_bounds(collection):
    points=[]
    for obj in collection.objects:
        if obj.type!="MESH" or obj.hide_render:
            continue
        points.extend(obj.matrix_world@Vector(corner) for corner in obj.bound_box)
    if not points:
        raise RuntimeError("No visible mesh bounds in "+collection.name)
    return min(p.x for p in points),max(p.x for p in points),min(p.y for p in points),max(p.y for p in points)


def place_collection_center(root,collection,center,angle):
    root.scale=(1,1,1)
    root.rotation_euler=(0,0,math.radians(angle))
    bpy.context.view_layer.update()
    x0,x1,y0,y1=collection_xy_bounds(collection)
    root.location.x+=center[0]-(x0+x1)/2
    root.location.y+=center[1]-(y0+y1)/2
    bpy.context.view_layer.update()
    collection["review_center_xy"]=center
    collection["review_scale"]=1.0
    return root


def regraded_material_copy(source_name,output_name,saturation=1.0,value=1.0,
                           warm_color=None,warm_mix=0.0,rough_min=.0,
                           metallic_scale=1.0):
    """Make a target-only material grade without touching the source asset."""
    source=bpy.data.materials.get(source_name)
    if source is None:
        return None
    material=source.copy()
    material.name=output_name
    if not material.use_nodes or material.node_tree is None:
        material.diffuse_color=tuple(
            min(1.0,max(0.0,channel*value)) for channel in material.diffuse_color[:3]
        )+(material.diffuse_color[3],)
        material.roughness=max(material.roughness,rough_min)
        material.metallic*=metallic_scale
        return material

    nodes=material.node_tree.nodes
    links=material.node_tree.links
    principled_nodes=[node for node in nodes if node.type=="BSDF_PRINCIPLED"]
    for index,shader in enumerate(principled_nodes):
        base=shader.inputs.get("Base Color")
        roughness=shader.inputs.get("Roughness")
        metallic=shader.inputs.get("Metallic")
        if base is not None:
            previous=base.links[0].from_socket if base.is_linked else None
            base_default=tuple(base.default_value)
            for link in tuple(base.links):
                links.remove(link)
            grade=nodes.new("ShaderNodeHueSaturation")
            grade.name="RWB_TargetGrade_%02d"%index
            grade.label="target-only pastoral grade"
            grade.inputs["Saturation"].default_value=saturation
            grade.inputs["Value"].default_value=value
            if previous is None:
                grade.inputs["Color"].default_value=base_default
            else:
                links.new(previous,grade.inputs["Color"])
            output=grade.outputs["Color"]
            if warm_color is not None and warm_mix>0:
                warm=nodes.new("ShaderNodeMixRGB")
                warm.name="RWB_WarmGlaze_%02d"%index
                warm.label="subtle rural warmth"
                warm.blend_type="MIX"
                warm.inputs[0].default_value=warm_mix
                warm.inputs[2].default_value=tuple(warm_color)+(1.0,)
                links.new(output,warm.inputs[1])
                output=warm.outputs[0]
            links.new(output,base)
        if roughness is not None:
            if roughness.is_linked:
                previous=roughness.links[0].from_socket
                for link in tuple(roughness.links):
                    links.remove(link)
                floor=nodes.new("ShaderNodeMath")
                floor.operation="MAXIMUM"
                floor.name="RWB_RoughnessFloor_%02d"%index
                floor.inputs[1].default_value=rough_min
                links.new(previous,floor.inputs[0])
                links.new(floor.outputs[0],roughness)
            else:
                roughness.default_value=max(roughness.default_value,rough_min)
        if metallic is not None:
            if metallic.is_linked:
                previous=metallic.links[0].from_socket
                for link in tuple(metallic.links):
                    links.remove(link)
                scale=nodes.new("ShaderNodeMath")
                scale.operation="MULTIPLY"
                scale.name="RWB_MetallicScale_%02d"%index
                scale.inputs[1].default_value=metallic_scale
                links.new(previous,scale.inputs[0])
                links.new(scale.outputs[0],metallic)
            else:
                metallic.default_value*=metallic_scale
    return material


def grade_target_building_materials():
    """Give the farm and barn separate, muted Panzer-Strike-era finishes."""
    specs={
        "farm":{
            "KB3D_WWT_MetalTrimRoofA":dict(saturation=.78,value=1.15,
                warm_color=(.49,.25,.105),warm_mix=.085,rough_min=.76,
                metallic_scale=.18),
            "KB3D_WWT_PlyWoodWornA":dict(saturation=.76,value=1.09,
                warm_color=(.48,.35,.20),warm_mix=.055,rough_min=.82),
            "KB3D_WWT_WoodPRedTrimA":dict(saturation=.74,value=1.08,
                warm_color=(.42,.25,.13),warm_mix=.050,rough_min=.82),
            "KB3D_WWT_WoodBrownTrimB":dict(saturation=.78,value=1.08,
                warm_color=(.42,.29,.16),warm_mix=.045,rough_min=.82)},
        "barn":{
            "KB3D_WWT_MetalTrimRoofA":dict(saturation=.72,value=1.10,
                warm_color=(.42,.26,.14),warm_mix=.070,rough_min=.78,
                metallic_scale=.15),
            "KB3D_WWT_ConcreteDamagedWallA":dict(saturation=.65,value=1.10,
                warm_color=(.45,.38,.25),warm_mix=.060,rough_min=.85),
            "KB3D_WWT_ConcreteDamagedWallB":dict(saturation=.65,value=1.10,
                warm_color=(.45,.38,.25),warm_mix=.060,rough_min=.85),
            "KB3D_WWT_BrickStoneGray":dict(saturation=.72,value=1.08,
                warm_color=(.38,.34,.25),warm_mix=.035,rough_min=.88)}
    }
    collections={"farm":"ROUND1_FARMSTEAD_CLEAN","barn":"ROUND1_BARN"}
    material_cache={}
    changed_objects=[]
    replacements=[]
    for role,collection_name in collections.items():
        collection=bpy.data.collections.get(collection_name)
        if collection is None:
            continue
        for obj in collection.objects:
            if obj.type!="MESH" or obj.data is None:
                continue
            matches=[]
            for slot_index,slot in enumerate(obj.material_slots):
                if slot.material and slot.material.name in specs[role]:
                    matches.append((slot_index,slot.material.name))
            if not matches:
                continue
            obj.data=obj.data.copy()
            for slot_index,source_name in matches:
                key=(role,source_name)
                if key not in material_cache:
                    output_name="RWB_%s_%s"%(role.title(),source_name)
                    material_cache[key]=regraded_material_copy(
                        source_name,output_name,**specs[role][source_name])
                replacement=material_cache[key]
                if replacement is not None:
                    obj.material_slots[slot_index].material=replacement
                    replacements.append({"object":obj.name,"slot":slot_index,
                                         "source":source_name,
                                         "target":replacement.name})
            changed_objects.append(obj.name)
    return {"mode":"target-only non-destructive node grade",
            "objects":sorted(set(changed_objects)),
            "materials":sorted(material.name for material in material_cache.values()
                               if material is not None),
            "slot_replacements":len(replacements)}


def build_building_layout():
    """Resolve farmstead/barn/cottage (center, angle) after --swap-buildings
    and --variant. v29 without swap reproduces the original literals exactly."""
    farmstead_center,farmstead_angle=(53,55),-7
    barn_center,barn_angle=(39,54),8
    cottage_center,cottage_angle=(18,41),-12
    if SWAP_BUILDINGS:
        farmstead_center,barn_center=(39,54),(53,55)
    return {
        "farmstead":(T(farmstead_center),T_angle(farmstead_angle)),
        "barn":(T(barn_center),T_angle(barn_angle)),
        "cottage":(T(cottage_center),T_angle(cottage_angle)),
    }


def target_assets(scene,building_layout):
    camp=bpy.data.collections.get("ROUND1_CAMP")
    if camp:
        for obj in camp.objects:
            obj.hide_render=True
    placements=(("ROUND1_FARMSTEAD_CLEAN","RW_ASSET_FARMSTEAD_CURATED_CLEAN",
                 *building_layout["farmstead"],"farmstead"),
                ("ROUND1_BARN","RW_ASSET_BARN_CURATED",
                 *building_layout["barn"],"barn"),
                ("ROUND1_COTTAGE","RW_ASSET_COTTAGE_BEAUTY",
                 *building_layout["cottage"],"cottage"))
    result=[]
    for collection_name,root_name,center,angle,label in placements:
        collection=bpy.data.collections[collection_name]
        for obj in collection.objects:
            obj.hide_render=False
        place_collection_center(bpy.data.objects[root_name],collection,center,angle)
        if label=="cottage":
            for obj in collection.objects:
                if "_Building" in obj.name or "_Porch" in obj.name:
                    obj.hide_render=True
        result.append((label,center))
    return result
def target_soft_contacts(col,mats,rng,building_layout):
    cottage_center,cottage_angle=building_layout["cottage"]
    barn_center,barn_angle=building_layout["barn"]
    farmstead_center,farmstead_angle=building_layout["farmstead"]
    specs=(("RWB_ContactRuin",cottage_center,(9.5,7.0),cottage_angle),
           ("RWB_ContactBarn",barn_center,(10.0,8.0),barn_angle),
           ("RWB_ContactFarm",farmstead_center,(16.0,11.5),farmstead_angle))
    for name,center,size,bearing in specs:
        rotated_patch(col,name,center,size,bearing,mats["contact"],rng,GROUND_Z+.041)
    return len(specs)





def consume_v26_ruin_random_stream(rng):
    """Advance the shared RNG exactly as the v26 ruin did."""
    for _ in range(7):
        rng.uniform(-2.8,2.8)
        rng.uniform(-1.8,1.8)
        rng.choice((-3.45,3.45))
        rng.uniform(-1.4,2.2)
        rng.uniform(3.0,5.8)
        rng.uniform(.065,.11)
    for _ in range(18):
        for __ in range(7):
            rng.uniform(0.0,1.0)
    for _ in range(160):
        rng.uniform(0,math.tau)
        rng.uniform(.3,6.4)
        rng.random()
        for __ in range(5):
            rng.uniform(0.0,1.0)


def add_ruined_cottage(col,center,mats,rng,bearing=-12):
    """Jagged, continuous masonry ruin with a fixed v26 footprint and RNG state."""
    consume_v26_ruin_random_stream(rng)
    rr=random.Random(SEED+5400)
    angle=math.radians(bearing)
    ca,sa=math.cos(angle),math.sin(angle)

    def world(local_x,local_y):
        return (center[0]+ca*local_x-sa*local_y,
                center[1]+sa*local_x+ca*local_y)

    def world3(point):
        x,y=world(point[0],point[1])
        return (x,y,GROUND_Z+point[2])

    wall_verts,wall_faces,wall_indices=[],[],[]

    def broken_strip(start,end,samples,z0=.03,thickness=.38):
        dx,dy=end[0]-start[0],end[1]-start[1]
        length=max(1e-6,math.hypot(dx,dy))
        nx,ny=-dy/length,dx/length
        first=len(wall_verts)
        for t,height,width_scale in samples:
            local_x=start[0]+dx*t
            local_y=start[1]+dy*t
            half=thickness*width_scale*.5
            minus=world(local_x-nx*half,local_y-ny*half)
            plus=world(local_x+nx*half,local_y+ny*half)
            wall_verts.extend((
                (minus[0],minus[1],GROUND_Z+z0),
                (minus[0],minus[1],GROUND_Z+height),
                (plus[0],plus[1],GROUND_Z+z0),
                (plus[0],plus[1],GROUND_Z+height)))
        for sample_index in range(len(samples)-1):
            a=first+sample_index*4
            b=a+4
            wall_faces.extend((
                (a,b,b+1,a+1),
                (a+2,a+3,b+3,b+2),
                (a+1,b+1,b+3,a+3),
                (a,a+2,b+2,b)))
            wall_indices.extend((0,0,1,1))
        last=first+(len(samples)-1)*4
        wall_faces.extend((
            (first,first+1,first+3,first+2),
            (last,last+2,last+3,last+1)))
        wall_indices.extend((1,1))

    wall_defs=(
        ((-3.55,-2.35),(-1.28,-2.35),.03,.38,
         ((0,2.15,.82),(.10,3.75,1.06),(.39,3.48,1.00),
          (.67,2.35,.88),(1,1.10,.54))),
        ((.22,-2.35),(3.46,-2.35),.03,.36,
         ((0,1.55,.55),(.22,2.72,.94),(.56,2.45,1.03),
          (.77,1.20,.76),(1,.50,.42))),
        ((-3.52,2.35),(-.92,2.35),.03,.40,
         ((0,4.15,.88),(.12,5.95,1.02),(.43,6.18,1.06),
          (.71,5.58,.98),(.87,4.40,.82),(1,3.55,.65))),
        ((-.96,2.35),(.96,2.35),.03,.39,
         ((0,.75,.72),(.38,1.40,1.04),(.72,1.18,.92),
          (1,.62,.58))),
        ((-1.02,2.35),(1.03,2.35),3.15,.40,
         ((0,3.85,.70),(.18,4.78,1.02),(.54,4.62,1.06),
          (.73,4.28,.88),(1,3.26,.48))),
        ((.94,2.35),(2.95,2.35),.03,.39,
         ((0,3.35,.72),(.15,4.52,1.00),(.48,4.88,1.06),
          (.70,4.14,.91),(.87,2.55,.66),(1,1.35,.36))),
        ((-3.65,-2.18),(-3.65,-.62),.03,.37,
         ((0,2.15,.82),(.18,3.60,1.04),(.52,3.20,.98),
          (.78,1.80,.75),(1,.85,.52))),
        ((-3.65,.12),(-3.65,2.28),.03,.40,
         ((0,1.15,.58),(.16,2.20,.82),(.45,3.95,1.00),
          (.75,5.55,1.06),(1,4.15,.88))),
        ((3.65,-2.18),(3.65,-.32),.03,.36,
         ((0,.50,.44),(.22,1.65,.88),(.61,1.20,.96),
          (1,.72,.58))),
        ((3.65,.25),(3.65,1.43),.03,.38,
         ((0,1.10,.60),(.18,2.05,.90),(.52,2.60,1.02),
          (.78,1.82,.77),(1,.72,.38))))
    for start_point,end_point,z0,thickness,samples in wall_defs:
        broken_strip(start_point,end_point,samples,z0,thickness)
    mesh_obj(col,"RWB_RuinBrokenShell",wall_verts,wall_faces,
             (mats["ruin_wall_weathered"],mats["stone"]),wall_indices)

    leaning=(
        ((-2.95,2.18,5.25),(-2.40,-1.55,.28)),
        ((-.75,2.18,4.45),(-.20,-1.45,.24)),
        ((1.75,2.18,4.00),(1.20,-1.25,.24)),
        ((-3.42,1.65,4.85),(.45,-.10,.28)))
    fallen=(
        ((-3.10,-1.70,.18),(-.30,-1.20,.18)),
        ((-2.40,-.25,.16),(1.90,-.70,.17)),
        ((-1.80,.55,.19),(2.70,.25,.18)),
        ((-3.00,1.25,.20),(.15,1.00,.18)),
        ((-.40,-1.75,.18),(3.00,-1.45,.18)),
        ((.55,.95,.18),(2.80,1.55,.18)))
    for index,path in enumerate(leaning):
        curve_ridge(col,"RWB_RuinLeaningBeam_%02d"%index,
                    tuple(world3(point) for point in path),
                    (.085,.075,.080,.095)[index],mats["wood"])
    for index,path in enumerate(fallen):
        curve_ridge(col,"RWB_RuinFallenBeam_%02d"%index,
                    tuple(world3(point) for point in path),
                    (.070,.065,.072,.068,.062,.066)[index],mats["wood"])

    rubble_verts,rubble_faces,rubble_indices=[],[],[]
    collapse_lobes_v28=(
        ((0,-2.35),(1,0),(0,-1),3.0),
        ((0,2.35),(1,0),(0,1),3.0),
        ((-3.65,.55),(0,1),(-1,0),2.1),
        ((3.65,.65),(0,1),(1,0),2.1))
    diagonal=math.sqrt(.5)
    rear_right_gap=(3.30,1.89)
    collapse_lobes=(
        (rear_right_gap,(-diagonal,diagonal),(diagonal,diagonal),3.35),
        ((2.78,2.28),(1,0),(0,1),2.12),
        ((3.55,1.28),(0,1),(1,0),2.38),
        ((3.18,1.76),(-diagonal,diagonal),(diagonal,diagonal),2.72))
    collapse_center_x=collapse_center_y=0.0
    for index in range(160):
        if index<100:
            theta=rr.uniform(0,math.tau)
            radius=4.35*(rr.random()**1.55)
            local_x=math.cos(theta)*radius
            local_y=math.sin(theta)*radius*.72
            size_local_x,size_local_y=local_x,local_y
        elif index<148:
            lobe_index=(index-100)%len(collapse_lobes)
            source_anchor,source_tangent,source_outward,source_reach=(
                collapse_lobes_v28[lobe_index])
            target_anchor,target_tangent,target_outward,target_reach=(
                collapse_lobes[lobe_index])
            run=rr.uniform(.12,source_reach)*(rr.random()**.82)
            across=rr.uniform(-1.35,1.35)*(1.0-.22*run/source_reach)
            size_local_x=(source_anchor[0]+source_outward[0]*run
                          +source_tangent[0]*across)
            size_local_y=(source_anchor[1]+source_outward[1]*run
                          +source_tangent[1]*across)
            target_run=run*target_reach/source_reach
            local_x=(target_anchor[0]+target_outward[0]*target_run
                     +target_tangent[0]*across)
            local_y=(target_anchor[1]+target_outward[1]*target_run
                     +target_tangent[1]*across)
        else:
            theta=rr.uniform(0,math.tau)
            radius=rr.uniform(4.8,6.2)
            local_x=math.cos(theta)*radius
            local_y=math.sin(theta)*radius*.70
            size_local_x,size_local_y=local_x,local_y
        local_x=max(-6.2,min(6.2,local_x))
        local_y=max(-4.55,min(4.55,local_y))
        size_local_x=max(-6.2,min(6.2,size_local_x))
        size_local_y=max(-4.55,min(4.55,size_local_y))
        if 100<=index<148:
            collapse_center_x+=local_x
            collapse_center_y+=local_y
        normalized=min(1.0,math.hypot(
            size_local_x/6.2,size_local_y/4.55))
        shrink=max(.55,1.0-.36*normalized)
        roll=rr.random()
        material_index=0 if roll<.56 else (1 if roll<.82 else 2)
        if material_index==1:
            dims=(rr.uniform(.28,.72)*shrink,
                  rr.uniform(.10,.29)*shrink,rr.uniform(.04,.09))
        elif material_index==2:
            dims=(rr.uniform(.15,.48)*shrink,
                  rr.uniform(.13,.41)*shrink,rr.uniform(.09,.25)*shrink)
        else:
            dims=(rr.uniform(.17,.58)*shrink,
                  rr.uniform(.14,.44)*shrink,rr.uniform(.08,.29)*shrink)
        piece_angle=rr.uniform(0,math.tau)
        piece_ca,piece_sa=math.cos(piece_angle),math.sin(piece_angle)
        base_z=GROUND_Z+rr.uniform(.015,.035)
        shift_x=rr.uniform(-dims[0]*.14,dims[0]*.14)
        shift_y=rr.uniform(-dims[1]*.14,dims[1]*.14)
        piece_base=len(rubble_verts)
        corners=((-1,-1),(1,-1),(-1,1),(1,1))
        for sign_x,sign_y in corners:
            px=sign_x*dims[0]*.5*rr.uniform(.86,1.12)
            py=sign_y*dims[1]*.5*rr.uniform(.86,1.12)
            rx=local_x+px*piece_ca-py*piece_sa
            ry=local_y+px*piece_sa+py*piece_ca
            x,y=world(rx,ry)
            rubble_verts.append((x,y,base_z))
        for sign_x,sign_y in corners:
            px=shift_x+sign_x*dims[0]*.42*rr.uniform(.80,1.10)
            py=shift_y+sign_y*dims[1]*.42*rr.uniform(.80,1.10)
            rx=local_x+px*piece_ca-py*piece_sa
            ry=local_y+px*piece_sa+py*piece_ca
            x,y=world(rx,ry)
            rubble_verts.append((x,y,base_z+dims[2]*rr.uniform(.78,1.12)))
        rubble_faces.extend((
            (piece_base,piece_base+1,piece_base+3,piece_base+2),
            (piece_base+4,piece_base+6,piece_base+7,piece_base+5),
            (piece_base,piece_base+4,piece_base+5,piece_base+1),
            (piece_base+2,piece_base+3,piece_base+7,piece_base+6),
            (piece_base,piece_base+2,piece_base+6,piece_base+4),
            (piece_base+1,piece_base+5,piece_base+7,piece_base+3)))
        rubble_indices.extend((material_index,)*6)
    mesh_obj(col,"RWB_RuinRubbleField",rubble_verts,rubble_faces,
             (mats["ruin_wall"],mats["roof_tile"],mats["stone"]),rubble_indices)
    ground_decal(col,"RWB_RuinPSDebris","compose_farm_a",1,center,.30,bearing,.082)
    return {"wall_fragments":len(wall_defs),"wall_construction":"jagged extruded strips",
            "macro_break_profile":True,"large_corner_loss":"rear_right",
            "wall_profile_mode":"nonuniform broad collapse planes",
            "wall_surface_weathering":{
                "mode":"shader-only dedicated wall material",
                "material":"RWB_RuinWallWeathered",
                "affected_object":"RWB_RuinBrokenShell","affected_faces":80,
                "layers":["age_dirt","rain_streaks","localized_soot"],
                "procedural_seed":SEED+5410,"shared_rng_preserved":True,
                "geometry_added":0,
                "topology":{"vertices":200,"edges":360,"faces":180},
                "stone_caps_unchanged":True,
                "rubble_material_unchanged":True},
            "readable_openings":2,"leaning_beams":len(leaning),
            "fallen_rafters":len(fallen),"rubble_pieces":160,
            "rubble_bands":{"core":100,"collapse":48,"fringe":12},
            "rubble_topology":{"pieces":160,"vertices_per_piece":8,
                "quad_faces_per_piece":6,"total_vertices":len(rubble_verts),
                "total_quad_faces":len(rubble_faces)},
            "rubble_collapse_bias":{
                "origin_local":[3.30,1.89],
                "outward_local":[round(diagonal,4),round(diagonal,4)],
                "outward_world_bearing_deg":round((bearing+45.0)%360,1),
                "directed_pieces":48,"unchanged_core_pieces":100,
                "unchanged_fringe_pieces":12,
                "collapse_centroid_local":[round(collapse_center_x/48,3),
                                            round(collapse_center_y/48,3)],
                "dedicated_rng_seed":SEED+5400,"dedicated_rng_draws":4848,
                "shared_rng_preserved":True},
            "footprint_local":{"x":[-6.2,6.2],"y":[-4.55,4.55]}}



def target_vocabulary(col,rng,road,buildings,mats):
    tree_positions=[T(p) for p in [(6,10),(9,15),(7,58),(14,64),(24,65),(35,66),
                    (50,65),(62,63),(64,56),(64,18),(60,9),(50,7),
                    (33,7),(19,8),(10,28),(24,59),(62,38),(29,63),
                    (12,20),(16,24),(5,48),(20,62),(43,64),(58,60),(18,7),(27,7),
                    (7,12),(11,18),(7,25),(8,53),(12,57),(18,60),(27,62),
                    (38,64),(47,63),(57,61),(62,53),(63,47),(58,11),(31,9),
                    (5,17),(8,22),(6,42),(10,50),(16,58),(22,63),(32,64),(41,65),
                    (52,63),(60,58),(63,50),(62,44),(61,14),(54,10),(44,8),(25,8)]]
    species=["tree_oak","tree_linden","tree_willow","tree_poplar",
             "tree_robinia","tree_fir","tree_spruce","tree_blossom"]
    scales=[.56,.66,.52,.50,.60,.74,.76,.70]
    for i,pos in enumerate(tree_positions):
        wood,crown=build_target_tree(
            col,"RWB_3DTree_%02d"%i,pos,i%5,mats,SEED+700+i*37)
        crown.hide_render=True
        canopy=billboard(col,"RWB_PSCanopy_%02d"%i,
                         species[i%len(species)],2,pos,scales[i%len(scales)])
    shrubs=[("bush_big",2),("bush_medium",0),("bush_medium",1),
            ("bush_small",0),("flower_phlox",0),("flower_primula",0),("fern",2)]
    accepted=attempts=0
    excl1=T_bounds(32,4,68,40)
    excl2=T_bounds(48,40,66,55)
    while accepted<92 and attempts<1600:
        attempts+=1
        pos=(rng.uniform(3,67),rng.uniform(.5,75))
        if (not inside_board(pos,.65) or path_network_distance(pos,road)<2.0
                or (excl1[0]<pos[0]<excl1[1] and excl1[2]<pos[1]<excl1[3])
                or (excl2[0]<pos[0]<excl2[1] and excl2[2]<pos[1]<excl2[3])):
            continue
        if any(math.hypot(pos[0]-center[0],pos[1]-center[1])<4.6
               for _,center in buildings):
            continue
        item,slot=shrubs[accepted%len(shrubs)]
        billboard(col,"RWB_LowPS_%03d"%accepted,item,slot,pos,rng.uniform(.42,.68))
        accepted+=1
    life=[(item,slot,T(pos)) for item,slot,pos in [
          ("washing",2,(49,51)),("well",2,(56,49)),("woodpile",2,(44,55)),
          ("cart",2,(47,58)),("compose_farm_a",1,(57,57)),
          ("compose_farm_b",2,(36,50)),("barrel",2,(21,39)),
          ("bench",2,(18,45)),("barrel",1,(50,53)),("woodpile",1,(41,57))]]
    for i,(item,slot,pos) in enumerate(life):
        try:
            billboard(col,"RWB_Life_%02d"%i,item,slot,pos,.68)
        except FileNotFoundError:
            continue
    return {"trees_hybrid":len(tree_positions),"tree_trunks_3d":len(tree_positions),
            "tree_canopies_ps":len(tree_positions),"understory_ps":accepted,"life":len(life)}


def pastoral_clusters(col,rng):
    """Place understory in deliberate hedgerow/fence clumps instead of uniform noise."""
    rng=random.Random(SEED+5300)
    anchors=((26,35),(39,36),(62,36),(47,42),(45,51),(44,60),
             (25,48),(12,36),(25,31),(32,53),(35,14),(38,25),
             (61,31),(57,39))
    palette=(("bush_big",2,.30),("bush_medium",0,.38),
             ("bush_medium",1,.38),("fern",2,.32),
             ("bush_small",0,.42),("flower_primula",0,.28))
    made=0
    for cluster_index,anchor in enumerate(anchors):
        count=4 if cluster_index%3==0 else 3
        for member in range(count):
            angle=math.tau*(member/count)+rng.uniform(-.45,.45)
            distance=rng.uniform(.18,1.25)
            pos=(anchor[0]+math.cos(angle)*distance,
                 anchor[1]+math.sin(angle)*distance)
            item,slot,base_scale=palette[(cluster_index+member)%len(palette)]
            billboard(col,"RWB_PastoralCluster_%03d"%made,item,slot,pos,
                      base_scale*rng.uniform(.86,1.16))
            made+=1
    return made



def duplicate(scene, source_name, out_name, root_name, location, angle):
    source=bpy.data.collections[source_name]
    dest=bpy.data.collections.new(out_name)
    scene.collection.children.link(dest)
    mapping={}
    for obj in source.objects:
        copy=obj.copy()
        copy.data=obj.data
        dest.objects.link(copy)
        mapping[obj]=copy
    for old,new in mapping.items():
        if old.parent in mapping:
            new.parent=mapping[old.parent]
            new.matrix_parent_inverse=old.matrix_parent_inverse.copy()
    root=mapping[bpy.data.objects[root_name]]
    root.name=out_name+"_ROOT"
    root.location=location
    root.rotation_euler=(0,0,math.radians(angle))
    root.scale=(1,1,1)
    dest["review_scale"]=1.0
    return root


def assets(scene):
    for name in ("ROUND1_CAMP","ROUND1_FARMSTEAD_CLEAN"):
        col=bpy.data.collections.get(name)
        if col:
            for obj in list(col.objects):
                obj.hide_render=True
    cottage=bpy.data.objects["RW_ASSET_COTTAGE_BEAUTY"]
    barn=bpy.data.objects["RW_ASSET_BARN_CURATED"]
    cottage.location=(14,49,cottage.location.z)
    cottage.rotation_euler=(0,0,math.radians(-8))
    cottage.scale=(1,1,1)
    barn.location=(21,62,barn.location.z)
    barn.rotation_euler=(0,0,math.radians(6))
    barn.scale=(1,1,1)
    duplicate(scene,"ROUND1_COTTAGE","ROUND2_COTTAGE_NORTH","RW_ASSET_COTTAGE_BEAUTY",
              (34,27,cottage.location.z),14)
    duplicate(scene,"ROUND1_COTTAGE","ROUND2_COTTAGE_EAST","RW_ASSET_COTTAGE_BEAUTY",
              (40,44,cottage.location.z),-17)
    duplicate(scene,"ROUND1_BARN","ROUND2_BARN_NORTH","RW_ASSET_BARN_CURATED",
              (35.5,17.5,barn.location.z),-11)
    return [("cottage_south",(14,49)),("barn_south",(21,62)),
            ("cottage_north",(34,27)),("cottage_east",(40,44)),
            ("barn_north",(35.5,17.5))]


def interfaces(col,buildings,road,mats,rng):
    for i,(name,pos) in enumerate(buildings):
        patch(col,"RWB_Yard_%02d"%i,pos,5.5 if "cottage" in name else 4.8,4.3,
              mats["worn"],rng,GROUND_Z+.03,26)
        near=min(road,key=lambda p:math.hypot(p[0]-pos[0],p[1]-pos[1]))
        connector=catmull([pos,((pos[0]+near[0])/2+rng.uniform(-.5,.5),
                                (pos[1]+near[1])/2+rng.uniform(-.5,.5)),near],7)
        strip(col,"RWB_Approach_%02d"%i,connector,
              [.62+.09*math.sin(j*.8) for j in range(len(connector))],
              mats["shoulder"],GROUND_Z+.065)


def target_interfaces(col,buildings,road,mats,rng):
    profiles={"farmstead":((16.5,12.0),-7),
              "barn":((9.5,11.5),8),
              "cottage":((12.5,10.5),-12)}
    for index,(name,center) in enumerate(buildings):
        size,bearing=profiles[name]
        rotated_patch(col,"RWB_TargetYard_%02d"%index,center,size,bearing,
                      mats["worn"],rng,GROUND_Z+.025)
        near=min(road,key=lambda point:math.hypot(point[0]-center[0],point[1]-center[1]))
        mid=((center[0]+near[0])/2+rng.uniform(-.45,.45),
             (center[1]+near[1])/2+rng.uniform(-.45,.45))
        connector=catmull([center,mid,near],8)
        widths=[.48+.09*math.sin(step*.73) for step in range(len(connector))]
        strip(col,"RWB_TargetApproach_%02d"%index,connector,widths,
              mats["shoulder"],GROUND_Z+.072)
        for spot in range(4):
            angle=math.tau*spot/4+rng.uniform(-.35,.35)
            distance=rng.uniform(min(size)*.40,min(size)*.58)
            patch(col,"RWB_YardEdge_%02d_%d"%(index,spot),
                  (center[0]+math.cos(angle)*distance,
                   center[1]+math.sin(angle)*distance),
                  rng.uniform(.55,1.15),rng.uniform(.28,.65),
                  mats["worn"],rng,GROUND_Z+.04,12)
    verts,faces=[],[]
    for index in range(34):
        if index<18:
            center=(18+rng.uniform(-6,6),41+rng.uniform(-5,5))
        else:
            center=(49+rng.uniform(-10,12),53+rng.uniform(-6,7))
        length=rng.uniform(.35,1.25)
        width=rng.uniform(.08,.16)
        angle=rng.uniform(0,math.tau)
        box(verts,faces,(center[0],center[1],GROUND_Z+.20),
            (length,width,width),angle)
    mesh_obj(col,"RWB_YardWoodDebris",verts,faces,(mats["wood"],))
    return {"yards":len(buildings),"approaches":len(buildings),"debris":34}


def crater(col,name,center,radius,mats,rng,heading):
    """Layered oval blast bowl with a broken earthen lip and granular ejecta."""
    n=32
    heading=math.radians(heading)
    disk=[(center[0],center[1],GROUND_Z+.105)]
    rim=[]
    for index in range(n):
        angle=math.tau*index/n+heading
        wobble=1+rng.uniform(-.14,.16)
        ca,sa=math.cos(angle),math.sin(angle)
        inner=(center[0]+ca*radius[0]*.48*wobble,
               center[1]+sa*radius[1]*.48*wobble,
               GROUND_Z+rng.uniform(.115,.145))
        crest=(center[0]+ca*radius[0]*.72*wobble,
               center[1]+sa*radius[1]*.72*wobble,
               GROUND_Z+rng.uniform(.22,.34))
        outer=(center[0]+ca*radius[0]*1.06*wobble,
               center[1]+sa*radius[1]*1.06*wobble,
               GROUND_Z+rng.uniform(.10,.15))
        disk.append(inner)
        rim.extend((inner,crest,outer))
    mesh_obj(col,name+"_Bowl",disk,
             [(0,index+1,(index+1)%n+1) for index in range(n)],
             (mats["crater"],),smooth=True)
    rotated_patch(col,name+"_DarkCore",center,(radius[0]*.68,radius[1]*.62),
                  math.degrees(heading),mats["crater_dark"],rng,
                  GROUND_Z+.132)
    rim_faces=[]
    rim_indices=[]
    for index in range(n):
        if index%11 in (3,4):
            continue
        current,next_index=index*3,((index+1)%n)*3
        rim_faces.extend(((current,next_index,next_index+1,current+1),
                          (current+1,next_index+1,next_index+2,current+2)))
        rim_indices.extend((0,1 if index%4 else 0))
    mesh_obj(col,name+"_BrokenLip",rim,rim_faces,
             (mats["crater"],mats["ejecta"]),rim_indices,smooth=True)
    ejecta_splats=0
    for index in range(12):
        direction=heading+rng.uniform(-1.15,1.15) if index<8 else rng.uniform(0,math.tau)
        distance=rng.uniform(radius[0]*.92,radius[0]*1.50)
        pos=(center[0]+math.cos(direction)*distance,
             center[1]+math.sin(direction)*distance*radius[1]/radius[0])
        if not inside_board(pos,.18):
            continue
        patch(col,name+"_EjectaPatch_%02d"%ejecta_splats,pos,
              rng.uniform(.14,.38),rng.uniform(.08,.22),
              mats["ejecta"] if index%3 else mats["crater"],rng,
              GROUND_Z+.128,10)
        ejecta_splats+=1
    clod_verts,clod_faces,clod_indices=[],[],[]
    for index in range(30):
        if index<20:
            direction=heading+rng.uniform(-.85,.85)
            distance=rng.uniform(radius[0]*.85,radius[0]*1.65)
        else:
            direction=rng.uniform(0,math.tau)
            distance=rng.uniform(radius[0]*.72,radius[0]*1.18)
        x=center[0]+math.cos(direction)*distance
        y=center[1]+math.sin(direction)*distance*radius[1]/radius[0]
        box(clod_verts,clod_faces,(x,y,GROUND_Z+rng.uniform(.16,.31)),
            (rng.uniform(.16,.48),rng.uniform(.12,.34),rng.uniform(.10,.28)),
            rng.uniform(0,math.tau))
        clod_indices.extend(([1] if index%5==0 else [0])*6)
    mesh_obj(col,name+"_EjectaClods",clod_verts,clod_faces,
             (mats["row"],mats["stone"]),clod_indices)
    ground_decal(col,name+"_PSGrain","crater_heavy",0,center,
                 .27*max(radius)/2.35,math.degrees(heading),.092)
    return {"rim_segments":len(rim_faces)//2,"ejecta_clods":30,
            "ejecta_splats":ejecta_splats,"dark_core":True,"ps_grain":True}


def camera_light(scene):
    camera=bpy.data.objects["RW_ReviewCamera"]
    camera.data.type="ORTHO"
    camera.data.ortho_scale=72
    target=Vector((35,35,1.5))
    horizontal=86
    elevation=math.radians(55)
    camera.location=(target.x,target.y-horizontal,
                     target.z+horizontal*math.tan(elevation))
    camera.rotation_euler=(target-camera.location).to_track_quat("-Z","Y").to_euler()
    camera.data.clip_start=.1
    camera.data.clip_end=500
    scene.camera=camera
    sun=bpy.data.objects["RW_ReviewSun"]
    sun.data.energy=2.8
    sun.data.use_shadow=False
    sun.data.angle=math.radians(16.0)
    sun.data.color=(1,.9,.75)
    sun.rotation_euler=(math.radians(38),math.radians(-18),math.radians(-32))
    data=bpy.data.lights.new("RWB_Fill","AREA")
    fill=bpy.data.objects.new("RWB_Fill",data)
    scene.collection.objects.link(fill)
    fill.location=(35,20,75)
    data.energy=2700
    data.shape="DISK"
    data.size=65
    data.color=(.63,.67,.55)


def render_settings(scene,output):
    try:
        scene.render.engine="BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine="BLENDER_EEVEE"
    scene.render.resolution_x=1600
    scene.render.resolution_y=1220
    scene.render.resolution_percentage=100
    scene.render.pixel_aspect_x=scene.render.pixel_aspect_y=1
    scene.render.image_settings.file_format="PNG"
    scene.render.image_settings.color_mode="RGB"
    scene.render.image_settings.color_depth="8"
    scene.render.image_settings.compression=15
    scene.render.filepath=str(output)
    scene.render.film_transparent=False
    try:
        scene.view_settings.view_transform="AgX"
        scene.view_settings.look="AgX - High Contrast"
    except Exception:
        pass
    scene.view_settings.exposure=.75
    world=bpy.data.worlds.get("RWB_World") or bpy.data.worlds.new("RWB_World")
    world.use_nodes=True
    bg=next((node for node in world.node_tree.nodes if node.type=="BACKGROUND"),None)
    if bg is None:
        bg=world.node_tree.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value=rgba((18,20,18))
    bg.inputs["Strength"].default_value=.78
    scene.world=world


def build_legacy():
    scene=bpy.data.scenes[SCENE]
    old=bpy.data.collections["REVIEW_WORLD"]
    ground=bpy.data.objects["RW_GroundContinuous"]
    for obj in list(old.objects):
        if obj != ground:
            bpy.data.objects.remove(obj,do_unlink=True)
    mats=materials(ground)
    col=clear_collection(scene,"REVIEW_WORLD_B")
    rng=random.Random(SEED)
    controls=[(-4,2),(7,8),(21,12),(34,22),(37,33),(29,43),
              (18,51),(21,62),(34,72),(51,77)]
    road=catmull(controls,9)
    ns=normals(road)
    for i in range(1,len(road)-1):
        off=math.sin(i*1.71)*.12+math.sin(i*.37)*.07
        road[i]=(road[i][0]+ns[i][0]*off,road[i][1]+ns[i][1]*off)
    shoulders=[2.8+.30*math.sin(i*.42)+.13*math.sin(i*1.31) for i in range(len(road))]
    cores=[1.68+.18*math.sin(i*.51)+.08*math.sin(i*1.73) for i in range(len(road))]
    strip(col,"RWB_RoadShoulder",road,shoulders,mats["shoulder"],GROUND_Z+.055)
    strip(col,"RWB_RoadCore",road,cores,mats["road"],GROUND_Z+.095)
    ruts=[.10+.02*math.sin(i*.9) for i in range(len(road))]
    strip(col,"RWB_RutL",road,ruts,mats["rut"],GROUND_Z+.122,-.56)
    strip(col,"RWB_RutR",road,ruts,mats["rut"],GROUND_Z+.124,.56)
    ns=normals(road)
    for i in range(7,len(road),7):
        if i%21==0:
            continue
        side=1 if i%2 else -1
        patch(col,"RWB_RoadWear_%03d"%i,
              (road[i][0]+ns[i][0]*shoulders[i]*side,
               road[i][1]+ns[i][1]*shoulders[i]*side),
              rng.uniform(.7,1.5),rng.uniform(.35,.8),mats["shoulder"],rng,GROUND_Z+.1,12)
    buildings=assets(scene)
    interfaces(col,buildings,road,mats,rng)
    field(col,"RWB_MainField",(57.5,49.5),(23,26),17,18,mats,rng)
    field(col,"RWB_Garden",(15,26),(14,11),-21,9,mats,rng)
    fence_segments=[
        ((8.5,44),(19.5,43.5)),((19.5,43.5),(21.5,51)),((9,55),(17,55.8)),
        ((17,55.8),(22,60)),((28.5,23),(39.5,21.5)),((39.5,21.5),(42.5,29.5)),
        ((34,38.5),(45,39.5)),((45,39.5),(47,47.5)),((45,35),(69,34)),
        ((69,34),(70.5,63)),((47,67),(69,65)),((8,20),(22,19)),((22,19),(23,32))]
    fences(col,fence_segments,mats["wood"],rng)
    grass(col,road,mats,rng)
    vocabulary=sprite_vocabulary(col,rng)
    crater(col,"RWB_RoadCrater",(29.8,42.8),(2.15,1.55),mats,rng,32)
    crater(col,"RWB_FieldCrater",(58.5,52),(2.35,1.72),mats,rng,-18)
    camera_light(scene)
    return scene,{
        "schema":"squad-tactics.review-scene-b-blender/v1",
        "logical_hex_count":30,"visible_hex_lines":0,"seed":SEED,
        "buildings_scale":1.0,"buildings":[name for name,_ in buildings],
        "road":{"control_points":len(controls),"sampled_points":len(road),
                "organic_variable_width":True,"rut_count":2},
        "fields":{"parcels":2,"raised_rows":27,"crop_stocks":True},
        "sprite_vocabulary":vocabulary,
        "terrain_interfaces":"yard+approach+fence+vegetation+life-props",
        "hidden_challenge_assets":["ROUND1_CAMP","ROUND1_FARMSTEAD_CLEAN"]}


def build():
    scene=bpy.data.scenes[SCENE]
    old=bpy.data.collections["REVIEW_WORLD"]
    source_ground=bpy.data.objects["RW_GroundContinuous"]
    for obj in list(old.objects):
        if obj != source_ground:
            bpy.data.objects.remove(obj,do_unlink=True)
    mats=materials(source_ground)
    col=clear_collection(scene,"REVIEW_WORLD_B")
    source_ground.hide_render=True
    ground=hex_board_ground(col,mats)
    rng=random.Random(SEED)
    controls=[T(p) for p in [(6,2),(9,8),(20,13),(32,22),(36,33),(29,43),
              (18,51),(21,61),(35,66),(51,68)]]
    road=catmull(controls,9)
    ns=normals(road)
    for i in range(1,len(road)-1):
        off=math.sin(i*1.71)*.14+math.sin(i*.37)*.08
        road[i]=(road[i][0]+ns[i][0]*off,road[i][1]+ns[i][1]*off)
    mottle_count=terrain_mottle(col,mats,rng)
    ps_ground_metrics={"enabled":False,"reason":"large decals broke terrain cohesion"}
    shoulders=[2.12+.24*math.sin(i*.42)+.10*math.sin(i*1.31) for i in range(len(road))]
    cores=[1.30+.14*math.sin(i*.51)+.06*math.sin(i*1.73) for i in range(len(road))]
    strip(col,"RWB_RoadShoulder",road,shoulders,mats["shoulder"],GROUND_Z+.055)
    strip(col,"RWB_RoadCore",road,cores,mats["road"],GROUND_Z+.095)
    _junction_target=T((29,43))
    junction=min(road,key=lambda point:math.hypot(
        point[0]-_junction_target[0],point[1]-_junction_target[1]))
    branch=catmull([junction,T((37,45.5)),T((46,48.5)),T((56,49.5))],8)
    branch_shoulders=[1.38+.14*math.sin(i*.61) for i in range(len(branch))]
    branch_cores=[.84+.09*math.sin(i*.47) for i in range(len(branch))]
    strip(col,"RWB_RoadBranchShoulder",branch,branch_shoulders,
          mats["shoulder"],GROUND_Z+.057)
    strip(col,"RWB_RoadBranchCore",branch,branch_cores,mats["road"],GROUND_Z+.097)
    road_ps_metrics=road_ps_vocabulary(col,(road,branch),rng)
    rut_segment_count=segmented_ruts(col,road,mats,rng)
    rut_segment_count+=segmented_ruts(col,branch,mats,rng,"RWB_BranchRut")
    road_edge_count=road_edge_scars(col,road,mats,rng)
    puddle_count=road_puddles(col,road,mats,rng)
    ns=normals(road)
    for i in range(7,len(road),7):
        if i%21==0:
            continue
        side=1 if i%2 else -1
        patch(col,"RWB_RoadWear_%03d"%i,
              (road[i][0]+ns[i][0]*shoulders[i]*side,
               road[i][1]+ns[i][1]*shoulders[i]*side),
              rng.uniform(.7,1.5),rng.uniform(.30,.72),
              mats["shoulder"],rng,GROUND_Z+.1,12)
    building_layout=build_building_layout()
    buildings=target_assets(scene,building_layout)
    building_finish_metrics=grade_target_building_materials()
    interface_metrics=target_interfaces(col,buildings,road+branch,mats,rng)
    cottage_center,cottage_angle=building_layout["cottage"]
    ruin_metrics=add_ruined_cottage(col,cottage_center,mats,rng,bearing=cottage_angle)
    contact_count=target_soft_contacts(col,mats,rng,building_layout)
    _field_hole_center=T((50.5,20.5))
    field_hole=((_field_hole_center[0],_field_hole_center[1],3.35,2.40),)
    north_field=target_field(col,"RWB_MainFieldNorth",T((51.2,26.2)),(25.5,10.5),13,7,
                             mats,rng,field_hole)
    south_field=target_field(col,"RWB_MainFieldSouth",T((51.3,13.8)),(23.5,10.5),-5,7,
                             mats,rng,field_hole)
    garden_field=target_field(col,"RWB_Garden",T((57,47)),(15,11),-8,8,mats,rng)
    # v26_fence_segments feeds consume_v26_fence_random_stream() only, to keep
    # the shared rng stream byte-for-byte compatible with the v26 fence pass.
    # It is NOT real geometry and must NEVER be run through T()/T_angle().
    v26_fence_segments=(
        ((39.5,5.5),(52.5,8.4)),((54,8.8),(66.6,11.5)),
        ((66.6,11.5),(63.6,24.5)),((63.2,26),(60.5,38.7)),
        ((60.5,38.7),(47.5,35.7)),((46,35.4),(33.3,32.5)),
        ((33.3,32.5),(36.3,19.5)),((36.7,18),(39.5,5.5)),
        ((48.8,42.6),(55,41.7)),((56.2,41.5),(63.7,40.5)),
        ((63.7,40.5),(65.2,51.4)),((65.2,51.4),(57.8,52.5)),
        ((56.4,52.7),(50.3,53.5)),((50.3,53.5),(48.8,42.6)),
        ((44.5,48),(44.5,60)),((44.5,60),(60.5,62.5)),
        ((60.5,62.5),(65,55)),((31.5,48),(42.5,47)),
        ((12,35.5),(24,35)),((24,35),(25,46)),
        ((11.5,47),(11.5,38.5)))
    fence_segments=tuple((T(a),T(b)) for a,b in (
        ((38.50,9.83),(52.50,8.61)),((54.00,8.48),(64.50,7.56)),
        ((64.50,7.56),(65.59,20.02)),((63.2,26),(60.5,38.7)),
        ((60.5,38.7),(47.5,35.7)),((46.00,35.40),(39.20,33.85)),
        ((35.72,22.01),(36.30,19.50)),((39.39,20.00),(38.50,9.83)),
        ((48.8,42.6),(55,41.7)),((56.2,41.5),(63.7,40.5)),
        ((63.7,40.5),(65.2,51.4)),((65.2,51.4),(57.8,52.5)),
        ((56.4,52.7),(50.3,53.5)),
        ((50.30,53.50),(50.00,51.30)),((49.35,46.60),(48.80,42.60)),
        ((44.50,50.60),(44.50,60.00)),((44.5,60),(60.5,62.5)),
        ((60.5,62.5),(65,55)),((31.50,48.00),(36.30,47.56))))
    fence_rng=random.Random()
    fence_rng.setstate(rng.getstate())
    fences(col,fence_segments,mats["wood"],fence_rng)
    consume_v26_fence_random_stream(rng,v26_fence_segments)
    ruin_fence_metrics,ruin_fence_segments,ruin_damage_segments=damaged_ruin_fences(col,mats)
    ruin_clearance_segments=ruin_fence_segments+ruin_damage_segments
    clearance_segments=fence_segments+ruin_clearance_segments
    ruin_fence_metrics["min_main_effective_clearance_m"]=round(min(
        fence_effective_clearance(segment,road,shoulders)
        for segment in ruin_clearance_segments),3)
    ruin_fence_metrics["min_branch_effective_clearance_m"]=round(min(
        fence_effective_clearance(segment,branch,branch_shoulders)
        for segment in ruin_clearance_segments),3)
    fence_metrics={
        "segments":len(fence_segments)+len(ruin_fence_segments),
        "field_and_compound_segments":len(fence_segments),
        "ruin_survivor_segments":len(ruin_fence_segments),
        "ruin_damage_members":len(ruin_damage_segments),
        "ruin_damage":ruin_fence_metrics,
        "field_row_bearings_deg":{"north":13,"south":-5,"garden":-8},
        "south_field_reoriented":True,
        "road_side_openings":4,
        "min_main_effective_clearance_m":round(min(
            fence_effective_clearance(segment,road,shoulders)
            for segment in clearance_segments),3),
        "min_branch_effective_clearance_m":round(min(
            fence_effective_clearance(segment,branch,branch_shoulders)
            for segment in clearance_segments),3)}
    grass(col,(road,branch),mats,rng,count=1250)
    stone_scatter(col,mats,rng,320)
    vocabulary=target_vocabulary(col,rng,(road,branch),buildings,mats)
    vocabulary["pastoral_cluster_sprites"]=pastoral_clusters(col,rng)
    road_crater_metrics=crater(col,"RWB_RoadCrater",road[43],(2.50,1.80),mats,rng,32)
    field_crater_metrics=crater(col,"RWB_FieldCrater",_field_hole_center,(2.85,2.05),mats,rng,-18)
    camera_light(scene)
    return scene,{
        "schema":"squad-tactics.review-scene-b-blender/v3",
        "logical_hex_count":30,"visible_hex_lines":0,"seed":SEED,
        "approved_target":"AI Panzer-Strike rural remaster direction",
        "buildings_scale":1.0,"buildings":[name for name,_ in buildings],
        "building_finish":building_finish_metrics,
        "ruined_cottage":ruin_metrics,
        "soft_contact_patches":contact_count,
        "road":{"control_points":len(controls),"sampled_points":len(road),
                "branch_points":len(branch),"organic_variable_width":True,
                "rut_segments":rut_segment_count,"edge_scars":road_edge_count,
                "puddles":puddle_count,"ps_grain":road_ps_metrics},
        "fields":{"parcels":3,"north":north_field,"south":south_field,
                  "garden":garden_field},
        "fences":fence_metrics,
        "craters":{"road":road_crater_metrics,"field":field_crater_metrics},
        "terrain":{"mottle_patches":mottle_count,"stone_scatter":320,
                   "grass_clumps":1250,"ps_ground":ps_ground_metrics},
        "vocabulary":vocabulary,
        "interfaces":interface_metrics,
        "terrain_interfaces":"yard+approach+fence+vegetation+life-props",
        "hidden_challenge_assets":["ROUND1_CAMP","towered_farmstead_full_recipe"]}


LOCATION_SPECS={
 "loc_crossroad":{
  "roads":[
    {"controls":[(30,2),(32,12),(34,24),(33,36),(31,48),(33,60),(36,66)],"main":True},
    {"controls":[(7.5,39.5),(14,37),(24,36.5),(33,36),(44,34),(56,31),(62,29.5)],"main":False},
  ],
  "buildings":[("farmstead",(44,46),5),("barn",(24,45),-80)],
  "ruins":[],
  "fields":[("FieldEast",(50,21),(17,10),-4,7,()),
            ("Garden",(46,57),(13,9),8,8,())],
  "fences":"auto",
  "craters":[{"road":0,"near":(32,28),"size":(2.5,1.8),"angle":30},
             {"pos":(52,18),"size":(2.6,2.0),"angle":-15}],
  "tree_seed":61027,"dressing_seed":61127,
 },
 "loc_forest_farm":{
  "roads":[{"controls":[(7.5,60.5),(12,58),(18,50),(22,40),(24,30),(22,20),(16,12),(7,3.5)],"main":True}],
  "buildings":[("cottage",(36,44),10),("barn",(48,52),-12)],
  "ruins":[],
  "fields":[("BigField",(47,23),(22,13),3,9,()),
            ("Garden",(30,55),(12,8),-6,8,())],
  "fences":"auto",
  "craters":[{"pos":(38,16),"size":(2.4,1.9),"angle":10}],
  "tree_seed":62027,"dressing_seed":62127,"tree_density":1.35,
 },
 "loc_shelled":{
  "roads":[{"controls":[(3,7),(16,16),(26,24),(36,32),(46,40),(56,48),(64,58)],"main":True},
           {"controls":[(36,32),(30,42),(26,52),(24,68)],"main":False}],
  "buildings":[("farmstead",(54,58),-30)],
  "ruins":[((46,26),25,71001),((28,44),-60,71002)],
  "fields":[("FieldWest",(18,34),(18,11),12,6,((18,34,3.0,2.2),)),
            ("FieldSE",(52,12),(14,9),-8,6,())],
  "fences":"auto_damaged",
  "craters":[{"road":0,"near":(26,24),"size":(2.5,1.8),"angle":20},
             {"road":0,"near":(46,40),"size":(2.3,1.7),"angle":-40},
             {"pos":(18,34),"size":(2.9,2.1),"angle":-18}],
  "tree_seed":63027,"dressing_seed":63127,
 },
}

LOCATION_ASSET_MAP={
    "farmstead":("ROUND1_FARMSTEAD_CLEAN","RW_ASSET_FARMSTEAD_CURATED_CLEAN"),
    "barn":("ROUND1_BARN","RW_ASSET_BARN_CURATED"),
    "cottage":("ROUND1_COTTAGE","RW_ASSET_COTTAGE_BEAUTY"),
}


def _validate_location_spec(spec):
    """Hard self-checks on the supervisor-authored spec; raise (don't silently fix)."""
    margin=1.0
    for asset_name,center,_angle in spec["buildings"]:
        if not inside_board(center,margin):
            raise AssertionError("building %s outside board (margin %.1f): %s"%(
                asset_name,margin,center))
    for center,_bearing,_seed in spec["ruins"]:
        if not inside_board(center,margin):
            raise AssertionError("ruin outside board (margin %.1f): %s"%(margin,center))
    for name,center,size,bearing,_rows,_holes in spec["fields"]:
        angle=math.radians(bearing)
        ux,uy=(math.cos(angle),math.sin(angle)),(-math.sin(angle),math.cos(angle))
        hx,hy=size[0]/2,size[1]/2
        for sx,sy in ((-hx,-hy),(hx,-hy),(hx,hy),(-hx,hy)):
            corner=(center[0]+ux[0]*sx+uy[0]*sy,center[1]+ux[1]*sx+uy[1]*sy)
            if not inside_board(corner,margin):
                raise AssertionError("field %s corner outside board: %s"%(name,corner))
    centers=[center for _,center,_ in spec["buildings"]]
    for i in range(len(centers)):
        for j in range(i+1,len(centers)):
            distance=math.hypot(centers[i][0]-centers[j][0],centers[i][1]-centers[j][1])
            if distance<=9.0:
                raise AssertionError("buildings %d/%d too close: %.2fm"%(i,j,distance))
    for ruin_center,_bearing,_seed in spec["ruins"]:
        for building_center in centers:
            distance=math.hypot(ruin_center[0]-building_center[0],
                                 ruin_center[1]-building_center[1])
            if distance<=8.0:
                raise AssertionError("ruin/building too close: %.2fm"%distance)
    for name,fcenter,size,bearing,_rows,_holes in spec["fields"]:
        angle=math.radians(bearing)
        ux,uy=(math.cos(angle),math.sin(angle)),(-math.sin(angle),math.cos(angle))
        hx,hy=size[0]/2,size[1]/2
        for building_name,building_center,_angle in spec["buildings"]:
            dx,dy=building_center[0]-fcenter[0],building_center[1]-fcenter[1]
            local_x=dx*ux[0]+dy*ux[1]
            local_y=dx*uy[0]+dy*uy[1]
            if abs(local_x)<hx and abs(local_y)<hy:
                raise AssertionError("building %s overlaps field %s"%(building_name,name))
    for road_spec in spec["roads"]:
        points=catmull(road_spec["controls"],9)
        for point in (points[0],points[-1]):
            if not (inside_board(point,0.0) and not inside_board(point,3.0)):
                raise AssertionError("road endpoint not within 3m of board edge: %s"%(point,))


def _offset_rect_corners(center,size,bearing,offset):
    angle=math.radians(bearing)
    ux,uy=(math.cos(angle),math.sin(angle)),(-math.sin(angle),math.cos(angle))
    hx,hy=size[0]/2+offset,size[1]/2+offset
    local=((-hx,-hy),(hx,-hy),(hx,hy),(-hx,hy))
    return [(center[0]+ux[0]*x+uy[0]*y,center[1]+ux[1]*x+uy[1]*y) for x,y in local]


def _damaged_fence_side(a,b,rng):
    """Split one fence side into surviving rails plus a random breach gap."""
    gap_len=rng.uniform(.30,.50)
    gap_start=rng.uniform(.20,max(.20,1.0-gap_len-.20))
    gap_end=gap_start+gap_len
    def lerp(t):
        return (a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)
    survivors=[]
    if gap_start>.05:
        survivors.append((a,lerp(gap_start)))
    if gap_end<.95:
        survivors.append((lerp(gap_end),b))
    return survivors,[lerp(gap_start),lerp(gap_end)]


def _leaning_fence_post(col,name,point,mats,rng):
    height=rng.uniform(1.1,1.5)
    lean_angle=rng.uniform(0,math.tau)
    lean_dist=height*rng.uniform(.28,.45)
    base=(point[0],point[1],GROUND_Z)
    top=(point[0]+math.cos(lean_angle)*lean_dist,
         point[1]+math.sin(lean_angle)*lean_dist,
         GROUND_Z+height*rng.uniform(.55,.75))
    curve_ridge(col,name,(base,top),.075,mats["wood"])


def _loc_road_ps_vocabulary(col,paths,rng):
    """Restrained PS road-surface stamping for procedural locations (no fork decal)."""
    surfaces=0
    for path_index,path in enumerate(paths):
        ns=normals(path)
        step=10 if path_index==0 else 7
        for index in range(6,len(path)-5,step):
            before,after=path[index-1],path[index+1]
            bearing=math.degrees(math.atan2(after[1]-before[1],after[0]-before[0]))
            pos=(path[index][0]+ns[index][0]*rng.uniform(-.20,.20),
                 path[index][1]+ns[index][1]*rng.uniform(-.20,.20))
            ground_decal(col,"RWB_LocPSRoad_%d_%02d"%(path_index,surfaces),
                         "road_straight",0,pos,rng.uniform(.21,.25),bearing,
                         GROUND_Z+.108,.16)
            surfaces+=1
    return {"surface_stamps":surfaces}


def build_location_scene(spec,seed_offset=0):
    """Generic spec-driven builder for a fresh road/building/field/ruin layout.

    Reuses the same visual vocabulary (roads, fields, fences, craters, trees,
    understory, life props, terrain) as build(), but with a road network,
    building placement, fields, ruins, and craters read from `spec` instead
    of the frozen v29 literals. Never touches build()/build_legacy()."""
    global SEED
    _validate_location_spec(spec)
    scene=bpy.data.scenes[SCENE]
    old=bpy.data.collections["REVIEW_WORLD"]
    source_ground=bpy.data.objects["RW_GroundContinuous"]
    for obj in list(old.objects):
        if obj != source_ground:
            bpy.data.objects.remove(obj,do_unlink=True)
    mats=materials(source_ground)
    col=clear_collection(scene,"REVIEW_WORLD_B")
    source_ground.hide_render=True
    hex_board_ground(col,mats)

    tree_seed=spec["tree_seed"]+seed_offset
    dressing_seed=spec["dressing_seed"]+seed_offset
    rng=random.Random(dressing_seed)

    camp=bpy.data.collections.get("ROUND1_CAMP")
    if camp:
        for obj in camp.objects:
            obj.hide_render=True
    used_assets={asset_name for asset_name,_,_ in spec["buildings"]}
    for asset_name,(collection_name,_root_name) in LOCATION_ASSET_MAP.items():
        collection=bpy.data.collections[collection_name]
        hide=asset_name not in used_assets
        for obj in collection.objects:
            obj.hide_render=hide
    for asset_name,center,angle in spec["buildings"]:
        collection_name,root_name=LOCATION_ASSET_MAP[asset_name]
        collection=bpy.data.collections[collection_name]
        place_collection_center(bpy.data.objects[root_name],collection,center,angle)

    road_paths=[catmull(road_spec["controls"],9) for road_spec in spec["roads"]]
    for index,(road_spec,points) in enumerate(zip(spec["roads"],road_paths)):
        is_main=bool(road_spec.get("main"))
        if is_main:
            shoulders=[2.12+.24*math.sin(i*.42)+.10*math.sin(i*1.31) for i in range(len(points))]
            cores=[1.30+.14*math.sin(i*.51)+.06*math.sin(i*1.73) for i in range(len(points))]
        else:
            shoulders=[1.30+.14*math.sin(i*.42) for i in range(len(points))]
            cores=[.80+.08*math.sin(i*.51) for i in range(len(points))]
        strip(col,"RWB_LocRoadShoulder_%d"%index,points,shoulders,mats["shoulder"],GROUND_Z+.055)
        strip(col,"RWB_LocRoadCore_%d"%index,points,cores,mats["road"],GROUND_Z+.095)
        if is_main:
            segmented_ruts(col,points,mats,rng,"RWB_LocRut_%d"%index)
            road_edge_scars(col,points,mats,rng)
            road_puddles(col,points,mats,rng)
    road_ps_metrics=_loc_road_ps_vocabulary(col,road_paths,rng)

    field_metrics={}
    field_rects=[]
    for name,center,size,bearing,rows,holes in spec["fields"]:
        field_metrics[name]=target_field(col,"RWB_Loc_%s"%name,center,size,bearing,
                                          rows,mats,rng,holes)
        angle=math.radians(bearing)
        ux,uy=(math.cos(angle),math.sin(angle)),(-math.sin(angle),math.cos(angle))
        field_rects.append((center,ux,uy,size[0]/2+1.0,size[1]/2+1.0))

    def in_any_field_rect(pos):
        for center,ux,uy,hx,hy in field_rects:
            dx,dy=pos[0]-center[0],pos[1]-center[1]
            local_x,local_y=dx*ux[0]+dy*ux[1],dx*uy[0]+dy*uy[1]
            if abs(local_x)<hx and abs(local_y)<hy:
                return True
        return False

    fence_mode=spec.get("fences","auto")
    fence_segments=[]
    leaning_posts=0
    if fence_mode in ("auto","auto_damaged"):
        for name,center,size,bearing,_rows,_holes in spec["fields"]:
            corners=_offset_rect_corners(center,size,bearing,1.6)
            for side in range(4):
                a,b=corners[side],corners[(side+1)%4]
                mid=((a[0]+b[0])/2,(a[1]+b[1])/2)
                if (path_network_distance(mid,road_paths)<3.2
                        or path_network_distance(a,road_paths)<3.2
                        or path_network_distance(b,road_paths)<3.2):
                    continue
                if fence_mode=="auto_damaged":
                    survivors,gap_points=_damaged_fence_side(a,b,rng)
                    fence_segments.extend(survivors)
                    for gap_point in gap_points:
                        _leaning_fence_post(col,"RWB_LocLeaningPost_%03d"%leaning_posts,
                                             gap_point,mats,rng)
                        leaning_posts+=1
                else:
                    fence_segments.append((a,b))
    if fence_segments:
        fences(col,fence_segments,mats["wood"],rng)

    crater_metrics=[]
    for index,crater_spec in enumerate(spec["craters"]):
        if "road" in crater_spec:
            road_points=road_paths[crater_spec["road"]]
            near_point=crater_spec["near"]
            center=min(road_points,key=lambda p:math.hypot(
                p[0]-near_point[0],p[1]-near_point[1]))
        else:
            center=crater_spec["pos"]
        crater_metrics.append(crater(col,"RWB_LocCrater_%02d"%index,center,
                                      crater_spec["size"],mats,rng,crater_spec["angle"]))

    ruin_metrics=[]
    saved_seed=SEED
    for index,(center,bearing,seed) in enumerate(spec["ruins"]):
        SEED=seed
        try:
            compat_rng=random.Random(seed)
            ruin_metrics.append(add_ruined_cottage(col,center,mats,compat_rng,bearing=bearing))
        finally:
            SEED=saved_seed

    tree_species=["tree_oak","tree_linden","tree_willow","tree_poplar",
                  "tree_robinia","tree_fir","tree_spruce","tree_blossom"]
    tree_scales=[.56,.66,.52,.50,.60,.74,.76,.70]
    tree_rng=random.Random(tree_seed)
    target_tree_count=max(1,round(52*spec.get("tree_density",1.0)))
    accepted_trees=[]
    attempts=0
    max_attempts=target_tree_count*80
    while len(accepted_trees)<target_tree_count and attempts<max_attempts:
        attempts+=1
        edge_biased=tree_rng.random()<0.70
        candidate=(tree_rng.uniform(3,67),tree_rng.uniform(.5,75))
        if not inside_board(candidate,0.8):
            continue
        if edge_biased and inside_board(candidate,9.0):
            continue
        if path_network_distance(candidate,road_paths)<3.5:
            continue
        if any(math.hypot(candidate[0]-bc[0],candidate[1]-bc[1])<7.0
               for _,bc,_ in spec["buildings"]):
            continue
        if any(math.hypot(candidate[0]-rc[0],candidate[1]-rc[1])<6.0
               for rc,_,_ in spec["ruins"]):
            continue
        if in_any_field_rect(candidate):
            continue
        if any(math.hypot(candidate[0]-ex[0],candidate[1]-ex[1])<4.5
               for ex in accepted_trees):
            continue
        accepted_trees.append(candidate)
    for index,pos in enumerate(accepted_trees):
        _wood,crown=build_target_tree(col,"RWB_LocTree_%02d"%index,pos,index%5,mats,
                                       tree_seed+700+index*37)
        crown.hide_render=True
        billboard(col,"RWB_LocCanopy_%02d"%index,tree_species[index%len(tree_species)],
                  2,pos,tree_scales[index%len(tree_scales)])

    shrubs=[("bush_big",2),("bush_medium",0),("bush_medium",1),("bush_small",0),
            ("flower_phlox",0),("flower_phlox",1),("flower_primula",0),("fern",2)]
    understory_rng=random.Random(dressing_seed+101)
    accepted_understory=0
    attempts=0
    target_understory=80
    while accepted_understory<target_understory and attempts<target_understory*30:
        attempts+=1
        pos=(understory_rng.uniform(3,67),understory_rng.uniform(.5,75))
        if not inside_board(pos,.5):
            continue
        if path_network_distance(pos,road_paths)<2.0:
            continue
        if in_any_field_rect(pos):
            continue
        if any(math.hypot(pos[0]-bc[0],pos[1]-bc[1])<4.6 for _,bc,_ in spec["buildings"]):
            continue
        item,slot=shrubs[accepted_understory%len(shrubs)]
        billboard(col,"RWB_LocUnderstory_%03d"%accepted_understory,item,slot,pos,
                  understory_rng.uniform(.42,.68))
        accepted_understory+=1

    life_items=[("washing",2),("well",2),("woodpile",2),("cart",2),
                ("compose_farm_a",1),("compose_farm_b",2),("barrel",2),
                ("bench",2),("barrel",1),("woodpile",1)]
    life_rng=random.Random(dressing_seed+202)
    all_road_points=[point for path in road_paths for point in path]
    life_count=0
    for building_index,(asset_name,center,angle) in enumerate(spec["buildings"]):
        near_point=min(all_road_points,key=lambda p:math.hypot(
            p[0]-center[0],p[1]-center[1]))
        dx,dy=near_point[0]-center[0],near_point[1]-center[1]
        length=max(1e-6,math.hypot(dx,dy))
        direction=(dx/length,dy/length)
        perpendicular=(-direction[1],direction[0])
        item_count=life_rng.randint(3,5)
        for member in range(item_count):
            item,slot=life_items[(building_index*5+member)%len(life_items)]
            distance=life_rng.uniform(3.0,6.0)
            lateral=life_rng.uniform(-2.0,2.0)
            pos=(center[0]+direction[0]*distance+perpendicular[0]*lateral,
                 center[1]+direction[1]*distance+perpendicular[1]*lateral)
            try:
                billboard(col,"RWB_LocLife_%03d"%life_count,item,slot,pos,.75)
            except FileNotFoundError:
                continue
            life_count+=1

    mottle_count=terrain_mottle(col,mats,rng)
    grass(col,tuple(road_paths),mats,rng,count=1250)
    stone_scatter(col,mats,rng,320)
    camera_light(scene)

    return scene,{
        "schema":"squad-tactics.review-scene-loc/v1",
        "variant":VARIANT,"seed":SEED,
        "roads":len(spec["roads"]),
        "buildings":[name for name,_,_ in spec["buildings"]],
        "ruins":len(spec["ruins"]),
        "fields":[name for name,_,_,_,_,_ in spec["fields"]],
        "trees":len(accepted_trees),
        "craters":len(spec["craters"]),
        "understory":accepted_understory,
        "life_props":life_count,
        "fences":{"segments":len(fence_segments),"leaning_posts":leaning_posts,
                  "mode":fence_mode},
        "terrain":{"mottle_patches":mottle_count,"grass_clumps":1250,"stone_scatter":320},
        "road_ps_vocabulary":road_ps_metrics,
        "field_metrics":field_metrics,
        "crater_metrics":crater_metrics,
        "ruin_metrics":ruin_metrics,
    }


def main(argv=None):
    global SEED,VARIANT,SWAP_BUILDINGS
    argv=sys.argv[sys.argv.index("--")+1:] if argv is None and "--" in sys.argv else (argv or [])
    parser=argparse.ArgumentParser()
    parser.add_argument("--render",type=Path,default=DEFAULT_RENDER)
    parser.add_argument("--save-blend",type=Path,default=DEFAULT_BLEND)
    parser.add_argument("--seed",type=int,default=SEED)
    parser.add_argument("--variant",choices=["v29","rot180"]+list(LOCATION_SPECS.keys()),
                        default="v29")
    parser.add_argument("--swap-buildings",action="store_true")
    args=parser.parse_args(argv)
    SEED=args.seed
    VARIANT=args.variant
    SWAP_BUILDINGS=args.swap_buildings
    if VARIANT in LOCATION_SPECS:
        scene,metrics=build_location_scene(LOCATION_SPECS[VARIANT],seed_offset=SEED-41027)
    else:
        scene,metrics=build()
    render_path=args.render.resolve()
    blend_path=args.save_blend.resolve()
    render_path.parent.mkdir(parents=True,exist_ok=True)
    render_settings(scene,render_path)
    scene["review_scene_b_metrics"]=json.dumps(metrics,sort_keys=True,separators=(",",":"))
    bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.render.render(write_still=True,scene=scene.name)
    render_path.with_suffix(".metrics.json").write_text(
        json.dumps(metrics,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("REVIEW_SCENE_B_BLENDER OK render=%s blend=%s"%(render_path,blend_path))
    return 0


if __name__=="__main__":
    raise SystemExit(main())
