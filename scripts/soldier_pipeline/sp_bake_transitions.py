"""
スプライト用の遷移クリップとループ終端補正をベイクする。

例:
    blender.exe -b work.blend --python sp_bake_transitions.py -- --spec transitions.json
"""

import argparse
import json
import math
import os
import sys

import bpy


class BakeError(Exception):
    """ベイク入力エラー。"""


class JapaneseArgumentParser(argparse.ArgumentParser):
    """日本語エラー用パーサー。"""

    def error(self, message):
        self.exit(2, "引数エラー: {}\n".format(message))


def parse_args():
    """-- 以降の引数を読む。"""
    argv = sys.argv
    script_args = argv[argv.index("--") + 1:] if "--" in argv else []

    parser = JapaneseArgumentParser(
        description="スプライト用遷移アクションをベイクします。"
    )
    parser.add_argument("--spec", required=True, help="遷移定義 JSON")
    parser.add_argument("--save", default=None, help="保存先 blend")
    return parser.parse_args(script_args)


def is_protected_name(name):
    """.001 系は操作しない。"""
    return isinstance(name, str) and name.endswith(".001")


def get_armature():
    """対象アーマチュアを得る。"""
    arm = bpy.data.objects.get("Armature")
    if arm is None:
        raise BakeError('対象オブジェクト "Armature" が見つかりません。')
    if arm.type != "ARMATURE":
        raise BakeError('"Armature" はアーマチュアではありません。')
    return arm


def ensure_quaternion_rotation(arm):
    """全ポーズボーンを Quaternion に統一する。"""
    for pb in arm.pose.bones:
        if pb.rotation_mode != "QUATERNION":
            pb.rotation_mode = "QUATERNION"


def assign_action(arm, act):
    """Blender 5 のスロット対応でアクションを割り当てる。"""
    ad = arm.animation_data_create()
    ad.action = act
    if act is not None and hasattr(ad, "action_slot") and act.slots:
        ad.action_slot = act.slots[0]


def _sample_assigned_pose(arm, frame):
    """現在割当済みアクションのポーズを読む。"""
    scene = bpy.context.scene
    scene.frame_set(int(frame))
    bpy.context.view_layer.update()

    pose = {}
    for pb in arm.pose.bones:
        pose[pb.name] = (
            pb.location.copy(),
            pb.rotation_quaternion.copy(),
        )
    return pose


def sample_pose(arm, act, frame):
    """アクションを評価し、全ポーズボーンを取得する。"""
    ensure_quaternion_rotation(arm)
    assign_action(arm, act)
    return _sample_assigned_pose(arm, frame)


def slerp_q(qa, qb, t):
    """最短経路で Quaternion 補間する。"""
    qb2 = qb.copy()
    if qa.dot(qb2) < 0.0:
        qb2.negate()
    return qa.slerp(qb2, t)


def smoothstep(t):
    """滑らかな補間係数。"""
    return t * t * (3.0 - 2.0 * t)


def action_bounds(act):
    """アクションの整数フレーム範囲を得る。"""
    start, end = act.frame_range
    fs = int(math.ceil(start))
    fe = int(math.floor(end))
    if fe < fs:
        raise BakeError('アクション "{}" のフレーム範囲が不正です。'.format(act.name))
    return fs, fe


def resolve_frame(act, value, default):
    """start/end/整数を実フレームへ解決する。"""
    if value is None:
        value = default

    fs, fe = action_bounds(act)

    if value == "start":
        return fs
    if value == "end":
        return fe
    if isinstance(value, int) and not isinstance(value, bool):
        return value

    raise BakeError(
        'アクション "{}" のフレーム指定は start、end、または整数で指定してください。'.format(
            act.name
        )
    )


