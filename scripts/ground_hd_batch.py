#!/usr/bin/env python3
"""List and visually inspect deterministic batches from the HD-ground queue."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
HD_DIR = ROOT / "asset" / "environment" / "ground_hd"
DEFAULT_INVENTORY = HD_DIR / "inventory.json"
DEFAULT_CONTACT = ROOT / "output" / "ground_hd_review" / "batch_contact.png"

FAMILY_SUBJECT = {
    "terrain": (
        "the same isolated natural ground-material patch, including its exact "
        "soil or forest-floor composition"
    ),
    "grass": (
        "the same isolated low grass patch, retaining every cluster, gap, "
        "flower accent, and density transition"
    ),
    "ground_feature": (
        "the same isolated small ground feature shown in the reference, "
        "retaining its object count and arrangement"
    ),
    "ground_spot": (
        "the same isolated blended ground spot or garden patch, retaining its "
        "material zones and feathered edge distribution"
    ),
    "road": (
        "the same isolated road or track segment, retaining every rut, verge, "
        "junction, width, and connection edge"
    ),
    "field": (
        "the same isolated agricultural field strip, retaining row count, "
        "spacing rhythm, gaps, and tapering ends"
    ),
    "flower": (
        "the same isolated tiny flower or low-plant cluster, retaining exact "
        "plant count, spacing, colors, and footprint"
    ),
}

FAMILY_AVOID = {
    "terrain": "tracks, puddles, new grass clumps, raised mound",
    "grass": "new bushes, trees, dense lawn carpet, oversized flowers",
    "ground_feature": "additional objects, reordered stones or sticks, raised base",
    "ground_spot": "new paths, buildings, hard circular border, raised island",
    "road": "tire tread pattern, deep trench, raised roadbed, new branches",
    "field": "new crops, extra rows, embankment, machinery tracks",
    "flower": "oversized blossoms, bouquet form, pot, tall stems, extra plants",
}


def read_inventory(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_reference(inventory_path: Path, value: str) -> Path:
    return (inventory_path.parent / value).resolve()


def prompt_for(item: dict[str, Any]) -> str:
    family = item["family"]
    subject = FAMILY_SUBJECT[family]
    avoid = FAMILY_AVOID[family]
    return "\n".join(
        (
            "Use case: precise-object-edit",
            (
                "Asset type: production 2D isometric ground decal for a "
                "photorealistic WWII tactical game"
            ),
            (
                "Input images: Image 1 is the edit target and absolute "
                "footprint, orientation, camera, palette, material, and "
                "placement-edge reference."
            ),
            (
                "Primary request: faithfully reconstruct and upscale exactly "
                f"the same {item['id']} asset at substantially higher "
                "photographic detail. This is not a redesign."
            ),
            f"Subject: {subject}.",
            (
                "Composition/framing: centered with generous padding; preserve "
                "the exact silhouette, footprint proportions, long-axis "
                "direction, internal mass distribution, gaps, connection "
                "points, and elevated 2:1 isometric/top-down viewpoint."
            ),
            (
                "Style/medium: restrained photorealistic natural material with "
                "the same muted low-contrast PS-era battlefield palette."
            ),
            (
                "Lighting/mood: use only the shared "
                "ps-overcast-upper-left-v1 lighting: one large soft neutral key "
                "arriving from screen upper-left, high overcast ambient fill, "
                "highlights on upper-left-facing relief, and every micro-shadow "
                "toward screen lower-right. No second light, front flash, rim "
                "light, hard sun, HDR, or cinematic grading."
            ),
            (
                "Scene/backdrop: perfectly flat uniform solid #ff00ff "
                "chroma-key background for local removal."
            ),
            (
                "Constraints: change only resolution and plausible sub-pixel "
                "material detail; preserve all semantic content and edge "
                f"connections. No {avoid}, detached cast shadow, floor plane, "
                "perspective change, enlarged footprint, text, border, "
                "watermark, or extra objects. Keep the background perfectly "
                "uniform and do not use #ff00ff in the subject."
            ),
        )
    )


def pending_items(
    inventory_path: Path,
    families: set[str] | None,
) -> list[dict[str, Any]]:
    inventory = read_inventory(inventory_path)
    result = []
    for item in inventory["assets"]:
        if families and item["family"] not in families:
            continue
        output = HD_DIR / f"{item['id']}_hd_v1.png"
        if output.is_file():
            continue
        result.append(
            {
                **item,
                "referenceAbsolute": str(
                    resolve_reference(inventory_path, item["reference"])
                ),
                "sourceAbsolute": str(
                    (ROOT / "tmp" / "ground_hd" / f"{item['id']}_source.png").resolve()
                ),
                "cutoutAbsolute": str(
                    (ROOT / "tmp" / "ground_hd" / f"{item['id']}_cutout.png").resolve()
                ),
                "outputAbsolute": str(output.resolve()),
                "prompt": prompt_for(item),
            }
        )
    result.sort(key=lambda item: (-int(item["usageCount"]), item["id"]))
    return result


def make_contact(
    items: list[dict[str, Any]],
    output: Path,
) -> None:
    if not items:
        canvas = Image.new("RGB", (720, 180), (76, 80, 56))
        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle(
            (16, 16, canvas.width - 16, canvas.height - 16),
            radius=12,
            fill=(105, 111, 78),
            outline=(151, 155, 119),
            width=2,
        )
        draw.text(
            (36, 70),
            "No pending ground HD assets.",
            fill=(245, 242, 220),
        )
        output.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(output)
        return

    columns = min(4, max(1, len(items)))
    rows = (len(items) + columns - 1) // columns
    card_width = 360
    card_height = 300
    canvas = Image.new(
        "RGB",
        (columns * card_width, rows * card_height),
        (76, 80, 56),
    )
    draw = ImageDraw.Draw(canvas)
    for index, item in enumerate(items):
        column = index % columns
        row = index // columns
        left = column * card_width
        top = row * card_height
        draw.rounded_rectangle(
            (left + 8, top + 8, left + card_width - 8, top + card_height - 8),
            radius=12,
            fill=(105, 111, 78),
            outline=(151, 155, 119),
            width=2,
        )
        draw.text(
            (left + 18, top + 18),
            f"{item['family']} · {item['id']}",
            fill=(245, 242, 220),
        )
        image = Image.open(item["referenceAbsolute"]).convert("RGBA")
        scale = min(
            320 / image.width,
            220 / image.height,
            3.0,
        )
        image = image.resize(
            (
                max(1, round(image.width * scale)),
                max(1, round(image.height * scale)),
            ),
            Image.Resampling.NEAREST,
        )
        x = left + (card_width - image.width) // 2
        y = top + 55 + (220 - image.height) // 2
        canvas.paste(image, (x, y), image)
        draw.text(
            (left + 18, top + card_height - 28),
            f"uses: {item['usageCount']} · {item['referenceSize'][0]}x{item['referenceSize'][1]}",
            fill=(220, 216, 194),
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)


def parse_families(value: str | None) -> set[str] | None:
    if not value:
        return None
    families = {part.strip() for part in value.split(",") if part.strip()}
    unknown = families - set(FAMILY_SUBJECT)
    if unknown:
        raise ValueError(f"unknown families: {sorted(unknown)}")
    return families


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--families")
    parser.add_argument("--limit", type=int, default=4)
    parser.add_argument("--contact", type=Path)
    args = parser.parse_args()

    items = pending_items(
        args.inventory.resolve(),
        parse_families(args.families),
    )[: args.limit]
    if args.contact:
        make_contact(items, args.contact.resolve())
    print(json.dumps(items, ensure_ascii=False))


if __name__ == "__main__":
    main()
