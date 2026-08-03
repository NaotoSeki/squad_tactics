"""
JSON レシピから既存アクションを合成し、新規アクションとして書き出す。

例:
    blender.exe -b work.blend --python sp_synth_clips.py -- --spec synth_clips.json
"""

import json
import math
import os
import sys

import bpy
from mathutils import Quaternion, Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sp_bake_transitions as spb


class SynthError(Exception):
    """合成入力エラー。"""


# graft 用のボーン群。mixamorig は上下の切れ目が綺麗なので、上半身だけ別クリップから
# 移植して「膝立ちのままリロード」等を1本のMixamoクリップから導出できる。
# Hips は下半身側（腰の向きは土台側が持つ）。
UPPER_BONE_PREFIXES = (
    "mixamorig:Spine",
    "mixamorig:Neck",
    "mixamorig:Head",
    "mixamorig:LeftShoulder",
    "mixamorig:LeftArm",
    "mixamorig:LeftForeArm",
    "mixamorig:LeftHand",
    "mixamorig:RightShoulder",
    "mixamorig:RightArm",
    "mixamorig:RightForeArm",
    "mixamorig:RightHand",
)
LOWER_BONE_PREFIXES = (
    "mixamorig:Hips",
    "mixamorig:LeftUpLeg",
    "mixamorig:LeftLeg",
    "mixamorig:LeftFoot",
    "mixamorig:LeftToe",
    "mixamorig:RightUpLeg",
    "mixamorig:RightLeg",
    "mixamorig:RightFoot",
    "mixamorig:RightToe",
)
BONE_GROUPS = {"upper": UPPER_BONE_PREFIXES, "lower": LOWER_BONE_PREFIXES}


def resolve_bone_group(spec, pose_names):
    """"upper"/"lower" またはボーン名配列を、実ボーン名集合へ解決する。"""
    if isinstance(spec, str):
        prefixes = BONE_GROUPS.get(spec)
        if prefixes is None:
            raise SynthError(
                'ボーン群 "{}" は upper / lower / ボーン名配列のいずれかで指定してください。'.format(spec)
            )
        return {n for n in pose_names if n.startswith(prefixes)}

    if isinstance(spec, list):
        names = set()
        for item in spec:
            if not isinstance(item, str) or not item:
                raise SynthError("ボーン名配列の要素は非空文字列で指定してください。")
            names.add(item)
        return names

    raise SynthError("ボーン群は upper / lower または配列で指定してください。")


def parse_args():
    """-- 以降の引数を読む。"""
    argv = sys.argv
    script_args = argv[argv.index("--") + 1:] if "--" in argv else []

    parser = spb.JapaneseArgumentParser(
        description="JSON レシピからアクションを合成します。"
    )
    parser.add_argument("--spec", required=True, help="合成定義 JSON")
    parser.add_argument("--save", default=None, help="保存先 blend")
    return parser.parse_args(script_args)


def is_integer(value):
    """bool を除いた整数か判定する。"""
    return isinstance(value, int) and not isinstance(value, bool)


def is_number(value):
    """bool を除いた有限数値か判定する。"""
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def require_integer(value, label, minimum=None):
    """整数値を検証する。"""
    if not is_integer(value):
        raise SynthError("{} は整数で指定してください。".format(label))
    if minimum is not None and value < minimum:
        raise SynthError("{} は {} 以上で指定してください。".format(label, minimum))
    return value


def require_number(value, label, minimum=None, strict_minimum=False):
    """数値を検証する。"""
    if not is_number(value):
        raise SynthError("{} は数値で指定してください。".format(label))

    if minimum is not None:
        if strict_minimum and value <= minimum:
            raise SynthError("{} は {} より大きく指定してください。".format(label, minimum))
        if not strict_minimum and value < minimum:
            raise SynthError("{} は {} 以上で指定してください。".format(label, minimum))

    return value


def require_vector3(value, label):
    """3 要素の数値配列を検証する。"""
    if not isinstance(value, list) or len(value) != 3:
        raise SynthError("{} は 3 要素の配列で指定してください。".format(label))

    for index, item in enumerate(value):
        require_number(item, "{}[{}]".format(label, index))

    return value


