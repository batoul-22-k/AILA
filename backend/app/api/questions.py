from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import get_current_user, require_account_class_role
from app.database import MongoCollections, get_db
from app.models import GeneratedQuestionOut, SaveGeneratedQuestionsRequest, new_id, utc_now

router = APIRouter(prefix="/questions", tags=["questions"])


@router.post("/generated", response_model=list[GeneratedQuestionOut])
async def save_generated_questions(
    payload: SaveGeneratedQuestionsRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[GeneratedQuestionOut]:
    await require_account_class_role(db, user, payload.class_id, "instructor")
    # TODO: Replace this placeholder save flow with Ollama/LLaMA generated question review results.
    questions = [
        GeneratedQuestionOut(
            question_id=question.question_id or new_id("question"),
            class_id=payload.class_id,
            lecture_file_id=payload.lecture_file_id,
            prompt=question.prompt,
            options=question.options,
            correct_answer_placeholder=question.correct_answer_placeholder,
            created_at=utc_now(),
        )
        for question in payload.questions
    ]
    if questions:
        await db[MongoCollections.generated_questions].insert_many([question.model_dump() for question in questions])
    return questions
