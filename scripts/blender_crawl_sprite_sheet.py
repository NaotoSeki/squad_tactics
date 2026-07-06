# SPDX-License-Identifier: MIT
"""
Blender 用: 45°俯瞰ビューから兵士の各アクションを
8方向分レンダし、アクションごとに1枚のスプライトシート PNG に合成するスクリプト。

使い方:
  1. Blender で該当シーンを開く（カメラ・兵士リグ・アニメーションが入っていること）
  2. 下の CONFIG を編集（アーマチュア名・カメラ名・render_jobs など）
  3. Blender の「スクリプト」ワークスペースでこのファイルを開き「スクリプトを実行」

出力:
  - 指定フォルダに 1 枚の PNG（横 8 方向 × 縦 フレーム数、各セル 256×256）
  - レイアウト: 横 = 方向（0°～315°）、縦 = 時間（1 フレーム目が上）、兵士は正立
"""

import bpy
import math
import os
import tempfile

# ============== ここを編集 ==============
CONFIG = {
    # 兵士のアーマチュアオブジェクト名（アウトライナーで確認）
    "armature_name": "Armature",
    # 8方向用に Z 回転させるオブジェクト（None = アーマチュア）。親の Empty で向きを変えている場合はその名前を指定
    "direction_rotation_object": None,
    # 45°俯瞰用カメラ名（未設定ならシーン内のアクティブカメラを使用）
    "camera_name": None,
    # レンダするフレーム範囲（None ならシーンの frame_start / frame_end を使用）
    "frame_start": None,
    "frame_end": None,
    # 1方向あたりの最大フレーム数（None なら全フレーム）。30 で約30fps・軽量（58f→30f に間引き）
    "max_frames_per_direction": 30,
    # 1 フレームあたりの解像度（256 で軽め・小さめ、512 で高解像）
    "cell_size": 256,
    # 出力 PNG のパス（None なら blend ファイルと同じフォルダに sprite_sheet_crawl.png）
    "output_path": None,
    # 複数動作を一括出力したいときは、下のようにジョブを列挙（None なら従来どおり frame_start/frame_end を使う）
    # action: Blender 上のアクション名（例: "Stand.Idle"）。指定するとそのアクションに切り替えてレンダ。
    #         frame_start/frame_end を省略すると、アクションのフレーム範囲を自動取得する。
    # "render_jobs": [
    #     {"name": "stand_idle",    "action": "Stand.Idle"},
    #     {"name": "stand_forward", "action": "Stand.Forward", "max_frames_per_direction": 20},
    #     {"name": "stand_fire",    "action": "Stand.Fire"},
    #     {"name": "kneel_idle",    "action": "Kneel.Idle"},
    #     {"name": "kneel_forward", "action": "Kneel.Forward"},
    #     {"name": "kneel_fire",    "action": "Kneel.Fire"},
    #     {"name": "prone_idle",    "action": "Prone.Idle"},
    #     {"name": "prone_forward", "action": "Prone.Forward"},
    #     {"name": "prone_fire",    "action": "Prone.Fire"},
    # ],
    # 各ジョブで output_path を指定しない場合、sprite_sheet_<name>.png で保存される
    "render_jobs": [
        {"name": "stand_idle",    "action": "Stand.Idle"},
        {"name": "stand_forward", "action": "Stand.Forward"},
        {"name": "stand_fire",    "action": "Stand.Fire"},
        {"name": "kneel_idle",    "action": "Kneel.Idle"},
        {"name": "kneel_forward", "action": "Kneel.Forward"},
        {"name": "kneel_fire",    "action": "Kneel.Fire"},
        {"name": "prone_idle",    "action": "Prone.Idle"},
        {"name": "prone_forward", "action": "Prone.Forward"},
        {"name": "prone_fire",    "action": "Prone.Fire"},
    ],
    # True ならカメラを 45° 俯瞰に自動セット。既にセット済みなら False にするとそのまま使う
    "setup_camera_45": True,
    # True ならライトが既にあっても「SpriteSheetSun」「SpriteSheetFill」を追加する（真っ黒になる場合に試す）
    "force_add_lights": False,
    # True なら一時レンダファイルを削除しない（デバッグ用。1枚開いてレンダ結果を確認できる）
    "keep_temp_files": False,
    # カメラ距離（透視投影時。正投影のときは orthographic_scale が優先される）
    "camera_distance": 2.5,
    # True なら正投影（スケールで枠サイズを指定でき、兵士をセルに収めやすい）
    "use_orthographic": True,
    # 正投影時の「見える範囲」のサイズ（Blender 単位）。None なら全方向・全フレームから自動算出（見切れず最大で収まる）
    "orthographic_scale": None,
    # 自動算出時の余白（0.05 = 5%。見切れを避けるため少し多め推奨）
    "orthographic_scale_margin": 0.12,
    # 撮影中心の手動オフセット（正投影時、カメラの「右」「上」方向、Blender 単位）。
    # 自動センタリングに加算される。例: ライフルが左で欠け・右に余白が多い → camera_frame_offset_x を負（カメラを左へ＝画角内で被写体が右へ）
    # 上に余白が多い → camera_frame_offset_y を負でカメラを下へ（画角内で被写体が上へ）
    "camera_frame_offset_x": 0.0,
    "camera_frame_offset_y": 0.0,
}
# =======================================


