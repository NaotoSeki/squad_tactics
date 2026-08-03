#!/usr/bin/env python3
"""Render the runtime tree sway settings as an animated GIF preview."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image


def affine_about_anchor(
    image: Image.Image,
    angle_degrees: float,
    scale_x: float,
    anchor: tuple[float, float],
) -> Image.Image:
    angle = math.radians(angle_degrees)
    cosine = math.cos(angle)
    sine = math.sin(angle)
    anchor_x, anchor_y = anchor

    # Inverse of: output = anchor + rotate * scale * (input - anchor)
    inverse_a = cosine / scale_x
    inverse_b = sine / scale_x
    inverse_d = -sine
    inverse_e = cosine
    inverse_c = anchor_x - inverse_a * anchor_x - inverse_b * anchor_y
    inverse_f = anchor_y - inverse_d * anchor_x - inverse_e * anchor_y

    return image.transform(
        image.size,
        Image.Transform.AFFINE,
        (inverse_a, inverse_b, inverse_c, inverse_d, inverse_e, inverse_f),
        resample=Image.Resampling.BICUBIC,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("asset/environment/trees_hd/manifest.json"),
    )
    parser.add_argument(
        "--asset",
        type=Path,
        default=Path("asset/environment/trees_hd/quercus-cerris_a_02_hd_v2.png"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("output/tree_sway/quercus-cerris_a_02_sway.gif"),
    )
    parser.add_argument("--fps", type=int, default=12)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    tree = manifest["overrides"][0]
    sway = tree["sway"]
    angle = float(sway["angleDeg"])
    scale_x_amount = float(sway["scaleX"])
    half_cycle_seconds = float(sway["durationMs"]) / 1000
    frame_count = max(4, round(args.fps * half_cycle_seconds * 2))
    anchor = (
        float(tree["ox"]) * int(tree["tw"]),
        float(tree["oy"]) * int(tree["th"]),
    )

    source = Image.open(args.asset).convert("RGBA")
    background_color = (50, 58, 37, 255)
    frames: list[Image.Image] = []

    for frame_index in range(frame_count):
        phase = (frame_index / frame_count) * math.tau
        wave = math.sin(phase)
        transformed = affine_about_anchor(
            source,
            angle_degrees=angle * wave,
            scale_x=1 + scale_x_amount * wave,
            anchor=anchor,
        )
        frame = Image.new("RGBA", source.size, background_color)
        frame.alpha_composite(transformed)
        frames.append(frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=255))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        args.output,
        save_all=True,
        append_images=frames[1:],
        duration=round(1000 / args.fps),
        loop=0,
        disposal=2,
        optimize=False,
    )
    print(
        f"wrote {args.output} ({frame_count} frames, "
        f"{angle:.2f} degrees, {half_cycle_seconds * 2:.1f}s cycle)"
    )


if __name__ == "__main__":
    main()