def require_bone(arm, bone_name, label):
    """存在するポーズボーン名を検証する。"""
    if not isinstance(bone_name, str) or not bone_name:
        raise SynthError("{} は非空文字列で指定してください。".format(label))
    if arm.pose.bones.get(bone_name) is None:
        raise SynthError(
            '{} "{}" はアーマチュアに存在しません。'.format(label, bone_name)
        )
    return bone_name


def validate_angle_bones(arm, bones, label):
    """回転オフセット用ボーン定義を検証する。"""
    if not isinstance(bones, dict):
        raise SynthError("{} はボーン名をキーとするオブジェクトで指定してください。".format(label))

    for bone_name, angles in bones.items():
        require_bone(arm, bone_name, "{} のボーン名".format(label))
        require_vector3(angles, '{}["{}"]'.format(label, bone_name))


def validate_envelope(envelope, label):
    """エンベロープ定義を検証する。"""
    if envelope is None:
        return

    if isinstance(envelope, str):
        if envelope != "const":
            raise SynthError("{} の文字列指定は const のみ使用できます。".format(label))
        return

    if is_number(envelope):
        if float(envelope) != 1.0:
            raise SynthError("{} の数値指定は 1.0 のみ使用できます。".format(label))
        return

    if not isinstance(envelope, dict):
        raise SynthError("{} はオブジェクト、1.0、const、または省略で指定してください。".format(label))

    env_type = envelope.get("type")
    if not isinstance(env_type, str):
        raise SynthError("{} の type は文字列で指定してください。".format(label))

    if env_type == "ramp_in":
        if "frames" not in envelope:
            raise SynthError("{} の ramp_in には frames が必要です。".format(label))
        require_integer(envelope["frames"], "{} の frames".format(label), 0)
        return

    if env_type == "ramp_out":
        if "frames" not in envelope:
            raise SynthError("{} の ramp_out には frames が必要です。".format(label))
        require_integer(envelope["frames"], "{} の frames".format(label), 0)
        return

    if env_type == "ramp":
        if "in" in envelope:
            require_integer(envelope["in"], "{} の in".format(label), 0)
        if "out" in envelope:
            require_integer(envelope["out"], "{} の out".format(label), 0)
        return

    if env_type == "pulse":
        if "rise" not in envelope or "fall" not in envelope:
            raise SynthError("{} の pulse には rise と fall が必要です。".format(label))
        require_integer(envelope["rise"], "{} の rise".format(label), 0)
        require_integer(envelope["fall"], "{} の fall".format(label), 0)

        peak = envelope.get("peak", "auto")
        if peak != "auto":
            require_integer(peak, "{} の peak".format(label), 0)
        return

    raise SynthError('{} の type "{}" は使用できません。'.format(label, env_type))


def validate_segment(segment, label, defined):
    """source または splice セグメントを検証する。

    defined は「この spec 内で先に生成される出力名」の集合。そこに含まれる名前は
    合成時にしか存在しないため、フレーム範囲の検証は synthesize 時まで遅延する。
    """
    if not isinstance(segment, dict):
        raise SynthError("{} はオブジェクトで指定してください。".format(label))

    action_name = segment.get("action")
    if not isinstance(action_name, str) or not action_name:
        raise SynthError("{} の action は非空文字列で指定してください。".format(label))

    step = segment.get("step", 1)
    require_integer(step, "{} の step".format(label), 1)

    if action_name in defined:
        return action_name

    try:
        action = spb.require_action(action_name)
    except spb.BakeError as exc:
        raise SynthError(str(exc))

    frame_from = spb.resolve_frame(action, segment.get("from"), "start")
    frame_to = spb.resolve_frame(action, segment.get("to"), "end")
    if frame_from > frame_to:
        raise SynthError(
            '{} の from は to 以下で指定してください。'.format(label)
        )

    return action_name


