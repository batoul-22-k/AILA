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
    course_code: str | None = None
    section: str | None = None
    department: str | None = None
    year: str | None = None
    institution_class_id: str | None = None


class ClassOut(BaseModel):
    class_id: str
    name: str
    description: str | None = None
    semester: str | None = None
    course_code: str | None = None
    section: str | None = None
    department: str | None = None
    year: str | None = None
    institution_class_id: str | None = None
    created_by: str
    instructor_ids: list[str] = Field(default_factory=list)
    status: Literal["active", "inactive"] = "active"
    created_at: datetime


class ClassStatusUpdate(BaseModel):
    status: Literal["active", "inactive", "Active", "Inactive"]


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
    global_role: str | None = None
    full_name: str | None = None
    institution_id: str | None = None
    department: str | None = None
    class_id: str | None = None
    class_name: str | None = None
    is_active: bool = True
    must_change_password: bool = False
    created_by_sync: bool = False
    sync_source: str | None = None
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
    instructor_feedback: str | None = None


class JoinSessionRequest(BaseModel):
    session_code: str
    student_id: str


class SubmitAnswerRequest(BaseModel):
    session_id: str
    question_id: str
    student_id: str
    answer: str


class AiEvaluationOut(BaseModel):
    semanticSimilarity: float = 0.0
    conceptCoverage: float = 0.0
    finalScore: float = 0.0
    label: Literal["correct", "partial", "incorrect"] = "incorrect"
    engine: str | None = None
    weights: dict = Field(default_factory=dict)
    evaluatedAt: datetime | None = None


class InstructorReviewOut(BaseModel):
    reviewed: bool = False
    finalScore: float | None = None
    finalLabel: Literal["correct", "partial", "incorrect"] | None = None
    feedback: str = ""
    showToStudent: bool = False
    reviewedBy: str | None = None
    reviewedAt: datetime | None = None


class InstructorReviewRequest(BaseModel):
    finalScore: float
    finalLabel: Literal["correct", "partial", "incorrect"]
    feedback: str = ""
    showToStudent: bool = False


class ResponseOut(BaseModel):
    response_id: str
    session_id: str
    question_id: str
    student_id: str
    answer: str
    semantic_score: float | None = None
    semantic_label: Literal["correct", "partial", "incorrect"] | None = None
    semantic_engine: str | None = None
    semantic_similarity: float | None = None
    concept_coverage: float | None = None
    final_score: float | None = None
    aiEvaluation: AiEvaluationOut | None = None
    instructorReview: InstructorReviewOut = Field(default_factory=InstructorReviewOut)
    is_correct: bool | None = None
    stars_earned: int = 0
    revealed_after_submission: bool = False
    correctness_placeholder: str = "pending"
    response_time_placeholder: float | None = None
    response_time_seconds: float | None = None
    submitted_at: datetime


class GamificationProfileOut(BaseModel):
    profile_id: str
    student_id: str
    class_id: str | None = None
    scope: Literal["platform", "class"] = "platform"
    xp: int = 0
    level: int = 1
    stars: int = 0
    platform_xp: int | None = None
    platform_level: int | None = None
    platform_stars: int | None = None
    current_streak: int = 0
    longest_streak: int = 0
    correct_streak: int = 0
    session_streak: int = 0
    badges_count: int = 0
    next_level_xp: int | None = 100
    current_level_xp: int = 0
    current_level_progress: int = 0
    xp_to_next_level: int = 100
    level_progress_percent: float = 0.0
    updated_at: datetime


class GamificationMeOut(GamificationProfileOut):
    platform_profile: GamificationProfileOut
    class_profile: GamificationProfileOut | None = None
    recent_notifications_count: int = 0


class GamificationEventOut(BaseModel):
    event_id: str
    student_id: str
    class_id: str | None = None
    session_id: str | None = None
    question_id: str | None = None
    source_type: str | None = None
    source_id: str | None = None
    event_type: str
    xp_delta: int = 0
    stars_delta: int = 0
    idempotency_key: str
    metadata: dict = Field(default_factory=dict)
    created_at: datetime


class StudentBadgeOut(BaseModel):
    badge_id: str
    student_id: str
    class_id: str | None = None
    badge_key: str
    title: str
    description: str
    icon: str
    unlocked_at: datetime
    source_session_id: str | None = None
    source_type: str | None = None
    source_id: str | None = None


class AchievementNotificationOut(BaseModel):
    achievement_notification_id: str
    student_id: str
    class_id: str | None = None
    achievement_type: Literal["badge", "level", "streak", "mission", "session_reward", "reward"]
    achievement_key: str
    title: str
    description: str
    icon: str | None = None
    source_type: str | None = None
    source_id: str | None = None
    read: bool = False
    created_at: datetime


class MissionTaskOut(BaseModel):
    key: str
    label: str
    target: int
    progress: int = 0
    completed: bool = False


class MissionRewardOut(BaseModel):
    xp: int = 0
    stars: int = 0


