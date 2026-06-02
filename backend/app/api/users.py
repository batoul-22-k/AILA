from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import get_current_user, require_any_class_role
from app.database import MongoCollections, get_db
from app.models import UserOut
from app.services import serialize_document

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserOut])
async def list_users(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[UserOut]:
    if user.get("global_role") != "admin":
        await require_any_class_role(db, user, "instructor")
    instructor_memberships = await db[MongoCollections.class_memberships].find(
        {"role": "instructor", "status": "active"},
        {"user_id": 1},
    ).to_list(length=500)
    instructor_ids = [membership["user_id"] for membership in instructor_memberships]
    rows = await db[MongoCollections.users].find(
        {"global_role": {"$ne": "admin"}, "user_id": {"$nin": instructor_ids}},
    ).sort("name", 1).to_list(length=500)
    return [UserOut(**serialize_document(row)) for row in rows]


@router.get("/mock-current")
async def get_mock_current_user(role: str = "student") -> dict:
    # TODO: Replace mock users with real authentication and role claims.
    return {"user_id": f"mock_{role}_001", "role": role}
