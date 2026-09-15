import logging
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import account_role_for_user, get_current_user, require_account_class_role, require_any_class_role, user_id_from_token
from app.analytics_services import recalculate_class_analytics
from app.database import MongoCollections, get_db
from app.instructor_services import (
    call_ollama_for_questions,
    clean_extracted_text,
    extract_readable_content,
    make_join_link,
    make_qr_base64,
    make_session_code,
    reconstruct_presentation,
    repair_and_validate_question_dicts,
    save_upload_file,
    latest_question_debug_request,
    redact_secret_text,
    test_ollama_connection,
)
from app.models import (
    ActiveQuestionUpdate,
    GenerateQuestionsRequest,
    InstructorQuestion,
    InstructorSessionCreateRequest,
    InstructorSessionOut,
    InstructorSessionStatusUpdate,
    InstructorUploadOut,
    LLMConnectionTestRequest,
    ReconstructPresentationOut,
    ReconstructPresentationRequest,
    RegenerateQuestionRequest,
    SaveInstructorQuestionsRequest,
    new_id,
    utc_now,
)
from app.realtime import manager
from app.services import delete_session_cascade, generate_unique_session_code, get_live_session_stats, serialize_document

router = APIRouter(prefix="/instructor", tags=["instructor"])
logger = logging.getLogger(__name__)


def live_question_notification_id(user_id: str, session_id: str, question_id: str) -> str:
    raw = f"{user_id}|{session_id}|{question_id}|live_question"
    return f"notification_{sha256(raw.encode('utf-8')).hexdigest()[:20]}"


async def require_instructor_account_with_any_class(db: AsyncIOMotorDatabase, user: dict) -> list[str]:
    if account_role_for_user(user) != "instructor":
        raise HTTPException(status_code=403, detail="Instructor account required")
    return await require_any_class_role(db, user, "instructor")


async def require_own_instructor_session(db: AsyncIOMotorDatabase, user: dict, session: dict) -> None:
    await require_account_class_role(db, user, session["class_id"], "instructor")
    if session.get("instructor_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Instructor permission required for your own session")


@router.post("/uploads", response_model=InstructorUploadOut)
async def upload_instructor_lecture(
    class_id: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> InstructorUploadOut:
    await require_account_class_role(db, user, class_id, "instructor")
    upload_id = new_id("upload")
    filename = file.filename or "lecture-material"
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".pptx"}:
        raise HTTPException(status_code=400, detail="Only PPTX and PDF files are supported.")

    created_at = utc_now()
    try:
        path = await save_upload_file(file, upload_id)
        extracted_text = extract_readable_content(path)
        cleaned_text = clean_extracted_text(extracted_text)
        status = "extracted"
        error = None
    except Exception as exc:
        extracted_text = ""
        cleaned_text = ""
        status = "failed"
        error = str(exc)

    upload = InstructorUploadOut(
        upload_id=upload_id,
        instructor_id=user["user_id"],
        class_id=class_id,
        filename=filename,
        file_type=suffix.removeprefix("."),
        status=status,
        extracted_text=extracted_text,
        cleaned_text=cleaned_text,
        error=error,
        created_at=created_at,
        updated_at=utc_now(),
    )
    await db[MongoCollections.lecture_uploads].insert_one(upload.model_dump())
    if error:
        raise HTTPException(status_code=422, detail=error)
    return upload


