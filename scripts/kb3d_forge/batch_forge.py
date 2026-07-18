from __future__ import annotations

import argparse
import html
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from paths import BLENDER_EXE, DEFAULT_CATALOG_OUT, KB_BLEND_PATH


BUILD_OK_RE = re.compile(
    r"^BUILD OK name=(.*?) parts=(\d+) time=([0-9]+(?:\.[0-9]+)?)s?\s*$"
)


def ascii_text(value: Any) -> str:
    return str(value).encode("ascii", "backslashreplace").decode("ascii")


def load_recipe(recipe_path: Path) -> dict[str, Any]:
    with recipe_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def recipe_thumb(recipe: dict[str, Any]) -> str | None:
    output = recipe.get("output")
    if not isinstance(output, dict):
        return None
    thumb = output.get("thumb")
    if thumb is None:
        return None
    return str(thumb)


def thumb_exists(thumb: str | None) -> bool:
    return bool(thumb) and Path(thumb).exists()


def parse_stdout(stdout: str) -> tuple[str | None, int | None, float | None, list[str], list[str]]:
    name = None
    parts = None
    build_time = None
    warns: list[str] = []
    fails: list[str] = []

    for raw_line in stdout.splitlines():
        line = raw_line.strip()

        match = BUILD_OK_RE.match(line)
        if match:
            name = match.group(1)
            parts = int(match.group(2))
            build_time = float(match.group(3))
            continue

        if line.startswith("VERIFY ") and "FAIL" in line:
            fails.append(line)
            continue

        if line.startswith("DESTRUCTION holes="):
            continue

        if line.startswith("WARN "):
            warns.append(line)

    return name, parts, build_time, warns, fails


def result_record(
    recipe_path: Path,
    recipe_name: str,
    thumb: str | None,
    exit_code: int | None,
    status: str,
    parts: int | None = None,
    build_time: float | None = None,
    warns: list[str] | None = None,
    fails: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "recipe": str(recipe_path),
        "name": recipe_name,
        "exit_code": exit_code,
        "status": status,
        "parts": parts,
        "build_time": build_time,
        "thumb": thumb,
        "warns": warns or [],
        "fails": fails or [],
    }


def write_index(index_path: Path, records: list[dict[str, Any]]) -> None:
    cells: list[str] = []

    for record in records:
        status = str(record["status"])
        border_class = " fail" if status != "ok" else ""
        thumb = record.get("thumb")
        image_html = ""

        if thumb:
            relative_thumb = os.path.relpath(
                os.path.abspath(str(thumb)),
                start=str(index_path.parent.resolve()),
            )
            relative_thumb = relative_thumb.replace(os.sep, "/")
            image_html = (
                '<img src="'
                + html.escape(relative_thumb, quote=True)
                + '" alt="'
                + html.escape(str(record["name"]), quote=True)
                + '">'
            )

        parts = "-" if record["parts"] is None else str(record["parts"])
        build_time = (
            "-"
            if record["build_time"] is None
            else f'{float(record["build_time"]):.1f}s'
        )

        cells.append(
            '<div class="cell'
            + border_class
            + '">'
            + image_html
            + '<div class="name">'
            + html.escape(str(record["name"]))
            + "</div>"
            + '<div class="meta">parts='
            + html.escape(parts)
            + " time="
            + html.escape(build_time)
            + " status="
            + html.escape(status)
            + "</div></div>"
        )

    document = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>KB3D Forge Report</title>
