from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

import finalize_raised_hd_asset as finalizer  # noqa: E402
import raised_hd_pipeline as pipeline  # noqa: E402
import validate_raised_hd  # noqa: E402


INVENTORY = (
    ROOT / "asset" / "environment" / "raised_hd" / "inventory.json"
)
TREE_FIXTURE = (
    ROOT
    / "asset"
    / "environment"
    / "trees_hd"
    / "quercus-cerris_a_02_hd_v2.png"
)


class RaisedHdFinalizerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tree = Image.open(TREE_FIXTURE).convert("RGBA")

    def _normalized_fixture(
        self,
        asset_id: str,
        body_slot: int,
    ) -> tuple[dict, Image.Image, Image.Image, dict]:
        job = pipeline.find_job(INVENTORY, asset_id, body_slot)
        reference = Image.open(job["referenceAbsolute"]).convert("RGBA")
        body, _metrics = pipeline.normalize_body(
            self.tree,
            reference,
            job["origin"],
        )
        quality = pipeline.validate_body(body, reference, job["origin"])
        return job, reference, body, quality

    def test_four_families_keep_exact_canvas_origin_and_generated_alpha(self) -> None:
        fixtures = (
            ("german_village_barn_001_ver_01", 4, "building"),
            ("village_fence_frontage", 56, "fence"),
            ("barrel_001", 2, "large_prop"),
            ("bush_big_01", 2, "shrub"),
        )
        for asset_id, body_slot, family in fixtures:
            with self.subTest(asset=asset_id, slot=body_slot):
                job, reference, body, quality = self._normalized_fixture(
                    asset_id,
                    body_slot,
                )
                self.assertEqual(family, job["family"])
                self.assertEqual(
                    (reference.width * 2, reference.height * 2),
                    body.size,
                )
                self.assertLessEqual(quality["contactErrorPx"], 2.25)
                self.assertFalse(quality["canonicalAlphaIdentical"])
                canonical = reference.getchannel("A").resize(
                    body.size,
                    Image.Resampling.NEAREST,
                )
                self.assertFalse(
                    np.array_equal(
                        np.asarray(body.getchannel("A")),
                        np.asarray(canonical),
                    )
                )

    def test_shadow_is_body_derived_but_ps_calibrated(self) -> None:
        job, _reference, body, body_quality = self._normalized_fixture(
            "barrel_001",
            2,
        )
        canonical_shadow = Image.open(
            job["shadowReferenceAbsolute"]
        ).convert("RGBA")
        calibration = pipeline.calibrate_shadow(
            canonical_shadow,
            job["shadowOrigin"],
        )
        shadow, derivation = pipeline.synthesize_shadow(
            body,
            job["origin"],
            tuple(body_quality["contact"]),
            job["shadowOrigin"],
            calibration,
        )
        quality = pipeline.validate_shadow(
            shadow,
            canonical_shadow,
            tuple(derivation["shadowContact"]),
            calibration,
            derivation["projectionMatrix"],
        )
        self.assertEqual(
            (
                canonical_shadow.width * 2,
                canonical_shadow.height * 2,
            ),
            shadow.size,
        )
        self.assertEqual(calibration["targetBbox"], quality["bbox"])
        self.assertLessEqual(quality["contactErrorPx"], 3.0)
        self.assertGreater(quality["lowerRightProjectionPx"], 0)
        self.assertGreater(quality["lowerRightCastPerHeightPx"], 0)
        self.assertFalse(quality["canonicalPixelIdentical"])
        self.assertFalse(derivation["canonicalShadowPixelsCopied"])
        self.assertEqual(
            pipeline.alpha_sha256(body),
            derivation["bodyAlphaSha256"],
        )
        self.assertNotIn("pixels", calibration)
        self.assertTrue(calibration["forbiddenPixelReuse"])

    def test_wide_asset_contact_does_not_invalidate_lower_right_cast(self) -> None:
        job, _reference, body, body_quality = self._normalized_fixture(
            "village_fence_frontage",
            72,
        )
        canonical_shadow = Image.open(
            job["shadowReferenceAbsolute"]
        ).convert("RGBA")
        calibration = pipeline.calibrate_shadow(
            canonical_shadow,
            job["shadowOrigin"],
        )
        shadow, derivation = pipeline.synthesize_shadow(
            body,
            job["origin"],
            tuple(body_quality["contact"]),
            job["shadowOrigin"],
            calibration,
        )
        quality = pipeline.validate_shadow(
            shadow,
            canonical_shadow,
            tuple(derivation["shadowContact"]),
            calibration,
            derivation["projectionMatrix"],
        )
        self.assertLess(quality["lowerRightProjectionPx"], 0)
        self.assertGreater(quality["lowerRightCastPerHeightPx"], 0)

    def test_prone_or_flattened_state_remains_shadowless(self) -> None:
        job, reference, body, quality = self._normalized_fixture(
            "bush_big_01",
            1,
        )
        self.assertIsNone(job["pairedShadowSlot"])
        self.assertIsNone(job["shadowReferenceAbsolute"])
        self.assertEqual(
            (reference.width * 2, reference.height * 2),
            body.size,
        )
        self.assertLessEqual(quality["contactErrorPx"], 2.25)

    def test_actual_chroma_helper_cli_smoke_and_runtime_manifest(self) -> None:
        helper = finalizer.default_chroma_helper()
        self.assertTrue(helper.is_file())
        with tempfile.TemporaryDirectory() as temporary:
            temp = Path(temporary)
            generated = Image.new(
                "RGBA",
                self.tree.size,
                (255, 0, 255, 255),
            )
            generated.alpha_composite(self.tree)
            generated_path = temp / "built_in_fixture.png"
            generated.convert("RGB").save(generated_path)
            output_root = temp / "raised_hd"
            result = finalizer.finalize(
                inventory_path=INVENTORY,
                asset_id="barrel_001",
                body_slot=2,
                generated_path=generated_path,
                chroma_helper=helper,
                output_root=output_root,
                tmp_root=temp / "tmp",
            )
            self.assertTrue(Path(result["body"]).is_file())
            self.assertTrue(Path(result["shadow"]).is_file())
            self.assertTrue(Path(result["review"]).is_file())

            manifest = json.loads(
                (output_root / "manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual("raised-hd-manifest/v1", manifest["schema"])
            self.assertEqual(2, manifest["pixelRatio"])
            self.assertEqual("./", manifest["basePath"])
            body_entry = manifest["sprites"]["barrel_001_s2"]
            shadow_entry = manifest["sprites"]["barrel_001_s4"]
            self.assertEqual(-6, body_entry["ox"])
            self.assertEqual(-14, body_entry["oy"])
            self.assertEqual("barrel_001_s4", body_entry["pairedShadowKey"])
            self.assertEqual("barrel_001_s2", shadow_entry["derivedFrom"])

            audit = validate_raised_hd.validate_all(
                output_root=output_root,
                inventory_path=INVENTORY,
            )
            self.assertEqual("ok", audit["status"])
            self.assertEqual(1, audit["checkedBodies"])
            self.assertEqual(1, audit["checkedShadows"])
            self.assertFalse(audit["canonicalShadowPixelsCopied"])

            metadata = json.loads(
                Path(result["metadata"]).read_text(encoding="utf-8")
            )
            self.assertFalse(
                metadata["references"]["canonicalPixelsCopied"]
            )
            self.assertFalse(
                metadata["shadow"]["canonicalShadowPixelsCopied"]
            )
            self.assertEqual(
                metadata["body"]["alphaSha256"],
                metadata["shadow"]["bodyAlphaAuthority"],
            )


if __name__ == "__main__":
    unittest.main()
