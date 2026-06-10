from collections import defaultdict
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import MongoCollections
from app.models import new_id, utc_now
from app.services import serialize_document


def percentage(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round((numerator / denominator) * 100, 2)


def engagement_score(attendance_rate: float, participation_rate: float, consistency_rate: float) -> float:
    return round((0.4 * attendance_rate) + (0.4 * participation_rate) + (0.2 * consistency_rate), 2)


def session_datetime(session: dict) -> datetime:
    value = session.get("scheduled_for") or session.get("created_at") or utc_now()
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return utc_now()


def week_key(value: datetime) -> str:
    iso_year, iso_week, _weekday = value.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def session_week(session: dict) -> str:
    return week_key(session_datetime(session))


def is_countable_session(session: dict) -> bool:
    if session.get("status") == "scheduled" and session.get("scheduled_for"):
        return session_datetime(session) <= utc_now()
    return True


def average(values: list[float]) -> float:
    if not values:
        return 0.0
    return round(sum(values) / len(values), 2)


def risk_level_for(attendance_rate: float, participation_rate: float, engagement_score_value: float) -> str:
    if attendance_rate < 50 or engagement_score_value < 40:
        return "High"
    if 40 <= engagement_score_value <= 70:
        return "Medium"
    return "Low"


def risk_reason_for(attendance_rate: float, participation_rate: float, engagement_score_value: float) -> str:
    if attendance_rate < 50:
        return "Low attendance"
    if engagement_score_value < 40:
        return "Low engagement score"
    if engagement_score_value <= 70:
        return "Engagement below target"
    return "On track"


def value_average(values: list[float]) -> float:
    clean_values = [float(value) for value in values if value is not None]
    if not clean_values:
        return 0.0
    return round(sum(clean_values) / len(clean_values), 2)


async def get_active_student_ids(db: AsyncIOMotorDatabase, class_id: str) -> list[str]:
    memberships = await db[MongoCollections.class_memberships].find(
        {"class_id": class_id, "role": "student", "status": "active"},
        {"user_id": 1},
    ).to_list(length=None)
    return sorted({membership["user_id"] for membership in memberships if membership.get("user_id")})


async def get_class_sessions(db: AsyncIOMotorDatabase, class_id: str) -> list[dict]:
    sessions = await db[MongoCollections.sessions].find({"class_id": class_id}).sort("created_at", 1).to_list(length=None)
    return [serialize_document(session) for session in sessions if is_countable_session(session)]


async def generate_risk_alerts(db: AsyncIOMotorDatabase, class_id: str, analytics_docs: list[dict]) -> None:
    class_doc = await db[MongoCollections.classes].find_one({"class_id": class_id})
    instructor_ids = class_doc.get("instructor_ids", []) if class_doc else []
    if not instructor_ids:
        return

    latest_by_student: dict[str, dict] = {}
    for doc in analytics_docs:
        current = latest_by_student.get(doc["student_id"])
        if not current or doc["week"] >= current["week"]:
            latest_by_student[doc["student_id"]] = doc

    risky_docs = [doc for doc in latest_by_student.values() if doc["risk_level"] in {"High", "Medium"}]
    if not risky_docs:
        return

    users = await db[MongoCollections.users].find(
        {"user_id": {"$in": [doc["student_id"] for doc in risky_docs]}},
        {"user_id": 1, "name": 1},
    ).to_list(length=None)
    names_by_id = {user["user_id"]: user.get("name") or user["user_id"] for user in users}
    now = utc_now()

    for doc in risky_docs:
        student_name = names_by_id.get(doc["student_id"], doc["student_id"])
        for instructor_id in instructor_ids:
            risk_key = f"{class_id}:{doc['student_id']}:{doc['week']}:{doc['risk_level']}"
            await db[MongoCollections.notifications].update_one(
                {"user_id": instructor_id, "risk_key": risk_key},
                {
                    "$set": {
                        "title": f"{doc['risk_level']} risk student",
                        "description": f"{student_name} needs support: {doc['risk_reason']}.",
                        "tone": "warning",
                        "class_id": class_id,
                        "student_id": doc["student_id"],
                        "week": doc["week"],
                    },
                    "$setOnInsert": {
                        "notification_id": new_id("notification"),
                        "user_id": instructor_id,
                        "risk_key": risk_key,
                        "read": False,
                        "created_at": now,
                    },
                },
                upsert=True,
            )


async def recalculate_class_analytics(db: AsyncIOMotorDatabase, class_id: str) -> dict:
    students = await get_active_student_ids(db, class_id)
    sessions = await get_class_sessions(db, class_id)
    calculated_at = utc_now()

    await db[MongoCollections.analytics_results].delete_many({"class_id": class_id})
    if not students or not sessions:
        return {
            "class_id": class_id,
            "calculated_count": 0,
            "total_students": len(students),
            "total_sessions": len(sessions),
            "weeks": [],
            "calculated_at": calculated_at,
        }

    sessions_by_id = {session["session_id"]: session for session in sessions if session.get("session_id")}
    sessions_by_week: dict[str, list[dict]] = defaultdict(list)
    for session in sessions:
        sessions_by_week[session_week(session)].append(session)

    session_ids = list(sessions_by_id)
    participation_records = await db[MongoCollections.participation_records].find(
        {"session_id": {"$in": session_ids}, "student_id": {"$in": students}},
        {"session_id": 1, "student_id": 1},
    ).to_list(length=None)
    responses = await db[MongoCollections.responses].find(
        {"session_id": {"$in": session_ids}, "student_id": {"$in": students}},
        {
            "session_id": 1,
            "question_id": 1,
            "student_id": 1,
            "response_time_seconds": 1,
            "response_time_placeholder": 1,
            "semantic_score": 1,
        },
    ).to_list(length=None)

    attended_sessions_by_student: dict[str, set[str]] = defaultdict(set)
    for record in participation_records:
        if record.get("session_id") in sessions_by_id and record.get("student_id") in students:
            attended_sessions_by_student[record["student_id"]].add(record["session_id"])

    answered_questions_by_student: dict[str, set[tuple[str, str]]] = defaultdict(set)
    answered_sessions_by_student: dict[str, set[str]] = defaultdict(set)
    response_times_by_student_week: dict[tuple[str, str], list[float]] = defaultdict(list)
    semantic_scores_by_student_week: dict[tuple[str, str], list[float]] = defaultdict(list)
    for response in responses:
        session_id = response.get("session_id")
        student_id = response.get("student_id")
        question_id = response.get("question_id")
        if session_id in sessions_by_id and student_id in students and question_id:
            current_week = session_week(sessions_by_id[session_id])
            answered_questions_by_student[student_id].add((session_id, question_id))
            answered_sessions_by_student[student_id].add(session_id)
            response_time = response.get("response_time_seconds", response.get("response_time_placeholder"))
            if response_time is not None:
                response_times_by_student_week[(student_id, current_week)].append(float(response_time))
            if response.get("semantic_score") is not None:
                semantic_scores_by_student_week[(student_id, current_week)].append(float(response["semantic_score"]))

    analytics_docs: list[dict] = []
    for week, week_sessions in sorted(sessions_by_week.items()):
        week_session_ids = {session["session_id"] for session in week_sessions if session.get("session_id")}
        total_week_sessions = len(week_session_ids)
        total_week_questions = sum(len(session.get("question_ids") or []) for session in week_sessions)

        for student_id in students:
            attended_session_ids = attended_sessions_by_student.get(student_id, set()) & week_session_ids
            answered_question_keys = {
                key
                for key in answered_questions_by_student.get(student_id, set())
                if key[0] in week_session_ids
            }
            answered_session_ids = answered_sessions_by_student.get(student_id, set()) & week_session_ids

            attendance_rate = percentage(len(attended_session_ids), total_week_sessions)
            participation_rate = percentage(len(answered_question_keys), total_week_questions)
            consistency_rate = percentage(len(answered_session_ids), len(attended_session_ids))
            score = engagement_score(attendance_rate, participation_rate, consistency_rate)
            risk_level = risk_level_for(attendance_rate, participation_rate, score)

            analytics_docs.append(
                {
                    "analytics_id": new_id("analytics"),
                    "class_id": class_id,
                    "student_id": student_id,
                    "week": week,
                    "sessions_attended": len(attended_session_ids),
                    "total_sessions": total_week_sessions,
                    "attendance_rate": attendance_rate,
                    "questions_presented": total_week_questions,
                    "questions_answered": len(answered_question_keys),
                    "participation_rate": participation_rate,
                    "consistency_rate": consistency_rate,
                    "sessions_with_answers": len(answered_session_ids),
                    "average_response_time": value_average(response_times_by_student_week.get((student_id, week), [])),
                    "average_semantic_score": value_average(semantic_scores_by_student_week.get((student_id, week), [])),
                    "engagement_score": score,
                    "risk_level": risk_level,
                    "risk_reason": risk_reason_for(attendance_rate, participation_rate, score),
                    "calculated_at": calculated_at,
                }
            )

    if analytics_docs:
        await db[MongoCollections.analytics_results].insert_many(analytics_docs)
        await generate_risk_alerts(db, class_id, analytics_docs)

    from app.prediction_service import recalculate_class_predictions

    await recalculate_class_predictions(db, class_id)

    # TODO: Feed these weekly engagement features into XGBoost/prediction models later.
    return {
        "class_id": class_id,
        "calculated_count": len(analytics_docs),
        "total_students": len(students),
        "total_sessions": len(sessions),
        "weeks": sorted(sessions_by_week),
        "calculated_at": calculated_at,
    }


async def get_student_analytics(db: AsyncIOMotorDatabase, student_id: str) -> list[dict]:
    rows = await db[MongoCollections.analytics_results].find(
        {"student_id": student_id}
    ).sort([("week", -1), ("class_id", 1)]).to_list(length=None)
    return [serialize_document(row) for row in rows]


async def get_student_progress(db: AsyncIOMotorDatabase, student_id: str, class_id: str | None = None) -> dict:
    query = {"student_id": student_id}
    if class_id:
        query["class_id"] = class_id
    rows = await db[MongoCollections.analytics_results].find(query).sort([("week", 1), ("class_id", 1)]).to_list(length=None)
    clean_rows = [serialize_document(row) for row in rows]
    if not clean_rows:
        return {
            "student_id": student_id,
            "class_id": class_id,
            "attendance_rate": 0.0,
            "participation_rate": 0.0,
            "consistency_rate": 0.0,
            "engagement_score": 0.0,
            "risk_level": "Low",
            "sessions_attended": 0,
            "total_sessions": 0,
            "questions_answered": 0,
            "questions_presented": 0,
            "sessions_with_answers": 0,
            "weekly_trend": [],
        }

    latest = clean_rows[-1]
    return {
        "student_id": student_id,
        "class_id": latest.get("class_id"),
        "attendance_rate": latest.get("attendance_rate", 0.0),
        "participation_rate": latest.get("participation_rate", 0.0),
        "consistency_rate": latest.get("consistency_rate", 0.0),
        "engagement_score": latest.get("engagement_score", 0.0),
        "risk_level": latest.get("risk_level", "Low"),
        "sessions_attended": sum(row.get("sessions_attended", 0) for row in clean_rows),
        "total_sessions": sum(row.get("total_sessions", 0) for row in clean_rows),
        "questions_answered": sum(row.get("questions_answered", 0) for row in clean_rows),
        "questions_presented": sum(row.get("questions_presented", 0) for row in clean_rows),
        "sessions_with_answers": sum(row.get("sessions_with_answers", 0) for row in clean_rows),
        "weekly_trend": [
            {
                "week": row.get("week"),
                "class_id": row.get("class_id"),
                "attendance_rate": row.get("attendance_rate", 0.0),
                "participation_rate": row.get("participation_rate", 0.0),
                "consistency_rate": row.get("consistency_rate", 0.0),
                "engagement_score": row.get("engagement_score", 0.0),
            }
            for row in clean_rows
        ],
    }


async def get_class_analytics_summary(db: AsyncIOMotorDatabase, class_id: str) -> dict:
    total_students = len(await get_active_student_ids(db, class_id))
    rows = await db[MongoCollections.analytics_results].find({"class_id": class_id}).to_list(length=None)
    clean_rows = [serialize_document(row) for row in rows]
    if not clean_rows:
        return {
            "class_id": class_id,
            "week": None,
            "average_attendance_rate": 0.0,
            "average_participation_rate": 0.0,
            "average_engagement_score": 0.0,
            "total_students": total_students,
            "active_students": 0,
            "at_risk_students": 0,
            "weekly_averages": [],
        }

    rows_by_week: dict[str, list[dict]] = defaultdict(list)
    for row in clean_rows:
        rows_by_week[row["week"]].append(row)

    weekly_averages = []
    for week, week_rows in sorted(rows_by_week.items()):
        weekly_averages.append(
            {
                "week": week,
                "average_attendance_rate": average([row.get("attendance_rate", 0.0) for row in week_rows]),
                "average_participation_rate": average([row.get("participation_rate", 0.0) for row in week_rows]),
                "average_consistency_rate": average([row.get("consistency_rate", 0.0) for row in week_rows]),
                "average_response_time": average([row.get("average_response_time", 0.0) for row in week_rows]),
                "average_engagement_score": average([row.get("engagement_score", 0.0) for row in week_rows]),
                "at_risk_students": len({row["student_id"] for row in week_rows if row.get("risk_level") in {"High", "Medium"}}),
                "active_students": len(
                    {
                        row["student_id"]
                        for row in week_rows
                        if row.get("attendance_rate", 0) > 0 or row.get("participation_rate", 0) > 0
                    }
                ),
            }
        )

    latest_week = weekly_averages[-1]["week"]
    latest_rows = rows_by_week[latest_week]
    active_students = len(
        {
            row["student_id"]
            for row in latest_rows
            if row.get("attendance_rate", 0) > 0 or row.get("participation_rate", 0) > 0
        }
    )
    at_risk_students = len({row["student_id"] for row in latest_rows if row.get("risk_level") in {"High", "Medium"}})

    # TODO: Add model-backed prediction summaries here after the XGBoost service is trained.
    return {
        "class_id": class_id,
        "week": latest_week,
        "average_attendance_rate": average([row.get("attendance_rate", 0.0) for row in latest_rows]),
        "average_participation_rate": average([row.get("participation_rate", 0.0) for row in latest_rows]),
        "average_engagement_score": average([row.get("engagement_score", 0.0) for row in latest_rows]),
        "total_students": total_students,
        "active_students": active_students,
        "at_risk_students": at_risk_students,
        "weekly_averages": weekly_averages,
    }


async def get_at_risk_students(db: AsyncIOMotorDatabase, class_id: str | None = None, include_all: bool = False) -> list[dict]:
    class_query = {"class_id": class_id} if class_id else {}
    class_rows = await db[MongoCollections.classes].find(class_query).to_list(length=None)
    classes_by_id = {row["class_id"]: serialize_document(row) for row in class_rows if row.get("class_id")}
    class_ids = list(classes_by_id)
    if not class_ids:
        return []

    memberships = await db[MongoCollections.class_memberships].find(
        {"class_id": {"$in": class_ids}, "role": "student", "status": "active"}
    ).to_list(length=None)
    if not memberships:
        return []

    student_ids = sorted({membership["user_id"] for membership in memberships if membership.get("user_id")})
    users = await db[MongoCollections.users].find({"user_id": {"$in": student_ids}}).to_list(length=None)
    users_by_id = {row["user_id"]: serialize_document(row) for row in users if row.get("user_id")}

    analytics_rows = await db[MongoCollections.analytics_results].find({"class_id": {"$in": class_ids}}).to_list(length=None)
    analytics_by_pair: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in analytics_rows:
        clean = serialize_document(row)
        analytics_by_pair[(clean["class_id"], clean["student_id"])].append(clean)
    for rows in analytics_by_pair.values():
        rows.sort(key=lambda row: row.get("week", ""))

    sessions = await db[MongoCollections.sessions].find({"class_id": {"$in": class_ids}}).to_list(length=None)
    sessions_by_class: dict[str, list[dict]] = defaultdict(list)
    sessions_by_id: dict[str, dict] = {}
    for session in sessions:
        clean = serialize_document(session)
        if not is_countable_session(clean):
            continue
        sessions_by_class[clean["class_id"]].append(clean)
        sessions_by_id[clean["session_id"]] = clean

    session_ids = list(sessions_by_id)
    participation_records = await db[MongoCollections.participation_records].find(
        {"session_id": {"$in": session_ids}, "student_id": {"$in": student_ids}},
        {"session_id": 1, "student_id": 1},
    ).to_list(length=None)
    responses = await db[MongoCollections.responses].find(
        {"session_id": {"$in": session_ids}, "student_id": {"$in": student_ids}},
        {"session_id": 1, "student_id": 1, "question_id": 1},
    ).to_list(length=None)

    attended_by_pair: dict[tuple[str, str], set[str]] = defaultdict(set)
    for record in participation_records:
        session = sessions_by_id.get(record.get("session_id"))
        if session:
            attended_by_pair[(session["class_id"], record["student_id"])].add(record["session_id"])

    answered_by_pair: dict[tuple[str, str], set[tuple[str, str]]] = defaultdict(set)
    answered_sessions_by_pair: dict[tuple[str, str], set[str]] = defaultdict(set)
    for response in responses:
        session = sessions_by_id.get(response.get("session_id"))
        question_id = response.get("question_id")
        student_id = response.get("student_id")
        if session and question_id and student_id:
            pair = (session["class_id"], student_id)
            answered_by_pair[pair].add((session["session_id"], question_id))
            answered_sessions_by_pair[pair].add(session["session_id"])

    results: list[dict] = []
    for membership in memberships:
        current_class_id = membership["class_id"]
        class_sessions = sessions_by_class.get(current_class_id, [])
        if not class_sessions:
            continue

        student_id = membership["user_id"]
        pair = (current_class_id, student_id)
        history = analytics_by_pair.get(pair, [])
        latest = history[-1] if history else {
            "week": None,
            "attendance_rate": 0.0,
            "participation_rate": 0.0,
            "consistency_rate": 0.0,
            "engagement_score": 0.0,
        }
        attendance_rate = latest.get("attendance_rate", 0.0)
        participation_rate = latest.get("participation_rate", 0.0)
        engagement = latest.get("engagement_score", 0.0)
        risk_level = risk_level_for(attendance_rate, participation_rate, engagement)
        if not include_all and risk_level == "Low":
            continue

        user = users_by_id.get(student_id, {})
        class_doc = classes_by_id.get(current_class_id, {})
        results.append(
            {
                "student_id": student_id,
                "student_name": user.get("name") or student_id,
                "email": user.get("email"),
                "class_id": current_class_id,
                "class_name": class_doc.get("name") or current_class_id,
                "week": latest.get("week"),
                "attendance_rate": attendance_rate,
                "participation_rate": participation_rate,
                "consistency_rate": latest.get("consistency_rate", 0.0),
                "engagement_score": engagement,
                "risk_level": risk_level,
                "risk_reason": risk_reason_for(attendance_rate, participation_rate, engagement),
                "sessions_attended": len(attended_by_pair.get(pair, set())),
                "total_sessions": len(class_sessions),
                "questions_answered": len(answered_by_pair.get(pair, set())),
                "questions_presented": sum(len(session.get("question_ids") or []) for session in class_sessions),
                "sessions_with_answers": len(answered_sessions_by_pair.get(pair, set())),
                "weekly_history": history,
            }
        )

    return sorted(
        results,
        key=lambda row: (
            {"High": 0, "Medium": 1, "Low": 2}.get(row["risk_level"], 3),
            row["engagement_score"],
            row["student_name"].lower(),
        ),
    )
