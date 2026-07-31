# -*- coding: utf-8 -*-
# HexKit scar system: cobble<->wasteland transition ground tiles (edge-mask
# family, the 3D successor of hex_trans_*_d0..5) and the 2-hex big-crater
# set piece (two tiles sampling ONE shared displacement field -> exact seam).
# Expects gen_extras.py (and thus gen_ground.py) already exec'd into globals.
import bpy
import bmesh
import json
import math
import random
from mathutils import Vector, Euler, noise

_g2 = globals()
scn = bpy.data.scenes["HexKit"]
CFG = json.loads(scn["hexkit_cfg"])
R = CFG["hex_R"]
INRAD = R * math.sqrt(3) / 2

# edge masks up to rotation; composer rotates to fit the actual neighbourhood
SCAR_PATTERNS = {
    "e1": (0,), "e2a": (0, 1), "e2o": (0, 3),
    "e3": (0, 1, 2), "e4": (0, 1, 2, 3), "full": (0, 1, 2, 3, 4, 5),
}
# Stable integer seeds: legacy v0/v1 retain their original appearance while
# the extra variants use well-separated streams to avoid look-alike craters.
CPAIR_VARIANT_SEEDS = {
    0: 5200, 1: 5201, 2: 15731, 3: 24439,
}


def edge_dir(k):
    a = math.radians(60 * k)
    return Vector((math.cos(a), math.sin(a), 0))


def edge_distance(p, k):
    """Perpendicular distance from p to hex edge line k (positive inside)."""
    return INRAD - (p.x * math.cos(math.radians(60 * k))
                    + p.y * math.sin(math.radians(60 * k)))


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def scar_mat(name, rng, dirt_tint=(0.09, 0.07, 0.05, 1),
             dirt_asset="brick_gravel", dirt_scale=0.45, dirt_fac=0.6,
             dirt_offset=None):
    """One material, two PBR branches (cobble / second surface) mixed by the
    per-vertex 'dirt' attribute. Also used for asphalt roads.
    dirt_offset: 第2面のボックス投影オフセット。バリアント間で模様をずらす
    （None=従来動作。既存タイルの再現性を守るため既定は変えない）。"""
    mat = bpy.data.materials.get(name)
    if mat:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nd, lk = mat.node_tree.nodes, mat.node_tree.links
    nd.clear()
    out = nd.new("ShaderNodeOutputMaterial")
    co = nd.new("ShaderNodeTexCoord")

    def branch(asset, scale, tint, tint_fac, bump_s, rough_fallback,
               grime=0.0, scorch_attr=None, offset=None):
        b = nd.new("ShaderNodeBsdfPrincipled")
        mp = nd.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (scale,) * 3
        if offset:
            mp.inputs["Location"].default_value = offset
        lk.new(co.outputs["Object"], mp.inputs["Vector"])
        imgs = ph_images(asset)
        if "diff" in imgs:
            t = box_tex(nd, lk, imgs["diff"], mp.outputs["Vector"], "sRGB")
            mix = nd.new("ShaderNodeMix")
            mix.data_type = 'RGBA'
            mix.inputs["Factor"].default_value = tint_fac
            lk.new(t.outputs["Color"], mix.inputs["A"])
            mix.inputs["B"].default_value = tint
            col_out = mix.outputs["Result"]
            if "ao" in imgs:
                ao = box_tex(nd, lk, imgs["ao"], mp.outputs["Vector"], "Non-Color")
                m2 = nd.new("ShaderNodeMix")
                m2.data_type = 'RGBA'
                m2.blend_type = 'MULTIPLY'
                m2.inputs["Factor"].default_value = 0.6
                lk.new(col_out, m2.inputs["A"])
                lk.new(ao.outputs["Color"], m2.inputs["B"])
                col_out = m2.outputs["Result"]
            if grime > 0.0:
                gn = nd.new("ShaderNodeTexNoise")
                gn.inputs["Scale"].default_value = 0.35
                gn.inputs["Detail"].default_value = 4.0
                lk.new(co.outputs["Object"], gn.inputs["Vector"])
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
            if scorch_attr:
                vc2 = nd.new("ShaderNodeVertexColor")
                vc2.layer_name = scorch_attr
                sm = nd.new("ShaderNodeMix")
                sm.data_type = 'RGBA'
                sm.blend_type = 'MULTIPLY'
                sm.inputs["Factor"].default_value = 1.0
                lk.new(col_out, sm.inputs["A"])
                lk.new(vc2.outputs["Color"], sm.inputs["B"])
                col_out = sm.outputs["Result"]
            lk.new(col_out, b.inputs["Base Color"])
        if "rough" in imgs:
            t = box_tex(nd, lk, imgs["rough"], mp.outputs["Vector"], "Non-Color")
            lk.new(t.outputs["Color"], b.inputs["Roughness"])
        else:
            b.inputs["Roughness"].default_value = rough_fallback
        if "disp" in imgs:
            t = box_tex(nd, lk, imgs["disp"], mp.outputs["Vector"], "Non-Color")
            bmp = nd.new("ShaderNodeBump")
            bmp.inputs["Strength"].default_value = bump_s
            lk.new(t.outputs["Color"], bmp.inputs["Height"])
            lk.new(bmp.outputs["Normal"], b.inputs["Normal"])
        return b

    b_cob = branch("cobblestone_floor_01", 0.35, (0.5, 0.49, 0.47, 1), 0.25,
                   0.7, 0.9, grime=0.45)
    b_dirt = branch(dirt_asset, dirt_scale, dirt_tint, dirt_fac, 0.8, 0.95,
                    grime=0.4, scorch_attr="scorch", offset=dirt_offset)
    vc = nd.new("ShaderNodeVertexColor")
    vc.layer_name = "dirt"
    ramp = nd.new("ShaderNodeMapRange")     # sharpen the blend band a touch
    ramp.inputs["From Min"].default_value = 0.25
    ramp.inputs["From Max"].default_value = 0.75
    ramp.clamp = True
    lk.new(vc.outputs["Color"], ramp.inputs["Value"])
    mx = nd.new("ShaderNodeMixShader")
    lk.new(ramp.outputs["Result"], mx.inputs["Fac"])
    lk.new(b_cob.outputs[0], mx.inputs[1])
    lk.new(b_dirt.outputs[0], mx.inputs[2])
    lk.new(mx.outputs[0], out.inputs["Surface"])
    return mat


