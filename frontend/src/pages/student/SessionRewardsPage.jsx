import { ArrowLeft, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { getGamificationSessionSummary } from "../../api/client";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { SessionRewardSummary } from "../../components/gamification/SessionRewardSummary";
import { PageHeader } from "../../components/PageHeader";

function readActiveSession() {
  try {
    return JSON.parse(localStorage.getItem("activeSession") || "null");
  } catch {
    return null;
  }
}

export function SessionRewardsPage() {
  const [searchParams] = useSearchParams();
  const activeSession = useMemo(readActiveSession, []);
  const sessionId = searchParams.get("session_id") || activeSession?.session_id || "";
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setError("");
    getGamificationSessionSummary(sessionId)
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load session rewards"))
      .finally(() => setLoading(false));
  }, [sessionId]);

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Session rewards"
        title="Reward Summary"
        description="Review XP, stars, badges, and level progress from your latest session."
        tone="role"
        action={
          <Link to="/student">
            <Button variant="outline">
              <ArrowLeft size={16} />
              Dashboard
            </Button>
          </Link>
        }
      />

      {!sessionId && (
        <DashboardCard>
          <div className="flex items-center gap-3">
            <Search className="text-role-primary" size={20} />
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No session selected yet. Join or complete a live session, then return here to see your reward summary.</p>
          </div>
        </DashboardCard>
      )}

      {sessionId && <SessionRewardSummary summary={summary} loading={loading} error={error} />}
    </div>
  );
}
