from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from scripts import gen_ps_seed_map


ROOT = Path(__file__).resolve().parents[1]
GROUND_HD_MANIFEST = ROOT / "asset" / "environment" / "ground_hd" / "manifest.json"
MAPS_DIR = ROOT / "asset" / "environment" / "maps"


class PsSeedGroundHdTest(unittest.TestCase):
    def run_generator(self, *arguments: str) -> None:
        argv = ["gen_ps_seed_map.py", *arguments]
        with patch.object(sys, "argv", argv), redirect_stdout(io.StringIO()):
            gen_ps_seed_map.main()

    @unittest.skipUnless(
        (MAPS_DIR / "ps_seed_3101.png").is_file(),
        "canonical seed 3101 fixture is unavailable",
    )
    def test_default_mode_is_byte_identical_to_existing_seed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir)
            self.run_generator("--seed", "3101", "--out-dir", str(output))

            for suffix in (".png", ".json", "_objects.json"):
                with self.subTest(suffix=suffix):
                    expected = MAPS_DIR / f"ps_seed_3101{suffix}"
                    actual = output / f"ps_seed_3101{suffix}"
                    self.assertEqual(expected.read_bytes(), actual.read_bytes())

    @unittest.skipUnless(
        GROUND_HD_MANIFEST.is_file()
        and (MAPS_DIR / "ps_seed_3101_objects.json").is_file(),
        "ground HD sample or canonical seed fixture is unavailable",
    )
    def test_opt_in_hd_mode_uses_physical_background_and_logical_object_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir)
            self.run_generator(
                "--seed",
                "3101",
                "--ground-hd-manifest",
                str(GROUND_HD_MANIFEST),
                "--pixel-ratio",
                "2",
                "--out-dir",
                str(output),
            )

            stem = "ps_seed_3101_ground_hd_x2"
            image_path = output / f"{stem}.png"
            metadata = json.loads(
                (output / f"{stem}.json").read_text(encoding="utf-8")
            )
            objects = json.loads(
                (output / f"{stem}_objects.json").read_text(encoding="utf-8")
            )

            with Image.open(image_path) as image:
                self.assertEqual((1240, 1240), image.size)
            self.assertFalse((output / "ps_seed_3101.png").exists())

            self.assertEqual(2, metadata["pixel_ratio"])
            self.assertEqual((1240, 1240), (
                metadata["image_width"],
                metadata["image_height"],
            ))
            self.assertEqual((620, 620), (
                metadata["logical_image_width"],
                metadata["logical_image_height"],
            ))
            self.assertAlmostEqual(0.42, metadata["projection"]["scale"])
            self.assertAlmostEqual(0.84, metadata["projection"]["logical_scale"])
            self.assertGreater(metadata["audit"]["ground_hd_overrides_drawn"], 0)
            self.assertEqual(0, metadata["audit"]["ground_hd_fallbacks_drawn"])

            self.assertAlmostEqual(0.84, objects["projection"]["scale"])
            self.assertEqual((620, 620), (
                objects["image_width"],
                objects["image_height"],
            ))
            self.assertEqual(2, objects["background_pixel_ratio"])
            self.assertTrue(objects["objects"])
            canonical_objects = json.loads(
                (MAPS_DIR / "ps_seed_3101_objects.json").read_text(encoding="utf-8")
            )
            self.assertEqual(canonical_objects["objects"], objects["objects"])

            registry_source = (output / "ps_battlefields.js").read_text(
                encoding="utf-8"
            )
            registry_json = registry_source.split(
                "window.PS_BATTLEFIELDS = ", 1
            )[1].rsplit(";", 1)[0]
            registry = json.loads(registry_json)
            entry = registry[stem]
            self.assertEqual(2, entry["pixelRatio"])
            self.assertEqual((620, 620), (
                entry["imageWidth"],
                entry["imageHeight"],
            ))
            self.assertAlmostEqual(0.84, entry["projection"]["scale"])

    @unittest.skipUnless(
        GROUND_HD_MANIFEST.is_file(),
        "ground HD sample manifest is unavailable",
    )
    def test_manifest_ratio_must_match_explicit_pixel_ratio(self) -> None:
        with self.assertRaisesRegex(ValueError, "does not match"):
            gen_ps_seed_map.GroundHdCatalog(GROUND_HD_MANIFEST, 1)


if __name__ == "__main__":
    unittest.main()