def set_attr(ob, name, vals):
    attr = ob.data.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    for i, f in enumerate(vals):
        attr.data[i].color = (f, f, f, 1.0)


def build_scar(pattern, variant, col):
    """Ground tile: cobble hex with wasteland dirt occupying the masked edges.
    Dirt fully covers masked edges (flat, standard), goes wild only inside."""
    mask = SCAR_PATTERNS[pattern]
    rng = random.Random(4000 + variant * 31 + hash(pattern) % 61)
    ph = rng.uniform(0, 80)
    full = (pattern == "full")
    depths = {k: (14.0 if full else rng.uniform(5.5, 8.5)) for k in mask}
    # shell holes confined to the future dirt zone, away from all edges
    holes = []
    if pattern != "e1":
        for _ in range(rng.randint(2, 4)):
            for _try in range(14):
                a = rng.uniform(0, 6.283)
                rr = rng.random() ** 0.5 * (INRAD - 3.2)
                hx, hy = math.cos(a) * rr, math.sin(a) * rr
                hr = rng.uniform(1.2, 2.5)
                p = Vector((hx, hy, 0))
                if min(edge_distance(p, k) for k in range(6)) < hr + 1.3:
                    continue
                dd = max(1 - edge_distance(p, k) / depths[k] for k in mask)
                if dd > 0.55 and all((hx - o[0]) ** 2 + (hy - o[1]) ** 2 >
                                     (hr + o[2]) ** 2 for o in holes):
                    holes.append((hx, hy, hr, rng.uniform(0.7, 1.3)))
                    break

    def dirt_field(p):
        if full:
            return 1.0
        d = 0.0
        for k in mask:
            base = 1 - smoothstep(0.9, depths[k], edge_distance(p, k))
            d = max(d, base)
        wob = noise.noise(Vector((p.x * 0.35 + ph, p.y * 0.35, 1.0)))
        d = max(0.0, min(1.0, d + wob * 0.9 * (4 * d * (1 - d)) ** 1.5))
        for j in range(6):
            if j not in mask:
                d *= smoothstep(0.3, 1.5, edge_distance(p, j))
        for k in mask:                     # re-assert full dirt at masked rims
            d = max(d, 1 - smoothstep(0.6, 1.4, edge_distance(p, k)))
        return d

    ob = new_obj(f"scar_{pattern}_{variant}", col)
    hex_grid_mesh(ob, R + 0.3, 7)     # bleed past the hex so AA edges overlap
    dirt_vals, scorch_vals = [], []
    for v in ob.data.vertices:
        p = v.co.copy()
        d = dirt_field(p)
        dirt_vals.append(d)
        edge_min = min(edge_distance(p, k) for k in range(6))
        rim = smoothstep(0.0, 1.2, edge_min)     # everything calms at the rim
        z_cob = 0.10 + 0.05 * noise.noise(
            Vector((p.x * 0.3 + ph, p.y * 0.3, 0))) * rim
        z_dirt = 0.10 + (0.28 * noise.noise(Vector((p.x * 0.9 + ph, p.y * 0.9, 3)))
                         + 0.08 * noise.noise(Vector((p.x * 2.6 + ph, p.y * 2.6, 5)))) * rim
        sc = 1.0
        for (hx, hy, hr, hd) in holes:
            t = math.hypot(p.x - hx, p.y - hy) / hr
            if t < 1.0:
                z_dirt -= hd * (1 - t * t) ** 1.3
                sc = min(sc, 0.25 + 0.75 * t * t)
            elif t < 1.45:
                z_dirt += 0.22 * hd * (1 - (t - 1.0) / 0.45)
        scorch_vals.append(sc)
        v.co.z = z_cob * (1 - d) + z_dirt * d
    for poly in ob.data.polygons:
        poly.use_smooth = True
    set_attr(ob, "dirt", dirt_vals)
    set_attr(ob, "scorch", scorch_vals)
    ob.data.materials.append(scar_mat(f"MSC_{pattern}_{variant}", rng))

    # debris strewn over the dirt zone
    m_bits = ph_mat(f"MSB_{pattern}_{variant}", "broken_brick_wall", scale=0.5,
                    tint=(0.20, 0.12, 0.085, 1), tint_fac=0.5, bump=0.5)
    bits = new_obj(f"scar_bits_{pattern}_{variant}", col)
    bm = bmesh.new()
    for _ in range(160):
        a = rng.uniform(0, 6.283)
        rr = rng.random() ** 0.5 * (INRAD - 0.7)
        px, py = math.cos(a) * rr, math.sin(a) * rr
        p = Vector((px, py, 0))
        d = dirt_field(p)
        if rng.random() > d * 0.8:
            continue
        z = 0.16
        for (hx, hy, hr, hd) in holes:
            t = math.hypot(px - hx, py - hy) / hr
            if t < 1.0:
                z -= hd * (1 - t * t) ** 1.3
        sz = rng.uniform(0.5, 1.3)
        add_box_at(bm, 0.26 * sz, 0.13 * sz, 0.09 * sz, (px, py, z),
                   (rng.uniform(0, 3), rng.uniform(0, 3), rng.uniform(0, 3)))
    bm.to_mesh(bits.data)
    bm.free()
    bits.data.materials.append(m_bits)