def validate_retime_op(op, label):
    """retime 演算を検証する。"""
    has_rate = "rate" in op
    has_frames = "frames" in op

    if has_rate == has_frames:
        raise SynthError("{} は rate または frames のどちらか一方を指定してください。".format(label))

    if has_rate:
        require_number(op["rate"], "{} の rate".format(label), 0, strict_minimum=True)

    if has_frames:
        require_integer(op["frames"], "{} の frames".format(label), 1)


def validate_offset_op(arm, op, label):
    """offset 演算を検証する。"""
    if "bones" not in op:
        raise SynthError("{} には bones が必要です。".format(label))

    validate_angle_bones(arm, op["bones"], "{} の bones".format(label))

    space = op.get("space", "local")
    if space not in ("local", "parent"):
        raise SynthError('{} の space は local または parent で指定してください。'.format(label))

    validate_envelope(op.get("envelope"), "{} の envelope".format(label))


def validate_root_op(arm, op, label):
    """root 演算を検証する。"""
    bone_name = op.get("bone", "mixamorig:Hips")
    require_bone(arm, bone_name, "{} の bone".format(label))

    if "translate" not in op:
        raise SynthError("{} には translate が必要です。".format(label))
    require_vector3(op["translate"], "{} の translate".format(label))

    validate_envelope(op.get("envelope"), "{} の envelope".format(label))


def validate_hold_op(arm, op, label):
    """hold 演算を検証する。"""
    if "frames" not in op:
        raise SynthError("{} には frames が必要です。".format(label))
    require_integer(op["frames"], "{} の frames".format(label), 1)

    at = op.get("at", "start")
    if at not in ("start", "end") and not (is_integer(at) and at >= 0):
        raise SynthError(
            "{} の at は start、end、または 0 以上の整数で指定してください。".format(label)
        )

    breathe = op.get("breathe")
    if breathe is None:
        return

    if not isinstance(breathe, dict):
        raise SynthError("{} の breathe はオブジェクトで指定してください。".format(label))

    if "bones" not in breathe:
        raise SynthError("{} の breathe には bones が必要です。".format(label))
    validate_angle_bones(arm, breathe["bones"], "{} の breathe.bones".format(label))

    period = breathe.get("period", op["frames"])
    require_integer(period, "{} の breathe.period".format(label), 1)


def validate_strip_root_motion_op(arm, op, label):
    """strip_root_motion 演算を検証する。"""
    require_bone(arm, op.get("bone", "mixamorig:Hips"), "{} の bone".format(label))

    axes = op.get("axes", ["x", "y", "z"])
    if not isinstance(axes, list) or not axes:
        raise SynthError("{} の axes は空でない配列で指定してください。".format(label))
    for axis in axes:
        if axis not in ("x", "y", "z"):
            raise SynthError('{} の axes は x/y/z で指定してください（"{}"）。'.format(label, axis))

    mode = op.get("mode", "linear")
    if mode not in ("linear", "lock"):
        raise SynthError("{} の mode は linear または lock で指定してください。".format(label))


def validate_graft_op(arm, op, label, defined):
    """graft 演算を検証する。"""
    donor = op.get("from")
    if not isinstance(donor, str) or not donor:
        raise SynthError("{} の from は非空文字列で指定してください。".format(label))
    if donor not in defined:
        try:
            spb.require_action(donor)
        except spb.BakeError as exc:
            raise SynthError(str(exc))

    if "bones" not in op:
        raise SynthError("{} には bones が必要です。".format(label))
    resolve_bone_group(op["bones"], {b.name for b in arm.pose.bones})

    step = op.get("step", 1)
    require_integer(step, "{} の step".format(label), 1)


