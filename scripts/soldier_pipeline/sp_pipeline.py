#!/usr/bin/env python3
"""
Blender外の兵士スプライト生成パイプラインを順番に実行する。

例:
    python sp_pipeline.py
    python sp_pipeline.py --config C:/Projects/squad_tactics/scripts/soldier_pipeline/config.json --only stand_idle,walk
    python sp_pipeline.py --fresh --force
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


REQUIRED_CONFIG_KEYS = (
    "blender_exe",
    "master_blend",
    "work_blend",
    "fbx_drop_dir",
    "fbx_map",
    "frames_dir",
    "sheets_dir",
    "jobs",
    "transitions",
    "repack",
    "scripts_dir",
)

# 任意のパスキー: 未設定なら該当ステージをスキップする
OPTIONAL_PATH_KEYS = ("synth_clips",)


def parse_only(value):
    """CSV形式のジョブ指定を解析する。"""
    if not value:
        return None
    names = {item.strip() for item in value.split(",") if item.strip()}
    return names or None


def load_config(config_path):
    """設定をUTF-8で読み込み、相対パスを設定ファイル基準で解決する。"""
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(f"config.json が見つかりません: {config_path}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"config.json のJSONが不正です: {config_path} ({exc})")

    if not isinstance(raw, dict):
        raise ValueError("config.json のルートはオブジェクトである必要があります")

    missing = [key for key in REQUIRED_CONFIG_KEYS if not isinstance(raw.get(key), str) or not raw[key]]
    if missing:
        raise ValueError(f"config.json に必須キーがありません: {', '.join(missing)}")

    base_dir = config_path.parent
    config = {}
    for key in REQUIRED_CONFIG_KEYS:
        value = Path(raw[key]).expanduser()
        config[key] = value if value.is_absolute() else (base_dir / value)

    for key in OPTIONAL_PATH_KEYS:
        raw_value = raw.get(key)
        if raw_value is None or raw_value == "":
            config[key] = None
            continue
        if not isinstance(raw_value, str):
            raise ValueError(f"config.json の {key} は文字列である必要があります")
        value = Path(raw_value).expanduser()
        config[key] = value if value.is_absolute() else (base_dir / value)

    # 任意キー: repack / render へ渡す追加引数
    # 例: repack_args=["--char-h","72"], render_args=["--ortho-scale","4.67","--rot-sign","-1"]
    for opt_key in ("repack_args", "render_args"):
        extra = raw.get(opt_key, [])
        if not isinstance(extra, list) or not all(isinstance(x, str) for x in extra):
            raise ValueError(f"config.json の {opt_key} は文字列配列である必要があります")
        config[opt_key] = extra

    return config


def load_jobs(path):
    """ジョブ一覧を読み込み、nameとsheet_nameを正規化する。"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(f"jobs.json が見つかりません: {path}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"jobs.json のJSONが不正です: {path} ({exc})")

    raw_jobs = data.get("jobs")
    if not isinstance(raw_jobs, list):
        raise ValueError("jobs.json の 'jobs' は配列である必要があります")

    jobs = []
    seen = set()
    for index, raw_job in enumerate(raw_jobs):
        if not isinstance(raw_job, dict):
            raise ValueError(f"jobs[{index}] がオブジェクトではありません")
        name = raw_job.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError(f"jobs[{index}] の name が不正です")
        if name in seen:
            raise ValueError(f"jobs.json に重複した name があります: {name}")
        seen.add(name)

        sheet_name = raw_job.get("sheet_name") or name
        if not isinstance(sheet_name, str) or not sheet_name:
            raise ValueError(f"jobs[{index}] の sheet_name が不正です")

        job = dict(raw_job)
        job["sheet_name"] = sheet_name
        jobs.append(job)

    return jobs


def run_command(stage, command, cwd=None):
    """UTF-8で子プロセスの出力をリアルタイム中継する。"""
    print(f"\n[{stage}] 実行:")
    print("  " + subprocess.list2cmdline(command))
    started = time.perf_counter()

    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"

    try:
        process = subprocess.Popen(
            command,
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=env,
        )
    except OSError as exc:
        raise RuntimeError(f"[{stage}] プロセスを起動できません: {exc}")

    assert process.stdout is not None
    for line in process.stdout:
        print(line, end="")

    return_code = process.wait()
    elapsed = time.perf_counter() - started
    if return_code != 0:
        raise RuntimeError(f"[{stage}] 失敗しました（exit code {return_code}、{elapsed:.1f}秒）")

    print(f"[{stage}] 完了: {elapsed:.1f}秒")
    return elapsed


