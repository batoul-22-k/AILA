from collections.abc import AsyncIterator
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

from app.config import get_settings


class MongoCollections:
    users = "users"
    classes = "classes"
    class_memberships = "class_memberships"
    lecture_uploads = "lecture_uploads"
    lecture_files = "lecture_files"
    generated_questions = "generated_questions"
    approved_questions = "approved_questions"
    sessions = "sessions"
    responses = "responses"
    student_rewards = "student_rewards"
    student_gamification_profiles = "student_gamification_profiles"
    gamification_events = "gamification_events"
    gamification_badge_definitions = "gamification_badge_definitions"
    student_badges = "student_badges"
    student_missions = "student_missions"
    weekly_challenges = "weekly_challenges"
    student_challenge_progress = "student_challenge_progress"
    session_reward_summaries = "session_reward_summaries"
    achievement_notifications = "achievement_notifications"
    participation_records = "participation_records"
    analytics_results = "analytics_results"
    prediction_features = "prediction_features"
    prediction_results = "prediction_results"
    weak_concept_predictions = "weak_concept_predictions"
    prediction_model_metadata = "prediction_model_metadata"
    admin_alert_reviews = "admin_alert_reviews"
    notifications = "notifications"
    institution_users = "institution_users"


client: AsyncIOMotorClient | None = None


