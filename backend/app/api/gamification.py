from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import account_role_for_user, get_current_user, require_account_class_role, require_admin, require_class_role
from app.database import MongoCollections, get_db
from app.gamification_backfill_service import (
    backfill_gamification_all,
    backfill_gamification_for_class,
    backfill_gamification_for_student,
    reconcile_profile_from_events,
)
from app.gamification_service import (
    award_gamification_event,
    build_session_reward_summary,
    calculate_level,
    create_achievement_notification,
    date_key,
    deterministic_id,
    get_badge_definitions,
    get_gamification_profile,
    ensure_daily_mission,
)
from app.models import (
    AchievementNotificationOut,
    BadgeCatalogItemOut,
    ChallengeClaimOut,
    GamificationBadgesOut,
    GamificationHistoryEventOut,
    GamificationLeaderboardOut,
    GamificationMeOut,
    GamificationProfileOut,
    LeaderboardRowOut,
    MissionClaimOut,
    MissionRewardOut,
    SessionRewardSummaryOut,
    StudentBadgeOut,
    StudentChallengeProgressOut,
    StudentMissionOut,
    WeeklyChallengeWithProgressOut,
    WeeklyChallengesOut,
)
from app.services import serialize_document

router = APIRouter(prefix="/gamification", tags=["gamification"])


DEFAULT_WEEKLY_CHALLENGES = [
    {
        "challenge_key": "answer_10_questions",
        "title": "Steady Contributor",
        "description": "Answer 10 questions this week.",
        "metric_type": "answer_question",
        "target": 10,
        "reward": {"xp": 40, "stars": 10},
    },
    {
        "challenge_key": "earn_50_stars",
        "title": "Star Builder",
        "description": "Earn 50 stars this week.",
        "metric_type": "stars_earned",
        "target": 50,
        "reward": {"xp": 35, "stars": 15},
    },
    {
        "challenge_key": "join_3_sessions",
        "title": "Present and Ready",
        "description": "Join 3 live sessions this week.",
        "metric_type": "join_session",
        "target": 3,
        "reward": {"xp": 30, "stars": 8},
    },
    {
        "challenge_key": "three_day_streak",
        "title": "Learning Rhythm",
        "description": "Maintain a 3-day activity streak.",
        "metric_type": "streak_days",
        "target": 3,
        "reward": {"xp": 25, "stars": 8},
    },
    {
        "challenge_key": "five_correct_answers",
        "title": "Accuracy Sprint",
        "description": "Get 5 correct answers this week.",
        "metric_type": "correct_answer",
        "target": 5,
        "reward": {"xp": 45, "stars": 12},
    },
]


def require_student(user: dict) -> None:
    if account_role_for_user(user) != "student":
        raise HTTPException(status_code=403, detail="Student permission required")


async def require_student_scope(
    db: AsyncIOMotorDatabase,
    user: dict,
    class_id: str | None = None,
) -> None:
    require_student(user)
    if class_id:
        await require_account_class_role(db, user, class_id, "student")


