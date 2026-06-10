from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.analytics_services import get_student_progress
from app.auth import get_current_user
from app.database import get_db
from app.models import StudentProgressOut

router = APIRouter(prefix="/progress", tags=["progress"])


@router.get("/me", response_model=StudentProgressOut)
async def get_my_progress(
    class_id: str | None = None,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> StudentProgressOut:
    progress = await get_student_progress(db, user["user_id"], class_id=class_id)
    return StudentProgressOut(**progress)