# ------------------------------------------------------------- roads v3
# Roads are scar-architecture too: ONE ground mesh, cobble<->asphalt blended
# by vertex attribute. No floating strip => no end-face shadow lines, no
# overlap AA seams, no z-steps at tile boundaries. Damage = shallow dents +
# subtle stain darkening (no black geometry).
def _seg_dist(p, a, b):
    """(perp distance, along-length param) from p to segment a-b."""
    a = Vector((a[0], a[1], 0))
    b = Vector((b[0], b[1], 0))
    ab = b - a
    L = ab.length
    t = max(0.0, min(1.0, (p - a).dot(ab) / (L * L)))
    return ((p - (a + ab * t)).length, t * L)


def build_road(pattern, variant, col, dmg=None):
    """dmg=None: 既存タイルの再現（従来動作そのまま — 乱数列も不変）。
    dmg=1: 荒れた路面 — デント増・焦げ・散乱瓦礫（「瓦礫が舞った道路」）
    dmg=2: 寸断路 — 深い着弾クレーター＋縁の土手＋重瓦礫（「壊れた道路」）
    出力命名は road_<pat>_v<n>_d<dmg>_rot<r>.png（d0=既存の無印ファイル）。"""
    seed_extra = 0 if dmg is None else dmg * 7919
    rng = random.Random(1200 + variant * 13 + hash(pattern) % 97 + seed_extra)
    ph = rng.uniform(0, 50)

    def ext(k):
        a = math.radians(60 * k)
        return ((INRAD + 1.2) * math.cos(a), (INRAD + 1.2) * math.sin(a))

    segs = {"straight": [(ext(3), ext(0))],
            "corner": [(ext(0), (0, 0)), ((0, 0), ext(2))],
            "tee": [(ext(3), ext(0)), ((0, 0), ext(2))],
            "cross": [(ext(3), ext(0)), (ext(5), ext(2))]}[pattern]
    halfw = 2.6
    if dmg is None:
        damaged = (pattern == "straight" and variant >= 2) or \
                  (pattern == "corner" and variant >= 2)
        n_dents = rng.randint(2, 4) if damaged else 0
        dent_depth = (0.05, 0.10)
    elif dmg == 1:
        n_dents = rng.randint(4, 6)
        dent_depth = (0.09, 0.16)
    else:
        n_dents = rng.randint(3, 5)
        dent_depth = (0.10, 0.18)
    dents = []
    for _ in range(n_dents):
        for _try in range(16):
            (a, b) = segs[rng.randrange(len(segs))]
            t = rng.uniform(0.25, 0.75)
            px = a[0] + (b[0] - a[0]) * t + rng.uniform(-1.4, 1.4)
            py = a[1] + (b[1] - a[1]) * t + rng.uniform(-1.4, 1.4)
            dr = rng.uniform(0.55, 1.1)
            p = Vector((px, py, 0))
            if min(edge_distance(p, k) for k in range(6)) < dr + 1.5:
                continue
            if min(_seg_dist(p, aa, bb)[0] for (aa, bb) in segs) < halfw - dr:
                dents.append((px, py, dr, rng.uniform(*dent_depth)))
                break

    # d2: 道路を寸断する深い着弾クレーター。縁は盛り上がる。
    # タイル境界の面一を壊さないよう、縁土手込みでヘックス辺から離して置く。
    # 「ヘックス中央の模様」化を避ける: 中心2m以内は禁止、線分全域+横ズレ大で
    # 道から半分外れる至近弾も許可、サイズも小〜大で散らす
    craters = []
    if dmg == 2:
        n_main = rng.randint(1, 2)
        n_sat = 1 if rng.random() < 0.5 else 0   # 小型のサテライト弾痕
        for i in range(n_main + n_sat):
            small = i >= n_main
            for _try in range(30):
                (a, b) = segs[rng.randrange(len(segs))]
                t = rng.uniform(0.12, 0.88)
                cx = a[0] + (b[0] - a[0]) * t + rng.uniform(-1.6, 1.6)
                cy = a[1] + (b[1] - a[1]) * t + rng.uniform(-1.6, 1.6)
                cr = rng.uniform(0.9, 1.4) if small else rng.uniform(1.4, 2.7)
                p = Vector((cx, cy, 0))
                if math.hypot(cx, cy) < 2.0:      # 中央メダリオン化の禁止
                    continue
                if min(edge_distance(p, k) for k in range(6)) < cr + 1.8:
                    continue
                if all((cx - o[0]) ** 2 + (cy - o[1]) ** 2 > (cr + o[2]) ** 2
                       for o in craters):
                    craters.append((cx, cy, cr,
                                    rng.uniform(0.5, 0.7) if small else rng.uniform(0.9, 1.3)))
                    break

    sfx = f"_d{dmg}" if dmg else ""
    ob = new_obj(f"road_{pattern}_{variant}{sfx}", col)
    hex_grid_mesh(ob, R + 0.3, 7)     # bleed past the hex so AA edges overlap
    road_vals, scorch_vals = [], []
    for v in ob.data.vertices:
        p = v.co.copy()
        edge_min = min(edge_distance(p, k) for k in range(6))
        rim = smoothstep(0.0, 2.0, edge_min)
        best = 99.0
        for i, (a, b) in enumerate(segs):
            dperp, along = _seg_dist(p, a, b)
            wob = noise.noise(Vector((along * 0.45 + ph, i * 7.3, 1.0)))
            hw = halfw * (1 + 0.30 * wob * rim)
            best = min(best, dperp - hw)
        D = 1 - smoothstep(-0.45, 0.35, best)
        road_vals.append(D)
        # cobble undulation also calms at the rim -> no shading step between
        # neighbouring tiles
        z_cob = 0.10 + 0.05 * noise.noise(
            Vector((p.x * 0.3 + ph, p.y * 0.3, 0))) * rim
        z_road = 0.055 + 0.025 * noise.noise(Vector((p.x * 0.8 + ph, p.y * 0.8, 5))) * rim
        sc = 1.0
        for (dx, dy, dr, dd) in dents:
            t = math.hypot(p.x - dx, p.y - dy) / dr
            if t < 1.0:
                z_road -= dd * (1 - t * t) ** 1.5
                sc = min(sc, 0.55 + 0.45 * t * t)
        z = z_cob * (1 - D) + z_road * D
        for (cx, cy, cr, cd) in craters:
            dd_ = math.hypot(p.x - cx, p.y - cy)
            if dd_ < cr:
                t = dd_ / cr
                z -= cd * (1 - t * t) ** 1.4          # bowl
                sc = min(sc, 0.22 + 0.55 * t)          # 中心ほど焦げる
            elif dd_ < cr + 1.3:
                z += 0.32 * (1 - (dd_ - cr) / 1.3)     # rim lip
                sc = min(sc, 0.7)
        scorch_vals.append(sc)
        v.co.z = z
    for poly in ob.data.polygons:
        poly.use_smooth = True
    set_attr(ob, "dirt", road_vals)
    set_attr(ob, "scorch", scorch_vals)
    ob.data.materials.append(scar_mat(
        f"MRD3_{pattern}_{variant}{sfx}", rng, dirt_tint=(0.28, 0.27, 0.25, 1),
        dirt_asset="road_damaged", dirt_scale=ROAD_TEX_SCALE, dirt_fac=0.45))

    # 損傷段では瓦礫を散布（d1=まばら / d2=クレーター縁に集中＋全体に重め）
    if dmg:
        m_bits = ph_mat(f"MRDB_{pattern}_{variant}{sfx}", "broken_brick_wall",
                        scale=0.5, tint=(0.22, 0.14, 0.10, 1), tint_fac=0.5, bump=0.5)
        bits = new_obj(f"road_bits_{pattern}_{variant}{sfx}", col)
        bm = bmesh.new()
        n_bits = 45 if dmg == 1 else 100
        for _ in range(n_bits):
            (a, b) = segs[rng.randrange(len(segs))]
            t = rng.uniform(0.05, 0.95)
            px = a[0] + (b[0] - a[0]) * t + rng.uniform(-halfw * 1.2, halfw * 1.2)
            py = a[1] + (b[1] - a[1]) * t + rng.uniform(-halfw * 1.2, halfw * 1.2)
            if min(edge_distance(Vector((px, py, 0)), k) for k in range(6)) < 0.6:
                continue
            z = 0.12
            for (cx, cy, cr, cd) in craters:
                dd_ = math.hypot(px - cx, py - cy)
                if dd_ < cr:
                    z -= cd * (1 - (dd_ / cr) ** 2) ** 1.4
            sz = rng.uniform(0.5, 1.4)
            add_box_at(bm, 0.26 * sz, 0.13 * sz, 0.09 * sz, (px, py, z),
                       (rng.uniform(0, 3), rng.uniform(0, 3), rng.uniform(0, 3)))
        if dmg == 2:
            for (cx, cy, cr, cd) in craters:
                for _ in range(50):
                    ang = rng.uniform(0, 6.283)
                    rr = cr + rng.uniform(-0.3, 1.5)
                    px, py = cx + math.cos(ang) * rr, cy + math.sin(ang) * rr
                    if min(edge_distance(Vector((px, py, 0)), k) for k in range(6)) < 0.6:
                        continue
                    rim_h = 0.32 * max(0.0, 1 - abs(rr - cr) / 1.4)
                    sz = rng.uniform(0.4, 1.1)
                    add_box_at(bm, 0.26 * sz, 0.13 * sz, 0.09 * sz,
                               (px, py, rim_h + 0.06),
                               (rng.uniform(0, 3), rng.uniform(0, 3), rng.uniform(0, 3)))
        bm.to_mesh(bits.data)
        bm.free()
        bits.data.materials.append(m_bits)


