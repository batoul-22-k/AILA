import unittest

import numpy as np

from app.ml.feature_schema import PREDICTION_FEATURE_COLUMNS
from app.ml.xai import build_xai_payload_from_values, values_for_predicted_class
from app.prediction_service import explain_prediction, prediction_report_payload


class PredictionXaiTest(unittest.TestCase):
    def sample_feature(self) -> dict:
        return {
            "attendance_rate": 33.0,
            "participation_rate": 25.0,
            "correctness_rate": 0.0,
            "semantic_score": 27.0,
            "engagement_score": 30.0,
            "consistency_score": 100.0,
            "response_time": 109.0,
            "recent_activity_count": 4.0,
            "weak_concepts_count": 5.0,
        }

    def test_maps_shap_values_to_nine_features(self):
        shap_values = np.array([[[0.01, 0.11, 0.21] for _ in PREDICTION_FEATURE_COLUMNS]])
        xai = build_xai_payload_from_values(
            normalized_feature=self.sample_feature(),
            predicted_class="high",
            risk_labels=("low", "medium", "high"),
            shap_values=shap_values,
            base_values=np.array([0.1, 0.2, 0.3]),
        )

        by_feature = {row["feature"]: row for row in xai["feature_contributions"]}

        self.assertEqual(set(by_feature), set(PREDICTION_FEATURE_COLUMNS))
        self.assertEqual(by_feature["response_time"]["label"], "Response Time")
        self.assertEqual(by_feature["response_time"]["value"], 109.0)
        self.assertEqual(by_feature["response_time"]["shap_value"], 0.21)
        self.assertEqual(xai["base_value"], 0.3)

    def test_selects_predicted_class_for_multiclass_output(self):
        shap_values = np.array(
            [
                [
                    [1.0, 2.0, 3.0],
                    [4.0, 5.0, 6.0],
                    [7.0, 8.0, 9.0],
                    [10.0, 11.0, 12.0],
                    [13.0, 14.0, 15.0],
                    [16.0, 17.0, 18.0],
                    [19.0, 20.0, 21.0],
                    [22.0, 23.0, 24.0],
                    [25.0, 26.0, 27.0],
                ]
            ]
        )

        selected = values_for_predicted_class(shap_values, 1, len(PREDICTION_FEATURE_COLUMNS))

        self.assertEqual(selected.tolist(), [2.0, 5.0, 8.0, 11.0, 14.0, 17.0, 20.0, 23.0, 26.0])

    def test_sorts_by_absolute_contribution(self):
        values = np.array([[[0.01], [-0.9], [0.2], [0.1], [0.05], [0.03], [0.7], [0.02], [-0.6]]])
        xai = build_xai_payload_from_values(
            normalized_feature=self.sample_feature(),
            predicted_class="high",
            risk_labels=("high",),
            shap_values=values,
            base_values=np.array([0.0]),
            feature_columns=PREDICTION_FEATURE_COLUMNS,
        )

        ordered = [row["feature"] for row in xai["feature_contributions"]]

        self.assertEqual(ordered[:3], ["participation_rate", "response_time", "weak_concepts_count"])

    def test_explanation_falls_back_without_shap(self):
        explanation = explain_prediction(
            {
                "student_name": "Student",
                "risk_level": "high",
                "features": self.sample_feature(),
                "feature_importance": [{"feature": "response_time", "importance": 0.5}],
            }
        )

        self.assertEqual(explanation["method"], "Feature-importance fallback")
        self.assertEqual(explanation["top_factors"][0]["source"], "feature_importance")

    def test_prediction_report_payload_exposes_xai_shape(self):
        xai = build_xai_payload_from_values(
            normalized_feature=self.sample_feature(),
            predicted_class="high",
            risk_labels=("low", "medium", "high"),
            shap_values=np.array([[[0.01, 0.02, 0.42] for _ in PREDICTION_FEATURE_COLUMNS]]),
            base_values=np.array([0.1, 0.2, 0.3]),
        )
        payload = prediction_report_payload(
            {
                "prediction_id": "prediction_test",
                "student_id": "student_test",
                "student_name": "Jad",
                "class_id": "class_test",
                "risk_level": "high",
                "confidence": 0.81,
                "risk_probabilities": {"low": 0.1, "medium": 0.2, "high": 0.7},
                "features": self.sample_feature(),
                "feature_importance": [{"feature": "response_time", "importance": 0.5}],
                "xai": xai,
            },
            class_names={"class_test": "Demo"},
            class_meta={"class_test": {"semester": "Spring 2026"}},
        )

        self.assertEqual(payload["xai"]["method"], "shap")
        self.assertEqual(payload["explanation"]["method"], "SHAP local explanation")
        self.assertEqual(payload["explanation"]["top_factors"][0]["source"], "shap")
        self.assertIn("feature_contributions", payload["xai"])


if __name__ == "__main__":
    unittest.main()