def prepare_work_blend(config, fresh):
    """必要時のみmasterをworkへコピーする。"""
    started = time.perf_counter()
    master = config["master_blend"]
    work = config["work_blend"]

    if work.exists() and not fresh:
        print(f"[prepare] 既存の work.blend を使用します: {work}")
        return time.perf_counter() - started, "existing"

    if not master.is_file():
        raise RuntimeError(f"[prepare] master_blend が見つかりません: {master}")

    work.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(master, work)
    print(f"[prepare] master をコピーしました: {master} -> {work}")
    return time.perf_counter() - started, "copied"


def blender_command(config, script_name, script_args):
    """Blenderバックグラウンド実行コマンドを作る。"""
    script = config["scripts_dir"] / script_name
    if not script.is_file():
        raise RuntimeError(f"Blenderスクリプトが見つかりません: {script}")

    return [
        str(config["blender_exe"]),
        "-b",
        str(config["work_blend"]),
        "--python",
        str(script),
        "--",
        *script_args,
    ]


def main():
    parser = argparse.ArgumentParser(description="兵士スプライト生成パイプラインを実行します。")
    parser.add_argument("--config", help="config.json のパス（既定: このスクリプトと同じ場所）")
    parser.add_argument("--skip-import", action="store_true", help="FBX取込を省略")
    parser.add_argument("--skip-bake", action="store_true", help="遷移ベイクを省略")
    parser.add_argument("--skip-synth", action="store_true", help="クリップ合成を省略")
    parser.add_argument("--skip-render", action="store_true", help="レンダを省略")
    parser.add_argument("--skip-compose", action="store_true", help="シート合成を省略")
    parser.add_argument("--skip-repack", action="store_true", help="repackを省略")
    parser.add_argument("--only", help="対象ジョブ名をカンマ区切りで指定")
    parser.add_argument("--force", action="store_true", help="既存シートがあってもレンダ・合成する")
    parser.add_argument("--fresh", action="store_true", help="master_blendからwork_blendを作り直す")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    config_path = Path(args.config) if args.config else script_dir / "config.json"
    if not config_path.is_absolute():
        config_path = (Path.cwd() / config_path).resolve()

    stage_times = []
    pipeline_started = time.perf_counter()

    try:
        config = load_config(config_path)
        only = parse_only(args.only)

        if not config["blender_exe"].is_file():
            raise ValueError(f"blender_exe が見つかりません: {config['blender_exe']}")

        prepare_seconds, prepare_state = prepare_work_blend(config, args.fresh)
        stage_times.append(("prepare", prepare_seconds, prepare_state))

        jobs = load_jobs(config["jobs"])
        all_names = {job["name"] for job in jobs}
        if only is not None:
            unknown = sorted(only - all_names)
            if unknown:
                raise ValueError(f"--only に存在しないジョブがあります: {', '.join(unknown)}")
            requested_jobs = [job for job in jobs if job["name"] in only]
        else:
            requested_jobs = jobs

        config["sheets_dir"].mkdir(parents=True, exist_ok=True)
        if args.force:
            target_jobs = requested_jobs
        else:
            target_jobs = [
                job for job in requested_jobs
                if not (config["sheets_dir"] / f"{job['sheet_name']}_spritesheet.png").is_file()
            ]

        skipped_existing = [job["name"] for job in requested_jobs if job not in target_jobs]
        if skipped_existing:
            print("[select] 既存シートのため除外: " + ", ".join(skipped_existing))
        if target_jobs:
            print("[select] 対象ジョブ: " + ", ".join(job["name"] for job in target_jobs))
        else:
            print("[select] 対象ジョブはありません")

        if args.skip_import:
            print("[import] skip (--skip-import)")
            stage_times.append(("import", 0.0, "skipped"))
        else:
            fbx_dir = config["fbx_drop_dir"]
            fbx_files = sorted(path for path in fbx_dir.glob("*.fbx") if path.is_file()) if fbx_dir.is_dir() else []
            if not fbx_files:
                print("[import] skip (no fbx)")
                stage_times.append(("import", 0.0, "no fbx"))
            else:
                if not config["fbx_map"].is_file():
                    raise RuntimeError(f"[import] fbx_map が見つかりません: {config['fbx_map']}")
                elapsed = run_command(
                    "import",
                    blender_command(
                        config,
                        "sp_import_fbx.py",
                        ["--fbx-dir", str(fbx_dir), "--map", str(config["fbx_map"])],
                    ),
                )
                stage_times.append(("import", elapsed, "done"))

        if args.skip_bake:
            print("[bake] skip (--skip-bake)")
            stage_times.append(("bake", 0.0, "skipped"))
        elif not config["transitions"].is_file():
            print("[bake] skip (transitions.json がありません)")
            stage_times.append(("bake", 0.0, "no transitions"))
        else:
            elapsed = run_command(
                "bake",
                blender_command(config, "sp_bake_transitions.py", ["--spec", str(config["transitions"])]),
            )
            stage_times.append(("bake", elapsed, "done"))

        # 合成クリップ（遮蔽・回避・被弾）は遷移ベイクの後、レンダの前に作る。
        # 遷移ベイク済みアクションを入力に取れるよう順序を固定している。
        if args.skip_synth:
            print("[synth] skip (--skip-synth)")
            stage_times.append(("synth", 0.0, "skipped"))
        elif config["synth_clips"] is None:
            print("[synth] skip (config に synth_clips がありません)")
            stage_times.append(("synth", 0.0, "no config"))
        elif not config["synth_clips"].is_file():
            raise RuntimeError(f"[synth] synth_clips が見つかりません: {config['synth_clips']}")
        else:
            elapsed = run_command(
                "synth",
                blender_command(config, "sp_synth_clips.py", ["--spec", str(config["synth_clips"])]),
            )
            stage_times.append(("synth", elapsed, "done"))

        target_names = [job["name"] for job in target_jobs]
        only_argument = ",".join(target_names)

        if args.skip_render:
            print("[render] skip (--skip-render)")
            stage_times.append(("render", 0.0, "skipped"))
        elif not target_jobs:
            print("[render] skip (対象ジョブなし)")
            stage_times.append(("render", 0.0, "no jobs"))
        else:
            config["frames_dir"].mkdir(parents=True, exist_ok=True)
            elapsed = run_command(
                "render",
                blender_command(
                    config,
                    "sp_render_frames.py",
                    [
                        "--jobs", str(config["jobs"]),
                        "--out-dir", str(config["frames_dir"]),
                        "--only", only_argument,
                        *config["render_args"],
                    ],
                ),
            )
            stage_times.append(("render", elapsed, "done"))

        if args.skip_compose:
            print("[compose] skip (--skip-compose)")
            stage_times.append(("compose", 0.0, "skipped"))
        elif not target_jobs:
            print("[compose] skip (対象ジョブなし)")
            stage_times.append(("compose", 0.0, "no jobs"))
        else:
            compose_script = config["scripts_dir"] / "sp_compose_sheets.py"
            if not compose_script.is_file():
                raise RuntimeError(f"[compose] スクリプトが見つかりません: {compose_script}")
            elapsed = run_command(
                "compose",
                [
                    sys.executable,
                    str(compose_script),
                    "--frames-dir", str(config["frames_dir"]),
                    "--out-dir", str(config["sheets_dir"]),
                    "--jobs", str(config["jobs"]),
                    "--only", only_argument,
                ],
            )
            stage_times.append(("compose", elapsed, "done"))

        if args.skip_repack:
            print("[repack] skip (--skip-repack)")
            stage_times.append(("repack", 0.0, "skipped"))
        else:
            repack = config["repack"]
            if not repack.is_file():
                raise RuntimeError(f"[repack] スクリプトが見つかりません: {repack}")
            elapsed = run_command("repack", [sys.executable, str(repack), *config["repack_args"]])
            stage_times.append(("repack", elapsed, "done"))

        total = time.perf_counter() - pipeline_started
        print("\n=== パイプライン完了 ===")
        for name, seconds, state in stage_times:
            print(f"{name:8s}: {seconds:7.1f}秒  ({state})")
        print(f"合計     : {total:.1f}秒")
        print(f"対象ジョブ数: {len(target_jobs)}")
        return 0

    except (ValueError, RuntimeError, OSError) as exc:
        total = time.perf_counter() - pipeline_started
        print(f"\n[PIPELINE ERROR] {exc}", file=sys.stderr)
        print(f"失敗までの経過時間: {total:.1f}秒", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