# ------------------------------------------------------- seam-breaker patch
def build_dirtpatch(variant, col):
    """ヘックス境目を砕くシームブレーカー土パッチ(透過オーバーレイ)。
    スカーの土と同素材(brick_gravel+暗tint)。中心アンカーに直径3.5-5mの
    平たい土盛り+小瓦礫。実行時にスカー境界のエッジ中点/3タイル頂点へ
    ピクセルオフセット配置する(ミリタリー投影は平面図が無歪なので
    world→screenは線形換算で済む)。回転レンダー不要(丸形+焼き込み陰影は
    どの位置でも整合)。"""
    rng = random.Random(8600 + variant * 41)
    ph = rng.uniform(0, 80)
    m_dirt = ph_mat(f"MDP_{variant}", "brick_gravel", scale=0.45,
                    tint=(0.09, 0.07, 0.05, 1), tint_fac=0.6, bump=0.8, grime=0.4)
    ob = new_obj(f"dirtpatch_{variant}", col)
    bm = bmesh.new()
    res = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    rx = rng.uniform(1.7, 2.4)
    ry = rng.uniform(1.5, 2.2)
    bmesh.ops.scale(bm, vec=(rx, ry, 0.5), verts=res["verts"])
    for v in res["verts"]:
        n = noise.noise(Vector((v.co.x * 0.9 + ph, v.co.y * 0.9, v.co.z)))
        v.co += v.co.normalized() * n * 0.55
        if v.co.z < 0:
            v.co.z *= 0.05
        v.co.z *= 0.35
    bm.to_mesh(ob.data)
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.materials.append(m_dirt)
    m_bits = ph_mat(f"MDPB_{variant}", "broken_brick_wall", scale=0.5,
                    tint=(0.20, 0.12, 0.085, 1), tint_fac=0.5, bump=0.5)
    bits = new_obj(f"dirtpatch_bits_{variant}", col)
    bm = bmesh.new()
    for _ in range(22):
        a = rng.uniform(0, 6.283)
        rr = rng.random() ** 0.5
        sz = rng.uniform(0.4, 0.9)
        add_box_at(bm, 0.26 * sz, 0.13 * sz, 0.09 * sz,
                   (math.cos(a) * rx * rr * 1.25, math.sin(a) * ry * rr * 1.25, 0.12),
                   (rng.uniform(0, 3), rng.uniform(0, 3), rng.uniform(0, 3)))
    bm.to_mesh(bits.data)
    bm.free()
    bits.data.materials.append(m_bits)


