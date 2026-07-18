"""Generate deterministic KB3D Forge recipe JSON files from a parts catalog."""

from __future__ import annotations

import argparse
import copy
import json
import random
import sys
import traceback
from collections import Counter
from pathlib import Path
from typing import Any


CUT_SECTION_MAT = "KB3D_WWT_ConcreteDamagedEdgesTrimDark"
DECAL_KINDS = ("bullet", "crack", "damage", "grunge")


def clamp(value: float, low: float, high: float) -> float:
    """Clamp value to the inclusive range."""
    return max(low, min(high, value))


def bbox_extents(part: dict[str, Any]) -> tuple[float, float, float]:
    """Return relative bounding-box extents."""
    minimum = part["bb_min_rel"]
    maximum = part["bb_max_rel"]
    return (
        abs(float(maximum[0]) - float(minimum[0])),
        abs(float(maximum[1]) - float(minimum[1])),
        abs(float(maximum[2]) - float(minimum[2])),
    )


def bbox_volume(part: dict[str, Any]) -> float:
    """Return relative bounding-box volume."""
    x_size, y_size, z_size = bbox_extents(part)
    return x_size * y_size * z_size


def is_connected_core(
    core_name: str,
    core_names: list[str],
    parts_by_name: dict[str, dict[str, Any]],
) -> bool:
    """Return whether a core intersects another core after a 0.3m expansion."""
    core = parts_by_name[core_name]
    core_min = core["bb_min_rel"]
    core_max = core["bb_max_rel"]

    expanded_min = [float(value) - 0.3 for value in core_min]
    expanded_max = [float(value) + 0.3 for value in core_max]

    for other_name in core_names:
        if other_name == core_name:
            continue

        other = parts_by_name[other_name]
        other_min = other["bb_min_rel"]
        other_max = other["bb_max_rel"]

        intersects = all(
            expanded_min[axis] <= float(other_max[axis])
            and expanded_max[axis] >= float(other_min[axis])
            for axis in range(3)
        )
        if intersects:
            return True

    return False


def compatible_core(
    source: dict[str, Any],
    candidate: dict[str, Any],
    tight: bool,
) -> bool:
    """Return whether candidate satisfies the CORE swap dimensional limits.

    Connected cores (KB3D compound buildings interpenetrate by design) use
    tight ratios so the replacement preserves the compound silhouette;
    isolated cores use the loose ratios.
    """
    source_x, source_y, source_z = bbox_extents(source)
    candidate_x, candidate_y, candidate_z = bbox_extents(candidate)

    source_footprint = max(source_x, source_y)
    candidate_footprint = max(candidate_x, candidate_y)

    if source_footprint <= 0.0 or source_z <= 0.0:
        return False

    footprint_ratio = candidate_footprint / source_footprint
    height_ratio = candidate_z / source_z

    if tight:
        return 0.85 <= footprint_ratio <= 1.35 and 0.6 <= height_ratio <= 1.5
    return 0.65 <= footprint_ratio <= 1.5 and 0.5 <= height_ratio <= 1.7


def template_short_name(template_name: str) -> str:
    """Build the required lowercase template abbreviation."""
    short_name = template_name.replace("Bldg", "", 1)
    for size_name in ("Md", "Sm", "Lg"):
        short_name = short_name.replace(size_name, "", 1)

    short_name = short_name.replace("Residential", "resid")
    short_name = short_name.replace("Commercial", "comm")
    short_name = short_name.replace("Industrial", "ind")
    return short_name.lower()


def paired_occupant_name(occupant: str) -> str | None:
    """Return the matching Left or Right occupant name, if applicable."""
    if "Left" in occupant:
        return occupant.replace("Left", "Right")
    if "Right" in occupant:
        return occupant.replace("Right", "Left")
    return None


def choose_opening_op(rng: random.Random, ruin_level: float) -> str:
    """Choose an opening operation using the specified ruin-adjusted weights."""
    remove_rate = 0.15 + 0.25 * ruin_level
    swap_rate = 0.30 - 0.25 * ruin_level
    value = rng.random()

    if value < 0.55:
        return "keep"
    if value < 0.55 + swap_rate:
        return "swap"
    if value < 0.55 + swap_rate + remove_rate:
        return "remove"
    return "keep"


