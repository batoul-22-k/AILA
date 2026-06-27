import { Activity, AlertCircle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Copy, Eye, Layers, MessageCircle, Play, QrCode, RefreshCw, Search, Timer, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { correctShortAnswerResponses, finishLiveSession, getInstructorSession, getLiveSessionQuestions, getLiveSessionResponseDetails, getLiveSessionStats, getWebSocketUrl, revealSessionQuestion, updateInstructorActiveQuestion, updateInstructorReview } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/ToastProvider";

const PLACEHOLDER_ANSWERS = ["A", "B", "C", "D"];

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function secondsUntil(value) {
  if (!value) return 0;
  const normalizedValue = typeof value === "string" && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? `${value}Z` : value;
  const endTime = new Date(normalizedValue).getTime();
  if (Number.isNaN(endTime)) return 0;
  return Math.max(Math.ceil((endTime - Date.now()) / 1000), 0);
}

function getSessionStatusTone(status) {
  if (status === "active") return "green";
  if (status === "scheduled") return "gold";
  if (status === "finished") return "emerald";
  return "slate";
}

function getSessionStatusLabel(status) {
  if (status === "active") return "Active";
  if (status === "scheduled") return "Scheduled";
  if (status === "closed") return "Stopped";
  if (status === "finished") return "Finished";
  return status || "Unknown";
}

function PerfectMetricIndicator({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-black text-emerald-700 dark:text-emerald-100 ${className}`}
      title="Perfect score"
      aria-label="100%. Perfect score"
    >
      <CheckCircle2 size={15} className="text-emerald-500 dark:text-emerald-300" />
      100%
    </span>
  );
}

function ZeroMetricIndicator({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-black text-red-700 dark:text-red-100 ${className}`}
      title="No activity recorded"
      aria-label="0%. No activity recorded"
    >
      <AlertCircle size={15} className="text-red-400 dark:text-red-300" />
      0%
    </span>
  );
}

