#!/usr/bin/env python3 -B
import json
import math
import os
import random
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_ps_map import (
    load_rgba,
    sprite_images,
    alpha_stamp,
    draw_stamp,
    SPRITE_ROOT,
    CATALOG_PATH,
)

GRID_W = 512
GRID_H = 384
PX = 14
CANVAS_W = GRID_W * PX
CANVAS_H = GRID_H * PX
MARGIN_CELLS = 70

OUT = r"C:\Projects\squad_tactics\scratch\ps_layered"

GROUND_STEP_PX = 360
DETAIL_STEP_CELLS = 4
DETAIL_KEEP_CHANCE = 0.55

N_CLUSTERS = 14
CLUSTER_MIN_DISTANCE = 55
CLUSTER_MAX_ATTEMPTS = 2000
LONE_TREES = 120


class SpatialIndex:
    def __init__(self, cell_size):
        self.cell_size = float(cell_size)
        self.buckets = {}

    def _bucket_key(self, x, y):
        return (
            int(math.floor(x / self.cell_size)),
            int(math.floor(y / self.cell_size)),
        )

    def add(self, x, y):
        key = self._bucket_key(x, y)
        self.buckets.setdefault(key, []).append((x, y))

    def is_clear(self, x, y, minimum_distance):
        radius = int(math.ceil(minimum_distance / self.cell_size))
        bx, by = self._bucket_key(x, y)
        min_dist_sq = minimum_distance * minimum_distance

        for iy in range(by - radius, by + radius + 1):
            for ix in range(bx - radius, bx + radius + 1):
                for ox, oy in self.buckets.get((ix, iy), ()):
                    dx = x - ox
                    dy = y - oy
                    if dx * dx + dy * dy < min_dist_sq:
                        return False
        return True


def entry_body_size(entry):
    primary_slot = entry.get("primary_slot")
    slots = entry.get("slots", [])

    for slot in slots:
        if slot.get("slot") == primary_slot and not slot.get("is_shadow"):
            return int(slot.get("png_w", 0)), int(slot.get("png_h", 0))

    for slot in slots:
        if not slot.get("is_shadow"):
            return int(slot.get("png_w", 0)), int(slot.get("png_h", 0))

    return 0, 0


def load_pool(entries, image_cache):
    pool = []

    for key, entry in entries:
        if key not in image_cache:
            try:
                image_cache[key] = sprite_images(entry)
            except Exception:
                image_cache[key] = None

        images = image_cache[key]
        if images is None:
            continue

        body, shadow = images
        if body is not None:
            pool.append((key, body, shadow))

    return pool


def build_pools(catalog):
    image_cache = {}
    records = list(catalog.items())

    grass_entries = []
    terrain_entries = []
    detail_entries = []
    all_plant_entries = []
    sticks_entries = []
    conifer_entries = []
    decid_entries = []
    bush_big_entries = []
    all_tree_entries = []

    for key, entry in records:
        key_lower = key.lower()
        name_lower = str(entry.get("name", "")).lower()
        body_w, body_h = entry_body_size(entry)

        if key.startswith("Objects/Grass/") and body_w > 300:
            grass_entries.append((key, entry))

        if key.startswith("Objects/Terrains/"):
            terrain_entries.append((key, entry))

        if key.startswith("Objects/Plants/"):
            all_plant_entries.append((key, entry))
            if max(body_w, body_h) <= 40:
                detail_entries.append((key, entry))

        if key.startswith("Objects/Sticks/"):
            sticks_entries.append((key, entry))
            detail_entries.append((key, entry))

        if key.startswith("Objects/Trees/"):
            all_tree_entries.append((key, entry))
            if any(token in name_lower for token in ("abies", "picea", "pine")):
                conifer_entries.append((key, entry))
            else:
                decid_entries.append((key, entry))

        if key_lower.startswith("objects/plants/bush_big"):
            bush_big_entries.append((key, entry))

    ground_pool = load_pool(grass_entries, image_cache)
    if not ground_pool:
        ground_pool = load_pool(terrain_entries, image_cache)

    detail_pool = load_pool(detail_entries, image_cache)
    if not detail_pool:
        detail_pool = load_pool(all_plant_entries + sticks_entries, image_cache)

    tree_conifer = load_pool(conifer_entries, image_cache)
    tree_decid = load_pool(decid_entries, image_cache)
    bush_big = load_pool(bush_big_entries, image_cache)

    all_trees = load_pool(all_tree_entries, image_cache)
    if not tree_conifer:
        tree_conifer = tree_decid[:] if tree_decid else all_trees[:]
    if not tree_decid:
        tree_decid = tree_conifer[:] if tree_conifer else all_trees[:]

    if not bush_big:
        bush_big = detail_pool[:] if detail_pool else all_trees[:]

    return ground_pool, detail_pool, tree_conifer, tree_decid, bush_big


def in_margin(x, y):
    return (
        MARGIN_CELLS <= x <= GRID_W - MARGIN_CELLS
        and MARGIN_CELLS <= y <= GRID_H - MARGIN_CELLS
    )