def build_openings(
    template: dict[str, Any],
    opening_clusters: dict[str, Any],
    rng: random.Random,
    ruin_level: float,
) -> list[dict[str, str]]:
    """Build explicit opening operations for every template anchor."""
    openings = template.get("openings", [])
    by_occupant = {opening["occupant"]: opening for opening in openings}
    decisions: dict[str, dict[str, str]] = {}
    processed_anchors: set[str] = set()

    for opening in openings:
        anchor_id = opening["anchor_id"]
        if anchor_id in processed_anchors:
            continue

        occupant = opening["occupant"]
        pair_name = paired_occupant_name(occupant)
        pair = by_occupant.get(pair_name) if pair_name is not None else None

        op = choose_opening_op(rng, ruin_level)
        cluster = opening_clusters.get(opening["cluster"], {})
        members = list(cluster.get("members", []))
        swappable = bool(cluster.get("swappable", False))

        swap_with: str | None = None
        if op == "swap":
            candidates = [member for member in members if member != occupant]
            if not swappable or not candidates:
                op = "keep"
            else:
                swap_with = rng.choice(candidates)

        primary_decision: dict[str, str] = {"anchor_id": anchor_id, "op": op}
        if op == "swap" and swap_with is not None:
            primary_decision["with"] = swap_with
        decisions[anchor_id] = primary_decision
        processed_anchors.add(anchor_id)

        if pair is None or pair["anchor_id"] in processed_anchors:
            continue

        pair_anchor_id = pair["anchor_id"]
        pair_decision: dict[str, str] = {"anchor_id": pair_anchor_id, "op": op}

        if op == "swap" and swap_with is not None:
            paired_swap_name = paired_occupant_name(swap_with)
            pair_members = opening_clusters.get(pair["cluster"], {}).get("members", [])
            if paired_swap_name is not None and paired_swap_name in pair_members:
                pair_decision["with"] = paired_swap_name
            else:
                pair_decision["op"] = "keep"

        decisions[pair_anchor_id] = pair_decision
        processed_anchors.add(pair_anchor_id)

    decision_list = [decisions[opening["anchor_id"]] for opening in openings]

    # forge_build の検証 (filled >= total * 0.4) をレシピ生成時に保証する。
    # 小開口数テンプレ(Camp系=3個)で remove 抽選が偏ると割れるため、
    # 決定論的に先頭から remove -> keep へフリップして充填率を回復する。
    total = len(decision_list)
    if total:
        required = total * 0.4
        filled = sum(1 for d in decision_list if d["op"] in ("keep", "swap"))
        for decision in decision_list:
            if filled >= required:
                break
            if decision["op"] == "remove":
                decision["op"] = "keep"
                decision.pop("with", None)
                filled += 1

    return decision_list


def build_core_swaps(
    template: dict[str, Any],
    all_core_names: list[str],
    parts_by_name: dict[str, dict[str, Any]],
    rng: random.Random,
) -> dict[str, str]:
    """Build compatible non-connected CORE substitutions."""
    core_names = list(template.get("cores", []))
    swaps: dict[str, str] = {}
    used_replacements: set[str] = set()

    for core_name in core_names:
        if rng.random() >= 0.35:
            continue
        tight = is_connected_core(core_name, core_names, parts_by_name)

        source = parts_by_name[core_name]
        candidates = [
            candidate_name
            for candidate_name in all_core_names
            if candidate_name != core_name
            and candidate_name not in used_replacements
            and compatible_core(source, parts_by_name[candidate_name], tight)
        ]
        if not candidates:
            continue

        replacement = rng.choice(candidates)
        swaps[core_name] = replacement
        used_replacements.add(replacement)

    return swaps


def template_prop_theme(template_name: str, rng: random.Random) -> str:
    """Select the required prop theme from the building family."""
    if "Church" in template_name:
        return "church"

    military_families = ("Camp", "Bunker", "Checkpoint", "SniperTower")
    if any(family in template_name for family in military_families):
        return "military"

    return "military" if rng.random() < 0.5 else "domestic"


