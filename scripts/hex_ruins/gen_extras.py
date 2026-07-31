# -*- coding: utf-8 -*-
# HexKit extras: cross-hex crater, roads, trenches, barbed wire, props,
# dead trees, vegetation. Includes gen_ground.py for shared helpers.
import bpy
import bmesh
import json
import math
import os
import random
from mathutils import Vector, Euler, Matrix, noise

HEXKIT_DEMO = False
_g = globals()
exec(open("C:/Projects/squad_tactics/scripts/hex_ruins/gen_ground.py",
          encoding="utf-8").read(), _g)

scn = bpy.data.scenes["HexKit"]
CFG = json.loads(scn["hexkit_cfg"])
R = CFG["hex_R"]
INRAD = R * math.sqrt(3) / 2          # center to edge midpoint = 7.794


def plain_mat(name, color, rough=0.85, metal=0.0):
    mat = bpy.data.materials.get(name)
    if mat:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nd = mat.node_tree.nodes
    b = [n for n in nd if n.type == 'BSDF_PRINCIPLED'][0]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return mat


def noisy_mat(name, c1, c2, scale=0.6, rough=0.9, bump=0.4):
    """Two-tone noise material (soil, bark, canvas)."""
    mat = bpy.data.materials.get(name)
    if mat:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nd, lk = mat.node_tree.nodes, mat.node_tree.links
    nd.clear()
    out = nd.new("ShaderNodeOutputMaterial")
    b = nd.new("ShaderNodeBsdfPrincipled")
    b.inputs["Roughness"].default_value = rough
    lk.new(b.outputs[0], out.inputs[0])
    co = nd.new("ShaderNodeTexCoord")
    nz = nd.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 6.0
    lk.new(co.outputs["Object"], nz.inputs["Vector"])
    mix = nd.new("ShaderNodeMix")
    mix.data_type = 'RGBA'
    mix.inputs["A"].default_value = (*c1, 1)
    mix.inputs["B"].default_value = (*c2, 1)
    lk.new(nz.outputs["Fac"], mix.inputs["Factor"])
    lk.new(mix.outputs["Result"], b.inputs["Base Color"])
    bmp = nd.new("ShaderNodeBump")
    bmp.inputs["Strength"].default_value = bump
    lk.new(nz.outputs["Fac"], bmp.inputs["Height"])
    lk.new(bmp.outputs["Normal"], b.inputs["Normal"])
    return mat


def add_box_at(bm, sx, sy, sz, loc, rot=(0, 0, 0)):
    res = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=res["verts"])
    m = Euler(rot).to_matrix().to_4x4()
    m.translation = Vector(loc)
    bmesh.ops.transform(bm, matrix=m, verts=res["verts"])
    return res["verts"]


def scatter_bits(bm_bits, rng, cx, cy, rad, n, z=0.05, sz_range=(0.5, 1.2)):
    for _ in range(n):
        a = rng.uniform(0, 6.283)
        rr = rng.random() ** 0.5 * rad
        add_box_at(bm_bits, 0.26, 0.13, 0.09,
                   (cx + math.cos(a) * rr, cy + math.sin(a) * rr, z))
        # cheap: rotation via per-box transform
    # (rotation folded into add_box_at when needed; bits read fine axis-jittered)


# ---------------------------------------------------------------- big crater
def build_big_crater(variant, col):
    """Cross-hex crater overlay: soil disc w/ alpha-faded apron, bowl + rim."""
    rng = random.Random(900 + variant)
    crad = rng.uniform(6.0, 8.5)          # bowl radius (over hex edge = 7.79)
    disc_r = crad + 4.5
    ob = new_obj(f"bigcrater_{variant}", col)
    # dense grid disc (hexagon shape hidden by the radial alpha fade)
    hex_grid_mesh(ob, disc_r, 7)
    ph = rng.uniform(0, 40)
    for v in ob.data.vertices:
        dd = math.hypot(v.co.x, v.co.y)
        h = 0.06 * noise.noise(Vector((v.co.x * 0.5 + ph, v.co.y * 0.5, 0)))
        h += 0.12 * noise.noise(Vector((v.co.x * 1.4 + ph, v.co.y * 1.4, 7)))
        if dd < crad:
            t = dd / crad
            h += -2.0 * (1 - t * t) ** 1.4
        elif dd < crad + 1.6:
            h += 0.55 * (1 - (dd - crad) / 1.6)
        else:
            h += max(0.0, 0.15 * (1 - (dd - crad - 1.6) / 2.0))
        v.co.z = max(h, -1.95) + 0.04
    for p in ob.data.polygons:
        p.use_smooth = True
    # soil material with radial alpha fade on the apron
    mat = ph_mat(f"MBC_{variant}", "brick_gravel", scale=0.4,
                 tint=(0.09, 0.07, 0.05, 1), tint_fac=0.55, bump=0.7, grime=0.3)
    nt = mat.node_tree
    b = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
    out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    co = [n for n in nt.nodes if n.type == 'TEX_COORD'][0]
    grad = nt.nodes.new("ShaderNodeTexGradient")
    grad.gradient_type = 'SPHERICAL'
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / disc_r,) * 3
    nt.links.new(co.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], grad.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeMapRange")     # 0 at rim of disc -> alpha 0
    ramp.inputs["From Min"].default_value = 0.0
    ramp.inputs["From Max"].default_value = 0.35  # inner 65% fully opaque
    ramp.inputs["To Min"].default_value = 0.0
    ramp.inputs["To Max"].default_value = 1.0
    ramp.clamp = True
    nt.links.new(grad.outputs["Fac"], ramp.inputs["Value"])
    mixsh = nt.nodes.new("ShaderNodeMixShader")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    nt.links.new(ramp.outputs["Result"], mixsh.inputs["Fac"])
    nt.links.new(tr.outputs[0], mixsh.inputs[1])
    nt.links.new(b.outputs[0], mixsh.inputs[2])
    nt.links.new(mixsh.outputs[0], out.inputs["Surface"])
    # scorch darkening toward center
    g2 = nt.nodes.new("ShaderNodeMapRange")
    g2.inputs["From Min"].default_value = 0.55
    g2.inputs["From Max"].default_value = 1.0
    g2.inputs["To Min"].default_value = 1.0
    g2.inputs["To Max"].default_value = 0.18
    g2.clamp = True
    nt.links.new(grad.outputs["Fac"], g2.inputs["Value"])
    mixc = [n for n in nt.nodes if n.type == 'MIX' and n.data_type == 'RGBA'][0]
    dk = nt.nodes.new("ShaderNodeMix")
    dk.data_type = 'RGBA'
    dk.blend_type = 'MULTIPLY'
    dk.inputs["Factor"].default_value = 1.0
    nt.links.new(mixc.outputs["Result"], dk.inputs["A"])
    nt.links.new(g2.outputs["Result"], dk.inputs["B"])
    nt.links.new(dk.outputs["Result"], b.inputs["Base Color"])
    ob.data.materials.append(mat)
    # rim debris
    m_bits = ph_mat(f"MBCB_{variant}", "broken_brick_wall", scale=0.5,
                    tint=(0.4, 0.32, 0.28, 1), tint_fac=0.5, bump=0.5)
    bits = new_obj(f"bigcrater_bits_{variant}", col)
    bm = bmesh.new()
    for _ in range(90):
        a = rng.uniform(0, 6.283)
        rr = crad + rng.uniform(-0.3, 2.2)
        rim_h = 0.55 * max(0.0, 1 - abs(rr - crad) / 1.6) if rr > crad else 0.05
        add_box_at(bm, 0.26 * rng.uniform(0.5, 1.2), 0.13, 0.09,
                   (math.cos(a) * rr, math.sin(a) * rr, rim_h + 0.06),
                   (rng.uniform(0, 3), rng.uniform(0, 3), rng.uniform(0, 3)))
    bm.to_mesh(bits.data)
    bm.free()
    bits.data.materials.append(m_bits)


