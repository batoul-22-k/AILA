"""Development-only seeder for admin analytics and prediction demos.

This script writes realistic demo learning activity for existing classes and
users, then runs the existing analytics/prediction pipeline. It is intentionally
guarded so it cannot run unless ENV=development or DEMO_SEED=true.
"""

from __future__ import annotations

import asyncio
import os
import random
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


SEED_SOURCE = "demo_learning_activity"
DEMO_INSTITUTION_ID = "demo_institution"
DEMO_SEMESTER = "Spring 2026"
DEMO_DEPARTMENT = "Demo Learning Analytics"
SESSION_COUNT = 8
QUESTIONS_PER_SESSION = 4
MIN_STUDENTS_PER_CLASS = 12

BLOOM_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"]
RISK_LEVELS = ["low", "medium", "high"]
DEMO_TREND_TARGET_RATIOS = {
    "stable": 0.30,
    "improved": 0.30,
    "worsened": 0.30,
    "initial": 0.10,
}
DEMO_CLASS_NAMES = [
    "Business Analytics",
    "SQL Database",
    "Java Programming",
    "Data Visualization",
    "Software Engineering",
    "Information Systems",
]


@dataclass(frozen=True)
class ClassProfile:
    name: str
    archetype: str
    attendance: float
    participation: float
    correctness: float
    semantic_quality: float
    response_time: float
    recent_boost: float
    trend: float
    bloom_focus: tuple[str, ...]
    weak_levels: tuple[str, ...]
    persona_mix: tuple[str, ...]


@dataclass(frozen=True)
class StudentPersona:
    name: str
    attendance_delta: float
    participation_delta: float
    correctness_delta: float
    semantic_delta: float
    response_time_delta: float
    trend: float
    volatility: float = 0.04


CLASS_PROFILES = [
    ClassProfile(
        "Excellent class",
        "excellent",
        0.97,
        0.92,
        0.92,
        0.92,
        30,
        1.0,
        0.03,
        ("Apply", "Analyze", "Evaluate"),
        ("Evaluate",),
        ("excellent", "quiet_strong", "slow_accurate", "improving", "average", "active_inaccurate"),
    ),
    ClassProfile(
        "Healthy class",
        "healthy",
        0.95,
        0.9,
        0.88,
        0.88,
        32,
        1.0,
        0.025,
        ("Understand", "Apply", "Analyze"),
        ("Analyze",),
        ("excellent", "quiet_strong", "slow_accurate", "improving", "average", "active_inaccurate"),
    ),
    ClassProfile(
        "Average class",
        "average",
        0.78,
        0.7,
        0.68,
        0.7,
        48,
        0.86,
        0.0,
        ("Understand", "Apply"),
        ("Apply",),
        ("average", "average", "quiet_strong", "active_inaccurate", "improving", "declining", "slow_accurate"),
    ),
    ClassProfile(
        "Challenging class",
        "challenging",
        0.68,
        0.62,
        0.56,
        0.58,
        62,
        0.74,
        -0.02,
        ("Apply", "Analyze", "Evaluate"),
        ("Analyze", "Evaluate"),
        ("average", "active_inaccurate", "declining", "frequently_absent", "struggling", "fast_careless"),
    ),
    ClassProfile(
        "At-risk class",
        "at_risk",
        0.5,
        0.48,
        0.42,
        0.45,
        78,
        0.58,
        -0.04,
        ("Remember", "Understand", "Apply"),
        ("Understand", "Apply", "Analyze"),
        ("struggling", "frequently_absent", "declining", "fast_careless", "active_inaccurate", "average"),
    ),
    ClassProfile(
        "Mixed classroom",
        "mixed",
        0.76,
        0.66,
        0.6,
        0.65,
        58,
        0.78,
        0.0,
        ("Analyze", "Evaluate", "Create"),
        ("Evaluate", "Create"),
        ("excellent", "quiet_strong", "average", "active_inaccurate", "frequently_absent", "struggling"),
    ),
]


STUDENT_PERSONAS = {
    "excellent": StudentPersona("Excellent student", 0.04, 0.05, 0.05, 0.05, -8, 0.01, 0.02),
    "quiet_strong": StudentPersona("Quiet but strong", 0.03, -0.18, 0.07, 0.06, 4, 0.0, 0.025),
    "active_inaccurate": StudentPersona("Active but inaccurate", 0.03, 0.08, -0.22, -0.2, -7, -0.005, 0.05),
    "improving": StudentPersona("Improving student", -0.04, -0.03, -0.06, -0.05, 3, 0.16, 0.04),
    "declining": StudentPersona("Declining student", 0.0, -0.02, -0.03, -0.03, 6, -0.18, 0.05),
    "frequently_absent": StudentPersona("Frequently absent", -0.28, -0.1, -0.08, -0.08, 10, -0.03, 0.05),
    "fast_careless": StudentPersona("Fast but careless", 0.01, 0.04, -0.18, -0.16, -22, -0.02, 0.055),
    "slow_accurate": StudentPersona("Slow but accurate", 0.02, -0.04, 0.05, 0.05, 28, 0.0, 0.025),
    "average": StudentPersona("Average student", 0.0, 0.0, 0.0, 0.0, 0, 0.0, 0.04),
    "struggling": StudentPersona("Struggling student", -0.14, -0.12, -0.2, -0.18, 18, -0.05, 0.06),
}


