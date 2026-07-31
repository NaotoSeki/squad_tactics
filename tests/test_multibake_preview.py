"""Pure layout tests for the deterministic multi-hex review compositor."""

from __future__ import annotations

import importlib.util
import math
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "kb3d_forge" / "multibake_preview.py"
SPEC = importlib.util.spec_from_file_location("multibake_preview", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
preview = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preview)


def manifest():
    return {
        "kind": "multihex",
        "projection": {
            "resolution_px": [288, 384],
            "anchor_px": [144.0, 234.5],
            "hex_radius_m": 9.0,
            "px_per_m": 288.0 / 20.25,
        },
        "pieces": [
            {"offset": {"q": 0, "r": 0}, "file": "a.png"},
            {"offset": {"q": 1, "r": 0}, "file": "b.png"},
            {"offset": {"q": 0, "r": 1}, "file": "c.png"},
        ],
    }


class MultiBakePreviewTests(unittest.TestCase):
    def test_axial_pixel_centers_match_hexkit_contract(self):
        density = 288.0 / 20.25
        x, y = preview.piece_center_px(
            1, 0, hex_radius_m=9.0, px_per_m=density
        )
        self.assertTrue(math.isclose(x, math.sqrt(3.0) * 9.0 * density))
        self.assertEqual(y, 0.0)

        x, y = preview.piece_center_px(
            0, 1, hex_radius_m=9.0, px_per_m=density
        )
        self.assertTrue(math.isclose(x, math.sqrt(3.0) * 4.5 * density))
        self.assertEqual(y, 1.5 * 9.0 * density)

    def test_layout_is_deterministic_and_has_unique_destinations(self):
        first = preview.preview_layout(manifest())
        second = preview.preview_layout(manifest())
        self.assertEqual(first, second)
        size, pieces = first
        self.assertGreater(size[0], 288)
        self.assertGreater(size[1], 384)
        self.assertEqual(len({piece["dest"] for piece in pieces}), 3)
        self.assertEqual([piece["file"] for piece in pieces], ["a.png", "b.png", "c.png"])

    def test_rejects_duplicate_cells(self):
        payload = manifest()
        payload["pieces"][1]["offset"] = {"q": 0, "r": 0}
        with self.assertRaisesRegex(ValueError, "duplicate piece cell"):
            preview.preview_layout(payload)


if __name__ == "__main__":
    unittest.main()