# ---------------------------------------------------------------- roads
# hex pitch = 2*INRAD. A box-projected texture whose period divides the pitch
# lands with identical phase on every neighbouring tile -> no texture seam.
ROAD_TEX_SCALE = 3.0 / (2 * INRAD)


def edge_mid(k):
    """Midpoint of hex edge k (azimuth k*60 deg from +X)."""
    a = math.radians(60 * k)
    return (INRAD * math.cos(a), INRAD * math.sin(a))


def road_strip(bm, p0, p1, width, rng, ph, taper=2.0):
    """Noise-edged road strip. Edge noise and undulation TAPER TO ZERO toward
    the endpoints so any two road tiles meet at the standard width/height."""
    p0, p1 = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0))
    axis = (p1 - p0)
    L = axis.length
    axis.normalize()
    perp = Vector((-axis.y, axis.x, 0))
    n_len = max(4, int(L / 0.7))
    n_wid = 6
    grid = []
    for i in range(n_len + 1):
        u = i / n_len
        dm = min(u, 1 - u) * L
        tf = max(0.0, min(1.0, dm / taper))
        tf = tf * tf * (3 - 2 * tf)
        # overshoot both ends 0.25m so composited neighbours always overlap
        along = u * L + (-0.25 if i == 0 else (0.25 if i == n_len else 0.0))
        row = []
        for j in range(n_wid + 1):
            vfrac = j / n_wid - 0.5
            edge_noise = 0.35 * noise.noise(Vector((u * L * 0.5 + ph, vfrac * 3, 0)))
            wv = width * (1 + (abs(vfrac) > 0.35) * edge_noise * tf)
            p = p0 + axis * along + perp * (vfrac * wv)
            z = 0.05 + 0.03 * noise.noise(Vector((p.x + ph, p.y, 5))) * tf
            row.append(bm.verts.new((p.x, p.y, z)))
        grid.append(row)
    for i in range(n_len):
        for j in range(n_wid):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))


def crack_lines(bm, seg, rng, half_w):
    """Jagged crack ribbons + shallow potholes on a road segment surface."""
    a, b = Vector((seg[0][0], seg[0][1], 0)), Vector((seg[1][0], seg[1][1], 0))
    axis = (b - a)
    L = axis.length
    axis.normalize()
    perp = Vector((-axis.y, axis.x, 0))
    for _ in range(rng.randint(2, 3)):
        u0 = rng.uniform(0.25, 0.75)
        c = a + axis * (u0 * L)
        v = -half_w * 1.02
        drift = 0.0
        while v < half_w * 1.02:
            step = rng.uniform(0.45, 0.9)
            drift += rng.uniform(-0.45, 0.45)
            p_mid = c + perp * (v + step / 2) + axis * drift
            seg_dir = perp * step + axis * (drift * 0.3)
            ang = math.atan2(seg_dir.y, seg_dir.x)
            add_box_at(bm, step * 0.62, 0.075, 0.02,
                       (p_mid.x, p_mid.y, 0.093), (0, 0, ang))
            v += step
    for _ in range(rng.randint(1, 2)):
        u0 = rng.uniform(0.2, 0.8)
        c = a + axis * (u0 * L) + perp * rng.uniform(-half_w * 0.5, half_w * 0.5)
        res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
        bmesh.ops.scale(bm, vec=(rng.uniform(0.45, 0.85), rng.uniform(0.35, 0.6), 0.025),
                        verts=res["verts"])
        bmesh.ops.translate(bm, vec=(c.x, c.y, 0.088), verts=res["verts"])


