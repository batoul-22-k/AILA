from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import UpdateOne

from app.database import MongoCollections
from app.models import GamificationProfileOut, utc_now
from app.services import serialize_document


PLATFORM_SCOPE = "platform"
CLASS_SCOPE = "class"

LEVEL_THRESHOLDS = [
    0,
    100,
    250,
    500,
    800,
    1200,
    1700,
    2300,
    3000,
    3900,
    5000,
]

REWARD_RULES = {
    "join_session": {"xp": 5, "stars": 0},
    "answer_question": {"xp": 2, "stars": 0},
    "correct_answer": {"xp": 10, "stars": 5},
    "complete_session": {"xp": 15, "stars": 5},
    "perfect_session": {"xp": 25, "stars": 20},
    "level_up_bonus": {"xp": 50, "stars": 0},
}
STREAK_MILESTONES = {3, 7, 14, 30}

DEFAULT_BADGE_DEFINITIONS = {
    "first_answer": {
        "title": "First Answer",
        "description": "Earned after first participation.",
        "icon": "medal",
        "enabled": True,
        "scope": "class",
        "criteria": {"event_type": "answer_question", "count": 1},
        "sort_order": 10,
    },
    "quick_thinker": {
        "title": "Quick Thinker",
        "description": "Earned after five fast correct answers.",
        "icon": "zap",
        "enabled": True,
        "scope": "class",
        "criteria": {"event_type": "correct_answer", "fast_only": True, "count": 5},
        "sort_order": 20,
    },
    "perfect_session": {
        "title": "Perfect Session",
        "description": "Earned after scoring 100% in one session.",
        "icon": "target",
        "enabled": True,
        "scope": "class",
        "criteria": {"event_type": "perfect_session", "count": 1},
        "sort_order": 30,
    },
    "consistency_hero": {
        "title": "Consistency Hero",
        "description": "Earned after a seven-day activity streak.",
        "icon": "flame",
        "enabled": True,
        "scope": "platform",
        "criteria": {"current_streak": 7},
        "sort_order": 40,
    },
    "participation_master": {
        "title": "Participation Master",
        "description": "Earned after answering 50 questions.",
        "icon": "award",
        "enabled": True,
        "scope": "class",
        "criteria": {"event_type": "answer_question", "count": 50},
        "sort_order": 50,
    },
    "critical_thinker": {
        "title": "Critical Thinker",
        "description": "Earned after 10 approved short answers.",
        "icon": "brain",
        "enabled": True,
        "scope": "class",
        "criteria": {"event_type": "approved_short_answer", "count": 10},
        "sort_order": 60,
    },
    "scholar": {
        "title": "Scholar",
        "description": "Earned after reaching level 10.",
        "icon": "graduation-cap",
        "enabled": True,
        "scope": "platform",
        "criteria": {"level": 10},
        "sort_order": 70,
    },
}
BADGE_DEFINITIONS = DEFAULT_BADGE_DEFINITIONS

DEFAULT_DAILY_MISSION_TASKS = [
    {"key": "join_session", "label": "Join a session", "target": 1, "progress": 0, "completed": False},
    {"key": "answer_questions", "label": "Answer 3 questions", "target": 3, "progress": 0, "completed": False},
    {"key": "earn_stars", "label": "Earn 15 stars", "target": 15, "progress": 0, "completed": False},
]
DEFAULT_DAILY_MISSION_REWARD = {"xp": 25, "stars": 10}


def profile_scope(class_id: str | None) -> str:
    return class_id or PLATFORM_SCOPE


def profile_type(class_id: str | None) -> str:
    return CLASS_SCOPE if class_id else PLATFORM_SCOPE


def deterministic_id(prefix: str, *parts: str | None) -> str:
    raw = "|".join(str(part or "") for part in parts)
    return f"{prefix}_{sha256(raw.encode('utf-8')).hexdigest()[:20]}"


