import { ArrowLeft, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { claimGamificationChallenge, getGamificationChallenges, getGamificationLeaderboard } from "../../api/client";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { ClassLeaderboard } from "../../components/gamification/ClassLeaderboard";
import { WeeklyChallengesCard } from "../../components/gamification/WeeklyChallengesCard";
import { PageHeader } from "../../components/PageHeader";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";

export function LeaderboardPage() {
  const { currentWorkspace } = useCurrentWorkspace();
  const classId = currentWorkspace?.type === "student" ? currentWorkspace.class_id : "";
  const [period, setPeriod] = useState("weekly");
  const [leaderboard, setLeaderboard] = useState(null);
  const [challenges, setChallenges] = useState(null);
  const [loading, setLoading] = useState(Boolean(classId));
  const [claimingChallengeId, setClaimingChallengeId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!classId) {
      setLeaderboard(null);
      setChallenges(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [leaderboardResult, challengesResult] = await Promise.all([
        getGamificationLeaderboard({ class_id: classId, period }),
        getGamificationChallenges({ class_id: classId }),
      ]);
      setLeaderboard(leaderboardResult);
      setChallenges(challengesResult);
    } catch {
      setError("No leaderboard data available yet.");
    } finally {
      setLoading(false);
    }
  }, [classId, period]);

  async function handleClaimChallenge(challenge) {
    if (!challenge?.challenge_id) return;
    setClaimingChallengeId(challenge.challenge_id);
    try {
      await claimGamificationChallenge(challenge.challenge_id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not claim challenge reward");
    } finally {
      setClaimingChallengeId("");
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Leaderboard"
        title={currentWorkspace?.class_name ?? "Class Leaderboard"}
        description="Healthy class competition based on XP, stars, participation, and progress."
        tone="role"
        action={
          <div className="flex gap-2">
            <Link to="/student">
              <Button variant="outline">
                <ArrowLeft size={16} />
                Dashboard
              </Button>
            </Link>
            <Button variant="role" onClick={load} loading={loading} disabled={!classId}>
              <RefreshCw size={16} />
              Refresh
            </Button>
          </div>
        }
      />

      {!classId && (
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
            Select a student class workspace to see your class leaderboard.
          </p>
        </DashboardCard>
      )}

      {classId && (
        <div className="grid gap-4 xl:grid-cols-[1fr_0.42fr]">
          <ClassLeaderboard
            leaderboard={leaderboard}
            period={period}
            onPeriodChange={setPeriod}
            loading={loading}
            error={error}
            onRetry={load}
          />
          <WeeklyChallengesCard
            challengesData={challenges}
            loading={loading}
            error=""
            onClaim={handleClaimChallenge}
            claimingId={claimingChallengeId}
          />
        </div>
      )}
    </div>
  );
}
