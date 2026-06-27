import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Info,
  LineChart,
  Minus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Line, LineChart as ReLineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getAdminCommandCenter } from "../../api/client";
import { Badge } from "../../components/Badge";
import { BloomSignalTooltip } from "../../components/BloomSignalTooltip";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { cn } from "../../utils/cn";

const RISK_COLORS = { low: "#5AA37A", medium: "#D79B42", high: "#D96A62" };
const MODEL_FACTOR_LABELS = new Set([
  "Attendance",
  "Participation",
  "Correctness",
  "Semantic Score",
  "Engagement",
  "Consistency",
  "Response Time",
  "Recent Activity",
  "Weak Concepts",
]);
const BLOOM_FACTOR_LABEL = "Weak Cognitive Skills";
const FACTOR_DISPLAY_LABELS = {
  "Semantic Score": "Short-answer Quality",
  "Weak Concepts": BLOOM_FACTOR_LABEL,
};
const reportColumns = [
  { key: "class_name", label: "Class" },
  { key: "risk_level", label: "Risk" },
  { key: "prediction_confidence", label: "Confidence" },
  { key: "students", label: "Students" },
  { key: "last_prediction_run", label: "Last Run" },
  { key: "status", label: "Status" },
];

function hasValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function percent(value, fallback = "—") {
  if (!hasValue(value)) return fallback;
  return `${Math.round(Number(value))}%`;
}

function probabilityPercent(value, fallback = "—") {
  if (!hasValue(value)) return fallback;
  const numeric = Number(value);
  return `${Math.round(numeric > 0 && numeric <= 1 ? numeric * 100 : numeric)}%`;
}

function numberValue(value, fallback = "—") {
  if (!hasValue(value)) return fallback;
  return new Intl.NumberFormat().format(Number(value));
}

function roundValue(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const multiplier = 10 ** decimals;
  return Math.round(numeric * multiplier) / multiplier;
}

function average(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function formatDate(value) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function riskTone(level) {
  if (level === "High" || level === "high" || level === "critical") return "red";
  if (level === "Medium" || level === "medium" || level === "warning" || level === "attention") return "gold";
  return "green";
}

function reportConfidence(row, fallback) {
  if (hasValue(row?.prediction_confidence)) return row.prediction_confidence;
  if (hasValue(row?.confidence)) return row.confidence;
  return fallback;
}

function executiveStatus(row) {
  if (!row?.last_prediction_run) return "Pending";
  if (row.risk_level === "High" || row.risk_level === "high" || Number(row.high_risk || 0) > 0) return "Needs Attention";
  return row.risk_level === "Medium" || row.risk_level === "medium" || Number(row.medium_risk || 0) > 0 ? "Monitor" : "Stable";
}

function statusTone(status) {
  if (status === "Needs Attention") return "red";
  if (status === "Monitor") return "gold";
  if (status === "Pending") return "slate";
  return "green";
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function bloomLevelLabel(value) {
  return titleCase(value);
}

function factorDisplayLabel(factor) {
  const label = typeof factor === "string" ? factor : factor?.factor;
  return FACTOR_DISPLAY_LABELS[label] || label;
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportCsv(rows, filename) {
  const headers = ["Class", "Risk", "Confidence", "Students", "Last Run", "Status"];
  const body = rows.map((row) => [
    row.class_name,
    row.risk_level || "Pending",
    probabilityPercent(row.prediction_confidence, ""),
    row.students,
    formatDate(row.last_prediction_run),
    executiveStatus(row),
  ]);
  const csv = [headers, ...body].map((line) => line.map(csvValue).join(",")).join("\n");
  const blob = new window.Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function useCommandCenterData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await getAdminCommandCenter());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load educational intelligence");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return { data, loading, error, load };
}

function useSharedFilters(reports) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const instructor = searchParams.get("instructor") || "all";
  const semester = searchParams.get("semester") || "all";
  const classId = searchParams.get("class") || "all";

  const instructors = useMemo(() => ["all", ...new Set(reports.map((row) => row.instructor).filter(Boolean))], [reports]);
  const semesters = useMemo(() => ["all", ...new Set(reports.map((row) => row.semester).filter(Boolean))], [reports]);

  function updateFilter(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reports.filter((row) => {
      const matchesSearch = !query || [row.class_name, row.instructor, row.semester, row.status].some((value) => String(value || "").toLowerCase().includes(query));
      return matchesSearch
        && (instructor === "all" || row.instructor === instructor)
        && (semester === "all" || row.semester === semester)
        && (classId === "all" || row.class_id === classId);
    });
  }, [reports, search, instructor, semester, classId]);

  return { search, setSearch, instructor, semester, classId, instructors, semesters, updateFilter, filteredReports };
}

function buildComparisonRows(reports, field) {
  const grouped = new Map();
  for (const report of reports) {
    const key = String(report[field] || "Unassigned");
    grouped.set(key, [...(grouped.get(key) || []), report]);
  }
  return [...grouped.entries()].map(([name, rows]) => ({
    name,
    engagement: average(rows.map((row) => row.engagement_score)),
    attendance: average(rows.map((row) => row.attendance)),
    participation: average(rows.map((row) => row.participation)),
    correctness: average(rows.map((row) => row.correctness)),
    risk: average(rows.map((row) => row.risk_concentration)),
    classes: rows.length,
  })).sort((a, b) => Number(b.risk || 0) - Number(a.risk || 0));
}

function riskDistributionFromReports(reports) {
  return reports.reduce(
    (distribution, row) => ({
      low: distribution.low + Number(row.low_risk || 0),
      medium: distribution.medium + Number(row.medium_risk || 0),
      high: distribution.high + Number(row.high_risk || 0),
    }),
    { low: 0, medium: 0, high: 0 },
  );
}

function TrendBadge({ delta }) {
  if (delta === null || delta === undefined) {
    return null;
  }
  const positive = delta > 0;
  const neutral = delta === 0;
  const Icon = neutral ? Minus : positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold", positive && "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-100", !positive && !neutral && "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-100", neutral && "bg-role-hover text-slate-500 dark:bg-slate-800 dark:text-slate-300")}>
      <Icon size={13} />
      {delta > 0 ? "+" : ""}{delta}%
    </span>
  );
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="text-xs font-black uppercase tracking-wide text-role-primary">{eyebrow}</p>}
        <h2 className={cn("text-lg font-black text-slate-950 dark:text-white", eyebrow && "mt-1")}>{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function KpiCard({ label, value, trend, icon: Icon, tone = "role", info }) {
  return (
    <DashboardCard interactive className={cn("flex min-h-[128px] flex-col justify-between p-4 shadow-sm", tone === "muted" && "opacity-50")}>
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1 text-sm font-black text-slate-600 dark:text-slate-300">
          {label}
          {info}
        </p>
        {Icon && (
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", tone === "red" && "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-100", tone === "gold" && "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-100", tone === "green" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-100", tone === "role" && "bg-role-soft text-role-primary")}>
            <Icon size={18} />
          </span>
        )}
      </div>
      <div>
        <p className={cn("text-2xl font-black text-slate-950 dark:text-white md:text-4xl", tone === "muted" && "text-slate-500 dark:text-slate-400")}>{value}</p>
        {trend !== null && trend !== undefined && <div className="mt-3"><TrendBadge delta={trend} /></div>}
      </div>
    </DashboardCard>
  );
}