def calculate_level(xp: int) -> int:
    safe_xp = max(int(xp or 0), 0)
    level = 1
    for index, threshold in enumerate(LEVEL_THRESHOLDS, start=1):
        if safe_xp >= threshold:
            level = index
    if safe_xp >= LEVEL_THRESHOLDS[-1]:
        extra_xp = safe_xp - LEVEL_THRESHOLDS[-1]
        level += extra_xp // 1500
    return level


def level_bounds(level: int) -> tuple[int, int | None]:
    safe_level = max(int(level or 1), 1)
    if safe_level <= len(LEVEL_THRESHOLDS):
        current_xp = LEVEL_THRESHOLDS[safe_level - 1]
    else:
        current_xp = LEVEL_THRESHOLDS[-1] + ((safe_level - len(LEVEL_THRESHOLDS)) * 1500)

    if safe_level < len(LEVEL_THRESHOLDS):
        next_xp = LEVEL_THRESHOLDS[safe_level]
    else:
        next_xp = current_xp + 1500
    return current_xp, next_xp


def build_profile_id(student_id: str, class_id: str | None) -> str:
    return deterministic_id("game_profile", student_id, profile_scope(class_id))


def build_legacy_global_profile_id(student_id: str) -> str:
    return deterministic_id("game_profile", student_id, "global")


def build_event_id(student_id: str, class_id: str | None, idempotency_key: str) -> str:
    return deterministic_id("game_event", student_id, profile_scope(class_id), idempotency_key)


def build_achievement_notification_id(
    student_id: str,
    class_id: str | None,
    achievement_type: str,
    achievement_key: str,
    source_id: str | None = None,
) -> str:
    return deterministic_id(
        "achievement_notice",
        student_id,
        profile_scope(class_id),
        achievement_type,
        achievement_key,
        source_id,
    )


def infer_source(
    event_type: str,
    source_type: str | None = None,
    source_id: str | None = None,
    session_id: str | None = None,
    question_id: str | None = None,
) -> tuple[str, str | None]:
    if source_type:
        return source_type, source_id
    if question_id:
        return "question", question_id
    if session_id:
        return "session", session_id
    return event_type, source_id


def date_key(value: datetime | None = None) -> str:
    return (value or utc_now()).astimezone(timezone.utc).date().isoformat()


def coerce_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


async def get_badge_definitions(db: AsyncIOMotorDatabase) -> dict[str, dict]:
    stored = await db[MongoCollections.gamification_badge_definitions].find(
        {"enabled": {"$ne": False}}
    ).to_list(length=None)
    definitions = {key: dict(value) for key, value in DEFAULT_BADGE_DEFINITIONS.items()}
    for row in stored:
        badge_key = row.get("badge_key")
        if badge_key:
            definitions[badge_key] = {**definitions.get(badge_key, {}), **serialize_document(row)}
    return {
        key: value
        for key, value in sorted(definitions.items(), key=lambda item: int(item[1].get("sort_order") or 0))
        if value.get("enabled", True)
    }


async def get_badge_definition(db: AsyncIOMotorDatabase, badge_key: str) -> dict:
    definitions = await get_badge_definitions(db)
    if badge_key not in definitions:
        raise KeyError(f"Unknown badge definition: {badge_key}")
    return definitions[badge_key]


async def legacy_star_total(db: AsyncIOMotorDatabase, student_id: str, class_id: str | None) -> int:
    query: dict[str, Any] = {"student_id": student_id}
    if class_id:
        sessions = await db[MongoCollections.sessions].find({"class_id": class_id}, {"session_id": 1}).to_list(length=None)
        session_ids = [session["session_id"] for session in sessions]
        if not session_ids:
            return 0
        query["session_id"] = {"$in": session_ids}
    rewards = await db[MongoCollections.student_rewards].find(query, {"stars_earned": 1}).to_list(length=None)
    return sum(int(reward.get("stars_earned") or 0) for reward in rewards)