def mission_day_bounds(mission_date_key: str) -> tuple[datetime, datetime]:
    start = datetime.fromisoformat(mission_date_key).replace(tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


def progress_percent(progress: int, target: int) -> float:
    if target <= 0:
        return 100.0
    return round(min(progress / target, 1) * 100, 1)


def current_week_key(value: datetime | None = None) -> str:
    current = value or datetime.now(timezone.utc)
    iso_year, iso_week, _ = current.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def week_bounds(value: datetime | None = None) -> tuple[datetime, datetime]:
    current = (value or datetime.now(timezone.utc)).astimezone(timezone.utc)
    start = datetime.combine(
        current.date() - timedelta(days=current.weekday()),
        datetime.min.time(),
        tzinfo=timezone.utc,
    )
    return start, start + timedelta(days=7)


def week_key_bounds(week_key: str | None) -> tuple[datetime, datetime]:
    try:
        year_text, week_text = (week_key or "").split("-W", 1)
        start = datetime.fromisocalendar(int(year_text), int(week_text), 1).replace(tzinfo=timezone.utc)
        return start, start + timedelta(days=7)
    except (TypeError, ValueError):
        return week_bounds()


def as_utc_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


async def event_progress(
    db: AsyncIOMotorDatabase,
    *,
    student_id: str,
    class_id: str | None,
    date_start: datetime,
    date_end: datetime,
) -> dict[str, int]:
    query: dict[str, Any] = {
        "student_id": student_id,
        "created_at": {"$gte": date_start, "$lt": date_end},
    }
    if class_id:
        query["class_id"] = class_id
    rows = await db[MongoCollections.gamification_events].find(query).to_list(length=None)
    return {
        "join_session": sum(1 for row in rows if row.get("event_type") == "join_session"),
        "answer_questions": sum(1 for row in rows if row.get("event_type") == "answer_question"),
        "earn_stars": sum(int(row.get("stars_delta") or 0) for row in rows),
    }


async def refresh_mission_progress(db: AsyncIOMotorDatabase, mission: dict) -> dict:
    clean = serialize_document(mission)
    date_start, date_end = mission_day_bounds(clean["date_key"])
    progress = await event_progress(
        db,
        student_id=clean["student_id"],
        class_id=clean.get("class_id"),
        date_start=date_start,
        date_end=date_end,
    )
    tasks = []
    for task in clean.get("tasks") or []:
        current_progress = min(int(progress.get(task["key"], 0)), int(task.get("target") or 0))
        tasks.append(
            {
                **task,
                "progress": current_progress,
                "completed": current_progress >= int(task.get("target") or 0),
            }
        )
    completed = bool(tasks) and all(task["completed"] for task in tasks)
    completed_at = clean.get("completed_at") or (datetime.now(timezone.utc) if completed else None)
    average_progress = round(
        sum(progress_percent(int(task["progress"]), int(task["target"])) for task in tasks) / max(len(tasks), 1),
        1,
    )
    update_doc = {
        "tasks": tasks,
        "completed": completed,
        "progress_percentage": average_progress,
        "updated_at": datetime.now(timezone.utc),
    }
    if completed_at:
        update_doc["completed_at"] = completed_at
    await db[MongoCollections.student_missions].update_one(
        {"mission_id": clean["mission_id"]},
        {"$set": update_doc},
    )
    clean.update(update_doc)
    return clean


async def ensure_weekly_challenges(db: AsyncIOMotorDatabase, class_id: str) -> list[dict]:
    week_key = current_week_key()
    _, week_end = week_bounds()
    now = datetime.now(timezone.utc)
    for definition in DEFAULT_WEEKLY_CHALLENGES:
        challenge_id = deterministic_id("weekly_challenge", class_id, week_key, definition["challenge_key"])
        challenge = {
            "challenge_id": challenge_id,
            "class_id": class_id,
            "week_key": week_key,
            "challenge_key": definition["challenge_key"],
            "title": definition["title"],
            "description": definition["description"],
            "metric_type": definition["metric_type"],
            "target": definition["target"],
            "reward": definition["reward"],
            "active": True,
            "created_at": now,
            "expires_at": week_end,
        }
        await db[MongoCollections.weekly_challenges].update_one(
            {"challenge_id": challenge_id},
            {"$setOnInsert": challenge},
            upsert=True,
        )

    rows = await db[MongoCollections.weekly_challenges].find(
        {"class_id": class_id, "week_key": week_key, "active": {"$ne": False}}
    ).sort("target", 1).to_list(length=None)
    return [serialize_document(row) for row in rows]


async def challenge_metric_progress(
    db: AsyncIOMotorDatabase,
    *,
    student_id: str,
    class_id: str,
    metric_type: str,
    week_start: datetime,
    week_end: datetime,
) -> int:
    if metric_type == "streak_days":
        profile = await get_gamification_profile(db, student_id, class_id)
        return int(profile.current_streak or 0)

    query: dict[str, Any] = {
        "student_id": student_id,
        "class_id": class_id,
        "created_at": {"$gte": week_start, "$lt": week_end},
    }
    if metric_type == "stars_earned":
        rows = await db[MongoCollections.gamification_events].find(query, {"stars_delta": 1}).to_list(length=None)
        return sum(int(row.get("stars_delta") or 0) for row in rows)

    query["event_type"] = metric_type
    return await db[MongoCollections.gamification_events].count_documents(query)


async def refresh_challenge_progress(
    db: AsyncIOMotorDatabase,
    *,
    challenge: dict,
    student_id: str,
) -> dict:
    clean = serialize_document(challenge)
    week_start, week_end = week_key_bounds(clean.get("week_key"))
    progress = await challenge_metric_progress(
        db,
        student_id=student_id,
        class_id=clean["class_id"],
        metric_type=clean["metric_type"],
        week_start=week_start,
        week_end=week_end,
    )
    target = int(clean.get("target") or 0)
    completed = progress >= target
    existing = await db[MongoCollections.student_challenge_progress].find_one(
        {"challenge_id": clean["challenge_id"], "student_id": student_id}
    )
    completed_at = (existing or {}).get("completed_at") or (datetime.now(timezone.utc) if completed else None)
    progress_id = (existing or {}).get("progress_id") or deterministic_id(
        "challenge_progress",
        clean["challenge_id"],
        student_id,
    )
    update_doc = {
        "progress_id": progress_id,
        "challenge_id": clean["challenge_id"],
        "student_id": student_id,
        "class_id": clean["class_id"],
        "progress": min(progress, target),
        "completed": completed,
        "updated_at": datetime.now(timezone.utc),
    }
    if completed_at:
        update_doc["completed_at"] = completed_at
    await db[MongoCollections.student_challenge_progress].update_one(
        {"challenge_id": clean["challenge_id"], "student_id": student_id},
        {
            "$set": update_doc,
            "$setOnInsert": {"claimed": False, "claimed_at": None, "created_at": datetime.now(timezone.utc)},
        },
        upsert=True,
    )
    stored = await db[MongoCollections.student_challenge_progress].find_one(
        {"challenge_id": clean["challenge_id"], "student_id": student_id}
    )
    normalized = serialize_document(stored or update_doc)
    normalized.setdefault("claimed", False)
    normalized.setdefault("claimed_at", None)
    return normalized


async def challenge_with_progress(
    db: AsyncIOMotorDatabase,
    *,
    challenge: dict,
    student_id: str,
) -> WeeklyChallengeWithProgressOut:
    progress = await refresh_challenge_progress(db, challenge=challenge, student_id=student_id)
    return WeeklyChallengeWithProgressOut(
        **serialize_document(challenge),
        progress=StudentChallengeProgressOut(**progress),
        progress_percentage=progress_percent(int(progress.get("progress") or 0), int(challenge.get("target") or 0)),
    )


async def badge_progress(
    db: AsyncIOMotorDatabase,
    *,
    student_id: str,
    class_id: str | None,
    definition: dict,
) -> tuple[int, int]:
    criteria = definition.get("criteria") or {}
    target = int(criteria.get("count") or criteria.get("current_streak") or criteria.get("level") or 1)
    if criteria.get("event_type"):
        query: dict[str, Any] = {"student_id": student_id, "event_type": criteria["event_type"]}
        if definition.get("scope") == "class" and class_id:
            query["class_id"] = class_id
        return await db[MongoCollections.gamification_events].count_documents(query), target
    if criteria.get("current_streak"):
        profile = await get_gamification_profile(db, student_id, None)
        return profile.current_streak, target
    if criteria.get("level"):
        profile = await get_gamification_profile(db, student_id, None)
        return profile.level, target
    return 0, target


def leaderboard_start_date(period: str) -> datetime | None:
    now = datetime.now(timezone.utc)
    if period == "weekly":
        return week_bounds(now)[0]
    if period == "monthly":
        return now - timedelta(days=30)
    return None


def private_student_name(user_doc: dict | None) -> str:
    name = str((user_doc or {}).get("name") or "").strip()
    if not name:
        return "Student"
    parts = [part for part in name.split() if part]
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0].upper()}."


