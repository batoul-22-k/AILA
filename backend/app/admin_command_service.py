from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import MongoCollections
from app.ml.feature_schema import GAMIFICATION_CONTEXT_COLUMNS, PREDICTION_FEATURE_COLUMNS
from app.models import utc_now
from app.prediction_service import (
    has_prediction_confidence as shared_has_prediction_confidence,
    predicted_class_confidence,
    prediction_probabilities_value as shared_prediction_probabilities_value,
    prediction_report_payload,
)
from app.services import serialize_document

BLOOM_LEVEL_LABELS = {
    "remember": "Remember",
    "understand": "Understand",
    "apply": "Apply",
    "analyze": "Analyze",
    "evaluate": "Evaluate",
    "create": "Create",
}
MASTERY_THRESHOLD = 60.0


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return round(max(low, min(high, float(value or 0))), 2)


def avg(values: list[float]) -> float:
    clean = [float(value) for value in values if isinstance(value, (int, float))]
    return round(sum(clean) / len(clean), 2) if clean else 0.0


def percentage(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    return round((float(numerator) / float(denominator)) * 100, 2)


def bloom_mastery_status(mastery_rate: float) -> str:
    if mastery_rate >= 80:
        return "Strong"
    if mastery_rate >= 60:
        return "Acceptable"
    if mastery_rate >= 40:
        return "Needs Attention"
    return "Needs Improvement"


def bloom_mastery_rate(row: dict) -> float | None:
    if isinstance(row.get("mastery_rate"), (int, float)):
        return round(float(row["mastery_rate"]), 2)
    if isinstance(row.get("average_correctness"), (int, float)):
        value = float(row["average_correctness"])
        return round(value * 100 if value <= 1 else value, 2)
    return None


def bloom_level_label(value: str | None) -> str | None:
    return BLOOM_LEVEL_LABELS.get(str(value or "").strip().lower())


def normalize_probability(value: Any) -> float:
    try:
        numeric = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    if numeric > 1:
        numeric /= 100
    return max(0.0, min(numeric, 1.0))


def prediction_probabilities_value(row: dict) -> dict | None:
    return shared_prediction_probabilities_value(row)


def prediction_confidence_value(row: dict) -> float:
    return predicted_class_confidence(row)


def has_prediction_confidence(row: dict) -> bool:
    return shared_has_prediction_confidence(row)


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


def week_key(value: datetime) -> str:
    year, week, _ = value.isocalendar()
    return f"{year}-W{week:02d}"


def iso_date(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def severity_rank(severity: str) -> int:
    return {"critical": 0, "warning": 1, "attention": 2, "healthy": 3}.get(severity, 4)


def health_status(score: float) -> str:
    if score < 45:
        return "Critical"
    if score < 70:
        return "Attention"
    return "Healthy"


def class_health_score(summary: dict, weak_concepts_count: int, inactive_days: int | None) -> float:
    activity_penalty = 12 if inactive_days is not None and inactive_days >= 14 else 0
    weak_concept_penalty = min(weak_concepts_count * 3, 15)
    risk_penalty = min(summary.get("risk_count", 0) * 5, 25)
    score = (
        0.4 * summary.get("engagement_score", 0)
        + 0.3 * summary.get("attendance_rate", 0)
        + 0.2 * summary.get("participation_rate", 0)
        + 10
        - risk_penalty
        - weak_concept_penalty
        - activity_penalty
    )
    return clamp(score)


def alert_id(*parts: str) -> str:
    raw = "|".join(str(part) for part in parts)
    return f"alert_{sha256(raw.encode('utf-8')).hexdigest()[:20]}"


def latest_rows_by_class(analytics_rows: list[dict]) -> dict[str, list[dict]]:
    by_class_week: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in analytics_rows:
        class_id = row.get("class_id")
        week = row.get("week")
        if class_id and week:
            by_class_week[(class_id, week)].append(row)
    latest: dict[str, list[dict]] = {}
    for (class_id, week), rows in by_class_week.items():
        current_week = max((row.get("week") for row in latest.get(class_id, [])), default="")
        if week >= current_week:
            latest[class_id] = rows
    return latest


def class_summary_from_rows(class_id: str, rows: list[dict]) -> dict:
    if not rows:
        return {
            "class_id": class_id,
            "week": None,
            "engagement_score": 0.0,
            "attendance_rate": 0.0,
            "participation_rate": 0.0,
            "risk_count": 0,
            "active_students": 0,
        }
    return {
        "class_id": class_id,
        "week": rows[0].get("week"),
        "engagement_score": avg([row.get("engagement_score", 0) for row in rows]),
        "attendance_rate": avg([row.get("attendance_rate", 0) for row in rows]),
        "participation_rate": avg([row.get("participation_rate", 0) for row in rows]),
        "risk_count": len({row.get("student_id") for row in rows if row.get("risk_level") in {"Critical", "High", "Medium"}}),
        "active_students": len({row.get("student_id") for row in rows if row.get("attendance_rate", 0) > 0 or row.get("participation_rate", 0) > 0}),
    }


def previous_class_summary(class_id: str, latest_week: str | None, analytics_rows: list[dict]) -> dict | None:
    if not latest_week:
        return None
    weeks = sorted({row.get("week") for row in analytics_rows if row.get("class_id") == class_id and row.get("week") and row.get("week") < latest_week})
    if not weeks:
        return None
    previous_week = weeks[-1]
    return class_summary_from_rows(class_id, [row for row in analytics_rows if row.get("class_id") == class_id and row.get("week") == previous_week])


async def load_admin_context(db: AsyncIOMotorDatabase) -> dict:
    classes = [serialize_document(row) for row in await db[MongoCollections.classes].find({}).to_list(length=None)]
    memberships = [serialize_document(row) for row in await db[MongoCollections.class_memberships].find({"status": "active"}).to_list(length=None)]
    instructor_ids = sorted({row.get("user_id") for row in memberships if row.get("role") == "instructor" and row.get("user_id")})
    users = [serialize_document(row) for row in await db[MongoCollections.users].find({"user_id": {"$in": instructor_ids}}).to_list(length=None)] if instructor_ids else []
    sessions = [serialize_document(row) for row in await db[MongoCollections.sessions].find({}).to_list(length=None)]
    session_ids = [row.get("session_id") for row in sessions if row.get("session_id")]
    responses = [serialize_document(row) for row in await db[MongoCollections.responses].find({"session_id": {"$in": session_ids}}).to_list(length=None)] if session_ids else []
    analytics = [serialize_document(row) for row in await db[MongoCollections.analytics_results].find({}).to_list(length=None)]
    weak_concepts = [serialize_document(row) for row in await db[MongoCollections.weak_concept_predictions].find({}).to_list(length=None)]
    predictions = [serialize_document(row) for row in await db[MongoCollections.prediction_results].find({}).to_list(length=None)]
    generated_questions = [serialize_document(row) for row in await db[MongoCollections.generated_questions].find({}).to_list(length=None)]
    approved_questions = [serialize_document(row) for row in await db[MongoCollections.approved_questions].find({}).to_list(length=None)]
    reviewed_alerts = [serialize_document(row) for row in await db[MongoCollections.admin_alert_reviews].find({}).to_list(length=None)]
    return {
        "classes": classes,
        "memberships": memberships,
        "users": users,
        "sessions": sessions,
        "responses": responses,
        "analytics": analytics,
        "weak_concepts": weak_concepts,
        "predictions": predictions,
        "generated_questions": generated_questions,
        "approved_questions": approved_questions,
        "reviewed_alert_ids": {row.get("alert_id") for row in reviewed_alerts if row.get("alert_id")},
    }


def class_name_map(classes: list[dict]) -> dict[str, str]:
    return {row.get("class_id"): row.get("name") or row.get("class_id") for row in classes if row.get("class_id")}


def instructor_name_map(users: list[dict]) -> dict[str, str]:
    return {row.get("user_id"): row.get("name") or row.get("user_id") for row in users if row.get("user_id")}


def build_class_monitoring(context: dict) -> list[dict]:
    classes = context["classes"]
    sessions = context["sessions"]
    analytics = context["analytics"]
    weak_concepts = context["weak_concepts"]
    latest = latest_rows_by_class(analytics)
    class_names = class_name_map(classes)
    instructor_names = instructor_name_map(context["users"])
    now = utc_now()

    sessions_by_class: dict[str, list[dict]] = defaultdict(list)
    for session in sessions:
        if session.get("class_id"):
            sessions_by_class[session["class_id"]].append(session)

    instructor_ids_by_class: dict[str, set[str]] = defaultdict(set)
    for membership in context["memberships"]:
        if membership.get("role") == "instructor" and membership.get("class_id") and membership.get("user_id"):
            instructor_ids_by_class[membership["class_id"]].add(membership["user_id"])

    weak_by_class: dict[str, list[dict]] = defaultdict(list)
    for concept in weak_concepts:
        if concept.get("class_id"):
            weak_by_class[concept["class_id"]].append(concept)

    rows = []
    for class_doc in classes:
        class_id = class_doc.get("class_id")
        if not class_id:
            continue
        summary = class_summary_from_rows(class_id, latest.get(class_id, []))
        previous = previous_class_summary(class_id, summary.get("week"), analytics)
        trend_delta = round(summary["engagement_score"] - previous["engagement_score"], 2) if previous else 0.0
        class_sessions = sessions_by_class.get(class_id, [])
        last_activity_values = [
            as_datetime(session.get("updated_at") or session.get("created_at") or session.get("scheduled_for"))
            for session in class_sessions
        ]
        last_activity = max([value for value in last_activity_values if value], default=None)
        inactive_days = (now - last_activity).days if last_activity else None
        active_sessions = len([session for session in class_sessions if session.get("status") == "active"])
        weak = weak_by_class.get(class_id, [])
        instructor_ids = sorted(set(class_doc.get("instructor_ids", []) or []) | instructor_ids_by_class.get(class_id, set()))
        score = class_health_score(summary, len(weak), inactive_days)
        rows.append(
            {
                "class_id": class_id,
                "class_name": class_names.get(class_id, class_id),
                "status": class_doc.get("status", "active"),
                "instructor_ids": instructor_ids,
                "instructor_names": [instructor_names.get(instructor_id, instructor_id) for instructor_id in instructor_ids],
                "health_score": score,
                "health_status": health_status(score),
                "engagement_score": summary["engagement_score"],
                "attendance_rate": summary["attendance_rate"],
                "participation_rate": summary["participation_rate"],
                "active_sessions": active_sessions,
                "weak_concepts": [item.get("concept") for item in weak[:3] if item.get("concept")],
                "weak_concepts_count": len(weak),
                "risk_count": summary["risk_count"],
                "active_students": summary["active_students"],
                "last_activity": iso_date(last_activity),
                "inactive_days": inactive_days,
                "trend_delta": trend_delta,
                "trend": "declining" if trend_delta <= -8 else "improving" if trend_delta >= 8 else "stable",
            }
        )
    return sorted(rows, key=lambda row: (-row["risk_count"], row["engagement_score"], row["class_name"]))


def pending_review_count_for_class(class_id: str, sessions: list[dict], responses: list[dict]) -> int:
    session_ids = {session.get("session_id") for session in sessions if session.get("class_id") == class_id}
    return len([
        response
        for response in responses
        if response.get("session_id") in session_ids and not (response.get("instructorReview") or {}).get("reviewed")
    ])


def build_instructor_monitoring(context: dict, class_rows: list[dict]) -> list[dict]:
    memberships = context["memberships"]
    sessions = context["sessions"]
    responses = context["responses"]
    generated_questions = context["generated_questions"]
    approved_questions = context["approved_questions"]
    names = instructor_name_map(context["users"])

    class_ids_by_instructor: dict[str, set[str]] = defaultdict(set)
    for membership in memberships:
        if membership.get("role") == "instructor" and membership.get("user_id") and membership.get("class_id"):
            class_ids_by_instructor[membership["user_id"]].add(membership["class_id"])

    class_by_id = {row["class_id"]: row for row in class_rows}
    approved_ids = {row.get("question_id") for row in approved_questions if row.get("question_id")}
    rows = []
    for instructor_id, class_ids in class_ids_by_instructor.items():
        instructor_sessions = [session for session in sessions if session.get("class_id") in class_ids]
        managed_class_rows = [class_by_id[class_id] for class_id in class_ids if class_id in class_by_id]
        pending_reviews = sum(pending_review_count_for_class(class_id, sessions, responses) for class_id in class_ids)
        generated_for_classes = [row for row in generated_questions if row.get("class_id") in class_ids]
        approval_rate = round((len([row for row in generated_for_classes if row.get("question_id") in approved_ids or row.get("status") == "approved"]) / len(generated_for_classes)) * 100, 2) if generated_for_classes else 0.0
        last_activity_values = [as_datetime(row.get("updated_at") or row.get("created_at")) for row in instructor_sessions + generated_for_classes]
        last_activity = max([value for value in last_activity_values if value], default=None)
        rows.append(
            {
                "instructor_id": instructor_id,
                "instructor_name": names.get(instructor_id, instructor_id),
                "classes_managed": len(class_ids),
                "class_ids": sorted(class_ids),
                "sessions_created": len(instructor_sessions),
                "student_engagement_average": avg([row.get("engagement_score", 0) for row in managed_class_rows]),
                "pending_short_answer_reviews": pending_reviews,
                "ai_question_approval_rate": approval_rate,
                "last_activity": iso_date(last_activity),
                "support_signal": "Needs support" if pending_reviews >= 10 or avg([row.get("engagement_score", 0) for row in managed_class_rows]) < 55 else "Stable",
            }
        )
    return sorted(rows, key=lambda row: (-row["pending_short_answer_reviews"], row["student_engagement_average"]))


def build_risk_overview(context: dict, class_rows: list[dict], instructor_rows: list[dict]) -> dict:
    analytics = context["analytics"]
    class_names = class_name_map(context["classes"])
    instructor_by_class = {}
    for instructor in instructor_rows:
        for class_id in instructor.get("class_ids", []):
            instructor_by_class[class_id] = instructor["instructor_name"]

    latest = latest_rows_by_class(analytics)
    by_class = []
    by_reason_counter: Counter[str] = Counter()
    by_instructor_counter: Counter[str] = Counter()
    by_trend_counter: Counter[str] = Counter()
    class_row_map = {row["class_id"]: row for row in class_rows}

    for class_id, rows in latest.items():
        risky = [row for row in rows if row.get("risk_level") in {"Critical", "High", "Medium"}]
        if not risky:
            continue
        reasons = Counter(row.get("risk_reason") or "Needs support" for row in risky)
        trend = class_row_map.get(class_id, {}).get("trend", "stable")
        instructor_name = instructor_by_class.get(class_id, "Unassigned")
        by_class.append(
            {
                "class_id": class_id,
                "class_name": class_names.get(class_id, class_id),
                "instructor_name": instructor_name,
                "risk_count": len({row.get("student_id") for row in risky if row.get("student_id")}),
                "top_reason": reasons.most_common(1)[0][0],
                "trend": trend,
                "summary": f"{class_names.get(class_id, class_id)} has {len(risky)} students with {reasons.most_common(1)[0][0].lower()}.",
            }
        )
        by_reason_counter.update(reasons)
        by_instructor_counter[instructor_name] += len(risky)
        by_trend_counter[trend] += len(risky)

    return {
        "by_class": sorted(by_class, key=lambda row: -row["risk_count"]),
        "by_reason": [{"reason": reason, "count": count} for reason, count in by_reason_counter.most_common()],
        "by_instructor": [{"instructor_name": name, "risk_count": count} for name, count in by_instructor_counter.most_common()],
        "by_trend": [{"trend": trend, "risk_count": count} for trend, count in by_trend_counter.most_common()],
    }


def build_trends(context: dict) -> list[dict]:
    analytics = context["analytics"]
    sessions = context["sessions"]
    by_week: dict[str, list[dict]] = defaultdict(list)
    for row in analytics:
        if row.get("week"):
            by_week[row["week"]].append(row)
    active_sessions_by_week: Counter[str] = Counter()
    for session in sessions:
        created_at = as_datetime(session.get("created_at") or session.get("scheduled_for"))
        if created_at:
            active_sessions_by_week[week_key(created_at)] += 1
    points = []
    for week, rows in sorted(by_week.items()):
        points.append(
            {
                "week": week,
                "engagement": avg([row.get("engagement_score", 0) for row in rows]),
                "attendance": avg([row.get("attendance_rate", 0) for row in rows]),
                "participation": avg([row.get("participation_rate", 0) for row in rows]),
                "correctness": avg([row.get("correctness_rate", 0) for row in rows]),
                "at_risk_count": len({row.get("student_id") for row in rows if row.get("risk_level") in {"Critical", "High", "Medium"}}),
                "active_sessions": active_sessions_by_week.get(week, 0),
            }
        )
    return points


def build_prediction_overview(context: dict) -> dict:
    predictions = context["predictions"]
    weak_concepts = context["weak_concepts"]
    classes = context["classes"]
    class_rows = build_class_monitoring(context)
    class_names = class_name_map(classes)
    instructor_names = instructor_name_map(context["users"])
    latest_analytics = latest_rows_by_class(context["analytics"])
    class_meta = {row.get("class_id"): row for row in classes if row.get("class_id")}
    class_health = {row.get("class_id"): row for row in class_rows if row.get("class_id")}

    instructor_ids_by_class: dict[str, set[str]] = defaultdict(set)
    student_ids_by_class: dict[str, set[str]] = defaultdict(set)
    for membership in context["memberships"]:
        class_id = membership.get("class_id")
        user_id = membership.get("user_id")
        if not class_id or not user_id:
            continue
        if membership.get("role") == "instructor":
            instructor_ids_by_class[class_id].add(user_id)
        if membership.get("role") == "student":
            student_ids_by_class[class_id].add(user_id)

    predictions_by_class: dict[str, list[dict]] = defaultdict(list)
    for row in predictions:
        if row.get("class_id"):
            predictions_by_class[row["class_id"]].append(row)

    weak_by_class: dict[str, list[dict]] = defaultdict(list)
    weak_by_concept: dict[str, list[dict]] = defaultdict(list)
    for row in weak_concepts:
        bloom_label = bloom_level_label(row.get("concept"))
        if not bloom_label:
            continue
        if row.get("class_id"):
            weak_by_class[row["class_id"]].append(row)
        weak_by_concept[bloom_label].append(row)

    def instructor_display(class_id: str) -> str:
        ids = sorted(set(class_meta.get(class_id, {}).get("instructor_ids", []) or []) | instructor_ids_by_class.get(class_id, set()))
        names = [instructor_names.get(instructor_id, instructor_id) for instructor_id in ids]
        return ", ".join(names) or "Unassigned"

    def class_prediction_report(class_id: str) -> dict:
        class_predictions = predictions_by_class.get(class_id, [])
        distribution = Counter(row.get("risk_level", "low") for row in class_predictions)
        analytics_rows = latest_analytics.get(class_id, [])
        health = class_health.get(class_id, {})
        meta = class_meta.get(class_id, {})
        high = distribution.get("high", 0)
        medium = distribution.get("medium", 0)
        low = distribution.get("low", 0)
        total_predictions = low + medium + high
        confidence_values = [
            prediction_confidence_value(row)
            for row in class_predictions
            if has_prediction_confidence(row)
        ]
        prediction_confidence = round(avg(confidence_values) * 100, 2) if confidence_values else 0.0
        student_count = len(student_ids_by_class.get(class_id, set())) or total_predictions or health.get("active_students", 0)
        risk_concentration = round(((medium + high) / total_predictions) * 100, 2) if total_predictions else 0.0
        correctness = avg([row.get("correctness_rate", 0) for row in analytics_rows])
        last_run = max(
            [
                as_datetime(row.get("generated_at") or row.get("predicted_at"))
                for row in class_predictions
                if as_datetime(row.get("generated_at") or row.get("predicted_at"))
            ],
            default=None,
        )
        risk_level = "High" if high > 0 or risk_concentration >= 40 else "Medium" if medium > 0 or risk_concentration >= 20 else "Low"
        return {
            "class_id": class_id,
            "class_name": class_names.get(class_id, class_id),
            "instructor": instructor_display(class_id),
            "semester": meta.get("semester") or "Unassigned",
            "students": student_count,
            "low_risk": low,
            "medium_risk": medium,
            "high_risk": high,
            "at_risk_students": medium + high,
            "risk_concentration": risk_concentration,
            "risk_level": risk_level,
            "prediction_confidence": prediction_confidence,
            "engagement_score": health.get("engagement_score", 0),
            "attendance": health.get("attendance_rate", 0),
            "participation": health.get("participation_rate", 0),
            "correctness": correctness,
            "weak_concepts_count": len(weak_by_class.get(class_id, [])),
            "last_prediction_run": iso_date(last_run),
            "status": "Needs intervention" if risk_level == "High" or health.get("health_status") == "Critical" else "Watch" if risk_level == "Medium" or health.get("health_status") == "Attention" else "Stable",
        }

    reports = [class_prediction_report(class_doc["class_id"]) for class_doc in classes if class_doc.get("class_id")]
    distribution = Counter(row.get("risk_level", "low") for row in predictions)
    last_run = max([as_datetime(row.get("generated_at") or row.get("predicted_at")) for row in predictions if as_datetime(row.get("generated_at") or row.get("predicted_at"))], default=None)
    weak_class_ids = {
        class_id
        for class_id, rows in weak_by_class.items()
        if any((bloom_mastery_rate(row) or 0) < MASTERY_THRESHOLD for row in rows)
    }
    engagement_decline_classes = {row.get("class_id") for row in predictions if row.get("engagement_trend") == "declining" and row.get("class_id")}
    weak_concept_rows = []
    for concept, rows in weak_by_concept.items():
        total_questions_answered = sum(int(row.get("total_questions_answered") or 0) for row in rows)
        correct_answers = sum(int(row.get("correct_answers") or 0) for row in rows)
        mastery_rate = percentage(correct_answers, total_questions_answered) if total_questions_answered else avg([value for row in rows if (value := bloom_mastery_rate(row)) is not None])
        if total_questions_answered <= 0 and mastery_rate <= 0:
            continue
        status = bloom_mastery_status(mastery_rate)
        if status not in {"Needs Attention", "Needs Improvement"}:
            continue
        affected_classes = {
            row.get("class_id")
            for row in rows
            if row.get("class_id") and (bloom_mastery_rate(row) is None or bloom_mastery_rate(row) < MASTERY_THRESHOLD)
        }
        affected_class_rows = [
            {
                "class_id": class_id,
                "class_name": class_names.get(class_id, class_id),
                "mastery_rate": bloom_mastery_rate(next((row for row in rows if row.get("class_id") == class_id), {})),
            }
            for class_id in sorted(affected_classes)
        ]
        affected_students = {
            student_id
            for row in rows
            for student_id in (row.get("affected_students") or [])
            if student_id
        }
        affected_students_count = len(affected_students) or sum(int(row.get("affected_students_count") or row.get("weak_students_count") or 0) for row in rows)
        weak_concept_rows.append(
            {
                "concept": concept,
                "bloom_level": concept,
                "total_questions_answered": total_questions_answered,
                "correct_answers": correct_answers,
                "mastery_rate": mastery_rate,
                "mastery_status": status,
                "mastery_threshold": MASTERY_THRESHOLD,
                "affected_classes": len(affected_classes),
                "affected_class_rows": affected_class_rows,
                "affected_students": affected_students_count,
                "severity": "High" if status == "Needs Improvement" else "Medium",
                "source": "descriptive_bloom_mastery",
            }
        )

    def comparison_key(report: dict, field: str) -> str:
        return str(report.get(field) or "Unassigned")

    def comparison_rows(field: str) -> list[dict]:
        grouped: dict[str, list[dict]] = defaultdict(list)
        for report in reports:
            grouped[comparison_key(report, field)].append(report)
        return [
            {
                "name": name,
                "engagement": avg([row.get("engagement_score", 0) for row in rows]),
                "attendance": avg([row.get("attendance", 0) for row in rows]),
                "participation": avg([row.get("participation", 0) for row in rows]),
                "correctness": avg([row.get("correctness", 0) for row in rows]),
                "risk": avg([row.get("risk_concentration", 0) for row in rows]),
                "classes": len(rows),
            }
            for name, rows in grouped.items()
        ]

    recommendations = []
    for report in sorted(reports, key=lambda row: (-row["high_risk"], row["engagement_score"]))[:6]:
        if report["high_risk"] > 0:
            recommendations.append(
                {
                    "priority": "High",
                    "title": f"Schedule support for {report['class_name']}",
                    "reason": f"{report['high_risk']} high-risk students and {round(report['engagement_score'])}% engagement.",
                    "class_id": report["class_id"],
                }
            )
        elif report["engagement_score"] < 55:
            recommendations.append(
                {
                    "priority": "Medium",
                    "title": f"Review low engagement in {report['class_name']}",
                    "reason": f"Engagement is {round(report['engagement_score'])}%.",
                    "class_id": report["class_id"],
                }
            )
    for concept in sorted(weak_concept_rows, key=lambda row: (row["mastery_rate"], -row["affected_students"]))[:4]:
        if concept["affected_classes"] > 1:
            recommendations.append(
                {
                    "priority": "Medium" if concept["severity"] != "High" else "High",
                    "title": f"Reinforce {concept['concept']} mastery across multiple classes",
                    "reason": f"{concept['affected_students']} students below mastery in {concept['affected_classes']} classes.",
                    "class_id": None,
                }
            )
    recommendations = recommendations[:8]

    factor_labels = {
        "attendance_rate": "Attendance",
        "participation_rate": "Participation",
        "answer_rate": "Participation",
        "correctness_rate": "Correctness",
        "semantic_score": "Semantic Score",
        "average_semantic_score": "Semantic Score",
        "consistency_score": "Consistency",
        "recent_activity_count": "Recent Activity",
        # Backward-compatible feature name. This is descriptive Bloom mastery
        # from answer correctness, not a model-predicted Bloom level.
        "weak_concepts_count": "Bloom Mastery Gaps",
        "response_time": "Response Time",
        "engagement_score": "Engagement",
    }

    def factor_label(feature_name: str) -> str:
        normalized = str(feature_name or "").lower()
        for key, label in factor_labels.items():
            if key in normalized:
                return label
        return normalized.replace("_", " ").title() or "Learning Signal"

    def feature_value(features: dict, *names: str) -> float:
        for name in names:
            value = features.get(name)
            if isinstance(value, (int, float)):
                return float(value)
        return 0.0

    def factor_direction(label: str, features: dict) -> str:
        if label == "Bloom Mastery Gaps":
            return "negative" if feature_value(features, "weak_concepts_count") > 0 else "positive"
        if label == "Response Time":
            return "negative" if feature_value(features, "response_time", "average_response_time") > 45 else "positive"
        value_map = {
            "Attendance": feature_value(features, "attendance_rate"),
            "Participation": feature_value(features, "participation_rate", "answer_rate"),
            "Correctness": feature_value(features, "correctness_rate"),
            "Semantic Score": feature_value(features, "semantic_score", "average_semantic_score"),
            "Consistency": feature_value(features, "consistency_score"),
            "Recent Activity": min(feature_value(features, "recent_activity_count") * 10, 100),
            "Engagement": feature_value(features, "engagement_score"),
        }
        return "positive" if value_map.get(label, 0) >= 60 else "negative"

    def reason_factors(prediction: dict) -> list[dict]:
        features = prediction.get("features") or {}
        factors = []
        candidates = [
            ("Attendance", feature_value(features, "attendance_rate"), max(0, 60 - feature_value(features, "attendance_rate"))),
            ("Participation", feature_value(features, "participation_rate", "answer_rate"), max(0, 60 - feature_value(features, "participation_rate", "answer_rate"))),
            ("Correctness", feature_value(features, "correctness_rate"), max(0, 60 - feature_value(features, "correctness_rate"))),
            ("Semantic Score", feature_value(features, "semantic_score", "average_semantic_score"), max(0, 60 - feature_value(features, "semantic_score", "average_semantic_score"))),
            ("Consistency", feature_value(features, "consistency_score"), max(0, 60 - feature_value(features, "consistency_score"))),
            ("Recent Activity", feature_value(features, "recent_activity_count"), 12 if feature_value(features, "recent_activity_count") == 0 else max(0, 5 - feature_value(features, "recent_activity_count")) * 2),
            ("Bloom Mastery Gaps", feature_value(features, "weak_concepts_count"), min(feature_value(features, "weak_concepts_count") * 8, 24)),
        ]
        for label, value, impact in candidates:
            if impact > 0:
                factors.append({"factor": label, "impact": round(float(impact), 4), "value": round(float(value), 4), "direction": "negative"})
            elif value:
                factors.append({"factor": label, "impact": round(min(float(value), 100) / 8, 4), "value": round(float(value), 4), "direction": "positive"})
        return factors

    def explain_prediction(prediction: dict) -> dict:
        features = prediction.get("features") or {}
        importance = prediction.get("feature_importance") or []
        factors = []
        for item in importance:
            feature_name = str(item.get("feature") or "")
            if feature_name not in PREDICTION_FEATURE_COLUMNS:
                continue
            label = factor_label(feature_name)
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
                    "direction": factor_direction(label, features),
                    "source": "feature_importance",
                }
            )
        if not factors:
            factors = reason_factors(prediction)
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
        summary = (
            f"{prediction.get('student_name', 'This student')} is classified as {risk_level} Academic Risk mainly because "
            f"{negative_names} influenced the prediction. {positive_names.title()} provide counter-signals where present."
        )
        return {
            "summary": summary,
            "positive_factors": positive,
            "negative_factors": negative,
            "top_factors": top_factors,
        }

    def engagement_context(features: dict, prediction: dict) -> dict:
        source = prediction.get("engagement_context") or {}
        context = {
            name: int(float(source.get(name, features.get(name, 0)) or 0))
            for name in GAMIFICATION_CONTEXT_COLUMNS
        }
        context["note"] = "Engagement context, not used by the risk model."
        return context

    def student_report_status(risk_level: str) -> str:
        normalized = str(risk_level or "").lower()
        if normalized == "high":
            return "Critical"
        if normalized == "medium":
            return "Needs Attention"
        return "Stable"

    def prediction_payload(prediction: dict) -> dict:
        return prediction_report_payload(
            prediction,
            class_names=class_names,
            class_meta=class_meta,
            instructor_display=instructor_display,
        )

    latest_student_predictions: dict[tuple[str, str], dict] = {}
    for row in predictions:
        student_id = row.get("student_id")
        class_id = row.get("class_id")
        if not student_id or not class_id:
            continue
        key = (student_id, class_id)
        current_date = as_datetime(row.get("generated_at") or row.get("predicted_at")) or datetime.min.replace(tzinfo=timezone.utc)
        existing = latest_student_predictions.get(key)
        existing_date = as_datetime(existing.get("generated_at") or existing.get("predicted_at")) if existing else None
        if not existing or current_date >= (existing_date or datetime.min.replace(tzinfo=timezone.utc)):
            latest_student_predictions[key] = row

    student_reports = [
        prediction_payload(row)
        for row in sorted(
            latest_student_predictions.values(),
            key=lambda item: (
                str(item.get("student_name") or ""),
                str(item.get("class_id") or ""),
                str(item.get("generated_at") or item.get("predicted_at") or ""),
            ),
        )
    ]

    explainable_predictions = []
    for row in sorted(predictions, key=lambda item: (str(item.get("risk_level")) != "high", -float(item.get("risk_score") or 0)))[:24]:
        explainable_predictions.append(prediction_payload(row))

    if not predictions:
        return {
            "empty": True,
            "message": "Prediction insights will appear once enough classroom activity has been collected.",
            "high_risk_students_count": 0,
            "weak_classes": 0,
            "engagement_decline_classes": 0,
            "risk_distribution": {"low": 0, "medium": 0, "high": 0},
            "prediction_confidence": 0.0,
            "last_prediction_run": None,
            "recent_prediction_alerts": [],
            "class_reports": reports,
            "high_risk_classes": [],
            "weak_class_ranking": sorted(reports, key=lambda row: (row["engagement_score"], row["correctness"], -row["risk_concentration"]))[:8],
            "weak_concepts": sorted(weak_concept_rows, key=lambda row: (row["mastery_rate"], -row["affected_students"]))[:12],
            "student_reports": [],
            "explainable_predictions": [],
            "comparison": {
                "classes": comparison_rows("class_name"),
                "instructors": comparison_rows("instructor"),
                "semesters": comparison_rows("semester"),
            },
            "recommendations": recommendations,
        }

    prediction_alerts = []
    for row in predictions:
        if row.get("risk_level") == "high":
            prediction_alerts.append(
                {
                    "title": f"{row.get('student_name', 'Student')} flagged as high risk",
                    "class_name": class_names.get(row.get("class_id"), row.get("class_id")),
                    "confidence": round(prediction_confidence_value(row) * 100, 2),
                    "generated_at": iso_date(as_datetime(row.get("generated_at") or row.get("predicted_at"))),
                }
            )
    for row in weak_concepts:
        prediction_alerts.append(
            {
                "title": f"Bloom mastery gap detected: {row.get('concept', 'Level')}",
                "class_name": class_names.get(row.get("class_id"), row.get("class_id")),
                "confidence": round(float(row.get("mastery_rate") if row.get("mastery_rate") is not None else float(row.get("average_correctness") or 0) * 100), 2),
                "generated_at": iso_date(as_datetime(row.get("generated_at"))),
            }
        )
    prediction_alerts.sort(key=lambda row: row.get("generated_at") or "", reverse=True)
    return {
        "empty": False,
        "high_risk_students_count": len([row for row in predictions if row.get("risk_level") == "high"]),
        "weak_classes": len({row.get("class_id") for row in weak_concepts if row.get("class_id") and (bloom_mastery_rate(row) or 0) < MASTERY_THRESHOLD}),
        "engagement_decline_classes": len({row.get("class_id") for row in predictions if row.get("engagement_trend") == "declining" and row.get("class_id")}),
        "risk_distribution": {
            "low": distribution.get("low", 0),
            "medium": distribution.get("medium", 0),
            "high": distribution.get("high", 0),
        },
        "prediction_confidence": avg([prediction_confidence_value(row) * 100 for row in predictions if has_prediction_confidence(row)]),
        "last_prediction_run": iso_date(last_run),
        "recent_prediction_alerts": prediction_alerts[:6],
        "class_reports": reports,
        "high_risk_classes": sorted(reports, key=lambda row: (-row["high_risk"], -row["risk_concentration"], row["engagement_score"]))[:8],
        "weak_class_ranking": sorted(reports, key=lambda row: (row["engagement_score"], row["correctness"], -row["risk_concentration"]))[:8],
        "weak_concepts": sorted(weak_concept_rows, key=lambda row: (row["mastery_rate"], -row["affected_students"]))[:12],
        "student_reports": student_reports,
        "explainable_predictions": explainable_predictions,
        "comparison": {
            "classes": comparison_rows("class_name"),
            "instructors": comparison_rows("instructor"),
            "semesters": comparison_rows("semester"),
        },
        "recommendations": recommendations,
    }