def generate_scatter(rng):
    centers = []
    center_attempts = 0

    while len(centers) < N_CLUSTERS and center_attempts < CLUSTER_MAX_ATTEMPTS:
        center_attempts += 1
        x = rng.randint(MARGIN_CELLS, GRID_W - MARGIN_CELLS)
        y = rng.randint(MARGIN_CELLS, GRID_H - MARGIN_CELLS)

        if all(
            (x - ox) * (x - ox) + (y - oy) * (y - oy)
            >= CLUSTER_MIN_DISTANCE * CLUSTER_MIN_DISTANCE
            for ox, oy, _tree_type in centers
        ):
            tree_type = "conifer" if rng.random() < 0.5 else "decid"
            centers.append((x, y, tree_type))

    accepted = []
    spatial = SpatialIndex(3.0)

    for center_x, center_y, tree_type in centers:
        radius = rng.randint(18, 34)
        trees_per_cluster = rng.randint(80, 160)
        sigma = radius / 2.0

        for _ in range(trees_per_cluster):
            for _resample in range(13):
                candidate_x = center_x + rng.gauss(0.0, sigma)
                candidate_y = center_y + rng.gauss(0.0, sigma)

                if not in_margin(candidate_x, candidate_y):
                    continue

                if not spatial.is_clear(candidate_x, candidate_y, 3.0):
                    continue

                accepted.append((candidate_x, candidate_y, tree_type))
                spatial.add(candidate_x, candidate_y)
                break

    lone_added = 0
    lone_attempts = 0

    while lone_added < LONE_TREES and lone_attempts < 20000:
        lone_attempts += 1
        candidate_x = rng.uniform(MARGIN_CELLS, GRID_W - MARGIN_CELLS)
        candidate_y = rng.uniform(MARGIN_CELLS, GRID_H - MARGIN_CELLS)

        if not spatial.is_clear(candidate_x, candidate_y, 4.0):
            continue

        tree_type = "conifer" if rng.random() < 0.5 else "decid"
        accepted.append((candidate_x, candidate_y, tree_type))
        spatial.add(candidate_x, candidate_y)
        lone_added += 1

    accepted.sort(key=lambda item: item[1])
    return accepted, centers, spatial


def generate_bush_positions(rng, trees, tree_spatial):
    target_count = int(len(trees) * 0.10)
    if target_count <= 0 or not trees:
        return []

    combined_spatial = SpatialIndex(3.0)
    for x, y, _tree_type in trees:
        combined_spatial.add(x, y)

    bushes = []
    attempts = 0
    max_attempts = max(2000, target_count * 150)

    while len(bushes) < target_count and attempts < max_attempts:
        attempts += 1
        source_x, source_y, _source_type = rng.choice(trees)
        candidate_x = source_x + rng.gauss(0.0, 12.0)
        candidate_y = source_y + rng.gauss(0.0, 12.0)

        if not in_margin(candidate_x, candidate_y):
            continue

        if not combined_spatial.is_clear(candidate_x, candidate_y, 3.0):
            continue

        bushes.append((candidate_x, candidate_y))
        combined_spatial.add(candidate_x, candidate_y)

    return bushes


def render_ground(rng, ground_pool):
    ground = Image.new("RGBA", (CANVAS_W, CANVAS_H), (74, 88, 58, 255))

    if not ground_pool:
        return ground

    for gy in range(0, CANVAS_H + GROUND_STEP_PX, GROUND_STEP_PX):
        for gx in range(0, CANVAS_W + GROUND_STEP_PX, GROUND_STEP_PX):
            _key, body, _shadow = rng.choice(ground_pool)
            jitter_x = rng.uniform(-60.0, 60.0)
            jitter_y = rng.uniform(-60.0, 60.0)
            left = int(round(gx - body.width / 2.0 + jitter_x))
            top = int(round(gy - body.height / 2.0 + jitter_y))
            alpha_stamp(ground, body, left, top)

    return ground


