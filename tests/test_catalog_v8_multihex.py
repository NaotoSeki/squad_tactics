"""Pure-Python tests for the v8 multi-hex catalog extension."""

from __future__ import annotations

import contextlib
import copy
import importlib.util
import json
import shutil
import struct
import types
import unittest
import uuid
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "kb3d_forge" / "catalog_v8_build.py"
SPEC = importlib.util.spec_from_file_location("kb3d_catalog_v8_build", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
catalog_v8 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog_v8)


@contextlib.contextmanager
def writable_temp_dir():
    path = ROOT / "tmp" / ("catalog_v8_" + uuid.uuid4().hex)
    path.mkdir(parents=True)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def write_png_header(path: Path, width: int = 288, height: int = 384) -> None:
    """Write the bytes inspected by png_dimensions; pixel data is unnecessary."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
    )


def valid_asset(asset_id: str = "camp_a_d0") -> dict:
    return {
        "id": asset_id,
        "kind": "building",
        "world_scale": 1.0,
        "damage_stage": 0,
        "origin": {"q": 0, "r": 0},
        "pieces": [
            {"q": 0, "r": 0, "file": "camp_a_d0_q0_r0.png"},
            {"q": 1, "r": 0, "file": "camp_a_d0_q1_r0.png"},
        ],
        "occupied_cells": [
            {"q": 1, "r": 0},
            {"q": 0, "r": 0},
        ],
    }


class MultihexValidationTests(unittest.TestCase):
    def test_valid_asset_accepts_existing_and_planned_piece_files(self):
        with writable_temp_dir() as v8_dir:
            write_png_header(v8_dir / "camp_a_d0_q0_r0.png")

            normalized = catalog_v8.validate_multihex_assets(
                [valid_asset()], v8_dir
            )

        self.assertEqual(normalized[0]["world_scale"], 1.0)
        self.assertEqual(normalized[0]["origin"], {"q": 0, "r": 0})
        self.assertEqual(
            {(cell["q"], cell["r"]) for cell in normalized[0]["pieces"]},
            {(0, 0), (1, 0)},
        )

    def test_rejects_invalid_fields_cells_and_files(self):
        cases = []

        bad = valid_asset()
        bad["world_scale"] = 0.999
        cases.append(("scale", bad))

        bad = valid_asset()
        bad["pieces"][1]["q"] = 0
        cases.append(("duplicate piece cell", bad))

        bad = valid_asset()
        bad["pieces"][1]["file"] = bad["pieces"][0]["file"].upper()
        cases.append(("duplicate piece file", bad))

        bad = valid_asset()
        bad["occupied_cells"] = bad["occupied_cells"][:1]
        cases.append(("footprint mismatch", bad))

        bad = valid_asset()
        bad["origin"] = {"q": 9, "r": 9}
        cases.append(("origin outside footprint", bad))

        bad = valid_asset()
        bad["damage_stage"] = -1
        cases.append(("negative damage", bad))

        bad = valid_asset()
        bad["damage_stage"] = None
        cases.append(("null damage", bad))

        bad = valid_asset()
        bad["origin"]["q"] = True
        cases.append(("boolean coordinate", bad))

        bad = valid_asset()
        bad["pieces"][0]["file"] = "piece.jpg"
        cases.append(("non-PNG path", bad))

        bad = valid_asset()
        del bad["kind"]
        cases.append(("missing required field", bad))

        with writable_temp_dir() as v8_dir:
            for label, asset in cases:
                with self.subTest(label=label):
                    with self.assertRaises(ValueError):
                        catalog_v8.validate_multihex_assets([asset], v8_dir)

    def test_rejects_duplicate_ids_and_globally_reused_piece_files(self):
        first = valid_asset()
        duplicate_id = copy.deepcopy(first)
        with self.assertRaisesRegex(ValueError, "duplicate multihex asset id"):
            catalog_v8.validate_multihex_assets(
                [first, duplicate_id], ROOT / "tmp"
            )

        reused_files = copy.deepcopy(first)
        reused_files["id"] = "camp_b_d0"
        with self.assertRaisesRegex(ValueError, "claimed more than once"):
            catalog_v8.validate_multihex_assets(
                [first, reused_files], ROOT / "tmp"
            )

    def test_rejects_existing_piece_with_wrong_dimensions(self):
        with writable_temp_dir() as v8_dir:
            write_png_header(v8_dir / "camp_a_d0_q0_r0.png", 576, 384)
            with self.assertRaisesRegex(ValueError, "must be 288x384"):
                catalog_v8.validate_multihex_assets([valid_asset()], v8_dir)


class MultihexCatalogLoadingTests(unittest.TestCase):
    def test_manifest_priority_and_existing_catalog_preservation(self):
        with writable_temp_dir() as v8_dir:
            out_path = v8_dir / "catalog.json"
            default_path = v8_dir / catalog_v8.MULTIHEX_MANIFEST_NAME
            explicit_path = v8_dir / "explicit.json"

            default_asset = valid_asset("from_default")
            existing_asset = valid_asset("from_existing")
            explicit_asset = valid_asset("from_explicit")
            default_path.write_text(
                json.dumps({"multihex_assets": [default_asset]}),
                encoding="utf-8",
            )
            explicit_path.write_text(json.dumps([explicit_asset]), encoding="utf-8")
            out_path.write_text(
                json.dumps({"multihex_assets": [existing_asset]}),
                encoding="utf-8",
            )

            loaded = catalog_v8.load_multihex_assets(
                v8_dir, out_path, manifest_path=explicit_path
            )
            self.assertEqual(loaded[0]["id"], "from_explicit")

            loaded = catalog_v8.load_multihex_assets(v8_dir, out_path)
            self.assertEqual(loaded[0]["id"], "from_default")

            default_path.unlink()
            loaded = catalog_v8.load_multihex_assets(v8_dir, out_path)
            self.assertEqual(loaded[0]["id"], "from_existing")

    def test_main_emits_multihex_without_changing_legacy_tile_entries(self):
        with writable_temp_dir() as v8_dir:
            out_path = v8_dir / "catalog.json"
            asset = valid_asset()
            (v8_dir / catalog_v8.MULTIHEX_MANIFEST_NAME).write_text(
                json.dumps([asset]), encoding="utf-8"
            )
            write_png_header(v8_dir / "CAMP_A_D0_Q0_R0.PNG")
            write_png_header(v8_dir / "tree_tilia_v2_rot120.png")

            args = types.SimpleNamespace(
                v8_dir=str(v8_dir),
                out=str(out_path),
                multihex_manifest=None,
            )
            with mock.patch.object(catalog_v8, "parse_args", return_value=args):
                catalog_v8.main()

            payload = json.loads(out_path.read_text(encoding="utf-8"))

        self.assertEqual(payload["meta"]["count"], 1)
        self.assertEqual(payload["meta"]["multihex_count"], 1)
        self.assertEqual(
            [tile["file"] for tile in payload["tiles"]],
            ["tree_tilia_v2_rot120.png"],
        )
        self.assertEqual(payload["tiles"][0], catalog_v8.parse_tile(
            "tree_tilia_v2_rot120.png"
        ))
        self.assertEqual(payload["multihex_assets"][0]["id"], "camp_a_d0")


if __name__ == "__main__":
    unittest.main()
