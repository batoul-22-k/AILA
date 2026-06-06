import random
import string

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import account_role_for_user, get_current_user, require_class_role
from app.database import MongoCollections, get_db, get_database
from app.models import CreateSessionRequest, JoinSessionRequest, LiveQuestionOut, SessionOut, new_id, utc_now
from app.realtime import manager
from app.services import get_live_session_stats, serialize_document

router = APIRouter(prefix="/sessions", tags=["sessions"])
ws_router = APIRouter(tags=["websocket"])


def make_session_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


@router.post("", response_model=SessionOut)
async def create_live_session(
    payload: CreateSessionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> SessionOut:
    await require_class_role(db, user, payload.class_id, "instructor")
    class_doc = await db[MongoCollections.classes].find_one({"class_id": payload.class_id})
    if class_doc and class_doc.get("status", "active") in {"archived", "inactive"}:
        raise HTTPException(status_code=400, detail="Activate this class before creating a live session.")
    session = SessionOut(
        session_id=new_id("session"),
        class_id=payload.class_id,
        instructor_id=user["user_id"],
        question_ids=payload.question_ids,
        active_question_id=payload.question_ids[0] if payload.question_ids else None,
        session_code=make_session_code(),
        status="active",
        created_at=utc_now(),
    )
    await db[MongoCollections.sessions].insert_one(session.model_dump())
    return session


@router.post("/join", response_model=SessionOut)
async def join_session_by_code(
    payload: JoinSessionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> SessionOut:
    session = await db[MongoCollections.sessions].find_one(
        {"session_code": payload.session_code.upper(), "status": "active"}
    )
    if not session:
        raise HTTPException(status_code=404, detail="Active session not found")
    class_doc = await db[MongoCollections.classes].find_one({"class_id": session["class_id"]})
    if class_doc and class_doc.get("status", "active") in {"archived", "inactive"}:
        raise HTTPException(status_code=403, detail="This class is inactive")
    await require_class_role(db, user, session["class_id"], "student")

    await db[MongoCollections.participation_records].update_one(
        {"session_id": session["session_id"], "student_id": user["user_id"]},
        {
            "$set": {"last_seen_at": utc_now()},
            "$setOnInsert": {
                "participation_id": new_id("participation"),
                "session_id": session["session_id"],
                "student_id": user["user_id"],
                "joined_at": utc_now(),
            },
        },
        upsert=True,
    )

    stats = await get_live_session_stats(db, session["session_id"])
    await manager.broadcast(session["session_id"], {"type": "session_stats", "payload": stats.model_dump(mode="json")})
    return SessionOut(**serialize_document(session))


@router.get("/{session_id}/questions", response_model=list[LiveQuestionOut])
async def get_session_questions(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[LiveQuestionOut]:
    session = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await require_class_role(db, user, session["class_id"], "student")

    question_ids = session.get("question_ids", [])
    rows = await db[MongoCollections.approved_questions].find({"question_id": {"$in": question_ids}}).to_list(length=100)
    if len(rows) < len(question_ids):
        found_ids = {row["question_id"] for row in rows}
        fallback_rows = await db[MongoCollections.generated_questions].find(
            {"question_id": {"$in": [question_id for question_id in question_ids if question_id not in found_ids]}}
        ).to_list(length=100)
        rows.extend(fallback_rows)

    questions_by_id = {row["question_id"]: row for row in rows}
    return [
        LiveQuestionOut(
            question_id=row["question_id"],
            type=row.get("type", "mcq"),
            question_text=row.get("question_text") or row.get("prompt", ""),
            options=row.get("options", []),
            bloom_level=row.get("bloom_level"),
            difficulty=row.get("difficulty"),
        )
        for question_id in question_ids
        if (row := questions_by_id.get(question_id))
    ]


@router.get("/{session_id}/stats")
async def get_session_statistics(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    session = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if account_role_for_user(user) != "admin":
        instructor_membership = await db[MongoCollections.class_memberships].find_one(
            {"class_id": session["class_id"], "user_id": user["user_id"], "role": "instructor", "status": "active"}
        )
        student_membership = await db[MongoCollections.class_memberships].find_one(
            {"class_id": session["class_id"], "user_id": user["user_id"], "role": "student", "status": "active"}
        )
        if not instructor_membership and not student_membership:
            raise HTTPException(status_code=403, detail="Session permission required")
    stats = await get_live_session_stats(db, session_id)
    return stats.model_dump(mode="json")


@ws_router.websocket("/ws/sessions/{session_id}")
async def live_session_updates(websocket: WebSocket, session_id: str) -> None:
    await manager.connect(session_id, websocket)
    try:
        db = get_database()
        stats = await get_live_session_stats(db, session_id)
        await websocket.send_json({"type": "session_stats", "payload": stats.model_dump(mode="json")})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(session_id, websocket)
