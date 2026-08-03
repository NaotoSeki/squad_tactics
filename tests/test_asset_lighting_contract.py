from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GROUND_MANIFEST = (
    ROOT / "asset" / "environment" / "ground_hd" / "manifest.json"
)
TREE_MANIFEST = (
    ROOT / "asset" / "environment" / "trees_hd" / "manifest.json"
)
LIGHTING_SPEC = ROOT / "docs" / "ASSET_LIGHTING_CONTRACT.md"


class AssetLightingContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ground = json.loads(GROUND_MANIFEST.read_text(encoding="utf-8"))
        cls.trees = json.loads(TREE_MANIFEST.read_text(encoding="utf-8"))

    def test_ground_and_tree_use_identical_lighting(self) -> None:
        ground = self.ground["lightingContract"]
        trees = self.trees["lightingContract"]
        for key in (
            "id",
            "keyOrigin",
            "shadowDirection",
            "shadowScreenVector",
            "elevationDegrees",
            "ambientFill",
            "colorTemperatureK",
        ):
            self.assertEqual(ground[key], trees[key], key)

    def test_contract_points_light_and_shadow_in_opposite_directions(self) -> None:
        lighting = self.ground["lightingContract"]
        self.assertEqual("screen upper-left", lighting["keyOrigin"])
        self.assertEqual("screen lower-right", lighting["shadowDirection"])
        self.assertGreater(lighting["shadowScreenVector"][0], 0)
        self.assertGreater(lighting["shadowScreenVector"][1], 0)

    def test_generation_prompts_pin_the_contract(self) -> None:
        ground_prompt = " ".join(
            self.ground["generationDefinition"]["promptContract"]
        )
        tree_prompt = " ".join(
            self.trees["generationDefinition"]["prompt"]
        )
        for prompt in (ground_prompt, tree_prompt):
            self.assertIn("ps-overcast-upper-left-v1", prompt)
            self.assertIn("screen upper-left", prompt)
            self.assertIn("screen lower-right", prompt)
            self.assertIn("No second light", prompt)

    def test_human_readable_spec_exists(self) -> None:
        text = LIGHTING_SPEC.read_text(encoding="utf-8")
        self.assertIn("ps-overcast-upper-left-v1", text)
        self.assertIn("screen upper-left", text)
        self.assertIn("screen lower-right", text)


if __name__ == "__main__":
    unittest.main()
