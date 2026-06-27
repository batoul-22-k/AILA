from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import get_current_user, require_account_class_role, require_admin
from app.database import MongoCollections, get_db
from app.prediction_service import (
    admin_prediction_overview,
    build_prediction_features_for_class,
    class_prediction_summary,
    run_prediction_pipeline_for_class,
    student_prediction,
)
from app.services import serialize_document

router = APIRouter(prefix="/predictions", tags=["predictions"])


async def ensure_class_exists(db: AsyncIOMotorDatabase, class_id: str) -> dict:
    class_doc = await db[MongoCollections.classes].find_one({"class_id": class_id})
    if not class_doc:
        raise HTTPException(status_code=404, detail="Class not found")
    return serialize_document(class_doc)


@router.post("/class/{class_id}/run")
async def run_class_predictions(
    class_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await ensure_class_exists(db, class_id)
    await require_account_class_role(db, user, class_id, "instructor")
    return await run_prediction_pipeline_for_class(db, class_id)


@router.get("/class/{class_id}")
async def get_class_predictions(
    class_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await ensure_class_exists(db, class_id)
    await require_account_class_role(db, user, class_id, "instructor")
    return await class_prediction_summary(db, class_id)


@router.get("/student")
async def get_student_prediction(
    class_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await ensure_class_exists(db, class_id)
    await require_account_class_role(db, user, class_id, "student")
    return await student_prediction(db, user["user_id"], class_id)


@router.get("/admin/overview")
async def get_admin_prediction_overview(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    return await admin_prediction_overview(db)


@router.get("/features/class/{class_id}")
async def get_class_prediction_features(
    class_id: str,
    refresh: bool = False,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await ensure_class_exists(db, class_id)
    await require_account_class_role(db, user, class_id, "instructor")
    if refresh:
        features = await build_prediction_features_for_class(db, class_id)
    else:
        features = [
            serialize_document(row)
            for row in await db[MongoCollections.prediction_features].find({"class_id": class_id}).to_list(length=None)
        ]
    return {
        "class_id": class_id,
        "features": features,
        "count": len(features),
        "empty": len(features) == 0,
    }
