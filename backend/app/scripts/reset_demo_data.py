"""Development-only reset for demo learning activity data.

Default mode removes records tagged with seed_source="demo_learning_activity"
or demo=True + institution_id="demo_institution".

Full mode, enabled with DEMO_RESET_FULL=true, also removes demo institution
classes, non-admin users, memberships, and dependent records for those classes
and users. The script refuses to run unless ENV=development or DEMO_SEED=true.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

SEED_SOURCE = "demo_learning_activity"
DEMO_INSTITUTION_ID = "demo_institution"


def allowed_to_run() -> bool:
    env = os.getenv("ENV", "").strip().lower()
    demo_seed = os.getenv("DEMO_SEED", "").strip().lower()
    return env == "development" or demo_seed in {"1", "true", "yes", "on"}


def full_reset_enabled() -> bool:
    return os.getenv("DEMO_RESET_FULL", "").strip().lower() in {"1", "true", "yes", "on"}


def load_app_dependencies() -> dict[str, Any]:
    from motor.motor_asyncio import AsyncIOMotorClient

    from app.config import get_settings
    from app.database import MongoCollections, ensure_indexes

    return {
        "AsyncIOMotorClient": AsyncIOMotorClient,
        "MongoCollections": MongoCollections,
        "ensure_indexes": ensure_indexes,
        "get_settings": get_settings,
    }


def demo_query() -> dict[str, Any]:
    return {
        "$or": [
            {"seed_source": SEED_SOURCE},
            {"demo": True, "institution_id": DEMO_INSTITUTION_ID},
        ]
    }


async def delete_many(db: Any, collection: str, query: dict[str, Any], counts: dict[str, int]) -> None:
    result = await db[collection].delete_many(query)
    counts[collection] = counts.get(collection, 0) + result.deleted_count


async def tagged_session_ids(db: Any) -> list[str]:
    rows = await db[MongoCollections.sessions].find(demo_query(), {"session_id": 1}).to_list(length=None)
    return [row["session_id"] for row in rows if row.get("session_id")]


async def tagged_class_ids(db: Any) -> list[str]:
    rows = await db[MongoCollections.classes].find(demo_query(), {"class_id": 1}).to_list(length=None)
    return [row["class_id"] for row in rows if row.get("class_id")]


async def tagged_user_ids(db: Any) -> list[str]:
    rows = await db[MongoCollections.users].find(
        {"$and": [demo_query(), {"account_role": {"$ne": "admin"}}]},
        {"user_id": 1},
    ).to_list(length=None)
    return [row["user_id"] for row in rows if row.get("user_id")]


def dependent_query(class_ids: list[str], user_ids: list[str], session_ids: list[str]) -> dict[str, Any]:
    clauses: list[dict[str, Any]] = [demo_query()]
    if class_ids:
        clauses.append({"class_id": {"$in": class_ids}})
    if user_ids:
        clauses.append({"student_id": {"$in": user_ids}})
        clauses.append({"user_id": {"$in": user_ids}})
    if session_ids:
        clauses.append({"session_id": {"$in": session_ids}})
    return {"$or": clauses}


async def reset_demo_data() -> dict[str, int]:
    if not allowed_to_run():
        raise RuntimeError("Refusing to reset demo data. Set ENV=development or DEMO_SEED=true.")

    globals().update(load_app_dependencies())
    settings = get_settings()
    client = AsyncIOMotorClient(settings.mongodb_uri)
    counts: dict[str, int] = {}

    try:
        await client.admin.command("ping")
        db = client[settings.mongodb_db]
        await ensure_indexes(db)

        full = full_reset_enabled()
        class_ids = await tagged_class_ids(db) if full else []
        user_ids = await tagged_user_ids(db) if full else []
        session_ids = await tagged_session_ids(db)
        if full and class_ids:
            more_sessions = await db[MongoCollections.sessions].find(
                {"class_id": {"$in": class_ids}},
                {"session_id": 1},
            ).to_list(length=None)
            session_ids = sorted(set(session_ids) | {row["session_id"] for row in more_sessions if row.get("session_id")})

        query = dependent_query(class_ids, user_ids, session_ids) if full else demo_query()
        if not full and session_ids:
            query = {"$or": [demo_query(), {"session_id": {"$in": session_ids}}]}

        for collection in (
            MongoCollections.responses,
            MongoCollections.participation_records,
            MongoCollections.student_rewards,
            MongoCollections.session_reward_summaries,
            MongoCollections.gamification_events,
            MongoCollections.achievement_notifications,
            MongoCollections.student_missions,
            MongoCollections.weekly_challenges,
            MongoCollections.student_challenge_progress,
            MongoCollections.sessions,
            MongoCollections.generated_questions,
            MongoCollections.approved_questions,
            MongoCollections.analytics_results,
            MongoCollections.prediction_features,
            MongoCollections.prediction_results,
            MongoCollections.weak_concept_predictions,
            MongoCollections.notifications,
        ):
            await delete_many(db, collection, query, counts)

        if full:
            membership_query = dependent_query(class_ids, user_ids, [])
            await delete_many(db, MongoCollections.class_memberships, membership_query, counts)
            if class_ids:
                await delete_many(db, MongoCollections.classes, {"class_id": {"$in": class_ids}, **demo_query()}, counts)
            if user_ids:
                await delete_many(db, MongoCollections.users, {"user_id": {"$in": user_ids}, **demo_query()}, counts)

        return counts
    finally:
        client.close()


def print_summary(counts: dict[str, int]) -> None:
    mode = "full demo reset" if full_reset_enabled() else "demo activity reset"
    print(f"Completed {mode}.")
    for collection, deleted in sorted(counts.items()):
        if deleted:
            print(f"- {collection}: {deleted} removed")


async def main() -> None:
    try:
        counts = await reset_demo_data()
    except RuntimeError as exc:
        print(str(exc))
        sys.exit(1)
    print_summary(counts)


if __name__ == "__main__":
    asyncio.run(main())