def validate_ops(arm, ops, clip_name, defined=frozenset()):
    """演算列を検証する。"""
    if not isinstance(ops, list):
        raise SynthError(
            'クリップ "{}" の ops は配列で指定してください。'.format(clip_name)
        )

    for index, op in enumerate(ops):
        label = 'クリップ "{}" の ops[{}]'.format(clip_name, index)

        if not isinstance(op, dict):
            raise SynthError("{} はオブジェクトで指定してください。".format(label))

        op_name = op.get("op")
        if not isinstance(op_name, str):
            raise SynthError("{} には op が必要です。".format(label))

        if op_name == "retime":
            validate_retime_op(op, label)
        elif op_name == "offset":
            validate_offset_op(arm, op, label)
        elif op_name == "root":
            validate_root_op(arm, op, label)
        elif op_name == "hold":
            validate_hold_op(arm, op, label)
        elif op_name == "strip_root_motion":
            validate_strip_root_motion_op(arm, op, label)
        elif op_name == "graft":
            validate_graft_op(arm, op, label, defined)
        else:
            raise SynthError(
                '{} の op "{}" は使用できません。'.format(label, op_name)
            )


def validate_spec(spec, arm):
    """合成定義全体を検証する。"""
    if not isinstance(spec, dict):
        raise SynthError("spec の最上位はオブジェクトで指定してください。")

    clips = spec.get("clips")
    if not isinstance(clips, list):
        raise SynthError("spec の clips は配列で指定してください。")

    # 先に定義された出力は後続クリップの入力に使える（遮蔽ポーズ→その遷移など）。
    # 自分自身の名前を入力にすることだけを禁じる。
    defined_names = set()

    for index, clip in enumerate(clips):
        label = "clips[{}]".format(index)

        if not isinstance(clip, dict):
            raise SynthError("{} はオブジェクトで指定してください。".format(label))

        name = clip.get("name")
        if not isinstance(name, str) or not name:
            raise SynthError("{} の name は非空文字列で指定してください。".format(label))
        if spb.is_protected_name(name):
            raise SynthError('保護対象の .001 アクション "{}" は作成できません。'.format(name))
        if name in defined_names:
            raise SynthError('出力アクション名 "{}" が重複しています。'.format(name))

        has_source = "source" in clip
        has_splice = "splice" in clip
        if has_source == has_splice:
            raise SynthError(
                'クリップ "{}" には source または splice のどちらか一方が必要です。'.format(
                    name
                )
            )

        clip_inputs = set()
        if has_source:
            clip_inputs.add(
                validate_segment(clip["source"], '{} の source'.format(label), defined_names)
            )
            if "bridge" in clip:
                raise SynthError(
                    'クリップ "{}" の bridge は splice 使用時のみ指定できます。'.format(name)
                )
        else:
            splice = clip["splice"]
            if not isinstance(splice, list) or not splice:
                raise SynthError(
                    'クリップ "{}" の splice は空でない配列で指定してください。'.format(name)
                )

            for segment_index, segment in enumerate(splice):
                clip_inputs.add(
                    validate_segment(
                        segment,
                        "{} の splice[{}]".format(label, segment_index),
                        defined_names,
                    )
                )

            bridge = clip.get("bridge", 0)
            require_integer(bridge, '{} の bridge'.format(label), 0)

        if name in clip_inputs:
            raise SynthError(
                'クリップ "{}" は自分自身を入力にできません。'.format(name)
            )

        validate_ops(arm, clip.get("ops", []), name, defined_names)
        defined_names.add(name)


def copy_pose(pose):
    """ポーズを独立した値として複製する。"""
    result = {}
    for bone_name, (location, rotation) in pose.items():
        result[bone_name] = (location.copy(), rotation.copy())
    return result


def copy_sequence(sequence):
    """ポーズ列を独立した値として複製する。"""
    return [copy_pose(pose) for pose in sequence]


def segment_frames(action, segment):
    """セグメントのサンプル対象フレーム列を得る。"""
    frame_from = spb.resolve_frame(action, segment.get("from"), "start")
    frame_to = spb.resolve_frame(action, segment.get("to"), "end")
    step = segment.get("step", 1)

    frames = list(range(frame_from, frame_to + 1, step))
    if not frames or frames[-1] != frame_to:
        frames.append(frame_to)

    return frames


def sample_segment(arm, segment):
    """1 セグメントからポーズ列を作る。"""
    action = spb.require_action(segment["action"])
    frames = segment_frames(action, segment)
    return [spb.sample_pose(arm, action, frame) for frame in frames]


