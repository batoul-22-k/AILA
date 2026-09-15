from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.ml.feature_schema import PREDICTION_FEATURE_COLUMNS, feature_vector

logger = logging.getLogger(__name__)

_EXPLAINER_CACHE: dict[tuple[Any, ...], "CachedShapExplainer"] = {}


@dataclass(frozen=True)
class CachedShapExplainer:
    explainer: Any
    preprocessor: Any
    feature_columns: tuple[str, ...]
    risk_labels: tuple[str, ...]
    kind: str


def label_for_feature(feature_name: str) -> str:
    labels = {
        "attendance_rate": "Attendance",
        "participation_rate": "Participation",
        "correctness_rate": "Correctness",
        "semantic_score": "Semantic Score",
        "engagement_score": "Engagement",
        "consistency_score": "Consistency",
        "response_time": "Response Time",
        "recent_activity_count": "Recent Activity",
        "weak_concepts_count": "Bloom Mastery Gaps",
    }
    return labels.get(feature_name, feature_name.replace("_", " ").title())


def shap_direction(predicted_class: str, shap_value: float) -> str:
    predicted = str(predicted_class or "").lower()
    if predicted == "high":
        return "increases_risk" if shap_value >= 0 else "decreases_risk"
    if predicted == "low":
        return "decreases_risk" if shap_value >= 0 else "increases_risk"
    if predicted == "medium":
        return "pushes_toward_medium_risk" if shap_value >= 0 else "pushes_away_from_medium_risk"
    return "pushes_toward_prediction" if shap_value >= 0 else "pushes_away_from_prediction"


def factor_direction_for_prediction(predicted_class: str, shap_value: float) -> str:
    predicted = str(predicted_class or "").lower()
    if predicted == "low":
        return "positive" if shap_value >= 0 else "negative"
    return "negative" if shap_value >= 0 else "positive"


def predicted_class_index(predicted_class: str, risk_labels: list[str] | tuple[str, ...]) -> int:
    labels = [str(label).lower() for label in risk_labels]
    predicted = str(predicted_class or "").lower()
    return labels.index(predicted) if predicted in labels else 0


def values_for_predicted_class(raw_values: Any, class_index: int, feature_count: int) -> np.ndarray:
    values = np.asarray(raw_values)
    if isinstance(raw_values, list):
        values = np.asarray(raw_values[class_index])

    if values.ndim == 1:
        return values.astype(float)
    if values.ndim == 2:
        if values.shape[0] == 1:
            return values[0].astype(float)
        if values.shape[1] == feature_count:
            return values[0].astype(float)
    if values.ndim == 3:
        if values.shape[0] == 1 and values.shape[1] == feature_count:
            return values[0, :, class_index].astype(float)
        if values.shape[0] == 1 and values.shape[2] == feature_count:
            return values[0, class_index, :].astype(float)
        if values.shape[0] > class_index and values.shape[2] == feature_count:
            return values[class_index, 0, :].astype(float)
        if values.shape[2] > class_index and values.shape[1] == feature_count:
            return values[0, :, class_index].astype(float)
    raise ValueError(f"Unsupported SHAP value shape {values.shape!r}")


def base_value_for_predicted_class(raw_base_values: Any, class_index: int) -> float:
    values = np.asarray(raw_base_values)
    if values.ndim == 0:
        return round(float(values), 6)
    if values.ndim == 1:
        return round(float(values[class_index] if len(values) > class_index else values[0]), 6)
    if values.ndim == 2:
        row = values[0]
        return round(float(row[class_index] if len(row) > class_index else row[0]), 6)
    return round(float(values.reshape(-1)[0]), 6)


def transformed_feature_matrix(preprocessor: Any, normalized_feature: dict, feature_columns: tuple[str, ...]) -> np.ndarray:
    values = feature_vector(normalized_feature, list(feature_columns))
    frame = pd.DataFrame([values], columns=list(feature_columns))
    transformed = preprocessor.transform(frame) if preprocessor is not None else frame.to_numpy()
    return np.asarray(transformed, dtype=float)


def _model_cache_key(model_bundle: Any, feature_columns: tuple[str, ...], risk_labels: tuple[str, ...]) -> tuple[Any, ...]:
    path = getattr(model_bundle, "path", None)
    if isinstance(path, Path) and path.exists():
        stat = path.stat()
        return (str(path.resolve()), stat.st_mtime_ns, stat.st_size, feature_columns, risk_labels)
    return (id(getattr(model_bundle, "model", model_bundle)), feature_columns, risk_labels)


