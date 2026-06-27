from collections import defaultdict
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import MongoCollections
from app.gamification_service import (
    award_bulk_reward_transaction,
    build_event_id,
    build_session_reward_summary,
    build_profile_id,
    calculate_level,
    get_gamification_profile,
    legacy_star_total,
    profile_type,
    sync_user_gamification_totals,
)
from app.models import utc_now
from app.response_scoring import final_is_correct
from app.services import serialize_document


FINISHED_SESSION_STATUSES = {"closed", "finished"}


def empty_backfill_summary(dry_run: bool) -> dict:
    return {
        "dry_run": dry_run,
        "scanned_sessions": 0,
        "scanned_responses": 0,
        "scanned_student_rewards": 0,
        "students_processed": 0,
        "events_created": 0,
        "events_skipped_existing": 0,
        "profiles_updated": 0,
        "session_summaries_updated": 0,
        "warnings": [],
    }


def merge_summary(target: dict, source: dict) -> dict:
    for key in (
        "scanned_sessions",
        "scanned_responses",
        "scanned_student_rewards",
        "students_processed",
        "events_created",
        "events_skipped_existing",
        "profiles_updated",
        "session_summaries_updated",
    ):
        target[key] += int(source.get(key) or 0)
    target["warnings"].extend(source.get("warnings") or [])
    return target


def response_sort_key(response: dict) -> Any:
    return response.get("submitted_at") or response.get("updated_at") or response.get("created_at")


def correctness_source(response: dict) -> str:
    review = response.get("instructorReview") or {}
    if review.get("reviewed") and review.get("finalLabel") == "correct":
        return "instructor_review"
    ai_evaluation = response.get("aiEvaluation") or {}
    if ai_evaluation.get("label") == "correct" or response.get("semantic_label") == "correct":
        return "semantic"
    return "automatic"


def legacy_reward_is_correct(reward: dict | None) -> bool:
    if not reward:
        return False
    return reward.get("is_correct") is True or int(reward.get("stars_earned") or 0) > 0


def equivalent_event_query(event: dict) -> dict:
    query: dict[str, Any] = {
        "student_id": event["student_id"],
        "class_id": event.get("class_id"),
        "session_id": event.get("session_id"),
        "event_type": event["event_type"],
    }
    if event.get("question_id"):
        query["question_id"] = event.get("question_id")
    return query


async def event_exists(db: AsyncIOMotorDatabase, event: dict) -> bool:
    event_id = build_event_id(event["student_id"], event.get("class_id"), event["idempotency_key"])
    existing = await db[MongoCollections.gamification_events].find_one(
        {"$or": [{"_id": event_id}, equivalent_event_query(event)]},
        {"_id": 1},
    )
    return bool(existing)


def add_unique_event(events_by_key: dict[tuple, dict], event: dict) -> None:
    key = (
        event.get("student_id"),
        event.get("class_id"),
        event.get("session_id"),
        event.get("question_id"),
        event.get("event_type"),
    )
    events_by_key.setdefault(key, event)


async def load_class_sessions(db: AsyncIOMotorDatabase, class_id: str) -> list[dict]:
    rows = await db[MongoCollections.sessions].find({"class_id": class_id}).to_list(length=None)
    return [serialize_document(row) for row in rows if row.get("session_id")]


async def load_legacy_star_keys(
    db: AsyncIOMotorDatabase,
    *,
    session_ids: list[str],
    student_id: str | None = None,
) -> tuple[set[tuple[str, str, str]], set[tuple[str, str]]]:
    if not session_ids:
        return set(), set()
    query: dict[str, Any] = {"session_id": {"$in": session_ids}}
    if student_id:
        query["student_id"] = student_id
    rows = await db[MongoCollections.student_rewards].find(query).to_list(length=None)
    question_star_keys: set[tuple[str, str, str]] = set()
    session_star_keys: set[tuple[str, str]] = set()
    for row in rows:
        current_student_id = row.get("student_id")
        session_id = row.get("session_id")
        if not current_student_id or not session_id:
            continue
        if int(row.get("stars_earned") or 0) <= 0 and not row.get("badge_earned"):
            continue
        question_id = row.get("question_id")
        if question_id:
            question_star_keys.add((current_student_id, session_id, question_id))
        else:
            session_star_keys.add((current_student_id, session_id))
    return question_star_keys, session_star_keys


