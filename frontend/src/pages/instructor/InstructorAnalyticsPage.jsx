import { AlertTriangle, BarChart3, BookOpen, CheckCircle2, Eye, RefreshCw, Target, TrendingDown, TrendingUp, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getClassAnalytics, getClassPredictionSummary, listClasses, listClassStudents, runPredictionAnalysis } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { Modal } from "../../components/Modal";
import { PageHeader } from "../../components/PageHeader";
import { TableHeaderFilter, TableToolbar } from "../../components/table";

function percent(value, fallback = "Pending") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return `${Math.round(numeric > 0 && numeric <= 1 ? numeric * 100 : numeric)}%`;
}

function shortDate(value) {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function riskTone(level) {
  const clean = String(level || "").toLowerCase();
  if (clean === "high") return "red";
  if (clean === "medium") return "gold";
  return "green";
}

function riskLabel(level) {
  const clean = String(level || "low").toLowerCase();
  if (clean === "high") return "High";
  if (clean === "medium") return "Medium";
  return "Low";
}

function activityStatus(row) {
  const recent = Number(row?.features?.recent_activity_count ?? row?.features?.activity_last_7_days ?? row?.recent_activity_count ?? 0);
  if (recent <= 0) return "Inactive";
  if (recent < 3) return "Recently active";
  return "Active";
}

function driverText(driver) {
  if (!driver) return "";
  if (typeof driver === "string") return driver;
  return driver.driver || driver.factor || driver.label || driver.name || driver.source || "Risk factor";
}

function metricValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, numeric > 0 && numeric <= 1 ? numeric * 100 : numeric));
}

function metricDisplay(value) {
  const normalized = metricValue(value);
  return normalized === null ? "No data" : `${Math.round(normalized)}%`;
}

function averageMetric(values) {
  const clean = values.map(metricValue).filter((value) => value !== null);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function firstMetric(source, keys) {
  if (!source) return null;
  for (const key of keys) {
    const value = metricValue(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function riskBucket(level) {
  const clean = String(level || "low").toLowerCase();
  if (clean === "critical" || clean === "high") return "high";
  if (clean === "medium") return "medium";
  return "low";
}

function riskDistributionFor(summary, rows) {
  const fromSummary = summary?.risk_distribution || {};
  const hasSummary = ["low", "medium", "high"].some((key) => Number(fromSummary[key] || 0) > 0);
  if (hasSummary) {
    return {
      low: Number(fromSummary.low || 0),
      medium: Number(fromSummary.medium || 0),
      high: Number(fromSummary.high || 0),
    };
  }
  return rows.reduce((counts, row) => {
    counts[riskBucket(row.risk_level)] += 1;
    return counts;
  }, { low: 0, medium: 0, high: 0 });
}

function trendDelta(points, key) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const latest = metricValue(points[points.length - 1]?.[key]);
  const previous = metricValue(points[points.length - 2]?.[key]);
  if (latest === null || previous === null) return null;
  return Math.round(latest - previous);
}

function trendCurrent(points, key, fallback) {
  if (Array.isArray(points) && points.length) {
    const latest = metricValue(points[points.length - 1]?.[key]);
    if (latest !== null) return latest;
  }
  return fallback;
}

function weakConceptLabel(row) {
  return row?.concept || row?.bloom_level || row?.label || row?.name || "Concept";
}

function MetricProgress({ value }) {
  const numeric = Number(value);
  const normalized = Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric > 0 && numeric <= 1 ? numeric * 100 : numeric)) : 0;
  const tone = normalized < 60 ? "bg-red-500" : normalized < 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="grid min-w-[6.5rem] gap-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${normalized}%` }} />
      </div>
      <span className="text-xs font-black text-slate-700 dark:text-slate-200">{percent(value, "-")}</span>
    </div>
  );
}

function classNameFor(classesById, classId) {
  return classesById.get(classId)?.name || classesById.get(classId)?.class_name || classId || "Class";
}

