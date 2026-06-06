import { Activity, BarChart3, ChevronLeft, ChevronRight, MessageCircle, Play, Radio, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { getInstructorSession, getLiveSessionStats, updateInstructorActiveQuestion } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
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

  useEffect(() => {
    let isMounted = true;

    async function load(showError = true) {
      if (!sessionId) return;
      try {
        const [sessionResult, statsResult] = await Promise.all([getInstructorSession(sessionId), getLiveSessionStats(sessionId)]);
        if (isMounted) {
          setSession(sessionResult);
          setStats(statsResult);
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

  const questionIds = session?.question_ids || [];
  const questionKey = questionIds.join("|");
  const chartQuestionIds = questionIds.slice(0, 4);
  const chartQuestionId = chartQuestionIds[chartQuestionIndex] || "";
  const chartDistribution = chartQuestionId ? (stats?.answer_distribution?.[chartQuestionId] ?? {}) : {};
  const chartTotal = Object.values(chartDistribution).reduce((sum, value) => sum + value, 0);
  const answerRows = Object.entries(chartDistribution).sort(([first], [second]) => first.localeCompare(second));
  const visibleAnswerRows = answerRows.length > 0 ? answerRows : PLACEHOLDER_ANSWERS.map((answer) => [answer, 0]);

  useEffect(() => {
    if (!sessionId || questionIds.length === 0) return;
    const storedQuestionId = session?.active_question_id || localStorage.getItem(`activeQuestionId:${sessionId}`) || localStorage.getItem("activeQuestionId") || "";
    const nextQuestionId = questionIds.includes(storedQuestionId) ? storedQuestionId : questionIds[0];
    setActiveQuestionId((current) => (questionIds.includes(current) ? current : nextQuestionId));
    localStorage.setItem(`activeQuestionId:${sessionId}`, nextQuestionId);
    localStorage.setItem("activeQuestionId", nextQuestionId);
  }, [session?.active_question_id, sessionId, questionKey]);

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
      const updatedSession = await updateInstructorActiveQuestion(sessionId, questionId);
      setSession(updatedSession);
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

  function moveChart(direction) {
    if (chartQuestionIds.length <= 1) return;
    setChartQuestionIndex((current) => (current + direction + chartQuestionIds.length) % chartQuestionIds.length);
  }

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Live classroom" title="Live dashboard"  tone="role" />

      {session && (
        <DashboardCard>
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <Badge tone={session.status === "active" ? "green" : session.status === "scheduled" ? "gold" : "slate"}>{session.status}</Badge>
              <p className="mt-3 text-sm font-black uppercase tracking-wide text-slate-500">Session code</p>
              <h2 className="mt-1 text-4xl font-black tracking-[0.2em] text-slate-900 dark:text-white">{session.session_code}</h2>
              {session.scheduled_for && (
                <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Starts {new Date(session.scheduled_for).toLocaleString()}</p>
              )}
              <p className="mt-2 break-all text-sm text-slate-500 dark:text-slate-400">{session.join_link}</p>
            </div>
            {session.qr_code_base64 && <img className="h-36 w-36 rounded-smart bg-white p-2 shadow-soft" src={session.qr_code_base64} alt="Session QR code" />}
          </div>
        </DashboardCard>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Joined students" value={stats?.participation_count ?? 0} icon={UsersRound} tone="violet" />
        <StatCard label="Submitted answers" value={responseCount} icon={MessageCircle} tone="gold" />
        <StatCard label="WebSocket status" value="Ready" icon={Activity} tone="emerald" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <DashboardCard className="overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-role-text">Question control</p>
              <h2 className="mt-1 text-lg font-black text-slate-900 dark:text-white">Activate one question</h2>
            </div>
            <Badge tone="teal">{questionIds.length} total</Badge>
          </div>

          <div className="mt-5 grid gap-3">
            {questionIds.length === 0 && (
              <div className="rounded-smart border border-dashed border-role-border bg-white/70 px-4 py-6 text-center text-sm font-semibold text-slate-500 dark:bg-slate-950/20 dark:text-slate-400">
                No questions are attached to this session yet.
              </div>
            )}
            {questionIds.map((questionId, index) => {
              const isActive = activeQuestionId === questionId;
              const answerCount = Object.values(stats?.answer_distribution?.[questionId] ?? {}).reduce((sum, value) => sum + value, 0);

              return (
                <div
                  key={questionId}
                  className={`rounded-[22px] border px-4 py-3 transition ${
                    isActive
                      ? "border-role-primary bg-[color-mix(in_srgb,var(--role-primary)_10%,white)] shadow-soft"
                      : "border-role-border bg-white/80 dark:border-slate-800 dark:bg-slate-950/20"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-role-primary text-sm font-black text-white">{index + 1}</span>
                        <p className="text-sm font-black text-slate-900 dark:text-white">Question {index + 1}</p>
                        {isActive && <Badge tone="green">Live now</Badge>}
                      </div>
                      <p className="mt-2 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">ID {shortenQuestionId(questionId)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <div className="text-right">
                        <p className="text-sm font-black text-slate-900 dark:text-white">{answerCount}</p>
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">answers</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={isActive ? "success" : "outline"}
                        className="min-w-28"
                        disabled={isActive}
                        loading={activatingQuestionId === questionId}
                        onClick={() => activateQuestion(questionId, index)}
                      >
                        {isActive ? <Radio size={15} /> : <Play size={15} />}
                        {isActive ? "Live" : "Activate"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </DashboardCard>

        <ChartCard
          title="Answer distribution"
          subtitle={chartQuestionIds.length ? `Question ${chartQuestionIndex + 1} of ${chartQuestionIds.length}` : "Waiting for questions"}
          action={
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-10 w-10 rounded-full p-0" disabled={chartQuestionIds.length <= 1} onClick={() => moveChart(-1)}>
                <ChevronLeft size={18} />
              </Button>
              <span className="min-w-12 text-center text-sm font-black text-slate-800 dark:text-white">
                {chartQuestionIds.length ? `${chartQuestionIndex + 1}/${chartQuestionIds.length}` : "0/0"}
              </span>
              <Button type="button" variant="ghost" size="sm" className="h-10 w-10 rounded-full p-0" disabled={chartQuestionIds.length <= 1} onClick={() => moveChart(1)}>
                <ChevronRight size={18} />
              </Button>
            </div>
          }
        >
          <div className="flex h-full flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-white px-4 py-3 shadow-sm dark:bg-slate-900">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-role-primary text-white">
                  <BarChart3 size={20} />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-900 dark:text-white">
                    {chartQuestionId ? `Question ${chartQuestionIndex + 1}` : "No question selected"}
                  </p>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {chartQuestionId ? `ID ${shortenQuestionId(chartQuestionId)}` : "Attach questions to start tracking"}
                  </p>
                </div>
              </div>
              <Badge tone={activeQuestionId === chartQuestionId ? "green" : "slate"}>{activeQuestionId === chartQuestionId ? "Live focus" : "Preview"}</Badge>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {visibleAnswerRows.map(([answer, count]) => {
                const percentage = chartTotal ? Math.round((count / chartTotal) * 100) : 0;

                return (
                  <div key={answer} className="rounded-[18px] bg-white px-4 py-3 shadow-sm dark:bg-slate-900">
                    <div className="flex items-start justify-between gap-3">
                      <p className="line-clamp-2 text-sm font-bold text-slate-700 dark:text-slate-200">{answer}</p>
                      <span className="shrink-0 text-sm font-black text-slate-900 dark:text-white">{count}</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="h-full rounded-full bg-role-primary transition-all" style={{ width: `${percentage}%` }} />
                    </div>
                    <p className="mt-2 text-right text-xs font-bold text-slate-500 dark:text-slate-400">{percentage}%</p>
                  </div>
                );
              })}
            </div>

            {chartTotal === 0 && (
              <div className="flex items-center justify-center gap-2 text-center text-xs font-bold text-slate-500 dark:text-slate-400">
                <Activity size={15} />
                Waiting for student responses on this question.
              </div>
            )}
            {questionIds.length > 4 && (
              <p className="text-center text-xs font-semibold text-slate-500 dark:text-slate-400">Showing the first 4 questions for the live carousel.</p>
            )}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
