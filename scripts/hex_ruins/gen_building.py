# -*- coding: utf-8 -*-
# HexKit ruined-building generator. Runs inside Blender (scene "HexKit" from rig_setup).
# Builds parametric WW2 ruined buildings into KIT collections, stages one, renders a proto.
import bpy
import bmesh
import json
import math
import os
import random
from mathutils import Vector, Euler, noise

scn = bpy.data.scenes["HexKit"]
CFG = json.loads(scn["hexkit_cfg"])
BRICK_COURSE = 0.25  # damage silhouette quantization (masonry steps)

# ---------------------------------------------------------------- materials
def ph_images(asset_id):
    """Collect PolyHaven image datablocks for an asset by datablock-name substring."""
    out = {}
    for img in bpy.data.images:
        p = img.name.lower()
        if asset_id not in p:
            continue
        if not img.packed_file:
            try:
                img.pack()  # temp files vanish; keep pixels in the blend
            except Exception:
                pass
        if "diff" in p or "color" in p:
            out["diff"] = img
        elif "rough" in p and "ao" not in p:
            out["rough"] = img
        elif "disp" in p or "height" in p:
            out["disp"] = img
        elif "_ao" in p or p.endswith("ao.jpg"):
            out["ao"] = img
    return out


def box_tex(nodes, links, img, mapping_out, colorspace):
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.projection = 'BOX'
    tex.projection_blend = 0.3
    try:
        tex.image.colorspace_settings.name = colorspace
    except Exception:
        pass
    links.new(mapping_out, tex.inputs["Vector"])
    return tex