async def leaderboard_badge_counts(
    db: AsyncIOMotorDatabase,
    *,
    student_ids: list[str],
    class_id: str,
) -> dict[str, int]:
    if not student_ids:
        return {}
    pipeline = [
        {
            "$match": {
                "student_id": {"$in": student_ids},
                "$or": [{"class_id": class_id}, {"class_id": None}],
            }
        },
        {"$group": {"_id": "$student_id", "count": {"$sum": 1}}},
    ]
    rows = await db[MongoCollections.student_badges].aggregate(pipeline).to_list(length=None)
    return {str(row["_id"]): int(row.get("count") or 0) for row in rows}


async def class_profile_map(
    db: AsyncIOMotorDatabase,
    *,
    class_id: str,
    student_ids: list[str],
) -> dict[str, dict]:
    if not student_ids:
        return {}
    rows = await db[MongoCollections.student_gamification_profiles].find(
        {
            "student_id": {"$in": student_ids},
            "class_id": class_id,
            "$or": [{"scope": "class"}, {"scope": {"$exists": False}}],
        }
    ).to_list(length=None)
    return {str(row.get("student_id")): serialize_document(row) for row in rows if row.get("student_id")}


async def all_time_leaderboard_entries(db: AsyncIOMotorDatabase, class_id: str) -> list[dict]:
    rows = await db[MongoCollections.student_gamification_profiles].find(
        {
            "class_id": class_id,
            "$or": [{"scope": "class"}, {"scope": {"$exists": False}}],
        }
    ).sort([("xp", -1), ("stars", -1), ("student_id", 1)]).to_list(length=None)
    return [
        {
            "student_id": str(row.get("student_id")),
            "xp": int(row.get("xp") or 0),
            "stars": int(row.get("stars") or 0),
            "level": int(row.get("level") or calculate_level(int(row.get("xp") or 0))),
            "streak": int(row.get("current_streak") or row.get("streak") or 0),
            "participation": int(row.get("session_streak") or 0),
        }
        for row in rows
        if row.get("student_id")
    ]