def get_camera(camera_name, scene):
    """カメラを取得。シーンコレクション外にあっても bpy.data から探す。"""
    # 名前指定なら bpy.data から取得（コレクション未リンクでも可）
    if camera_name and camera_name in bpy.data.objects:
        cam = bpy.data.objects[camera_name]
        if cam.type == "CAMERA":
            scene.camera = cam  # レンダで使うように設定
            return cam
    # シーン内のカメラを探す
    for obj in scene.objects:
        if obj.type == "CAMERA":
            return obj
    # シーンにいなくてもデータ内のカメラを探す（どれか1台を使う）
    for obj in bpy.data.objects:
        if obj.type == "CAMERA":
            scene.camera = obj
            return obj
    return None


def _cleanup_sprite_sheet_objects():
    """過去の実行で残った SpriteSheet* オブジェクトを全削除してリセット。"""
    prefixes = ("SpriteSheetCamera", "SpriteSheetSun", "SpriteSheetFill")
    for obj in list(bpy.data.objects):
        if obj.name.startswith(prefixes):
            bpy.data.objects.remove(obj, do_unlink=True)


def create_camera(scene):
    """カメラが1台もないときに新規作成してシーンに追加する。"""
    name = "SpriteSheetCamera"
    cam_data = bpy.data.cameras.new(name)
    cam_obj = bpy.data.objects.new(name, cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj
    return cam_obj


def setup_camera_45_topdown(cam, target=(0, 0, 0), distance=12.0, use_orthographic=False, orthographic_scale=2.0):
    """カメラを 45° 俯瞰にセット。正投影なら orthographic_scale で枠サイズを指定（兵士をセルに収めやすい）。"""
    if cam is None:
        return
    from mathutils import Vector
    t = Vector(target)
    cam.location = t + Vector((distance, distance, distance))
    direction = t - Vector(cam.location)
    direction.normalize()
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    if use_orthographic and hasattr(cam.data, "type"):
        cam.data.type = "ORTHO"
        if hasattr(cam.data, "ortho_scale"):
            cam.data.ortho_scale = orthographic_scale


def _get_character_objects(armature, scene):
    """アーマチュア・子オブジェクト（ライフル等）・このアーマチュアで変形しているメッシュのリスト。"""
    objs = [armature]
    for obj in scene.objects:
        if obj.parent == armature:
            objs.append(obj)
        elif obj.type == "MESH" and obj != armature:
            for mod in obj.modifiers:
                if getattr(mod, "type", None) == "ARMATURE" and getattr(mod, "object", None) == armature:
                    objs.append(obj)
                    break
    return objs


def compute_orthographic_scale(
    scene, cam, armature, jobs, num_dirs=8, margin=0.08, direction_rot_obj=None
):
    """
    全ジョブ・全方向・全フレームで兵士＋ライフルがカメラに投影したときの 2D 範囲を求め、
    見切れずに収まる最小の orthographic_scale（かつフレームを精いっぱい使う）を返す。
    ジョブごとにアクションを切り替えて計測する。
    """
    from mathutils import Vector
    rot_obj = direction_rot_obj if direction_rot_obj is not None else armature
    try:
        dg = bpy.context.evaluated_depsgraph_get()
    except Exception:
        dg = None
    char_objs = _get_character_objects(armature, scene)
    orig_rot_z = rot_obj.rotation_euler.z
    orig_action = armature.animation_data.action if armature.animation_data else None

    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")

    for job in jobs:
        if job.get("action"):
            _switch_action(armature, job["action"])
        frame_start = job["frame_start"]
        frame_end = job["frame_end"]

        for direction_index in range(num_dirs):
            rot_obj.rotation_euler.z = orig_rot_z + math.radians(direction_index * 45)
            for frame in range(frame_start, frame_end + 1):
                scene.frame_set(frame)
                if dg:
                    dg.update()
                cam_inv = cam.matrix_world.inverted()
                for obj in char_objs:
                    try:
                        obj_eval = obj.evaluated_get(dg) if dg else obj
                        mw = obj_eval.matrix_world
                        for corner in obj_eval.bound_box:
                            world = mw @ Vector((corner[0], corner[1], corner[2]))
                            cam_local = cam_inv @ world
                            min_x = min(min_x, cam_local.x)
                            max_x = max(max_x, cam_local.x)
                            min_y = min(min_y, cam_local.y)
                            max_y = max(max_y, cam_local.y)
                    except Exception:
                        pass

    rot_obj.rotation_euler.z = orig_rot_z
    if orig_action and armature.animation_data:
        armature.animation_data.action = orig_action
    first_fs = min(j["frame_start"] for j in jobs)
    scene.frame_set(first_fs)

    if min_x == float("inf"):
        return 2.8, 0.0, 0.0
    content_w = max_x - min_x
    content_h = max_y - min_y
    if content_w <= 0 or content_h <= 0:
        return 2.8, 0.0, 0.0
    center_x = (min_x + max_x) * 0.5
    center_y = (min_y + max_y) * 0.5
    scale = max(content_w, content_h) * (1.0 + margin)
    return max(0.5, scale), center_x, center_y


def scene_has_light(scene):
    """シーンにライトが1つでもあれば True。"""
    for obj in scene.objects:
        if obj.type == "LIGHT":
            return True
    for obj in bpy.data.objects:
        if obj.type == "LIGHT":
            return True
    return False


def create_light(scene, target=(0, 0, 0), distance=12.0):
    """ライトが1つもないときに Sun + 補助ライトを追加。target は兵士の位置。"""
    from mathutils import Vector
    t = Vector(target)
    d = distance
    # Sun: 斜め上から（強め）
    sun_data = bpy.data.lights.new("SpriteSheetSun", type="SUN")
    sun_data.energy = 3.0
    sun_obj = bpy.data.objects.new("SpriteSheetSun", sun_data)
    scene.collection.objects.link(sun_obj)
    sun_obj.location = t + Vector((d * 0.7, d * 0.7, d * 0.7))
    direction = t - Vector(sun_obj.location)
    direction.normalize()
    sun_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    # 補助: target の真上にポイントライト
    point_data = bpy.data.lights.new("SpriteSheetFill", type="POINT")
    point_data.energy = 200
    point_data.shadow_soft_size = 2.0
    point_obj = bpy.data.objects.new("SpriteSheetFill", point_data)
    scene.collection.objects.link(point_obj)
    point_obj.location = t + Vector((0, 0, max(6, distance * 0.8)))
    return sun_obj


def _switch_action(armature, action_name):
    """アーマチュアのアクティブアクションを切り替える。フレーム範囲も返す。"""
    action = bpy.data.actions.get(action_name)
    if action is None:
        raise RuntimeError(
            f"アクション '{action_name}' が見つかりません。"
            f" 利用可能: {[a.name for a in bpy.data.actions]}"
        )
    if not armature.animation_data:
        armature.animation_data_create()
    armature.animation_data.action = action
    fs = int(action.frame_range[0])
    fe = int(action.frame_range[1])
    return fs, fe


def _resolve_default_output_dir():
    blend_path = bpy.data.filepath or ""
    base = os.path.dirname(blend_path) if blend_path else ""
    if base:
        base = os.path.abspath(bpy.path.abspath(base))
    if not base or "Program Files" in base or "Program Files (x86)" in base:
        base = os.path.join(os.path.expanduser("~"), "Documents")
    return base


def _resolve_output_path(explicit_output_path, job_name):
    if explicit_output_path:
        return os.path.abspath(bpy.path.abspath(explicit_output_path))
    base = _resolve_default_output_dir()
    safe_name = str(job_name or "crawl").strip().replace(" ", "_")
    return os.path.join(base, f"sprite_sheet_{safe_name}.png")


def _resolve_frame_range(scene, frame_start, frame_end):
    fs = scene.frame_start if frame_start is None else int(frame_start)
    fe = scene.frame_end if frame_end is None else int(frame_end)
    if fs > fe:
        raise RuntimeError("frame_start <= frame_end にしてください。")
    return fs, fe


def _compute_frames_to_render(frame_start, frame_end, max_frames_cfg):
    num_frames_total = frame_end - frame_start + 1
    if max_frames_cfg is not None and num_frames_total > max_frames_cfg:
        if max_frames_cfg <= 1:
            return [frame_start], 1, num_frames_total
        frames_to_render = [
            frame_start + round(i * (num_frames_total - 1) / (max_frames_cfg - 1))
            for i in range(max_frames_cfg)
        ]
        return frames_to_render, max_frames_cfg, num_frames_total
    frames_to_render = list(range(frame_start, frame_end + 1))
    return frames_to_render, num_frames_total, num_frames_total


def _build_render_jobs(scene, armature):
    jobs_cfg = CONFIG.get("render_jobs")
    jobs = []
    if isinstance(jobs_cfg, (list, tuple)) and len(jobs_cfg) > 0:
        for i, job in enumerate(jobs_cfg):
            if not isinstance(job, dict):
                continue
            name = str(job.get("name") or f"job_{i + 1}")
            action_name = job.get("action")
            explicit_fs = job.get("frame_start")
            explicit_fe = job.get("frame_end")
            if action_name and (explicit_fs is None or explicit_fe is None):
                act_fs, act_fe = _switch_action(armature, action_name)
                if explicit_fs is None:
                    explicit_fs = act_fs
                if explicit_fe is None:
                    explicit_fe = act_fe
            frame_start, frame_end = _resolve_frame_range(
                scene,
                explicit_fs if explicit_fs is not None else CONFIG.get("frame_start"),
                explicit_fe if explicit_fe is not None else CONFIG.get("frame_end"),
            )
            jobs.append(
                {
                    "name": name,
                    "action": action_name,
                    "frame_start": frame_start,
                    "frame_end": frame_end,
                    "max_frames_per_direction": job.get(
                        "max_frames_per_direction", CONFIG.get("max_frames_per_direction")
                    ),
                    "output_path": job.get("output_path"),
                }
            )
    if jobs:
        return jobs

    frame_start, frame_end = _resolve_frame_range(
        scene,
        CONFIG.get("frame_start"),
        CONFIG.get("frame_end"),
    )
    return [
        {
            "name": "crawl",
            "action": None,
            "frame_start": frame_start,
            "frame_end": frame_end,
            "max_frames_per_direction": CONFIG.get("max_frames_per_direction"),
            "output_path": CONFIG.get("output_path"),
        }
    ]


def main():
    scene = bpy.context.scene
    _cleanup_sprite_sheet_objects()

    armature = bpy.data.objects.get(CONFIG["armature_name"])
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError(
            f"アーマチュア '{CONFIG['armature_name']}' が見つかりません。"
            " CONFIG の armature_name をアウトライナーの名前に合わせてください。"
        )

    # 方角回転用オブジェクト（親 Empty で向きを変えている場合はそれを指定）
    rot_obj_name = CONFIG.get("direction_rotation_object")
    direction_rot_obj = bpy.data.objects.get(rot_obj_name) if rot_obj_name else armature
    if direction_rot_obj is None and rot_obj_name:
        direction_rot_obj = armature
    # 兵士の位置を注視点にする（原点でなくても写るように）
    target = tuple(armature.location)

    cam = get_camera(CONFIG["camera_name"], scene)
    if cam is None:
        cam = create_camera(scene)
        print("カメラがなかったため「SpriteSheetCamera」を自動作成しました。")
    jobs = _build_render_jobs(scene, armature)
    print(f"レンダジョブ数: {len(jobs)}")
    for j in jobs:
        label = f"  - {j['name']}"
        if j.get("action"):
            label += f" (action: {j['action']})"
        label += f"  frames {j['frame_start']}–{j['frame_end']}"
        print(label)

    cam_dist = CONFIG.get("camera_distance", 12.0)
    use_ortho = CONFIG.get("use_orthographic", False)
    ortho_scale_cfg = CONFIG.get("orthographic_scale")
    margin = CONFIG.get("orthographic_scale_margin", 0.08)
    if CONFIG.get("setup_camera_45", True):
        ortho_scale = ortho_scale_cfg if isinstance(ortho_scale_cfg, (int, float)) else 10.0
        setup_camera_45_topdown(cam, target=target, distance=cam_dist, use_orthographic=use_ortho, orthographic_scale=ortho_scale)
    cx, cy = 0.0, 0.0
    if use_ortho and (ortho_scale_cfg is None or ortho_scale_cfg == "auto"):
        ortho_scale, cx, cy = compute_orthographic_scale(
            scene,
            cam,
            armature,
            jobs,
            num_dirs=8,
            margin=margin,
            direction_rot_obj=direction_rot_obj,
        )
        if hasattr(cam.data, "ortho_scale"):
            cam.data.ortho_scale = ortho_scale
        print(
            f"orthographic_scale を自動算出しました: {ortho_scale:.3f}（見切れずフレームいっぱい・中心合わせ済み）"
        )

    # bbox 中心 (cx,cy) + 手動オフセットで、カメラをローカル XY 平面内で平行移動
    off_x = float(CONFIG.get("camera_frame_offset_x", 0.0))
    off_y = float(CONFIG.get("camera_frame_offset_y", 0.0))
    if CONFIG.get("setup_camera_45", True) and use_ortho and (cx != 0.0 or cy != 0.0 or off_x != 0.0 or off_y != 0.0):
        try:
            from mathutils import Vector

            q = cam.matrix_world.to_quaternion()
            right = q @ Vector((1.0, 0.0, 0.0))
            up = q @ Vector((0.0, 1.0, 0.0))
            cam.location += right * (cx + off_x) + up * (cy + off_y)
        except Exception:
            pass

    if not scene_has_light(scene):
        create_light(scene, target=target, distance=cam_dist)
        print("ライトがなかったため「SpriteSheetSun」と「SpriteSheetFill」を自動作成しました。")
    elif CONFIG.get("force_add_lights", False):
        create_light(scene, target=target, distance=cam_dist)
        print("force_add_lights のため「SpriteSheetSun」と「SpriteSheetFill」を追加しました。")

    # カメラ・ライトをレンダに反映させるためビューレイヤーを更新
    try:
        bpy.context.view_layer.update()
    except Exception:
        pass

    cell = CONFIG["cell_size"]
    num_dirs = 8

    # レンダ設定を一時退避
    r = scene.render
    orig_res_x, orig_res_y = r.resolution_x, r.resolution_y
    orig_percent = r.resolution_percentage
    orig_filepath = r.filepath
    orig_file_format = r.image_settings.file_format
    orig_film_transparent = getattr(r, "film_transparent", False)
    orig_color_mode = getattr(r.image_settings, "color_mode", "RGB")

    r.resolution_x = cell
    r.resolution_y = cell
    r.resolution_percentage = 100
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    if hasattr(r, "film_transparent"):
        r.film_transparent = True
    # Eevee で透過を有効にする（エンジンが Eevee の場合）
    if hasattr(scene, "eevee") and hasattr(scene.eevee, "use_transparent_background"):
        orig_eevee_transparent = scene.eevee.use_transparent_background
        scene.eevee.use_transparent_background = True
    else:
        orig_eevee_transparent = None

    # 方角回転オブジェクトの元の Z を覚え、オイラーに統一
    orig_rot_mode = getattr(direction_rot_obj, "rotation_mode", "XYZ")
    orig_rot_z = direction_rot_obj.rotation_euler.z if orig_rot_mode in ("XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX") else 0.0
    try:
        direction_rot_obj.rotation_mode = "XYZ"
    except Exception:
        pass

    outputs = []
    try:
        for job in jobs:
            if job.get("action"):
                _switch_action(armature, job["action"])
                print(f"[{job['name']}] アクション '{job['action']}' に切り替えました")
            frames_to_render, num_frames, num_frames_total = _compute_frames_to_render(
                job["frame_start"], job["frame_end"], job["max_frames_per_direction"]
            )
            if num_frames_total <= 0:
                raise RuntimeError(f"ジョブ '{job['name']}' の frame 範囲が不正です。")
            if num_frames < num_frames_total:
                print(
                    f"[{job['name']}] フレームを {num_frames_total} → {num_frames} に間引きました "
                    f"（max_frames_per_direction={job['max_frames_per_direction']}）"
                )

            out_path = _resolve_output_path(job.get("output_path"), job["name"])
            out_dir = os.path.dirname(out_path)
            if out_dir:
                os.makedirs(out_dir, exist_ok=True)
            temp_dir = tempfile.mkdtemp(prefix=f"blender_{job['name']}_", dir=out_dir if out_dir else None)

            sheet_width = num_dirs * cell
            sheet_height = num_frames * cell
            sheet_name = f"CrawlSpriteSheet_{job['name']}"
            if sheet_name in bpy.data.images:
                bpy.data.images.remove(bpy.data.images[sheet_name])
            sheet = bpy.data.images.new(
                sheet_name,
                width=sheet_width,
                height=sheet_height,
                alpha=True,
            )
            full_pixels = [0.0] * (sheet_width * sheet_height * 4)

            try:
                print(f"[{job['name']}] レンダ開始 …")
                for direction_index in range(num_dirs):
                    print(f"[{job['name']}] 方向 {direction_index + 1}/{num_dirs} …")
                    for i, frame in enumerate(frames_to_render):
                        scene.frame_set(frame)
                        # 方角: 指定オブジェクトの Z 回転だけ上書き（0°, 45°, …, 315°）
                        direction_rot_obj.rotation_euler.z = orig_rot_z + math.radians(direction_index * 45)
                        try:
                            bpy.context.view_layer.update()
                        except Exception:
                            pass
                        frame_path = os.path.join(temp_dir, f"d{direction_index}_f{i:04d}.png")
                        r.filepath = frame_path
                        bpy.ops.render.render(write_still=True)

                        if not os.path.isfile(frame_path):
                            raise RuntimeError(f"レンダファイルが作成されませんでした: {frame_path}")
                        loaded = bpy.data.images.load(frame_path, check_existing=False)
                        try:
                            rw, rh = loaded.size[0], loaded.size[1]
                            copy_w = min(cell, rw)
                            copy_h = min(cell, rh)
                            col = direction_index
                            row = num_frames - 1 - i
                            dx = col * cell
                            dy = row * cell
                            rr_px = list(loaded.pixels)
                            # 行単位でコピー。dst_y = dy + py で正立（さかさまにならない）
                            row_len = copy_w * 4
                            for py in range(copy_h):
                                src_row_start = py * rw * 4
                                dst_y = dy + py
                                dst_row_start = (dst_y * sheet_width + dx) * 4
                                full_pixels[dst_row_start : dst_row_start + row_len] = rr_px[
                                    src_row_start : src_row_start + row_len
                                ]
                        finally:
                            bpy.data.images.remove(loaded)

                print(f"[{job['name']}] 合成中 …")
                sheet.pixels.foreach_set(full_pixels)
                sheet.update()
                sheet.filepath_raw = out_path
                sheet.file_format = "PNG"
                sheet.save()
                print(f"[{job['name']}] 保存しました: {out_path}")
                print(
                    f"[{job['name']}] サイズ: {sheet_width} x {sheet_height}"
                    f"（横 8 方向 × 縦 {num_frames} フレーム、1 セル = {cell} x {cell}）"
                )
                outputs.append(out_path)
            finally:
                if not CONFIG.get("keep_temp_files", False):
                    try:
                        import shutil
                        if temp_dir and os.path.isdir(temp_dir):
                            shutil.rmtree(temp_dir, ignore_errors=True)
                    except Exception:
                        pass
                elif temp_dir and os.path.isdir(temp_dir):
                    print(f"[{job['name']}] 一時レンダフォルダ: {temp_dir}")

    finally:
        direction_rot_obj.rotation_euler.z = orig_rot_z
        try:
            direction_rot_obj.rotation_mode = orig_rot_mode
        except Exception:
            pass
        r.resolution_x, r.resolution_y = orig_res_x, orig_res_y
        r.resolution_percentage = orig_percent
        r.filepath = orig_filepath
        r.image_settings.file_format = orig_file_format
        r.image_settings.color_mode = orig_color_mode
        if hasattr(r, "film_transparent"):
            r.film_transparent = orig_film_transparent
        if orig_eevee_transparent is not None and hasattr(scene, "eevee"):
            scene.eevee.use_transparent_background = orig_eevee_transparent
    return outputs


if __name__ == "__main__":
    main()
