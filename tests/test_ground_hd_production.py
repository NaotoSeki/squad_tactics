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

import ground_hd_batch  # noqa: E402
import sync_ground_hd_manifest as manifest_sync  # noqa: E402
import validate_ground_hd_production as production  # noqa: E402


INVENTORY_PATH = (
    ROOT / "asset" / "environment" / "ground_hd" / "inventory.json"
)
MANIFEST_PATH = (
    ROOT / "asset" / "environment" / "ground_hd" / "manifest.json"
)


class GroundHdProductionTest(unittest.TestCase):
    def make_fixture(
        self,
        root: Path,
        *,
        output_alpha_delta: bool = False,
        magenta: bool = False,
        canonical_magenta: bool = False,
    ) -> tuple[Path, Path, Path]:
        hd_dir = root / "asset" / "environment" / "ground_hd"
        reference_dir = root / "scratch"
        docs_dir = root / "docs"
        hd_dir.mkdir(parents=True)
        reference_dir.mkdir(parents=True)
        docs_dir.mkdir(parents=True)

        reference_path = reference_dir / "tile_s0.png"
        reference = Image.new("RGBA", (3, 2), (80, 90, 60, 0))
        reference.putpixel((1, 0), (80, 90, 60, 255))
        reference.putpixel((1, 1), (90, 80, 50, 180))
        if canonical_magenta:
            reference.putpixel((1, 0), (230, 60, 210, 255))
        reference.save(reference_path)
        expected_alpha = reference.getchannel("A").resize(
            (6, 4),
            Image.Resampling.LANCZOS,
        )
        output = Image.new("RGBA", (6, 4), (70, 80, 50, 0))
        output.putalpha(expected_alpha)
        if output_alpha_delta:
            rgba = np.asarray(output).copy()
            rgba[0, 0, 3] = min(255, int(rgba[0, 0, 3]) + 1)
            output = Image.fromarray(rgba, "RGBA")
        if magenta:
            visible = np.argwhere(np.asarray(output)[:, :, 3] > 16)[0]
            y, x = (int(value) for value in visible)
            output.putpixel((x, y), (255, 0, 255, output.getpixel((x, y))[3]))
        if canonical_magenta:
            alpha = output.getpixel((2, 0))[3]
            output.putpixel((2, 0), (255, 0, 255, alpha))
        output.save(hd_dir / "tile_hd_v1.png")

        spec_path = docs_dir / "ASSET_LIGHTING_CONTRACT.md"
        spec_path.write_text(
            "ps-overcast-upper-left-v1 screen upper-left screen lower-right",
            encoding="utf-8",
        )
        inventory = {
            "schema": "ground-hd-inventory/v1",
            "summary": {"drawableCount": 1},
            "assets": [
                {
                    "id": "tile",
                    "family": "terrain",
                    "reference": "../../../scratch/tile_s0.png",
                    "referenceSize": [3, 2],
                    "canonicalSlot": 0,
                }
            ],
        }
        manifest = {
            "schemaVersion": 1,
            "status": "production-complete",
            "pixelRatio": 2,
            "runtimeRenderScale": 0.5,
            "lightingContract": {
                "id": "ps-overcast-upper-left-v1",
                "spec": "../../../docs/ASSET_LIGHTING_CONTRACT.md",
                "keyOrigin": "screen upper-left",
                "shadowDirection": "screen lower-right",
            },
            "generationDefinition": {
                "promptContract": [
                    (
                        "ps-overcast-upper-left-v1 screen upper-left "
                        "screen lower-right"
                    )
                ]
            },
            "inventory": {
                "file": "inventory.json",
                "schema": "ground-hd-inventory/v1",
                "assetCount": 1,
            },
            "overrides": [
                {
                    "id": "tile",
                    "family": "terrain",
                    "reference": "../../../scratch/tile_s0.png",
                    "generatedSource": "../../../tmp/ground_hd/tile_source.png",
                    "file": "tile_hd_v1.png",
                    "referenceSize": [3, 2],
                    "outputSize": [6, 4],
                    "canonicalSlot": 0,
                    "lightingContract": "ps-overcast-upper-left-v1",
                }
            ],
        }
        inventory_path = hd_dir / "inventory.json"
        manifest_path = hd_dir / "manifest.json"
        inventory_path.write_text(
            json.dumps(inventory, indent=2),
            encoding="utf-8",
        )
        manifest_path.write_text(
            json.dumps(manifest, indent=2),
            encoding="utf-8",
        )
        return inventory_path, manifest_path, hd_dir

    def validate_fixture(
        self,
        inventory_path: Path,
        manifest_path: Path,
        hd_dir: Path,
    ) -> dict:
        return production.validate_production(
            inventory_path,
            manifest_path,
            hd_dir,
            expected_asset_count=1,
        )

    def test_validator_accepts_exact_two_x_canonical_alpha(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            paths = self.make_fixture(Path(temp_dir))
            report = self.validate_fixture(*paths)
            self.assertTrue(report["ok"], report["issues"])
            self.assertEqual(1, report["validImageCount"])

    def test_validator_detects_alpha_and_magenta_regressions(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            paths = self.make_fixture(
                Path(temp_dir),
                output_alpha_delta=True,
                magenta=True,
            )
            report = self.validate_fixture(*paths)
            codes = {item["code"] for item in report["issues"]}
            self.assertIn("output.alpha.mismatch", codes)
            self.assertIn("output.magenta_spill", codes)

    def test_validator_preserves_canonical_magenta_flowers(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            paths = self.make_fixture(
                Path(temp_dir),
                canonical_magenta=True,
            )
            report = self.validate_fixture(*paths)
            self.assertTrue(report["ok"], report["issues"])

    def test_validator_detects_missing_output_and_lighting_reference(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            inventory_path, manifest_path, hd_dir = self.make_fixture(
                Path(temp_dir)
            )
            (hd_dir / "tile_hd_v1.png").unlink()
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["overrides"][0]["lightingContract"] = "wrong-light"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            report = self.validate_fixture(
                inventory_path,
                manifest_path,
                hd_dir,
            )
            codes = {item["code"] for item in report["issues"]}
            self.assertIn("output.not_found", codes)
            self.assertIn(
                "manifest.override.lightingContract.mismatch",
                codes,
            )

    def test_manifest_builder_covers_real_inventory_deterministically(self) -> None:
        inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        first = manifest_sync.build_manifest(
            inventory,
            manifest,
            INVENTORY_PATH,
            MANIFEST_PATH,
        )
        second = manifest_sync.build_manifest(
            inventory,
            manifest,
            INVENTORY_PATH,
            MANIFEST_PATH,
        )
        self.assertEqual(first, second)
        self.assertEqual(238, len(first["overrides"]))
        self.assertEqual(
            [item["id"] for item in inventory["assets"]],
            [item["id"] for item in first["overrides"]],
        )
        for item in first["overrides"]:
            self.assertEqual(
                "ps-overcast-upper-left-v1",
                item["lightingContract"],
            )
            self.assertEqual(
                [value * 2 for value in item["referenceSize"]],
                item["outputSize"],
            )

    def test_manifest_sync_validates_before_atomic_write(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            inventory_path, manifest_path, _ = self.make_fixture(Path(temp_dir))
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["status"] = "sample-checkpoint"
            manifest["overrides"] = []
            manifest_path.write_text(
                json.dumps(manifest, indent=2),
                encoding="utf-8",
            )

            candidate, changed = manifest_sync.sync_manifest(
                inventory_path,
                manifest_path,
                expected_asset_count=1,
            )
            self.assertTrue(changed)
            self.assertEqual("production-complete", candidate["status"])
            self.assertEqual(
                candidate,
                json.loads(manifest_path.read_text(encoding="utf-8")),
            )
            _, changed_again = manifest_sync.sync_manifest(
                inventory_path,
                manifest_path,
                check=True,
                expected_asset_count=1,
            )
            self.assertFalse(changed_again)

    def test_manifest_sync_does_not_write_when_validation_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            inventory_path, manifest_path, _ = self.make_fixture(
                Path(temp_dir),
                magenta=True,
            )
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["status"] = "sample-checkpoint"
            manifest["overrides"] = []
            manifest_path.write_text(
                json.dumps(manifest, indent=2),
                encoding="utf-8",
            )
            before = manifest_path.read_bytes()

            with self.assertRaisesRegex(ValueError, "refusing to publish"):
                manifest_sync.sync_manifest(
                    inventory_path,
                    manifest_path,
                    expected_asset_count=1,
                )
            self.assertEqual(before, manifest_path.read_bytes())

    def test_empty_pending_queue_writes_nonzero_contact_sheet(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "empty.png"
            ground_hd_batch.make_contact([], output)
            with Image.open(output) as image:
                self.assertGreater(image.width, 0)
                self.assertGreater(image.height, 0)


if __name__ == "__main__":
    unittest.main()