def build_source_sequence(arm, source):
    """source 定義からポーズ列を作る。"""
    return sample_segment(arm, source)


def build_splice_sequence(arm, splice, bridge):
    """splice 定義からポーズ列を作る。"""
    sequence = []

    for segment_index, segment in enumerate(splice):
        segment_sequence = sample_segment(arm, segment)

        if segment_index > 0 and bridge > 0:
            pose_a = sequence[-1]
            pose_b = segment_sequence[0]

            for bridge_index in range(1, bridge + 1):
                t = float(bridge_index) / float(bridge + 1)
                sequence.append(
                    spb.blend_pose(pose_a, pose_b, spb.smoothstep(t))
                )

        sequence.extend(segment_sequence)

    return sequence


def build_sequence(arm, clip):
    """クリップ定義から元ポーズ列を作る。"""
    if "source" in clip:
        return build_source_sequence(arm, clip["source"])

    return build_splice_sequence(
        arm,
        clip["splice"],
        clip.get("bridge", 0),
    )


def ramp_in_weight(index, frames):
    """先頭ランプの重みを得る。"""
    if frames <= 0:
        return 1.0
    if frames == 1:
        return 1.0
    if index >= frames - 1:
        return 1.0
    return spb.smoothstep(float(index) / float(frames - 1))


def ramp_out_weight(index, length, frames):
    """末尾ランプの重みを得る。"""
    if frames <= 0:
        return 1.0
    if frames == 1:
        return 0.0 if index == length - 1 else 1.0

    distance = length - 1 - index
    if distance >= frames - 1:
        return 1.0
    return spb.smoothstep(float(distance) / float(frames - 1))


def pulse_weight(index, rise, fall, peak):
    """パルス型エンベロープの重みを得る。"""
    if index < peak:
        if rise <= 0:
            return 0.0

        start = peak - rise
        if index < start:
            return 0.0

        return spb.smoothstep(float(index - start) / float(rise))

    if index == peak:
        return 1.0

    if fall <= 0:
        return 0.0

    end = peak + fall
    if index > end:
        return 0.0

    return 1.0 - spb.smoothstep(float(index - peak) / float(fall))


def envelope_weight(envelope, index, length):
    """エンベロープ定義からフレーム重みを得る。"""
    if envelope is None or envelope == "const":
        return 1.0

    if is_number(envelope):
        return 1.0

    env_type = envelope["type"]

    if env_type == "ramp_in":
        return ramp_in_weight(index, envelope["frames"])

    if env_type == "ramp_out":
        return ramp_out_weight(index, length, envelope["frames"])

    if env_type == "ramp":
        weight_in = ramp_in_weight(index, envelope.get("in", 0))
        weight_out = ramp_out_weight(index, length, envelope.get("out", 0))
        return min(weight_in, weight_out)

    if env_type == "pulse":
        peak = envelope.get("peak", "auto")
        if peak == "auto":
            peak = envelope["rise"]

        return pulse_weight(index, envelope["rise"], envelope["fall"], peak)

    raise SynthError('エンベロープ type "{}" は使用できません。'.format(env_type))


def weighted_rotation(full_rotation, weight):
    """恒等回転から重み付き回転を得る。"""
    identity = Quaternion((1.0, 0.0, 0.0, 0.0))
    return spb.slerp_q(identity, full_rotation, weight)


def angle_rotation(angles):
    """度数 XYZ オイラー角から Quaternion を得る。"""
    radians = tuple(math.radians(value) for value in angles)
    return Euler(radians, "XYZ").to_quaternion()


def apply_offset_to_pose(pose, bones, space, weight):
    """1 ポーズに加算回転を適用する。"""
    result = copy_pose(pose)

    for bone_name, angles in bones.items():
        location, old_rotation = result[bone_name]
        full_rotation = angle_rotation(angles)
        delta_rotation = weighted_rotation(full_rotation, weight)

        if space == "local":
            new_rotation = old_rotation @ delta_rotation
        else:
            new_rotation = delta_rotation @ old_rotation

        new_rotation.normalize()
        result[bone_name] = (location, new_rotation)

    return result


