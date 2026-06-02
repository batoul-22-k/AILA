from fastapi import APIRouter, Depends, File, Form, UploadFile
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import get_current_user, require_class_role
from app.database import MongoCollections, get_db
from app.models import LectureUploadOut, new_id, utc_now

router = APIRouter(prefix="/lecture-uploads", tags=["lecture_uploads"])


@router.post("", response_model=LectureUploadOut)
async def upload_lecture_material(
    class_id: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> LectureUploadOut:
    await require_class_role(db, user, class_id, "instructor")
    # TODO: Persist lecture files to object storage and pass extracted text to the AI question generator.
    lecture = LectureUploadOut(
        lecture_file_id=new_id("lecture"),
        class_id=class_id,
        filename=file.filename or "lecture-material",
        status="uploaded",
        created_at=utc_now(),
    )
    await db[MongoCollections.lecture_files].insert_one(lecture.model_dump())
    return lecture
