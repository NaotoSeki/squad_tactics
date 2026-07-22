#!/usr/bin/env python3 -B
import json
import os
import random
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, r"C:\Projects\squad_tactics\scratch")
from psm_map_analyzer import analyze_psm, extract_layers


PSM_PATH = (
    r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo"
    r"\Maps\Single\demo_campaign_battle_01.psm"
)
SPRITE_ROOT = r"C:\Projects\squad_tactics\scratch\ps_sprites_v2"
CATALOG_PATH = r"C:\Projects\squad_tactics\scratch\ps_sprites_v2\catalog.json"
OUTPUT_DIR = r"C:\Projects\squad_tactics\scratch\ps_map_decode"
FULL_OUTPUT = os.path.join(OUTPUT_DIR, "ps_repro_full.png")
SMALL_OUTPUT = os.path.join(OUTPUT_DIR, "ps_repro_small.jpg")

GRID_W = 512
GRID_H = 384
PX = 14
CANVAS_W = GRID_W * PX
CANVAS_H = GRID_H * PX
GROUND_COLOR = (74, 88, 58, 255)


def load_rgba(path):
    with Image.open(path) as image:
        return image.convert("RGBA")


def sprite_images(entry):
    primary_slot = entry.get("primary_slot")
    slots = entry.get("slots", [])

    body_slot = next(
        (
            slot
            for slot in slots
            if not slot.get("is_shadow", False) and slot.get("slot") == primary_slot
        ),
        None,
    )
    if body_slot is None:
        body_slot = next(
            (slot for slot in slots if not slot.get("is_shadow", False)),
            None,
        )
    if body_slot is None or not body_slot.get("png"):
        return None

    shadow_slot = next(
        (slot for slot in slots if slot.get("is_shadow", False) and slot.get("png")),
        None,
    )

    body = load_rgba(os.path.join(SPRITE_ROOT, body_slot["png"]))
    shadow = (
        load_rgba(os.path.join(SPRITE_ROOT, shadow_slot["png"]))
        if shadow_slot is not None
        else None
    )
    return body, shadow


def build_pools(catalog):
    trees = []
    conifers = []
    deciduous = []
    plants = []

    for key, entry in catalog.items():
        images = sprite_images(entry)
        if images is None:
            continue

        name = str(entry.get("name", key)).lower()
        if key.startswith("Objects/Trees/"):
            trees.append(images)
            if any(token in name for token in ("abies", "picea", "pine")):
                conifers.append(images)
            else:
                deciduous.append(images)
        elif key.startswith("Objects/Plants/"):
            plants.append(images)

    if not conifers:
        conifers = trees[: max(1, len(trees) // 2)]
    if not deciduous:
        deciduous = trees
    if not plants:
        plants = trees

    return conifers, deciduous, plants


def alpha_stamp(canvas, image, left, top):
    right = left + image.width
    bottom = top + image.height

    clip_left = max(0, left)
    clip_top = max(0, top)
    clip_right = min(canvas.width, right)
    clip_bottom = min(canvas.height, bottom)

    if clip_left >= clip_right or clip_top >= clip_bottom:
        return

    src_left = clip_left - left
    src_top = clip_top - top
    src_right = src_left + (clip_right - clip_left)
    src_bottom = src_top + (clip_bottom - clip_top)

    destination = canvas.crop((clip_left, clip_top, clip_right, clip_bottom))
    source = image.crop((src_left, src_top, src_right, src_bottom))
    destination = Image.alpha_composite(destination, source)
    canvas.paste(destination, (clip_left, clip_top))


def draw_stamp(canvas, world_px, world_py, body, shadow):
    if shadow is not None:
        shadow_left = world_px - shadow.width // 2
        shadow_top = world_py - shadow.height // 2
        alpha_stamp(canvas, shadow, shadow_left, shadow_top)

    body_left = world_px - body.width // 2
    body_top = world_py - body.height
    alpha_stamp(canvas, body, body_left, body_top)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    result = analyze_psm(PSM_PATH)
    layers = extract_layers(result["grid_data"], GRID_W, GRID_H)
    l0 = layers[0]["array"]
    l1 = layers[1]["array"]

    with open(CATALOG_PATH, "r", encoding="utf-8") as file:
        catalog = json.load(file)

    tree_conifer, tree_decid, bushes = build_pools(catalog)

    if not tree_conifer:
        tree_conifer = tree_decid or bushes
    if not tree_decid:
        tree_decid = tree_conifer or bushes
    if not bushes:
        bushes = tree_conifer or tree_decid

    if not (tree_conifer and tree_decid and bushes):
        raise RuntimeError("No usable tree or plant sprites were found in catalog.json")

    stamps = []
    l0_count = 0
    l1_count = 0

    for y in range(GRID_H):
        for x in range(GRID_W):
            value = int(l0[y, x])
            if value == 0:
                continue

            pool = tree_conifer if value == 2 else tree_decid
            rng = random.Random(x * 100003 + y)
            body, shadow = rng.choice(pool)
            world_px = x * PX + PX // 2
            world_py = y * PX + PX // 2
            stamps.append((world_py, world_px, body, shadow))
            l0_count += 1

    for y in range(GRID_H):
        for x in range(GRID_W):
            if l1[y, x] == 0 or (x + y) % 2 != 0:
                continue

            rng = random.Random(x * 100003 + y)
            body, shadow = rng.choice(bushes)
            world_px = x * PX + PX // 2
            world_py = y * PX + PX // 2
            stamps.append((world_py, world_px, body, shadow))
            l1_count += 1

    stamps.sort(key=lambda stamp: stamp[0])

    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), GROUND_COLOR)
    for world_py, world_px, body, shadow in stamps:
        draw_stamp(canvas, world_px, world_py, body, shadow)

    canvas.save(FULL_OUTPUT, "PNG")

    ys, xs = np.nonzero(l0)
    if len(xs):
        cx = float(xs.mean())
        cy = float(ys.mean())
    else:
        cx = GRID_W / 2.0
        cy = GRID_H / 2.0

    crop_w = 120 * PX
    crop_h = 90 * PX
    center_x = int(round(cx * PX + PX // 2))
    center_y = int(round(cy * PX + PX // 2))
    left = max(0, min(CANVAS_W - crop_w, center_x - crop_w // 2))
    top = max(0, min(CANVAS_H - crop_h, center_y - crop_h // 2))

    dense_crop = canvas.crop((left, top, left + crop_w, top + crop_h))
    small_h = round(dense_crop.height * 900 / dense_crop.width)
    dense_crop.resize((900, small_h), Image.Resampling.LANCZOS).convert("RGB").save(
        SMALL_OUTPUT,
        "JPEG",
        quality=85,
    )

    print(f"tree_conifer types: {len(tree_conifer)}")
    print(f"tree_decid types: {len(tree_decid)}")
    print(f"bushes types: {len(bushes)}")
    print(f"L0 stamps: {l0_count}")
    print(f"L1 stamps: {l1_count}")
    print(f"L0 centroid cells: ({cx:.2f}, {cy:.2f})")
    print(f"Full output: {FULL_OUTPUT}")
    print(f"Small output: {SMALL_OUTPUT}")


if __name__ == "__main__":
    main()
