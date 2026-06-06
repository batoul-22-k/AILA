from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import get_current_user, require_class_role
from app.database import MongoCollections, get_db
from app.models import ResponseOut, SubmitAnswerRequest, new_id, utc_now
from app.realtime import manager
from app.services import get_live_session_stats

router = APIRouter(prefix="/responses", tags=["responses"])


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
    # TODO: Add semantic answer evaluation and correctness scoring.
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
        submitted_at=utc_now(),
    )
    await db[MongoCollections.responses].update_one(
        {"session_id": payload.session_id, "question_id": payload.question_id, "student_id": user["user_id"]},
        {"$set": response.model_dump()},
        upsert=True,
    )

    stats = await get_live_session_stats(db, payload.session_id)
    await manager.broadcast(payload.session_id, {"type": "session_stats", "payload": stats.model_dump(mode="json")})
    return response
