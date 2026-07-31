from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

from ground_hd_quality import conspicuous_magenta_spill  # noqa: E402


HD_DIR = ROOT / "asset" / "environment" / "ground_hd"
MANIFEST_PATH = HD_DIR / "manifest.json"
INVENTORY_PATH = HD_DIR / "inventory.json"


class GroundHdSamplesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))

    def test_production_contract(self) -> None:
        self.assertEqual("production-complete", self.manifest["status"])
        self.assertEqual(2, self.manifest["pixelRatio"])
        self.assertEqual(0.5, self.manifest["runtimeRenderScale"])
        self.assertEqual(238, len(self.manifest["overrides"]))
        self.assertEqual(
            [item["id"] for item in self.inventory["assets"]],
            [item["id"] for item in self.manifest["overrides"]],
        )

    def test_outputs_are_exactly_two_x_reference_dimensions(self) -> None:
        for item in self.manifest["overrides"]:
            with self.subTest(asset=item["id"]):
                reference = Image.open(
                    (HD_DIR / item["reference"]).resolve()
                ).convert("RGBA")
                output = Image.open(HD_DIR / item["file"]).convert("RGBA")
                self.assertEqual(
                    (reference.width * 2, reference.height * 2),
                    output.size,
                )
                self.assertEqual(tuple(item["outputSize"]), output.size)

    def test_output_alpha_uses_canonical_ps_footprint(self) -> None:
        for item in self.manifest["overrides"]:
            with self.subTest(asset=item["id"]):
                reference = Image.open(
                    (HD_DIR / item["reference"]).resolve()
                ).convert("RGBA")
                expected = np.asarray(
                    reference.getchannel("A").resize(
                        tuple(item["outputSize"]),
                        Image.Resampling.LANCZOS,
                    )
                )
                actual = np.asarray(
                    Image.open(HD_DIR / item["file"]).convert("RGBA").getchannel("A")
                )
                np.testing.assert_array_equal(expected, actual)

    def test_outputs_have_no_magenta_spill(self) -> None:
        for item in self.manifest["overrides"]:
            with self.subTest(asset=item["id"]):
                output = Image.open(
                    HD_DIR / item["file"]
                ).convert("RGBA")
                rgba = np.asarray(output)
                canonical = np.asarray(
                    Image.open(
                        (HD_DIR / item["reference"]).resolve()
                    ).convert("RGBA").resize(
                        output.size,
                        Image.Resampling.LANCZOS,
                    )
                )
                magenta = conspicuous_magenta_spill(
                    rgba,
                    canonical,
                )
                self.assertEqual(
                    0,
                    int(np.count_nonzero(magenta)),
                )


if __name__ == "__main__":
    unittest.main()
