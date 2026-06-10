from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class ClassCreate(BaseModel):
    name: str
    instructor_id: str | None = None
    instructor_ids: list[str] = Field(default_factory=list)
    description: str | None = None
    semester: str | None = None


class ClassOut(BaseModel):
    class_id: str
    name: str
    description: str | None = None
    semester: str | None = None
    created_by: str
    instructor_ids: list[str] = Field(default_factory=list)
    status: Literal["active", "inactive"] = "active"
    created_at: datetime


class ClassStatusUpdate(BaseModel):
    status: Literal["active", "inactive"]


class ClassStudentOut(BaseModel):
    user_id: str
    name: str
    email: str
    membership_id: str
    status: str = "active"
    joined_at: datetime | None = None


class EnrollStudentRequest(BaseModel):
    user_id: str


class UserOut(BaseModel):
    user_id: str
    name: str
    email: str
    account_role: Literal["student", "instructor", "admin"] = "student"
    created_at: datetime | None = None


class UserCreateRequest(BaseModel):
    name: str
    email: str
    password: str
    account_role: Literal["student", "instructor", "admin"] = "student"


class NotificationOut(BaseModel):
    notification_id: str
    user_id: str
    title: str
    description: str | None = None
    tone: Literal["success", "error", "warning", "info"] = "info"
    read: bool = False
    created_at: datetime


class LoginRequest(BaseModel):
    email: str
    password: str


class ProfileUpdateRequest(BaseModel):
    name: str
    email: str


class WorkspaceOut(BaseModel):
    type: Literal["student", "instructor", "admin"]
    class_id: str | None = None
    class_name: str | None = None
    instructor_name: str | None = None
    joined_at: datetime | None = None
    last_activity_at: datetime | None = None
    label: str | None = None


class LoginResponse(BaseModel):
    user: UserOut
    session_token: str
    workspaces: list[WorkspaceOut]


class LectureUploadOut(BaseModel):
    lecture_file_id: str
    class_id: str
    filename: str
    status: Literal["uploaded"]
    created_at: datetime


class InstructorUploadOut(BaseModel):
    upload_id: str
    instructor_id: str
    class_id: str
    filename: str
    file_type: str
    status: Literal["uploaded", "extracted", "failed"]
    extracted_text: str = ""
    cleaned_text: str = ""
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class InstructorQuestion(BaseModel):
    question_id: str | None = None
    upload_id: str | None = None
    type: Literal["mcq", "short_answer"]
    question_text: str
    options: list[str] = Field(default_factory=list)
    correct_answer: str
    explanation: str
    bloom_level: str
    difficulty: str
    source_slide: int | None = None
    status: Literal["generated", "approved"] = "generated"


class GenerateQuestionsRequest(BaseModel):
    upload_id: str | None = None
    extracted_text: str | None = None
    question_type: Literal["mcq", "short_answer"] | None = None
    bloom_level: str | None = None
    difficulty: str | None = None
    output_language: str | None = None
    question_index: int | None = None
    avoid_questions: list[str] = Field(default_factory=list)


class SaveInstructorQuestionsRequest(BaseModel):
    upload_id: str | None = None
    questions: list[InstructorQuestion]


class RegenerateQuestionRequest(BaseModel):
    upload_id: str | None = None
    question: InstructorQuestion


class ReconstructPresentationRequest(BaseModel):
    upload_id: str
    question_ids: list[str]
    session_code: str | None = None


class ReconstructPresentationOut(BaseModel):
    file_id: str
    filename: str
    download_url: str
    created_at: datetime


class InstructorSessionCreateRequest(BaseModel):
    instructor_id: str
    class_id: str
    question_ids: list[str]
    scheduled_for: datetime | None = None


class InstructorSessionStatusUpdate(BaseModel):
    status: Literal["scheduled", "active", "closed", "finished"]


class ActiveQuestionUpdate(BaseModel):
    question_id: str
    duration_seconds: int | None = None


class InstructorSessionOut(BaseModel):
    session_id: str
    class_id: str
    instructor_id: str
    question_ids: list[str]
    active_question_id: str | None = None
    session_code: str
    join_link: str
    qr_code_base64: str
    status: Literal["scheduled", "active", "closed", "finished"]
    scheduled_for: datetime | None = None
    question_started_at: datetime | None = None
    question_duration_seconds: int | None = None
    question_ends_at: datetime | None = None
    revealed_question_ids: list[str] = Field(default_factory=list)
    created_at: datetime


class GeneratedQuestionIn(BaseModel):
    question_id: str | None = None
    prompt: str
    options: list[str] = Field(default_factory=list)
    correct_answer_placeholder: str | None = None


class SaveGeneratedQuestionsRequest(BaseModel):
    class_id: str
    lecture_file_id: str | None = None
    questions: list[GeneratedQuestionIn]


