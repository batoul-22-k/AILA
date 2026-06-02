from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import MongoCollections
from app.models import LiveSessionStats, utc_now


async def get_live_session_stats(db: AsyncIOMotorDatabase, session_id: str) -> LiveSessionStats:
    responses = await db[MongoCollections.responses].find({"session_id": session_id}).to_list(length=None)
    student_ids = {response["student_id"] for response in responses}

    answer_distribution: dict[str, dict[str, int]] = {}
    for response in responses:
        question_id = response["question_id"]
        answer = response["answer"]
        answer_distribution.setdefault(question_id, {})
        answer_distribution[question_id][answer] = answer_distribution[question_id].get(answer, 0) + 1

    # TODO: Replace with roster-aware unanswered counts once class enrollment exists.
    unanswered_count_placeholder = 0

    return LiveSessionStats(
        session_id=session_id,
        participation_count=len(student_ids),
        answer_distribution=answer_distribution,
        unanswered_count_placeholder=unanswered_count_placeholder,
        updated_at=utc_now(),
    )


def serialize_document(document: dict) -> dict:
    clean = dict(document)
    clean.pop("_id", None)
    return clean


def serialize_datetime(value: datetime) -> str:
    return value.isoformat()
