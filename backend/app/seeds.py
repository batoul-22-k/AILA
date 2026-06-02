from app.database import MongoCollections
from app.models import utc_now


DEMO_USERS = [
    {
        "user_id": "student_001",
        "name": "Maya Student",
        "email": "student@example.com",
        "password_hash_placeholder": "demo-password",
        "global_role": "user",
    },
    {
        "user_id": "instructor_001",
        "name": "Dr. Instructor",
        "email": "instructor@example.com",
        "password_hash_placeholder": "demo-password",
        "global_role": "user",
    },
    {
        "user_id": "admin_001",
        "name": "Admin Office",
        "email": "admin@example.com",
        "password_hash_placeholder": "demo-password",
        "global_role": "admin",
    },
    {
        "user_id": "batoul_001",
        "name": "Batoul",
        "email": "batoul@example.com",
        "password_hash_placeholder": "demo-password",
        "global_role": "user",
    },
]

DEMO_CLASSES = [
    {
        "class_id": "class_demo",
        "name": "AI Fundamentals",
        "description": "Live engagement demo class",
        "semester": "Spring 2026",
        "created_by": "instructor_001",
        "instructor_ids": ["instructor_001", "batoul_001"],
    },
    {
        "class_id": "class_database",
        "name": "Database Systems",
        "description": "Question generation workspace demo",
        "semester": "Spring 2026",
        "created_by": "instructor_001",
        "instructor_ids": ["instructor_001", "batoul_001"],
    },
]

DEMO_MEMBERSHIPS = [
    {"membership_id": "membership_student_ai", "class_id": "class_demo", "user_id": "student_001", "role": "student", "status": "active"},
    {"membership_id": "membership_student_db", "class_id": "class_database", "user_id": "student_001", "role": "student", "status": "active"},
    {"membership_id": "membership_instructor_ai", "class_id": "class_demo", "user_id": "instructor_001", "role": "instructor", "status": "active"},
    {"membership_id": "membership_instructor_db", "class_id": "class_database", "user_id": "instructor_001", "role": "instructor", "status": "active"},
    {"membership_id": "membership_batoul_student", "class_id": "class_demo", "user_id": "batoul_001", "role": "student", "status": "active"},
    {"membership_id": "membership_batoul_instructor", "class_id": "class_database", "user_id": "batoul_001", "role": "instructor", "status": "active"},
]


async def seed_demo_auth_data(db) -> None:
    created_at = utc_now()

    for user in DEMO_USERS:
        await db[MongoCollections.users].update_one(
            {"user_id": user["user_id"]},
            {"$setOnInsert": user | {"created_at": created_at}},
            upsert=True,
        )

    for class_doc in DEMO_CLASSES:
        await db[MongoCollections.classes].update_one(
            {"class_id": class_doc["class_id"]},
            {"$setOnInsert": class_doc | {"created_at": created_at}},
            upsert=True,
        )

    for membership in DEMO_MEMBERSHIPS:
        await db[MongoCollections.class_memberships].update_one(
            {"membership_id": membership["membership_id"]},
            {"$setOnInsert": membership | {"created_at": created_at}},
            upsert=True,
        )