async def ensure_gamification_profile(
    db: AsyncIOMotorDatabase,
    student_id: str,
    class_id: str | None = None,
) -> dict:
    profile_id = build_profile_id(student_id, class_id)
    existing = await db[MongoCollections.student_gamification_profiles].find_one({"profile_id": profile_id})
    if existing:
        if "scope" not in existing:
            await db[MongoCollections.student_gamification_profiles].update_one(
                {"profile_id": profile_id},
                {"$set": {"scope": profile_type(class_id)}},
            )
            existing["scope"] = profile_type(class_id)
        return serialize_document(existing)
    if class_id is None:
        legacy_profile_id = build_legacy_global_profile_id(student_id)
        legacy = await db[MongoCollections.student_gamification_profiles].find_one({"profile_id": legacy_profile_id})
        if legacy:
            await db[MongoCollections.student_gamification_profiles].update_one(
                {"profile_id": legacy_profile_id},
                {"$set": {"profile_id": profile_id, "scope": PLATFORM_SCOPE, "class_id": None, "updated_at": utc_now()}},
            )
            legacy["profile_id"] = profile_id
            legacy["scope"] = PLATFORM_SCOPE
            legacy["class_id"] = None
            return serialize_document(legacy)

    now = utc_now()
    profile = {
        "profile_id": profile_id,
        "student_id": student_id,
        "class_id": class_id,
        "scope": profile_type(class_id),
        "xp": 0,
        "level": 1,
        "stars": await legacy_star_total(db, student_id, class_id),
        "leaderboard_score": 0,
        "current_streak": 0,
        "longest_streak": 0,
        "correct_streak": 0,
        "session_streak": 0,
        "last_activity_date": None,
        "created_at": now,
        "updated_at": now,
    }
    await db[MongoCollections.student_gamification_profiles].update_one(
        {"profile_id": profile_id},
        {"$setOnInsert": profile},
        upsert=True,
    )
    stored = await db[MongoCollections.student_gamification_profiles].find_one({"profile_id": profile_id})
    return serialize_document(stored or profile)


def profile_response(profile: dict, badges_count: int) -> GamificationProfileOut:
    xp = int(profile.get("xp") or 0)
    level = calculate_level(xp)
    current_level_xp, next_level_xp = level_bounds(level)
    current_level_progress = max(xp - current_level_xp, 0)
    xp_to_next_level = max((next_level_xp or xp) - xp, 0)
    level_span = max((next_level_xp or xp) - current_level_xp, 1)
    progress_percent = round((current_level_progress / level_span) * 100, 1)
    return GamificationProfileOut(
        profile_id=profile["profile_id"],
        student_id=profile["student_id"],
        class_id=profile.get("class_id"),
        scope=profile.get("scope") or profile_type(profile.get("class_id")),
        xp=xp,
        level=level,
        stars=int(profile.get("stars") or 0),
        platform_xp=profile.get("platform_xp"),
        platform_level=profile.get("platform_level"),
        platform_stars=profile.get("platform_stars"),
        current_streak=int(profile.get("current_streak") or profile.get("streak") or 0),
        longest_streak=int(profile.get("longest_streak") or 0),
        correct_streak=int(profile.get("correct_streak") or 0),
        session_streak=int(profile.get("session_streak") or 0),
        badges_count=badges_count,
        next_level_xp=next_level_xp,
        current_level_xp=current_level_xp,
        current_level_progress=current_level_progress,
        xp_to_next_level=xp_to_next_level,
        level_progress_percent=progress_percent,
        updated_at=profile.get("updated_at") or utc_now(),
    )


async def get_gamification_profile(
    db: AsyncIOMotorDatabase,
    student_id: str,
    class_id: str | None = None,
) -> GamificationProfileOut:
    profile = await ensure_gamification_profile(db, student_id, class_id)
    if class_id:
        platform_profile = await ensure_gamification_profile(db, student_id, None)
        profile["platform_xp"] = int(platform_profile.get("xp") or 0)
        profile["platform_level"] = calculate_level(int(platform_profile.get("xp") or 0))
        profile["platform_stars"] = int(platform_profile.get("stars") or 0)
    badge_query: dict[str, Any] = {"student_id": student_id}
    if class_id:
        badge_query["class_id"] = class_id
    badges_count = await db[MongoCollections.student_badges].count_documents(badge_query)
    return profile_response(profile, badges_count)


