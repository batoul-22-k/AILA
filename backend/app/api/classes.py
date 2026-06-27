from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import account_role_for_user, get_current_user, require_admin, require_class_role
from app.database import MongoCollections, get_db
from app.models import ClassCreate, ClassOut, ClassStatusUpdate, ClassStudentOut, EnrollStudentRequest, new_id, utc_now
from app.services import serialize_document

router = APIRouter(prefix="/classes", tags=["classes"])


def class_out_from_row(row: dict) -> ClassOut:
    clean = serialize_document(row)
    clean.setdefault("created_by", (clean.get("instructor_ids") or ["system"])[0])
    clean.setdefault("semester", None)
    clean.setdefault("instructor_ids", [])
    clean.setdefault("status", "active")
    if clean["status"] == "archived":
        clean["status"] = "inactive"
    return ClassOut(**clean)


async def upsert_instructor_memberships(db: AsyncIOMotorDatabase, class_id: str, instructor_ids: list[str]) -> None:
    now = utc_now()
    for instructor_id in instructor_ids:
        await db[MongoCollections.class_memberships].update_one(
            {"class_id": class_id, "user_id": instructor_id, "role": "instructor"},
            {
                "$set": {
                    "status": "active",
                    "role_in_class": "instructor",
                    "source": "admin",
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "membership_id": new_id("membership"),
                    "class_id": class_id,
                    "user_id": instructor_id,
                    "role": "instructor",
                    "created_at": now,
                },
            },
            upsert=True,
        )


