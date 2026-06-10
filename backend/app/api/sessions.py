from datetime import timedelta
import random
import string

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import account_role_for_user, get_current_user, require_class_role
from app.analytics_services import recalculate_class_analytics
from app.database import MongoCollections, get_db, get_database
from app.models import CreateSessionRequest, JoinSessionRequest, LiveQuestionOut, SessionOut, new_id, utc_now
from app.realtime import manager
from app.services import generate_unique_session_code, get_live_session_stats, serialize_document

router = APIRouter(prefix="/sessions", tags=["sessions"])
ws_router = APIRouter(tags=["websocket"])


def make_session_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


async def has_class_role(db: AsyncIOMotorDatabase, user: dict, class_id: str, role: str) -> bool:
    if account_role_for_user(user) == "admin":
        return True
    membership = await db[MongoCollections.class_memberships].find_one(
        {"class_id": class_id, "user_id": user["user_id"], "role": role, "status": "active"},
        {"_id": 1},
    )
    return bool(membership)


async def require_session_instructor(db: AsyncIOMotorDatabase, user: dict, session: dict) -> None:
    # TODO: Replace this class-role check with strict JWT/RBAC policy before production.
    if not await has_class_role(db, user, session["class_id"], "instructor"):
        raise HTTPException(status_code=403, detail="Instructor session permission required")


async def load_session_question_rows(db: AsyncIOMotorDatabase, question_ids: list[str]) -> dict[str, dict]:
    rows = await db[MongoCollections.approved_questions].find({"question_id": {"$in": question_ids}}).to_list(length=200)
    found_ids = {row["question_id"] for row in rows}
    missing_ids = [question_id for question_id in question_ids if question_id not in found_ids]
    if missing_ids:
        rows.extend(
            await db[MongoCollections.generated_questions].find({"question_id": {"$in": missing_ids}}).to_list(length=200)
        )
    return {row["question_id"]: row for row in rows}


async def session_roster_ids(db: AsyncIOMotorDatabase, session: dict) -> set[str]:
    memberships = await db[MongoCollections.class_memberships].find(
        {"class_id": session["class_id"], "role": "student", "status": "active"},
        {"user_id": 1},
    ).to_list(length=None)
    participation = await db[MongoCollections.participation_records].find(
        {"session_id": session["session_id"]},
        {"student_id": 1},
    ).to_list(length=None)
    responses = await db[MongoCollections.responses].find(
        {"session_id": session["session_id"]},
        {"student_id": 1},
    ).to_list(length=None)
    return {
        row.get("user_id") or row.get("student_id")
        for row in [*memberships, *participation, *responses]
        if row.get("user_id") or row.get("student_id")
    }


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
    try:
        session_code = await generate_unique_session_code(db, make_session_code)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    started_at = utc_now() if payload.question_ids else None
    session = SessionOut(
        session_id=new_id("session"),
        class_id=payload.class_id,
        instructor_id=user["user_id"],
        question_ids=payload.question_ids,
        active_question_id=payload.question_ids[0] if payload.question_ids else None,
        session_code=session_code,
        status="active",
        question_started_at=started_at,
        question_duration_seconds=180 if started_at else None,
        question_ends_at=started_at + timedelta(seconds=180) if started_at else None,
        revealed_question_ids=[],
        created_at=utc_now(),
    )
    await db[MongoCollections.sessions].insert_one(session.model_dump())
    await recalculate_class_analytics(db, payload.class_id)
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
    await recalculate_class_analytics(db, session["class_id"])
    clean = serialize_document(session)
    clean.setdefault("revealed_question_ids", [])
    clean.setdefault("question_started_at", None)
    clean.setdefault("question_duration_seconds", None)
    clean.setdefault("question_ends_at", None)
    return SessionOut(**clean)


