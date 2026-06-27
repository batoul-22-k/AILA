import asyncio
import argparse
from datetime import UTC, datetime

from app.config import get_settings
from app.database import MongoCollections


SYNC_SOURCE = "institution_database"

CLASSES = [
    {
        "institution_class_id": "CS201-A-2026",
        "course_code": "CS201",
        "name": "Data Structures",
        "section": "A",
        "year": "2026",
        "department": "Computer Science",
        "semester": "Spring 2026",
    },
    {
        "institution_class_id": "DS110-B-2026",
        "course_code": "DS110",
        "name": "Introduction to Data Science",
        "section": "B",
        "year": "2026",
        "department": "Data Science",
        "semester": "Spring 2026",
    },
    {
        "institution_class_id": "MATH101-A-2026",
        "course_code": "MATH101",
        "name": "Calculus I",
        "section": "A",
        "year": "2026",
        "department": "Mathematics",
        "semester": "Spring 2026",
    },
    {
        "institution_class_id": "ENG220-C-2026",
        "course_code": "ENG220",
        "name": "Academic Communication",
        "section": "C",
        "year": "2026",
        "department": "English Studies",
        "semester": "Spring 2026",
    },
    {
        "institution_class_id": "BUS150-D-2026",
        "course_code": "BUS150",
        "name": "Business Analytics",
        "section": "D",
        "year": "2026",
        "department": "Business",
        "semester": "Spring 2026",
    },
]

INSTRUCTORS = [
    ("Dr. Lina Saad", "lina.saad", "INS-210", "Mathematics", [2]),
    ("Dr. Karim Mansour", "karim.mansour", "INS-211", "Computer Science", [0]),
    ("Prof. Nadine Farah", "nadine.farah", "INS-212", "Data Science", [1]),
    ("Dr. Elias Haddad", "elias.haddad", "INS-213", "English Studies", [3]),
    ("Prof. Sara Khoury", "sara.khoury", "INS-214", "Business", [4]),
]

ADMINS = [
    ("Rami Khoury", "rami.khoury", "ADM-014", "Academic Affairs"),
    ("Mira Aoun", "mira.aoun", "ADM-015", "Registrar Office"),
]

STUDENTS = [
    ("Maya Haddad", "maya.haddad", "STU-1001", "Computer Science", "A", "2026", "Morning", [0, 2]),
    ("Omar Nasser", "omar.nasser", "STU-1002", "Data Science", "B", "2026", "Morning", [1, 2]),
    ("Lea Khoury", "lea.khoury", "STU-1003", "Computer Science", "A", "2026", "Morning", [0]),
    ("Tarek Mansour", "tarek.mansour", "STU-1004", "Business", "D", "2026", "Evening", [4, 1]),
    ("Nour Farah", "nour.farah", "STU-1005", "English Studies", "C", "2026", "Morning", [3]),
    ("Adam Saad", "adam.saad", "STU-1006", "Mathematics", "A", "2026", "Morning", [2]),
    ("Yara Aoun", "yara.aoun", "STU-1007", "Data Science", "B", "2026", "Evening", [1, 0]),
    ("Jad Karam", "jad.karam", "STU-1008", "Computer Science", "A", "2026", "Morning", [0, 1]),
    ("Hana Zein", "hana.zein", "STU-1009", "Business", "D", "2026", "Evening", [4]),
    ("Rayan Daher", "rayan.daher", "STU-1010", "Mathematics", "A", "2026", "Morning", [2, 0]),
    ("Lara Salem", "lara.salem", "STU-1011", "Data Science", "B", "2026", "Morning", [1]),
    ("Samir Haddad", "samir.haddad", "STU-1012", "English Studies", "C", "2026", "Evening", [3, 4]),
    ("Mariam Youssef", "mariam.youssef", "STU-1013", "Computer Science", "A", "2026", "Morning", [0]),
    ("Khaled Nader", "khaled.nader", "STU-1014", "Business", "D", "2026", "Evening", [4, 2]),
    ("Dina Barakat", "dina.barakat", "STU-1015", "Mathematics", "A", "2026", "Morning", [2]),
    ("Fadi Rahal", "fadi.rahal", "STU-1016", "Data Science", "B", "2026", "Morning", [1, 4]),
    ("Sofia Nassar", "sofia.nassar", "STU-1017", "English Studies", "C", "2026", "Morning", [3]),
    ("Ali Hammoud", "ali.hammoud", "STU-1018", "Computer Science", "A", "2026", "Evening", [0, 2]),
    ("Celine Abi Farah", "celine.abifarah", "STU-1019", "Business", "D", "2026", "Evening", [4]),
    ("Ziad Chahine", "ziad.chahine", "STU-1020", "Mathematics", "A", "2026", "Morning", [2, 1]),
    ("Reem Hallal", "reem.hallal", "STU-1021", "Data Science", "B", "2026", "Morning", [1]),
    ("Joe Ibrahim", "joe.ibrahim", "STU-1022", "English Studies", "C", "2026", "Evening", [3]),
    ("Salma Kassem", "salma.kassem", "STU-1023", "Computer Science", "A", "2026", "Morning", [0, 3]),
    ("Bassel Mourad", "bassel.mourad", "STU-1024", "Business", "D", "2026", "Evening", [4]),
    ("Aya Fakhry", "aya.fakhry", "STU-1025", "Mathematics", "A", "2026", "Morning", [2]),
    ("Marc Habib", "marc.habib", "STU-1026", "Data Science", "B", "2026", "Evening", [1, 0]),
    ("Rita Sfeir", "rita.sfeir", "STU-1027", "English Studies", "C", "2026", "Morning", [3, 2]),
    ("Hadi Ghosn", "hadi.ghosn", "STU-1028", "Computer Science", "A", "2026", "Morning", [0]),
    ("Elena Nasr", "elena.nasr", "STU-1029", "Business", "D", "2026", "Evening", [4, 1]),
    ("Walid Tannous", "walid.tannous", "STU-1030", "Mathematics", "A", "2026", "Morning", [2]),
]


