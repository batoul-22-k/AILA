import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Lightbulb,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingDown,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

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
  if (concept?.risk_level === "high") return { label: "High", tone: "red", value: 92 };
  if (concept?.risk_level === "medium") return { label: "Medium", tone: "gold", value: 64 };
  const correctness = Number(concept?.average_correctness);
  if (Number.isFinite(correctness) && correctness > 0) {
    const severity = Math.round((1 - Math.min(correctness, 1)) * 100);
    if (severity >= 70) return { label: "High", tone: "red", value: severity };
    if (severity >= 40) return { label: "Medium", tone: "gold", value: severity };
    return { label: "Low", tone: "green", value: severity };
  }
  return { label: "Low", tone: "green", value: 30 };
}

function primaryRiskFactor(student) {
  return (student?.risk_reasons || student?.reasons || [])[0] || "Needs closer learning signal review";
}

function displayRiskDriver(driver) {
  return driver === "Weak Concepts" ? "Weak Cognitive Skills" : driver;
}

function displayRecommendedAction(action) {
  return String(action || "")
    .replace(/Review weak concepts/gi, "Review Bloom cognitive skills")
    .replace(/weak concepts/gi, "Bloom cognitive skills");
}

function riskDriverFallback(atRisk) {
  const scores = new Map([
    ["Attendance", 35],
    ["Correctness", 35],
    ["Weak Cognitive Skills", 24],
    ["Participation", 20],
    ["Engagement Trend", 12],
  ]);
  for (const student of atRisk || []) {
    for (const item of student.feature_importance || []) {
      const feature = String(item.feature || "").toLowerCase();
      const value = Number(item.importance || 0);
      if (!value) continue;
      if (feature.includes("attendance")) scores.set("Attendance", (scores.get("Attendance") || 0) + value);
      else if (feature.includes("correctness")) scores.set("Correctness", (scores.get("Correctness") || 0) + value);
      else if (feature.includes("weak_concepts")) scores.set("Weak Cognitive Skills", (scores.get("Weak Cognitive Skills") || 0) + value);
      else if (feature.includes("answer") || feature.includes("participation") || feature.includes("recent_activity")) scores.set("Participation", (scores.get("Participation") || 0) + value);
      else if (feature.includes("trend") || feature.includes("consistency")) scores.set("Engagement Trend", (scores.get("Engagement Trend") || 0) + value);
    }
  }
  const max = Math.max(...scores.values(), 1);
  return [...scores.entries()]
    .map(([driver, importance]) => ({ driver, importance, percentage: Math.round((importance / max) * 100) }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5);
}

function PredictionSummaryCard({ label, count, total, tone, icon: Icon }) {
  const share = total ? Math.round((count / total) * 100) : 0;
  return (
    <DashboardCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{count}</p>
        </div>
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
            tone === "green" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-100",
            tone === "gold" && "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-100",
            tone === "red" && "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-100",
            tone === "role" && "bg-role-soft text-role-primary",
          )}
        >
          <Icon size={19} />
        </span>
      </div>
      <p className="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">{share}% of class</p>
    </DashboardCard>
  );
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