class StudentMissionOut(BaseModel):
    mission_id: str
    student_id: str
    class_id: str | None = None
    date_key: str
    title: str
    tasks: list[MissionTaskOut] = Field(default_factory=list)
    reward: MissionRewardOut = Field(default_factory=MissionRewardOut)
    completed: bool = False
    claimed: bool = False
    progress_percentage: float = 0.0
    created_at: datetime
    completed_at: datetime | None = None


class MissionClaimOut(BaseModel):
    mission: StudentMissionOut
    profile: GamificationProfileOut
    reward: MissionRewardOut
    inserted: bool = False


class BadgeCatalogItemOut(BaseModel):
    badge_key: str
    title: str
    description: str
    icon: str
    earned: bool = False
    progress: int = 0
    target: int = 1
    progress_percentage: float = 0.0
    unlocked_at: datetime | None = None


class GamificationBadgesOut(BaseModel):
    earned: list[StudentBadgeOut] = Field(default_factory=list)
    unlocked: list[StudentBadgeOut] = Field(default_factory=list)
    locked: list[BadgeCatalogItemOut] = Field(default_factory=list)


class GamificationHistoryEventOut(BaseModel):
    event_type: str
    xp_delta: int = 0
    stars_delta: int = 0
    created_at: datetime
    source_type: str | None = None
    source_id: str | None = None


class LeaderboardRowOut(BaseModel):
    rank: int
    student_id: str
    student_name: str
    level: int = 1
    xp: int = 0
    stars: int = 0
    badges_count: int = 0
    streak: int = 0
    is_current_student: bool = False


class GamificationLeaderboardOut(BaseModel):
    class_id: str
    period: Literal["weekly", "monthly", "all_time"] = "weekly"
    rows: list[LeaderboardRowOut] = Field(default_factory=list)
    current_student_rank: int | None = None


class StudentChallengeProgressOut(BaseModel):
    progress_id: str
    challenge_id: str
    student_id: str
    class_id: str
    progress: int = 0
    completed: bool = False
    claimed: bool = False
    completed_at: datetime | None = None
    claimed_at: datetime | None = None


class WeeklyChallengeOut(BaseModel):
    challenge_id: str
    class_id: str
    week_key: str
    title: str
    description: str
    metric_type: Literal["answer_question", "correct_answer", "join_session", "stars_earned", "streak_days"]
    target: int
    reward: MissionRewardOut = Field(default_factory=MissionRewardOut)
    active: bool = True
    created_at: datetime
    expires_at: datetime


class WeeklyChallengeWithProgressOut(WeeklyChallengeOut):
    progress: StudentChallengeProgressOut
    progress_percentage: float = 0.0


class WeeklyChallengesOut(BaseModel):
    class_id: str
    week_key: str
    challenges: list[WeeklyChallengeWithProgressOut] = Field(default_factory=list)


class ChallengeClaimOut(BaseModel):
    challenge: WeeklyChallengeWithProgressOut
    profile: GamificationProfileOut
    reward: MissionRewardOut
    inserted: bool = False


class SessionRewardSummaryOut(BaseModel):
    summary_id: str
    student_id: str
    class_id: str
    session_id: str
    source_session_id: str | None = None
    xp_earned: int = 0
    stars_earned: int = 0
    badges_unlocked: int = 0
    new_badges: list[StudentBadgeOut] = Field(default_factory=list)
    current_streak: int = 0
    longest_streak: int = 0
    level_before: int = 1
    level_after: int = 1
    leveled_up: bool = False
    created_at: datetime


class LiveSessionStats(BaseModel):
    session_id: str
    participation_count: int
    answer_distribution: dict[str, dict[str, int]]
    correct_counts: dict[str, int] = Field(default_factory=dict)
    incorrect_counts: dict[str, int] = Field(default_factory=dict)
    semantic_counts: dict[str, dict[str, int]] = Field(default_factory=dict)
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
    correctness_rate: float = 0.0
    consistency_rate: float
    recent_activity_score: float = 0.0
    sessions_with_answers: int = 0
    average_response_time: float = 0.0
    average_semantic_score: float = 0.0
    engagement_score: float
    risk_score: float = 0.0
    risk_level: Literal["Low", "Medium", "High", "Critical"] = "Low"
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
    risk_level: Literal["Low", "Medium", "High", "Critical"] = "Low"
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
    risk_level: Literal["low", "medium", "high"] = "low"
    risk_probability: float
    confidence: float = 0.0
    engagement_index: float = 0.0
    derived_engagement_index: float = 0.0
    engagement_status: str = "steady"
    academic_status: str = "on_track"
    risk_reasons: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    feature_importance: list[dict] = Field(default_factory=list)
    model_feature_values: dict = Field(default_factory=dict)
    engagement_context: dict = Field(default_factory=dict)
    explanation: dict = Field(default_factory=dict)
    predicted_performance: float | None = None
    predicted_score: float | None = None
    performance_level: str | None = None
    model_confidence: float | None = None
    reasons: list[str] = Field(default_factory=list)
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
    correctness_rate: float = 0.0
    consistency_rate: float
    recent_activity_score: float = 0.0
    engagement_score: float
    learning_health_score: float = 0.0
    risk_score: float = 0.0
    risk_level: Literal["Low", "Medium", "High", "Critical"]
    risk_reason: str
    last_active_at: datetime | None = None
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