function predictionRows(summary) {
  return summary?.student_reports?.length ? summary.student_reports : summary?.predictions?.length ? summary.predictions : summary?.at_risk_students || [];
}

function mergeRoster(students, summary, classesById, classId) {
  const predictionsByStudent = new Map(predictionRows(summary).map((row) => [row.student_id, row]));
  return students.map((student) => {
    const prediction = predictionsByStudent.get(student.user_id) || {};
    const features = prediction.features || {};
    return {
      ...student,
      student_id: student.user_id,
      student_name: student.name,
      class_id: prediction.class_id || classId,
      class_name: prediction.class_name || classNameFor(classesById, prediction.class_id || classId),
      attendance_rate: prediction.attendance ?? features.attendance_rate,
      participation_rate: prediction.participation ?? features.participation_rate ?? features.answer_rate,
      correctness_rate: prediction.correctness ?? features.correctness_rate,
      engagement_score: prediction.engagement ?? features.engagement_score ?? prediction.engagement_index,
      risk_level: prediction.risk_level || "low",
      last_active_at: prediction.generated_at || prediction.predicted_at || student.joined_at,
      activity_status: activityStatus(prediction),
      analytics_source: prediction,
    };
  });
}

function StudentAnalyticsModal({ student, onClose }) {
  return (
    <Modal open={Boolean(student)} title="Student Analytics" onClose={onClose} panelClassName="max-w-3xl">
      {student && (
        <div className="grid gap-4">
          <section className="rounded-lg border border-role-border p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-slate-950 dark:text-white">{student.student_name}</h3>
                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{student.email || student.student_id}</p>
              </div>
              <Badge tone={riskTone(student.risk_level)}>{riskLabel(student.risk_level)} Risk</Badge>
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
              Classroom monitoring summary for {student.class_name}.
            </p>
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            {[
              ["Attendance", student.attendance_rate],
              ["Participation", student.participation_rate],
              ["Correctness", student.correctness_rate],
              ["Engagement", student.engagement_score],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-role-border p-4 dark:border-slate-800">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{percent(value)}</p>
              </div>
            ))}
          </section>
        </div>
      )}
    </Modal>
  );
}

function ClassSelector({ classes, value, onChange }) {
  return (
    <select
      className="adaptive-input h-10 w-full rounded-lg border border-role-border bg-white px-3 text-sm font-semibold dark:border-slate-800 dark:bg-slate-900 sm:w-60"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Selected class"
    >
      {classes.map((classDoc) => (
        <option key={classDoc.class_id} value={classDoc.class_id}>{classDoc.name}</option>
      ))}
    </select>
  );
}

function useInstructorAnalyticsData() {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState("");
  const [summary, setSummary] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadClasses() {
      const classResult = await listClasses().catch(() => []);
      setClasses(classResult);
      setClassId((current) => current || classResult[0]?.class_id || "");
    }
    loadClasses();
  }, []);

  useEffect(() => {
    async function loadClassData() {
      if (!classId) return;
      setLoading(true);
      setError("");
      try {
        const [summaryResult, analyticsResult, studentRows] = await Promise.all([
          getClassPredictionSummary(classId).catch(() => null),
          getClassAnalytics(classId).catch(() => null),
          listClassStudents(classId).catch(() => []),
        ]);
        setSummary(summaryResult);
        setAnalytics(analyticsResult);
        setStudents(studentRows);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load analytics");
      } finally {
        setLoading(false);
      }
    }
    loadClassData();
  }, [classId]);

  return { classes, classId, setClassId, summary, analytics, students, loading, error, setError, setSummary };
}

function SummaryMetricCard({ label, value, detail, icon: Icon = BarChart3 }) {
  return (
    <DashboardCard className="p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{value}</p>
          {detail && <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{detail}</p>}
        </div>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-role-hover text-role-primary dark:bg-slate-900">
          <Icon size={17} />
        </span>
      </div>
    </DashboardCard>
  );
}

