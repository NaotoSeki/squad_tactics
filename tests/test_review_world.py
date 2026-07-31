"""Pure-Python checks for the deterministic Round-1 Blender world builder."""

from __future__ import annotations

import importlib.util
import inspect
import math
import subprocess
import sys
import unittest
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "kb3d_forge" / "review_world.py"
MANIFEST_PATH = ROOT / "scripts" / "kb3d_forge" / "review_scene_round1.json"

SPEC = importlib.util.spec_from_file_location("kb3d_review_world", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
review_world = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = review_world
SPEC.loader.exec_module(review_world)


class ReviewWorldPlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = review_world.load_manifest(MANIFEST_PATH)
        cls.plan = review_world.build_world_plan(MANIFEST_PATH)

    @classmethod
    def feature(cls, feature_type, *, role=None, context=None):
        return next(
            feature
            for feature in cls.manifest["features"]
            if feature["type"] == feature_type
            and (role is None or feature.get("role") == role)
            and (context is None or feature.get("context") == context)
        )

    def test_plan_is_fixed_rot0_and_follows_manifest_footprints(self):
        plan = self.plan
        self.assertEqual(30, len(plan.cells))
        self.assertEqual(0, plan.rotation_deg)
        expected = {
            role: tuple(self.feature("multihex_cluster", role=role)["cells"])
            for role in ("camp", "farmstead")
        }
        self.assertEqual(
            expected,
            {item.role: item.cell_ids for item in plan.reserved_footprints},
        )
        self.assertEqual(
            review_world._manifest_digest(self.manifest), plan.manifest_sha256
        )

    def test_ground_is_one_connected_shared_vertex_rectangle(self):
        mesh = review_world.build_ground_mesh_data(self.plan, step_m=3.0)
        self.assertGreater(len(mesh.vertices), 900)
        self.assertGreaterEqual(len(mesh.faces), 900)
        self.assertEqual(len(mesh.faces), len(mesh.material_indices))
        self.assertEqual({0, 1, 2, 3}, set(mesh.material_indices))
        adjacency = defaultdict(set)
        for face in mesh.faces:
            for left, right in zip(face, face[1:] + face[:1]):
                adjacency[left].add(right)
                adjacency[right].add(left)
        visited = {0}
        frontier = [0]
        while frontier:
            current = frontier.pop()
            for neighbor in adjacency[current] - visited:
                visited.add(neighbor)
                frontier.append(neighbor)
        self.assertEqual(len(mesh.vertices), len(visited))

    def test_review_palette_lighting_and_faint_hex_overlay_are_deterministic(self):
        palette = review_world.REVIEW_PALETTE_SRGB
        self.assertEqual(
            {
                "grass", "worn", "field", "edge", "shoulder", "road",
                "rut", "row", "crop", "bank", "leaf", "leaf_dark",
                "bark", "crater_road", "crater_field", "hex_line",
            },
            set(palette),
        )
        self.assertAlmostEqual(
            0.21404114048223255,
            review_world.srgb_channel_to_linear(0.5),
            places=12,
        )
        self.assertLess(sum(palette["field"][:3]), sum(palette["grass"][:3]))
        self.assertGreater(sum(palette["road"][:3]), sum(palette["grass"][:3]))
        self.assertGreater(palette["crop"][0], palette["crop"][2] * 4.0)
        self.assertGreater(palette["crop"][1], palette["crop"][2] * 4.0)
        self.assertLess(palette["leaf_dark"][1], palette["grass"][1])
        self.assertLess(review_world.REVIEW_SUN_ENERGY, 3.0)
        self.assertGreaterEqual(review_world.REVIEW_WORLD_STRENGTH, 0.35)
        self.assertLessEqual(review_world.REVIEW_WORLD_STRENGTH, 0.5)
        self.assertGreater(review_world.REVIEW_EXPOSURE, 0.5)
        self.assertLess(review_world.REVIEW_EXPOSURE, 1.5)
        self.assertGreater(sum(palette["rut"][:3]), 0.20)

        first = review_world.build_hex_overlay_mesh_data(self.plan)
        second = review_world.build_hex_overlay_mesh_data(self.plan)
        self.assertEqual(first, second)
        self.assertEqual(111, len(first.faces))
        self.assertEqual(4 * len(first.faces), len(first.vertices))
        self.assertEqual({0}, set(first.material_indices))
        self.assertLessEqual(review_world.REVIEW_HEX_LINE_WIDTH_M, 0.08)
        outside = review_world.Point2(
            self.plan.ground_bounds.min_x + 0.01,
            self.plan.ground_bounds.min_y + 0.01,
        )
        self.assertEqual(3, review_world._ground_material_index(self.plan, outside))
        parsed = review_world._parse_args(["--no-hex-overlay"])
        self.assertTrue(parsed.no_hex_overlay)

    def test_road_samples_manifest_path_as_one_smooth_ribbon(self):

        feature = self.feature("road_spline")
        road = self.plan.road
        self.assertEqual(tuple(feature["cell_path"]), road.cell_ids)
        self.assertEqual((len(road.cell_ids) + 1) * 12 + 1, len(road.samples))
        self.assertEqual(float(feature["surface"]["width_m"]), road.width_m)
        self.assertEqual(float(feature["surface"]["shoulder_m"]), road.shoulder_m)
        self.assertEqual(2, len(road.rut_offsets_m))
        for cell_point in road.cell_points:
            self.assertAlmostEqual(
                0.0,
                min(
                    review_world.distance(cell_point, sample)
                    for sample in road.samples
                ),
                places=9,
            )
        self.assertGreater(
            review_world.distance(road.samples[0], road.cell_points[0]), 9.9
        )
        self.assertGreater(
            review_world.distance(road.samples[-1], road.cell_points[-1]), 9.9
        )
        self.assertLess(
            max(
                review_world.distance(left, right)
                for left, right in zip(road.samples, road.samples[1:])
            ),
            1.9,
        )

    def test_field_rows_follow_manifest_and_break_only_for_crater(self):
        field = self.plan.field
        feature = self.feature("raised_field_parcel")
        self.assertEqual(tuple(feature["cells"]), field.cell_ids)
        self.assertEqual(float(feature["row_bearing_deg"]), field.bearing_deg)
        self.assertEqual(float(feature["row_spacing_m"]), field.row_spacing_m)
        self.assertEqual(float(feature["row_height_m"]), field.row_height_m)
        self.assertGreater(field.row_count, 20)
        self.assertGreater(len(field.crop_stalks), field.row_count * 20)
        offsets = [row.offset_m for row in field.rows]
        for left, right in zip(offsets, offsets[1:]):
            self.assertAlmostEqual(field.row_spacing_m, right - left, places=8)
        for row in field.rows:
            angle = math.degrees(
                math.atan2(row.end.y - row.start.y, row.end.x - row.start.x)
            )
            self.assertAlmostEqual(field.bearing_deg, angle, places=8)
        pieces_by_row = defaultdict(int)
        for segment in field.visible_segments:
            pieces_by_row[segment.row_index] += 1
        self.assertGreaterEqual(sum(count == 2 for count in pieces_by_row.values()), 1)
        crater = next(item for item in self.plan.craters if item.context == "field")
        self.assertTrue(all(
            review_world.crater_normalized_radius(stalk.point, crater) >= 1.04
            for stalk in field.crop_stalks
        ))

    def test_hedge_is_one_bank_with_non_blob_foliage(self):
        hedge = self.plan.hedge
        feature = self.feature("hedgerow_wood_edge")
        self.assertEqual(tuple(feature["cell_path"]), hedge.cell_ids)
        self.assertEqual((len(hedge.cell_ids) - 1) * 12 + 1, len(hedge.samples))
        self.assertGreater(len(hedge.brush_stations), 3)
        self.assertEqual(3, len(hedge.tree_stations))
        self.assertIn("leaf_cards", hedge.foliage_style)
        self.assertNotIn("icosphere", hedge.foliage_style)

    def test_contextual_craters_deform_and_interrupt_their_surfaces(self):
        self.assertEqual({"road", "field"}, {item.context for item in self.plan.craters})
        road_crater = next(item for item in self.plan.craters if item.context == "road")
        field_crater = next(item for item in self.plan.craters if item.context == "field")
        self.assertLess(
            min(
                review_world.distance(road_crater.center, sample)
                for sample in self.plan.road.samples
            ),
            self.plan.road.width_m * 0.5,
        )
        self.assertTrue(
            review_world.point_in_convex_polygon(field_crater.center, self.plan.field.polygon)
        )
        for crater in self.plan.craters:
            self.assertLess(review_world.ground_height(crater.center, self.plan.craters), -0.7)
            rim_heights = []
            for index in range(36):
                angle = math.tau * index / 36
                point = review_world.Point2(
                    crater.center.x + math.cos(angle) * crater.radius_x_m * 0.78,
                    crater.center.y + math.sin(angle) * crater.radius_y_m * 0.78,
                )
                rim_heights.append(review_world.crater_height(point, crater))
            self.assertGreater(max(rim_heights), 0.15)
            self.assertEqual(0, crater.rotation_deg)
            self.assertIn("asymmetric", crater.shape)
        complete_faces = (len(self.plan.road.samples) - 1) * 8
        self.assertLess(
            len(review_world._road_mesh_data(self.plan, shoulder=False).faces),
            complete_faces,
        )

    def test_plan_is_stable_and_source_has_no_random_generator(self):
        second = review_world.build_world_plan(MANIFEST_PATH)
        self.assertEqual(self.plan, second)
        self.assertEqual(
            review_world.plan_digest(self.plan), review_world.plan_digest(second)
        )
        self.assertEqual(64, len(review_world.plan_digest(self.plan)))
        source = SCRIPT_PATH.read_text(encoding="utf-8")
        self.assertNotIn("import random", source)
        self.assertNotIn("from random", source)

    def test_camera_fit_contains_board_and_vertical_features_with_margin(self):
        fit = review_world.camera_fit_for_bounds(self.plan.ground_bounds)
        self.assertEqual(fit, review_world.camera_fit_for_bounds(self.plan.ground_bounds))
        self.assertEqual((1280, 960), fit.resolution_px)
        self.assertEqual(55.0, fit.elevation_deg)
        self.assertEqual(1.0 / math.sin(math.radians(55.0)), fit.pixel_aspect_x)
        self.assertGreater(fit.ortho_scale_m, fit.projected_width_m)

        bounds = self.plan.ground_bounds
        self.assertEqual(
            (
                (bounds.min_x + bounds.max_x) * 0.5,
                (bounds.min_y + bounds.max_y) * 0.5,
                (review_world.REVIEW_CONTENT_MIN_Z_M
                 + review_world.REVIEW_CONTENT_MAX_Z_M) * 0.5,
            ),
            fit.target_xyz,
        )
        expected_scale = max(
            fit.projected_width_m,
            fit.projected_height_m * fit.display_aspect,
        ) * fit.frame_margin
        self.assertAlmostEqual(expected_scale, fit.ortho_scale_m, places=9)

        projected = [
            review_world.project_point_to_review_camera(fit, (x, y, z))
            for x in (bounds.min_x, bounds.max_x)
            for y in (bounds.min_y, bounds.max_y)
            for z in (
                review_world.REVIEW_CONTENT_MIN_Z_M,
                review_world.REVIEW_CONTENT_MAX_Z_M,
            )
        ]
        max_x = max(abs(point[0]) for point in projected)
        max_y = max(abs(point[1]) for point in projected)
        self.assertLessEqual(
            max_x * 2.0 * fit.frame_margin,
            fit.ortho_scale_m + 1.0e-8,
        )
        self.assertLessEqual(
            max_y * 2.0 * fit.display_aspect * fit.frame_margin,
            fit.ortho_scale_m + 1.0e-8,
        )
        self.assertEqual(
            ("scene", "plan", "output_path"),
            tuple(inspect.signature(review_world.render_review_world).parameters),
        )

        parsed = review_world._parse_args(["--render", "review.png"])
        self.assertEqual(Path("review.png"), parsed.render)

    def test_cli_can_validate_plan_without_blender(self):
        completed = subprocess.run(
            [sys.executable, "-B", str(SCRIPT_PATH), "--manifest",
             str(MANIFEST_PATH), "--plan-only"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(0, completed.returncode, completed.stdout + completed.stderr)
        self.assertIn("REVIEW_WORLD PLAN OK", completed.stdout)
        self.assertIn("cells=30", completed.stdout)
        self.assertIn("field_rows=%d" % self.plan.field.row_count, completed.stdout)
        self.assertIn("rotation=0", completed.stdout)


if __name__ == "__main__":
    unittest.main()
