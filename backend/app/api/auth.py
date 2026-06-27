from fastapi import APIRouter, Depends, Header, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth import build_workspaces, make_session_token, public_user, user_id_from_token, verify_password
from app.database import MongoCollections, get_db
from app.models import LoginRequest, LoginResponse, ProfileUpdateRequest
from app.services import serialize_document

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, db: AsyncIOMotorDatabase = Depends(get_db)) -> LoginResponse:
    user = await db[MongoCollections.users].find_one({"email": payload.email.lower().strip()})
    stored_password = (user.get("password_hash") or user.get("password_hash_placeholder")) if user else None
    if not user or not verify_password(payload.password, stored_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    clean_user = serialize_document(user)
    return LoginResponse(
        user=public_user(clean_user),
        session_token=make_session_token(clean_user["user_id"]),
        workspaces=await build_workspaces(db, clean_user),
    )


@router.get("/me", response_model=LoginResponse)
async def get_current_session(
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> LoginResponse:
    # TODO: Replace this token lookup with hardened server-side session validation.
    user_id = user_id_from_token(x_session_token)
    user = await db[MongoCollections.users].find_one({"user_id": user_id})
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    clean_user = serialize_document(user)
    return LoginResponse(
        user=public_user(clean_user),
        session_token=make_session_token(clean_user["user_id"]),
        workspaces=await build_workspaces(db, clean_user),
    )


@router.put("/profile", response_model=LoginResponse)
async def update_profile(
    payload: ProfileUpdateRequest,
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> LoginResponse:
    user_id = user_id_from_token(x_session_token)
    email = payload.email.lower().strip()
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    existing = await db[MongoCollections.users].find_one({"email": email, "user_id": {"$ne": user_id}})
    if existing:
        raise HTTPException(status_code=409, detail="Email is already in use")
    await db[MongoCollections.users].update_one(
        {"user_id": user_id},
        {"$set": {"name": name, "email": email}},
    )
    user = await db[MongoCollections.users].find_one({"user_id": user_id})
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    clean_user = serialize_document(user)
    return LoginResponse(
        user=public_user(clean_user),
        session_token=make_session_token(clean_user["user_id"]),
        workspaces=await build_workspaces(db, clean_user),
    )