@router.get("/{session_id}", response_model=SessionOut)
async def get_live_session(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> SessionOut:
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
    clean = serialize_document(session)
    clean.setdefault("active_question_id", clean.get("question_ids", [None])[0] if clean.get("question_ids") else None)
    clean.setdefault("revealed_question_ids", [])
    clean.setdefault("question_started_at", None)
    clean.setdefault("question_duration_seconds", None)
    clean.setdefault("question_ends_at", None)
    if clean.get("status") == "scheduled":
        raise HTTPException(status_code=404, detail="Active session not found")
    return SessionOut(**clean)


@router.get("/{session_id}/questions", response_model=list[LiveQuestionOut])
async def get_session_questions(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[LiveQuestionOut]:
    session = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    is_instructor = await has_class_role(db, user, session["class_id"], "instructor")
    is_student = await has_class_role(db, user, session["class_id"], "student")
    if not is_instructor and not is_student:
        raise HTTPException(status_code=403, detail="Session permission required")

    question_ids = session.get("question_ids", [])
    questions_by_id = await load_session_question_rows(db, question_ids)
    revealed_question_ids = set(session.get("revealed_question_ids") or [])
    responses_by_question: dict[str, dict] = {}
    rewards_by_question: dict[str, dict] = {}
    session_stars = 0
    badge_reward = None
    if is_student and not is_instructor:
        responses = await db[MongoCollections.responses].find(
            {"session_id": session_id, "student_id": user["user_id"]}
        ).sort("submitted_at", -1).to_list(length=None)
        for response in responses:
            responses_by_question.setdefault(response.get("question_id"), serialize_document(response))
        rewards = await db[MongoCollections.student_rewards].find(
            {"session_id": session_id, "student_id": user["user_id"]}
        ).to_list(length=None)
        for reward in rewards:
            clean_reward = serialize_document(reward)
            if clean_reward.get("question_id"):
                rewards_by_question[clean_reward["question_id"]] = clean_reward
                session_stars += int(clean_reward.get("stars_earned") or 0)
            elif clean_reward.get("badge_earned"):
                badge_reward = clean_reward

    return [
        LiveQuestionOut(
            question_id=row["question_id"],
            type=row.get("type", "mcq"),
            question_text=row.get("question_text") or row.get("prompt", ""),
            options=row.get("options", []),
            bloom_level=row.get("bloom_level"),
            difficulty=row.get("difficulty"),
            source_slide=row.get("source_slide"),
            correct_answer=row.get("correct_answer") if is_instructor or row["question_id"] in revealed_question_ids else None,
            explanation=row.get("explanation") if is_instructor or row["question_id"] in revealed_question_ids else None,
            is_revealed=row["question_id"] in revealed_question_ids,
            student_answer=responses_by_question.get(row["question_id"], {}).get("answer"),
            is_correct=responses_by_question.get(row["question_id"], {}).get("is_correct") if row["question_id"] in revealed_question_ids else None,
            stars_earned=int(rewards_by_question.get(row["question_id"], {}).get("stars_earned") or 0) if row["question_id"] in revealed_question_ids else 0,
            session_stars=session_stars,
            badge_earned=bool(badge_reward),
            badge_type=badge_reward.get("badge_type") if badge_reward else None,
        )
        for question_id in question_ids
        if (row := questions_by_id.get(question_id))
    ]


@router.post("/{session_id}/questions/{question_id}/reveal")
async def reveal_session_question(
    session_id: str,
    question_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    session = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await require_session_instructor(db, user, session)
    if question_id not in session.get("question_ids", []):
        raise HTTPException(status_code=400, detail="Question is not part of this session")

    questions_by_id = await load_session_question_rows(db, [question_id])
    question = questions_by_id.get(question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    await db[MongoCollections.sessions].update_one(
        {"session_id": session_id},
        {"$addToSet": {"revealed_question_ids": question_id}, "$set": {"updated_at": utc_now()}},
    )
    stats = await get_live_session_stats(db, session_id)
    payload = {
        "session_id": session_id,
        "question_id": question_id,
        "correct_answer": question.get("correct_answer"),
        "explanation": question.get("explanation"),
        "stats": stats.model_dump(mode="json"),
    }
    await manager.broadcast(session_id, {"type": "answer_revealed", "payload": payload})
    await manager.broadcast(session_id, {"type": "reward_earned", "payload": {"session_id": session_id, "question_id": question_id}})
    await manager.broadcast(session_id, {"type": "session_stats", "payload": stats.model_dump(mode="json")})
    return payload


@router.post("/{session_id}/finish")
async def finish_live_session(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    session = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await require_session_instructor(db, user, session)

    question_ids = list(dict.fromkeys(session.get("question_ids") or []))
    roster_ids = sorted(await session_roster_ids(db, session))
    responses = await db[MongoCollections.responses].find({"session_id": session_id}).sort("submitted_at", -1).to_list(length=None)
    latest_by_student_question: dict[tuple[str, str], dict] = {}
    for response in responses:
        key = (response.get("student_id"), response.get("question_id"))
        if key[0] and key[1] and key not in latest_by_student_question:
            latest_by_student_question[key] = serialize_document(response)

    rewards = []
    now = utc_now()
    for student_id in roster_ids:
        student_responses = [latest_by_student_question.get((student_id, question_id)) for question_id in question_ids]
        total_stars = sum(int(response.get("stars_earned") or 0) for response in student_responses if response)
        answered_all_correctly = bool(question_ids) and all(response and response.get("is_correct") for response in student_responses)
        reward_doc = {
            "session_id": session_id,
            "student_id": student_id,
            "question_id": None,
            "stars_earned": total_stars,
            "badge_earned": answered_all_correctly,
            "badge_type": "Session Master" if answered_all_correctly else None,
            "created_at": now,
            "updated_at": now,
        }
        await db[MongoCollections.student_rewards].update_one(
            {"session_id": session_id, "student_id": student_id, "question_id": None},
            {"$set": reward_doc, "$setOnInsert": {"reward_id": new_id("reward")}},
            upsert=True,
        )
        rewards.append(reward_doc)

    users = await db[MongoCollections.users].find(
        {"user_id": {"$in": roster_ids}},
        {"user_id": 1, "name": 1},
    ).to_list(length=None)
    names_by_id = {row["user_id"]: row.get("name") or row["user_id"] for row in users}
    answered_responses = [response for response in latest_by_student_question.values() if response.get("question_id") in question_ids]
    correct_count = sum(1 for response in answered_responses if response.get("is_correct"))
    average_correctness = round((correct_count / len(answered_responses)) * 100, 1) if answered_responses else 0.0
    top_stars = sorted(
        [{"student_id": reward["student_id"], "student_name": names_by_id.get(reward["student_id"], reward["student_id"]), "stars": reward["stars_earned"]} for reward in rewards],
        key=lambda row: (-row["stars"], row["student_name"].lower()),
    )[:5]
    badge_students = [
        {"student_id": reward["student_id"], "student_name": names_by_id.get(reward["student_id"], reward["student_id"]), "badge_type": reward["badge_type"]}
        for reward in rewards
        if reward["badge_earned"]
    ]
    needs_support = [
        {"student_id": reward["student_id"], "student_name": names_by_id.get(reward["student_id"], reward["student_id"]), "stars": reward["stars_earned"]}
        for reward in rewards
        if reward["stars_earned"] < len(question_ids)
    ][:8]
    summary = {
        "session_id": session_id,
        "total_participants": len(roster_ids),
        "average_correctness": average_correctness,
        "top_stars": top_stars,
        "students_who_earned_badges": badge_students,
        "students_needing_support": needs_support,
        "student_rewards": rewards,
    }
    await db[MongoCollections.sessions].update_one(
        {"session_id": session_id},
        {"$set": {"status": "finished", "updated_at": now}},
    )
    await manager.broadcast(session_id, {"type": "session_finished", "payload": summary})
    return summary


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


@router.get("/{session_id}/responses")
async def get_session_response_details(
    session_id: str,
    question_id: str | None = None,
    answer: str | None = None,
    status_filter: str = Query(default="all", alias="status"),
    correctness: str | None = None,
    search: str = "",
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
        if not instructor_membership:
            raise HTTPException(status_code=403, detail="Instructor session permission required")

    selected_question_id = question_id or session.get("active_question_id")
    if not selected_question_id and session.get("question_ids"):
        selected_question_id = session["question_ids"][0]
    if not selected_question_id or selected_question_id not in session.get("question_ids", []):
        raise HTTPException(status_code=400, detail="Question is not part of this session")

    memberships = await db[MongoCollections.class_memberships].find(
        {"class_id": session["class_id"], "role": "student", "status": "active"},
        {"user_id": 1},
    ).to_list(length=None)
    enrolled_ids = {membership["user_id"] for membership in memberships if membership.get("user_id")}

    participation_records = await db[MongoCollections.participation_records].find(
        {"session_id": session_id},
        {"student_id": 1, "joined_at": 1, "last_seen_at": 1},
    ).to_list(length=None)
    present_ids = {record["student_id"] for record in participation_records if record.get("student_id")}
    participation_by_student = {record["student_id"]: record for record in participation_records if record.get("student_id")}

    responses = await db[MongoCollections.responses].find(
        {"session_id": session_id, "question_id": selected_question_id}
    ).sort("submitted_at", -1).to_list(length=None)
    latest_response_by_student: dict[str, dict] = {}
    for response in responses:
        student_id = response.get("student_id")
        if student_id and student_id not in latest_response_by_student:
            latest_response_by_student[student_id] = serialize_document(response)

    roster_ids = enrolled_ids | present_ids | set(latest_response_by_student)
    users = await db[MongoCollections.users].find(
        {"user_id": {"$in": list(roster_ids)}},
        {"user_id": 1, "name": 1, "email": 1},
    ).to_list(length=None)
    users_by_id = {row["user_id"]: serialize_document(row) for row in users if row.get("user_id")}

    search_text = search.strip().lower()

    def student_name(student_id: str) -> str:
        return users_by_id.get(student_id, {}).get("name") or student_id

    def matches_search(row: dict) -> bool:
        if not search_text:
            return True
        return search_text in " ".join(
            str(row.get(key) or "").lower()
            for key in ("student_name", "student_id", "email", "selected_answer")
        )

    rows: list[dict] = []
    for student_id, response in latest_response_by_student.items():
        selected_answer = response.get("answer")
        if answer is not None and selected_answer != answer:
            continue
        if correctness == "correct" and response.get("is_correct") is not True:
            continue
        if correctness == "incorrect" and response.get("is_correct") is not False:
            continue
        row = {
            "student_name": student_name(student_id),
            "student_id": student_id,
            "email": users_by_id.get(student_id, {}).get("email"),
            "selected_answer": selected_answer,
            "submitted_at": response.get("submitted_at"),
            "confidence_level": response.get("confidence_level"),
            "is_correct": response.get("is_correct"),
            "stars_earned": response.get("stars_earned", 0),
            "status": "answered",
        }
        if status_filter in {"all", "answered"} and matches_search(row):
            rows.append(row)

    answered_ids = set(latest_response_by_student)
    not_answered_ids = sorted(roster_ids - answered_ids, key=lambda current_id: student_name(current_id).lower())
    if answer is None and correctness is None and status_filter in {"all", "not_answered"}:
        for student_id in not_answered_ids:
            participation = participation_by_student.get(student_id, {})
            row = {
                "student_name": student_name(student_id),
                "student_id": student_id,
                "email": users_by_id.get(student_id, {}).get("email"),
                "selected_answer": None,
                "submitted_at": None,
                "confidence_level": None,
                "status": "not_answered",
                "joined_at": participation.get("joined_at"),
                "last_seen_at": participation.get("last_seen_at"),
            }
            if matches_search(row):
                rows.append(row)

    total_students = len(roster_ids)
    answered_count = len(answered_ids)
    not_answered_count = max(total_students - answered_count, 0)
    response_rate = round((answered_count / total_students) * 100, 2) if total_students else 0.0
    correct_count = sum(1 for response in latest_response_by_student.values() if response.get("is_correct") is True)
    incorrect_count = sum(1 for response in latest_response_by_student.values() if response.get("is_correct") is False)

    return {
        "session_id": session_id,
        "question_id": selected_question_id,
        "answer": answer,
        "status": status_filter,
        "correctness": correctness,
        "students": rows,
        "summary": {
            "answered": answered_count,
            "not_answered": not_answered_count,
            "total_students": total_students,
            "response_rate": response_rate,
            "correct": correct_count,
            "incorrect": incorrect_count,
        },
    }


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