async def sync_user_gamification_totals(db: AsyncIOMotorDatabase, student_id: str) -> None:
    platform_profile = await ensure_gamification_profile(db, student_id, None)
    total_xp = int(platform_profile.get("xp") or 0)
    total_stars = int(platform_profile.get("stars") or 0)
    current_streak = int(platform_profile.get("current_streak") or 0)
    longest_streak = int(platform_profile.get("longest_streak") or 0)
    await db[MongoCollections.users].update_one(
        {"user_id": student_id},
        {
            "$set": {
                "xp": total_xp,
                "level": calculate_level(total_xp),
                "stars": total_stars,
                "streak": current_streak,
                "longest_streak": longest_streak,
                "gamification_updated_at": utc_now(),
            }
        },
    )


async def touch_activity_streak(
    db: AsyncIOMotorDatabase,
    student_id: str,
    class_id: str | None,
    now: datetime | None = None,
) -> dict:
    profile = await ensure_gamification_profile(db, student_id, class_id)
    current_time = now or utc_now()
    today = current_time.astimezone(timezone.utc).date()
    last_activity = coerce_datetime(profile.get("last_activity_date"))
    last_date = last_activity.astimezone(timezone.utc).date() if last_activity else None

    current_streak = int(profile.get("current_streak") or 0)
    if last_date == today:
        next_streak = current_streak
    elif last_date == today - timedelta(days=1):
        next_streak = current_streak + 1
    else:
        next_streak = 1

    longest_streak = max(int(profile.get("longest_streak") or 0), next_streak)
    await db[MongoCollections.student_gamification_profiles].update_one(
        {"profile_id": profile["profile_id"]},
        {
            "$set": {
                "current_streak": next_streak,
                "longest_streak": longest_streak,
                "last_activity_date": current_time,
                "updated_at": current_time,
            }
        },
    )
    updated = await db[MongoCollections.student_gamification_profiles].find_one({"profile_id": profile["profile_id"]})
    return serialize_document(updated or profile)


async def apply_reward_to_profile(
    db: AsyncIOMotorDatabase,
    *,
    student_id: str,
    class_id: str | None,
    xp_delta: int,
    stars_delta: int,
    now: datetime,
    update_streak: bool = True,
) -> dict:
    profile = await ensure_gamification_profile(db, student_id, class_id)
    next_xp = int(profile.get("xp") or 0) + max(int(xp_delta or 0), 0)
    previous_level = calculate_level(int(profile.get("xp") or 0))
    next_level = calculate_level(next_xp)
    await db[MongoCollections.student_gamification_profiles].update_one(
        {"profile_id": profile["profile_id"]},
        {
            "$inc": {
                "xp": max(int(xp_delta or 0), 0),
                "stars": max(int(stars_delta or 0), 0),
            },
            "$set": {
                "level": next_level,
                "leaderboard_score": (next_xp * 1000)
                + int(profile.get("stars") or 0)
                + max(int(stars_delta or 0), 0),
                "updated_at": now,
            },
        },
    )
    if next_level > previous_level:
        await create_achievement_notification(
            db,
            student_id=student_id,
            class_id=class_id,
            achievement_type="level",
            achievement_key=f"level_{next_level}",
            title=f"Level {next_level} Reached",
            description=f"You reached Level {next_level}.",
            icon="trending-up",
            source_type="profile",
            source_id=profile["profile_id"],
        )
    if update_streak:
        updated_profile = await touch_activity_streak(db, student_id, class_id, now)
        current_streak = int(updated_profile.get("current_streak") or 0)
        previous_streak = int(profile.get("current_streak") or 0)
        if current_streak in STREAK_MILESTONES and previous_streak < current_streak:
            await create_achievement_notification(
                db,
                student_id=student_id,
                class_id=class_id,
                achievement_type="streak",
                achievement_key=f"streak_{current_streak}",
                title=f"{current_streak} Day Streak",
                description=f"You kept learning for {current_streak} active days.",
                icon="flame",
                source_type="profile",
                source_id=profile["profile_id"],
            )
            if current_streak >= 7:
                await unlock_badge(
                    db,
                    student_id=student_id,
                    badge_key="consistency_hero",
                    class_id=class_id,
                    source_type="streak",
                    source_id=f"streak_{current_streak}",
                )
        return updated_profile
    updated = await db[MongoCollections.student_gamification_profiles].find_one({"profile_id": profile["profile_id"]})
    return serialize_document(updated or profile)


