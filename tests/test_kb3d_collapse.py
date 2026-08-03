import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "kb3d_forge" / "collapse.py"
SPEC = importlib.util.spec_from_file_location("kb3d_collapse", MODULE_PATH)
collapse = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = collapse
SPEC.loader.exec_module(collapse)


class CollapsePlanningTests(unittest.TestCase):
    def test_connected_components(self):
        components = collapse.connected_components(
            7,
            [(0, 1), (1, 2), (3, 4), (5, 6)],
        )
        self.assertEqual(components, [(0, 1, 2), (3, 4), (5, 6)])

    def test_stage_zero_is_intact(self):
        metrics = self._building_metrics()
        self.assertEqual(collapse.plan_component_removal(metrics, 0, 7), [])

    def test_stages_are_monotonic(self):
        metrics = self._building_metrics()
        previous = set()
        for stage in range(1, 5):
            current = set(
                collapse.plan_component_removal(
                    metrics,
                    stage,
                    seed=17,
                    direction=(1.0, 1.0),
                )
            )
            self.assertTrue(previous.issubset(current))
            previous = current
        self.assertTrue(previous)

    def test_invalid_direction_and_stage_are_rejected(self):
        metrics = self._building_metrics()
        with self.assertRaises(ValueError):
            collapse.plan_component_removal(metrics, 5, 1)
        with self.assertRaises(ValueError):
            collapse.plan_component_removal(metrics, 2, 1, direction=(0.0, 0.0))

    @staticmethod
    def _building_metrics():
        metrics = []
        index = 0
        for z in range(5):
            for y in range(5):
                for x in range(5):
                    center = (float(x), float(y), float(z))
                    dimensions = (0.45, 0.35, 0.25)
                    metrics.append(
                        {
                            "index": index,
                            "vertices": (index,),
                            "minimum": tuple(center[a] - dimensions[a] * 0.5 for a in range(3)),
                            "maximum": tuple(center[a] + dimensions[a] * 0.5 for a in range(3)),
                            "dimensions": dimensions,
                            "center": center,
                            "slenderness": 1.3,
                        }
                    )
                    index += 1
        return metrics


if __name__ == "__main__":
    unittest.main()