def ph_mat(name, asset_id, scale=0.30, tint=(1, 1, 1, 1), tint_fac=0.0,
           bump=0.4, rough_add=0.0, grime=0.0):
    """Box-projected PBR material from a downloaded PolyHaven set (no UVs needed)."""
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
        if grime > 0.0:
            # large-scale soot/weathering: object-space noise multiplied in
            gn = nd.new("ShaderNodeTexNoise")
            gn.inputs["Scale"].default_value = 0.35
            gn.inputs["Detail"].default_value = 4.0
            lk.new(coord.outputs["Object"], gn.inputs["Vector"])
            mr = nd.new("ShaderNodeMapRange")
            mr.inputs["From Min"].default_value = 0.0
            mr.inputs["From Max"].default_value = 1.0
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
        if rough_add:
            add = nd.new("ShaderNodeMath")
            add.operation = 'ADD'
            add.inputs[1].default_value = rough_add
            add.use_clamp = True
            lk.new(t.outputs["Color"], add.inputs[0])
            lk.new(add.outputs[0], bsdf.inputs["Roughness"])
        else:
            lk.new(t.outputs["Color"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = 0.9
    if "disp" in imgs:
        t = box_tex(nd, lk, imgs["disp"], mo, "Non-Color")
        bmp = nd.new("ShaderNodeBump")
        bmp.inputs["Strength"].default_value = bump
        lk.new(t.outputs["Color"], bmp.inputs["Height"])
        lk.new(bmp.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def roof_tile_mat(name, rng, kind=None):
    """Procedural roof tiles: brick-node rows, clay red / slate grey."""
    mat = bpy.data.materials.get(name)
    if mat:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nd, lk = mat.node_tree.nodes, mat.node_tree.links
    nd.clear()
    out = nd.new("ShaderNodeOutputMaterial")
    bsdf = nd.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.85
    lk.new(bsdf.outputs[0], out.inputs[0])
    coord = nd.new("ShaderNodeTexCoord")
    mapping = nd.new("ShaderNodeMapping")
    lk.new(coord.outputs["Object"], mapping.inputs["Vector"])
    brick = nd.new("ShaderNodeTexBrick")
    bases = {"clay": (0.20, 0.075, 0.05), "slate": (0.10, 0.10, 0.12)}
    base = bases.get(kind) or rng.choice([(0.20, 0.075, 0.05), (0.10, 0.10, 0.12),
                                          (0.17, 0.09, 0.06), (0.14, 0.12, 0.10)])
    jit = rng.uniform(0.85, 1.15)
    brick.inputs["Color1"].default_value = (base[0] * jit, base[1] * jit, base[2] * jit, 1)
    brick.inputs["Color2"].default_value = (base[0] * 0.55, base[1] * 0.55, base[2] * 0.55, 1)
    brick.inputs["Mortar"].default_value = (base[0] * 0.3, base[1] * 0.3, base[2] * 0.3, 1)
    brick.inputs["Scale"].default_value = 1.0
    brick.inputs["Mortar Size"].default_value = 0.02
    brick.offset = 0.5
    try:
        brick.inputs["Brick Width"].default_value = 0.38
        brick.inputs["Row Height"].default_value = 0.20
    except Exception:
        pass
    lk.new(mapping.outputs["Vector"], brick.inputs["Vector"])
    lk.new(brick.outputs["Color"], bsdf.inputs["Base Color"])
    bmp = nd.new("ShaderNodeBump")
    bmp.inputs["Strength"].default_value = 0.3
    lk.new(brick.outputs["Fac"], bmp.inputs["Height"])
    lk.new(bmp.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


WALL_SETS = [
    ("damaged_plaster",      0.32),
    ("plaster_brick_pattern", 0.30),
    ("red_plaster_weathered", 0.34),
    ("broken_brick_wall",    0.30),
    ("brick_wall_001",       0.28),
    ("castle_brick_broken_06", 0.32),
]

# ---------------------------------------------------------------- mesh utils
def new_obj(name, col):
    mesh = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, mesh)
    col.objects.link(ob)
    return ob


def add_box(bm, cx, cy, z0, z1, w, d, rz=0.0):
    """Axis box (optionally z-rotated) appended into bmesh."""
    mat = Euler((0, 0, rz)).to_matrix().to_4x4()
    mat.translation = Vector((cx, cy, (z0 + z1) / 2))
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res["verts"]
    bmesh.ops.scale(bm, vec=(w, d, z1 - z0), verts=verts)
    bmesh.ops.transform(bm, matrix=mat, verts=verts)
    return verts


def mesh_from_bm(ob, bm):
    bm.to_mesh(ob.data)
    bm.free()


def apply_bool(ob, cutter, op='DIFFERENCE'):
    mod = ob.modifiers.new("b", 'BOOLEAN')
    mod.operation = op
    mod.object = cutter
    mod.solver = 'EXACT'
    with bpy.context.temp_override(object=ob, active_object=ob,
                                   selected_editable_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=mod.name)


# ---------------------------------------------------------------- generator
def build_building(seed, damage, col):
    """damage: 0 light (roofless, mostly whole) / 1 heavy / 2 collapsed."""
    rng = random.Random(seed * 100 + damage)
    t = 0.45                                  # wall thickness
    # near-max inscribed in hex even when rotated 60deg: hypot(w,d)/2 <= 7.79
    w = rng.uniform(11.0, 13.0)               # X extent
    d = rng.uniform(7.2, 8.2)                 # Y extent
    stories = rng.choice([2, 2, 3])
    sh = rng.uniform(3.0, 3.4)                # story height
    H = stories * sh

    wall_asset, wall_scale = WALL_SETS[rng.randrange(len(WALL_SETS))]
    # WW2 european facade palette: dusty ochre / grey / brick red / cream /
    # soot-dark / faded green-grey — strong factor so buildings read distinct
    palette = [(0.78, 0.63, 0.42), (0.55, 0.54, 0.52), (0.55, 0.30, 0.22),
               (0.85, 0.76, 0.60), (0.38, 0.36, 0.34), (0.52, 0.55, 0.45),
               (0.70, 0.48, 0.35), (0.62, 0.58, 0.48)]
    pc = palette[rng.randrange(len(palette))]
    tint = (pc[0] * rng.uniform(0.88, 1.12), pc[1] * rng.uniform(0.88, 1.12),
            pc[2] * rng.uniform(0.88, 1.12), 1.0)
    m_wall = ph_mat(f"MW_{seed}_{damage}", wall_asset, scale=wall_scale,
                    tint=tint, tint_fac=0.5, bump=0.5, grime=0.4)
    m_floor = ph_mat(f"MF_{seed}_{damage}", "concrete_floor_damaged_01",
                     scale=0.22, tint=(0.5, 0.5, 0.46, 1), tint_fac=0.4,
                     bump=0.35, grime=0.35)
    m_rubble = ph_mat(f"MR_{seed}_{damage}",
                      rng.choice(["concrete_debris", "brick_gravel"]),
                      scale=0.35, tint=(0.16, 0.14, 0.12, 1), tint_fac=0.45,
                      bump=0.6, grime=0.25)
    m_wood = ph_mat(f"MB_{seed}_{damage}", "old_planks_02",
                    scale=0.5, tint=(0.22, 0.17, 0.13, 1), tint_fac=0.7, bump=0.4)
    m_brickbits = ph_mat(f"MP_{seed}_{damage}", "broken_brick_wall",
                         scale=0.5, tint=(0.24, 0.14, 0.10, 1), tint_fac=0.5, bump=0.5)

    # ---- shell: outer minus inner ----
    shell = new_obj(f"shell_{seed}_{damage}", col)
    bm = bmesh.new()
    add_box(bm, 0, 0, 0, H, w, d)
    mesh_from_bm(shell, bm)
    inner = new_obj("tmp_inner", col)
    bm = bmesh.new()
    add_box(bm, 0, 0, -0.5, H + 1.0, w - 2 * t, d - 2 * t)
    mesh_from_bm(inner, bm)
    apply_bool(shell, inner)
    bpy.data.objects.remove(inner, do_unlink=True)

    # ---- window + door cutters ----
    cut = new_obj("tmp_cut", col)
    bm = bmesh.new()
    win_w, win_h, sill = 1.35, 1.7, 0.85
    for axis in ('S', 'N', 'E', 'W'):
        length = w if axis in 'SN' else d
        margin = 1.5
        n = max(1, int((length - 2 * margin) // 2.5))
        step = (length - 2 * margin) / n
        for i in range(n):
            u = -length / 2 + margin + step * (i + 0.5)
            for s in range(stories):
                z0 = s * sh + sill
                if axis == 'S' and s == 0 and i == n // 2:
                    # door
                    add_box(bm, u, -d / 2, 0.0, 2.2, 1.3, t * 3)
                    continue
                if axis in 'SN':
                    add_box(bm, u, (-d / 2 if axis == 'S' else d / 2),
                            z0, z0 + win_h, win_w, t * 3)
                else:
                    add_box(bm, (-w / 2 if axis == 'W' else w / 2), u,
                            z0, z0 + win_h, t * 3, win_w)
    mesh_from_bm(cut, bm)
    apply_bool(shell, cut)
    bpy.data.objects.remove(cut, do_unlink=True)

    # ---- roof plan decided BEFORE destruction so walls correlate with it ----
    want_roof = (damage == 0) or (damage == 1 and rng.random() < 0.35)
    burn_from = rng.choice([-1, 1])   # +1: east end burnt, -1: west end
    keep_frac = rng.uniform(0.55, 0.85) if damage == 0 else rng.uniform(0.3, 0.5)
    burn_len = (1.0 - keep_frac) * w
    roof_inner = w / 2 - burn_len     # burnt stretch (signed): [inner .. gable]
    kept_lo, kept_hi = sorted((-burn_from * w / 2, burn_from * roof_inner))

    # ---- destruction cutters: stepped masonry break line ----
    keep = {0: (0.75, 1.0), 1: (0.35, 0.85), 2: (0.15, 0.6)}[damage]
    phase = rng.uniform(0, 100)
    collapsed_axis = rng.choice(['S', 'N', 'E', 'W']) if damage >= 1 else None

    def ruin_h(axis, u, length):
        # noise-driven keep-height along wall, corners kept higher sometimes
        x = phase + (u + length / 2) * 0.35 + {'S': 0, 'N': 20, 'E': 40, 'W': 60}[axis]
        n1 = noise.noise(Vector((x, phase, 0.0)))
        n2 = noise.noise(Vector((x * 3.1, phase + 7.7, 1.3)))
        nz = min(1.0, max(0.0, 0.5 + 0.45 * n1 + 0.28 * n2))
        h = (keep[0] + (keep[1] - keep[0]) * nz) * H
        if rng.random() < 0.10:
            h = min(h, sh * rng.uniform(0.6, 1.2))   # deep V notch
        corner = min(u + length / 2, length / 2 - u)
        if corner < 1.2 and rng.random() < 0.7:
            h = max(h, H * rng.uniform(0.8, 1.0))   # corner pier survives
        if axis == collapsed_axis and damage >= 1:
            h *= 0.45 if damage == 1 else 0.25
        if want_roof:
            # walls under the surviving roof stretch stay (nearly) full height
            under_roof = (axis in 'SN' and kept_lo + 0.3 < u < kept_hi - 0.3) or \
                         (axis == 'W' and burn_from > 0) or \
                         (axis == 'E' and burn_from < 0)
            if under_roof:
                h = max(h, H * rng.uniform(0.96, 1.0))
        return max(1.0, round(h / BRICK_COURSE) * BRICK_COURSE)

    # NOTE: cutter boxes inside ONE mesh must not overlap each other —
    # the EXACT solver counts self-intersections even-odd and the overlap
    # region would survive the difference. Top-cut boxes are laid side by
    # side (width == step) and each wall gets its OWN boolean pass so the
    # deep cutters of adjacent walls never co-exist in one operand.
    # two alternating passes per wall: neighbours overlap ACROSS passes so no
    # hairline fins survive in the 1mm gaps, yet no self-overlap within a pass.
    wall_heights = {}
    for axis in ('S', 'N', 'E', 'W'):
        length = w if axis in 'SN' else d
        step = 0.55
        n = max(1, int(length / step))
        heights = []
        for i in range(n + 1):
            u = -length / 2 + step * (i + 0.5)
            heights.append((u, ruin_h(axis, u, length)))
        wall_heights[axis] = (heights, step)
        for parity in (0, 1):
            cut = new_obj(f"tmp_dmg_{axis}{parity}", col)
            bm = bmesh.new()
            any_box = False
            for i, (u, h) in enumerate(heights):
                if i % 2 != parity or h >= H - 0.01:
                    continue
                any_box = True
                bw = step * 1.45   # overlaps neighbours from the other pass
                if axis in 'SN':
                    add_box(bm, u, (-d / 2 if axis == 'S' else d / 2),
                            h, H + 2.0, bw, t * 4)
                else:
                    add_box(bm, (-w / 2 if axis == 'W' else w / 2), u,
                            h, H + 2.0, t * 4, bw)
            mesh_from_bm(cut, bm)
            if any_box:
                apply_bool(shell, cut)
            bpy.data.objects.remove(cut, do_unlink=True)

    # shell breaches: one boolean pass per hole (they may overlap anything)
    for _ in range(rng.randint(1, 2 + damage)):
        axis = rng.choice(['S', 'N', 'E', 'W'])
        length = w if axis in 'SN' else d
        u = rng.uniform(-length / 2 + 2, length / 2 - 2)
        z = rng.uniform(0.3, max(0.5, H - 3.0))
        r = rng.uniform(1.0, 2.2)
        rz = rng.uniform(-0.4, 0.4)
        hole = new_obj("tmp_breach", col)
        bm = bmesh.new()
        if axis in 'SN':
            add_box(bm, u, (-d / 2 if axis == 'S' else d / 2), z, z + r * 1.2, r, t * 5, rz)
        else:
            add_box(bm, (-w / 2 if axis == 'W' else w / 2), u, z, z + r * 1.2, t * 5, r, rz)
        mesh_from_bm(hole, bm)
        apply_bool(shell, hole)
        bpy.data.objects.remove(hole, do_unlink=True)
    shell.data.materials.append(m_wall)

    # ---- story ledges (cornices) where the wall still stands ----
    # no booleans: short overlapping boxes only at samples whose wall survives,
    # so ledges track the ruin silhouette automatically.
    ledge = new_obj(f"ledge_{seed}_{damage}", col)
    bm = bmesh.new()
    for axis in ('S', 'N', 'E', 'W'):
        length = w if axis in 'SN' else d
        heights, step = wall_heights[axis]
        levels = [s * sh - 0.15 for s in range(1, stories)]
        off = 0.05  # protrude outward only; edge-on walls just gain a thin line
        for z in levels:
            for (u, h) in heights:
                if h < z + 0.35 or abs(u) > length / 2 - 0.2:
                    continue
                bw = step * 1.1
                if axis == 'S':
                    add_box(bm, u, -d / 2 - off, z, z + 0.12, bw, 0.1)
                elif axis == 'N':
                    add_box(bm, u, d / 2 + off, z, z + 0.12, bw, 0.1)
                elif axis == 'W':
                    add_box(bm, -w / 2 - off, u, z, z + 0.12, 0.1, bw)
                else:
                    add_box(bm, w / 2 + off, u, z, z + 0.12, 0.1, bw)
    mesh_from_bm(ledge, bm)
    ledge.data.materials.append(m_wall)

    # ---- interior floor slabs with collapse holes ----
    slab_holes = {}
    for s in range(1, stories):
        z = s * sh
        slab = new_obj(f"slab_{seed}_{damage}_{s}", col)
        bm = bmesh.new()
        add_box(bm, 0, 0, z - 0.18, z, w - 2 * t + 0.05, d - 2 * t + 0.05)
        mesh_from_bm(slab, bm)
        # collapse holes: floors vanish from the top down. Top slab keeps only
        # a broken ring near the walls; lower slabs keep more surface.
        frac = s / max(1, stories - 1)          # 1.0 = top slab
        base = 0.10 + 0.30 * frac + 0.06 * damage
        n_holes = 1 + int(round(frac)) + min(1, damage)
        slab_holes[s] = []
        for k in range(n_holes):
            hole = new_obj("tmp_hole", col)
            bm = bmesh.new()
            bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
            rx = rng.uniform(base, base + 0.12) * w
            ry = rng.uniform(base, base + 0.12) * d
            bmesh.ops.scale(bm, vec=(rx, ry, 1.2), verts=bm.verts[:])
            spread = w / 5 if k == 0 else w / 3
            hx, hy = rng.uniform(-spread, spread), rng.uniform(-d / 4, d / 4)
            bmesh.ops.translate(bm, vec=(hx, hy, z), verts=bm.verts[:])
            slab_holes[s].append((hx, hy, rx, ry))
            mesh_from_bm(hole, bm)
            apply_bool(slab, hole)
            bpy.data.objects.remove(hole, do_unlink=True)
        slab.data.materials.append(m_floor)

    # ---- partial pitched roof (params decided above, correlated with walls) ----
    if want_roof:
        rise = (d / 2) * math.tan(math.radians(38))
        eave = 0.35
        m_roof = roof_tile_mat(f"MT_{seed}_{damage}", rng)
        slope_len = math.hypot(d / 2 + eave, rise)
        ang = math.atan2(rise, d / 2 + eave)
        outer = w / 2 + eave * 2 + 0.5    # just beyond the gable edge
        inner = roof_inner                # burnt stretch: [inner .. outer] (signed)
        want_hole = rng.random() < 0.6
        hole_params = None
        if want_hole and kept_hi - kept_lo > 3.0:
            hole_params = (rng.uniform(kept_lo + 1.5, kept_hi - 1.5),
                           rng.uniform(-d / 5, d / 5),
                           rng.uniform(1.0, 1.8), rng.uniform(0.9, 1.5),
                           rng.uniform(1.0, 1.6))
        # NOTE: the two slopes cross at the ridge; keeping them in one mesh makes
        # the target self-intersecting and EXACT boolean returns an EMPTY mesh.
        # Build each slope as its own object and cut them independently.
        for side in (-1, 1):
            roof = new_obj(f"roof_{seed}_{damage}_{'S' if side < 0 else 'N'}", col)
            bm = bmesh.new()
            # -side: ridge-side edge must be the HIGH one (A-shape, not V)
            mtx = Euler((-side * ang, 0, 0)).to_matrix().to_4x4()
            mtx.translation = Vector((0, side * (d / 2 + eave) / 2,
                                      H + rise / 2 + 0.06))
            res = bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(w + eave * 2, slope_len, 0.12),
                            verts=res["verts"])
            bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
            mesh_from_bm(roof, bm)
            cutter = new_obj("tmp_roofcut", col)
            bm = bmesh.new()
            add_box(bm, burn_from * (outer + inner) / 2, 0,
                    H - 1.0, H + rise + 1.5, outer - inner, d + eave * 2 + 2.0)
            mesh_from_bm(cutter, bm)
            apply_bool(roof, cutter)
            bpy.data.objects.remove(cutter, do_unlink=True)
            # jagged burn boundary: a few staggered bites, separate passes
            for k in range(3):
                bite = new_obj("tmp_roofbite", col)
                bm = bmesh.new()
                bw_ = rng.uniform(0.5, 1.1)
                by = rng.uniform(0.2, slope_len * 0.9) * side
                add_box(bm, burn_from * inner - burn_from * 0 + burn_from * rng.uniform(-0.9, 0.0),
                        by * 0.5, H - 0.5, H + rise + 1.0, bw_, rng.uniform(0.8, 1.8))
                mesh_from_bm(bite, bm)
                apply_bool(roof, bite)
                bpy.data.objects.remove(bite, do_unlink=True)
            if hole_params:
                hx, hy, hrx, hry, hrz = hole_params
                hole = new_obj("tmp_roofhole", col)
                bm = bmesh.new()
                bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
                bmesh.ops.scale(bm, vec=(hrx, hry, hrz), verts=bm.verts[:])
                bmesh.ops.translate(bm, vec=(hx, hy, H + rise * 0.55), verts=bm.verts[:])
                mesh_from_bm(hole, bm)
                apply_bool(roof, hole)
                bpy.data.objects.remove(hole, do_unlink=True)
            roof.data.materials.append(m_roof)
        # ridge cap over the kept span (skip on heavily damaged roof remnants);
        # pull back 1m from the burnt edge so it never floats past the jags
        if damage == 0:
            r_lo = kept_lo + (1.0 if burn_from < 0 else 0.0)
            r_hi = kept_hi - (1.0 if burn_from > 0 else 0.0)
            if r_hi - r_lo > 1.0:
                ridge = new_obj(f"ridge_{seed}_{damage}", col)
                bm = bmesh.new()
                add_box(bm, (r_lo + r_hi) / 2, 0,
                        H + rise - 0.05, H + rise + 0.16, r_hi - r_lo, 0.35)
                mesh_from_bm(ridge, bm)
                ridge.data.materials.append(m_roof)
        # gable wall (^): close the triangle between wall top and the roof
        # pitch at the non-burnt end; the burnt end stays open bare rafters
        xg = -burn_from * (w / 2 - t / 2)
        gable = new_obj(f"gable_{seed}_{damage}", col)
        bm = bmesh.new()
        gz0 = H - 0.3
        tri = []
        for dx in (-t / 2, t / 2):
            tri.append((bm.verts.new((xg + dx, -d / 2, gz0)),
                        bm.verts.new((xg + dx, d / 2, gz0)),
                        bm.verts.new((xg + dx, 0.0, H + rise - 0.02))))
        (a0, b0, c0), (a1, b1, c1) = tri
        bm.faces.new((a0, b0, c0))
        bm.faces.new((a1, c1, b1))
        bm.faces.new((a0, a1, b1, b0))
        bm.faces.new((a0, c0, c1, a1))
        bm.faces.new((b0, b1, c1, c0))
        mesh_from_bm(gable, bm)
        if rng.random() < 0.4:      # small attic window in the gable
            gwin = new_obj("tmp_gwin", col)
            bm = bmesh.new()
            add_box(bm, xg, rng.uniform(-0.5, 0.5), H + rise * 0.15,
                    H + rise * 0.15 + 0.75, t * 4, 0.55)
            mesh_from_bm(gwin, bm)
            apply_bool(gable, gwin)
            bpy.data.objects.remove(gwin, do_unlink=True)
        gable.data.materials.append(m_wall)
        # exposed rafters over the burnt stretch only
        rafters = new_obj(f"rafter_{seed}_{damage}", col)
        bm = bmesh.new()
        r_lo, r_hi = min(burn_from * inner, burn_from * w / 2), \
                     max(burn_from * inner, burn_from * w / 2)
        x = r_lo + 0.4
        while x < r_hi - 0.2:
            if rng.random() < 0.7:        # some rafters burnt away entirely
                for side in (-1, 1):
                    mtx = Euler((-side * ang, 0, 0)).to_matrix().to_4x4()
                    mtx.translation = Vector((x, side * (d / 2) / 2,
                                              H + rise / 2))
                    res = bmesh.ops.create_cube(bm, size=1.0)
                    bmesh.ops.scale(bm, vec=(0.13, slope_len * 0.9, 0.16),
                                    verts=res["verts"])
                    bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
            x += rng.uniform(0.8, 1.3)
        mesh_from_bm(rafters, bm)
        rafters.data.materials.append(m_wood)

    # ---- rubble mounds ----
    def mound(cx, cy, rx, ry, h, mat):
        ob = new_obj(f"rubble_{seed}_{damage}_{cx:.1f}", col)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
        bmesh.ops.scale(bm, vec=(rx, ry, h * 0.75), verts=bm.verts[:])
        for v in bm.verts:
            n = noise.noise(Vector((v.co.x * 1.3 + phase, v.co.y * 1.3, v.co.z * 1.1)))
            v.co += v.normal * n * 0.45 * min(rx, ry)
            if v.co.z < 0:
                v.co.z *= 0.12
        bmesh.ops.translate(bm, vec=(cx, cy, 0.05), verts=bm.verts[:])
        mesh_from_bm(ob, bm)
        ob.data.materials.append(mat)
        return (cx, cy, rx, ry, h)

    mounds = []
    n_inner = 1 + damage
    for _ in range(n_inner):
        mounds.append(mound(rng.uniform(-w / 4, w / 4), rng.uniform(-d / 4, d / 4),
                            rng.uniform(1.2, 2.2), rng.uniform(1.0, 1.8),
                            rng.uniform(0.4, 0.6 + 0.3 * damage), m_rubble))
    if collapsed_axis:
        # spill outward from the collapsed wall
        off = {'S': (0, -d / 2 - 0.8), 'N': (0, d / 2 + 0.8),
               'E': (w / 2 + 0.8, 0), 'W': (-w / 2 - 0.8, 0)}[collapsed_axis]
        mounds.append(mound(off[0] * 1.0, off[1] * 1.0,
                            rng.uniform(1.6, 2.4), rng.uniform(1.3, 1.9),
                            rng.uniform(0.35, 0.6), m_rubble))

    # ---- scattered brick chunks on mounds ----
    bits = new_obj(f"bits_{seed}_{damage}", col)
    bm = bmesh.new()
    for (cx, cy, rx, ry, h) in mounds:
        for _ in range(70):
            a = rng.uniform(0, 6.283)
            rr = rng.random() ** 0.5
            px = cx + math.cos(a) * rx * rr * 0.95
            py = cy + math.sin(a) * ry * rr * 0.95
            pz = h * max(0.0, 1 - (rr ** 2)) * 0.8 + 0.06
            sz = rng.uniform(0.65, 1.4)
            mtx = Euler((rng.uniform(0, 3.14), rng.uniform(0, 3.14),
                         rng.uniform(0, 3.14))).to_matrix().to_4x4()
            mtx.translation = Vector((px, py, pz))
            res = bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(0.26 * sz, 0.13 * sz, 0.09 * sz), verts=res["verts"])
            bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
    mesh_from_bm(bits, bm)
    bits.data.materials.append(m_brickbits)

    # ---- fallen timber beams ----
    beams = new_obj(f"beams_{seed}_{damage}", col)
    bm = bmesh.new()
    for _ in range(rng.randint(2, 4 + damage)):
        L = rng.uniform(2.5, 5.0)
        mtx = Euler((rng.uniform(-0.5, 0.5), rng.uniform(0.15, 0.7),
                     rng.uniform(0, 3.14))).to_matrix().to_4x4()
        mtx.translation = Vector((rng.uniform(-w / 3, w / 3),
                                  rng.uniform(-d / 3, d / 3),
                                  rng.uniform(0.4, 1.2)))
        res = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(0.14, 0.14, L), verts=res["verts"])
        bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
    mesh_from_bm(beams, bm)
    beams.data.materials.append(m_wood)

    # ---- interior furnishing: stoves, beds, tables — visible where the
    # roof/floors are gone. Roofed buildings only furnish the burnt stretch.
    def flat_mat(nm, c, rough=0.7, metal=0.0):
        mm = bpy.data.materials.get(nm)
        if mm:
            bpy.data.materials.remove(mm)
        mm = bpy.data.materials.new(nm)
        mm.use_nodes = True
        bb = [n for n in mm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'][0]
        bb.inputs["Base Color"].default_value = (*c, 1)
        bb.inputs["Roughness"].default_value = rough
        bb.inputs["Metallic"].default_value = metal
        return mm

    m_metal = flat_mat(f"MFM_{seed}_{damage}", (0.028, 0.028, 0.03), 0.5, 0.8)
    m_white = flat_mat(f"MFW_{seed}_{damage}", (0.30, 0.30, 0.29), 0.35)

    def in_hole(s, px, py, margin=1.05):
        for (hx, hy, rx, ry) in slab_holes.get(s, []):
            if ((px - hx) / (rx * margin)) ** 2 + ((py - hy) / (ry * margin)) ** 2 < 1:
                return True
        return False

    fur_w = new_obj(f"furnw_{seed}_{damage}", col)   # wooden furniture
    bmw = bmesh.new()
    fur_m = new_obj(f"furnm_{seed}_{damage}", col)   # stoves / metal
    bmm = bmesh.new()
    fur_h = new_obj(f"furnh_{seed}_{damage}", col)   # white ceramic / linen
    bmh = bmesh.new()

    def put(bm_t, boxes, px, py, z, rz):
        vs = []
        for (sx, sy, sz, lx, ly, lz) in boxes:
            res = bmesh.ops.create_cube(bm_t, size=1.0)
            bmesh.ops.scale(bm_t, vec=(sx, sy, sz), verts=res["verts"])
            bmesh.ops.translate(bm_t, vec=(lx, ly, lz), verts=res["verts"])
            vs += res["verts"]
        m = Euler((0, 0, rz)).to_matrix().to_4x4()
        m.translation = Vector((px, py, z))
        bmesh.ops.transform(bm_t, matrix=m, verts=vs)

    if want_roof:
        b_lo, b_hi = sorted((burn_from * roof_inner, burn_from * (w / 2 - t)))
        furnish = [(stories - 1, b_lo + 0.7, b_hi - 0.7)]
        if damage >= 1:
            furnish.append((0, -w / 2 + t + 1, w / 2 - t - 1))
    else:
        furnish = [(s, -w / 2 + t + 1, w / 2 - t - 1) for s in range(stories)]
    for (s, x_lo, x_hi) in furnish:
        if x_hi - x_lo < 1.6:
            continue
        z = s * sh
        for _ in range(rng.randint(2, 4)):
            px = py = None
            for _try in range(8):
                tx = rng.uniform(x_lo, x_hi)
                ty = rng.uniform(-d / 2 + t + 0.8, d / 2 - t - 0.8)
                if s == 0 or not in_hole(s, tx, ty):
                    px, py = tx, ty
                    break
            if px is None:
                continue
            rz = rng.uniform(0, 6.283)
            kind = rng.choice(('stove', 'bed', 'table', 'wardrobe', 'tub'))
            if kind == 'stove':
                res = bmesh.ops.create_cone(bmm, cap_ends=True, segments=10,
                                            radius1=0.36, radius2=0.32, depth=0.95)
                bmesh.ops.translate(bmm, vec=(px, py, z + 0.48), verts=res["verts"])
                res = bmesh.ops.create_cone(bmm, cap_ends=True, segments=8,
                                            radius1=0.09, radius2=0.09, depth=1.5)
                bmesh.ops.translate(bmm, vec=(px, py, z + 1.7), verts=res["verts"])
            elif kind == 'bed':
                put(bmw, [(2.0, 0.95, 0.32, 0, 0, 0.16),
                          (0.10, 0.95, 0.85, -0.95, 0, 0.42)], px, py, z, rz)
                put(bmh, [(1.8, 0.82, 0.16, 0.05, 0, 0.40)], px, py, z, rz)
            elif kind == 'table':
                put(bmw, [(1.35, 0.9, 0.07, 0, 0, 0.71),
                          (0.07, 0.07, 0.68, 0.60, 0.38, 0.34),
                          (0.07, 0.07, 0.68, -0.60, 0.38, 0.34),
                          (0.07, 0.07, 0.68, 0.60, -0.38, 0.34),
                          (0.07, 0.07, 0.68, -0.60, -0.38, 0.34)], px, py, z, rz)
                if rng.random() < 0.7:   # a chair, sometimes knocked over
                    cx_, cy_ = px + math.cos(rz) * 1.0, py + math.sin(rz) * 1.0
                    if rng.random() < 0.5:
                        put(bmw, [(0.42, 0.42, 0.06, 0, 0, 0.45),
                                  (0.42, 0.05, 0.5, 0, -0.2, 0.75)],
                            cx_, cy_, z, rng.uniform(0, 6.283))
                    else:
                        put(bmw, [(0.42, 0.9, 0.42, 0, 0, 0.21)],
                            cx_, cy_, z, rng.uniform(0, 6.283))
            elif kind == 'wardrobe':
                if rng.random() < 0.35:   # toppled: lies on its face
                    put(bmw, [(1.15, 1.95, 0.52, 0, 0, 0.26)], px, py, z, rz)
                else:
                    put(bmw, [(1.15, 0.55, 1.95, 0, 0, 0.98)], px, py, z, rz)
            else:                          # bathtub
                res = bmesh.ops.create_icosphere(bmh, subdivisions=2, radius=1.0)
                bmesh.ops.scale(bmh, vec=(0.85, 0.44, 0.30), verts=res["verts"])
                for v in res["verts"]:
                    v.co.z = max(v.co.z, -0.05)
                m = Euler((0, 0, rz)).to_matrix().to_4x4()
                m.translation = Vector((px, py, z + 0.28))
                bmesh.ops.transform(bmh, matrix=m, verts=res["verts"])
    mesh_from_bm(fur_w, bmw)
    fur_w.data.materials.append(m_wood)
    mesh_from_bm(fur_m, bmm)
    fur_m.data.materials.append(m_metal)
    mesh_from_bm(fur_h, bmh)
    fur_h.data.materials.append(m_white)
    return col


# ---------------------------------------------------------------- staging
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


def clear_stage():
    stage = bpy.data.collections["STAGE"]
    for ob in list(stage.objects):
        bpy.data.objects.remove(ob, do_unlink=True)


def stage_and_render(col, rot_deg, out_path):
    clear_stage()
    stage = bpy.data.collections["STAGE"]
    inst = bpy.data.objects.new("stage_inst", None)
    inst.instance_type = 'COLLECTION'
    inst.instance_collection = col
    inst.rotation_euler = (0, 0, math.radians(rot_deg))
    stage.objects.link(inst)
    scn.render.filepath = out_path
    bpy.ops.render.render(write_still=True, scene="HexKit")


if globals().get("HEXKIT_DEMO", True):
    os.makedirs(CFG["scratch"], exist_ok=True)
    # lighting balance: enough ambient to read interiors, low enough for mood
    bgn = bpy.data.worlds["HK_World"].node_tree.nodes
    for n in bgn:
        if n.type == 'BACKGROUND':
            n.inputs[1].default_value = 0.58
    bpy.data.lights["HK_Sun"].energy = 4.5
    scn.view_settings.look = 'High Contrast'
    for seed in (1, 2):
        for dmg in (0, 1, 2):
            name = f"BLDG_s{seed}_d{dmg}"
            col = get_kit_col(name)
            build_building(seed=seed, damage=dmg, col=col)
            stage_and_render(col, 0, CFG["scratch"] + f"/proto_s{seed}_d{dmg}.png")
            print("rendered", name)
    print("DONE variety sheet")
