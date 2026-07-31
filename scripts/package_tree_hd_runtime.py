#!/usr/bin/env python3
"""Package completed tree HD production for both PS and vegetation renderers."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
TREE_HD_DIR = ROOT / "asset" / "environment" / "trees_hd"
PRODUCTION_DIR = TREE_HD_DIR / "production"
PS_OBJECT_DIR = ROOT / "asset" / "environment" / "ps_objects"
TREE_PS_DIR = ROOT / "asset" / "environment" / "trees_ps"
RUNTIME_VEGETATION_DIR = TREE_HD_DIR / "runtime"
RUNTIME_PS_DIR = PRODUCTION_DIR / "runtime_ps"

SWAY = {
    "enabled": True,
    "angleDeg": 0.42,
    "scaleX": 0.0035,
    "durationMs": 4200,
}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def alpha_composite_clipped(
    canvas: Image.Image,
    sprite: Image.Image,
    left: int,
    top: int,
) -> None:
    clip_left = max(0, left)
    clip_top = max(0, top)
    clip_right = min(canvas.width, left + sprite.width)
    clip_bottom = min(canvas.height, top + sprite.height)
    if clip_left >= clip_right or clip_top >= clip_bottom:
        return
    crop = sprite.crop(
        (
            clip_left - left,
            clip_top - top,
            clip_right - left,
            clip_bottom - top,
        )
    )
    canvas.alpha_composite(crop, (clip_left, clip_top))


def crop_about_anchor(
    source: Image.Image,
    source_anchor: tuple[float, float],
    target_size: tuple[int, int],
    target_anchor: tuple[int, int],
) -> Image.Image:
    left = round(source_anchor[0] - target_anchor[0])
    top = round(source_anchor[1] - target_anchor[1])
    return source.crop((left, top, left + target_size[0], top + target_size[1]))


def approved_ps_sprites(
    public_manifest: dict[str, Any],
    canonical_sprites: dict[str, dict[str, Any]],
) -> tuple[str, dict[str, dict[str, Any]]]:
    approved = public_manifest["overrides"][0]
    tree_id = str(approved["id"])
    body_key = f"{tree_id}_s2"
    shadow_key = f"{tree_id}_s4"
    body_meta = canonical_sprites[body_key]
    shadow_meta = canonical_sprites[shadow_key]

    body_source = Image.open(TREE_HD_DIR / Path(approved["body"]).name).convert(
        "RGBA"
    )
    shadow_source = Image.open(
        TREE_HD_DIR / Path(approved["shadow"]).name
    ).convert("RGBA")
    try:
        body = crop_about_anchor(
            body_source,
            (
                float(approved["ox"]) * body_source.width,
                float(approved["oy"]) * body_source.height,
            ),
            (int(body_meta["w"]) * 2, int(body_meta["h"]) * 2),
            (-int(body_meta["ox"]) * 2, -int(body_meta["oy"]) * 2),
        )
        shadow = crop_about_anchor(
            shadow_source,
            (
                float(approved["sox"]) * shadow_source.width,
                float(approved["soy"]) * shadow_source.height,
            ),
            (int(shadow_meta["w"]) * 2, int(shadow_meta["h"]) * 2),
            (-int(shadow_meta["ox"]) * 2, -int(shadow_meta["oy"]) * 2),
        )
    finally:
        body_source.close()
        shadow_source.close()

    RUNTIME_PS_DIR.mkdir(parents=True, exist_ok=True)
    body_name = f"{body_key}_body_hd_v2.png"
    shadow_name = f"{shadow_key}_shadow_hd_v2.png"
    body.save(RUNTIME_PS_DIR / body_name, optimize=True)
    shadow.save(RUNTIME_PS_DIR / shadow_name, optimize=True)
    body.close()
    shadow.close()

    lighting_id = public_manifest["lightingContract"]["id"]
    sprites = {
        body_key: {
            "file": f"runtime_ps/{body_name}",
            "pixelRatio": 2,
            "ox": int(body_meta["ox"]),
            "oy": int(body_meta["oy"]),
            "kind": "body",
            "family": "tree",
            "lightingContract": lighting_id,
            "pairedShadowKey": shadow_key,
            "approvedSample": True,
        },
        shadow_key: {
            "file": f"runtime_ps/{shadow_name}",
            "pixelRatio": 2,
            "ox": int(shadow_meta["ox"]),
            "oy": int(shadow_meta["oy"]),
            "kind": "shadow",
            "family": "tree",
            "lightingContract": lighting_id,
            "pairedBodyKey": body_key,
            "shadowMethod": "paired-canonical-body-transform-v4-light-only",
            "shadowVersion": "shadow-v4-paired-transform",
            "darkCoreRemoved": True,
            "maxAlpha": 76,
            "approvedSample": True,
        },
    }
    return tree_id, sprites


def build_ps_runtime_manifest(
    production: dict[str, Any],
    public_manifest: dict[str, Any],
    canonical_sprites: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], str]:
    if production.get("status") != "production-complete":
        raise ValueError("tree production manifest is not complete")
    approved_id, approved_sprites = approved_ps_sprites(
        public_manifest,
        canonical_sprites,
    )
    sprites = copy.deepcopy(production["sprites"])
    overlap = set(sprites).intersection(approved_sprites)
    if overlap:
        raise ValueError(f"approved sample duplicates production: {sorted(overlap)}")
    sprites.update(approved_sprites)

    manifest = copy.deepcopy(production)
    manifest["schema"] = "raised-hd-manifest/v1"
    manifest["status"] = "production-complete"
    manifest["source"] = (
        "completed tree ImageGen BODY production + approved V4 light-only "
        "paired-transform shadows"
    )
    manifest["inventory"] = "../tree_inventory.json"
    manifest["basePath"] = "./"
    manifest["animationContract"] = {
        "body": "subtle trunk-base-pivot sway",
        "shadow": "static; shares the trunk-base world anchor",
        "sway": copy.deepcopy(SWAY),
    }
    manifest["approvedSample"] = approved_id
    manifest["sprites"] = dict(sorted(sprites.items()))
    return manifest, approved_id


def pad_production_sprite(
    source_path: Path,
    output_path: Path,
    output_size: tuple[int, int],
    paste_position: tuple[int, int],
) -> tuple[int, int]:
    source = Image.open(source_path).convert("RGBA")
    try:
        canvas = Image.new("RGBA", output_size, (0, 0, 0, 0))
        alpha_composite_clipped(
            canvas,
            source,
            paste_position[0],
            paste_position[1],
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(output_path, optimize=True)
        return source.size
    finally:
        source.close()


def build_vegetation_overrides(
    production: dict[str, Any],
    public_manifest: dict[str, Any],
    tree_ps_manifest: dict[str, Any],
    canonical_sprites: dict[str, dict[str, Any]],
    approved_id: str,
) -> tuple[dict[str, Any], int, int]:
    tree_by_id = {
        str(tree["id"]): tree
        for tree in tree_ps_manifest["trees"]
        if tree and tree.get("id")
    }
    production_ids = sorted(
        key[:-3]
        for key, meta in production["sprites"].items()
        if key.endswith("_s2") and meta.get("kind") == "body"
    )
    overrides = [copy.deepcopy(public_manifest["overrides"][0])]
    overrides[0].update(
        {
            "shadowVersion": "shadow-v4-paired-transform",
            "darkCoreRemoved": True,
            "maxAlpha": 76,
        }
    )
    packaged = 0
    absent = 0

    for tree_id in production_ids:
        tree = tree_by_id.get(tree_id)
        if not tree:
            absent += 1
            continue
        if tree_id == approved_id:
            continue

        body_key = f"{tree_id}_s2"
        shadow_key = f"{tree_id}_s4"
        body_record = production["sprites"][body_key]
        shadow_record = production["sprites"][shadow_key]
        body_meta = canonical_sprites[body_key]
        shadow_meta = canonical_sprites[shadow_key]

        body_tw = int(tree["tw"]) * 2
        body_th = int(tree["th"]) * 2
        shadow_tw = int(tree["stw"]) * 2
        shadow_th = int(tree["sth"]) * 2
        body_anchor = (
            float(tree["ox"]) * body_tw,
            float(tree["oy"]) * body_th,
        )
        shadow_anchor = (
            float(tree["sox"]) * shadow_tw,
            float(tree["soy"]) * shadow_th,
        )
        body_left = round(body_anchor[0] + int(body_meta["ox"]) * 2)
        body_top = round(body_anchor[1] + int(body_meta["oy"]) * 2)
        shadow_left = round(shadow_anchor[0] + int(shadow_meta["ox"]) * 2)
        shadow_top = round(shadow_anchor[1] + int(shadow_meta["oy"]) * 2)

        body_name = f"{tree_id}_hd_v1.png"
        shadow_name = f"{tree_id}_shadow_hd_v1.png"
        body_size = pad_production_sprite(
            PRODUCTION_DIR / body_record["file"],
            RUNTIME_VEGETATION_DIR / body_name,
            (body_tw, body_th),
            (body_left, body_top),
        )
        shadow_size = pad_production_sprite(
            PRODUCTION_DIR / shadow_record["file"],
            RUNTIME_VEGETATION_DIR / shadow_name,
            (shadow_tw, shadow_th),
            (shadow_left, shadow_top),
        )

        overrides.append(
            {
                "id": tree_id,
                "body": f"../trees_hd/runtime/{body_name}",
                "w": body_size[0],
                "h": body_size[1],
                "tw": body_tw,
                "th": body_th,
                "ox": float(tree["ox"]),
                "oy": float(tree["oy"]),
                "shadow": f"../trees_hd/runtime/{shadow_name}",
                "sw": shadow_size[0],
                "sh": shadow_size[1],
                "stw": shadow_tw,
                "sth": shadow_th,
                "sox": float(tree["sox"]),
                "soy": float(tree["soy"]),
                "renderScale": 0.5,
                "sampleGuarantee": False,
                "shadowVersion": "shadow-v4-paired-transform",
                "darkCoreRemoved": True,
                "maxAlpha": 76,
                "sway": copy.deepcopy(SWAY),
            }
        )
        packaged += 1

    manifest = copy.deepcopy(public_manifest)
    manifest["overrides"] = overrides
    manifest["productionBatch"] = {
        "status": "production-complete",
        "sourceManifest": "production/manifest.json",
        "runtimePsManifest": "production/runtime_ps_manifest.json",
        "mapPriorityTrees": len(production_ids) + 1,
        "vegetationOverrides": len(overrides),
        "notInVegetationCatalog": absent,
        "lightingContract": production["lightingContract"]["id"],
        "shadowMethod": "paired-canonical-body-transform-v4-light-only",
        "shadowVersion": "shadow-v4-paired-transform",
        "darkCoreRemoved": True,
        "maxAlpha": 76,
        "sway": copy.deepcopy(SWAY),
    }
    return manifest, packaged, absent


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--production-manifest",
        type=Path,
        default=PRODUCTION_DIR / "manifest.json",
    )
    parser.add_argument(
        "--public-manifest",
        type=Path,
        default=TREE_HD_DIR / "manifest.json",
    )
    parser.add_argument(
        "--ps-object-manifest",
        type=Path,
        default=PS_OBJECT_DIR / "manifest.json",
    )
    parser.add_argument(
        "--tree-ps-manifest",
        type=Path,
        default=TREE_PS_DIR / "manifest.json",
    )
    parser.add_argument(
        "--runtime-ps-manifest",
        type=Path,
        default=PRODUCTION_DIR / "runtime_ps_manifest.json",
    )
    args = parser.parse_args()

    production = read_json(args.production_manifest)
    public_manifest = read_json(args.public_manifest)
    canonical = read_json(args.ps_object_manifest)
    tree_ps = read_json(args.tree_ps_manifest)

    runtime_ps, approved_id = build_ps_runtime_manifest(
        production,
        public_manifest,
        canonical["sprites"],
    )
    public_runtime, packaged, absent = build_vegetation_overrides(
        production,
        public_manifest,
        tree_ps,
        canonical["sprites"],
        approved_id,
    )

    write_json(args.runtime_ps_manifest, runtime_ps)
    write_json(args.public_manifest, public_runtime)
    print(
        json.dumps(
            {
                "status": "ok",
                "mapPriorityTrees": len(runtime_ps["sprites"]) // 2,
                "psRuntimeSprites": len(runtime_ps["sprites"]),
                "vegetationOverrides": len(public_runtime["overrides"]),
                "newVegetationPackages": packaged,
                "notInVegetationCatalog": absent,
                "runtimePsManifest": str(args.runtime_ps_manifest.resolve()),
                "publicManifest": str(args.public_manifest.resolve()),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
