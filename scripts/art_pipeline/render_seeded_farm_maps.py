#!/usr/bin/env python3
"""Render deterministic modular farm maps and their battle-history states."""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


INTERNAL_SIZE = (864, 576)
DISPLAY_SIZE = (960, 640)
PILOT_SEEDS = (104729, 271828, 314159)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kit-dir", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    return parser.parse_args()


def jitter(rng: random.Random, amount: int) -> int:
    return rng.randint(-amount, amount)


def field_polygon(
    left: int,
    top: int,
    right: int,
    bottom: int,
    rng: random.Random,
    amount: int = 12,
) -> list[tuple[int, int]]:
    return [
        (left + jitter(rng, amount), top + jitter(rng, amount)),
        (right + jitter(rng, amount), top + jitter(rng, amount)),
        (right + jitter(rng, amount), bottom + jitter(rng, amount)),
        (left + jitter(rng, amount), bottom + jitter(rng, amount)),
    ]


def catmull_rom(
    points: list[tuple[float, float]],
    samples_per_segment: int = 18,
) -> list[tuple[int, int]]:
    if len(points) < 2:
        return [(round(x), round(y)) for x, y in points]
    padded = [points[0], *points, points[-1]]
    result: list[tuple[int, int]] = []
    for index in range(1, len(padded) - 2):
        p0, p1, p2, p3 = padded[index - 1 : index + 3]
        for sample in range(samples_per_segment):
            t = sample / samples_per_segment
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * (
                (2 * p1[0])
                + (-p0[0] + p2[0]) * t
                + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            )
            y = 0.5 * (
                (2 * p1[1])
                + (-p0[1] + p2[1]) * t
                + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            )
            result.append((round(x), round(y)))
    result.append((round(points[-1][0]), round(points[-1][1])))
    return result


def create_layout(seed: int) -> dict[str, object]:
    rng = random.Random(seed)
    farmhouse = (600 + jitter(rng, 35), 270 + jitter(rng, 22))
    barn = (720 + jitter(rng, 34), 410 + jitter(rng, 25))
    junction = (415 + jitter(rng, 28), 350 + jitter(rng, 24))
    entry = (-20, 505 + jitter(rng, 28))
    exit_point = (884, 145 + jitter(rng, 35))
    road_control = [
        entry,
        (185 + jitter(rng, 24), 455 + jitter(rng, 20)),
        junction,
        (farmhouse[0] - 70, farmhouse[1] + 30),
        exit_point,
    ]
    branch_control = [
        junction,
        (560 + jitter(rng, 20), 440 + jitter(rng, 15)),
        (barn[0] - 20, barn[1] + 15),
        (884, 490 + jitter(rng, 24)),
    ]

    fields = [
        {
            "kind": "wheat",
            "polygon": field_polygon(28, 42, 350, 235, rng),
            "row_angle": -8 + jitter(rng, 4),
        },
        {
            "kind": "plowed",
            "polygon": field_polygon(25, 405, 330, 570, rng),
            "row_angle": 12 + jitter(rng, 5),
        },
        {
            "kind": "fallow",
            "polygon": field_polygon(515, 455, 840, 570, rng),
            "row_angle": -4 + jitter(rng, 5),
        },
    ]

    orchard: list[dict[str, object]] = []
    center_x = 500 + jitter(rng, 18)
    center_y = 395 + jitter(rng, 15)
    for index, (offset_x, offset_y) in enumerate(
        [(-82, -34), (0, -46), (82, -29), (-43, 42), (48, 47)]
    ):
        orchard.append(
            {
                "id": f"orchard_{index}",
                "asset": "tree_apple_a" if index in (0, 3) else "tree_pear_b",
                "x": center_x + offset_x + jitter(rng, 7),
                "y": center_y + offset_y + jitter(rng, 6),
                "scale": round(rng.uniform(0.60, 0.74), 4),
            }
        )

    instances = [
        {
            "id": "farmhouse",
            "asset": "farmhouse_intact",
            "x": farmhouse[0],
            "y": farmhouse[1],
            "scale": 0.72,
        },
        {
            "id": "barn",
            "asset": "barn_intact",
            "x": barn[0],
            "y": barn[1],
            "scale": 0.72,
        },
        *orchard,
    ]

    track_points = catmull_rom(
        [
            entry,
            (junction[0] - 95, junction[1] + 45),
            junction,
            (farmhouse[0] - 54, farmhouse[1] + 25),
        ]
    )
    events = [
        {
            "kind": "track_path",
            "points": track_points,
            "memory": "fading",
        },
        {
            "kind": "impact",
            "class": "heavy",
            "x": 430 + jitter(rng, 35),
            "y": 493 + jitter(rng, 18),
            "radius": 20,
            "memory": "battle_persistent",
        },
        {
            "kind": "impact",
            "class": "medium",
            "x": junction[0] - 38,
            "y": junction[1] + 12,
            "radius": 12,
            "memory": "battle_persistent",
        },
        {
            "kind": "state_replace",
            "target": "farmhouse",
            "to": "farmhouse_damaged",
            "memory": "state_replacement",
        },
        {
            "kind": "state_replace",
            "target": "barn",
            "to": "barn_damaged",
            "memory": "state_replacement",
        },
        {
            "kind": "state_replace",
            "target": "orchard_2",
            "to": "fallen_tree",
            "memory": "state_replacement",
        },
        {
            "kind": "wreck",
            "x": farmhouse[0] - 72,
            "y": farmhouse[1] + 31,
            "memory": "state_replacement",
        },
        {
            "kind": "casualty_cluster",
            "x": junction[0] + 8,
            "y": junction[1] + 23,
            "count": 3,
            "memory": "battle_persistent",
        },
    ]

    return {
        "seed": seed,
        "fields": fields,
        "roads": {
            "main": catmull_rom(road_control),
            "branch": catmull_rom(branch_control),
        },
        "instances": instances,
        "events": events,
        "junction": list(junction),
    }