async def load_legacy_reward_rows(
    db: AsyncIOMotorDatabase,
    *,
    session_ids: list[str],
    student_id: str | None = None,
) -> list[dict]:
    if not session_ids:
        return []
    query: dict[str, Any] = {"session_id": {"$in": session_ids}}
    if student_id:
        query["student_id"] = student_id
    rows = await db[MongoCollections.student_rewards].find(query).to_list(length=None)
    return [serialize_document(row) for row in rows]


async def collect_backfill_events(
    db: AsyncIOMotorDatabase,
    *,
    class_id: str,
    student_id: str | None = None,
) -> tuple[list[dict], dict, set[str]]:
    summary = empty_backfill_summary(dry_run=False)
    sessions = await load_class_sessions(db, class_id)
    summary["scanned_sessions"] = len(sessions)
    if not sessions:
        summary["warnings"].append(f"No sessions found for class {class_id}.")
        return [], summary, set()

    sessions_by_id = {session["session_id"]: session for session in sessions}
    session_ids = list(sessions_by_id)
    question_ids_by_session = {
        session_id: list(dict.fromkeys(session.get("question_ids") or []))
        for session_id, session in sessions_by_id.items()
    }

    participation_query: dict[str, Any] = {"session_id": {"$in": session_ids}}
    response_query: dict[str, Any] = {"session_id": {"$in": session_ids}}
    if student_id:
        participation_query["student_id"] = student_id
        response_query["student_id"] = student_id

    participation_rows = await db[MongoCollections.participation_records].find(participation_query).to_list(length=None)
    response_rows = await db[MongoCollections.responses].find(response_query).to_list(length=None)
    responses = [serialize_document(row) for row in response_rows]
    summary["scanned_responses"] = len(responses)

    legacy_reward_rows = await load_legacy_reward_rows(
        db,
        session_ids=session_ids,
        student_id=student_id,
    )
    summary["scanned_student_rewards"] = len(legacy_reward_rows)
    question_star_keys: set[tuple[str, str, str]] = set()
    session_star_keys: set[tuple[str, str]] = set()
    for reward in legacy_reward_rows:
        current_student_id = reward.get("student_id")
        session_id = reward.get("session_id")
        if not current_student_id or not session_id:
            continue
        if int(reward.get("stars_earned") or 0) <= 0 and not reward.get("badge_earned"):
            continue
        question_id = reward.get("question_id")
        if question_id:
            question_star_keys.add((current_student_id, session_id, question_id))
        else:
            session_star_keys.add((current_student_id, session_id))

    if question_star_keys or session_star_keys:
        summary["warnings"].append(
            "Some backfilled star deltas were set to 0 because matching legacy student_rewards rows already store stars."
        )

    students_by_session: dict[str, set[str]] = defaultdict(set)
    for row in participation_rows:
        current_student_id = row.get("student_id")
        session_id = row.get("session_id")
        if current_student_id and session_id in sessions_by_id:
            students_by_session[session_id].add(current_student_id)

    latest_response_by_student_question: dict[tuple[str, str, str], dict] = {}
    for response in sorted(responses, key=response_sort_key, reverse=True):
        session_id = response.get("session_id")
        current_student_id = response.get("student_id")
        question_id = response.get("question_id")
        if not session_id or not current_student_id or not question_id:
            summary["warnings"].append(f"Skipped response {response.get('response_id') or '<missing id>'}: missing session_id, student_id, or question_id.")
            continue
        if session_id not in sessions_by_id:
            summary["warnings"].append(f"Skipped response {response.get('response_id')}: session {session_id} not found in class {class_id}.")
            continue
        if question_id not in question_ids_by_session.get(session_id, []):
            summary["warnings"].append(f"Skipped response {response.get('response_id')}: question {question_id} does not belong to session {session_id}.")
            continue
        students_by_session[session_id].add(current_student_id)
        latest_response_by_student_question.setdefault((current_student_id, session_id, question_id), response)

    legacy_reward_by_student_question: dict[tuple[str, str, str], dict] = {}
    for reward in legacy_reward_rows:
        session_id = reward.get("session_id")
        current_student_id = reward.get("student_id")
        question_id = reward.get("question_id")
        if not session_id or not current_student_id or not question_id:
            continue
        if session_id not in sessions_by_id:
            continue
        if question_id not in question_ids_by_session.get(session_id, []):
            summary["warnings"].append(f"Skipped legacy reward {reward.get('reward_id') or '<missing id>'}: question {question_id} does not belong to session {session_id}.")
            continue
        students_by_session[session_id].add(current_student_id)
        legacy_reward_by_student_question.setdefault((current_student_id, session_id, question_id), reward)

    all_student_ids = {student for students in students_by_session.values() for student in students}
    summary["students_processed"] = len(all_student_ids)

    events_by_key: dict[tuple, dict] = {}
    for session_id, student_ids in students_by_session.items():
        session = sessions_by_id[session_id]
        for current_student_id in student_ids:
            add_unique_event(
                events_by_key,
                {
                    "student_id": current_student_id,
                    "class_id": class_id,
                    "session_id": session_id,
                    "event_type": "join_session",
                    "source_type": "session",
                    "source_id": session_id,
                    "idempotency_key": f"backfill:join_session:{current_student_id}:{session_id}",
                    "metadata": {"backfill": True},
                },
            )

            if session.get("status") in FINISHED_SESSION_STATUSES:
                stars_delta = 0 if (current_student_id, session_id) in session_star_keys else None
                event = {
                    "student_id": current_student_id,
                    "class_id": class_id,
                    "session_id": session_id,
                    "event_type": "complete_session",
                    "source_type": "session",
                    "source_id": session_id,
                    "idempotency_key": f"backfill:complete_session:{current_student_id}:{session_id}",
                    "metadata": {"backfill": True},
                }
                if stars_delta is not None:
                    event["stars_delta"] = stars_delta
                add_unique_event(events_by_key, event)

                question_ids = question_ids_by_session.get(session_id, [])
                answered_all_correctly = bool(question_ids) and all(
                    (
                        (
                            response := latest_response_by_student_question.get((current_student_id, session_id, question_id))
                        )
                        and final_is_correct(response) is True
                    )
                    or legacy_reward_is_correct(
                        legacy_reward_by_student_question.get((current_student_id, session_id, question_id))
                    )
                    for question_id in question_ids
                )
                if answered_all_correctly:
                    perfect_event = {
                        "student_id": current_student_id,
                        "class_id": class_id,
                        "session_id": session_id,
                        "event_type": "perfect_session",
                        "source_type": "session",
                        "source_id": session_id,
                        "idempotency_key": f"backfill:perfect_session:{current_student_id}:{session_id}",
                        "metadata": {"backfill": True},
                    }
                    if stars_delta is not None:
                        perfect_event["stars_delta"] = 0
                    add_unique_event(events_by_key, perfect_event)

    for (current_student_id, session_id, question_id), response in latest_response_by_student_question.items():
        add_unique_event(
            events_by_key,
            {
                "student_id": current_student_id,
                "class_id": class_id,
                "session_id": session_id,
                "question_id": question_id,
                "event_type": "answer_question",
                "source_type": "question",
                "source_id": question_id,
                "idempotency_key": f"backfill:answer_question:{current_student_id}:{session_id}:{question_id}",
                "metadata": {"backfill": True, "response_id": response.get("response_id")},
            },
        )
        if final_is_correct(response) is True:
            correct_source_id = question_id or response.get("response_id")
            correct_event = {
                "student_id": current_student_id,
                "class_id": class_id,
                "session_id": session_id,
                "question_id": question_id,
                "event_type": "correct_answer",
                "source_type": "question" if question_id else "response",
                "source_id": correct_source_id,
                "idempotency_key": f"backfill:correct_answer:{current_student_id}:{session_id}:{correct_source_id}",
                "metadata": {
                    "backfill": True,
                    "response_id": response.get("response_id"),
                    "correctness_source": correctness_source(response),
                },
            }
            if (current_student_id, session_id, question_id) in question_star_keys:
                correct_event["stars_delta"] = 0
            add_unique_event(events_by_key, correct_event)

    response_keys = set(latest_response_by_student_question)
    for (current_student_id, session_id, question_id), reward in legacy_reward_by_student_question.items():
        if (current_student_id, session_id, question_id) in response_keys:
            continue
        add_unique_event(
            events_by_key,
            {
                "student_id": current_student_id,
                "class_id": class_id,
                "session_id": session_id,
                "question_id": question_id,
                "event_type": "answer_question",
                "source_type": "question",
                "source_id": question_id,
                "idempotency_key": f"backfill:answer_question:{current_student_id}:{session_id}:{question_id}",
                "metadata": {
                    "backfill": True,
                    "source": "student_rewards",
                    "reward_id": reward.get("reward_id"),
                    "missing_response": True,
                },
            },
        )
        reward_is_correct = reward.get("is_correct") is True or int(reward.get("stars_earned") or 0) > 0
        if reward_is_correct:
            add_unique_event(
                events_by_key,
                {
                    "student_id": current_student_id,
                    "class_id": class_id,
                    "session_id": session_id,
                    "question_id": question_id,
                    "event_type": "correct_answer",
                    "source_type": "question",
                    "source_id": question_id,
                    "idempotency_key": f"backfill:correct_answer:{current_student_id}:{session_id}:{question_id}",
                    "stars_delta": 0,
                    "metadata": {
                        "backfill": True,
                        "source": "student_rewards",
                        "reward_id": reward.get("reward_id"),
                        "missing_response": True,
                    },
                },
            )

    return list(events_by_key.values()), summary, all_student_ids


