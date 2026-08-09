#!/usr/bin/env python3
"""Inventory and optionally materialize every Panzer Strike FX-like SSC."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CANONICAL = ROOT / "scratch/ps_sprites_canonical_v1"
DEFAULT_OUT = ROOT / "asset/ps_fx/inventory"
FX_PATTERN = re.compile(
    r"(explos|fire|smoke|dust|spark|tracer|trasser|muzzle|shot|hit|impact|"
    r"flame|blast|rocket|shell|trail|crater)", re.I
)


def is_effect_ssc(ssc: str) -> bool:
    low = ssc.lower()
    return bool(FX_PATTERN.search(ssc) or low.startswith("animations/fragment_ground_")
                or "_hit_default_ground_" in low
                or low == "animations/grenade_projectile.ssc"
                or low == "animations/vehicle_destroy_00.ssc")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def slug_for(ssc: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", Path(ssc).with_suffix("").as_posix().lower()).strip("_")


def category_for(ssc: str) -> str:
    s = ssc.lower()
    if "/craters/" in s: return "crater_decal"
    if "fire_cell" in s or "flame" in s: return "persistent_fire"
    if "explosion" in s or "blast" in s: return "explosion"
    if "shot_smoke" in s: return "muzzle_smoke"
    if "armor_smoke" in s: return "armor_impact_smoke"
    if "default_smoke" in s: return "impact_smoke"
    if "tracks_move_smoke" in s: return "vehicle_track_smoke"
    if "tracks_move_dust" in s: return "vehicle_track_dust"
    if "dust" in s: return "impact_dust"
    if "spark" in s: return "sparks"
    if "trasser" in s or "tracer" in s: return "tracer"
    if "fragment_ground" in s: return "ground_debris_fragment"
    if "grenade_projectile" in s: return "projectile"
    if "vehicle_destroy_00" in s: return "vehicle_destroy"
    if "hit_building" in s: return "building_impact"
    if "hit_default_ground" in s: return "ground_impact"
    if "_shot" in s or s.endswith("shot.ssc"): return "muzzle_flash_or_projectile"
    if "hit" in s or "impact" in s: return "impact_other"
    return "effect_other"


def frames_per_tick_for(ssc: str) -> int:
    low = ssc.lower()
    if "tracks_move_smoke" in low or low == "animations/grenade_projectile.ssc":
        return 500
    if re.search(r"animations/mg_shot(?:_\d+)?\.ssc$", low):
        return 2000
    return 1000


def contiguous_runs(entries: list[dict]) -> list[list[dict]]:
    runs, current, previous = [], [], None
    for entry in entries:
        slot = int(entry["slot"])
        if previous is not None and slot != previous + 1:
            if current: runs.append(current)
            current = []
        current.append(entry)
        previous = slot
    if current: runs.append(current)
    return runs


def choose_grid(count: int, fw: int, fh: int) -> tuple[int, int]:
    best = None
    for cols in range(1, min(count, max(1, 16384 // fw)) + 1):
        rows = math.ceil(count / cols)
        if rows * fh > 16384: continue
        score = abs(cols * fw - rows * fh)
        if best is None or score < best[0]: best = (score, cols, rows)
    if best is None:
        raise RuntimeError(f"sheet exceeds 16384px limit: {count=} {fw=} {fh=}")
    return best[1], best[2]


def config_index(source_root: Path) -> dict[str, list[str]]:
    result: dict[str, list[str]] = defaultdict(list)
    configs = source_root.parent / "Configs"
    if not configs.exists(): return result
    for path in configs.rglob("*.sdt"):
        try: text = path.read_text(encoding="utf-8", errors="ignore").lower()
        except OSError: continue
        for stem in re.findall(r"[a-z0-9_]+", text):
            result[stem].append(str(path))
    return result


def materialize(canonical: Path, out: Path, family: dict, entries: list[dict],
                clip_key: str = "clips", runtime_key: str = "runtime", suffix: str = "") -> None:
    if not entries: return
    pad = 4
    min_x = min(int(e["origin_x"]) for e in entries)
    min_y = min(int(e["origin_y"]) for e in entries)
    max_x = max(int(e["origin_x"]) + int(e["width"]) for e in entries)
    max_y = max(int(e["origin_y"]) + int(e["height"]) for e in entries)
    fw, fh = max_x - min_x + pad * 2, max_y - min_y + pad * 2
    ax, ay = -min_x + pad, -min_y + pad
    cols, rows = choose_grid(len(entries), fw, fh)
    sheet = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    index_by_slot = {}
    for i, entry in enumerate(entries):
        src = Image.open(canonical / entry["png"]).convert("RGBA")
        x = (i % cols) * fw + ax + int(entry["origin_x"])
        y = (i // cols) * fh + ay + int(entry["origin_y"])
        sheet.alpha_composite(src, (x, y))
        index_by_slot[int(entry["slot"])] = i
    png_name = family["id"] + suffix + ".png"
    sheet.save(out / png_name, optimize=True)
    family[runtime_key] = {
        "sheet": png_name, "frameWidth": fw, "frameHeight": fh,
        "columns": cols, "rows": rows, "anchor": {"x": ax, "y": ay},
        "fps": family["runtimeFps"], "frameCount": len(entries),
    }
    for clip in family[clip_key]:
        clip["startFrame"] = index_by_slot[clip["slots"][0]]
        clip["endFrame"] = index_by_slot[clip["slots"][-1]]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-root", type=Path, default=DEFAULT_CANONICAL)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--materialize", action="store_true", help="write runtime PNG sheets")
    parser.add_argument("--category", action="append", help="limit materialization to category")
    args = parser.parse_args()
    manifest = json.loads((args.canonical_root / "canonical_manifest.json").read_text(encoding="utf-8"))
    source_root = Path(manifest["source_root"])
    cfg_index = config_index(source_root)
    by_ssc: dict[str, list[dict]] = defaultdict(list)
    for entry in manifest["sprites"]:
        if is_effect_ssc(entry["ssc"]): by_ssc[entry["ssc"]].append(entry)
    args.output_root.mkdir(parents=True, exist_ok=True)
    families, totals = [], defaultdict(int)
    for ssc in sorted(by_ssc):
        all_entries = sorted(by_ssc[ssc], key=lambda e: int(e["slot"]))
        first_shadow = next((int(e["slot"]) for e in all_entries if int(e["format_id"]) == 934), None)
        body = [e for e in all_entries if int(e["format_id"]) != 934
                and (first_shadow is None or int(e["slot"]) < first_shadow)]
        shadow = [e for e in all_entries if int(e["format_id"]) == 934]
        runs = contiguous_runs(body)
        shadow_runs = contiguous_runs(shadow)
        source_ssc = source_root / ssc
        source_spl = source_root / all_entries[0]["palette"]
        family = {
            "id": slug_for(ssc), "category": category_for(ssc), "ssc": ssc,
            "framesPerTick": frames_per_tick_for(ssc),
            "runtimeFps": 30 * 1000 / frames_per_tick_for(ssc),
            "source": {
                "ssc": str(source_ssc), "spl": str(source_spl),
                "sscSha256": sha256(source_ssc), "splSha256": sha256(source_spl),
                "configRefs": sorted(set(cfg_index.get(source_ssc.stem.lower(), []))),
                "canonicalManifest": "scratch/ps_sprites_canonical_v1/canonical_manifest.json",
            },
            "bodyFrameCount": len(body), "shadow934FrameCount": len(shadow),
            "shadow934FirstSlot": first_shadow,
            "formatCounts": {str(k): v for k, v in sorted(Counter(int(e["format_id"]) for e in all_entries).items())},
            "sourceFrames": [{
                "slot": int(e["slot"]), "png": e["png"], "formatId": int(e["format_id"]),
                "depth": int(e["depth"]), "width": int(e["width"]), "height": int(e["height"]),
                "originX": int(e["origin_x"]), "originY": int(e["origin_y"]),
                "layer": "shadow934" if int(e["format_id"]) == 934 else "body"
            } for e in all_entries],
            "clips": [{"id": f"clip_{i:03d}", "slots": [int(e["slot"]) for e in run],
                       "frameCount": len(run)} for i, run in enumerate(runs)],
            "shadow934Clips": [{"id": f"shadow_{i:03d}", "slots": [int(e["slot"]) for e in run],
                                "frameCount": len(run)} for i, run in enumerate(shadow_runs)],
            "status": "runtime_sheet_materialized" if args.materialize else "rebuildable_on_demand",
        }
        selected = not args.category or family["category"] in args.category
        if args.materialize and selected:
            materialize(args.canonical_root, args.output_root, family, body)
            if shadow:
                materialize(args.canonical_root, args.output_root, family, shadow,
                            "shadow934Clips", "runtimeShadow934", "_shadow934")
            (args.output_root / f"{family['id']}.json").write_text(
                json.dumps(family, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        elif args.materialize:
            family["status"] = "catalogued_not_materialized_by_filter"
        families.append(family)
        totals["families"] += 1; totals["clips"] += len(runs)
        totals["bodyFrames"] += len(body); totals["shadow934Frames"] += len(shadow)
    catalog = {
        "schema": "ps-fx-inventory/v1", "sourceProduct": "Panzer Strike Demo",
        "canonicalRules": "native RGBA and SSC origin preserved; format 934 shadow layer inventoried but excluded from body sheets",
        "runtimeFpsBasis": "30 * 1000 / frames_per_tick; inferred from config timing and core updates_per_second=30",
        "totals": dict(totals), "families": families,
    }
    (args.output_root / "catalog.json").write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(catalog["totals"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
