import secrets
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from app.admin_command_service import (
    build_alerts,
    build_class_monitoring,
    build_instructor_monitoring,
    build_prediction_overview,
    build_risk_overview,
    build_trends,
    command_center_payload,
    load_admin_context,
    mark_alert_reviewed,
)
from app.api.users import make_account_user_id, user_out_from_row
from app.auth import get_current_user, hash_password, make_unusable_password_hash, require_admin
from app.database import MongoCollections, get_db
from app.models import UserOut, new_id, utc_now
from app.services import get_live_session_stats, serialize_document

router = APIRouter(prefix="/admin", tags=["admin"])

ACCOUNT_ROLES = {"student", "instructor", "admin"}
ROLE_ALIASES = {
    "administrator": "admin",
    "teacher": "instructor",
    "faculty": "instructor",
    "lecturer": "instructor",
    "learner": "student",
}
SYNC_SOURCE = "institution_database"


class InstitutionUserPreview(BaseModel):
    full_name: str
    email: str
    role: Literal["student", "instructor", "admin"] | str
    institution_id: str
    department: str | None = None
    section: str | None = None
    year: str | None = None
    group: str | None = None
    class_id: str | None = None
    class_name: str | None = None
    enrolled_classes: list[dict] = Field(default_factory=list)
    assigned_classes: list[dict] = Field(default_factory=list)
    account_role: Literal["student", "instructor", "admin"] | None = None
    global_role: str | None = None
    sync_source: str
    sync_status: Literal["New", "Existing", "Invalid", "Missing data"]
    reason: str | None = None
    can_import: bool = False
    can_sync: bool = False


class InstitutionUsersPreviewResponse(BaseModel):
    users: list[InstitutionUserPreview]
    counts: dict[str, int]
    sync_source: str


class AccountsSyncRequest(BaseModel):
    institution_ids: list[str] = Field(default_factory=list)


class AccountsSyncResponse(BaseModel):
    created: list[UserOut]
    created_count: int
    skipped_duplicates: int
    invalid_count: int


class InstitutionClassPreview(BaseModel):
    class_key: str
    name: str
    institution_class_id: str | None = None
    course_code: str | None = None
    section: str | None = None
    year: str | None = None
    group: str | None = None
    department: str | None = None
    status: Literal["New", "Existing", "Invalid", "Missing data"]
    reason: str | None = None
    existing_class_id: str | None = None


class InstitutionMembershipPreview(BaseModel):
    institution_id: str
    email: str
    full_name: str
    role_in_class: Literal["student", "instructor"]
    class_key: str
    class_name: str
    institution_class_id: str | None = None
    status: Literal["New", "Existing", "Invalid", "Missing data"]
    reason: str | None = None


class InstitutionSyncPreviewResponse(BaseModel):
    users: list[InstitutionUserPreview]
    classes: list[InstitutionClassPreview]
    student_enrollments: list[InstitutionMembershipPreview]
    instructor_assignments: list[InstitutionMembershipPreview]
    counts: dict[str, int]
    sync_source: str


class InstitutionSyncApplyRequest(BaseModel):
    institution_ids: list[str] = Field(default_factory=list)


class InstitutionSyncApplyResponse(BaseModel):
    users: list[UserOut]
    created_accounts: int
    updated_accounts: int
    created_classes: int
    student_enrollments_added: int
    instructor_assignments_added: int
    skipped_existing_memberships: int
    invalid_records: int


class ManualAccountRequest(BaseModel):
    full_name: str
    email: str
    account_role: Literal["student", "instructor", "admin"] = "student"
    institution_id: str | None = None
    department: str | None = None
    class_id: str | None = None
    class_name: str | None = None


class AdminSessionOut(BaseModel):
    session_id: str
    class_id: str
    class_name: str | None = None
    instructor_id: str | None = None
    instructor_name: str | None = None
    session_code: str
    status: str
    question_count: int = 0
    active_question_id: str | None = None
    scheduled_for: datetime | None = None
    created_at: datetime | None = None
    participant_count: int = 0


def normalize_role(role: str | None) -> str:
    clean = (role or "").strip().lower()
    return ROLE_ALIASES.get(clean, clean)


def clean_optional(value) -> str | None:
    if value is None:
        return None
    clean = str(value).strip()
    return clean or None