def apply_retime(sequence, op):
    """ポーズ列を正規化位置でリタイムする。"""
    if "frames" in op:
        output_length = op["frames"]
    else:
        output_length = max(1, int(round(float(len(sequence)) / op["rate"])))

    result = []
    input_length = len(sequence)

    for index in range(output_length):
        if output_length == 1:
            position = 0.0
        else:
            position = (
                float(index) * float(input_length - 1) / float(output_length - 1)
            )

        lower = int(math.floor(position))
        t = position - lower
        upper = min(lower + 1, input_length - 1)

        result.append(spb.blend_pose(sequence[lower], sequence[upper], t))

    return result


def apply_offset(sequence, op):
    """ポーズ列へ加算回転を適用する。"""
    result = []
    bones = op["bones"]
    space = op.get("space", "local")
    envelope = op.get("envelope")

    for index, pose in enumerate(sequence):
        weight = envelope_weight(envelope, index, len(sequence))
        result.append(apply_offset_to_pose(pose, bones, space, weight))

    return result


def apply_root(sequence, op):
    """ポーズ列へ位置オフセットを適用する。"""
    result = copy_sequence(sequence)
    bone_name = op.get("bone", "mixamorig:Hips")
    translate = Vector(op["translate"])
    envelope = op.get("envelope")

    for index, pose in enumerate(result):
        weight = envelope_weight(envelope, index, len(result))
        location, rotation = pose[bone_name]
        pose[bone_name] = (location + weight * translate, rotation)

    return result


def hold_index(sequence, at):
    """hold の対象インデックスを得る。"""
    if at == "start":
        return 0
    if at == "end":
        return len(sequence) - 1
    if at >= len(sequence):
        raise SynthError(
            "hold の at インデックス {} はポーズ列の範囲外です。".format(at)
        )
    return at


def breathe_rotation(full_rotation, weight):
    """負の重みに対応した呼吸用回転を得る。"""
    identity = Quaternion((1.0, 0.0, 0.0, 0.0))

    if weight >= 0.0:
        return spb.slerp_q(identity, full_rotation, weight)

    return spb.slerp_q(identity, full_rotation.inverted(), -weight)


def apply_breathe(sequence, breathe):
    """保持ポーズ列へ呼吸回転を適用する。"""
    if breathe is None:
        return sequence

    result = copy_sequence(sequence)
    bones = breathe["bones"]
    period = breathe.get("period", len(result))

    for index, pose in enumerate(result):
        weight = math.sin(2.0 * math.pi * float(index) / float(period))

        for bone_name, angles in bones.items():
            location, old_rotation = pose[bone_name]
            full_rotation = angle_rotation(angles)
            delta_rotation = breathe_rotation(full_rotation, weight)
            new_rotation = old_rotation @ delta_rotation
            new_rotation.normalize()
            pose[bone_name] = (location, new_rotation)

    return result


def apply_hold(sequence, op):
    """指定ポーズを固定長のポーズ列へ置換する。"""
    index = hold_index(sequence, op.get("at", "start"))
    pose = sequence[index]
    result = [copy_pose(pose) for _ in range(op["frames"])]
    return apply_breathe(result, op.get("breathe"))


def apply_strip_root_motion(sequence, op):
    """ルートの移動成分を除去してインプレース化する。

    In Place 無しでDLしたMixamoクリップは実際に前進するため、そのままシート化すると
    兵士がセルの外へ歩いて出ていく。既定の linear は「先頭→末尾の直線ドリフトだけ」を
    差し引くので、走りの上下動や左右の振りは残る。末尾が先頭と一致するのでループも閉じる。
    """
    bone_name = op.get("bone", "mixamorig:Hips")
    axes = op.get("axes", ["x", "y", "z"])
    mode = op.get("mode", "linear")
    index_of = {"x": 0, "y": 1, "z": 2}

    result = copy_sequence(sequence)
    count = len(result)
    if count == 0:
        return result

    first = result[0][bone_name][0].copy()
    last = result[-1][bone_name][0].copy()

    for i, pose in enumerate(result):
        location, rotation = pose[bone_name]
        new_loc = location.copy()
        for axis in axes:
            a = index_of[axis]
            if mode == "lock":
                new_loc[a] = first[a]
            else:
                t = 0.0 if count == 1 else i / (count - 1)
                new_loc[a] = location[a] - (last[a] - first[a]) * t
        pose[bone_name] = (new_loc, rotation)

    return result


