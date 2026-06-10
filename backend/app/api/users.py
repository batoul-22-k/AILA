from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import account_role_for_user, get_current_user, require_admin, require_any_class_role
from app.database import MongoCollections, get_db
from app.models import UserCreateRequest, UserOut, utc_now
from app.services import serialize_document

router = APIRouter(prefix="/users", tags=["users"])


async def make_account_user_id(db: AsyncIOMotorDatabase, account_role: str) -> str:
    prefix = account_role
    rows = await db[MongoCollections.users].find(
        {"user_id": {"$regex": f"^{prefix}_[0-9]{{2}}$"}},
        {"user_id": 1},
    ).to_list(length=1000)
    highest = 0
    for row in rows:
        suffix = row["user_id"].removeprefix(f"{prefix}_")
        if len(suffix) == 2 and suffix.isdigit():
            highest = max(highest, int(suffix))

    next_number = highest + 1
    while True:
        candidate = f"{prefix}_{next_number:03d}"
        existing = await db[MongoCollections.users].find_one({"user_id": candidate})
        if not existing:
            return candidate
        next_number += 1


async def user_out_from_row(db: AsyncIOMotorDatabase, row: dict, instructor_ids: set[str] | None = None) -> UserOut:
    clean = serialize_document(row)
    if not clean.get("account_role"):
        if account_role_for_user(clean) == "admin":
            clean["account_role"] = "admin"
        elif instructor_ids is not None and clean["user_id"] in instructor_ids:
            clean["account_role"] = "instructor"
        else:
            membership = await db[MongoCollections.class_memberships].find_one(
                {"user_id": clean["user_id"], "role": "instructor", "status": "active"}
            )
            clean["account_role"] = "instructor" if membership else "student"
    clean.pop("global_role", None)
    return UserOut(**clean)


@router.get("", response_model=list[UserOut])
async def list_users(
    include_all: bool = False,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[UserOut]:
    if account_role_for_user(user) == "admin" and include_all:
        instructor_memberships = await db[MongoCollections.class_memberships].find(
            {"role": "instructor", "status": "active"},
            {"user_id": 1},
        ).to_list(length=500)
        instructor_ids = {membership["user_id"] for membership in instructor_memberships}
        rows = await db[MongoCollections.users].find({}).sort("created_at", -1).to_list(length=500)
        return [await user_out_from_row(db, row, instructor_ids) for row in rows]

    if account_role_for_user(user) != "admin":
        await require_any_class_role(db, user, "instructor")
    instructor_memberships = await db[MongoCollections.class_memberships].find(
        {"role": "instructor", "status": "active"},
        {"user_id": 1},
    ).to_list(length=500)
    instructor_ids = [membership["user_id"] for membership in instructor_memberships]
    rows = await db[MongoCollections.users].find({"user_id": {"$nin": instructor_ids}}).sort("name", 1).to_list(length=500)
    normalized = [await user_out_from_row(db, row, set(instructor_ids)) for row in rows]
    return [row for row in normalized if row.account_role == "student"]


@router.post("", response_model=UserOut)
async def create_user(
    payload: UserCreateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> UserOut:
    await require_admin(db, user)
    name = payload.name.strip()
    email = payload.email.lower().strip()
    password = payload.password.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    existing = await db[MongoCollections.users].find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Email is already in use")

    account = {
        "user_id": await make_account_user_id(db, payload.account_role),
        "name": name,
        "email": email,
        "password_hash_placeholder": password,
        "account_role": payload.account_role,
        "created_at": utc_now(),
    }
    await db[MongoCollections.users].insert_one(account)

    return UserOut(**serialize_document(account))


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    account = await db[MongoCollections.users].find_one({"user_id": user_id})
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    await db[MongoCollections.users].delete_one({"user_id": user_id})
    await db[MongoCollections.class_memberships].delete_many({"user_id": user_id})
    await db[MongoCollections.classes].update_many(
        {"instructor_ids": user_id},
        {"$pull": {"instructor_ids": user_id}},
    )
    await db[MongoCollections.responses].delete_many({"student_id": user_id})
    await db[MongoCollections.participation_records].delete_many({"student_id": user_id})
    await db[MongoCollections.notifications].delete_many({"user_id": user_id})
    return {"status": "deleted", "user_id": user_id}
