from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import get_current_user, require_account_class_role
from app.analytics_services import recalculate_class_analytics
from app.database import MongoCollections, get_db
from app.gamification_service import REWARD_RULES, award_bulk_reward_transaction, award_rule_event
from app.models import InstructorReviewRequest, ResponseOut, SubmitAnswerRequest, new_id, utc_now
from app.realtime import manager
from app.response_scoring import default_instructor_review, final_is_correct, final_stars_earned, normalize_label, normalize_score
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
    await require_account_class_role(db, user, session["class_id"], "student")
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
    is_short_answer = bool(question and question.get("type") == "short_answer")
    is_correct = None if is_short_answer else is_answer_correct(question, answer, semantic_result)
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
        instructorReview=default_instructor_review(),
        **semantic_result,
    )
    await db[MongoCollections.responses].update_one(
        {"session_id": payload.session_id, "question_id": payload.question_id, "student_id": user["user_id"]},
        {"$set": response.model_dump()},
        upsert=True,
    )
    reward_events = [
        {
            "student_id": user["user_id"],
            "class_id": session["class_id"],
            "session_id": payload.session_id,
            "question_id": payload.question_id,
            "event_type": "answer_question",
            "source_type": "question",
            "source_id": payload.question_id,
            "idempotency_key": f"{user['user_id']}:{payload.session_id}:{payload.question_id}:answer_question",
        }
    ]
    if is_correct is True:
        reward_events.append(
            {
                "student_id": user["user_id"],
                "class_id": session["class_id"],
                "session_id": payload.session_id,
                "question_id": payload.question_id,
                "event_type": "correct_answer",
                "source_type": "question",
                "source_id": payload.question_id,
                "idempotency_key": f"{user['user_id']}:{payload.session_id}:{payload.question_id}:correct_answer",
            }
        )
        existing_correct_count = await db[MongoCollections.gamification_events].count_documents(
            {
                "session_id": payload.session_id,
                "question_id": payload.question_id,
                "event_type": "correct_answer",
            }
        )
        if "first_correct_answer" in REWARD_RULES and existing_correct_count == 0:
            reward_events.append(
                {
                    "student_id": user["user_id"],
                    "class_id": session["class_id"],
                    "session_id": payload.session_id,
                    "question_id": payload.question_id,
                    "event_type": "first_correct_answer",
                    "source_type": "question",
                    "source_id": payload.question_id,
                    "idempotency_key": f"{user['user_id']}:{payload.session_id}:{payload.question_id}:first_correct_answer",
                }
            )
    await award_bulk_reward_transaction(
        db,
        transaction_id=f"answer:{user['user_id']}:{payload.session_id}:{payload.question_id}",
        reward_events=reward_events,
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


@router.patch("/{response_id}/instructor-review")
async def update_instructor_review(
    response_id: str,
    payload: InstructorReviewRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    response = await db[MongoCollections.responses].find_one({"response_id": response_id})
    if not response:
        raise HTTPException(status_code=404, detail="Response not found")

    session = await db[MongoCollections.sessions].find_one({"session_id": response.get("session_id")})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await require_account_class_role(db, user, session["class_id"], "instructor")

    question = await db[MongoCollections.approved_questions].find_one({"question_id": response.get("question_id")})
    if not question:
        question = await db[MongoCollections.generated_questions].find_one({"question_id": response.get("question_id")})
    if question and question.get("type") != "short_answer":
        raise HTTPException(status_code=400, detail="Instructor review is only available for short answers")

    now = utc_now()
    final_score = normalize_score(payload.finalScore)
    final_label = normalize_label(payload.finalLabel)
    instructor_review = {
        "reviewed": True,
        "finalScore": final_score,
        "finalLabel": final_label,
        "feedback": payload.feedback.strip(),
        "showToStudent": payload.showToStudent,
        "reviewedBy": user["user_id"],
        "reviewedAt": now,
    }
    reviewed_response = {
        **response,
        "instructorReview": instructor_review,
        "semantic_score": final_score,
        "final_score": final_score,
        "semantic_label": final_label,
        "is_correct": final_label == "correct",
    }
    was_correct_before = final_is_correct(response)
    stars_earned = final_stars_earned(reviewed_response)

    await db[MongoCollections.responses].update_one(
        {"response_id": response_id},
        {
            "$set": {
                "instructorReview": instructor_review,
                "semantic_score": final_score,
                "final_score": final_score,
                "semantic_label": final_label,
                "is_correct": final_label == "correct",
                "stars_earned": stars_earned,
                "updated_at": now,
            }
        },
    )
    await db[MongoCollections.student_rewards].update_one(
        {"session_id": response["session_id"], "question_id": response["question_id"], "student_id": response["student_id"]},
        {
            "$set": {
                "stars_earned": stars_earned,
                "badge_earned": False,
                "badge_type": None,
                "is_correct": final_label == "correct",
                "updated_at": now,
            },
            "$setOnInsert": {
                "reward_id": new_id("reward"),
                "session_id": response["session_id"],
                "student_id": response["student_id"],
                "question_id": response["question_id"],
                "created_at": now,
            },
        },
        upsert=True,
    )
    if final_label == "correct" and was_correct_before is not True:
        await award_rule_event(
            db,
            student_id=response["student_id"],
            class_id=session["class_id"],
            session_id=response["session_id"],
            question_id=response["question_id"],
            event_type="correct_answer",
            source_type="question",
            source_id=response["question_id"],
            idempotency_key=f"{response_id}:correct_answer",
            metadata={"reviewed_by": user["user_id"], "review_source": "instructor"},
        )
    # TODO: Add reward adjustment logic if an instructor downgrades an answer after XP/stars were awarded.
    await db[MongoCollections.sessions].update_one(
        {"session_id": response["session_id"]},
        {"$set": {"updated_at": now}},
    )

    stats = await get_live_session_stats(db, response["session_id"])
    await manager.broadcast(
        response["session_id"],
        {
            "type": "instructor_review_updated",
            "payload": {
                "session_id": response["session_id"],
                "question_id": response["question_id"],
                "response_id": response_id,
                "student_id": response["student_id"],
                "instructorReview": instructor_review,
                "stats": stats.model_dump(mode="json"),
            },
        },
    )
    await manager.broadcast(response["session_id"], {"type": "session_stats", "payload": stats.model_dump(mode="json")})
    await recalculate_class_analytics(db, session["class_id"])
    return {
        "response_id": response_id,
        "instructorReview": instructor_review,
        "finalScore": final_score,
        "finalLabel": final_label,
        "is_correct": final_label == "correct",
        "stars_earned": stars_earned,
        "stats": stats.model_dump(mode="json"),
    }