def build_students_support_summary(context: dict, class_rows: list[dict]) -> dict:
    analytics = context["analytics"]
    latest = latest_rows_by_class(analytics)
    current_count = sum(row.get("risk_count", 0) for row in class_rows)
    previous_count = 0
    reasons: Counter[str] = Counter()
    for class_id, rows in latest.items():
        latest_week = rows[0].get("week") if rows else None
        previous = previous_class_summary(class_id, latest_week, analytics)
        previous_count += previous.get("risk_count", 0) if previous else 0
        reasons.update(row.get("risk_reason") or "Needs support" for row in rows if row.get("risk_level") in {"Critical", "High", "Medium"})
    by_class = [
        {
            "class_id": row["class_id"],
            "class_name": row["class_name"],
            "students_needing_support": row.get("risk_count", 0),
            "top_reason": next((reason for reason, _count in reasons.most_common(1)), "Needs support"),
        }
        for row in class_rows
        if row.get("risk_count", 0) > 0
    ]
    return {
        "total": current_count,
        "weekly_trend": current_count - previous_count,
        "by_reason": [{"reason": reason, "count": count} for reason, count in reasons.most_common(5)],
        "by_class": sorted(by_class, key=lambda row: -row["students_needing_support"])[:6],
    }


def build_recent_activity(context: dict) -> list[dict]:
    class_names = class_name_map(context["classes"])
    activities = []

    for session in context["sessions"]:
        status = session.get("status")
        timestamp = as_datetime(session.get("updated_at") or session.get("created_at") or session.get("scheduled_for"))
        if not timestamp:
            continue
        class_name = class_names.get(session.get("class_id"), session.get("class_id") or "Class")
        if status == "finished":
            title = f"Session completed in {class_name}"
        elif status == "active":
            title = f"Active session running in {class_name}"
        else:
            title = f"Session {status or 'created'} in {class_name}"
        activities.append({"type": "session", "title": title, "created_at": iso_date(timestamp)})

    for class_doc in context["classes"]:
        timestamp = as_datetime(class_doc.get("created_at"))
        if timestamp:
            activities.append({"type": "class", "title": f"New class created: {class_doc.get('name') or class_doc.get('class_id')}", "created_at": iso_date(timestamp)})

    for question in context["approved_questions"]:
        timestamp = as_datetime(question.get("approved_at") or question.get("updated_at") or question.get("created_at"))
        if timestamp:
            class_name = class_names.get(question.get("class_id"), question.get("class_id") or "a class")
            activities.append({"type": "review", "title": f"Instructor approved a question for {class_name}", "created_at": iso_date(timestamp)})

    for prediction in context["predictions"]:
        timestamp = as_datetime(prediction.get("generated_at") or prediction.get("predicted_at"))
        if timestamp:
            class_name = class_names.get(prediction.get("class_id"), prediction.get("class_id") or "a class")
            activities.append({"type": "prediction", "title": f"Prediction analysis completed for {class_name}", "created_at": iso_date(timestamp)})

    for concept in context["weak_concepts"]:
        timestamp = as_datetime(concept.get("generated_at"))
        if timestamp:
            class_name = class_names.get(concept.get("class_id"), concept.get("class_id") or "a class")
            activities.append({"type": "alert", "title": f"Weak concept alert generated in {class_name}: {concept.get('concept')}", "created_at": iso_date(timestamp)})

    return sorted(activities, key=lambda row: row.get("created_at") or "", reverse=True)[:12]