function HeaderActions({ filters, loading, onRefresh }) {
  const selectClassName = "adaptive-input h-10 w-full rounded-lg border border-role-border bg-white px-3 text-sm font-semibold dark:border-slate-800 dark:bg-slate-900 sm:w-44 lg:w-48";
  return (
    <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
      <select className={selectClassName} value={filters.instructor} onChange={(event) => filters.updateFilter("instructor", event.target.value)} aria-label="Instructor filter">
        {filters.instructors.map((item) => <option key={item} value={item}>{item === "all" ? "All instructors" : item}</option>)}
      </select>
      <select className={selectClassName} value={filters.semester} onChange={(event) => filters.updateFilter("semester", event.target.value)} aria-label="Semester filter">
        {filters.semesters.map((item) => <option key={item} value={item}>{item === "all" ? "All semesters" : item}</option>)}
      </select>
      <Button variant="role" loading={loading} onClick={onRefresh} className="h-10 shrink-0">
        <RefreshCw size={17} />Refresh
      </Button>
    </div>
  );
}

function EmptyState({ icon: Icon = CheckCircle2, title, description }) {
  return (
    <div className="rounded-lg border border-dashed border-role-border bg-role-hover/60 p-5 dark:border-slate-800 dark:bg-slate-950/30">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 text-role-primary" size={20} />
        <div>
          <p className="font-black text-slate-950 dark:text-white">{title}</p>
          {description && <p className="mt-1 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      </div>
    </div>
  );
}

function InfoTooltip({ text }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-role-primary outline-none transition hover:bg-role-soft focus:bg-role-soft"
        aria-label={text}
      >
        <Info size={14} />
      </button>
      <span className="pointer-events-none absolute left-0 top-[calc(100%+0.5rem)] z-40 w-72 translate-y-1 rounded-lg border border-role-border bg-white p-3 text-left text-xs font-semibold normal-case leading-5 tracking-normal text-slate-600 opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        {text}
      </span>
    </span>
  );
}

