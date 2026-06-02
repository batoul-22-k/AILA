import { Activity, MessageCircle, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { getInstructorSession, getLiveSessionStats } from "../../api/client";
import { Badge } from "../../components/Badge";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import { useToast } from "../../components/ToastProvider";

export function LiveParticipationDashboardPage() {
  const { showToast } = useToast();
  const params = useParams();
  const savedSession = JSON.parse(localStorage.getItem("instructorSession") || "null");
  const sessionId = params.sessionId || savedSession?.session_id;
  const [session, setSession] = useState(savedSession);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    async function load() {
      if (!sessionId) return;
      try {
        const [sessionResult, statsResult] = await Promise.all([getInstructorSession(sessionId), getLiveSessionStats(sessionId)]);
        setSession(sessionResult);
        setStats(statsResult);
      } catch (err) {
        showToast({ title: "Could not load live session", description: err instanceof Error ? err.message : "Could not load live session", tone: "error" });
      }
    }
    load();
  }, [sessionId]);

  const responseCount = stats?.answer_distribution
    ? Object.values(stats.answer_distribution).flatMap((answers) => Object.values(answers)).reduce((sum, value) => sum + value, 0)
    : 0;

  if (!sessionId) {
    return <EmptyState title="No session selected" description="Create a session first, then open its live dashboard." />;
  }

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Live classroom" title="Live dashboard" description="WebSocket tracking hooks are ready; this view shows real session details and placeholder live counters." tone="role" />

      {session && (
        <DashboardCard>
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <Badge tone={session.status === "active" ? "green" : "slate"}>{session.status}</Badge>
              <p className="mt-3 text-sm font-black uppercase tracking-wide text-slate-500">Session code</p>
              <h2 className="mt-1 text-4xl font-black tracking-[0.2em] text-slate-900 dark:text-white">{session.session_code}</h2>
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
        <DashboardCard>
          <h2 className="text-lg font-black text-slate-900 dark:text-white">Active questions</h2>
          <div className="mt-4 grid gap-2">
            {(session?.question_ids || []).map((questionId) => (
              <div key={questionId} className="rounded-smart bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                {questionId}
              </div>
            ))}
          </div>
        </DashboardCard>
        <ChartCard title="Answer distribution" subtitle="Placeholder-ready for WebSocket live tracking">
          <div className="grid h-full place-items-center text-center">
            <div>
              <Activity className="mx-auto text-role-text" size={34} />
              <p className="mt-3 text-sm font-bold text-slate-600 dark:text-slate-300">Live distribution will update as students submit answers.</p>
              <p className="mt-1 text-xs text-slate-500">TODO: connect final per-question WebSocket visualization.</p>
            </div>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