# ------------------------------------------------------------- crater pair
def _pair_field(rng):
    """Shared world-space displacement field for the 2-hex crater set piece.
    Tile A sits at origin, tile B east at (2*INRAD, 0)."""
    ph = rng.uniform(0, 90)
    cxw, cyw = INRAD, rng.uniform(-1.0, 1.0)
    a_ax = rng.uniform(6.4, 7.4)          # ellipse semi-axes: elongated E-W
    b_ax = rng.uniform(4.6, 5.4)
    rot = rng.uniform(-0.35, 0.35)
    depth = rng.uniform(2.1, 2.6)
    sats = []
    for _ in range(rng.randint(2, 3)):
        sa = rng.uniform(0, 6.283)
        sr = rng.uniform(0.55, 0.8)
        sats.append((cxw + math.cos(sa) * a_ax * sr * 1.35,
                     cyw + math.sin(sa) * b_ax * sr * 1.35,
                     rng.uniform(1.3, 2.2), rng.uniform(0.5, 1.0)))
    ca, sa_ = math.cos(rot), math.sin(rot)

    def hex_inset(px, py, cx, skip_k):
        """Distance inward from hex boundary around (cx,0), IGNORING the
        shared edge (skip_k) — it is interior to the pair, not an outline."""
        p = Vector((px - cx, py, 0))
        return min(edge_distance(p, k) for k in range(6) if k != skip_k)

    def field(px, py):
        ins = max(hex_inset(px, py, 0.0, 0), hex_inset(px, py, 2 * INRAD, 3))
        calm = smoothstep(0.0, 1.5, ins)
        z = 0.10 + (0.14 * noise.noise(Vector((px * 0.8 + ph, py * 0.8, 3)))
                    + 0.05 * noise.noise(Vector((px * 2.4 + ph, py * 2.4, 5)))) * calm
        # main elongated bowl, noisy radius
        ux = ((px - cxw) * ca + (py - cyw) * sa_) / a_ax
        uy = (-(px - cxw) * sa_ + (py - cyw) * ca) / b_ax
        t = math.hypot(ux, uy)
        t *= 1.0 + 0.22 * noise.noise(Vector((math.atan2(uy, ux) * 1.6 + ph, 7.7, 0)))
        if t < 1.0:
            z -= depth * (1 - t * t) ** 1.35 * calm
        elif t < 1.30:
            z += 0.5 * (1 - (t - 1.0) / 0.30) * calm
        for (sx, sy, sr, sd) in sats:
            st = math.hypot(px - sx, py - sy) / sr
            if st < 1.0:
                z -= sd * (1 - st * st) ** 1.3 * calm
            elif st < 1.4:
                z += 0.2 * sd * (1 - (st - 1.0) / 0.4) * calm
        return max(z, -depth + 0.08)

    def scorch(px, py):
        ux = ((px - cxw) * ca + (py - cyw) * sa_) / a_ax
        uy = (-(px - cxw) * sa_ + (py - cyw) * ca) / b_ax
        return smoothstep(0.35, 1.25, math.hypot(ux, uy))

    return field, scorch, (cxw, cyw, a_ax, b_ax, rot, ph)