function MetricProgressLine({ percentage, barClass = "bg-role-primary" }) {
  if (percentage >= 100) {
    return <PerfectMetricIndicator className="mt-3" />;
  }
  if (percentage <= 0) {
    return <ZeroMetricIndicator className="mt-3" />;
  }
  return (
    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-full ${barClass}`} style={{ width: `${percentage}%` }} />
    </div>
  );
}

function studentCountLabel(count) {
  return `${count} student${count === 1 ? "" : "s"}`;
}

function getCorrectAnswerDisplay(question) {
  if (!question?.correct_answer) return "Not set";
  const correctAnswer = String(question.correct_answer).trim();
  const optionIndex = question.options?.findIndex((option) => option.trim().toLowerCase() === correctAnswer.toLowerCase()) ?? -1;
  if (optionIndex >= 0) return `${String.fromCharCode(65 + optionIndex)}. ${question.options[optionIndex]}`;
  if (/^[A-Z]$/i.test(correctAnswer) && question.options?.length) {
    const index = correctAnswer.toUpperCase().charCodeAt(0) - 65;
    if (question.options[index]) return `${correctAnswer.toUpperCase()}. ${question.options[index]}`;
  }
  return correctAnswer;
}

function isCorrectAnswerOption(question, answer, fallbackIndex) {
  if (!question?.correct_answer) return false;
  const correctAnswer = String(question.correct_answer).trim();
  const normalizedAnswer = String(answer).trim();
  const option = question.options?.[fallbackIndex]?.trim() || "";
  return (
    normalizedAnswer.toLowerCase() === correctAnswer.toLowerCase()
    || option.toLowerCase() === correctAnswer.toLowerCase()
    || (/^[A-Z]$/i.test(correctAnswer) && normalizedAnswer.toUpperCase() === correctAnswer.toUpperCase())
  );
}

function InstructorReviewPanel({ student, saving, onSave }) {
  const aiEvaluation = student.aiEvaluation || {};
  const review = student.instructorReview || {};
  const initialScore = Math.round(((review.reviewed ? review.finalScore : aiEvaluation.finalScore) ?? student.semantic_score ?? 0) * 100);
  const initialLabel = (review.reviewed ? review.finalLabel : aiEvaluation.label) || student.semantic_label || "incorrect";
  const [score, setScore] = useState(initialScore);
  const [label, setLabel] = useState(initialLabel);
  const [feedback, setFeedback] = useState(review.feedback || "");
  const [showToStudent, setShowToStudent] = useState(Boolean(review.showToStudent));
  const aiScore = Math.round(((aiEvaluation.finalScore ?? student.semantic_score ?? 0) || 0) * 100);
  const aiLabel = aiEvaluation.label || student.semantic_label || "incorrect";

  function acceptAi() {
    setScore(aiScore);
    setLabel(aiLabel);
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Instructor review</p>
        <button type="button" className="text-xs font-bold text-role-primary hover:underline" onClick={acceptAi}>
          Accept AI
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[7rem_9rem_minmax(0,1fr)]">
        <label className="grid gap-1 text-xs font-bold text-slate-500 dark:text-slate-400">
          Score
          <input
            className="adaptive-input focus-ring h-9 rounded-lg border border-role-border px-2 text-sm dark:border-slate-800"
            type="number"
            min="0"
            max="100"
            value={score}
            onChange={(event) => setScore(Math.max(0, Math.min(100, Number(event.target.value || 0))))}
          />
        </label>
        <label className="grid gap-1 text-xs font-bold text-slate-500 dark:text-slate-400">
          Label
          <select
            className="adaptive-input focus-ring h-9 rounded-lg border border-role-border px-2 text-sm dark:border-slate-800"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          >
            <option value="correct">Correct</option>
            <option value="partial">Partial</option>
            <option value="incorrect">Needs review</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold text-slate-500 dark:text-slate-400">
          Feedback
          <textarea
            className="adaptive-input focus-ring min-h-9 rounded-lg border border-role-border px-2 py-2 text-sm dark:border-slate-800"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Optional feedback"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-role-primary"
            checked={showToStudent}
            onChange={(event) => setShowToStudent(event.target.checked)}
          />
          Show to student
        </label>
        <Button
          type="button"
          size="sm"
          variant="role"
          loading={saving}
          disabled={!student.response_id}
          onClick={() => onSave(student.response_id, {
            finalScore: Number(score || 0) / 100,
            finalLabel: label,
            feedback,
            showToStudent,
          })}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function responseResult(student) {
  if (student.status === "not_answered") {
    return {
      label: "Not Answered",
      className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200",
    };
  }
  if (student.is_correct === true) {
    return {
      label: "Correct",
      className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-100",
    };
  }
  if (student.semantic_label === "partial") {
    return {
      label: "Partial",
      className: "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-100",
    };
  }
  return {
    label: "Needs Review",
    className: "bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-100",
  };
}

function semanticLabelDisplay(label) {
  if (label === "correct") return "Correct";
  if (label === "partial") return "Partial";
  if (label === "incorrect") return "Needs Review";
  return "Not evaluated";
}

function responseMatch(student) {
  if (typeof student.semantic_score === "number") return Math.round(student.semantic_score * 100);
  if (student.status === "not_answered") return null;
  if (student.is_correct === true) return 100;
  if (student.is_correct === false) return 0;
  return null;
}

function responseAnswerText(student) {
  if (student.status === "not_answered") return "No answer submitted.";
  const answer = String(student.selected_answer ?? "").trim();
  return answer || "Answer unavailable.";
}

function responseEngineLabel(engine) {
  if (!engine) return "Not evaluated";
  if (engine.includes("sentence-transformers") || engine === "embedding") return "Semantic check";
  if (engine === "empty") return "Empty answer";
  return "Lexical check";
}

function ResponseSummary({ summary, fallback }) {
  const responseRate = summary?.response_rate ?? fallback.responseRate;
  const answered = summary?.answered ?? fallback.answered;
  const total = summary?.total_students ?? fallback.total;
  const correct = summary?.correct ?? fallback.correct;
  const partial = summary?.partial ?? fallback.partial;
  const needsReview = summary?.incorrect ?? fallback.needsReview;
  const notAnswered = summary?.not_answered ?? fallback.notAnswered;

  return (
    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-slate-500 dark:text-slate-400">Response Rate</span>
        <span className="text-lg font-semibold tracking-tight text-slate-950 dark:text-white">{responseRate}%</span>
        <span className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
        <span className="font-medium text-slate-500 dark:text-slate-400">{answered}/{total} answered</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
        <span className="text-emerald-700 dark:text-emerald-100">Correct {correct}</span>
        <span>·</span>
        <span className="text-amber-700 dark:text-amber-100">Partial {partial}</span>
        <span>·</span>
        <span className="text-rose-700 dark:text-rose-100">Review {needsReview}</span>
        <span>·</span>
        <span>Waiting {notAnswered}</span>
      </div>
    </div>
  );
}

function ResponseFilters({
  status,
  correctness,
  search,
  isShortAnswerQuestion,
  onStatusChange,
  onCorrectnessChange,
  onSearchChange,
}) {
  return (
    <div className="grid gap-2">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
        <input
          className="adaptive-input focus-ring h-10 w-full rounded-xl border border-role-border bg-white pl-9 pr-3 text-sm shadow-none dark:border-slate-800 dark:bg-slate-900"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search student or answer"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Status</span>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["all", "All"],
            ["answered", "Answered"],
            ["not_answered", "Waiting"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                status === value
                  ? "border-role-primary bg-role-soft text-role-primary"
                  : "border-role-border bg-white text-slate-500 hover:border-role-primary hover:text-role-primary dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              }`}
              onClick={() => onStatusChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Result</span>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["", "All Results"],
            ["correct", "Correct"],
            ...(isShortAnswerQuestion ? [["partial", "Partial"]] : []),
            ["incorrect", "Needs Review"],
          ].map(([value, label]) => (
            <button
              key={value || "all-results"}
              type="button"
              disabled={status === "not_answered" && value !== ""}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                correctness === value
                  ? "border-role-primary bg-role-soft text-role-primary"
                  : "border-role-border bg-white text-slate-500 hover:border-role-primary hover:text-role-primary dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              }`}
              onClick={() => onCorrectnessChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResponseDetails({ student, isShortAnswerQuestion, savingReviewId, onSaveReview, expanded }) {
  if (!expanded) return null;
  const match = responseMatch(student);

  return (
    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/50">
      <div className="grid gap-2 text-xs text-slate-500 dark:text-slate-400">
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          <p><span className="font-semibold text-slate-700 dark:text-slate-200">Student ID:</span> {student.student_id}</p>
          <p><span className="font-semibold text-slate-700 dark:text-slate-200">Method:</span> {responseEngineLabel(student.semantic_engine)}</p>
          {student.email && <p><span className="font-semibold text-slate-700 dark:text-slate-200">Email:</span> {student.email}</p>}
          {student.confidence_level && <p><span className="font-semibold text-slate-700 dark:text-slate-200">Confidence:</span> {student.confidence_level}</p>}
          {match !== null && <p><span className="font-semibold text-slate-700 dark:text-slate-200">Raw score:</span> {match}%</p>}
          {student.aiEvaluation?.semanticSimilarity !== undefined && (
            <p><span className="font-semibold text-slate-700 dark:text-slate-200">Semantic:</span> {Math.round(student.aiEvaluation.semanticSimilarity * 100)}%</p>
          )}
          {student.aiEvaluation?.conceptCoverage !== undefined && (
            <p><span className="font-semibold text-slate-700 dark:text-slate-200">Concept match:</span> {Math.round(student.aiEvaluation.conceptCoverage * 100)}%</p>
          )}
          {student.aiEvaluation?.label && (
            <p><span className="font-semibold text-slate-700 dark:text-slate-200">AI label:</span> {semanticLabelDisplay(student.aiEvaluation.label)}</p>
          )}
        </div>
        {isShortAnswerQuestion && student.status === "answered" && (
          <InstructorReviewPanel
            key={`${student.response_id}:${student.instructorReview?.reviewedAt || ""}:${student.semantic_score ?? ""}`}
            student={student}
            saving={savingReviewId === student.response_id}
            onSave={onSaveReview}
          />
        )}
      </div>
    </div>
  );
}

function StudentResponseCard({ student, isShortAnswerQuestion, savingReviewId, onSaveReview, formatSubmittedAt }) {
  const [expandedAnswer, setExpandedAnswer] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const result = responseResult(student);
  const match = responseMatch(student);
  const answer = responseAnswerText(student);
  const answerIsLong = answer.length > 150;

  return (
    <article className="rounded-2xl border border-slate-100 bg-white p-3 shadow-[0_6px_18px_rgba(15,23,42,0.03)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{student.student_name}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold leading-none ${result.className}`}>
          {result.label}
        </span>
      </div>

      <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/50">
        <p
          className="break-words text-sm font-medium leading-5 text-slate-800 dark:text-slate-100"
          style={expandedAnswer ? undefined : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          "{answer}"
        </p>
        {answerIsLong && (
          <button
            type="button"
            className="mt-1 text-xs font-semibold text-role-primary hover:underline"
            onClick={() => setExpandedAnswer((current) => !current)}
          >
            {expandedAnswer ? "View less" : "View more"}
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-400">
        <span>Match: <span className="font-semibold text-slate-800 dark:text-slate-100">{match === null ? "—" : `${match}%`}</span></span>
        <span>Submitted: <span className="font-semibold text-slate-800 dark:text-slate-100">{formatSubmittedAt(student.submitted_at)}</span></span>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-role-primary transition hover:text-role-primary-700"
          onClick={() => setDetailsExpanded((current) => !current)}
          aria-expanded={detailsExpanded}
        >
          {detailsExpanded ? "Hide" : "Details"}
          <ChevronDown size={13} className={`transition-transform ${detailsExpanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      <ResponseDetails
        student={student}
        isShortAnswerQuestion={isShortAnswerQuestion}
        savingReviewId={savingReviewId}
        onSaveReview={onSaveReview}
        expanded={detailsExpanded}
      />
    </article>
  );
}

function responseEmptyMessage({ students, loading, status, search, summary }) {
  if (loading || students.length > 0) return "";
  if ((summary?.total_students ?? 0) === 0) return "No students found.";
  if (search.trim()) return "No matching responses.";
  if (status === "not_answered" && (summary?.answered ?? 0) === 0) return "All students are waiting.";
  if ((summary?.answered ?? 0) === 0) return "No responses yet.";
  return "No matching responses.";
}

function ResponsesPanel({
  open,
  title,
  students,
  summary,
  fallback,
  loading,
  status,
  correctness,
  search,
  isShortAnswerQuestion,
  recalculating,
  savingReviewId,
  onClose,
  onRecalculate,
  onStatusChange,
  onCorrectnessChange,
  onSearchChange,
  onSaveReview,
  formatSubmittedAt,
}) {
  if (!open) return null;
  const emptyMessage = responseEmptyMessage({ students, loading, status, search, summary });
  const hasStudents = students.length > 0;
  const showInitialLoading = loading && !hasStudents;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden overscroll-contain">
      <button className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]" type="button" aria-label="Close responses" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-screen w-full max-w-[700px] flex-col overflow-hidden overscroll-contain border-l border-role-border bg-[#F7FAFA] shadow-[0_24px_80px_rgba(15,23,42,0.16)] dark:border-slate-800 dark:bg-slate-950">
        <div className="shrink-0 border-b border-role-border bg-white/95 px-5 py-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex items-center justify-between gap-4">
            <h2 className="min-w-0 truncate text-lg font-semibold text-slate-950 dark:text-white">{title}</h2>
            <div className="flex shrink-0 items-center gap-2">
              {isShortAnswerQuestion && (
                <Button type="button" variant="outline" size="sm" loading={recalculating} onClick={onRecalculate}>
                  Recalculate
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </div>
          </div>
        </div>

        <div className="sticky top-0 z-20 shrink-0 border-b border-role-border bg-[#F7FAFA]/95 px-4 py-3 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95">
          <div className="grid gap-2 rounded-2xl border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <ResponseSummary summary={summary} fallback={fallback} />
            <ResponseFilters
              status={status}
              correctness={correctness}
              search={search}
              isShortAnswerQuestion={isShortAnswerQuestion}
              onStatusChange={onStatusChange}
              onCorrectnessChange={onCorrectnessChange}
              onSearchChange={onSearchChange}
            />
          </div>
        </div>

        <div className="pointer-events-none relative z-10 h-3 shrink-0 bg-gradient-to-b from-[#F7FAFA] to-transparent dark:from-slate-950" />
        <div className="subtle-scroll min-h-0 flex-1 scroll-smooth overscroll-contain overflow-y-auto px-4 pb-8 pr-2" aria-busy={loading ? "true" : undefined}>
          {showInitialLoading && (
            <div className="rounded-2xl border border-slate-100 bg-white p-4 text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              Loading responses...
            </div>
          )}
          {!loading && emptyMessage && (
            <div className="rounded-2xl border border-slate-100 bg-white p-6 text-center text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              {emptyMessage}
            </div>
          )}
          {hasStudents && (
            <div className="grid gap-3">
              {students.map((student) => (
                <StudentResponseCard
                  key={`${student.response_id || student.student_id}:${student.status}:${student.selected_answer || "none"}`}
                  student={student}
                  isShortAnswerQuestion={isShortAnswerQuestion}
                  savingReviewId={savingReviewId}
                  onSaveReview={onSaveReview}
                  formatSubmittedAt={formatSubmittedAt}
                />
              ))}
            </div>
          )}
        </div>
        <div className="pointer-events-none h-4 shrink-0 bg-gradient-to-t from-[#F7FAFA] to-transparent dark:from-slate-950" />
      </aside>
    </div>
  );
}

export function LiveParticipationDashboardPage() {
  const { showToast } = useToast();
  const params = useParams();
  const savedSession = JSON.parse(localStorage.getItem("instructorSession") || "null");
  const sessionId = params.sessionId || savedSession?.session_id;
  const [session, setSession] = useState(savedSession);
  const [stats, setStats] = useState(null);
  const [activeQuestionId, setActiveQuestionId] = useState(() => {
    if (savedSession?.active_question_id) return savedSession.active_question_id;
    return "";
  });
  const [chartQuestionIndex, setChartQuestionIndex] = useState(0);
  const [activatingQuestionId, setActivatingQuestionId] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsStatus, setDetailsStatus] = useState("all");
  const [detailsAnswer, setDetailsAnswer] = useState("");
  const [detailsCorrectness, setDetailsCorrectness] = useState("");
  const [detailsSearch, setDetailsSearch] = useState("");
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsData, setDetailsData] = useState(null);
  const [liveQuestions, setLiveQuestions] = useState([]);
  const [revealingQuestionId, setRevealingQuestionId] = useState("");
  const [correctingQuestionId, setCorrectingQuestionId] = useState("");
  const [finishingSession, setFinishingSession] = useState(false);
  const [summaryPreviewData, setSummaryPreviewData] = useState({});
  const [summaryPreviewLoading, setSummaryPreviewLoading] = useState({});
  const [savingReviewId, setSavingReviewId] = useState("");
  const [timerMinutes, setTimerMinutes] = useState(() => Math.round((savedSession?.question_duration_seconds || 180) / 60));
  const [dashboardTimeLeft, setDashboardTimeLeft] = useState(() => secondsUntil(savedSession?.question_ends_at));
  const [timerModalOpen, setTimerModalOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function load(showError = true) {
      if (!sessionId) return;
      try {
        const [sessionResult, statsResult, questionsResult] = await Promise.all([
          getInstructorSession(sessionId),
          getLiveSessionStats(sessionId),
          getLiveSessionQuestions(sessionId),
        ]);
        if (isMounted) {
          setSession(sessionResult);
          setStats(statsResult);
          setLiveQuestions(questionsResult);
          setActiveQuestionId(sessionResult.active_question_id || "");
        }
      } catch (err) {
        if (showError && isMounted) {
          showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not load live session", tone: "error" });
        }
      }
    }

    load();
    const refreshInterval = window.setInterval(() => load(false), 5000);
    return () => {
      isMounted = false;
      window.clearInterval(refreshInterval);
    };
  }, [sessionId, showToast]);

  useEffect(() => {
    if (!sessionId) return undefined;
    let socket;
    try {
      socket = new WebSocket(getWebSocketUrl(sessionId));
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "session_stats") {
            setStats(message.payload);
          }
          if (message.type === "active_question" || message.type === "question_active") {
            const nextQuestionId = message.payload?.question_id || "";
            setActiveQuestionId(nextQuestionId);
            setSession((current) => (
              current && nextQuestionId
                ? {
                    ...current,
                    active_question_id: nextQuestionId,
                    question_started_at: message.payload?.question_started_at || current.question_started_at,
                    question_duration_seconds: Object.prototype.hasOwnProperty.call(message.payload || {}, "question_duration_seconds")
                      ? message.payload.question_duration_seconds
                      : current.question_duration_seconds,
                    question_ends_at: Object.prototype.hasOwnProperty.call(message.payload || {}, "question_ends_at")
                      ? message.payload.question_ends_at
                      : current.question_ends_at,
                  }
                : current
            ));
            if (message.payload?.question_duration_seconds) {
              setTimerMinutes(Math.max(0.25, Math.round((message.payload.question_duration_seconds / 60) * 100) / 100));
            }
            setDashboardTimeLeft(secondsUntil(message.payload?.question_ends_at));
            if (message.payload?.stats) setStats(message.payload.stats);
          }
          if (message.type === "response_submitted" && message.payload?.stats) {
            setStats(message.payload.stats);
          }
          if (message.type === "short_answers_corrected" && message.payload?.stats) {
            setStats(message.payload.stats);
            setSummaryPreviewData({});
          }
          if (message.type === "instructor_review_updated" && message.payload?.stats) {
            setStats(message.payload.stats);
            setSummaryPreviewData({});
          }
          if (message.type === "answer_revealed") {
            if (message.payload?.stats) setStats(message.payload.stats);
            setLiveQuestions((current) => current.map((question) => (
              question.question_id === message.payload?.question_id
                ? { ...question, is_revealed: true, correct_answer: message.payload.correct_answer, explanation: message.payload.explanation }
                : question
            )));
          }
          if (message.type === "session_finished") {
            setSession((current) => (current ? { ...current, status: "finished" } : current));
          }
        } catch {
          // Ignore malformed websocket payloads; polling remains as a fallback.
        }
      };
    } catch {
      return undefined;
    }
    return () => socket?.close();
  }, [sessionId]);

  const questionIds = session?.question_ids || [];
  const questionKey = questionIds.join("|");
  const chartQuestionIds = questionIds.slice(0, 4);
  const chartQuestionId = chartQuestionIds[chartQuestionIndex] || "";
  const chartDistribution = chartQuestionId ? (stats?.answer_distribution?.[chartQuestionId] ?? {}) : {};
  const chartQuestion = liveQuestions.find((question) => question.question_id === chartQuestionId);
  const isShortAnswerQuestion = chartQuestion?.type === "short_answer";
  const chartTotal = Object.values(chartDistribution).reduce((sum, value) => sum + value, 0);
  const correctCount = chartQuestionId ? (stats?.correct_counts?.[chartQuestionId] ?? 0) : 0;
  const incorrectCount = chartQuestionId ? (stats?.incorrect_counts?.[chartQuestionId] ?? 0) : 0;
  const semanticCounts = chartQuestionId ? (stats?.semantic_counts?.[chartQuestionId] ?? {}) : {};
  const semanticCorrectCount = semanticCounts.correct ?? correctCount;
  const semanticPartialCount = semanticCounts.partial ?? 0;
  const semanticIncorrectCount = semanticCounts.incorrect ?? incorrectCount;
  const scoredShortAnswerCount = (semanticCounts.correct ?? 0) + (semanticCounts.partial ?? 0) + (semanticCounts.incorrect ?? 0);
  const shortAnswersNeedCorrection = isShortAnswerQuestion && chartTotal > 0 && scoredShortAnswerCount < chartTotal;
  const shortAnswersWaitingForCorrection = Math.max(chartTotal - scoredShortAnswerCount, 0);
  const responseAudience = Math.max(stats?.participation_count ?? 0, chartTotal);
  const notAnsweredCount = Math.max(responseAudience - chartTotal, 0);
  const responseRate = responseAudience ? Math.round((chartTotal / responseAudience) * 1000) / 10 : 0;
  const answerRows = Object.entries(chartDistribution).sort(([first], [second]) => first.localeCompare(second));
  const visibleAnswerRows = answerRows.length > 0 ? answerRows : PLACEHOLDER_ANSWERS.map((answer) => [answer, 0]);
  const shortAnswerRows = [
    {
      key: "correct",
      label: "Correct",
      count: semanticCorrectCount,
      correctness: "correct",
      badgeClass: "bg-emerald-600 text-white",
      barClass: "bg-emerald-600",
    },
    {
      key: "partial",
      label: "Partial",
      count: semanticPartialCount,
      correctness: "partial",
      badgeClass: "bg-amber-500 text-white",
      barClass: "bg-amber-500",
    },
    {
      key: "incorrect",
      label: "Needs review",
      count: semanticIncorrectCount,
      correctness: "incorrect",
      badgeClass: "bg-rose-600 text-white",
      barClass: "bg-rose-600",
    },
    {
      key: "not_answered",
      label: "Not answered",
      count: notAnsweredCount,
      status: "not_answered",
      badgeClass: "bg-slate-500 text-white",
      barClass: "bg-slate-400",
    },
  ];
  const hasActiveQuestionTimer = activeQuestionId === chartQuestionId && Boolean(session?.question_ends_at);
  const activeQuestionTimeEnded = hasActiveQuestionTimer && dashboardTimeLeft <= 0;

  useEffect(() => {
    setDashboardTimeLeft(secondsUntil(session?.question_ends_at));
    const interval = window.setInterval(() => {
      setDashboardTimeLeft(secondsUntil(session?.question_ends_at));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeQuestionId, session?.question_ends_at]);

  function timerDurationSeconds() {
    return Math.min(Math.max(Math.round(Number(timerMinutes || 0) * 60), 15), 3600);
  }

  useEffect(() => {
    if (!sessionId || questionIds.length === 0) return;
    const liveQuestionId = session?.active_question_id || "";
    setActiveQuestionId(liveQuestionId);
    const nextChartIndex = chartQuestionIds.indexOf(liveQuestionId);
    if (nextChartIndex >= 0) setChartQuestionIndex(nextChartIndex);
    if (liveQuestionId) {
      localStorage.setItem(`activeQuestionId:${sessionId}`, liveQuestionId);
      localStorage.setItem("activeQuestionId", liveQuestionId);
    } else {
      localStorage.removeItem(`activeQuestionId:${sessionId}`);
      if (localStorage.getItem("activeQuestionId") && !questionIds.includes(localStorage.getItem("activeQuestionId"))) {
        localStorage.removeItem("activeQuestionId");
      }
    }
  }, [activeQuestionId, session?.active_question_id, sessionId, questionKey]);

  useEffect(() => {
    setChartQuestionIndex((current) => Math.min(current, Math.max(chartQuestionIds.length - 1, 0)));
  }, [chartQuestionIds.length]);

  const responseCount = stats?.answer_distribution
    ? Object.values(stats.answer_distribution).flatMap((answers) => Object.values(answers)).reduce((sum, value) => sum + value, 0)
    : 0;

  if (!sessionId) {
    return <EmptyState title="No session selected" description="Create a session first." />;
  }

  function shortenQuestionId(id) {
    if (!id || id.length <= 16) return id;
    return `${id.slice(0, 8)}...${id.slice(-4)}`;
  }

  async function activateQuestion(questionId, index, { timed = false } = {}) {
    setActivatingQuestionId(questionId);
    const requestedDurationSeconds = timed ? timerDurationSeconds() : undefined;
    if (requestedDurationSeconds) {
      setActiveQuestionId(questionId);
      setDashboardTimeLeft(requestedDurationSeconds);
    }
    try {
      const updatedSession = await updateInstructorActiveQuestion(sessionId, questionId, requestedDurationSeconds);
      setSession(updatedSession);
      if (updatedSession.question_duration_seconds) {
        setTimerMinutes(Math.max(0.25, Math.round((updatedSession.question_duration_seconds / 60) * 100) / 100));
      }
      setDashboardTimeLeft(secondsUntil(updatedSession.question_ends_at));
      setActiveQuestionId(questionId);
      localStorage.setItem(`activeQuestionId:${sessionId}`, questionId);
      localStorage.setItem("activeQuestionId", questionId);
      const nextChartIndex = chartQuestionIds.indexOf(questionId);
      if (nextChartIndex >= 0) setChartQuestionIndex(nextChartIndex);
      window.dispatchEvent(new window.CustomEvent("live-question-activated", {
        detail: {
          sessionId,
          questionId,
          questionNumber: index + 1,
          questionDurationSeconds: updatedSession.question_duration_seconds,
          questionEndsAt: updatedSession.question_ends_at,
        },
      }));
      showToast({
        title: `Question ${index + 1} live`,
        tone: "success",
      });
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not activate question", tone: "error" });
    } finally {
      setActivatingQuestionId("");
    }
  }

  async function startQuestionTimer() {
    if (!chartQuestionId) return;
    const questionIndex = questionIds.indexOf(chartQuestionId);
    await activateQuestion(chartQuestionId, questionIndex >= 0 ? questionIndex : chartQuestionIndex, { timed: true });
    setTimerModalOpen(false);
  }

  async function revealAnswer() {
    if (!sessionId || !chartQuestionId) return;
    setRevealingQuestionId(chartQuestionId);
    try {
      const result = await revealSessionQuestion(sessionId, chartQuestionId);
      setLiveQuestions((current) => current.map((question) => (
        question.question_id === chartQuestionId
          ? { ...question, is_revealed: true, correct_answer: result.correct_answer, explanation: result.explanation }
          : question
      )));
      if (result.stats) setStats(result.stats);
      showToast({ title: "Answer revealed", tone: "success" });
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not reveal answer", tone: "error" });
    } finally {
      setRevealingQuestionId("");
    }
  }

  async function recalculateShortAnswers() {
    if (!sessionId || !chartQuestionId || !isShortAnswerQuestion) return;
    setCorrectingQuestionId(chartQuestionId);
    try {
      const result = await correctShortAnswerResponses(sessionId, chartQuestionId);
      if (result.stats) setStats(result.stats);
      setSummaryPreviewData({});
      showToast({ title: "Scores recalculated", tone: "success" });
      await loadResponseDetails();
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not recalculate answers", tone: "error" });
    } finally {
      setCorrectingQuestionId("");
    }
  }

  async function finishSession() {
    if (!sessionId) return;
    setFinishingSession(true);
    try {
      await finishLiveSession(sessionId);
      setSession((current) => (current ? { ...current, status: "finished" } : current));
      showToast({ title: "Session finished", tone: "success" });
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not complete session", tone: "error" });
    } finally {
      setFinishingSession(false);
    }
  }

  function moveChart(direction) {
    if (chartQuestionIds.length <= 1) return;
    setChartQuestionIndex((current) => (current + direction + chartQuestionIds.length) % chartQuestionIds.length);
  }

  function openDetails({ status = "all", answer = "", correctness = "" } = {}) {
    setDetailsData(null);
    setDetailsStatus(status);
    setDetailsAnswer(answer);
    setDetailsCorrectness(correctness);
    setDetailsSearch("");
    setDetailsOpen(true);
  }

  async function loadResponseDetails(showError = false) {
    if (!sessionId || !chartQuestionId || !detailsOpen) return;
    setDetailsLoading(true);
    try {
      const result = await getLiveSessionResponseDetails(sessionId, {
        question_id: chartQuestionId,
        status: detailsStatus,
        answer: detailsAnswer,
        correctness: detailsCorrectness,
        search: detailsSearch,
      });
      setDetailsData(result);
    } catch (err) {
      if (showError) {
        showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not load response details", tone: "error" });
      }
    } finally {
      setDetailsLoading(false);
    }
  }

  async function saveInstructorReview(responseId, payload) {
    if (!responseId) return;
    setSavingReviewId(responseId);
    try {
      const result = await updateInstructorReview(responseId, payload);
      if (result.stats) setStats(result.stats);
      setSummaryPreviewData({});
      setDetailsData((current) => {
        if (!current?.students) return current;
        return {
          ...current,
          students: current.students.map((student) => (
            student.response_id === responseId
              ? {
                  ...student,
                  instructorReview: result.instructorReview,
                  semantic_score: result.finalScore,
                  semantic_label: result.finalLabel,
                  is_correct: result.is_correct,
                  stars_earned: result.stars_earned,
                }
              : student
          )),
        };
      });
      showToast({ title: "Saved", tone: "success" });
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not save review", tone: "error" });
    } finally {
      setSavingReviewId("");
    }
  }

  useEffect(() => {
    if (!detailsOpen) return;
    void loadResponseDetails();
  }, [detailsOpen, detailsStatus, detailsAnswer, detailsCorrectness, detailsSearch, chartQuestionId, stats?.updated_at]);

  useEffect(() => {
    if (!detailsOpen) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [detailsOpen]);

  function detailTitle() {
    if (detailsAnswer) return `Students who answered ${detailsAnswer}`;
    if (detailsCorrectness === "correct") return "Correct responses";
    if (detailsCorrectness === "partial") return "Partially correct responses";
    if (detailsCorrectness === "incorrect") return "Needs review";
    if (detailsStatus === "not_answered") return "Not answered yet";
    if (detailsStatus === "answered") return "Answered students";
    return "All responses";
  }

  function formatSubmittedAt(value) {
    if (!value) return "Not submitted";
    return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  async function copyJoinLink() {
    const link = session?.join_link;
    if (!link) return;
    try {
      await navigator.clipboard?.writeText(link);
      showToast({ title: "Copied", tone: "success" });
    } catch {
      showToast({ title: "Something went wrong", description: "Copy is unavailable in this browser.", tone: "error" });
    }
  }

  function previewKey(status, correctness = "", answer = "") {
    return `${chartQuestionId}:${status}:${correctness}:${answer}:${stats?.updated_at || "static"}`;
  }

  async function loadSummaryPreview(status, correctness = "", answer = "") {
    if (!sessionId || !chartQuestionId) return;
    const key = previewKey(status, correctness, answer);
    if (summaryPreviewData[key] || summaryPreviewLoading[key]) return;
    setSummaryPreviewLoading((current) => ({ ...current, [key]: true }));
    try {
      const result = await getLiveSessionResponseDetails(sessionId, {
        question_id: chartQuestionId,
        status,
        correctness,
        answer,
      });
      setSummaryPreviewData((current) => ({ ...current, [key]: result }));
    } catch {
      setSummaryPreviewData((current) => ({
        ...current,
        [key]: { students: [], summary: { answered: chartTotal, not_answered: notAnsweredCount, response_rate: responseRate } },
      }));
    } finally {
      setSummaryPreviewLoading((current) => ({ ...current, [key]: false }));
    }
  }

  function SummaryStudentPreview({ status, correctness = "", answer = "", title }) {
    const key = previewKey(status, correctness, answer);
    const preview = summaryPreviewData[key];
    const loading = summaryPreviewLoading[key];
    const students = preview?.students || [];
    const showCorrectnessGroups = status === "answered" && !correctness;
    const correctStudents = showCorrectnessGroups ? students.filter((student) => student.is_correct === true) : [];
    const partialStudents = showCorrectnessGroups ? students.filter((student) => student.semantic_label === "partial") : [];
    const notCorrectStudents = showCorrectnessGroups ? students.filter((student) => student.is_correct === false && student.semantic_label !== "partial") : [];
    const uncheckedStudents = showCorrectnessGroups ? students.filter((student) => student.is_correct !== true && student.is_correct !== false) : [];
    const visibleStudents = students.slice(0, 7);
    const remainingCount = Math.max(students.length - visibleStudents.length, 0);
    const previewGroup = (label, groupStudents, toneClass) => {
      if (groupStudents.length === 0) return null;
      const visibleGroupStudents = groupStudents.slice(0, 5);
      const extraCount = Math.max(groupStudents.length - visibleGroupStudents.length, 0);

      return (
        <div className="rounded-lg bg-role-hover p-2 dark:bg-slate-950">
          <p className={`text-[11px] font-black uppercase tracking-wide ${toneClass}`}>{label}</p>
          <div className="mt-2 grid gap-1">
            {visibleGroupStudents.map((student) => (
              <p key={`${status}:${correctness}:${label}:${student.student_id}`} className="truncate text-xs font-black text-slate-800 dark:text-slate-100">
                {student.student_name}
              </p>
            ))}
            {extraCount > 0 && <p className="text-xs font-bold text-slate-500 dark:text-slate-400">+{extraCount} more</p>}
          </div>
        </div>
      );
    };

    return (
      <div className="pointer-events-none absolute left-0 top-[calc(100%+0.5rem)] z-40 w-72 translate-y-1 rounded-[18px] border border-role-border bg-white p-3 text-left opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:border-slate-800 dark:bg-slate-900 sm:left-auto sm:right-0">
        <p className="text-xs font-black uppercase tracking-wide text-role-text">{title}</p>
        <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto pr-1">
          {loading && <p className="rounded-lg bg-role-hover px-3 py-2 text-xs font-bold text-slate-500 dark:bg-slate-950 dark:text-slate-300">Loading students...</p>}
          {!loading && visibleStudents.length === 0 && (
            <p className="rounded-lg bg-role-hover px-3 py-2 text-xs font-bold text-slate-500 dark:bg-slate-950 dark:text-slate-300">No students in this group yet.</p>
          )}
          {!loading && showCorrectnessGroups && (
            <>
              {previewGroup("Correct", correctStudents, "text-emerald-700 dark:text-emerald-100")}
              {previewGroup("Partial", partialStudents, "text-amber-700 dark:text-amber-100")}
              {previewGroup("Not correct", notCorrectStudents, "text-rose-700 dark:text-rose-100")}
              {previewGroup("Unchecked", uncheckedStudents, "text-slate-500 dark:text-slate-400")}
            </>
          )}
          {!loading && !showCorrectnessGroups && visibleStudents.map((student) => (
            <p key={`${status}:${correctness}:${student.student_id}`} className="truncate rounded-lg bg-role-hover px-3 py-2 text-xs font-black text-slate-800 dark:bg-slate-950 dark:text-slate-100">
              {student.student_name}
            </p>
          ))}
          {!loading && !showCorrectnessGroups && remainingCount > 0 && (
            <p className="text-center text-xs font-bold text-slate-500 dark:text-slate-400">+{remainingCount} more. Click to view all.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-3 bg-slate-50 p-3 dark:bg-slate-950 sm:p-4 lg:h-screen lg:overflow-hidden">
      {session && (
        <div className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:px-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Session Code</span>
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-xl font-black tracking-wide text-slate-900 dark:text-white">{session.session_code}</h2>
                  <Badge tone={getSessionStatusTone(session.status)}>{getSessionStatusLabel(session.status)}</Badge>
                </div>
              </div>
              <div className="hidden h-6 w-px bg-slate-200 dark:bg-slate-800 sm:block" />
              <div className="grid grid-cols-2 gap-1.5 sm:flex sm:items-center">
                <div className="flex min-h-8 items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold dark:bg-slate-800/50">
                  <UsersRound size={13} className="text-slate-500" />
                  <span>Joined: <strong className="text-slate-900 dark:text-white">{stats?.participation_count ?? 0}</strong></span>
                </div>
                <div className="flex min-h-8 items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold dark:bg-slate-800/50">
                  <MessageCircle size={13} className="text-slate-500" />
                  <span>Answered: <strong className="text-slate-900 dark:text-white">{responseCount}</strong></span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="outline" size="icon" className="h-11 w-11 rounded-full" disabled={!session.qr_code_base64} onClick={() => setQrModalOpen(true)} title="Show QR Code">
                <QrCode size={18} />
              </Button>
              <Button type="button" variant="outline" size="icon" className="h-11 w-11 rounded-full" disabled={!session.join_link} onClick={copyJoinLink} title="Copy Join Link">
                <Copy size={18} />
              </Button>
              <Button type="button" variant="outline" size="md" className="h-11 rounded-full px-4 text-sm" loading={finishingSession} disabled={session.status !== "active"} onClick={finishSession}>
                <CheckCircle2 size={17} />
                {session.status === "finished" ? "Finished" : "End"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid flex-1 items-stretch gap-3 lg:min-h-0 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <div className="flex min-h-[18rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:min-h-0">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-role-primary">
              <Layers size={13} />
              Questions ({questionIds.length})
            </div>
          </div>

          <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-2">
            {questionIds.map((questionId, index) => {
                const isActive = activeQuestionId === questionId;
                const answerCount = Object.values(stats?.answer_distribution?.[questionId] ?? {}).reduce((sum, value) => sum + value, 0);

                return (
                  <div key={questionId} className={`flex min-h-12 items-center justify-between gap-2 rounded-lg border p-2 text-xs transition ${isActive ? "border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20" : "border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${isActive ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800"}`}>{index + 1}</span>
                      <span className="truncate font-bold text-slate-700 dark:text-slate-300">Q{index + 1} ({answerCount} ans)</span>
                    </div>
                    {isActive ? (
                      <span className="rounded bg-emerald-100/50 px-1.5 py-0.5 text-[10px] font-black text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">LIVE</span>
                    ) : (
                      <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg px-3 text-xs" loading={activatingQuestionId === questionId} onClick={() => activateQuestion(questionId, index)}>
                        <Play size={13} />
                        Run
                      </Button>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        <div className="grid min-h-0 gap-3 lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={activeQuestionId === chartQuestionId ? "green" : "slate"}>{activeQuestionId === chartQuestionId ? "Live Focus" : "Preview"}</Badge>
                  {chartQuestion?.type && <Badge tone="teal">{chartQuestion.type === "mcq" ? "MCQ" : "Short text"}</Badge>}
                  <Badge tone={chartQuestion?.is_revealed ? "green" : "slate"}>{chartQuestion?.is_revealed ? "Revealed" : "Answers Private"}</Badge>
                  {activeQuestionId === chartQuestionId && (
                    <Badge tone={hasActiveQuestionTimer ? (activeQuestionTimeEnded ? "gold" : "teal") : "slate"}>
                      {hasActiveQuestionTimer ? (activeQuestionTimeEnded ? "Time ended" : `${formatTime(dashboardTimeLeft)} left`) : "Unlimited"}
                    </Badge>
                  )}
                </div>
                <h3 className="mt-2 text-base font-black leading-snug text-slate-900 dark:text-white">
                  {chartQuestion?.question_text || "Select a question to display live statistics"}
                </h3>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2">
                <Button type="button" size="icon" variant="outline" className="h-11 w-11 rounded-full" disabled={!chartQuestionId} onClick={() => setTimerModalOpen(true)} aria-label="Set question timer">
                  <Timer size={18} />
                </Button>
                <Button type="button" variant={chartQuestion?.is_revealed ? "success" : "role"} size="md" className="h-11 rounded-full px-5 text-sm" loading={revealingQuestionId === chartQuestionId} disabled={!chartQuestion || chartQuestion.is_revealed} onClick={revealAnswer}>
                  {chartQuestion?.is_revealed ? <CheckCircle2 size={17} /> : <Eye size={17} />}
                  Reveal
                </Button>
              </div>
            </div>

            {chartQuestion?.options?.length > 0 && (
              <div className="grid grid-cols-1 gap-2 border-t border-slate-100 pt-2 dark:border-slate-800 sm:grid-cols-2 xl:grid-cols-4">
                {chartQuestion.options.map((option, index) => (
                  <div key={`${index}:${option}`} className="flex min-h-10 items-center rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs font-medium dark:border-slate-800 dark:bg-slate-950">
                    <strong className="mr-1 text-role-primary">{String.fromCharCode(65 + index)}.</strong>
                    <span className="min-w-0 truncate">{option}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-h-[24rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-4 lg:min-h-0">
            <div className="flex shrink-0 flex-col gap-2 border-b border-slate-100 pb-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">{isShortAnswerQuestion ? "Short Answers" : "Answers"}</h4>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {isShortAnswerQuestion && (
                  <Button
                    type="button"
                    variant={shortAnswersNeedCorrection ? "role" : "outline"}
                    size="sm"
                    className="h-9 rounded-full"
                    loading={correctingQuestionId === chartQuestionId}
                    disabled={!chartQuestionId || chartTotal === 0}
                    onClick={recalculateShortAnswers}
                  >
                    <RefreshCw size={15} />
                    {shortAnswersNeedCorrection ? "Correct answers" : "Recalculate"}
                  </Button>
                )}
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full" disabled={chartQuestionIds.length <= 1} onClick={() => moveChart(-1)}>
                  <ChevronLeft size={17} />
                </Button>
                <span className="min-w-10 text-center text-sm font-black">{chartQuestionIds.length ? `${chartQuestionIndex + 1}/${chartQuestionIds.length}` : "0/0"}</span>
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full" disabled={chartQuestionIds.length <= 1} onClick={() => moveChart(1)}>
                  <ChevronRight size={17} />
                </Button>
              </div>
            </div>

            <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {shortAnswersNeedCorrection && (
                <div className="rounded-xl border border-role-border bg-role-hover p-3 text-sm dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-black text-slate-900 dark:text-white">Correct submitted answers</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">
                        {shortAnswersWaitingForCorrection} answered {shortAnswersWaitingForCorrection === 1 ? "response needs" : "responses need"} scoring before result buckets are shown.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="role"
                      size="sm"
                      className="h-9 shrink-0 rounded-full"
                      loading={correctingQuestionId === chartQuestionId}
                      onClick={recalculateShortAnswers}
                    >
                      <RefreshCw size={15} />
                      Start correcting
                    </Button>
                  </div>
                </div>
              )}

              {chartQuestion && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3 text-sm dark:border-emerald-400/20 dark:bg-emerald-500/10">
                  <p className="text-[11px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-100">Correct answer</p>
                  <p className="mt-1 break-words font-black leading-6 text-emerald-950 dark:text-emerald-50">
                    {getCorrectAnswerDisplay(chartQuestion)}
                  </p>
                </div>
              )}

              <button
                type="button"
                className="group relative w-full rounded-xl border border-slate-100 bg-slate-50 p-3 text-left transition hover:bg-slate-100/50 dark:border-slate-800 dark:bg-slate-950/40"
                onClick={() => openDetails({ status: "all" })}
                onMouseEnter={() => loadSummaryPreview("answered")}
              >
                <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold">
                  <span className="text-slate-500">Progress</span>
                  <span className="font-black text-role-primary">
                    {responseRate >= 100 ? "Complete" : responseRate <= 0 ? "No activity" : `${responseRate}%`}
                  </span>
                </div>
                <MetricProgressLine percentage={responseRate} />
                <div className="mt-1 flex items-center justify-between text-[11px] font-medium text-slate-400">
                  <span>{chartTotal} answered</span>
                  <span>{notAnsweredCount} waiting</span>
                </div>
                <SummaryStudentPreview status="answered" title="Submitted Group" />
              </button>

              {isShortAnswerQuestion ? (
                <div className="grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {shortAnswerRows.map((row) => {
                    const percentage = responseAudience ? Math.round((row.count / responseAudience) * 100) : 0;
                    return (
                      <button
                        key={row.key}
                        type="button"
                        disabled={!chartQuestionId || row.count === 0}
                        onClick={() => openDetails(row.status ? { status: row.status } : { status: "answered", correctness: row.correctness })}
                        onFocus={() => loadSummaryPreview(row.status || "answered", row.correctness || "")}
                        onMouseEnter={() => loadSummaryPreview(row.status || "answered", row.correctness || "")}
                        className="group relative flex min-h-24 flex-col justify-between rounded-xl border border-slate-100 bg-white p-3 text-left text-xs transition hover:border-slate-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900"
                      >
                        <div className="flex w-full items-start justify-between gap-3">
                          <span className={`flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-2 text-[11px] font-black ${row.badgeClass}`}>
                            {row.key === "not_answered" ? "NA" : row.label.charAt(0)}
                          </span>
                          <span className="text-right font-black text-slate-700 dark:text-slate-300">
                            {percentage >= 100 || percentage <= 0 ? studentCountLabel(row.count) : `${percentage}% (${row.count})`}
                          </span>
                        </div>
                        <p className="mt-3 truncate font-black text-slate-800 dark:text-slate-100">{row.label}</p>
                        <MetricProgressLine percentage={percentage} barClass={row.barClass} />
                        <SummaryStudentPreview status={row.status || "answered"} correctness={row.correctness || ""} title={`${row.label} students`} />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {visibleAnswerRows.map(([answer, count], index) => {
                    const percentage = chartTotal ? Math.round((count / chartTotal) * 100) : 0;
                    const label = /^[A-D]$/i.test(String(answer).trim()) ? String(answer).trim().toUpperCase() : String.fromCharCode(65 + index);
                    const isCorrectOption = isCorrectAnswerOption(chartQuestion, answer, index);
                    return (
                      <button
                        key={answer}
                        type="button"
                        disabled={!chartQuestionId || count === 0}
                        onClick={() => openDetails({ status: "answered", answer })}
                        onFocus={() => loadSummaryPreview("answered", "", answer)}
                        onMouseEnter={() => loadSummaryPreview("answered", "", answer)}
                        className={`group relative flex min-h-20 flex-col justify-between rounded-xl border bg-white p-3 text-xs transition hover:border-slate-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-900 ${isCorrectOption ? "border-emerald-300 ring-2 ring-emerald-100 dark:border-emerald-500/50 dark:ring-emerald-500/10" : "border-slate-100 dark:border-slate-800"}`}
                      >
                        <div className="flex w-full items-center justify-between gap-3">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white ${isCorrectOption ? "bg-emerald-600" : "bg-role-primary"}`}>{label}</span>
                          <span className="text-right font-black text-slate-700 dark:text-slate-300">
                            {percentage >= 100 || percentage <= 0 ? studentCountLabel(count) : `${percentage}% (${count})`}
                          </span>
                        </div>
                        {isCorrectOption && <p className="mt-2 text-[11px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-100">Correct</p>}
                        <MetricProgressLine percentage={percentage} barClass={isCorrectOption ? "bg-emerald-600" : "bg-role-primary"} />
                        <SummaryStudentPreview status="answered" answer={answer} title={`${label} students`} />
                      </button>
                    );
                  })}
                </div>
              )}

              {chartTotal === 0 && (
                <div className="flex items-center justify-center gap-1.5 py-4 text-center text-xs text-slate-400">
                  <Activity size={12} className="animate-pulse" />
                  {activeQuestionId ? "Waiting for responses..." : "No question is live."}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ResponsesPanel
        open={detailsOpen}
        title={detailTitle()}
        students={detailsData?.students || []}
        summary={detailsData?.summary}
        fallback={{
          answered: chartTotal,
          total: responseAudience,
          correct: semanticCorrectCount,
          partial: semanticPartialCount,
          needsReview: semanticIncorrectCount,
          notAnswered: notAnsweredCount,
          responseRate,
        }}
        loading={detailsLoading}
        status={detailsStatus}
        correctness={detailsCorrectness}
        search={detailsSearch}
        isShortAnswerQuestion={isShortAnswerQuestion}
        recalculating={correctingQuestionId === chartQuestionId}
        savingReviewId={savingReviewId}
        onClose={() => setDetailsOpen(false)}
        onRecalculate={recalculateShortAnswers}
        onStatusChange={(value) => {
          setDetailsData(null);
          setDetailsStatus(value);
          setDetailsAnswer("");
          if (value === "not_answered") setDetailsCorrectness("");
        }}
        onCorrectnessChange={(value) => {
          setDetailsData(null);
          setDetailsStatus(value ? "answered" : "all");
          setDetailsAnswer("");
          setDetailsCorrectness(value);
        }}
        onSearchChange={(value) => {
          setDetailsData(null);
          setDetailsSearch(value);
        }}
        onSaveReview={saveInstructorReview}
        formatSubmittedAt={formatSubmittedAt}
      />

      <Modal open={qrModalOpen} title="Session QR code" onClose={() => setQrModalOpen(false)} panelClassName="max-w-md">
        <div className="grid gap-4 text-center">
          {session?.qr_code_base64 ? (
            <img className="mx-auto h-56 w-56 rounded-[24px] bg-white p-4 shadow-soft" src={session.qr_code_base64} alt="Session QR code" />
          ) : (
            <div className="rounded-[24px] border border-dashed border-role-border bg-role-hover px-4 py-10 text-sm font-bold text-slate-500 dark:bg-slate-950 dark:text-slate-300">
              QR code unavailable.
            </div>
          )}
          <div className="rounded-[18px] bg-role-hover p-4 text-left dark:bg-slate-950">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Session code</p>
            <p className="mt-1 text-2xl font-black tracking-[0.16em] text-slate-950 dark:text-white">{session?.session_code || "No code"}</p>
            {session?.join_link && <p className="mt-2 break-all text-xs font-semibold text-slate-500 dark:text-slate-400">{session.join_link}</p>}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setQrModalOpen(false)}>
              Close
            </Button>
            <Button type="button" variant="role" disabled={!session?.join_link} onClick={copyJoinLink}>
              <Copy size={17} />
              Copy link
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={timerModalOpen} title="Question timer" onClose={() => setTimerModalOpen(false)} panelClassName="max-w-md">
        <div className="grid gap-4">
          <div className="rounded-[18px] bg-role-hover p-4 dark:bg-slate-950">
            <p className="text-sm font-black text-slate-950 dark:text-white">
              {chartQuestionId ? `Question ${chartQuestionIndex + 1}` : "No question selected"}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
              Use this only when you want a countdown. The regular Run button leaves the question open until you reveal or switch questions.
            </p>
          </div>
          <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
            Minutes
            <input
              type="number"
              min="0.25"
              max="60"
              step="0.25"
              className="adaptive-input focus-ring h-12 border border-role-border px-4 text-sm font-black"
              value={timerMinutes}
              onChange={(event) => setTimerMinutes(event.target.value)}
              autoFocus
            />
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setTimerModalOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="role" loading={activatingQuestionId === chartQuestionId} disabled={!chartQuestionId} onClick={startQuestionTimer}>
              <Timer size={17} />
              {activeQuestionId === chartQuestionId ? "Restart timer" : "Activate timed"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