async def period_leaderboard_entries(
    db: AsyncIOMotorDatabase,
    *,
    class_id: str,
    period: Literal["weekly", "monthly"],
) -> list[dict]:
    start_date = leaderboard_start_date(period)
    match: dict[str, Any] = {"class_id": class_id}
    if start_date:
        match["created_at"] = {"$gte": start_date}
    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": "$student_id",
                "xp": {"$sum": "$xp_delta"},
                "stars": {"$sum": "$stars_delta"},
                "participation": {"$sum": 1},
            }
        },
    ]
    rows = await db[MongoCollections.gamification_events].aggregate(pipeline).to_list(length=None)
    student_ids = [str(row["_id"]) for row in rows if row.get("_id")]
    profiles = await class_profile_map(db, class_id=class_id, student_ids=student_ids)
    entries = []
    for row in rows:
        student_id = str(row.get("_id") or "")
        if not student_id:
            continue
        profile = profiles.get(student_id, {})
        profile_xp = int(profile.get("xp") or 0)
        entries.append(
            {
                "student_id": student_id,
                "xp": int(row.get("xp") or 0),
                # Weekly/monthly rows are still ranked by period XP, but stars are
                # displayed from the class profile so legacy backfilled stars match
                # the student top-right profile instead of showing as 0.
                "stars": int(profile.get("stars") or row.get("stars") or 0),
                "level": int(profile.get("level") or calculate_level(profile_xp)),
                "streak": int(profile.get("current_streak") or profile.get("streak") or 0),
                "participation": int(row.get("participation") or 0),
            }
        )
    return entries


