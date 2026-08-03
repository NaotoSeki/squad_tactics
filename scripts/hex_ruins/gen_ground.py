# -*- coding: utf-8 -*-
# HexKit ground tiles: cobblestone / dirt hex bases, crater variants,
# and transparent rubble-field overlays. Requires rig_setup + gen_building run
# (materials use the same ph_mat pipeline — duplicated here to stay standalone).
import bpy
import bmesh
import json
import math
import os
import random
from mathutils import Vector, Euler, noise

scn = bpy.data.scenes["HexKit"]
CFG = json.loads(scn["hexkit_cfg"])
R = CFG["hex_R"]


def ph_images(asset_id):
    out = {}
    for img in bpy.data.images:
        p = img.name.lower()
        if asset_id not in p:
            continue
        if not img.packed_file:
            try:
                img.pack()
            except Exception:
                pass
        if "diff" in p or "color" in p:
            out["diff"] = img
        elif "rough" in p and "ao" not in p:
            out["rough"] = img
        elif "disp" in p or "height" in p:
            out["disp"] = img
        elif "_ao" in p:
            out["ao"] = img
    return out


def box_tex(nd, lk, img, mo, cs):
    tex = nd.new("ShaderNodeTexImage")
    tex.image = img
    tex.projection = 'BOX'
    tex.projection_blend = 0.3
    try:
        tex.image.colorspace_settings.name = cs
    except Exception:
        pass
    lk.new(mo, tex.inputs["Vector"])
    return tex