def build_road(pattern, variant, col):
    """straight (E-W) / corner (E+NW) / tee (E,W,NW) / cross (E,W,NW,SE).
    Higher variants of straight/corner carry cracks & potholes."""
    rng = random.Random(1200 + variant * 13 + hash(pattern) % 97)
    ph = rng.uniform(0, 50)
    base = new_obj(f"road_{pattern}_{variant}", col)
    hex_grid_mesh(base, R + 0.4, 6)
    for v in base.data.vertices:
        v.co.z += 0.08 * noise.noise(Vector((v.co.x * 0.3 + ph, v.co.y * 0.3, 0)))
    for p in base.data.polygons:
        p.use_smooth = True
    m_cob = ph_mat(f"MRD_base_{pattern}_{variant}", "cobblestone_floor_01",
                   scale=0.35, offset=(rng.uniform(0, 7), rng.uniform(0, 7), 0),
                   tint=(0.5, 0.49, 0.47, 1), tint_fac=0.25, bump=0.7, grime=0.5)
    base.data.materials.append(m_cob)
    strip = new_obj(f"road_strip_{pattern}_{variant}", col)
    bm = bmesh.new()
    W = 5.2
    segs = {"straight": [(edge_mid(3), edge_mid(0))],
            "corner": [(edge_mid(0), (0, 0)), ((0, 0), edge_mid(2))],
            "tee": [(edge_mid(3), edge_mid(0)), ((0, 0), edge_mid(2))],
            "cross": [(edge_mid(3), edge_mid(0)), (edge_mid(5), edge_mid(2))]}[pattern]
    for (a, b) in segs:
        road_strip(bm, a, b, W, rng, ph)
    if pattern in ("corner", "tee", "cross"):
        res = bmesh.ops.create_circle(bm, cap_ends=True, radius=W * 0.62, segments=20)
        bmesh.ops.translate(bm, vec=(0, 0, 0.055), verts=res["verts"])
    bm.to_mesh(strip.data)
    bm.free()
    for p in strip.data.polygons:
        p.use_smooth = True
    # fixed texture offset + pitch-periodic scale = phase-continuous asphalt
    m_road = ph_mat(f"MRD_{pattern}_{variant}", "road_damaged", scale=ROAD_TEX_SCALE,
                    tint=(0.28, 0.27, 0.25, 1), tint_fac=0.45, bump=0.5, grime=0.5)
    strip.data.materials.append(m_road)
    cracked = (pattern == "straight" and variant >= 2) or \
              (pattern == "corner" and variant >= 2)
    if cracked:
        cr = new_obj(f"road_cracks_{pattern}_{variant}", col)
        bm = bmesh.new()
        for (a, b) in segs:
            crack_lines(bm, (a, b), rng, W / 2)
        bm.to_mesh(cr.data)
        bm.free()
        cr.data.materials.append(plain_mat(f"MRC_{pattern}_{variant}",
                                           (0.010, 0.010, 0.011), rough=0.97))


# ---------------------------------------------------------------- trenches v2
def resample_path(pts, step=0.5):
    """Polyline -> evenly spaced (pos, tangent, dist, total) samples."""
    P = [Vector((p[0], p[1], 0)) for p in pts]
    seglens = [(P[i + 1] - P[i]).length for i in range(len(P) - 1)]
    total = sum(seglens)
    n = max(6, int(total / step))
    out = []
    di, acc = 0, 0.0
    for k in range(n + 1):
        target = total * k / n
        while di < len(seglens) - 1 and acc + seglens[di] < target:
            acc += seglens[di]
            di += 1
        t = (target - acc) / max(1e-9, seglens[di])
        pos = P[di].lerp(P[di + 1], min(1.0, max(0.0, t)))
        tang = (P[di + 1] - P[di]).normalized()
        out.append([pos, tang, target, total])
    for i in range(1, len(out) - 1):
        out[i][1] = (out[i - 1][1] + out[i][1] + out[i + 1][1]).normalized()
    return out


def set_fade(ob, fades):
    """Per-vertex alpha weights (1 opaque, 0 transparent) as a color attr."""
    attr = ob.data.color_attributes.new("fade", 'FLOAT_COLOR', 'POINT')
    for i, f in enumerate(fades):
        attr.data[i].color = (f, f, f, 1.0)


def fade_alpha_wrap(mat):
    """Blend the material to transparent where the 'fade' attribute -> 0."""
    nt = mat.node_tree
    b = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
    out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "fade"
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(vc.outputs["Color"], mx.inputs["Fac"])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(b.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])
    return mat


def trench_mats(sfx):
    m_soil = fade_alpha_wrap(ph_mat(f"MTS_{sfx}", "brick_gravel", scale=0.45,
                                    tint=(0.09, 0.07, 0.05, 1), tint_fac=0.55,
                                    bump=0.7, grime=0.3))
    m_dark = noisy_mat(f"MTD_{sfx}", (0.012, 0.010, 0.008),
                       (0.035, 0.027, 0.02), scale=1.4, rough=0.98, bump=0.3)
    m_wood = ph_mat(f"MTW_{sfx}", "old_planks_02", scale=0.5,
                    tint=(0.15, 0.115, 0.085, 1), tint_fac=0.6, bump=0.4)
    m_bag = noisy_mat(f"MTB_{sfx}", (0.085, 0.075, 0.05), (0.14, 0.125, 0.085),
                      scale=2.2, rough=0.95, bump=0.35)
    return m_soil, m_dark, m_wood, m_bag


# soil profile per side: (perp offset, base z, fade). Apron is OPAQUE up to
# the outermost row: neighbouring trench tiles overlap in a 0.7m band and
# semi-transparent rows there would double-composite into a darker stripe.
TR_PROF = [(3.15, 0.015, 0.0), (2.45, 0.12, 1.0), (1.80, 1.0, 1.0),
           (1.40, 0.86, 1.0), (1.00, 0.30, 1.0)]
# excavated channel profile crossing both sides: (signed offset, z)
TR_CHAN = [(1.00, 0.30), (0.62, -1.28), (0.44, -1.40), (0.0, -1.44),
           (-0.44, -1.40), (-0.62, -1.28), (-1.00, 0.30)]
TR_CREST_STD = 0.52     # parapet height where the path crosses a hex edge