def normalize_institution_class(raw_class, fallback: dict | None = None) -> dict:
    fallback = fallback or {}
    if isinstance(raw_class, str):
        raw = {"name": raw_class, "course_code": raw_class}
    else:
        raw = dict(raw_class or {})
    institution_class_id = clean_optional(
        raw.get("institution_class_id")
        or raw.get("institution_id")
        or raw.get("class_institution_id")
        or raw.get("class_id")
        or fallback.get("institution_class_id")
        or fallback.get("class_id")
    )
    course_code = clean_optional(raw.get("course_code") or raw.get("code") or raw.get("course") or fallback.get("course_code"))
    section = clean_optional(raw.get("section") or fallback.get("section"))
    name = clean_optional(raw.get("name") or raw.get("class_name") or raw.get("title") or fallback.get("class_name") or course_code or institution_class_id)
    return {
        "institution_class_id": institution_class_id,
        "course_code": course_code,
        "section": section,
        "year": clean_optional(raw.get("year") or fallback.get("year")),
        "group": clean_optional(raw.get("group") or fallback.get("group")),
        "department": clean_optional(raw.get("department") or fallback.get("department")),
        "name": name or "",
        "semester": clean_optional(raw.get("semester") or fallback.get("semester")),
    }


def class_key(class_row: dict) -> str:
    institution_class_id = clean_optional(class_row.get("institution_class_id"))
    if institution_class_id:
        return f"institution_class_id:{institution_class_id.lower()}"
    course_code = clean_optional(class_row.get("course_code"))
    section = clean_optional(class_row.get("section"))
    if course_code and section:
        return f"course_section:{course_code.lower()}:{section.lower()}"
    class_id = clean_optional(class_row.get("class_id"))
    if class_id:
        return f"class_id:{class_id.lower()}"
    if course_code:
        return f"course_code:{course_code.lower()}"
    return f"name:{(class_row.get('name') or '').strip().lower()}"


def class_lookup_keys(class_row: dict) -> set[str]:
    keys = {class_key(class_row)}
    institution_class_id = clean_optional(class_row.get("institution_class_id"))
    course_code = clean_optional(class_row.get("course_code"))
    section = clean_optional(class_row.get("section"))
    class_id = clean_optional(class_row.get("class_id"))
    name = clean_optional(class_row.get("name"))
    if institution_class_id:
        keys.add(f"institution_class_id:{institution_class_id.lower()}")
        keys.add(f"class_id:{institution_class_id.lower()}")
    if course_code and section:
        keys.add(f"course_section:{course_code.lower()}:{section.lower()}")
    if course_code:
        keys.add(f"course_code:{course_code.lower()}")
    if class_id:
        keys.add(f"class_id:{class_id.lower()}")
    if name:
        keys.add(f"name:{name.lower()}")
    return keys


def user_class_payloads(row: dict) -> list[dict]:
    fallback = {
        "class_id": row.get("class_id"),
        "class_name": row.get("class_name"),
        "department": row.get("department"),
        "section": row.get("section"),
        "year": row.get("year"),
        "group": row.get("group"),
    }
    raw_classes = row.get("enrolled_classes") if row["role"] == "student" else row.get("assigned_classes") if row["role"] == "instructor" else []
    if not raw_classes and (row.get("class_id") or row.get("class_name")) and row["role"] in {"student", "instructor"}:
        raw_classes = [fallback]
    if not isinstance(raw_classes, list):
        raw_classes = [raw_classes]
    return [normalize_institution_class(raw_class, fallback) for raw_class in raw_classes]


def normalize_institution_user(row: dict) -> dict:
    full_name = (row.get("full_name") or row.get("name") or "").strip()
    email = (row.get("email") or "").strip().lower()
    role = normalize_role(row.get("account_role") or row.get("role") or row.get("global_role"))
    institution_id = (
        row.get("institution_id")
        or row.get("student_id")
        or row.get("employee_id")
        or row.get("external_id")
        or ""
    )
    return {
        "full_name": full_name,
        "email": email,
        "role": role,
        "institution_id": str(institution_id).strip(),
        "department": clean_optional(row.get("department")),
        "section": clean_optional(row.get("section")),
        "year": clean_optional(row.get("year")),
        "group": clean_optional(row.get("group")),
        "class_id": clean_optional(row.get("class_id")),
        "class_name": clean_optional(row.get("class_name") or row.get("class")),
        "enrolled_classes": row.get("enrolled_classes") or [],
        "assigned_classes": row.get("assigned_classes") or [],
        "sync_source": SYNC_SOURCE,
    }


