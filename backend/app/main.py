from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, ai, analytics, auth, classes, dashboards, gamification, instructor, lecture_uploads, notifications, predictions, progress, questions, responses, sessions, users
from app.config import get_settings
from app.database import close_mongo_connection, connect_to_mongo


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_to_mongo()
    yield
    await close_mongo_connection()


settings = get_settings()

app = FastAPI(
    title="AILA - AI-Powered Interactive Learning Analytics",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(instructor.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(analytics.router)
app.include_router(classes.router, prefix="/api")
app.include_router(lecture_uploads.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(progress.router, prefix="/api")
app.include_router(gamification.router, prefix="/api")
app.include_router(predictions.router, prefix="/api")
app.include_router(questions.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(responses.router, prefix="/api")
app.include_router(dashboards.router, prefix="/api")
app.include_router(sessions.ws_router)


@app.get("/health")
async def health_check() -> dict:
    return {"status": "ok"}