@router.get("", response_model=list[ClassOut])
async def list_classes(
    include_archived: bool = False,
    include_inactive: bool = False,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[ClassOut]:
    show_inactive = include_inactive or include_archived
    status_filter = {} if show_inactive else {"$or": [{"status": "active"}, {"status": {"$exists": False}}]}
    if account_role_for_user(user) == "admin":
        rows = await db[MongoCollections.classes].find(status_filter).sort("created_at", -1).to_list(length=500)
    else:
        memberships = await db[MongoCollections.class_memberships].find(
            {"user_id": user["user_id"], "role": "instructor", "status": "active"},
            {"class_id": 1},
        ).to_list(length=500)
        class_ids = [membership["class_id"] for membership in memberships]
        query = {"class_id": {"$in": class_ids}} | status_filter
        rows = await db[MongoCollections.classes].find(query).sort("created_at", -1).to_list(length=500)
    return [class_out_from_row(row) for row in rows]


@router.post("", response_model=ClassOut)
async def create_class(
    payload: ClassCreate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ClassOut:
    await require_admin(db, user)
    requested_instructor_ids = payload.instructor_ids or ([payload.instructor_id] if payload.instructor_id else [])

    class_doc = ClassOut(
        class_id=new_id("class"),
        name=payload.name,
        description=payload.description,
        semester=payload.semester,
        course_code=payload.course_code,
        section=payload.section,
        department=payload.department,
        year=payload.year,
        institution_class_id=payload.institution_class_id,
        created_by=user["user_id"],
        instructor_ids=requested_instructor_ids,
        status="active",
        created_at=utc_now(),
    )
    await db[MongoCollections.classes].insert_one(class_doc.model_dump())
    await upsert_instructor_memberships(db, class_doc.class_id, requested_instructor_ids)
    return class_doc


@router.put("/{class_id}", response_model=ClassOut)
async def update_class(
    class_id: str,
    payload: ClassCreate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ClassOut:
    await require_admin(db, user)
    existing = await db[MongoCollections.classes].find_one({"class_id": class_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Class not found")

    update = {
        "name": payload.name,
        "description": payload.description,
        "semester": payload.semester,
        "course_code": payload.course_code,
        "section": payload.section,
        "department": payload.department,
        "year": payload.year,
        "institution_class_id": payload.institution_class_id,
        "updated_at": utc_now(),
    }
    requested_instructor_ids = payload.instructor_ids or ([payload.instructor_id] if payload.instructor_id else [])
    if requested_instructor_ids:
        update["instructor_ids"] = requested_instructor_ids
    await db[MongoCollections.classes].update_one({"class_id": class_id}, {"$set": update})
    if requested_instructor_ids:
        await upsert_instructor_memberships(db, class_id, requested_instructor_ids)
    refreshed = await db[MongoCollections.classes].find_one({"class_id": class_id})
    return class_out_from_row(refreshed)


@router.patch("/{class_id}/status", response_model=ClassOut)
async def update_class_status(
    class_id: str,
    payload: ClassStatusUpdate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ClassOut:
    await require_admin(db, user)
    existing = await db[MongoCollections.classes].find_one({"class_id": class_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Class not found")
    next_status = payload.status.lower()
    await db[MongoCollections.classes].update_one(
        {"class_id": class_id},
        {"$set": {"status": next_status, "updated_at": utc_now()}},
    )
    if next_status == "inactive":
        await db[MongoCollections.sessions].update_many(
            {"class_id": class_id, "status": "active"},
            {"$set": {"status": "closed", "updated_at": utc_now()}},
        )
    refreshed = await db[MongoCollections.classes].find_one({"class_id": class_id})
    return class_out_from_row(refreshed)


@router.delete("/{class_id}")
async def delete_class(
    class_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    existing = await db[MongoCollections.classes].find_one({"class_id": class_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Class not found")

    sessions = await db[MongoCollections.sessions].find({"class_id": class_id}, {"session_id": 1}).to_list(length=None)
    session_ids = [session["session_id"] for session in sessions]
    if session_ids:
        await db[MongoCollections.responses].delete_many({"session_id": {"$in": session_ids}})
        await db[MongoCollections.participation_records].delete_many({"session_id": {"$in": session_ids}})
    await db[MongoCollections.sessions].delete_many({"class_id": class_id})
    await db[MongoCollections.class_memberships].delete_many({"class_id": class_id})
    await db[MongoCollections.lecture_uploads].delete_many({"class_id": class_id})
    await db[MongoCollections.lecture_files].delete_many({"class_id": class_id})
    await db[MongoCollections.generated_questions].delete_many({"class_id": class_id})
    await db[MongoCollections.approved_questions].delete_many({"class_id": class_id})
    await db[MongoCollections.notifications].delete_many({"class_id": class_id})
    await db[MongoCollections.classes].delete_one({"class_id": class_id})
    return {"status": "deleted"}


@router.get("/{class_id}/students", response_model=list[ClassStudentOut])
async def list_class_students(
    class_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[ClassStudentOut]:
    await require_class_role(db, user, class_id, "instructor")
    memberships = await db[MongoCollections.class_memberships].find(
        {"class_id": class_id, "role": "student", "status": "active"}
    ).sort("created_at", -1).to_list(length=500)
    if not memberships:
        return []
    users = await db[MongoCollections.users].find(
        {"user_id": {"$in": [membership["user_id"] for membership in memberships]}}
    ).to_list(length=500)
    users_by_id = {row["user_id"]: serialize_document(row) for row in users}
    students = []
    for membership in memberships:
        user_doc = users_by_id.get(membership["user_id"])
        if not user_doc:
            continue
        students.append(
            ClassStudentOut(
                user_id=user_doc["user_id"],
                name=user_doc["name"],
                email=user_doc["email"],
                membership_id=membership["membership_id"],
                status=membership.get("status", "active"),
                joined_at=membership.get("created_at"),
            )
        )
    return students


@router.post("/{class_id}/students", response_model=ClassStudentOut)
async def enroll_class_student(
    class_id: str,
    payload: EnrollStudentRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ClassStudentOut:
    await require_admin(db, user)
    class_doc = await db[MongoCollections.classes].find_one({"class_id": class_id})
    if not class_doc:
        raise HTTPException(status_code=404, detail="Class not found")
    student = await db[MongoCollections.users].find_one({"user_id": payload.user_id})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    if account_role_for_user(student) == "admin" or account_role_for_user(student) == "instructor":
        raise HTTPException(status_code=400, detail="Only student users can be enrolled in a class")
    instructor_membership = await db[MongoCollections.class_memberships].find_one(
        {"user_id": payload.user_id, "role": "instructor", "status": "active"}
    )
    if instructor_membership:
        raise HTTPException(status_code=400, detail="Instructors cannot be enrolled as students")
    membership_id = new_id("membership")
    now = utc_now()
    await db[MongoCollections.class_memberships].update_one(
        {"class_id": class_id, "user_id": payload.user_id, "role": "student"},
        {
            "$set": {
                "status": "active",
                "role_in_class": "student",
                "source": "admin",
                "updated_at": now,
            },
            "$setOnInsert": {
                "membership_id": membership_id,
                "class_id": class_id,
                "user_id": payload.user_id,
                "role": "student",
                "created_at": now,
            },
        },
        upsert=True,
    )
    membership = await db[MongoCollections.class_memberships].find_one(
        {"class_id": class_id, "user_id": payload.user_id, "role": "student"}
    )
    await db[MongoCollections.notifications].insert_one(
        {
            "notification_id": new_id("notification"),
            "user_id": payload.user_id,
            "title": "You are enrolled",
            "description": f"You are now enrolled in {class_doc['name']}.",
            "tone": "success",
            "read": False,
            "created_at": now,
            "class_id": class_id,
        }
    )
    return ClassStudentOut(
        user_id=student["user_id"],
        name=student["name"],
        email=student["email"],
        membership_id=membership["membership_id"],
        status=membership.get("status", "active"),
        joined_at=membership.get("created_at"),
    )


@router.delete("/{class_id}/students/{student_id}")
async def remove_class_student(
    class_id: str,
    student_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    result = await db[MongoCollections.class_memberships].update_one(
        {"class_id": class_id, "user_id": student_id, "role": "student"},
        {"$set": {"status": "inactive", "updated_at": utc_now()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Student enrollment not found")
    return {"status": "removed"}
