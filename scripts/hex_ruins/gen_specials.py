# -*- coding: utf-8 -*-
# HexKit special buildings: church (nave+apse+tower) and factory (sawtooth
# roof + chimney). Expects gen_building.py exec'd into globals (ph_mat,
# new_obj, add_box, mesh_from_bm, apply_bool, roof_tile_mat, ...).
import bpy
import bmesh
import json
import math
import random
from mathutils import Vector, Euler, noise

_g3 = globals()
scn = bpy.data.scenes["HexKit"]
CFG = json.loads(scn["hexkit_cfg"])


def _flat(nm, c, rough=0.7, metal=0.0):
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


def _parity_ruin(shell, col, w, d, H, rng, keep, phase, step=0.7):
    """Noise silhouette cut on all four walls, two-parity passes (no fins)."""
    for axis in ('S', 'N', 'E', 'W'):
        length = w if axis in 'SN' else d
        n = max(1, int(length / step))
        heights = []
        for i in range(n + 1):
            u = -length / 2 + step * (i + 0.5)
            x = phase + (u + length / 2) * 0.4 + {'S': 0, 'N': 20, 'E': 40, 'W': 60}[axis]
            nz = 0.5 + 0.5 * noise.noise(Vector((x, phase, 0)))
            h = (keep[0] + (keep[1] - keep[0]) * nz) * H
            corner = min(u + length / 2, length / 2 - u)
            if corner < 1.0 and rng.random() < 0.6:
                h = max(h, H * 0.85)
            heights.append((u, max(0.8, round(h / 0.25) * 0.25)))
        for parity in (0, 1):
            cut = new_obj(f"tmp_pr_{axis}{parity}", col)
            bm = bmesh.new()
            any_box = False
            for i, (u, h) in enumerate(heights):
                if i % 2 != parity or h >= H - 0.01:
                    continue
                any_box = True
                if axis in 'SN':
                    add_box(bm, u, (-d / 2 if axis == 'S' else d / 2),
                            h, H + 12.0, step * 1.45, 3.0)
                else:
                    add_box(bm, (-w / 2 if axis == 'W' else w / 2), u,
                            h, H + 12.0, 3.0, step * 1.45)
            mesh_from_bm(cut, bm)
            if any_box:
                apply_bool(shell, cut)
            bpy.data.objects.remove(cut, do_unlink=True)


def _arch_cut(shell, col, cx, cy, z0, wdt, hgt, thick, along='SN'):
    """Round-headed window: box pass + cylinder pass. TWO separate booleans —
    box and arch cylinder overlap, and a self-intersecting operand is wiped
    by the EXACT solver's even-odd rule (known trap)."""
    cut = new_obj("tmp_archbox", col)
    bm = bmesh.new()
    if along == 'SN':
        add_box(bm, cx, cy, z0, z0 + hgt - wdt / 2, wdt, thick)
    else:
        add_box(bm, cx, cy, z0, z0 + hgt - wdt / 2, thick, wdt)
    mesh_from_bm(cut, bm)
    apply_bool(shell, cut)
    bpy.data.objects.remove(cut, do_unlink=True)
    cut = new_obj("tmp_archcyl", col)
    bm = bmesh.new()
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=12,
                                radius1=wdt / 2, radius2=wdt / 2, depth=thick)
    rot = (math.radians(90), 0, 0) if along == 'SN' else (0, math.radians(90), 0)
    m = Euler(rot).to_matrix().to_4x4()
    m.translation = Vector((cx, cy, z0 + hgt - wdt / 2))
    bmesh.ops.transform(bm, matrix=m, verts=res["verts"])
    mesh_from_bm(cut, bm)
    apply_bool(shell, cut)
    bpy.data.objects.remove(cut, do_unlink=True)


def _mound(col, mat, cx, cy, rx, ry, h, phase):
    ob = new_obj(f"sp_mound_{cx:.1f}_{cy:.1f}", col)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    bmesh.ops.scale(bm, vec=(rx, ry, h * 0.75), verts=bm.verts[:])
    for v in bm.verts:
        n = noise.noise(Vector((v.co.x * 1.3 + phase, v.co.y * 1.3, v.co.z)))
        v.co += v.normal * n * 0.4 * min(rx, ry)
        if v.co.z < 0:
            v.co.z *= 0.12
    bmesh.ops.translate(bm, vec=(cx, cy, 0.05), verts=bm.verts[:])
    mesh_from_bm(ob, bm)
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.materials.append(mat)