async def filter_missing_events(db: AsyncIOMotorDatabase, events: list[dict]) -> tuple[list[dict], int]:
    missing = []
    skipped = 0
    for event in events:
        if await event_exists(db, event):
            skipped += 1
        else:
            missing.append(event)
    return missing, skipped


async def create_session_summaries(
    db: AsyncIOMotorDatabase,
    *,
    class_id: str,
    student_ids_by_session: dict[str, set[str]],
) -> int:
    updated = 0
    for session_id, student_ids in student_ids_by_session.items():
        for student_id in student_ids:
            await build_session_reward_summary(
                db,
                student_id=student_id,
                class_id=class_id,
                session_id=session_id,
            )
            updated += 1
    return updated


async def ledger_totals(
    db: AsyncIOMotorDatabase,
    *,
    student_id: str,
    class_id: str | None,
) -> dict[str, int]:
    match: dict[str, Any] = {"student_id": student_id}
    if class_id:
        match["class_id"] = class_id
    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": None,
                "xp": {"$sum": "$xp_delta"},
                "stars": {"$sum": "$stars_delta"},
            }
        },
    ]
    rows = await db[MongoCollections.gamification_events].aggregate(pipeline).to_list(length=1)
    if not rows:
        return {"xp": 0, "stars": 0}
    row = rows[0]
    return {"xp": int(row.get("xp") or 0), "stars": int(row.get("stars") or 0)}


