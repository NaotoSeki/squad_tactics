"""Assemble the fixed Round-1 review world and curated KB3D assets.

Validation and planning run in ordinary Python. Blender is imported only for
the final assembly, render, and save operations.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import review_world


ASSET_SCHEMA = "squad-tactics.review-round1-assets/v1"
SOURCE_SCENE_NAME = "KB3D_WorldWarTwo-Native"
RENDER_SCENE_NAME = "REVIEW_ROUND1_RENDER"
DEFAULT_ASSETS_PATH = SCRIPT_DIR / "review_round1_assets.json"


@dataclass(frozen=True)
class AssetPlacement:
    asset_id: str
    role: str
    anchor_cell: str
    offset_m: tuple[float, float]
    world_center: tuple[float, float, float]
    recipe_path: Path
    recipe_name: str
    collection_name: str
    scale: float
    rotation_deg: int


@dataclass(frozen=True)
class Round1BuildPlan:
    assets_path: Path
    manifest_path: Path
    catalog_path: Path
    scene_name: str
    world_plan: Any
    assets: tuple[AssetPlacement, ...]


@dataclass(frozen=True)
class BlenderBuildResult:
    scene: Any
    world_plan: Any
    review_collection: Any
    asset_collections: tuple[Any, ...]


def load_json_object(path: str | Path, *, label: str) -> dict[str, Any]:
    source = Path(path)
    with source.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("%s JSON root must be an object: %s" % (label, source))
    return value


def resolve_project_path(
    value: str | Path,
    *,
    project_root: str | Path = PROJECT_ROOT,
) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = Path(project_root) / path
    return path.resolve()


def _finite_number(value: Any) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(float(value))
    )


def _stable_cell_centers(
    manifest: Mapping[str, Any],
    errors: list[str],
) -> dict[str, tuple[float, float]]:
    grid = manifest.get("grid")
    cells = grid.get("cells") if isinstance(grid, Mapping) else None
    if not isinstance(cells, list):
        errors.append("review manifest grid.cells must be a list of stable cells")
        return {}
    centers: dict[str, tuple[float, float]] = {}
    for index, cell in enumerate(cells):
        label = "review manifest grid.cells[%d]" % index
        if not isinstance(cell, Mapping):
            errors.append("%s must be an object" % label)
            continue
        cell_id = cell.get("id")
        if not isinstance(cell_id, str) or not cell_id:
            errors.append("%s.id must be a non-empty stable cell id" % label)
            continue
        if cell_id in centers:
            errors.append("review manifest stable cell id is duplicated: %s" % cell_id)
            continue
        center = cell.get("world_center_m")
        if (
            not isinstance(center, (list, tuple))
            or len(center) != 2
            or not all(_finite_number(value) for value in center)
        ):
            errors.append("%s.world_center_m must contain two finite numbers" % label)
            continue
        centers[cell_id] = (float(center[0]), float(center[1]))
    return centers


def _role_footprints(
    manifest: Mapping[str, Any],
    errors: list[str],
) -> dict[str, frozenset[str]]:
    features = manifest.get("features")
    if not isinstance(features, list):
        errors.append("review manifest features must be a list")
        return {}
    footprints: dict[str, frozenset[str]] = {}
    for feature in features:
        if not isinstance(feature, Mapping):
            continue
        if feature.get("type") != "multihex_cluster":
            continue
        role = feature.get("role")
        cells = feature.get("cells")
        if not isinstance(role, str) or not role:
            errors.append("multihex_cluster role must be a non-empty string")
            continue
        if role in footprints:
            errors.append("review manifest multihex role is duplicated: %s" % role)
            continue
        if (
            not isinstance(cells, list)
            or not cells
            or any(not isinstance(cell_id, str) or not cell_id for cell_id in cells)
        ):
            errors.append("multihex role %s must list stable footprint cells" % role)
            continue
        footprints[role] = frozenset(cells)
    return footprints


def _read_recipe_for_validation(
    recipe_ref: Any,
    *,
    project_root: str | Path,
    label: str,
    errors: list[str],
) -> tuple[Path | None, dict[str, Any] | None]:
    if not isinstance(recipe_ref, str) or not recipe_ref:
        errors.append("%s.recipe must be a non-empty repository-relative path" % label)
        return None, None
    recipe_path = resolve_project_path(recipe_ref, project_root=project_root)
    if not recipe_path.is_file():
        errors.append("%s.recipe does not exist: %s" % (label, recipe_path))
        return recipe_path, None
    try:
        recipe = load_json_object(recipe_path, label="recipe")
    except (OSError, UnicodeError, ValueError) as exc:
        errors.append("%s.recipe is not valid object JSON: %s" % (label, exc))
        return recipe_path, None
    return recipe_path, recipe


def validate_assets(
    assets_manifest: Mapping[str, Any],
    review_manifest: Mapping[str, Any],
    *,
    project_root: str | Path = PROJECT_ROOT,
) -> list[str]:
    """Return deterministic Blender-free validation errors."""

    errors: list[str] = []
    if assets_manifest.get("schema") != ASSET_SCHEMA:
        errors.append("assets schema must be %s" % ASSET_SCHEMA)
    if assets_manifest.get("scene") != SOURCE_SCENE_NAME:
        errors.append("assets scene must be %s" % SOURCE_SCENE_NAME)
    centers = _stable_cell_centers(review_manifest, errors)
    footprints = _role_footprints(review_manifest, errors)
    grid = review_manifest.get("grid")
    radius_value = grid.get("hex_radius_m") if isinstance(grid, Mapping) else None
    if not _finite_number(radius_value) or float(radius_value) <= 0.0:
        errors.append("review manifest grid.hex_radius_m must be positive")
        hex_radius = 0.0
    else:
        hex_radius = float(radius_value)
    assets = assets_manifest.get("assets")
    if not isinstance(assets, list) or not assets:
        errors.append("assets must be a non-empty list")
        return errors

    asset_ids: set[str] = set()
    recipe_names: dict[str, str] = {}
    collection_names: dict[str, str] = {}
    for index, asset in enumerate(assets):
        label = "assets[%d]" % index
        if not isinstance(asset, Mapping):
            errors.append("%s must be an object" % label)
            continue
        asset_id = asset.get("id")
        if not isinstance(asset_id, str) or not asset_id:
            errors.append("%s.id must be a non-empty string" % label)
        elif asset_id in asset_ids:
            errors.append("asset id must be unique: %s" % asset_id)
        else:
            asset_ids.add(asset_id)
            label = "asset %s" % asset_id

        role = asset.get("role")
        anchor_cell = asset.get("anchor_cell")
        if not isinstance(anchor_cell, str) or not anchor_cell:
            errors.append("%s.anchor_cell must be a stable cell id" % label)
        elif anchor_cell not in centers:
            errors.append(
                "%s.anchor_cell does not resolve to a stable manifest cell: %s"
                % (label, anchor_cell)
            )
        if not isinstance(role, str) or not role:
            errors.append("%s.role must be a non-empty string" % label)
        elif role not in footprints:
            errors.append("%s.role has no multihex footprint: %s" % (label, role))
        elif anchor_cell in centers and anchor_cell not in footprints[role]:
            errors.append(
                "%s anchor %s is outside the %s role footprint"
                % (label, anchor_cell, role)
            )

        offset = asset.get("offset_m")
        if (
            not isinstance(offset, (list, tuple))
            or len(offset) != 2
            or not all(_finite_number(value) for value in offset)
        ):
            errors.append("%s.offset_m must contain two finite numbers" % label)
        elif hex_radius > 0.0 and math.hypot(
            float(offset[0]), float(offset[1])
        ) > hex_radius + 1.0e-6:
            errors.append("%s.offset_m must remain within its anchor hex" % label)

        scale = asset.get("scale")
        if not _finite_number(scale) or float(scale) != 1.0:
            errors.append("%s.scale must be exactly 1.0" % label)
        rotation = asset.get("rotation_deg")
        if (
            isinstance(rotation, bool)
            or not isinstance(rotation, int)
            or rotation != 0
        ):
            errors.append("%s.rotation_deg must be integer rot0" % label)

        _recipe_path, recipe = _read_recipe_for_validation(
            asset.get("recipe"),
            project_root=project_root,
            label=label,
            errors=errors,
        )
        if recipe is None:
            continue
        recipe_name = recipe.get("name")
        if not isinstance(recipe_name, str) or not recipe_name:
            errors.append("%s recipe name must be a non-empty string" % label)
        elif recipe_name in recipe_names:
            errors.append(
                "recipe name must be unique: %s (%s and %s)"
                % (recipe_name, recipe_names[recipe_name], label)
            )
        else:
            recipe_names[recipe_name] = label

        output = recipe.get("output")
        collection_name = (
            output.get("collection")
            if isinstance(output, Mapping)
            else None
        ) or "FORGE_OUT"
        if not isinstance(collection_name, str) or not collection_name:
            errors.append("%s recipe output.collection must be a string" % label)
        elif collection_name in collection_names:
            errors.append(
                "recipe output collection must be unique: %s" % collection_name
            )
        else:
            collection_names[collection_name] = label
    return errors


def validate_asset_manifest(
    assets_manifest: Mapping[str, Any],
    review_manifest: Mapping[str, Any],
    *,
    project_root: str | Path = PROJECT_ROOT,
) -> list[str]:
    """Public name for validating the Round-1 asset manifest."""

    return validate_assets(
        assets_manifest, review_manifest, project_root=project_root)


def _raise_validation_errors(errors: Sequence[str]) -> None:
    if errors:
        raise ValueError(
            "invalid Round-1 asset placement manifest:\n- "
            + "\n- ".join(errors)
        )


def _asset_placements(
    assets_manifest: Mapping[str, Any],
    review_manifest: Mapping[str, Any],
    *,
    project_root: str | Path,
) -> tuple[AssetPlacement, ...]:
    errors = validate_assets(
        assets_manifest,
        review_manifest,
        project_root=project_root,
    )
    _raise_validation_errors(errors)
    centers = _stable_cell_centers(review_manifest, [])
    placements = []
    for asset in assets_manifest["assets"]:
        recipe_path = resolve_project_path(
            asset["recipe"], project_root=project_root)
        recipe = load_json_object(recipe_path, label="recipe")
        output = recipe.get("output")
        collection_name = (
            output.get("collection")
            if isinstance(output, Mapping)
            else None
        ) or "FORGE_OUT"
        center_x, center_y = centers[asset["anchor_cell"]]
        offset_x, offset_y = (float(value) for value in asset["offset_m"])
        placements.append(
            AssetPlacement(
                asset_id=asset["id"],
                role=asset["role"],
                anchor_cell=asset["anchor_cell"],
                offset_m=(offset_x, offset_y),
                world_center=(center_x + offset_x, center_y + offset_y, 0.0),
                recipe_path=recipe_path,
                recipe_name=recipe["name"],
                collection_name=collection_name,
                scale=1.0,
                rotation_deg=0,
            )
        )
    return tuple(placements)


def build_round1_plan(
    assets_path: str | Path = DEFAULT_ASSETS_PATH,
    *,
    manifest_path: str | Path | None = None,
    catalog_path: str | Path | None = None,
    project_root: str | Path = PROJECT_ROOT,
) -> Round1BuildPlan:
    assets_source = Path(assets_path).resolve()
    assets_manifest = load_json_object(assets_source, label="assets")
    manifest_ref = (
        manifest_path
        if manifest_path is not None
        else assets_manifest.get("manifest")
    )
    if not isinstance(manifest_ref, (str, Path)) or not str(manifest_ref):
        raise ValueError("assets manifest must define a review manifest path")
    resolved_manifest = resolve_project_path(
        manifest_ref, project_root=project_root)
    review_manifest = load_json_object(resolved_manifest, label="review manifest")

    catalog_ref = (
        catalog_path
        if catalog_path is not None
        else assets_manifest.get("catalog")
    )
    if not isinstance(catalog_ref, (str, Path)) or not str(catalog_ref):
        raise ValueError("assets manifest must define a catalog path")
    resolved_catalog = resolve_project_path(
        catalog_ref, project_root=project_root)

    placements = _asset_placements(
        assets_manifest,
        review_manifest,
        project_root=project_root,
    )
    world_plan = review_world.build_world_plan(review_manifest)
    return Round1BuildPlan(
        assets_path=assets_source,
        manifest_path=resolved_manifest,
        catalog_path=resolved_catalog,
        scene_name=SOURCE_SCENE_NAME,
        world_plan=world_plan,
        assets=placements,
    )


def _remove_generated_collection(bpy: Any, collection_name: str) -> None:
    collection = bpy.data.collections.get(collection_name)
    if collection is None:
        return
    for obj in list(collection.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(collection)


def _activate_scene(bpy: Any, scene: Any) -> None:
    window_manager = getattr(bpy.context, "window_manager", None)
    for window in getattr(window_manager, "windows", ()):
        window.scene = scene


def _isolated_review_scene(
    bpy: Any,
    review_collection: Any,
    asset_collections: Sequence[Any],
) -> Any:
    """Link only generated terrain and assets into the render scene."""

    scene = bpy.data.scenes.get(RENDER_SCENE_NAME)
    if scene is None:
        scene = bpy.data.scenes.new(RENDER_SCENE_NAME)
    for obj in list(scene.collection.objects):
        scene.collection.objects.unlink(obj)
        if obj.users == 0:
            bpy.data.objects.remove(obj)
    for child in list(scene.collection.children):
        scene.collection.children.unlink(child)
    scene.collection.children.link(review_collection)
    for collection in asset_collections:
        scene.collection.children.link(collection)
    return scene


def build_blender_review(plan: Round1BuildPlan) -> BlenderBuildResult:
    """Build terrain first, then verified unit-scale rot0 assets in Blender."""

    try:
        import bpy  # type: ignore
        import forge_build  # type: ignore
    except ImportError as exc:
        raise RuntimeError("build_blender_review must run inside Blender") from exc

    scene = bpy.data.scenes.get(plan.scene_name)
    if scene is None:
        raise RuntimeError("required Blender scene not found: %s" % plan.scene_name)
    _activate_scene(bpy, scene)
    review_collection = review_world.build_blender_world(
        plan.manifest_path,
        scene=scene,
    )
    catalog = load_json_object(plan.catalog_path, label="parts catalog")

    asset_collections = []
    for placement in plan.assets:
        recipe = load_json_object(placement.recipe_path, label="recipe")
        _remove_generated_collection(bpy, placement.collection_name)
        result = forge_build.build_scene(recipe, catalog, skip_ground=True)
        if not isinstance(result, Mapping) or not result.get("verify_ok"):
            raise RuntimeError(
                "Forge verification failed for recipe: %s"
                % placement.recipe_name
            )
        root = result["root"]
        root.name = "RW_ASSET_" + placement.asset_id.upper()
        root.location = placement.world_center
        root.rotation_euler = (0.0, 0.0, 0.0)
        root.scale = (1.0, 1.0, 1.0)
        root["review_asset_id"] = placement.asset_id
        root["review_role"] = placement.role
        root["review_anchor_cell"] = placement.anchor_cell
        root["review_offset_m"] = list(placement.offset_m)
        root["review_recipe_name"] = placement.recipe_name

        out_collection = result["out_col"]
        out_collection["review_asset_id"] = placement.asset_id
        out_collection["review_role"] = placement.role
        out_collection["review_anchor_cell"] = placement.anchor_cell
        out_collection["review_offset_m"] = list(placement.offset_m)
        out_collection["review_scale"] = 1.0
        out_collection["review_rotation_deg"] = 0
        asset_collections.append(out_collection)

    bpy.context.view_layer.update()
    review_collection["buildings_placed"] = True
    review_collection["placed_asset_count"] = len(asset_collections)
    collection_names = json.dumps(
        [collection.name for collection in asset_collections],
        separators=(",", ":"),
    )
    scene["review_asset_collections"] = collection_names
    render_scene = _isolated_review_scene(
        bpy,
        review_collection,
        asset_collections,
    )
    render_scene["review_source_scene"] = scene.name
    render_scene["review_asset_collections"] = collection_names
    return BlenderBuildResult(
        scene=render_scene,
        world_plan=plan.world_plan,
        review_collection=review_collection,
        asset_collections=tuple(asset_collections),
    )


def render_blender_review(
    result: BlenderBuildResult,
    output_path: str | Path,
) -> Path:
    renderer = getattr(review_world, "render_review_world", None)
    if not callable(renderer):
        raise RuntimeError(
            "review_world.render_review_world(scene, plan, output_path) "
            "is required for --render"
        )
    rendered = renderer(result.scene, result.world_plan, output_path)
    return Path(rendered if rendered is not None else output_path).resolve()


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, default=DEFAULT_ASSETS_PATH)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--catalog", type=Path)
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--render", type=Path)
    parser.add_argument("--save-blend", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    if argv is None:
        argv = (
            sys.argv[sys.argv.index("--") + 1:]
            if "--" in sys.argv
            else sys.argv[1:]
        )
    args = _parse_args(argv)
    try:
        plan = build_round1_plan(
            args.assets,
            manifest_path=args.manifest,
            catalog_path=args.catalog,
        )
    except (OSError, UnicodeError, ValueError) as exc:
        print("REVIEW_ROUND1 PLAN ERROR %s" % exc, file=sys.stderr)
        return 2

    if args.plan_only:
        role_counts: dict[str, int] = {}
        for asset in plan.assets:
            role_counts[asset.role] = role_counts.get(asset.role, 0) + 1
        roles = ",".join(
            "%s:%d" % item for item in sorted(role_counts.items()))
        print(
            "REVIEW_ROUND1 PLAN OK scene=%s cells=%d assets=%d roles=%s "
            "scale=1.0 rotation=0"
            % (
                plan.scene_name,
                len(plan.world_plan.cells),
                len(plan.assets),
                roles,
            )
        )
        return 0

    result = build_blender_review(plan)
    if args.render is not None:
        rendered_path = render_blender_review(result, args.render)
        print("REVIEW_ROUND1 RENDER OK path=%s" % rendered_path)
    if args.save_blend is not None:
        import bpy  # type: ignore

        destination = args.save_blend.resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(destination))
        print("REVIEW_ROUND1 SAVE OK path=%s" % destination)
    print(
        "REVIEW_ROUND1 BUILD OK scene=%s assets=%d scale=1.0 rotation=0"
        % (result.scene.name, len(result.asset_collections))
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