def preview_status(row: dict, existing_emails: set[str], existing_institution_ids: set[str]) -> tuple[str, str | None]:
    missing = [label for label, value in [
        ("full name", row["full_name"]),
        ("email", row["email"]),
        ("role", row["role"]),
        ("institution ID", row["institution_id"]),
    ] if not value]
    if missing:
        return "Missing data", f"Missing {', '.join(missing)}"
    if "@" not in row["email"] or "." not in row["email"].split("@")[-1]:
        return "Invalid", "Email format is invalid"
    if row["role"] not in ACCOUNT_ROLES:
        return "Invalid", "Role is not supported"
    if row["email"] in existing_emails or row["institution_id"] in existing_institution_ids:
        return "Existing", "Email or institution ID already exists"
    return "New", None


async def load_institution_source(db: AsyncIOMotorDatabase) -> list[dict]:
    rows = await db[MongoCollections.institution_users].find({}).sort("full_name", 1).to_list(length=1000)
    return rows


def build_existing_class_index(classes: list[dict]) -> dict[str, dict]:
    index = {}
    for class_doc in classes:
        for key in class_lookup_keys(class_doc):
            index.setdefault(key, class_doc)
    return index


def class_status(row: dict, existing_class_index: dict[str, dict], seen_class_keys: set[str]) -> tuple[str, str | None, str | None]:
    missing = []
    if not row.get("name"):
        missing.append("class name")
    if not (row.get("institution_class_id") or row.get("course_code") or row.get("class_id")):
        missing.append("class identifier")
    if missing:
        return "Missing data", f"Missing {', '.join(missing)}", None
    key = class_key(row)
    existing = next((existing_class_index.get(candidate) for candidate in class_lookup_keys(row) if existing_class_index.get(candidate)), None)
    if existing:
        return "Existing", None, existing["class_id"]
    if key in seen_class_keys:
        return "Existing", "Already included in this preview", None
    return "New", None, None