async def build_leaderboard_rows(
    db: AsyncIOMotorDatabase,
    *,
    class_id: str,
    period: Literal["weekly", "monthly", "all_time"],
    current_student_id: str,
) -> tuple[list[LeaderboardRowOut], int | None]:
    if period == "all_time":
        entries = await all_time_leaderboard_entries(db, class_id)
    else:
        entries = await period_leaderboard_entries(db, class_id=class_id, period=period)

    if current_student_id not in {entry["student_id"] for entry in entries}:
        profile = await get_gamification_profile(db, current_student_id, class_id)
        entries.append(
            {
                "student_id": current_student_id,
                "xp": profile.xp if period == "all_time" else 0,
                "stars": profile.stars,
                "level": profile.level,
                "streak": profile.current_streak,
                "participation": 0,
            }
        )

    student_ids = [entry["student_id"] for entry in entries]
    users = await db[MongoCollections.users].find(
        {"user_id": {"$in": student_ids}},
        {"user_id": 1, "name": 1},
    ).to_list(length=None)
    user_map = {str(row.get("user_id")): serialize_document(row) for row in users if row.get("user_id")}
    badge_counts = await leaderboard_badge_counts(db, student_ids=student_ids, class_id=class_id)

    sorted_entries = sorted(
        entries,
        key=lambda entry: (
            -int(entry.get("xp") or 0),
            -int(entry.get("stars") or 0),
            -int(entry.get("participation") or 0),
            private_student_name(user_map.get(entry["student_id"])).lower(),
            entry["student_id"],
        ),
    )
    ranked = []
    current_rank: int | None = None
    for index, entry in enumerate(sorted_entries, start=1):
        is_current = entry["student_id"] == current_student_id
        if is_current:
            current_rank = index
        ranked.append(
            LeaderboardRowOut(
                rank=index,
                student_id=entry["student_id"],
                student_name=private_student_name(user_map.get(entry["student_id"])),
                level=int(entry.get("level") or 1),
                xp=int(entry.get("xp") or 0),
                stars=int(entry.get("stars") or 0),
                badges_count=int(badge_counts.get(entry["student_id"], 0)),
                streak=int(entry.get("streak") or 0),
                is_current_student=is_current,
            )
        )

    visible = ranked[:20]
    if current_rank and current_rank > 20:
        current_row = next((row for row in ranked if row.is_current_student), None)
        if current_row:
            visible.append(current_row)
    return visible, current_rank


