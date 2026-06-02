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
    global_role: Literal["user", "admin"] = "user"


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


class ReconstructPresentationOut(BaseModel):
    file_id: str
    filename: str
    download_url: str
    created_at: datetime


class InstructorSessionCreateRequest(BaseModel):
    instructor_id: str
    class_id: str
    question_ids: list[str]


class InstructorSessionStatusUpdate(BaseModel):
    status: Literal["active", "closed"]


class InstructorSessionOut(BaseModel):
    session_id: str
    class_id: str
    instructor_id: str
    question_ids: list[str]
    session_code: str
    join_link: str
    qr_code_base64: str
    status: Literal["active", "closed"]
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
    session_code: str
    status: Literal["active", "closed"]
    created_at: datetime


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
    correctness_placeholder: str = "pending"
    response_time_placeholder: float | None = None
    submitted_at: datetime


class LiveSessionStats(BaseModel):
    session_id: str
    participation_count: int
    answer_distribution: dict[str, dict[str, int]]
    unanswered_count_placeholder: int
    updated_at: datetime


class DashboardSummary(BaseModel):
    active_sessions: int
    total_classes: int
    total_responses: int
    engagement_rate_placeholder: float
