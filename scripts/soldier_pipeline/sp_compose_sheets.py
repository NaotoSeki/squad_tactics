#!/usr/bin/env python3
"""
レンダ済み方向別フレームをスプライトシートへ合成する。

例:
    python sp_compose_sheets.py --frames-dir C:/work/frames --out-dir C:/work/sheets --jobs jobs.json
    python sp_compose_sheets.py --frames-dir frames --out-dir sheets --jobs jobs.json --only stand_idle,walk
"""

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image


CELL_WIDTH = 400
CELL_HEIGHT = 262
DIRECTIONS = 8
FRAME_RE = re.compile(r"^d([0-7])_f(\d{3,})\.png$", re.IGNORECASE)


def parse_only(value):
    """--only のCSVを集合へ変換する。"""
    if not value:
        return None
    names = {item.strip() for item in value.split(",") if item.strip()}
    return names or None


def load_jobs(path):
    """jobs.jsonを読み込む。"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(f"jobs.json が見つかりません: {path}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"jobs.json のJSONが不正です: {path} ({exc})")

    jobs = data.get("jobs")
    if not isinstance(jobs, list):
        raise ValueError("jobs.json の 'jobs' は配列である必要があります")

    seen_names = set()
    result = []
    for index, job in enumerate(jobs):
        if not isinstance(job, dict) or not isinstance(job.get("name"), str) or not job["name"]:
            raise ValueError(f"jobs[{index}] の name が不正です")
        if job["name"] in seen_names:
            raise ValueError(f"jobs.json に重複した name があります: {job['name']}")
        seen_names.add(job["name"])
        result.append(job)
    return result


def collect_frames(job_dir):
    """フレームを収集し、命名・寸法・連番を検証する。"""
    if not job_dir.is_dir():
        raise ValueError(f"フレームディレクトリがありません: {job_dir}")

    by_direction = [dict() for _ in range(DIRECTIONS)]
    png_files = sorted(path for path in job_dir.iterdir() if path.is_file() and path.suffix.lower() == ".png")

    if not png_files:
        raise ValueError(f"PNGがありません: {job_dir}")

    for path in png_files:
        match = FRAME_RE.match(path.name)
        if not match:
            raise ValueError(f"不正なPNGファイル名です: {path.name} (d{{0..7}}_f{{連番}}.png が必要)")
        direction = int(match.group(1))
        frame = int(match.group(2))
        if frame in by_direction[direction]:
            raise ValueError(f"重複フレームです: {path}")
        by_direction[direction][frame] = path

        try:
            with Image.open(path) as image:
                if image.size != (CELL_WIDTH, CELL_HEIGHT):
                    raise ValueError(
                        f"PNG寸法が不正です: {path} "
                        f"({image.size[0]}x{image.size[1]}、{CELL_WIDTH}x{CELL_HEIGHT} が必要)"
                    )
        except OSError as exc:
            raise ValueError(f"PNGを開けません: {path} ({exc})")

    counts = []
    ordered = []
    for direction in range(DIRECTIONS):
        frames = by_direction[direction]
        if not frames:
            raise ValueError(f"方向 d{direction} のフレームがありません: {job_dir}")

        indices = sorted(frames)
        expected = list(range(len(indices)))
        if indices != expected:
            raise ValueError(
                f"方向 d{direction} のフレーム番号が0始まり連番ではありません: "
                f"{','.join(str(i) for i in indices)}"
            )

        ordered.append([frames[index] for index in indices])
        counts.append(len(indices))

    if len(set(counts)) != 1:
        detail = ", ".join(f"d{direction}={count}" for direction, count in enumerate(counts))
        raise ValueError(f"方向間でフレーム数が一致しません: {detail}")

    return ordered, counts[0]


def compose_job(frames_dir, out_dir, job):
    """1ジョブのシートを作成する。"""
    name = job["name"]
    sheet_name = job.get("sheet_name") or name
    if not isinstance(sheet_name, str) or not sheet_name:
        raise ValueError(f"ジョブ '{name}' の sheet_name が不正です")

    frame_sets, frame_count = collect_frames(frames_dir / name)
    output_path = out_dir / f"{sheet_name}_spritesheet.png"

    if output_path.exists():
        print(f"[compose] 上書きします: {output_path}")

    sheet = Image.new("RGBA", (frame_count * CELL_WIDTH, DIRECTIONS * CELL_HEIGHT), (0, 0, 0, 0))
    try:
        for direction, paths in enumerate(frame_sets):
            for frame_index, path in enumerate(paths):
                with Image.open(path) as image:
                    rgba = image.convert("RGBA")
                    sheet.alpha_composite(rgba, (frame_index * CELL_WIDTH, direction * CELL_HEIGHT))
        sheet.save(output_path, "PNG")
    finally:
        sheet.close()

    print(f"[compose] 完了: {name} -> {output_path} ({frame_count} frames x 8 directions)")
    return {
        "name": name,
        "sheet_name": sheet_name,
        "path": str(output_path),
        "frames": frame_count,
    }


def main():
    parser = argparse.ArgumentParser(description="方向別PNGフレームからスプライトシートを作成します。")
    parser.add_argument("--frames-dir", required=True, help="レンダ済みフレームの親ディレクトリ")
    parser.add_argument("--out-dir", required=True, help="スプライトシート出力先")
    parser.add_argument("--jobs", required=True, help="jobs.json のパス")
    parser.add_argument("--only", help="処理するジョブ名をカンマ区切りで指定")
    args = parser.parse_args()

    try:
        frames_dir = Path(args.frames_dir)
        out_dir = Path(args.out_dir)
        jobs = load_jobs(Path(args.jobs))
        only = parse_only(args.only)

        if only is not None:
            available = {job["name"] for job in jobs}
            unknown = sorted(only - available)
            if unknown:
                raise ValueError(f"--only に存在しないジョブがあります: {', '.join(unknown)}")
            jobs = [job for job in jobs if job["name"] in only]

        out_dir.mkdir(parents=True, exist_ok=True)

        results = [compose_job(frames_dir, out_dir, job) for job in jobs]
        print("SP_COMPOSE_RESULT=" + json.dumps(
            {"ok": True, "count": len(results), "sheets": results},
            ensure_ascii=False,
        ))
        return 0

    except (ValueError, OSError) as exc:
        print(f"[compose] エラー: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
