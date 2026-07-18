"""Blender-free contract tests for the curated Round-1 integration build."""

from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "kb3d_forge" / "review_round1_build.py"
ASSETS_PATH = ROOT / "scripts" / "kb3d_forge" / "review_round1_assets.json"
MANIFEST_PATH = ROOT / "scripts" / "kb3d_forge" / "review_scene_round1.json"

SPEC = importlib.util.spec_from_file_location("kb3d_review_round1_build", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
review_build = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = review_build
SPEC.loader.exec_module(review_build)


class ReviewRound1BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assets_manifest = json.loads(ASSETS_PATH.read_text(encoding="utf-8"))
        cls.review_manifest = json.loads(
            MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.plan = review_build.build_round1_plan(ASSETS_PATH)

    def errors_for(self, assets_manifest=None, review_manifest=None):
        return review_build.validate_asset_manifest(
            assets_manifest or self.assets_manifest,
            review_manifest or self.review_manifest,
            project_root=ROOT,
        )

    def test_fixed_asset_manifest_and_plan_match_requested_anchors(self):
        expected = {
            "camp": (
                "scratch/kb3d_review/round1_camp_beauty.json",
                "cell_r01_c03",
                "camp",
                (0.0, 0.0),
            ),
            "farmstead_curated_clean": (
                "scratch/kb3d_review/round1_farmstead_curated_clean.json",
                "cell_r04_c01",
                "farmstead",
                (6.411543, -4.0),
            ),
            "cottage_beauty": (
                "scratch/kb3d_review/round1_cottage_beauty.json",
                "cell_r03_c00",
                "farmstead",
                (2.205771, 5.5),
            ),
            "barn_curated": (
                "scratch/kb3d_review/round1_barn_curated.json",
                "cell_r05_c00",
                "farmstead",
                (4.205771, -5.5),
            ),
        }
        actual = {
            asset["id"]: (
                asset["recipe"],
                asset["anchor_cell"],
                asset["role"],
                tuple(asset["offset_m"]),
            )
            for asset in self.assets_manifest["assets"]
        }
        self.assertEqual(expected, actual)
        self.assertEqual(review_build.SOURCE_SCENE_NAME, self.plan.scene_name)
        self.assertEqual(4, len(self.plan.assets))
        self.assertEqual(
            set(expected),
            {placement.asset_id for placement in self.plan.assets},
        )
        self.assertTrue(all(
            placement.scale == 1.0 and placement.rotation_deg == 0
            for placement in self.plan.assets
        ))

        centers = {
            cell["id"]: tuple(cell["world_center_m"])
            for cell in self.review_manifest["grid"]["cells"]
        }
        for placement in self.plan.assets:
            center_x, center_y = centers[placement.anchor_cell]
            offset_x, offset_y = placement.offset_m
            expected_world = (center_x + offset_x, center_y + offset_y, 0.0)
            self.assertEqual(expected_world, placement.world_center)

    def test_validator_accepts_every_anchor_inside_its_role_footprint(self):
        self.assertEqual([], self.errors_for())
        footprints = {
            feature["role"]: set(feature["cells"])
            for feature in self.review_manifest["features"]
            if feature.get("type") == "multihex_cluster"
        }
        for asset in self.assets_manifest["assets"]:
            self.assertIn(asset["anchor_cell"], footprints[asset["role"]])

    def test_validator_rejects_unstable_or_out_of_role_cells_and_transforms(self):
        cases = []
        unknown = copy.deepcopy(self.assets_manifest)
        unknown["assets"][0]["anchor_cell"] = "cell_missing"
        cases.append((unknown, "stable manifest cell"))

        outside = copy.deepcopy(self.assets_manifest)
        outside["assets"][0]["anchor_cell"] = "cell_r05_c01"
        cases.append((outside, "outside the camp role footprint"))

        scaled = copy.deepcopy(self.assets_manifest)
        scaled["assets"][0]["scale"] = 0.999999
        cases.append((scaled, "scale must be exactly 1.0"))

        rotated = copy.deepcopy(self.assets_manifest)
        rotated["assets"][0]["rotation_deg"] = 60
        cases.append((rotated, "rotation_deg must be integer rot0"))

        bad_offset = copy.deepcopy(self.assets_manifest)
        bad_offset["assets"][0]["offset_m"] = [1.0]
        cases.append((bad_offset, "offset_m must contain two finite numbers"))

        far_offset = copy.deepcopy(self.assets_manifest)
        far_offset["assets"][0]["offset_m"] = [9.01, 0.0]
        cases.append((far_offset, "offset_m must remain within its anchor hex"))

        for mutated, expected_error in cases:
            with self.subTest(expected_error=expected_error):
                self.assertTrue(any(
                    expected_error in error
                    for error in self.errors_for(mutated)
                ))

    def test_validator_rejects_missing_invalid_and_duplicate_recipe_names(self):
        missing = copy.deepcopy(self.assets_manifest)
        missing["assets"][0]["recipe"] = (
            "scratch/kb3d_review/round1_missing_recipe.json")
        self.assertTrue(any(
            "recipe does not exist" in error
            for error in self.errors_for(missing)
        ))

        invalid = copy.deepcopy(self.assets_manifest)
        invalid["assets"][0]["recipe"] = "docs/HANDOFF_TO_GPT.md"
        self.assertTrue(any(
            "not valid object JSON" in error
            for error in self.errors_for(invalid)
        ))

        duplicate = copy.deepcopy(self.assets_manifest)
        duplicate["assets"][1]["recipe"] = duplicate["assets"][0]["recipe"]
        self.assertTrue(any(
            "recipe name must be unique" in error
            for error in self.errors_for(duplicate)
        ))

    def test_validator_rejects_duplicate_manifest_stable_cell_ids(self):
        manifest = copy.deepcopy(self.review_manifest)
        manifest["grid"]["cells"][1]["id"] = manifest["grid"]["cells"][0]["id"]
        self.assertTrue(any(
            "stable cell id is duplicated" in error
            for error in self.errors_for(review_manifest=manifest)
        ))

    def test_render_delegates_to_public_review_world_api(self):
        calls = []
        original = getattr(review_build.review_world, "render_review_world", None)

        def fake_renderer(scene, plan, output_path):
            calls.append((scene, plan, Path(output_path)))
            return Path(output_path).resolve()

        review_build.review_world.render_review_world = fake_renderer
        try:
            scene = object()
            world_plan = object()
            result = review_build.BlenderBuildResult(
                scene=scene,
                world_plan=world_plan,
                review_collection=object(),
                asset_collections=(),
            )
            output = ROOT / "scratch" / "kb3d_review" / "not_rendered.png"
            self.assertEqual(
                output.resolve(),
                review_build.render_blender_review(result, output),
            )
            self.assertEqual([(scene, world_plan, output)], calls)
        finally:
            if original is None:
                delattr(review_build.review_world, "render_review_world")
            else:
                review_build.review_world.render_review_world = original

    def test_source_orders_world_then_forge_and_isolates_render_scene(self):
        source = SCRIPT_PATH.read_text(encoding="utf-8")
        self.assertLess(
            source.index("review_world.build_blender_world"),
            source.index("forge_build.build_scene"),
        )
        self.assertIn("skip_ground=True", source)
        self.assertIn("root.location = placement.world_center", source)
        self.assertIn("root.rotation_euler = (0.0, 0.0, 0.0)", source)
        self.assertIn("root.scale = (1.0, 1.0, 1.0)", source)
        self.assertIn("render_scene = _isolated_review_scene", source)

    def test_cli_help_and_plan_only_work_without_blender(self):
        help_result = subprocess.run(
            [sys.executable, "-B", str(SCRIPT_PATH), "--help"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(
            0, help_result.returncode, help_result.stdout + help_result.stderr)
        for option in ("--plan-only", "--render", "--save-blend"):
            self.assertIn(option, help_result.stdout)

        completed = subprocess.run(
            [
                sys.executable,
                "-B",
                str(SCRIPT_PATH),
                "--assets",
                str(ASSETS_PATH),
                "--plan-only",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(0, completed.returncode, completed.stdout + completed.stderr)
        self.assertIn("REVIEW_ROUND1 PLAN OK", completed.stdout)
        self.assertIn("scene=KB3D_WorldWarTwo-Native", completed.stdout)
        self.assertIn("cells=30", completed.stdout)
        self.assertIn("assets=4", completed.stdout)
        self.assertIn("roles=camp:1,farmstead:3", completed.stdout)
        self.assertIn("scale=1.0 rotation=0", completed.stdout)


if __name__ == "__main__":
    unittest.main()