# ------------------------------------------------------------------ church
def build_church(damage, col):
    rng = random.Random(7100 + damage)
    phase = rng.uniform(0, 100)
    w, d, t = 9.6, 6.8, 0.55          # nave
    H = 6.0
    tw, th = 3.2, 10.5                # west tower
    tower_x = -w / 2 - tw / 2 + 0.6
    apse_r, apse_h = 2.2, 4.6
    m_stone = ph_mat(f"MCH_{damage}", "castle_brick_broken_06", scale=0.32,
                     tint=(0.30, 0.29, 0.26, 1), tint_fac=0.45, bump=0.55, grime=0.45)
    m_roof = roof_tile_mat(f"MCHR_{damage}", rng, kind="slate")
    m_wood = ph_mat(f"MCHW_{damage}", "old_planks_02", scale=0.5,
                    tint=(0.15, 0.115, 0.085, 1), tint_fac=0.65, bump=0.4)
    m_rubble = ph_mat(f"MCHRB_{damage}", "concrete_debris", scale=0.35,
                      tint=(0.17, 0.155, 0.14, 1), tint_fac=0.45, bump=0.6, grime=0.3)

    # nave shell
    shell = new_obj(f"church_{damage}", col)
    bm = bmesh.new()
    add_box(bm, 0, 0, 0, H, w, d)
    mesh_from_bm(shell, bm)
    inner = new_obj("tmp_in", col)
    bm = bmesh.new()
    add_box(bm, 0, 0, -0.5, H + 1, w - 2 * t, d - 2 * t)
    mesh_from_bm(inner, bm)
    apply_bool(shell, inner)
    bpy.data.objects.remove(inner, do_unlink=True)
    # tall arched windows, 3 per long side
    for sgn in (-1, 1):
        for i in range(3):
            cx = -w / 2 + (i + 0.5) * (w / 3)
            _arch_cut(shell, col, cx, sgn * d / 2, 1.6, 1.0, 3.2, t * 3, 'SN')
    if damage >= 1:
        for _ in range(1 + damage):
            axis_sn = rng.random() < 0.5
            u = rng.uniform(-w / 2 + 2, w / 2 - 2) if axis_sn else rng.uniform(-d / 2 + 1.5, d / 2 - 1.5)
            r = rng.uniform(1.2, 2.2)
            hole = new_obj("tmp_bre", col)
            bm = bmesh.new()
            z0 = rng.uniform(0.4, 2.5)
            if axis_sn:
                add_box(bm, u, rng.choice([-d / 2, d / 2]), z0,
                        z0 + r, r, t * 5, rng.uniform(-0.4, 0.4))
            else:
                add_box(bm, rng.choice([-w / 2, w / 2]), u, z0,
                        z0 + r, t * 5, r, rng.uniform(-0.4, 0.4))
            mesh_from_bm(hole, bm)
            apply_bool(shell, hole)
            bpy.data.objects.remove(hole, do_unlink=True)
    if damage == 2:
        _parity_ruin(shell, col, w, d, H, rng, (0.25, 0.7), phase)
    shell.data.materials.append(m_stone)

    # buttresses along the nave
    if damage <= 1:
        but = new_obj(f"church_but_{damage}", col)
        bm = bmesh.new()
        for sgn in (-1, 1):
            for i in range(4):
                cx = -w / 2 + i * (w / 3)
                add_box(bm, cx, sgn * (d / 2 + 0.28), 0, H * 0.62, 0.5, 0.6)
        mesh_from_bm(but, bm)
        but.data.materials.append(m_stone)

    # apse: half-cylinder shell at the east end
    apse = new_obj(f"church_apse_{damage}", col)
    bm = bmesh.new()
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=16,
                                radius1=apse_r, radius2=apse_r, depth=apse_h)
    bmesh.ops.translate(bm, vec=(w / 2, 0, apse_h / 2), verts=res["verts"])
    mesh_from_bm(apse, bm)
    for (rr, z0, z1) in ((apse_r - t, -0.5, apse_h + 1),):
        cut = new_obj("tmp_ac", col)
        bm = bmesh.new()
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=16,
                                    radius1=rr, radius2=rr, depth=z1 - z0)
        bmesh.ops.translate(bm, vec=(w / 2, 0, (z0 + z1) / 2), verts=res["verts"])
        mesh_from_bm(cut, bm)
        apply_bool(apse, cut)
        bpy.data.objects.remove(cut, do_unlink=True)
    cut = new_obj("tmp_ah", col)
    bm = bmesh.new()
    add_box(bm, w / 2 - apse_r, 0, -1, apse_h + 2, apse_r * 2, apse_r * 2 + 2)
    mesh_from_bm(cut, bm)
    apply_bool(apse, cut)
    bpy.data.objects.remove(cut, do_unlink=True)
    if damage == 2:
        cutz = new_obj("tmp_az", col)
        bm = bmesh.new()
        add_box(bm, w / 2 + apse_r / 2, rng.uniform(-1, 1), rng.uniform(1.8, 2.6),
                apse_h + 2, apse_r * 1.5, apse_r * 1.5, rng.uniform(-0.3, 0.3))
        mesh_from_bm(cutz, bm)
        apply_bool(apse, cutz)
        bpy.data.objects.remove(cutz, do_unlink=True)
    apse.data.materials.append(m_stone)
    if damage == 0:      # conical apse roof
        ar = new_obj("church_apseroof", col)
        bm = bmesh.new()
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=16,
                                    radius1=apse_r + 0.35, radius2=0.1, depth=2.0)
        bmesh.ops.translate(bm, vec=(w / 2, 0, apse_h + 1.0), verts=res["verts"])
        mesh_from_bm(ar, bm)
        cut = new_obj("tmp_arh", col)
        bm = bmesh.new()
        add_box(bm, w / 2 - apse_r, 0, apse_h - 1, apse_h + 3, apse_r * 2, apse_r * 2 + 2)
        mesh_from_bm(cut, bm)
        apply_bool(ar, cut)
        bpy.data.objects.remove(cut, do_unlink=True)
        ar.data.materials.append(m_roof)

    # west tower + spire
    tower = new_obj(f"church_tw_{damage}", col)
    t_h = th if damage <= 1 else th * rng.uniform(0.5, 0.62)
    bm = bmesh.new()
    add_box(bm, tower_x, 0, 0, t_h, tw, tw)
    mesh_from_bm(tower, bm)
    inner = new_obj("tmp_ti", col)
    bm = bmesh.new()
    add_box(bm, tower_x, 0, 1.0, t_h + 1, tw - 2 * t, tw - 2 * t)
    mesh_from_bm(inner, bm)
    apply_bool(tower, inner)
    bpy.data.objects.remove(inner, do_unlink=True)
    if damage <= 1:      # belfry openings on all 4 sides
        for k in range(4):
            ang = k * math.pi / 2
            ox = tower_x + math.cos(ang) * tw / 2
            oy = math.sin(ang) * tw / 2
            along = 'SN' if k % 2 else 'EW'
            _arch_cut(tower, col, ox, oy, t_h - 2.6, 0.85, 1.7, t * 3, along)
    else:                # jagged broken top
        for _ in range(4):
            cutz = new_obj("tmp_tz", col)
            bm = bmesh.new()
            add_box(bm, tower_x + rng.uniform(-tw / 2, tw / 2),
                    rng.uniform(-tw / 2, tw / 2), t_h - rng.uniform(0.4, 1.4),
                    t_h + 2, rng.uniform(0.8, 1.6), rng.uniform(0.8, 1.6),
                    rng.uniform(0, 1.5))
            mesh_from_bm(cutz, bm)
            apply_bool(tower, cutz)
            bpy.data.objects.remove(cutz, do_unlink=True)
    tower.data.materials.append(m_stone)
    if damage == 0:      # steep pyramid spire, dark slate
        sp = new_obj("church_spire", col)
        bm = bmesh.new()
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=4,
                                    radius1=tw * 0.80, radius2=0.05, depth=4.6)
        m = Euler((0, 0, math.radians(45))).to_matrix().to_4x4()
        m.translation = Vector((tower_x, 0, th + 2.3))
        bmesh.ops.transform(bm, matrix=m, verts=res["verts"])
        mesh_from_bm(sp, bm)
        sp.data.materials.append(_flat(f"MSPD_{damage}", (0.028, 0.028, 0.035), 0.75))

    # nave roof: steep slate gable (full d0, burnt stretch d1, rafters d2)
    rise = (d / 2) * math.tan(math.radians(50))
    eave = 0.35
    slope_len = math.hypot(d / 2 + eave, rise)
    ang = math.atan2(rise, d / 2 + eave)
    burn_from = rng.choice([-1, 1])
    keep_frac = 1.0 if damage == 0 else (rng.uniform(0.45, 0.65) if damage == 1 else 0.0)
    roof_inner = w / 2 - (1.0 - keep_frac) * w
    if damage <= 1:
        for side in (-1, 1):
            roofob = new_obj(f"church_roof_{damage}_{side}", col)
            bm = bmesh.new()
            mtx = Euler((-side * ang, 0, 0)).to_matrix().to_4x4()
            mtx.translation = Vector((0, side * (d / 2 + eave) / 2, H + rise / 2 + 0.06))
            res = bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(w + eave * 2, slope_len, 0.12), verts=res["verts"])
            bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
            mesh_from_bm(roofob, bm)
            if damage == 1:
                cutter = new_obj("tmp_crc", col)
                bm = bmesh.new()
                outer = w / 2 + eave * 2 + 0.5
                add_box(bm, burn_from * (outer + roof_inner) / 2, 0,
                        H - 1, H + rise + 1.5, outer - roof_inner, d + eave * 2 + 2)
                mesh_from_bm(cutter, bm)
                apply_bool(roofob, cutter)
                bpy.data.objects.remove(cutter, do_unlink=True)
                for _ in range(3):
                    bite = new_obj("tmp_crb", col)
                    bm = bmesh.new()
                    add_box(bm, burn_from * roof_inner + rng.uniform(-0.9, 0),
                            rng.uniform(-d / 2, d / 2), H - 0.5, H + rise + 1,
                            rng.uniform(0.5, 1.1), rng.uniform(0.8, 1.8))
                    mesh_from_bm(bite, bm)
                    apply_bool(roofob, bite)
                    bpy.data.objects.remove(bite, do_unlink=True)
            roofob.data.materials.append(m_roof)
        ridge = new_obj(f"church_ridge_{damage}", col)
        bm = bmesh.new()
        r_lo = -w / 2 if (damage == 0 or burn_from > 0) else burn_from * roof_inner
        r_hi = w / 2 if (damage == 0 or burn_from < 0) else burn_from * roof_inner
        if damage == 1:
            r_lo, r_hi = sorted((-burn_from * w / 2, burn_from * roof_inner - burn_from * 1.0))
        add_box(bm, (r_lo + r_hi) / 2, 0, H + rise - 0.05, H + rise + 0.16,
                max(1.0, r_hi - r_lo), 0.35)
        mesh_from_bm(ridge, bm)
        ridge.data.materials.append(m_roof)
        # east gable triangle above the apse end
        gab = new_obj(f"church_gable_{damage}", col)
        bm = bmesh.new()
        tri = []
        for dx in (-t / 2, t / 2):
            tri.append((bm.verts.new((w / 2 - t / 2 + dx, -d / 2, H - 0.3)),
                        bm.verts.new((w / 2 - t / 2 + dx, d / 2, H - 0.3)),
                        bm.verts.new((w / 2 - t / 2 + dx, 0, H + rise - 0.02))))
        (a0, b0, c0), (a1, b1, c1) = tri
        for f in ((a0, b0, c0), (a1, c1, b1), (a0, a1, b1, b0),
                  (a0, c0, c1, a1), (b0, b1, c1, c0)):
            bm.faces.new(f)
        mesh_from_bm(gab, bm)
        gab.data.materials.append(m_stone)
    # exposed rafters where the roof is gone
    if damage >= 1:
        raf = new_obj(f"church_raf_{damage}", col)
        bm = bmesh.new()
        r_lo = -w / 2 if damage == 2 else min(burn_from * roof_inner, burn_from * w / 2)
        r_hi = w / 2 if damage == 2 else max(burn_from * roof_inner, burn_from * w / 2)
        x = r_lo + 0.4
        while x < r_hi - 0.2:
            if rng.random() < 0.7:
                for side in (-1, 1):
                    mtx = Euler((-side * ang, 0, 0)).to_matrix().to_4x4()
                    mtx.translation = Vector((x, side * (d / 2) / 2, H + rise / 2))
                    res = bmesh.ops.create_cube(bm, size=1.0)
                    bmesh.ops.scale(bm, vec=(0.13, slope_len * 0.9, 0.16),
                                    verts=res["verts"])
                    bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
            x += rng.uniform(0.9, 1.4)
        mesh_from_bm(raf, bm)
        raf.data.materials.append(m_wood)

    # pews + altar (read through the open roof)
    pews = new_obj(f"church_pews_{damage}", col)
    bm = bmesh.new()
    for i in range(5):
        px = -w / 2 + 1.8 + i * 1.15
        if damage == 2 and rng.random() < 0.4:
            add_box(bm, px, rng.uniform(-0.8, 0.8), 0.0, 0.45, 0.5,
                    d * 0.3, rng.uniform(0, 3))
            continue
        for sgn in (-1, 1):
            add_box(bm, px, sgn * d * 0.22, 0.35, 0.5, 0.4, d * 0.34)
            add_box(bm, px - 0.18, sgn * d * 0.22, 0.35, 0.95, 0.07, d * 0.34)
    mesh_from_bm(pews, bm)
    pews.data.materials.append(m_wood)
    alt = new_obj(f"church_altar_{damage}", col)
    bm = bmesh.new()
    add_box(bm, w / 2 - 1.2, 0, 0, 1.05, 0.8, 1.8)
    mesh_from_bm(alt, bm)
    alt.data.materials.append(ph_mat(f"MCA_{damage}", "castle_brick_broken_06",
                                     scale=0.3, tint=(0.5, 0.48, 0.45, 1),
                                     tint_fac=0.5, bump=0.3))
    if damage == 2:
        _mound(col, m_rubble, rng.uniform(-2, 2), rng.uniform(-1, 1),
               rng.uniform(1.6, 2.4), rng.uniform(1.3, 1.9),
               rng.uniform(0.5, 0.8), phase)
        _mound(col, m_rubble, tower_x + rng.uniform(0.5, 1.5), rng.uniform(-1, 1),
               rng.uniform(1.2, 1.8), rng.uniform(1.2, 1.8),
               rng.uniform(0.4, 0.7), phase)
    return col


