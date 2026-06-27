import { CheckCircle2, MessageSquareText, Send, Star, Timer, Trophy, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getLiveSession, getLiveSessionQuestions, getWebSocketUrl, submitAnswer } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { PageHeader } from "../../components/PageHeader";
import { QuestionCard } from "../../components/QuestionCard";
import { useToast } from "../../components/ToastProvider";
import { useAuth } from "../../state/AuthContext";

const QUESTION_DURATION_SECONDS = 180;

function getSession() {
  const raw = localStorage.getItem("activeSession");
  return raw ? JSON.parse(raw) : null;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function secondsUntil(value, fallback = QUESTION_DURATION_SECONDS) {
  if (!value) return fallback;
  const normalizedValue = typeof value === "string" && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? `${value}Z` : value;
  const endTime = new Date(normalizedValue).getTime();
  if (Number.isNaN(endTime)) return fallback;
  return Math.max(Math.ceil((endTime - Date.now()) / 1000), 0);
}

function shortenQuestionId(id) {
  if (!id || id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function storeActiveQuestion(session, questionId) {
  if (!session?.session_id || !questionId) return;
  localStorage.setItem(`activeQuestionId:${session.session_id}`, questionId);
  localStorage.setItem("activeQuestionId", questionId);
  localStorage.setItem("activeSession", JSON.stringify({ ...session, active_question_id: questionId }));
}

function storeSession(session) {
  if (!session?.session_id) return;
  localStorage.setItem("activeSession", JSON.stringify(session));
  if (session.active_question_id) {
    localStorage.setItem(`activeQuestionId:${session.session_id}`, session.active_question_id);
    localStorage.setItem("activeQuestionId", session.active_question_id);
  } else {
    localStorage.removeItem(`activeQuestionId:${session.session_id}`);
  }
}

function getActiveQuestionId(session, questionIds) {
  if (session?.active_question_id && questionIds.length === 0) return session.active_question_id;
  if (session?.active_question_id && questionIds.includes(session.active_question_id)) return session.active_question_id;
  return "";
}

function getAnswerKey(sessionId, questionId) {
  return `selectedAnswer:${sessionId || "no-session"}:${questionId || "no-question"}`;
}

function getStoredAnswer(sessionId, questionId) {
  return localStorage.getItem(getAnswerKey(sessionId, questionId)) || "";
}

export function ActiveQuestionPage() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [session, setSession] = useState(() => getSession());
  const questionIds = useMemo(() => session?.question_ids ?? [], [session]);
  const [questions, setQuestions] = useState([]);
  const [activeQuestionId, setActiveQuestionId] = useState(() => getActiveQuestionId(session, questionIds));
  const [selected, setSelected] = useState(() => getStoredAnswer(session?.session_id, getActiveQuestionId(session, questionIds)));
  const [submitting, setSubmitting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(QUESTION_DURATION_SECONDS);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const displayedQuestionIds = questionIds.length > 0 ? questionIds : questions.map((question) => question.question_id);
  const activeQuestionIndex = Math.max(0, displayedQuestionIds.indexOf(activeQuestionId));
  const activeQuestionNumber = activeQuestionIndex + 1;
  const totalQuestions = Math.max(displayedQuestionIds.length, 1);
  const activeQuestion = questions.find((question) => question.question_id === activeQuestionId);
  const isMcq = activeQuestion ? (activeQuestion.type ? activeQuestion.type === "mcq" : (activeQuestion.options?.length ?? 0) > 0) : true;
  const questionType = isMcq ? "MCQ" : "Short answer";
  const hasSubmitted = Boolean(activeQuestion?.student_answer);
  const isRevealed = Boolean(activeQuestion?.is_revealed);
  const hasQuestionTimer = Boolean(session?.question_ends_at);
  const isTimeExpired = !isRevealed && hasQuestionTimer && timeLeft <= 0;
  const isAnswerLocked = isRevealed || isTimeExpired;
  const questionStatus = !activeQuestionId ? "Waiting" : !activeQuestion ? "Loading" : isRevealed ? "Revealed" : isTimeExpired ? "Time ended" : hasSubmitted ? "Submitted" : "Live";
  const questionPrompt = activeQuestion?.question_text || (activeQuestionId ? "Loading the active question..." : "Waiting for the instructor to activate the next question.");
  const questionTitle = activeQuestionId ? `Question ${activeQuestionNumber} of ${totalQuestions}` : "Waiting for a live question";
  const questionSubtitle = activeQuestionId ? `ID: ${shortenQuestionId(activeQuestionId)}` : "No question is live yet";
  const sessionStars = Math.max(0, ...questions.map((question) => Number(question.session_stars || 0)));
  const badgeQuestion = questions.find((question) => question.badge_earned);

  async function loadLiveState(showError = true, targetSessionId = session?.session_id) {
    if (!targetSessionId) return;
    try {
      const [sessionResult, questionsResult] = await Promise.all([
        getLiveSession(targetSessionId),
        getLiveSessionQuestions(targetSessionId),
      ]);
      storeSession(sessionResult);
      setSession(sessionResult);
      setQuestions(questionsResult);
      const nextQuestionIds = sessionResult.question_ids ?? [];
      const nextActiveQuestionId = getActiveQuestionId(sessionResult, nextQuestionIds);
      setActiveQuestionId(nextActiveQuestionId);
      const nextActiveQuestion = questionsResult.find((question) => question.question_id === nextActiveQuestionId);
      if (nextActiveQuestion?.student_answer) {
        setSelected(nextActiveQuestion.student_answer);
        localStorage.setItem(getAnswerKey(sessionResult.session_id, nextActiveQuestionId), nextActiveQuestion.student_answer);
      }
      if (questionsResult.some((question) => question.badge_earned)) setBadgeOpen(true);
    } catch (err) {
      if (showError) {
        showToast({ title: "Could not load live questions", description: err instanceof Error ? err.message : "Could not load live questions", tone: "error" });
      }
    }
  }

  useEffect(() => {
    let isMounted = true;

    if (isMounted) void loadLiveState(true, session?.session_id);
    const refreshInterval = window.setInterval(() => {
      if (isMounted) void loadLiveState(false, session?.session_id);
    }, 4000);
    return () => {
      isMounted = false;
      window.clearInterval(refreshInterval);
    };
  }, [session?.session_id, showToast]);

  useEffect(() => {
    setActiveQuestionId(getActiveQuestionId(session, questionIds));
  }, [questionIds, session?.active_question_id]);

  useEffect(() => {
    function syncActiveQuestion() {
      const latestSession = getSession() || session;
      setSession(latestSession);
      setActiveQuestionId(getActiveQuestionId(latestSession, latestSession?.question_ids ?? questionIds));
    }

    function handleActivatedQuestion(event) {
      if (!event.detail?.questionId) return;
      if (!session?.session_id) return;
      if (event.detail.sessionId && event.detail.sessionId !== session.session_id) return;
      const nextSession = {
        ...(session || {}),
        active_question_id: event.detail.questionId,
        question_duration_seconds: event.detail.questionDurationSeconds ?? null,
        question_ends_at: event.detail.questionEndsAt ?? null,
      };
      storeActiveQuestion(nextSession, event.detail.questionId);
      setSession((current) => ({
        ...(current || session),
        active_question_id: event.detail.questionId,
        question_duration_seconds: event.detail.questionDurationSeconds ?? null,
        question_ends_at: event.detail.questionEndsAt ?? null,
      }));
      setActiveQuestionId(event.detail.questionId);
    }

    window.addEventListener("storage", syncActiveQuestion);
    window.addEventListener("live-question-activated", handleActivatedQuestion);
    return () => {
      window.removeEventListener("storage", syncActiveQuestion);
      window.removeEventListener("live-question-activated", handleActivatedQuestion);
    };
  }, [questionIds, session]);

  useEffect(() => {
    if (!session?.session_id) return undefined;
    const socketSessionId = session.session_id;
    const socket = new WebSocket(getWebSocketUrl(socketSessionId));

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if ((message.type === "active_question" || message.type === "question_active") && message.payload?.question_id) {
          const nextSession = {
            ...(session || {}),
            active_question_id: message.payload.question_id,
            question_started_at: message.payload.question_started_at || session?.question_started_at,
            question_duration_seconds: Object.prototype.hasOwnProperty.call(message.payload, "question_duration_seconds")
              ? message.payload.question_duration_seconds
              : session?.question_duration_seconds,
            question_ends_at: Object.prototype.hasOwnProperty.call(message.payload, "question_ends_at")
              ? message.payload.question_ends_at
              : session?.question_ends_at,
          };
          storeActiveQuestion(nextSession, message.payload.question_id);
          setSession((current) => ({
            ...(current || session),
            active_question_id: message.payload.question_id,
            question_started_at: message.payload.question_started_at || current?.question_started_at,
            question_duration_seconds: Object.prototype.hasOwnProperty.call(message.payload, "question_duration_seconds")
              ? message.payload.question_duration_seconds
              : current?.question_duration_seconds,
            question_ends_at: Object.prototype.hasOwnProperty.call(message.payload, "question_ends_at")
              ? message.payload.question_ends_at
              : current?.question_ends_at,
          }));
          setActiveQuestionId(message.payload.question_id);
          setTimeLeft(message.payload.question_ends_at ? secondsUntil(message.payload.question_ends_at, message.payload.question_duration_seconds || QUESTION_DURATION_SECONDS) : 0);
          showToast({ title: "New question active", description: message.payload.message || "A new question is active.", tone: "info" });
          void loadLiveState(false, socketSessionId);
        }
        if (message.type === "answer_revealed") {
          showToast({ title: "Answer revealed", description: "Your feedback is now available.", tone: "success" });
          void loadLiveState(false, socketSessionId);
        }
        if (message.type === "reward_earned") {
          void loadLiveState(false, socketSessionId);
        }
        if (message.type === "session_finished") {
          showToast({ title: "Session completed", description: "Your session results are ready.", tone: "info" });
          void loadLiveState(false, socketSessionId);
        }
      } catch {
        // Ignore malformed live messages.
      }
    };

    return () => socket.close();
  }, [session?.session_id]);

  useEffect(() => {
    setSelected(activeQuestion?.student_answer || getStoredAnswer(session?.session_id, activeQuestionId));
    setTimeLeft(session?.question_ends_at ? secondsUntil(session.question_ends_at, session?.question_duration_seconds || QUESTION_DURATION_SECONDS) : 0);
  }, [activeQuestion?.student_answer, activeQuestionId, questionIds.length, session?.question_duration_seconds, session?.question_ends_at, session?.session_id]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTimeLeft(session?.question_ends_at ? secondsUntil(session.question_ends_at, session?.question_duration_seconds || QUESTION_DURATION_SECONDS) : 0);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeQuestionId, session?.question_duration_seconds, session?.question_ends_at]);

  function handleSelect(answer) {
    if (isAnswerLocked) return;
    localStorage.setItem(getAnswerKey(session?.session_id, activeQuestionId), answer);
    localStorage.setItem("selectedAnswer", answer);
    setSelected(answer);
  }

  async function handleSubmit() {
    if (!session?.session_id) {
      showToast({ title: "Join a session first", description: "Join a session before submitting an answer.", tone: "warning" });
      return;
    }
    if (!activeQuestion) {
      showToast({ title: "Question still loading", description: "Wait for the active question to load before submitting.", tone: "warning" });
      return;
    }
    if (!selected.trim()) {
      showToast({
        title: "Answer required",
        description: isMcq ? "Choose an answer before submitting." : "Write an answer before submitting.",
        tone: "warning",
      });
      return;
    }
    if (isTimeExpired) {
      showToast({ title: "Time ended", description: "The answer window for this question has closed.", tone: "warning" });
      return;
    }
    setSubmitting(true);
    try {
      await submitAnswer({
        session_id: session.session_id,
        question_id: activeQuestionId,
        student_id: user?.user_id || "current",
        answer: selected,
      });
      showToast({ title: "Answer submitted", description: "Your instructor will reveal feedback when ready.", tone: "success" });
      await loadLiveState(false, session.session_id);
    } catch (err) {
      showToast({ title: "Could not submit answer", description: err instanceof Error ? err.message : "Could not submit answer", tone: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!session?.session_id) {
    return (
      <div className="page-grid">
        <PageHeader eyebrow="Live class" title="Active question" description="Answer the question currently selected by your instructor." tone="role" />
        <EmptyState
          title="No live session joined"
          description="Join the session again from the Join Session page. The previous demo-looking view meant the saved session data was missing or stale."
        />
      </div>
    );
  }

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Live class" title="Active question" description="Answer the question currently selected by your instructor." tone="role" />
      <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[1fr_320px]">
        {isMcq ? (
          <QuestionCard
            title={questionTitle}
            subtitle={questionSubtitle}
            type={questionType}
            status={questionStatus}
            prompt={questionPrompt}
            options={activeQuestion?.options || []}
            selected={selected}
            onSelect={handleSelect}
            disabled={isAnswerLocked}
            revealed={isRevealed}
            correctAnswer={activeQuestion?.correct_answer || ""}
            showActions={false}
          />
        ) : (
          <DashboardCard>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-role-border pb-4 dark:border-slate-800">
              <div>
                <h3 className="font-black text-slate-950 dark:text-white">{questionTitle}</h3>
                <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{questionSubtitle}</p>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{questionType}</p>
              </div>
              <Badge tone={!activeQuestion ? "slate" : isRevealed ? "green" : isTimeExpired ? "gold" : hasSubmitted ? "green" : "teal"}>{questionStatus}</Badge>
            </div>
            <p className="mt-5 text-lg font-black leading-7 text-slate-950 dark:text-white">
              {questionPrompt}
            </p>
            <label className="mt-5 grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              Your answer
              <textarea
                className="focus-ring min-h-44 rounded-[20px] border border-role-border bg-role-hover px-4 py-3 text-sm font-semibold leading-6 text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                value={selected}
                onChange={(event) => handleSelect(event.target.value)}
                disabled={isAnswerLocked}
                placeholder="Write your response..."
              />
            </label>
          </DashboardCard>
        )}

        <DashboardCard>
          <Badge tone="role">Session {session?.session_code ?? "Demo"}</Badge>
          <div className="mt-5 grid gap-3">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                <Star size={17} />
                Session stars
              </span>
              <span className="font-black">{sessionStars}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                <Timer size={17} />
                Time left
              </span>
              <span className="font-black">{activeQuestionId ? (hasQuestionTimer ? formatTime(timeLeft) : "Unlimited") : "Not started"}</span>
            </div>
            {/* <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                <MessageSquareText size={17} />
                Format
              </span>
              <span className="font-black">{questionType}</span>
            </div> */}
          </div>
          {hasSubmitted && !isRevealed && (
            <div className="mt-4 rounded-[18px] bg-role-hover p-4 text-sm font-semibold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
              Submitted. The correct answer will appear after your instructor reveals it.
            </div>
          )}
          {isTimeExpired && !hasSubmitted && (
            <div className="mt-4 rounded-[18px] bg-amber-50 p-4 text-sm font-semibold text-amber-900 dark:bg-amber-400/10 dark:text-amber-100">
              Time ended. Your instructor may activate another question.
            </div>
          )}
          {isRevealed && (
            <div className={`mt-4 rounded-[18px] border p-4 ${activeQuestion?.is_correct ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100"}`}>
              <div className="flex items-center gap-2 text-sm font-black">
                {activeQuestion?.is_correct ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
                {activeQuestion?.is_correct ? `Correct +${activeQuestion.stars_earned || 1} star` : "Review the correct answer"}
              </div>
              <p className="mt-3 text-sm font-bold">Correct answer: {activeQuestion?.correct_answer || "Available from your instructor"}</p>
              {activeQuestion?.explanation && <p className="mt-2 text-sm font-semibold leading-6 opacity-90">{activeQuestion.explanation}</p>}
              {activeQuestion?.instructor_feedback && (
                <div className="mt-3 rounded-xl bg-white/60 p-3 text-sm font-semibold leading-6 dark:bg-slate-950/40">
                  <p className="text-xs font-black uppercase tracking-wide opacity-70">Instructor feedback</p>
                  <p className="mt-1">{activeQuestion.instructor_feedback}</p>
                </div>
              )}
            </div>
          )}
          <Button className="mt-5 w-full" size="lg" variant={isAnswerLocked ? "outline" : "role"} loading={submitting} disabled={!activeQuestion || !selected.trim() || isAnswerLocked} onClick={handleSubmit}>
            <Send size={18} />
            {isRevealed ? "Answer locked" : isTimeExpired ? "Time ended" : hasSubmitted ? "Update answer" : "Submit answer"}
          </Button>
        </DashboardCard>
      </div>
      <Modal open={badgeOpen && Boolean(badgeQuestion)} title="Session Master Badge" onClose={() => setBadgeOpen(false)} panelClassName="max-w-md">
        <div className="rounded-[18px] bg-role-hover p-5 text-center dark:bg-slate-950">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-role-primary text-white">
            <Trophy size={24} />
          </div>
          <p className="mt-4 text-lg font-black text-slate-950 dark:text-white">{badgeQuestion?.badge_type || "Session Master"}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">You answered all questions correctly in this session.</p>
        </div>
      </Modal>
    </div>
  );
}
