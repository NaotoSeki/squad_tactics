# -*- coding: utf-8 -*-
"""Roguelike WW2 ruined-city composer (verification tool, v3).

Layers: grounds (cobble / roads / scar-wasteland blobs / 2-hex crater pairs)
-> flat overlays (trenches, foxholes) -> standing overlays north->south
(buildings, church/factory, rubble, wire, bocage, props, trees, vegetation).

  python compose_city.py --seed 7 --cols 12 --rows 9 --scale 0.35 --out city.png
"""
import argparse
import hashlib
import json
import math
import os

from PIL import Image

TILES = os.path.join(os.path.dirname(__file__), "..", "..",
                     "asset", "environment", "hex_tiles_v7")

NEI = {(1, 0): 0, (1, -1): 1, (0, -1): 2, (-1, 0): 3, (-1, 1): 4, (0, 1): 5}
DIRS = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]   # index = k
SCAR_BASES = {"e1": {0}, "e2a": {0, 1}, "e2o": {0, 3},
              "e3": {0, 1, 2}, "e4": {0, 1, 2, 3}, "full": set(range(6))}


def h32(*args):
    b = ("|".join(str(a) for a in args)).encode()
    return int.from_bytes(hashlib.md5(b).digest()[:4], "little")


def rnd(seed, *args):
    return h32(seed, *args) / 0xFFFFFFFF


def scar_resolve(mask):
    """Edge mask (set of k) -> (pattern, rot_deg) or None."""
    if not mask:
        return None
    for pat, base in SCAR_BASES.items():
        for r in range(6):
            if {(k - r) % 6 for k in mask} == base:
                return (pat, r * 60)
    return None