def build_alerts(context: dict, class_rows: list[dict], instructor_rows: list[dict]) -> list[dict]:
    reviewed = context.get("reviewed_alert_ids", set())
    class_names = class_name_map(context["classes"])
    alerts = []

    for row in class_rows:
        if row.get("trend") == "declining":
            drop = abs(round(row["trend_delta"], 1))
            alerts.append(
                {
                    "alert_id": alert_id("class_decline", row["class_id"]),
                    "severity": "critical" if row["engagement_score"] < 45 or drop >= 15 else "warning",
                    "type": "class_engagement_dropped",
                    "class_id": row["class_id"],
                    "class_name": row["class_name"],
                    "affected": row["class_name"],
                    "reason": f"{row['class_name']} engagement dropped {drop}% this week.",
                    "recommended_action": "Check recent participation and ask the instructor if support is needed.",
                    "created_at": row.get("last_activity") or iso_date(utc_now()),
                }
            )
        if row.get("risk_count", 0) >= 3:
            alerts.append(
                {
                    "alert_id": alert_id("class_risk", row["class_id"]),
                    "severity": "critical" if row["risk_count"] >= 8 else "warning",
                    "type": "many_students_at_risk",
                    "class_id": row["class_id"],
                    "class_name": row["class_name"],
                    "affected": row["class_name"],
                    "reason": f"{row['risk_count']} students need support.",
                    "recommended_action": "Review risk reasons and schedule targeted support.",
                    "created_at": row.get("last_activity") or iso_date(utc_now()),
                }
            )
        if row.get("inactive_days") is not None and row["inactive_days"] >= 14:
            alerts.append(
                {
                    "alert_id": alert_id("class_inactive", row["class_id"]),
                    "severity": "attention",
                    "type": "class_inactive",
                    "class_id": row["class_id"],
                    "class_name": row["class_name"],
                    "affected": row["class_name"],
                    "reason": f"No class activity for {row['inactive_days']} days.",
                    "recommended_action": "Check class inactivity with the instructor.",
                    "created_at": row.get("last_activity") or iso_date(utc_now()),
                }
            )

    for row in instructor_rows:
        if row.get("pending_short_answer_reviews", 0) >= 10:
            alerts.append(
                {
                    "alert_id": alert_id("pending_reviews", row["instructor_id"]),
                    "severity": "attention",
                    "type": "pending_reviews",
                    "affected": row["instructor_name"],
                    "reason": f"{row['pending_short_answer_reviews']} answers may need review.",
                    "recommended_action": "Ask instructor to review pending answers.",
                    "created_at": row.get("last_activity") or iso_date(utc_now()),
                }
            )

    weak_by_class_concept = Counter((item.get("class_id"), item.get("concept")) for item in context["weak_concepts"] if item.get("class_id") and item.get("concept"))
    for (class_id, concept), count in weak_by_class_concept.items():
        if count >= 1:
            class_name = class_names.get(class_id, class_id)
            alerts.append(
                {
                    "alert_id": alert_id("weak_concept_repeated", class_id, concept),
                    "severity": "attention",
                    "type": "weak_concept_repeated",
                    "class_id": class_id,
                    "class_name": class_name,
                    "affected": class_name,
            "reason": f"{class_name} has Bloom mastery below threshold in {concept}.",
                    "recommended_action": f"Reinforce {concept} with a short example and follow-up question.",
                    "created_at": iso_date(utc_now()),
                }
            )

    for alert in alerts:
        alert["reviewed"] = alert["alert_id"] in reviewed
    return sorted(alerts, key=lambda row: (row["reviewed"], severity_rank(row["severity"]), row.get("created_at") or ""), reverse=False)[:30]


