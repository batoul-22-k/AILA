import { ArrowLeft, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { getGamificationBadges, getGamificationHistory, getGamificationLeaderboard, getGamificationProfile } from "../../api/client";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { BadgeCollection } from "../../components/gamification/BadgeCollection";
import { GamificationHistory } from "../../components/gamification/GamificationHistory";
import { LevelProfileCard } from "../../components/gamification/LevelProfileCard";
import { RewardLoopCard } from "../../components/gamification/RewardLoopCard";
import { PageHeader } from "../../components/PageHeader";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";

function classParams(classId) {
  return classId ? { class_id: classId } : {};
}

async function safeRequest(request, fallback = null) {
  try {
    return await request;
  } catch {
    return fallback;
  }
}

export function AchievementsPage() {
  const { currentWorkspace } = useCurrentWorkspace();
  const classId = currentWorkspace?.type === "student" ? currentWorkspace.class_id : "";
  const [profile, setProfile] = useState(null);
  const [badges, setBadges] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = classParams(classId);
      const [profileResult, badgesResult, historyResult, leaderboardResult] = await Promise.all([
        safeRequest(getGamificationProfile(params)),
        safeRequest(getGamificationBadges(params), { earned: [], unlocked: [], locked: [] }),
        safeRequest(getGamificationHistory(params), []),
        classId ? safeRequest(getGamificationLeaderboard({ ...params, period: "weekly" })) : Promise.resolve(null),
      ]);
      setProfile(profileResult);
      setBadges(badgesResult);
      setHistory(historyResult);
      setLeaderboard(leaderboardResult);
      setError(profileResult ? "" : "Could not load achievement profile");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load achievements");
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Achievements"
        title="Achievement Collection"
        description="Track badge progress, level growth, and recent reward history."
        tone="role"
        action={
          <div className="flex gap-2">
            <Link to="/student">
              <Button variant="outline">
                <ArrowLeft size={16} />
                Dashboard
              </Button>
            </Link>
            <Button variant="role" onClick={load} loading={loading}>
              <RefreshCw size={16} />
              Refresh
            </Button>
          </div>
        }
      />

      {!classId && (
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Select a student class workspace to see class-scoped badge progress. Platform badges are still shown when available.</p>
        </DashboardCard>
      )}

      <LevelProfileCard
        profile={profile}
        rank={leaderboard?.current_student_rank}
        loading={loading}
        error={error}
        compact
      />
      <RewardLoopCard />
      <BadgeCollection badges={badges} loading={loading} error={error} />
      <GamificationHistory events={history} loading={loading} error="" />
    </div>
  );
}
