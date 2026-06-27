from datetime import datetime
from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import MongoCollections
from app.models import LiveSessionStats, utc_now
from app.response_scoring import final_is_correct, final_response_label


async def generate_unique_session_code(db: AsyncIOMotorDatabase, code_factory, attempts: int = 20) -> str:
    for _ in range(attempts):
        code = code_factory()
        existing = await db[MongoCollections.sessions].find_one({"session_code": code}, {"_id": 1})
        if not existing:
            return code
    raise RuntimeError("Could not generate a unique session code")


async def get_live_session_stats(db: AsyncIOMotorDatabase, session_id: str) -> LiveSessionStats:
    session = await db[MongoCollections.sessions].find_one({"session_id": session_id}, {"question_ids": 1})
    responses = await db[MongoCollections.responses].find({"session_id": session_id}).to_list(length=None)
    participation_records = await db[MongoCollections.participation_records].find(
        {"session_id": session_id}
    ).to_list(length=None)

    joined_student_ids = {record["student_id"] for record in participation_records}
    response_student_ids = {response["student_id"] for response in responses}
    participant_ids = joined_student_ids | response_student_ids

    answer_distribution: dict[str, dict[str, int]] = {}
    correct_counts: dict[str, int] = {}
    incorrect_counts: dict[str, int] = {}
    semantic_counts: dict[str, dict[str, int]] = {}
    question_ids = session.get("question_ids", []) if session else []
    for response in responses:
        question_id = response["question_id"]
        answer = response["answer"]
        answer_distribution.setdefault(question_id, {})
        answer_distribution[question_id][answer] = answer_distribution[question_id].get(answer, 0) + 1
        is_correct = final_is_correct(response)
        semantic_label = final_response_label(response)
        if is_correct is True:
            correct_counts[question_id] = correct_counts.get(question_id, 0) + 1
        if is_correct is False and semantic_label != "partial":
            incorrect_counts[question_id] = incorrect_counts.get(question_id, 0) + 1
        if semantic_label in {"correct", "partial", "incorrect"}:
            semantic_counts.setdefault(question_id, {"correct": 0, "partial": 0, "incorrect": 0, "pending": 0})
            semantic_counts[question_id][semantic_label] += 1
        elif is_correct is True:
            semantic_counts.setdefault(question_id, {"correct": 0, "partial": 0, "incorrect": 0, "pending": 0})
            semantic_counts[question_id]["correct"] += 1
        elif is_correct is False:
            semantic_counts.setdefault(question_id, {"correct": 0, "partial": 0, "incorrect": 0, "pending": 0})
            semantic_counts[question_id]["incorrect"] += 1
        else:
            semantic_counts.setdefault(question_id, {"correct": 0, "partial": 0, "incorrect": 0, "pending": 0})
            semantic_counts[question_id]["pending"] += 1

    presented_question_ids = set(question_ids) or {response["question_id"] for response in responses}
    submitted_pairs = {
        (response["student_id"], response["question_id"])
        for response in responses
        if response["question_id"] in presented_question_ids
    }
    unanswered_count = max((len(participant_ids) * len(presented_question_ids)) - len(submitted_pairs), 0)

    return LiveSessionStats(
        session_id=session_id,
        participation_count=len(participant_ids),
        answer_distribution=answer_distribution,
        correct_counts=correct_counts,
        incorrect_counts=incorrect_counts,
        semantic_counts=semantic_counts,
        unanswered_count_placeholder=unanswered_count,
        updated_at=utc_now(),
    )


async def delete_session_cascade(
    db: AsyncIOMotorDatabase,
    session: dict,
    *,
    delete_orphan_questions: bool = True,
) -> dict:
    session_id = session["session_id"]
    question_ids = list(dict.fromkeys(session.get("question_ids") or []))
    deleted_responses = await db[MongoCollections.responses].delete_many({"session_id": session_id})
    deleted_rewards = await db[MongoCollections.student_rewards].delete_many({"session_id": session_id})
    deleted_participation = await db[MongoCollections.participation_records].delete_many({"session_id": session_id})
    deleted_session = await db[MongoCollections.sessions].delete_one({"session_id": session_id})

    deleted_generated_questions = 0
    deleted_approved_questions = 0
    deleted_question_ids: list[str] = []
    if delete_orphan_questions and question_ids:
        remaining_sessions = await db[MongoCollections.sessions].find(
            {"question_ids": {"$in": question_ids}},
            {"question_ids": 1},
        ).to_list(length=None)
        still_used_question_ids = {
            question_id
            for remaining_session in remaining_sessions
            for question_id in (remaining_session.get("question_ids") or [])
            if question_id in question_ids
        }
        deleted_question_ids = [question_id for question_id in question_ids if question_id not in still_used_question_ids]
        if deleted_question_ids:
            generated_result = await db[MongoCollections.generated_questions].delete_many(
                {"question_id": {"$in": deleted_question_ids}}
            )
            approved_result = await db[MongoCollections.approved_questions].delete_many(
                {"question_id": {"$in": deleted_question_ids}}
            )
            deleted_generated_questions = generated_result.deleted_count
            deleted_approved_questions = approved_result.deleted_count

    return {
        "status": "deleted",
        "session_id": session_id,
        "deleted_sessions": deleted_session.deleted_count,
        "deleted_responses": deleted_responses.deleted_count,
        "deleted_rewards": deleted_rewards.deleted_count,
        "deleted_participation_records": deleted_participation.deleted_count,
        "deleted_question_ids": deleted_question_ids,
        "deleted_generated_questions": deleted_generated_questions,
        "deleted_approved_questions": deleted_approved_questions,
    }


def serialize_mongo_value(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, list):
        return [serialize_mongo_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(serialize_mongo_value(item) for item in value)
    if isinstance(value, dict):
        return {key: serialize_mongo_value(item) for key, item in value.items()}
    return value


def serialize_document(document: dict) -> dict:
    clean = dict(document)
    clean.pop("_id", None)
    return serialize_mongo_value(clean)


def serialize_datetime(value: datetime) -> str:
    return value.isoformat()