async def apply_reward_projection(
    db: AsyncIOMotorDatabase,
    event: dict,
    *,
    update_streak: bool = True,
) -> None:
    await apply_reward_to_profile(
        db,
        student_id=event["student_id"],
        class_id=event.get("class_id"),
        xp_delta=event.get("xp_delta", 0),
        stars_delta=event.get("stars_delta", 0),
        now=event["created_at"],
        update_streak=update_streak,
    )
    if event.get("class_id"):
        await apply_reward_to_profile(
            db,
            student_id=event["student_id"],
            class_id=None,
            xp_delta=event.get("xp_delta", 0),
            stars_delta=event.get("stars_delta", 0),
            now=event["created_at"],
            update_streak=update_streak,
        )


async def award_gamification_event(
    db: AsyncIOMotorDatabase,
    *,
    student_id: str,
    event_type: str,
    idempotency_key: str,
    class_id: str | None = None,
    session_id: str | None = None,
    question_id: str | None = None,
    source_type: str | None = None,
    source_id: str | None = None,
    xp_delta: int = 0,
    stars_delta: int = 0,
    metadata: dict | None = None,
    update_streak: bool = True,
) -> tuple[bool, GamificationProfileOut]:
    starting_profile = await ensure_gamification_profile(db, student_id, class_id)
    starting_level = calculate_level(int(starting_profile.get("xp") or 0))
    now = utc_now()
    event_id = build_event_id(student_id, class_id, idempotency_key)
    resolved_source_type, resolved_source_id = infer_source(
        event_type,
        source_type=source_type,
        source_id=source_id,
        session_id=session_id,
        question_id=question_id,
    )
    event = {
        "_id": event_id,
        "event_id": event_id,
        "student_id": student_id,
        "class_id": class_id,
        "session_id": session_id,
        "question_id": question_id,
        "source_type": resolved_source_type,
        "source_id": resolved_source_id,
        "event_type": event_type,
        "xp_delta": max(int(xp_delta or 0), 0),
        "stars_delta": max(int(stars_delta or 0), 0),
        "idempotency_key": idempotency_key,
        "metadata": metadata or {},
        "created_at": now,
    }
    result = await db[MongoCollections.gamification_events].update_one(
        {"_id": event_id},
        {"$setOnInsert": event},
        upsert=True,
    )

    inserted = bool(result.upserted_id)
    if inserted:
        await apply_reward_projection(db, event, update_streak=update_streak)
        await evaluate_achievements_for_event(db, event)
        updated_profile = await ensure_gamification_profile(db, student_id, class_id)
        updated_level = calculate_level(int(updated_profile.get("xp") or 0))
        if event_type != "level_up_bonus" and updated_level > starting_level:
            bonus_rule = REWARD_RULES["level_up_bonus"]
            await award_gamification_event(
                db,
                student_id=student_id,
                class_id=class_id,
                event_type="level_up_bonus",
                idempotency_key=f"{student_id}:{profile_scope(class_id)}:level_{updated_level}:level_up_bonus",
                source_type="profile",
                source_id=updated_profile.get("profile_id"),
                xp_delta=bonus_rule["xp"],
                stars_delta=bonus_rule["stars"],
                metadata={"level": updated_level, "trigger_event_id": event_id},
                update_streak=False,
            )
        await sync_user_gamification_totals(db, student_id)

    # Phase 2 hook: update daily mission progress and unlock badges from this event here.
    # Phase 2 hook: mirror XP/stars deltas into student_rewards when the event is tied to a response.
    return inserted, await get_gamification_profile(db, student_id, class_id)