def road_tile(dirs, seed, q, r, nvar):
    ds = sorted(set(dirs))

    def f(pat, rot):
        v = h32(seed, q, r, "rv") % nvar[pat]
        return f"road_{pat}_v{v}_rot{rot}.png"

    if len(ds) == 2:
        a, b = ds
        if (b - a) % 6 == 3:
            return f("straight", (a % 3) * 60), True
        if (b - a) % 6 == 2:
            return f("corner", a * 60), True
        if (a - b) % 6 == 2:
            return f("corner", b * 60), True
    if len(ds) == 3:
        for k in range(6):
            if {(d - k) % 6 for d in ds} == {0, 2, 3}:
                return f("tee", k * 60), True
    if len(ds) == 4:
        for k in (0, 60, 120):
            if {(d - k // 60) % 6 for d in ds} == {0, 2, 3, 5}:
                return f("cross", k), True
    return None, False


def gen_city(seed, cols, rows):
    grid = {}
    streets = set()
    av_r = 2 + h32(seed, "avr") % max(1, rows - 4)
    for q in range(cols):
        streets.add((q, av_r))
    bq = 2 + h32(seed, "avq") % max(1, cols - 4)
    q = bq
    for r in range(rows):
        streets.add((q, r))
        if r % 2 == 1:
            q -= 1

    cx, cy = cols / 2, rows / 2
    for r in range(rows):
        for q in range(cols):
            dist = math.hypot(q - cx, r - cy) / max(cx, cy)
            wreck = max(0.0, 1.0 - dist) + (rnd(seed, q, r, "n") - 0.5) * 0.55
            cell = {"ground": "cobble", "gfile": None, "flat": [], "over": [],
                    "wreck": wreck, "dist": dist, "open": True, "scar": False}
            if (q, r) in streets:
                cell["open"] = False
                cell["ground"] = "street"
            grid[(q, r)] = cell

    # ---- wasteland blobs + 2-hex crater pairs (scar system) ----
    scar_cells = set()
    pair_cells = {}          # (q,r) -> filename
    n_blob = 1 + h32(seed, "nblob") % 2
    for i in range(n_blob):
        for _try in range(20):
            bq_ = 1 + h32(seed, "blq", i, _try) % (cols - 3)
            br_ = 1 + h32(seed, "blr", i, _try) % (rows - 2)
            k = h32(seed, "blk", i, _try) % 3          # pair direction 0..2
            nb = (bq_ + DIRS[k][0], br_ + DIRS[k][1])
            if not grid.get((bq_, br_), {}).get("open") or \
               not grid.get(nb, {}).get("open"):
                continue
            v = h32(seed, "blv", i) % 2
            pair_cells[(bq_, br_)] = f"cpair_v{v}_a_rot{k * 60}.png"
            pair_cells[nb] = f"cpair_v{v}_b_rot{k * 60}.png"
            scar_cells |= {(bq_, br_), nb}
            for c in [(bq_, br_), nb]:
                for (dq, dr) in DIRS:
                    n2 = (c[0] + dq, c[1] + dr)
                    if grid.get(n2, {}).get("open"):
                        scar_cells.add(n2)
            break
    # organic extras
    extra = 2 + h32(seed, "blx") % 4
    frontier = [c for c in scar_cells if c not in pair_cells]
    for j in range(extra):
        if not frontier:
            break
        c = frontier[h32(seed, "blf", j) % len(frontier)]
        for (dq, dr) in DIRS:
            n2 = (c[0] + dq, c[1] + dr)
            if grid.get(n2, {}).get("open") and n2 not in scar_cells \
               and rnd(seed, "blg", j, n2[0], n2[1]) < 0.5:
                scar_cells.add(n2)
                frontier.append(n2)
    # repair pass: every scar cell's dirt-edge mask must be representable
    for _it in range(6):
        bad = []
        for c in scar_cells:
            if c in pair_cells:
                continue
            mask = {k for (dq, dr), k in NEI.items()
                    if (c[0] + dq, c[1] + dr) in scar_cells}
            if scar_resolve(mask) is None:
                bad.append((c, mask))
        if not bad:
            break
        for (c, mask) in bad:
            for k in range(6):
                if k not in mask:
                    kk = (k + 3) % 6
                    n2 = (c[0] + DIRS[k][0], c[1] + DIRS[k][1])
                    if grid.get(n2, {}).get("open") and n2 not in scar_cells:
                        scar_cells.add(n2)
                        break
            else:
                pass
    for c in scar_cells:
        cell = grid.get(c)
        if not cell:
            continue
        cell["scar"] = True
        cell["open"] = False
        if c in pair_cells:
            cell["ground"] = "pair"
            cell["gfile"] = pair_cells[c]
        else:
            mask = {k for (dq, dr), k in NEI.items()
                    if (c[0] + dq, c[1] + dr) in scar_cells}
            res = scar_resolve(mask)
            pat, rot = res if res else ("full", 0)
            nv = 3 if pat == "full" else 2
            rots_avail = [0] if pat == "full" else None
            v = h32(seed, c[0], c[1], "sv") % nv
            if pat == "full":
                rot = 0
            cell["ground"] = "scar"
            cell["gfile"] = f"scar_{pat}_v{v}_rot{rot}.png"

    # ---- roads resolved after scar (streets unaffected by scar) ----
    nvar = {"straight": 4, "corner": 3, "tee": 2, "cross": 2}
    for (q, r) in streets:
        if (q, r) not in grid:
            continue
        cell = grid[(q, r)]
        dirs = [k for (dq, dr), k in NEI.items() if (q + dq, r + dr) in streets]
        tile, ok = road_tile(dirs, seed, q, r, nvar)
        if ok:
            cell["ground"] = "road"
            cell["gfile"] = tile

    # ---- buildings / rubble / specials on remaining open hexes ----
    church_done = factory_done = False
    for r in range(rows):
        for q in range(cols):
            cell = grid[(q, r)]
            if not cell["open"]:
                continue
            wreck = cell["wreck"]
            roll = rnd(seed, q, r, "b")
            if not church_done and rnd(seed, "chp") < 0.75 and \
               0.3 < cell["dist"] < 0.75 and roll < 0.2:
                dmg = 0 if wreck < 0.3 else (1 if wreck < 0.65 else 2)
                cell["over"].append(f"church_d{dmg}_rot{60 * (h32(seed, q, r, 'cr') % 6)}.png")
                cell["open"] = False
                church_done = True
                continue
            if not factory_done and rnd(seed, "fap") < 0.65 and \
               cell["dist"] > 0.5 and roll < 0.25:
                dmg = 0 if wreck < 0.3 else (1 if wreck < 0.65 else 2)
                cell["over"].append(f"factory_d{dmg}_rot{60 * (h32(seed, q, r, 'fr') % 6)}.png")
                cell["open"] = False
                factory_done = True
                continue
            if roll < 0.62:
                dmg = 0 if wreck < 0.25 else (1 if wreck < 0.6 else 2)
                bs = 1 + h32(seed, q, r, "bs") % 5
                rot = 60 * (h32(seed, q, r, "rot") % 6)
                cell["over"].append(f"bldg_s{bs}_d{dmg}_rot{rot}.png")
                cell["open"] = False
            elif roll < 0.76:
                v = h32(seed, q, r, "rv") % 3
                rot = 60 * (h32(seed, q, r, "rr") % 2)
                cell["over"].append(f"rubble_v{v}_rot{rot}.png")

    # ---- trench line + wire + foxholes ----
    tr_r = (rows - 2) if h32(seed, "trs") % 2 else 1
    tq0 = 1 + h32(seed, "tq0") % max(1, cols // 2)
    tlen = 3 + h32(seed, "tql") % 4
    run = []
    for q in range(tq0, min(cols - 1, tq0 + tlen)):
        if not grid.get((q, tr_r), {}).get("open", False):
            break
        run.append(q)
    if len(run) >= 2:
        for i, q in enumerate(run):
            c = grid[(q, tr_r)]
            if i == 0:
                c["flat"].append("trench_end_v0_rot0.png")
            elif i == len(run) - 1:
                c["flat"].append("trench_end_v0_rot180.png")
            else:
                c["flat"].append(f"trench_straight_v{h32(seed, q, tr_r, 'tv') % 2}_rot0.png")
            c["open"] = False
        wr = tr_r + (1 if tr_r < rows / 2 else -1)
        for q in run:
            c = grid.get((q, wr))
            if c and c["open"] and rnd(seed, q, wr, "w") < 0.8:
                c["over"].append(f"wire_v{h32(seed, q, wr, 'wv') % 2}_rot0.png")
        for q in run:
            c = grid.get((q, tr_r + (2 if tr_r < rows / 2 else -2)))
            if c and c["open"] and rnd(seed, q, tr_r, "fx") < 0.25:
                c["flat"].append(f"foxhole_v{h32(seed, q, tr_r, 'fv') % 2}_rot0.png")
                c["open"] = False

    # ---- bocage field line on the outskirts ----
    bg_r = 1 if tr_r != 1 else rows - 2
    bq0 = 1 + h32(seed, "bg0") % max(1, cols // 2)
    blen = 3 + h32(seed, "bgl") % 4
    brun = []
    for q in range(bq0, min(cols - 1, bq0 + blen)):
        if not grid.get((q, bg_r), {}).get("open", False):
            break
        brun.append(q)
    if len(brun) >= 2:
        for i, q in enumerate(brun):
            c = grid[(q, bg_r)]
            if i == 0:
                c["over"].append("bocage_end_v0_rot0.png")
            elif i == len(brun) - 1:
                c["over"].append("bocage_end_v0_rot180.png")
            else:
                c["over"].append(f"bocage_straight_v{h32(seed, q, bg_r, 'bv') % 2}_rot0.png")
            c["open"] = False

    # ---- props / nature ----
    for r in range(rows):
        for q in range(cols):
            cell = grid[(q, r)]
            dist = cell["dist"]
            if cell["ground"] == "road":
                if rnd(seed, q, r, "hh") < 0.08:
                    cell["over"].append(
                        f"prop_hedgehog_v{h32(seed, q, r, 'hv') % 2}"
                        f"_rot{(h32(seed, q, r, 'hr') % 3) * 60}.png")
                continue
            if not cell["open"] and not cell["scar"]:
                continue
            p = rnd(seed, q, r, "px")
            if cell["scar"]:
                if p < 0.15:
                    tv = (0, 1, 2, 3, 3, 4)[h32(seed, q, r, "tw") % 6]
                    cell["over"].append(f"tree_v{tv}_rot0.png")
                continue
            if p < 0.05:
                k = "sandbag" if h32(seed, q, r, "pk") % 2 else "barrels"
                cell["over"].append(f"prop_{k}_v{h32(seed, q, r, 'pv') % 2}_rot0.png")
            elif dist > 0.6 and p < 0.25:
                if rnd(seed, q, r, "tv2") < 0.5:
                    tv = (0, 1, 2, 0, 3, 4)[h32(seed, q, r, "tvv") % 6]
                    cell["over"].append(f"tree_v{tv}_rot0.png")
                else:
                    cell["over"].append(f"veg_v{h32(seed, q, r, 'vv') % 3}_rot0.png")
            elif p > 0.93:
                cell["over"].append(f"veg_v{h32(seed, q, r, 'vv2') % 3}_rot0.png")
    return grid


def compose(seed, cols, rows, scale, out_path):
    with open(os.path.join(TILES, "catalog.json"), encoding="utf-8") as f:
        cat = json.load(f)
    meta = cat["meta"]
    Rpx = meta["hex_R_px"] * scale
    ax, ay = meta["anchor_px"]
    grid = gen_city(seed, cols, rows)

    def center(q, r):
        return (math.sqrt(3) * Rpx * (q + r / 2.0), 1.5 * Rpx * r)

    pad = 60 * scale
    W = int(math.sqrt(3) * Rpx * (cols + rows / 2.0) + pad * 2)
    H = int(1.5 * Rpx * rows + Rpx + pad * 6)
    img = Image.new("RGBA", (W, H), (24, 24, 26, 255))
    cache = {}

    def tile(name):
        if name not in cache:
            im = Image.open(os.path.join(TILES, name)).convert("RGBA")
            im = im.resize((int(im.width * scale), int(im.height * scale)),
                           Image.LANCZOS)
            cache[name] = im
        return cache[name]

    def paste(name, q, r):
        try:
            im = tile(name)
        except FileNotFoundError:
            print("MISSING", name)
            return
        cx, cy = center(q, r)
        img.alpha_composite(im, (int(cx - ax * scale + pad),
                                 int(cy - ay * scale + pad * 4)))

    ngr = {"cobble": len(cat["grounds"]["cobble"]),
           "street": len(cat["grounds"]["street"])}

    def ground_file(cell, q, r):
        g = cell["ground"]
        if cell["gfile"]:
            return cell["gfile"]
        if g == "street":
            g = "street"
        return f"gnd_{g}_v{h32(seed, q, r, 'gv') % ngr.get(g, 1)}.png"

    for r in range(rows):
        for q in range(cols):
            paste(ground_file(grid[(q, r)], q, r), q, r)
    for r in range(rows):
        for q in range(cols):
            for name in grid[(q, r)]["flat"]:
                paste(name, q, r)
    for r in range(rows):
        for q in range(cols):
            for name in grid[(q, r)]["over"]:
                paste(name, q, r)
    img.save(out_path)
    print("saved", out_path, img.size)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--cols", type=int, default=12)
    ap.add_argument("--rows", type=int, default=9)
    ap.add_argument("--scale", type=float, default=0.35)
    ap.add_argument("--out", default="city.png")
    args = ap.parse_args()
    compose(args.seed, args.cols, args.rows, args.scale, args.out)
