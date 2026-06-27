from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import logging
from statistics import mean
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import MongoCollections
from app.ml.feature_schema import FEATURE_SCHEMA_VERSION, GAMIFICATION_CONTEXT_COLUMNS, PREDICTION_FEATURE_COLUMNS, feature_vector
from app.ml.model_loader import load_prediction_model, model_feature_importance
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

logger = logging.getLogger(__name__)


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    if not isinstance(value, (int, float)):
        return low
    return round(max(low, min(high, float(value))), 2)


def percent(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    return clamp((float(numerator) / float(denominator)) * 100)


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
            concept = question_concept(questions_by_id.get(response.get("question_id")))
            concept_totals[concept].append(1 if response_is_correct(response) else 0)
        concept_correctness_map = {
            concept: round(sum(values) / len(values), 4)
            for concept, values in concept_totals.items()
            if values
        }
        weak_concepts = [concept for concept, value in concept_correctness_map.items() if value < 0.6]

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
        concept = feature.get("weakest_concept") or "a recent concept"
        reasons.append(f"Weak performance in {concept}")
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
        feature_columns = [
            column
            for column in (model_bundle.feature_columns or PREDICTION_FEATURE_COLUMNS)
            if column in PREDICTION_FEATURE_COLUMNS
        ]
        if feature_columns != PREDICTION_FEATURE_COLUMNS:
            return None
        risk_labels = model_bundle.risk_labels or ["low", "medium", "high"]
        vector = [feature_vector(feature, feature_columns)]
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
        per_student_confidence = feature_based_confidence(feature, risk_level)
        if not probabilities:
            probabilities = conservative_probabilities(predicted_index, len(risk_labels), per_student_confidence)
        probabilities = soften_extreme_probabilities(probabilities, predicted_index, per_student_confidence)
        weights = {"low": 15.0, "medium": 55.0, "high": 90.0}
        risk_score = clamp(sum(probabilities[index] * weights.get(label, 50.0) for index, label in enumerate(risk_labels)))
        engagement_index = derived_engagement_index(feature)
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
            "engagement_trend": engagement_trend_from_delta(float(feature.get("engagement_trend_delta") or 0)),
            "confidence": round(confidence, 4),
            "model_type": model_bundle.model_type,
            "risk_reasons": reasons,
            "recommended_actions": ["Review model feature importance and current learning signals before acting"],
            "feature_importance": model_feature_importance(model, feature_columns),
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
    # Backward-compatible field name. The frontend presents this as Bloom
    # cognitive skills because current values are Bloom taxonomy levels.
    "weak_concepts_count": "Weak Concepts",
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


def top_risk_drivers(results: list[dict]) -> list[dict]:
    scores: Counter[str] = Counter()
    source = "risk_scoring_priorities"
    for row in results:
        for item in row.get("feature_importance") or []:
            feature = str(item.get("feature") or "").strip()
            if not feature:
                continue
            if feature not in PREDICTION_FEATURE_COLUMNS:
                continue
            try:
                value = float(item.get("importance") or 0)
            except (TypeError, ValueError):
                value = 0
            if value <= 0:
                continue
            source = "xgboost_feature_importance"
            scores[driver_label(feature)] += value

    if not scores:
        scores.update(
            {
                "Attendance": 35,
                "Correctness": 35,
                "Weak Concepts": 24,
                "Participation": 20,
                "Engagement Trend": 12,
            }
        )

    max_score = max(scores.values() or [1])
    preferred_order = ["Attendance", "Correctness", "Weak Concepts", "Participation", "Engagement Trend"]
    rows = [
        {
            "driver": label,
            "importance": round(value, 4),
            "percentage": round((value / max_score) * 100, 1),
            "source": source,
        }
        for label, value in scores.items()
    ]
    return sorted(rows, key=lambda row: (-row["importance"], preferred_order.index(row["driver"]) if row["driver"] in preferred_order else 99))[:5]


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
        return "Review weak concepts"
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
            label = f"Review {concept_name} concepts"
            actions[label] += int(concept.get("weak_students_count") or 0)
            affected_students[label].update(str(student_id) for student_id in concept.get("affected_students") or [])

    preferred = [
        "Monitor participation in the next session",
        "Schedule a check-in with struggling students",
        "Review weak concepts",
        "Assign reinforcement activity",
        "Provide additional examples",
    ]
    rows = [
        {"action": action, "count": max(len(affected_students[action]), count)}
        for action, count in actions.items()
    ]
    return sorted(rows, key=lambda row: (preferred.index(row["action"]) if row["action"] in preferred else 99, -row["count"], row["action"]))[:8]


async def detect_weak_concepts(db: AsyncIOMotorDatabase, class_id: str, features: list[dict]) -> list[dict]:
    concepts: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for feature in features:
        for concept, correctness in feature.get("concept_correctness_map", {}).items():
            concepts[concept].append((feature["student_id"], float(correctness)))

    generated_at = utc_now()
    docs = []
    for concept, rows in concepts.items():
        if not rows:
            continue
        avg_correctness = round(sum(value for _student_id, value in rows) / len(rows), 4)
        affected = [student_id for student_id, value in rows if value < 0.6]
        if not affected:
            continue
        risk_level = "high" if avg_correctness < 0.45 or len(affected) >= 3 else "medium"
        docs.append(
            {
                "weak_concept_prediction_id": f"weak_concept_{class_id}_{concept.lower().replace(' ', '_')}",
                "class_id": class_id,
                "concept": concept,
                "average_correctness": avg_correctness,
                "weak_students_count": len(affected),
                "affected_students": affected,
                "risk_level": risk_level,
                "recommended_action": f"Revisit {concept} with a short example and follow-up question",
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
    await db[MongoCollections.prediction_features].delete_many({"class_id": class_id})
    if features:
        await db[MongoCollections.prediction_features].insert_many(features)

    model_bundle = load_prediction_model()
    averages = class_average_features(features)
    results = []
    for feature in features:
        prediction = ml_prediction(feature, model_bundle) or fallback_prediction(feature, averages)
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
                "confidence": prediction["confidence"],
                "engagement_status": prediction["engagement_status"],
                "academic_status": prediction["academic_status"],
                "engagement_trend": prediction["engagement_trend"],
                "model_type": prediction["model_type"],
                "risk_reasons": prediction["risk_reasons"],
                "recommended_actions": prediction["recommended_actions"],
                "feature_importance": prediction["feature_importance"],
                "model_feature_values": model_feature_values(feature),
                "engagement_context": engagement_context(feature),
                # Compatibility aliases. The score is a behavioral engagement index,
                # not a predicted exam mark.
                "predicted_score": prediction["engagement_index"],
                "predicted_performance": prediction["engagement_index"],
                "performance_level": prediction["performance_level"],
                "model_confidence": prediction["confidence"],
                "reasons": prediction["risk_reasons"],
                "features": feature,
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
                "generated_at": generated_at,
                "predicted_at": generated_at,
            }
        )

    await db[MongoCollections.prediction_results].delete_many({"class_id": class_id})
    if results:
        log_identical_confidence_if_needed(class_id, results)
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
    weak_concepts = [serialize_document(row) for row in await db[MongoCollections.weak_concept_predictions].find({"class_id": class_id}).sort("weak_students_count", -1).to_list(length=20)]
    at_risk = [row for row in results if row.get("risk_level") in {"medium", "high"}]
    generated_at = max([as_datetime(row.get("generated_at")) for row in results if as_datetime(row.get("generated_at"))] or [None])
    trends = Counter(row.get("engagement_trend", "stable") for row in results)
    return {
        "class_id": class_id,
        "risk_distribution": risk_distribution(results),
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
    level = clean.get("risk_level", "low")
    clean["risk_reasons"] = prediction_reasons(clean)
    clean["confidence"] = clean.get("confidence", clean.get("model_confidence", 0))
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
    weak_classes = {row.get("class_id") for row in weak_concepts if row.get("class_id") and row.get("risk_level") == "high"}
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