function SectionCard({ title, children, action, className = "" }) {
  return (
    <DashboardCard className={`p-4 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-black text-slate-950 dark:text-white">{title}</h2>
        {action}
      </div>
      {children}
    </DashboardCard>
  );
}

function RiskBar({ label, count, total, tone }) {
  const percentage = total ? Math.round((count / total) * 100) : 0;
  const colors = {
    low: "bg-emerald-500",
    medium: "bg-amber-500",
    high: "bg-red-500",
  };
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-sm font-semibold">
        <span className="text-slate-600 dark:text-slate-300">{label}</span>
        <span className="font-black text-slate-950 dark:text-white">{count} · {percentage}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-role-hover dark:bg-slate-950/60">
        <div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${Math.max(percentage, count ? 5 : 0)}%` }} />
      </div>
    </div>
  );
}

function ClassRiskOverview({ distribution, total }) {
  return (
    <SectionCard title="Class Risk Overview">
      <div className="mt-4 grid gap-3">
        <RiskBar label="Low Risk" count={distribution.low} total={total} tone="low" />
        <RiskBar label="Medium Risk" count={distribution.medium} total={total} tone="medium" />
        <RiskBar label="High Risk" count={distribution.high} total={total} tone="high" />
      </div>
    </SectionCard>
  );
}

function StudentsSupportSummary({ rows }) {
  const supportRows = rows
    .filter((row) => ["medium", "high"].includes(riskBucket(row.risk_level)))
    .sort((first, second) => {
      const riskDiff = (riskBucket(second.risk_level) === "high" ? 2 : 1) - (riskBucket(first.risk_level) === "high" ? 2 : 1);
      return riskDiff || String(first.student_name || "").localeCompare(String(second.student_name || ""));
    })
    .slice(0, 5);

  return (
    <SectionCard
      title="Students Requiring Support"
      action={<Badge tone={supportRows.length ? "gold" : "green"}>{supportRows.length} shown</Badge>}
    >
      <div className="mt-4 grid gap-2">
        {supportRows.length ? supportRows.map((row) => (
          <div key={`${row.student_id}-${row.class_id}`} className="flex items-center justify-between gap-3 rounded-lg bg-role-hover px-3 py-2 dark:bg-slate-950/40">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-900 dark:text-white">{row.student_name}</p>
              <p className="text-xs font-semibold text-slate-500">{metricDisplay(row.engagement_score)} engagement</p>
            </div>
            <Badge tone={riskTone(row.risk_level)}>{riskLabel(row.risk_level)}</Badge>
          </div>
        )) : <p className="text-sm font-semibold text-slate-500">No students currently require support.</p>}
      </div>
      <div className="mt-3 text-right">
        <Link to="/instructor/at-risk" className="text-sm font-black text-role-primary transition hover:underline">Open At-Risk Students -&gt;</Link>
      </div>
    </SectionCard>
  );
}

function TrendCard({ title, value, delta }) {
  const tone = delta === null ? "slate" : delta < 0 ? "red" : delta > 0 ? "green" : "slate";
  const Icon = delta === null || delta === 0 ? BarChart3 : delta > 0 ? TrendingUp : TrendingDown;
  return (
    <SectionCard title={title} action={<Badge tone={tone}><Icon size={13} />{delta === null ? "No trend" : `${delta > 0 ? "+" : ""}${delta}%`}</Badge>}>
      <div className="mt-5">
        <p className="text-3xl font-black text-slate-950 dark:text-white">{metricDisplay(value)}</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">Latest measured class average</p>
      </div>
    </SectionCard>
  );
}

