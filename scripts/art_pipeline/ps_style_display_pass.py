#!/usr/bin/env python3
"""Create a shared-palette, low-resolution tactical display pass.

This is deliberately a display/bake experiment, not an attempt to infer or
replace the original Panzer Strike asset palettes. A before/after pair shares
one generated palette so battle damage does not introduce a color-grade jump.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageEnhance


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--internal-width", type=int, default=864)
    parser.add_argument("--internal-height", type=int, default=576)
    parser.add_argument("--display-width", type=int, default=960)
    parser.add_argument("--display-height", type=int, default=640)
    parser.add_argument("--colors", type=int, default=224)
    return parser.parse_args()


def prepare_source(path: Path, size: tuple[int, int]) -> Image.Image:
    image = Image.open(path).convert("RGB")
    if image.width * size[1] != image.height * size[0]:
        raise ValueError(f"{path} is not {size[0]}:{size[1]} aspect-compatible")
    image = image.resize(size, Image.Resampling.LANCZOS)
    image = ImageEnhance.Color(image).enhance(0.92)
    image = ImageEnhance.Contrast(image).enhance(1.04)
    return ImageEnhance.Brightness(image).enhance(0.985)


def unique_color_count(image: Image.Image) -> int:
    colors = image.convert("RGB").getcolors(maxcolors=image.width * image.height)
    return len(colors) if colors is not None else image.width * image.height


def main() -> None:
    args = parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    internal_size = (args.internal_width, args.internal_height)
    display_size = (args.display_width, args.display_height)
    prepared = {
        "before": prepare_source(args.before, internal_size),
        "after": prepare_source(args.after, internal_size),
    }

    palette_source = Image.new(
        "RGB", (args.internal_width * 2, args.internal_height)
    )
    palette_source.paste(prepared["before"], (0, 0))
    palette_source.paste(prepared["after"], (args.internal_width, 0))
    shared_palette = palette_source.quantize(
        colors=args.colors,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    )

    metrics: dict[str, object] = {
        "schema": "squad-tactics-ps-style-display-pass-v1",
        "internal_size": list(internal_size),
        "display_size": list(display_size),
        "shared_palette_colors": args.colors,
        "source_bake": {
            "downsample": "LANCZOS",
            "saturation": 0.92,
            "contrast": 1.04,
            "brightness": 0.985,
            "dither": "none",
        },
        "final_pass": {
            "ps_candidate": "BILINEAR 10/9",
            "diagnostic": "NEAREST 10/9",
        },
        "outputs": {},
    }

    for state, image in prepared.items():
        native = image.quantize(
            palette=shared_palette,
            dither=Image.Dither.NONE,
        ).convert("RGB")
        native_path = args.out_dir / f"farm_{state}_native.png"
        ps_path = args.out_dir / f"farm_{state}_ps.png"
        nearest_path = args.out_dir / f"farm_{state}_nearest.png"

        native.save(native_path, optimize=True)
        native.resize(display_size, Image.Resampling.BILINEAR).save(
            ps_path, optimize=True
        )
        native.resize(display_size, Image.Resampling.NEAREST).save(
            nearest_path, optimize=True
        )

        metrics["outputs"][state] = {
            "native": native_path.name,
            "ps": ps_path.name,
            "nearest": nearest_path.name,
            "native_unique_colors": unique_color_count(native),
        }

    metrics_path = args.out_dir / "display_pass_metrics.json"
    metrics_path.write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(metrics_path)


if __name__ == "__main__":
    main()
