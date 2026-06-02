from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import get_current_user, require_admin
from app.database import MongoCollections, get_db
from app.models import DashboardSummary

router = APIRouter(tags=["dashboards"])


@router.get("/instructor/dashboard", response_model=DashboardSummary)
async def get_instructor_dashboard_data(
    instructor_id: str | None = None,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> DashboardSummary:
    instructor_id = user["user_id"]
    memberships = await db[MongoCollections.class_memberships].find(
        {"user_id": instructor_id, "role": "instructor", "status": "active"},
        {"class_id": 1},
    ).to_list(length=100)
    class_ids = [membership["class_id"] for membership in memberships]
    classes = len(class_ids)
    active_sessions = await db[MongoCollections.sessions].count_documents(
        {"class_id": {"$in": class_ids}, "status": "active"}
    )
    session_ids = [
        session["session_id"]
        async for session in db[MongoCollections.sessions].find({"class_id": {"$in": class_ids}}, {"session_id": 1})
    ]
    total_responses = await db[MongoCollections.responses].count_documents({"session_id": {"$in": session_ids}})
    return DashboardSummary(
        active_sessions=active_sessions,
        total_classes=classes,
        total_responses=total_responses,
        engagement_rate_placeholder=0.0,
    )


@router.get("/admin/dashboard", response_model=DashboardSummary)
async def get_admin_dashboard_data(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> DashboardSummary:
    await require_admin(db, user)
    # TODO: Replace placeholder engagement/prediction values with analytics and ML service outputs.
    return DashboardSummary(
        active_sessions=await db[MongoCollections.sessions].count_documents({"status": "active"}),
        total_classes=await db[MongoCollections.classes].count_documents({}),
        total_responses=await db[MongoCollections.responses].count_documents({}),
        engagement_rate_placeholder=0.0,
    )