def _pipeline_parts(model: Any) -> tuple[Any, Any]:
    if not hasattr(model, "steps") or not hasattr(model, "named_steps"):
        return None, model
    steps = list(model.steps)
    classifier_name, classifier = steps[-1]
    if classifier_name != "classifier":
        classifier = model.named_steps.get("classifier", classifier)
    preprocessing_steps = [(name, step) for name, step in steps if step is not classifier]
    if not preprocessing_steps:
        return None, classifier
    from sklearn.pipeline import Pipeline

    return Pipeline(preprocessing_steps), classifier


def get_cached_shap_explainer(model_bundle: Any) -> CachedShapExplainer | None:
    if not model_bundle:
        return None

    feature_columns = tuple(getattr(model_bundle, "feature_columns", None) or PREDICTION_FEATURE_COLUMNS)
    risk_labels = tuple(getattr(model_bundle, "risk_labels", None) or ("low", "medium", "high"))
    if list(feature_columns) != PREDICTION_FEATURE_COLUMNS:
        logger.warning("Skipping SHAP: model feature columns do not match production schema.")
        return None

    cache_key = _model_cache_key(model_bundle, feature_columns, risk_labels)
    if cache_key in _EXPLAINER_CACHE:
        return _EXPLAINER_CACHE[cache_key]

    try:
        import shap

        preprocessor, classifier = _pipeline_parts(model_bundle.model)
        explainer = shap.TreeExplainer(classifier)
        cached = CachedShapExplainer(
            explainer=explainer,
            preprocessor=preprocessor,
            feature_columns=feature_columns,
            risk_labels=risk_labels,
            kind="tree",
        )
        _EXPLAINER_CACHE[cache_key] = cached
        return cached
    except Exception as exc:
        logger.warning("SHAP explainer is unavailable: %s", exc)
        return None


def build_xai_payload_from_values(
    *,
    normalized_feature: dict,
    predicted_class: str,
    risk_labels: list[str] | tuple[str, ...],
    shap_values: Any,
    base_values: Any,
    feature_columns: list[str] | tuple[str, ...] = PREDICTION_FEATURE_COLUMNS,
) -> dict:
    columns = tuple(feature_columns)
    class_index = predicted_class_index(predicted_class, risk_labels)
    local_values = values_for_predicted_class(shap_values, class_index, len(columns))
    base_value = base_value_for_predicted_class(base_values, class_index)
    measured_values = feature_vector(normalized_feature, list(columns))
    contributions = []
    for feature_name, measured_value, shap_value in zip(columns, measured_values, local_values, strict=False):
        local_value = round(float(shap_value), 6)
        contributions.append(
            {
                "feature": feature_name,
                "label": label_for_feature(feature_name),
                "value": round(float(measured_value), 4),
                "shap_value": local_value,
                "abs_shap_value": round(abs(local_value), 6),
                "direction": shap_direction(predicted_class, local_value),
                "factor_direction": factor_direction_for_prediction(predicted_class, local_value),
            }
        )

    contributions.sort(key=lambda row: row["abs_shap_value"], reverse=True)
    risk_driving = [row for row in contributions if row["factor_direction"] == "negative"]
    counter_signals = [row for row in contributions if row["factor_direction"] == "positive"]
    return {
        "method": "shap",
        "explainer": "TreeExplainer",
        "predicted_class": str(predicted_class or "").lower(),
        "class_index": class_index,
        "base_value": base_value,
        "feature_contributions": contributions,
        "top_risk_factors": risk_driving[:4],
        "top_counter_signals": counter_signals[:4],
    }


def local_shap_explanation(model_bundle: Any, normalized_feature: dict, predicted_class: str) -> dict | None:
    cached = get_cached_shap_explainer(model_bundle)
    if cached is None:
        return None
    try:
        transformed = transformed_feature_matrix(cached.preprocessor, normalized_feature, cached.feature_columns)
        if hasattr(cached.explainer, "shap_values"):
            shap_values = cached.explainer.shap_values(transformed)
            base_values = cached.explainer.expected_value
        else:
            explanation = cached.explainer(transformed)
            shap_values = explanation.values
            base_values = explanation.base_values
        return build_xai_payload_from_values(
            normalized_feature=normalized_feature,
            predicted_class=predicted_class,
            risk_labels=cached.risk_labels,
            shap_values=shap_values,
            base_values=base_values,
            feature_columns=cached.feature_columns,
        )
    except Exception as exc:
        logger.warning("SHAP local explanation failed: %s", exc)
        return None