def remove_action_if_exists(arm, name):
    """同名アクションを安全に削除する。"""
    old = bpy.data.actions.get(name)
    if old is None:
        return

    ad = arm.animation_data
    if ad is not None and ad.action == old:
        ad.action = None
        if hasattr(ad, "action_slot"):
            try:
                ad.action_slot = None
            except Exception:
                pass

    bpy.data.actions.remove(old, do_unlink=True)


def write_pose(arm, pose, frame):
    """ポーズを現在のアクションへキー化する。"""
    for bone_name, (location, rotation) in pose.items():
        pb = arm.pose.bones.get(bone_name)
        if pb is None:
            continue
        pb.location = location
        pb.rotation_quaternion = rotation
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("rotation_quaternion", frame=frame)


def blend_pose(pose_a, pose_b, t):
    """2 ポーズを補間する。"""
    result = {}
    for bone_name, (loc_a, rot_a) in pose_a.items():
        if bone_name not in pose_b:
            result[bone_name] = (loc_a.copy(), rot_a.copy())
            continue

        loc_b, rot_b = pose_b[bone_name]
        result[bone_name] = (
            loc_a.lerp(loc_b, t),
            slerp_q(rot_a, rot_b, t),
        )
    return result


def require_action(name):
    """保護名を除く既存アクションを得る。"""
    if not isinstance(name, str) or not name:
        raise BakeError("アクション名が不正です。")
    if is_protected_name(name):
        raise BakeError('保護対象の .001 アクション "{}" は使用できません。'.format(name))

    act = bpy.data.actions.get(name)
    if act is None:
        available = sorted(action.name for action in bpy.data.actions)
        raise BakeError(
            '指定アクション "{}" が見つかりません。利用可能一覧: {}'.format(
                name, ", ".join(available) if available else "なし"
            )
        )
    return act


def validate_spec(spec):
    """入力定義を検証する。"""
    if not isinstance(spec, dict):
        raise BakeError("spec JSON の最上位はオブジェクトである必要があります。")

    transitions = spec.get("transitions", [])
    loop_close = spec.get("loop_close", [])

    if not isinstance(transitions, list) or not isinstance(loop_close, list):
        raise BakeError("transitions と loop_close は配列である必要があります。")

    source_names = set()
    output_names = set()

    for item in transitions:
        if not isinstance(item, dict):
            raise BakeError("transitions の各要素はオブジェクトである必要があります。")

        for key in ("from", "to", "name", "frames"):
            if key not in item:
                raise BakeError('transitions に必須項目 "{}" がありません。'.format(key))

        source_names.add(item["from"])
        source_names.add(item["to"])
        output_names.add(item["name"])

        if not isinstance(item["frames"], int) or isinstance(item["frames"], bool):
            raise BakeError('遷移 "{}" の frames は整数で指定してください。'.format(item["name"]))
        if item["frames"] < 1:
            raise BakeError('遷移 "{}" の frames は 1 以上で指定してください。'.format(item["name"]))

    for item in loop_close:
        if not isinstance(item, dict):
            raise BakeError("loop_close の各要素はオブジェクトである必要があります。")

        for key in ("action", "name", "blend_frames"):
            if key not in item:
                raise BakeError('loop_close に必須項目 "{}" がありません。'.format(key))

        source_names.add(item["action"])
        output_names.add(item["name"])

        if not isinstance(item["blend_frames"], int) or isinstance(item["blend_frames"], bool):
            raise BakeError(
                'ループ補正 "{}" の blend_frames は整数で指定してください。'.format(
                    item["name"]
                )
            )
        if item["blend_frames"] < 1:
            raise BakeError(
                'ループ補正 "{}" の blend_frames は 1 以上で指定してください。'.format(
                    item["name"]
                )
            )

    if len(output_names) != len(transitions) + len(loop_close):
        raise BakeError("出力アクション名が重複しています。")

    for name in source_names:
        require_action(name)

    for name in output_names:
        if not isinstance(name, str) or not name:
            raise BakeError("出力アクション名が不正です。")
        if is_protected_name(name):
            raise BakeError('保護対象の .001 アクション "{}" は操作できません。'.format(name))
        if name in source_names:
            raise BakeError(
                '出力アクション "{}" は入力アクション名と同一にできません。'.format(name)
            )

    return transitions, loop_close