class GeneratedQuestionOut(GeneratedQuestionIn):
    question_id: str
    class_id: str
    lecture_file_id: str | None = None
    created_at: datetime


class CreateSessionRequest(BaseModel):
    class_id: str
    instructor_id: str
    question_ids: list[str]


class SessionOut(BaseModel):
    session_id: str
    class_id: str
    instructor_id: str
    question_ids: list[str]
    active_question_id: str | None = None
    session_code: str
    status: Literal["active", "closed", "finished"]
    question_started_at: datetime | None = None
    question_duration_seconds: int | None = None
    question_ends_at: datetime | None = None
    revealed_question_ids: list[str] = Field(default_factory=list)
    created_at: datetime


class LiveQuestionOut(BaseModel):
    question_id: str
    type: Literal["mcq", "short_answer"]
    question_text: str
    options: list[str] = Field(default_factory=list)
    bloom_level: str | None = None
    difficulty: str | None = None
    source_slide: int | None = None
    correct_answer: str | None = None
    explanation: str | None = None
    is_revealed: bool = False
    student_answer: str | None = None
    is_correct: bool | None = None
    stars_earned: int = 0
    session_stars: int = 0
    badge_earned: bool = False
    badge_type: str | None = None


class JoinSessionRequest(BaseModel):
    session_code: str
    student_id: str


class SubmitAnswerRequest(BaseModel):
    session_id: str
    question_id: str
    student_id: str
    answer: str


class ResponseOut(BaseModel):
    response_id: str
    session_id: str
    question_id: str
    student_id: str
    answer: str
    semantic_score: float | None = None
    semantic_label: Literal["correct", "partial", "incorrect"] | None = None
    semantic_engine: str | None = None
    is_correct: bool | None = None
    stars_earned: int = 0
    revealed_after_submission: bool = False
    correctness_placeholder: str = "pending"
    response_time_placeholder: float | None = None
    response_time_seconds: float | None = None
    submitted_at: datetime


class LiveSessionStats(BaseModel):
    session_id: str
    participation_count: int
    answer_distribution: dict[str, dict[str, int]]
    correct_counts: dict[str, int] = Field(default_factory=dict)
    incorrect_counts: dict[str, int] = Field(default_factory=dict)
    unanswered_count_placeholder: int
    updated_at: datetime


class AnalyticsResultOut(BaseModel):
    analytics_id: str
    class_id: str
    student_id: str
    week: str
    sessions_attended: int = 0
    total_sessions: int = 0
    attendance_rate: float
    questions_presented: int = 0
    questions_answered: int = 0
    participation_rate: float
    consistency_rate: float
    sessions_with_answers: int = 0
    average_response_time: float = 0.0
    average_semantic_score: float = 0.0
    engagement_score: float
    risk_level: Literal["Low", "Medium", "High"] = "Low"
    risk_reason: str = "On track"
    calculated_at: datetime


class ClassAnalyticsSummaryOut(BaseModel):
    class_id: str
    week: str | None = None
    average_attendance_rate: float
    average_participation_rate: float
    average_engagement_score: float
    total_students: int
    active_students: int
    at_risk_students: int = 0
    weekly_averages: list[dict] = Field(default_factory=list)


class AnalyticsRecalculateOut(BaseModel):
    class_id: str
    calculated_count: int
    total_students: int
    total_sessions: int
    weeks: list[str] = Field(default_factory=list)
    calculated_at: datetime


class StudentProgressOut(BaseModel):
    student_id: str
    class_id: str | None = None
    attendance_rate: float = 0.0
    participation_rate: float = 0.0
    consistency_rate: float = 0.0
    engagement_score: float = 0.0
    risk_level: Literal["Low", "Medium", "High"] = "Low"
    sessions_attended: int = 0
    total_sessions: int = 0
    questions_answered: int = 0
    questions_presented: int = 0
    sessions_with_answers: int = 0
    weekly_trend: list[dict] = Field(default_factory=list)


class PredictionResultOut(BaseModel):
    prediction_id: str
    student_id: str
    class_id: str
    predicted_performance: float
    risk_probability: float
    predicted_at: datetime
    features: dict = Field(default_factory=dict)


class AtRiskStudentOut(BaseModel):
    student_id: str
    student_name: str
    email: str | None = None
    class_id: str
    class_name: str
    week: str | None = None
    attendance_rate: float
    participation_rate: float
    consistency_rate: float
    engagement_score: float
    risk_level: Literal["Low", "Medium", "High"]
    risk_reason: str
    sessions_attended: int
    total_sessions: int
    questions_answered: int
    questions_presented: int
    sessions_with_answers: int
    weekly_history: list[dict] = Field(default_factory=list)


class DashboardSummary(BaseModel):
    active_sessions: int
    total_classes: int
    total_responses: int
    engagement_rate_placeholder: float
