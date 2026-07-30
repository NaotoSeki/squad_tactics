"""
Mixamo FBX をメインリグ用アクションとして一括取込する。

例:
    blender.exe -b work.blend --python sp_import_fbx.py -- ^
        --fbx-dir "D:\\fbx" --map "D:\\fbx\\map.json" --save "D:\\work.blend"
"""

import argparse
import json
import os
import sys

import bpy


def script_argv():
    """-- 以降だけを取得する。"""
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]


def remove_objects(objects):
    """オブジェクトを安全に削除する。"""
    for obj in list(objects):
        if obj and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)


def remove_unused_import_actions(actions, keep=None):
    """取込失敗時の未使用アクションを削除する。"""
    for action in list(actions):
        if action == keep:
            continue
        if action and action.name in bpy.data.actions and action.users == 0:
            bpy.data.actions.remove(action)


def cleanup_orphan_data():
    """指定された未使用データだけを掃除する。"""
    collections = (
        bpy.data.meshes,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.images,
    )
    for collection in collections:
        for datablock in list(collection):
            if datablock.users == 0 and datablock.library is None:
                collection.remove(datablock)


def bone_match_ratio(main_armature, imported_armature):
    """骨名集合の一致率を返す。"""
    main_names = {bone.name for bone in main_armature.data.bones}
    imported_names = {bone.name for bone in imported_armature.data.bones}
    denominator = max(len(main_names), len(imported_names), 1)
    return len(main_names & imported_names) / denominator


def find_imported_armature(new_objects, main_armature):
    """最も骨名が近い新規アーマチュアを選ぶ。"""
    candidates = [obj for obj in new_objects if obj.type == "ARMATURE"]
    if not candidates:
        return None, 0.0

    ranked = [
        (bone_match_ratio(main_armature, candidate), candidate)
        for candidate in candidates
    ]
    ratio, armature = max(ranked, key=lambda item: item[0])
    return armature, ratio


def choose_imported_action(new_actions, imported_armature):
    """アーマチュアのアクションを優先して選ぶ。"""
    if not new_actions:
        return None

    animation_data = imported_armature.animation_data
    active_action = animation_data.action if animation_data else None
    if active_action in new_actions:
        return active_action

    return sorted(new_actions, key=lambda action: action.name)[0]


def load_name_map(path):
    """JSON マップを読み込む。"""
    if not path:
        return {}

    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)

    if not isinstance(data, dict):
        raise RuntimeError("--map は JSON オブジェクトである必要があります。")

    return {str(key): str(value) for key, value in data.items() if not key.startswith("_")}


def main():
    parser = argparse.ArgumentParser(description="Mixamo FBX 一括取込")
    parser.add_argument("--fbx-dir", required=True, help="FBX ディレクトリ")
    parser.add_argument("--map", help="ファイル名からアクション名への JSON マップ")
    parser.add_argument("--save", help="保存先 blend ファイル")
    args = parser.parse_args(script_argv())

    main_armature = bpy.data.objects.get("Armature")
    if main_armature is None or main_armature.type != "ARMATURE":
        raise RuntimeError('メインリグ "Armature" が見つからないか、ARMATURE ではありません。')

    fbx_dir = os.path.abspath(bpy.path.abspath(args.fbx_dir))
    if not os.path.isdir(fbx_dir):
        raise RuntimeError(f"FBX ディレクトリが見つかりません: {fbx_dir}")

    name_map = load_name_map(args.map)
    fbx_files = sorted(
        [
            os.path.join(fbx_dir, filename)
            for filename in os.listdir(fbx_dir)
            if filename.lower().endswith(".fbx")
        ],
        key=lambda path: os.path.basename(path).lower(),
    )

    result = {"imported": [], "skipped": []}

    for fbx_path in fbx_files:
        filename = os.path.basename(fbx_path)
        target_name = name_map.get(filename)

        if not target_name:
            target_name = os.path.splitext(filename)[0].replace(" ", "_")
            print(
                f"WARN: map に無いため stem をアクション名にします: "
                f"{filename} -> {target_name}",
                file=sys.stderr,
            )

        before_objects = set(bpy.data.objects)
        before_actions = set(bpy.data.actions)

        try:
            bpy.ops.import_scene.fbx(filepath=fbx_path)
        except Exception as exc:
            new_objects = set(bpy.data.objects) - before_objects
            remove_objects(new_objects)
            result["skipped"].append(
                {"fbx": filename, "reason": f"FBX インポート失敗: {exc}"}
            )
            print(f"ERROR: {filename}: FBX インポートに失敗しました: {exc}", file=sys.stderr)
            continue

        new_objects = set(bpy.data.objects) - before_objects
        new_actions = set(bpy.data.actions) - before_actions
        imported_armature, match_ratio = find_imported_armature(
            new_objects, main_armature
        )

        if imported_armature is None:
            remove_objects(new_objects)
            remove_unused_import_actions(new_actions)
            reason = "新規アーマチュアが見つかりません。"
            result["skipped"].append({"fbx": filename, "reason": reason})
            print(f"ERROR: {filename}: {reason}", file=sys.stderr)
            continue

        if match_ratio < 0.80:
            remove_objects(new_objects)
            remove_unused_import_actions(new_actions)
            reason = f"骨名一致率が不足しています ({match_ratio:.1%} < 80%)。"
            result["skipped"].append({"fbx": filename, "reason": reason})
            print(f"ERROR: {filename}: {reason}", file=sys.stderr)
            continue

        imported_action = choose_imported_action(new_actions, imported_armature)
        if imported_action is None:
            remove_objects(new_objects)
            remove_unused_import_actions(new_actions)
            reason = "新規アクションが見つかりません。"
            result["skipped"].append({"fbx": filename, "reason": reason})
            print(f"ERROR: {filename}: {reason}", file=sys.stderr)
            continue

        existing_action = bpy.data.actions.get(target_name)
        if existing_action is not None and existing_action != imported_action:
            bpy.data.actions.remove(existing_action, do_unlink=True)

        imported_action.name = target_name
        imported_action.use_fake_user = True

        remove_objects(new_objects)
        remove_unused_import_actions(new_actions, keep=imported_action)

        result["imported"].append(
            {
                "fbx": filename,
                "action": imported_action.name,
                "bones_match": round(match_ratio, 6),
            }
        )
        print(
            f"INFO: 取込完了: {filename} -> {imported_action.name} "
            f"(骨名一致率 {match_ratio:.1%})"
        )

    cleanup_orphan_data()

    save_path = args.save
    if save_path:
        save_path = os.path.abspath(bpy.path.abspath(save_path))
    else:
        save_path = bpy.data.filepath

    if not save_path:
        raise RuntimeError("--save 未指定時は、開いている blend ファイルが必要です。")

    bpy.ops.wm.save_as_mainfile(filepath=save_path)
    print("SP_IMPORT_RESULT=" + json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