async def reconcile_profile_from_events(
    db: AsyncIOMotorDatabase,
    *,
    student_id: str,
    class_id: str | None,
) -> bool:
    profile = await get_gamification_profile(db, student_id, class_id)
    totals = await ledger_totals(db, student_id=student_id, class_id=class_id)
    legacy_stars = await legacy_star_total(db, student_id, class_id)
    target_xp = max(int(profile.xp or 0), int(totals["xp"] or 0))
    target_stars = max(int(profile.stars or 0), int(totals["stars"] or 0), int(legacy_stars or 0) + int(totals["stars"] or 0))
    target_level = calculate_level(target_xp)
    if target_xp == int(profile.xp or 0) and target_stars == int(profile.stars or 0) and target_level == int(profile.level or 1):
        return False

    await db[MongoCollections.student_gamification_profiles].update_one(
        {"profile_id": build_profile_id(student_id, class_id)},
        {
            "$set": {
                "student_id": student_id,
                "class_id": class_id,
                "scope": profile_type(class_id),
                "xp": target_xp,
                "stars": target_stars,
                "level": target_level,
                "leaderboard_score": (target_xp * 1000) + target_stars,
                "updated_at": utc_now(),
            },
            "$setOnInsert": {"created_at": utc_now()},
        },
        upsert=True,
    )
    if class_id is None:
        await sync_user_gamification_totals(db, student_id)
    return True


async def reconcile_profiles_for_students(
    db: AsyncIOMotorDatabase,
    *,
    student_ids: set[str],
    class_id: str | None,
) -> int:
    changed = 0
    for student_id in student_ids:
        if await reconcile_profile_from_events(db, student_id=student_id, class_id=class_id):
            changed += 1
        if class_id and await reconcile_profile_from_events(db, student_id=student_id, class_id=None):
            changed += 1
    return changed


def student_ids_by_finished_session(events: list[dict]) -> dict[str, set[str]]:
    result: dict[str, set[str]] = defaultdict(set)
    for event in events:
        if event.get("event_type") == "complete_session" and event.get("session_id") and event.get("student_id"):
            result[event["session_id"]].add(event["student_id"])
    return result


