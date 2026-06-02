from typing import Literal

from fastapi import Depends, Header, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import MongoCollections, get_db
from app.models import UserOut, WorkspaceOut
from app.services import serialize_document

SESSION_PREFIX = "mock-session:"


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
        workspaces.append(
            WorkspaceOut(
                type=membership["role"],
                class_id=membership["class_id"],
                class_name=class_doc.get("name") if class_doc else membership["class_id"],
            )
        )

    if user.get("global_role") == "admin":
        workspaces.append(WorkspaceOut(type="admin", label="Institution Administration"))

    return workspaces


async def require_admin(db: AsyncIOMotorDatabase, user: dict) -> None:
    if user.get("global_role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin permission required")


async def require_class_role(
    db: AsyncIOMotorDatabase,
    user: dict,
    class_id: str,
    role: Literal["student", "instructor"],
) -> None:
    if user.get("global_role") == "admin":
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


async def require_any_class_role(
    db: AsyncIOMotorDatabase,
    user: dict,
    role: Literal["student", "instructor"],
) -> list[str]:
    if user.get("global_role") == "admin":
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
        global_role=user.get("global_role", "user"),
    )
