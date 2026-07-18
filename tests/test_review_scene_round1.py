import copy
import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "kb3d_forge" / "review_scene.py"
MANIFEST_PATH = REPO_ROOT / "scripts" / "kb3d_forge" / "review_scene_round1.json"

SPEC = importlib.util.spec_from_file_location("review_scene_round1", SCRIPT_PATH)
review_scene = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(review_scene)


class ReviewSceneRound1Tests(unittest.TestCase):
    def setUp(self):
        self.manifest = review_scene.load_manifest(MANIFEST_PATH)

    def feature(self, feature_id):
        return next(
            feature
            for feature in self.manifest["features"]
            if feature["id"] == feature_id
        )

    def test_manifest_validates_as_fixed_5_by_6_grade_a_scene(self):
        self.assertEqual([], review_scene.validate_manifest(self.manifest))
        self.assertEqual(5, self.manifest["grid"]["columns"])
        self.assertEqual(6, self.manifest["grid"]["rows"])
        self.assertEqual(30, len(self.manifest["grid"]["cells"]))
        self.assertEqual("A", self.manifest["grade"]["profile_id"])
        self.assertFalse(self.manifest["determinism"]["random_placement"])
        self.assertIsNone(self.manifest["determinism"]["seed"])

    def test_semantic_footprints_are_connected_and_cross_hex_boundaries(self):
        cells = {cell["id"]: cell for cell in self.manifest["grid"]["cells"]}
        camp = self.feature("round1.cluster.camp_a")
        farm = self.feature("round1.cluster.farmstead")
        field = self.feature("round1.parcel.raised_field")
        hedge = self.feature("round1.edge.hedgerow_wood")

        self.assertEqual(7, len(camp["cells"]))
        self.assertEqual(6, len(farm["cells"]))
        self.assertEqual(6, len(field["cells"]))
        self.assertEqual(4, len(hedge["cell_path"]))
        self.assertTrue(review_scene._connected_cells(camp["cells"], cells))
        self.assertTrue(review_scene._connected_cells(farm["cells"], cells))
        self.assertTrue(review_scene._connected_cells(field["cells"], cells))
        self.assertTrue(review_scene._path_is_continuous(hedge["cell_path"], cells))
        self.assertEqual(1.0, camp["scale"])
        self.assertEqual(1.0, farm["scale"])
        self.assertFalse(camp["fit_to_cell"])
        self.assertFalse(farm["fit_to_cell"])

    def test_main_road_is_a_connected_s_with_contextual_crater(self):
        cells = {cell["id"]: cell for cell in self.manifest["grid"]["cells"]}
        road = self.feature("round1.road.main_s")
        crater = self.feature("round1.damage.road_crater")

        self.assertTrue(review_scene._path_is_continuous(road["cell_path"], cells))
        signs = review_scene._compressed_horizontal_signs(road["cell_path"], cells)
        self.assertGreaterEqual(len(signs), 3)
        self.assertEqual(signs[0], signs[2])
        self.assertNotEqual(signs[0], signs[1])
        self.assertIn(crater["anchor_cell"], road["cell_path"])

    def test_contextual_vignettes_are_inside_their_clusters(self):
        features = {feature["id"]: feature for feature in self.manifest["features"]}
        vignettes = [
            feature
            for feature in self.manifest["features"]
            if feature["type"] == "contextual_vignette"
        ]
        self.assertEqual(2, len(vignettes))
        for vignette in vignettes:
            context = features[vignette["context_feature_id"]]
            self.assertIn(vignette["anchor_cell"], context["cells"])

    def test_validator_rejects_random_placement(self):
        mutated = copy.deepcopy(self.manifest)
        mutated["determinism"]["random_placement"] = True
        errors = review_scene.validate_manifest(mutated)
        self.assertTrue(any("random_placement" in error for error in errors))

    def test_validator_rejects_a_disconnected_road(self):
        mutated = copy.deepcopy(self.manifest)
        road = next(
            feature
            for feature in mutated["features"]
            if feature["id"] == "round1.road.main_s"
        )
        road["cell_path"][1] = "cell_r05_c04"
        errors = review_scene.validate_manifest(mutated)
        self.assertTrue(any("road path must be connected" in error for error in errors))

    def test_cli_validation_succeeds(self):
        completed = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--manifest", str(MANIFEST_PATH)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(0, completed.returncode, completed.stdout + completed.stderr)
        self.assertIn("REVIEW_SCENE OK", completed.stdout)
        self.assertIn("cells=30", completed.stdout)
        self.assertIn("grade=A", completed.stdout)


if __name__ == "__main__":
    unittest.main()
