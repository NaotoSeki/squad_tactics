# -*- coding: utf-8 -*-
# HexKit green system: cobble<->grass transition tiles for the city outskirts
# (市街地の外周が野原へ溶けるためのエッジマスク遷移。scarと同アーキテクチャ:
#  1ヘックスメッシュ + 頂点属性ブレンド1マテリアル + 「縁で静まる」原則)。
# gen_scar.py が先に exec 済みであること（edge_distance / smoothstep / set_attr /
# scar_mat / SCAR_PATTERNS / hex_grid_mesh / new_obj / get_kit_col を共有）。
import bpy
import bmesh
import json
import math
import random
from mathutils import Vector, Euler, noise

scn = bpy.data.scenes["HexKit"]
CFG = json.loads(scn["hexkit_cfg"])
R = CFG["hex_R"]
INRAD = R * math.sqrt(3) / 2

# くすんだ戦時の野原。tintはリニア値（sRGB感覚で書くと白飛び — 色の教訓参照）。
# grass_medium_01 は接写テクスチャでタイリング反復が丸見えだった（不採用の実績）。
# aerial_grass_rock（空撮フォトグラメトリ）が上空視点の粒度に合う。
GRASS_ASSET = "aerial_grass_rock"
GRASS_TINT = (0.28, 0.34, 0.20, 1)
GRASS_FAC = 0.4
GRASS_SCALE = 0.10


def build_green(pattern, variant, col, asset=None, scale=None, tint=None, fac=None):
    """cobble↔grass 遷移タイル。pattern はscarと同じエッジマスク族
    (e1/e2a/e2o/e3/e4/full)。full=全面草地(基礎タイル gnd_grass 用)。
    scarと違い、砲痕・荒れ地表現は持たない — 穏やかな野原のうねりのみ。"""
    asset = asset or GRASS_ASSET
    mask = SCAR_PATTERNS[pattern]
    rng = random.Random(7300 + variant * 37 + hash(pattern) % 71)
    ph = rng.uniform(0, 80)
    full = (pattern == "full")
    depths = {k: (14.0 if full else rng.uniform(5.5, 8.5)) for k in mask}

    def green_field(p):
        if full:
            return 1.0
        d = 0.0
        for k in mask:
            base = 1 - smoothstep(0.9, depths[k], edge_distance(p, k))
            d = max(d, base)
        wob = noise.noise(Vector((p.x * 0.35 + ph, p.y * 0.35, 1.0)))
        return max(0.0, min(1.0, d + wob * 0.9 * (4 * d * (1 - d)) ** 1.5))

    ob = new_obj(f"grn_{pattern}_{variant}", col)
    hex_grid_mesh(ob, R + 0.4, 6)
    green_vals, scorch_vals = [], []
    for v in ob.data.vertices:
        p = v.co.copy()
        edge_min = min(edge_distance(p, k) for k in range(6))
        rim = max(0.0, min(1.0, edge_min / 1.4))
        rim = rim * rim * (3 - 2 * rim)
        d = green_field(p)
        green_vals.append(d)
        scorch_vals.append(1.0)   # 草地は焦がさない（scar_matのscorch枝を素通し）
        # 石畳0.10 / 草地はわずかに低くフラット寄り + 野原の緩いうねり(縁で静まる)
        z_cob = 0.10 + 0.05 * noise.noise(Vector((p.x * 0.3 + ph, p.y * 0.3, 0))) * rim
        z_grs = 0.06 + 0.10 * noise.noise(Vector((p.x * 0.18 + ph, p.y * 0.18, 7))) * rim \
                     + 0.03 * noise.noise(Vector((p.x * 0.8 + ph, p.y * 0.8, 11))) * rim
        v.co.z = z_cob * (1 - d) + z_grs * d
    for poly in ob.data.polygons:
        poly.use_smooth = True
    set_attr(ob, "dirt", green_vals)
    set_attr(ob, "scorch", scorch_vals)
    # バリアント間で草の模様をずらす（オフセットなしだと full 同士がほぼ同一絵になる）
    ob.data.materials.append(scar_mat(
        f"MGR_{pattern}_{variant}", rng,
        dirt_tint=tint or GRASS_TINT, dirt_asset=asset,
        dirt_scale=scale or GRASS_SCALE, dirt_fac=fac if fac is not None else GRASS_FAC,
        dirt_offset=(rng.uniform(0, 30), rng.uniform(0, 30), 0)))
    return ob


if globals().get("GREEN_DEMO", True):
    import os
    os.makedirs(CFG["scratch"], exist_ok=True)
    col = get_kit_col("GRN_full_0")
    build_green("full", 0, col)
    stage_and_render(col, 0, CFG["scratch"] + "/test_gnd_grass_v0.png", with_catcher=False)
    col = get_kit_col("GRN_full_1")
    build_green("full", 1, col)
    stage_and_render(col, 0, CFG["scratch"] + "/test_gnd_grass_v1.png", with_catcher=False)
    col = get_kit_col("GRN_e2a_0")
    build_green("e2a", 0, col)
    stage_and_render(col, 0, CFG["scratch"] + "/test_grn_e2a_v0.png", with_catcher=False)
    print("DONE green protos")