async def award_rule_event(
    db: AsyncIOMotorDatabase,
    *,
    student_id: str,
    event_type: str,
    idempotency_key: str,
    class_id: str | None = None,
    session_id: str | None = None,
    question_id: str | None = None,
    source_type: str | None = None,
    source_id: str | None = None,
    metadata: dict | None = None,
) -> tuple[bool, GamificationProfileOut]:
    rule = REWARD_RULES.get(event_type, {"xp": 0, "stars": 0})
    return await award_gamification_event(
        db,
        student_id=student_id,
        class_id=class_id,
        session_id=session_id,
        question_id=question_id,
        source_type=source_type,
        source_id=source_id,
        event_type=event_type,
        idempotency_key=idempotency_key,
        xp_delta=rule["xp"],
        stars_delta=rule["stars"],
        metadata=metadata,
    )


async def award_bulk_reward_transaction(
    db: AsyncIOMotorDatabase,
    *,
    reward_events: list[dict],
    transaction_id: str | None = None,
    update_streak: bool = True,
) -> dict:
    """
    Insert a logical reward transaction into the idempotent ledger.

    Each reward event is still independently idempotent. Only newly inserted
    ledger rows project XP/stars into platform and class profiles.
    """
    if not reward_events:
        return {"transaction_id": transaction_id, "inserted_count": 0, "skipped_count": 0, "events": []}

    now = utc_now()
    resolved_transaction_id = transaction_id or deterministic_id(
        "reward_txn",
        *[
            str(event.get("idempotency_key") or event.get("event_type") or index)
            for index, event in enumerate(reward_events)
        ],
    )
    event_docs: list[dict] = []
    operations: list[UpdateOne] = []
    for index, spec in enumerate(reward_events):
        event_type = spec["event_type"]
        student_id = spec["student_id"]
        class_id = spec.get("class_id")
        session_id = spec.get("session_id")
        question_id = spec.get("question_id")
        rule = REWARD_RULES.get(event_type, {"xp": 0, "stars": 0})
        idempotency_key = spec.get("idempotency_key") or f"{resolved_transaction_id}:{index}:{event_type}"
        event_id = build_event_id(student_id, class_id, idempotency_key)
        source_type, source_id = infer_source(
            event_type,
            source_type=spec.get("source_type"),
            source_id=spec.get("source_id"),
            session_id=session_id,
            question_id=question_id,
        )
        event = {
            "_id": event_id,
            "event_id": event_id,
            "student_id": student_id,
            "class_id": class_id,
            "session_id": session_id,
            "question_id": question_id,
            "source_type": source_type,
            "source_id": source_id,
            "event_type": event_type,
            "xp_delta": max(int(spec.get("xp_delta", rule["xp"]) or 0), 0),
            "stars_delta": max(int(spec.get("stars_delta", rule["stars"]) or 0), 0),
            "idempotency_key": idempotency_key,
            "transaction_id": resolved_transaction_id,
            "metadata": spec.get("metadata") or {},
            "created_at": now,
        }
        event_docs.append(event)
        operations.append(UpdateOne({"_id": event_id}, {"$setOnInsert": event}, upsert=True))

    result = await db[MongoCollections.gamification_events].bulk_write(operations, ordered=False)
    inserted_indexes = set((result.upserted_ids or {}).keys())
    touched_students: set[str] = set()
    response_events: list[dict] = []

    for index, event in enumerate(event_docs):
        inserted = index in inserted_indexes
        if inserted:
            await apply_reward_projection(db, event, update_streak=update_streak)
            await evaluate_achievements_for_event(db, event)
            touched_students.add(event["student_id"])
        response_events.append(
            {
                "event_id": event["event_id"],
                "event_type": event["event_type"],
                "student_id": event["student_id"],
                "class_id": event.get("class_id"),
                "inserted": inserted,
                "xp_delta": event["xp_delta"] if inserted else 0,
                "stars_delta": event["stars_delta"] if inserted else 0,
            }
        )

    for student_id in touched_students:
        await sync_user_gamification_totals(db, student_id)

    return {
        "transaction_id": resolved_transaction_id,
        "inserted_count": len(inserted_indexes),
        "skipped_count": len(event_docs) - len(inserted_indexes),
        "events": response_events,
    }