<style>
body { font-family: sans-serif; margin: 20px; background: #202020; color: #eeeeee; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.cell { border: 3px solid #4b9b54; padding: 8px; background: #2d2d2d; }
.cell.fail { border-color: #d33; }
img { display: block; width: 320px; max-width: 100%; height: auto; background: #111; }
.name { margin-top: 8px; font-weight: bold; }
.meta { margin-top: 4px; font-family: monospace; font-size: 13px; }
</style>
</head>
<body>
<h1>KB3D Forge Report</h1>
<div class="grid">
""" + "\n".join(cells) + """
</div>
</body>
</html>
"""

    index_path.write_text(document, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build KB3D forge recipes serially.")
    parser.add_argument("--recipes-dir", required=True)
    parser.add_argument("--catalog", default=str(DEFAULT_CATALOG_OUT))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--report")
    parser.add_argument("--skip-existing", action="store_true")
    args = parser.parse_args()

    recipes_dir = Path(args.recipes_dir)
    catalog_path = Path(args.catalog)
    report_path = Path(args.report) if args.report else recipes_dir / "forge_report.json"

    recipe_paths = sorted(recipes_dir.glob("FORGE_*.json"), key=lambda path: path.name)
    if args.limit is not None:
        recipe_paths = recipe_paths[: max(0, args.limit)]

    total = len(recipe_paths)
    records: list[dict[str, Any]] = []

    for index, recipe_path in enumerate(recipe_paths, start=1):
        fallback_name = recipe_path.stem

        try:
            recipe = load_recipe(recipe_path)
        except (OSError, json.JSONDecodeError) as exc:
            record = result_record(
                recipe_path,
                fallback_name,
                None,
                None,
                "error",
                fails=[f"RECIPE ERROR {exc}"],
            )
            records.append(record)
            print(
                ascii_text(
                    f"[{index}/{total}] {recipe_path.stem} ... error (0.0s)"
                )
            )
            continue

        recipe_name = str(recipe.get("name", fallback_name))
        thumb = recipe_thumb(recipe)

        if args.skip_existing and thumb_exists(thumb):
            record = result_record(
                recipe_path,
                recipe_name,
                thumb,
                0,
                "ok",
            )
            records.append(record)
            print(
                ascii_text(
                    f"[{index}/{total}] {recipe_path.stem} ... ok (skipped)"
                )
            )
            continue

        command = [
            str(BLENDER_EXE),
            "-b",
            str(KB_BLEND_PATH),
            "-P",
            str(SCRIPT_DIR / "forge_build.py"),
            "--",
            "--recipe",
            str(recipe_path),
            "--catalog",
            str(catalog_path),
        ]

        stdout = ""
        exit_code: int | None = None
        status = "error"

        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=600,
            )
            stdout = completed.stdout or ""
            exit_code = completed.returncode
            parsed_name, parts, build_time, warns, fails = parse_stdout(stdout)

            if fails:
                status = "verify_fail"
            elif exit_code != 0:
                status = "error"
            elif parsed_name is None:
                status = "error"
                fails.append("BUILD ERROR missing BUILD OK line")
            else:
                status = "ok"

            record = result_record(
                recipe_path,
                parsed_name or recipe_name,
                thumb,
                exit_code,
                status,
                parts,
                build_time,
                warns,
                fails,
            )
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout or ""
            if isinstance(stdout, bytes):
                stdout = stdout.decode(errors="replace")
            parsed_name, parts, build_time, warns, fails = parse_stdout(stdout)
            record = result_record(
                recipe_path,
                parsed_name or recipe_name,
                thumb,
                None,
                "timeout",
                parts,
                build_time,
                warns,
                fails,
            )
        except OSError as exc:
            record = result_record(
                recipe_path,
                recipe_name,
                thumb,
                None,
                "error",
                fails=[f"PROCESS ERROR {exc}"],
            )

        records.append(record)
        elapsed = record["build_time"]
        elapsed_text = f"{float(elapsed):.1f}s" if elapsed is not None else "0.0s"
        print(
            ascii_text(
                f"[{index}/{total}] {recipe_path.stem} ... "
                f'{record["status"]} ({elapsed_text})'
            ),
            flush=True,
        )

    counts = {
        "total": len(records),
        "ok": sum(record["status"] == "ok" for record in records),
        "verify_fail": sum(record["status"] == "verify_fail" for record in records),
        "error": sum(record["status"] == "error" for record in records),
        "timeout": sum(record["status"] == "timeout" for record in records),
    }
    build_times = [
        float(record["build_time"])
        for record in records
        if record["build_time"] is not None
    ]
    average_build_time = sum(build_times) / len(build_times) if build_times else 0.0

    report = {
        "summary": {
            **counts,
            "average_build_time": average_build_time,
        },
        "results": records,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_index(recipes_dir / "index.html", records)

    print(
        ascii_text(
            "total={total} ok={ok} verify_fail={verify_fail} "
            "error={error} timeout={timeout} avg_build_time={avg:.1f}s".format(
                **counts,
                avg=average_build_time,
            )
        )
    )

    return 0 if counts["ok"] == counts["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