@router.get("/uploads/{upload_id}", response_model=InstructorUploadOut)
async def get_instructor_upload(
    upload_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> InstructorUploadOut:
    upload = await db[MongoCollections.lecture_uploads].find_one({"upload_id": upload_id})
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    await require_account_class_role(db, user, upload["class_id"], "instructor")
    return InstructorUploadOut(**serialize_document(upload))


@router.post("/questions/generate", response_model=list[InstructorQuestion])
async def generate_instructor_questions(
    payload: GenerateQuestionsRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[InstructorQuestion]:
    await require_instructor_account_with_any_class(db, user)
    text = payload.extracted_text or ""
    class_id = None
    if payload.upload_id:
        upload = await db[MongoCollections.lecture_uploads].find_one({"upload_id": payload.upload_id})
        if not upload:
            raise HTTPException(status_code=404, detail="Upload not found")
        await require_account_class_role(db, user, upload["class_id"], "instructor")
        class_id = upload["class_id"]
        text = upload.get("cleaned_text") or upload.get("extracted_text") or text
    if not text.strip():
        raise HTTPException(status_code=400, detail="No extracted text available for question generation.")

    try:
        questions = call_ollama_for_questions(
            text,
            question_type=payload.question_type,
            bloom_level=payload.bloom_level,
            difficulty=payload.difficulty,
            output_language=payload.output_language,
            question_index=payload.question_index,
            avoid_questions=payload.avoid_questions,
            debug_lecture_id=payload.upload_id,
            debug_class_id=class_id,
            debug_instructor_id=user["user_id"],
            debug_batch_id=payload.batch_id,
            debug_question_number=payload.question_number or payload.question_index,
            debug_question_type=payload.question_type,
            debug_request_kind=payload.request_kind,
            debug_parent_request_id=payload.parent_request_id,
            llm_provider=payload.llm_provider,
            llm_model=payload.llm_model,
        )
    except Exception as exc:
        logger.exception(
            "Instructor question generation failed provider=%s model=%s upload_id=%s class_id=%s error=%s",
            payload.llm_provider or "configured-default",
            payload.llm_model or "configured-default",
            payload.upload_id,
            class_id,
            redact_secret_text(str(exc)),
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    for question in questions:
        question.upload_id = payload.upload_id
        question.status = "generated"
    return questions


@router.post("/llm/test-connection")
async def test_instructor_llm_connection(
    payload: LLMConnectionTestRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_instructor_account_with_any_class(db, user)
    try:
        return test_ollama_connection(payload.provider, payload.model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/questions/save", response_model=list[InstructorQuestion])
async def save_instructor_questions(
    payload: SaveInstructorQuestionsRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[InstructorQuestion]:
    await require_instructor_account_with_any_class(db, user)
    class_id = None
    lecture_text = ""
    if payload.upload_id:
        upload = await db[MongoCollections.lecture_uploads].find_one({"upload_id": payload.upload_id})
        if not upload:
            raise HTTPException(status_code=404, detail="Upload not found")
        class_id = upload["class_id"]
        lecture_text = upload.get("cleaned_text") or upload.get("extracted_text") or ""
        await require_account_class_role(db, user, class_id, "instructor")
    questions: list[InstructorQuestion] = []
    for question in payload.questions:
        question_payload = question.model_dump()
        if lecture_text:
            repaired_questions, _had_quality_failure = repair_and_validate_question_dicts(
                [question_payload],
                lecture_text,
                question.type,
                question.bloom_level,
                question.difficulty,
            )
            if repaired_questions:
                question_payload = repaired_questions[0] | {
                    "question_id": question.question_id,
                    "upload_id": question.upload_id,
                    "status": question.status,
                }
        clean_question = InstructorQuestion(**question_payload)
        saved = question.model_copy(
            update={
                **clean_question.model_dump(),
                "question_id": question.question_id or clean_question.question_id or new_id("question"),
                "upload_id": question.upload_id or clean_question.upload_id or payload.upload_id,
                "status": question.status or clean_question.status or "generated",
            }
        )
        questions.append(saved)

    if questions:
        await db[MongoCollections.generated_questions].insert_many(
            [question.model_dump() | {"class_id": class_id, "created_at": utc_now()} for question in questions]
        )
    return questions


@router.put("/questions/{question_id}", response_model=InstructorQuestion)
async def update_instructor_question(
    question_id: str,
    payload: InstructorQuestion,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> InstructorQuestion:
    existing = await db[MongoCollections.generated_questions].find_one({"question_id": question_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Question not found")
    if existing.get("class_id"):
        await require_account_class_role(db, user, existing["class_id"], "instructor")
    else:
        await require_instructor_account_with_any_class(db, user)
    updated = payload.model_copy(update={"question_id": question_id})
    result = await db[MongoCollections.generated_questions].update_one(
        {"question_id": question_id},
        {"$set": updated.model_dump() | {"updated_at": utc_now()}},
    )
    return updated


@router.delete("/questions/{question_id}")
async def delete_instructor_question(
    question_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    existing = await db[MongoCollections.generated_questions].find_one({"question_id": question_id})
    if existing and existing.get("class_id"):
        await require_account_class_role(db, user, existing["class_id"], "instructor")
    else:
        await require_instructor_account_with_any_class(db, user)
    await db[MongoCollections.generated_questions].delete_one({"question_id": question_id})
    await db[MongoCollections.approved_questions].delete_one({"question_id": question_id})
    return {"status": "deleted", "question_id": question_id}


@router.post("/questions/{question_id}/approve", response_model=InstructorQuestion)
async def approve_instructor_question(
    question_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> InstructorQuestion:
    question = await db[MongoCollections.generated_questions].find_one({"question_id": question_id})
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    if question.get("class_id"):
        await require_account_class_role(db, user, question["class_id"], "instructor")
    else:
        await require_instructor_account_with_any_class(db, user)
    clean = serialize_document(question)
    clean["status"] = "approved"
    approved = InstructorQuestion(**clean)
    approved_doc = approved.model_dump() | {"approved_at": utc_now()}
    if question.get("class_id"):
        approved_doc["class_id"] = question["class_id"]
    await db[MongoCollections.approved_questions].update_one(
        {"question_id": question_id},
        {"$set": approved_doc},
        upsert=True,
    )
    await db[MongoCollections.generated_questions].update_one({"question_id": question_id}, {"$set": {"status": "approved"}})
    return approved


@router.post("/questions/regenerate", response_model=InstructorQuestion)
async def regenerate_instructor_question(
    payload: RegenerateQuestionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> InstructorQuestion:
    await require_instructor_account_with_any_class(db, user)
    text = ""
    class_id = None
    if payload.upload_id:
        upload = await db[MongoCollections.lecture_uploads].find_one({"upload_id": payload.upload_id})
        if upload:
            await require_account_class_role(db, user, upload["class_id"], "instructor")
            class_id = upload["class_id"]
            text = upload.get("cleaned_text") or upload.get("extracted_text") or ""
    if not text:
        text = payload.question.question_text

    try:
        previous_debug = latest_question_debug_request(payload.question.question_id)
        regenerated = call_ollama_for_questions(
            text,
            payload.question,
            debug_lecture_id=payload.upload_id,
            debug_class_id=class_id,
            debug_instructor_id=user["user_id"],
            debug_batch_id=payload.batch_id or (previous_debug or {}).get("batch_id") or str(uuid4()),
            debug_question_number=payload.question_number,
            debug_question_type=payload.question_type or payload.question.type,
            debug_request_kind=payload.request_kind or "manual_regeneration",
            debug_parent_request_id=payload.parent_request_id or (previous_debug or {}).get("request_id"),
            llm_provider=payload.llm_provider,
            llm_model=payload.llm_model,
        )[0]
    except Exception as exc:
        logger.exception(
            "Instructor question regeneration failed provider=%s model=%s upload_id=%s class_id=%s question_id=%s error=%s",
            payload.llm_provider or "configured-default",
            payload.llm_model or "configured-default",
            payload.upload_id,
            class_id,
            payload.question.question_id,
            redact_secret_text(str(exc)),
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    regenerated.question_id = payload.question.question_id or new_id("question")
    regenerated.upload_id = payload.upload_id or payload.question.upload_id
    await db[MongoCollections.generated_questions].update_one(
        {"question_id": regenerated.question_id},
        {"$set": regenerated.model_dump() | {"updated_at": utc_now()}},
        upsert=True,
    )
    return regenerated


@router.get("/questions", response_model=list[InstructorQuestion])
async def list_instructor_questions(
    upload_id: str | None = None,
    class_id: str | None = None,
    status: str | None = None,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[InstructorQuestion]:
    class_ids = await require_instructor_account_with_any_class(db, user)
    query: dict = {}
    if upload_id:
        query["upload_id"] = upload_id
    elif class_id:
        if class_id not in class_ids:
            await require_account_class_role(db, user, class_id, "instructor")
        query["class_id"] = class_id
    else:
        query["$or"] = [{"class_id": {"$in": class_ids}}, {"class_id": None}, {"class_id": {"$exists": False}}]
    if status:
        query["status"] = status
    rows = await db[MongoCollections.generated_questions].find(query).to_list(length=200)
    return [InstructorQuestion(**serialize_document(row)) for row in rows]


@router.post("/presentations/reconstruct", response_model=ReconstructPresentationOut)
async def reconstruct_instructor_presentation(
    payload: ReconstructPresentationRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ReconstructPresentationOut:
    upload = await db[MongoCollections.lecture_uploads].find_one({"upload_id": payload.upload_id})
    if upload:
        await require_account_class_role(db, user, upload["class_id"], "instructor")
    else:
        await require_instructor_account_with_any_class(db, user)
    rows = await db[MongoCollections.approved_questions].find({"question_id": {"$in": payload.question_ids}}).to_list(length=100)
    questions_by_id = {row["question_id"]: InstructorQuestion(**serialize_document(row)) for row in rows}
    questions = [questions_by_id[question_id] for question_id in payload.question_ids if question_id in questions_by_id]
    if not questions:
        raise HTTPException(status_code=400, detail="Approve at least one question before reconstructing a presentation.")
    filename, path = reconstruct_presentation(questions, payload.upload_id, upload, payload.session_code)
    file_id = path.stem
    await db["reconstructed_presentations"].insert_one(
        {
            "file_id": file_id,
            "upload_id": payload.upload_id,
            "filename": filename,
            "path": str(path),
            "question_ids": payload.question_ids,
            "created_at": utc_now(),
        }
    )
    return ReconstructPresentationOut(
        file_id=file_id,
        filename=filename,
        download_url=f"/api/instructor/presentations/{file_id}/download",
        created_at=utc_now(),
    )


@router.get("/presentations/{file_id}/download")
async def download_reconstructed_presentation(
    file_id: str,
    session_token: str | None = Query(default=None),
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> FileResponse:
    user_id = user_id_from_token(x_session_token or session_token)
    user = await db[MongoCollections.users].find_one({"user_id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid session")
    user = serialize_document(user)
    row = await db["reconstructed_presentations"].find_one({"file_id": file_id})
    if not row:
        raise HTTPException(status_code=404, detail="Presentation not found")
    await require_instructor_account_with_any_class(db, user)
    return FileResponse(path=row["path"], filename=row["filename"])


@router.post("/sessions", response_model=InstructorSessionOut)
async def create_instructor_session(
    payload: InstructorSessionCreateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> InstructorSessionOut:
    await require_account_class_role(db, user, payload.class_id, "instructor")
    class_doc = await db[MongoCollections.classes].find_one({"class_id": payload.class_id})
    if class_doc and class_doc.get("status", "active") in {"archived", "inactive"}:
        raise HTTPException(status_code=400, detail="Activate this class before creating a live session.")
    requested_question_ids = list(dict.fromkeys(payload.question_ids))
    if not requested_question_ids:
        raise HTTPException(status_code=400, detail="Create a session from at least one approved question.")
    approved_rows = await db[MongoCollections.approved_questions].find({"question_id": {"$in": requested_question_ids}}).to_list(length=200)
    approved_ids = {row["question_id"] for row in approved_rows}
    generated_rows = await db[MongoCollections.generated_questions].find({"question_id": {"$in": requested_question_ids}}).to_list(length=200)
    generated_by_id = {row["question_id"]: row for row in generated_rows}
    invalid_ids = [question_id for question_id in requested_question_ids if question_id not in approved_ids]
    wrong_class_ids = [
        question_id
        for question_id in requested_question_ids
        if generated_by_id.get(question_id, {}).get("class_id") not in {None, payload.class_id}
    ]
    if invalid_ids:
        raise HTTPException(status_code=400, detail="Approve all selected questions before creating a session.")
    if wrong_class_ids:
        raise HTTPException(status_code=400, detail="Selected questions do not belong to this class.")
    question_ids = [question_id for question_id in requested_question_ids if question_id in approved_ids]
    try:
        session_code = await generate_unique_session_code(db, make_session_code)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    join_link = make_join_link(session_code)
    scheduled_for = payload.scheduled_for
    status = "scheduled" if scheduled_for and scheduled_for > utc_now() else "active"
    started_at = utc_now() if status == "active" else None
    session = InstructorSessionOut(
        session_id=new_id("session"),
        class_id=payload.class_id,
        instructor_id=user["user_id"],
        question_ids=question_ids,
        active_question_id=None,
        session_code=session_code,
        join_link=join_link,
        qr_code_base64=make_qr_base64(join_link),
        status=status,
        scheduled_for=scheduled_for,
        question_started_at=None,
        question_duration_seconds=None,
        question_ends_at=None,
        revealed_question_ids=[],
        created_at=utc_now(),
    )
    await db[MongoCollections.sessions].insert_one(session.model_dump())
    await recalculate_class_analytics(db, payload.class_id)
    return session


@router.get("/sessions", response_model=list[InstructorSessionOut])
async def list_instructor_sessions(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[InstructorSessionOut]:
    class_ids = await require_instructor_account_with_any_class(db, user)
    rows = await db[MongoCollections.sessions].find(
        {"class_id": {"$in": class_ids}, "instructor_id": user["user_id"], "qr_code_base64": {"$exists": True}}
    ).sort("created_at", -1).to_list(length=100)
    sessions = []
    for row in rows:
        clean = serialize_document(row)
        clean.setdefault("revealed_question_ids", [])
        clean.setdefault("question_started_at", None)
        clean.setdefault("question_duration_seconds", None)
        clean.setdefault("question_ends_at", None)
        sessions.append(InstructorSessionOut(**clean))
    return sessions


@router.get("/sessions/{session_id}", response_model=InstructorSessionOut)
async def get_instructor_session(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> InstructorSessionOut:
    row = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    await require_own_instructor_session(db, user, row)
    clean = serialize_document(row)
    if "qr_code_base64" not in clean:
        join_link = make_join_link(clean["session_code"])
        clean["join_link"] = join_link
        clean["qr_code_base64"] = make_qr_base64(join_link)
    clean.setdefault("active_question_id", None)
    clean.setdefault("revealed_question_ids", [])
    clean.setdefault("question_started_at", None)
    clean.setdefault("question_duration_seconds", None)
    clean.setdefault("question_ends_at", None)
    return InstructorSessionOut(**clean)


@router.delete("/sessions/{session_id}")
async def delete_instructor_session(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    row = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    await require_own_instructor_session(db, user, row)

    result = await delete_session_cascade(db, row)
    await manager.broadcast(session_id, {"type": "session_deleted", "payload": {"session_id": session_id}})
    await recalculate_class_analytics(db, row["class_id"])
    return result


@router.patch("/sessions/{session_id}/status", response_model=InstructorSessionOut)
async def update_instructor_session_status(
    session_id: str,
    payload: InstructorSessionStatusUpdate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> InstructorSessionOut:
    row = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    await require_own_instructor_session(db, user, row)
    if payload.status == "active":
        class_doc = await db[MongoCollections.classes].find_one({"class_id": row["class_id"]})
        if class_doc and class_doc.get("status", "active") in {"archived", "inactive"}:
            raise HTTPException(status_code=400, detail="Activate this class before reopening the session.")
    await db[MongoCollections.sessions].update_one(
        {"session_id": session_id},
        {"$set": {"status": payload.status, "updated_at": utc_now()}},
    )
    refreshed = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    clean = serialize_document(refreshed)
    if "qr_code_base64" not in clean:
        join_link = make_join_link(clean["session_code"])
        clean["join_link"] = join_link
        clean["qr_code_base64"] = make_qr_base64(join_link)
    clean.setdefault("active_question_id", None)
    clean.setdefault("revealed_question_ids", [])
    clean.setdefault("question_started_at", None)
    clean.setdefault("question_duration_seconds", None)
    clean.setdefault("question_ends_at", None)
    return InstructorSessionOut(**clean)


@router.patch("/sessions/{session_id}/active-question", response_model=InstructorSessionOut)
async def update_instructor_active_question(
    session_id: str,
    payload: ActiveQuestionUpdate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> InstructorSessionOut:
    row = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    await require_own_instructor_session(db, user, row)
    if payload.question_id not in row.get("question_ids", []):
        raise HTTPException(status_code=400, detail="Question is not part of this session")

    started_at = utc_now()
    duration_seconds = None
    ends_at = None
    if payload.duration_seconds is not None:
        duration_seconds = min(max(int(payload.duration_seconds), 15), 3600)
        ends_at = started_at + timedelta(seconds=duration_seconds)
    await db[MongoCollections.sessions].update_one(
        {"session_id": session_id},
        {
            "$set": {
                "active_question_id": payload.question_id,
                "question_started_at": started_at,
                "question_duration_seconds": duration_seconds,
                "question_ends_at": ends_at,
                "status": "active",
                "updated_at": started_at,
            }
        },
    )
    refreshed = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    clean = serialize_document(refreshed)
    if "qr_code_base64" not in clean:
        join_link = make_join_link(clean["session_code"])
        clean["join_link"] = join_link
        clean["qr_code_base64"] = make_qr_base64(join_link)

    clean.setdefault("revealed_question_ids", [])
    clean.setdefault("question_started_at", None)
    clean.setdefault("question_duration_seconds", None)
    clean.setdefault("question_ends_at", None)

    memberships = await db[MongoCollections.class_memberships].find(
        {"class_id": row["class_id"], "role": "student", "status": "active"},
        {"user_id": 1},
    ).to_list(length=None)
    notification_created_at = utc_now()
    for membership in memberships:
        student_id = membership.get("user_id")
        if not student_id:
            continue
        notification_id = live_question_notification_id(student_id, session_id, payload.question_id)
        await db[MongoCollections.notifications].update_one(
            {"notification_id": notification_id},
            {
                "$setOnInsert": {
                    "notification_id": notification_id,
                    "user_id": student_id,
                    "title": "New live question",
                    "description": "A new question is active.",
                    "tone": "info",
                    "read": False,
                    "class_id": row["class_id"],
                    "session_id": session_id,
                    "question_id": payload.question_id,
                    "created_at": notification_created_at,
                }
            },
            upsert=True,
        )

    stats = await get_live_session_stats(db, session_id)
    question_payload = {
        "session_id": session_id,
        "question_id": payload.question_id,
        "question_started_at": started_at.isoformat(),
        "question_duration_seconds": duration_seconds,
        "question_ends_at": ends_at.isoformat() if ends_at else None,
        "message": "A new question is active",
        "stats": stats.model_dump(mode="json"),
    }
    await manager.broadcast(session_id, {"type": "question_active", "payload": question_payload})
    await manager.broadcast(
        session_id,
        {
            "type": "active_question",
            "payload": {
                "question_id": payload.question_id,
                "question_started_at": started_at.isoformat(),
                "question_duration_seconds": duration_seconds,
                "question_ends_at": ends_at.isoformat() if ends_at else None,
                "stats": stats.model_dump(mode="json"),
            },
        },
    )
    return InstructorSessionOut(**clean)



