FEATURE_SCHEMA_VERSION = "student-risk.v3"

PREDICTION_FEATURE_COLUMNS = [
    "attendance_rate",
    "participation_rate",
    "correctness_rate",
    "semantic_score",
    "engagement_score",
    "consistency_score",
    "response_time",
    "recent_activity_count",
    "weak_concepts_count",
]

GAMIFICATION_CONTEXT_COLUMNS = [
    "xp",
    "level",
    "badges_count",
    "streak",
]

# Gamification values are deliberately excluded from model inputs to avoid
# circular reasoning: they are platform outputs, not independent learning signals.

FEATURE_ALIASES = {
    "participation_rate": ("participation_rate", "answer_rate"),
    "semantic_score": ("semantic_score", "average_semantic_score"),
    "engagement_score": ("engagement_score",),
    "response_time": ("response_time", "average_response_time"),
}

RISK_LABELS = ["low", "medium", "high"]
RISK_LABEL_TO_ID = {label: index for index, label in enumerate(RISK_LABELS)}
RISK_ID_TO_LABEL = {index: label for label, index in RISK_LABEL_TO_ID.items()}


def feature_value(feature_record: dict, name: str) -> float:
    candidates = FEATURE_ALIASES.get(name, (name,))
    for candidate in candidates:
        value = feature_record.get(candidate)
        if value is not None:
            try:
                return float(value)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def feature_vector(feature_record: dict, columns: list[str] | None = None) -> list[float]:
    return [feature_value(feature_record, name) for name in (columns or PREDICTION_FEATURE_COLUMNS)]