async def build_institution_sync_preview(db: AsyncIOMotorDatabase) -> InstitutionSyncPreviewResponse:
    source_rows = await load_institution_source(db)
    normalized_rows = [normalize_institution_user(serialize_document(row)) for row in source_rows]
    users = await db[MongoCollections.users].find({}, {"email": 1, "institution_id": 1, "user_id": 1}).to_list(length=2000)
    classes = await db[MongoCollections.classes].find({}).to_list(length=2000)
    memberships = await db[MongoCollections.class_memberships].find(
        {"status": "active"},
        {"user_id": 1, "class_id": 1, "role": 1, "role_in_class": 1},
    ).to_list(length=5000)
    existing_emails = {user.get("email", "").lower() for user in users if user.get("email")}
    existing_institution_ids = {str(user.get("institution_id", "")).strip() for user in users if user.get("institution_id")}
    users_by_email = {user.get("email", "").lower(): user for user in users if user.get("email")}
    users_by_institution_id = {str(user.get("institution_id", "")).strip(): user for user in users if user.get("institution_id")}
    existing_class_index = build_existing_class_index(classes)
    existing_memberships = {
        (membership.get("user_id"), membership.get("class_id"), membership.get("role") or membership.get("role_in_class"))
        for membership in memberships
    }

    user_previews: list[InstitutionUserPreview] = []
    class_previews_by_key: dict[str, InstitutionClassPreview] = {}
    memberships_to_preview: list[InstitutionMembershipPreview] = []
    seen_emails: set[str] = set()
    seen_institution_ids: set[str] = set()
    seen_class_keys: set[str] = set()
    for row in normalized_rows:
        status, reason = preview_status(row, existing_emails, existing_institution_ids)
        duplicate_email = bool(row["email"] and row["email"] in seen_emails)
        duplicate_institution_id = bool(row["institution_id"] and row["institution_id"] in seen_institution_ids)
        if status != "Missing data" and (duplicate_email or duplicate_institution_id):
            status = "Invalid"
            reason = "Duplicate in institution source"
        if row["email"]:
            seen_emails.add(row["email"])
        if row["institution_id"]:
            seen_institution_ids.add(row["institution_id"])

        class_payloads = user_class_payloads(row)
        normalized_classes = []
        for class_row in class_payloads:
            key = class_key(class_row)
            normalized_classes.append(class_row)
            if key not in class_previews_by_key:
                c_status, c_reason, existing_class_id = class_status(class_row, existing_class_index, seen_class_keys)
                class_previews_by_key[key] = InstitutionClassPreview(
                    class_key=key,
                    name=class_row.get("name") or "Missing class name",
                    institution_class_id=class_row.get("institution_class_id"),
                    course_code=class_row.get("course_code"),
                    section=class_row.get("section"),
                    year=class_row.get("year"),
                    group=class_row.get("group"),
                    department=class_row.get("department"),
                    status=c_status,
                    reason=c_reason,
                    existing_class_id=existing_class_id,
                )
                seen_class_keys.add(key)

        user_preview_payload = {
            **row,
            "enrolled_classes": normalized_classes if row["role"] == "student" else [],
            "assigned_classes": normalized_classes if row["role"] == "instructor" else [],
            "account_role": row["role"] if row["role"] in ACCOUNT_ROLES else None,
            "global_role": row["role"] if row["role"] in ACCOUNT_ROLES else None,
            "sync_status": status,
            "reason": reason,
            "can_import": status == "New",
            "can_sync": status in {"New", "Existing"},
        }
        user_previews.append(
            InstitutionUserPreview(**user_preview_payload)
        )

        if status not in {"New", "Existing"} or row["role"] not in {"student", "instructor"}:
            continue
        existing_user = users_by_email.get(row["email"]) or users_by_institution_id.get(row["institution_id"])
        role_in_class = "student" if row["role"] == "student" else "instructor"
        for class_row in normalized_classes:
            class_preview = class_previews_by_key[class_key(class_row)]
            membership_status = "New"
            membership_reason = None
            existing_class_id = class_preview.existing_class_id
            if class_preview.status in {"Invalid", "Missing data"}:
                membership_status = class_preview.status
                membership_reason = class_preview.reason
            elif existing_user and existing_class_id and (existing_user["user_id"], existing_class_id, role_in_class) in existing_memberships:
                membership_status = "Existing"
                membership_reason = "Membership already exists"
            memberships_to_preview.append(
                InstitutionMembershipPreview(
                    institution_id=row["institution_id"],
                    email=row["email"],
                    full_name=row["full_name"],
                    role_in_class=role_in_class,
                    class_key=class_preview.class_key,
                    class_name=class_preview.name,
                    institution_class_id=class_preview.institution_class_id,
                    status=membership_status,
                    reason=membership_reason,
                )
            )

    student_enrollments = [row for row in memberships_to_preview if row.role_in_class == "student"]
    instructor_assignments = [row for row in memberships_to_preview if row.role_in_class == "instructor"]
    classes_preview = list(class_previews_by_key.values())
    counts = {
        **preview_counts(user_previews),
        "new_accounts": sum(row.sync_status == "New" for row in user_previews),
        "existing_accounts": sum(row.sync_status == "Existing" for row in user_previews),
        "new_classes": sum(row.status == "New" for row in classes_preview),
        "student_enrollments_to_add": sum(row.status == "New" for row in student_enrollments),
        "instructor_assignments_to_add": sum(row.status == "New" for row in instructor_assignments),
        "invalid_records": sum(row.sync_status in {"Invalid", "Missing data"} for row in user_previews)
        + sum(row.status in {"Invalid", "Missing data"} for row in classes_preview),
    }
    return InstitutionSyncPreviewResponse(
        users=user_previews,
        classes=classes_preview,
        student_enrollments=student_enrollments,
        instructor_assignments=instructor_assignments,
        counts=counts,
        sync_source=SYNC_SOURCE,
    )


async def build_institution_preview(db: AsyncIOMotorDatabase) -> list[InstitutionUserPreview]:
    preview = await build_institution_sync_preview(db)
    return preview.users
    return preview