def ph_mat(name, asset_id, scale=0.3, offset=(0, 0, 0), tint=(1, 1, 1, 1),
           tint_fac=0.0, bump=0.4, grime=0.0):
    imgs = ph_images(asset_id)
    mat = bpy.data.materials.get(name)
    if mat:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nd, lk = mat.node_tree.nodes, mat.node_tree.links
    nd.clear()
    out = nd.new("ShaderNodeOutputMaterial")
    bsdf = nd.new("ShaderNodeBsdfPrincipled")
    lk.new(bsdf.outputs[0], out.inputs[0])
    coord = nd.new("ShaderNodeTexCoord")
    mapping = nd.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    mapping.inputs["Location"].default_value = offset
    lk.new(coord.outputs["Object"], mapping.inputs["Vector"])
    mo = mapping.outputs["Vector"]
    if "diff" in imgs:
        t = box_tex(nd, lk, imgs["diff"], mo, "sRGB")
        mix = nd.new("ShaderNodeMix")
        mix.data_type = 'RGBA'
        mix.inputs["Factor"].default_value = tint_fac
        lk.new(t.outputs["Color"], mix.inputs["A"])
        mix.inputs["B"].default_value = tint
        col_out = mix.outputs["Result"]
        if "ao" in imgs:
            ao = box_tex(nd, lk, imgs["ao"], mo, "Non-Color")
            m2 = nd.new("ShaderNodeMix")
            m2.data_type = 'RGBA'
            m2.blend_type = 'MULTIPLY'
            m2.inputs["Factor"].default_value = 0.6
            lk.new(col_out, m2.inputs["A"])
            lk.new(ao.outputs["Color"], m2.inputs["B"])
            col_out = m2.outputs["Result"]
        if grime > 0:
            gn = nd.new("ShaderNodeTexNoise")
            gn.inputs["Scale"].default_value = 0.3
            gn.inputs["Detail"].default_value = 4.0
            lk.new(coord.outputs["Object"], gn.inputs["Vector"])
            mr = nd.new("ShaderNodeMapRange")
            mr.inputs["To Min"].default_value = 1.0 - grime
            mr.inputs["To Max"].default_value = 1.05
            lk.new(gn.outputs["Fac"], mr.inputs["Value"])
            gm = nd.new("ShaderNodeMix")
            gm.data_type = 'RGBA'
            gm.blend_type = 'MULTIPLY'
            gm.inputs["Factor"].default_value = 1.0
            lk.new(col_out, gm.inputs["A"])
            lk.new(mr.outputs["Result"], gm.inputs["B"])
            col_out = gm.outputs["Result"]
        lk.new(col_out, bsdf.inputs["Base Color"])
    if "rough" in imgs:
        t = box_tex(nd, lk, imgs["rough"], mo, "Non-Color")
        lk.new(t.outputs["Color"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = 0.95
    if "disp" in imgs:
        t = box_tex(nd, lk, imgs["disp"], mo, "Non-Color")
        bmp = nd.new("ShaderNodeBump")
        bmp.inputs["Strength"].default_value = bump
        lk.new(t.outputs["Color"], bmp.inputs["Height"])
        lk.new(bmp.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def new_obj(name, col):
    mesh = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, mesh)
    col.objects.link(ob)
    return ob


def get_kit_col(name):
    kit = bpy.data.collections["KIT"]
    col = bpy.data.collections.get(name)
    if col:
        for ob in list(col.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
    else:
        col = bpy.data.collections.new(name)
        kit.children.link(col)
    return col


def hex_grid_mesh(ob, rad, subdiv, z=0.0):
    """Triangulated hexagon disc with interior verts for displacement."""
    bm = bmesh.new()
    corners = [Vector((rad * math.cos(math.radians(90 + 60 * i)),
                       rad * math.sin(math.radians(90 + 60 * i)), z)) for i in range(6)]
    vc = bm.verts.new(Vector((0, 0, z)))
    vs = [bm.verts.new(c) for c in corners]
    for i in range(6):
        bm.faces.new((vc, vs[i], vs[(i + 1) % 6]))
    for _ in range(subdiv):
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1,
                                  use_grid_fill=True)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()


def build_ground(kind, variant, col):
    """kind: cobble / dirt / crater_cobble"""
    rng = random.Random(hash(kind) % 9999 + variant * 7)
    ob = new_obj(f"gnd_{kind}_{variant}", col)
    hex_grid_mesh(ob, R + 0.4, 6)   # slight overhang to kill seam slivers
    me = ob.data
    ph = rng.uniform(0, 50)
    # gentle undulation + crater bowl
    crater = kind.startswith("crater")
    # v0/v1 は既存タイル再現のため乱数消費順を変えない。v2+ は「中央の模様」化を
    # 避けるためオフセットを広げ、半径は縁土手がタイル外へ出ない範囲に絞る
    if crater and variant >= 2:
        off_r = rng.uniform(1.5, 3.4)
        off_a = rng.uniform(0, 6.283)
        cx, cy = math.cos(off_a) * off_r, math.sin(off_a) * off_r
        crad = rng.uniform(2.4, min(4.4, R * math.sqrt(3) / 2 - 1.4 - off_r))
    else:
        cx, cy = (rng.uniform(-2, 2), rng.uniform(-2, 2)) if crater else (0, 0)
        crad = rng.uniform(3.2, 4.6)
    inrad = R * math.sqrt(3) / 2
    for v in me.vertices:
        p = v.co
        # undulation calms at the rim so neighbouring tiles meet flush
        edge_min = min(inrad - (p.x * math.cos(math.radians(60 * k))
                                + p.y * math.sin(math.radians(60 * k)))
                       for k in range(6))
        rim = max(0.0, min(1.0, edge_min / 1.4))
        rim = rim * rim * (3 - 2 * rim)
        h = 0.10 * noise.noise(Vector((p.x * 0.25 + ph, p.y * 0.25, 0))) * rim
        h += 0.05 * noise.noise(Vector((p.x * 0.9 + ph, p.y * 0.9, 3))) * rim
        if crater:
            dd = math.hypot(p.x - cx, p.y - cy)
            if dd < crad:
                t = dd / crad
                h += -1.5 * (1 - t * t) ** 1.5          # bowl
            elif dd < crad + 1.2:
                h += 0.42 * (1 - (dd - crad) / 1.2)     # rim lip
        v.co.z += h
    for poly in me.polygons:
        poly.use_smooth = True
    # cobble stones ~0.2m so buildings read at correct scale next to them
    asset = {"cobble": "cobblestone_floor_01", "street": "road_damaged",
             "crater_cobble": "cobblestone_floor_01"}[kind]
    if kind == "street":
        mat = ph_mat(f"MG_{kind}_{variant}", asset, scale=0.22,
                     offset=(rng.uniform(0, 7), rng.uniform(0, 7), 0),
                     tint=(0.42, 0.41, 0.4, 1), tint_fac=0.25, bump=0.6, grime=0.5)
    else:
        mat = ph_mat(f"MG_{kind}_{variant}", asset, scale=0.35,
                     offset=(rng.uniform(0, 7), rng.uniform(0, 7), 0),
                     tint=(0.5, 0.49, 0.47, 1), tint_fac=0.25, bump=0.7, grime=0.5)
    me.materials.append(mat)
    if crater:
        # scorch: darken diffuse near crater via extra node tweak
        nt = mat.node_tree
        bsdf = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
        src = bsdf.inputs["Base Color"].links[0].from_socket
        grad = nt.nodes.new("ShaderNodeTexGradient")
        grad.gradient_type = 'SPHERICAL'
        mapg = nt.nodes.new("ShaderNodeMapping")
        mapg.inputs["Location"].default_value = (-cx / (crad * 1.6), -cy / (crad * 1.6), 0)
        mapg.inputs["Scale"].default_value = (1 / (crad * 1.6),) * 3
        coord = [n for n in nt.nodes if n.type == 'TEX_COORD'][0]
        nt.links.new(coord.outputs["Object"], mapg.inputs["Vector"])
        nt.links.new(mapg.outputs["Vector"], grad.inputs["Vector"])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["To Min"].default_value = 1.0
        mr.inputs["To Max"].default_value = 0.12   # center dark
        nt.links.new(grad.outputs["Fac"], mr.inputs["Value"])
        dk = nt.nodes.new("ShaderNodeMix")
        dk.data_type = 'RGBA'
        dk.blend_type = 'MULTIPLY'
        dk.inputs["Factor"].default_value = 1.0
        nt.links.new(src, dk.inputs["A"])
        nt.links.new(mr.outputs["Result"], dk.inputs["B"])
        nt.links.new(dk.outputs["Result"], bsdf.inputs["Base Color"])
        # debris ring on the rim
        m_bits = ph_mat(f"MGB_{kind}_{variant}", "broken_brick_wall", scale=0.5,
                        tint=(0.45, 0.35, 0.3, 1), tint_fac=0.5, bump=0.5)
        bits = new_obj(f"gnd_bits_{kind}_{variant}", col)
        bm = bmesh.new()
        for _ in range(70):
            a = rng.uniform(0, 6.283)
            rr = crad + rng.uniform(-0.4, 1.6)
            px, py = cx + math.cos(a) * rr, cy + math.sin(a) * rr
            if math.hypot(px, py) > R - 0.5:
                continue
            rim_h = 0.42 * max(0.0, 1 - abs(rr - crad) / 1.2) if rr > crad else 0.1
            sz = rng.uniform(0.5, 1.2)
            mtx = Euler((rng.uniform(0, 3.14), rng.uniform(0, 3.14),
                         rng.uniform(0, 3.14))).to_matrix().to_4x4()
            mtx.translation = Vector((px, py, rim_h + 0.05))
            res = bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(0.26 * sz, 0.13 * sz, 0.09 * sz), verts=res["verts"])
            bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
        bm.to_mesh(bits.data)
        bm.free()
        bits.data.materials.append(m_bits)
    return ob


def build_rubble_field(variant, col):
    """Transparent overlay: strewn rubble mounds + bricks, no ground."""
    rng = random.Random(500 + variant)
    ph = rng.uniform(0, 50)
    m_rubble = ph_mat(f"MRF_{variant}",
                      rng.choice(["concrete_debris", "brick_gravel"]),
                      scale=0.35, tint=(0.14, 0.12, 0.10, 1), tint_fac=0.45,
                      bump=0.6, grime=0.35)
    m_bits = ph_mat(f"MRB_{variant}", "broken_brick_wall", scale=0.5,
                    tint=(0.22, 0.13, 0.09, 1), tint_fac=0.5, bump=0.5)
    mounds = []
    for _ in range(rng.randint(2, 4)):
        ob = new_obj(f"rf_mound_{variant}", col)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
        rx, ry = rng.uniform(1.4, 2.8), rng.uniform(1.2, 2.2)
        h = rng.uniform(0.3, 0.7)
        bmesh.ops.scale(bm, vec=(rx, ry, h), verts=bm.verts[:])
        for v in bm.verts:
            n = noise.noise(Vector((v.co.x * 1.2 + ph, v.co.y * 1.2, v.co.z)))
            v.co += v.normal * n * 0.4 * min(rx, ry)
            if v.co.z < 0:
                v.co.z *= 0.1
        cx = rng.uniform(-R * 0.45, R * 0.45)
        cy = rng.uniform(-R * 0.45, R * 0.45)
        bmesh.ops.translate(bm, vec=(cx, cy, 0.03), verts=bm.verts[:])
        bm.to_mesh(ob.data)
        bm.free()
        for poly in ob.data.polygons:
            poly.use_smooth = True
        ob.data.materials.append(m_rubble)
        mounds.append((cx, cy, rx, ry, h))
    bits = new_obj(f"rf_bits_{variant}", col)
    bm = bmesh.new()

    def one_bit(px, py, pz, sz):
        mtx = Euler((rng.uniform(0, 3.14), rng.uniform(0, 3.14),
                     rng.uniform(0, 3.14))).to_matrix().to_4x4()
        mtx.translation = Vector((px, py, pz))
        res = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(0.26 * sz, 0.13 * sz, 0.09 * sz), verts=res["verts"])
        bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])

    for (cx, cy, rx, ry, h) in mounds:
        for _ in range(45):
            a = rng.uniform(0, 6.283)
            rr = rng.random() ** 0.5
            one_bit(cx + math.cos(a) * rx * rr * 1.15,
                    cy + math.sin(a) * ry * rr * 1.15,
                    h * max(0.0, 1 - rr ** 2) * 0.7 + 0.05, rng.uniform(0.6, 1.3))
    # loose debris across the whole hex
    for _ in range(90):
        a = rng.uniform(0, 6.283)
        rr = rng.random() ** 0.5
        one_bit(math.cos(a) * R * 0.9 * rr, math.sin(a) * R * 0.9 * rr,
                0.05, rng.uniform(0.5, 1.1))
    bm.to_mesh(bits.data)
    bm.free()
    bits.data.materials.append(m_bits)

    # a few strewn planks / charred beams
    m_wood = ph_mat(f"MRW_{variant}", "old_planks_02", scale=0.5,
                    tint=(0.12, 0.095, 0.07, 1), tint_fac=0.6, bump=0.4)
    planks = new_obj(f"rf_planks_{variant}", col)
    bm = bmesh.new()
    for _ in range(rng.randint(3, 6)):
        L = rng.uniform(1.5, 3.5)
        mtx = Euler((rng.uniform(-0.15, 0.15), rng.uniform(1.35, 1.75),
                     rng.uniform(0, 3.14))).to_matrix().to_4x4()
        mtx.translation = Vector((rng.uniform(-R * 0.6, R * 0.6),
                                  rng.uniform(-R * 0.6, R * 0.6), 0.12))
        res = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(0.16, 0.16, L), verts=res["verts"])
        bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
    bm.to_mesh(planks.data)
    bm.free()
    planks.data.materials.append(m_wood)

    # leaning wall slabs: broken facade plates half-buried in the mounds
    m_slab = ph_mat(f"MRS_{variant}", "damaged_plaster", scale=0.35,
                    tint=(0.35, 0.30, 0.22, 1), tint_fac=0.45, bump=0.5, grime=0.5)
    slabs = new_obj(f"rf_slabs_{variant}", col)
    bm = bmesh.new()
    for (cx, cy, rx, ry, h) in mounds:
        for _ in range(rng.randint(1, 2)):
            sw = rng.uniform(1.4, 2.6)
            sc = rng.uniform(1.0, 1.8)
            a = rng.uniform(0, 6.283)
            px = cx + math.cos(a) * rx * rng.uniform(0.2, 0.8)
            py = cy + math.sin(a) * ry * rng.uniform(0.2, 0.8)
            res = bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(sw, 0.16, sc), verts=res["verts"])
            mtx = Euler((rng.uniform(0.9, 1.35), 0,
                         rng.uniform(0, 3.14))).to_matrix().to_4x4()
            mtx.translation = Vector((px, py, h * 0.4 + 0.1))
            bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
    bm.to_mesh(slabs.data)
    bm.free()
    slabs.data.materials.append(m_slab)

    # occasionally a chimney stub still stands in the field
    if rng.random() < 0.45:
        m_ch = ph_mat(f"MRCH_{variant}", "broken_brick_wall", scale=0.4,
                      tint=(0.20, 0.11, 0.08, 1), tint_fac=0.5, bump=0.5)
        chim = new_obj(f"rf_chimney_{variant}", col)
        bm = bmesh.new()
        (cx, cy, rx, ry, h) = mounds[0]
        hh = rng.uniform(2.2, 3.6)
        res = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(0.95, 0.95, hh), verts=res["verts"])
        bmesh.ops.translate(bm, vec=(cx, cy, hh / 2 + h * 0.3), verts=res["verts"])
        res = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(1.15, 1.15, 0.22), verts=res["verts"])
        bmesh.ops.translate(bm, vec=(cx, cy, hh + h * 0.3), verts=res["verts"])
        bm.to_mesh(chim.data)
        bm.free()
        chim.data.materials.append(m_ch)


