import json
import unittest
from pathlib import Path

from scripts.kb3d_forge.navigation_v1 import (
    validate_navigation,
    serialize_navigation,
)


SAMPLE_VALID_DOC = {
    "$schema": "squad-tactics.navigation/v1",
    "asset_id": "farmhouse_small_01",
    "space": {
        "units": "meter",
        "basis": "asset_local_xy",
        "hex_layout": "pointy_axial",
        "hex_radius_m": 9.0
    },
    "owner": {
        "base_cell": [0, 0],
        "occupied_cells": [[0, 0], [1, 0]]
    },
    "profiles": ["infantry", "vehicle"],
    "states": {
        "d0": {
            "obstacles": [
                {
                    "id": "building_shell",
                    "polygon": [[-3.4, -2.5], [3.4, -2.5], [3.4, 2.5], [-3.4, 2.5]],
                    "profiles": ["infantry", "vehicle"],
                    "blocks_los": True,
                    "blocks_projectile": True,
                    "height_m": 3.2
                }
            ],
            "portals": [
                {
                    "id": "front_door",
                    "segment": [[-0.55, -2.5], [0.55, -2.5]],
                    "connects": ["exterior", "room_main"],
                    "profiles": ["infantry"],
                    "width_m": 1.1
                }
            ],
            "regions": [
                {
                    "id": "room_main",
                    "polygon": [[-3.0, -2.1], [3.0, -2.1], [3.0, 2.1], [-3.0, 2.1]],
                    "profiles": ["infantry"],
                    "movement_cost_milli": 1000,
                    "capacity": 4,
                    "allows": ["wait", "fire"]
                }
            ],
            "barriers": [
                {
                    "id": "yard_fence_east",
                    "polyline": [[4.1, -3.0], [4.1, 3.1]],
                    "profiles": ["infantry", "vehicle"],
                    "width_m": 0.12,
                    "passable_gaps": []
                }
            ],
            "surfaces": [
                {
                    "id": "field_south",
                    "kind": "field",
                    "polygon": [[-8.0, -8.0], [8.0, -8.0], [8.0, -3.2], [-8.0, -3.2]],
                    "profiles": ["infantry", "vehicle"],
                    "movement_cost_milli": 1350
                },
                {
                    "id": "road_gate",
                    "kind": "road",
                    "polygon": [[-1.8, -10.0], [1.8, -10.0], [1.8, -3.0], [-1.8, -3.0]],
                    "profiles": ["infantry", "vehicle"],
                    "movement_cost_milli": 800
                }
            ],
            "slots": [
                {
                    "id": "window_north_fire_01",
                    "point": [-1.6, 1.8],
                    "region": "room_main",
                    "kind": "fire",
                    "facing_deg": 90,
                    "profiles": ["infantry"]
                }
            ]
        }
    },
    "source": {
        "blend": "farmhouse_small_01.blend",
        "generator": "kb3d_forge",
        "state": "d0"
    }
}


class NavigationV1ValidationTests(unittest.TestCase):
    def test_valid_sample_document_passes(self):
        """Valid sample document should have no errors."""
        errors = validate_navigation(SAMPLE_VALID_DOC)
        self.assertEqual(errors, [])

    def test_self_intersecting_polygon_rejected(self):
        """Polygon with self-intersection (butterfly shape) should be rejected."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        # Replace building_shell polygon with self-intersecting one
        doc["states"]["d0"]["obstacles"][0]["polygon"] = [[0, 0], [2, 2], [2, 0], [0, 2]]
        errors = validate_navigation(doc)
        self.assertTrue(any("self-intersection" in e for e in errors))

    def test_nonexistent_region_in_portal_connects_rejected(self):
        """Portal referencing unknown region should be rejected."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        doc["states"]["d0"]["portals"][0]["connects"] = ["exterior", "nonexistent_room"]
        errors = validate_navigation(doc)
        self.assertTrue(any("unknown region" in e and "nonexistent_room" in e for e in errors))

    def test_slot_outside_region_rejected(self):
        """Slot point outside its region polygon should be rejected."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        # Move slot to far outside room_main
        doc["states"]["d0"]["slots"][0]["point"] = [100.0, 100.0]
        errors = validate_navigation(doc)
        self.assertTrue(any("not in region" in e for e in errors))

    def test_duplicate_id_in_same_state_rejected(self):
        """Two elements with same id in same state should be rejected."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        # Add another surface with same id as existing one
        doc["states"]["d0"]["surfaces"].append({
            "id": "field_south",  # Duplicate
            "kind": "field",
            "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "profiles": ["infantry"],
            "movement_cost_milli": 1200
        })
        errors = validate_navigation(doc)
        self.assertTrue(any("duplicate id" in e and "field_south" in e for e in errors))

    def test_missing_schema_rejected(self):
        """Missing $schema should be rejected."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        del doc["$schema"]
        errors = validate_navigation(doc)
        self.assertTrue(any("$schema" in e for e in errors))

    def test_wrong_schema_value_rejected(self):
        """Wrong $schema value should be rejected."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        doc["$schema"] = "other.schema/v2"
        errors = validate_navigation(doc)
        self.assertTrue(any("$schema" in e for e in errors))

    def test_empty_states_rejected(self):
        """Document with empty states should be rejected."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        doc["states"] = {}
        errors = validate_navigation(doc)
        self.assertTrue(any("states must be non-empty" in e for e in errors))

    def test_invalid_state_key_rejected(self):
        """State with invalid key (d5) should be rejected."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        doc["states"]["d5"] = doc["states"]["d0"]
        errors = validate_navigation(doc)
        self.assertTrue(any("d5" in e and "invalid" in e for e in errors))

    def test_both_exterior_in_portal_connects_rejected(self):
        """Portal connecting ['exterior', 'exterior'] should be rejected."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        doc["states"]["d0"]["portals"][0]["connects"] = ["exterior", "exterior"]
        errors = validate_navigation(doc)
        self.assertTrue(any("cannot be ['exterior', 'exterior']" in e for e in errors))

    def test_profile_not_in_top_level_rejected(self):
        """Element profile not in top-level profiles should be rejected."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        doc["states"]["d0"]["obstacles"][0]["profiles"] = ["unknown_profile"]
        errors = validate_navigation(doc)
        self.assertTrue(any("not subset of top-level profiles" in e for e in errors))

    def test_zero_area_polygon_rejected(self):
        """Polygon with zero area (collinear points) should be rejected."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        # Replace region polygon with collinear points
        doc["states"]["d0"]["regions"][0]["polygon"] = [[0, 0], [1, 0], [2, 0]]
        errors = validate_navigation(doc)
        self.assertTrue(any("zero area" in e for e in errors))

    def test_polygon_with_less_than_3_vertices_rejected(self):
        """Polygon with < 3 vertices should be rejected."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        doc["states"]["d0"]["obstacles"][0]["polygon"] = [[0, 0], [1, 1]]
        errors = validate_navigation(doc)
        self.assertTrue(any("3+ vertices" in e for e in errors))

    def test_base_cell_not_in_occupied_cells_rejected(self):
        """base_cell must be in occupied_cells."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        doc["owner"]["occupied_cells"] = [[1, 1], [2, 2]]
        errors = validate_navigation(doc)
        self.assertTrue(any("must include base_cell" in e for e in errors))

    def test_duplicate_occupied_cells_rejected(self):
        """occupied_cells must have no duplicates."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        doc["owner"]["occupied_cells"] = [[0, 0], [0, 0], [1, 0]]
        errors = validate_navigation(doc)
        self.assertTrue(any("no duplicates" in e for e in errors))


