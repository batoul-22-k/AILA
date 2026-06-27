from datetime import datetime
from typing import Any


VALID_SEMANTIC_LABELS = {"correct", "partial", "incorrect"}


def normalize_score(value: Any) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.0
    return round(max(0.0, min(1.0, score)), 4)


def normalize_label(value: Any) -> str:
    label = str(value or "").strip().lower()
    return label if label in VALID_SEMANTIC_LABELS else "incorrect"


def ai_evaluation_from_result(result: dict, evaluated_at: datetime | None = None) -> dict:
    final_score = normalize_score(result.get("final_score", result.get("semantic_score", 0.0)))
    return {
        "semanticSimilarity": normalize_score(result.get("semantic_similarity", result.get("semantic_score", final_score))),
        "conceptCoverage": normalize_score(result.get("concept_coverage", 0.0)),
        "finalScore": final_score,
        "label": normalize_label(result.get("semantic_label")),
        "engine": result.get("semantic_engine"),
        "weights": result.get("weights") or {},
        "evaluatedAt": evaluated_at,
    }


def default_instructor_review() -> dict:
    return {
        "reviewed": False,
        "finalScore": None,
        "finalLabel": None,
        "feedback": "",
        "showToStudent": False,
        "reviewedBy": None,
        "reviewedAt": None,
    }


def get_ai_evaluation(response: dict) -> dict:
    ai_evaluation = response.get("aiEvaluation") or {}
    if ai_evaluation:
        return ai_evaluation
    has_legacy_evaluation = any(
        response.get(key) is not None
        for key in ("semantic_score", "final_score", "semantic_label", "semantic_similarity", "concept_coverage")
    )
    if not has_legacy_evaluation:
        return {}
    return ai_evaluation_from_result(
        {
            "semantic_score": response.get("semantic_score", response.get("final_score", 0.0)),
            "semantic_label": response.get("semantic_label"),
            "semantic_engine": response.get("semantic_engine"),
            "semantic_similarity": response.get("semantic_similarity"),
            "concept_coverage": response.get("concept_coverage"),
            "weights": response.get("weights") or {},
        },
        response.get("submitted_at"),
    )


def get_instructor_review(response: dict) -> dict:
    return {**default_instructor_review(), **(response.get("instructorReview") or {})}


def final_response_score(response: dict) -> float | None:
    review = get_instructor_review(response)
    if review.get("reviewed") is True and review.get("finalScore") is not None:
        return normalize_score(review.get("finalScore"))
    ai_evaluation = get_ai_evaluation(response)
    if not ai_evaluation:
        return None
    if ai_evaluation.get("finalScore") is not None:
        return normalize_score(ai_evaluation.get("finalScore"))
    return None


def final_response_label(response: dict) -> str | None:
    review = get_instructor_review(response)
    if review.get("reviewed") is True and review.get("finalLabel"):
        return normalize_label(review.get("finalLabel"))
    ai_evaluation = get_ai_evaluation(response)
    if not ai_evaluation:
        return None
    if ai_evaluation.get("label"):
        return normalize_label(ai_evaluation.get("label"))
    semantic_label = response.get("semantic_label")
    return normalize_label(semantic_label) if semantic_label else None


def final_is_correct(response: dict) -> bool | None:
    label = final_response_label(response)
    if label:
        return label == "correct"
    if response.get("is_correct") is None:
        return None
    return response.get("is_correct") is True


def final_stars_earned(response: dict) -> int:
    return 1 if final_is_correct(response) else 0