async def connect_to_mongo() -> None:
    global client
    settings = get_settings()
    client = AsyncIOMotorClient(settings.mongodb_uri)
    await client.admin.command("ping")
    await ensure_indexes(client[settings.mongodb_db])


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[MongoCollections.institution_users].create_index(
        [("institution_id", ASCENDING)],
        unique=True,
        name="unique_institution_user_id",
    )
    await db[MongoCollections.institution_users].create_index(
        [("email", ASCENDING)],
        sparse=True,
        name="institution_users_email",
    )
    await db[MongoCollections.users].create_index(
        [("email", ASCENDING)],
        sparse=True,
        name="users_email",
    )
    await db[MongoCollections.users].create_index(
        [("institution_id", ASCENDING)],
        sparse=True,
        name="users_institution_id",
    )
    await db[MongoCollections.classes].create_index(
        [("institution_class_id", ASCENDING)],
        sparse=True,
        name="classes_institution_class_id",
    )
    await db[MongoCollections.classes].create_index(
        [("course_code", ASCENDING), ("section", ASCENDING)],
        sparse=True,
        name="classes_course_section",
    )
    await db[MongoCollections.classes].create_index(
        [("course_code", ASCENDING)],
        sparse=True,
        name="classes_course_code",
    )
    await db[MongoCollections.class_memberships].create_index(
        [("class_id", ASCENDING), ("user_id", ASCENDING), ("role", ASCENDING)],
        name="memberships_class_user_role",
    )

    await db[MongoCollections.student_gamification_profiles].create_index(
        [("profile_id", ASCENDING)],
        unique=True,
        name="unique_profile_id",
    )
    await db[MongoCollections.student_gamification_profiles].create_index(
        [("student_id", ASCENDING), ("scope", ASCENDING), ("class_id", ASCENDING)],
        name="profile_student_scope_class",
    )
    await db[MongoCollections.student_gamification_profiles].create_index(
        [("class_id", ASCENDING), ("xp", DESCENDING), ("stars", DESCENDING), ("student_id", ASCENDING)],
        name="leaderboard_class_xp_stars",
    )
    await db[MongoCollections.student_gamification_profiles].create_index(
        [("scope", ASCENDING), ("xp", DESCENDING), ("stars", DESCENDING), ("student_id", ASCENDING)],
        name="leaderboard_platform_xp_stars",
    )

    await db[MongoCollections.gamification_events].create_index(
        [("event_id", ASCENDING)],
        unique=True,
        name="unique_event_id",
    )
    await db[MongoCollections.gamification_events].create_index(
        [("student_id", ASCENDING), ("created_at", DESCENDING)],
        name="events_student_created",
    )
    await db[MongoCollections.gamification_events].create_index(
        [("class_id", ASCENDING), ("created_at", DESCENDING)],
        name="events_class_created",
    )
    await db[MongoCollections.gamification_events].create_index(
        [("class_id", ASCENDING), ("student_id", ASCENDING), ("created_at", DESCENDING)],
        name="events_class_student_created",
    )
    await db[MongoCollections.gamification_events].create_index(
        [("source_type", ASCENDING), ("source_id", ASCENDING)],
        name="events_source",
    )

    await db[MongoCollections.gamification_badge_definitions].create_index(
        [("badge_key", ASCENDING)],
        unique=True,
        name="unique_badge_key",
    )
    await db[MongoCollections.gamification_badge_definitions].create_index(
        [("enabled", ASCENDING), ("sort_order", ASCENDING), ("badge_key", ASCENDING)],
        name="badge_definitions_enabled_order",
    )

    await db[MongoCollections.student_badges].create_index(
        [("badge_id", ASCENDING)],
        unique=True,
        name="unique_badge_id",
    )
    await db[MongoCollections.student_badges].create_index(
        [("student_id", ASCENDING), ("class_id", ASCENDING), ("unlocked_at", DESCENDING)],
        name="badges_student_class_unlocked",
    )
    await db[MongoCollections.student_badges].create_index(
        [("class_id", ASCENDING), ("badge_key", ASCENDING), ("unlocked_at", DESCENDING)],
        name="badges_class_key_unlocked",
    )

    await db[MongoCollections.student_missions].create_index(
        [("mission_id", ASCENDING)],
        unique=True,
        name="unique_mission_id",
    )
    await db[MongoCollections.student_missions].create_index(
        [("student_id", ASCENDING), ("class_id", ASCENDING), ("date_key", DESCENDING)],
        name="missions_student_class_date",
    )

    await db[MongoCollections.weekly_challenges].create_index(
        [("challenge_id", ASCENDING)],
        unique=True,
        name="unique_weekly_challenge_id",
    )
    await db[MongoCollections.weekly_challenges].create_index(
        [("class_id", ASCENDING), ("week_key", DESCENDING), ("active", ASCENDING)],
        name="weekly_challenges_class_week_active",
    )

    await db[MongoCollections.student_challenge_progress].create_index(
        [("progress_id", ASCENDING)],
        unique=True,
        name="unique_student_challenge_progress_id",
    )
    await db[MongoCollections.student_challenge_progress].create_index(
        [("challenge_id", ASCENDING), ("student_id", ASCENDING)],
        unique=True,
        name="student_challenge_progress_unique",
    )
    await db[MongoCollections.student_challenge_progress].create_index(
        [("student_id", ASCENDING), ("class_id", ASCENDING), ("completed", ASCENDING), ("claimed", ASCENDING)],
        name="student_challenge_progress_status",
    )

    await db[MongoCollections.session_reward_summaries].create_index(
        [("summary_id", ASCENDING)],
        unique=True,
        name="unique_summary_id",
    )
    await db[MongoCollections.session_reward_summaries].create_index(
        [("class_id", ASCENDING), ("session_id", ASCENDING), ("student_id", ASCENDING)],
        name="summaries_class_session_student",
    )
    await db[MongoCollections.session_reward_summaries].create_index(
        [("student_id", ASCENDING), ("created_at", DESCENDING)],
        name="summaries_student_created",
    )

    await db[MongoCollections.achievement_notifications].create_index(
        [("achievement_notification_id", ASCENDING)],
        unique=True,
        name="unique_achievement_notification_id",
    )
    await db[MongoCollections.achievement_notifications].create_index(
        [("student_id", ASCENDING), ("read", ASCENDING), ("created_at", DESCENDING)],
        name="achievement_notifications_student_read_created",
    )
    await db[MongoCollections.achievement_notifications].create_index(
        [("class_id", ASCENDING), ("created_at", DESCENDING)],
        name="achievement_notifications_class_created",
    )

    await db[MongoCollections.notifications].create_index(
        [("notification_id", ASCENDING)],
        unique=True,
        name="unique_notification_id",
    )
    await db[MongoCollections.notifications].create_index(
        [("user_id", ASCENDING), ("read", ASCENDING), ("created_at", DESCENDING)],
        name="notifications_user_read_created",
    )

    await db[MongoCollections.student_rewards].create_index(
        [("student_id", ASCENDING), ("session_id", ASCENDING), ("question_id", ASCENDING)],
        name="student_rewards_student_session_question",
    )
    await db[MongoCollections.student_rewards].create_index(
        [("session_id", ASCENDING), ("stars_earned", DESCENDING)],
        name="student_rewards_session_stars",
    )

    await db[MongoCollections.prediction_features].create_index(
        [("feature_id", ASCENDING)],
        unique=True,
        name="unique_prediction_feature_id",
    )
    await db[MongoCollections.prediction_features].create_index(
        [("class_id", ASCENDING), ("student_id", ASCENDING), ("generated_at", DESCENDING)],
        name="prediction_features_class_student_generated",
    )

    await db[MongoCollections.prediction_results].create_index(
        [("prediction_id", ASCENDING)],
        unique=True,
        name="unique_prediction_id",
    )
    await db[MongoCollections.prediction_results].create_index(
        [("class_id", ASCENDING), ("risk_score", DESCENDING), ("generated_at", DESCENDING)],
        name="prediction_results_class_risk_generated",
    )
    await db[MongoCollections.prediction_results].create_index(
        [("student_id", ASCENDING), ("class_id", ASCENDING), ("generated_at", DESCENDING)],
        name="prediction_results_student_class_generated",
    )

    await db[MongoCollections.weak_concept_predictions].create_index(
        [("weak_concept_prediction_id", ASCENDING)],
        unique=True,
        name="unique_weak_concept_prediction_id",
    )
    await db[MongoCollections.weak_concept_predictions].create_index(
        [("class_id", ASCENDING), ("risk_level", ASCENDING), ("generated_at", DESCENDING)],
        name="weak_concepts_class_risk_generated",
    )

    await db[MongoCollections.prediction_model_metadata].create_index(
        [("model_name", ASCENDING), ("model_version", ASCENDING)],
        unique=True,
        name="unique_prediction_model_version",
    )
    await db[MongoCollections.admin_alert_reviews].create_index(
        [("alert_id", ASCENDING), ("reviewed_by", ASCENDING)],
        unique=True,
        name="unique_admin_alert_review",
    )


async def close_mongo_connection() -> None:
    global client
    if client:
        client.close()
        client = None


def get_database() -> AsyncIOMotorDatabase:
    if client is None:
        raise RuntimeError("MongoDB client is not initialized")
    return client[get_settings().mongodb_db]


async def get_db() -> AsyncIterator[AsyncIOMotorDatabase]:
    yield get_database()