def render_field(
    image: Image.Image,
    polygon: list[tuple[int, int]],
    kind: str,
    row_angle: int,
    rng: random.Random,
) -> None:
    colors = {
        "wheat": ((157, 132, 70, 150), (198, 169, 91, 115)),
        "plowed": ((92, 70, 48, 180), (129, 94, 59, 140)),
        "fallow": ((112, 88, 55, 145), (151, 119, 69, 110)),
    }
    base, line = colors[kind]
    mask = Image.new("L", INTERNAL_SIZE, 0)
    ImageDraw.Draw(mask).polygon(polygon, fill=255)

    layer = Image.new("RGBA", INTERNAL_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rectangle((0, 0, *INTERNAL_SIZE), fill=base)
    spacing = 9 if kind != "wheat" else 7
    tangent = math.tan(math.radians(row_angle))
    for y in range(-INTERNAL_SIZE[0], INTERNAL_SIZE[1] * 2, spacing):
        draw.line(
            [(0, y), (INTERNAL_SIZE[0], y + tangent * INTERNAL_SIZE[0])],
            fill=line,
            width=2 if kind == "plowed" else 1,
        )
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    image.alpha_composite(layer)

    detail = Image.new("RGBA", INTERNAL_SIZE, (0, 0, 0, 0))
    detail_draw = ImageDraw.Draw(detail)
    attempts = 2800 if kind == "wheat" else 900
    for _ in range(attempts):
        x = rng.randrange(INTERNAL_SIZE[0])
        y = rng.randrange(INTERNAL_SIZE[1])
        if mask.getpixel((x, y)) == 0:
            continue
        if kind == "wheat":
            detail_draw.line(
                (x, y + 1, x + rng.choice((-1, 0, 1)), y - 1),
                fill=(218, 186, 105, rng.randint(70, 125)),
                width=1,
            )
        else:
            shade = (56, 47, 36, rng.randint(45, 85))
            detail_draw.point((x, y), fill=shade)
    image.alpha_composite(detail)

    border = ImageDraw.Draw(image)
    border.line([*polygon, polygon[0]], fill=(69, 64, 43, 185), width=3)


def render_road(
    image: Image.Image,
    points: list[tuple[int, int]],
    rng: random.Random,
) -> None:
    draw = ImageDraw.Draw(image, "RGBA")
    draw.line(points, fill=(59, 55, 42, 145), width=34, joint="curve")
    draw.line(points, fill=(118, 101, 70, 205), width=27, joint="curve")
    for _ in range(max(220, len(points) * 4)):
        index = rng.randrange(1, len(points) - 1)
        previous = points[index - 1]
        current = points[index]
        following = points[index + 1]
        dx = following[0] - previous[0]
        dy = following[1] - previous[1]
        length = max(1.0, math.hypot(dx, dy))
        tx, ty = dx / length, dy / length
        nx, ny = -ty, tx
        lateral = rng.uniform(-11.5, 11.5)
        longitudinal = rng.uniform(-4.0, 4.0)
        x = current[0] + nx * lateral + tx * longitudinal
        y = current[1] + ny * lateral + ty * longitudinal
        if rng.random() < 0.58:
            color = (61, 55, 42, rng.randint(28, 52))
        else:
            color = (174, 148, 95, rng.randint(22, 44))
        point = (round(x), round(y))
        if rng.random() < 0.18:
            draw.line((point[0] - 1, point[1], point[0] + 1, point[1]), fill=color)
        else:
            draw.point(point, fill=color)


def draw_fence(
    image: Image.Image,
    start: tuple[int, int],
    end: tuple[int, int],
    breaks: list[tuple[int, int]],
) -> None:
    draw = ImageDraw.Draw(image, "RGBA")
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = max(1.0, math.hypot(dx, dy))
    segments = max(1, round(length / 24))
    points = [
        (
            round(start[0] + dx * index / segments),
            round(start[1] + dy * index / segments),
        )
        for index in range(segments + 1)
    ]
    for first, second in zip(points, points[1:]):
        midpoint = ((first[0] + second[0]) // 2, (first[1] + second[1]) // 2)
        if any(math.dist(midpoint, broken) < 25 for broken in breaks):
            continue
        draw.line([first, second], fill=(71, 54, 37, 205), width=2)
        draw.line(
            [(first[0], first[1] - 3), (first[0], first[1] + 3)],
            fill=(49, 39, 29, 220),
            width=2,
        )


def load_kit(kit_dir: Path) -> tuple[dict[str, object], dict[str, Image.Image]]:
    manifest = json.loads((kit_dir / "manifest.json").read_text(encoding="utf-8"))
    images: dict[str, Image.Image] = {}
    for asset_id, entry in manifest["assets"].items():
        images[asset_id] = Image.open(kit_dir / entry["file"]).convert("RGBA")
    images["ground"] = Image.open(
        kit_dir / manifest["ground"]["file"]
    ).convert("RGBA")
    return manifest, images


def scaled_asset(image: Image.Image, scale: float) -> Image.Image:
    return image.resize(
        (
            max(1, round(image.width * scale)),
            max(1, round(image.height * scale)),
        ),
        Image.Resampling.LANCZOS,
    )


def paste_shadow(
    image: Image.Image,
    asset: Image.Image,
    x: int,
    y: int,
    scale: float,
    kind: str,
) -> None:
    scaled = scaled_asset(asset, scale)
    alpha = scaled.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return
    body_width = bbox[2] - bbox[0]
    body_height = bbox[3] - bbox[1]
    if kind == "tree":
        width = max(12, round(body_width * 0.85))
        height = max(5, round(body_height * 0.16))
        offset_x, offset_y, opacity = 20, -4, 32
    elif kind == "wreck":
        width = max(14, round(body_width * 0.70))
        height = max(5, round(body_height * 0.14))
        offset_x, offset_y, opacity = 14, -4, 38
    else:
        width = max(20, round(body_width * 0.82))
        height = max(8, round(body_height * 0.22))
        offset_x, offset_y, opacity = 24, -7, 42

    patch = Image.new("RGBA", (width + 20, height + 20), (0, 0, 0, 0))
    draw = ImageDraw.Draw(patch)
    draw.ellipse(
        (8, 6, width + 8, height + 8),
        fill=(28, 27, 23, opacity),
    )
    patch = patch.rotate(-8, resample=Image.Resampling.BICUBIC, expand=True)
    image.alpha_composite(
        patch,
        (
            round(x - patch.width * 0.35 + offset_x),
            round(y - patch.height * 0.55 + offset_y),
        ),
    )


def paste_asset(
    image: Image.Image,
    asset: Image.Image,
    x: int,
    y: int,
    scale: float,
    origin: tuple[float, float],
) -> None:
    scaled = scaled_asset(asset, scale)
    left = round(x - scaled.width * origin[0])
    top = round(y - scaled.height * origin[1])
    image.alpha_composite(scaled, (left, top))


def draw_tracks(image: Image.Image, points: list[tuple[int, int]]) -> None:
    draw = ImageDraw.Draw(image, "RGBA")
    draw.line(points, fill=(40, 38, 29, 105), width=8, joint="curve")
    draw.line(points, fill=(105, 91, 62, 58), width=3, joint="curve")
    for index in range(6, len(points) - 6, 7):
        previous = points[index - 2]
        current = points[index]
        following = points[index + 2]
        dx = following[0] - previous[0]
        dy = following[1] - previous[1]
        length = max(1.0, math.hypot(dx, dy))
        nx, ny = -dy / length, dx / length
        for side in (-1, 1):
            cx = current[0] + nx * side * 4.2
            cy = current[1] + ny * side * 4.2
            draw.line(
                (
                    round(cx - nx * 2.4),
                    round(cy - ny * 2.4),
                    round(cx + nx * 2.4),
                    round(cy + ny * 2.4),
                ),
                fill=(40, 37, 29, 125),
                width=1,
            )


def draw_fallen_tree(
    image: Image.Image,
    asset: Image.Image,
    x: int,
    y: int,
) -> None:
    bbox = asset.getchannel("A").getbbox()
    if bbox is None:
        return
    cropped = asset.crop(bbox)
    cropped = cropped.resize(
        (
            max(1, round(cropped.width * 0.56)),
            max(1, round(cropped.height * 0.56)),
        ),
        Image.Resampling.LANCZOS,
    )
    fallen = cropped.rotate(
        76,
        resample=Image.Resampling.BICUBIC,
        expand=True,
    )
    shadow = Image.new("RGBA", (fallen.width + 16, 22), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse(
        (7, 7, shadow.width - 7, 15),
        fill=(28, 27, 22, 36),
    )
    image.alpha_composite(shadow, (x - shadow.width // 2 + 8, y - 8))
    image.alpha_composite(
        fallen,
        (x - fallen.width // 2, y - fallen.height // 2),
    )
    draw = ImageDraw.Draw(image, "RGBA")
    draw.ellipse((x - 4, y + 3, x + 4, y + 8), fill=(82, 57, 37, 210))


def draw_casualties(
    image: Image.Image,
    x: int,
    y: int,
    count: int,
    rng: random.Random,
) -> None:
    draw = ImageDraw.Draw(image, "RGBA")
    for _ in range(count):
        px = x + rng.randint(-20, 20)
        py = y + rng.randint(-10, 12)
        draw.ellipse((px - 2, py - 2, px + 2, py + 2), fill=(50, 41, 34, 220))
        draw.line((px + 1, py, px + rng.randint(5, 9), py + rng.randint(-2, 3)), fill=(55, 43, 35, 230), width=3)


def state_replacements(layout: dict[str, object]) -> dict[str, str]:
    replacements: dict[str, str] = {}
    for event in layout["events"]:
        if event["kind"] == "state_replace":
            replacements[event["target"]] = event["to"]
    return replacements


def render_map(
    layout: dict[str, object],
    manifest: dict[str, object],
    images: dict[str, Image.Image],
    battle: bool,
) -> Image.Image:
    seed = int(layout["seed"])
    rng = random.Random(seed ^ (0x5A17 if battle else 0x1937))
    terrain_rng = random.Random(seed ^ 0xC0DE)
    image = images["ground"].copy()

    for field in layout["fields"]:
        render_field(
            image,
            [tuple(point) for point in field["polygon"]],
            field["kind"],
            field["row_angle"],
            terrain_rng,
        )
    render_road(
        image,
        [tuple(point) for point in layout["roads"]["main"]],
        terrain_rng,
    )
    render_road(
        image,
        [tuple(point) for point in layout["roads"]["branch"]],
        terrain_rng,
    )

    broken_points: list[tuple[int, int]] = []
    if battle:
        broken_points = [tuple(layout["junction"])]
    first_field = [tuple(point) for point in layout["fields"][0]["polygon"]]
    draw_fence(image, first_field[0], first_field[1], broken_points)
    draw_fence(image, first_field[1], first_field[2], broken_points)
    draw_fence(image, first_field[2], first_field[3], broken_points)

    replacements = state_replacements(layout) if battle else {}
    removed = {"orchard_2"} if battle else set()

    if battle:
        for event in layout["events"]:
            kind = event["kind"]
            if kind == "track_path":
                draw_tracks(image, [tuple(point) for point in event["points"]])
            elif kind == "impact":
                crater_entry = manifest["assets"]["crater_heavy"]
                crater_scale = 0.86 if event["class"] == "heavy" else 0.56
                paste_asset(
                    image,
                    images["crater_heavy"],
                    int(event["x"]),
                    int(event["y"]),
                    crater_scale,
                    tuple(crater_entry["origin"]),
                )
        fallen = next(
            instance
            for instance in layout["instances"]
            if instance["id"] == "orchard_2"
        )
        draw_fallen_tree(
            image,
            images["tree_pear_b"],
            int(fallen["x"]),
            int(fallen["y"]),
        )

    drawable: list[dict[str, object]] = []
    for instance in layout["instances"]:
        if instance["id"] in removed:
            continue
        drawable.append(
            {
                **instance,
                "asset": replacements.get(instance["id"], instance["asset"]),
            }
        )
    if battle:
        wreck_event = next(
            event for event in layout["events"] if event["kind"] == "wreck"
        )
        drawable.append(
            {
                "id": "wreck_scout",
                "asset": "wreck_scout",
                "x": wreck_event["x"],
                "y": wreck_event["y"],
                "scale": 0.58,
            }
        )

    for instance in drawable:
        asset_id = instance["asset"]
        if asset_id.startswith("tree_"):
            kind = "tree"
        elif asset_id.startswith("wreck_"):
            kind = "wreck"
        else:
            kind = "building"
        paste_shadow(
            image,
            images[asset_id],
            int(instance["x"]),
            int(instance["y"]),
            float(instance["scale"]),
            kind,
        )

    for instance in sorted(drawable, key=lambda item: item["y"]):
        asset_id = instance["asset"]
        entry = manifest["assets"][asset_id]
        paste_asset(
            image,
            images[asset_id],
            int(instance["x"]),
            int(instance["y"]),
            float(instance["scale"]),
            tuple(entry["origin"]),
        )

    if battle:
        for event in layout["events"]:
            if event["kind"] == "casualty_cluster":
                draw_casualties(
                    image,
                    int(event["x"]),
                    int(event["y"]),
                    int(event["count"]),
                    rng,
                )

    return image.convert("RGB")


def diff_metrics(before: Image.Image, after: Image.Image) -> tuple[dict[str, object], Image.Image]:
    difference = ImageChops.difference(before, after)
    grayscale = difference.convert("L")
    mask = grayscale.point(lambda value: 255 if value > 0 else 0)
    changed = sum(value > 0 for value in mask.get_flattened_data())
    total = before.width * before.height
    overlay = before.convert("L").convert("RGB")
    red = Image.new("RGB", before.size, (220, 62, 40))
    overlay.paste(red, mask=mask)
    return (
        {
            "changed_pixels": changed,
            "total_pixels": total,
            "unchanged_ratio": round(1 - changed / total, 6),
            "difference_bbox": list(difference.getbbox() or (0, 0, 0, 0)),
        },
        overlay,
    )


def main() -> None:
    args = parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest, images = load_kit(args.kit_dir)
    index: dict[str, object] = {
        "schema": "squad-tactics-seeded-farm-pilot-v1",
        "internal_size": list(INTERNAL_SIZE),
        "display_size": list(DISPLAY_SIZE),
        "final_pass": "BILINEAR 10/9",
        "seeds": [],
    }

    for seed in PILOT_SEEDS:
        layout = create_layout(seed)
        before_internal = render_map(layout, manifest, images, battle=False)
        after_internal = render_map(layout, manifest, images, battle=True)
        before = before_internal.resize(DISPLAY_SIZE, Image.Resampling.BILINEAR)
        after = after_internal.resize(DISPLAY_SIZE, Image.Resampling.BILINEAR)
        metrics, diff = diff_metrics(before, after)

        prefix = f"farm_seed_{seed}"
        before_path = args.out_dir / f"{prefix}_before.png"
        after_path = args.out_dir / f"{prefix}_after.png"
        diff_path = args.out_dir / f"{prefix}_diff.png"
        layout_path = args.out_dir / f"{prefix}_ledger.json"
        before.save(before_path, optimize=True)
        after.save(after_path, optimize=True)
        diff.save(diff_path, optimize=True)
        layout_path.write_text(
            json.dumps(layout, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        index["seeds"].append(
            {
                "seed": seed,
                "before": before_path.name,
                "after": after_path.name,
                "diff": diff_path.name,
                "ledger": layout_path.name,
                "metrics": metrics,
            }
        )

    index_path = args.out_dir / "seed_index.json"
    index_path.write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    js_path = args.out_dir / "seed_index.js"
    js_path.write_text(
        "window.FARM_SEED_INDEX = "
        + json.dumps(index, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(index_path)


if __name__ == "__main__":
    main()
