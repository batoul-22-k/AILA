from collections.abc import AsyncIterator
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

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
    participation_records = "participation_records"
    analytics_results = "analytics_results"
    prediction_results = "prediction_results"
    notifications = "notifications"


client: AsyncIOMotorClient | None = None


async def connect_to_mongo() -> None:
    global client
    settings = get_settings()
    client = AsyncIOMotorClient(settings.mongodb_uri)
    await client.admin.command("ping")


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