function BloomMastery({ weakConcepts }) {
  const levels = ["remember", "understand", "apply", "analyze", "evaluate", "create"];
  const byLevel = new Map((weakConcepts || []).map((row) => [String(row.concept || row.bloom_level || "").toLowerCase(), row]));
  return (
    <SectionCard title="Bloom Mastery">
      <div className="mt-4 grid gap-2">
        {levels.map((level) => {
          const row = byLevel.get(level);
          const mastery = row ? metricValue(row.mastery_rate ?? row.average_correctness) ?? 0 : 100;
          const tone = mastery < 60 ? "bg-amber-500" : "bg-emerald-500";
          return (
            <div key={level} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-3">
              <span className="text-xs font-black capitalize text-slate-600 dark:text-slate-300">{level}</span>
              <div className="h-2 overflow-hidden rounded-full bg-role-hover dark:bg-slate-950/60">
                <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(mastery, 5)}%` }} />
              </div>
              <span className="text-right text-xs font-black text-slate-500">{Math.round(mastery)}%</span>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function WeakConcepts({ weakConcepts }) {
  const rows = (weakConcepts || []).slice(0, 6);
  return (
    <SectionCard title="Weak Concepts">
      <div className="mt-4 grid gap-2">
        {rows.length ? rows.map((row, index) => (
          <div key={`${weakConceptLabel(row)}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-role-hover px-3 py-2 dark:bg-slate-950/40">
            <span className="truncate text-sm font-black text-slate-800 dark:text-slate-100">{weakConceptLabel(row)}</span>
            <span className="text-xs font-black text-slate-500">{metricDisplay(row.mastery_rate ?? row.average_correctness)}</span>
          </div>
        )) : <p className="text-sm font-semibold text-slate-500">No weak concepts detected.</p>}
      </div>
    </SectionCard>
  );
}

