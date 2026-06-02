from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import get_current_user
from app.database import MongoCollections, get_db
from app.models import NotificationOut, utc_now
from app.services import serialize_document

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    unread_only: bool = True,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[NotificationOut]:
    query = {"user_id": user["user_id"]}
    if unread_only:
        query["read"] = {"$ne": True}
    rows = await db[MongoCollections.notifications].find(query).sort("created_at", -1).to_list(length=50)
    return [NotificationOut(**serialize_document(row)) for row in rows]


@router.post("/mark-read")
async def mark_notifications_read(
    notification_ids: list[str],
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    if not notification_ids:
        return {"updated": 0}
    result = await db[MongoCollections.notifications].update_many(
        {"user_id": user["user_id"], "notification_id": {"$in": notification_ids}},
        {"$set": {"read": True, "read_at": utc_now()}},
    )
    return {"updated": result.modified_count}