async def event_count(
    db: AsyncIOMotorDatabase,
    *,
    student_id: str,
    event_type: str,
    class_id: str | None = None,
) -> int:
    query: dict[str, Any] = {"student_id": student_id, "event_type": event_type}
    if class_id is not None:
        query["class_id"] = class_id
    return await db[MongoCollections.gamification_events].count_documents(query)


async def evaluate_achievements_for_event(db: AsyncIOMotorDatabase, event: dict) -> None:
    student_id = event["student_id"]
    class_id = event.get("class_id")
    session_id = event.get("session_id")
    event_type = event.get("event_type")

    if event_type == "answer_question":
        answers_in_class = await event_count(
            db,
            student_id=student_id,
            class_id=class_id,
            event_type="answer_question",
        )
        if answers_in_class >= 1:
            await unlock_badge(
                db,
                student_id=student_id,
                class_id=class_id,
                badge_key="first_answer",
                source_session_id=session_id,
                source_type=event.get("source_type"),
                source_id=event.get("source_id"),
            )
        if answers_in_class >= 50:
            await unlock_badge(
                db,
                student_id=student_id,
                class_id=class_id,
                badge_key="participation_master",
                source_session_id=session_id,
                source_type=event.get("source_type"),
                source_id=event.get("source_id"),
            )

    if event_type == "perfect_session":
        await unlock_badge(
            db,
            student_id=student_id,
            class_id=class_id,
            badge_key="perfect_session",
            source_session_id=session_id,
            source_type="session",
            source_id=session_id,
        )
        await create_achievement_notification(
            db,
            student_id=student_id,
            class_id=class_id,
            achievement_type="session_reward",
            achievement_key="perfect_session",
            title="Perfect Session",
            description="You answered every question correctly in this session.",
            icon="target",
            source_type="session",
            source_id=session_id,
        )

    platform_profile = await ensure_gamification_profile(db, student_id, None)
    if calculate_level(int(platform_profile.get("xp") or 0)) >= 10:
        await unlock_badge(
            db,
            student_id=student_id,
            class_id=None,
            badge_key="scholar",
            source_type="profile",
            source_id=platform_profile.get("profile_id"),
        )


async def unlock_badge(
    db: AsyncIOMotorDatabase,
    *,
    student_id: str,
    badge_key: str,
    class_id: str | None = None,
    source_session_id: str | None = None,
    source_type: str | None = None,
    source_id: str | None = None,
) -> tuple[bool, dict]:
    definition = await get_badge_definition(db, badge_key)
    resolved_source_type = source_type or ("session" if source_session_id else "badge")
    resolved_source_id = source_id or source_session_id
    badge_id = deterministic_id("badge", student_id, profile_scope(class_id), badge_key)
    now = utc_now()
    badge = {
        "_id": badge_id,
        "badge_id": badge_id,
        "student_id": student_id,
        "class_id": class_id,
        "badge_key": badge_key,
        "title": definition["title"],
        "description": definition["description"],
        "icon": definition["icon"],
        "unlocked_at": now,
        "source_session_id": source_session_id,
        "source_type": resolved_source_type,
        "source_id": resolved_source_id,
    }
    result = await db[MongoCollections.student_badges].update_one(
        {"_id": badge_id},
        {"$setOnInsert": badge},
        upsert=True,
    )
    stored = await db[MongoCollections.student_badges].find_one({"_id": badge_id})
    inserted = bool(result.upserted_id)
    if inserted:
        await create_achievement_notification(
            db,
            student_id=student_id,
            class_id=class_id,
            achievement_type="badge",
            achievement_key=badge_key,
            title=definition["title"],
            description=definition["description"],
            icon=definition.get("icon"),
            source_type=resolved_source_type,
            source_id=resolved_source_id,
        )
    return inserted, serialize_document(stored or badge)