COURSE_PROFILE_HINTS = [
    (("java", "programming"), "excellent"),
    (("network",), "average"),
    (("communication",), "healthy"),
    (("visualization", "dashboard"), "healthy"),
    (("data science",), "healthy"),
    (("software", "engineering"), "average"),
    (("sql", "database"), "challenging"),
    (("information systems", "systems"), "at_risk"),
    (("business", "analytics"), "mixed"),
]


def allowed_to_run() -> bool:
    env = os.getenv("ENV", "").strip().lower()
    demo_seed = os.getenv("DEMO_SEED", "").strip().lower()
    return env == "development" or demo_seed in {"1", "true", "yes", "on"}


def load_app_dependencies() -> dict[str, Any]:
    from motor.motor_asyncio import AsyncIOMotorClient

    from app.analytics_services import recalculate_class_analytics
    from app.auth import hash_password
    from app.config import get_settings
    from app.database import MongoCollections, ensure_indexes
    from app.models import new_id, utc_now

    return {
        "AsyncIOMotorClient": AsyncIOMotorClient,
        "MongoCollections": MongoCollections,
        "ensure_indexes": ensure_indexes,
        "get_settings": get_settings,
        "hash_password": hash_password,
        "new_id": new_id,
        "recalculate_class_analytics": recalculate_class_analytics,
        "utc_now": utc_now,
    }


def account_role(user: dict) -> str:
    return str(user.get("account_role") or user.get("global_role") or "").lower()


def stable_slug(value: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in str(value or "")).strip("_").lower()[:48]


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def percent(value: float) -> float:
    return round(clamp(value) * 100, 2)


def normalize_demo_risk_level(value: Any) -> str:
    normalized = str(value or "low").strip().lower().replace(" risk", "")
    return normalized if normalized in RISK_LEVELS else "low"


def supported_demo_trend_states(current_risk_level: str) -> list[str]:
    current = normalize_demo_risk_level(current_risk_level)
    states = ["stable", "initial"]
    if current != "low":
        states.append("worsened")
    if current != "high":
        states.append("improved")
    return states


def previous_risk_level_for_demo_trend(current_risk_level: str, trend_state: str) -> str | None:
    current = normalize_demo_risk_level(current_risk_level)
    if trend_state == "initial":
        return None
    if trend_state == "stable":
        return current
    current_index = RISK_LEVELS.index(current)
    if trend_state == "improved" and current_index < len(RISK_LEVELS) - 1:
        return RISK_LEVELS[current_index + 1]
    if trend_state == "worsened" and current_index > 0:
        return RISK_LEVELS[current_index - 1]
    return current


