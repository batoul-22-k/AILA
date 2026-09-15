import {
  AlertTriangle,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  BrainCircuit,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Info,
  LineChart,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Target,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Line, LineChart as ReLineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import ailaLogo from "../../../assets/img/ailaLogo.png";
import { getAdminCommandCenter } from "../../api/client";
import { Badge } from "../../components/Badge";
import { BloomSignalTooltip } from "../../components/BloomSignalTooltip";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { IconButton } from "../../components/IconButton";
import { PageHeader } from "../../components/PageHeader";
import { HeaderIconLabel, StatusIcon } from "../../components/StatusIcon";
import { TableHeaderFilter, TableToolbar } from "../../components/table";
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
  "Bloom Mastery Gaps",
]);
const BLOOM_FACTOR_DISPLAY_LABEL = "Weak Bloom Levels";
const BLOOM_MASTERY_THRESHOLD = 60;
const BLOOM_GAP_TOOLTIP = "Only Bloom levels with answered questions are evaluated. Untested levels are not counted as mastery gaps.";
const BLOOM_LEVEL_ORDER = ["remember", "understand", "apply", "analyze", "evaluate", "create"];
const BLOOM_LEVEL_LABELS = {
  remember: "Remember",
  understand: "Understand",
  apply: "Apply",
  analyze: "Analyze",
  evaluate: "Evaluate",
  create: "Create",
};
const FACTOR_DISPLAY_LABELS = {
  "Semantic Score": "Semantic Score",
  "Weak Concepts": BLOOM_FACTOR_DISPLAY_LABEL,
  "Weak Concepts Count": BLOOM_FACTOR_DISPLAY_LABEL,
  "Bloom Mastery Gaps": BLOOM_FACTOR_DISPLAY_LABEL,
};
const DRIVER_DISPLAY_LABELS = {
  Attendance: "Low attendance",
  "Attendance Rate": "Low attendance",
  Participation: "Low participation",
  "Participation Rate": "Low participation",
  "Answer Rate": "Low participation",
  Correctness: "Low correctness",
  "Correctness Rate": "Low correctness",
  "Semantic Score": "Low semantic score",
  Engagement: "Low engagement",
  "Engagement Score": "Low engagement",
  Consistency: "Inconsistent activity",
  "Consistency Score": "Inconsistent activity",
  "Response Time": "Slow response behavior",
  "Recent Activity": "Recent inactivity",
  "Recent Activity Count": "Recent inactivity",
  "Weak Concepts": BLOOM_FACTOR_DISPLAY_LABEL,
  "Weak Concepts Count": BLOOM_FACTOR_DISPLAY_LABEL,
  "Bloom Mastery Gaps": BLOOM_FACTOR_DISPLAY_LABEL,
};
const reportColumns = [
  { key: "class_name", label: "Class", icon: BookOpen },
  { key: "risk_level", label: "Risk", icon: AlertTriangle },
  { key: "prediction_confidence", label: "Confidence", icon: Target },
  { key: "students", label: "Students", icon: UsersRound },
  { key: "last_prediction_run", label: "Date", icon: Calendar },
  { key: "status", label: "Status" },
];
const studentReportColumns = [
  { key: "student_name", label: "Student" },
  { key: "class_name", label: "Class", icon: BookOpen },
  { key: "risk_level", label: "Risk", icon: AlertTriangle },
  { key: "confidence", label: "Confidence", icon: Target },
  { key: "generated_at", label: "Date", icon: Calendar },
  { key: "status", label: "Status" },
];
const STUDENT_RISK_FILTERS = [
  ["all", "All risks"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
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

function signalPercent(value, fallback = "—") {
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

function reportConfidence(row, fallback) {
  if (hasValue(row?.prediction_confidence)) return row.prediction_confidence;
  if (hasValue(row?.confidence)) return row.confidence;
  return fallback;
}

function predictionTimestamp(row) {
  return row?.generated_at || row?.predicted_at || row?.last_prediction_run;
}

function executiveStatus(row) {
  if (!row?.last_prediction_run) return "Pending";
  if (row.risk_level === "High" || row.risk_level === "high" || Number(row.high_risk || 0) > 0) return "Needs Attention";
  return row.risk_level === "Medium" || row.risk_level === "medium" || Number(row.medium_risk || 0) > 0 ? "Monitor" : "Stable";
}

function studentReportStatus(row) {
  const provided = row?.status || row?.academic_status;
  if (provided === "Critical" || provided === "Needs Attention" || provided === "Stable") return provided;
  const level = String(row?.risk_level || "").toLowerCase();
  if (level === "high") return "Critical";
  if (level === "medium") return "Needs Attention";
  return "Stable";
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
  const clean = String(value || "").trim().toLowerCase();
  return BLOOM_LEVEL_LABELS[clean] || titleCase(value);
}

function isBloomLevel(value) {
  return BLOOM_LEVEL_ORDER.includes(String(value || "").trim().toLowerCase());
}

function bloomLevelRank(value) {
  const index = BLOOM_LEVEL_ORDER.indexOf(String(value || "").trim().toLowerCase());
  return index === -1 ? BLOOM_LEVEL_ORDER.length : index;
}

function bloomLevelCount(value) {
  const numeric = Math.round(Number(value || 0));
  return Math.min(Math.max(numeric, 0), BLOOM_LEVEL_ORDER.length);
}

function bloomKey(value) {
  const clean = String(value || "").trim().toLowerCase();
  const labelMatch = Object.entries(BLOOM_LEVEL_LABELS).find(([, label]) => label.toLowerCase() === clean);
  return labelMatch?.[0] || clean;
}

function mapValueForBloomLevel(map, levelKey) {
  if (!map || typeof map !== "object") return null;
  const label = BLOOM_LEVEL_LABELS[levelKey];
  if (map[levelKey] !== undefined) return map[levelKey];
  if (map[label] !== undefined) return map[label];
  const entry = Object.entries(map).find(([key]) => bloomKey(key) === levelKey);
  return entry ? entry[1] : null;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function masteryPercentValue(value) {
  const numeric = numberOrNull(value);
  if (numeric === null) return null;
  return numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
}

function bloomMasteryRowsForPrediction(prediction) {
  const features = prediction?.features || {};
  const source = prediction?.bloom_mastery_by_level || features.bloom_mastery_by_level || {};
  const sourceRows = Array.isArray(source) ? source : Object.values(source || {});
  const answerCounts = features.concept_answer_counts || {};
  const correctCounts = features.concept_correct_answer_counts || {};
  const correctnessMap = features.concept_correctness_map || {};

  return BLOOM_LEVEL_ORDER.map((levelKey) => {
    const row = sourceRows.find((item) => bloomKey(item?.bloom_level || item?.level || item?.concept) === levelKey) || {};
    const attemptedValue = numberOrNull(row.attempted_count ?? row.questions_answered ?? mapValueForBloomLevel(answerCounts, levelKey));
    const correctValue = numberOrNull(row.correct_count ?? row.correct_answers ?? mapValueForBloomLevel(correctCounts, levelKey));
    const attempted = attemptedValue || 0;
    const correct = correctValue || 0;
    const mappedMastery = masteryPercentValue(mapValueForBloomLevel(correctnessMap, levelKey));
    const mastery = attempted > 0
      ? correctValue !== null
        ? (correct / attempted) * 100
        : mappedMastery ?? masteryPercentValue(row.mastery_rate ?? row.average_correctness)
      : null;
    return {
      level: levelKey,
      label: BLOOM_LEVEL_LABELS[levelKey],
      attempted_count: attempted,
      correct_count: correct,
      mastery_rate: mastery,
      is_gap: attempted > 0 && mastery !== null && mastery < BLOOM_MASTERY_THRESHOLD,
    };
  });
}

function bloomGapRowsForPrediction(prediction) {
  return bloomMasteryRowsForPrediction(prediction).filter((row) => row.is_gap);
}

function notAssessedBloomRowsForPrediction(prediction) {
  return bloomMasteryRowsForPrediction(prediction).filter((row) => row.attempted_count <= 0);
}

function factorDisplayLabel(factor) {
  const label = typeof factor === "string" ? factor : factor?.factor;
  return FACTOR_DISPLAY_LABELS[label] || label;
}

function factorDriverLabel(factor) {
  const label = typeof factor === "string" ? factor : factor?.factor || factor?.feature || factor?.name || factor?.label;
  const clean = titleCase(label);
  return DRIVER_DISPLAY_LABELS[label] || DRIVER_DISPLAY_LABELS[clean] || factorDisplayLabel({ factor: clean });
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
  const classes = useMemo(() => {
    const classMap = new Map();
    for (const row of reports) {
      if (!row.class_id) continue;
      if (instructor !== "all" && row.instructor !== instructor) continue;
      classMap.set(row.class_id, row.class_name || row.class_id);
    }
    return [
      { class_id: "all", class_name: "All classes" },
      ...[...classMap.entries()]
        .map(([id, name]) => ({ class_id: id, class_name: name }))
        .sort((a, b) => String(a.class_name).localeCompare(String(b.class_name))),
    ];
  }, [reports, instructor]);

  useEffect(() => {
    if (classId === "all") return;
    if (classes.some((row) => row.class_id === classId)) return;
    const next = new URLSearchParams(searchParams);
    next.delete("class");
    setSearchParams(next, { replace: true });
  }, [classId, classes, searchParams, setSearchParams]);

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

  return { search, setSearch, instructor, semester, classId, instructors, semesters, classes, updateFilter, filteredReports };
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
    classes: rows.length,
  })).sort((a, b) => Number(a.engagement || 0) - Number(b.engagement || 0) || a.name.localeCompare(b.name));
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

function KpiCard({ label, value, unit, tone = "role", icon: Icon }) {
  return (
    <DashboardCard
      className={cn(
        "flex min-h-[124px] flex-col justify-between p-5 shadow-sm",
        tone === "red" && "border-t-4 border-t-red-500",
        tone === "gold" && "border-t-4 border-t-amber-500",
        tone === "green" && "border-t-4 border-t-emerald-500",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-black text-slate-600 dark:text-slate-300">{label}</p>
        {Icon && (
          <span className={cn(
            "inline-grid h-9 w-9 shrink-0 place-items-center rounded-full",
            tone === "red" && "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-100",
            tone === "gold" && "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-100",
            tone === "green" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-100",
            tone === "role" && "bg-role-hover text-role-primary dark:bg-slate-900",
          )} title={label} aria-label={label}>
            <Icon size={19} aria-hidden="true" />
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-black leading-tight text-slate-950 dark:text-white md:text-3xl">{value}{unit && <span className="ml-2 text-base font-black text-slate-500 dark:text-slate-400">{unit}</span>}</p>
      </div>
    </DashboardCard>
  );
}

function HeaderActions({ filters, loading, onRefresh, activeTab, riskFilter, setRiskFilter }) {
  return (
    <div className="flex w-full flex-wrap items-center justify-start gap-2 xl:w-auto xl:justify-end">
      <TableHeaderFilter
        label="Instructor"
        value={filters.instructor === "all" ? "" : filters.instructor}
        onChange={(value) => filters.updateFilter("instructor", value || "all")}
        allLabel="All instructors"
        options={filters.instructors.filter((item) => item !== "all").map((item) => ({ value: item, label: item }))}
      />
      <TableHeaderFilter
        label="Class"
        value={filters.classId === "all" ? "" : filters.classId}
        onChange={(value) => filters.updateFilter("class", value || "all")}
        allLabel="All classes"
        options={(filters.classes || []).filter((item) => item.class_id !== "all").map((item) => ({ value: item.class_id, label: item.class_name }))}
      />
      <TableHeaderFilter
        label="Semester"
        value={filters.semester === "all" ? "" : filters.semester}
        onChange={(value) => filters.updateFilter("semester", value || "all")}
        allLabel="All semesters"
        options={filters.semesters.filter((item) => item !== "all").map((item) => ({ value: item, label: item }))}
      />
      {activeTab === "students" && (
        <TableHeaderFilter
          label="Risk"
          value={riskFilter === "all" ? "" : riskFilter}
          onChange={(value) => setRiskFilter(value || "all")}
          allLabel="All risk"
          options={STUDENT_RISK_FILTERS.filter(([value]) => value !== "all").map(([value, label]) => ({ value, label }))}
        />
      )}
      <IconButton label="Refresh predictions" icon={RefreshCw} loading={loading} onClick={onRefresh} tone="role" className="h-12 w-12 rounded-lg border-role-primary/70" />
    </div>
  );
}

function ReportsHeader({ filters, loading, onRefresh, activeTab, onTabChange, classCount, studentCount, riskFilter, setRiskFilter }) {
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-slate-950 dark:text-white">Reports</h1>
        <p className="mt-1 text-base font-semibold text-slate-500 dark:text-slate-400">Prediction Reports</p>
      </div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <ReportsTabs activeTab={activeTab} onChange={onTabChange} classCount={classCount} studentCount={studentCount} />
        <HeaderActions filters={filters} loading={loading} onRefresh={onRefresh} activeTab={activeTab} riskFilter={riskFilter} setRiskFilter={setRiskFilter} />
      </div>
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

function AcademicRiskDistribution({ distribution }) {
  const rows = [["high", "High Risk"], ["medium", "Medium Risk"], ["low", "Low Risk"]].map(([key, label]) => ({ key, label, value: Number(distribution[key] || 0) }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!total) return <EmptyState icon={AlertTriangle} title="No classifications yet" />;
  const enrichedRows = rows.map((row) => ({ ...row, share: total ? Math.round((row.value / total) * 100) : 0 }));
  const minimumVisibleShare = 12;
  const smallRowsTotal = enrichedRows.reduce((sum, row) => sum + (row.value > 0 && row.share < minimumVisibleShare ? minimumVisibleShare : 0), 0);
  const largeRowsTotal = enrichedRows.reduce((sum, row) => sum + (row.value > 0 && row.share >= minimumVisibleShare ? row.share : 0), 0);
  const remainingShare = Math.max(0, 100 - smallRowsTotal);
  return (
    <div className="grid gap-4">
      <div className="flex min-h-[76px] overflow-hidden rounded-lg bg-role-hover dark:bg-slate-900">
        {enrichedRows.map((row) => {
          const visibleShare = row.value > 0 && row.share < minimumVisibleShare
            ? minimumVisibleShare
            : largeRowsTotal
              ? (row.share / largeRowsTotal) * remainingShare
              : row.share;
          return (
            <div
              key={row.key}
              className={cn("grid min-w-0 place-items-center px-3 text-center text-white transition-all duration-500", row.value === 0 && "hidden")}
              style={{ width: `${visibleShare}%`, backgroundColor: RISK_COLORS[row.key] }}
              title={`${row.label}: ${numberValue(row.value)} students (${row.share}%)`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-black">{row.label}</p>
                <p className="mt-1 truncate text-xs font-bold opacity-95">{numberValue(row.value)} students ({row.share}%)</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {enrichedRows.map((row) => (
          <div key={row.key} className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: RISK_COLORS[row.key] }} />
            <span>{row.label}</span>
            <span className="text-slate-500 dark:text-slate-400">{numberValue(row.value)} students ({row.share}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function studentPredictionConfidence(row) {
  return row?.confidence ?? row?.model_confidence;
}

function studentKey(row) {
  return row.prediction_id || `${row.student_id || "student"}-${row.class_id || "class"}`;
}

function studentLabel(count) {
  return Number(count) === 1 ? "Student" : "Students";
}

function highRiskLabel(row) {
  const level = String(row?.risk_level || "").trim();
  return level ? titleCase(level) : "High";
}

function classReportLookup(reports) {
  return new Map((reports || []).map((row) => [row.class_id, row]));
}

function enrichStudentReports(rows, reports) {
  const classes = classReportLookup(reports);
  return (rows || []).map((row) => {
    const classReport = classes.get(row.class_id) || {};
    return {
      ...row,
      class_name: row.class_name || classReport.class_name || "Class",
      instructor: row.instructor || classReport.instructor || "Unassigned",
      semester: row.semester || classReport.semester || "Unassigned",
      status: studentReportStatus(row),
    };
  });
}

function studentSignalValue(row, keys) {
  const features = row?.features || {};
  for (const key of keys) {
    if (hasValue(row?.[key])) return row[key];
    if (hasValue(features[key])) return features[key];
  }
  return null;
}

function recommendationRows(prediction) {
  const rows = (prediction?.recommended_actions || prediction?.recommendations || prediction?.explanation?.recommended_actions || [])
    .map((action) => (typeof action === "string" ? action : action?.title || action?.recommended_action || action?.description))
    .filter(Boolean);
  if (rows.length) return rows.slice(0, 3);
  const level = String(prediction?.risk_level || "").toLowerCase();
  if (level === "high") return ["Contact student", "Schedule meeting", "Assign additional exercises"];
  if (level === "medium") return ["Monitor participation", "Encourage practice", "Review progress after the next class activity"];
  return ["Continue current learning path", "Maintain regular feedback", "Monitor future prediction updates"];
}

function fullDateTime(value) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function cleanList(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function weakConceptRows(prediction) {
  const direct = Array.isArray(prediction?.weak_concepts) ? prediction.weak_concepts : [];
  const fromFeatures = Array.isArray(prediction?.features?.weak_concepts) ? prediction.features.weak_concepts : [];
  const fromMap = Object.entries(prediction?.features?.concept_correctness_map || {})
    .filter(([, value]) => Number(value) < 0.6)
    .map(([concept]) => concept);
  return cleanList([...direct, ...fromFeatures, ...fromMap])
    .filter((concept) => !isBloomLevel(concept))
    .slice(0, 6);
}

function signalNumber(value) {
  if (!hasValue(value)) return null;
  const numeric = Number(value);
  const percentValue = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
  return Math.min(Math.max(Math.round(percentValue), 0), 100);
}

function rawSignalNumber(value) {
  if (!hasValue(value)) return null;
  return Number(value);
}

function studentReportSignals(report) {
  return [
    ["Attendance", studentSignalValue(report, ["attendance", "attendance_rate"])],
    ["Participation", studentSignalValue(report, ["participation", "participation_rate", "answer_rate"])],
    ["Correctness", studentSignalValue(report, ["correctness", "correctness_rate"])],
    ["Engagement", studentSignalValue(report, ["engagement", "engagement_score", "engagement_index"])],
  ].map(([label, value]) => ({ label, value: signalNumber(value) }));
}

function riskMeta(level) {
  const key = String(level || "pending").toLowerCase();
  if (key === "high") return { label: "High", className: "student-report-risk-high", color: RISK_COLORS.high };
  if (key === "medium") return { label: "Medium", className: "student-report-risk-medium", color: RISK_COLORS.medium };
  if (key === "low") return { label: "Low", className: "student-report-risk-low", color: RISK_COLORS.low };
  return { label: "Pending", className: "student-report-risk-pending", color: "#64748b" };
}

function predictionTrend(report) {
  const trend = report?.prediction_trend;
  if (trend) return trend;
  const previous = report?.previous_prediction;
  if (!previous?.risk_level) {
    return {
      status: "initial",
      label: "Initial Prediction",
      previous_risk_level: null,
      current_risk_level: report?.risk_level || "low",
      risk_score_difference: null,
      previous_prediction_date: null,
      current_prediction_date: predictionTimestamp(report),
    };
  }
  const rank = { low: 1, medium: 2, high: 3 };
  const previousLevel = String(previous.risk_level || "low").toLowerCase();
  const currentLevel = String(report?.risk_level || "low").toLowerCase();
  const delta = (rank[currentLevel] || 0) - (rank[previousLevel] || 0);
  const previousScore = Number(previous.risk_score);
  const currentScore = Number(report?.risk_score);
  const riskScoreDifference = Number.isFinite(previousScore) && Number.isFinite(currentScore) ? Math.round(currentScore - previousScore) : null;
  return {
    status: delta > 0 ? "worsening" : delta < 0 ? "improving" : "stable",
    label: delta > 0 ? "Worsening" : delta < 0 ? (Math.abs(delta) > 1 ? "Major improvement" : "Improving") : "Stable",
    previous_risk_level: previousLevel,
    current_risk_level: currentLevel,
    risk_score_difference: riskScoreDifference,
    previous_prediction_date: predictionTimestamp(previous),
    current_prediction_date: predictionTimestamp(report),
  };
}

function trendSummaryText(report) {
  const trend = predictionTrend(report);
  if (trend.status === "initial") return "Initial Prediction";
  return `${titleCase(trend.previous_risk_level)} -> ${titleCase(trend.current_risk_level)} (${trend.label})`;
}

function previousPredictionText(report) {
  const trend = predictionTrend(report);
  if (trend.status === "initial") return "No previous prediction";
  return `${titleCase(trend.previous_risk_level)} (${formatDate(trend.previous_prediction_date)})`;
}

function studentReportFactors(report) {
  const factors = studentRiskDriverCandidates(report).map((factor) => factor.label);
  return factors.length ? cleanList(factors).slice(0, 3) : ["No detailed contributing factors were provided by the model output."];
}

function studentXaiDriverImpacts(report) {
  const rows = [
    ...(Array.isArray(report?.explanation?.negative_factors) ? report.explanation.negative_factors : []),
    ...(Array.isArray(report?.explanation?.top_factors) ? report.explanation.top_factors.filter((factor) => factor?.direction !== "positive") : []),
    ...(Array.isArray(report?.feature_importance) ? report.feature_importance.filter((factor) => factor?.direction !== "positive") : []),
  ];
  const impacts = new Map();
  rows.forEach((factor) => {
    const label = factorDriverLabel(factor);
    const impact = Math.abs(Number(factor?.impact ?? factor?.importance ?? factor?.weight));
    if (!label || !Number.isFinite(impact)) return;
    impacts.set(label, Math.max(impacts.get(label) || 0, impact));
  });
  return impacts;
}

function addStudentDriverCandidate(candidates, impacts, maxImpact, label, severity) {
  if (!Number.isFinite(severity) || severity <= 0) return;
  const impact = impacts.get(label) || 0;
  const xaiScore = maxImpact > 0 ? (impact / maxImpact) * 25 : 0;
  candidates.push({ label, score: severity + xaiScore, impact });
}

function studentRiskDriverCandidates(report) {
  const impacts = studentXaiDriverImpacts(report);
  const maxImpact = Math.max(...impacts.values(), 0);
  const candidates = [];
  const threshold = 60;
  const attendance = signalNumber(studentSignalValue(report, ["attendance", "attendance_rate"]));
  const participation = signalNumber(studentSignalValue(report, ["participation", "participation_rate", "answer_rate"]));
  const correctness = signalNumber(studentSignalValue(report, ["correctness", "correctness_rate"]));
  const semanticScore = signalNumber(studentSignalValue(report, ["semantic_score", "average_semantic_score"]));
  const engagement = signalNumber(studentSignalValue(report, ["engagement", "engagement_score", "engagement_index", "derived_engagement_index"]));
  const consistency = signalNumber(studentSignalValue(report, ["consistency_score", "response_consistency"]));
  const recentActivity = rawSignalNumber(studentSignalValue(report, ["recent_activity_count", "activity_last_7_days"]));
  const responseTime = rawSignalNumber(studentSignalValue(report, ["response_time", "average_response_time"]));
  const weakConceptsCount = rawSignalNumber(studentSignalValue(report, ["weak_concepts_count"]));
  const bloomRows = bloomMasteryRowsForPrediction(report);
  const assessedBloomRows = bloomRows.filter((row) => row.attempted_count > 0);
  const bloomGaps = bloomRows.filter((row) => row.is_gap);

  addStudentDriverCandidate(candidates, impacts, maxImpact, "Low attendance", attendance === null ? 0 : threshold - attendance);
  addStudentDriverCandidate(candidates, impacts, maxImpact, "Low correctness", correctness === null ? 0 : threshold - correctness);
  addStudentDriverCandidate(candidates, impacts, maxImpact, "Low semantic score", semanticScore === null ? 0 : threshold - semanticScore);
  addStudentDriverCandidate(candidates, impacts, maxImpact, "Low participation", participation === null ? 0 : threshold - participation);
  addStudentDriverCandidate(candidates, impacts, maxImpact, "Low engagement", engagement === null ? 0 : threshold - engagement);
  addStudentDriverCandidate(candidates, impacts, maxImpact, "Inconsistent activity", consistency === null ? 0 : threshold - consistency);
  addStudentDriverCandidate(candidates, impacts, maxImpact, "Recent inactivity", recentActivity !== null && recentActivity <= 0 ? 35 : 0);
  addStudentDriverCandidate(candidates, impacts, maxImpact, "Slow response behavior", responseTime !== null && responseTime > 90 ? Math.min(40, ((responseTime - 90) / 90) * 40) : 0);
  if (assessedBloomRows.length > 0 && bloomGaps.length > 0) {
    const bloomSeverity = Math.min(
      60,
      bloomGaps.reduce((total, row) => total + Math.max(0, BLOOM_MASTERY_THRESHOLD - Number(row.mastery_rate || 0)), 0) / bloomGaps.length
        + (bloomGaps.length * 8),
    );
    addStudentDriverCandidate(candidates, impacts, maxImpact, BLOOM_FACTOR_DISPLAY_LABEL, bloomSeverity);
  } else if (weakConceptsCount !== null && weakConceptsCount > 0) {
    addStudentDriverCandidate(candidates, impacts, maxImpact, BLOOM_FACTOR_DISPLAY_LABEL, Math.min(weakConceptsCount * 12, 48));
  }

  return candidates.sort((first, second) => second.score - first.score || second.impact - first.impact || first.label.localeCompare(second.label));
}

function classRiskScore(row) {
  const riskWeight = { high: 3, medium: 2, low: 1 };
  return [
    riskWeight[String(row.risk_level || "").toLowerCase()] || 0,
    Number(row.high_risk || 0),
    Number(row.risk_concentration || 0),
    Number(reportConfidence(row, 0) || 0),
  ];
}

function compareClassRisk(a, b) {
  const left = classRiskScore(a);
  const right = classRiskScore(b);
  for (let index = 0; index < left.length; index += 1) {
    if (right[index] !== left[index]) return right[index] - left[index];
  }
  return String(a.class_name || "").localeCompare(String(b.class_name || ""));
}

function mainStudentDriver(row) {
  return studentReportFactors(row)[0] || "Learning signal";
}

function mainClassDriver(row, explanationForClass) {
  const explanation = explanationForClass(row);
  const factor = modelFactors(explanation?.explanation?.negative_factors?.length ? explanation.explanation.negative_factors : explanation?.explanation?.top_factors || [])[0];
  return factor ? factorDisplayLabel(factor) : "Classroom signals";
}

function RiskCountPills({ row }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-black text-red-700 dark:bg-red-500/10 dark:text-red-100">H {numberValue(row.high_risk || 0)}</span>
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700 dark:bg-amber-500/10 dark:text-amber-100">M {numberValue(row.medium_risk || 0)}</span>
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-100">L {numberValue(row.low_risk || 0)}</span>
    </div>
  );
}

function SegmentButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-black transition",
        active ? "bg-white text-role-primary shadow-sm dark:bg-slate-950" : "text-slate-500 hover:text-role-primary dark:text-slate-400",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function HighRiskStudentRows({ rows, onExplain }) {
  if (!rows.length) return <EmptyState title="No students need immediate attention" />;
  return (
    <div className="divide-y divide-role-border overflow-hidden rounded-lg border border-role-border dark:divide-slate-800 dark:border-slate-800">
      {rows.map((row) => (
        <div key={studentKey(row)} className="grid gap-3 bg-white px-3 py-3 text-sm transition hover:bg-role-hover/60 dark:bg-slate-950 dark:hover:bg-slate-900 md:grid-cols-[1.25fr_1fr_auto] md:items-center">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate font-black text-slate-950 dark:text-white">{row.student_name || "Student"}</p>
              <StatusIcon status="High" />
            </div>
            <p className="mt-0.5 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{row.class_name || "Class"}</p>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-slate-700 dark:text-slate-200">{mainStudentDriver(row)}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Confidence {probabilityPercent(studentPredictionConfidence(row), "-")}</p>
          </div>
          <div className="flex items-center gap-2 md:justify-end">
            <IconButton label="Explain prediction" icon={BrainCircuit} onClick={() => onExplain(row)} tone="role" />
            <Link
              to={`/admin/students?class=${row.class_id || ""}&student=${row.student_id || ""}`}
              className="focus-ring inline-grid h-10 w-10 place-items-center rounded-full border border-role-border bg-white text-role-primary shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-950"
              title="View student"
              aria-label="View student"
            >
              <Eye size={18} />
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function HighRiskClassRows({ rows, onExplain, explanationForClass }) {
  if (!rows.length) return <EmptyState title="No classes need immediate attention" />;
  return (
    <div className="divide-y divide-role-border overflow-hidden rounded-lg border border-role-border dark:divide-slate-800 dark:border-slate-800">
      {rows.map((row) => (
        <div key={row.class_id} className="grid gap-3 bg-white px-3 py-3 text-sm transition hover:bg-role-hover/60 dark:bg-slate-950 dark:hover:bg-slate-900 lg:grid-cols-[1.25fr_auto_1fr_auto] lg:items-center">
          <div className="min-w-0">
            <p className="truncate font-black text-slate-950 dark:text-white">{row.class_name}</p>
            <p className="mt-0.5 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{row.instructor || "Unassigned"}</p>
          </div>
          <RiskCountPills row={row} />
          <p className="truncate text-sm font-black text-slate-700 dark:text-slate-200">{mainClassDriver(row, explanationForClass)}</p>
          <div className="flex items-center gap-2 lg:justify-end">
            <IconButton label="Explain class prediction" icon={BrainCircuit} onClick={() => onExplain(explanationForClass(row))} tone="role" />
            <Link
              to={`/admin/classes?class=${row.class_id}`}
              className="focus-ring inline-grid h-10 w-10 place-items-center rounded-full border border-role-border bg-white text-role-primary shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-950"
              title="Open class"
              aria-label="Open class"
            >
              <ExternalLink size={18} />
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function HighRiskResultsPanel({ students, classes, onViewAll, onExplain, explanationForClass }) {
  const [tab, setTab] = useState("students");
  const visibleStudents = students.slice(0, 5);
  const visibleClasses = classes.slice(0, 5);
  const viewingStudents = tab === "students";
  return (
    <DashboardCard className="p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SectionHeader title="Predicted High-Risk Results" />
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-role-hover p-1 dark:bg-slate-900">
            <SegmentButton active={viewingStudents} onClick={() => setTab("students")}>Students</SegmentButton>
            <SegmentButton active={!viewingStudents} onClick={() => setTab("classes")}>Classes</SegmentButton>
          </div>
          <ViewAllButton onClick={() => onViewAll(tab)} disabled={viewingStudents ? !students.length : !classes.length} />
        </div>
      </div>
      <div className="mt-4">
        {viewingStudents ? (
          <HighRiskStudentRows rows={visibleStudents} onExplain={onExplain} />
        ) : (
          <HighRiskClassRows rows={visibleClasses} onExplain={onExplain} explanationForClass={explanationForClass} />
        )}
      </div>
    </DashboardCard>
  );
}

function PriorityClassCards({ rows, onExplain, explanationForClass }) {
  if (!rows.length) return <EmptyState title="No classes need immediate attention" />;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {rows.map((row) => (
        <div key={row.class_id} className="flex min-h-[150px] flex-col justify-between rounded-lg border border-role-border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/30">
          <div className="grid gap-2.5">
            <div className="min-w-0">
              <p className="truncate font-black text-slate-950 dark:text-white">{row.class_name}</p>
              <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{row.instructor || "Unassigned"}</p>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Predicted Risk</p>
              <StatusIcon status={highRiskLabel(row)} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Link
              to={`/admin/classes?class=${row.class_id}`}
              className="focus-ring inline-grid h-10 w-10 place-items-center rounded-full border border-role-border bg-white text-role-primary shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-950"
              title="Open class"
              aria-label="Open class"
            >
              <ExternalLink size={18} />
            </Link>
            <IconButton label="Explain prediction" icon={BrainCircuit} onClick={() => onExplain(explanationForClass(row))} tone="role" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PriorityStudentCards({ rows, onExplain }) {
  if (!rows.length) return <EmptyState title="No students need immediate attention" />;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {rows.map((row) => {
        const confidence = studentPredictionConfidence(row);
        const predictionDate = row.generated_at || row.predicted_at || row.last_prediction_run;
        return (
          <div key={studentKey(row)} className="flex min-h-[170px] flex-col justify-between rounded-lg border border-role-border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/30">
            <div className="grid gap-2.5">
              <div className="min-w-0">
                <p className="truncate text-base font-black text-slate-950 dark:text-white">{row.student_name || "Student"}</p>
                <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{row.class_name || "Class"}</p>
              </div>
              <StatusIcon status="High" />
            </div>
            <div className="mt-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Prediction Confidence</p>
              <p className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{probabilityPercent(confidence, "-")}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Predicted on {formatDate(predictionDate)}</p>
            </div>
            <div className="mt-3">
              <IconButton label="Explain prediction" icon={BrainCircuit} onClick={() => onExplain(row)} tone="role" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ViewAllButton({ onClick, disabled }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-sm font-black text-role-primary transition hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
      onClick={onClick}
      disabled={disabled}
    >
      View All <span aria-hidden="true">-&gt;</span>
    </button>
  );
}

function PriorityStudentsModal({ rows, onClose, onExplain }) {
  if (!rows) return null;
  return (
    <AdminModalPortal>
      <div className="fixed inset-0 z-[90] grid h-dvh w-screen place-items-center overflow-y-auto bg-slate-950/35 px-4 py-6 backdrop-blur-[1px] dark:bg-slate-950/55" role="dialog" aria-modal="true">
        <div className="flex max-h-[80vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-role-border bg-white shadow-lift dark:border-slate-800 dark:bg-slate-950">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-role-border px-5 py-4 dark:border-slate-800">
            <h2 className="text-xl font-black text-slate-950 dark:text-white">Predicted High-Risk Students</h2>
            <button type="button" className="rounded-full bg-role-hover p-2 text-slate-500 transition hover:text-role-primary dark:bg-slate-900" onClick={onClose} aria-label="Close predicted high-risk students">
              <X size={18} />
            </button>
          </div>
          <div className="subtle-scroll min-h-0 flex-1 overflow-auto p-5">
            <table className="min-w-[720px] w-full text-left text-sm">
              <thead className="bg-role-hover text-[11px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-900/70">
                <tr>
                  <th className="px-3 py-2.5">Student</th>
                  <th className="px-3 py-2.5">Class</th>
                  <th className="px-3 py-2.5">Classified As</th>
                  <th className="px-3 py-2.5">Prediction Confidence</th>
                  <th className="px-3 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-role-border dark:divide-slate-800">
                {rows.map((row) => (
                  <tr key={studentKey(row)} className="bg-white dark:bg-slate-950">
                    <td className="px-3 py-3 font-black text-slate-950 dark:text-white">{row.student_name || "Student"}</td>
                    <td className="px-3 py-3 font-semibold text-slate-600 dark:text-slate-300">{row.class_name || "Class"}</td>
                    <td className="px-3 py-3"><StatusIcon status="High" /></td>
                    <td className="px-3 py-3 font-black text-slate-950 dark:text-white">{probabilityPercent(studentPredictionConfidence(row), "-")}</td>
                    <td className="px-3 py-3">
                      <IconButton label="Explain prediction" icon={BrainCircuit} onClick={() => onExplain(row)} tone="role" />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td className="px-3 py-8 text-center font-semibold text-slate-500" colSpan={5}>No students need immediate attention.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminModalPortal>
  );
}

function PriorityClassesModal({ rows, onClose, onExplain, explanationForClass }) {
  if (!rows) return null;
  return (
    <AdminModalPortal>
      <div className="fixed inset-0 z-[90] grid h-dvh w-screen place-items-center overflow-y-auto bg-slate-950/35 px-4 py-6 backdrop-blur-[1px] dark:bg-slate-950/55" role="dialog" aria-modal="true">
        <div className="flex max-h-[80vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-role-border bg-white shadow-lift dark:border-slate-800 dark:bg-slate-950">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-role-border px-5 py-4 dark:border-slate-800">
            <h2 className="text-xl font-black text-slate-950 dark:text-white">Predicted High-Risk Classes</h2>
            <button type="button" className="rounded-full bg-role-hover p-2 text-slate-500 transition hover:text-role-primary dark:bg-slate-900" onClick={onClose} aria-label="Close predicted high-risk classes">
              <X size={18} />
            </button>
          </div>
          <div className="subtle-scroll min-h-0 flex-1 overflow-auto p-5">
            <table className="min-w-[720px] w-full text-left text-sm">
              <thead className="bg-role-hover text-[11px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-900/70">
                <tr>
                  <th className="px-3 py-2.5">Class</th>
                  <th className="px-3 py-2.5">Instructor</th>
                  <th className="px-3 py-2.5">Predicted Risk</th>
                  <th className="px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-role-border dark:divide-slate-800">
                {rows.map((row) => (
                  <tr key={row.class_id} className="bg-white dark:bg-slate-950">
                    <td className="px-3 py-3 font-black text-slate-950 dark:text-white">{row.class_name}</td>
                    <td className="px-3 py-3 font-semibold text-slate-600 dark:text-slate-300">{row.instructor || "Unassigned"}</td>
                    <td className="px-3 py-3"><StatusIcon status={highRiskLabel(row)} /></td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-4">
                        <Link
                          to={`/admin/classes?class=${row.class_id}`}
                          className="focus-ring inline-grid h-10 w-10 place-items-center rounded-full border border-role-border bg-white text-role-primary shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-950"
                          title="Open class"
                          aria-label="Open class"
                          onClick={onClose}
                        >
                          <ExternalLink size={18} />
                        </Link>
                        <IconButton label="Explain prediction" icon={BrainCircuit} onClick={() => onExplain(explanationForClass(row))} tone="role" />
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td className="px-3 py-8 text-center font-semibold text-slate-500" colSpan={4}>No classes need immediate attention.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminModalPortal>
  );
}

function AffectedClassesPanel({ concept }) {
  if (!concept) return null;
  const classes = concept.affected_class_rows || [];
  return (
    <div className="rounded-lg bg-role-hover/70 p-4 dark:bg-slate-950/30">
      <p className="text-xs font-black uppercase tracking-wide text-role-primary">{bloomLevelLabel(concept.concept)}</p>
      <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
        Mastery {percent(concept.mastery_rate, "No data")} - {numberValue(concept.affected_students)} students below mastery across {numberValue(concept.affected_classes)} classes below mastery
      </p>
      {classes.length ? <div className="mt-3 grid gap-1.5">{classes.slice(0, 6).map((row) => <Link key={row.class_id} to={`/admin/classes?class=${row.class_id}`} className="text-sm font-black text-role-primary transition hover:underline">{row.class_name}{hasValue(row.mastery_rate) ? ` - ${percent(row.mastery_rate)}` : ""}</Link>)}</div> : null}
    </div>
  );
}

function impactWidth(factor, factors) {
  const max = Math.max(...(factors || []).map((item) => Number(item.impact || 0)), 1);
  return Math.max(8, Math.round((Number(factor.impact || 0) / max) * 100));
}

function isNegligibleShapFactor(factor) {
  if (!isShapFactor(factor)) return false;
  const value = Math.abs(Number(factor?.shap_value));
  return Number.isFinite(value) && value < 0.05;
}

function modelFactors(factors) {
  return (factors || []).filter((factor) => MODEL_FACTOR_LABELS.has(factor.factor) && !isNegligibleShapFactor(factor));
}

const FEATURE_VALUE_CONFIG = {
  Attendance: { keys: ["attendance_rate"], format: (value) => percent(value) },
  Participation: { keys: ["participation_rate", "answer_rate"], format: (value) => percent(value) },
  Correctness: { keys: ["correctness_rate"], format: (value) => percent(value) },
  "Semantic Score": { keys: ["semantic_score", "average_semantic_score"], format: (value) => percent(value) },
  Engagement: { keys: ["engagement_score"], format: (value) => percent(value) },
  Consistency: { keys: ["consistency_score"], format: (value) => percent(value) },
  "Recent Activity": { keys: ["recent_activity_count"], format: (value) => `${numberValue(value)} ${Number(value) === 1 ? "activity" : "activities"}` },
  "Weak Concepts": { keys: ["weak_concepts_count"], format: (value) => `${numberValue(Math.round(Number(value)))} weak Bloom ${Number(value) === 1 ? "level" : "levels"}` },
  "Bloom Mastery Gaps": { keys: ["weak_concepts_count"], format: (value) => `${numberValue(Math.round(Number(value)))} weak Bloom ${Number(value) === 1 ? "level" : "levels"}` },
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
  if (isShapFactor(factor)) {
    const value = Math.abs(Number(factor?.shap_value));
    if (value >= 1) return "High";
    if (value >= 0.5) return "Medium";
    return "Low";
  }
  const max = Math.max(...(factors || []).map((item) => Number(item.impact || 0)), 1);
  const share = Number(factor.impact || 0) / max;
  if (share >= 0.72) return "High";
  if (share >= 0.38) return "Medium";
  return "Low";
}

function influenceTone(factor) {
  if (isShapFactor(factor)) {
    const value = Number(factor?.shap_value);
    if (Number.isFinite(value)) return value >= 0 ? "red" : "green";
  }
  return factor.direction === "positive" ? "green" : "red";
}

function isShapFactor(factor) {
  return factor?.source === "shap" || factor?.method === "shap" || Number.isFinite(Number(factor?.shap_value));
}

function shapContributionText(factor) {
  const value = Number(factor?.shap_value);
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function shapPredictionText(prediction, factor) {
  const riskLevel = titleCase(prediction?.risk_level || "risk").toLowerCase();
  const value = Number(factor?.shap_value);
  if (Number.isFinite(value)) {
    return value >= 0 ? `pushed the prediction toward ${riskLevel} risk` : "reduced the predicted risk";
  }
  if (factor.direction === "positive") return "reduced the predicted risk";
  return `pushed the prediction toward ${riskLevel} risk`;
}

function explanationMethodLabel(prediction, factors = []) {
  if (prediction?.xai?.method === "shap" || factors.some(isShapFactor)) return "SHAP local explanation";
  return prediction?.explanation?.method || "Feature-importance fallback";
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
  const suffix = isShapFactor(factor) ? ` ${shapPredictionText(prediction, factor)}` : "";
  if (factor.factor === "Weak Concepts" || factor.factor === "Bloom Mastery Gaps") {
    if (isShapFactor(factor)) return `${factorDisplayLabel(factor)} = ${measured.text}${suffix}`;
    const levels = weakConceptNamesForPrediction(prediction).slice(0, BLOOM_LEVEL_ORDER.length).map(bloomLevelLabel);
    if (levels.length) {
      return `weaker performance at the ${listText(levels)} cognitive ${levels.length === 1 ? "level" : "levels"}${suffix}`;
    }
    return null;
  }
  return `${factorDisplayLabel(factor)} = ${measured.text}${suffix}`;
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
  const hasShap = riskFactors.some(isShapFactor) || positiveFactors.some(isShapFactor) || prediction?.xai?.method === "shap";
  if (hasShap) {
    return `${subject} is classified as ${riskLevel} Academic Risk because ${listText(riskValues)}.${positiveSentence}`;
  }
  return `${subject} is classified as ${riskLevel} Academic Risk because ${listText(riskValues)} strongly influenced the prediction.${positiveSentence}`;
}

function weakConceptNamesForPrediction(prediction) {
  return bloomGapRowsForPrediction(prediction)
    .map((row) => row.label)
    .sort((a, b) => bloomLevelRank(a) - bloomLevelRank(b) || String(a).localeCompare(String(b)))
    .slice(0, BLOOM_LEVEL_ORDER.length);
}

function WeakConceptValue({ prediction, measured }) {
  const [open, setOpen] = useState(false);
  const concepts = weakConceptNamesForPrediction(prediction);
  const count = concepts.length;
  const visibleLevels = concepts.slice(0, BLOOM_LEVEL_ORDER.length).map(bloomLevelLabel);
  const remaining = Math.max(concepts.length - visibleLevels.length, 0);

  if (!concepts.length) {
    return <span>No assessed Bloom level is below mastery</span>;
  }

  return (
    <span className="group relative inline-flex items-center gap-1.5">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full text-left text-sm font-black text-slate-950 outline-none transition hover:text-role-primary focus:text-role-primary dark:text-white"
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((current) => !current)}
      >
        {numberValue(count)} of {BLOOM_LEVEL_ORDER.length} weak Bloom {count === 1 ? "level" : "levels"}
        <Info size={14} className="text-role-primary" />
      </button>
      <span
        className={cn(
          "pointer-events-none absolute left-0 top-[calc(100%+0.5rem)] z-40 w-64 translate-y-1 rounded-lg border border-role-border bg-white p-3 text-left opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:border-slate-800 dark:bg-slate-900",
          open && "translate-y-0 opacity-100",
        )}
      >
        <span className="block text-xs font-black uppercase tracking-wide text-role-primary">Weak Bloom Level Details</span>
        <span className="mt-2 grid gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
          {visibleLevels.map((level) => (
            <span key={level}>• {level}</span>
          ))}
          {remaining > 0 && <span className="font-black text-slate-500">+{remaining} more</span>}
        </span>
        <span className="mt-2 block text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">
          {BLOOM_GAP_TOOLTIP}
        </span>
      </span>
    </span>
  );
}

function FactorValueCell({ prediction, factor, measured }) {
  if ((factor.factor === "Weak Concepts" || factor.factor === "Bloom Mastery Gaps") && measured.available) {
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
      <div className="hidden grid-cols-[1fr_1fr_auto_auto] gap-3 border-b border-role-border bg-role-hover/70 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 sm:grid">
        <span>Signal</span>
        <span>Actual Value</span>
        <span>SHAP Value</span>
        <span>Influence</span>
      </div>
      <div className="divide-y divide-role-border dark:divide-slate-800">
        {rows.map((factor) => {
          const measured = measuredFactorValue(prediction, factor);
          const shapValue = Number(factor?.shap_value);
          const shapIsPositive = isShapFactor(factor) && Number.isFinite(shapValue) && shapValue >= 0;
          const RowIcon = isShapFactor(factor) && Number.isFinite(shapValue) ? (shapIsPositive ? ArrowUpRight : ArrowDownRight) : Icon;
          return (
            <div key={`${factor.factor}-${factor.direction}`} className="grid gap-2 px-3 py-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center sm:gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <RowIcon className={cn("shrink-0", influenceTone(factor) === "green" ? "text-emerald-600 dark:text-emerald-200" : "text-red-500 dark:text-red-200")} size={15} />
                <span className="truncate text-sm font-black text-slate-800 dark:text-slate-100">{factorDisplayLabel(factor)}</span>
              </div>
              <p className={cn("text-sm font-black", measured.available ? "text-slate-950 dark:text-white" : "text-slate-500 dark:text-slate-400")}>
                <FactorValueCell prediction={prediction} factor={factor} measured={measured} />
              </p>
              <p className="text-sm font-black text-slate-600 dark:text-slate-300">{shapContributionText(factor)}</p>
              <Badge tone={influenceTone(factor)}>{influenceLevel(factor, rows)} Influence</Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShapExplanationNote({ show }) {
  if (!show) return null;
  return (
    <p className="mt-4 rounded-lg border border-role-border bg-role-hover/50 px-3 py-2.5 text-xs font-semibold leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
      SHAP explains how each feature contributed to this student's prediction. Positive values push the prediction toward the predicted risk level, while negative values reduce the predicted risk. Larger absolute SHAP values indicate stronger influence.
    </p>
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
  const methodLabel = explanationMethodLabel(prediction, [...riskFactors, ...positiveFactors]);
  const hasShapExplanation = prediction?.xai?.method === "shap" || [...riskFactors, ...positiveFactors].some(isShapFactor);
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
              <div className="rounded-lg bg-role-hover px-3 py-2.5 dark:bg-slate-900/60"><p className="text-[11px] font-black uppercase text-slate-500">Risk</p><div className="mt-1.5"><StatusIcon status={titleCase(prediction.risk_level)} /></div></div>
            </div>

            <PredictionProbabilityBars prediction={prediction} />

            <div className="mt-4 rounded-lg border border-role-border p-3 dark:border-slate-800">
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Summary</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{summary}</p>
              <p className="mt-2 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Explanation method: {methodLabel}</p>
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

            <ShapExplanationNote show={hasShapExplanation} />

            {recommendedActions.length > 0 && (
              <div className="mt-4 rounded-lg border border-role-border p-3 dark:border-slate-800">
                {/* <p className="text-xs font-black uppercase tracking-wide text-role-primary">Recommended Intervention</p>
                <ul className="mt-2 grid gap-1.5 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                  {recommendedActions.map((action) => (
                    <li key={action} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-role-primary" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul> */}
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
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function HistoricalTrends({ trends }) {
  if (!trends?.length) return <EmptyState icon={LineChart} title="Awaiting" />;
  return (
    <div className="rounded-lg bg-role-hover/50 p-3 dark:bg-slate-950/20">
      <div className="mb-3 flex flex-wrap items-center gap-4 px-1 text-xs font-black text-slate-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#2B7886]" />Engagement</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#76A9FA]" />Attendance</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#111827]" />Correctness</span>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ReLineChart data={trends.slice(-12)} margin={{ left: 0, right: 20, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.28)" />
            <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
            <YAxis axisLine={false} tickLine={false} domain={[0, 100]} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="engagement" name="Engagement" stroke="#2B7886" strokeWidth={3} dot={false} />
            <Line type="monotone" dataKey="attendance" name="Attendance" stroke="#76A9FA" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="correctness" name="Correctness" stroke="#111827" strokeWidth={2} dot={false} />
          </ReLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function OverviewStrip({ health, reports, distribution, weakConcepts }) {
  const totalPredicted = distribution.low + distribution.medium + distribution.high;
  const metrics = [
    ["Engagement", percent(health.institution_engagement_health, "Awaiting")],
    ["Active Classes", numberValue(health.active_classes ?? reports.length)],
    ["Students Analyzed", numberValue(totalPredicted)],
    ["Bloom Below Mastery", numberValue(Math.min(weakConcepts.length, BLOOM_LEVEL_ORDER.length))],
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
      {!totalPredicted && <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Analytics will appear after learning records are available.</p>}
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

function InstitutionPerformance({ comparisonData, reports }) {
  const averageAttendance = comparisonData.length ? percent(average(comparisonData.map((row) => row.attendance))) : "Awaiting";
  const averageParticipation = comparisonData.length ? percent(average(comparisonData.map((row) => row.participation))) : "Awaiting";
  const averageCorrectness = comparisonData.length ? percent(average(comparisonData.map((row) => row.correctness))) : "Awaiting";
  const averageEngagement = comparisonData.length ? percent(average(comparisonData.map((row) => row.engagement))) : "Awaiting";
  return (
    <DashboardCard className="p-6 shadow-sm">
      <SectionHeader eyebrow="Performance" title="Institution Performance" />
      <div className="mt-6">
        <MetricLine label="Average engagement" value={averageEngagement} />
        <MetricLine label="Average attendance" value={averageAttendance} />
        <MetricLine label="Average participation" value={averageParticipation} />
        <MetricLine label="Average correctness" value={averageCorrectness} />
        <MetricLine label="Classes analyzed" value={numberValue(reports.length)} />
      </div>
    </DashboardCard>
  );
}

function bloomStatusTone(status) {
  if (status === "Strong") return "green";
  if (status === "Acceptable") return "teal";
  if (status === "Needs Attention") return "gold";
  return "red";
}

function BloomRankedAnalysis({ concepts, selectedConcept, onSelect }) {
  const rows = [...(concepts || [])]
    .filter((concept) => isBloomLevel(concept.concept))
    .filter((concept) => ["Needs Attention", "Needs Improvement"].includes(concept.mastery_status))
    .sort((a, b) => Number(a.mastery_rate ?? 101) - Number(b.mastery_rate ?? 101) || Number(b.affected_students || 0) - Number(a.affected_students || 0));
  if (!rows.length) return <EmptyState title="No Bloom mastery gaps" description="No Bloom taxonomy level is currently below the 60% mastery threshold." />;
  return (
    <DashboardCard className="p-6 shadow-sm">
      <SectionHeader
        eyebrow="Bloom Analysis"
        title="Bloom-Level Mastery Analysis"
        description="Student performance grouped by Bloom's Taxonomy level."
        action={<BloomSignalTooltip />}
      />
      <div className="mt-5 overflow-hidden rounded-lg border border-role-border dark:border-slate-800">
        <div className="hidden grid-cols-[9rem_minmax(12rem,1fr)_7rem_12rem_11rem_10rem] gap-3 border-b border-role-border bg-role-hover/70 px-4 py-3 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950 sm:grid">
          <span>Bloom level</span>
          <span>Mastery progress</span>
          <span>Mastery</span>
          <span>Students</span>
          <span>Classes</span>
          <span>Status</span>
        </div>
        <div className="divide-y divide-role-border dark:divide-slate-800">
          {rows.map((concept) => {
            const selected = selectedConcept?.concept === concept.concept;
            const mastery = hasValue(concept.mastery_rate) ? Number(concept.mastery_rate) : 0;
            const status = concept.mastery_status || "Needs Attention";
            return (
              <button
                key={concept.concept}
                type="button"
                className={cn("grid w-full gap-3 px-4 py-3 text-left transition hover:bg-role-hover dark:hover:bg-slate-900/50 sm:grid-cols-[9rem_minmax(12rem,1fr)_7rem_12rem_11rem_10rem] sm:items-center", selected && "bg-role-hover dark:bg-slate-900/50")}
                onClick={() => onSelect(selected ? null : concept)}
              >
                <span className="text-sm font-black text-slate-950 dark:text-white">{bloomLevelLabel(concept.concept)}</span>
                <span className="grid gap-1">
                  <span className="h-2.5 overflow-hidden rounded-full bg-role-hover dark:bg-slate-900">
                    <span
                      className={cn("block h-full rounded-full", mastery < 40 ? "bg-red-500" : "bg-amber-500")}
                      style={{ width: `${Math.max(6, mastery)}%` }}
                    />
                  </span>
                </span>
                <span className="text-sm font-black text-slate-950 dark:text-white">{hasValue(concept.mastery_rate) ? `${Math.round(mastery)}%` : "No data"}</span>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{numberValue(concept.affected_students)} students below mastery</span>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{numberValue(concept.affected_classes)} classes below mastery</span>
                <span><Badge tone={bloomStatusTone(status)}>{status}</Badge></span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3">
        <AffectedClassesPanel concept={selectedConcept} />
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
function ReportDetailsModal({ report, defaultConfidence, explanation, onClose, onExplain, onExportPdf }) {
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
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60"><p className="text-[11px] font-black uppercase text-slate-500">Risk</p><div className="mt-2"><StatusIcon status={report.risk_level || "Pending"} /></div></div>
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60"><p className="text-[11px] font-black uppercase text-slate-500">Confidence</p><p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{probabilityPercent(reportConfidence(report, defaultConfidence), "Pending")}</p></div>
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60"><p className="text-[11px] font-black uppercase text-slate-500">Students</p><p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{numberValue(report.students)}</p></div>
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60"><p className="text-[11px] font-black uppercase text-slate-500">Last</p><p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{formatDate(report.last_prediction_run)}</p></div>
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60"><p className="text-[11px] font-black uppercase text-slate-500">Status</p><div className="mt-2"><StatusIcon status={status} type="intervention" /></div></div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
            <div className="rounded-lg border border-role-border p-4 dark:border-slate-800">
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Student Breakdown</p>
              <div className="mt-3 grid gap-2">
                {[
                  ["Low", report.low_risk, "green"],
                  ["Medium", report.medium_risk, "gold"],
                  ["High", report.high_risk, "red"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-lg bg-role-hover px-3 py-2 dark:bg-slate-900/60">
                    <StatusIcon status={label} />
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
            <IconButton label="Explain prediction" icon={BrainCircuit} onClick={() => { onClose(); onExplain(explanation); }} tone="role" />
            <IconButton label="Export CSV" icon={FileSpreadsheet} onClick={() => exportCsv([report], `${report.class_name || "prediction-report"}.csv`)} />
            <IconButton label="Export PDF" icon={FileText} onClick={() => onExportPdf(report)} />
          </div>
        </div>
      </div>
    </AdminModalPortal>
  );
}

function ReportsTabs({ activeTab, onChange, classCount, studentCount }) {
  const tabs = [
    ["classes", "Classes", classCount, BookOpen],
    ["students", "Students", studentCount, UsersRound],
  ];
  return (
    <div className="flex flex-wrap items-center gap-3">
      {tabs.map(([key, label, count, Icon]) => (
        <button
          key={key}
          type="button"
          className={cn(
            "inline-flex h-12 min-w-36 items-center justify-center gap-3 rounded-lg border px-5 text-sm font-black shadow-sm transition",
            activeTab === key
              ? "border-role-primary bg-role-primary text-white shadow-md"
              : "border-role-border bg-white text-slate-700 hover:border-role-primary hover:text-role-primary dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
          )}
          onClick={() => onChange(key)}
        >
          <Icon size={19} />
          {label}
          <span className={cn("sr-only", activeTab === key ? "text-white/80" : "text-slate-400")}>{numberValue(count)}</span>
        </button>
      ))}
    </div>
  );
}

function reportStudentSignals(report) {
  return [
    ["Attendance", studentSignalValue(report, ["attendance", "attendance_rate"])],
    ["Participation", studentSignalValue(report, ["participation", "participation_rate", "answer_rate"])],
    ["Correctness", studentSignalValue(report, ["correctness", "correctness_rate"])],
    ["Engagement", studentSignalValue(report, ["engagement", "engagement_score", "engagement_index", "derived_engagement_index"])],
    ["Semantic Score", studentSignalValue(report, ["semantic_score", "average_semantic_score"])],
  ].map(([label, value]) => ({ label, value: signalNumber(value) }));
}

function detectedStudentDrivers(report) {
  return cleanList(studentRiskDriverCandidates(report).map((factor) => factor.label)).slice(0, 3);
}

function recommendationFromDriver(driver) {
  if (driver === BLOOM_FACTOR_DISPLAY_LABEL) return "Review assessed Bloom-level weaknesses with targeted practice.";
  if (driver === "Low participation") return "Increase participation checks and active learning prompts.";
  if (driver === "Low correctness") return "Provide additional practice on recently missed concepts.";
  if (driver === "Low semantic score") return "Give short-answer feedback focused on semantic understanding.";
  if (driver === "Low attendance") return "Follow up on attendance and missed learning activities.";
  if (driver === "Low engagement") return "Schedule an engagement check-in and monitor the next activities.";
  if (driver === "Recent inactivity") return "Contact the student about recent inactivity.";
  if (driver === "Slow response behavior") return "Review response-time pressure and provide guided practice.";
  if (driver === "Inconsistent activity") return "Set a regular practice cadence and review consistency.";
  return null;
}

function recommendationsFromDrivers(drivers, extra = []) {
  return cleanList([...drivers.map(recommendationFromDriver).filter(Boolean), ...extra]).slice(0, 5);
}

function classRiskDistribution(rows, students) {
  if (students.length) {
    return students.reduce(
      (distribution, row) => {
        const risk = String(row.risk_level || "").toLowerCase();
        return { ...distribution, [risk]: Number(distribution[risk] || 0) + (["high", "medium", "low"].includes(risk) ? 1 : 0) };
      },
      { high: 0, medium: 0, low: 0 },
    );
  }
  return riskDistributionFromReports(rows);
}

function reportMetricAverage(students, keys, rows, rowKeys = keys) {
  const studentValues = students
    .map((student) => signalNumber(studentSignalValue(student, keys)))
    .filter((value) => value !== null);
  if (studentValues.length) return percent(average(studentValues));
  const rowValues = rows
    .flatMap((row) => rowKeys.map((key) => signalNumber(row[key])))
    .filter((value) => value !== null);
  return rowValues.length ? percent(average(rowValues)) : "Pending";
}

function classWeakConceptCount(students) {
  const concepts = cleanList(students.flatMap((student) => weakConceptRows(student)));
  if (concepts.length) return concepts.length;
  return students.reduce((total, student) => total + Number(studentSignalValue(student, ["weak_concepts_count"]) || 0), 0);
}

function commonRiskFactorsForStudents(students) {
  const counts = new Map();
  students.forEach((student) => {
    detectedStudentDrivers(student).forEach((driver) => counts.set(driver, (counts.get(driver) || 0) + 1));
  });
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 5);
}

function importantStudents(students) {
  const rank = { high: 3, medium: 2, low: 1 };
  return [...students]
    .sort((a, b) => {
      const riskDelta = (rank[String(b.risk_level || "").toLowerCase()] || 0) - (rank[String(a.risk_level || "").toLowerCase()] || 0);
      if (riskDelta) return riskDelta;
      return Number(studentPredictionConfidence(b) || 0) - Number(studentPredictionConfidence(a) || 0);
    })
    .slice(0, 24);
}

function reportTrendParts(report) {
  const trend = predictionTrend(report);
  if (trend.status === "initial") {
    return { path: "No previous prediction", label: "Initial Prediction" };
  }
  const label = trend.status === "improving"
    ? "Improved"
    : trend.status === "worsening"
      ? "Worsened"
      : "Stable";
  return { path: `${titleCase(trend.previous_risk_level)} → ${titleCase(trend.current_risk_level)}`, label };
}

function ReportTrendCell({ report }) {
  const trend = reportTrendParts(report);
  return (
    <span className="institution-report-trend">
      <span>{trend.path}</span>
      <strong>{trend.label}</strong>
    </span>
  );
}

function InstitutionalReportHeader({ title, generatedAt }) {
  return (
    <header className="institution-report-header">
      <div className="institution-report-brand">
        <img src={ailaLogo} alt="AILA logo" />
        <div>
          <p>AILA Smart Classes</p>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="institution-report-generated">
        <span>Generated</span>
        <strong>{fullDateTime(generatedAt)}</strong>
      </div>
    </header>
  );
}

function InstitutionalReportFooter({ generatedAt }) {
  return (
    <footer className="institution-report-footer">
      <span>Generated automatically by AILA Smart Classes</span>
      <span>Prediction Model: XGBoost</span>
      <span>Generated Date: {fullDateTime(generatedAt)}</span>
      <span className="institution-report-page-number" />
    </footer>
  );
}

function ReportSection({ title, children }) {
  return (
    <section className="institution-report-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ReportMetaGrid({ rows }) {
  return (
    <div className="institution-report-meta-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value || "Not available"}</strong>
        </div>
      ))}
    </div>
  );
}

function ReportStatGrid({ stats }) {
  return (
    <div className="institution-report-stat-grid">
      {stats.map(([label, value]) => (
        <div key={label} className="institution-report-stat">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function ReportRiskPill({ risk }) {
  const meta = riskMeta(risk);
  return <span className={cn("institution-report-risk-pill", meta.className)}>{meta.label}</span>;
}

function reportDisplayLabel(value) {
  return titleCase(value).replace(/\bBloom\b/i, "Bloom");
}

function ReportDistributionBar({ distribution }) {
  const total = Number(distribution.high || 0) + Number(distribution.medium || 0) + Number(distribution.low || 0);
  const rows = [
    ["High", "high", Number(distribution.high || 0)],
    ["Medium", "medium", Number(distribution.medium || 0)],
    ["Low", "low", Number(distribution.low || 0)],
  ];
  let offset = 0;
  if (!total) return <p className="institution-report-muted">No risk distribution is available.</p>;
  return (
    <div className="institution-report-distribution">
      <svg className="institution-report-distribution-chart" viewBox="0 0 100 18" role="img" aria-label="Risk distribution">
        <defs>
          <clipPath id="institution-risk-distribution-clip">
            <rect x="0" y="0" width="100" height="18" rx="3" />
          </clipPath>
        </defs>
        <rect x="0" y="0" width="100" height="18" rx="3" fill="#e8edf2" />
        <g clipPath="url(#institution-risk-distribution-clip)">
          {rows.map(([, key, value]) => {
            const width = (value / total) * 100;
            const x = offset;
            offset += width;
            return value > 0 ? (
              <rect key={key} x={x} y="0" width={Math.max(width, 0.8)} height="18" fill={RISK_COLORS[key]} />
            ) : null;
          })}
        </g>
      </svg>
      <div className="institution-report-distribution-summary">
        {rows.map(([label, key, value]) => (
          <div key={key}>
            <span><i style={{ backgroundColor: RISK_COLORS[key] }} />{label}</span>
            <strong>{numberValue(value)}</strong>
            <em>{Math.round((value / total) * 100)}%</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClassPredictionPdfReport({ report, rows = [], students = [], generatedAt, defaultConfidence }) {
  const classRows = rows.length ? rows : report ? [report] : [];
  const distribution = classRiskDistribution(classRows, students);
  const studentsAnalyzed = students.length || distribution.high + distribution.medium + distribution.low || classRows.reduce((sum, row) => sum + Number(row.students || 0), 0);
  const confidenceValues = students.map(studentPredictionConfidence).map(Number).filter(Number.isFinite);
  const confidence = confidenceValues.length ? average(confidenceValues) : reportConfidence(report, defaultConfidence);
  const commonFactors = commonRiskFactorsForStudents(students);
  const highRiskCount = distribution.high;
  const recommendations = recommendationsFromDrivers(
    commonFactors.map((factor) => factor.label),
    highRiskCount > 0 ? ["Follow up with High Risk students and schedule targeted intervention."] : [],
  );
  const singleClass = classRows.length === 1;
  const className = singleClass ? classRows[0]?.class_name || "Class" : "Institution Overview";
  const instructors = cleanList(classRows.map((row) => row.instructor));
  const semesters = cleanList(classRows.map((row) => row.semester));
  const instructor = singleClass ? classRows[0]?.instructor || "Unassigned" : numberValue(instructors.length, "0");
  const semester = singleClass ? classRows[0]?.semester || "Unassigned" : semesters.length === 1 ? semesters[0] : `${numberValue(semesters.length, "0")} semesters`;
  const scopeRows = singleClass
    ? [
        ["Instructor", instructor],
        ["Class", className],
        ["Semester", semester],
        ["Generated date", fullDateTime(generatedAt)],
        ["Students analyzed", numberValue(studentsAnalyzed)],
      ]
    : [
        ["Institution", "AILA Smart Classes"],
        ["Instructors included", numberValue(instructors.length, "0")],
        ["Classes included", numberValue(classRows.length, "0")],
        ["Semester", semester],
        ["Generated date", fullDateTime(generatedAt)],
        ["Students analyzed", numberValue(studentsAnalyzed)],
      ];
  const attentionRows = importantStudents(students);

  return (
    <article className="institution-report-document">
      <InstitutionalReportHeader title="Class Prediction Report" generatedAt={generatedAt} />
      <main className="institution-report-content">
        <section className="institution-report-cover">
          <p>Report Scope</p>
          <h2>{className}</h2>
          <ReportMetaGrid rows={scopeRows} />
        </section>

        <ReportSection title="Executive Summary">
          <ReportStatGrid stats={[
            ["Students analyzed", numberValue(studentsAnalyzed)],
            ["High Risk", numberValue(distribution.high)],
            ["Medium Risk", numberValue(distribution.medium)],
            ["Low Risk", numberValue(distribution.low)],
            ["Average prediction confidence", probabilityPercent(confidence, "Pending")],
          ]} />
        </ReportSection>

        <ReportSection title="Risk Distribution">
          <ReportDistributionBar distribution={distribution} />
        </ReportSection>

        <ReportSection title="Class Summary">
          <div className="institution-report-metric-list">
            <div><span>Average attendance</span><strong>{reportMetricAverage(students, ["attendance", "attendance_rate"], classRows, ["attendance"])}</strong></div>
            <div><span>Average participation</span><strong>{reportMetricAverage(students, ["participation", "participation_rate", "answer_rate"], classRows, ["participation"])}</strong></div>
            <div><span>Average engagement</span><strong>{reportMetricAverage(students, ["engagement", "engagement_score", "engagement_index"], classRows, ["engagement_score"])}</strong></div>
            <div><span>Average correctness</span><strong>{reportMetricAverage(students, ["correctness", "correctness_rate"], classRows, ["correctness"])}</strong></div>
            <div><span>Average semantic score</span><strong>{reportMetricAverage(students, ["semantic_score", "average_semantic_score"], classRows, ["semantic_score"])}</strong></div>
            <div><span>Weak concepts detected</span><strong>{numberValue(classWeakConceptCount(students), "0")}</strong></div>
          </div>
        </ReportSection>

        <ReportSection title="Students Requiring Attention">
          {attentionRows.length ? (
            <table className="institution-report-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Risk</th>
                  <th>Trend</th>
                  <th>Main Risk Driver</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {attentionRows.map((student) => (
                  <tr key={studentKey(student)}>
                    <td>{student.student_name || "Student"}</td>
                    <td><ReportRiskPill risk={student.risk_level} /></td>
                    <td><ReportTrendCell report={student} /></td>
                    <td>{detectedStudentDrivers(student)[0] || "No specific driver detected"}</td>
                    <td>{probabilityPercent(studentPredictionConfidence(student), "Pending")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="institution-report-muted">No student-level predictions are available for this class report.</p>
          )}
        </ReportSection>

        <div className="institution-report-two-column">
          <ReportSection title="Common Risk Factors">
            {commonFactors.length ? (
              <ol className="institution-report-ranked-list">
                {commonFactors.map((factor) => (
                  <li key={factor.label}>
                    <span>{reportDisplayLabel(factor.label)}</span>
                    <strong>{numberValue(factor.count)} {Number(factor.count) === 1 ? "student" : "students"}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="institution-report-muted">No repeated risk factor was detected in the available student data.</p>
            )}
          </ReportSection>
          <ReportSection title="Suggested Actions">
            {recommendations.length ? (
              <ul className="institution-report-action-list">
                {recommendations.map((action) => <li key={action}><span aria-hidden="true">✓</span>{action}</li>)}
              </ul>
            ) : (
              <p className="institution-report-muted">No targeted action was generated because no specific risk factor was detected.</p>
            )}
          </ReportSection>
        </div>
      </main>
      <InstitutionalReportFooter generatedAt={generatedAt} />
    </article>
  );
}

function StudentPredictionPdfReport({ report, generatedAt }) {
  const drivers = detectedStudentDrivers(report);
  const recommendations = recommendationsFromDrivers(drivers);
  const bloomRows = bloomMasteryRowsForPrediction(report).filter((row) => row.attempted_count > 0);
  const predictionDate = predictionTimestamp(report);
  const studentId = report.student_id || report.user_id || report.institution_student_id || report.institution_id || "Not available";

  return (
    <article className="institution-report-document">
      <InstitutionalReportHeader title="Student Prediction Report" generatedAt={generatedAt} />
      <main className="institution-report-content">
        <section className="institution-report-cover">
          <p>Individual Academic Profile</p>
          <h2>{report.student_name || "Student"}</h2>
          <ReportMetaGrid rows={[
            ["Student ID", studentId],
            ["Instructor", report.instructor || "Unassigned"],
            ["Class", report.class_name || "Class"],
            ["Prediction date", fullDateTime(predictionDate)],
            ["Generated date", fullDateTime(generatedAt)],
          ]} />
        </section>

        <ReportSection title="Current Prediction">
          <ReportStatGrid stats={[
            ["Risk level", <ReportRiskPill key="risk" risk={report.risk_level} />],
            ["Confidence", probabilityPercent(studentPredictionConfidence(report), "Pending")],
            ["Trend", <ReportTrendCell key="trend" report={report} />],
          ]} />
        </ReportSection>

        <ReportSection title="Feature Summary">
          <div className="institution-report-metric-list">
            {reportStudentSignals(report).map((signal) => (
              <div key={signal.label}>
                <span>{signal.label}</span>
                <strong>{signal.value === null ? "Pending" : `${signal.value}%`}</strong>
              </div>
            ))}
          </div>
        </ReportSection>

        <ReportSection title="Main Risk Drivers">
          {drivers.length ? (
            <ul className="institution-report-list">
              {drivers.map((driver) => <li key={driver}>{driver}</li>)}
            </ul>
          ) : (
            <p className="institution-report-muted">No specific risk driver was detected in the available feature values.</p>
          )}
        </ReportSection>

        <ReportSection title="Bloom Performance">
          {bloomRows.length ? (
            <table className="institution-report-table institution-report-bloom-table">
              <thead>
                <tr>
                  <th>Bloom Level</th>
                  <th>Correct</th>
                  <th>Attempted</th>
                  <th>Mastery</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bloomRows.map((row) => (
                  <tr key={row.level} className={row.is_gap ? "is-weak" : ""}>
                    <td>{row.label}</td>
                    <td>{numberValue(row.correct_count, "0")}</td>
                    <td>{numberValue(row.attempted_count, "0")}</td>
                    <td>{row.mastery_rate === null ? "Pending" : `${Math.round(row.mastery_rate)}%`}</td>
                    <td>{row.is_gap ? "Below mastery threshold" : "At or above mastery threshold"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="institution-report-muted">No Bloom-level questions have been completed yet.</p>
          )}
        </ReportSection>

        <ReportSection title="Recommended Actions">
          {recommendations.length ? (
            <ul className="institution-report-action-list">
              {recommendations.map((action) => <li key={action}><span aria-hidden="true">✓</span>{action}</li>)}
            </ul>
          ) : (
            <p className="institution-report-muted">No targeted action was generated because no specific weakness was detected.</p>
          )}
        </ReportSection>
      </main>
      <InstitutionalReportFooter generatedAt={generatedAt} />
    </article>
  );
}

function PredictionReportPrintSurface({ printReport }) {
  if (!printReport) return null;
  return (
    <div className="institution-report-print-root" aria-hidden="true">
      {printReport.type === "class" ? (
        <ClassPredictionPdfReport
          report={printReport.report}
          rows={printReport.rows}
          students={printReport.students}
          generatedAt={printReport.generatedAt}
          defaultConfidence={printReport.defaultConfidence}
        />
      ) : (
        <StudentPredictionPdfReport report={printReport.report} generatedAt={printReport.generatedAt} />
      )}
    </div>
  );
}

function StudentReportModal({ report, onClose, onExplain, onExportPdf }) {
  if (!report) return null;
  const confidence = studentPredictionConfidence(report);
  const predictionDate = predictionTimestamp(report);
  const bloomRows = bloomMasteryRowsForPrediction(report);
  const assessedBloomRows = bloomRows.filter((row) => row.attempted_count > 0);
  const bloomGapRows = bloomGapRowsForPrediction(report);
  const notAssessedBloomRows = notAssessedBloomRowsForPrediction(report);
  const signals = [
    ["Attendance", studentSignalValue(report, ["attendance", "attendance_rate"])],
    ["Participation", studentSignalValue(report, ["participation", "participation_rate", "answer_rate"])],
    ["Correctness", studentSignalValue(report, ["correctness", "correctness_rate"])],
    ["Engagement", studentSignalValue(report, ["engagement", "engagement_score", "engagement_index"])],
    ["Semantic Score", studentSignalValue(report, ["semantic_score", "average_semantic_score"])],
  ];
  const recommendations = recommendationRows(report);
  return (
    <AdminModalPortal>
      <div className="fixed inset-0 z-[90] grid h-dvh w-screen place-items-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
        <div className="subtle-scroll max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-role-border bg-white p-5 shadow-lift dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Student Report</p>
              <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">{report.student_name || "Student"}</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{report.class_name || "Class"} - {formatDate(predictionDate)}</p>
            </div>
            <button type="button" className="rounded-full bg-role-hover p-2 text-slate-500 transition hover:text-role-primary dark:bg-slate-900" onClick={onClose} aria-label="Close student report">
              <X size={18} />
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60">
              <p className="text-[11px] font-black uppercase text-slate-500">Predicted Risk</p>
              <div className="mt-2"><StatusIcon status={titleCase(report.risk_level || "Pending")} /></div>
            </div>
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60">
              <p className="text-[11px] font-black uppercase text-slate-500">Previous</p>
              <p className="mt-1 text-sm font-black text-slate-950 dark:text-white">{previousPredictionText(report)}</p>
            </div>
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60">
              <p className="text-[11px] font-black uppercase text-slate-500">Trend</p>
              <p className="mt-1 text-sm font-black text-slate-950 dark:text-white">{trendSummaryText(report)}</p>
            </div>
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60">
              <p className="text-[11px] font-black uppercase text-slate-500">Confidence</p>
              <p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{probabilityPercent(confidence, "Pending")}</p>
            </div>
            <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-900/60">
              <p className="text-[11px] font-black uppercase text-slate-500">Status</p>
              <div className="mt-2"><StatusIcon status={studentReportStatus(report)} type="intervention" /></div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-lg border border-role-border p-4 dark:border-slate-800">
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Learning Signals</p>
              <div className="mt-3 grid gap-2">
                {signals.map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-lg bg-role-hover px-3 py-2 dark:bg-slate-900/60">
                    <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</span>
                    <span className="font-black text-slate-950 dark:text-white">{signalPercent(value)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-role-border p-4 dark:border-slate-800">
              <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-role-primary">
                {assessedBloomRows.length ? "Bloom-Level Mastery Gaps" : "Bloom Assessment"}
                <span className="group relative inline-flex">
                  <Info size={13} />
                  <span className="pointer-events-none absolute left-0 top-[calc(100%+0.5rem)] z-40 w-72 translate-y-1 rounded-lg border border-role-border bg-white p-3 text-xs font-semibold normal-case leading-5 tracking-normal text-slate-600 opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    {BLOOM_GAP_TOOLTIP}
                  </span>
                </span>
              </p>
              {assessedBloomRows.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {bloomGapRows.length
                    ? bloomGapRows.map((row) => <Badge key={row.level} tone="gold">{row.label} {Math.round(row.mastery_rate)}%</Badge>)
                    : <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No assessed Bloom level is below mastery.</p>}
                </div>
              ) : (
                <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">No Bloom-level questions have been completed yet.</p>
              )}
              {assessedBloomRows.length > 0 && notAssessedBloomRows.length > 0 && (
                <div className="mt-4 border-t border-role-border pt-3 dark:border-slate-800">
                  <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Not yet assessed</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {notAssessedBloomRows.map((row) => <Badge key={row.level} tone="slate" className="opacity-60">{row.label}</Badge>)}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-role-border p-4 dark:border-slate-800">
            <p className="text-xs font-black uppercase tracking-wide text-role-primary">Recommendation</p>
            <ul className="mt-2 grid gap-1.5 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
              {recommendations.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-role-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5 rounded-lg border border-role-border p-4 dark:border-slate-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-role-primary">Prediction Explanation</p>
                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Review the model explanation for this prediction.</p>
              </div>
              <IconButton label="Explain prediction" icon={BrainCircuit} onClick={() => onExplain(report)} tone="role" />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <IconButton label="Export PDF" icon={FileText} onClick={() => onExportPdf(report)} />
          </div>
        </div>
      </div>
    </AdminModalPortal>
  );
}

function ReportsTable({ rows, allRows, filters, mode = "analytics", onExplain, explanationForClass, onViewReport, onExportPdf, defaultConfidence }) {
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
      {!dedicated && (
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <SectionHeader eyebrow="Reports" title="Details" />
          <IconButton label={open ? "Collapse details" : "Open details"} icon={ChevronDown} iconClassName={cn("transition", open && "rotate-180")} onClick={() => setOpen((current) => !current)} />
        </div>
      )}
      {open && (
        <>
          <div className={cn(!dedicated && "mt-5")}>
            <TableToolbar
              search={filters.search}
              onSearchChange={filters.setSearch}
              searchPlaceholder="Search classes..."
              onClearFilters={() => filters.setSearch("")}
            >
            <div className="flex items-center gap-2">
              <IconButton label="Export CSV" icon={FileSpreadsheet} onClick={() => exportCsv(sortedRows, "prediction-reports.csv")} />
              <IconButton label="Export PDF" icon={FileText} onClick={() => onExportPdf(sortedRows)} />
            </div>
            </TableToolbar>
          </div>
          <div className="mt-3 max-h-[560px] overflow-auto rounded-lg border border-role-border dark:border-slate-800">
            <table className="min-w-[860px] w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-role-hover text-[11px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-950">
                  <tr>
                    {reportColumns.map((column) => <th key={column.key} className="px-3 py-2.5"><button type="button" className="inline-flex items-center gap-1 hover:text-role-primary" onClick={() => updateSort(column.key)}><HeaderIconLabel icon={column.icon} label={column.label} />{sort.key === column.key && <ChevronDown size={13} className={cn("transition", sort.direction === "asc" && "rotate-180")} />}</button></th>)}
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
                      <td className="px-3 py-2.5"><StatusIcon status={hasPrediction ? row.risk_level : "Pending"} /></td>
                      <td className="px-3 py-2.5 font-black">{probabilityPercent(reportConfidence(row, defaultConfidence), hasPrediction ? "—" : "Pending")}</td>
                      <td className="px-3 py-2.5 font-semibold">{numberValue(row.students)}</td>
                      <td className="px-3 py-2.5">{formatDate(row.last_prediction_run)}</td>
                      <td className="px-3 py-2.5"><StatusIcon status={status} type="intervention" /></td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <IconActionButton label="View report" icon={Eye} onClick={() => onViewReport(row)} />
                          <IconActionButton label="Explain prediction" icon={BrainCircuit} onClick={() => onExplain(explanationForClass(row))} />
                          <IconActionButton label="Export CSV" icon={FileSpreadsheet} onClick={() => exportCsv([row], `${row.class_name || "prediction-report"}.csv`)} />
                          <IconActionButton label="Export PDF" icon={FileText} onClick={() => onExportPdf(row)} />
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
            <div className="flex items-center gap-2">
              <IconButton label="Previous page" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} />
              <span className="text-xs font-black text-slate-500">Page {page} of {pageCount}</span>
              <IconButton label="Next page" icon={ChevronRight} disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} />
            </div>
          </div>
        </>
      )}
    </DashboardCard>
  );
}

function IconActionButton({ label, icon: Icon, onClick }) {
  return <IconButton label={label} icon={Icon} onClick={onClick} />;
}

function StudentReportsTable({ rows, allRows, filters, riskFilter, onViewReport, onExplain, onExportPdf }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: "generated_at", direction: "desc" });
  const pageSize = 10;

  const sortedRows = useMemo(() => [...rows].sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];
    const leftValue = hasValue(left) ? Number(left) : String(left || "");
    const rightValue = hasValue(right) ? Number(right) : String(right || "");
    if (leftValue < rightValue) return sort.direction === "asc" ? -1 : 1;
    if (leftValue > rightValue) return sort.direction === "asc" ? 1 : -1;
    return String(a.student_name || "").localeCompare(String(b.student_name || ""));
  }), [rows, sort]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const pageRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [filters.search, filters.instructor, filters.semester, filters.classId, riskFilter, sort]);

  function updateSort(key) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "desc" ? "asc" : "desc" }));
  }

  return (
    <DashboardCard className="p-4 shadow-sm">
      <TableToolbar
        search={filters.search}
        onSearchChange={filters.setSearch}
        searchPlaceholder="Search students..."
        onClearFilters={() => filters.setSearch("")}
      />
      <div className="mt-4 max-h-[560px] overflow-auto rounded-lg border border-role-border dark:border-slate-800">
        <table className="min-w-[840px] w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-role-hover text-[11px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-950">
            <tr>
              {studentReportColumns.map((column) => <th key={column.key} className="px-3 py-2.5"><button type="button" className="inline-flex items-center gap-1 hover:text-role-primary" onClick={() => updateSort(column.key)}><HeaderIconLabel icon={column.icon} label={column.label} />{sort.key === column.key && <ChevronDown size={13} className={cn("transition", sort.direction === "asc" && "rotate-180")} />}</button></th>)}
              <th className="w-32 px-3 py-2.5 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-role-border dark:divide-slate-800">
            {pageRows.length === 0 && <tr><td className="px-3 py-8 text-center text-sm font-semibold text-slate-500" colSpan={studentReportColumns.length + 1}>No student reports match the current filters.</td></tr>}
            {pageRows.map((row) => {
              const status = studentReportStatus(row);
              return (
                <tr key={studentKey(row)} className="bg-white transition hover:bg-role-hover/60 dark:bg-slate-900 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2.5">
                    <p className="font-black text-slate-950 dark:text-white">{row.student_name || "Student"}</p>

                  </td>
                  <td className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300">{row.class_name || "Class"}</td>
                  <td className="px-3 py-2.5"><StatusIcon status={titleCase(row.risk_level || "Pending")} /></td>
                  <td className="px-3 py-2.5 font-black text-slate-950 dark:text-white">{probabilityPercent(studentPredictionConfidence(row), "Pending")}</td>
                  <td className="px-3 py-2.5">{formatDate(predictionTimestamp(row))}</td>
                  <td className="px-3 py-2.5"><StatusIcon status={status} type="intervention" /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <IconActionButton label="View Report" icon={Eye} onClick={() => onViewReport(row)} />
                      <IconActionButton label="Explain Prediction" icon={BrainCircuit} onClick={() => onExplain(row)} />
                      <IconActionButton label="Export PDF" icon={FileText} onClick={() => onExportPdf(row)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400"><SlidersHorizontal size={14} />{pageRows.length} / {sortedRows.length} shown - {allRows.length} total</p>
        <div className="flex items-center gap-2">
          <IconButton label="Previous page" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} />
          <span className="text-xs font-black text-slate-500">Page {page} of {pageCount}</span>
          <IconButton label="Next page" icon={ChevronRight} disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} />
        </div>
      </div>
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
    return (overview.weak_concepts || [])
      .filter((concept) => isBloomLevel(concept.concept))
      .filter((concept) => ["Needs Attention", "Needs Improvement"].includes(concept.mastery_status))
      .filter((concept) => !concept.affected_class_rows?.length || concept.affected_class_rows.some((row) => classIds.has(row.class_id)));
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
            <InstitutionPerformance comparisonData={comparisonData} reports={filters.filteredReports} />
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
  const [listModal, setListModal] = useState(null);
  const distribution = useMemo(() => riskDistributionFromReports(filters.filteredReports), [filters.filteredReports]);
  const filteredClassIds = useMemo(() => new Set(filters.filteredReports.map((row) => row.class_id)), [filters.filteredReports]);
  const studentReports = useMemo(
    () => enrichStudentReports(overview.student_reports?.length ? overview.student_reports : overview.explainable_predictions || [], reports),
    [overview.student_reports, overview.explainable_predictions, reports],
  );
  const filteredStudentReports = useMemo(
    () => studentReports.filter((row) => !row.class_id || filteredClassIds.has(row.class_id)),
    [studentReports, filteredClassIds],
  );
  const explainablePredictions = useMemo(
    () => filteredStudentReports.filter((row) => row.explanation || row.feature_importance?.length),
    [filteredStudentReports],
  );
  const highRiskStudents = useMemo(
    () => filteredStudentReports
      .filter((row) => String(row.risk_level || "").toLowerCase() === "high")
      .sort((a, b) => Number(studentPredictionConfidence(b) || 0) - Number(studentPredictionConfidence(a) || 0)),
    [filteredStudentReports],
  );
  const highRiskClasses = useMemo(
    () => filters.filteredReports
      .filter((row) => Number(row.high_risk || 0) > 0 || String(row.risk_level || "").toLowerCase() === "high")
      .sort(compareClassRisk),
    [filters.filteredReports],
  );
  const explanationForClass = (row) => buildClassExplanation(row, explainablePredictions);
  const predictionDate = overview.last_prediction_run || filters.filteredReports.find((row) => row.last_prediction_run)?.last_prediction_run;
  function showExplanation(prediction) {
    setListModal(null);
    setSelectedExplanation(prediction);
  }

  return (
    <div className="page-grid gap-8">
      <PageHeader
        eyebrow="Educational Intelligence"
        title={(
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>Academic Risk Predictions</span>
            <span className="rounded-full bg-role-hover px-2.5 py-1 text-xs font-black text-slate-500 dark:bg-slate-900 dark:text-slate-300">Powered by XGBoost</span>
          </span>
        )}
        description="Students classified from their latest learning signals."
        tone="role"
        action={<HeaderActions filters={filters} loading={loading} onRefresh={load} />}
      />
      <LoadingAndError loading={loading} error={error} data={data} />
      {data && (
        <>
          <section className="grid gap-4">
            <SectionHeader title="Prediction Overview" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="High" value={numberValue(distribution.high)} unit={studentLabel(distribution.high)} tone="red" icon={AlertTriangle} />
              <KpiCard label="Medium" value={numberValue(distribution.medium)} unit={studentLabel(distribution.medium)} tone="gold" icon={AlertCircle} />
              <KpiCard label="Low" value={numberValue(distribution.low)} unit={studentLabel(distribution.low)} tone="green" icon={CheckCircle2} />
              <KpiCard label="Date" value={formatDate(predictionDate)} icon={Calendar} />
            </div>
          </section>

          <section className="grid gap-4">
            <DashboardCard className="p-6 shadow-sm">
              <SectionHeader title="Prediction Distribution" />
              <div className="mt-6"><AcademicRiskDistribution distribution={distribution} /></div>
            </DashboardCard>
          </section>

          <section className="grid gap-4">
            <HighRiskResultsPanel
              students={highRiskStudents}
              classes={highRiskClasses}
              onViewAll={setListModal}
              onExplain={showExplanation}
              explanationForClass={explanationForClass}
            />
          </section>
          <PriorityStudentsModal rows={listModal === "students" ? highRiskStudents : null} onClose={() => setListModal(null)} onExplain={showExplanation} />
          <PriorityClassesModal rows={listModal === "classes" ? highRiskClasses : null} onClose={() => setListModal(null)} onExplain={showExplanation} explanationForClass={explanationForClass} />
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
  const [activeTab, setActiveTab] = useState("classes");
  const [riskFilter, setRiskFilter] = useState("all");
  const [selectedExplanation, setSelectedExplanation] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedStudentReport, setSelectedStudentReport] = useState(null);
  const [printReport, setPrintReport] = useState(null);
  const filteredClassIds = useMemo(() => new Set(filters.filteredReports.map((row) => row.class_id)), [filters.filteredReports]);
  const explainablePredictions = useMemo(
    () => (overview.explainable_predictions || []).filter((row) => !row.class_id || filteredClassIds.has(row.class_id)),
    [overview.explainable_predictions, filteredClassIds],
  );
  const studentReports = useMemo(
    () => enrichStudentReports(overview.student_reports?.length ? overview.student_reports : overview.explainable_predictions || [], reports),
    [overview.student_reports, overview.explainable_predictions, reports],
  );
  const filteredStudentReports = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return studentReports.filter((row) => {
      const risk = String(row.risk_level || "").toLowerCase();
      const matchesSearch = !query || [row.student_name, row.class_name, row.instructor, row.semester].some((value) => String(value || "").toLowerCase().includes(query));
      return matchesSearch
        && (filters.instructor === "all" || row.instructor === filters.instructor)
        && (filters.semester === "all" || row.semester === filters.semester)
        && (filters.classId === "all" || row.class_id === filters.classId)
        && (riskFilter === "all" || risk === riskFilter);
    });
  }, [studentReports, filters.search, filters.instructor, filters.semester, filters.classId, riskFilter]);
  const explanationForClass = (row) => buildClassExplanation(row, explainablePredictions);
  function exportClassPdf(targetRows) {
    const rows = (Array.isArray(targetRows) ? targetRows : [targetRows]).filter(Boolean);
    if (!rows.length) return;
    const classIds = new Set(rows.map((row) => row.class_id).filter(Boolean));
    setPrintReport({
      type: "class",
      report: rows[0],
      rows,
      students: studentReports.filter((student) => classIds.has(student.class_id)),
      generatedAt: new Date().toISOString(),
      defaultConfidence: overview.prediction_confidence,
    });
  }

  function exportStudentPdf(row) {
    if (!row) return;
    setPrintReport({
      type: "student",
      report: row,
      generatedAt: new Date().toISOString(),
    });
  }

  useEffect(() => {
    if (!printReport) return undefined;
    function clearPrintReport() {
      setPrintReport(null);
    }
    window.addEventListener("afterprint", clearPrintReport, { once: true });
    const printTimer = window.setTimeout(() => window.print(), 150);
    return () => {
      window.clearTimeout(printTimer);
      window.removeEventListener("afterprint", clearPrintReport);
    };
  }, [printReport]);

  return (
    <div className="page-grid gap-8">
      <ReportsHeader
        filters={filters}
        loading={loading}
        onRefresh={load}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        classCount={filters.filteredReports.length}
        studentCount={filteredStudentReports.length}
        riskFilter={riskFilter}
        setRiskFilter={setRiskFilter}
      />
      <LoadingAndError loading={loading} error={error} data={data} />
      {data && (
        <>
          {activeTab === "classes" ? (
            <ReportsTable
              rows={filters.filteredReports}
              allRows={reports}
              filters={filters}
              mode="reports"
              defaultConfidence={overview.prediction_confidence}
              onExplain={setSelectedExplanation}
              explanationForClass={explanationForClass}
              onViewReport={setSelectedReport}
              onExportPdf={exportClassPdf}
            />
          ) : (
            <StudentReportsTable
              rows={filteredStudentReports}
              allRows={studentReports}
              filters={filters}
              riskFilter={riskFilter}
              onViewReport={setSelectedStudentReport}
              onExplain={setSelectedExplanation}
              onExportPdf={exportStudentPdf}
            />
          )}
          <ReportDetailsModal
            report={selectedReport}
            defaultConfidence={overview.prediction_confidence}
            explanation={selectedReport ? explanationForClass(selectedReport) : null}
            onClose={() => setSelectedReport(null)}
            onExplain={setSelectedExplanation}
            onExportPdf={exportClassPdf}
          />
          <StudentReportModal
            report={selectedStudentReport}
            onClose={() => setSelectedStudentReport(null)}
            onExplain={setSelectedExplanation}
            onExportPdf={exportStudentPdf}
          />
          <PredictionReportPrintSurface printReport={printReport} />
          <ExplainPredictionModal prediction={selectedExplanation} onClose={() => setSelectedExplanation(null)} />
        </>
      )}
    </div>
  );
}