def preview_counts(preview: list[InstitutionUserPreview]) -> dict[str, int]:
    return {
        "total": len(preview),
        "new": sum(row.sync_status == "New" for row in preview),
        "existing": sum(row.sync_status == "Existing" for row in preview),
        "invalid": sum(row.sync_status == "Invalid" for row in preview),
        "missing_data": sum(row.sync_status == "Missing data" for row in preview),
    }


def temporary_password_hash() -> str:
    return hash_password(secrets.token_urlsafe(24))


def user_document_from_preview(row: InstitutionUserPreview, user_id: str) -> dict:
    return {
        "user_id": user_id,
        "name": row.full_name,
        "full_name": row.full_name,
        "email": row.email,
        "password_hash": temporary_password_hash(),
        "must_change_password": True,
        "password_reset_required": True,
        "invite_pending": True,
        "account_role": row.account_role,
        "global_role": row.global_role or row.account_role,
        "institution_id": row.institution_id,
        "department": row.department,
        "section": row.section,
        "year": row.year,
        "group": row.group,
        "class_id": row.class_id,
        "class_name": row.class_name,
        "enrolled_classes": row.enrolled_classes,
        "assigned_classes": row.assigned_classes,
        "is_active": True,
        "created_by_sync": True,
        "sync_source": row.sync_source,
        "created_at": utc_now(),
    }


def user_metadata_update_from_preview(row: InstitutionUserPreview) -> dict:
    return {
        "name": row.full_name,
        "full_name": row.full_name,
        "email": row.email,
        "account_role": row.account_role,
        "global_role": row.global_role or row.account_role,
        "institution_id": row.institution_id,
        "department": row.department,
        "section": row.section,
        "year": row.year,
        "group": row.group,
        "class_id": row.class_id,
        "class_name": row.class_name,
        "enrolled_classes": row.enrolled_classes,
        "assigned_classes": row.assigned_classes,
        "is_active": True,
        "sync_source": row.sync_source,
        "updated_by_sync": True,
        "updated_at": utc_now(),
    }


def class_document_from_source(class_row: dict, created_by: str) -> dict:
    return {
        "class_id": new_id("class"),
        "name": class_row.get("name") or class_row.get("course_code") or "Institution class",
        "description": class_row.get("description"),
        "semester": class_row.get("semester"),
        "created_by": created_by,
        "instructor_ids": [],
        "status": "active",
        "institution_class_id": class_row.get("institution_class_id"),
        "course_code": class_row.get("course_code"),
        "section": class_row.get("section"),
        "year": class_row.get("year"),
        "group": class_row.get("group"),
        "department": class_row.get("department"),
        "created_by_sync": True,
        "sync_source": SYNC_SOURCE,
        "created_at": utc_now(),
    }


def class_metadata_update_from_source(class_row: dict) -> dict:
    return {
        "name": class_row.get("name") or class_row.get("course_code") or "Institution class",
        "description": class_row.get("description"),
        "semester": class_row.get("semester"),
        "institution_class_id": class_row.get("institution_class_id"),
        "course_code": class_row.get("course_code"),
        "section": class_row.get("section"),
        "year": class_row.get("year"),
        "group": class_row.get("group"),
        "department": class_row.get("department"),
        "status": "active",
        "sync_source": SYNC_SOURCE,
        "updated_by_sync": True,
        "updated_at": utc_now(),
    }


def user_document_from_manual(payload: ManualAccountRequest, user_id: str) -> dict:
    full_name = payload.full_name.strip()
    return {
        "user_id": user_id,
        "name": full_name,
        "full_name": full_name,
        "email": payload.email.lower().strip(),
        "password_hash": make_unusable_password_hash(),
        "must_change_password": True,
        "password_reset_required": True,
        "invite_pending": True,
        "account_role": payload.account_role,
        "global_role": payload.account_role,
        "institution_id": payload.institution_id.strip() if payload.institution_id else None,
        "department": payload.department,
        "class_id": payload.class_id,
        "class_name": payload.class_name,
        "is_active": True,
        "created_by_sync": False,
        "sync_source": "manual",
        "created_at": utc_now(),
    }


async def find_existing_user_for_preview(db: AsyncIOMotorDatabase, row: InstitutionUserPreview) -> dict | None:
    return await db[MongoCollections.users].find_one(
        {
            "$or": [
                {"email": row.email},
                {"institution_id": row.institution_id},
            ]
        }
    )


