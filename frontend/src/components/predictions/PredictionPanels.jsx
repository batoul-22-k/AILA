import {
  AlertTriangle,
  Activity,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Eye,
  History,
  Lightbulb,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { cn } from "../../utils/cn";
import { Badge } from "../Badge";
import { BloomSignalTooltip } from "../BloomSignalTooltip";
import { Button } from "../Button";
import { DashboardCard } from "../DashboardCard";

const RISK_COLORS = {
  low: "#5AA37A",
  medium: "#D79B42",
  high: "#D96A62",
};

const BLOOM_LEVELS = new Set(["remember", "understand", "apply", "analyze", "evaluate", "create"]);
const BLOOM_MASTERY_THRESHOLD = 60;

function percent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function metricPercent(value) {
  const numeric = Number(value || 0);
  const scaled = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
  return `${Math.round(scaled)}%`;
}

function riskTone(level) {
  if (level === "high") return "red";
  if (level === "medium") return "gold";
  return "green";
}

function riskLabel(level) {
  if (level === "high") return "High Risk";
  if (level === "medium") return "Medium Risk";
  return "Low Risk";
}

function supportLabel(level) {
  if (level === "high") return "Needs support";
  if (level === "medium") return "Needs attention";
  return "On track";
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function bloomLevelLabel(concept) {
  const clean = String(concept || "General").trim();
  if (BLOOM_LEVELS.has(clean.toLowerCase())) return titleCase(clean);
  return titleCase(clean);
}

function conceptSeverity(concept) {
  if (concept?.mastery_status) {
    const mastery = Number(concept.mastery_rate);
    if (concept.mastery_status === "Needs Improvement") return { label: "Needs Improvement", tone: "red", value: Number.isFinite(mastery) ? mastery : 0 };
    if (concept.mastery_status === "Needs Attention") return { label: "Needs Attention", tone: "gold", value: Number.isFinite(mastery) ? mastery : 0 };
    if (concept.mastery_status === "Acceptable") return { label: "Acceptable", tone: "teal", value: Number.isFinite(mastery) ? mastery : 60 };
    return { label: "Strong", tone: "green", value: Number.isFinite(mastery) ? mastery : 80 };
  }
  if (concept?.risk_level === "high") return { label: "Needs Improvement", tone: "red", value: 35 };
  if (concept?.risk_level === "medium") return { label: "Needs Attention", tone: "gold", value: 50 };
  const correctness = Number(concept?.average_correctness);
  if (Number.isFinite(correctness) && correctness > 0) {
    const mastery = Math.round(Math.min(correctness, 1) * 100);
    if (mastery < 40) return { label: "Needs Improvement", tone: "red", value: mastery };
    if (mastery < 60) return { label: "Needs Attention", tone: "gold", value: mastery };
    return { label: "Below Target", tone: "green", value: mastery };
  }
  return { label: "Below Target", tone: "gold", value: 0 };
}

function signalValue(student, ...names) {
  const sources = [student?.features || {}, student?.model_feature_values || {}, student || {}];
  for (const source of sources) {
    for (const name of names) {
      const value = source[name];
      if (value === null || value === undefined || value === "") continue;
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
    }
  }
  return 0;
}

function hasBloomAssessmentDetails(student) {
  const features = student?.features || {};
  return Boolean(
    student?.bloom_mastery_by_level
    || features.bloom_mastery_by_level
    || features.concept_answer_counts
    || features.concept_correct_answer_counts,
  );
}

function bloomGapCount(student) {
  const features = student?.features || {};
  const source = student?.bloom_mastery_by_level || features.bloom_mastery_by_level || {};
  const rows = Array.isArray(source) ? source : Object.values(source || {});
  if (rows.length) {
    return rows.filter((row) => {
      const attempted = Number(row?.attempted_count ?? row?.questions_answered ?? 0);
      const mastery = Number(row?.mastery_rate ?? row?.average_correctness);
      const percentValue = mastery > 0 && mastery <= 1 ? mastery * 100 : mastery;
      return attempted > 0 && Number.isFinite(percentValue) && percentValue < BLOOM_MASTERY_THRESHOLD;
    }).length;
  }
  if (hasBloomAssessmentDetails(student)) return 0;
  return signalValue(student, "weak_concepts_count");
}

function learningConcerns(student) {
  const attendance = signalValue(student, "attendance_rate");
  const participation = signalValue(student, "participation_rate", "answer_rate");
  const correctness = signalValue(student, "correctness_rate");
  const engagement = signalValue(student, "engagement_score", "engagement_index", "derived_engagement_index");
  const recentActivity = signalValue(student, "recent_activity_count", "activity_last_7_days");
  const weakConcepts = bloomGapCount(student);
  const responseTime = signalValue(student, "response_time", "average_response_time");

  return [
    { label: "Low engagement", score: Math.max(0, 60 - engagement) },
    { label: "Poor attendance", score: Math.max(0, 60 - attendance) },
    { label: "Bloom mastery gap", score: weakConcepts > 0 ? Math.min(weakConcepts * 8, 24) : 0 },
    { label: "Low correctness", score: Math.max(0, 60 - correctness) },
    { label: "Low participation", score: Math.max(0, 60 - participation) },
    { label: "Recent inactivity", score: recentActivity <= 0 ? 20 : 0 },
    { label: "Slow response behavior", score: responseTime > 90 ? 12 : 0 },
  ].filter((concern) => concern.score > 0);
}

function primaryRiskFactor(student) {
  const [concern] = learningConcerns(student).sort((first, second) => second.score - first.score);
  if (concern) return concern.label;

  const explanationFactors = student?.explanation?.negative_factors || student?.explanation?.top_factors || [];
  const factor = explanationFactors.find((item) => {
    const label = displayRiskDriver(item?.factor || item?.feature);
    if (label === "Bloom mastery gaps" && bloomGapCount(student) <= 0) return false;
    return item?.factor || item?.feature;
  });
  if (factor) return displayRiskDriver(factor.factor || factor.feature);

  return "Monitor learning signals";
}

function displayRiskDriver(driver) {
  const label = String(driver || "");
  if (label === "Weak Concepts") return "Bloom mastery gaps";
  if (label === "Bloom Mastery Gaps") return "Bloom mastery gaps";
  if (label === "Engagement Trend") return "Recent inactivity";
  return label;
}

function riskDriverFallback(atRisk) {
  const flagged = atRisk || [];
  const counts = new Map();
  const total = flagged.length || 1;

  function add(label) {
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  for (const student of atRisk || []) {
    const labels = new Set(learningConcerns(student).map((concern) => concern.label.replace("Bloom mastery gap", "Bloom mastery gaps")));
    labels.forEach(add);
  }
  const order = ["Low engagement", "Poor attendance", "Bloom mastery gaps", "Low correctness", "Low participation", "Recent inactivity", "Slow response behavior"];
  return [...counts.entries()]
    .map(([driver, affected]) => ({
      driver,
      affected_students: affected,
      total_flagged_students: total,
      percentage: Math.round((affected / total) * 100),
      source: "flagged_student_indicators",
      calculation: "Percentage of medium/high risk students with this learning indicator.",
    }))
    .sort((a, b) => b.percentage - a.percentage || order.indexOf(a.driver) - order.indexOf(b.driver))
    .slice(0, 5);
}

export function StudentPredictionCard({ prediction, loading, error }) {
  if (loading) {
    return <DashboardCard><div className="h-28 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /></DashboardCard>;
  }
  if (error) {
    return <DashboardCard><p className="text-sm font-semibold text-red-600">Could not load learning signals.</p></DashboardCard>;
  }
  if (!prediction || prediction.empty) {
    return (
      <DashboardCard>
        <div className="flex items-start gap-3">
          <BrainCircuit className="mt-1 text-role-primary" size={22} />
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Your learning signals</h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
              Prediction insights will appear after your instructor runs an analysis for this class.
            </p>
          </div>
        </div>
      </DashboardCard>
    );
  }

  const confidence = prediction.confidence ?? prediction.model_confidence;
  const engagementIndex = prediction.engagement_index ?? prediction.derived_engagement_index ?? prediction.predicted_score;
  const riskReasons = prediction.risk_reasons || prediction.reasons || [];
  const academicStatus = prediction.academic_status || supportLabel(prediction.risk_level);
  const engagementStatus = prediction.engagement_status || prediction.engagement_trend || "stable";

  return (
    <DashboardCard>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Badge tone={riskTone(prediction.risk_level)}>{prediction.support_label || supportLabel(prediction.risk_level)}</Badge>
          <h2 className="mt-3 text-lg font-black text-slate-950 dark:text-white">Your learning signals</h2>
          <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
            {prediction.student_message || "These signals are guidance for your learning progress, not a final judgment."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-950/40">
            <p className="text-xs font-black uppercase text-slate-500">Academic Risk</p>
            <p className="mt-1 text-lg font-black text-slate-950 dark:text-white">{riskLabel(prediction.risk_level)}</p>
          </div>
          <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-950/40">
            <p className="text-xs font-black uppercase text-slate-500">Prediction Confidence</p>
            <p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{metricPercent(confidence)}</p>
          </div>
          <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-950/40">
            <p className="text-xs font-black uppercase text-slate-500">Engagement Status</p>
            <p className="mt-1 text-lg font-black capitalize text-slate-950 dark:text-white">{titleCase(engagementStatus)}</p>
          </div>
          <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-950/40">
            <p className="text-xs font-black uppercase text-slate-500">Academic Status</p>
            <p className="mt-1 text-lg font-black capitalize text-slate-950 dark:text-white">{titleCase(academicStatus)}</p>
          </div>
          <div className="col-span-2 rounded-lg bg-role-hover p-3 dark:bg-slate-950/40 sm:col-span-3 lg:col-span-1">
            <p className="text-xs font-black uppercase text-slate-500">Engagement Index</p>
            <p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{percent(engagementIndex)}</p>
            <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-500 dark:text-slate-400">
              Derived from attendance, participation, correctness, consistency, and recent activity. Not an exam grade.
            </p>
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">What we noticed</p>
          <div className="mt-2 grid gap-2">
            {riskReasons.slice(0, 3).map((reason) => (
              <div key={reason} className="flex gap-2 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-600 dark:bg-slate-950/50 dark:text-slate-300">
                <Target size={16} className="mt-0.5 shrink-0 text-role-primary" />
                {reason}
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">Helpful next steps</p>
          <div className="mt-2 grid gap-2">
            {(prediction.recommended_actions || []).slice(0, 3).map((action) => (
              <div key={action} className="flex gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100">
                <Lightbulb size={16} className="mt-0.5 shrink-0" />
                {action}
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}

function averageMetric(rows, getter) {
  const values = rows.map(getter).map(Number).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function riskShare(count, total) {
  return total ? Math.round((Number(count || 0) / total) * 100) : 0;
}

function initials(name) {
  const parts = String(name || "Student").split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "S") + (parts[1]?.[0] || "");
}

function compactRiskLabel(level) {
  if (level === "high") return "High";
  if (level === "medium") return "Medium";
  return "Low";
}

function supportFactorMeta(label) {
  const normalized = String(label || "").toLowerCase();
  if (normalized.includes("participation")) return { icon: Users, label: "Low participation" };
  if (normalized.includes("attendance")) return { icon: Clock, label: "Poor attendance" };
  if (normalized.includes("engagement")) return { icon: Activity, label: "Low engagement" };
  if (normalized.includes("bloom") || normalized.includes("mastery")) return { icon: BrainCircuit, label: "Weak Bloom mastery" };
  if (normalized.includes("correct")) return { icon: XCircle, label: "Low correctness" };
  if (normalized.includes("inactive") || normalized.includes("activity")) return { icon: History, label: "Recent inactivity" };
  return { icon: Target, label: displayRiskDriver(label) || "Learning signal" };
}

function DashboardPanel({ title, subtitle, action, children, className }) {
  return (
    <DashboardCard className={cn("rounded-xl border-role-border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-black text-slate-950 dark:text-white">{title}</h3>
          {subtitle && <p className="mt-1 text-sm font-semibold leading-5 text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </DashboardCard>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg border border-role-border bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/30">
      <p className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}

function RiskBreakdownRow({ label, count, total, color }) {
  const share = riskShare(count, total);
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg px-2 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate">{label}</span>
      </span>
      <span className="font-black text-slate-950 dark:text-white">{count || 0}</span>
      <span className="w-10 text-right text-xs font-black text-slate-500">{share}%</span>
    </div>
  );
}

function StudentSupportTable({ students }) {
  const rows = [...students]
    .sort((first, second) => {
      const riskDelta = (second.risk_level === "high" ? 2 : second.risk_level === "medium" ? 1 : 0) - (first.risk_level === "high" ? 2 : first.risk_level === "medium" ? 1 : 0);
      if (riskDelta) return riskDelta;
      return Number(second.confidence ?? second.model_confidence ?? 0) - Number(first.confidence ?? first.model_confidence ?? 0);
    })
    .slice(0, 5);

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-role-border dark:border-slate-800">
      <div className="hidden grid-cols-[1.4fr_0.8fr_1fr_0.7fr_3rem] gap-3 border-b border-role-border bg-role-hover/70 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 md:grid">
        <span>Student</span>
        <span>Risk Level</span>
        <span>Main Factor</span>
        <span className="text-right">Action</span>
      </div>
      <div className="divide-y divide-role-border dark:divide-slate-800">
        {rows.map((student) => {
          const factor = supportFactorMeta(primaryRiskFactor(student));
          const FactorIcon = factor.icon;
          return (
            <div key={student.prediction_id || student.student_id} className="grid gap-3 bg-white px-3 py-3 transition hover:bg-role-hover/60 dark:bg-slate-900 dark:hover:bg-slate-800/50 md:grid-cols-[1.4fr_0.8fr_1fr_0.7fr_3rem] md:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-role-soft text-xs font-black uppercase text-role-primary">
                  {initials(student.student_name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-slate-950 dark:text-white">{student.student_name || "Student"}</span>
                  <span className="block truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{student.student_id || student.prediction_id || "Student ID unavailable"}</span>
                </span>
              </div>
              <div>
                <Badge tone={riskTone(student.risk_level)} className="px-2 py-0.5">{compactRiskLabel(student.risk_level)}</Badge>
              </div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                <FactorIcon size={15} className="shrink-0 text-role-primary" />
                <span className="truncate">{factor.label}</span>
              </div>
              <div className="md:text-right">
                <Link
                  to="/instructor/at-risk"
                  aria-label={`View Profile for ${student.student_name || "student"}`}
                  title="View Profile"
                  className="focus-ring inline-grid h-9 w-9 place-items-center rounded-full border border-role-border bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:border-role-primary hover:text-role-primary hover:shadow-md dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                >
                  <Eye size={16} />
                </Link>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="bg-white px-3 py-8 text-center text-sm font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            No students currently require support.
          </div>
        )}
      </div>
    </div>
  );
}

function BloomMasteryRows({ weakConcepts }) {
  const byLevel = new Map((weakConcepts || []).map((concept) => [String(concept.concept || concept.bloom_level || "").toLowerCase(), concept]));
  const levels = ["remember", "understand", "apply", "analyze", "evaluate", "create"];
  return (
    <div className="mt-4 grid gap-2">
      {levels.map((level) => {
        const concept = byLevel.get(level);
        const masteryValue = concept?.mastery_rate ?? (Number(concept?.average_correctness || 0) * 100);
        const mastery = concept ? Math.round(Number(masteryValue || 0)) : 100;
        const color = mastery < 40 ? RISK_COLORS.high : mastery < 60 ? RISK_COLORS.medium : RISK_COLORS.low;
        return (
          <div key={level} className="grid grid-cols-[5.8rem_1fr_2.5rem] items-center gap-3">
            <span className="text-xs font-black text-slate-600 dark:text-slate-300">{bloomLevelLabel(level)}</span>
            <div className="h-2 overflow-hidden rounded-full bg-role-hover dark:bg-slate-950/60">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(mastery, mastery ? 6 : 0)}%`, backgroundColor: color }} />
            </div>
            <span className="text-right text-xs font-black text-slate-500">{mastery}%</span>
          </div>
        );
      })}
    </div>
  );
}

export function InstructorPredictionPanel({ summary, loading, error, onRun, running }) {
  const distribution = summary?.risk_distribution || {};
  const allStudents = summary?.student_reports?.length ? summary.student_reports : summary?.predictions?.length ? summary.predictions : summary?.at_risk_students || [];
  const atRisk = summary?.at_risk_students || allStudents.filter((student) => ["medium", "high"].includes(String(student.risk_level || "").toLowerCase()));
  const weakConcepts = summary?.weak_concepts || [];
  const drivers = summary?.top_risk_drivers?.length ? summary.top_risk_drivers : riskDriverFallback(atRisk);
  const totalStudents = (distribution.low || 0) + (distribution.medium || 0) + (distribution.high || 0) || allStudents.length;
  const avgConfidence = averageMetric(allStudents, (student) => student.confidence ?? student.model_confidence);
  const avgEngagement = averageMetric(allStudents, (student) => signalValue(student, "engagement_score", "engagement_index", "derived_engagement_index"));
  const currentActivity = averageMetric(allStudents, (student) => signalValue(student, "activity_last_7_days", "recent_activity_count"));
  const previousActivity = averageMetric(allStudents, (student) => signalValue(student, "activity_previous_7_days"));
  const activityDelta = previousActivity ? Math.round(((currentActivity - previousActivity) / previousActivity) * 100) : 0;
  const trendData = [
    { label: "Last", value: Math.round(previousActivity || currentActivity || avgEngagement) },
    { label: "This", value: Math.round(currentActivity || avgEngagement) },
  ];
  const donutData = [
    { key: "low", name: "Low Risk", value: distribution.low || 0 },
    { key: "medium", name: "Medium Risk", value: distribution.medium || 0 },
    { key: "high", name: "High Risk", value: distribution.high || 0 },
  ].filter((item) => item.value > 0);

  if (loading) {
    return <DashboardCard className="p-4 shadow-sm"><div className="h-72 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /></DashboardCard>;
  }
  if (error) {
    return <DashboardCard className="p-4 shadow-sm"><p className="text-sm font-semibold text-red-600">{error}</p></DashboardCard>;
  }
  if (!summary || summary.empty) {
    return (
      <DashboardCard className="p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Target className="mt-1 text-role-primary" size={22} />
            <div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">No prediction data yet</h2>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                Run the class analysis after sessions and responses are available.
              </p>
            </div>
          </div>
          <Button type="button" variant="role" loading={running} onClick={onRun} className="h-10">
            <RefreshCw size={16} />
            Refresh
          </Button>
        </div>
      </DashboardCard>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1.08fr]">
        <DashboardPanel title="Class Risk Overview" subtitle="Overall academic risk distribution for your students.">
          <div className="mt-4 grid gap-4 lg:grid-cols-[12rem_1fr] lg:items-center">
            <div className="relative h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutData.length ? donutData : [{ key: "empty", name: "No Data", value: 1 }]} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="88%" paddingAngle={3}>
                    {(donutData.length ? donutData : [{ key: "empty" }]).map((entry) => (
                      <Cell key={entry.key} fill={RISK_COLORS[entry.key] || "#E6ECEF"} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, name) => [value, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div>
                  <p className="text-2xl font-black text-slate-950 dark:text-white">{totalStudents}</p>
                  <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">Students</p>
                </div>
              </div>
            </div>
            <div className="grid gap-1">
              <RiskBreakdownRow label="Low Risk" count={distribution.low || 0} total={totalStudents} color={RISK_COLORS.low} />
              <RiskBreakdownRow label="Medium Risk" count={distribution.medium || 0} total={totalStudents} color={RISK_COLORS.medium} />
              <RiskBreakdownRow label="High Risk" count={distribution.high || 0} total={totalStudents} color={RISK_COLORS.high} />
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <MiniStat label="Avg Confidence" value={metricPercent(avgConfidence)} />
            <MiniStat label="Avg Engagement" value={percent(avgEngagement)} />
            <MiniStat label="Students Analyzed" value={totalStudents} />
          </div>
        </DashboardPanel>

        <DashboardPanel
          title="Students Requiring Support"
          subtitle="High-priority prediction results for early intervention."
          action={<Badge tone={atRisk.length ? "gold" : "green"}>{atRisk.length} flagged</Badge>}
        >
          <StudentSupportTable students={atRisk} />
          <div className="mt-3 text-right">
            <Link to="/instructor/at-risk" className="text-sm font-black text-role-primary transition hover:underline">
              View all students -&gt;
            </Link>
          </div>
        </DashboardPanel>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DashboardPanel title="Engagement Trend" subtitle="This week vs last week" className="min-h-[224px]">
          <div className="mt-3 flex items-center gap-2">
            <Badge tone={activityDelta < 0 ? "red" : activityDelta > 0 ? "green" : "slate"} className="px-2 py-0.5">
              {activityDelta > 0 ? <TrendingUp size={13} /> : activityDelta < 0 ? <TrendingDown size={13} /> : <Activity size={13} />}
              {activityDelta > 0 ? "+" : ""}{activityDelta}%
            </Badge>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">activity change</span>
          </div>
          <div className="mt-4 h-24">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                <Tooltip formatter={(value) => [value, "Activity"]} />
                <Line type="monotone" dataKey="value" stroke="var(--role-primary)" strokeWidth={3} dot={{ r: 4, fill: "var(--role-primary)" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </DashboardPanel>

        <DashboardPanel title="Most Common Risk Factors" subtitle="Share of flagged students" className="min-h-[224px]">
          <div className="mt-4 grid gap-3">
            {drivers.slice(0, 4).map((driver, index) => (
              <div key={driver.driver} className="grid gap-1">
                <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                  <span className="truncate text-slate-700 dark:text-slate-200">{index + 1}. {displayRiskDriver(driver.driver)}</span>
                  <span className="font-black text-slate-950 dark:text-white">{Math.round(driver.percentage || 0)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-role-hover dark:bg-slate-950/60">
                  <div className="h-full rounded-full bg-role-primary" style={{ width: `${Math.max(driver.percentage || 0, 5)}%` }} />
                </div>
              </div>
            ))}
            {drivers.length === 0 && <p className="text-sm font-semibold text-slate-500">No common risk pattern yet.</p>}
          </div>
        </DashboardPanel>

        <DashboardPanel
          title="Bloom Mastery Summary"
          subtitle="Analytics by Bloom level"
          action={<BloomSignalTooltip text="Calculated from answer correctness grouped by Bloom taxonomy level. This is descriptive analytics, not a prediction." />}
          className="min-h-[224px]"
        >
          <BloomMasteryRows weakConcepts={weakConcepts} />
        </DashboardPanel>

        <DashboardPanel title="Quick Insights" subtitle="Current intervention mix" className="min-h-[224px]">
          <div className="mt-4 grid gap-3">
            {[
              { label: "students are doing well", value: distribution.low || 0, icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-100" },
              { label: "students need monitoring", value: distribution.medium || 0, icon: BarChart3, tone: "text-amber-700 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-100" },
              { label: "students need immediate support", value: distribution.high || 0, icon: AlertTriangle, tone: "text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-100" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-center gap-3 rounded-lg bg-role-hover/60 p-3 dark:bg-slate-950/40">
                  <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", item.tone)}>
                    <Icon size={16} />
                  </span>
                  <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    <span className="font-black text-slate-950 dark:text-white">{item.value}</span> {item.label}
                  </p>
                </div>
              );
            })}
          </div>
        </DashboardPanel>
      </div>
    </div>
  );
}

export function AdminPredictionOverview({ overview, loading, error }) {
  if (loading) return <DashboardCard><div className="h-28 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /></DashboardCard>;
  if (error) return <DashboardCard><p className="text-sm font-semibold text-red-600">Could not load prediction overview.</p></DashboardCard>;

  return (
    <DashboardCard>
      <div className="flex items-start gap-3">
        <BrainCircuit className="mt-1 text-role-primary" size={24} />
        <div>
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Prediction overview</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
            Institution-level risk and engagement signals from the Stage 3 prediction pipeline.
          </p>
        </div>
      </div>
      {overview?.empty ? (
        <div className="mt-4 rounded-lg border border-dashed border-role-border bg-role-hover p-4 text-sm font-semibold text-slate-500 dark:bg-slate-950/40 dark:text-slate-300">
          No prediction data yet. Instructors can run analysis from class analytics.
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-950/40">
            <CheckCircle2 className="text-role-primary" size={18} />
            <p className="mt-2 text-2xl font-black">{overview?.total_classes_analyzed || 0}</p>
            <p className="text-xs font-black uppercase text-slate-500">Classes analyzed</p>
          </div>
          <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-500/10">
            <AlertTriangle className="text-amber-600" size={18} />
            <p className="mt-2 text-2xl font-black">{overview?.weak_classes || 0}</p>
            <p className="flex items-center gap-1 text-xs font-black uppercase text-slate-500">
              Classes below Bloom mastery
              <BloomSignalTooltip />
            </p>
          </div>
          <div className="rounded-lg bg-red-50 p-3 dark:bg-red-500/10">
            <AlertTriangle className="text-red-600" size={18} />
            <p className="mt-2 text-2xl font-black">{overview?.high_risk_student_count || 0}</p>
            <p className="text-xs font-black uppercase text-slate-500">High-risk students</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950/40">
            <TrendingDown className="text-role-primary" size={18} />
            <p className="mt-2 text-2xl font-black">{overview?.classes_with_engagement_decline || 0}</p>
            <p className="text-xs font-black uppercase text-slate-500">Declining classes</p>
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
