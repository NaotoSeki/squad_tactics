from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

import build_ground_hd_inventory as inventory_builder  # noqa: E402


INVENTORY_PATH = (
    ROOT / "asset" / "environment" / "ground_hd" / "inventory.json"
)


class GroundHdInventoryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.inventory = json.loads(
            INVENTORY_PATH.read_text(encoding="utf-8")
        )

    def test_expected_inventory_partition(self) -> None:
        summary = self.inventory["summary"]
        self.assertEqual(258, summary["vocabularyCount"])
        self.assertEqual(238, summary["drawableCount"])
        self.assertEqual(20, summary["missingCount"])
        self.assertEqual(14, summary["mapCount"])
        self.assertEqual(238, len(self.inventory["assets"]))
        self.assertEqual(20, len(self.inventory["missing"]))

        available_ids = {item["id"] for item in self.inventory["assets"]}
        missing_ids = {item["id"] for item in self.inventory["missing"]}
        self.assertEqual(238, len(available_ids))
        self.assertEqual(20, len(missing_ids))
        self.assertFalse(available_ids & missing_ids)

    def test_family_partition(self) -> None:
        self.assertEqual(
            {
                "terrain": 69,
                "grass": 22,
                "ground_feature": 42,
                "ground_spot": 31,
                "road": 45,
                "field": 6,
                "flower": 23,
            },
            self.inventory["summary"]["drawableByFamily"],
        )
        self.assertEqual(
            {
                "terrain": 0,
                "grass": 0,
                "ground_feature": 0,
                "ground_spot": 0,
                "road": 0,
                "field": 0,
                "flower": 20,
            },
            self.inventory["summary"]["missingByFamily"],
        )

    def test_reference_geometry_and_usage_fields(self) -> None:
        map_names = set(self.inventory["sources"]["maps"])
        for item in self.inventory["assets"]:
            with self.subTest(asset=item["id"]):
                reference = (INVENTORY_PATH.parent / item["reference"]).resolve()
                self.assertTrue(reference.is_file())
                self.assertEqual(2, len(item["referenceSize"]))
                self.assertGreater(item["referenceSize"][0], 0)
                self.assertGreater(item["referenceSize"][1], 0)
                self.assertEqual(2, len(item["origin"]))
                self.assertEqual(0, item["canonicalSlot"])
                self.assertEqual(map_names, set(item["usageByMap"]))
                self.assertEqual(
                    item["usageCount"],
                    sum(item["usageByMap"].values()),
                )

    def test_missing_assets_have_no_ground_slot(self) -> None:
        for item in self.inventory["missing"]:
            with self.subTest(asset=item["id"]):
                self.assertEqual("flower", item["family"])
                self.assertNotIn(0, item["canonicalSlots"])
                self.assertEqual([1, 2, 4], item["canonicalSlots"])
                self.assertEqual(
                    item["usageCount"],
                    sum(item["usageByMap"].values()),
                )

    def test_checked_in_inventory_is_reproducible(self) -> None:
        rebuilt = inventory_builder.build_inventory(
            output_path=INVENTORY_PATH,
        )
        self.assertEqual(self.inventory, rebuilt)


if __name__ == "__main__":
    unittest.main()
