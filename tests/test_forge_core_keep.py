"""Blender-free tests for recipe core subset selection."""

from __future__ import annotations

import copy
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "kb3d_forge" / "forge_build.py"
SPEC = importlib.util.spec_from_file_location("kb3d_forge_build", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
forge_build = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = forge_build
SPEC.loader.exec_module(forge_build)


class CoreKeepSelectionTests(unittest.TestCase):
    def setUp(self):
        self.cores = [
            "FarmHouse",
            {"name": "FarmShed", "rel_loc": [1.0, 0.0, 0.0]},
            {"name": "FarmTower", "rel_loc": [2.0, 0.0, 0.0]},
        ]

    def test_omitted_field_keeps_every_template_core(self):
        selected = forge_build.select_template_cores({}, self.cores)
        self.assertEqual(selected, self.cores)
        self.assertIsNot(selected, self.cores)
        self.assertIs(selected[1], self.cores[1])

    def test_explicit_subset_uses_source_names_and_template_order(self):
        recipe = {"core_keep": ["FarmTower", "FarmHouse"]}
        recipe_before = copy.deepcopy(recipe)
        cores_before = copy.deepcopy(self.cores)

        selected = forge_build.select_template_cores(recipe, self.cores)

        self.assertEqual(selected, ["FarmHouse", self.cores[2]])
        self.assertEqual(recipe, recipe_before)
        self.assertEqual(self.cores, cores_before)

    def test_rejects_wrong_shape_non_strings_duplicates_and_unknown_names(self):
        invalid_cases = (
            (None, "non-empty list"),
            ([], "non-empty list"),
            ("FarmHouse", "non-empty list"),
            ([1], "non-empty string"),
            ([""], "non-empty string"),
            (["FarmHouse", "FarmHouse"], "duplicate name"),
            (["NotInTemplate"], "unknown template core"),
        )
        for value, message in invalid_cases:
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, message):
                    forge_build.select_template_cores(
                        {"core_keep": value}, self.cores
                    )

    def test_build_scene_validates_before_any_blender_work(self):
        recipe = {
            "template": "Farm_A",
            "seed": 7,
            "core_keep": ["NotInTemplate"],
        }
        catalog = {
            "templates": [{"name": "Farm_A", "cores": self.cores}],
        }
        with mock.patch.object(
            forge_build,
            "remap_textures",
            side_effect=AssertionError("Blender work started before validation"),
        ):
            with self.assertRaisesRegex(ValueError, "unknown template core"):
                forge_build.build_scene(recipe, catalog)


if __name__ == "__main__":
    unittest.main()