def trench_body(col, sfx, samples, rng, ph, mats, taper=1.6, bags=True,
                timber=True):
    """Shared trench construction along resampled path: parapet soil (alpha-
    faded apron), excavated channel, timber revetment, duckboards, sandbags."""
    m_soil, m_dark, m_wood, m_bag = mats
    soil = new_obj(f"tr_soil_{sfx}", col)
    bm = bmesh.new()
    fades = []
    for side in (-1, 1):
        rows = []
        for (pos, tang, dist, total) in samples:
            perp = Vector((-tang.y, tang.x, 0)) * side
            dm = min(dist, total - dist)
            tf = min(1.0, dm / taper)
            tf = tf * tf * (3 - 2 * tf)
            crest = TR_CREST_STD * (0.8 + 0.5 * (0.5 + 0.5 * noise.noise(
                Vector((dist * 0.7 + ph, side * 3.3, 2)))))
            crest = TR_CREST_STD + (crest - TR_CREST_STD) * tf
            row = []
            for (off, zf, fd) in TR_PROF:
                p = pos + perp * off
                z = zf * crest if zf > 0.2 else zf
                z += 0.03 * noise.noise(Vector((p.x * 1.5 + ph, p.y * 1.5, 4))) * tf
                row.append(bm.verts.new((p.x, p.y, z)))
                fades.append(fd)
            rows.append(row)
        for i in range(len(rows) - 1):
            for j in range(len(TR_PROF) - 1):
                if side < 0:
                    bm.faces.new((rows[i][j], rows[i + 1][j],
                                  rows[i + 1][j + 1], rows[i][j + 1]))
                else:
                    bm.faces.new((rows[i][j + 1], rows[i + 1][j + 1],
                                  rows[i + 1][j], rows[i][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(soil.data)
    bm.free()
    for p in soil.data.polygons:
        p.use_smooth = True
    set_fade(soil, fades)
    soil.data.materials.append(m_soil)

    chan = new_obj(f"tr_chan_{sfx}", col)
    bm = bmesh.new()
    rows = []
    for (pos, tang, dist, total) in samples:
        perp = Vector((-tang.y, tang.x, 0))
        row = []
        for (off, z) in TR_CHAN:
            p = pos + perp * off
            zz = z + 0.02 * noise.noise(Vector((p.x * 2 + ph, p.y * 2, 9)))
            row.append(bm.verts.new((p.x, p.y, zz)))
        rows.append(row)
    for i in range(len(rows) - 1):
        for j in range(len(TR_CHAN) - 1):
            bm.faces.new((rows[i][j], rows[i + 1][j],
                          rows[i + 1][j + 1], rows[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(chan.data)
    bm.free()
    for p in chan.data.polygons:
        p.use_smooth = True
    chan.data.materials.append(m_dark)

    wood = new_obj(f"tr_wood_{sfx}", col)
    bm = bmesh.new()
    if timber:
        for k, (pos, tang, dist, total) in enumerate(samples):
            yaw = math.atan2(tang.y, tang.x)
            perp = Vector((-tang.y, tang.x, 0))
            if k % 2 == 0:                      # revetment planks both walls
                for side in (-1, 1):
                    p = pos + perp * (side * 0.80)
                    add_box_at(bm, 0.30, 0.055, 1.5, (p.x, p.y, -0.62),
                               (side * 0.13, 0, yaw))
            if k % 1 == 0 and 0.3 < dist < total - 0.3:   # duckboard slats
                p = pos
                add_box_at(bm, 0.13, 1.0, 0.045, (p.x, p.y, -1.36), (0, 0, yaw))
        # wale beams along both lips
        for side in (-1, 1):
            for i in range(len(samples) - 1):
                a, b = samples[i], samples[i + 1]
                pa = a[0] + Vector((-a[1].y, a[1].x, 0)) * (side * 0.74)
                pb = b[0] + Vector((-b[1].y, b[1].x, 0)) * (side * 0.74)
                mid = (pa + pb) / 2
                dd = pb - pa
                add_box_at(bm, dd.length * 1.15, 0.075, 0.11,
                           (mid.x, mid.y, -0.12), (0, 0, math.atan2(dd.y, dd.x)))
    bm.to_mesh(wood.data)
    bm.free()
    wood.data.materials.append(m_wood)

    if bags:
        bagob = new_obj(f"tr_bags_{sfx}", col)
        bm = bmesh.new()
        acc = 0.0
        for i in range(len(samples) - 1):
            (pos, tang, dist, total) = samples[i]
            step = (samples[i + 1][0] - pos).length
            acc += step
            if acc < 0.34:
                continue
            acc = 0.0
            perp = Vector((-tang.y, tang.x, 0))
            yaw = math.atan2(tang.y, tang.x)
            for side in (-1, 1):
                for layer in range(2):
                    if rng.random() < 0.13:
                        continue
                    p = pos + perp * (side * (1.52 + layer * 0.06)) \
                        + tang * rng.uniform(-0.05, 0.05)
                    res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
                    bmesh.ops.scale(bm, vec=(0.30, 0.19, 0.115), verts=res["verts"])
                    mtx = Euler((0, 0, yaw + rng.uniform(-0.12, 0.12))).to_matrix().to_4x4()
                    mtx.translation = Vector((p.x, p.y, 0.30 + layer * 0.165))
                    bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
        bm.to_mesh(bagob.data)
        bm.free()
        for p in bagob.data.polygons:
            p.use_smooth = True
        bagob.data.materials.append(m_bag)


def dug_pit(col, sfx, center, radius, depth, rng, ph, m_soil, m_dark,
            rim_h=0.35, rings=7):
    """Round excavated pit with raised rim, alpha-faded skirt."""
    ob = new_obj(f"pit_{sfx}", col)
    bm = bmesh.new()
    fades = []
    cx, cy = center
    rays = 18
    ring_r = [radius * (i / (rings - 2)) for i in range(rings - 1)] + [radius + 1.4]
    rows = []
    for i, rr in enumerate(ring_r):
        row = []
        for a in range(rays):
            ang = a / rays * 6.2832
            px, py = cx + math.cos(ang) * rr, cy + math.sin(ang) * rr
            if rr <= radius:
                tt = rr / radius
                z = -depth * (1 - tt * tt) ** 1.2 + rim_h * (tt ** 3)
                fd = 1.0
            else:
                z = 0.015
                fd = 0.0
            z += 0.03 * noise.noise(Vector((px * 1.7 + ph, py * 1.7, 3)))
            row.append(bm.verts.new((px, py, z)))
            fades.append(fd)
        rows.append(row)
    for i in range(len(rows) - 1):
        for a in range(rays):
            b = (a + 1) % rays
            bm.faces.new((rows[i][a], rows[i + 1][a], rows[i + 1][b], rows[i][b]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    set_fade(ob, fades)
    mat = m_soil            # faded soil w/ dark centre via second slot? keep soil
    ob.data.materials.append(mat)
    return ob


def bag_arc(bm, center, radius, a0, a1, layers, rng, z0=0.10):
    cx, cy = center
    aa = a0
    while aa < a1:
        for layer in range(layers):
            if rng.random() < 0.1:
                continue
            px = cx + math.cos(aa) * (radius + layer * 0.05)
            py = cy + math.sin(aa) * (radius + layer * 0.05)
            res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
            bmesh.ops.scale(bm, vec=(0.30, 0.19, 0.115), verts=res["verts"])
            mtx = Euler((0, 0, aa + 1.5708 + rng.uniform(-0.1, 0.1))).to_matrix().to_4x4()
            mtx.translation = Vector((px, py, z0 + 0.09 + layer * 0.165))
            bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
        aa += 0.36 / max(0.6, radius)


def build_trench(pattern, variant, col):
    """WW2 field works. straight/corner: zigzag traversed trench with timber
    revetment + sandbag parapets. end: trench terminating in an MG nest."""
    rng = random.Random(1500 + variant * 17 + hash(pattern) % 89)
    ph = rng.uniform(0, 50)
    mats = trench_mats(f"{pattern}_{variant}")
    s1 = rng.choice([-1, 1])
    # paths overshoot the hex edge by 0.7m: the strip's end ring (whose
    # smooth normals tilt) lands OUTSIDE the tile and gets overdrawn by the
    # neighbour's identical standard cross-section -> seamless joints
    OV = INRAD + 0.7
    if pattern == "straight":
        pts = [(-OV, 0), (-6.1, 0), (-3.0, s1 * 1.45),
               (-0.1, -s1 * 1.05), (2.9, s1 * 1.3), (6.1, 0), (OV, 0)]
        trench_body(col, f"{pattern}{variant}", resample_path(pts), rng, ph, mats)
    elif pattern == "corner":
        m2 = edge_mid(2)
        app = (m2[0] * 0.795, m2[1] * 0.795)
        ovf = OV / INRAD
        pts = [(OV, 0), (6.1, 0), (3.3, s1 * 0.9), (0.7, 0.4),
               (-1.5, 2.7), (app[0], app[1]),
               (m2[0] * ovf, m2[1] * ovf)]
        trench_body(col, f"{pattern}{variant}", resample_path(pts), rng, ph, mats)
    elif pattern == "end":
        pts = [(OV, 0), (6.1, 0), (3.6, s1 * 0.9), (1.8, 0.25)]
        trench_body(col, f"{pattern}{variant}", resample_path(pts), rng, ph, mats)
        # MG nest: wide pit + sandbag horseshoe (weapon itself not modelled —
        # the game draws the crew/gun as units)
        m_soil, m_dark, m_wood, m_bag = mats
        dug_pit(col, f"{pattern}{variant}", (0.1, 0.2), 2.1, 1.15, rng, ph,
                m_soil, m_dark)
        bags = new_obj(f"mg_bags_{variant}", col)
        bm = bmesh.new()
        bag_arc(bm, (0.1, 0.2), 2.25, math.radians(55), math.radians(305), 3, rng)
        bm.to_mesh(bags.data)
        bm.free()
        for p in bags.data.polygons:
            p.use_smooth = True
        bags.data.materials.append(m_bag)
        crates = new_obj(f"mg_crates_{variant}", col)
        bm = bmesh.new()
        for _ in range(2):                                          # ammo crates
            add_box_at(bm, 0.55, 0.32, 0.28,
                       (rng.uniform(0.2, 1.2), rng.uniform(-0.6, 1.0), -0.9),
                       (0, 0, rng.uniform(0, 3.14)))
        bm.to_mesh(crates.data)
        bm.free()
        crates.data.materials.append(m_wood)


def build_foxholes(variant, col):
    """2-3 one-man pits with sandbag half-rings — scattered strongpoint."""
    rng = random.Random(3100 + variant)
    ph = rng.uniform(0, 40)
    mats = trench_mats(f"fox_{variant}")
    m_soil, m_dark, m_wood, m_bag = mats
    bags = new_obj(f"fox_bags_{variant}", col)
    bmb = bmesh.new()
    spots = []
    for k in range(rng.randint(2, 3)):
        for _try in range(10):
            cx = rng.uniform(-4.5, 4.5)
            cy = rng.uniform(-3.8, 3.8)
            if all((cx - a) ** 2 + (cy - b) ** 2 > 3.4 ** 2 for (a, b) in spots):
                spots.append((cx, cy))
                break
    for k, (cx, cy) in enumerate(spots):
        rad = rng.uniform(0.85, 1.15)
        dug_pit(col, f"fox{variant}_{k}", (cx, cy), rad, 0.85, rng, ph,
                m_soil, m_dark, rim_h=0.22, rings=6)
        a0 = rng.uniform(0, 6.283)
        bag_arc(bmb, (cx, cy), rad + 0.28, a0, a0 + rng.uniform(2.2, 3.4), 2, rng)
    bmb.to_mesh(bags.data)
    bmb.free()
    for p in bags.data.polygons:
        p.use_smooth = True
    bags.data.materials.append(m_bag)


# ---------------------------------------------------------------- bocage
def build_bocage(pattern, variant, col):
    """Hedgerow on an earth bank — connectable like roads (rim-calm ends)."""
    rng = random.Random(3400 + variant * 11 + hash(pattern) % 71)
    ph = rng.uniform(0, 60)
    OV = INRAD + 0.7
    ovf = OV / INRAD
    paths = {"straight": [(-OV, 0), (-3.5, rng.uniform(-0.5, 0.5)),
                          (0, rng.uniform(-0.6, 0.6)),
                          (3.5, rng.uniform(-0.5, 0.5)), (OV, 0)],
             "corner": [(OV, 0), (5.2, 0.2), (2.2, 0.5),
                        (-0.6, 1.6), (-2.4, 3.9),
                        (edge_mid(2)[0] * 0.67, edge_mid(2)[1] * 0.67),
                        (edge_mid(2)[0] * ovf, edge_mid(2)[1] * ovf)],
             "end": [(OV, 0), (5.0, 0.3), (2.2, -0.3), (0.2, 0.1)]}[pattern]
    samples = resample_path(paths, 0.5)
    # earth bank with faded skirt
    bank = new_obj(f"boc_bank_{pattern}_{variant}", col)
    bm = bmesh.new()
    fades = []
    prof = [(-1.7, 0.015, 0.0), (-1.05, 0.35, 1.0), (-0.45, 0.78, 1.0),
            (0.45, 0.78, 1.0), (1.05, 0.35, 1.0), (1.7, 0.015, 0.0)]
    rows = []
    for (pos, tang, dist, total) in samples:
        perp = Vector((-tang.y, tang.x, 0))
        dm = min(dist, total - dist)
        tf = min(1.0, dm / 1.6)
        tf = tf * tf * (3 - 2 * tf)
        hmul = 1.0 + 0.3 * noise.noise(Vector((dist * 0.6 + ph, 0, 6))) * tf
        row = []
        for (off, z, fd) in prof:
            p = pos + perp * off
            row.append(bm.verts.new((p.x, p.y, z * hmul)))
            fades.append(fd)
        rows.append(row)
    for i in range(len(rows) - 1):
        for j in range(len(prof) - 1):
            bm.faces.new((rows[i][j], rows[i + 1][j],
                          rows[i + 1][j + 1], rows[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(bank.data)
    bm.free()
    for p in bank.data.polygons:
        p.use_smooth = True
    set_fade(bank, fades)
    bank.data.materials.append(fade_alpha_wrap(
        ph_mat(f"MBK_{pattern}_{variant}", "brick_gravel", scale=0.5,
               tint=(0.07, 0.06, 0.04, 1), tint_fac=0.55, bump=0.6, grime=0.3)))
    # dense hedge lobes riding the bank
    hedge = new_obj(f"boc_hedge_{pattern}_{variant}", col)
    bm = bmesh.new()
    acc = 99.0
    for i, (pos, tang, dist, total) in enumerate(samples):
        acc += (samples[i][0] - samples[i - 1][0]).length if i else 0
        if acc < 0.55:
            continue
        acc = 0.0
        perp = Vector((-tang.y, tang.x, 0))
        rr = rng.uniform(0.55, 1.0)
        p = pos + perp * rng.uniform(-0.25, 0.25)
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        bmesh.ops.scale(bm, vec=(rr * rng.uniform(0.9, 1.3), rr, rr * 0.8),
                        verts=res["verts"])
        for v in res["verts"]:
            n = noise.noise(Vector((v.co.x * 2.2 + ph, v.co.y * 2.2, v.co.z * 2.2)))
            v.co += v.co.normalized() * n * 0.4 * rr
        bmesh.ops.translate(bm, vec=(p.x, p.y, 0.75 + rr * 0.35), verts=res["verts"])
    bm.to_mesh(hedge.data)
    bm.free()
    for p in hedge.data.polygons:
        p.use_smooth = True
    hedge.data.materials.append(noisy_mat(f"MBH_{pattern}_{variant}",
                                          (0.012, 0.02, 0.006), (0.04, 0.05, 0.016),
                                          scale=2.8, rough=0.95, bump=0.5))
    # 1-2 emergent trees
    trees = new_obj(f"boc_tree_{pattern}_{variant}", col)
    bm = bmesh.new()
    for _ in range(rng.randint(1, 2)):
        s = samples[rng.randrange(len(samples) // 4, 3 * len(samples) // 4)]
        add_branch(bm, Vector((s[0].x, s[0].y, 0.6)),
                   Vector((rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), 1)).normalized(),
                   rng.uniform(3.5, 5.0), rng.uniform(0.16, 0.22), 2, rng)
    bm.to_mesh(trees.data)
    bm.free()
    trees.data.materials.append(ph_mat(f"MBT_{pattern}_{variant}", "old_planks_02",
                                       scale=0.8, tint=(0.05, 0.04, 0.03, 1),
                                       tint_fac=0.72, bump=0.5))


# ---------------------------------------------------------------- barbed wire
def build_wire(variant, col):
    rng = random.Random(1800 + variant)
    m_wood = ph_mat(f"MWW_{variant}", "old_planks_02", scale=0.5,
                    tint=(0.3, 0.24, 0.18, 1), tint_fac=0.5, bump=0.4)
    m_steel = plain_mat(f"MWS_{variant}", (0.08, 0.075, 0.07), rough=0.55, metal=0.8)
    stakes = new_obj(f"wire_stakes_{variant}", col)
    bm = bmesh.new()
    x = -INRAD
    while x < INRAD:
        for tilt in (-0.5, 0.5):
            add_box_at(bm, 0.09, 0.09, 1.5,
                       (x + rng.uniform(-0.1, 0.1), rng.uniform(-0.15, 0.15), 0.6),
                       (tilt + rng.uniform(-0.1, 0.1), 0, rng.uniform(-0.2, 0.2)))
        x += rng.uniform(1.3, 1.8)
    bm.to_mesh(stakes.data)
    bm.free()
    stakes.data.materials.append(m_wood)
    coils = new_obj(f"wire_coils_{variant}", col)
    bm = bmesh.new()
    x = -INRAD
    while x < INRAD:
        res = bmesh.ops.create_circle(bm, cap_ends=False, radius=0.45, segments=10)
        mtx = Euler((0, math.radians(90), rng.uniform(-0.2, 0.2))).to_matrix().to_4x4()
        mtx.translation = Vector((x, rng.uniform(-0.08, 0.08), 0.5))
        bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
        x += 0.42
    # give the circles thickness: convert edges to skin via solidify trick —
    # simplest: extrude edge rings slightly along X to make ribbons
    ext = bmesh.ops.extrude_edge_only(bm, edges=bm.edges[:])
    verts_new = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0.05, 0.0, 0.0), verts=verts_new)
    bm.to_mesh(coils.data)
    bm.free()
    coils.data.materials.append(m_steel)


# ---------------------------------------------------------------- props
def build_props(kind, variant, col):
    rng = random.Random(2100 + variant * 7 + hash(kind) % 83)
    m_steel = plain_mat(f"MPS_{kind}_{variant}", (0.09, 0.085, 0.08), 0.5, 0.85)
    m_canvas = noisy_mat(f"MPC_{kind}_{variant}", (0.10, 0.088, 0.058), (0.16, 0.14, 0.10),
                         scale=2.0, rough=0.95, bump=0.3)
    m_wood = ph_mat(f"MPW_{kind}_{variant}", "old_planks_02", scale=0.5,
                    tint=(0.32, 0.26, 0.2, 1), tint_fac=0.45, bump=0.4)
    if kind == "hedgehog":
        ob = new_obj(f"prop_hh_{variant}", col)
        bm = bmesh.new()
        n = rng.randint(3, 4)
        for i in range(n):
            cx = -4.5 + i * (9.0 / max(1, n - 1)) + rng.uniform(-0.6, 0.6)
            cy = rng.uniform(-1.2, 1.2)
            for rot in ((0, 0.62, 0.3), (2.1, 0.62, -0.4), (-2.1, 0.62, 1.1)):
                add_box_at(bm, 0.14, 0.14, 2.0, (cx, cy, 0.7),
                           (rot[0] + rng.uniform(-0.1, 0.1), rot[1], rot[2]))
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.materials.append(m_steel)
    elif kind == "sandbag":
        ob = new_obj(f"prop_sb_{variant}", col)
        bm = bmesh.new()
        arc_r = rng.uniform(2.2, 3.0)
        a0 = rng.uniform(0, 6.28)
        for layer in range(3):
            aa = a0 - 1.2
            while aa < a0 + 1.2:
                px = math.cos(aa) * arc_r
                py = math.sin(aa) * arc_r
                res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
                bmesh.ops.scale(bm, vec=(0.33, 0.2, 0.13), verts=res["verts"])
                mtx = Euler((0, 0, aa + 1.57 + rng.uniform(-0.15, 0.15))).to_matrix().to_4x4()
                mtx.translation = Vector((px + rng.uniform(-0.05, 0.05),
                                          py + rng.uniform(-0.05, 0.05),
                                          0.11 + layer * 0.19))
                bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
                aa += 0.62 / arc_r * 2.2
        bm.to_mesh(ob.data)
        bm.free()
        for p in ob.data.polygons:
            p.use_smooth = True
        ob.data.materials.append(m_canvas)
    elif kind == "barrels":
        ob = new_obj(f"prop_br_{variant}", col)
        bm = bmesh.new()
        for _ in range(rng.randint(4, 7)):
            px, py = rng.uniform(-3, 3), rng.uniform(-2.5, 2.5)
            fallen = rng.random() < 0.35
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=12,
                                        radius1=0.32, radius2=0.32, depth=0.95)
            rot = (1.57, 0, rng.uniform(0, 3.14)) if fallen else (0, 0, 0)
            mtx = Euler(rot).to_matrix().to_4x4()
            mtx.translation = Vector((px, py, 0.33 if fallen else 0.48))
            bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
        for _ in range(rng.randint(2, 4)):
            add_box_at(bm, rng.uniform(0.7, 1.1), rng.uniform(0.7, 1.1),
                       rng.uniform(0.5, 0.8),
                       (rng.uniform(-3, 3), rng.uniform(-2.5, 2.5), 0.35),
                       (0, 0, rng.uniform(0, 3.14)))
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.materials.append(m_wood)
    return


# ---------------------------------------------------------------- dead trees
def add_branch(bm, base, direction, length, radius, depth, rng, kink=0.28):
    """Two chained tapering segments with a kink -> organic curvature."""
    mid_dir = (direction + Vector((rng.uniform(-kink, kink),
                                   rng.uniform(-kink, kink),
                                   rng.uniform(-kink * 0.4, kink * 0.6)))).normalized()
    seg1, seg2 = length * 0.55, length * 0.45
    parts = ((base, direction, seg1, radius, radius * 0.72),
             (base + direction * seg1, mid_dir, seg2, radius * 0.72, radius * 0.36))
    for (b0, dd, ll, r0, r1) in parts:
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=6,
                                    radius1=r0, radius2=r1, depth=ll)
        m = dd.to_track_quat('Z', 'X').to_matrix().to_4x4()
        m.translation = b0 + dd * (ll / 2)
        bmesh.ops.transform(bm, matrix=m, verts=res["verts"])
    if depth <= 0:
        return
    for _ in range(rng.randint(2, 4)):
        t = rng.uniform(0.35, 1.0)
        if t < 0.55:
            b2 = base + direction * (length * t)
            par = direction
        else:
            b2 = base + direction * seg1 + mid_dir * (seg2 * (t - 0.55) / 0.45)
            par = mid_dir
        tilt = rng.uniform(0.45, 1.1)
        az = rng.uniform(0, 6.283)
        d2 = (par + Vector((math.cos(az) * tilt, math.sin(az) * tilt,
                            rng.uniform(-0.15, 0.3)))).normalized()
        add_branch(bm, b2, d2, length * rng.uniform(0.42, 0.6),
                   radius * 0.52, depth - 1, rng)


def build_tree(variant, col):
    """0-2: standing dead trees. 3: shattered snag. 4: fallen trunk."""
    rng = random.Random(2400 + variant)
    ob = new_obj(f"tree_{variant}", col)
    bm = bmesh.new()
    bx, by = rng.uniform(-1, 1), rng.uniform(-1, 1)
    if variant <= 2:
        h = rng.uniform(5.0, 7.5)
        r0 = rng.uniform(0.24, 0.32)
        add_branch(bm, Vector((bx, by, 0)),
                   Vector((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), 1)).normalized(),
                   h, r0, 3, rng)
        for _ in range(4):        # root flare
            az = rng.uniform(0, 6.283)
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=5,
                                        radius1=0.16, radius2=0.05, depth=0.9)
            m = Euler((0, math.radians(105), az)).to_matrix().to_4x4()
            m.translation = Vector((bx + math.cos(az) * 0.45,
                                    by + math.sin(az) * 0.45, 0.12))
            bmesh.ops.transform(bm, matrix=m, verts=res["verts"])
    elif variant == 3:            # snag: trunk sheared off with splinters
        h = rng.uniform(2.4, 3.6)
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=7,
                                    radius1=0.34, radius2=0.22, depth=h)
        bmesh.ops.translate(bm, vec=(bx, by, h / 2), verts=res["verts"])
        for _ in range(6):        # jagged splinter spikes at the break
            az = rng.uniform(0, 6.283)
            sp = rng.uniform(0.5, 1.2)
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=4,
                                        radius1=0.07, radius2=0.01, depth=sp)
            m = Euler((rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35),
                       az)).to_matrix().to_4x4()
            m.translation = Vector((bx + math.cos(az) * 0.16,
                                    by + math.sin(az) * 0.16, h + sp * 0.35))
            bmesh.ops.transform(bm, matrix=m, verts=res["verts"])
        if rng.random() < 0.8:    # the fallen crown lies next to it
            dir2 = Vector((math.cos(rng.uniform(0, 6.28)),
                           math.sin(rng.uniform(0, 6.28)), 0.04)).normalized()
            add_branch(bm, Vector((bx + dir2.x, by + dir2.y, 0.35)),
                       dir2, rng.uniform(3.0, 4.2), 0.2, 2, rng)
    else:                          # fallen tree: trunk + root disc
        az = rng.uniform(0, 6.283)
        dirF = Vector((math.cos(az), math.sin(az), 0.02)).normalized()
        add_branch(bm, Vector((bx, by, 0.4)), dirF,
                   rng.uniform(5.0, 6.5), 0.28, 2, rng, kink=0.16)
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=9,
                                    radius1=1.0, radius2=0.85, depth=0.35)
        m = dirF.to_track_quat('Z', 'X').to_matrix().to_4x4()
        m.translation = Vector((bx, by, 0.75))
        bmesh.ops.transform(bm, matrix=m, verts=res["verts"])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.materials.append(ph_mat(f"MTR_{variant}", "old_planks_02", scale=0.8,
                                    tint=(0.05, 0.04, 0.03, 1), tint_fac=0.7, bump=0.5))


def build_vegetation(variant, col):
    """Clustered scrub: multi-lobe bushes + dead twig sticks poking through."""
    rng = random.Random(2700 + variant)
    ph = rng.uniform(0, 30)
    ob = new_obj(f"veg_{variant}", col)
    bm = bmesh.new()
    twigs = new_obj(f"veg_twigs_{variant}", col)
    bmt = bmesh.new()
    for _ in range(rng.randint(2, 4)):        # clusters, not confetti
        cx, cy = rng.uniform(-R * 0.55, R * 0.55), rng.uniform(-R * 0.5, R * 0.5)
        for _ in range(rng.randint(2, 4)):    # lobes per cluster
            lx = cx + rng.uniform(-1.1, 1.1)
            ly = cy + rng.uniform(-0.9, 0.9)
            rr = rng.uniform(0.45, 1.05)
            res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
            bmesh.ops.scale(bm, vec=(rr * rng.uniform(0.9, 1.4), rr, rr * 0.62),
                            verts=res["verts"])
            for v in res["verts"]:
                n = noise.noise(Vector((v.co.x * 2.4 + ph, v.co.y * 2.4, v.co.z * 2.4)))
                v.co += v.co.normalized() * n * 0.5 * rr
            bmesh.ops.translate(bm, vec=(lx, ly, rr * 0.28), verts=res["verts"])
        for _ in range(rng.randint(2, 5)):    # twigs
            tx = cx + rng.uniform(-1.3, 1.3)
            ty = cy + rng.uniform(-1.1, 1.1)
            hh = rng.uniform(0.7, 1.5)
            res = bmesh.ops.create_cone(bmt, cap_ends=True, segments=4,
                                        radius1=0.035, radius2=0.008, depth=hh)
            m = Euler((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4),
                       rng.uniform(0, 3.14))).to_matrix().to_4x4()
            m.translation = Vector((tx, ty, hh * 0.4))
            bmesh.ops.transform(bmt, matrix=m, verts=res["verts"])
    bm.to_mesh(ob.data)
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.materials.append(noisy_mat(f"MVG_{variant}", (0.014, 0.022, 0.007),
                                       (0.045, 0.052, 0.02), scale=2.5, rough=0.95, bump=0.5))
    bmt.to_mesh(twigs.data)
    bmt.free()
    twigs.data.materials.append(plain_mat(f"MVT_{variant}", (0.04, 0.032, 0.024), 0.9))


# ---------------------------------------------------------------- demo
if _g.get("EXTRAS_DEMO", True):
    os.makedirs(CFG["scratch"], exist_ok=True)
    tests = []
    for (pat, v) in (("straight", 0), ("straight", 2), ("cross", 0)):
        col = get_kit_col(f"XT_road_{pat}{v}")
        build_road(pat, v, col)
        tests.append((f"XT_road_{pat}{v}", f"xt_road_{pat}{v}.png", False))
    for pat in ("straight", "corner", "end"):
        col = get_kit_col(f"XT_trench_{pat}")
        build_trench(pat, 0, col)
        tests.append((f"XT_trench_{pat}", f"xt_trench_{pat}.png", True))
    col = get_kit_col("XT_fox")
    build_foxholes(0, col)
    tests.append(("XT_fox", "xt_fox.png", True))
    for pat in ("straight", "corner"):
        col = get_kit_col(f"XT_boc_{pat}")
        build_bocage(pat, 0, col)
        tests.append((f"XT_boc_{pat}", f"xt_boc_{pat}.png", True))
    for v in (0, 3, 4):
        col = get_kit_col(f"XT_tree{v}")
        build_tree(v, col)
        tests.append((f"XT_tree{v}", f"xt_tree{v}.png", True))
    col = get_kit_col("XT_veg")
    build_vegetation(0, col)
    tests.append(("XT_veg", "xt_veg.png", True))
    for (cn, fn, catcher) in tests:
        stage_and_render(bpy.data.collections[cn], 0, CFG["scratch"] + "/" + fn,
                         with_catcher=catcher)
        print("R", fn)
    print("DONE extras demo")
