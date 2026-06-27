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
from dataclasses import dataclass
from datetime import timedelta
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
MIN_STUDENTS_PER_CLASS = 6

BLOOM_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"]
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
    attendance: float
    participation: float
    correctness: float
    semantic_quality: float
    recent_boost: float
    weak_levels: tuple[str, ...]


CLASS_PROFILES = [
    ClassProfile("Healthy class", 0.94, 0.88, 0.84, 0.86, 1.0, ("Create",)),
    ClassProfile("Attention class", 0.74, 0.68, 0.58, 0.62, 0.75, ("Apply", "Analyze")),
    ClassProfile("Critical/low activity class", 0.42, 0.38, 0.34, 0.38, 0.35, ("Understand", "Apply", "Analyze")),
    ClassProfile("Mixed class", 0.72, 0.64, 0.63, 0.66, 0.7, ("Apply", "Evaluate")),
    ClassProfile("High attendance but low correctness", 0.93, 0.82, 0.39, 0.44, 0.8, ("Analyze", "Evaluate")),
    ClassProfile("Low attendance but high correctness", 0.46, 0.76, 0.82, 0.84, 0.45, ("Remember",)),
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


def demo_description(profile: ClassProfile) -> str:
    return f"Development demo dataset profile: {profile.name}."


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
        profile = CLASS_PROFILES[index % len(CLASS_PROFILES)]
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


def question_docs(class_id: str, metadata: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    now = utc_now()
    slug = stable_slug(class_id)
    generated = []
    approved = []
    for index, bloom_level in enumerate(BLOOM_LEVELS):
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
            "explanation": f"Seeded demo question targeting the {bloom_level} Bloom level.",
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
        created_at = now - timedelta(days=(SESSION_COUNT - index) * 4)
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


def student_multiplier(student_index: int, spread: float = 0.12) -> float:
    offsets = [-spread, -spread / 2, 0, spread / 2, spread, 0.04, -0.08]
    return offsets[student_index % len(offsets)]


def response_quality(profile: ClassProfile, bloom_level: str, student_index: int) -> float:
    base = profile.correctness + student_multiplier(student_index, 0.16)
    if bloom_level in profile.weak_levels:
        base -= 0.22
    if profile.name == "Mixed class" and student_index % 3 == 0:
        base -= 0.18
    return clamp(base, 0.05, 0.98)


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
        session_age_rank = session_index / max(len(sessions) - 1, 1)
        recent_factor = 0.75 + (profile.recent_boost * 0.25 * session_age_rank)
        for student_index, student in enumerate(students):
            attendance_probability = clamp(profile.attendance + student_multiplier(student_index) - (0.08 if session_index < 2 else 0))
            attended = rng.random() < attendance_probability * recent_factor
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
                    **metadata,
                }
            )

            answer_probability = clamp(profile.participation + student_multiplier(student_index, 0.14))
            for question_offset, question_id in enumerate(session["question_ids"]):
                if rng.random() > answer_probability:
                    continue

                question = questions_by_id[question_id]
                bloom_level = question.get("bloom_level") or "Apply"
                quality = response_quality(profile, bloom_level, student_index)
                is_correct = rng.random() < quality
                submitted_at = joined_at + timedelta(minutes=question_offset * 4 + rng.randint(1, 4))
                response_time = max(8, 22 + rng.randint(-6, 18) + int((1 - quality) * 18))
                score = clamp(profile.semantic_quality + student_multiplier(student_index, 0.12) - (0.2 if bloom_level in profile.weak_levels else 0.0))
                if is_correct:
                    score = max(score, 0.72 + rng.random() * 0.22)
                else:
                    score = min(score, 0.58)

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
    profile = CLASS_PROFILES[class_index % len(CLASS_PROFILES)]
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

    generated_questions, approved_questions = question_docs(class_id, metadata)
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
        return summaries
    finally:
        client.close()


def print_summary(summaries: list[dict[str, Any]]) -> None:
    print(f"Seeded demo learning activity for {len(summaries)} classes.")
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


async def main() -> None:
    try:
        summaries = await seed_demo_learning_activity()
    except RuntimeError as exc:
        print(str(exc))
        sys.exit(1)
    print_summary(summaries)


if __name__ == "__main__":
    asyncio.run(main())