@router.get("/me", response_model=GamificationMeOut)
async def get_my_gamification_profile(
    class_id: str | None = None,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> GamificationMeOut:
    await require_student_scope(db, user, class_id)
    # Defensive repair: if a backfill inserted ledger events but profile projection was stale,
    # reconcile this student's profile before returning dashboard data.
    await reconcile_profile_from_events(db, student_id=user["user_id"], class_id=None)
    if class_id:
        await reconcile_profile_from_events(db, student_id=user["user_id"], class_id=class_id)
    platform_profile = await get_gamification_profile(db, user["user_id"], None)
    class_profile = await get_gamification_profile(db, user["user_id"], class_id) if class_id else None
    active_profile = class_profile or platform_profile
    unread_count = await db[MongoCollections.achievement_notifications].count_documents(
        {"student_id": user["user_id"], "read": {"$ne": True}}
    )
    payload = active_profile.model_dump()
    payload["platform_profile"] = platform_profile
    payload["class_profile"] = class_profile
    payload["recent_notifications_count"] = unread_count
    return GamificationMeOut(**payload)


@router.get("/missions", response_model=StudentMissionOut)
async def get_today_mission(
    class_id: str | None = None,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> StudentMissionOut:
    await require_student_scope(db, user, class_id)
    mission = await ensure_daily_mission(db, user["user_id"], class_id, date_key())
    mission = await refresh_mission_progress(db, mission)
    return StudentMissionOut(**mission)


@router.post("/missions/{mission_id}/claim", response_model=MissionClaimOut)
async def claim_mission_reward(
    mission_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> MissionClaimOut:
    require_student(user)
    mission = await db[MongoCollections.student_missions].find_one(
        {"mission_id": mission_id, "student_id": user["user_id"]}
    )
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    if mission.get("class_id"):
        await require_account_class_role(db, user, mission["class_id"], "student")

    mission = await refresh_mission_progress(db, mission)
    if not mission.get("completed"):
        raise HTTPException(status_code=400, detail="Mission is not complete")
    if mission.get("claimed"):
        raise HTTPException(status_code=400, detail="Mission already claimed")

    reward = mission.get("reward") or {"xp": 0, "stars": 0}
    inserted, profile = await award_gamification_event(
        db,
        student_id=user["user_id"],
        class_id=mission.get("class_id"),
        event_type="mission_claim",
        idempotency_key=f"{user['user_id']}:{mission_id}:mission_claim",
        source_type="mission",
        source_id=mission_id,
        xp_delta=int(reward.get("xp") or 0),
        stars_delta=int(reward.get("stars") or 0),
        metadata={"mission_id": mission_id},
    )
    now = datetime.now(timezone.utc)
    await db[MongoCollections.student_missions].update_one(
        {"mission_id": mission_id},
        {"$set": {"claimed": True, "claimed_at": now, "updated_at": now}},
    )
    await create_achievement_notification(
        db,
        student_id=user["user_id"],
        class_id=mission.get("class_id"),
        achievement_type="mission",
        achievement_key="mission_claimed",
        title="Mission Complete",
        description=f"You earned {int(reward.get('xp') or 0)} XP and {int(reward.get('stars') or 0)} stars.",
        icon="check-circle",
        source_type="mission",
        source_id=mission_id,
    )
    mission["claimed"] = True
    mission["claimed_at"] = now
    return MissionClaimOut(
        mission=StudentMissionOut(**mission),
        profile=profile,
        reward=MissionRewardOut(**reward),
        inserted=inserted,
    )


@router.get("/badges", response_model=GamificationBadgesOut)
async def list_badges(
    class_id: str | None = None,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> GamificationBadgesOut:
    await require_student_scope(db, user, class_id)
    badge_query: dict[str, Any] = {"student_id": user["user_id"]}
    if class_id:
        badge_query["$or"] = [{"class_id": class_id}, {"class_id": None}]
    rows = await db[MongoCollections.student_badges].find(badge_query).sort("unlocked_at", -1).to_list(length=None)
    unlocked = [StudentBadgeOut(**serialize_document(row)) for row in rows]
    unlocked_by_key = {badge.badge_key: badge for badge in unlocked}

    definitions = await get_badge_definitions(db)
    locked: list[BadgeCatalogItemOut] = []
    for badge_key, definition in definitions.items():
        if badge_key in unlocked_by_key:
            continue
        progress, target = await badge_progress(
            db,
            student_id=user["user_id"],
            class_id=class_id,
            definition=definition,
        )
        locked.append(
            BadgeCatalogItemOut(
                badge_key=badge_key,
                title=definition["title"],
                description=definition["description"],
                icon=definition["icon"],
                earned=False,
                progress=min(progress, target),
                target=target,
                progress_percentage=progress_percent(progress, target),
            )
        )
    return GamificationBadgesOut(earned=unlocked, unlocked=unlocked, locked=locked)


@router.get("/leaderboard", response_model=GamificationLeaderboardOut)
async def get_class_leaderboard(
    class_id: str,
    period: Literal["weekly", "monthly", "all_time"] = "weekly",
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> GamificationLeaderboardOut:
    await require_student_scope(db, user, class_id)
    rows, current_rank = await build_leaderboard_rows(
        db,
        class_id=class_id,
        period=period,
        current_student_id=user["user_id"],
    )
    return GamificationLeaderboardOut(
        class_id=class_id,
        period=period,
        rows=rows,
        current_student_rank=current_rank,
    )


@router.get("/challenges", response_model=WeeklyChallengesOut)
async def list_weekly_challenges(
    class_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> WeeklyChallengesOut:
    await require_student_scope(db, user, class_id)
    challenges = await ensure_weekly_challenges(db, class_id)
    order = {definition["challenge_key"]: index for index, definition in enumerate(DEFAULT_WEEKLY_CHALLENGES)}
    challenges = sorted(challenges, key=lambda item: order.get(item.get("challenge_key"), 999))
    rows = [
        await challenge_with_progress(db, challenge=challenge, student_id=user["user_id"])
        for challenge in challenges
    ]
    return WeeklyChallengesOut(class_id=class_id, week_key=current_week_key(), challenges=rows)


@router.post("/challenges/{challenge_id}/claim", response_model=ChallengeClaimOut)
async def claim_weekly_challenge(
    challenge_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ChallengeClaimOut:
    require_student(user)
    challenge = await db[MongoCollections.weekly_challenges].find_one(
        {"challenge_id": challenge_id, "active": {"$ne": False}}
    )
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    await require_student_scope(db, user, challenge["class_id"])
    expires_at = as_utc_datetime(challenge.get("expires_at"))
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Challenge has expired")

    progress = await refresh_challenge_progress(db, challenge=challenge, student_id=user["user_id"])
    if not progress.get("completed"):
        raise HTTPException(status_code=400, detail="Challenge is not complete")
    if progress.get("claimed"):
        raise HTTPException(status_code=400, detail="Challenge already claimed")

    reward = challenge.get("reward") or {"xp": 0, "stars": 0}
    inserted, profile = await award_gamification_event(
        db,
        student_id=user["user_id"],
        class_id=challenge["class_id"],
        event_type="weekly_challenge_claim",
        idempotency_key=f"{user['user_id']}:{challenge_id}:weekly_challenge_claim",
        source_type="weekly_challenge",
        source_id=challenge_id,
        xp_delta=int(reward.get("xp") or 0),
        stars_delta=int(reward.get("stars") or 0),
        metadata={"challenge_id": challenge_id, "week_key": challenge.get("week_key")},
    )
    now = datetime.now(timezone.utc)
    await db[MongoCollections.student_challenge_progress].update_one(
        {"challenge_id": challenge_id, "student_id": user["user_id"]},
        {"$set": {"claimed": True, "claimed_at": now, "updated_at": now}},
    )
    await create_achievement_notification(
        db,
        student_id=user["user_id"],
        class_id=challenge["class_id"],
        achievement_type="reward",
        achievement_key=f"weekly_challenge_{challenge_id}",
        title="Weekly Challenge Complete",
        description=f"You earned {int(reward.get('xp') or 0)} XP and {int(reward.get('stars') or 0)} stars.",
        icon="trophy",
        source_type="weekly_challenge",
        source_id=challenge_id,
    )
    updated_challenge = await challenge_with_progress(db, challenge=challenge, student_id=user["user_id"])
    return ChallengeClaimOut(
        challenge=updated_challenge,
        profile=profile,
        reward=MissionRewardOut(**reward),
        inserted=inserted,
    )


@router.get("/notifications", response_model=list[AchievementNotificationOut])
async def list_achievement_notifications(
    unread_only: bool = True,
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[AchievementNotificationOut]:
    require_student(user)
    query: dict[str, Any] = {"student_id": user["user_id"]}
    if unread_only:
        query["read"] = {"$ne": True}
    rows = await db[MongoCollections.achievement_notifications].find(query).sort("created_at", -1).to_list(length=limit)
    return [AchievementNotificationOut(**serialize_document(row)) for row in rows]


@router.post("/notifications/{notification_id}/read")
async def mark_achievement_notification_read(
    notification_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    require_student(user)
    result = await db[MongoCollections.achievement_notifications].update_one(
        {"achievement_notification_id": notification_id, "student_id": user["user_id"]},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"updated": result.modified_count}


@router.post("/notifications/read-all")
async def mark_all_achievement_notifications_read(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    require_student(user)
    result = await db[MongoCollections.achievement_notifications].update_many(
        {"student_id": user["user_id"], "read": {"$ne": True}},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}},
    )
    return {"updated": result.modified_count}


@router.get("/sessions/{session_id}/summary", response_model=SessionRewardSummaryOut)
async def get_session_reward_summary(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> SessionRewardSummaryOut:
    require_student(user)
    session = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await require_account_class_role(db, user, session["class_id"], "student")

    summary = await db[MongoCollections.session_reward_summaries].find_one(
        {"session_id": session_id, "student_id": user["user_id"]}
    )
    if not summary:
        summary = await build_session_reward_summary(
            db,
            student_id=user["user_id"],
            class_id=session["class_id"],
            session_id=session_id,
        )
    return SessionRewardSummaryOut(**serialize_document(summary))


@router.get("/history", response_model=list[GamificationHistoryEventOut])
async def list_gamification_history(
    class_id: str | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[GamificationHistoryEventOut]:
    await require_student_scope(db, user, class_id)
    query: dict[str, Any] = {"student_id": user["user_id"]}
    if class_id:
        query["class_id"] = class_id
    rows = await db[MongoCollections.gamification_events].find(query).sort("created_at", -1).to_list(length=limit)
    return [GamificationHistoryEventOut(**serialize_document(row)) for row in rows]


@router.post("/backfill/class/{class_id}")
async def backfill_class_gamification(
    class_id: str,
    dry_run: bool = Query(default=False),
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    return await backfill_gamification_for_class(db, class_id, dry_run=dry_run)


@router.post("/backfill/student/{student_id}")
async def backfill_student_gamification(
    student_id: str,
    class_id: str | None = None,
    dry_run: bool = Query(default=False),
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    return await backfill_gamification_for_student(db, student_id, class_id, dry_run=dry_run)


@router.post("/backfill/all")
async def backfill_all_gamification(
    dry_run: bool = Query(default=False),
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    return await backfill_gamification_all(db, dry_run=dry_run)