async def create_achievement_notification(
    db: AsyncIOMotorDatabase,
    *,
    student_id: str,
    achievement_type: str,
    achievement_key: str,
    title: str,
    description: str,
    class_id: str | None = None,
    icon: str | None = None,
    source_type: str | None = None,
    source_id: str | None = None,
) -> tuple[bool, dict]:
    now = utc_now()
    notification_id = build_achievement_notification_id(
        student_id,
        class_id,
        achievement_type,
        achievement_key,
        source_id,
    )
    notification = {
        "_id": notification_id,
        "achievement_notification_id": notification_id,
        "student_id": student_id,
        "class_id": class_id,
        "achievement_type": achievement_type,
        "achievement_key": achievement_key,
        "title": title,
        "description": description,
        "icon": icon,
        "source_type": source_type,
        "source_id": source_id,
        "read": False,
        "created_at": now,
    }
    result = await db[MongoCollections.achievement_notifications].update_one(
        {"_id": notification_id},
        {"$setOnInsert": notification},
        upsert=True,
    )
    stored = await db[MongoCollections.achievement_notifications].find_one({"_id": notification_id})
    return bool(result.upserted_id), serialize_document(stored or notification)


async def ensure_daily_mission(
    db: AsyncIOMotorDatabase,
    student_id: str,
    class_id: str | None = None,
    current_date_key: str | None = None,
) -> dict:
    mission_date = current_date_key or date_key()
    mission_id = deterministic_id("mission", student_id, profile_scope(class_id), mission_date)
    existing = await db[MongoCollections.student_missions].find_one({"mission_id": mission_id})
    if existing:
        return serialize_document(existing)

    now = utc_now()
    mission = {
        "mission_id": mission_id,
        "student_id": student_id,
        "class_id": class_id,
        "date_key": mission_date,
        "title": "Today's Mission",
        "tasks": [dict(task) for task in DEFAULT_DAILY_MISSION_TASKS],
        "reward": dict(DEFAULT_DAILY_MISSION_REWARD),
        "completed": False,
        "claimed": False,
        "created_at": now,
        "completed_at": None,
    }
    await db[MongoCollections.student_missions].update_one(
        {"mission_id": mission_id},
        {"$setOnInsert": mission},
        upsert=True,
    )
    stored = await db[MongoCollections.student_missions].find_one({"mission_id": mission_id})
    return serialize_document(stored or mission)


async def build_session_reward_summary(
    db: AsyncIOMotorDatabase,
    *,
    student_id: str,
    class_id: str,
    session_id: str,
) -> dict:
    events = await db[MongoCollections.gamification_events].find(
        {"student_id": student_id, "class_id": class_id, "session_id": session_id}
    ).to_list(length=None)
    profile = await get_gamification_profile(db, student_id, class_id)
    xp_earned = sum(int(event.get("xp_delta") or 0) for event in events)
    stars_earned = sum(int(event.get("stars_delta") or 0) for event in events)
    level_before = calculate_level(max(int(profile.xp or 0) - xp_earned, 0))
    badge_rows = await db[MongoCollections.student_badges].find(
        {
            "student_id": student_id,
            "class_id": class_id,
            "$or": [
                {"source_session_id": session_id},
                {"source_type": "session", "source_id": session_id},
            ],
        }
    ).sort("unlocked_at", -1).to_list(length=None)
    new_badges = [serialize_document(row) for row in badge_rows]
    summary = {
        "summary_id": deterministic_id("reward_summary", student_id, class_id, session_id),
        "student_id": student_id,
        "class_id": class_id,
        "session_id": session_id,
        "source_session_id": session_id,
        "xp_earned": xp_earned,
        "stars_earned": stars_earned,
        "badges_unlocked": len(new_badges),
        "new_badges": new_badges,
        "current_streak": profile.current_streak,
        "longest_streak": profile.longest_streak,
        "level_before": level_before,
        "level_after": profile.level,
        "leveled_up": profile.level > level_before,
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }
    await db[MongoCollections.session_reward_summaries].update_one(
        {"summary_id": summary["summary_id"]},
        {"$set": summary},
        upsert=True,
    )
    return summary