def clear_stage():
    stage = bpy.data.collections["STAGE"]
    for ob in list(stage.objects):
        bpy.data.objects.remove(ob, do_unlink=True)


def stage_and_render(col, rot_deg, out_path, with_catcher=True, loc=(0, 0, 0)):
    """loc shifts the staged collection AFTER rotation — set pieces built at
    world offsets use it to bring each member hex onto the camera anchor."""
    clear_stage()
    stage = bpy.data.collections["STAGE"]
    inst = bpy.data.objects.new("stage_inst", None)
    inst.instance_type = 'COLLECTION'
    inst.instance_collection = col
    inst.rotation_euler = (0, 0, math.radians(rot_deg))
    inst.location = loc
    stage.objects.link(inst)
    bpy.data.objects["HK_ShadowCatcher"].hide_render = not with_catcher
    scn.render.filepath = out_path
    bpy.ops.render.render(write_still=True, scene="HexKit")


if globals().get("HEXKIT_DEMO", True):
    os.makedirs(CFG["scratch"], exist_ok=True)
    col = get_kit_col("GND_cobble_0")
    build_ground("cobble", 0, col)
    # ground tiles are opaque bases: no catcher needed (tile IS the ground)
    stage_and_render(col, 0, CFG["scratch"] + "/gnd_cobble_0.png", with_catcher=False)
    col = get_kit_col("GND_crater_0")
    build_ground("crater_cobble", 0, col)
    stage_and_render(col, 0, CFG["scratch"] + "/gnd_crater_0.png", with_catcher=False)
    col = get_kit_col("RF_0")
    build_rubble_field(0, col)
    stage_and_render(col, 0, CFG["scratch"] + "/rubble_field_0.png", with_catcher=True)
    print("DONE ground protos")
