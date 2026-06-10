import { Activity, CheckCircle2, ChevronLeft, ChevronRight, Copy, Eye, Flag, HelpCircle, Layers, MessageCircle, Play, QrCode, Search, Timer, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { finishLiveSession, getInstructorSession, getLiveSessionQuestions, getLiveSessionResponseDetails, getLiveSessionStats, getWebSocketUrl, revealSessionQuestion, updateInstructorActiveQuestion } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/ToastProvider";

const PLACEHOLDER_ANSWERS = ["A", "B", "C", "D"];

export function LiveParticipationDashboardPage() {
  const { showToast } = useToast();
  const params = useParams();
  const savedSession = JSON.parse(localStorage.getItem("instructorSession") || "null");
  const sessionId = params.sessionId || savedSession?.session_id;
  const [session, setSession] = useState(savedSession);
  const [stats, setStats] = useState(null);
  const [activeQuestionId, setActiveQuestionId] = useState(() => {
    if (savedSession?.active_question_id) return savedSession.active_question_id;
    if (!savedSession?.session_id) return localStorage.getItem("activeQuestionId") || "";
    return localStorage.getItem(`activeQuestionId:${savedSession.session_id}`) || localStorage.getItem("activeQuestionId") || "";
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
  const [finishingSession, setFinishingSession] = useState(false);
  const [finishSummary, setFinishSummary] = useState(null);
  const [summaryPreviewData, setSummaryPreviewData] = useState({});
  const [summaryPreviewLoading, setSummaryPreviewLoading] = useState({});
  const [timerMinutes, setTimerMinutes] = useState(() => Math.round((savedSession?.question_duration_seconds || 180) / 60));
  const [timerModalOpen, setTimerModalOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [leftPanelTab, setLeftPanelTab] = useState("questions");

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
        }
      } catch (err) {
        if (showError && isMounted) {
          showToast({ title: "Could not load live session", description: err instanceof Error ? err.message : "Could not load live session", tone: "error" });
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
                    question_duration_seconds: message.payload?.question_duration_seconds ?? current.question_duration_seconds,
                    question_ends_at: message.payload?.question_ends_at || current.question_ends_at,
                  }
                : current
            ));
            if (message.payload?.question_duration_seconds) {
              setTimerMinutes(Math.max(0.25, Math.round((message.payload.question_duration_seconds / 60) * 100) / 100));
            }
            if (message.payload?.stats) setStats(message.payload.stats);
          }
          if (message.type === "response_submitted" && message.payload?.stats) {
            setStats(message.payload.stats);
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
            setFinishSummary(message.payload);
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
  const chartTotal = Object.values(chartDistribution).reduce((sum, value) => sum + value, 0);
  const correctCount = chartQuestionId ? (stats?.correct_counts?.[chartQuestionId] ?? 0) : 0;
  const incorrectCount = chartQuestionId ? (stats?.incorrect_counts?.[chartQuestionId] ?? 0) : 0;
  const responseAudience = Math.max(stats?.participation_count ?? 0, chartTotal);
  const notAnsweredCount = Math.max(responseAudience - chartTotal, 0);
  const responseRate = responseAudience ? Math.round((chartTotal / responseAudience) * 1000) / 10 : 0;
  const answerRows = Object.entries(chartDistribution).sort(([first], [second]) => first.localeCompare(second));
  const visibleAnswerRows = answerRows.length > 0 ? answerRows : PLACEHOLDER_ANSWERS.map((answer) => [answer, 0]);

  function timerDurationSeconds() {
    return Math.min(Math.max(Math.round(Number(timerMinutes || 0) * 60), 15), 3600);
  }

  useEffect(() => {
    if (!sessionId || questionIds.length === 0) return;
    const storedQuestionId = session?.active_question_id || activeQuestionId || localStorage.getItem(`activeQuestionId:${sessionId}`) || localStorage.getItem("activeQuestionId") || "";
    const nextQuestionId = questionIds.includes(storedQuestionId) ? storedQuestionId : questionIds[0];
    setActiveQuestionId((current) => (questionIds.includes(current) ? current : nextQuestionId));
    const nextChartIndex = chartQuestionIds.indexOf(nextQuestionId);
    if (nextChartIndex >= 0) setChartQuestionIndex(nextChartIndex);
    localStorage.setItem(`activeQuestionId:${sessionId}`, nextQuestionId);
    localStorage.setItem("activeQuestionId", nextQuestionId);
  }, [activeQuestionId, session?.active_question_id, sessionId, questionKey]);

  useEffect(() => {
    setChartQuestionIndex((current) => Math.min(current, Math.max(chartQuestionIds.length - 1, 0)));
  }, [chartQuestionIds.length]);

  const responseCount = stats?.answer_distribution
    ? Object.values(stats.answer_distribution).flatMap((answers) => Object.values(answers)).reduce((sum, value) => sum + value, 0)
    : 0;

  if (!sessionId) {
    return <EmptyState title="No session selected" description="Create a session first, then open its live dashboard." />;
  }

  function shortenQuestionId(id) {
    if (!id || id.length <= 16) return id;
    return `${id.slice(0, 8)}...${id.slice(-4)}`;
  }

  async function activateQuestion(questionId, index) {
    setActivatingQuestionId(questionId);
    try {
      const updatedSession = await updateInstructorActiveQuestion(sessionId, questionId, timerDurationSeconds());
      setSession(updatedSession);
      setTimerMinutes(Math.max(0.25, Math.round(((updatedSession.question_duration_seconds || timerDurationSeconds()) / 60) * 100) / 100));
      setActiveQuestionId(questionId);
      localStorage.setItem(`activeQuestionId:${sessionId}`, questionId);
      localStorage.setItem("activeQuestionId", questionId);
      const nextChartIndex = chartQuestionIds.indexOf(questionId);
      if (nextChartIndex >= 0) setChartQuestionIndex(nextChartIndex);
      window.dispatchEvent(new window.CustomEvent("live-question-activated", { detail: { sessionId, questionId, questionNumber: index + 1 } }));
      showToast({
        title: `Question ${index + 1} is live`,
        description: "Students will answer this question now.",
        tone: "success",
      });
    } catch (err) {
      showToast({ title: "Could not activate question", description: err instanceof Error ? err.message : "Could not activate question", tone: "error" });
    } finally {
      setActivatingQuestionId("");
    }
  }

  async function startQuestionTimer() {
    if (!chartQuestionId) return;
    const questionIndex = questionIds.indexOf(chartQuestionId);
    await activateQuestion(chartQuestionId, questionIndex >= 0 ? questionIndex : chartQuestionIndex);
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
      showToast({ title: "Answer revealed", description: "Students can now see the correct answer and feedback.", tone: "success" });
    } catch (err) {
      showToast({ title: "Could not reveal answer", description: err instanceof Error ? err.message : "Could not reveal answer", tone: "error" });
    } finally {
      setRevealingQuestionId("");
    }
  }

  async function finishSession() {
    if (!sessionId) return;
    setFinishingSession(true);
    try {
      const result = await finishLiveSession(sessionId);
      setFinishSummary(result);
      setSession((current) => (current ? { ...current, status: "finished" } : current));
      showToast({ title: "Session finished", description: "Stars and session badges have been finalized.", tone: "success" });
    } catch (err) {
      showToast({ title: "Could not finish session", description: err instanceof Error ? err.message : "Could not finish session", tone: "error" });
    } finally {
      setFinishingSession(false);
    }
  }

  function moveChart(direction) {
    if (chartQuestionIds.length <= 1) return;
    setChartQuestionIndex((current) => (current + direction + chartQuestionIds.length) % chartQuestionIds.length);
  }

  function openDetails({ status = "all", answer = "", correctness = "" } = {}) {
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
        showToast({ title: "Could not load response details", description: err instanceof Error ? err.message : "Could not load response details", tone: "error" });
      }
    } finally {
      setDetailsLoading(false);
    }
  }

  useEffect(() => {
    if (!detailsOpen) return;
    void loadResponseDetails();
  }, [detailsOpen, detailsStatus, detailsAnswer, detailsCorrectness, detailsSearch, chartQuestionId, stats?.updated_at]);

  function detailTitle() {
    if (detailsAnswer) return `Students who answered ${detailsAnswer}`;
    if (detailsCorrectness === "correct") return "Correct responses";
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
      showToast({ title: "Join link copied", description: "Students can use this link to join the live session.", tone: "success" });
    } catch {
      showToast({ title: "Could not copy link", description: "Copy is unavailable in this browser.", tone: "error" });
    }
  }

  function previewKey(status, correctness = "") {
    return `${chartQuestionId}:${status}:${correctness}:${stats?.updated_at || "static"}`;
  }

  async function loadSummaryPreview(status, correctness = "") {
    if (!sessionId || !chartQuestionId) return;
    const key = previewKey(status, correctness);
    if (summaryPreviewData[key] || summaryPreviewLoading[key]) return;
    setSummaryPreviewLoading((current) => ({ ...current, [key]: true }));
    try {
      const result = await getLiveSessionResponseDetails(sessionId, {
        question_id: chartQuestionId,
        status,
        correctness,
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

  function SummaryStudentPreview({ status, correctness = "", title }) {
    const key = previewKey(status, correctness);
    const preview = summaryPreviewData[key];
    const loading = summaryPreviewLoading[key];
    const students = preview?.students || [];
    const showCorrectnessGroups = status === "answered" && !correctness;
    const correctStudents = showCorrectnessGroups ? students.filter((student) => student.is_correct === true) : [];
    const notCorrectStudents = showCorrectnessGroups ? students.filter((student) => student.is_correct === false) : [];
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
    <div className="mx-auto flex h-screen w-full max-w-[1600px] flex-col gap-2 overflow-hidden bg-slate-50 p-2 dark:bg-slate-950">
      {session && (
        <div className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Session Code</span>
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-xl font-black tracking-wide text-slate-900 dark:text-white">{session.session_code}</h2>
                  <Badge tone={session.status === "active" ? "green" : session.status === "scheduled" ? "gold" : "slate"}>{session.status}</Badge>
                </div>
              </div>
              <div className="hidden h-6 w-px bg-slate-200 dark:bg-slate-800 sm:block" />
              <div className="hidden items-center gap-1.5 sm:flex">
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold dark:bg-slate-800/50">
                  <UsersRound size={13} className="text-slate-500" />
                  <span>Joined: <strong className="text-slate-900 dark:text-white">{stats?.participation_count ?? 0}</strong></span>
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold dark:bg-slate-800/50">
                  <MessageCircle size={13} className="text-slate-500" />
                  <span>Submissions: <strong className="text-slate-900 dark:text-white">{responseCount}</strong></span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" disabled={!session.qr_code_base64} onClick={() => setQrModalOpen(true)} title="Show QR Code">
                <QrCode size={14} />
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" disabled={!session.join_link} onClick={copyJoinLink} title="Copy Join Link">
                <Copy size={14} />
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs" loading={finishingSession} disabled={session.status === "finished"} onClick={finishSession}>
                <Flag size={13} />
                End
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex border-b border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
            <button
              type="button"
              onClick={() => setLeftPanelTab("questions")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1 text-xs font-bold transition ${leftPanelTab === "questions" ? "bg-white text-role-primary shadow-sm dark:bg-slate-900" : "text-slate-500"}`}
            >
              <Layers size={13} />
              Questions ({questionIds.length})
            </button>
            <button
              type="button"
              onClick={() => setLeftPanelTab("insights")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1 text-xs font-bold transition ${leftPanelTab === "insights" ? "bg-white text-role-primary shadow-sm dark:bg-slate-900" : "text-slate-500"}`}
            >
              <Activity size={13} />
              Live Flags
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {leftPanelTab === "questions" ? (
              questionIds.map((questionId, index) => {
                const isActive = activeQuestionId === questionId;
                const answerCount = Object.values(stats?.answer_distribution?.[questionId] ?? {}).reduce((sum, value) => sum + value, 0);

                return (
                  <div key={questionId} className={`flex items-center justify-between gap-2 rounded-lg border p-1.5 text-xs transition ${isActive ? "border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20" : "border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${isActive ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800"}`}>{index + 1}</span>
                      <span className="truncate font-bold text-slate-700 dark:text-slate-300">Q{index + 1} ({answerCount} ans)</span>
                    </div>
                    {isActive ? (
                      <span className="rounded bg-emerald-100/50 px-1.5 py-0.5 text-[10px] font-black text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">LIVE</span>
                    ) : (
                      <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]" loading={activatingQuestionId === questionId} onClick={() => activateQuestion(questionId, index)}>
                        <Play size={10} />
                        Run
                      </Button>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="space-y-2 text-xs">
                <div>
                  <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Session Summary Data</p>
                  <div className="grid grid-cols-2 gap-1">
                    <div className="rounded-lg bg-slate-50 p-1.5 dark:bg-slate-950">
                      <span className="block text-[10px] text-slate-400">Avg Correctness</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{finishSummary?.average_correctness ?? 0}%</span>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-1.5 dark:bg-slate-950">
                      <span className="block text-[10px] text-slate-400">Badges Issued</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{finishSummary?.students_who_earned_badges?.length ?? 0}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase text-amber-600"><HelpCircle size={11} /> Support Flags</p>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-amber-100 p-1 dark:border-amber-950">
                    {(finishSummary?.students_needing_support || []).length === 0 ? (
                      <p className="p-1 text-center text-[11px] text-slate-400">No current alerts.</p>
                    ) : (
                      finishSummary.students_needing_support.map((student) => (
                        <div key={student.student_id} className="flex justify-between rounded bg-amber-50/50 p-1 dark:bg-amber-950/20">
                          <span className="truncate font-medium">{student.student_name}</span>
                          <span className="shrink-0 font-bold text-amber-700">{student.stars} stars</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
          <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={activeQuestionId === chartQuestionId ? "green" : "slate"}>{activeQuestionId === chartQuestionId ? "Live Focus" : "Preview"}</Badge>
                  {chartQuestion?.type && <Badge tone="teal">{chartQuestion.type === "mcq" ? "MCQ" : "Short text"}</Badge>}
                  <Badge tone={chartQuestion?.is_revealed ? "green" : "slate"}>{chartQuestion?.is_revealed ? "Revealed" : "Answers Private"}</Badge>
                </div>
                <h3 className="mt-1.5 truncate text-base font-black text-slate-900 dark:text-white">
                  {chartQuestion?.question_text || "Select a question to display live statistics"}
                </h3>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" disabled={!chartQuestionId} onClick={() => setTimerModalOpen(true)} aria-label="Set question timer">
                  <Timer size={14} />
                </Button>
                <Button type="button" variant={chartQuestion?.is_revealed ? "success" : "role"} size="sm" className="h-8 px-2.5 text-xs" loading={revealingQuestionId === chartQuestionId} disabled={!chartQuestion || chartQuestion.is_revealed} onClick={revealAnswer}>
                  {chartQuestion?.is_revealed ? <CheckCircle2 size={13} /> : <Eye size={13} />}
                  Reveal
                </Button>
              </div>
            </div>

            {chartQuestion?.options?.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 border-t border-slate-100 pt-1 dark:border-slate-800 sm:grid-cols-4">
                {chartQuestion.options.map((option, index) => (
                  <div key={`${index}:${option}`} className="truncate rounded-md border border-slate-100 bg-slate-50 px-2 py-1 text-xs font-medium dark:border-slate-800 dark:bg-slate-950">
                    <strong className="mr-1 text-role-primary">{String.fromCharCode(65 + index)}.</strong>
                    {option}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">Answer Distribution Metrics</h4>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 rounded-full p-0" disabled={chartQuestionIds.length <= 1} onClick={() => moveChart(-1)}>
                  <ChevronLeft size={14} />
                </Button>
                <span className="min-w-8 text-center text-xs font-black">{chartQuestionIds.length ? `${chartQuestionIndex + 1}/${chartQuestionIds.length}` : "0/0"}</span>
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 rounded-full p-0" disabled={chartQuestionIds.length <= 1} onClick={() => moveChart(1)}>
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>

            <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              <button
                type="button"
                className="group relative w-full rounded-xl border border-slate-100 bg-slate-50 p-2 text-left transition hover:bg-slate-100/50 dark:border-slate-800 dark:bg-slate-950/40"
                onClick={() => openDetails({ status: "all" })}
                onMouseEnter={() => loadSummaryPreview("answered")}
              >
                <div className="mb-1 flex items-center justify-between text-xs font-bold">
                  <span className="text-slate-500">Global Class Progress Rate</span>
                  <span className="font-black text-role-primary">{responseRate}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full bg-role-primary transition-all" style={{ width: `${responseRate}%` }} />
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] font-medium text-slate-400">
                  <span>{chartTotal} Active Submissions</span>
                  <span>{notAnsweredCount} Waiting Action</span>
                </div>
                <SummaryStudentPreview status="answered" title="Submitted Group" />
              </button>

              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {visibleAnswerRows.map(([answer, count], index) => {
                  const percentage = chartTotal ? Math.round((count / chartTotal) * 100) : 0;
                  const label = /^[A-D]$/i.test(String(answer).trim()) ? String(answer).trim().toUpperCase() : String.fromCharCode(65 + index);
                  return (
                    <button
                      key={answer}
                      type="button"
                      disabled={!chartQuestionId || count === 0}
                      onClick={() => openDetails({ status: "answered", answer })}
                      className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-2 text-xs transition hover:translate-x-0.5 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-role-primary text-[10px] font-black text-white">{label}</span>
                        <div className="min-w-0 flex-1">
                          <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div className="h-full bg-role-primary" style={{ width: `${percentage}%` }} />
                          </div>
                        </div>
                      </div>
                      <span className="ml-3 shrink-0 font-black text-slate-700 dark:text-slate-300">{percentage}% ({count})</span>
                    </button>
                  );
                })}
              </div>

              {chartTotal === 0 && (
                <div className="flex items-center justify-center gap-1.5 py-4 text-center text-xs text-slate-400">
                  <Activity size={12} className="animate-pulse" />
                  Live connection active. Awaiting first submission...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal open={detailsOpen} title={detailTitle()} onClose={() => setDetailsOpen(false)} panelClassName="max-w-3xl">
        <div className="grid gap-4">
          <div className="grid gap-3 rounded-[18px] bg-role-hover p-3 dark:bg-slate-950 sm:grid-cols-5">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Answered</p>
              <p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{detailsData?.summary?.answered ?? chartTotal}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-100">Correct</p>
              <p className="mt-1 text-xl font-black text-emerald-800 dark:text-emerald-50">{detailsData?.summary?.correct ?? correctCount}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-rose-700 dark:text-rose-100">Needs Review</p>
              <p className="mt-1 text-xl font-black text-rose-800 dark:text-rose-50">{detailsData?.summary?.incorrect ?? incorrectCount}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-amber-700 dark:text-amber-100">Not Answered</p>
              <p className="mt-1 text-xl font-black text-amber-800 dark:text-amber-50">{detailsData?.summary?.not_answered ?? notAnsweredCount}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Response Rate</p>
              <p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{detailsData?.summary?.response_rate ?? responseRate}%</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {[
                ["all", "All Responses"],
                ["answered", "Answered"],
                ["not_answered", "Not Answered"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={detailsStatus === value && !detailsAnswer && !detailsCorrectness ? "role" : "outline"}
                  onClick={() => {
                    setDetailsStatus(value);
                    setDetailsAnswer("");
                    setDetailsCorrectness("");
                  }}
                >
                  {label}
                </Button>
              ))}
              {[
                ["correct", "Correct"],
                ["incorrect", "Needs Review"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={detailsCorrectness === value ? "role" : "outline"}
                  onClick={() => {
                    setDetailsStatus("answered");
                    setDetailsAnswer("");
                    setDetailsCorrectness(value);
                  }}
                >
                  {label}
                </Button>
              ))}
              {detailsAnswer && <Badge tone="teal">Answer: {detailsAnswer}</Badge>}
              {detailsCorrectness && <Badge tone={detailsCorrectness === "correct" ? "green" : "red"}>{detailsCorrectness === "correct" ? "Correct" : "Needs review"}</Badge>}
            </div>
            <label className="relative block lg:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                className="adaptive-input focus-ring h-10 w-full border border-role-border pl-9 pr-3 text-sm"
                value={detailsSearch}
                onChange={(event) => setDetailsSearch(event.target.value)}
                placeholder="Search student name..."
              />
            </label>
          </div>

          <div className="max-h-[26rem] overflow-y-auto pr-1">
            {detailsLoading && <div className="rounded-[18px] bg-white p-4 text-sm font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-300">Loading response details...</div>}
            {!detailsLoading && (detailsData?.students || []).length === 0 && (
              <div className="rounded-[18px] bg-white p-4 text-sm font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-300">
                No students match this view yet.
              </div>
            )}
            {!detailsLoading && (detailsData?.students || []).map((student) => (
              <div key={`${student.status}:${student.student_id}:${student.selected_answer || "none"}`} className="mb-2 rounded-[18px] border border-role-border bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-black text-slate-950 dark:text-white">{student.student_name}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">ID {student.student_id}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={student.status === "answered" ? "green" : "gold"}>{student.status === "answered" ? "Answered" : "Not answered"}</Badge>
                    {student.is_correct === true && <Badge tone="green">Correct</Badge>}
                    {student.is_correct === false && <Badge tone="red">Needs review</Badge>}
                    {student.selected_answer && <Badge tone="teal">{student.selected_answer}</Badge>}
                    <Badge tone="slate">{formatSubmittedAt(student.submitted_at)}</Badge>
                    {student.confidence_level && <Badge tone="violet">{student.confidence_level}</Badge>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal open={qrModalOpen} title="Session QR code" onClose={() => setQrModalOpen(false)} panelClassName="max-w-md">
        <div className="grid gap-4 text-center">
          {session?.qr_code_base64 ? (
            <img className="mx-auto h-56 w-56 rounded-[24px] bg-white p-4 shadow-soft" src={session.qr_code_base64} alt="Session QR code" />
          ) : (
            <div className="rounded-[24px] border border-dashed border-role-border bg-role-hover px-4 py-10 text-sm font-bold text-slate-500 dark:bg-slate-950 dark:text-slate-300">
              QR code is not available for this session.
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
              Students can submit until this timer ends. Restarting resets the answer window.
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