export function InstructorPredictionPanel({ summary, loading, error, onRun, running }) {
  const [showAllActions, setShowAllActions] = useState(false);
  const distribution = summary?.risk_distribution || {};
  const atRisk = summary?.at_risk_students || [];
  const weakConcepts = summary?.weak_concepts || [];
  const recommendedActions = summary?.recommendation_summary || [];
  const drivers = summary?.top_risk_drivers?.length ? summary.top_risk_drivers : riskDriverFallback(atRisk);
  const totalStudents = (distribution.low || 0) + (distribution.medium || 0) + (distribution.high || 0);
  const highAndMedium = (distribution.medium || 0) + (distribution.high || 0);
  const donutData = [
    { key: "low", name: "Low Risk", value: distribution.low || 0 },
    { key: "medium", name: "Medium Risk", value: distribution.medium || 0 },
    { key: "high", name: "High Risk", value: distribution.high || 0 },
  ].filter((item) => item.value > 0);
  const visibleActions = showAllActions ? recommendedActions : recommendedActions.slice(0, 4);
  const defaultActions = [
    { action: "Monitor participation in the next session", count: highAndMedium },
    { action: "Schedule a check-in with struggling students", count: distribution.high || 0 },
    { action: "Review Bloom cognitive skills", count: weakConcepts.length },
    { action: "Assign reinforcement activity", count: highAndMedium },
    { action: "Provide additional examples", count: weakConcepts.length },
  ].filter((item) => item.count > 0 || recommendedActions.length === 0);

  if (loading) {
    return <DashboardCard><div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /></DashboardCard>;
  }
  if (error) {
    return <DashboardCard><p className="text-sm font-semibold text-red-600">{error}</p></DashboardCard>;
  }
  if (!summary || summary.empty) {
    return (
      <DashboardCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Target className="mt-1 text-role-primary" size={24} />
            <div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Classroom support insights</h2>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                No support data yet. Update the support plan after sessions and responses are available.
              </p>
            </div>
          </div>
          <Button type="button" variant="role" loading={running} onClick={onRun}>
            <RefreshCw size={16} />
            Update support plan
          </Button>
        </div>
      </DashboardCard>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PredictionSummaryCard label="Total Students" count={totalStudents} total={totalStudents} tone="role" icon={Users} />
        <PredictionSummaryCard label="Low Risk Students" count={distribution.low || 0} total={totalStudents} tone="green" icon={ShieldCheck} />
        <PredictionSummaryCard label="Medium Risk Students" count={distribution.medium || 0} total={totalStudents} tone="gold" icon={AlertTriangle} />
        <PredictionSummaryCard label="High Risk Students" count={distribution.high || 0} total={totalStudents} tone="red" icon={TrendingDown} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <DashboardCard className="p-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-role-primary">Risk distribution</p>
            <h3 className="mt-1 text-base font-black text-slate-950 dark:text-white">Class risk mix</h3>
          </div>
          <div className="relative mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donutData.length ? donutData : [{ key: "empty", name: "No Data", value: 1 }]} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="88%" paddingAngle={3}>
                  {(donutData.length ? donutData : [{ key: "empty" }]).map((entry) => (
                    <Cell key={entry.key} fill={RISK_COLORS[entry.key] || "#E6ECEF"} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [value, name]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="text-center">
                <p className="text-3xl font-black text-slate-950 dark:text-white">{totalStudents}</p>
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">Students</p>
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              ["low", "Low Risk"],
              ["medium", "Medium Risk"],
              ["high", "High Risk"],
            ].map(([key, label]) => (
              <div key={key} className="rounded-lg bg-role-hover p-3 dark:bg-slate-950/40">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: RISK_COLORS[key] }} />
                  <span className="text-xs font-black uppercase text-slate-500">{label}</span>
                </div>
                <p className="mt-1 text-lg font-black text-slate-950 dark:text-white">{distribution[key] || 0}</p>
              </div>
            ))}
          </div>
        </DashboardCard>

        <DashboardCard className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">At-risk students</p>
              <h3 className="mt-1 text-base font-black text-slate-950 dark:text-white">Highest-risk students</h3>
            </div>
            <Badge tone={distribution.high ? "red" : "gold"}>{atRisk.length} flagged</Badge>
          </div>
          <div className="mt-4 grid gap-3">
            {atRisk.slice(0, 3).map((student) => (
              <div key={student.student_id} className="rounded-lg border border-role-border bg-white p-3 dark:border-slate-800 dark:bg-slate-950/30">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-950 dark:text-white">{student.student_name || "Student"}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Main Factor: {primaryRiskFactor(student)}</p>
                  </div>
                  <Badge tone={riskTone(student.risk_level)}>{riskLabel(student.risk_level)}</Badge>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-red-50 p-2 dark:bg-red-400/10">
                    <p className="text-[11px] font-black uppercase text-red-700 dark:text-red-100">Risk</p>
                    <p className="text-lg font-black text-red-700 dark:text-red-100">{metricPercent(student.risk_score)}</p>
                  </div>
                  <Link
                    to="/instructor/at-risk"
                    className="adaptive-button focus-ring inline-flex items-center justify-center rounded-lg bg-role-primary px-3 py-2 text-xs font-bold text-white hover:brightness-95"
                  >
                    View Profile
                  </Link>
                </div>
              </div>
            ))}
            {atRisk.length === 0 && (
              <div className="rounded-lg bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100">
                No elevated risk signals. Keep monitoring participation and learning checks.
              </div>
            )}
          </div>
        </DashboardCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <DashboardCard className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Bloom Cognitive Skills</p>
              <h3 className="mt-1 text-base font-black text-slate-950 dark:text-white">Bloom Levels Requiring Improvement</h3>
            </div>
            <BloomSignalTooltip />
          </div>
          <div className="mt-4 grid gap-3">
            {weakConcepts.slice(0, 4).map((concept) => {
              const severity = conceptSeverity(concept);
              return (
                <div key={concept.weak_concept_prediction_id} className="rounded-lg bg-role-hover p-3 dark:bg-slate-950/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black text-slate-950 dark:text-white">{bloomLevelLabel(concept.concept)}</p>
                    <Badge tone={severity.tone}>{severity.label} severity</Badge>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="h-2 overflow-hidden rounded-full bg-white dark:bg-slate-900">
                      <div className="h-full rounded-full" style={{ width: `${severity.value}%`, backgroundColor: RISK_COLORS[severity.tone === "red" ? "high" : severity.tone === "gold" ? "medium" : "low"] }} />
                    </div>
                    <span className="text-xs font-bold text-slate-500">{concept.weak_students_count || 0} students affected</span>
                  </div>
                </div>
              );
            })}
            {weakConcepts.length === 0 && <p className="rounded-lg bg-role-hover p-4 text-sm font-semibold text-slate-500">No Bloom levels requiring improvement detected yet.</p>}
          </div>
        </DashboardCard>

        <DashboardCard className="p-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-role-primary">Top risk drivers</p>
            <h3 className="mt-1 text-base font-black text-slate-950 dark:text-white">Key patterns behind student risk</h3>
          </div>
          <div className="mt-4 grid gap-3">
            {drivers.map((driver, index) => (
              <div key={driver.driver}>
                <div className="mb-1 flex items-center justify-between gap-3 text-sm font-bold">
                  <span className="text-slate-700 dark:text-slate-200">{index + 1}. {displayRiskDriver(driver.driver)}</span>
                  <span className="text-slate-500">{Math.round(driver.percentage || 0)}%</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-role-hover dark:bg-slate-950/50">
                  <div className="h-full rounded-full bg-role-primary" style={{ width: `${Math.max(driver.percentage || 0, 6)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </DashboardCard>
      </div>

      <DashboardCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-role-primary">Recommended actions ({recommendedActions.length || defaultActions.length})</p>
            <h3 className="mt-1 text-base font-black text-slate-950 dark:text-white">Next best teaching moves</h3>
          </div>
          {(recommendedActions.length > 4) && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg bg-role-hover px-3 py-2 text-xs font-bold text-role-primary"
              onClick={() => setShowAllActions((current) => !current)}
            >
              {showAllActions ? "Show less" : "Expand"}
              <ChevronDown size={14} className={cn("transition", showAllActions && "rotate-180")} />
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {(recommendedActions.length ? visibleActions : defaultActions).map((item) => (
            <div key={item.action} className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
              <span className="flex items-center gap-2">
                <Lightbulb size={15} className="shrink-0" />
                {displayRecommendedAction(item.action)}
              </span>
              <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-black text-emerald-700 dark:bg-slate-950/40 dark:text-emerald-100">{item.count}</span>
            </div>
          ))}
        </div>
      </DashboardCard>
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
              Classes needing Bloom support
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
