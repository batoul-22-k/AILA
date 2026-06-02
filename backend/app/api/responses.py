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
    # TODO: Add semantic answer evaluation and correctness scoring.
    response = ResponseOut(
        response_id=new_id("response"),
        session_id=payload.session_id,
        question_id=payload.question_id,
        student_id=user["user_id"],
        answer=payload.answer,
        submitted_at=utc_now(),
    )
    await db[MongoCollections.responses].insert_one(response.model_dump())

    stats = await get_live_session_stats(db, payload.session_id)
    await manager.broadcast(payload.session_id, {"type": "session_stats", "payload": stats.model_dump(mode="json")})
    return response
