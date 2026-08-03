from __future__ import annotations

import json
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / "asset" / "environment"
TREE_HD = ENV / "trees_hd"
PRODUCTION = TREE_HD / "production"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class TreeHdRuntimePackageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.canonical = read_json(ENV / "ps_objects" / "manifest.json")
        cls.runtime = read_json(PRODUCTION / "runtime_ps_manifest.json")
        cls.public = read_json(TREE_HD / "manifest.json")

    def test_map_priority_catalog_is_complete(self) -> None:
        self.assertEqual("production-complete", self.runtime["status"])
        self.assertEqual(116, len(self.runtime["sprites"]))
        self.assertEqual(
            "static; shares the trunk-base world anchor",
            self.runtime["animationContract"]["shadow"],
        )
        self.assertEqual(
            {
                "enabled": True,
                "angleDeg": 0.42,
                "scaleX": 0.0035,
                "durationMs": 4200,
            },
            self.runtime["animationContract"]["sway"],
        )

    def test_every_runtime_slot_preserves_origin_and_exact_two_x_size(self) -> None:
        for key, meta in self.runtime["sprites"].items():
            canonical = self.canonical["sprites"][key]
            self.assertEqual(canonical["ox"], meta["ox"], key)
            self.assertEqual(canonical["oy"], meta["oy"], key)
            self.assertEqual(2, meta["pixelRatio"], key)
            path = PRODUCTION / meta["file"]
            self.assertTrue(path.is_file(), path)
            with Image.open(path) as image:
                self.assertEqual(
                    (canonical["w"] * 2, canonical["h"] * 2),
                    image.size,
                    key,
                )

    def test_approved_sample_stays_first_and_all_overrides_sway(self) -> None:
        overrides = self.public["overrides"]
        self.assertEqual(38, len(overrides))
        self.assertEqual("quercus-cerris_a_02", overrides[0]["id"])
        for tree in overrides:
            self.assertEqual(0.5, tree["renderScale"], tree["id"])
            self.assertTrue(tree["sway"]["enabled"], tree["id"])
            self.assertEqual(0.42, tree["sway"]["angleDeg"], tree["id"])
            body = ENV / "trees_ps" / tree["body"]
            shadow = ENV / "trees_ps" / tree["shadow"]
            self.assertTrue(body.resolve().is_file(), body)
            self.assertTrue(shadow.resolve().is_file(), shadow)

    def test_all_map_tree_slots_resolve_to_runtime_hd(self) -> None:
        tree_ids: set[str] = set()
        placements = 0
        maps_dir = ENV / "maps"
        for ledger_path in maps_dir.glob("ps_seed_*_objects.json"):
            ledger = read_json(ledger_path)
            for spec in ledger.get("objects", []):
                if spec.get("family") != "tree":
                    continue
                tree_ids.add(str(spec["asset"]))
                placements += 1
                body_key = f"{spec['asset']}_s{spec['body_slot']}"
                shadow_key = f"{spec['asset']}_s{spec['shadow_slot']}"
                self.assertIn(body_key, self.runtime["sprites"])
                self.assertIn(shadow_key, self.runtime["sprites"])
        self.assertEqual(58, len(tree_ids))
        self.assertEqual(317, placements)

    def test_production_tree_shadows_use_v4_light_only_projection(self) -> None:
        banding_scores: list[float] = []
        parity_scores: list[float] = []
        for metadata_path in sorted((PRODUCTION / "metadata").glob("*.json")):
            metadata = read_json(metadata_path)
            derivation = metadata["shadow"]["derivation"]
            self.assertEqual(
                "shadow-v4-paired-transform",
                derivation["version"],
                metadata["jobId"],
            )
            self.assertTrue(derivation["darkCoreRemoved"], metadata["jobId"])
            self.assertEqual(52, derivation["lightOnlyKneeAlpha"])
            self.assertEqual(76, derivation["lightOnlyCapAlpha"])
            self.assertFalse(derivation["canonicalShadowPixelsCopied"])
            self.assertEqual(
                "shadow-v4-light-only",
                metadata["shadow"]["quality"]["contract"],
            )
            parity_scores.append(
                float(metadata["shadow"]["quality"]["parityBias"])
            )
            shadow_path = PRODUCTION / metadata["outputs"]["shadow"]
            with Image.open(shadow_path).convert("RGBA") as shadow:
                alpha = (
                    np.asarray(shadow.getchannel("A"), dtype=np.float32)
                    / 255.0
                )
                bbox = shadow.getchannel("A").getbbox()
                self.assertIsNotNone(bbox, metadata["jobId"])
                crop = alpha[bbox[1]:bbox[3], bbox[0]:bbox[2]]
                score = float(
                    np.mean(
                        np.abs(np.diff(np.diff(crop, axis=0), axis=0))
                    )
                )
                banding_scores.append(score)
                self.assertEqual(76, int(np.max(alpha * 255.0)))
        self.assertEqual(57, len(banding_scores))
        self.assertLess(max(banding_scores), 0.02)
        self.assertLess(float(np.mean(banding_scores)), 0.008)
        self.assertLess(max(parity_scores), 0.04)


if __name__ == "__main__":
    unittest.main()
