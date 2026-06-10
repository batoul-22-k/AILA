from collections import defaultdict

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.analytics_services import risk_level_for
from app.database import MongoCollections
from app.models import new_id, utc_now
from app.services import serialize_document


def risk_probability_for(risk_level: str, engagement_score: float) -> float:
    if risk_level == "High":
        return round(max(0.7, min(1.0, (100 - engagement_score) / 100)), 2)
    if risk_level == "Medium":
        return round(max(0.35, min(0.69, (100 - engagement_score) / 100)), 2)
    return round(max(0.05, min(0.34, (100 - engagement_score) / 100)), 2)


async def semantic_score_by_student_class(db: AsyncIOMotorDatabase, class_id: str) -> dict[str, float]:
    sessions = await db[MongoCollections.sessions].find({"class_id": class_id}, {"session_id": 1}).to_list(length=None)
    session_ids = [session["session_id"] for session in sessions if session.get("session_id")]
    if not session_ids:
        return {}

    responses = await db[MongoCollections.responses].find(
        {"session_id": {"$in": session_ids}, "semantic_score": {"$ne": None}},
        {"student_id": 1, "semantic_score": 1},
    ).to_list(length=None)
    scores_by_student: dict[str, list[float]] = defaultdict(list)
    for response in responses:
        if response.get("student_id") and response.get("semantic_score") is not None:
            scores_by_student[response["student_id"]].append(float(response["semantic_score"]))
    return {
        student_id: round(sum(scores) / len(scores), 4)
        for student_id, scores in scores_by_student.items()
        if scores
    }


async def recalculate_class_predictions(db: AsyncIOMotorDatabase, class_id: str) -> dict:
    analytics_rows = await db[MongoCollections.analytics_results].find({"class_id": class_id}).to_list(length=None)
    latest_by_student: dict[str, dict] = {}
    for row in analytics_rows:
        clean = serialize_document(row)
        current = latest_by_student.get(clean["student_id"])
        if not current or clean.get("week", "") >= current.get("week", ""):
            latest_by_student[clean["student_id"]] = clean

    semantic_scores = await semantic_score_by_student_class(db, class_id)
    predicted_at = utc_now()
    prediction_docs = []
    for student_id, analytics in latest_by_student.items():
        engagement = float(analytics.get("engagement_score", 0.0))
        semantic_score = semantic_scores.get(student_id, 0.0)
        predicted_performance = round((0.8 * engagement) + (0.2 * semantic_score * 100), 2)
        risk_level = risk_level_for(
            float(analytics.get("attendance_rate", 0.0)),
            float(analytics.get("participation_rate", 0.0)),
            engagement,
        )
        prediction_docs.append(
            {
                "prediction_id": new_id("prediction"),
                "student_id": student_id,
                "class_id": class_id,
                "features": {
                    "attendance_rate": analytics.get("attendance_rate", 0.0),
                    "participation_rate": analytics.get("participation_rate", 0.0),
                    "engagement_score": engagement,
                    "average_response_time": analytics.get("average_response_time", 0.0),
                    "semantic_score": semantic_score,
                },
                "predicted_performance": predicted_performance,
                "risk_probability": risk_probability_for(risk_level, engagement),
                "predicted_at": predicted_at,
            }
        )

    await db[MongoCollections.prediction_results].delete_many({"class_id": class_id})
    if prediction_docs:
        await db[MongoCollections.prediction_results].insert_many(prediction_docs)

    # TODO:
    # Train XGBoost using OULAD dataset.
    # Train risk prediction model.
    # Load model from disk.
    # Perform future performance prediction.
    return {"class_id": class_id, "calculated_count": len(prediction_docs), "predicted_at": predicted_at}
