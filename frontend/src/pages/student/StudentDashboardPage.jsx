import { Activity, ArrowRight, BarChart3, BookOpen, Radio, RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  claimGamificationChallenge,
  claimGamificationMission,
  getGamificationBadges,
  getGamificationChallenges,
  getGamificationHistory,
  getGamificationLeaderboard,
  getGamificationMissions,
  getGamificationNotifications,
  getGamificationProfile,
  getStudentPrediction,
  getMyProgress,
  getStudentAnalytics,
  markAllGamificationNotificationsRead,
  markGamificationNotificationRead,
} from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { AchievementNotifications } from "../../components/gamification/AchievementNotifications";
import { BadgeCollection } from "../../components/gamification/BadgeCollection";
import { CelebrationOverlay } from "../../components/gamification/CelebrationOverlay";
import { ClassLeaderboard } from "../../components/gamification/ClassLeaderboard";
import { DailyMissionsCard } from "../../components/gamification/DailyMissionsCard";
import { GamificationHistory } from "../../components/gamification/GamificationHistory";
import { LevelProfileCard } from "../../components/gamification/LevelProfileCard";
import { RecentAchievementsPanel } from "../../components/gamification/RecentAchievementsPanel";
import { RewardLoopCard } from "../../components/gamification/RewardLoopCard";
import { WeeklyChallengesCard } from "../../components/gamification/WeeklyChallengesCard";
import { PageHeader } from "../../components/PageHeader";
import { StudentPredictionCard } from "../../components/predictions/PredictionPanels";
import { StatCard } from "../../components/StatCard";
import { useAuth } from "../../state/AuthContext";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";

