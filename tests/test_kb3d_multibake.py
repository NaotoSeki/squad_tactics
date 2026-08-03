"""Lightweight pure-Python tests for the KB3D multi-hex foundation."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
import unittest
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "kb3d_forge" / "multibake.py"
SPEC = importlib.util.spec_from_file_location("kb3d_multibake", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
multibake = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = multibake
SPEC.loader.exec_module(multibake)


class MultiBakeGeometryTests(unittest.TestCase):
    def test_hexkit_contract_is_55_degree_288_by_384(self):
        self.assertEqual(multibake.CAMERA_ELEVATION_DEG, 55.0)
        self.assertEqual(multibake.HEX_RADIUS_M, 9.0)
        self.assertEqual(multibake.CAMERA_HEX_CLIP_OVERLAP_M, 0.125)
        self.assertGreaterEqual(multibake.CAMERA_HEX_CLIP_OVERLAP_M, 0.10)
        self.assertLessEqual(multibake.CAMERA_HEX_CLIP_OVERLAP_M, 0.15)
        self.assertEqual(multibake.ORTHO_SCALE_M, 20.25)
        self.assertEqual(
            (multibake.RENDER_WIDTH_PX, multibake.RENDER_HEIGHT_PX),
            (288, 384),
        )
        self.assertTrue(math.isclose(
            multibake.PIXEL_ASPECT_X,
            1.0 / math.sin(math.radians(55.0)),
        ))

    def test_scale_is_exactly_one_and_near_one_is_rejected(self):
        self.assertEqual(multibake.require_unit_scale(1.0), (1.0, 1.0, 1.0))
        self.assertEqual(
            multibake.require_unit_scale((1.0, 1.0, 1.0)),
            (1.0, 1.0, 1.0),
        )
        for invalid in (0.999999, 1.000001, (1.0, 1.0, 0.999999), True):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    multibake.require_unit_scale(invalid)

    def test_axial_world_round_trip_and_sixty_degree_rotation(self):
        for q in range(-3, 4):
            for r in range(-3, 4):
                cell = multibake.AxialCell(q, r)
                self.assertEqual(
                    multibake.world_to_axial(*multibake.axial_to_world(cell)),
                    cell,
                )
                for steps in range(6):
                    rotated = multibake.rotate_axial(cell, steps)
                    self.assertEqual(
                        multibake.rotate_axial(rotated, -steps), cell)
                    source_x, source_y = multibake.axial_to_world(cell)
                    rotated_x, rotated_y = multibake.axial_to_world(rotated)
                    angle = math.radians(60.0 * steps)
                    self.assertAlmostEqual(
                        rotated_x,
                        source_x * math.cos(angle) - source_y * math.sin(angle),
                    )
                    self.assertAlmostEqual(
                        rotated_y,
                        source_x * math.sin(angle) + source_y * math.cos(angle),
                    )
        source = multibake.AxialCell(1, 0)
        rotated = multibake.rotate_axial(source, 1)
        self.assertEqual(rotated, multibake.AxialCell(1, -1))

    def test_positive_r_maps_to_negative_world_y_and_occupancy(self):
        radius = multibake.HEX_RADIUS_M
        cell = multibake.AxialCell(0, 1)
        center_x, center_y = multibake.axial_to_world(cell)
        self.assertAlmostEqual(center_x, math.sqrt(3.0) * radius * 0.5)
        self.assertAlmostEqual(center_y, -1.5 * radius)
        self.assertLess(center_y, 0.0)
        self.assertEqual(multibake.world_to_axial(center_x, center_y), cell)
        stage_x, stage_y, stage_z = multibake.stage_offset_for_cell(cell)
        self.assertAlmostEqual((center_x + stage_x), 0.0)
        self.assertAlmostEqual(stage_y, 1.5 * radius)
        self.assertEqual(stage_z, 0.0)
        self.assertEqual(
            multibake.occupied_cells_from_bounds((
                center_x - 0.1,
                center_x + 0.1,
                center_y - 0.1,
                center_y + 0.1,
            )),
            (cell,),
        )

    def test_world_bounds_find_one_cell_then_east_neighbor(self):
        one = multibake.occupied_cells_from_bounds((-0.1, 0.1, -0.1, 0.1))
        self.assertEqual(one, (multibake.AxialCell(0, 0),))

        east_x, east_y = multibake.axial_to_world(multibake.AxialCell(1, 0))
        two = multibake.occupied_cells_from_bounds(
            (-0.1, east_x + 0.1, -0.1, east_y + 0.1)
        )
        self.assertEqual(
            two,
            (multibake.AxialCell(0, 0), multibake.AxialCell(1, 0)),
        )

    def test_stage_offset_moves_each_cell_center_to_origin(self):
        for cell in (
            multibake.AxialCell(0, 0),
            multibake.AxialCell(2, -1),
            multibake.AxialCell(-3, 4),
        ):
            center = multibake.axial_to_world(cell)
            offset = multibake.stage_offset_for_cell(cell)
            self.assertAlmostEqual(center[0] + offset[0], 0.0)
            self.assertAlmostEqual(center[1] + offset[1], 0.0)
            self.assertEqual(offset[2], 0.0)

    def test_pointy_hex_clip_assigns_only_the_staged_owner_cell(self):
        radius = multibake.HEX_RADIUS_M
        half_width = math.sqrt(3.0) * radius * 0.5
        self.assertTrue(multibake.point_in_pointy_hex(0.0, 0.0))
        self.assertTrue(multibake.point_in_pointy_hex(0.0, radius - 1.0e-6))
        self.assertTrue(multibake.point_in_pointy_hex(
            half_width - 1.0e-6, 0.0))
        # Logical ownership remains strict; camera clipping expands separately.
        self.assertFalse(multibake.point_in_pointy_hex(0.0, radius))
        self.assertFalse(multibake.point_in_pointy_hex(half_width, 0.0))

        overlap = multibake.CAMERA_HEX_CLIP_OVERLAP_M
        horizontal_limit, diagonal_limit = multibake.pointy_hex_clip_limits(
            radius, overlap=overlap)
        self.assertAlmostEqual(horizontal_limit, half_width + overlap)
        self.assertAlmostEqual(diagonal_limit, radius + overlap)
        self.assertTrue(multibake.point_in_camera_clip_hex(0.0, radius))
        self.assertTrue(multibake.point_in_camera_clip_hex(half_width, 0.0))
        self.assertTrue(multibake.point_in_camera_clip_hex(
            0.0, radius + overlap * 0.5))
        self.assertTrue(multibake.point_in_camera_clip_hex(
            half_width + overlap * 0.5, 0.0))
        self.assertFalse(multibake.point_in_camera_clip_hex(
            0.0, radius + overlap))
        self.assertFalse(multibake.point_in_camera_clip_hex(
            half_width + overlap, 0.0))

        neighbors = (
            multibake.AxialCell(1, 0),
            multibake.AxialCell(1, -1),
            multibake.AxialCell(0, -1),
            multibake.AxialCell(-1, 0),
            multibake.AxialCell(-1, 1),
            multibake.AxialCell(0, 1),
        )
        for neighbor in neighbors:
            neighbor_x, neighbor_y = multibake.axial_to_world(neighbor)
            self.assertFalse(multibake.point_in_camera_clip_hex(
                neighbor_x, neighbor_y))
        with self.assertRaises(ValueError):
            multibake.point_in_pointy_hex(0.0, 0.0, overlap=-0.001)

        cells = (
            multibake.AxialCell(0, 0),
            multibake.AxialCell(1, 0),
            multibake.AxialCell(0, 1),
        )
        for target in cells:
            offset_x, offset_y, _ = multibake.stage_offset_for_cell(target)
            visible_sources = []
            for source in cells:
                source_x, source_y = multibake.axial_to_world(source)
                if multibake.point_in_pointy_hex(
                    source_x + offset_x,
                    source_y + offset_y,
                ):
                    visible_sources.append(source)
            self.assertEqual(
                visible_sources,
                [target],
                "a staged piece must not repeat adjacent-cell geometry",
            )


class MultiBakeManifestTests(unittest.TestCase):
    def test_manifest_has_atomic_offsets_and_deterministic_filenames(self):
        cells = [multibake.AxialCell(1, 0), multibake.AxialCell(0, 0)]
        entry = multibake.build_manifest_entry(
            "Camp A",
            (-1.0, 17.0, -1.0, 1.0, 0.0, 8.0),
            cells=cells,
        )
        self.assertEqual(entry["schema"], "squad-tactics.multibake/v1")
        self.assertEqual(entry["id"], "camp_a")
        self.assertTrue(entry["atomic"])
        self.assertEqual(entry["scale"], 1.0)
        self.assertEqual(entry["world_scale"], 1.0)
        self.assertEqual(entry["piece_count"], 2)
        self.assertEqual(entry["base_cell"], {"q": 1, "r": 0})
        self.assertEqual(entry["origin"], {"q": 1, "r": 0})
        self.assertEqual(
            [piece["file"] for piece in entry["pieces"]],
            [
                "camp_a__qp000_rp000_rot0.png",
                "camp_a__qp001_rp000_rot0.png",
            ],
        )
        self.assertEqual(
            [(piece["q"], piece["r"], piece["file"])
             for piece in entry["pieces"]],
            [
                (0, 0, "camp_a__qp000_rp000_rot0.png"),
                (1, 0, "camp_a__qp001_rp000_rot0.png"),
            ],
        )
        self.assertEqual(entry["pieces"][0]["offset"], {"q": -1, "r": 0})
        self.assertEqual(entry["pieces"][1]["offset"], {"q": 0, "r": 0})

    def test_manifest_json_is_byte_deterministic(self):
        entry = multibake.build_manifest_entry(
            "residential-e",
            (-0.2, 0.2, -0.2, 0.2, 0.0, 6.0),
        )
        review_dir = ROOT / "scratch" / "kb3d_review"
        token = uuid.uuid4().hex
        first = review_dir / (".multibake_test_%s_first.json" % token)
        second = review_dir / (".multibake_test_%s_second.json" % token)
        try:
            multibake.write_manifest(first, entry)
            multibake.write_manifest(second, entry)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            loaded = json.loads(first.read_text(encoding="utf-8"))
            self.assertEqual(loaded, entry)
        finally:
            first.unlink(missing_ok=True)
            second.unlink(missing_ok=True)

    def test_manifest_rejects_rescale(self):
        with self.assertRaises(ValueError):
            multibake.build_manifest_entry(
                "camp",
                (-1.0, 1.0, -1.0, 1.0),
                scale=0.55,
            )


if __name__ == "__main__":
    unittest.main()