def render_detail(rng, detail_pool):
    detail = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    count = 0

    if not detail_pool:
        return detail, count

    for cell_y in range(MARGIN_CELLS, GRID_H - MARGIN_CELLS, DETAIL_STEP_CELLS):
        for cell_x in range(MARGIN_CELLS, GRID_W - MARGIN_CELLS, DETAIL_STEP_CELLS):
            if rng.random() >= DETAIL_KEEP_CHANCE:
                continue

            _key, body, shadow = rng.choice(detail_pool)
            jitter_x = rng.uniform(-1.5, 1.5) * PX
            jitter_y = rng.uniform(-1.5, 1.5) * PX
            world_px = int(round(cell_x * PX + PX // 2 + jitter_x))
            world_py = int(round(cell_y * PX + PX // 2 + jitter_y))
            draw_stamp(detail, world_px, world_py, body, shadow)
            count += 1

    return detail, count


def choose_tree_sprite(rng, tree_type, tree_conifer, tree_decid, bush_big):
    preferred = tree_conifer if tree_type == "conifer" else tree_decid
    alternate = tree_decid if tree_type == "conifer" else tree_conifer

    if preferred:
        return rng.choice(preferred)
    if alternate:
        return rng.choice(alternate)
    if bush_big:
        return rng.choice(bush_big)
    return None


def render_vegetation(rng, trees, bush_positions, tree_conifer, tree_decid, bush_big):
    veg = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))

    stamps = []
    for cell_x, cell_y, tree_type in trees:
        sprite = choose_tree_sprite(
            rng, tree_type, tree_conifer, tree_decid, bush_big
        )
        if sprite is not None:
            stamps.append((cell_y, cell_x, sprite))

    if bush_big:
        for cell_x, cell_y in bush_positions:
            stamps.append((cell_y, cell_x, rng.choice(bush_big)))

    stamps.sort(key=lambda item: item[0])

    for cell_y, cell_x, (_key, body, shadow) in stamps:
        world_px = int(round(cell_x * PX + PX // 2))
        world_py = int(round(cell_y * PX + PX // 2))
        draw_stamp(veg, world_px, world_py, body, shadow)

    return veg


def make_buildup(ground, detail, veg):
    ground_detail = Image.alpha_composite(ground, detail)
    full = Image.alpha_composite(ground_detail, veg)

    panels = []
    for image in (ground, ground_detail, full):
        height = int(round(image.height * 520 / image.width))
        panels.append(image.resize((520, height), Image.Resampling.LANCZOS).convert("RGB"))

    buildup = Image.new("RGB", (520 * 3 + 8 * 2, panels[0].height), (0, 0, 0))
    buildup.paste(panels[0], (0, 0))
    buildup.paste(panels[1], (528, 0))
    buildup.paste(panels[2], (1056, 0))
    return buildup, ground_detail, full


def make_composite_crop(composite, trees):
    if trees:
        centroid_x = sum(x for x, _y, _t in trees) / len(trees)
        centroid_y = sum(y for _x, y, _t in trees) / len(trees)
    else:
        centroid_x = GRID_W / 2.0
        centroid_y = GRID_H / 2.0

    crop_w = 120 * PX
    crop_h = 90 * PX
    center_px = centroid_x * PX + PX / 2.0
    center_py = centroid_y * PX + PX / 2.0

    left = int(round(center_px - crop_w / 2.0))
    top = int(round(center_py - crop_h / 2.0))
    left = max(0, min(CANVAS_W - crop_w, left))
    top = max(0, min(CANVAS_H - crop_h, top))

    crop = composite.crop((left, top, left + crop_w, top + crop_h))
    crop_h_resized = int(round(crop.height * 900 / crop.width))
    small = crop.resize((900, crop_h_resized), Image.Resampling.LANCZOS).convert("RGB")
    return small, centroid_x, centroid_y


def main():
    rng = random.Random(20260722)
    os.makedirs(OUT, exist_ok=True)

    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    (
        ground_pool,
        detail_pool,
        tree_conifer,
        tree_decid,
        bush_big,
    ) = build_pools(catalog)

    ground_layer = render_ground(rng, ground_pool)
    detail_layer, detail_count = render_detail(rng, detail_pool)

    trees, cluster_centers, tree_spatial = generate_scatter(rng)
    bush_positions = generate_bush_positions(rng, trees, tree_spatial)
    veg_layer = render_vegetation(
        rng,
        trees,
        bush_positions,
        tree_conifer,
        tree_decid,
        bush_big,
    )

    ground_path = os.path.join(OUT, "ground.png")
    detail_path = os.path.join(OUT, "detail.png")
    veg_path = os.path.join(OUT, "veg.png")
    composite_path = os.path.join(OUT, "composite.png")
    buildup_path = os.path.join(OUT, "buildup.jpg")
    composite_small_path = os.path.join(OUT, "composite_small.jpg")

    ground_layer.save(ground_path)
    detail_layer.save(detail_path)
    veg_layer.save(veg_path)

    buildup, ground_detail, composite = make_buildup(
        ground_layer, detail_layer, veg_layer
    )
    composite.save(composite_path)
    buildup.save(buildup_path, quality=85)

    composite_small, centroid_x, centroid_y = make_composite_crop(composite, trees)
    composite_small.save(composite_small_path, quality=85)

    print(
        "pools:",
        "ground=%d" % len(ground_pool),
        "detail=%d" % len(detail_pool),
        "conifer=%d" % len(tree_conifer),
        "decid=%d" % len(tree_decid),
        "bush_big=%d" % len(bush_big),
    )
    print("clusters:", len(cluster_centers))
    print("trees:", len(trees))
    print("bushes:", len(bush_positions))
    print("detail:", detail_count)
    print("centroid_cells: %.2f, %.2f" % (centroid_x, centroid_y))
    print("ground:", ground_path)
    print("detail:", detail_path)
    print("veg:", veg_path)
    print("composite:", composite_path)
    print("buildup:", buildup_path)
    print("composite_small:", composite_small_path)


if __name__ == "__main__":
    main()
