from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import account_role_for_user, get_current_user, require_account_class_role, require_admin, require_any_class_role
from app.analytics_services import (
    get_at_risk_students,
    get_class_analytics_summary,
    get_student_analytics,
    recalculate_class_analytics,
)
from app.database import MongoCollections, get_db
from app.models import AnalyticsRecalculateOut, AnalyticsResultOut, AtRiskStudentOut, ClassAnalyticsSummaryOut
from app.prediction_service import recalculate_class_predictions

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/student/{student_id}", response_model=list[AnalyticsResultOut])
async def get_student_weekly_analytics(
    student_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> list[AnalyticsResultOut]:
    rows = await get_student_analytics(db, student_id)
    return [AnalyticsResultOut(**row) for row in rows]


@router.get("/class/{class_id}", response_model=ClassAnalyticsSummaryOut)
async def get_class_analytics(
    class_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ClassAnalyticsSummaryOut:
    summary = await get_class_analytics_summary(db, class_id)
    return ClassAnalyticsSummaryOut(**summary)


@router.post("/recalculate/{class_id}", response_model=AnalyticsRecalculateOut)
async def recalculate_analytics_for_class(
    class_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> AnalyticsRecalculateOut:
    result = await recalculate_class_analytics(db, class_id)
    return AnalyticsRecalculateOut(**result)


@router.post("/predictions/recalculate/{class_id}")
async def recalculate_predictions_for_class(
    class_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    return await recalculate_class_predictions(db, class_id)


@router.get("/at-risk-students", response_model=list[AtRiskStudentOut])
async def get_at_risk_student_details(
    class_id: str | None = None,
    include_all: bool = False,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[AtRiskStudentOut]:
    if account_role_for_user(user) == "admin":
        rows = await get_at_risk_students(db, class_id=class_id, include_all=include_all)
    else:
        if class_id:
            await require_account_class_role(db, user, class_id, "instructor")
            rows = await get_at_risk_students(db, class_id=class_id, include_all=include_all)
        else:
            class_ids = await require_any_class_role(db, user, "instructor")
            rows = await get_at_risk_students(db, include_all=include_all, class_ids=class_ids)
    return [AtRiskStudentOut(**row) for row in rows]


@router.get("/engagement-trends")
async def get_engagement_trends(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    stored_results = await db[MongoCollections.analytics_results].find({}).to_list(length=None)
    by_week: dict[str, list[dict]] = {}
    for result in stored_results:
        week = result.get("week")
        if not week:
            continue
        by_week.setdefault(week, []).append(result)
    trend_points = []
    for week, rows in sorted(by_week.items()):
        trend_points.append(
            {
                "week": week,
                "attendance_rate": round(sum(row.get("attendance_rate", 0) for row in rows) / len(rows), 2),
                "participation_rate": round(sum(row.get("participation_rate", 0) for row in rows) / len(rows), 2),
                "engagement_score": round(sum(row.get("engagement_score", 0) for row in rows) / len(rows), 2),
            }
        )
    return {
        "trend_points": trend_points,
        "placeholder": len(trend_points) == 0,
    }


@router.get("/prediction-results")
async def get_prediction_results(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    # TODO: Add pagination and model-version filters once trained ML predictions are produced.
    stored_results = await db[MongoCollections.prediction_results].find({}).to_list(length=20)
    return {
        "results": [
            {key: value for key, value in result.items() if key != "_id"}
            for result in stored_results
        ],
        "placeholder": len(stored_results) == 0,
    }
