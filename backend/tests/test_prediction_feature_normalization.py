import unittest

from app.prediction_service import bloom_mastery_by_level_value, normalize_inference_features, tested_bloom_gap_levels
from app.scripts.seed_demo_learning_activity import assign_demo_prediction_trend_states, previous_risk_level_for_demo_trend


class PredictionFeatureNormalizationTest(unittest.TestCase):
    def test_scales_fractional_semantic_score(self):
        normalized = normalize_inference_features({"semantic_score": 0.86})

        self.assertEqual(normalized["semantic_score"], 86)

    def test_preserves_percent_semantic_score(self):
        normalized = normalize_inference_features({"semantic_score": 86})

        self.assertEqual(normalized["semantic_score"], 86)

    def test_caps_large_response_time(self):
        normalized = normalize_inference_features({"response_time": 5431})

        self.assertEqual(normalized["response_time"], 180)

    def test_clamps_negative_response_time(self):
        normalized = normalize_inference_features({"response_time": -5})

        self.assertEqual(normalized["response_time"], 0)

    def test_clamps_percentage_features(self):
        normalized = normalize_inference_features({"attendance_rate": 120})

        self.assertEqual(normalized["attendance_rate"], 100)

    def test_bloom_gap_requires_attempted_question(self):
        rows = bloom_mastery_by_level_value(
            {
                "concept_answer_counts": {"Remember": 1, "Create": 0},
                "concept_correct_answer_counts": {"Remember": 0, "Create": 0},
            }
        )

        self.assertEqual(rows["Remember"]["mastery_rate"], 0)
        self.assertTrue(rows["Remember"]["is_mastery_gap"])
        self.assertIsNone(rows["Create"]["mastery_rate"])
        self.assertFalse(rows["Create"]["is_mastery_gap"])
        self.assertEqual(tested_bloom_gap_levels({"bloom_mastery_by_level": rows}), ["Remember"])

    def test_bloom_mastery_uses_correct_over_attempted_counts(self):
        rows = bloom_mastery_by_level_value(
            {
                "bloom_mastery_by_level": {
                    "Apply": {"attempted_count": 1, "correct_count": 1, "mastery_rate": 0},
                    "Analyze": {"attempted_count": 1, "correct_count": 0, "mastery_rate": 100},
                }
            }
        )

        self.assertEqual(rows["Apply"]["mastery_rate"], 100)
        self.assertFalse(rows["Apply"]["is_mastery_gap"])
        self.assertEqual(rows["Analyze"]["mastery_rate"], 0)
        self.assertTrue(rows["Analyze"]["is_mastery_gap"])

    def test_demo_prediction_trend_assignment_covers_supported_states(self):
        predictions = [
            {"prediction_id": f"low_{index}", "student_id": f"l{index}", "class_id": "demo", "risk_level": "low"}
            for index in range(8)
        ] + [
            {"prediction_id": f"medium_{index}", "student_id": f"m{index}", "class_id": "demo", "risk_level": "medium"}
            for index in range(8)
        ] + [
            {"prediction_id": f"high_{index}", "student_id": f"h{index}", "class_id": "demo", "risk_level": "high"}
            for index in range(8)
        ]

        assignments = assign_demo_prediction_trend_states(predictions)
        states = set(assignments.values())

        self.assertEqual(states, {"stable", "improved", "worsened", "initial"})
        for prediction in predictions:
            state = assignments[prediction["prediction_id"]]
            previous = previous_risk_level_for_demo_trend(prediction["risk_level"], state)
            if state == "initial":
                self.assertIsNone(previous)
            elif state == "stable":
                self.assertEqual(previous, prediction["risk_level"])
            elif state == "improved":
                self.assertGreater(["low", "medium", "high"].index(previous), ["low", "medium", "high"].index(prediction["risk_level"]))
            elif state == "worsened":
                self.assertLess(["low", "medium", "high"].index(previous), ["low", "medium", "high"].index(prediction["risk_level"]))


if __name__ == "__main__":
    unittest.main()
