"""
WW2 スプライト用にアクションを 8 方向・指定フレームでレンダする。

例:
    blender.exe -b work.blend --python sp_render_frames.py -- ^
        --jobs "D:\\jobs.json" --out-dir "D:\\sprites" --camera SpriteCam
"""

import argparse
import json
import math
import os
import sys

import bpy


def script_argv():
    """-- 以降だけを取得する。"""
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]


def set_action_slotted(animation_data, action):
    """Blender 5 のスロット付きアクションを設定する。"""
    animation_data.action = action
    if action is not None and hasattr(animation_data, "action_slot") and action.slots:
        animation_data.action_slot = action.slots[0]


def restore_action(animation_data, action, slot):
    """元のアクションとスロットを戻す。"""
    animation_data.action = action
    if (
        action is not None
        and slot is not None
        and hasattr(animation_data, "action_slot")
    ):
        try:
            animation_data.action_slot = slot
        except Exception:
            if action.slots:
                animation_data.action_slot = action.slots[0]


def action_frames(action, step):
    """アクション範囲から整数フレーム列を作る。"""
    if step <= 0:
        raise RuntimeError("job の step は 1 以上である必要があります。")

    frame_start = int(math.ceil(float(action.frame_range[0])))
    frame_end = int(math.floor(float(action.frame_range[1])))
    frames = list(range(frame_start, frame_end + 1, step))

    if not frames:
        raise RuntimeError(
            f'アクション "{action.name}" の有効なフレーム範囲がありません。'
        )

    return frames


def load_jobs(path):
    """jobs.json を読み込む。"""
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)

    jobs = data.get("jobs") if isinstance(data, dict) else None
    if not isinstance(jobs, list):
        raise RuntimeError('jobs.json は {"jobs": [...]} 形式である必要があります。')

    for index, job in enumerate(jobs):
        if not isinstance(job, dict):
            raise RuntimeError(f"jobs[{index}] はオブジェクトである必要があります。")
        for key in ("name", "action", "step"):
            if key not in job:
                raise RuntimeError(f'jobs[{index}] に "{key}" がありません。')

    return jobs


def camera_names():
    """利用可能なカメラ名を返す。"""
    return sorted(obj.name for obj in bpy.data.objects if obj.type == "CAMERA")