def build_destruction(
    template: dict[str, Any],
    parts_by_name: dict[str, dict[str, Any]],
    rng: random.Random,
    ruin_level: float,
) -> dict[str, Any] | None:
    """Build the optional destruction recipe section."""
    if rng.random() >= 0.25 + 0.6 * ruin_level:
        return None

    core_names = list(template["cores"])
    # fabric shells are not boolean-safe (see destruction.py guard)
    weights = [
        0.0 if ("Tent" in name or "Tarp" in name) else bbox_volume(parts_by_name[name])
        for name in core_names
    ]

    if sum(weights) <= 0.0:
        return None
    core_index = rng.choices(range(len(core_names)), weights=weights, k=1)[0]

    count = rng.randint(1, 1 + int(2.5 * ruin_level))
    radius = [
        round(0.6 + 0.3 * ruin_level, 2),
        round(1.2 + 0.8 * ruin_level, 2),
    ]

    return {
        "holes": [
            {
                "core_index": core_index,
                "count": count,
                "radius": radius,
            }
        ],
        "cut_section_mat": CUT_SECTION_MAT,
        "debris_per_hole": [1, 2 + int(2 * ruin_level)],
    }


def build_recipe(
    seed: int,
    template: dict[str, Any],
    all_core_names: list[str],
    parts_by_name: dict[str, dict[str, Any]],
    opening_clusters: dict[str, Any],
    damage_decal_sets: dict[str, list[str]],
    out_thumb_dir: Path,
    ruin_level: float,
) -> dict[str, Any]:
    """Build one deterministic recipe."""
    rng = random.Random(seed)
    template_name = template["name"]
    core_swaps = build_core_swaps(template, all_core_names, parts_by_name, rng)
    openings = build_openings(template, opening_clusters, rng, ruin_level)

    template_decals = set(template.get("decals", []))
    decal_sets: list[str] = []
    for kind in DECAL_KINDS:
        available = bool(template_decals.intersection(damage_decal_sets.get(kind, [])))
        if not available:
            continue

        probability = 0.5 if kind == "crack" else 0.8
        if rng.random() < probability:
            decal_sets.append(kind)

    destruction = build_destruction(template, parts_by_name, rng, ruin_level)
    forge_name = f"FORGE_{seed:06d}_{template_short_name(template_name)}"

    recipe: dict[str, Any] = {
        "seed": seed,
        "name": forge_name,
        "template": template_name,
        "core_swaps": core_swaps,
        "openings": openings,
        "decals": {
            "density": clamp(rng.gauss(0.75, 0.2), 0.2, 1.2),
            "sets": decal_sets,
        },
        "debris": {
            "density": clamp(rng.gauss(0.6 + 0.4 * ruin_level, 0.2), 0.1, 1.3),
            "import_extra": rng.randint(0, 2 + int(3 * ruin_level)),
        },
        "props": {
            "density": clamp(rng.gauss(0.55, 0.2), 0.15, 1.0),
            "theme": template_prop_theme(template_name, rng),
        },
        "struct": {"keep": True},
        "output": {
            "collection": "FORGE_OUT",
            "save_blend": "",
            "thumb": str(out_thumb_dir / f"FORGE_{seed:06d}.png"),
        },
    }

    if destruction is not None:
        recipe["destruction"] = destruction

    return recipe


def ascii_print(message: str) -> None:
    """Print a message safely on ASCII-only host consoles."""
    print(message.encode("ascii", "backslashreplace").decode("ascii"))


def hex_compatible(template: dict[str, Any],
                   parts_by_name: dict[str, dict[str, Any]]) -> bool:
    """Coarse pre-filter: combined core footprint bakeable into one hex.

    hexbake shrinks oversized builds at stage time (kbres precedent: scale
    13/footprint; texel loss is invisible at the 288x384 tile resolution).
    Scale floor is 0.5, so anything wider than 13/0.5 = 26m is excluded
    here; the exact scale is measured on the assembled build (incl. props),
    not the catalog, because core swaps and scatter widen the footprint.
    """
    cores = [parts_by_name[c] for c in template.get("cores", []) if c in parts_by_name]
    if not cores:
        return False
    min_x = min(c["bb_min_rel"][0] for c in cores)
    max_x = max(c["bb_max_rel"][0] for c in cores)
    min_y = min(c["bb_min_rel"][1] for c in cores)
    max_y = max(c["bb_max_rel"][1] for c in cores)
    return max(max_x - min_x, max_y - min_y) <= 26.0


