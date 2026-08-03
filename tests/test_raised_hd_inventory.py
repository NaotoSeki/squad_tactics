from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

import build_raised_hd_inventory as inventory_builder  # noqa: E402
import raised_hd_batch  # noqa: E402


INVENTORY_PATH = (
    ROOT / "asset" / "environment" / "raised_hd" / "inventory.json"
)


class RaisedHdInventoryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.inventory = json.loads(
            INVENTORY_PATH.read_text(encoding="utf-8")
        )

    def test_expected_inventory_counts(self) -> None:
        summary = self.inventory["summary"]
        self.assertEqual(14, summary["mapCount"])
        self.assertEqual(138, summary["assetCount"])
        self.assertEqual(1281, summary["usageCount"])
        self.assertEqual(287, summary["bodyVariantCount"])
        self.assertEqual(252, summary["pairedShadowVariantCount"])
        self.assertEqual(35, summary["shadowlessBodyVariantCount"])
        self.assertEqual(539, summary["canonicalSlotCount"])
        self.assertEqual(0, summary["selectedDuplicateSlotCount"])
        self.assertEqual(138, len(self.inventory["assets"]))

    def test_family_partition(self) -> None:
        summary = self.inventory["summary"]
        self.assertEqual(
            {
                "building": 25,
                "fence": 1,
                "large_prop": 69,
                "shrub": 43,
            },
            summary["assetsByFamily"],
        )
        self.assertEqual(
            {
                "building": 39,
                "fence": 341,
                "large_prop": 199,
                "shrub": 702,
            },
            summary["usageByFamily"],
        )
        self.assertEqual(
            {
                "building": 100,
                "fence": 40,
                "large_prop": 69,
                "shrub": 78,
            },
            summary["bodyVariantsByFamily"],
        )
        self.assertEqual(
            {
                "building": 100,
                "fence": 40,
                "large_prop": 69,
                "shrub": 43,
            },
            summary["pairedShadowVariantsByFamily"],
        )
        self.assertEqual(
            {
                "building": 200,
                "fence": 80,
                "large_prop": 138,
                "shrub": 121,
            },
            summary["canonicalSlotsByFamily"],
        )

    def test_usage_and_canonical_geometry_are_complete(self) -> None:
        map_names = {
            item["name"]
            for item in self.inventory["sources"]["ledgers"]
        }
        seen_ids: set[str] = set()
        for asset in self.inventory["assets"]:
            with self.subTest(asset=asset["id"]):
                self.assertNotIn(asset["id"].casefold(), seen_ids)
                seen_ids.add(asset["id"].casefold())
                self.assertIn(
                    asset["family"],
                    {"building", "fence", "large_prop", "shrub"},
                )
                self.assertEqual(map_names, set(asset["usageByMap"]))
                self.assertEqual(
                    asset["usageCount"],
                    sum(asset["usageByMap"].values()),
                )

                canonical = {
                    int(record["slot"]): record
                    for record in asset["canonicalSlots"]
                }
                for record in canonical.values():
                    reference = (
                        INVENTORY_PATH.parent / record["reference"]
                    ).resolve()
                    self.assertTrue(reference.is_file())
                    with Image.open(reference) as image:
                        self.assertEqual(
                            tuple(record["referenceSize"]),
                            image.size,
                        )
                    self.assertEqual(2, len(record["origin"]))
                    self.assertTrue(record["roles"])

                for variant in asset["bodyVariants"]:
                    body_slot = int(variant["bodySlot"])
                    self.assertIn(body_slot, canonical)
                    self.assertTrue(
                        set(variant["roles"])
                        & {"body", "stateBody", "crushedBody"}
                    )
                    shadow_slot = variant["pairedShadowSlot"]
                    if shadow_slot is not None:
                        self.assertIn(int(shadow_slot), canonical)
                        self.assertTrue(
                            set(canonical[int(shadow_slot)]["roles"])
                            & {"shadow", "stateShadow", "crushedShadow"}
                        )

    def test_shadow_contract_forbids_canonical_pixel_reuse(self) -> None:
        policy = self.inventory["shadowPolicy"]
        self.assertEqual("generated-body-derived", policy["method"])
        self.assertIn("calibration only", policy["canonicalShadowRole"])
        self.assertIn("copying", policy["forbidden"])
        self.assertIn(
            "screen lower-right",
            policy["alignmentInvariant"],
        )
        self.assertEqual(
            "ps-overcast-upper-left-v1",
            self.inventory["lightingContract"]["id"],
        )

    def test_checked_in_inventory_is_reproducible(self) -> None:
        rebuilt = inventory_builder.build_inventory(
            output_path=INVENTORY_PATH,
        )
        self.assertEqual(self.inventory, rebuilt)

    def test_batch_jobs_are_slot_exact_and_strict(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(
            raised_hd_batch,
            "HD_DIR",
            Path(temp_dir) / "raised_hd",
        ):
            jobs = raised_hd_batch.pending_jobs(
                INVENTORY_PATH,
                {"building"},
            )
        hd_root = ROOT / "asset" / "environment" / "raised_hd"
        completed_buildings = 0
        for asset in self.inventory["assets"]:
            if asset["family"] != "building":
                continue
            for variant in asset["bodyVariants"]:
                job_id = f"{asset['id']}_s{variant['bodySlot']}"
                body_exists = (
                    hd_root / "body" / f"{job_id}_body_hd_v1.png"
                ).is_file()
                metadata_exists = (
                    hd_root / "metadata" / f"{job_id}.json"
                ).is_file()
                shadow_slot = variant["pairedShadowSlot"]
                shadow_exists = (
                    shadow_slot is None
                    or (
                        hd_root
                        / "shadow"
                        / (
                            f"{asset['id']}_s{shadow_slot}"
                            "_shadow_hd_v1.png"
                        )
                    ).is_file()
                )
                if body_exists and metadata_exists and shadow_exists:
                    completed_buildings += 1
        self.assertEqual(100, len(jobs))
        self.assertEqual(100, completed_buildings)
        job = jobs[0]
        self.assertTrue(Path(job["referenceAbsolute"]).is_file())
        self.assertEqual(
            [value * 2 for value in job["referenceSize"]],
            job["outputSize"],
        )
        self.assertEqual(
            "generated-body-derived",
            job["shadowMethod"],
        )
        self.assertIn(
            "ps-overcast-upper-left-v1",
            job["prompt"],
        )
        self.assertIn("screen upper-left", job["prompt"])
        self.assertIn("screen lower-right", job["prompt"])
        self.assertIn("BODY ONLY", job["prompt"])
        self.assertIn(
            "Never copy, trace, paste, recolor, scale, or reuse canonical "
            "shadow pixels",
            job["prompt"],
        )
        self.assertIn("#ff00ff", job["prompt"])

    def test_contact_sheet_renders_reference_pair(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(
            raised_hd_batch,
            "HD_DIR",
            Path(temp_dir) / "raised_hd",
        ):
            jobs = raised_hd_batch.pending_jobs(
                INVENTORY_PATH,
                {"large_prop"},
            )
            output = Path(temp_dir) / "raised.png"
            raised_hd_batch.make_contact(jobs[:1], output)
            with Image.open(output) as image:
                self.assertGreater(image.width, 0)
                self.assertGreater(image.height, 0)


if __name__ == "__main__":
    unittest.main()
