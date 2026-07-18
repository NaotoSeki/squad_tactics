"""Recompose one multi-hex bake exactly as the board compositor will see it.

The preview is deliberately deterministic. It is a visual acceptance gate:
camera-offset bakes that duplicate the complete source in every occupied cell
are immediately visible when the pieces are placed back on the axial grid.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Mapping, Sequence

from PIL import Image


def _number_pair(value: object, label: str) -> tuple[float, float]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ValueError("%s must contain two numbers" % label)
    values = tuple(value)
    if len(values) != 2:
        raise ValueError("%s must contain two numbers" % label)
    result = (float(values[0]), float(values[1]))
    if not all(math.isfinite(number) for number in result):
        raise ValueError("%s must contain finite numbers" % label)
    return result


def piece_center_px(
    q: int,
    r: int,
    *,
    hex_radius_m: float,
    px_per_m: float,
) -> tuple[float, float]:
    """Return a pointy-top axial cell center in compositor pixels."""

    if isinstance(q, bool) or not isinstance(q, int):
        raise TypeError("q must be an integer")
    if isinstance(r, bool) or not isinstance(r, int):
        raise TypeError("r must be an integer")
    radius = float(hex_radius_m)
    density = float(px_per_m)
    if not math.isfinite(radius) or radius <= 0.0:
        raise ValueError("hex_radius_m must be positive and finite")
    if not math.isfinite(density) or density <= 0.0:
        raise ValueError("px_per_m must be positive and finite")
    return (
        math.sqrt(3.0) * radius * density * (q + r * 0.5),
        1.5 * radius * density * r,
    )


def preview_layout(
    manifest: Mapping[str, object],
    *,
    margin_px: int = 24,
) -> tuple[tuple[int, int], list[dict]]:
    """Validate a manifest and return canvas size plus piece destinations."""

    if manifest.get("kind") != "multihex":
        raise ValueError("manifest kind must be multihex")
    projection = manifest.get("projection")
    pieces = manifest.get("pieces")
    if not isinstance(projection, Mapping):
        raise ValueError("manifest projection must be an object")
    if not isinstance(pieces, list) or not pieces:
        raise ValueError("manifest pieces must be a non-empty list")
    if isinstance(margin_px, bool) or not isinstance(margin_px, int) or margin_px < 0:
        raise ValueError("margin_px must be a non-negative integer")

    width_f, height_f = _number_pair(projection.get("resolution_px"), "resolution_px")
    anchor_x, anchor_y = _number_pair(projection.get("anchor_px"), "anchor_px")
    width, height = int(width_f), int(height_f)
    if width_f != width or height_f != height or width <= 0 or height <= 0:
        raise ValueError("resolution_px must contain positive integers")
    radius = float(projection.get("hex_radius_m", 0.0))
    density = float(projection.get("px_per_m", 0.0))

    placed = []
    claimed_cells = set()
    for index, piece in enumerate(pieces):
        if not isinstance(piece, Mapping):
            raise ValueError("pieces[%d] must be an object" % index)
        offset = piece.get("offset", piece.get("cell"))
        if not isinstance(offset, Mapping):
            raise ValueError("pieces[%d] needs an offset" % index)
        q, r = offset.get("q"), offset.get("r")
        if isinstance(q, bool) or not isinstance(q, int):
            raise ValueError("pieces[%d].offset.q must be an integer" % index)
        if isinstance(r, bool) or not isinstance(r, int):
            raise ValueError("pieces[%d].offset.r must be an integer" % index)
        if (q, r) in claimed_cells:
            raise ValueError("duplicate piece cell q=%d r=%d" % (q, r))
        claimed_cells.add((q, r))
        filename = piece.get("file")
        if not isinstance(filename, str) or not filename.lower().endswith(".png"):
            raise ValueError("pieces[%d].file must name a PNG" % index)
        center_x, center_y = piece_center_px(
            q,
            r,
            hex_radius_m=radius,
            px_per_m=density,
        )
        placed.append({
            "file": filename,
            "q": q,
            "r": r,
            "center_x": center_x,
            "center_y": center_y,
        })

    min_x = min(item["center_x"] - anchor_x for item in placed)
    max_x = max(item["center_x"] + width - anchor_x for item in placed)
    min_y = min(item["center_y"] - anchor_y for item in placed)
    max_y = max(item["center_y"] + height - anchor_y for item in placed)
    for item in placed:
        item["dest"] = (
            int(round(item["center_x"] - anchor_x - min_x + margin_px)),
            int(round(item["center_y"] - anchor_y - min_y + margin_px)),
        )

    canvas_size = (
        int(math.ceil(max_x - min_x + margin_px * 2)),
        int(math.ceil(max_y - min_y + margin_px * 2)),
    )
    # The camera has no X azimuth. Increasing compositor Y is the stable
    # back-to-front order already used by the board renderer.
    placed.sort(key=lambda item: (item["center_y"], item["center_x"], item["file"]))
    return canvas_size, placed


def compose_preview(
    manifest_path: str | Path,
    out_path: str | Path,
    *,
    background: tuple[int, int, int, int] = (28, 30, 27, 255),
    margin_px: int = 24,
) -> Path:
    manifest_path = Path(manifest_path)
    out_path = Path(out_path)
    with manifest_path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    canvas_size, pieces = preview_layout(manifest, margin_px=margin_px)
    projection = manifest["projection"]
    expected_size = tuple(int(value) for value in projection["resolution_px"])
    canvas = Image.new("RGBA", canvas_size, background)
    for piece in pieces:
        image_path = manifest_path.parent / piece["file"]
        with Image.open(image_path) as source:
            image = source.convert("RGBA")
        if image.size != expected_size:
            raise ValueError(
                "%s is %s, expected %s" %
                (image_path.name, image.size, expected_size)
            )
        canvas.alpha_composite(image, dest=piece["dest"])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)
    return out_path


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--margin", type=int, default=24)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    output = compose_preview(args.manifest, args.out, margin_px=args.margin)
    print("MULTIBAKE PREVIEW OK %s" % output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
