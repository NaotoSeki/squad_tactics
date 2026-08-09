#!/usr/bin/env python3
"""Pack canonical Panzer Strike animation slots into Phaser runtime sheets."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


SPECS = {
    "ps_fire_cell_00": {
        "ssc": "Animations/fire_cell_00.ssc",
        "config": "Configs/Animations/animations_fire.sdt",
        "frames_per_tick": 1000,
        "repeat": True,
    },
    "ps_fire_cell_01": {
        "ssc": "Animations/fire_cell_01.ssc",
        "config": "Configs/Animations/animations_fire.sdt",
        "frames_per_tick": 1000,
        "repeat": True,
    },
    "ps_gun_light_dust_00": {
        "ssc": "Animations/Guns/gun_light_hit_default_dust_00.ssc",
        "config": "Configs/Animations/animations_gun_light.sdt",
        "frames_per_tick": 1000,
        "repeat": False,
    },
    "ps_gun_medium_smoke_00": {
        "ssc": "Animations/Guns/gun_medium_hit_default_smoke_00.ssc",
        "config": "Configs/Animations/animations_gun_medium.sdt",
        "frames_per_tick": 1000,
        "repeat": False,
    },
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def body_entries(manifest: dict, ssc: str) -> list[dict]:
    entries = sorted(
        (entry for entry in manifest["sprites"] if entry["ssc"] == ssc),
        key=lambda entry: int(entry["slot"]),
    )
    first_shadow = next(
        (int(entry["slot"]) for entry in entries if int(entry["format_id"]) == 934),
        None,
    )
    if first_shadow is not None:
        entries = [entry for entry in entries if int(entry["slot"]) < first_shadow]
    # Canonical gaps separate the temporal body sequence from tiny helper
    # slots and auxiliary layers.  The body is the largest contiguous run.
    runs: list[list[dict]] = []
    contiguous: list[dict] = []
    previous = None
    for entry in entries:
        slot = int(entry["slot"])
        if previous is not None and slot != previous + 1:
            runs.append(contiguous)
            contiguous = []
        contiguous.append(entry)
        previous = slot
    if contiguous:
        runs.append(contiguous)
    return max(runs, key=len, default=[])


def pack(canonical_root: Path, output_root: Path, key: str, spec: dict, manifest: dict) -> None:
    entries = body_entries(manifest, spec["ssc"])
    if not entries:
        raise RuntimeError(f"no body frames for {spec['ssc']}")

    min_x = min(int(entry["origin_x"]) for entry in entries)
    min_y = min(int(entry["origin_y"]) for entry in entries)
    max_x = max(int(entry["origin_x"]) + int(entry["width"]) for entry in entries)
    max_y = max(int(entry["origin_y"]) + int(entry["height"]) for entry in entries)
    padding = 4
    frame_width = max_x - min_x + padding * 2
    frame_height = max_y - min_y + padding * 2
    anchor_x = -min_x + padding
    anchor_y = -min_y + padding
    columns = 16
    rows = (len(entries) + columns - 1) // columns
    sheet = Image.new("RGBA", (columns * frame_width, rows * frame_height), (0, 0, 0, 0))

    slots = []
    for index, entry in enumerate(entries):
        image = Image.open(canonical_root / entry["png"]).convert("RGBA")
        left = (index % columns) * frame_width + anchor_x + int(entry["origin_x"])
        top = (index // columns) * frame_height + anchor_y + int(entry["origin_y"])
        sheet.alpha_composite(image, (left, top))
        slots.append(int(entry["slot"]))

    output_root.mkdir(parents=True, exist_ok=True)
    png_path = output_root / f"{key}.png"
    json_path = output_root / f"{key}.json"
    sheet.save(png_path, optimize=True)
    source_ssc = Path(manifest["source_root"]) / spec["ssc"]
    source_spl = source_ssc.with_suffix(".spl")
    metadata = {
        "schema": "ps-runtime-fx/v1",
        "key": key,
        "frames": len(entries),
        "slots": slots,
        "columns": columns,
        "rows": rows,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "anchor": {"x": anchor_x, "y": anchor_y},
        "framesPerTick": spec["frames_per_tick"],
        # PanzerStrike.sdt declares 30 core updates/second.  The animation
        # configs use frames_per_tick=1000 (1.000 frame per engine tick), so
        # preserve the original cadence as one source slot per 30 Hz update.
        "runtimeFps": 30,
        "repeat": spec["repeat"],
        "source": {
            "product": "Panzer Strike Demo",
            "ssc": str(source_ssc),
            "spl": str(source_spl),
            "config": str(Path(manifest["source_root"]).parent / spec["config"]),
            "sscSha256": sha256(source_ssc),
            "splSha256": sha256(source_spl),
            "canonicalManifest": "scratch/ps_sprites_canonical_v1/canonical_manifest.json",
            "canonicalRule": "native RGBA, SSC origin preserved; body slots only; no scaling or repainting",
        },
    }
    json_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{key}: {len(entries)} frames, {frame_width}x{frame_height}, {png_path}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-root", type=Path, default=Path("scratch/ps_sprites_canonical_v1"))
    parser.add_argument("--output-root", type=Path, default=Path("asset/ps_fx"))
    args = parser.parse_args()
    manifest_path = args.canonical_root / "canonical_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for key, spec in SPECS.items():
        pack(args.canonical_root, args.output_root, key, spec, manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