async def backfill_gamification_for_class(
    db: AsyncIOMotorDatabase,
    class_id: str,
    *,
    dry_run: bool = False,
) -> dict:
    summary = empty_backfill_summary(dry_run)
    if not class_id:
        summary["warnings"].append("Missing class_id; no backfill was run.")
        return summary

    events, scan_summary, student_ids = await collect_backfill_events(db, class_id=class_id)
    merge_summary(summary, scan_summary)
    missing_events, skipped = await filter_missing_events(db, events)
    summary["events_skipped_existing"] += skipped

    if dry_run:
        summary["events_created"] = len(missing_events)
        summary["profiles_updated"] = len({event["student_id"] for event in missing_events if event.get("student_id")})
        summary["session_summaries_updated"] = len(
            [
                (session_id, student_id)
                for session_id, ids in student_ids_by_finished_session(events).items()
                for student_id in ids
            ]
        )
        return summary

    result = await award_bulk_reward_transaction(
        db,
        reward_events=missing_events,
        transaction_id=f"backfill:class:{class_id}",
        update_streak=False,
    )
    summary["events_created"] += int(result.get("inserted_count") or 0)
    summary["events_skipped_existing"] += int(result.get("skipped_count") or 0)
    inserted_student_ids = {
        event.get("student_id")
        for event in result.get("events", [])
        if event.get("inserted") and event.get("student_id")
    }

    # Backfilled events use current ledger timestamps, so historical streaks are not replayed.
    # Existing profile totals, badges, notifications, and summaries remain idempotent.
    reconciled_profiles = await reconcile_profiles_for_students(
        db,
        student_ids=student_ids | inserted_student_ids,
        class_id=class_id,
    )
    summary["profiles_updated"] += max(len(inserted_student_ids), reconciled_profiles)
    summary["session_summaries_updated"] += await create_session_summaries(
        db,
        class_id=class_id,
        student_ids_by_session=student_ids_by_finished_session(events),
    )
    return summary


async def backfill_gamification_for_student(
    db: AsyncIOMotorDatabase,
    student_id: str,
    class_id: str | None = None,
    *,
    dry_run: bool = False,
) -> dict:
    summary = empty_backfill_summary(dry_run)
    if not student_id:
        summary["warnings"].append("Missing student_id; no backfill was run.")
        return summary

    if class_id:
        events, scan_summary, _student_ids = await collect_backfill_events(db, class_id=class_id, student_id=student_id)
        merge_summary(summary, scan_summary)
        missing_events, skipped = await filter_missing_events(db, events)
        summary["events_skipped_existing"] += skipped
        if dry_run:
            summary["events_created"] = len(missing_events)
            summary["profiles_updated"] = 1 if missing_events else 0
            summary["session_summaries_updated"] = len(
                [
                    (session_id, current_student_id)
                    for session_id, ids in student_ids_by_finished_session(events).items()
                    for current_student_id in ids
                ]
            )
            return summary
        result = await award_bulk_reward_transaction(
            db,
            reward_events=missing_events,
            transaction_id=f"backfill:student:{student_id}:{class_id}",
            update_streak=False,
        )
        summary["events_created"] += int(result.get("inserted_count") or 0)
        summary["events_skipped_existing"] += int(result.get("skipped_count") or 0)
        reconciled_profiles = await reconcile_profiles_for_students(
            db,
            student_ids={student_id},
            class_id=class_id,
        )
        summary["profiles_updated"] += max(1 if result.get("inserted_count") else 0, reconciled_profiles)
        summary["session_summaries_updated"] += await create_session_summaries(
            db,
            class_id=class_id,
            student_ids_by_session=student_ids_by_finished_session(events),
        )
        return summary

    summary["warnings"].append("No class_id supplied; scanning all classes with sessions for this student.")
    class_ids = await db[MongoCollections.sessions].distinct("class_id", {"class_id": {"$ne": None}})
    for current_class_id in sorted(str(value) for value in class_ids if value):
        class_summary = await backfill_gamification_for_student(
            db,
            student_id,
            current_class_id,
            dry_run=dry_run,
        )
        merge_summary(summary, class_summary)
    return summary


async def backfill_gamification_all(
    db: AsyncIOMotorDatabase,
    *,
    dry_run: bool = False,
) -> dict:
    summary = empty_backfill_summary(dry_run)
    class_ids = await db[MongoCollections.sessions].distinct("class_id", {"class_id": {"$ne": None}})
    if not class_ids:
        summary["warnings"].append("No classes with sessions were found.")
        return summary
    for class_id in sorted(str(value) for value in class_ids if value):
        class_summary = await backfill_gamification_for_class(db, class_id, dry_run=dry_run)
        merge_summary(summary, class_summary)
    return summary
