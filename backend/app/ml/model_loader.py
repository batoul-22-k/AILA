from pathlib import Path
from typing import Any

from app.ml.feature_schema import PREDICTION_FEATURE_COLUMNS


MODEL_DIR = Path(__file__).resolve().parents[2] / "models"
MODEL_CANDIDATES = [
    MODEL_DIR / "student_risk_xgboost.pkl",
    MODEL_DIR / "student_risk_sklearn.pkl",
    MODEL_DIR / "student_risk_model.pkl",
]


class LoadedPredictionModel:
    def __init__(self, model: Any, path: Path, artifact: dict | None = None):
        self.model = model
        self.path = path
        self.artifact = artifact or {}
        self.model_name = self.artifact.get("model_name") or path.stem
        self.model_version = self.artifact.get("model_version") or "external"
        self.model_type = self.artifact.get("model_type") or "trained_model"
        self.feature_columns = self.artifact.get("feature_columns")
        self.risk_labels = self.artifact.get("risk_labels") or ["low", "medium", "high"]
        self.metrics = self.artifact.get("metrics") or {}
        self.feature_schema_version = self.artifact.get("feature_schema_version")


def load_prediction_model() -> LoadedPredictionModel | None:
    for path in MODEL_CANDIDATES:
        if not path.exists():
            continue
        try:
            try:
                import joblib

                model = joblib.load(path)
            except Exception:
                import pickle

                with path.open("rb") as handle:
                    model = pickle.load(handle)
            if isinstance(model, dict) and "model" in model:
                feature_columns = model.get("feature_columns")
                if feature_columns and list(feature_columns) != PREDICTION_FEATURE_COLUMNS:
                    continue
                return LoadedPredictionModel(model["model"], path, model)
            return LoadedPredictionModel(model, path)
        except Exception:
            # A bad or incompatible model artifact must not break the baseline pipeline.
            continue
    return None


def model_feature_importance(model: Any, feature_names: list[str]) -> list[dict]:
    classifier = getattr(model, "named_steps", {}).get("classifier") if hasattr(model, "named_steps") else None
    values = getattr(classifier or model, "feature_importances_", None)
    if values is None:
        return []
    pairs = zip(feature_names, values, strict=False)
    return [
        {"feature": feature, "importance": round(float(value), 4)}
        for feature, value in sorted(pairs, key=lambda item: float(item[1]), reverse=True)
    ]
