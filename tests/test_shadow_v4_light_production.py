from __future__ import annotations

import json
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / "asset" / "environment"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class ShadowV4LightProductionTest(unittest.TestCase):
    def test_raised_and_tree_catalogs_use_light_only_contract(self) -> None:
        catalogs = (
            (ENV / "raised_hd", 252),
            (ENV / "trees_hd" / "production", 57),
        )
        for catalog, expected in catalogs:
            with self.subTest(catalog=catalog.name):
                manifest = read_json(catalog / "manifest.json")
                policy = manifest["shadowPolicy"]
                self.assertEqual(
                    "paired-canonical-body-transform-v4-light-only",
                    policy["method"],
                )
                self.assertEqual(
                    "shadow-v4-paired-transform",
                    policy["version"],
                )
                self.assertTrue(policy["darkCoreRemoved"])
                self.assertEqual(52, policy["lightOnlyKneeAlpha"])
                self.assertEqual(76, policy["lightOnlyCapAlpha"])
                self.assertFalse(policy["canonicalShadowPixelsCopied"])

                checked = 0
                for metadata_path in sorted(
                    (catalog / "metadata").glob("*.json")
                ):
                    metadata = read_json(metadata_path)
                    if metadata["pairedShadowSlot"] is None:
                        continue
                    derivation = metadata["shadow"]["derivation"]
                    quality = metadata["shadow"]["quality"]
                    self.assertEqual(
                        "shadow-v4-paired-transform",
                        derivation["version"],
                        metadata["jobId"],
                    )
                    self.assertTrue(
                        derivation["darkCoreRemoved"],
                        metadata["jobId"],
                    )
                    self.assertEqual(76, quality["maxAlpha"])
                    self.assertEqual(
                        "shadow-v4-light-only",
                        quality["contract"],
                    )
                    shadow_path = catalog / metadata["outputs"]["shadow"]
                    with Image.open(shadow_path).convert("RGBA") as shadow:
                        self.assertEqual(
                            76,
                            shadow.getchannel("A").getextrema()[1],
                            metadata["jobId"],
                        )
                    checked += 1
                self.assertEqual(expected, checked)

    def test_approved_tree_sample_uses_same_contract(self) -> None:
        tree_root = ENV / "trees_hd"
        metadata = read_json(
            tree_root / "quercus-cerris_a_02_shadow_hd_v4_light.json"
        )
        self.assertEqual(
            "approved-tree-shadow/v4-light",
            metadata["schema"],
        )
        self.assertTrue(metadata["derivation"]["darkCoreRemoved"])
        self.assertEqual(76, metadata["quality"]["maxAlpha"])
        self.assertFalse(metadata["canonicalShadowPixelsCopied"])

        manifest = read_json(tree_root / "manifest.json")
        definition = manifest["generationDefinition"]["postprocess"][
            "shadowDefinition"
        ]
        self.assertEqual(
            "shadow-v4-paired-transform",
            definition["version"],
        )
        self.assertTrue(definition["darkCoreRemoved"])
        self.assertEqual(76, definition["lightOnlyCapAlpha"])


if __name__ == "__main__":
    unittest.main()