def apply_graft(arm, sequence, op):
    """別クリップの一部ボーンを現在のポーズ列へ移植する。

    上半身だけ差し替えることで、立ちリロード1本から膝立ち/伏せ版を導出できる。
    ドナーは現在の列長へリサンプルしてから重ねる。
    """
    donor_act = spb.require_action(op["from"])
    fs, fe = spb.action_bounds(donor_act)
    step = op.get("step", 1)

    frames = list(range(fs, fe + 1, step))
    if not frames or frames[-1] != fe:
        frames.append(fe)
    donor = [spb.sample_pose(arm, donor_act, f) for f in frames]

    count = len(sequence)
    donor = apply_retime(donor, {"frames": count}) if count != len(donor) else donor

    names = resolve_bone_group(op["bones"], set(sequence[0].keys()))
    result = copy_sequence(sequence)
    for i, pose in enumerate(result):
        for bone_name in names:
            if bone_name in donor[i]:
                loc, rot = donor[i][bone_name]
                pose[bone_name] = (loc.copy(), rot.copy())
    return result


def apply_ops(arm, sequence, ops):
    """演算列を記載順に適用する。"""
    result = sequence

    for op in ops:
        op_name = op["op"]

        if op_name == "retime":
            result = apply_retime(result, op)
        elif op_name == "offset":
            result = apply_offset(result, op)
        elif op_name == "root":
            result = apply_root(result, op)
        elif op_name == "hold":
            result = apply_hold(result, op)
        elif op_name == "strip_root_motion":
            result = apply_strip_root_motion(result, op)
        elif op_name == "graft":
            result = apply_graft(arm, result, op)
        else:
            raise SynthError('演算 "{}" は使用できません。'.format(op_name))

    return result


def write_action(arm, name, sequence):
    """ポーズ列を新規アクションとして書き込む。"""
    if not sequence:
        raise SynthError('クリップ "{}" のポーズ列が空です。'.format(name))

    spb.remove_action_if_exists(arm, name)
    action = bpy.data.actions.new(name)
    spb.assign_action(arm, action)

    for frame, pose in enumerate(sequence, start=1):
        spb.write_pose(arm, pose, frame)

    action.use_fake_user = True
    return action


def synthesize_clip(arm, clip):
    """1 クリップをサンプリング、変換、書き込みする。"""
    sequence = build_sequence(arm, clip)
    sequence = apply_ops(arm, sequence, clip.get("ops", []))
    write_action(arm, clip["name"], sequence)
    return len(sequence)


def main():
    """合成処理を実行する。"""
    try:
        args = parse_args()
        arm = spb.get_armature()
        spb.ensure_quaternion_rotation(arm)

        spec = spb.load_spec(args.spec)
        validate_spec(spec, arm)

        created = []

        for clip in spec["clips"]:
            name = clip["name"]
            ops = clip.get("ops", [])
            frames = synthesize_clip(arm, clip)

            print("INFO: 合成完了: {} ({}フレーム)".format(name, frames))

            created.append(
                {
                    "name": name,
                    "frames": frames,
                    "ops": [op["op"] for op in ops],
                }
            )

        spb.save_blend(args.save)
        print(
            "SP_SYNTH_RESULT="
            + json.dumps({"created": created}, ensure_ascii=False)
        )

    except (SynthError, spb.BakeError) as exc:
        print("エラー: {}".format(exc), file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:
        print("予期しないエラー: {}".format(exc), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