def class_copy(index: int) -> dict:
    return dict(CLASSES[index])


def email(username: str) -> str:
    return f"{username}@institution.edu"


def now() -> datetime:
    return datetime.now(UTC)


def build_student(row: tuple) -> dict:
    full_name, username, institution_id, department, section, year, group, class_indexes = row
    return {
        "full_name": full_name,
        "email": email(username),
        "role": "student",
        "institution_id": institution_id,
        "department": department,
        "section": section,
        "year": year,
        "group": group,
        "enrolled_classes": [class_copy(index) for index in class_indexes],
        "sync_source": SYNC_SOURCE,
        "seeded_at": now(),
    }


def build_instructor(row: tuple) -> dict:
    full_name, username, institution_id, department, class_indexes = row
    return {
        "full_name": full_name,
        "email": email(username),
        "role": "instructor",
        "institution_id": institution_id,
        "department": department,
        "assigned_classes": [class_copy(index) for index in class_indexes],
        "sync_source": SYNC_SOURCE,
        "seeded_at": now(),
    }


def build_admin(row: tuple) -> dict:
    full_name, username, institution_id, department = row
    return {
        "full_name": full_name,
        "email": email(username),
        "role": "admin",
        "institution_id": institution_id,
        "department": department,
        "sync_source": SYNC_SOURCE,
        "seeded_at": now(),
    }


def build_seed_documents() -> list[dict]:
    return (
        [build_student(row) for row in STUDENTS]
        + [build_instructor(row) for row in INSTRUCTORS]
        + [build_admin(row) for row in ADMINS]
    )


def seed_summary(documents: list[dict]) -> dict[str, int]:
    class_ids = {
        class_doc["institution_class_id"]
        for document in documents
        for class_doc in document.get("enrolled_classes", []) + document.get("assigned_classes", [])
    }
    return {
        "total": len(documents),
        "students": sum(document["role"] == "student" for document in documents),
        "instructors": sum(document["role"] == "instructor" for document in documents),
        "admins": sum(document["role"] == "admin" for document in documents),
        "classes": len(class_ids),
    }


async def seed_institution_users() -> None:
    from motor.motor_asyncio import AsyncIOMotorClient

    settings = get_settings()
    client = AsyncIOMotorClient(settings.mongodb_uri)
    try:
        db = client[settings.mongodb_db]
        collection = db[MongoCollections.institution_users]
        await collection.create_index("institution_id", unique=True, name="unique_institution_user_id")

        inserted = 0
        skipped = 0
        for document in build_seed_documents():
            existing = await collection.find_one(
                {
                    "$or": [
                        {"institution_id": document["institution_id"]},
                        {"email": document["email"]},
                    ]
                },
                {"_id": 1},
            )
            if existing:
                skipped += 1
                continue
            await collection.insert_one(document)
            inserted += 1

        print(f"Seeded {MongoCollections.institution_users}: {inserted} inserted, {skipped} skipped.")
        print("Demo source includes 30 students, 5 instructors, 2 admins, and 5 classes.")
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed institution users for account/class sync demos.")
    parser.add_argument("--dry-run", action="store_true", help="Print seed counts without writing to MongoDB.")
    args = parser.parse_args()

    if args.dry_run:
        summary = seed_summary(build_seed_documents())
        print(
            "Seed payload: "
            f"{summary['total']} users, "
            f"{summary['students']} students, "
            f"{summary['instructors']} instructors, "
            f"{summary['admins']} admins, "
            f"{summary['classes']} classes."
        )
    else:
        asyncio.run(seed_institution_users())