def build_crater_pair(variant, col):
    """ONE scene holding both member hexes of the 2-hex crater (tile A at the
    origin, tile B east at (2*INRAD,0)). Rendered twice with a stage offset —
    overlapping pixels are identical and shadows stay continuous, so the two
    tiles reassemble seamlessly in the composite."""
    seed = CPAIR_VARIANT_SEEDS.get(variant, 5200 + variant * 7919)
    rng = random.Random(seed)
    field, scorch, meta = _pair_field(rng)
    (cxw, cyw, a_ax, b_ax, rot, ph) = meta
    # ONE welded mesh across both hexes — separate sheets would compute
    # smooth normals per object and shade a visible stripe at the shared edge
    ob = new_obj(f"cpair_{variant}", col)
    hex_grid_mesh(ob, R, 7)
    tmp = new_obj(f"cpair_tmp_{variant}", col)
    hex_grid_mesh(tmp, R, 7)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for v in bm.verts:
        pass
    off_verts = bmesh.new()
    off_verts.from_mesh(tmp.data)
    bmesh.ops.translate(off_verts, vec=(2 * INRAD, 0, 0), verts=off_verts.verts[:])
    tmp_me = bpy.data.meshes.new("cpair_off")
    off_verts.to_mesh(tmp_me)
    off_verts.free()
    bm.from_mesh(tmp_me)
    bpy.data.meshes.remove(tmp_me)
    bpy.data.objects.remove(tmp, do_unlink=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    bm.to_mesh(ob.data)
    bm.free()
    dirt_vals, scorch_vals = [], []
    for v in ob.data.vertices:
        wx, wy = v.co.x, v.co.y
        v.co.z = field(wx, wy)
        dirt_vals.append(1.0)             # all-dirt: sits inside scar blobs
        scorch_vals.append(0.25 + 0.75 * scorch(wx, wy))
    for poly in ob.data.polygons:
        poly.use_smooth = True
    set_attr(ob, "dirt", dirt_vals)
    set_attr(ob, "scorch", scorch_vals)
    ob.data.materials.append(scar_mat(f"MCP_{variant}", rng))

    # debris ring around the rim, built once in world space
    m_bits = ph_mat(f"MCPB_{variant}", "broken_brick_wall", scale=0.5,
                    tint=(0.18, 0.11, 0.08, 1), tint_fac=0.5, bump=0.5)
    bits = new_obj(f"cpair_bits_{variant}", col)
    bm = bmesh.new()
    for _ in range(240):
        aa = rng.uniform(0, 6.283)
        tt = rng.uniform(0.95, 1.45)
        wx = cxw + math.cos(rot) * math.cos(aa) * a_ax * tt \
            - math.sin(rot) * math.sin(aa) * b_ax * tt
        wy = cyw + math.sin(rot) * math.cos(aa) * a_ax * tt \
            + math.cos(rot) * math.sin(aa) * b_ax * tt
        in_a = min(edge_distance(Vector((wx, wy, 0)), k) for k in range(6)) > -0.5
        in_b = min(edge_distance(Vector((wx - 2 * INRAD, wy, 0)), k)
                   for k in range(6)) > -0.5
        if not (in_a or in_b):
            continue
        z = field(wx, wy) + 0.07
        add_box_at(bm, 0.26 * rng.uniform(0.5, 1.4), 0.13, 0.09, (wx, wy, z),
                   (rng.uniform(0, 3), rng.uniform(0, 3), rng.uniform(0, 3)))
    bm.to_mesh(bits.data)
    bm.free()
    bits.data.materials.append(m_bits)


def render_crater_pair(col, out_prefix, rots=(0, 60, 120)):
    """Render both member tiles at each pair orientation."""
    for k in rots:
        a = math.radians(k)
        stage_and_render(col, k, f"{out_prefix}_a_rot{k}.png", with_catcher=False)
        stage_and_render(col, k, f"{out_prefix}_b_rot{k}.png", with_catcher=False,
                         loc=(-2 * INRAD * math.cos(a), -2 * INRAD * math.sin(a), 0))


# ---------------------------------------------------------------- demo
if _g2.get("SCAR_DEMO", True):
    import os
    os.makedirs(CFG["scratch"], exist_ok=True)
    tests = []
    for pat in ("e1", "e2a", "e3", "full"):
        col = get_kit_col(f"XS_{pat}")
        build_scar(pat, 0, col)
        tests.append((f"XS_{pat}", f"xs_{pat}.png"))
    for (cn, fn) in tests:
        stage_and_render(bpy.data.collections[cn], 0, CFG["scratch"] + "/" + fn,
                         with_catcher=False)
        print("R", fn)
    col_p = get_kit_col("XS_cp")
    build_crater_pair(0, col_p)
    render_crater_pair(col_p, CFG["scratch"] + "/xs_cpair", rots=(0,))
    print("R xs_cpair a/b")
    print("DONE scar demo")
