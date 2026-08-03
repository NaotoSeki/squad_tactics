from __future__ import annotations

import json
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
HD_DIR = ROOT / "asset" / "environment" / "trees_hd"
PS_DIR = ROOT / "asset" / "environment" / "trees_ps"
MANIFEST_PATH = HD_DIR / "manifest.json"


class TreeHdShadowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.tree = cls.manifest["overrides"][0]
        cls.definition = cls.manifest["generationDefinition"]["postprocess"][
            "shadowDefinition"
        ]
        cls.shadow = Image.open(
            HD_DIR / Path(cls.tree["shadow"]).name
        ).convert("RGBA")
        cls.reference = Image.open(
            PS_DIR / Path(cls.definition["reference"]).name
        ).convert("RGBA")

    def test_shadow_dimensions_and_anchor_match_two_x_canonical(self) -> None:
        self.assertEqual((512, 256), self.shadow.size)
        self.assertEqual(0.41015625, self.tree["sox"])
        self.assertEqual(0.25, self.tree["soy"])
        self.assertEqual(0.5, self.tree["renderScale"])

    def test_shadow_coverage_matches_ps_reference(self) -> None:
        alpha = np.asarray(self.shadow.getchannel("A"))
        visible = alpha > 0
        self.assertEqual(76, int(alpha.max()))
        self.assertLessEqual(float(alpha[visible].mean()), 76.0)
        self.assertGreater(float(alpha[visible].mean()), 52.0)

    def test_shadow_is_generated_from_final_tree_not_reference_pixels(self) -> None:
        self.assertEqual(
            (
                "paired canonical BODY/SHADOW transform applied to final "
                "generated BODY; V4 light-only grade"
            ),
            self.definition["method"],
        )
        self.assertEqual(
            "shadow-v4-paired-transform",
            self.definition["version"],
        )
        self.assertTrue(self.definition["darkCoreRemoved"])
        self.assertEqual(52, self.definition["lightOnlyKneeAlpha"])
        self.assertEqual(76, self.definition["lightOnlyCapAlpha"])
        self.assertEqual(
            (
                "BODY-to-shadow transform calibration only; no canonical "
                "shadow pixels are copied"
            ),
            self.definition["referenceRole"],
        )
        self.assertEqual(
            "final generated BODY alpha and foliage luminance",
            self.definition["bodyAuthority"],
        )

        reference_support = np.asarray(
            self.reference.getchannel("A").resize(
                self.shadow.size,
                Image.Resampling.LANCZOS,
            )
        ) > 0
        generated_support = np.asarray(self.shadow.getchannel("A")) > 0
        self.assertFalse(np.array_equal(reference_support, generated_support))

    def test_generated_trunk_shadow_starts_at_anchor_and_casts_lower_right(self) -> None:
        alpha = np.asarray(self.shadow.getchannel("A"))
        anchor_x = round(self.tree["sox"] * self.shadow.width)
        anchor_y = round(self.tree["soy"] * self.shadow.height)
        contact = alpha[
            max(0, anchor_y - 3) : anchor_y + 8,
            max(0, anchor_x - 4) : anchor_x + 12,
        ]
        lower_right = alpha[
            anchor_y + 8 : min(self.shadow.height, anchor_y + 70),
            anchor_x + 4 : min(self.shadow.width, anchor_x + 80),
        ]
        self.assertGreater(int(contact.max()), 0)
        self.assertGreater(np.count_nonzero(lower_right), 50)

    def test_shadow_is_static_while_tree_sways(self) -> None:
        self.assertTrue(self.tree["sway"]["enabled"])
        self.assertEqual(
            "static; shares the trunk-base world anchor",
            self.definition["runtimeMotion"],
        )

if __name__ == "__main__":
    unittest.main()