function formatActivity(value) {
  if (!value) return "No activity yet";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function missedCount(total, done) {
  return Math.max(Number(total || 0) - Number(done || 0), 0);
}

function readActiveSession() {
  try {
    return JSON.parse(localStorage.getItem("activeSession") || "null");
  } catch {
    return null;
  }
}

function classParams(classId) {
  return classId ? { class_id: classId } : {};
}

async function safeGamificationRequest(request, fallback = null) {
  try {
    return await request;
  } catch {
    return fallback;
  }
}

export function StudentDashboardPage() {
  const { user, workspaces, refreshSession } = useAuth();
  const { currentWorkspace, selectWorkspace } = useCurrentWorkspace();
  const [analytics, setAnalytics] = useState([]);
  const [progress, setProgress] = useState(null);
  const [gameProfile, setGameProfile] = useState(null);
  const [mission, setMission] = useState(null);
  const [challenges, setChallenges] = useState(null);
  const [badges, setBadges] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [history, setHistory] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [loadingGame, setLoadingGame] = useState(false);
  const [gameError, setGameError] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimingChallengeId, setClaimingChallengeId] = useState("");
  const [celebration, setCelebration] = useState(null);
  const previousLevelRef = useRef(null);

  const studentClasses = workspaces.filter((workspace) => workspace.type === "student");
  const activeClass = currentWorkspace?.type === "student" ? currentWorkspace : studentClasses[0];
  const activeSession = useMemo(readActiveSession, []);
  const activeClassId = activeClass?.class_id;
  const hasClass = Boolean(activeClassId);
  const classAnalytics = activeClassId ? analytics.filter((row) => row.class_id === activeClassId) : analytics;
  const latestAnalytics = progress || classAnalytics[0] || null;
  const progressTrend = progress?.weekly_trend?.length ? progress.weekly_trend : [...classAnalytics].reverse();
  const chartData = progressTrend.map((row) => ({
    week: row.week,
    attendance: row.attendance_rate,
    participation: row.participation_rate,
    engagement: row.engagement_score,
  }));
  const totalSessions = latestAnalytics?.total_sessions ?? 0;
  const attendedSessions = latestAnalytics?.sessions_attended ?? 0;
  const questionsPresented = latestAnalytics?.questions_presented ?? 0;
  const questionsAnswered = latestAnalytics?.questions_answered ?? 0;

  const loadGamification = useCallback(async () => {
    if (!user?.user_id) return;
    setLoadingGame(true);
    setGameError("");
    try {
      const params = classParams(activeClassId);
      const [
        profileResult,
        missionResult,
        challengesResult,
        badgesResult,
        notificationsResult,
        historyResult,
        leaderboardResult,
        predictionResult,
      ] = await Promise.all([
        safeGamificationRequest(getGamificationProfile(params)),
        hasClass ? safeGamificationRequest(getGamificationMissions(params)) : Promise.resolve(null),
        hasClass
          ? safeGamificationRequest(getGamificationChallenges(params), { class_id: activeClassId, week_key: "", challenges: [] })
          : Promise.resolve(null),
        safeGamificationRequest(getGamificationBadges(params), { earned: [], unlocked: [], locked: [] }),
        safeGamificationRequest(getGamificationNotifications({ unreadOnly: false, limit: 10 }), []),
        safeGamificationRequest(getGamificationHistory(params), []),
        hasClass ? safeGamificationRequest(getGamificationLeaderboard({ ...params, period: "weekly" })) : Promise.resolve(null),
        hasClass ? safeGamificationRequest(getStudentPrediction(params), null) : Promise.resolve(null),
      ]);
      if (profileResult) {
        const previousLevel = previousLevelRef.current;
        const nextLevel = Number(profileResult?.level || 1);
        if (previousLevel && nextLevel > previousLevel) {
          setCelebration({
            variant: "level",
            level: nextLevel,
            title: "Level up",
            description: `Level ${nextLevel} achieved. New rewards are available.`,
          });
        }
        previousLevelRef.current = nextLevel;
      }
      setGameProfile(profileResult);
      setMission(missionResult);
      setChallenges(challengesResult);
      setBadges(badgesResult);
      setNotifications(notificationsResult);
      setHistory(historyResult);
      setLeaderboard(leaderboardResult);
      setPrediction(predictionResult);
      setGameError(profileResult ? "" : "Could not load your reward profile. Please try again.");
    } catch (err) {
      setGameError("Could not load your reward progress. Please try again.");
    } finally {
      setLoadingGame(false);
    }
  }, [activeClassId, hasClass, user?.user_id]);

  useEffect(() => {
    if (!user?.user_id) return;
    getStudentAnalytics(user.user_id).then(setAnalytics).catch(() => setAnalytics([]));
    getMyProgress(activeClassId ? { class_id: activeClassId } : {}).then(setProgress).catch(() => setProgress(null));
  }, [activeClassId, user?.user_id]);

  useEffect(() => {
    loadGamification();
  }, [loadGamification]);

  async function handleClaimMission(currentMission) {
    if (!currentMission?.mission_id) return;
    setClaiming(true);
    try {
      const result = await claimGamificationMission(currentMission.mission_id);
      setMission(result.mission);
      setGameProfile((current) => ({ ...current, ...(result.profile || {}) }));
      setCelebration({
        title: "Mission Complete",
        description: `You earned ${result.reward?.xp || 0} XP and ${result.reward?.stars || 0} stars.`,
      });
      await loadGamification();
    } catch (err) {
      setGameError(err instanceof Error ? err.message : "Could not claim mission reward");
    } finally {
      setClaiming(false);
    }
  }

  async function handleClaimChallenge(challenge) {
    if (!challenge?.challenge_id) return;
    setClaimingChallengeId(challenge.challenge_id);
    try {
      const result = await claimGamificationChallenge(challenge.challenge_id);
      setGameProfile((current) => ({ ...current, ...(result.profile || {}) }));
      setCelebration({
        title: "Challenge Complete",
        description: `You earned ${result.reward?.xp || 0} XP and ${result.reward?.stars || 0} stars.`,
      });
      await loadGamification();
    } catch (err) {
      setGameError(err instanceof Error ? err.message : "Could not claim challenge reward");
    } finally {
      setClaimingChallengeId("");
    }
  }

  async function handleReadNotification(notification) {
    if (!notification?.achievement_notification_id) return;
    await markGamificationNotificationRead(notification.achievement_notification_id).catch(() => {});
    setNotifications((current) => current.filter((item) => item.achievement_notification_id !== notification.achievement_notification_id));
  }

  async function handleReadAllNotifications() {
    await markAllGamificationNotificationsRead().catch(() => {});
    setNotifications([]);
  }

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Student dashboard"
        title={activeClass?.class_name ?? "Student workspace"}
                tone="role"
        action={
          <Link to="/student/join">
            <Button size="lg" variant="role">
              <Radio size={18} />
              Join session
            </Button>
          </Link>
        }
      />

      {!hasClass && (
        <DashboardCard>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Choose a class to unlock missions</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Your platform profile is visible now. Daily missions and class badges appear after a class is selected.</p>
            </div>
            <Button type="button" variant="outline" onClick={() => refreshSession()}>
              <RefreshCw size={16} />
              Refresh classes
            </Button>
          </div>
        </DashboardCard>
      )}

      <LevelProfileCard
        profile={gameProfile}
        rank={leaderboard?.current_student_rank}
        loading={loadingGame}
        error={gameError}
      />

      <RewardLoopCard />

      <WeeklyChallengesCard
        challengesData={challenges}
        loading={loadingGame}
        error={!hasClass ? "Select a class to load weekly challenges." : ""}
        onClaim={handleClaimChallenge}
        claimingId={claimingChallengeId}
      />

      <StudentPredictionCard prediction={prediction} loading={loadingGame} error="" />

      <div className="grid gap-4 xl:grid-cols-[1fr_0.85fr]">
        <DailyMissionsCard mission={mission} loading={loadingGame} error={!hasClass ? "Select a class to load today's mission." : ""} onClaim={handleClaimMission} claiming={claiming} />
        <RecentAchievementsPanel badges={badges} notifications={notifications} history={history} loading={loadingGame} />
      </div>

      <div className="grid gap-4">
        <BadgeCollection badges={badges} loading={loadingGame} error="" compact />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <ClassLeaderboard
          leaderboard={leaderboard}
          onRetry={loadGamification}
          loading={loadingGame}
          error={!hasClass ? "Select a class to see the weekly leaderboard." : ""}
          compact
        />
        <AchievementNotifications
          notifications={notifications}
          loading={loadingGame}
          error=""
          onRead={handleReadNotification}
          onReadAll={handleReadAllNotifications}
        />
      </div>

      <GamificationHistory events={history} loading={loadingGame} error="" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Enrolled classes"
          value={studentClasses.length}
          icon={Users}
          tone="role"
          detailPanel={{
            title: "Class details",
            description: "Classes available in your student workspace.",
            items: [
              { label: "Enrolled classes", value: studentClasses.length },
              { label: "Active class", value: activeClass?.class_name || "None selected" },
            ],
          }}
        />
        <StatCard
          label="My Attendance"
          value={formatPercent(latestAnalytics?.attendance_rate)}
          icon={Activity}
          tone="role"
          detail={latestAnalytics?.week ?? latestAnalytics?.risk_level ?? "No data"}
          detailPanel={{
            title: "Attendance details",
            description: "Sessions joined compared with sessions available.",
            items: [
              { label: "Sessions attended", value: formatCount(attendedSessions) },
              { label: "Sessions missed", value: formatCount(missedCount(totalSessions, attendedSessions)) },
              { label: "Total sessions", value: formatCount(totalSessions) },
            ],
          }}
        />
        <StatCard
          label="My Participation"
          value={formatPercent(latestAnalytics?.participation_rate)}
          icon={Radio}
          tone="gold"
          detailPanel={{
            title: "Participation details",
            description: "Live questions answered in your current class context.",
            items: [
              { label: "Questions answered", value: formatCount(questionsAnswered) },
              { label: "Not answered", value: formatCount(missedCount(questionsPresented, questionsAnswered)) },
              { label: "Questions presented", value: formatCount(questionsPresented) },
            ],
          }}
        />
        <StatCard
          label="My Engagement"
          value={formatPercent(latestAnalytics?.engagement_score)}
          icon={BarChart3}
          tone="role"
          detailPanel={{
            title: "Engagement details",
            description: "Combined learning activity score.",
            items: [
              { label: "Attendance", value: formatPercent(latestAnalytics?.attendance_rate) },
              { label: "Participation", value: formatPercent(latestAnalytics?.participation_rate) },
              { label: "Risk level", value: latestAnalytics?.risk_level || "No data" },
            ],
          }}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <ChartCard title="Learning Analytics" subtitle="Attendance, participation, and engagement score">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <XAxis dataKey="week" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip />
              <Area type="monotone" dataKey="attendance" stroke="#2B7886" strokeWidth={3} fill="#2B788626" />
              <Area type="monotone" dataKey="participation" stroke="#79D99C" strokeWidth={3} fill="#79D99C33" />
              <Area type="monotone" dataKey="engagement" stroke="#245866" strokeWidth={3} fill="#24586622" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <DashboardCard>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge tone="role">Current class</Badge>
              <h2 className="mt-3 text-lg font-black text-slate-950 dark:text-white">{activeClass?.class_name ?? "No class selected"}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {activeClass ? `Instructor: ${activeClass.instructor_name || "To be announced"}` : "Select an enrolled class to focus this workspace."}
              </p>
            </div>
            <Link to="/student/session">
              <Button variant="outline">
                Live class
                <ArrowRight size={16} />
              </Button>
            </Link>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="rounded-lg bg-role-hover p-4 dark:bg-slate-950/30">
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Live session</p>
              <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                {activeSession?.session_code ? `Session ${activeSession.session_code}` : "No live session joined"}
              </p>
            </div>
            <div className="rounded-lg bg-role-hover p-4 dark:bg-slate-950/30">
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Next action</p>
              <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">Join the session code shared by your instructor, then answer the live question.</p>
            </div>
          </div>
        </DashboardCard>
      </div>

      <DashboardCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Class access</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose the class context used by missions, badges, analytics, and live session access.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => refreshSession()}>
            <RefreshCw size={16} />
            Refresh
          </Button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {studentClasses.length === 0 && (
            <div className="rounded-lg border border-dashed border-role-border bg-role-hover p-4 text-sm font-semibold text-slate-500 dark:bg-slate-950/30 dark:text-slate-300">
              No enrolled classes yet. Your instructor can add your account from class management.
            </div>
          )}
          {studentClasses.map((workspace) => (
            <button
              key={`${workspace.type}-${workspace.class_id}`}
              className="focus-ring rounded-lg bg-slate-50 p-4 text-left transition hover:bg-role-hover dark:bg-slate-950"
              type="button"
              onClick={() => selectWorkspace(workspace)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-black text-slate-950 dark:text-white">{workspace.class_name ?? workspace.label ?? "Class"}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Instructor: {workspace.instructor_name || "To be announced"}</p>
                </div>
                <BookOpen className="shrink-0 text-role-primary" size={20} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <Badge tone={currentWorkspace?.class_id === workspace.class_id ? "green" : "slate"}>
                  {currentWorkspace?.class_id === workspace.class_id ? "Active" : formatActivity(workspace.last_activity_at)}
                </Badge>
                <ArrowRight className="text-slate-400" size={16} />
              </div>
            </button>
          ))}
        </div>
      </DashboardCard>

      <CelebrationOverlay
        show={Boolean(celebration)}
        title={celebration?.title}
        description={celebration?.description}
        variant={celebration?.variant}
        level={celebration?.level}
        onClose={() => setCelebration(null)}
      />
    </div>
  );
}
