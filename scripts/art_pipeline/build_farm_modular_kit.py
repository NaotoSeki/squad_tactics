#!/usr/bin/env python3
"""Normalize generated farm cutouts into a deterministic modular art kit."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ASSET_GROUPS = {
    "buildings": {
        "colors": 96,
        "members": {
            "farmhouse_intact": "farmhouse_intact_cutout.png",
            "farmhouse_damaged": "farmhouse_damaged_cutout.png",
            "barn_intact": "barn_intact_cutout.png",
            "barn_damaged": "barn_damaged_cutout.png",
        },
        "targets": {
            "farmhouse_intact": ((288, 224), (260, 194)),
            "farmhouse_damaged": ((288, 224), (260, 194)),
            "barn_intact": ((248, 200), (224, 174)),
            "barn_damaged": ((248, 200), (224, 174)),
        },
    },
    "trees": {
        "colors": 64,
        "members": {
            "tree_apple_a": "tree_apple_a_cutout.png",
            "tree_pear_b": "tree_pear_b_cutout.png",
        },
        "targets": {
            "tree_apple_a": ((128, 184), (114, 166)),
            "tree_pear_b": ((128, 184), (114, 166)),
        },
    },
    "residue": {
        "colors": 64,
        "members": {
            "crater_heavy": "crater_heavy_cutout.png",
            "wreck_scout": "wreck_scout_cutout.png",
        },
        "targets": {
            "crater_heavy": ((128, 96), (114, 72)),
            "wreck_scout": ((136, 104), (122, 82)),
        },
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    return parser.parse_args()


def alpha_bbox(image: Image.Image, threshold: int = 8) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    mask = alpha.point(lambda value: 255 if value > threshold else 0)
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError("image has no visible alpha coverage")
    return bbox


def crop_alpha(image: Image.Image, padding: int = 3) -> Image.Image:
    left, top, right, bottom = alpha_bbox(image)
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(image.width, right + padding)
    bottom = min(image.height, bottom + padding)
    return image.crop((left, top, right, bottom))


def palette_from_images(images: list[Image.Image], colors: int) -> Image.Image:
    samples: list[tuple[int, int, int]] = []
    for image in images:
        preview = image.copy()
        preview.thumbnail((512, 512), Image.Resampling.LANCZOS)
        for red, green, blue, alpha in preview.get_flattened_data():
            if alpha >= 32:
                samples.append((red, green, blue))

    if not samples:
        raise ValueError("no opaque pixels available for palette")

    sample_count = 512 * 512
    stride = max(1, len(samples) // sample_count)
    selected = samples[::stride][:sample_count]
    if len(selected) < sample_count:
        repeats = math.ceil(sample_count / len(selected))
        selected = (selected * repeats)[:sample_count]

    palette_source = Image.new("RGB", (512, 512))
    palette_source.putdata(selected)
    return palette_source.quantize(
        colors=colors,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    )


def quantize_rgba(image: Image.Image, palette: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    indexed = image.convert("RGB").quantize(
        palette=palette,
        dither=Image.Dither.NONE,
    )
    rgba = indexed.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba


def place_on_canvas(
    cropped: Image.Image,
    canvas_size: tuple[int, int],
    max_visible: tuple[int, int],
    scale_override: float | None = None,
) -> tuple[Image.Image, float]:
    canvas_width, canvas_height = canvas_size
    max_width, max_height = max_visible
    scale = scale_override or min(
        max_width / cropped.width,
        max_height / cropped.height,
    )
    width = max(1, round(cropped.width * scale))
    height = max(1, round(cropped.height * scale))
    resized = cropped.resize((width, height), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    x = round((canvas_width - width) / 2)
    y = canvas_height - height - 4
    canvas.alpha_composite(resized, (x, y))
    return canvas, scale


def alpha_metrics(image: Image.Image) -> dict[str, object]:
    alpha = image.getchannel("A")
    values = list(alpha.get_flattened_data())
    visible = sum(value > 8 for value in values)
    partial = sum(8 < value < 247 for value in values)
    corners = [
        alpha.getpixel((0, 0)),
        alpha.getpixel((image.width - 1, 0)),
        alpha.getpixel((0, image.height - 1)),
        alpha.getpixel((image.width - 1, image.height - 1)),
    ]

    magenta_like = 0
    for red, green, blue, value in image.get_flattened_data():
        if value > 32 and red > 180 and blue > 170 and green < 110:
            magenta_like += 1

    bbox = alpha_bbox(image)
    return {
        "visible_pixels": visible,
        "partial_alpha_pixels": partial,
        "coverage": round(visible / (image.width * image.height), 6),
        "transparent_corners": all(value == 0 for value in corners),
        "alpha_bbox": list(bbox),
        "magenta_like_visible_pixels": magenta_like,
    }


def build_assets(source_dir: Path, out_dir: Path) -> dict[str, object]:
    assets_dir = out_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {
        "schema": "squad-tactics-generated-farm-kit-v1",
        "render_contract": {
            "camera": "orthographic oblique approximately 35 degrees",
            "light": "upper-left",
            "origin": "bottom-center",
            "palette": "shared within material family; no dithering",
            "runtime_shadow": "derived from body alpha; not baked into asset",
        },
        "assets": {},
        "damage_chains": {
            "farmhouse": ["farmhouse_intact", "farmhouse_damaged"],
            "barn": ["barn_intact", "barn_damaged"],
        },
    }

    for group_name, group in ASSET_GROUPS.items():
        cropped: dict[str, Image.Image] = {}
        for asset_id, filename in group["members"].items():
            source = Image.open(source_dir / filename).convert("RGBA")
            cropped[asset_id] = crop_alpha(source)

        normalized: dict[str, Image.Image] = {}
        # Preserve scale inside each damage pair by using the largest source
        # extent and the smaller of each pair's target scales.
        pairs = [
            ["farmhouse_intact", "farmhouse_damaged"],
            ["barn_intact", "barn_damaged"],
        ]
        handled: set[str] = set()
        for pair in pairs:
            active = [asset_id for asset_id in pair if asset_id in cropped]
            if not active:
                continue
            scales = []
            for asset_id in active:
                _, max_visible = group["targets"][asset_id]
                scales.append(
                    min(
                        max_visible[0] / cropped[asset_id].width,
                        max_visible[1] / cropped[asset_id].height,
                    )
                )
            shared_scale = min(scales)
            for asset_id in active:
                canvas_size, max_visible = group["targets"][asset_id]
                normalized[asset_id], _ = place_on_canvas(
                    cropped[asset_id],
                    canvas_size,
                    max_visible,
                    shared_scale,
                )
                handled.add(asset_id)

        for asset_id, image in cropped.items():
            if asset_id in handled:
                continue
            canvas_size, max_visible = group["targets"][asset_id]
            normalized[asset_id], _ = place_on_canvas(
                image,
                canvas_size,
                max_visible,
            )

        if group_name == "trees":
            for asset_id, image in list(normalized.items()):
                alpha = image.getchannel("A")
                softened = ImageEnhance.Color(image.convert("RGB")).enhance(0.86)
                normalized[asset_id] = softened.convert("RGBA")
                normalized[asset_id].putalpha(alpha)

        palette = palette_from_images(list(normalized.values()), group["colors"])
        for asset_id, image in normalized.items():
            output = quantize_rgba(image, palette)
            output_path = assets_dir / f"{asset_id}.png"
            output.save(output_path, optimize=True)
            origin = [0.5, 0.98]
            layer = "tall"
            if asset_id == "crater_heavy":
                origin = [0.5, 0.64]
                layer = "low"
            elif asset_id == "wreck_scout":
                origin = [0.5, 0.96]
                layer = "remains"
            manifest["assets"][asset_id] = {
                "file": f"assets/{output_path.name}",
                "canvas": [output.width, output.height],
                "origin": origin,
                "layer": layer,
                "palette_colors": group["colors"],
                "metrics": alpha_metrics(output),
            }

    return manifest


def build_ground(source_dir: Path, out_dir: Path) -> dict[str, object]:
    source = Image.open(source_dir / "ground_meadow_raw.png").convert("RGB")
    target_ratio = 3 / 2
    if source.width / source.height > target_ratio:
        crop_width = round(source.height * target_ratio)
        left = (source.width - crop_width) // 2
        source = source.crop((left, 0, left + crop_width, source.height))
    else:
        crop_height = round(source.width / target_ratio)
        top = (source.height - crop_height) // 2
        source = source.crop((0, top, source.width, top + crop_height))

    # Suppress the generated source's high-frequency grit before the common
    # palette pass. This keeps the battlefield readable after the 10/9 final
    # display interpolation without turning the ground into a flat wash.
    ground = source.resize((288, 192), Image.Resampling.BILINEAR)
    ground = ground.resize((864, 576), Image.Resampling.BICUBIC)
    ground = ground.filter(ImageFilter.GaussianBlur(0.35))
    red, green, blue = ground.split()
    ground = Image.merge(
        "RGB",
        (
            red.point(lambda value: min(255, round(value * 0.86))),
            green.point(lambda value: min(255, round(value * 0.88))),
            blue.point(lambda value: min(255, round(value * 0.94))),
        ),
    )
    ground = ImageEnhance.Contrast(ground).enhance(0.92)
    ground = ground.quantize(
        colors=160,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    ).convert("RGB")
    path = out_dir / "ground_meadow_native.png"
    ground.save(path, optimize=True)
    return {
        "file": path.name,
        "size": [ground.width, ground.height],
        "palette_colors": 160,
    }


def checkerboard(
    size: tuple[int, int],
    light: tuple[int, int, int] = (150, 143, 114),
    dark: tuple[int, int, int] = (126, 121, 98),
) -> Image.Image:
    image = Image.new("RGB", size, light)
    draw = ImageDraw.Draw(image)
    step = 16
    for y in range(0, size[1], step):
        for x in range(0, size[0], step):
            if (x // step + y // step) % 2:
                draw.rectangle((x, y, x + step - 1, y + step - 1), fill=dark)
    return image


def build_contact_sheet(out_dir: Path, manifest: dict[str, object]) -> Path:
    asset_ids = list(manifest["assets"])
    cell_width, cell_height = 330, 270
    columns = 2
    rows = math.ceil(len(asset_ids) / columns)
    sheet = checkerboard((cell_width * columns, cell_height * rows))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for index, asset_id in enumerate(asset_ids):
        column = index % columns
        row = index // columns
        x0 = column * cell_width
        y0 = row * cell_height
        asset_path = out_dir / manifest["assets"][asset_id]["file"]
        asset = Image.open(asset_path).convert("RGBA")
        x = x0 + (cell_width - asset.width) // 2
        y = y0 + 30 + (cell_height - 40 - asset.height) // 2
        sheet.paste(asset, (x, y), asset)
        draw.rectangle(
            (x0, y0, x0 + cell_width - 1, y0 + cell_height - 1),
            outline=(55, 55, 44),
            width=2,
        )
        draw.text((x0 + 10, y0 + 9), asset_id, fill=(24, 25, 20), font=font)

    path = out_dir / "farm_modular_contact_sheet.png"
    sheet.save(path, optimize=True)
    return path


def main() -> None:
    args = parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest = build_assets(args.source_dir, args.out_dir)
    manifest["ground"] = build_ground(args.source_dir, args.out_dir)
    contact_sheet = build_contact_sheet(args.out_dir, manifest)
    manifest["contact_sheet"] = contact_sheet.name

    manifest_path = args.out_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    js_path = args.out_dir / "manifest.js"
    js_path.write_text(
        "window.FARM_MODULAR_KIT = "
        + json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(manifest_path)


if __name__ == "__main__":
    main()