function RiskDistributionBars({ distribution }) {
  const rows = [["low", "Low"], ["medium", "Medium"], ["high", "High"]].map(([key, label]) => ({ key, label, value: Number(distribution[key] || 0) }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!total) return <EmptyState icon={AlertTriangle} title="Pending" />;
  return (
    <div className="grid gap-3">
      <div className="flex h-4 overflow-hidden rounded-full bg-role-hover dark:bg-slate-950/50">
        {rows.map((row) => {
          const share = (row.value / total) * 100;
          return row.value ? (
            <div
              key={row.key}
              className="h-full transition-all duration-500"
              style={{ width: `${share}%`, minWidth: share < 5 ? "1rem" : undefined, backgroundColor: RISK_COLORS[row.key] }}
              title={`${row.label}: ${row.value}`}
            />
          ) : null;
        })}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2 text-xs font-black text-slate-600 dark:text-slate-300">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: RISK_COLORS[row.key] }} />
            <span>{row.label}</span>
            <span className="text-slate-950 dark:text-white">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AcademicRiskDistribution({ distribution }) {
  const rows = [["high", "High"], ["medium", "Medium"], ["low", "Low"]].map(([key, label]) => ({ key, label, value: Number(distribution[key] || 0) }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!total) return <EmptyState icon={AlertTriangle} title="No classifications yet" />;
  return (
    <div className="grid gap-4">
      {rows.map((row) => {
        const share = total ? Math.round((row.value / total) * 100) : 0;
        return (
          <div key={row.key} className={cn("grid grid-cols-[6rem_1fr_3.5rem] items-center gap-4", row.value === 0 && "opacity-50")}>
            <span className="text-sm font-black text-slate-700 dark:text-slate-200">{row.label}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-role-hover dark:bg-slate-900" title={`${row.label}: ${numberValue(row.value)}`}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(share, row.value ? 4 : 0)}%`, backgroundColor: RISK_COLORS[row.key] }} />
            </div>
            <span className="text-right text-sm font-black text-slate-950 dark:text-white">{share}%</span>
          </div>
        );
      })}
    </div>
  );
}

function HighRiskClassCards({ rows, onExplain, explanationForClass }) {
  if (!rows.length) return <EmptyState title="No high-risk class classifications" />;
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {rows.map((row) => (
        <div key={row.class_id} className="rounded-lg border border-role-border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/30">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-black text-slate-950 dark:text-white">{row.class_name}</p>
              <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{row.instructor || "Unassigned"}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link to={`/admin/classes?class=${row.class_id}`} className="inline-flex items-center gap-1 text-sm font-black text-role-primary">Open <ArrowUpRight size={15} /></Link>
            <button type="button" className="inline-flex items-center gap-1 text-sm font-black text-role-primary" onClick={() => onExplain(explanationForClass(row))}>
              Why <BrainCircuit size={15} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function HighRiskStudentCards({ explanations, onExplain }) {
  const riskRows = explanations.filter((row) => String(row.risk_level || "").toLowerCase() === "high");
  if (!riskRows.length) return <EmptyState title="No high-risk classifications" />;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {riskRows.slice(0, 9).map((row) => {
        const confidence = row.confidence ?? row.model_confidence;
        return (
          <div key={row.prediction_id || `${row.student_id}-${row.class_id}`} className="rounded-lg border border-role-border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/30">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black text-slate-950 dark:text-white">{row.student_name || "Student"}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{row.class_name || "Class"}</p>
              </div>
            </div>
            <div className="mt-4">
              <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">Confidence</p>
              <p className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{probabilityPercent(confidence, "—")}</p>
            </div>
            <button type="button" className="mt-4 inline-flex items-center gap-1 text-sm font-black text-role-primary" onClick={() => onExplain(row)}>
              Why <BrainCircuit size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function AffectedClassesPanel({ concept }) {
  if (!concept) return null;
  const classes = concept.affected_class_rows || [];
  return (
    <div className="rounded-lg bg-role-hover/70 p-4 dark:bg-slate-950/30">
      <p className="text-xs font-black uppercase tracking-wide text-role-primary">{bloomLevelLabel(concept.concept)}</p>
      <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
        {numberValue(concept.affected_students)} students across {numberValue(concept.affected_classes)} classes
      </p>
      {classes.length ? <div className="mt-3 grid gap-1.5">{classes.slice(0, 6).map((row) => <Link key={row.class_id} to={`/admin/classes?class=${row.class_id}`} className="text-sm font-black text-role-primary transition hover:underline">{row.class_name}</Link>)}</div> : null}
    </div>
  );
}

function impactWidth(factor, factors) {
  const max = Math.max(...(factors || []).map((item) => Number(item.impact || 0)), 1);
  return Math.max(8, Math.round((Number(factor.impact || 0) / max) * 100));
}

function modelFactors(factors) {
  return (factors || []).filter((factor) => MODEL_FACTOR_LABELS.has(factor.factor));
}

const FEATURE_VALUE_CONFIG = {
  Attendance: { keys: ["attendance_rate"], format: (value) => percent(value) },
  Participation: { keys: ["participation_rate", "answer_rate"], format: (value) => percent(value) },
  Correctness: { keys: ["correctness_rate"], format: (value) => percent(value) },
  "Semantic Score": { keys: ["semantic_score", "average_semantic_score"], format: (value) => percent(value) },
  Engagement: { keys: ["engagement_score"], format: (value) => percent(value) },
  Consistency: { keys: ["consistency_score"], format: (value) => percent(value) },
  "Recent Activity": { keys: ["recent_activity_count"], format: (value) => `${numberValue(value)} ${Number(value) === 1 ? "activity" : "activities"}` },
  "Weak Concepts": { keys: ["weak_concepts_count"], format: (value) => numberValue(Math.round(Number(value))) },
  "Response Time": { keys: ["response_time", "average_response_time"], format: (value) => `${Math.round(Number(value))}s` },
};

function ImpactBars({ factors, compact = false }) {
  const rows = modelFactors(factors).slice(0, compact ? 4 : 8);
  if (!rows.length) return <p className="rounded-lg bg-role-hover p-3 text-sm font-semibold text-slate-500 dark:bg-slate-950/40">—</p>;
  return (
    <div className="grid gap-3">
      {rows.map((factor) => (
        <div key={`${factor.factor}-${factor.direction}`}>
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="text-xs font-black uppercase text-slate-500">{factorDisplayLabel(factor)}</span>
            <span className={cn("text-xs font-black", factor.direction === "positive" ? "text-emerald-700 dark:text-emerald-200" : "text-red-600 dark:text-red-200")}>
              {factor.direction === "positive" ? "+" : "-"}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-role-hover dark:bg-slate-900">
            <div
              className={cn("h-full rounded-full transition-all duration-500", factor.direction === "positive" ? "bg-emerald-500" : "bg-red-500")}
              style={{ width: `${impactWidth(factor, rows)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function hasMeasuredValue(source, key) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return false;
  const value = Number(source[key]);
  return Number.isFinite(value);
}

function measuredFactorValue(prediction, factor) {
  const config = FEATURE_VALUE_CONFIG[factor.factor];
  const features = prediction?.features || {};
  if (config) {
    for (const key of config.keys) {
      if (hasMeasuredValue(features, key)) {
        const value = Number(features[key]);
        return { value, text: config.format(value), available: true };
      }
    }
  }

  const fallbackValue = Number(factor.value);
  if (Number.isFinite(fallbackValue) && (fallbackValue !== 0 || factor.hasMeasuredValue)) {
    return { value: fallbackValue, text: config ? config.format(fallbackValue) : numberValue(fallbackValue), available: true };
  }

  return { value: null, text: "Value unavailable", available: false };
}

function influenceLevel(factor, factors) {
  const max = Math.max(...(factors || []).map((item) => Number(item.impact || 0)), 1);
  const share = Number(factor.impact || 0) / max;
  if (share >= 0.72) return "High";
  if (share >= 0.38) return "Medium";
  return "Low";
}

function influenceTone(factor) {
  return factor.direction === "positive" ? "green" : "red";
}

function normalizedRiskProbabilities(prediction) {
  const raw = prediction?.risk_probabilities || prediction?.class_probabilities || prediction?.probabilities;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const values = {
    high: Number(raw.high ?? raw.High ?? 0),
    medium: Number(raw.medium ?? raw.Medium ?? 0),
    low: Number(raw.low ?? raw.Low ?? 0),
  };
  if (!Object.values(values).some((value) => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.max(...Object.values(values)) > 1 ? 1 : 100;
  return {
    high: Math.max(0, values.high * scale),
    medium: Math.max(0, values.medium * scale),
    low: Math.max(0, values.low * scale),
  };
}

function averageRiskProbabilities(predictions) {
  const rows = predictions
    .map((prediction) => normalizedRiskProbabilities(prediction))
    .filter(Boolean);
  if (!rows.length) return null;
  return {
    high: roundValue(average(rows.map((row) => row.high)) / 100, 4),
    medium: roundValue(average(rows.map((row) => row.medium)) / 100, 4),
    low: roundValue(average(rows.map((row) => row.low)) / 100, 4),
  };
}

function PredictionProbabilityBars({ prediction }) {
  const probabilities = normalizedRiskProbabilities(prediction);
  if (!probabilities) return null;
  const rows = [
    ["High", probabilities.high, "high"],
    ["Medium", probabilities.medium, "medium"],
    ["Low", probabilities.low, "low"],
  ];
  return (
    <div className="mt-4 rounded-lg border border-role-border p-3 dark:border-slate-800">
      <p className="text-xs font-black uppercase tracking-wide text-role-primary">Prediction Probability</p>
      <div className="mt-3 grid gap-2">
        {rows.map(([label, value, key]) => (
          <div key={key} className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-3">
            <span className="text-xs font-black uppercase text-slate-500">{label}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-role-hover dark:bg-slate-900">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(value, value ? 4 : 0)}%`, backgroundColor: RISK_COLORS[key] }} />
            </div>
            <span className="text-right text-sm font-black text-slate-950 dark:text-white">{Math.round(value)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function factorSummaryText(prediction, factor) {
  const measured = measuredFactorValue(prediction, factor);
  if (!measured.available) return null;
  if (factor.factor === "Weak Concepts") {
    const count = Math.round(Number(measured.value || 0));
    const levels = weakConceptNamesForPrediction(prediction).slice(0, 3).map(bloomLevelLabel);
    if (levels.length) {
      return `weaker performance at the ${listText(levels)} cognitive ${levels.length === 1 ? "level" : "levels"}`;
    }
    return `performance was weaker across ${numberValue(count)} Bloom cognitive ${count === 1 ? "level" : "levels"}`;
  }
  return `${factorDisplayLabel(factor)} = ${measured.text}`;
}

function listText(items) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function explainSummaryWithValues(prediction, riskFactors, positiveFactors) {
  const riskLevel = titleCase(prediction?.risk_level || "risk");
  const subject = prediction?.entity_type === "class"
    ? prediction.class_name || prediction.student_name || "This class"
    : prediction?.student_name || "This student";
  const riskValues = riskFactors.map((factor) => factorSummaryText(prediction, factor)).filter(Boolean).slice(0, 3);
  const positiveValues = positiveFactors.map((factor) => factorSummaryText(prediction, factor)).filter(Boolean).slice(0, 2);

  if (!riskValues.length) {
    return `${subject} is classified as ${riskLevel} Academic Risk. The model found risk-driving signals, but the measured feature values are not available for this prediction.`;
  }

  const positiveSentence = positiveValues.length
    ? ` Counter-signals include ${listText(positiveValues)}.`
    : "";
  return `${subject} is classified as ${riskLevel} Academic Risk because ${listText(riskValues)} strongly influenced the prediction.${positiveSentence}`;
}

function weakConceptNamesForPrediction(prediction) {
  const direct = Array.isArray(prediction?.weak_concepts) ? prediction.weak_concepts : [];
  const fromFeatures = Array.isArray(prediction?.features?.weak_concepts) ? prediction.features.weak_concepts : [];
  const fromMap = Object.entries(prediction?.features?.concept_correctness_map || {})
    .filter(([, value]) => Number(value) < 0.6)
    .map(([concept]) => concept);
  return [...new Set([...direct, ...fromFeatures, ...fromMap].map((concept) => String(concept || "").trim()).filter(Boolean))];
}

function WeakConceptValue({ prediction, measured }) {
  const [open, setOpen] = useState(false);
  const count = Math.round(Number(measured.value || 0));
  const concepts = weakConceptNamesForPrediction(prediction);
  const visibleLevels = concepts.slice(0, 3).map(bloomLevelLabel);
  const remaining = Math.max(concepts.length - visibleLevels.length, 0);

  if (!concepts.length) {
    return <span>{numberValue(count)} Bloom {count === 1 ? "Level" : "Levels"} Flagged</span>;
  }

  return (
    <span className="group relative inline-flex items-center gap-1.5">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full text-left text-sm font-black text-slate-950 outline-none transition hover:text-role-primary focus:text-role-primary dark:text-white"
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((current) => !current)}
      >
        {numberValue(count)} Bloom {count === 1 ? "Level" : "Levels"} Flagged
        <Info size={14} className="text-role-primary" />
      </button>
      <span
        className={cn(
          "pointer-events-none absolute left-0 top-[calc(100%+0.5rem)] z-40 w-64 translate-y-1 rounded-lg border border-role-border bg-white p-3 text-left opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:border-slate-800 dark:bg-slate-900",
          open && "translate-y-0 opacity-100",
        )}
      >
        <span className="block text-xs font-black uppercase tracking-wide text-role-primary">Bloom Levels Requiring Improvement</span>
        <span className="mt-2 grid gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
          {visibleLevels.map((level) => (
            <span key={level}>• {level}</span>
          ))}
          {remaining > 0 && <span className="font-black text-slate-500">+{remaining} more</span>}
        </span>
        <span className="mt-2 block text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">
          These represent Bloom's Taxonomy cognitive levels where the student or class demonstrated lower performance.
        </span>
      </span>
    </span>
  );
}

function FactorValueCell({ prediction, factor, measured }) {
  if (factor.factor === "Weak Concepts" && measured.available) {
    return <WeakConceptValue prediction={prediction} measured={measured} />;
  }
  return <span>{measured.text}</span>;
}

function CompactFactorRows({ factors, prediction, direction, limit = 4 }) {
  const rows = modelFactors(factors).filter((factor) => !direction || factor.direction === direction).slice(0, limit);
  if (!rows.length) return <p className="rounded-lg border border-role-border bg-role-hover/60 px-3 py-2.5 text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/40">No signal detail.</p>;
  const Icon = direction === "positive" ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="overflow-hidden rounded-lg border border-role-border dark:border-slate-800">
      <div className="hidden grid-cols-[1fr_1fr_auto] gap-3 border-b border-role-border bg-role-hover/70 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 sm:grid">
        <span>Signal</span>
        <span>Actual Value</span>
        <span>Influence</span>
      </div>
      <div className="divide-y divide-role-border dark:divide-slate-800">
        {rows.map((factor) => {
          const measured = measuredFactorValue(prediction, factor);
          return (
            <div key={`${factor.factor}-${factor.direction}`} className="grid gap-2 px-3 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center sm:gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Icon className={cn("shrink-0", factor.direction === "positive" ? "text-emerald-600 dark:text-emerald-200" : "text-red-500 dark:text-red-200")} size={15} />
                <span className="truncate text-sm font-black text-slate-800 dark:text-slate-100">{factorDisplayLabel(factor)}</span>
              </div>
              <p className={cn("text-sm font-black", measured.available ? "text-slate-950 dark:text-white" : "text-slate-500 dark:text-slate-400")}>
                <FactorValueCell prediction={prediction} factor={factor} measured={measured} />
              </p>
              <Badge tone={influenceTone(factor)}>{influenceLevel(factor, rows)} Influence</Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildClassExplanation(row, predictions) {
  const classPredictions = predictions.filter((prediction) => prediction.class_id === row.class_id);
  const merged = new Map();
  const weakConcepts = new Set();
  for (const prediction of classPredictions) {
    for (const concept of weakConceptNamesForPrediction(prediction)) {
      weakConcepts.add(concept);
    }
    for (const factor of modelFactors(prediction.explanation?.top_factors || [])) {
      const current = merged.get(factor.factor) || { ...factor, impact: 0, valueTotal: 0, valueCount: 0 };
      const value = Number(factor.value);
      const nextValueTotal = Number.isFinite(value) ? Number(current.valueTotal || 0) + value : Number(current.valueTotal || 0);
      const nextValueCount = Number.isFinite(value) ? Number(current.valueCount || 0) + 1 : Number(current.valueCount || 0);
      merged.set(factor.factor, {
        ...current,
        direction: current.direction === "positive" && factor.direction !== "positive" ? factor.direction : current.direction,
        impact: Number(current.impact || 0) + Number(factor.impact || 0),
        value: nextValueCount ? roundValue(nextValueTotal / nextValueCount) : current.value,
        valueTotal: nextValueTotal,
        valueCount: nextValueCount,
        hasMeasuredValue: nextValueCount > 0,
      });
    }
  }
  const topFactors = [...merged.values()].sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0)).slice(0, 8);
  const negativeFactors = topFactors.filter((factor) => factor.direction !== "positive").slice(0, 4);
  const positiveFactors = topFactors.filter((factor) => factor.direction === "positive").slice(0, 4);
  const confidence = average(classPredictions.map((prediction) => Number(prediction.confidence || 0)));
  const riskProbabilities = averageRiskProbabilities(classPredictions);
  const engagementIndex = row.engagement_score || average(classPredictions.map((prediction) => Number(prediction.engagement_index || 0)));
  const summary = topFactors.length
    ? `${row.class_name}: ${negativeFactors.slice(0, 3).map((factor) => factor.factor.toLowerCase()).join(", ") || "learning signals"} drive the current label.`
    : `${row.class_name}: limited signal detail.`;
  return {
    prediction_id: `class-${row.class_id}`,
    entity_type: "class",
    student_name: row.class_name,
    class_name: row.class_name,
    class_id: row.class_id,
    risk_level: String(row.risk_level || "Low").toLowerCase(),
    confidence,
    risk_probabilities: riskProbabilities,
    engagement_index: engagementIndex,
    academic_status: row.status,
    weak_concepts: [...weakConcepts],
    explanation: {
      summary,
      top_factors: topFactors,
      negative_factors: negativeFactors,
      positive_factors: positiveFactors,
    },
  };
}

function AdminModalPortal({ children }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return createPortal(children, document.body);
}

function ExplainPredictionModal({ prediction, onClose }) {
  if (!prediction) return null;
  const explanation = prediction.explanation || {};
  const riskFactors = modelFactors(explanation.negative_factors?.length ? explanation.negative_factors : explanation.top_factors || []).filter((factor) => factor.direction !== "positive");
  const positiveFactors = modelFactors(explanation.positive_factors || []).filter((factor) => factor.direction === "positive");
  const summary = explainSummaryWithValues(prediction, riskFactors, positiveFactors);
  const recommendedActions = (prediction.recommended_actions || prediction.recommendations || explanation.recommended_actions || [])
    .map((action) => (typeof action === "string" ? action : action?.title || action?.recommended_action || action?.description))
    .filter(Boolean)
    .slice(0, 3);
  const viewFullReportHref = prediction.class_id ? `/admin/insights/reports?class=${encodeURIComponent(prediction.class_id)}` : "/admin/insights/reports";
  return (
    <AdminModalPortal>
      <div className="fixed inset-0 z-[90] grid h-dvh w-screen place-items-center overflow-y-auto bg-slate-950/35 px-4 py-6 backdrop-blur-[1px] dark:bg-slate-950/55" role="dialog" aria-modal="true">
        <div className="flex max-h-[80vh] w-full max-w-[820px] flex-col overflow-hidden rounded-2xl border border-role-border bg-white shadow-lift dark:border-slate-800 dark:bg-slate-950">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-role-border px-5 py-4 dark:border-slate-800">
            <div>
              <h2 className="text-xl font-black text-slate-950 dark:text-white">Explain Prediction</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{prediction.student_name || prediction.class_name || "Result"}{prediction.student_name && prediction.class_name ? ` · ${prediction.class_name}` : ""}</p>
            </div>
            <button type="button" className="rounded-full bg-role-hover p-2 text-slate-500 transition hover:text-role-primary dark:bg-slate-900" onClick={onClose} aria-label="Close explanation">
              <X size={18} />
            </button>
          </div>

          <div className="subtle-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-lg bg-role-hover px-3 py-2.5 dark:bg-slate-900/60"><p className="text-[11px] font-black uppercase text-slate-500">Risk Level</p><Badge className="mt-1.5" tone={riskTone(prediction.risk_level)}>{titleCase(prediction.risk_level)}</Badge></div>
            </div>

            <PredictionProbabilityBars prediction={prediction} />

            <div className="mt-4 rounded-lg border border-role-border p-3 dark:border-slate-800">
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Summary</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{summary}</p>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-role-primary">Main Risk Factors</p>
              <CompactFactorRows factors={riskFactors} prediction={prediction} direction="negative" />
            </div>

            {positiveFactors.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-role-primary">Positive Signals</p>
                <CompactFactorRows factors={positiveFactors} prediction={prediction} direction="positive" limit={3} />
              </div>
            )}

            {recommendedActions.length > 0 && (
              <div className="mt-4 rounded-lg border border-role-border p-3 dark:border-slate-800">
                <p className="text-xs font-black uppercase tracking-wide text-role-primary">Recommended Intervention</p>
                <ul className="mt-2 grid gap-1.5 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                  {recommendedActions.map((action) => (
                    <li key={action} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-role-primary" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-role-border px-5 py-4 dark:border-slate-800">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Link to={viewFullReportHref} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-role-primary px-4 text-sm font-black text-white shadow-sm transition hover:bg-role-primary-strong">
              View Full Report <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </AdminModalPortal>
  );
}

function ComparisonChart({ data }) {
  if (!data.length) return <EmptyState icon={SlidersHorizontal} title="Awaiting" />;
  const chartData = data.slice(0, 18);
  const height = Math.max(280, chartData.length * 58);
  return (
    <div className="max-h-[560px] overflow-y-auto rounded-lg bg-role-hover/50 p-3 dark:bg-slate-950/20">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 12, right: 24, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.28)" />
            <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={140} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="attendance" name="Attendance" fill="#79D99C" radius={[0, 6, 6, 0]} barSize={8} />
            <Bar dataKey="participation" name="Participation" fill="#76A9FA" radius={[0, 6, 6, 0]} barSize={8} />
            <Bar dataKey="correctness" name="Correctness" fill="#245866" radius={[0, 6, 6, 0]} barSize={8} />
            <Bar dataKey="engagement" name="Engagement" fill="#2B7886" radius={[0, 6, 6, 0]} barSize={8} />
            <Bar dataKey="risk" name="Risk" fill="#D96A62" radius={[0, 6, 6, 0]} barSize={8} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function HistoricalTrends({ trends }) {
  if (!trends?.length) return <EmptyState icon={LineChart} title="Awaiting" />;
  return (
    <div className="h-72 rounded-lg bg-role-hover/50 p-3 dark:bg-slate-950/20">
      <ResponsiveContainer width="100%" height="100%">
        <ReLineChart data={trends.slice(-12)} margin={{ left: 0, right: 20, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.28)" />
          <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
          <YAxis axisLine={false} tickLine={false} domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="engagement" name="Engagement" stroke="#2B7886" strokeWidth={3} dot={false} />
          <Line type="monotone" dataKey="attendance" name="Attendance" stroke="#79D99C" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="participation" name="Participation" stroke="#76A9FA" strokeWidth={2} dot={false} />
        </ReLineChart>
      </ResponsiveContainer>
    </div>
  );
}

function OverviewStrip({ health, reports, distribution, weakConcepts }) {
  const totalPredicted = distribution.low + distribution.medium + distribution.high;
  const metrics = [
    ["Engagement", percent(health.institution_engagement_health, "Awaiting")],
    ["Active Classes", numberValue(health.active_classes ?? reports.length)],
    ["At-Risk Students", numberValue(distribution.medium + distribution.high)],
    ["Bloom Levels", numberValue(weakConcepts.length)],
  ];
  return (
    <DashboardCard className="p-5 shadow-sm">
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{value}</p>
          </div>
        ))}
      </div>
      {!totalPredicted && <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Analytics will appear after prediction runs are available.</p>}
    </DashboardCard>
  );
}

function MetricLine({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-role-border/70 py-3 last:border-b-0 dark:border-slate-800">
      <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-base font-black text-slate-950 dark:text-white">{value}</span>
    </div>
  );
}

function InstitutionPerformance({ distribution, comparisonData, reports }) {
  const averageAttendance = comparisonData.length ? percent(average(comparisonData.map((row) => row.attendance))) : "Awaiting";
  const averageParticipation = comparisonData.length ? percent(average(comparisonData.map((row) => row.participation))) : "Awaiting";
  const averageCorrectness = comparisonData.length ? percent(average(comparisonData.map((row) => row.correctness))) : "Awaiting";
  const averageEngagement = comparisonData.length ? percent(average(comparisonData.map((row) => row.engagement))) : "Awaiting";
  return (
    <DashboardCard className="p-6 shadow-sm">
      <SectionHeader eyebrow="Performance" title="Institution Performance" />
      <div className="mt-6 grid gap-8 xl:grid-cols-[1fr_0.9fr]">
        <div>
          <p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Institution Risk Distribution</p>
          <RiskDistributionBars distribution={distribution} />
        </div>
        <div>
          <MetricLine label="Average engagement" value={averageEngagement} />
          <MetricLine label="Average attendance" value={averageAttendance} />
          <MetricLine label="Average participation" value={averageParticipation} />
          <MetricLine label="Average correctness" value={averageCorrectness} />
          <MetricLine label="Classes analyzed" value={numberValue(reports.length)} />
        </div>
      </div>
    </DashboardCard>
  );
}

function BloomRankedAnalysis({ concepts, selectedConcept, onSelect }) {
  const rows = [...(concepts || [])]
    .sort((a, b) => Number(b.affected_students || 0) - Number(a.affected_students || 0));
  if (!rows.length) return <EmptyState title="No Bloom levels requiring improvement" />;
  const maxStudents = Math.max(...rows.map((row) => Number(row.affected_students || 0)), 1);
  const topRows = rows.slice(0, 3);
  return (
    <DashboardCard className="p-6 shadow-sm">
      <SectionHeader
        eyebrow="Bloom Analysis"
        title="Bloom Levels Requiring Improvement"
        action={<BloomSignalTooltip />}
      />
      <div className="mt-5 grid gap-8 xl:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="text-sm font-black text-slate-950 dark:text-white">Most difficult Bloom levels</p>
          <div className="mt-3 grid gap-3">
            {topRows.map((concept) => (
              <button key={concept.concept} type="button" className="text-left" onClick={() => onSelect(concept)}>
                <p className="text-sm font-black text-role-primary">{bloomLevelLabel(concept.concept)}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{numberValue(concept.affected_students)} students · {numberValue(concept.affected_classes)} classes</p>
              </button>
            ))}
          </div>
          <button type="button" className="mt-5 inline-flex items-center gap-1 text-sm font-black text-role-primary" onClick={() => onSelect(rows[0])}>
            View Details <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="grid gap-2">
          {rows.map((concept) => {
            const selected = selectedConcept?.concept === concept.concept;
            const count = Number(concept.affected_students || 0);
            return (
              <button
                key={concept.concept}
                type="button"
                className={cn("grid gap-2 rounded-lg px-3 py-3 text-left transition hover:bg-role-hover dark:hover:bg-slate-900/50", selected && "bg-role-hover dark:bg-slate-900/50")}
                onClick={() => onSelect(selected ? null : concept)}
              >
                <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
                  <span className="text-sm font-black text-slate-950 dark:text-white">{bloomLevelLabel(concept.concept)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-role-hover dark:bg-slate-900">
                    <span className="block h-full rounded-full bg-role-primary" style={{ width: `${Math.max(8, (count / maxStudents) * 100)}%` }} />
                  </span>
                  <span className="text-sm font-black text-slate-950 dark:text-white">{numberValue(count)} students</span>
                </div>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{numberValue(concept.affected_classes)} classes affected</span>
              </button>
            );
          })}
          <AffectedClassesPanel concept={selectedConcept} />
        </div>
      </div>
    </DashboardCard>
  );
}

function AdvancedAnalytics({ comparisonOptions, activeComparisonFilter, setComparisonFilter, comparisonData }) {
  return (
    <details className="group rounded-2xl border border-role-border bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">Advanced Analytics</p>
          <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Class Compare</h2>
        </div>
        <ChevronDown size={18} className="text-slate-500 transition group-open:rotate-180" />
      </summary>
      <div className="mt-5 border-t border-role-border pt-5 dark:border-slate-800">
        <div className="flex flex-wrap gap-2">
          {comparisonOptions.map(([key, label]) => (
            <button key={key} type="button" className={cn("rounded-lg px-3 py-2 text-xs font-black transition", activeComparisonFilter === key ? "bg-role-primary text-white shadow-sm" : "bg-role-hover text-slate-600 hover:text-role-primary dark:bg-slate-950/40 dark:text-slate-300")} onClick={() => setComparisonFilter(key)}>{label}</button>
          ))}
        </div>
        <div className="mt-4"><ComparisonChart data={comparisonData} /></div>
      </div>
    </details>
  );
}
function ReportDetailsModal({ report, defaultConfidence, explanation, onClose, onExplain }) {
  if (!report) return null;
  const status = executiveStatus(report);
  return (
    <AdminModalPortal>
      <div className="fixed inset-0 z-[90] grid h-dvh w-screen place-items-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
        <div className="subtle-scroll max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-role-border bg-white p-5 shadow-lift dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Report</p>
              <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">{report.class_name}</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{report.instructor || "Unassigned"}</p>
            </div>
            <button type="button" className="rounded-full bg-role-hover p-2 text-slate-500 transition hover:text-role-primary dark:bg-slate-900" onClick={onClose} aria-label="Close report">
              <X size={18} />
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60"><p className="text-[11px] font-black uppercase text-slate-500">Risk</p><Badge className="mt-2" tone={riskTone(report.risk_level)}>{report.risk_level || "Pending"}</Badge></div>
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60"><p className="text-[11px] font-black uppercase text-slate-500">Confidence</p><p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{probabilityPercent(reportConfidence(report, defaultConfidence), "Pending")}</p></div>
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60"><p className="text-[11px] font-black uppercase text-slate-500">Students</p><p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{numberValue(report.students)}</p></div>
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60"><p className="text-[11px] font-black uppercase text-slate-500">Last</p><p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{formatDate(report.last_prediction_run)}</p></div>
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60"><p className="text-[11px] font-black uppercase text-slate-500">Status</p><Badge className="mt-2" tone={statusTone(status)}>{status}</Badge></div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
            <div className="rounded-lg border border-role-border p-4 dark:border-slate-800">
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Student Breakdown</p>
              <div className="mt-3 grid gap-2">
                {[
                  ["Low", report.low_risk, "green"],
                  ["Medium", report.medium_risk, "gold"],
                  ["High", report.high_risk, "red"],
                ].map(([label, value, tone]) => (
                  <div key={label} className="flex items-center justify-between rounded-lg bg-role-hover px-3 py-2 dark:bg-slate-900/60">
                    <Badge tone={tone}>{label}</Badge>
                    <span className="font-black text-slate-950 dark:text-white">{numberValue(value)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-role-border p-4 dark:border-slate-800">
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Class Explanation</p>
              <div className="mt-3"><ImpactBars factors={explanation?.explanation?.top_factors || []} /></div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => { onClose(); onExplain(explanation); }}><BrainCircuit size={16} />Explain Prediction</Button>
            <Button variant="outline" onClick={() => exportCsv([report], `${report.class_name || "prediction-report"}.csv`)}><Download size={16} />Export</Button>
            <Button variant="outline" onClick={() => window.print()}><FileText size={16} />PDF</Button>
          </div>
        </div>
      </div>
    </AdminModalPortal>
  );
}

function ReportsTable({ rows, allRows, filters, mode = "analytics", onExplain, explanationForClass, onViewReport, defaultConfidence }) {
  const dedicated = mode === "reports";
  const [open, setOpen] = useState(dedicated);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: dedicated ? "last_prediction_run" : "engagement_score", direction: "desc" });
  const pageSize = 10;

  const sortedRows = useMemo(() => [...rows].sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];
    const leftValue = hasValue(left) ? Number(left) : String(left || "");
    const rightValue = hasValue(right) ? Number(right) : String(right || "");
    if (leftValue < rightValue) return sort.direction === "asc" ? -1 : 1;
    if (leftValue > rightValue) return sort.direction === "asc" ? 1 : -1;
    return 0;
  }), [rows, sort]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const pageRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [filters.search, filters.instructor, filters.semester, filters.classId, sort]);

  function updateSort(key) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "desc" ? "asc" : "desc" }));
  }

  return (
    <DashboardCard className="p-4 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <SectionHeader eyebrow="Reports" title={dedicated ? "History" : "Details"} />
        {!dedicated && <Button variant="outline" onClick={() => setOpen((current) => !current)}>{open ? "Collapse" : "Open"}<ChevronDown size={15} className={cn("transition", open && "rotate-180")} /></Button>}
      </div>
      {open && (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input className="adaptive-input h-10 rounded-lg border border-role-border bg-white pl-9 pr-3 text-sm font-semibold dark:border-slate-800 dark:bg-slate-900" placeholder="Search" value={filters.search} onChange={(event) => filters.setSearch(event.target.value)} />
            </div>
            <Button variant="outline" onClick={() => exportCsv(sortedRows, "prediction-reports.csv")}><Download size={15} />Export CSV</Button>
            <Button variant="outline" onClick={() => window.print()}><FileText size={15} />Export PDF</Button>
          </div>
          <div className="mt-3 max-h-[560px] overflow-auto rounded-lg border border-role-border dark:border-slate-800">
            <table className="min-w-[860px] w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-role-hover text-[11px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-950">
                  <tr>
                    {reportColumns.map((column) => <th key={column.key} className="px-3 py-2.5"><button type="button" className="inline-flex items-center gap-1 hover:text-role-primary" onClick={() => updateSort(column.key)}>{column.label}{sort.key === column.key && <ChevronDown size={13} className={cn("transition", sort.direction === "asc" && "rotate-180")} />}</button></th>)}
                    <th className="px-3 py-2.5">Actions</th>
                  </tr>
              </thead>
              <tbody className="divide-y divide-role-border dark:divide-slate-800">
                {pageRows.length === 0 && <tr><td className="px-3 py-8 text-center text-sm font-semibold text-slate-500" colSpan={reportColumns.length + 1}>No matches.</td></tr>}
                {pageRows.map((row) => {
                  const hasPrediction = Boolean(row.last_prediction_run);
                  const status = executiveStatus(row);
                  return (
                    <tr key={row.class_id} className="bg-white transition hover:bg-role-hover/60 dark:bg-slate-900 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2.5">
                        <p className="font-black text-slate-950 dark:text-white">{row.class_name}</p>
                        <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">{row.instructor || "Unassigned"}</p>
                      </td>
                      <td className="px-3 py-2.5"><Badge tone={riskTone(row.risk_level)}>{hasPrediction ? row.risk_level : "Pending"}</Badge></td>
                      <td className="px-3 py-2.5 font-black">{probabilityPercent(reportConfidence(row, defaultConfidence), hasPrediction ? "—" : "Pending")}</td>
                      <td className="px-3 py-2.5 font-semibold">{numberValue(row.students)}</td>
                      <td className="px-3 py-2.5">{formatDate(row.last_prediction_run)}</td>
                      <td className="px-3 py-2.5"><Badge tone={statusTone(status)}>{status}</Badge></td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" className="text-xs font-black text-role-primary" onClick={() => onViewReport(row)}>View</button>
                          <button type="button" className="text-xs font-black text-role-primary" onClick={() => onExplain(explanationForClass(row))}>Explain</button>
                          <button type="button" className="text-xs font-black text-slate-500 transition hover:text-role-primary" onClick={() => exportCsv([row], `${row.class_name || "prediction-report"}.csv`)}>Export</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400"><SlidersHorizontal size={14} />{pageRows.length} / {sortedRows.length} shown · {allRows.length} total</p>
            <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><span className="text-xs font-black text-slate-500">Page {page} of {pageCount}</span><Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</Button></div>
          </div>
        </>
      )}
    </DashboardCard>
  );
}

function LoadingAndError({ loading, error, data }) {
  return (
    <>
      {error && <DashboardCard><p className="text-sm font-semibold text-red-600">{error}</p></DashboardCard>}
      {loading && !data && <DashboardCard><div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /></DashboardCard>}
    </>
  );
}

export function AdminEducationalAnalyticsPage() {
  const { data, loading, error, load } = useCommandCenterData();
  const overview = data?.prediction_overview || {};
  const reports = overview.class_reports || [];
  const health = data?.health || {};
  const filters = useSharedFilters(reports);
  const [comparisonFilter, setComparisonFilter] = useState("class_name");
  const [selectedConcept, setSelectedConcept] = useState(null);
  const distribution = useMemo(() => riskDistributionFromReports(filters.filteredReports), [filters.filteredReports]);
  const comparisonOptions = useMemo(() => [
    ["class_name", "Classes"],
    ["instructor", "Instructors"],
    ["semester", "Semesters"],
  ], []);
  const activeComparisonFilter = comparisonOptions.some(([key]) => key === comparisonFilter) ? comparisonFilter : "class_name";

  useEffect(() => {
    if (activeComparisonFilter !== comparisonFilter) setComparisonFilter(activeComparisonFilter);
  }, [activeComparisonFilter, comparisonFilter]);

  const comparisonData = useMemo(() => buildComparisonRows(filters.filteredReports, activeComparisonFilter), [filters.filteredReports, activeComparisonFilter]);
  const weakConcepts = useMemo(() => {
    const classIds = new Set(filters.filteredReports.map((row) => row.class_id));
    return (overview.weak_concepts || []).filter((concept) => !concept.affected_class_rows?.length || concept.affected_class_rows.some((row) => classIds.has(row.class_id)));
  }, [overview.weak_concepts, filters.filteredReports]);

  return (
    <div className="page-grid gap-8">
      <PageHeader
        eyebrow="Educational Intelligence"
        title="Analytics"
       
        tone="role"
        action={<HeaderActions filters={filters} loading={loading} onRefresh={load} />}
      />
      <LoadingAndError loading={loading} error={error} data={data} />
      {data && (
        <>
          <section className="grid gap-4">
            <SectionHeader eyebrow="Overview" title="What is happening" />
            <OverviewStrip health={health} reports={filters.filteredReports} distribution={distribution} weakConcepts={weakConcepts} />
          </section>

          <section className="grid gap-4">
            <InstitutionPerformance distribution={distribution} comparisonData={comparisonData} reports={filters.filteredReports} />
          </section>

          <section className="grid gap-4">
            <BloomRankedAnalysis concepts={weakConcepts} selectedConcept={selectedConcept} onSelect={setSelectedConcept} />
          </section>

          {data.trends?.length ? (
            <section className="grid gap-4">
              <DashboardCard className="p-6 shadow-sm"><SectionHeader eyebrow="Trends" title="Weekly Performance Trend" /><div className="mt-5"><HistoricalTrends trends={data.trends} /></div></DashboardCard>
            </section>
          ) : null}

          <section className="grid gap-4">
            <AdvancedAnalytics comparisonOptions={comparisonOptions} activeComparisonFilter={activeComparisonFilter} setComparisonFilter={setComparisonFilter} comparisonData={comparisonData} />
          </section>
        </>
      )}
    </div>
  );
}

export function AdminEducationalPredictionsPage() {
  const { data, loading, error, load } = useCommandCenterData();
  const overview = data?.prediction_overview || {};
  const reports = overview.class_reports || [];
  const filters = useSharedFilters(reports);
  const [selectedExplanation, setSelectedExplanation] = useState(null);
  const distribution = useMemo(() => riskDistributionFromReports(filters.filteredReports), [filters.filteredReports]);
  const filteredClassIds = useMemo(() => new Set(filters.filteredReports.map((row) => row.class_id)), [filters.filteredReports]);
  const highRiskClasses = useMemo(
    () => filters.filteredReports
      .filter((row) => Number(row.high_risk || 0) > 0 || row.risk_level === "High")
      .sort((a, b) => Number(b.high_risk || 0) - Number(a.high_risk || 0)),
    [filters.filteredReports],
  );
  const explainablePredictions = useMemo(
    () => (overview.explainable_predictions || []).filter((row) => !row.class_id || filteredClassIds.has(row.class_id)),
    [overview.explainable_predictions, filteredClassIds],
  );
  const averageConfidence = useMemo(() => {
    const confidenceValues = explainablePredictions
      .map((row) => row.confidence)
      .filter(hasValue)
      .map(Number);
    return confidenceValues.length ? average(confidenceValues) : overview.prediction_confidence;
  }, [explainablePredictions, overview.prediction_confidence]);
  const explanationForClass = (row) => buildClassExplanation(row, explainablePredictions);
  const predictionDate = overview.last_prediction_run || filters.filteredReports.find((row) => row.last_prediction_run)?.last_prediction_run;

  return (
    <div className="page-grid gap-8">
      <PageHeader
        eyebrow="Educational Intelligence"
        title="Academic Risk Predictions"
        description="Classified from the latest student learning signals."
        tone="role"
        action={<HeaderActions filters={filters} loading={loading} onRefresh={load} />}
      />
      <LoadingAndError loading={loading} error={error} data={data} />
      {data && (
        <>
          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Overview</h2>
              <span className="rounded-full bg-role-hover px-3 py-1.5 text-xs font-black text-slate-500 dark:bg-slate-900/60 dark:text-slate-300">
                Prediction Date · {formatDate(predictionDate)}
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <KpiCard label="High Risk" value={numberValue(distribution.high)} trend={null} tone="red" />
              <KpiCard label="Medium Risk" value={numberValue(distribution.medium)} trend={null} tone="gold" />
              <KpiCard
                label="Average Confidence"
                value={probabilityPercent(averageConfidence, "Pending")}
                trend={null}
                info={<InfoTooltip text="Average confidence score across all student predictions in the current filter. Lower values may indicate limited participation data." />}
              />
            </div>
          </section>

          {/* TODO: Analytics-only widgets such as engagement, attendance, Bloom statistics, and watchlists belong on the Analytics page, not the Predictions classification page. */}
          <section className="grid gap-4">
            <DashboardCard className="p-5 shadow-sm">
              <SectionHeader title="Academic Risk Distribution" />
              <div className="mt-6"><AcademicRiskDistribution distribution={distribution} /></div>
            </DashboardCard>
          </section>

          <section className="grid gap-4">
            <DashboardCard className="p-5 shadow-sm"><SectionHeader title="High-Risk Students" /><div className="mt-5"><HighRiskStudentCards explanations={explainablePredictions} onExplain={setSelectedExplanation} /></div></DashboardCard>
          </section>

          <section className="grid gap-4">
            <DashboardCard className="p-5 shadow-sm">
              <SectionHeader title="High-Risk Classes" />
              <div className="mt-5"><HighRiskClassCards rows={highRiskClasses} onExplain={setSelectedExplanation} explanationForClass={explanationForClass} /></div>
            </DashboardCard>
          </section>
          <ExplainPredictionModal prediction={selectedExplanation} onClose={() => setSelectedExplanation(null)} />
        </>
      )}
    </div>
  );
}

export function PredictionReportsPage() {
  return <Navigate to="/admin/insights/reports" replace />;
}

export function AdminPredictionReportsPage() {
  const { data, loading, error, load } = useCommandCenterData();
  const overview = data?.prediction_overview || {};
  const reports = overview.class_reports || [];
  const filters = useSharedFilters(reports);
  const [selectedExplanation, setSelectedExplanation] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const filteredClassIds = useMemo(() => new Set(filters.filteredReports.map((row) => row.class_id)), [filters.filteredReports]);
  const explainablePredictions = useMemo(
    () => (overview.explainable_predictions || []).filter((row) => !row.class_id || filteredClassIds.has(row.class_id)),
    [overview.explainable_predictions, filteredClassIds],
  );
  const explanationForClass = (row) => buildClassExplanation(row, explainablePredictions);

  return (
    <div className="page-grid gap-8">
      <PageHeader
        eyebrow="Educational Intelligence"
        title="Reports"
        description="Prediction Reports"
        tone="role"
        action={<HeaderActions filters={filters} loading={loading} onRefresh={load} />}
      />
      <LoadingAndError loading={loading} error={error} data={data} />
      {data && (
        <>
          <ReportsTable
            rows={filters.filteredReports}
            allRows={reports}
            filters={filters}
            mode="reports"
            defaultConfidence={overview.prediction_confidence}
            onExplain={setSelectedExplanation}
            explanationForClass={explanationForClass}
            onViewReport={setSelectedReport}
          />
          <ReportDetailsModal
            report={selectedReport}
            defaultConfidence={overview.prediction_confidence}
            explanation={selectedReport ? explanationForClass(selectedReport) : null}
            onClose={() => setSelectedReport(null)}
            onExplain={setSelectedExplanation}
          />
          <ExplainPredictionModal prediction={selectedExplanation} onClose={() => setSelectedExplanation(null)} />
        </>
      )}
    </div>
  );
}