# ------------------------------------------------------------------ factory
def build_factory(damage, col):
    rng = random.Random(8200 + damage)
    phase = rng.uniform(0, 100)
    w, d, t = 12.0, 7.6, 0.4
    H = 4.8
    m_brick = ph_mat(f"MFB_{damage}", "broken_brick_wall", scale=0.30,
                     tint=(0.16, 0.075, 0.055, 1), tint_fac=0.5, bump=0.55, grime=0.45)
    m_tar = _flat(f"MFT_{damage}", (0.022, 0.022, 0.024), 0.88)
    m_glass = _flat(f"MFG_{damage}", (0.018, 0.028, 0.04), 0.2, 0.4)
    m_wood = ph_mat(f"MFWD_{damage}", "old_planks_02", scale=0.5,
                    tint=(0.15, 0.115, 0.085, 1), tint_fac=0.65, bump=0.4)
    m_rubble = ph_mat(f"MFRB_{damage}", "brick_gravel", scale=0.35,
                      tint=(0.14, 0.10, 0.08, 1), tint_fac=0.45, bump=0.6, grime=0.3)
    m_metal = _flat(f"MFM2_{damage}", (0.03, 0.03, 0.032), 0.5, 0.8)

    shell = new_obj(f"factory_{damage}", col)
    bm = bmesh.new()
    add_box(bm, 0, 0, 0, H, w, d)
    mesh_from_bm(shell, bm)
    inner = new_obj("tmp_fi", col)
    bm = bmesh.new()
    add_box(bm, 0, 0, -0.5, H + 1, w - 2 * t, d - 2 * t)
    mesh_from_bm(inner, bm)
    apply_bool(shell, inner)
    bpy.data.objects.remove(inner, do_unlink=True)
    # industrial window grid: 2 rows, dense
    cut = new_obj("tmp_fw", col)
    bm = bmesh.new()
    for axis in ('S', 'N', 'E', 'W'):
        length = w if axis in 'SN' else d
        n = int((length - 2.4) // 1.7)
        step = (length - 2.4) / max(1, n)
        for i in range(n):
            u = -length / 2 + 1.2 + step * (i + 0.5)
            for z0 in (0.9, 2.9):
                if axis == 'S' and z0 < 1 and i == n // 2:
                    add_box(bm, u, -d / 2, 0, 2.6, 2.0, t * 3)   # big gate
                    continue
                if axis in 'SN':
                    add_box(bm, u, (-d / 2 if axis == 'S' else d / 2),
                            z0, z0 + 1.3, 1.05, t * 3)
                else:
                    add_box(bm, (-w / 2 if axis == 'W' else w / 2), u,
                            z0, z0 + 1.3, t * 3, 1.05)
    mesh_from_bm(cut, bm)
    apply_bool(shell, cut)
    bpy.data.objects.remove(cut, do_unlink=True)
    if damage >= 1:
        for _ in range(damage * 2):
            u = rng.uniform(-w / 2 + 2, w / 2 - 2)
            r = rng.uniform(1.2, 2.4)
            hole = new_obj("tmp_fb", col)
            bm = bmesh.new()
            z0 = rng.uniform(0.3, 2.2)
            add_box(bm, u, rng.choice([-d / 2, d / 2]), z0,
                    z0 + r, r, t * 5, rng.uniform(-0.4, 0.4))
            mesh_from_bm(hole, bm)
            apply_bool(shell, hole)
            bpy.data.objects.remove(hole, do_unlink=True)
    if damage == 2:
        _parity_ruin(shell, col, w, d, H, rng, (0.2, 0.6), phase)
    shell.data.materials.append(m_brick)

    # sawtooth roof: 3 north-light teeth, slope run = full tooth width
    wt = w / 3
    tooth_rise = 1.55
    sl = math.hypot(wt, tooth_rise)
    angT = math.atan2(tooth_rise, wt)
    if damage == 2:
        # the whole roof has come down: trusses lie collapsed ON the rubble,
        # not floating at eave height (the walls are razed to 0.2-0.6*H).
        deb = new_obj(f"fac_rooffall_{damage}", col)
        bm = bmesh.new()
        for _ in range(rng.randint(6, 9)):
            L = rng.uniform(2.8, 4.6)
            px = rng.uniform(-w / 2 + 1.2, w / 2 - 1.2)
            py = rng.uniform(-d / 2 + 1.0, d / 2 - 1.0)
            pz = rng.uniform(0.25, 1.2)
            # mostly fallen flat; a few lean up against a surviving wall stub
            pitch = rng.uniform(-0.3, 0.3) if rng.random() < 0.7 \
                else rng.uniform(0.6, 1.1)
            res = bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(L, 0.12, 0.15), verts=res["verts"])
            m = Euler((rng.uniform(-0.2, 0.2), pitch,
                       rng.uniform(0, 3.14))).to_matrix().to_4x4()
            m.translation = Vector((px, py, pz))
            bmesh.ops.transform(bm, matrix=m, verts=res["verts"])
        mesh_from_bm(deb, bm)
        deb.data.materials.append(m_wood)
        # a couple of buckled roof-panel fragments among the beams
        pan = new_obj(f"fac_roofpanel_{damage}", col)
        bm = bmesh.new()
        for _ in range(rng.randint(2, 3)):
            pw, pl = rng.uniform(1.4, 2.6), rng.uniform(1.6, 3.0)
            px = rng.uniform(-w / 2 + 1.5, w / 2 - 1.5)
            py = rng.uniform(-d / 2 + 1.2, d / 2 - 1.2)
            res = bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(pw, pl, 0.06), verts=res["verts"])
            m = Euler((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4),
                       rng.uniform(0, 3.14))).to_matrix().to_4x4()
            m.translation = Vector((px, py, rng.uniform(0.35, 0.9)))
            bmesh.ops.transform(bm, matrix=m, verts=res["verts"])
        mesh_from_bm(pan, bm)
        pan.data.materials.append(m_tar)
    else:
        for i in range(3):
            x0 = -w / 2 + i * wt
            collapsed = (damage == 1 and i == 1)
            if not collapsed:
                slab = new_obj(f"fac_tooth_{damage}_{i}", col)
                bm = bmesh.new()
                res = bmesh.ops.create_cube(bm, size=1.0)
                bmesh.ops.scale(bm, vec=(sl, d + 0.3, 0.12), verts=res["verts"])
                m = Euler((0, -angT, 0)).to_matrix().to_4x4()
                m.translation = Vector((x0 + wt / 2, 0, H + tooth_rise / 2 + 0.06))
                bmesh.ops.transform(bm, matrix=m, verts=res["verts"])
                mesh_from_bm(slab, bm)
                slab.data.materials.append(m_tar)
                glass = new_obj(f"fac_glass_{damage}_{i}", col)
                bm = bmesh.new()
                add_box(bm, x0 + wt - 0.06, 0, H + 0.06, H + tooth_rise - 0.05,
                        0.09, d - 0.5)
                mesh_from_bm(glass, bm)
                glass.data.materials.append(m_glass)
            else:
                # d1 middle tooth: cladding gone, exposed truss stays at roof
                # height because the shell around it is still full-height
                frame = new_obj(f"fac_frame_{damage}_{i}", col)
                bm = bmesh.new()
                for yy in (-d / 2 + 0.4, 0, d / 2 - 0.4):
                    if rng.random() < 0.75:
                        res = bmesh.ops.create_cube(bm, size=1.0)
                        bmesh.ops.scale(bm, vec=(sl * 0.95, 0.12, 0.14),
                                        verts=res["verts"])
                        m = Euler((0, -angT, 0)).to_matrix().to_4x4()
                        m.translation = Vector((x0 + wt / 2, yy, H + tooth_rise / 2))
                        bmesh.ops.transform(bm, matrix=m, verts=res["verts"])
                mesh_from_bm(frame, bm)
                frame.data.materials.append(m_wood)

    # brick chimney (broken stump + fallen trail at d2)
    ch_x, ch_y = w / 2 - 1.4, d / 2 - 1.4
    ch_h = 9.0 if damage <= 1 else rng.uniform(3.4, 5.2)
    chim = new_obj(f"fac_chim_{damage}", col)
    bm = bmesh.new()
    add_box(bm, ch_x, ch_y, 0, 1.4, 1.7, 1.7)
    add_box(bm, ch_x, ch_y, 1.4, ch_h, 1.25, 1.25)
    if damage <= 1:
        add_box(bm, ch_x, ch_y, ch_h, ch_h + 0.3, 1.5, 1.5)
    mesh_from_bm(chim, bm)
    if damage == 2:      # jagged break
        for _ in range(3):
            cutz = new_obj("tmp_cz", col)
            bm = bmesh.new()
            add_box(bm, ch_x + rng.uniform(-0.6, 0.6), ch_y + rng.uniform(-0.6, 0.6),
                    ch_h - rng.uniform(0.3, 1.0), ch_h + 2,
                    rng.uniform(0.6, 1.1), rng.uniform(0.6, 1.1), rng.uniform(0, 1.5))
            mesh_from_bm(cutz, bm)
            apply_bool(chim, cutz)
            bpy.data.objects.remove(cutz, do_unlink=True)
    chim.data.materials.append(m_brick)
    if damage == 2:      # fallen brick trail
        ta = rng.uniform(0, 6.283)
        _mound(col, m_rubble, ch_x + math.cos(ta) * 2.2, ch_y + math.sin(ta) * 2.2,
               2.6, 1.1, 0.5, phase)

    # machinery inside (visible through collapsed roof)
    mach = new_obj(f"fac_mach_{damage}", col)
    bm = bmesh.new()
    for _ in range(3):
        mx = rng.uniform(-w / 2 + 2, w / 2 - 2)
        my = rng.uniform(-d / 2 + 1.6, d / 2 - 1.6)
        add_box(bm, mx, my, 0, rng.uniform(0.9, 1.5),
                rng.uniform(1.2, 2.0), rng.uniform(0.9, 1.4), rng.uniform(0, 3.14))
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=8,
                                    radius1=0.12, radius2=0.12, depth=1.2)
        bmesh.ops.translate(bm, vec=(mx + 0.4, my, 1.6), verts=res["verts"])
    add_box(bm, 0, -d / 2 + 1.0, 0, 0.85, 4.5, 0.7)      # workbench
    mesh_from_bm(mach, bm)
    mach.data.materials.append(m_metal)
    if damage == 2:
        _mound(col, m_rubble, rng.uniform(-2.5, 2.5), rng.uniform(-1.5, 1.5),
               rng.uniform(1.8, 2.6), rng.uniform(1.4, 2.0),
               rng.uniform(0.5, 0.9), phase)
    return col


if _g3.get("SPECIALS_DEMO", True):
    import os
    os.makedirs(CFG["scratch"], exist_ok=True)
    for (fn, builder) in (("church", build_church), ("factory", build_factory)):
        for dmg in (0, 2):
            colx = get_kit_col(f"XSP_{fn}_{dmg}")
            builder(dmg, colx)
            stage_and_render(colx, 120, CFG["scratch"] + f"/xsp_{fn}_d{dmg}.png",
                             with_catcher=True)
            print("R", fn, dmg)
    print("DONE specials demo")