def build_recommendations(alerts: list[dict], class_rows: list[dict], instructor_rows: list[dict]) -> list[dict]:
    recommendations = []
    for alert in alerts:
        if not alert.get("reviewed"):
            recommendations.append(
                {
                    "title": alert["recommended_action"],
                    "reason": alert["reason"],
                    "severity": alert["severity"],
                    "source": alert["affected"],
                }
            )
    if not recommendations:
        low_classes = [row for row in class_rows if row.get("engagement_score", 0) < 60]
        if low_classes:
            recommendations.append(
                {
                    "title": "Schedule reinforcement session.",
                    "reason": f"{len(low_classes)} classes have engagement below target.",
                    "severity": "attention",
                    "source": "Class monitoring",
                }
            )
    return recommendations[:8]


async def command_center_payload(db: AsyncIOMotorDatabase) -> dict:
    context = await load_admin_context(db)
    class_rows = build_class_monitoring(context)
    instructor_rows = build_instructor_monitoring(context, class_rows)
    alerts = build_alerts(context, class_rows, instructor_rows)
    trends = build_trends(context)
    prediction = build_prediction_overview(context)
    students_support = build_students_support_summary(context, class_rows)

    total_classes = len(class_rows)
    active_classes = len([row for row in class_rows if str(row.get("status", "active")).lower() not in {"inactive", "archived"}])
    risk_students = sum(row.get("risk_count", 0) for row in class_rows)
    engagement = avg([row.get("engagement_score", 0) for row in class_rows])
    instructor_activity = avg([100 if row.get("last_activity") else 0 for row in instructor_rows])
    health_score = clamp((0.55 * engagement) + (0.25 * max(0, 100 - min(risk_students * 5, 100))) + (0.20 * instructor_activity))
    classes_requiring_attention = len([
        row
        for row in class_rows
        if row.get("health_status") != "Healthy" or row.get("risk_count", 0) > 0 or row.get("weak_concepts_count", 0) > 0 or row.get("trend") == "declining"
    ])
    return {
        "health": {
            "institution_engagement_health": health_score,
            "risk_level": health_status(health_score),
            "active_classes": active_classes,
            "total_classes": total_classes,
            "active_activity_percentage": round((active_classes / total_classes) * 100, 2) if total_classes else 0.0,
            "students_needing_support": risk_students,
            "students_needing_support_weekly_trend": students_support["weekly_trend"],
            "classes_requiring_attention": classes_requiring_attention,
            "instructor_activity": instructor_activity,
            "status": health_status(health_score),
        },
        "alerts": alerts,
        "classes": class_rows,
        "instructors": instructor_rows,
        "risk_overview": build_risk_overview(context, class_rows, instructor_rows),
        "prediction_overview": prediction,
        "students_support": students_support,
        "recommendations": build_recommendations(alerts, class_rows, instructor_rows),
        "trends": trends[-12:],
        "recent_activity": build_recent_activity(context),
        "secondary_metrics": {
            "running_sessions": len([session for session in context["sessions"] if session.get("status") == "active"]),
            "responses": len(context["responses"]),
        },
        "generated_at": iso_date(utc_now()),
    }


async def mark_alert_reviewed(db: AsyncIOMotorDatabase, alert_id_value: str, admin_id: str) -> dict:
    now = utc_now()
    await db[MongoCollections.admin_alert_reviews].update_one(
        {"alert_id": alert_id_value, "reviewed_by": admin_id},
        {"$set": {"alert_id": alert_id_value, "reviewed_by": admin_id, "reviewed_at": now}},
        upsert=True,
    )
    return {"alert_id": alert_id_value, "reviewed": True, "reviewed_at": now}