async def ensure_sync_class(
    db: AsyncIOMotorDatabase,
    class_row: dict,
    class_cache: dict[str, dict],
    created_by: str,
) -> tuple[dict | None, bool]:
    if not class_row.get("name") or not (class_row.get("institution_class_id") or class_row.get("course_code") or class_row.get("class_id")):
        return None, False
    for key in class_lookup_keys(class_row):
        if key in class_cache:
            cached = class_cache[key]
            await db[MongoCollections.classes].update_one(
                {"class_id": cached["class_id"]},
                {"$set": class_metadata_update_from_source(class_row)},
            )
            refreshed = await db[MongoCollections.classes].find_one({"class_id": cached["class_id"]}) or cached
            for refreshed_key in class_lookup_keys(refreshed) | class_lookup_keys(class_row):
                class_cache[refreshed_key] = refreshed
            return refreshed, False

    query_options = []
    if class_row.get("institution_class_id"):
        query_options.append({"institution_class_id": class_row["institution_class_id"]})
        query_options.append({"class_id": class_row["institution_class_id"]})
    if class_row.get("course_code") and class_row.get("section"):
        query_options.append({"course_code": class_row["course_code"], "section": class_row["section"]})
    if class_row.get("course_code"):
        query_options.append({"course_code": class_row["course_code"]})

    existing = await db[MongoCollections.classes].find_one({"$or": query_options}) if query_options else None
    if existing:
        await db[MongoCollections.classes].update_one(
            {"class_id": existing["class_id"]},
            {"$set": class_metadata_update_from_source(class_row)},
        )
        refreshed = await db[MongoCollections.classes].find_one({"class_id": existing["class_id"]}) or existing
        for key in class_lookup_keys(refreshed) | class_lookup_keys(class_row):
            class_cache[key] = refreshed
        return refreshed, False

    class_doc = class_document_from_source(class_row, created_by)
    await db[MongoCollections.classes].insert_one(class_doc)
    for key in class_lookup_keys(class_doc) | class_lookup_keys(class_row):
        class_cache[key] = class_doc
    return class_doc, True


async def upsert_sync_membership(
    db: AsyncIOMotorDatabase,
    *,
    user_doc: dict,
    class_doc: dict,
    role_in_class: Literal["student", "instructor"],
    institution_id: str,
) -> bool:
    now = utc_now()
    result = await db[MongoCollections.class_memberships].update_one(
        {"class_id": class_doc["class_id"], "user_id": user_doc["user_id"], "role": role_in_class},
        {
            "$set": {
                "status": "active",
                "role_in_class": role_in_class,
                "institution_id": institution_id,
                "source": "institution_sync",
                "updated_at": now,
            },
            "$setOnInsert": {
                "membership_id": new_id("membership"),
                "class_id": class_doc["class_id"],
                "user_id": user_doc["user_id"],
                "role": role_in_class,
                "created_at": now,
            },
        },
        upsert=True,
    )
    if role_in_class == "instructor":
        await db[MongoCollections.classes].update_one(
            {"class_id": class_doc["class_id"]},
            {"$addToSet": {"instructor_ids": user_doc["user_id"]}, "$set": {"updated_at": now}},
        )
    return result.upserted_id is not None