def demo_trend_target_counts(total_predictions: int) -> dict[str, int]:
    if total_predictions <= 0:
        return {state: 0 for state in DEMO_TREND_TARGET_RATIOS}
    initial = max(1, -(-total_predictions // 10))
    remaining = max(0, total_predictions - initial)
    base = remaining // 3
    targets = {"stable": base, "improved": base, "worsened": base, "initial": initial}
    for state in ("stable", "improved", "worsened"):
        if sum(targets.values()) >= total_predictions:
            break
        targets[state] += 1
    return targets


def choose_demo_trend_state(current_risk_level: str, counts: Counter[str], targets: dict[str, int]) -> str:
    supported = supported_demo_trend_states(current_risk_level)
    under_target = [state for state in supported if counts[state] < targets.get(state, 0)]
    candidates = under_target or supported

    def state_score(state: str) -> tuple[float, int]:
        target = max(targets.get(state, 0), 1)
        remaining = targets.get(state, 0) - counts[state]
        return (remaining / target, -1 if state == "initial" else 0)

    return max(candidates, key=state_score)


def preferred_demo_trend_candidate(predictions: list[dict], trend_state: str, prefer_support: bool = True) -> dict | None:
    candidates = [
        row
        for row in predictions
        if trend_state in supported_demo_trend_states(row.get("risk_level"))
    ]
    if not candidates:
        return None
    return sorted(
        candidates,
        key=lambda row: (
            (normalize_demo_risk_level(row.get("risk_level")) not in {"medium", "high"})
            if prefer_support
            else (normalize_demo_risk_level(row.get("risk_level")) in {"medium", "high"}),
            str(row.get("student_id") or ""),
            str(row.get("prediction_id") or ""),
        ),
    )[0]


def demo_previous_risk_score(previous_level: str, current_score: float, row_index: int) -> float:
    ranges = {
        "low": (12.0, 36.0),
        "medium": (52.0, 70.0),
        "high": (82.0, 94.0),
    }
    low, high = ranges[normalize_demo_risk_level(previous_level)]
    offset = ((row_index * 7) % 11) - 5
    if low <= current_score <= high:
        return round(max(low, min(high, current_score + offset)), 2)
    midpoint = (low + high) / 2
    return round(max(low, min(high, midpoint + offset)), 2)


def demo_previous_probabilities(previous_level: str) -> dict[str, float]:
    level = normalize_demo_risk_level(previous_level)
    if level == "high":
        return {"low": 0.04, "medium": 0.16, "high": 0.80}
    if level == "medium":
        return {"low": 0.18, "medium": 0.68, "high": 0.14}
    return {"low": 0.82, "medium": 0.14, "high": 0.04}


def demo_previous_prediction_payload(prediction: dict, trend_state: str, row_index: int) -> dict | None:
    previous_level = previous_risk_level_for_demo_trend(prediction.get("risk_level"), trend_state)
    if previous_level is None:
        return None

    generated_at = prediction.get("generated_at") or prediction.get("predicted_at")
    if not isinstance(generated_at, datetime):
        generated_at = datetime.now(timezone.utc)
    previous_at = generated_at - timedelta(days=14)
    current_score = float(prediction.get("risk_score") or 0)
    previous_score = demo_previous_risk_score(previous_level, current_score, row_index)
    probabilities = demo_previous_probabilities(previous_level)
    confidence = probabilities[previous_level]
    return {
        "prediction_id": f"previous_{prediction.get('prediction_id') or row_index}",
        "student_id": prediction.get("student_id"),
        "student_name": prediction.get("student_name", "Student"),
        "class_id": prediction.get("class_id"),
        "risk_level": previous_level,
        "risk_score": previous_score,
        "risk_probability": round(probabilities["medium"] + probabilities["high"], 4),
        "risk_probabilities": probabilities,
        "confidence": confidence,
        "model_confidence": confidence,
        "model_type": prediction.get("model_type"),
        "generated_at": previous_at,
        "predicted_at": previous_at,
        "demo": True,
        "seed_source": SEED_SOURCE,
        "demo_prediction_history": True,
    }


def assign_demo_prediction_trend_states_for_group(predictions: list[dict]) -> dict[str, str]:
    sorted_predictions = sorted(
        predictions,
        key=lambda row: (str(row.get("class_id") or ""), str(row.get("student_id") or ""), str(row.get("prediction_id") or "")),
    )
    targets = demo_trend_target_counts(len(sorted_predictions))
    counts: Counter[str] = Counter()
    assignments: dict[str, str] = {}

    unassigned = [row for row in sorted_predictions if row.get("prediction_id")]
    if len(unassigned) >= 4:
        support_count = sum(1 for row in unassigned if normalize_demo_risk_level(row.get("risk_level")) in {"medium", "high"})
        for state in ("improved", "worsened", "stable", "initial"):
            candidate = preferred_demo_trend_candidate(unassigned, state, prefer_support=(state in {"improved", "worsened"} or support_count >= 6))
            if not candidate or not candidate.get("prediction_id"):
                continue
            assignments[candidate["prediction_id"]] = state
            counts[state] += 1
            unassigned = [row for row in unassigned if row.get("prediction_id") != candidate["prediction_id"]]

    for prediction in unassigned:
        state = choose_demo_trend_state(prediction.get("risk_level"), counts, targets)
        counts[state] += 1
        assignments[prediction["prediction_id"]] = state
    return assignments


def assign_demo_prediction_trend_states(predictions: list[dict]) -> dict[str, str]:
    by_class: dict[str, list[dict]] = {}
    sorted_predictions = sorted(
        predictions,
        key=lambda row: (str(row.get("class_id") or ""), str(row.get("student_id") or ""), str(row.get("prediction_id") or "")),
    )
    for prediction in sorted_predictions:
        by_class.setdefault(str(prediction.get("class_id") or ""), []).append(prediction)

    targets = demo_trend_target_counts(len(sorted_predictions))
    counts: Counter[str] = Counter()
    assignments: dict[str, str] = {}
    remaining_predictions: list[dict] = []
    for class_predictions in by_class.values():
        unassigned = [row for row in class_predictions if row.get("prediction_id")]
        if len(unassigned) >= 4:
            support_count = sum(1 for row in unassigned if normalize_demo_risk_level(row.get("risk_level")) in {"medium", "high"})
            for state in ("improved", "worsened", "stable", "initial"):
                candidate = preferred_demo_trend_candidate(unassigned, state, prefer_support=(state in {"improved", "worsened"} or support_count >= 6))
                if not candidate or not candidate.get("prediction_id"):
                    continue
                assignments[candidate["prediction_id"]] = state
                counts[state] += 1
                unassigned = [row for row in unassigned if row.get("prediction_id") != candidate["prediction_id"]]
        remaining_predictions.extend(unassigned)

    for prediction in sorted(
        remaining_predictions,
        key=lambda row: (str(row.get("class_id") or ""), str(row.get("student_id") or ""), str(row.get("prediction_id") or "")),
    ):
        if not prediction.get("prediction_id"):
            continue
        state = choose_demo_trend_state(prediction.get("risk_level"), counts, targets)
        counts[state] += 1
        assignments[prediction["prediction_id"]] = state
    return assignments


async def prepare_demo_prediction_trends(db: Any) -> dict[str, int]:
    predictions = await db[MongoCollections.prediction_results].find(
        {"seed_source": SEED_SOURCE},
    ).to_list(length=None)
    assignments = assign_demo_prediction_trend_states(predictions)
    counts: Counter[str] = Counter()
    for row_index, prediction in enumerate(predictions):
        prediction_id = prediction.get("prediction_id")
        if not prediction_id:
            continue
        trend_state = assignments.get(prediction_id, "stable")
        counts[trend_state] += 1
        previous_prediction = demo_previous_prediction_payload(prediction, trend_state, row_index)
        update = {
            "$set": {
                "previous_prediction": previous_prediction,
                "demo_prediction_trend_state": trend_state,
                "demo_prediction_trend_seeded": True,
                "demo_prediction_trend_seeded_at": utc_now(),
            }
        }
        await db[MongoCollections.prediction_results].update_one(
            {"prediction_id": prediction_id, "seed_source": SEED_SOURCE},
            update,
        )
    return {state: counts.get(state, 0) for state in ("stable", "improved", "worsened", "initial")}


def user_summary(user: dict | None) -> dict[str, str | None]:
    if not user:
        return {"user_id": None, "name": None, "email": None}
    return {
        "user_id": user.get("user_id"),
        "name": user.get("name") or user.get("full_name") or user.get("email"),
        "email": user.get("email"),
    }


def demo_course_code(class_index: int) -> str:
    return f"DEMO-{class_index + 1:03d}"


def profile_for_class(class_doc_or_name: dict | str, class_index: int) -> ClassProfile:
    if isinstance(class_doc_or_name, dict):
        class_name = str(class_doc_or_name.get("name") or class_doc_or_name.get("class_name") or "")
    else:
        class_name = str(class_doc_or_name or "")
    normalized = class_name.lower()
    profiles_by_archetype = {profile.archetype: profile for profile in CLASS_PROFILES}
    for keywords, archetype in COURSE_PROFILE_HINTS:
        if any(keyword in normalized for keyword in keywords):
            return profiles_by_archetype[archetype]
    return CLASS_PROFILES[class_index % len(CLASS_PROFILES)]


def demo_description(profile: ClassProfile) -> str:
    return f"Development demo dataset profile: {profile.name}; Bloom focus: {', '.join(profile.bloom_focus)}."


def demo_metadata(
    *,
    class_index: int,
    profile: ClassProfile,
    instructor: dict | None = None,
    students: list[dict] | None = None,
) -> dict[str, Any]:
    return {
        "seed_source": SEED_SOURCE,
        "demo": True,
        "institution_id": DEMO_INSTITUTION_ID,
        "semester": DEMO_SEMESTER,
        "department": DEMO_DEPARTMENT,
        "course_code": demo_course_code(class_index),
        "description": demo_description(profile),
        "class_archetype": profile.archetype,
        "bloom_focus": list(profile.bloom_focus),
        "instructor": user_summary(instructor),
        "students": [user_summary(student) for student in (students or [])],
    }


def choose_existing_students(all_students: list[dict], class_index: int, count: int) -> list[dict]:
    if not all_students:
        return []
    rotated = all_students[class_index % len(all_students) :] + all_students[: class_index % len(all_students)]
    return rotated[: min(count, len(rotated))]


async def class_students(db: AsyncIOMotorDatabase, class_id: str) -> list[dict]:
    memberships = await db[MongoCollections.class_memberships].find(
        {"class_id": class_id, "role": "student", "status": "active"}
    ).to_list(length=None)
    student_ids = [row["user_id"] for row in memberships if row.get("user_id")]
    if not student_ids:
        return []
    return await db[MongoCollections.users].find({"user_id": {"$in": student_ids}}).to_list(length=None)


async def class_instructor_id(db: AsyncIOMotorDatabase, class_doc: dict, instructors: list[dict], class_index: int) -> str | None:
    instructor_ids = [value for value in class_doc.get("instructor_ids", []) if value]
    if instructor_ids:
        return instructor_ids[0]
    if class_doc.get("instructor_id"):
        return class_doc["instructor_id"]

    membership = await db[MongoCollections.class_memberships].find_one(
        {"class_id": class_doc["class_id"], "role": "instructor", "status": "active"}
    )
    if membership and membership.get("user_id"):
        return membership["user_id"]

    if not instructors:
        return class_doc.get("created_by")

    instructor_id = instructors[class_index % len(instructors)]["user_id"]
    now = utc_now()
    await db[MongoCollections.class_memberships].update_one(
        {"class_id": class_doc["class_id"], "user_id": instructor_id, "role": "instructor"},
        {
            "$set": {
                "status": "active",
                "role_in_class": "instructor",
                "source": SEED_SOURCE,
                "seed_source": SEED_SOURCE,
                "demo": True,
                "institution_id": DEMO_INSTITUTION_ID,
                "updated_at": now,
            },
            "$setOnInsert": {
                "membership_id": new_id("membership"),
                "class_id": class_doc["class_id"],
                "user_id": instructor_id,
                "role": "instructor",
                "created_at": now,
            },
        },
        upsert=True,
    )
    await db[MongoCollections.classes].update_one(
        {"class_id": class_doc["class_id"]},
        {"$addToSet": {"instructor_ids": instructor_id}},
    )
    return instructor_id


async def ensure_students(
    db: AsyncIOMotorDatabase,
    class_doc: dict,
    all_students: list[dict],
    class_index: int,
) -> list[dict]:
    current = await class_students(db, class_doc["class_id"])
    if len(current) >= min(MIN_STUDENTS_PER_CLASS, len(all_students)):
        return current

    needed = max(0, min(MIN_STUDENTS_PER_CLASS, len(all_students)) - len(current))
    current_ids = {row.get("user_id") for row in current}
    candidates = [row for row in choose_existing_students(all_students, class_index, len(all_students)) if row.get("user_id") not in current_ids]
    now = utc_now()
    for student in candidates[:needed]:
        await db[MongoCollections.class_memberships].update_one(
            {"class_id": class_doc["class_id"], "user_id": student["user_id"], "role": "student"},
            {
                "$set": {
                    "status": "active",
                    "role_in_class": "student",
                    "source": SEED_SOURCE,
                    "seed_source": SEED_SOURCE,
                    "demo": True,
                    "institution_id": DEMO_INSTITUTION_ID,
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "membership_id": new_id("membership"),
                    "class_id": class_doc["class_id"],
                    "user_id": student["user_id"],
                    "role": "student",
                    "created_at": now,
                },
            },
            upsert=True,
        )
    return await class_students(db, class_doc["class_id"])


async def ensure_demo_base_data(db: AsyncIOMotorDatabase) -> None:
    now = utc_now()
    password_hash = hash_password("demo-password")

    instructor_docs = []
    for index in range(1, 4):
        instructor_docs.append(
            {
                "user_id": f"demo_instructor_{index:02d}",
                "name": f"Demo Instructor {index}",
                "full_name": f"Demo Instructor {index}",
                "email": f"demo.instructor{index}@example.com",
                "password_hash": password_hash,
                "account_role": "instructor",
                "global_role": "instructor",
                "is_active": True,
                "created_by_sync": False,
                "sync_source": SEED_SOURCE,
                "created_at": now,
                "demo_seeded_at": now,
                "seed_source": SEED_SOURCE,
                "demo": True,
                "institution_id": DEMO_INSTITUTION_ID,
            }
        )

    student_docs = []
    for index in range(1, 19):
        student_docs.append(
            {
                "user_id": f"demo_student_{index:02d}",
                "name": f"Demo Student {index}",
                "full_name": f"Demo Student {index}",
                "email": f"demo.student{index}@example.com",
                "password_hash": password_hash,
                "account_role": "student",
                "global_role": "student",
                "is_active": True,
                "created_by_sync": False,
                "sync_source": SEED_SOURCE,
                "created_at": now,
                "demo_seeded_at": now,
                "seed_source": SEED_SOURCE,
                "demo": True,
                "institution_id": DEMO_INSTITUTION_ID,
            }
        )

    for user in [*instructor_docs, *student_docs]:
        await db[MongoCollections.users].update_one(
            {"user_id": user["user_id"]},
            {"$set": user},
            upsert=True,
        )

    for index, class_name in enumerate(DEMO_CLASS_NAMES):
        instructor = instructor_docs[index % len(instructor_docs)]
        profile = profile_for_class(class_name, index)
        metadata = demo_metadata(class_index=index, profile=profile, instructor=instructor, students=[])
        class_id = f"demo_class_{index + 1:02d}"
        await db[MongoCollections.classes].update_one(
            {"class_id": class_id},
            {
                "$set": {
                    "class_id": class_id,
                    "name": class_name,
                    "class_name": class_name,
                    "created_by": instructor["user_id"],
                    "instructor_id": instructor["user_id"],
                    "instructor_ids": [instructor["user_id"]],
                    "section": f"D{index + 1}",
                    "year": "2026",
                    "institution_class_id": f"{DEMO_INSTITUTION_ID}_{demo_course_code(index)}",
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                    "demo_seeded": True,
                    "demo_seed_profile": profile.name,
                    "demo_seeded_at": now,
                    **metadata,
                }
            },
            upsert=True,
        )


async def clear_previous_demo_seed(db: AsyncIOMotorDatabase, class_id: str) -> dict[str, int]:
    demo_sessions = await db[MongoCollections.sessions].find(
        {"class_id": class_id, "seed_source": SEED_SOURCE},
        {"session_id": 1},
    ).to_list(length=None)
    session_ids = [row["session_id"] for row in demo_sessions if row.get("session_id")]
    counts: dict[str, int] = {}

    if session_ids:
        counts["responses"] = (await db[MongoCollections.responses].delete_many({"session_id": {"$in": session_ids}, "seed_source": SEED_SOURCE})).deleted_count
        counts["participation_records"] = (await db[MongoCollections.participation_records].delete_many({"session_id": {"$in": session_ids}, "seed_source": SEED_SOURCE})).deleted_count
    else:
        counts["responses"] = 0
        counts["participation_records"] = 0

    counts["sessions"] = (await db[MongoCollections.sessions].delete_many({"class_id": class_id, "seed_source": SEED_SOURCE})).deleted_count
    counts["generated_questions"] = (await db[MongoCollections.generated_questions].delete_many({"class_id": class_id, "seed_source": SEED_SOURCE})).deleted_count
    counts["approved_questions"] = (await db[MongoCollections.approved_questions].delete_many({"class_id": class_id, "seed_source": SEED_SOURCE})).deleted_count
    return counts


def bloom_sequence(profile: ClassProfile) -> list[str]:
    focus = [level for level in profile.bloom_focus if level in BLOOM_LEVELS]
    support = [level for level in BLOOM_LEVELS if level not in focus]
    sequence = [*focus, *focus[:2], *support]
    while len(sequence) < SESSION_COUNT:
        sequence.extend(focus or BLOOM_LEVELS)
    return sequence[: max(SESSION_COUNT, len(focus))]


def question_docs(class_id: str, metadata: dict[str, Any], profile: ClassProfile) -> tuple[list[dict], list[dict]]:
    now = utc_now()
    slug = stable_slug(class_id)
    generated = []
    approved = []
    for index, bloom_level in enumerate(bloom_sequence(profile)):
        question_type = "short_answer" if index % 2 else "mcq"
        question_id = f"demo_q_{slug}_{index + 1}"
        base = {
            "question_id": question_id,
            "class_id": class_id,
            "lecture_file_id": None,
            "upload_id": None,
            "type": question_type,
            "question_text": f"Demo {bloom_level} assessment item {index + 1}",
            "options": ["A", "B", "C", "D"] if question_type == "mcq" else [],
            "correct_answer": "A" if question_type == "mcq" else f"{bloom_level.lower()} explanation",
            "correct_answer_placeholder": "A" if question_type == "mcq" else f"{bloom_level.lower()} explanation",
            "explanation": f"Seeded demo question targeting the {bloom_level} Bloom level for a {profile.name.lower()}.",
            "bloom_level": bloom_level,
            "difficulty": ["easy", "medium", "hard"][index % 3],
            "source_slide": index + 1,
            "status": "approved",
            "created_at": now,
            "updated_at": now,
            **metadata,
        }
        generated.append(dict(base))
        approved.append(dict(base))
    return generated, approved


def session_docs(class_id: str, instructor_id: str | None, question_ids: list[str], class_index: int, metadata: dict[str, Any]) -> list[dict]:
    now = utc_now()
    slug = stable_slug(class_id)
    docs = []
    for index in range(SESSION_COUNT):
        created_at = now - timedelta(days=(SESSION_COUNT - index - 1) * 2)
        selected_question_ids = [
            question_ids[(index + offset) % len(question_ids)]
            for offset in range(QUESTIONS_PER_SESSION)
        ]
        session_id = f"demo_session_{slug}_{index + 1}"
        docs.append(
            {
                "session_id": session_id,
                "class_id": class_id,
                "instructor_id": instructor_id,
                "question_ids": selected_question_ids,
                "active_question_id": None,
                "session_code": f"D{class_index:02d}{index:02d}"[-6:].upper(),
                "join_link": f"http://localhost:5173/join/D{class_index:02d}{index:02d}",
                "qr_code_base64": "",
                "status": "finished",
                "scheduled_for": created_at,
                "question_started_at": created_at + timedelta(minutes=3),
                "question_duration_seconds": 90,
                "question_ends_at": created_at + timedelta(minutes=25),
                "revealed_question_ids": selected_question_ids,
                "created_at": created_at,
                "updated_at": created_at + timedelta(minutes=30),
                **metadata,
            }
        )
    return docs


def student_persona(profile: ClassProfile, student_index: int) -> StudentPersona:
    persona_name = profile.persona_mix[student_index % len(profile.persona_mix)]
    return STUDENT_PERSONAS[persona_name]


def session_progress(session_index: int, total_sessions: int) -> float:
    if total_sessions <= 1:
        return 0.5
    return session_index / (total_sessions - 1)


def evolving_metric(
    base: float,
    delta: float,
    trend: float,
    progress: float,
    rng: random.Random,
    volatility: float,
    low: float = 0.02,
    high: float = 0.99,
) -> float:
    trend_effect = trend * (progress - 0.5)
    return clamp(base + delta + trend_effect + rng.gauss(0, volatility), low, high)


def bloom_penalty(profile: ClassProfile, bloom_level: str) -> float:
    if bloom_level not in profile.weak_levels:
        return 0.0
    if profile.archetype in {"excellent", "healthy"}:
        return 0.06
    if profile.archetype == "average":
        return 0.1
    if profile.archetype == "mixed":
        return 0.14
    return 0.18


def response_quality(
    profile: ClassProfile,
    persona: StudentPersona,
    bloom_level: str,
    progress: float,
    rng: random.Random,
) -> float:
    quality = evolving_metric(
        profile.correctness,
        persona.correctness_delta,
        profile.trend + persona.trend,
        progress,
        rng,
        persona.volatility,
        0.04,
        0.99,
    )
    return clamp(quality - bloom_penalty(profile, bloom_level), 0.04, 0.99)


def semantic_quality(
    profile: ClassProfile,
    persona: StudentPersona,
    bloom_level: str,
    progress: float,
    rng: random.Random,
) -> float:
    semantic = evolving_metric(
        profile.semantic_quality,
        persona.semantic_delta,
        profile.trend + persona.trend,
        progress,
        rng,
        persona.volatility,
        0.04,
        0.99,
    )
    return clamp(semantic - (bloom_penalty(profile, bloom_level) * 0.9), 0.04, 0.99)


def response_time_seconds(profile: ClassProfile, persona: StudentPersona, quality: float, rng: random.Random) -> float:
    seconds = profile.response_time + persona.response_time_delta + ((1 - quality) * 18) + rng.gauss(0, 6)
    return round(max(12.0, min(140.0, seconds)), 2)


def semantic_payload(score: float, submitted_at) -> dict[str, Any]:
    label = "correct" if score >= 0.7 else "partial" if score >= 0.45 else "incorrect"
    return {
        "semantic_score": round(score, 4),
        "semantic_label": label,
        "semantic_engine": "demo_seed",
        "semantic_similarity": round(clamp(score + 0.03), 4),
        "concept_coverage": round(clamp(score - 0.02), 4),
        "final_score": round(score, 4),
        "aiEvaluation": {
            "semanticSimilarity": round(clamp(score + 0.03), 4),
            "conceptCoverage": round(clamp(score - 0.02), 4),
            "finalScore": round(score, 4),
            "label": label,
            "engine": "demo_seed",
            "weights": {"semantic_similarity": 0.6, "concept_coverage": 0.4},
            "evaluatedAt": submitted_at,
        },
        "instructorReview": {
            "reviewed": False,
            "finalScore": None,
            "finalLabel": None,
            "feedback": "",
            "showToStudent": False,
            "reviewedBy": None,
            "reviewedAt": None,
        },
    }


def participation_and_responses(
    class_id: str,
    students: list[dict],
    sessions: list[dict],
    questions_by_id: dict[str, dict],
    profile: ClassProfile,
    rng: random.Random,
    metadata: dict[str, Any],
) -> tuple[list[dict], list[dict]]:
    participation = []
    responses = []
    for session_index, session in enumerate(sessions):
        progress = session_progress(session_index, len(sessions))
        for student_index, student in enumerate(students):
            persona = student_persona(profile, student_index)
            attendance_probability = evolving_metric(
                profile.attendance,
                persona.attendance_delta,
                profile.trend + persona.trend + ((profile.recent_boost - 1.0) * 0.12),
                progress,
                rng,
                persona.volatility,
            )
            attended = rng.random() < attendance_probability
            if not attended:
                continue

            joined_at = session["created_at"] + timedelta(minutes=2 + rng.randint(0, 6))
            last_seen_at = joined_at + timedelta(minutes=18 + rng.randint(0, 12))
            participation.append(
                {
                    "participation_id": new_id("participation"),
                    "class_id": class_id,
                    "session_id": session["session_id"],
                    "student_id": student["user_id"],
                    "joined_at": joined_at,
                    "last_seen_at": last_seen_at,
                    "student": user_summary(student),
                    "demo_student_persona": persona.name,
                    **metadata,
                }
            )

            answer_probability = evolving_metric(
                profile.participation,
                persona.participation_delta,
                profile.trend + persona.trend,
                progress,
                rng,
                persona.volatility,
            )
            for question_offset, question_id in enumerate(session["question_ids"]):
                if rng.random() > answer_probability:
                    continue

                question = questions_by_id[question_id]
                bloom_level = question.get("bloom_level") or "Apply"
                quality = response_quality(profile, persona, bloom_level, progress, rng)
                is_correct = rng.random() < quality
                response_time = response_time_seconds(profile, persona, quality, rng)
                submitted_at = joined_at + timedelta(minutes=question_offset * 4 + 1, seconds=response_time)
                score = semantic_quality(profile, persona, bloom_level, progress, rng)
                if is_correct:
                    score = max(score, clamp(0.68 + (quality * 0.24) + rng.gauss(0, 0.03), 0.68, 0.98))
                else:
                    score = min(score, clamp(0.28 + (quality * 0.45) + rng.gauss(0, 0.06), 0.08, 0.68))

                response = {
                    "response_id": new_id("response"),
                    "session_id": session["session_id"],
                    "question_id": question_id,
                    "student_id": student["user_id"],
                    "answer": question["correct_answer"] if is_correct else "Needs reinforcement",
                    "is_correct": bool(is_correct),
                    "stars_earned": 1 if is_correct else 0,
                    "revealed_after_submission": True,
                    "correctness_placeholder": "correct" if is_correct else "incorrect",
                    "response_time_placeholder": response_time,
                    "response_time_seconds": response_time,
                    "submitted_at": submitted_at,
                    "student": user_summary(student),
                    "demo_student_persona": persona.name,
                    **metadata,
                }
                response.update(semantic_payload(score, submitted_at))
                responses.append(response)
    return participation, responses


async def seed_class(
    db: AsyncIOMotorDatabase,
    class_doc: dict,
    class_index: int,
    all_students: list[dict],
    instructors: list[dict],
) -> dict[str, Any]:
    class_id = class_doc["class_id"]
    profile = profile_for_class(class_doc, class_index)
    rng = random.Random(f"{SEED_SOURCE}:{class_id}:{profile.name}")

    removed = await clear_previous_demo_seed(db, class_id)
    students = await ensure_students(db, class_doc, all_students, class_index)
    instructor_id = await class_instructor_id(db, class_doc, instructors, class_index)
    instructor = await db[MongoCollections.users].find_one({"user_id": instructor_id}) if instructor_id else None

    if not students:
        return {"class_id": class_id, "class_name": class_doc.get("name"), "profile": profile.name, "skipped": "No existing student users available", "removed": removed}
    if not instructor_id:
        return {"class_id": class_id, "class_name": class_doc.get("name"), "profile": profile.name, "skipped": "No existing instructor or class creator available", "removed": removed}

    metadata = demo_metadata(class_index=class_index, profile=profile, instructor=instructor, students=students)
    participant_ids = [user_id for user_id in [instructor_id, *[student.get("user_id") for student in students]] if user_id]
    if participant_ids:
        await db[MongoCollections.users].update_many(
            {"user_id": {"$in": participant_ids}},
            {
                "$set": {
                    "demo": True,
                    "seed_source": SEED_SOURCE,
                    "institution_id": DEMO_INSTITUTION_ID,
                    "demo_seeded_at": utc_now(),
                }
            },
        )

    generated_questions, approved_questions = question_docs(class_id, metadata, profile)
    question_ids = [row["question_id"] for row in approved_questions]
    sessions = session_docs(class_id, instructor_id, question_ids, class_index, metadata)
    questions_by_id = {row["question_id"]: row for row in approved_questions}
    participation, responses = participation_and_responses(class_id, students, sessions, questions_by_id, profile, rng, metadata)

    await db[MongoCollections.generated_questions].insert_many(generated_questions)
    await db[MongoCollections.approved_questions].insert_many(approved_questions)
    await db[MongoCollections.sessions].insert_many(sessions)
    if participation:
        await db[MongoCollections.participation_records].insert_many(participation)
    if responses:
        await db[MongoCollections.responses].insert_many(responses)

    analytics_summary = await recalculate_class_analytics(db, class_id)
    pipeline_metadata = metadata | {"demo_seeded_at": utc_now()}
    for collection_name in (
        MongoCollections.analytics_results,
        MongoCollections.prediction_features,
        MongoCollections.prediction_results,
        MongoCollections.weak_concept_predictions,
    ):
        await db[collection_name].update_many({"class_id": class_id}, {"$set": pipeline_metadata})
    prediction_count = await db[MongoCollections.prediction_results].count_documents({"class_id": class_id})
    weak_count = await db[MongoCollections.weak_concept_predictions].count_documents({"class_id": class_id})

    await db[MongoCollections.classes].update_one(
        {"class_id": class_id},
        {
            "$set": {
                **metadata,
                "demo_seeded": True,
                "demo_seed_profile": profile.name,
                "demo_seeded_at": utc_now(),
                "institution_class_id": f"{DEMO_INSTITUTION_ID}_{demo_course_code(class_index)}",
            }
        },
    )

    return {
        "class_id": class_id,
        "class_name": class_doc.get("name") or class_doc.get("class_name") or class_id,
        "profile": profile.name,
        "students": len(students),
        "sessions": len(sessions),
        "responses": len(responses),
        "participation_records": len(participation),
        "analytics_docs": analytics_summary.get("calculated_count", 0),
        "prediction_results": prediction_count,
        "weak_cognitive_skill_rows": weak_count,
        "removed": removed,
    }


async def seed_demo_learning_activity() -> list[dict[str, Any]]:
    if not allowed_to_run():
        raise RuntimeError("Refusing to seed demo data. Set ENV=development or DEMO_SEED=true.")

    globals().update(load_app_dependencies())
    settings = get_settings()
    client = AsyncIOMotorClient(settings.mongodb_uri)
    try:
        await client.admin.command("ping")
        db = client[settings.mongodb_db]
        await ensure_indexes(db)

        classes = await db[MongoCollections.classes].find({}).sort("created_at", 1).to_list(length=None)
        users = await db[MongoCollections.users].find({}).to_list(length=None)
        students = [row for row in users if account_role(row) == "student"]
        instructors = [row for row in users if account_role(row) == "instructor"]

        if not classes or not students or not instructors:
            await ensure_demo_base_data(db)
            classes = await db[MongoCollections.classes].find({}).sort("created_at", 1).to_list(length=None)
            users = await db[MongoCollections.users].find({}).to_list(length=None)
            students = [row for row in users if account_role(row) == "student"]
            instructors = [row for row in users if account_role(row) == "instructor"]

        if not classes:
            raise RuntimeError("No classes found. Create classes before running the demo activity seeder.")
        if not students:
            raise RuntimeError("No student users found. Seed or create students before running the demo activity seeder.")

        summaries = []
        for index, class_doc in enumerate(classes):
            if not class_doc.get("class_id"):
                continue
            summaries.append(await seed_class(db, class_doc, index, students, instructors))
        trend_distribution = await prepare_demo_prediction_trends(db)
        for summary in summaries:
            summary["prediction_trend_demo_distribution"] = trend_distribution
        return summaries
    finally:
        client.close()


def print_summary(summaries: list[dict[str, Any]]) -> None:
    print(f"Seeded demo learning activity for {len(summaries)} classes.")
    trend_distribution = next((row.get("prediction_trend_demo_distribution") for row in summaries if row.get("prediction_trend_demo_distribution")), None)
    for row in summaries:
        class_name = row.get("class_name") or row.get("class_id")
        if row.get("skipped"):
            print(f"- {class_name}: skipped ({row['skipped']})")
            continue
        print(
            "- {class_name}: {profile}, {students} students, {sessions} sessions, "
            "{responses} responses, {analytics_docs} analytics docs, "
            "{prediction_results} predictions, {weak_cognitive_skill_rows} Bloom rows".format(**row)
        )
    if trend_distribution:
        print(
            "- Demo prediction trends: "
            + ", ".join(f"{state}={count}" for state, count in trend_distribution.items())
        )


async def main() -> None:
    try:
        summaries = await seed_demo_learning_activity()
    except RuntimeError as exc:
        print(str(exc))
        sys.exit(1)
    print_summary(summaries)


if __name__ == "__main__":
    asyncio.run(main())