def derive_hex_triplet(
    base: dict[str, Any],
    template: dict[str, Any],
    parts_by_name: dict[str, dict[str, Any]],
    seed: int,
    out_dir: Path,
) -> list[tuple[Path, dict[str, Any]]]:
    """Derive deterministic d0/d1/d2 damage-stage hex recipes from one base.

    d0/d1/d2 share template, core swaps, and the base opening decisions so the
    triplet reads as the same building degrading; only damage-related fields
    diverge (extra opening removals, decal density, destruction block).
    """
    triplet: list[tuple[Path, dict[str, Any]]] = []
    for dmg in (0, 1, 2):
        recipe = copy.deepcopy(base)
        drng = random.Random(seed + 900000 + dmg)
        recipe["hex"] = True
        recipe["name"] = "%s_d%d" % (base["name"], dmg)
        recipe["output"]["thumb"] = ""
        # one tile must carry the scene: denser props/debris than yard mode
        recipe["props"]["density"] = clamp(recipe["props"]["density"] + 0.15, 0.15, 1.0)
        recipe["debris"]["density"] = clamp(recipe["debris"]["density"] + 0.15, 0.1, 1.3)

        extra_remove = {0: 0.0, 1: 0.10, 2: 0.25}[dmg]
        if extra_remove:
            ops = recipe["openings"]
            total = len(ops)
            filled = sum(1 for d in ops if d["op"] in ("keep", "swap"))
            for decision in ops:
                if decision["op"] in ("keep", "swap") and drng.random() < extra_remove:
                    if (filled - 1) >= total * 0.4:
                        decision["op"] = "remove"
                        decision.pop("with", None)
                        filled -= 1

        decal_scale = {0: 0.7, 1: 1.0, 2: 1.2}[dmg]
        recipe["decals"]["density"] = min(1.2, recipe["decals"]["density"] * decal_scale)

        if dmg == 0:
            recipe.pop("destruction", None)
        else:
            core_names = list(template["cores"])
            # fabric shells are not boolean-safe (see destruction.py guard)
            weights = [
                0.0 if ("Tent" in n or "Tarp" in n) else bbox_volume(parts_by_name[n])
                for n in core_names
            ]
            if sum(weights) <= 0.0:
                recipe.pop("destruction", None)
                triplet.append(
                    (out_dir / ("FORGE_%06d_d%d.json" % (seed, dmg)), recipe))
                continue
            core_index = drng.choices(range(len(core_names)), weights=weights, k=1)[0]
            if dmg == 1:
                holes = [{"core_index": core_index, "count": drng.randint(1, 2),
                          "radius": [0.6, 1.2]}]
                debris_per_hole = [1, 2]
            else:
                holes = [{"core_index": core_index, "count": drng.randint(2, 4),
                          "radius": [0.9, 1.8]}]
                debris_per_hole = [2, 4]
            recipe["destruction"] = {
                "holes": holes,
                "cut_section_mat": CUT_SECTION_MAT,
                "debris_per_hole": debris_per_hole,
            }

        triplet.append((out_dir / ("FORGE_%06d_d%d.json" % (seed, dmg)), recipe))
    return triplet


