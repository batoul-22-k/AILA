import hashlib
import hmac
import secrets
from typing import Literal

from fastapi import Depends, Header, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import MongoCollections, get_db
from app.models import UserOut, WorkspaceOut
from app.services import serialize_document

SESSION_PREFIX = "aila-session:"
PASSWORD_HASH_PREFIX = "pbkdf2_sha256"
PASSWORD_HASH_ITERATIONS = 260000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PASSWORD_HASH_ITERATIONS,
    ).hex()
    return f"{PASSWORD_HASH_PREFIX}${PASSWORD_HASH_ITERATIONS}${salt}${digest}"


def make_unusable_password_hash() -> str:
    return hash_password(secrets.token_urlsafe(32))


def verify_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    if stored_hash.startswith(f"{PASSWORD_HASH_PREFIX}$"):
        try:
            _, iterations, salt, digest = stored_hash.split("$", 3)
            candidate = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                salt.encode("utf-8"),
                int(iterations),
            ).hex()
            return hmac.compare_digest(candidate, digest)
        except (TypeError, ValueError):
            return False
    return hmac.compare_digest(stored_hash, password)


def account_role_for_user(user: dict) -> str:
    user_id = user.get("user_id", "")
    if user_id.startswith("admin_"):
        return "admin"
    if user_id.startswith("instructor_"):
        return "instructor"
    if user_id.startswith("student_"):
        return "student"
    role = user.get("account_role")
    if role in {"student", "instructor", "admin"}:
        return role
    if user.get("global_role") == "admin":
        return "admin"
    return "student"


def make_session_token(user_id: str) -> str:
    # TODO: Replace this placeholder token with signed server-side sessions or JWT.
    return f"{SESSION_PREFIX}{user_id}"


def user_id_from_token(token: str | None) -> str:
    if not token or not token.startswith(SESSION_PREFIX):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    user_id = token.removeprefix(SESSION_PREFIX)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return user_id


async def get_current_user(
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    user_id = user_id_from_token(x_session_token)
    user = await db[MongoCollections.users].find_one({"user_id": user_id})
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return serialize_document(user)


async def build_workspaces(db: AsyncIOMotorDatabase, user: dict) -> list[WorkspaceOut]:
    workspaces: list[WorkspaceOut] = []
    memberships = await db[MongoCollections.class_memberships].find(
        {"user_id": user["user_id"], "status": "active"}
    ).to_list(length=100)

    for membership in memberships:
        class_doc = await db[MongoCollections.classes].find_one({"class_id": membership["class_id"]})
        if class_doc and class_doc.get("status", "active") in {"archived", "inactive"}:
            continue
        instructor_name = None
        instructor_ids = class_doc.get("instructor_ids", []) if class_doc else []
        if instructor_ids:
            instructor = await db[MongoCollections.users].find_one({"user_id": instructor_ids[0]})
            instructor_name = instructor.get("name") if instructor else None
        workspaces.append(
            WorkspaceOut(
                type=membership["role"],
                class_id=membership["class_id"],
                class_name=class_doc.get("name") if class_doc else membership["class_id"],
                instructor_name=instructor_name,
                joined_at=membership.get("created_at"),
                last_activity_at=membership.get("updated_at") or membership.get("last_seen_at"),
            )
        )

    account_role = account_role_for_user(user)
    has_instructor_workspace = any(workspace.type == "instructor" for workspace in workspaces)
    if account_role == "instructor" and not has_instructor_workspace:
        workspaces.append(WorkspaceOut(type="instructor", label="Instructor Workspace"))

    if account_role == "admin":
        workspaces.append(WorkspaceOut(type="admin", label="Institution Administration"))

    return workspaces


async def require_admin(db: AsyncIOMotorDatabase, user: dict) -> None:
    if account_role_for_user(user) != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin permission required")


async def require_class_role(
    db: AsyncIOMotorDatabase,
    user: dict,
    class_id: str,
    role: Literal["student", "instructor"],
) -> None:
    if account_role_for_user(user) == "admin":
        return

    membership = await db[MongoCollections.class_memberships].find_one(
        {
            "class_id": class_id,
            "user_id": user["user_id"],
            "role": role,
            "status": "active",
        }
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{role.title()} permission required for this class")


async def require_account_class_role(
    db: AsyncIOMotorDatabase,
    user: dict,
    class_id: str,
    role: Literal["student", "instructor"],
) -> None:
    if account_role_for_user(user) != role:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{role.title()} account required")

    membership = await db[MongoCollections.class_memberships].find_one(
        {
            "class_id": class_id,
            "user_id": user["user_id"],
            "role": role,
            "status": "active",
        }
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{role.title()} permission required for this class")


async def require_any_class_role(
    db: AsyncIOMotorDatabase,
    user: dict,
    role: Literal["student", "instructor"],
) -> list[str]:
    if account_role_for_user(user) == "admin":
        classes = await db[MongoCollections.classes].find({}, {"class_id": 1}).to_list(length=500)
        return [class_doc["class_id"] for class_doc in classes]

    memberships = await db[MongoCollections.class_memberships].find(
        {"user_id": user["user_id"], "role": role, "status": "active"},
        {"class_id": 1},
    ).to_list(length=500)
    if not memberships:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{role.title()} permission required")
    return [membership["class_id"] for membership in memberships]


def public_user(user: dict) -> UserOut:
    return UserOut(
        user_id=user["user_id"],
        name=user["name"],
        email=user["email"],
        account_role=account_role_for_user(user),
        global_role=user.get("global_role"),
        full_name=user.get("full_name"),
        institution_id=user.get("institution_id"),
        department=user.get("department"),
        class_id=user.get("class_id"),
        class_name=user.get("class_name"),
        is_active=user.get("is_active", True),
        must_change_password=user.get("must_change_password", False),
        created_by_sync=user.get("created_by_sync", False),
        sync_source=user.get("sync_source"),
        created_at=user.get("created_at"),
    )