def main():
    parser = argparse.ArgumentParser(description="8方向スプライトフレームレンダ")
    parser.add_argument("--jobs", required=True, help="jobs.json")
    parser.add_argument("--out-dir", help="出力ディレクトリ")
    parser.add_argument("--camera", default="SpriteCam", help="使用カメラ名")
    parser.add_argument("--rot-object", default="Armature", help="回転対象名")
    parser.add_argument("--rot-sign", type=float, default=1.0, help="方向回転の符号")
    parser.add_argument("--only", help="実行する job 名をカンマ区切りで指定")
    # カメラ微調整（レンダ時のみ適用・blendは変更しない）。旧シートとのフレーミング
    # パリティ合わせ用。shift はカメラのローカル右/上方向（Blender 単位）
    parser.add_argument("--ortho-scale", type=float, default=None, help="ortho_scale の一時上書き")
    parser.add_argument("--shift-right", type=float, default=0.0, help="カメラをローカル右へ平行移動")
    parser.add_argument("--shift-up", type=float, default=0.0, help="カメラをローカル上へ平行移動")
    args = parser.parse_args(script_argv())

    jobs_path = os.path.abspath(bpy.path.abspath(args.jobs))
    if not os.path.isfile(jobs_path):
        raise RuntimeError(f"jobs.json が見つかりません: {jobs_path}")

    jobs = load_jobs(jobs_path)

    selected_names = None
    if args.only is not None:
        selected_names = {
            name.strip() for name in args.only.split(",") if name.strip()
        }
        if not selected_names:
            raise RuntimeError("--only に有効な job 名が指定されていません。")
        jobs = [job for job in jobs if str(job["name"]) in selected_names]

        found_names = {str(job["name"]) for job in jobs}
        missing_names = sorted(selected_names - found_names)
        if missing_names:
            raise RuntimeError(
                "--only で指定された job が jobs.json にありません: "
                + ", ".join(missing_names)
            )

    camera = bpy.data.objects.get(args.camera)
    if camera is None or camera.type != "CAMERA":
        available = ", ".join(camera_names()) or "なし"
        raise RuntimeError(
            f'カメラ "{args.camera}" が見つかりません。利用可能: {available}'
        )

    rot_object = bpy.data.objects.get(args.rot_object)
    if rot_object is None:
        raise RuntimeError(f'回転対象 "{args.rot_object}" が見つかりません。')

    missing_actions = []
    for job in jobs:
        action_name = str(job["action"])
        if bpy.data.actions.get(action_name) is None:
            missing_actions.append(action_name)

    if missing_actions:
        available = ", ".join(sorted(action.name for action in bpy.data.actions)) or "なし"
        raise RuntimeError(
            "アクションが見つかりません: "
            + ", ".join(sorted(set(missing_actions)))
            + f"\n利用可能: {available}"
        )

    if args.out_dir:
        out_dir = os.path.abspath(bpy.path.abspath(args.out_dir))
    else:
        blend_dir = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd()
        out_dir = os.path.join(blend_dir, "sprite_frames")

    scene = bpy.context.scene
    view_layer = bpy.context.view_layer
    animation_data_existed = rot_object.animation_data is not None
    animation_data = rot_object.animation_data_create()

    old_action = animation_data.action
    old_slot = getattr(animation_data, "action_slot", None)
    old_frame = scene.frame_current
    old_camera = scene.camera

    old_rotation_mode = rot_object.rotation_mode
    old_rotation_euler = rot_object.rotation_euler.copy()
    old_rotation_quaternion = rot_object.rotation_quaternion.copy()
    old_rotation_axis_angle = tuple(rot_object.rotation_axis_angle)

    render = scene.render
    image_settings = render.image_settings
    old_render_settings = {
        "resolution_x": render.resolution_x,
        "resolution_y": render.resolution_y,
        "resolution_percentage": render.resolution_percentage,
        "filepath": render.filepath,
        "file_format": image_settings.file_format,
        "color_mode": image_settings.color_mode,
        "film_transparent": render.film_transparent,
    }

    eevee = getattr(scene, "eevee", None)
    has_eevee_transparent = (
        eevee is not None and hasattr(eevee, "use_transparent_background")
    )
    old_eevee_transparent = (
        eevee.use_transparent_background if has_eevee_transparent else None
    )

    result = {"jobs": []}
    overwrite_existing = selected_names is not None

    try:
        render.resolution_x = 400
        render.resolution_y = 262
        render.resolution_percentage = 100
        image_settings.file_format = "PNG"
        image_settings.color_mode = "RGBA"
        render.film_transparent = True
        if has_eevee_transparent:
            eevee.use_transparent_background = True

        scene.camera = camera

        # カメラ微調整（元値は finally で復元）
        old_cam_loc = camera.location.copy()
        old_cam_scale = camera.data.ortho_scale if hasattr(camera.data, "ortho_scale") else None
        if args.ortho_scale is not None and hasattr(camera.data, "ortho_scale"):
            camera.data.ortho_scale = args.ortho_scale
        if args.shift_right or args.shift_up:
            from mathutils import Vector
            q = camera.matrix_world.to_quaternion()
            camera.location = (
                camera.location
                + (q @ Vector((1.0, 0.0, 0.0))) * args.shift_right
                + (q @ Vector((0.0, 1.0, 0.0))) * args.shift_up
            )

        rot_object.rotation_mode = "XYZ"
        base_rotation_z = rot_object.rotation_euler.z

        for job in jobs:
            job_name = str(job["name"])
            action = bpy.data.actions[str(job["action"])]
            step = int(job["step"])
            frames = action_frames(action, step)
            job_out_dir = os.path.join(out_dir, job_name)

            set_action_slotted(animation_data, action)

            for direction in range(8):
                rot_object.rotation_euler.z = (
                    base_rotation_z
                    + args.rot_sign * math.radians(direction * 45.0)
                )
                view_layer.update()

                direction_dir = os.path.join(job_out_dir)
                os.makedirs(direction_dir, exist_ok=True)

                rendered_count = 0
                skipped_count = 0

                for sample_index, frame in enumerate(frames):
                    output_path = os.path.join(
                        direction_dir,
                        f"d{direction}_f{sample_index:03d}.png",
                    )

                    if os.path.isfile(output_path) and not overwrite_existing:
                        skipped_count += 1
                        continue

                    scene.frame_set(frame)
                    view_layer.update()
                    render.filepath = output_path
                    bpy.ops.render.render(write_still=True)
                    rendered_count += 1

                print(
                    f"INFO: {job_name} d{direction}: "
                    f"render={rendered_count}, skip={skipped_count}"
                )

            result["jobs"].append(
                {
                    "name": job_name,
                    "frames": frames,
                    "dirs": list(range(8)),
                    "out_dir": os.path.abspath(job_out_dir),
                }
            )

    finally:
        render.resolution_x = old_render_settings["resolution_x"]
        render.resolution_y = old_render_settings["resolution_y"]
        render.resolution_percentage = old_render_settings["resolution_percentage"]
        render.filepath = old_render_settings["filepath"]
        image_settings.file_format = old_render_settings["file_format"]
        image_settings.color_mode = old_render_settings["color_mode"]
        render.film_transparent = old_render_settings["film_transparent"]

        if has_eevee_transparent:
            eevee.use_transparent_background = old_eevee_transparent

        try:
            camera.location = old_cam_loc
            if old_cam_scale is not None:
                camera.data.ortho_scale = old_cam_scale
        except NameError:
            pass

        scene.camera = old_camera
        scene.frame_set(old_frame)

        restore_action(animation_data, old_action, old_slot)
        if not animation_data_existed:
            rot_object.animation_data_clear()

        rot_object.rotation_mode = old_rotation_mode
        if old_rotation_mode == "QUATERNION":
            rot_object.rotation_quaternion = old_rotation_quaternion
        elif old_rotation_mode == "AXIS_ANGLE":
            rot_object.rotation_axis_angle = old_rotation_axis_angle
        else:
            rot_object.rotation_euler = old_rotation_euler

        view_layer.update()

    print("SP_RENDER_RESULT=" + json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