def run(args: argparse.Namespace) -> int:
    """Generate all requested recipe files and print generation statistics."""
    catalog_path = Path(args.catalog)
    out_dir = Path(args.out_dir)
    thumb_dir = Path(args.thumb_dir) if args.thumb_dir else out_dir / "thumbs"

    with catalog_path.open("r", encoding="utf-8") as handle:
        catalog = json.load(handle)

    parts_by_name = {part["name"]: part for part in catalog["parts"]}
    templates = list(catalog["templates"])
    building_templates = [template for template in templates if template.get("cores")]
    if args.hex:
        building_templates = [
            template for template in building_templates
            if hex_compatible(template, parts_by_name)
        ]
        ascii_print("hex mode: %d templates fit one hex" % len(building_templates))

    if args.templates:
        requested_names = [name.strip() for name in args.templates.split(",") if name.strip()]
        templates_by_name = {template["name"]: template for template in building_templates}
        missing_names = [name for name in requested_names if name not in templates_by_name]
        if missing_names:
            raise ValueError(f"Unknown building template(s): {', '.join(missing_names)}")
        target_templates = [templates_by_name[name] for name in requested_names]
    else:
        target_templates = building_templates

    if not target_templates:
        raise ValueError("No building templates are available.")

    all_core_names: list[str] = []
    seen_core_names: set[str] = set()
    for template in templates:
        for core_name in template.get("cores", []):
            if core_name not in seen_core_names:
                all_core_names.append(core_name)
                seen_core_names.add(core_name)

    out_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir.mkdir(parents=True, exist_ok=True)

    template_counts: Counter[str] = Counter()
    opening_counts: Counter[str] = Counter()
    core_swap_count = 0
    destruction_count = 0

    for index in range(args.n):
        seed = args.seed0 + index
        selection_rng = random.Random(seed)
        template = selection_rng.choice(target_templates)

        recipe = build_recipe(
            seed=seed,
            template=template,
            all_core_names=all_core_names,
            parts_by_name=parts_by_name,
            opening_clusters=catalog["opening_clusters"],
            damage_decal_sets=catalog["damage_decal_sets"],
            out_thumb_dir=thumb_dir,
            ruin_level=args.ruin_level,
        )

        if args.hex:
            recipes_to_write = derive_hex_triplet(
                recipe, template, parts_by_name, seed, out_dir)
        else:
            recipes_to_write = [(out_dir / f"FORGE_{seed:06d}.json", recipe)]

        for output_path, out_recipe in recipes_to_write:
            with output_path.open("w", encoding="utf-8") as handle:
                json.dump(out_recipe, handle, ensure_ascii=False, indent=1)
                handle.write("\n")

            template_counts[template["name"]] += 1
            core_swap_count += len(out_recipe["core_swaps"])
            opening_counts.update(opening["op"] for opening in out_recipe["openings"])
            if "destruction" in out_recipe:
                destruction_count += 1

    ascii_print(f"generated: {args.n}")
    template_stats = ", ".join(
        f"{name}={template_counts[name]}" for name in sorted(template_counts)
    )
    ascii_print(f"templates: {template_stats or 'none'}")
    ascii_print(f"core_swaps: {core_swap_count}")
    ascii_print(
        "openings: "
        f"keep={opening_counts['keep']}, "
        f"swap={opening_counts['swap']}, "
        f"remove={opening_counts['remove']}"
    )
    ascii_print(f"destruction: {destruction_count}")

    return 0


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Generate deterministic KB3D Forge recipe JSON files."
    )
    parser.add_argument("--catalog", required=True, help="Path to parts_catalog.json")
    parser.add_argument("--n", required=True, type=int, help="Number of recipes")
    parser.add_argument("--seed0", required=True, type=int, help="First recipe seed")
    parser.add_argument("--out-dir", required=True, help="Recipe output directory")
    parser.add_argument("--ruin-level", type=float, default=0.35)
    parser.add_argument(
        "--hex",
        action="store_true",
        help="Hex-tile mode: 13m footprint filter, d0/d1/d2 damage triplets.",
    )
    parser.add_argument(
        "--templates",
        help="Comma-separated building template names. Defaults to all buildings.",
    )
    parser.add_argument(
        "--thumb-dir",
        help="Thumbnail output directory. Defaults to <out-dir>/thumbs.",
    )
    return parser.parse_args()


def main() -> int:
    """Run the recipe generator with traceback reporting on failures."""
    try:
        args = parse_args()
        if args.n < 0:
            raise ValueError("--n must be non-negative.")
        return run(args)
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
