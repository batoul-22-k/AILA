from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import get_current_user, require_admin
from app.database import MongoCollections, get_db

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/engagement-trends")
async def get_engagement_trends(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    # TODO: Replace placeholder trend data with analytics aggregation results.
    stored_results = await db[MongoCollections.analytics_results].find({}).to_list(length=20)
    return {
        "trend_points": [
            {key: value for key, value in result.items() if key != "_id"}
            for result in stored_results
        ],
        "placeholder": len(stored_results) == 0,
    }


@router.get("/prediction-results")
async def get_prediction_results(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    # TODO: Connect this route to the ML prediction service output.
    stored_results = await db[MongoCollections.prediction_results].find({}).to_list(length=20)
    return {
        "results": [
            {key: value for key, value in result.items() if key != "_id"}
            for result in stored_results
        ],
        "placeholder": len(stored_results) == 0,
    }