function CommonRiskFactors({ drivers }) {
  const rows = (drivers || []).slice(0, 5);
  return (
    <SectionCard title="Common Risk Factors">
      <div className="mt-4 grid gap-2">
        {rows.length ? rows.map((driver, index) => (
          <div key={`${driverText(driver)}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-role-hover px-3 py-2 dark:bg-slate-950/40">
            <span className="truncate text-sm font-black text-slate-800 dark:text-slate-100">{driverText(driver)}</span>
            {driver?.percentage !== undefined && <span className="text-xs font-black text-slate-500">{Math.round(Number(driver.percentage || 0))}%</span>}
          </div>
        )) : <p className="text-sm font-semibold text-slate-500">No common risk factors detected.</p>}
      </div>
    </SectionCard>
  );
}

function QuickClassStatistics({ analytics, rows, distribution }) {
  const stats = [
    ["Active Students", analytics?.active_students ?? rows.filter((row) => row.activity_status !== "Inactive").length],
    ["Measured Week", analytics?.week || "No data"],
    ["Low / Medium / High", `${distribution.low} / ${distribution.medium} / ${distribution.high}`],
    ["Roster Size", rows.length],
  ];
  return (
    <SectionCard title="Quick Class Statistics">
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-role-hover px-3 py-2 dark:bg-slate-950/40">
            <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-sm font-black text-slate-950 dark:text-white">{value}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function InstructorAnalyticsPage() {
  const { classes, classId, setClassId, summary, analytics, students, loading, error, setError, setSummary } = useInstructorAnalyticsData();
  const [runningPrediction, setRunningPrediction] = useState(false);
  const classesById = useMemo(() => new Map(classes.map((row) => [row.class_id, row])), [classes]);
  const rows = useMemo(() => mergeRoster(students, summary, classesById, classId), [students, summary, classesById, classId]);
  const distribution = useMemo(() => riskDistributionFor(summary, rows), [summary, rows]);
  const totalAnalyzed = distribution.low + distribution.medium + distribution.high || rows.length || analytics?.total_students || 0;
  const weeklyAverages = analytics?.weekly_averages || [];
  const averageAttendance = firstMetric(analytics, ["average_attendance_rate", "attendance_rate", "average_attendance"]) ?? averageMetric(rows.map((row) => row.attendance_rate));
  const averageParticipation = firstMetric(analytics, ["average_participation_rate", "participation_rate", "average_participation"]) ?? averageMetric(rows.map((row) => row.participation_rate));
  const averageEngagement = firstMetric(analytics, ["average_engagement_score", "engagement_score", "average_engagement"]) ?? averageMetric(rows.map((row) => row.engagement_score));
  const averageCorrectness = averageMetric(rows.map((row) => row.correctness_rate));
  const weakConcepts = summary?.weak_concepts || [];
  const drivers = summary?.top_risk_drivers || [];

  async function handleRunPrediction() {
    if (!classId) return;
    setRunningPrediction(true);
    setError("");
    try {
      await runPredictionAnalysis(classId);
      setSummary(await getClassPredictionSummary(classId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update classroom support insights");
    } finally {
      setRunningPrediction(false);
    }
  }

  return (
    <div className="page-grid gap-5">
      <PageHeader
        title="Instructor Analytics"
        description="Classroom support overview for your selected class."
        tone="role"
        action={(
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
            <ClassSelector classes={classes} value={classId} onChange={setClassId} />
            <Button type="button" variant="role" loading={runningPrediction} onClick={handleRunPrediction} disabled={!classId} className="h-10 px-3">
              <RefreshCw size={16} />
              Refresh
            </Button>
          </div>
        )}
      />

      {error && <DashboardCard className="p-4 shadow-sm"><p className="text-sm font-semibold text-red-600">{error}</p></DashboardCard>}
      {loading ? (
        <DashboardCard className="p-4 shadow-sm"><div className="h-72 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /></DashboardCard>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SummaryMetricCard label="Students Analyzed" value={totalAnalyzed} detail={`${rows.length} enrolled in selected class`} icon={UsersRound} />
            <SummaryMetricCard label="Average Engagement" value={metricDisplay(averageEngagement)} icon={BarChart3} />
            <SummaryMetricCard label="Average Attendance" value={metricDisplay(averageAttendance)} icon={CheckCircle2} />
            <SummaryMetricCard label="Average Participation" value={metricDisplay(averageParticipation)} icon={Target} />
            <SummaryMetricCard label="Average Correctness" value={metricDisplay(averageCorrectness)} icon={BookOpen} />
            <SummaryMetricCard label="Risk Distribution" value={`${distribution.low}/${distribution.medium}/${distribution.high}`} detail="Low / Medium / High" icon={AlertTriangle} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ClassRiskOverview distribution={distribution} total={totalAnalyzed} />
            <StudentsSupportSummary rows={rows} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <TrendCard title="Engagement Trend" value={trendCurrent(weeklyAverages, "average_engagement_score", averageEngagement)} delta={trendDelta(weeklyAverages, "average_engagement_score")} />
            <TrendCard title="Attendance Trend" value={trendCurrent(weeklyAverages, "average_attendance_rate", averageAttendance)} delta={trendDelta(weeklyAverages, "average_attendance_rate")} />
            <TrendCard title="Participation Trend" value={trendCurrent(weeklyAverages, "average_participation_rate", averageParticipation)} delta={trendDelta(weeklyAverages, "average_participation_rate")} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <BloomMastery weakConcepts={weakConcepts} />
            <WeakConcepts weakConcepts={weakConcepts} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <CommonRiskFactors drivers={drivers} />
            <QuickClassStatistics analytics={analytics} rows={rows} distribution={distribution} />
          </div>
        </>
      )}
    </div>
  );
}

export function InstructorStudentsAnalyticsPage() {
  const { classes, classId, setClassId, summary, students, loading, error } = useInstructorAnalyticsData();
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [activityFilter, setActivityFilter] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const classesById = useMemo(() => new Map(classes.map((row) => [row.class_id, row])), [classes]);
  const rows = useMemo(() => mergeRoster(students, summary, classesById, classId), [students, summary, classesById, classId]);
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = !query || [row.student_name, row.email, row.student_id].some((value) => String(value || "").toLowerCase().includes(query));
      return matchesSearch
        && (!riskFilter || riskLabel(row.risk_level) === riskFilter)
        && (!activityFilter || row.activity_status === activityFilter);
    });
  }, [rows, search, riskFilter, activityFilter]);
  const activeFilterChips = [
    { key: "risk", label: "Risk", valueLabel: riskFilter, onClear: () => setRiskFilter("") },
    { key: "activity", label: "Activity", valueLabel: activityFilter, onClear: () => setActivityFilter("") },
  ];
  const clearFilters = () => {
    setSearch("");
    setRiskFilter("");
    setActivityFilter("");
  };

  return (
    <div className="page-grid gap-5">
      <PageHeader
        title="Students"
              tone="role"
        action={<ClassSelector classes={classes} value={classId} onChange={setClassId} />}
      />
      {error && <DashboardCard className="p-4"><p className="text-sm font-semibold text-red-600">{error}</p></DashboardCard>}
      <DashboardCard className="p-4 shadow-sm">
        <TableToolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search students"
          filters={activeFilterChips}
          onClearFilters={clearFilters}
        >
          <Badge tone="slate">{filteredRows.length} students</Badge>
        </TableToolbar>

        <div className="mt-4 overflow-auto rounded-lg border border-role-border dark:border-slate-800">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead className="bg-role-hover text-xs font-black uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2.5">Student</th>
                <th className="px-3 py-2.5">Attendance</th>
                <th className="px-3 py-2.5">Participation</th>
                <th className="px-3 py-2.5">Correctness</th>
                <th className="px-3 py-2.5">Engagement</th>
                <th className="px-3 py-2.5">
                  <TableHeaderFilter
                    label="Risk"
                    value={riskFilter}
                    onChange={setRiskFilter}
                    allLabel="All risk"
                    options={[{ value: "", label: "All risk" }, { value: "High", label: "High" }, { value: "Medium", label: "Medium" }, { value: "Low", label: "Low" }]}
                  />
                </th>
                <th className="px-3 py-2.5">
                  <TableHeaderFilter
                    label="Activity"
                    value={activityFilter}
                    onChange={setActivityFilter}
                    allLabel="All activity"
                    options={[{ value: "", label: "All activity" }, { value: "Active", label: "Active" }, { value: "Recently active", label: "Recently active" }, { value: "Inactive", label: "Inactive" }]}
                  />
                </th>
                <th className="px-3 py-2.5 text-right">View</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-role-border bg-white dark:divide-slate-800 dark:bg-slate-900">
              {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-sm font-semibold text-slate-500">Loading students...</td></tr>}
              {!loading && filteredRows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-sm font-semibold text-slate-500">No students match the current filters.</td></tr>}
              {!loading && filteredRows.map((row) => (
                <tr key={`${row.student_id}-${row.class_id}`} className="transition hover:bg-role-hover/60 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-3">
                    <p className="font-black text-slate-950 dark:text-white">{row.student_name}</p>
                    <p className="mt-0.5 text-xs font-semibold text-slate-500">{row.email || row.student_id}</p>
                  </td>
                  <td className="px-3 py-3"><MetricProgress value={row.attendance_rate} /></td>
                  <td className="px-3 py-3"><MetricProgress value={row.participation_rate} /></td>
                  <td className="px-3 py-3"><MetricProgress value={row.correctness_rate} /></td>
                  <td className="px-3 py-3"><MetricProgress value={row.engagement_score} /></td>
                  <td className="px-3 py-3"><Badge tone={riskTone(row.risk_level)}>{riskLabel(row.risk_level)}</Badge></td>
                  <td className="px-3 py-3">
                    <p className="font-semibold text-slate-700 dark:text-slate-200">{shortDate(row.last_active_at)}</p>
                    <p className="mt-0.5 text-xs font-bold text-slate-500">{row.activity_status}</p>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button type="button" className="focus-ring inline-grid h-9 w-9 place-items-center rounded-full border border-role-border bg-white text-slate-600 transition hover:border-role-primary hover:text-role-primary dark:border-slate-800 dark:bg-slate-950" onClick={() => setSelectedStudent(row)} aria-label="View student analytics" title="View student analytics">
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashboardCard>
      <StudentAnalyticsModal student={selectedStudent} onClose={() => setSelectedStudent(null)} />
    </div>
  );
}
