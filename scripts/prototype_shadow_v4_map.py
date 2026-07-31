#!/usr/bin/env python3
"""Build a non-destructive seed-3101 map preview with paired BODY shadows."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

try:
    from .build_raised_hd_map_review import CatalogRenderer
    from .raised_hd_pipeline import calibrate_shadow, find_job
    from .shadow_v4_pipeline import synthesize_shadow_v4
except ImportError:
    from build_raised_hd_map_review import CatalogRenderer
    from raised_hd_pipeline import calibrate_shadow, find_job
    from shadow_v4_pipeline import synthesize_shadow_v4


ROOT = Path(__file__).resolve().parents[1]
RAISED = ROOT / "asset" / "environment" / "raised_hd"
TREES = ROOT / "asset" / "environment" / "trees_hd" / "production"
DEFAULT_OUTPUT = ROOT / "output" / "shadow_v4_prototype" / "seed_3101"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        Path("C:/Windows/Fonts/meiryo.ttc"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ):
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def paired_slots(spec: dict[str, Any]) -> list[tuple[int, int]]:
    if spec.get("composite"):
        bodies = [int(value) for value in spec.get("body_slots", [])]
        shadows = [int(value) for value in spec.get("shadow_slots", [])]
    else:
        bodies = (
            [int(spec["body_slot"])]
            if spec.get("body_slot") is not None
            else []
        )
        shadows = (
            [int(spec["shadow_slot"])]
            if spec.get("shadow_slot") is not None
            else []
        )
    return list(zip(bodies, shadows))


def comparison(
    ps_path: Path,
    current_path: Path,
    prototype_path: Path,
    output: Path,
    *,
    light_only: bool,
) -> Path:
    panel_size = (600, 600)
    margin = 18
    header = 76
    gap = 12
    labels = (
        ("PS正本", ps_path, Image.Resampling.NEAREST),
        ("現行HD（影は不採用）", current_path, Image.Resampling.LANCZOS),
        (
            "影v4薄影版（濃いコア除去・未反映）"
            if light_only
            else "影v4試作（未反映）",
            prototype_path,
            Image.Resampling.LANCZOS,
        ),
    )
    sheet = Image.new(
        "RGB",
        (
            margin * 2 + panel_size[0] * len(labels) + gap * (len(labels) - 1),
            header + panel_size[1] + margin,
        ),
        (27, 31, 26),
    )
    draw = ImageDraw.Draw(sheet)
    title_font = font(18)
    note_font = font(12)
    for index, (label, path, resampling) in enumerate(labels):
        left = margin + index * (panel_size[0] + gap)
        with Image.open(path) as source:
            image = source.convert("RGB").resize(panel_size, resampling)
        sheet.paste(image, (left, header))
        draw.text((left, 14), label, font=title_font, fill=(226, 232, 214))
        note = (
            "正本BODY→正本影の変換のみ校正"
            if index == 2
            else "比較基準"
            if index == 0
            else "全身アルファの汎用投影"
        )
        draw.text((left, 43), note, font=note_font, fill=(172, 185, 159))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, optimize=True)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=3101)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--light-only",
        action="store_true",
        help="remove the dense shadow core and retain only soft low-alpha shade",
    )
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    ledger_path = (
        ROOT
        / "asset"
        / "environment"
        / "maps"
        / f"ps_seed_{args.seed}_objects.json"
    )
    ledger = read_json(ledger_path)
    raised_manifest_path = RAISED / "manifest.json"
    tree_manifest_path = TREES / "runtime_ps_manifest.json"
    raised_manifest = read_json(raised_manifest_path)
    tree_manifest = read_json(tree_manifest_path)
    prototype_raised = copy.deepcopy(raised_manifest)
    prototype_trees = copy.deepcopy(tree_manifest)
    for meta in prototype_raised["sprites"].values():
        meta["file"] = str((RAISED / meta["file"]).resolve())
    for meta in prototype_trees["sprites"].values():
        meta["file"] = str((TREES / meta["file"]).resolve())

    pairs: dict[tuple[str, int, int, str], None] = {}
    for spec in ledger.get("objects", []):
        for body_slot, shadow_slot in paired_slots(spec):
            pairs[
                (
                    str(spec["asset"]),
                    body_slot,
                    shadow_slot,
                    str(spec["family"]),
                )
            ] = None

    records: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    shadow_dir = output / "shadows"
    shadow_dir.mkdir(parents=True, exist_ok=True)
    for index, (asset_id, body_slot, shadow_slot, family) in enumerate(
        sorted(pairs),
        start=1,
    ):
        is_tree = family == "tree"
        inventory_path = (
            ROOT
            / "asset"
            / "environment"
            / "trees_hd"
            / "tree_inventory.json"
            if is_tree
            else RAISED / "inventory.json"
        )
        catalog_root = TREES if is_tree else RAISED
        catalog = prototype_trees if is_tree else prototype_raised
        try:
            job = find_job(inventory_path, asset_id, body_slot)
            body_key = f"{asset_id}_s{body_slot}"
            shadow_key = f"{asset_id}_s{shadow_slot}"
            body_meta = catalog["sprites"][body_key]
            body_path = Path(body_meta["file"])
            metadata = read_json(
                catalog_root / "metadata" / f"{job['jobId']}.json"
            )
            with Image.open(body_path) as source:
                body = source.convert("RGBA")
            with Image.open(job["referenceAbsolute"]) as source:
                canonical_body = source.convert("RGBA")
            with Image.open(job["shadowReferenceAbsolute"]) as source:
                canonical_shadow = source.convert("RGBA")
            calibration = calibrate_shadow(
                canonical_shadow,
                job["shadowOrigin"],
            )
            body_contact = tuple(
                float(value)
                for value in metadata["body"]["quality"]["contact"]
            )
            shadow, derivation = synthesize_shadow_v4(
                body,
                job["origin"],
                body_contact,
                job["shadowOrigin"],
                calibration,
                family=family,
                canonical_body=canonical_body,
                light_only=args.light_only,
            )
            suffix = "shadow_v4_light" if args.light_only else "shadow_v4"
            shadow_path = shadow_dir / f"{job['jobId']}_{suffix}.png"
            shadow.save(shadow_path, optimize=True)
            catalog["sprites"][shadow_key]["file"] = str(shadow_path)
            records.append(
                {
                    "jobId": job["jobId"],
                    "family": family,
                    "shadow": str(shadow_path),
                    "derivation": derivation,
                }
            )
        except Exception as error:
            failures.append(
                {
                    "asset": asset_id,
                    "bodySlot": str(body_slot),
                    "shadowSlot": str(shadow_slot),
                    "error": f"{type(error).__name__}: {error}",
                }
            )
        if index % 10 == 0 or index == len(pairs):
            print(
                f"shadow prototype {index}/{len(pairs)} "
                f"(failures={len(failures)})",
                flush=True,
            )

    prototype_raised_path = output / "raised_manifest_v4.json"
    prototype_tree_path = output / "tree_manifest_v4.json"
    write_json(prototype_raised_path, prototype_raised)
    write_json(prototype_tree_path, prototype_trees)

    canonical_manifest = (
        ROOT / "asset" / "environment" / "ps_objects" / "manifest.json"
    )
    ground = (
        ROOT
        / "output"
        / "ground_hd_maps"
        / f"ps_seed_{args.seed}_ground_hd_x2.png"
    )
    renderer = CatalogRenderer(
        canonical_manifest,
        prototype_raised_path,
        prototype_tree_path,
    )
    try:
        canvas, audit = renderer.render(ground, ledger_path, raised=True)
    finally:
        renderer.close()
    variant = "shadow_v4_light" if args.light_only else "shadow_v4"
    prototype_map = output / f"ps_seed_{args.seed}_{variant}_preview.png"
    canvas.convert("RGB").save(prototype_map, optimize=True)
    canvas.close()

    current_map = (
        ROOT
        / "output"
        / "raised_hd_maps"
        / f"ps_seed_{args.seed}_ground_raised_hd_x2.png"
    )
    ps_map = (
        ROOT
        / "output"
        / "raised_hd_maps"
        / f"ps_seed_{args.seed}_objects_ps.png"
    )
    comparison_path = comparison(
        ps_map,
        current_map,
        prototype_map,
        output / f"ps_seed_{args.seed}_{variant}_comparison.png",
        light_only=args.light_only,
    )
    summary = {
        "status": "prototype",
        "seed": args.seed,
        "uniquePairs": len(pairs),
        "generated": len(records),
        "failures": failures,
        "productionOverwritten": False,
        "darkCoreRemoved": args.light_only,
        "audit": audit,
        "map": str(prototype_map),
        "comparison": str(comparison_path),
        "records": records,
    }
    write_json(output / "summary.json", summary)
    print(
        json.dumps(
            {
                key: value
                for key, value in summary.items()
                if key not in {"records"}
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
