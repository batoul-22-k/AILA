from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import get_current_user, require_class_role
from app.analytics_services import recalculate_class_analytics
from app.database import MongoCollections, get_db
from app.models import ResponseOut, SubmitAnswerRequest, new_id, utc_now
from app.realtime import manager
from app.semantic_service import evaluate_short_answer
from app.services import get_live_session_stats

router = APIRouter(prefix="/responses", tags=["responses"])


def normalize_answer(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def is_answer_correct(question: dict | None, answer: str, semantic_result: dict) -> bool:
    if not question:
        return False
    if question.get("type") == "short_answer":
        return semantic_result.get("semantic_label") == "correct"
    normalized_answer = normalize_answer(answer)
    normalized_correct = normalize_answer(question.get("correct_answer"))
    if normalized_answer == normalized_correct:
        return True
    options = question.get("options") or []
    letters = "abcdefghijklmnopqrstuvwxyz"
    for index, option in enumerate(options):
        option_text = normalize_answer(option)
        option_letter = letters[index] if index < len(letters) else ""
        if normalized_correct == option_letter and normalized_answer == option_text:
            return True
        if normalized_answer == option_letter and normalized_correct == option_text:
            return True
    return False


@router.post("", response_model=ResponseOut)
async def submit_student_answer(
    payload: SubmitAnswerRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ResponseOut:
    session = await db[MongoCollections.sessions].find_one({"session_id": payload.session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await require_class_role(db, user, session["class_id"], "student")
    if payload.question_id not in session.get("question_ids", []):
        raise HTTPException(status_code=400, detail="Question is not part of this session")
    answer = payload.answer.strip()
    if not answer:
        raise HTTPException(status_code=400, detail="Answer cannot be empty")
    submitted_at = utc_now()
    question_ends_at = session.get("question_ends_at")
    if question_ends_at:
        try:
            if question_ends_at.tzinfo is None:
                question_ends_at = question_ends_at.replace(tzinfo=submitted_at.tzinfo)
            if submitted_at > question_ends_at:
                raise HTTPException(status_code=400, detail="This question's answer window has ended")
        except AttributeError:
            pass
    question = await db[MongoCollections.approved_questions].find_one({"question_id": payload.question_id})
    if not question:
        question = await db[MongoCollections.generated_questions].find_one({"question_id": payload.question_id})

    session_start = session.get("created_at")
    response_time_seconds = None
    if session_start:
        try:
            if session_start.tzinfo is None:
                session_start = session_start.replace(tzinfo=submitted_at.tzinfo)
            response_time_seconds = max((submitted_at - session_start).total_seconds(), 0)
        except AttributeError:
            response_time_seconds = None

    semantic_result = {}
    if question and question.get("type") == "short_answer":
        semantic_result = evaluate_short_answer(question.get("correct_answer", ""), answer)
    is_correct = is_answer_correct(question, answer, semantic_result)
    stars_earned = 1 if is_correct else 0
    revealed_question_ids = set(session.get("revealed_question_ids") or [])

    existing = await db[MongoCollections.responses].find_one(
        {"session_id": payload.session_id, "question_id": payload.question_id, "student_id": user["user_id"]}
    )
    if existing:
        await db[MongoCollections.responses].delete_many(
            {
                "session_id": payload.session_id,
                "question_id": payload.question_id,
                "student_id": user["user_id"],
                "response_id": {"$ne": existing["response_id"]},
            }
        )
    response = ResponseOut(
        response_id=existing["response_id"] if existing else new_id("response"),
        session_id=payload.session_id,
        question_id=payload.question_id,
        student_id=user["user_id"],
        answer=answer,
        is_correct=is_correct,
        stars_earned=stars_earned,
        revealed_after_submission=payload.question_id in revealed_question_ids,
        response_time_seconds=response_time_seconds,
        submitted_at=submitted_at,
        **semantic_result,
    )
    await db[MongoCollections.responses].update_one(
        {"session_id": payload.session_id, "question_id": payload.question_id, "student_id": user["user_id"]},
        {"$set": response.model_dump()},
        upsert=True,
    )
    await db[MongoCollections.student_rewards].update_one(
        {"session_id": payload.session_id, "question_id": payload.question_id, "student_id": user["user_id"]},
        {
            "$set": {
                "stars_earned": stars_earned,
                "badge_earned": False,
                "badge_type": None,
                "is_correct": is_correct,
                "updated_at": utc_now(),
            },
            "$setOnInsert": {
                "reward_id": new_id("reward"),
                "session_id": payload.session_id,
                "student_id": user["user_id"],
                "question_id": payload.question_id,
                "created_at": utc_now(),
            },
        },
        upsert=True,
    )

    stats = await get_live_session_stats(db, payload.session_id)
    await manager.broadcast(
        payload.session_id,
        {
            "type": "response_submitted",
            "payload": {
                "session_id": payload.session_id,
                "question_id": payload.question_id,
                "student_id": user["user_id"],
                "submitted_at": submitted_at.isoformat(),
                "stats": stats.model_dump(mode="json"),
            },
        },
    )
    await manager.broadcast(payload.session_id, {"type": "session_stats", "payload": stats.model_dump(mode="json")})
    await recalculate_class_analytics(db, session["class_id"])
    return response
