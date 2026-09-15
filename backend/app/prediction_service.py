from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import logging
import os
from statistics import mean
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import MongoCollections
from app.ml.feature_schema import FEATURE_SCHEMA_VERSION, GAMIFICATION_CONTEXT_COLUMNS, PREDICTION_FEATURE_COLUMNS, feature_vector
from app.ml.model_loader import load_prediction_model, model_feature_importance
from app.ml.xai import local_shap_explanation
from app.models import new_id, utc_now
from app.response_scoring import final_response_label, final_response_score
from app.services import serialize_document


MODEL_METADATA = {
    "model_name": "student_risk_prediction",
    "model_version": "baseline-v1",
    "trained_on": "OULAD/KDD-compatible feature schema",
    "feature_schema_version": FEATURE_SCHEMA_VERSION,
    "metrics": {"status": "explainable baseline; replace with validated XGBoost/sklearn metrics later"},
}

BLOOM_LEVEL_LABELS = {
    "remember": "Remember",
    "understand": "Understand",
    "apply": "Apply",
    "analyze": "Analyze",
    "evaluate": "Evaluate",
    "create": "Create",
}
MASTERY_THRESHOLD = 60.0

logger = logging.getLogger(__name__)

PERCENTAGE_INFERENCE_FEATURES = {
    "attendance_rate",
    "participation_rate",
    "correctness_rate",
    "semantic_score",
    "average_semantic_score",
    "engagement_score",
    "consistency_score",
}
RESPONSE_TIME_FEATURES = {"response_time", "average_response_time"}
MAX_RESPONSE_TIME_SECONDS = 180.0


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    if not isinstance(value, (int, float)):
        return low
    return round(max(low, min(high, float(value))), 2)


