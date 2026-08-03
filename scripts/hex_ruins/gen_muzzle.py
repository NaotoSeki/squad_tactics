# -*- coding: utf-8 -*-
# マズルフラッシュ: 4「形状」バリエーション × 2フレーム(pop/fade) = 8枚。
# 単発の減衰アニメではなく、実銃の発射ガス燃焼が毎回不揃いな形になる様子を
# 再現するため独立形状を用意し、連射時はJS側でラウンドロビン切替する
# (2026-07-13 ユーザー要望: 「連射時は高速点滅・発射ガスの燃え方になるので
#  数パターンを高速ラウンドロビン」)。128x128, +X方向へ発射、Phaser側で回転。
# HexKitリグとは独立の "MuzzleKit" シーン: 黒無光ワールド + 真上オルソ +
# エミッシブ花弁メッシュ。ブルームはPIL後処理(Blender 5.0はscene.node_tree廃止)。
# 出力: scratch/muzzle/muzzle_v{0..3}_f{0..1}.png — 後段のPILパッカーでシート化。
import bpy
import bmesh
import math
import os
import random
from mathutils import Vector, Euler, noise

SCRATCH = "C:/Projects/squad_tactics/scratch/muzzle"
os.makedirs(SCRATCH, exist_ok=True)

# ---- scene ----
scn = bpy.data.scenes.get("MuzzleKit")
if scn is None:
    scn = bpy.data.scenes.new("MuzzleKit")
bpy.context.window.scene = scn
scn.render.engine = 'CYCLES'
scn.cycles.samples = 64
scn.cycles.use_denoising = True
scn.render.film_transparent = True
scn.render.resolution_x = 128
scn.render.resolution_y = 128
scn.render.pixel_aspect_x = 1.0
scn.render.image_settings.file_format = 'PNG'
scn.render.image_settings.color_mode = 'RGBA'
scn.view_settings.view_transform = 'Filmic'
scn.view_settings.look = 'None'

world = bpy.data.worlds.get("MZ_World") or bpy.data.worlds.new("MZ_World")
scn.world = world
world.use_nodes = True
for n in world.node_tree.nodes:
    if n.type == 'BACKGROUND':
        n.inputs[0].default_value = (0, 0, 0, 1)
        n.inputs[1].default_value = 0.0

cam_data = bpy.data.cameras.get("MZ_Camera") or bpy.data.cameras.new("MZ_Camera")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.2
cam = bpy.data.objects.get("MZ_Camera")
if cam is None:
    cam = bpy.data.objects.new("MZ_Camera", cam_data)
    scn.collection.objects.link(cam)
cam.location = (0.35, 0, 5.0)   # フラッシュは+X側に伸びるので中心をやや前方へ
cam.rotation_euler = (0, 0, 0)
scn.camera = cam

# ブルームはBlenderコンポジタでなくPIL後処理で付与する
# (Blender 5.0でscene.node_treeが廃止されコンポジタAPIが刷新されたため。
#  ブライトパス抽出→ガウスぼかし→スクリーン加算はPILで同等以上に制御できる)


def emis_mat(name, color, strength):
    mat = bpy.data.materials.get(name)
    if mat:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nd = mat.node_tree.nodes
    nd.clear()
    em = nd.new("ShaderNodeEmission")
    em.inputs[0].default_value = color
    em.inputs[1].default_value = strength
    out = nd.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(em.outputs[0], out.inputs[0])
    return mat


def build_flash(variant, step, col):
    """variant: 独立した燃焼形状の種(0-3、互いに似ない火球配置)。
    step: 0=pop(最大強度) 1=fade(短い減衰、フリッカーの抜けを作る)。
    2026-07-13再修正: 主役は縁をノイズで不揃いにした丸い火球1個だけ(前方サブ
    ローブ・側方噴きは廃止)。ごくまれに(15%)マズルブレーキ/フラッシュ
    ハイダーの吹き出しを思わせる細い一筋だけを覗かせる — 毎回出ると煩いので
    低確率の「たまに見える」演出に留める。"""
    rng = random.Random(100 + variant * 53)   # 形状は variant のみに依存(stepで再現)
    decay = 1.0 if step == 0 else 0.55
    mesh = bpy.data.meshes.new(f"MZ_flash_{variant}_{step}")
    ob = bpy.data.objects.new(f"MZ_flash_{variant}_{step}", mesh)
    col.objects.link(ob)
    bm = bmesh.new()

    def blob(cx, cy, radius, amp, ph):
        """縁をノイズで不揃いにした火球。z=0平面中心(真上カメラで丸く映る)"""
        res = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=radius)
        for v in res["verts"]:
            n = noise.noise(Vector((v.co.x * 3.0 + ph, v.co.y * 3.0, v.co.z * 3.0)))
            v.co += v.co.normalized() * n * amp * radius
        bmesh.ops.translate(bm, vec=(cx, cy, 0), verts=res["verts"])

    # 主火球(唯一の主要形状): 銃口のやや前方。variantごとに半径・位置・縁の乱れを振る
    main_r = rng.uniform(0.32, 0.46)
    blob(main_r * 0.9 + rng.uniform(0.05, 0.15), rng.uniform(-0.05, 0.05),
         main_r * decay, rng.uniform(0.32, 0.48), rng.uniform(0, 50))
    # ごくまれな細い吹き(マズルブレーキのガス漏れ風。丸ではなく細長い一筋)
    if rng.random() < 0.15:
        sgn = 1 if rng.random() < 0.5 else -1
        length = rng.uniform(0.35, 0.55) * decay
        width = 0.035 * decay
        ang = sgn * rng.uniform(35, 55)
        res = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(length, width, 0.04), verts=res["verts"])
        bmesh.ops.translate(bm, vec=(length / 2, 0, 0), verts=res["verts"])
        for v in res["verts"]:
            t = max(0.0, v.co.x / max(length, 1e-6))
            v.co.y *= (1.0 - 0.8 * t)
        mtx = Euler((0, 0, math.radians(ang))).to_matrix().to_4x4()
        mtx.translation = Vector((main_r * 0.3, 0, 0))
        bmesh.ops.transform(bm, matrix=mtx, verts=res["verts"])
    # コア球(銃口位置、白飛びさせてブルームの種にする)
    bmesh.ops.create_icosphere(bm, subdivisions=2,
                               radius=(0.10 + rng.uniform(0, 0.03)) * decay + 0.025)
    bm.to_mesh(mesh)
    bm.free()
    strength = 55 if step == 0 else 22
    ob.data.materials.append(emis_mat(f"MZM_{variant}_{step}", (1.0, 0.78, 0.42, 1.0), strength))
    return ob


# ---- render 4 variants x 2 steps = 8 frames ----
kit = bpy.data.collections.get("MZ_KIT")
if kit is None:
    kit = bpy.data.collections.new("MZ_KIT")
    scn.collection.children.link(kit)
for variant in range(4):
    for step in range(2):
        for o in list(kit.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        build_flash(variant, step, kit)
        scn.render.filepath = f"{SCRATCH}/muzzle_v{variant}_f{step}.png"
        bpy.ops.render.render(write_still=True, scene="MuzzleKit")
        print(f"R muzzle_v{variant}_f{step}")
print("MUZZLE DONE")