@router.get("/institution-sync/preview", response_model=InstitutionSyncPreviewResponse)
async def preview_institution_sync(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> InstitutionSyncPreviewResponse:
    await require_admin(db, user)
    return await build_institution_sync_preview(db)


@router.post("/institution-sync/apply", response_model=InstitutionSyncApplyResponse)
async def apply_institution_sync(
    payload: InstitutionSyncApplyRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> InstitutionSyncApplyResponse:
    await require_admin(db, user)
    selected_ids = {institution_id.strip() for institution_id in payload.institution_ids if institution_id.strip()}
    if not selected_ids:
        raise HTTPException(status_code=400, detail="Select at least one valid institution user to sync")

    preview = await build_institution_sync_preview(db)
    selected_users = [row for row in preview.users if row.institution_id in selected_ids]
    valid_users = [row for row in selected_users if row.can_sync and row.account_role]
    invalid_records = len(selected_ids) - len(valid_users)
    created_accounts = 0
    updated_accounts = 0
    created_classes = 0
    student_enrollments_added = 0
    instructor_assignments_added = 0
    skipped_existing_memberships = 0
    touched_users: list[dict] = []

    existing_classes = await db[MongoCollections.classes].find({}).to_list(length=2000)
    class_cache = build_existing_class_index(existing_classes)

    for row in valid_users:
        existing_user = await find_existing_user_for_preview(db, row)
        if existing_user:
            await db[MongoCollections.users].update_one(
                {"user_id": existing_user["user_id"]},
                {"$set": user_metadata_update_from_preview(row)},
            )
            user_doc = await db[MongoCollections.users].find_one({"user_id": existing_user["user_id"]})
            updated_accounts += 1
        else:
            user_doc = user_document_from_preview(row, await make_account_user_id(db, row.account_role))
            await db[MongoCollections.users].insert_one(user_doc)
            created_accounts += 1

        if not user_doc:
            invalid_records += 1
            continue
        touched_users.append(user_doc)

        role_in_class = "student" if row.account_role == "student" else "instructor" if row.account_role == "instructor" else None
        if not role_in_class:
            continue
        source_classes = row.enrolled_classes if role_in_class == "student" else row.assigned_classes
        for class_row in source_classes:
            class_doc, created = await ensure_sync_class(db, class_row, class_cache, user["user_id"])
            if not class_doc:
                invalid_records += 1
                continue
            if created:
                created_classes += 1
            inserted = await upsert_sync_membership(
                db,
                user_doc=user_doc,
                class_doc=class_doc,
                role_in_class=role_in_class,
                institution_id=row.institution_id,
            )
            if inserted and role_in_class == "student":
                student_enrollments_added += 1
            elif inserted and role_in_class == "instructor":
                instructor_assignments_added += 1
            else:
                skipped_existing_memberships += 1

    users_out = [await user_out_from_row(db, row) for row in touched_users]
    return InstitutionSyncApplyResponse(
        users=users_out,
        created_accounts=created_accounts,
        updated_accounts=updated_accounts,
        created_classes=created_classes,
        student_enrollments_added=student_enrollments_added,
        instructor_assignments_added=instructor_assignments_added,
        skipped_existing_memberships=skipped_existing_memberships,
        invalid_records=invalid_records,
    )


@router.get("/institution-users/preview", response_model=InstitutionUsersPreviewResponse)
async def preview_institution_users(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> InstitutionUsersPreviewResponse:
    await require_admin(db, user)
    preview = await build_institution_preview(db)
    return InstitutionUsersPreviewResponse(users=preview, counts=preview_counts(preview), sync_source=SYNC_SOURCE)


@router.post("/accounts/sync", response_model=AccountsSyncResponse)
async def sync_institution_accounts(
    payload: AccountsSyncRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> AccountsSyncResponse:
    await require_admin(db, user)
    selected_ids = {institution_id.strip() for institution_id in payload.institution_ids if institution_id.strip()}
    if not selected_ids:
        raise HTTPException(status_code=400, detail="Select at least one valid institution user to import")

    preview = await build_institution_preview(db)
    selected_rows = [row for row in preview if row.institution_id in selected_ids]
    created_rows: list[dict] = []
    skipped_duplicates = 0
    invalid_count = max(len(selected_ids) - len(selected_rows), 0)

    for row in selected_rows:
        if row.sync_status in {"Invalid", "Missing data"}:
            invalid_count += 1
            continue
        existing = await db[MongoCollections.users].find_one(
            {
                "$or": [
                    {"email": row.email},
                    {"institution_id": row.institution_id},
                ]
            },
            {"_id": 1},
        )
        if row.sync_status == "Existing" or existing:
            skipped_duplicates += 1
            continue
        if not row.account_role:
            invalid_count += 1
            continue

        account = user_document_from_preview(row, await make_account_user_id(db, row.account_role))
        await db[MongoCollections.users].insert_one(account)
        created_rows.append(account)

    created = [await user_out_from_row(db, row) for row in created_rows]
    return AccountsSyncResponse(
        created=created,
        created_count=len(created),
        skipped_duplicates=skipped_duplicates,
        invalid_count=invalid_count,
    )


@router.post("/accounts/manual", response_model=UserOut)
async def create_manual_account(
    payload: ManualAccountRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> UserOut:
    await require_admin(db, user)
    full_name = payload.full_name.strip()
    email = payload.email.lower().strip()
    institution_id = payload.institution_id.strip() if payload.institution_id else None
    if not full_name:
        raise HTTPException(status_code=400, detail="Full name is required")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Email format is invalid")

    duplicate_filters = [{"email": email}]
    if institution_id:
        duplicate_filters.append({"institution_id": institution_id})
    existing = await db[MongoCollections.users].find_one({"$or": duplicate_filters})
    if existing:
        raise HTTPException(status_code=409, detail="Email or institution ID is already in use")

    account = user_document_from_manual(payload, await make_account_user_id(db, payload.account_role))
    await db[MongoCollections.users].insert_one(account)
    return await user_out_from_row(db, account)


async def admin_session_out_from_row(db: AsyncIOMotorDatabase, row: dict) -> AdminSessionOut:
    clean = serialize_document(row)
    class_doc = await db[MongoCollections.classes].find_one({"class_id": clean["class_id"]})
    instructor = await db[MongoCollections.users].find_one({"user_id": clean.get("instructor_id")}) if clean.get("instructor_id") else None
    stats = await get_live_session_stats(db, clean["session_id"])
    return AdminSessionOut(
        session_id=clean["session_id"],
        class_id=clean["class_id"],
        class_name=class_doc.get("name") if class_doc else None,
        instructor_id=clean.get("instructor_id"),
        instructor_name=instructor.get("name") if instructor else None,
        session_code=clean["session_code"],
        status=clean.get("status", "active"),
        question_count=len(clean.get("question_ids") or []),
        active_question_id=clean.get("active_question_id"),
        scheduled_for=clean.get("scheduled_for"),
        created_at=clean.get("created_at"),
        participant_count=stats.participation_count,
    )


@router.get("/sessions", response_model=list[AdminSessionOut])
async def list_admin_sessions(
    active_only: bool = False,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[AdminSessionOut]:
    await require_admin(db, user)
    query = {"status": "active"} if active_only else {}
    rows = await db[MongoCollections.sessions].find(query).sort("created_at", -1).to_list(length=500)
    return [await admin_session_out_from_row(db, row) for row in rows]


@router.get("/sessions/{session_id}/report")
async def get_admin_session_report(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    session = await db[MongoCollections.sessions].find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    summary = await admin_session_out_from_row(db, session)
    stats = await get_live_session_stats(db, session_id)
    responses = await db[MongoCollections.responses].find({"session_id": session_id}).to_list(length=None)
    return {
        "session": summary.model_dump(mode="json"),
        "stats": stats.model_dump(mode="json"),
        "responses_count": len(responses),
    }


@router.get("/command-center")
async def get_admin_command_center(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    return await command_center_payload(db)


@router.get("/alerts")
async def get_admin_alerts(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    context = await load_admin_context(db)
    classes = build_class_monitoring(context)
    instructors = build_instructor_monitoring(context, classes)
    alerts = build_alerts(context, classes, instructors)
    return {"alerts": alerts, "count": len(alerts)}


@router.post("/alerts/{alert_id}/review")
async def review_admin_alert(
    alert_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    return await mark_alert_reviewed(db, alert_id, user["user_id"])


@router.get("/classes/monitoring")
async def get_admin_classes_monitoring(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    context = await load_admin_context(db)
    rows = build_class_monitoring(context)
    return {"classes": rows, "count": len(rows)}


@router.get("/instructors/monitoring")
async def get_admin_instructors_monitoring(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    context = await load_admin_context(db)
    classes = build_class_monitoring(context)
    rows = build_instructor_monitoring(context, classes)
    return {"instructors": rows, "count": len(rows)}


@router.get("/risk-overview")
async def get_admin_risk_overview(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    context = await load_admin_context(db)
    classes = build_class_monitoring(context)
    instructors = build_instructor_monitoring(context, classes)
    return build_risk_overview(context, classes, instructors)


@router.get("/trends")
async def get_admin_trends(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    context = await load_admin_context(db)
    return {"trends": build_trends(context)}


@router.get("/prediction-overview")
async def get_admin_prediction_overview(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    await require_admin(db, user)
    context = await load_admin_context(db)
    return build_prediction_overview(context)