def percent(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    return clamp((float(numerator) / float(denominator)) * 100)


def bloom_mastery_status(mastery_rate: float) -> str:
    if mastery_rate >= 80:
        return "Strong"
    if mastery_rate >= 60:
        return "Acceptable"
    if mastery_rate >= 40:
        return "Needs Attention"
    return "Needs Improvement"


def as_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def average(values: list[float]) -> float:
    clean = [float(value) for value in values if isinstance(value, (int, float))]
    return round(mean(clean), 4) if clean else 0.0


def numeric_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def latest_analytics(rows: list[dict]) -> dict:
    if not rows:
        return {}
    return max(rows, key=lambda row: str(row.get("week") or row.get("calculated_at") or ""))


def question_concept(question: dict | None) -> str:
    if not question:
        return "General"
    for key in ("concept", "topic", "concept_label", "lesson_concept", "bloom_level"):
        value = question.get(key)
        if value:
            return str(value).strip().title()
    text = str(question.get("question_text") or "").strip()
    if text:
        return " ".join(text.split()[:4]).strip(" ?.,").title() or "General"
    return "General"


def question_bloom_level(question: dict | None) -> str | None:
    value = str((question or {}).get("bloom_level") or "").strip().lower()
    return BLOOM_LEVEL_LABELS.get(value)


def mapping_value_for_bloom_level(mapping: dict | None, level: str, default: Any = 0) -> Any:
    if not isinstance(mapping, dict):
        return default
    if level in mapping:
        return mapping.get(level, default)
    level_key = level.strip().lower()
    for key, value in mapping.items():
        if str(key).strip().lower() == level_key:
            return value
    return default


def bloom_mastery_by_level_value(feature: dict) -> dict[str, dict]:
    existing = feature.get("bloom_mastery_by_level")
    existing_rows = (
        [
            {"bloom_level": key, **value} if isinstance(value, dict) else {"bloom_level": key}
            for key, value in existing.items()
        ]
        if isinstance(existing, dict)
        else existing
        if isinstance(existing, list)
        else []
    )
    answer_counts = feature.get("concept_answer_counts") or {}
    correct_counts = feature.get("concept_correct_answer_counts") or {}
    correctness_map = feature.get("concept_correctness_map") or {}
    rows: dict[str, dict] = {}
    for level in BLOOM_LEVEL_LABELS.values():
        existing_row = next(
            (
                row
                for row in existing_rows
                if isinstance(row, dict)
                and str(row.get("bloom_level") or row.get("level") or row.get("concept") or "").strip().lower() == level.lower()
            ),
            {},
        )
        attempted_value = numeric_or_none(
            existing_row.get("attempted_count")
            if existing_row.get("attempted_count") is not None
            else existing_row.get("questions_answered")
            if existing_row.get("questions_answered") is not None
            else mapping_value_for_bloom_level(answer_counts, level, None)
        )
        correct_value = numeric_or_none(
            existing_row.get("correct_count")
            if existing_row.get("correct_count") is not None
            else existing_row.get("correct_answers")
            if existing_row.get("correct_answers") is not None
            else mapping_value_for_bloom_level(correct_counts, level, None)
        )
        attempted_count = int(attempted_value or 0)
        correct_count = int(correct_value or 0)
        mastery_rate = None
        if attempted_count > 0:
            if correct_value is not None:
                mastery_rate = percent(correct_count, attempted_count)
            else:
                mastery_value = numeric_or_none(
                    existing_row.get("mastery_rate")
                    if existing_row.get("mastery_rate") is not None
                    else existing_row.get("average_correctness")
                    if existing_row.get("average_correctness") is not None
                    else mapping_value_for_bloom_level(correctness_map, level, None)
                )
                if mastery_value is not None:
                    mastery_rate = clamp(mastery_value * 100 if 0 <= mastery_value <= 1 else mastery_value)
        rows[level] = {
            "bloom_level": level,
            "attempted_count": attempted_count,
            "correct_count": correct_count,
            "mastery_rate": mastery_rate,
            "mastery_threshold": MASTERY_THRESHOLD,
            "is_mastery_gap": attempted_count > 0 and mastery_rate is not None and mastery_rate < MASTERY_THRESHOLD,
        }
    return rows


def tested_bloom_gap_levels(feature: dict) -> list[str]:
    return [
        level
        for level, row in bloom_mastery_by_level_value(feature).items()
        if int(row.get("attempted_count") or 0) > 0
        and numeric_or_none(row.get("mastery_rate")) is not None
        and float(row.get("mastery_rate")) < MASTERY_THRESHOLD
    ]


def response_is_correct(response: dict) -> bool:
    label = final_response_label(response)
    if label:
        return label == "correct"
    return bool(response.get("is_correct"))


def response_is_partial(response: dict) -> bool:
    return final_response_label(response) == "partial"


def response_needs_review(response: dict) -> bool:
    label = final_response_label(response)
    return label in {None, "incorrect"} and response.get("correctness_placeholder") == "pending"


def risk_level_from_score(score: float) -> str:
    if score >= 75:
        return "high"
    if score >= 45:
        return "medium"
    return "low"


def engagement_level_from_index(score: float) -> str:
    if score >= 75:
        return "high"
    if score >= 50:
        return "medium"
    return "low"


def engagement_status_from_index(score: float) -> str:
    if score >= 75:
        return "strong"
    if score >= 50:
        return "steady"
    return "needs_support"


def academic_status_from_risk(level: str) -> str:
    if level == "high":
        return "needs_support"
    if level == "medium":
        return "monitor"
    return "on_track"


def derived_engagement_index(feature: dict) -> float:
    """
    This value is derived from engagement and learning-behavior metrics.
    It is not a predicted exam mark.

    Gamification values are excluded to avoid circular reasoning; XP, levels,
    badges, and streaks are platform outputs shown only as context.
    """
    attendance_rate = float(feature.get("attendance_rate") or 0)
    correctness_rate = float(feature.get("correctness_rate") or 0)
    answer_rate = float(feature.get("answer_rate") or feature.get("participation_rate") or 0)
    consistency_score = float(feature.get("consistency_score") or 0)
    recent_activity_count = float(feature.get("recent_activity_count") or 0)
    return clamp(
        (0.35 * attendance_rate)
        + (0.25 * answer_rate)
        + (0.25 * correctness_rate)
        + (0.10 * consistency_score)
        + (0.05 * min(recent_activity_count * 10, 100))
    )


def model_feature_values(feature: dict) -> dict[str, float]:
    return {name: feature_vector(feature, [name])[0] for name in PREDICTION_FEATURE_COLUMNS}


def normalize_inference_features(feature: dict) -> dict:
    """
    Live inference must match the training feature schema. Training expects
    semantic_score on a 0-100 scale and response_time as seconds-per-answer.
    The persisted source feature document is left untouched; only the model
    input copy is normalized.
    """
    normalized = dict(feature)

    for name in PERCENTAGE_INFERENCE_FEATURES:
        if name not in normalized or normalized.get(name) is None:
            continue
        value = numeric_or_none(normalized.get(name))
        if value is None:
            continue
        if name in {"semantic_score", "average_semantic_score"} and 0 <= value <= 1:
            value *= 100
        normalized[name] = clamp(value)

    for name in RESPONSE_TIME_FEATURES:
        if name not in normalized or normalized.get(name) is None:
            continue
        value = numeric_or_none(normalized.get(name))
        if value is None:
            continue
        normalized[name] = round(max(0.0, min(value, MAX_RESPONSE_TIME_SECONDS)), 2)

    return normalized


def engagement_context(feature: dict) -> dict[str, int | str]:
    context = {name: int(float(feature.get(name) or 0)) for name in GAMIFICATION_CONTEXT_COLUMNS}
    context["note"] = "Engagement context, not used by the risk model."
    return context


def fallback_confidence_from_risk_score(score: float, level: str) -> float:
    score = clamp(score)
    if level == "high":
        return round(min(0.58 + ((score / 100) * 0.34), 0.92), 4)
    if level == "medium":
        distance_from_edge = min(abs(score - 45), abs(75 - score), 15)
        return round(0.6 + (distance_from_edge / 15 * 0.2), 4)
    return round(min(0.58 + (((100 - score) / 100) * 0.34), 0.92), 4)


def bounded_model_confidence(value: float) -> float:
    return round(max(0.0, min(float(value or 0), 0.97)), 4)


def probability_value(value: Any) -> float:
    try:
        numeric = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    if numeric > 1:
        numeric /= 100
    return max(0.0, min(numeric, 1.0))


def predicted_class_confidence(row: dict) -> float:
    probabilities = row.get("risk_probabilities")
    risk_level = str(row.get("risk_level") or "").lower()
    if isinstance(probabilities, dict) and risk_level in probabilities:
        return round(probability_value(probabilities[risk_level]), 4)
    return round(probability_value(row.get("confidence", row.get("model_confidence"))), 4)


def prediction_probabilities_value(row: dict) -> dict | None:
    raw = row.get("risk_probabilities")
    if not isinstance(raw, dict) or not raw:
        return raw
    return {str(key).lower(): round(probability_value(value), 4) for key, value in raw.items()}


def has_prediction_confidence(row: dict) -> bool:
    probabilities = prediction_probabilities_value(row)
    predicted_level = str(row.get("risk_level") or "").lower()
    return (
        isinstance(probabilities, dict)
        and predicted_level in probabilities
    ) or row.get("confidence", row.get("model_confidence")) is not None


def prediction_feature_value(features: dict, *names: str) -> float:
    for name in names:
        value = features.get(name)
        if isinstance(value, (int, float)):
            return float(value)
    return 0.0


def report_factor_label(feature_name: str) -> str:
    return driver_label(feature_name)


def report_factor_direction(label: str, features: dict) -> str:
    if label == "Bloom Mastery Gaps":
        return "negative" if tested_bloom_gap_levels(features) else "positive"
    if label == "Response Time":
        return "negative" if prediction_feature_value(features, "response_time", "average_response_time") > 45 else "positive"
    value_map = {
        "Attendance": prediction_feature_value(features, "attendance_rate"),
        "Participation": prediction_feature_value(features, "participation_rate", "answer_rate"),
        "Correctness": prediction_feature_value(features, "correctness_rate"),
        "Semantic Score": prediction_feature_value(features, "semantic_score", "average_semantic_score"),
        "Consistency": prediction_feature_value(features, "consistency_score"),
        "Recent Activity": min(prediction_feature_value(features, "recent_activity_count") * 10, 100),
        "Engagement": prediction_feature_value(features, "engagement_score"),
    }
    return "positive" if value_map.get(label, 0) >= 60 else "negative"


def report_reason_factors(prediction: dict) -> list[dict]:
    features = prediction.get("features") or {}
    bloom_gap_count = len(tested_bloom_gap_levels(features))
    factors = []
    candidates = [
        ("Attendance", prediction_feature_value(features, "attendance_rate"), max(0, 60 - prediction_feature_value(features, "attendance_rate"))),
        ("Participation", prediction_feature_value(features, "participation_rate", "answer_rate"), max(0, 60 - prediction_feature_value(features, "participation_rate", "answer_rate"))),
        ("Correctness", prediction_feature_value(features, "correctness_rate"), max(0, 60 - prediction_feature_value(features, "correctness_rate"))),
        ("Semantic Score", prediction_feature_value(features, "semantic_score", "average_semantic_score"), max(0, 60 - prediction_feature_value(features, "semantic_score", "average_semantic_score"))),
        ("Consistency", prediction_feature_value(features, "consistency_score"), max(0, 60 - prediction_feature_value(features, "consistency_score"))),
        ("Recent Activity", prediction_feature_value(features, "recent_activity_count"), 12 if prediction_feature_value(features, "recent_activity_count") == 0 else max(0, 5 - prediction_feature_value(features, "recent_activity_count")) * 2),
        ("Bloom Mastery Gaps", bloom_gap_count, min(bloom_gap_count * 8, 24)),
    ]
    for label, value, impact in candidates:
        if impact > 0:
            factors.append({"factor": label, "impact": round(float(impact), 4), "value": round(float(value), 4), "direction": "negative"})
        elif value:
            factors.append({"factor": label, "impact": round(min(float(value), 100) / 8, 4), "value": round(float(value), 4), "direction": "positive"})
    return factors


def shap_explanation_factors(prediction: dict) -> list[dict]:
    xai = prediction.get("xai") or {}
    if xai.get("method") != "shap":
        return []
    factors = []
    for contribution in xai.get("feature_contributions") or []:
        try:
            impact = abs(float(contribution.get("shap_value") or 0))
            shap_value = float(contribution.get("shap_value") or 0)
        except (TypeError, ValueError):
            continue
        if impact <= 0:
            continue
        feature_name = str(contribution.get("feature") or "")
        if feature_name not in PREDICTION_FEATURE_COLUMNS:
            continue
        factors.append(
            {
                "factor": contribution.get("label") or report_factor_label(feature_name),
                "feature": feature_name,
                "impact": round(impact, 6),
                "value": round(float(contribution.get("value") or 0), 4),
                "direction": contribution.get("factor_direction") or factor_direction_for_shap(prediction, shap_value),
                "source": "shap",
                "method": "shap",
                "shap_value": round(shap_value, 6),
                "xai_direction": contribution.get("direction"),
            }
        )
    return factors


def factor_direction_for_shap(prediction: dict, shap_value: float) -> str:
    predicted = str(prediction.get("risk_level") or prediction.get("xai", {}).get("predicted_class") or "").lower()
    if predicted == "low":
        return "positive" if shap_value >= 0 else "negative"
    return "negative" if shap_value >= 0 else "positive"


def explain_prediction(prediction: dict) -> dict:
    features = prediction.get("features") or {}
    factors = shap_explanation_factors(prediction)
    explanation_method = "SHAP local explanation" if factors else "Feature-importance fallback"
    if not factors:
        importance = prediction.get("feature_importance") or []
        for item in importance:
            feature_name = str(item.get("feature") or "")
            if feature_name not in PREDICTION_FEATURE_COLUMNS:
                continue
            label = report_factor_label(feature_name)
            try:
                impact = float(item.get("importance") or 0)
            except (TypeError, ValueError):
                impact = 0.0
            if impact <= 0:
                continue
            factors.append(
                {
                    "factor": label,
                    "impact": round(impact, 4),
                    "value": round(float(features.get(feature_name, 0) or 0), 4),
                    "direction": report_factor_direction(label, features),
                    "source": "feature_importance",
                }
            )
    if not factors:
        explanation_method = "Rule-based fallback"
        factors = report_reason_factors(prediction)
    merged: dict[str, dict] = {}
    for factor in factors:
        current = merged.get(factor["factor"])
        if not current or factor["impact"] > current["impact"]:
            merged[factor["factor"]] = factor
    top_factors = sorted(merged.values(), key=lambda row: row["impact"], reverse=True)[:8]
    negative = [row for row in top_factors if row.get("direction") == "negative"][:4]
    positive = [row for row in top_factors if row.get("direction") == "positive"][:4]
    risk_level = str(prediction.get("risk_level") or "low").title()
    negative_names = ", ".join(row["factor"].lower() for row in negative[:3]) or "the available learning signals"
    positive_names = ", ".join(row["factor"].lower() for row in positive[:2]) or "some steady engagement signals"
    if explanation_method == "SHAP local explanation":
        summary = (
            f"{prediction.get('student_name', 'This student')} is classified as {risk_level} Academic Risk because "
            f"{negative_names} contributed to this local prediction. {positive_names.title()} acted as counter-signals where present."
        )
    else:
        summary = (
            f"{prediction.get('student_name', 'This student')} is classified as {risk_level} Academic Risk mainly because "
            f"{negative_names} influenced the prediction. {positive_names.title()} provide counter-signals where present."
        )
    return {
        "method": explanation_method,
        "summary": summary,
        "positive_factors": positive,
        "negative_factors": negative,
        "top_factors": top_factors,
    }


def previous_prediction_snapshot(prediction: dict | None) -> dict | None:
    if not prediction:
        return None
    confidence = predicted_class_confidence(prediction)
    features = dict(prediction.get("features") or {})
    bloom_mastery = bloom_mastery_by_level_value(features)
    bloom_gaps = tested_bloom_gap_levels({**features, "bloom_mastery_by_level": bloom_mastery})
    risk_reasons = prediction.get("risk_reasons") or prediction.get("reasons") or []
    if not bloom_gaps:
        risk_reasons = [
            reason
            for reason in risk_reasons
            if "bloom" not in str(reason).lower() and "mastery" not in str(reason).lower()
        ]
    return {
        "prediction_id": prediction.get("prediction_id"),
        "student_id": prediction.get("student_id"),
        "student_name": prediction.get("student_name"),
        "class_id": prediction.get("class_id"),
        "risk_level": prediction.get("risk_level", "low"),
        "risk_score": prediction.get("risk_score", 0),
        "confidence": confidence,
        "model_confidence": confidence,
        "risk_probability": prediction.get("risk_probability", 0),
        "risk_probabilities": prediction_probabilities_value(prediction),
        "risk_reasons": risk_reasons,
        "weak_concepts": bloom_gaps,
        "weak_concepts_count": len(bloom_gaps),
        "bloom_mastery_by_level": bloom_mastery,
        "generated_at": prediction.get("generated_at"),
        "predicted_at": prediction.get("predicted_at") or prediction.get("generated_at"),
    }


def prediction_trend_payload(prediction: dict) -> dict:
    previous = previous_prediction_snapshot(prediction.get("previous_prediction"))
    if not previous:
        return {
            "status": "initial",
            "label": "Initial Prediction",
            "previous_risk_level": None,
            "current_risk_level": prediction.get("risk_level", "low"),
            "risk_score_difference": None,
            "previous_prediction_date": None,
            "current_prediction_date": prediction.get("generated_at") or prediction.get("predicted_at"),
        }
    risk_rank = {"low": 1, "medium": 2, "high": 3}
    previous_level = str(previous.get("risk_level") or "low").lower()
    current_level = str(prediction.get("risk_level") or "low").lower()
    delta = risk_rank.get(current_level, 0) - risk_rank.get(previous_level, 0)
    previous_score = previous.get("risk_score")
    current_score = prediction.get("risk_score")
    try:
        score_difference = round(float(current_score or 0) - float(previous_score or 0), 2)
    except (TypeError, ValueError):
        score_difference = None
    if delta > 0:
        label = "Slight decline" if delta == 1 and previous_level == "low" else "Worsening"
        status = "worsening"
    elif delta < 0:
        label = "Major improvement" if abs(delta) > 1 else "Improving"
        status = "improving"
    else:
        label = "Stable"
        status = "stable"
    return {
        "status": status,
        "label": label,
        "previous_risk_level": previous_level,
        "current_risk_level": current_level,
        "risk_score_difference": score_difference,
        "previous_prediction_date": previous.get("generated_at") or previous.get("predicted_at"),
        "current_prediction_date": prediction.get("generated_at") or prediction.get("predicted_at"),
    }


def prediction_report_status(risk_level: str) -> str:
    normalized = str(risk_level or "").lower()
    if normalized == "high":
        return "Critical"
    if normalized == "medium":
        return "Needs Attention"
    return "Stable"


def prediction_report_payload(
    prediction: dict,
    class_names: dict[str, str] | None = None,
    class_meta: dict[str, dict] | None = None,
    instructor_display=None,
) -> dict:
    class_names = class_names or {}
    class_meta = class_meta or {}
    class_id = prediction.get("class_id")
    features = dict(prediction.get("features") or {})
    bloom_mastery = bloom_mastery_by_level_value(features)
    bloom_gaps = tested_bloom_gap_levels({**features, "bloom_mastery_by_level": bloom_mastery})
    features = {
        **features,
        "bloom_mastery_by_level": bloom_mastery,
        "weak_concepts": bloom_gaps,
        "weak_concepts_count": len(bloom_gaps),
    }
    risk_reasons = prediction.get("risk_reasons") or prediction.get("reasons") or []
    if not bloom_gaps:
        risk_reasons = [
            reason
            for reason in risk_reasons
            if "bloom" not in str(reason).lower() and "mastery" not in str(reason).lower()
        ]
    display_prediction = {
        **prediction,
        "features": features,
        "weak_concepts": bloom_gaps,
        "risk_reasons": risk_reasons,
        "reasons": risk_reasons,
    }
    confidence = predicted_class_confidence(prediction)
    generated_at = prediction.get("generated_at") or prediction.get("predicted_at")
    predicted_at = prediction.get("predicted_at") or prediction.get("generated_at")
    instructor = instructor_display(class_id) if callable(instructor_display) and class_id else "Unassigned"
    return {
        "prediction_id": prediction.get("prediction_id"),
        "student_id": prediction.get("student_id"),
        "student_name": prediction.get("student_name", "Student"),
        "class_id": class_id,
        "class_name": class_names.get(class_id, class_id or "Class"),
        "instructor": instructor,
        "semester": (class_meta.get(class_id) or {}).get("semester") or "Unassigned",
        "risk_level": prediction.get("risk_level", "low"),
        "confidence": confidence,
        "model_confidence": confidence,
        "generated_at": generated_at,
        "predicted_at": predicted_at,
        "risk_probability": prediction.get("risk_probability", 0),
        "risk_probabilities": prediction_probabilities_value(prediction),
        "risk_score": prediction.get("risk_score", 0),
        "engagement_status": prediction.get("engagement_status"),
        "academic_status": prediction.get("academic_status"),
        "status": prediction_report_status(prediction.get("risk_level")),
        "attendance": prediction_feature_value(features, "attendance_rate"),
        "participation": prediction_feature_value(features, "participation_rate", "answer_rate"),
        "correctness": prediction_feature_value(features, "correctness_rate"),
        "engagement": prediction_feature_value(features, "engagement_score"),
        "semantic_score": prediction_feature_value(features, "semantic_score", "average_semantic_score"),
        "engagement_index": prediction.get("engagement_index", prediction.get("derived_engagement_index", prediction.get("predicted_score", 0))),
        "risk_reasons": risk_reasons,
        "weak_concepts": bloom_gaps,
        "recommended_actions": prediction.get("recommended_actions") or prediction.get("recommendations") or [],
        "feature_importance": [
            item
            for item in (prediction.get("feature_importance") or [])
            if item.get("feature") in PREDICTION_FEATURE_COLUMNS
        ],
        "xai": prediction.get("xai"),
        "features": features,
        "model_feature_values": prediction.get("model_feature_values") or {
            name: prediction_feature_value(features, name)
            for name in PREDICTION_FEATURE_COLUMNS
        },
        "engagement_context": prediction.get("engagement_context") or engagement_context(features),
        "previous_prediction": previous_prediction_snapshot(prediction.get("previous_prediction")),
        "prediction_trend": prediction_trend_payload(prediction),
        "explanation": explain_prediction(display_prediction),
    }


def feature_risk_score(feature: dict) -> float:
    attendance_rate = float(feature.get("attendance_rate") or 0)
    correctness_rate = float(feature.get("correctness_rate") or 0)
    answer_rate = float(feature.get("answer_rate") or feature.get("participation_rate") or 0)
    consistency_score = float(feature.get("consistency_score") or 0)
    recent_activity_count = int(feature.get("recent_activity_count") or 0)
    weak_concepts_count = int(feature.get("weak_concepts_count") or 0)
    return clamp(
        (max(0, 60 - attendance_rate) * 0.35)
        + (max(0, 60 - correctness_rate) * 0.35)
        + (max(0, 60 - answer_rate) * 0.2)
        + (12 if recent_activity_count == 0 else 0)
        + (max(0, 60 - consistency_score) * 0.12)
        + min(weak_concepts_count * 8, 24)
    )


def feature_based_confidence(feature: dict, level: str) -> float:
    score = feature_risk_score(feature)
    return fallback_confidence_from_risk_score(score, level)


def conservative_probabilities(predicted_index: int, label_count: int, confidence: float) -> list[float]:
    if label_count <= 1:
        return [1.0]
    confidence = max(0.55, min(float(confidence or 0.72), 0.9))
    remainder = round((1.0 - confidence) / (label_count - 1), 6)
    probabilities = [remainder for _index in range(label_count)]
    if 0 <= predicted_index < label_count:
        probabilities[predicted_index] = confidence
    return probabilities


def soften_extreme_probabilities(probabilities: list[float], predicted_index: int, confidence_cap: float) -> list[float]:
    if not probabilities:
        return probabilities
    total = sum(max(0.0, float(value or 0)) for value in probabilities)
    if total <= 0:
        return probabilities
    normalized = [max(0.0, float(value or 0)) / total for value in probabilities]
    max_index = max(range(len(normalized)), key=normalized.__getitem__)
    if normalized[max_index] < 0.995 or len(normalized) <= 1:
        return normalized
    capped_confidence = max(0.55, min(float(confidence_cap or 0.9), 0.97))
    max_index = predicted_index if 0 <= predicted_index < len(normalized) else max_index
    excess = normalized[max_index] - capped_confidence
    if excess <= 0:
        return normalized
    normalized[max_index] = capped_confidence
    other_indexes = [index for index in range(len(normalized)) if index != max_index]
    other_total = sum(normalized[index] for index in other_indexes)
    for index in other_indexes:
        share = normalized[index] / other_total if other_total else 1 / len(other_indexes)
        normalized[index] += excess * share
    return normalized


def engagement_trend_from_delta(delta: float) -> str:
    if delta <= -8:
        return "declining"
    if delta >= 8:
        return "improving"
    return "stable"


async def class_students(db: AsyncIOMotorDatabase, class_id: str) -> list[dict]:
    memberships = await db[MongoCollections.class_memberships].find(
        {"class_id": class_id, "role": "student", "status": "active"}
    ).to_list(length=None)
    user_ids = [row.get("user_id") for row in memberships if row.get("user_id")]
    users = await db[MongoCollections.users].find({"user_id": {"$in": user_ids}}).to_list(length=None)
    users_by_id = {row["user_id"]: serialize_document(row) for row in users if row.get("user_id")}
    return [users_by_id.get(user_id, {"user_id": user_id, "name": "Student"}) for user_id in user_ids]


async def class_questions(db: AsyncIOMotorDatabase, sessions: list[dict]) -> dict[str, dict]:
    question_ids = sorted({question_id for session in sessions for question_id in session.get("question_ids", []) if question_id})
    if not question_ids:
        return {}
    generated = await db[MongoCollections.generated_questions].find({"question_id": {"$in": question_ids}}).to_list(length=None)
    approved = await db[MongoCollections.approved_questions].find({"question_id": {"$in": question_ids}}).to_list(length=None)
    questions = {row["question_id"]: serialize_document(row) for row in generated if row.get("question_id")}
    questions.update({row["question_id"]: serialize_document(row) for row in approved if row.get("question_id")})
    return questions


def session_question_count(sessions: list[dict]) -> int:
    return sum(len(session.get("question_ids", [])) for session in sessions)


async def leaderboard_ranks(db: AsyncIOMotorDatabase, class_id: str) -> dict[str, int]:
    rows = await db[MongoCollections.student_gamification_profiles].find(
        {"scope": "class", "class_id": class_id}
    ).sort([("xp", -1), ("stars", -1), ("student_id", 1)]).to_list(length=None)
    return {row.get("student_id"): index for index, row in enumerate(rows, start=1) if row.get("student_id")}


async def build_prediction_features_for_class(db: AsyncIOMotorDatabase, class_id: str) -> list[dict]:
    students = await class_students(db, class_id)
    sessions = [serialize_document(row) for row in await db[MongoCollections.sessions].find({"class_id": class_id}).to_list(length=None)]
    session_ids = [session["session_id"] for session in sessions if session.get("session_id")]
    finished_sessions = {session["session_id"] for session in sessions if session.get("status") in {"closed", "finished"}}
    questions_by_id = await class_questions(db, sessions)
    total_sessions = len(sessions)
    total_questions = session_question_count(sessions)
    responses = [serialize_document(row) for row in await db[MongoCollections.responses].find({"session_id": {"$in": session_ids}}).to_list(length=None)] if session_ids else []
    participation = [serialize_document(row) for row in await db[MongoCollections.participation_records].find({"class_id": class_id}).to_list(length=None)]
    analytics_rows = [serialize_document(row) for row in await db[MongoCollections.analytics_results].find({"class_id": class_id}).to_list(length=None)]
    profiles = await db[MongoCollections.student_gamification_profiles].find({"scope": "class", "class_id": class_id}).to_list(length=None)
    badges = await db[MongoCollections.student_badges].find({"class_id": class_id}).to_list(length=None)
    missions = await db[MongoCollections.student_missions].find({"class_id": class_id}).to_list(length=None)
    challenge_progress = await db[MongoCollections.student_challenge_progress].find({"class_id": class_id}).to_list(length=None)
    events = [serialize_document(row) for row in await db[MongoCollections.gamification_events].find({"class_id": class_id}).to_list(length=None)]
    ranks = await leaderboard_ranks(db, class_id)

    responses_by_student: dict[str, list[dict]] = defaultdict(list)
    for row in responses:
        if row.get("student_id"):
            responses_by_student[row["student_id"]].append(row)

    participation_by_student: dict[str, list[dict]] = defaultdict(list)
    for row in participation:
        if row.get("student_id"):
            participation_by_student[row["student_id"]].append(row)

    analytics_by_student: dict[str, list[dict]] = defaultdict(list)
    for row in analytics_rows:
        if row.get("student_id"):
            analytics_by_student[row["student_id"]].append(row)

    profiles_by_student = {row.get("student_id"): serialize_document(row) for row in profiles if row.get("student_id")}
    badge_count_by_student = Counter(row.get("student_id") for row in badges if row.get("student_id"))
    missions_completed_by_student = Counter(row.get("student_id") for row in missions if row.get("student_id") and row.get("completed"))
    challenges_completed_by_student = Counter(row.get("student_id") for row in challenge_progress if row.get("student_id") and row.get("completed"))
    events_by_student: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        if event.get("student_id"):
            events_by_student[event["student_id"]].append(event)

    generated_at = utc_now()
    features = []
    for student in students:
        student_id = student["user_id"]
        student_responses = responses_by_student.get(student_id, [])
        student_events = events_by_student.get(student_id, [])
        student_analytics = latest_analytics(analytics_by_student.get(student_id, []))
        profile = profiles_by_student.get(student_id, {})

        joined_session_ids = {
            row.get("session_id")
            for row in student_responses
            if row.get("session_id")
        } | {
            row.get("session_id")
            for row in participation_by_student.get(student_id, [])
            if row.get("session_id")
        } | {
            row.get("session_id")
            for row in student_events
            if row.get("event_type") == "join_session" and row.get("session_id")
        }
        answered_question_keys = {
            (row.get("session_id"), row.get("question_id"))
            for row in student_responses
            if row.get("session_id") and row.get("question_id")
        }
        correct_responses = [row for row in student_responses if response_is_correct(row)]
        partial_responses = [row for row in student_responses if response_is_partial(row)]
        review_responses = [row for row in student_responses if response_needs_review(row)]
        response_times = [
            float(row.get("response_time_seconds") or row.get("response_time_placeholder") or 0)
            for row in student_responses
            if row.get("response_time_seconds") or row.get("response_time_placeholder")
        ]
        fast_answers = [value for value in response_times if value <= 15]
        semantic_scores = [
            float(score)
            for row in student_responses
            if (score := final_response_score(row)) is not None
        ]
        mcq_responses = [row for row in student_responses if questions_by_id.get(row.get("question_id"), {}).get("type") == "mcq"]
        short_responses = [row for row in student_responses if questions_by_id.get(row.get("question_id"), {}).get("type") == "short_answer"]

        concept_totals: dict[str, list[int]] = defaultdict(list)
        for response in student_responses:
            concept = question_bloom_level(questions_by_id.get(response.get("question_id")))
            if concept:
                concept_totals[concept].append(1 if response_is_correct(response) else 0)
        concept_correctness_map = {
            concept: round(sum(values) / len(values), 4)
            for concept, values in concept_totals.items()
            if values
        }
        concept_answer_counts = {concept: len(values) for concept, values in concept_totals.items() if values}
        concept_correct_answer_counts = {concept: sum(values) for concept, values in concept_totals.items() if values}
        bloom_mastery_by_level = bloom_mastery_by_level_value(
            {
                "concept_correctness_map": concept_correctness_map,
                "concept_answer_counts": concept_answer_counts,
                "concept_correct_answer_counts": concept_correct_answer_counts,
            }
        )
        weak_concepts = [
            concept
            for concept, row in bloom_mastery_by_level.items()
            if row["is_mastery_gap"]
        ]

        event_dates = [as_datetime(row.get("created_at")) for row in student_events]
        response_dates = [as_datetime(row.get("submitted_at")) for row in student_responses]
        active_dates = [value.date().isoformat() for value in event_dates + response_dates if value]
        now = utc_now()
        recent_cutoff = now - timedelta(days=7)
        previous_cutoff = now - timedelta(days=14)
        activity_last_7 = sum(1 for value in event_dates + response_dates if value and value >= recent_cutoff)
        activity_previous_7 = sum(1 for value in event_dates + response_dates if value and previous_cutoff <= value < recent_cutoff)
        engagement_trend_delta = float(activity_last_7 - activity_previous_7)

        questions_answered = len(answered_question_keys)
        consistency_score = float(student_analytics.get("consistency_rate") or percent(len(joined_session_ids), total_sessions))
        participation_rate = float(student_analytics.get("participation_rate") or percent(questions_answered, total_questions))
        average_response_time = average(response_times)
        correctness_rate = float(student_analytics.get("correctness_rate") or percent(len(correct_responses), questions_answered))
        semantic_score = average(semantic_scores)
        attendance_rate = float(student_analytics.get("attendance_rate") or percent(len(joined_session_ids), total_sessions))
        recent_activity_count = activity_last_7
        engagement_score = clamp(
            (0.35 * attendance_rate)
            + (0.25 * participation_rate)
            + (0.25 * correctness_rate)
            + (0.10 * consistency_score)
            + (0.05 * min(recent_activity_count * 10, 100))
        )
        feature = {
            "feature_id": f"prediction_feature_{student_id}_{class_id}",
            "student_id": student_id,
            "student_name": student.get("name") or "Student",
            "class_id": class_id,
            "sessions_joined": len(joined_session_ids),
            "total_sessions": total_sessions,
            "attendance_rate": attendance_rate,
            "questions_answered": questions_answered,
            "total_questions": total_questions,
            "answer_rate": participation_rate,
            "participation_rate": participation_rate,
            "missed_questions_count": max(total_questions - questions_answered, 0),
            "average_response_time": average_response_time,
            "response_time": average_response_time,
            "fast_answer_rate": percent(len(fast_answers), len(response_times)),
            "correct_answers_count": len(correct_responses),
            "correctness_rate": correctness_rate,
            "partial_answers_count": len(partial_responses),
            "needs_review_count": len(review_responses),
            "average_semantic_score": semantic_score,
            "semantic_score": semantic_score,
            "engagement_score": engagement_score,
            "mcq_correctness_rate": percent(sum(1 for row in mcq_responses if response_is_correct(row)), len(mcq_responses)),
            "short_answer_correctness_rate": percent(sum(1 for row in short_responses if response_is_correct(row)), len(short_responses)),
            "weak_concepts_count": len(weak_concepts),
            "active_days_count": len(set(active_dates)),
            "recent_activity_count": recent_activity_count,
            "activity_last_7_days": recent_activity_count,
            "activity_previous_7_days": activity_previous_7,
            "engagement_trend_delta": engagement_trend_delta,
            "consistency_score": consistency_score,
            "response_consistency": consistency_score,
            "session_completion_rate": percent(len(joined_session_ids & finished_sessions), max(len(finished_sessions), 1)),
            "xp": int(profile.get("xp") or 0),
            "level": int(profile.get("level") or 1),
            "stars": int(profile.get("stars") or 0),
            "badges_count": int(profile.get("badges_count") or badge_count_by_student.get(student_id, 0)),
            "streak": int(profile.get("current_streak") or profile.get("streak") or 0),
            "longest_streak": int(profile.get("longest_streak") or 0),
            "missions_completed": int(missions_completed_by_student.get(student_id, 0)),
            "challenges_completed": int(challenges_completed_by_student.get(student_id, 0)),
            "leaderboard_rank": ranks.get(student_id),
            "weak_concepts": weak_concepts,
            "weakest_concept": min(concept_correctness_map, key=concept_correctness_map.get) if concept_correctness_map else None,
            "concept_correctness_map": concept_correctness_map,
            "concept_answer_counts": concept_answer_counts,
            "concept_correct_answer_counts": concept_correct_answer_counts,
            "bloom_mastery_by_level": bloom_mastery_by_level,
            "feature_schema_version": FEATURE_SCHEMA_VERSION,
            "generated_at": generated_at,
        }
        features.append(feature)
    return features


def fallback_prediction(feature: dict, class_averages: dict[str, float]) -> dict:
    reasons: list[str] = []
    actions: list[str] = []
    importance: list[dict] = []
    attendance_rate = float(feature.get("attendance_rate") or 0)
    correctness_rate = float(feature.get("correctness_rate") or 0)
    answer_rate = float(feature.get("answer_rate") or feature.get("participation_rate") or 0)
    severe_core_gap = attendance_rate < 50 and correctness_rate < 50

    contributions = {
        "attendance_rate": max(0, 60 - attendance_rate) * 0.35,
        "correctness_rate": max(0, 60 - correctness_rate) * 0.35,
        "participation_rate": max(0, 60 - answer_rate) * 0.2,
        "recent_activity_count": 12 if int(feature.get("recent_activity_count") or 0) == 0 else 0,
        "consistency_score": max(0, 60 - float(feature.get("consistency_score") or 0)) * 0.12,
        "weak_concepts_count": min(int(feature.get("weak_concepts_count") or 0) * 8, 24),
    }
    risk_score = clamp(sum(contributions.values()))
    risk_level = risk_level_from_score(risk_score)
    engagement_index = derived_engagement_index(feature)
    confidence = fallback_confidence_from_risk_score(risk_score, risk_level)
    if severe_core_gap:
        reasons.append("Low attendance and correctness together indicate urgent support")
        actions.append("Schedule a direct check-in and review missed concepts before the next session")
    if attendance_rate < 60:
        reasons.append("Low attendance rate")
        actions.append("Send a supportive check-in and encourage joining the next live session")
    if correctness_rate < 50:
        reasons.append("Correctness is below the expected range")
        actions.append("Assign a short reinforcement activity on recent questions")
    if correctness_rate < class_averages.get("correctness_rate", 0) - 10:
        reasons.append("Correctness below class average")
    if float(feature.get("engagement_trend_delta") or 0) < 0:
        reasons.append("Declining activity in the last 7 days")
        actions.append("Monitor the next live session participation")
    if int(feature.get("recent_activity_count") or 0) == 0:
        reasons.append("No recent learning activity")
    if int(feature.get("weak_concepts_count") or 0) > 0:
        concept = feature.get("weakest_concept") or "a recent Bloom level"
        reasons.append(f"Bloom mastery below threshold in {concept}")
        actions.append(f"Review {concept} with an extra explanation or example")
    if not reasons:
        reasons.append("Learning signals are currently steady")
        actions.append("Keep reinforcing participation and timely feedback")

    for name, value in sorted(contributions.items(), key=lambda item: item[1], reverse=True):
        if value > 0:
            if name in PREDICTION_FEATURE_COLUMNS:
                importance.append({"feature": name, "importance": round(value, 4)})

    return {
        "engagement_index": engagement_index,
        "derived_engagement_index": engagement_index,
        "risk_probability": round(risk_score / 100, 4),
        "risk_score": risk_score,
        "academic_status": academic_status_from_risk(risk_level),
        "engagement_status": engagement_status_from_index(engagement_index),
        "risk_level": risk_level,
        "engagement_trend": engagement_trend_from_delta(float(feature.get("engagement_trend_delta") or 0)),
        "confidence": confidence,
        "model_type": "explainable_baseline",
        "risk_reasons": reasons[:5],
        "recommended_actions": list(dict.fromkeys(actions))[:5],
        "feature_importance": importance[:8],
        "predicted_score": engagement_index,
        "predicted_performance": engagement_index,
        "performance_level": engagement_level_from_index(engagement_index),
        "model_confidence": confidence,
        "reasons": reasons[:5],
    }


def ml_prediction(feature: dict, model_bundle: Any) -> dict | None:
    if not model_bundle:
        return None
    try:
        normalized_feature = normalize_inference_features(feature)
        feature_columns = [
            column
            for column in (model_bundle.feature_columns or PREDICTION_FEATURE_COLUMNS)
            if column in PREDICTION_FEATURE_COLUMNS
        ]
        if feature_columns != PREDICTION_FEATURE_COLUMNS:
            return None
        risk_labels = model_bundle.risk_labels or ["low", "medium", "high"]
        vector = [feature_vector(normalized_feature, feature_columns)]
        model = model_bundle.model
        probabilities = []
        if hasattr(model, "predict_proba"):
            probabilities = [float(value) for value in model.predict_proba(vector)[0]]
        raw_prediction = model.predict(vector)[0] if hasattr(model, "predict") else 0
        try:
            predicted_index = int(raw_prediction)
            risk_level = risk_labels[predicted_index]
        except (TypeError, ValueError, IndexError):
            risk_level = str(raw_prediction).lower().replace(" risk", "")
            predicted_index = risk_labels.index(risk_level) if risk_level in risk_labels else 0
        per_student_confidence = feature_based_confidence(normalized_feature, risk_level)
        if not probabilities:
            probabilities = conservative_probabilities(predicted_index, len(risk_labels), per_student_confidence)
        probabilities = soften_extreme_probabilities(probabilities, predicted_index, per_student_confidence)
        weights = {"low": 15.0, "medium": 55.0, "high": 90.0}
        risk_score = clamp(sum(probabilities[index] * weights.get(label, 50.0) for index, label in enumerate(risk_labels)))
        engagement_index = derived_engagement_index(normalized_feature)
        high_risk_probability = probabilities[risk_labels.index("high")] if "high" in risk_labels else max(probabilities)
        elevated_risk_probability = sum(
            probabilities[index]
            for index, label in enumerate(risk_labels)
            if label in {"medium", "high"}
        )
        confidence = bounded_model_confidence(probabilities[predicted_index] if probabilities and predicted_index < len(probabilities) else 0.0)
        reasons = [
            f"XGBoost model predicted {risk_level} academic risk",
            f"High-risk probability: {round(high_risk_probability * 100, 2)}%",
        ]
        xai = local_shap_explanation(model_bundle, normalized_feature, risk_level)
        return {
            "engagement_index": engagement_index,
            "derived_engagement_index": engagement_index,
            "risk_probability": round(elevated_risk_probability, 4),
            "risk_probabilities": {
                label: round(probabilities[index], 4)
                for index, label in enumerate(risk_labels)
            },
            "risk_score": risk_score,
            "academic_status": academic_status_from_risk(risk_level),
            "engagement_status": engagement_status_from_index(engagement_index),
            "risk_level": risk_level,
            "engagement_trend": engagement_trend_from_delta(float(normalized_feature.get("engagement_trend_delta") or 0)),
            "confidence": round(confidence, 4),
            "model_type": model_bundle.model_type,
            "risk_reasons": reasons,
            "recommended_actions": ["Review model feature importance and current learning signals before acting"],
            "feature_importance": model_feature_importance(model, feature_columns),
            "xai": xai,
            "predicted_score": engagement_index,
            "predicted_performance": engagement_index,
            "performance_level": engagement_level_from_index(engagement_index),
            "model_confidence": round(confidence, 4),
            "reasons": reasons,
        }
    except Exception:
        return None


def class_average_features(features: list[dict]) -> dict[str, float]:
    return {
        "attendance_rate": average([row.get("attendance_rate", 0) for row in features]),
        "correctness_rate": average([row.get("correctness_rate", 0) for row in features]),
        "answer_rate": average([row.get("answer_rate", 0) for row in features]),
    }


def risk_distribution(results: list[dict]) -> dict[str, int]:
    counts = Counter(row.get("risk_level", "low") for row in results)
    return {"low": counts.get("low", 0), "medium": counts.get("medium", 0), "high": counts.get("high", 0)}


def prediction_reasons(row: dict) -> list[str]:
    return row.get("risk_reasons") or row.get("reasons") or []


RISK_DRIVER_LABELS = {
    "attendance_rate": "Attendance",
    "correctness_rate": "Correctness",
    # Backward-compatible feature name. This is a descriptive Bloom mastery
    # feature derived from answer correctness, not a model-predicted Bloom level.
    "weak_concepts_count": "Bloom Mastery Gaps",
    "participation_rate": "Participation",
    "semantic_score": "Semantic Score",
    "engagement_score": "Engagement",
    "recent_activity_count": "Recent Activity",
    "consistency_score": "Consistency",
    "response_time": "Response Time",
}


def driver_label(feature_name: str) -> str:
    normalized = feature_name.lower()
    for key, label in RISK_DRIVER_LABELS.items():
        if key in normalized:
            return label
    return feature_name.replace("_", " ").title()


def prediction_signal_value(row: dict, *names: str) -> float:
    sources = [row.get("features") or {}, row.get("model_feature_values") or {}, row]
    for source in sources:
        for name in names:
            value = source.get(name)
            if value is None:
                continue
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
    return 0.0


def student_risk_factors(row: dict) -> set[str]:
    factors: set[str] = set()
    attendance = prediction_signal_value(row, "attendance_rate")
    participation = prediction_signal_value(row, "participation_rate", "answer_rate")
    correctness = prediction_signal_value(row, "correctness_rate")
    engagement = prediction_signal_value(row, "engagement_score", "engagement_index", "derived_engagement_index")
    recent_activity = prediction_signal_value(row, "recent_activity_count", "activity_last_7_days")
    weak_concepts = len(tested_bloom_gap_levels(row.get("features") or row))
    response_time = prediction_signal_value(row, "response_time", "average_response_time")

    if engagement < 60:
        factors.add("Low engagement")
    if attendance < 60:
        factors.add("Poor attendance")
    if correctness < 60:
        factors.add("Low correctness")
    if participation < 60:
        factors.add("Low participation")
    if recent_activity <= 0:
        factors.add("Recent inactivity")
    if weak_concepts > 0:
        factors.add("Bloom mastery gaps")
    if response_time > 90:
        factors.add("Slow response behavior")
    return factors


def top_risk_drivers(results: list[dict]) -> list[dict]:
    flagged = [row for row in results if row.get("risk_level") in {"medium", "high"}]
    if not flagged:
        return []

    affected_students: dict[str, set[str]] = defaultdict(set)
    for row in flagged:
        student_id = str(row.get("student_id") or row.get("prediction_id") or "")
        for factor in student_risk_factors(row):
            affected_students[factor].add(student_id)

    total = len(flagged)
    preferred_order = [
        "Low engagement",
        "Poor attendance",
        "Bloom mastery gaps",
        "Low correctness",
        "Low participation",
        "Recent inactivity",
        "Slow response behavior",
    ]
    rows = [
        {
            "driver": label,
            "affected_students": len(students),
            "total_flagged_students": total,
            "percentage": round((len(students) / total) * 100, 1),
            "source": "flagged_student_indicators",
            "calculation": "Percentage of medium/high risk students with this learning indicator.",
        }
        for label, students in affected_students.items()
        if students
    ]
    return sorted(rows, key=lambda row: (-row["percentage"], preferred_order.index(row["driver"]) if row["driver"] in preferred_order else 99))[:5]


def prediction_diagnostics_enabled() -> bool:
    environment = str(os.getenv("ENV") or os.getenv("APP_ENV") or "").strip().lower()
    debug_flag = str(os.getenv("PREDICTION_DEBUG") or "").strip().lower()
    return environment in {"development", "dev", "local"} or debug_flag in {"1", "true", "yes", "on"}


def numeric_distribution(values: list[float]) -> dict[str, float | None]:
    clean = [float(value) for value in values if isinstance(value, (int, float))]
    if not clean:
        return {"min": None, "mean": None, "max": None}
    return {
        "min": round(min(clean), 2),
        "mean": round(mean(clean), 2),
        "max": round(max(clean), 2),
    }


def log_inference_normalization_diagnostics(class_id: str, results: list[dict]) -> None:
    if not prediction_diagnostics_enabled():
        return
    counts = Counter(str(row.get("risk_level") or "").lower() for row in results)
    model_features = [row.get("model_feature_values") or {} for row in results]
    logger.info(
        "Prediction normalization diagnostics for class %s: counts=%s response_time=%s semantic_score=%s",
        class_id,
        {
            "low": counts.get("low", 0),
            "medium": counts.get("medium", 0),
            "high": counts.get("high", 0),
        },
        numeric_distribution([row.get("response_time") for row in model_features]),
        numeric_distribution([row.get("semantic_score") for row in model_features]),
    )


def log_identical_confidence_if_needed(class_id: str, results: list[dict]) -> None:
    if len(results) < 2:
        return
    confidences = {round(float(row.get("confidence") or 0), 4) for row in results}
    if len(confidences) > 1:
        return
    samples = [
        {
            "student_id": row.get("student_id"),
            "confidence": row.get("confidence"),
            "risk_level": row.get("risk_level"),
            "features": row.get("model_feature_values"),
            "probabilities": row.get("risk_probabilities"),
        }
        for row in results[:3]
    ]
    logger.warning("Identical prediction confidence for class %s: %s", class_id, samples)


def teaching_action_label(action: str) -> str:
    normalized = action.lower()
    if "check-in" in normalized or "check in" in normalized:
        return "Schedule a check-in with struggling students"
    if "attendance" in normalized or "joining" in normalized or "live session" in normalized or "participation" in normalized or "monitor" in normalized:
        return "Monitor participation in the next session"
    if "reinforcement" in normalized or "practice" in normalized or "activity" in normalized:
        return "Assign reinforcement activity"
    if "review" in normalized or "revisit" in normalized or "concept" in normalized:
        return "Review Bloom-level mastery"
    if "example" in normalized or "explanation" in normalized:
        return "Provide additional examples"
    return action


def recommendation_summary(results: list[dict], weak_concepts: list[dict]) -> list[dict]:
    actions: Counter[str] = Counter()
    affected_students: dict[str, set[str]] = defaultdict(set)
    for row in results:
        student_id = row.get("student_id")
        for action in row.get("recommended_actions", []):
            label = teaching_action_label(str(action))
            actions[label] += 1
            if student_id:
                affected_students[label].add(student_id)

    for concept in weak_concepts:
        if concept.get("concept"):
            concept_name = str(concept["concept"]).strip()
            label = f"Review Bloom-level mastery in {concept_name}"
            actions[label] += int(concept.get("weak_students_count") or 0)
            affected_students[label].update(str(student_id) for student_id in concept.get("affected_students") or [])

    preferred = [
        "Monitor participation in the next session",
        "Schedule a check-in with struggling students",
        "Review Bloom-level mastery",
        "Assign reinforcement activity",
        "Provide additional examples",
    ]
    rows = [
        {"action": action, "count": max(len(affected_students[action]), count)}
        for action, count in actions.items()
    ]
    return sorted(rows, key=lambda row: (preferred.index(row["action"]) if row["action"] in preferred else 99, -row["count"], row["action"]))[:8]


async def detect_weak_concepts(db: AsyncIOMotorDatabase, class_id: str, features: list[dict]) -> list[dict]:
    concepts: dict[str, list[dict]] = defaultdict(list)
    for feature in features:
        for concept, correctness in feature.get("concept_correctness_map", {}).items():
            if str(concept).strip().lower() in BLOOM_LEVEL_LABELS:
                answered = int((feature.get("concept_answer_counts") or {}).get(concept) or 0)
                correct = int((feature.get("concept_correct_answer_counts") or {}).get(concept) or 0)
                if answered <= 0:
                    continue
                concepts[concept].append(
                    {
                        "student_id": feature["student_id"],
                        "questions_answered": answered,
                        "correct_answers": correct,
                        "mastery_rate": percent(correct, answered),
                    }
                )

    generated_at = utc_now()
    docs = []
    for concept, rows in concepts.items():
        if not rows:
            continue
        total_questions_answered = sum(row["questions_answered"] for row in rows)
        correct_answers = sum(row["correct_answers"] for row in rows)
        mastery_rate = percent(correct_answers, total_questions_answered)
        affected = [row["student_id"] for row in rows if row["mastery_rate"] < MASTERY_THRESHOLD]
        if mastery_rate >= MASTERY_THRESHOLD and not affected:
            continue
        status = bloom_mastery_status(mastery_rate)
        risk_level = "high" if status == "Needs Improvement" else "medium"
        docs.append(
            {
                "weak_concept_prediction_id": f"weak_concept_{class_id}_{concept.lower().replace(' ', '_')}",
                "class_id": class_id,
                "concept": concept,
                "bloom_level": concept,
                "total_questions_answered": total_questions_answered,
                "correct_answers": correct_answers,
                "mastery_rate": mastery_rate,
                "mastery_threshold": MASTERY_THRESHOLD,
                "mastery_status": status,
                "average_correctness": round(mastery_rate / 100, 4),
                "weak_students_count": len(affected),
                "affected_students_count": len(affected),
                "affected_students": affected,
                "affected_classes": 1 if mastery_rate < MASTERY_THRESHOLD else 0,
                "risk_level": risk_level,
                "recommended_action": f"Revisit {concept} with a short example and follow-up question",
                "source": "descriptive_bloom_mastery",
                "generated_at": generated_at,
            }
        )

    await db[MongoCollections.weak_concept_predictions].delete_many({"class_id": class_id})
    if docs:
        await db[MongoCollections.weak_concept_predictions].insert_many(docs)
    return docs


async def run_prediction_pipeline_for_class(db: AsyncIOMotorDatabase, class_id: str) -> dict:
    features = await build_prediction_features_for_class(db, class_id)
    generated_at = utc_now()
    existing_predictions = [
        serialize_document(row)
        for row in await db[MongoCollections.prediction_results].find({"class_id": class_id}).to_list(length=None)
    ]
    previous_by_student: dict[str, dict] = {}
    for row in existing_predictions:
        student_id = row.get("student_id")
        if not student_id:
            continue
        current_date = as_datetime(row.get("generated_at") or row.get("predicted_at")) or datetime.min.replace(tzinfo=timezone.utc)
        existing = previous_by_student.get(student_id)
        existing_date = as_datetime(existing.get("generated_at") or existing.get("predicted_at")) if existing else None
        if not existing or current_date >= (existing_date or datetime.min.replace(tzinfo=timezone.utc)):
            previous_by_student[student_id] = row
    await db[MongoCollections.prediction_features].delete_many({"class_id": class_id})
    if features:
        await db[MongoCollections.prediction_features].insert_many(features)

    model_bundle = load_prediction_model()
    averages = class_average_features(features)
    results = []
    for feature in features:
        normalized_feature = normalize_inference_features(feature)
        prediction = ml_prediction(feature, model_bundle) or fallback_prediction(feature, averages)
        confidence = predicted_class_confidence(prediction)
        results.append(
            {
                "prediction_id": f"prediction_{feature['student_id']}_{class_id}",
                "student_id": feature["student_id"],
                "student_name": feature.get("student_name", "Student"),
                "class_id": class_id,
                "engagement_index": prediction["engagement_index"],
                "derived_engagement_index": prediction["derived_engagement_index"],
                "risk_probability": prediction["risk_probability"],
                "risk_probabilities": prediction.get("risk_probabilities"),
                "risk_score": prediction["risk_score"],
                "risk_level": prediction["risk_level"],
                "confidence": confidence,
                "engagement_status": prediction["engagement_status"],
                "academic_status": prediction["academic_status"],
                "engagement_trend": prediction["engagement_trend"],
                "model_type": prediction["model_type"],
                "risk_reasons": prediction["risk_reasons"],
                "recommended_actions": prediction["recommended_actions"],
                "feature_importance": prediction["feature_importance"],
                "xai": prediction.get("xai"),
                "model_feature_values": model_feature_values(normalized_feature),
                "engagement_context": engagement_context(feature),
                # Compatibility aliases. The score is a behavioral engagement index,
                # not a predicted exam mark.
                "predicted_score": prediction["engagement_index"],
                "predicted_performance": prediction["engagement_index"],
                "performance_level": prediction["performance_level"],
                "model_confidence": confidence,
                "reasons": prediction["risk_reasons"],
                "features": feature,
                "previous_prediction": previous_prediction_snapshot(previous_by_student.get(feature["student_id"])),
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
                "generated_at": generated_at,
                "predicted_at": generated_at,
            }
        )

    await db[MongoCollections.prediction_results].delete_many({"class_id": class_id})
    if results:
        log_identical_confidence_if_needed(class_id, results)
        log_inference_normalization_diagnostics(class_id, results)
        await db[MongoCollections.prediction_results].insert_many(results)
    weak_concepts = await detect_weak_concepts(db, class_id, features)

    metadata = MODEL_METADATA | {
        "model_version": model_bundle.model_version if model_bundle else MODEL_METADATA["model_version"],
        "model_type": model_bundle.model_type if model_bundle else "explainable_baseline",
        "model_name": model_bundle.model_name if model_bundle else MODEL_METADATA["model_name"],
        "feature_columns": model_bundle.feature_columns if model_bundle else PREDICTION_FEATURE_COLUMNS,
        "risk_labels": model_bundle.risk_labels if model_bundle else ["low", "medium", "high"],
        "metrics": model_bundle.metrics if model_bundle else MODEL_METADATA["metrics"],
        "updated_at": generated_at,
    }
    await db[MongoCollections.prediction_model_metadata].update_one(
        {"model_name": metadata["model_name"], "model_version": metadata["model_version"]},
        {"$set": metadata},
        upsert=True,
    )

    return {
        "class_id": class_id,
        "students_processed": len(features),
        "predictions_created": len(results),
        "weak_concepts_detected": len(weak_concepts),
        "model_type": metadata["model_type"],
        "generated_at": generated_at,
    }


async def class_prediction_summary(db: AsyncIOMotorDatabase, class_id: str) -> dict:
    results = [serialize_document(row) for row in await db[MongoCollections.prediction_results].find({"class_id": class_id}).to_list(length=None)]
    for row in results:
        confidence = predicted_class_confidence(row)
        row["confidence"] = confidence
        row["model_confidence"] = confidence
    class_doc = serialize_document(await db[MongoCollections.classes].find_one({"class_id": class_id}) or {})
    class_names = {class_id: class_doc.get("name") or class_doc.get("class_name") or class_id}
    class_meta = {class_id: class_doc}
    student_reports = [
        prediction_report_payload(row, class_names=class_names, class_meta=class_meta)
        for row in sorted(results, key=lambda item: (str(item.get("student_name") or ""), str(item.get("student_id") or "")))
    ]
    weak_concepts = [serialize_document(row) for row in await db[MongoCollections.weak_concept_predictions].find({"class_id": class_id}).sort("weak_students_count", -1).to_list(length=20)]
    at_risk = [row for row in student_reports if row.get("risk_level") in {"medium", "high"}]
    generated_at = max([as_datetime(row.get("generated_at")) for row in results if as_datetime(row.get("generated_at"))] or [None])
    trends = Counter(row.get("engagement_trend", "stable") for row in results)
    return {
        "class_id": class_id,
        "risk_distribution": risk_distribution(results),
        "predictions": student_reports,
        "student_reports": student_reports,
        "at_risk_students": sorted(at_risk, key=lambda row: row.get("risk_score", 0), reverse=True)[:20],
        "weak_concepts": weak_concepts,
        "engagement_trends": dict(trends),
        "recommendation_summary": recommendation_summary(results, weak_concepts),
        "generated_at": generated_at,
        "model_type": results[0].get("model_type") if results else "not_run",
        "top_risk_drivers": top_risk_drivers(results),
        "empty": len(results) == 0,
    }


async def student_prediction(db: AsyncIOMotorDatabase, student_id: str, class_id: str) -> dict:
    row = await db[MongoCollections.prediction_results].find_one(
        {"student_id": student_id, "class_id": class_id},
        sort=[("generated_at", -1)],
    )
    if not row:
        return {"student_id": student_id, "class_id": class_id, "empty": True}
    clean = serialize_document(row)
    class_doc = serialize_document(await db[MongoCollections.classes].find_one({"class_id": class_id}) or {})
    clean = prediction_report_payload(
        clean,
        class_names={class_id: class_doc.get("name") or class_doc.get("class_name") or class_id},
        class_meta={class_id: class_doc},
    )
    level = clean.get("risk_level", "low")
    clean["risk_reasons"] = prediction_reasons(clean)
    clean["confidence"] = predicted_class_confidence(clean)
    clean["model_confidence"] = clean["confidence"]
    clean["engagement_index"] = clean.get("engagement_index", clean.get("derived_engagement_index", clean.get("predicted_score", 0)))
    clean["derived_engagement_index"] = clean.get("derived_engagement_index", clean["engagement_index"])
    clean["engagement_status"] = clean.get("engagement_status", engagement_status_from_index(float(clean["engagement_index"] or 0)))
    clean["academic_status"] = clean.get("academic_status", academic_status_from_risk(level))
    clean["support_label"] = {"high": "Needs attention", "medium": "Worth monitoring", "low": "On track"}.get(level, "On track")
    clean["student_message"] = "These signals are guidance for your learning progress, not a final judgment."
    return clean


async def admin_prediction_overview(db: AsyncIOMotorDatabase) -> dict:
    results = [serialize_document(row) for row in await db[MongoCollections.prediction_results].find({}).to_list(length=None)]
    weak_concepts = [serialize_document(row) for row in await db[MongoCollections.weak_concept_predictions].find({}).to_list(length=None)]
    classes = {row.get("class_id") for row in results if row.get("class_id")}
    high_risk = [row for row in results if row.get("risk_level") == "high"]
    declining_classes = {
        row.get("class_id")
        for row in results
        if row.get("class_id") and row.get("engagement_trend") == "declining"
    }
    weak_classes = {
        row.get("class_id")
        for row in weak_concepts
        if row.get("class_id") and float(row.get("mastery_rate") if row.get("mastery_rate") is not None else float(row.get("average_correctness") or 0) * 100) < MASTERY_THRESHOLD
    }
    recent_alerts = sorted(
        [
            {
                "class_id": row.get("class_id"),
                "student_id": row.get("student_id"),
                "student_name": row.get("student_name", "Student"),
                "risk_level": row.get("risk_level"),
                "risk_score": row.get("risk_score"),
                "reason": (prediction_reasons(row) or ["Prediction alert"])[0],
                "generated_at": row.get("generated_at"),
            }
            for row in results
            if row.get("risk_level") in {"medium", "high"}
        ],
        key=lambda row: row.get("risk_score") or 0,
        reverse=True,
    )[:12]
    return {
        "total_classes_analyzed": len(classes),
        "weak_classes": len(weak_classes),
        "high_risk_student_count": len(high_risk),
        "classes_with_engagement_decline": len(declining_classes),
        "recent_prediction_alerts": recent_alerts,
        "generated_at": utc_now(),
        "empty": len(results) == 0,
    }


async def recalculate_class_predictions(db: AsyncIOMotorDatabase, class_id: str) -> dict:
    return await run_prediction_pipeline_for_class(db, class_id)