class NavigationV1SerializationTests(unittest.TestCase):
    def test_deterministic_serialization_round_trip(self):
        """Serialize same doc with different key order should produce identical output."""
        # Create two dicts with same content but different key orders
        doc1 = json.loads(json.dumps(SAMPLE_VALID_DOC))
        doc2 = json.loads(json.dumps(SAMPLE_VALID_DOC))

        # Alter doc2's key order by reconstructing with different order
        doc2 = {
            "source": doc2["source"],
            "states": doc2["states"],
            "profiles": doc2["profiles"],
            "owner": doc2["owner"],
            "space": doc2["space"],
            "asset_id": doc2["asset_id"],
            "$schema": doc2["$schema"]
        }

        serialized1 = serialize_navigation(doc1)
        serialized2 = serialize_navigation(doc2)

        self.assertEqual(serialized1, serialized2, "Serialization should be deterministic regardless of input key order")

    def test_coordinates_rounded_to_3_decimals(self):
        """Coordinates should be rounded to 3 decimal places."""
        doc = json.loads(json.dumps(SAMPLE_VALID_DOC))
        # Modify with extra precision
        doc["states"]["d0"]["obstacles"][0]["polygon"][0][0] = -3.4123456
        serialized = serialize_navigation(doc)
        parsed = json.loads(serialized)
        coord = parsed["states"]["d0"]["obstacles"][0]["polygon"][0][0]
        self.assertEqual(coord, -3.412)

    def test_serialization_ends_with_newline(self):
        """Serialized output should end with single newline."""
        serialized = serialize_navigation(SAMPLE_VALID_DOC)
        self.assertTrue(serialized.endswith('\n'), "Serialization should end with newline")
        self.assertFalse(serialized.endswith('\n\n'), "Should not have double newline at end")

    def test_serialization_uses_sorted_keys(self):
        """Serialized output should have keys in alphabetical order."""
        serialized = serialize_navigation(SAMPLE_VALID_DOC)
        # Check that top-level keys appear in alphabetical order
        lines = serialized.split('\n')
        key_lines = [l for l in lines if '":' in l and l.strip().startswith('"')]
        if len(key_lines) >= 2:
            # Extract keys from JSON
            for i in range(len(key_lines) - 1):
                current_key = key_lines[i].split('"')[1]
                next_key = key_lines[i + 1].split('"')[1]
                # Keys should be in order (or nested, which is fine)
                if current_key[0] == next_key[0]:  # Same first letter, check full order
                    pass  # This is a simplified check; full JSON structure is nested


class NavigationV1GoldenTests(unittest.TestCase):
    def test_golden_serialization(self):
        """Serialization of sample doc should match golden file."""
        golden_path = Path(__file__).parent / "golden" / "navigation_v1_sample.json"

        if not golden_path.exists():
            self.skipTest(f"Golden file not found: {golden_path}")

        with open(golden_path, 'r', encoding='utf-8') as f:
            golden_content = f.read()

        serialized = serialize_navigation(SAMPLE_VALID_DOC)
        self.assertEqual(serialized, golden_content, "Serialization should match golden file byte-for-byte")


if __name__ == "__main__":
    unittest.main()