def bake_transition(arm, item):
    """遷移アクションを生成する。"""
    from_act = require_action(item["from"])
    to_act = require_action(item["to"])
    name = item["name"]
    frames = item["frames"]

    from_frame = resolve_frame(from_act, item.get("from_frame"), "end")
    to_frame = resolve_frame(to_act, item.get("to_frame"), "start")

    pose_a = sample_pose(arm, from_act, from_frame)
    pose_b = sample_pose(arm, to_act, to_frame)

    remove_action_if_exists(arm, name)
    new_act = bpy.data.actions.new(name)
    assign_action(arm, new_act)

    for frame in range(1, frames + 1):
        t = 0.0 if frames == 1 else (frame - 1) / (frames - 1)
        pose = blend_pose(pose_a, pose_b, smoothstep(t))
        write_pose(arm, pose, frame)

    new_act.use_fake_user = True
    return {"name": name, "frames": frames}


def bake_loop_close(arm, item):
    """ループ終端を先頭へ接続するアクションを生成する。"""
    source_act = require_action(item["action"])
    name = item["name"]
    blend_frames = item["blend_frames"]
    fs, fe = action_bounds(source_act)
    total_frames = fe - fs + 1

    if blend_frames > total_frames:
        raise BakeError(
            'ループ補正 "{}" の blend_frames はアクション長 ({}) 以下にしてください。'.format(
                name, total_frames
            )
        )

    ensure_quaternion_rotation(arm)
    assign_action(arm, source_act)

    sampled = {}
    for frame in range(fs, fe + 1):
        sampled[frame] = _sample_assigned_pose(arm, frame)

    first_pose = sampled[fs]

    remove_action_if_exists(arm, name)
    new_act = bpy.data.actions.new(name)
    assign_action(arm, new_act)

    blend_start = fe - blend_frames + 1
    for frame in range(fs, fe + 1):
        pose = sampled[frame]
        if frame >= blend_start:
            j = frame - blend_start + 1
            weight = smoothstep(j / blend_frames)
            pose = blend_pose(pose, first_pose, weight)
        write_pose(arm, pose, frame)

    new_act.use_fake_user = True
    return {
        "name": name,
        "frames": total_frames,
        "blend_frames": blend_frames,
    }


def load_spec(path):
    """JSON 定義を読む。"""
    spec_path = os.path.abspath(path)
    try:
        with open(spec_path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        raise BakeError('spec ファイルが見つかりません: "{}"'.format(spec_path))
    except json.JSONDecodeError as exc:
        raise BakeError("spec JSON の解析に失敗しました: {}".format(exc))


def save_blend(path):
    """blend を保存する。"""
    if path:
        bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath(path))
    else:
        bpy.ops.wm.save_mainfile()


def main():
    """主処理。"""
    args = parse_args()
    spec = load_spec(args.spec)
    transitions, loop_close = validate_spec(spec)
    arm = get_armature()

    ensure_quaternion_rotation(arm)

    result = {
        "created": [],
        "loop_closed": [],
    }

    for item in transitions:
        result["created"].append(bake_transition(arm, item))
        print("INFO: 遷移ベイク完了: {}".format(item["name"]))

    for item in loop_close:
        result["loop_closed"].append(bake_loop_close(arm, item))
        print("INFO: ループ閉包完了: {}".format(item["name"]))

    save_blend(args.save)
    print("SP_BAKE_RESULT={}".format(json.dumps(result, ensure_ascii=False)))


if __name__ == "__main__":
    try:
        main()
    except BakeError as exc:
        print("エラー: {}".format(exc), file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:
        print("予期しないエラー: {}".format(exc), file=sys.stderr)
        raise SystemExit(1)
