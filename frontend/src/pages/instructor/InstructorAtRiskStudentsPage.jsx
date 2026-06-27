import { AlertCircle, CheckCircle2, ChevronDown, Info, RefreshCw, School } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getAtRiskStudents, listClasses, recalculateClassAnalytics } from "../../api/client";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { average } from "../../utils/analytics";

const riskLevels = ["Critical", "High", "Medium", "Low"];
const activityFilters = ["All", "Today", "Last 7 days", "Last 30 days", "Inactive"];
const defaultColumnFilters = {
  attendance: "All",
  correctness: "All",
  engagement: "All",
  risk: "All",
  lastActive: "All",
};

const metricFilterOptions = ["All", "Low", "Medium", "High"];
const perfectMetricLabels = new Set(["Attendance", "Correctness", "Participation", "Engagement", "Response consistency"]);

function clampPercent(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function parsePercentValue(value) {
  const numeric = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(numeric) ? clampPercent(numeric) : null;
}

function SuccessMetric({ className = "text-sm", iconSize = 15 }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-100 ${className}`}
      title="Perfect score"
      aria-label="100%. Perfect score"
    >
      <CheckCircle2 size={iconSize} className="text-emerald-500 dark:text-emerald-300" />
      <span>100%</span>
    </span>
  );
}

function ZeroMetric({ className = "text-sm", iconSize = 15 }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-100 ${className}`}
      title="No activity recorded"
      aria-label="0%. No activity recorded"
    >
      <AlertCircle size={iconSize} className="text-red-400 dark:text-red-300" />
      <span>0%</span>
    </span>
  );
}

export function calculateEngagementScore({ attendance, participation, correctness, consistency, recentActivity }) {
  return clampPercent(
    (0.35 * clampPercent(attendance))
    + (0.25 * clampPercent(participation))
    + (0.25 * clampPercent(correctness))
    + (0.10 * clampPercent(consistency))
    + (0.05 * clampPercent(recentActivity)),
  );
}

export function calculateRiskScore(learningHealthScore) {
  return clampPercent(100 - clampPercent(learningHealthScore));
}

export function getRiskLevel(riskScore) {
  const score = clampPercent(riskScore);
  if (score <= 30) return "Low";
  if (score <= 60) return "Medium";
  if (score <= 80) return "High";
  return "Critical";
}

export function getRiskReason(student) {
  if (student.engagement >= 70) return "Stable";
  const previous = student.previousEngagement ?? student.weekly_history?.at?.(-2)?.engagement_score;
  if (Number.isFinite(Number(previous)) && student.engagement <= Number(previous) - 10) return "Declining trend";
  if (student.attendance < 50) return "Low attendance";
  if (student.correctness < 60) return "Weak correctness";
  if (student.recentActivity < 50) return "Inactive recently";
  if (student.participation < 60 || student.consistency < 60) return "Low engagement";
  return "Low engagement";
}

export function getRiskBadgeClass(level) {
  if (level === "Critical") return "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-100";
  if (level === "High") return "bg-orange-100 text-orange-800 dark:bg-orange-400/15 dark:text-orange-100";
  if (level === "Medium") return "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-100";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-100";
}

function formatLastActive(value) {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getTimeValue(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function daysSince(value) {
  const time = getTimeValue(value);
  if (!time) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - time) / 86400000);
}

function normalizeStudent(student) {
  const attendance = clampPercent(student.attendance_rate);
  const participation = clampPercent(student.participation_rate);
  const correctness = clampPercent(student.correctness_rate);
  const consistency = clampPercent(student.consistency_rate);
  const recentActivity = clampPercent(student.recent_activity_score);
  const engagement = clampPercent(student.engagement_score)
    || calculateEngagementScore({ attendance, participation, correctness, consistency, recentActivity });
  const riskScore = clampPercent(student.risk_score) || calculateRiskScore(engagement);
  const normalized = {
    ...student,
    id: `${student.class_id}:${student.student_id}`,
    attendance,
    participation,
    correctness,
    consistency,
    recentActivity,
    engagement,
    riskScore,
    risk_level: student.risk_level || getRiskLevel(riskScore),
    lastActive: student.last_active_at,
  };
  return {
    ...normalized,
    risk_reason: getRiskReason(normalized),
  };
}

function latestDateValue(values) {
  return values
    .map((value) => (value ? new Date(value).getTime() : 0))
    .filter((value) => Number.isFinite(value))
    .reduce((latest, value) => Math.max(latest, value), 0);
}

export function aggregateStudentMetricsAcrossClasses(records) {
  const normalizedRecords = records.map(normalizeStudent);
  const byStudent = new Map();
  for (const record of normalizedRecords) {
    const group = byStudent.get(record.student_id) || [];
    group.push(record);
    byStudent.set(record.student_id, group);
  }

  return [...byStudent.values()].map((studentRecords) => {
    const first = studentRecords[0];
    const attendance = average(studentRecords.map((student) => student.attendance));
    const participation = average(studentRecords.map((student) => student.participation));
    const correctness = average(studentRecords.map((student) => student.correctness));
    const consistency = average(studentRecords.map((student) => student.consistency));
    const recentActivity = average(studentRecords.map((student) => student.recentActivity));
    const engagement = average(studentRecords.map((student) => student.engagement));
    const riskScore = calculateRiskScore(engagement);
    const lastActiveTime = latestDateValue(studentRecords.map((student) => student.lastActive));
    const previousEngagement = average(
      studentRecords
        .map((student) => student.weekly_history?.at?.(-2)?.engagement_score)
        .filter((value) => Number.isFinite(Number(value))),
    );
    const overall = {
      ...first,
      id: `overall:${first.student_id}`,
      class_id: "all",
      class_name: "All Classes",
      classesCount: new Set(studentRecords.map((student) => student.class_id)).size,
      classNames: [...new Set(studentRecords.map((student) => student.class_name).filter(Boolean))],
      attendance,
      participation,
      correctness,
      consistency,
      recentActivity,
      engagement,
      riskScore,
      risk_level: getRiskLevel(riskScore),
      isOverallProfile: true,
      lastActive: lastActiveTime ? new Date(lastActiveTime).toISOString() : null,
      sessions_attended: studentRecords.reduce((sum, student) => sum + Number(student.sessions_attended || 0), 0),
      total_sessions: studentRecords.reduce((sum, student) => sum + Number(student.total_sessions || 0), 0),
      questions_answered: studentRecords.reduce((sum, student) => sum + Number(student.questions_answered || 0), 0),
      questions_presented: studentRecords.reduce((sum, student) => sum + Number(student.questions_presented || 0), 0),
      previousEngagement,
      sourceRecords: studentRecords,
    };
    return {
      ...overall,
      risk_reason: getRiskReason(overall),
    };
  });
}

function MetricBar({ value, tone = "role" }) {
  const percent = clampPercent(value);
  const barClass = {
    green: "bg-emerald-300",
    gold: "bg-amber-300",
    orange: "bg-orange-300",
    red: "bg-red-300",
    role: "bg-[#6EADB5]",
  }[tone];
  if (percent >= 100) {
    return (
      <div className="flex min-w-28 items-center">
        <SuccessMetric />
      </div>
    );
  }
  if (percent <= 0) {
    return (
      <div className="flex min-w-28 items-center">
        <ZeroMetric />
      </div>
    );
  }
  return (
    <div className="grid min-w-28 grid-cols-[2.4rem_minmax(4rem,1fr)] items-center gap-2">
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{percent}%</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function InfoTip({ label, text }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent text-slate-400 transition hover:border-[#E6ECEF] hover:bg-[#F7FAFA] hover:text-role-primary dark:hover:bg-slate-900"
        aria-label={label}
      >
        <Info size={14} />
      </button>
      <span className="pointer-events-none absolute right-0 top-9 z-30 w-72 translate-y-1 rounded-lg border border-role-border bg-white p-3 text-left text-xs font-semibold leading-5 text-slate-500 opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        {text}
      </span>
    </span>
  );
}

function controlClass(className = "") {
  return `adaptive-input focus-ring h-10 rounded-lg border border-[#E6ECEF] bg-white px-3 text-sm text-slate-700 shadow-none placeholder:text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 ${className}`;
}

function RiskCompact({ row }) {
  return (
    <div className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getRiskBadgeClass(row.risk_level)}`}>{row.risk_level}</span>
      <span className="text-slate-300 dark:text-slate-600">·</span>
      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{row.riskScore}</span>
    </div>
  );
}

function AtRiskIndicator({ count, total }) {
  const hasRisk = count > 0;
  return (
    <div className="flex items-center">
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${
          hasRisk
            ? "border-red-100 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-100"
            : "border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100"
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${hasRisk ? "bg-red-400" : "bg-emerald-400"}`} />
        <span>{count} at-risk {count === 1 ? "student" : "students"}</span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span className="font-medium text-slate-500 dark:text-slate-300">{total} total</span>
      </span>
    </div>
  );
}

function classesLabel(student, isAllClasses) {
  if (!isAllClasses) return student.class_name || "Class";
  const count = student.classesCount || 0;
  return `${count} class${count === 1 ? "" : "es"}`;
}

function latestSessionLabel(student) {
  return formatLastActive(student.latest_session_at || student.last_session_at || student.lastActive);
}

function trendLabel(student) {
  const previous = Number(student.previousEngagement);
  if (!Number.isFinite(previous)) return "No trend";
  const delta = student.engagement - previous;
  if (delta >= 5) return `+${Math.round(delta)} engagement`;
  if (delta <= -5) return `${Math.round(delta)} engagement`;
  return "Stable trend";
}

function matchesMetricFilter(value, filter) {
  if (filter === "Low") return value < 60;
  if (filter === "Medium") return value >= 60 && value < 80;
  if (filter === "High") return value >= 80;
  return true;
}

function matchesActivityFilter(student, filter) {
  const inactive = daysSince(student.lastActive) > 30 || student.recentActivity < 50;
  const activeDays = daysSince(student.lastActive);
  return (
    filter === "All"
    || (filter === "Today" && activeDays === 0)
    || (filter === "Last 7 days" && activeDays <= 7)
    || (filter === "Last 30 days" && activeDays <= 30)
    || (filter === "Inactive" && inactive)
  );
}

export function filterStudents(students, { search, columnFilters }) {
  const query = search.trim().toLowerCase();
  return students.filter((student) => {
    const matchesSearch = !query
      || student.student_name?.toLowerCase().includes(query)
      || student.class_name?.toLowerCase().includes(query)
      || student.classNames?.join(" ").toLowerCase().includes(query);
    const matchesRisk = columnFilters.risk === "All" || student.risk_level === columnFilters.risk;
    const matchesActivity = matchesActivityFilter(student, columnFilters.lastActive);
    const matchesAttendance = matchesMetricFilter(student.attendance, columnFilters.attendance);
    const matchesCorrectness = matchesMetricFilter(student.correctness, columnFilters.correctness);
    const matchesEngagement = matchesMetricFilter(student.engagement, columnFilters.engagement);
    return matchesSearch && matchesRisk && matchesActivity && matchesAttendance && matchesCorrectness && matchesEngagement;
  });
}

function getSortValue(student, key) {
  if (key === "attendance") return student.attendance;
  if (key === "correctness") return student.correctness;
  if (key === "engagement") return student.engagement;
  if (key === "lastActive") return getTimeValue(student.lastActive);
  return student.riskScore;
}

export function sortStudents(students, sortConfig = { key: "risk", direction: "desc" }) {
  return [...students].sort((first, second) => {
    const firstValue = getSortValue(first, sortConfig.key);
    const secondValue = getSortValue(second, sortConfig.key);
    const direction = sortConfig.direction === "asc" ? 1 : -1;
    const comparison = (firstValue - secondValue) * direction;
    if (comparison !== 0) return comparison;
    return first.attendance - second.attendance;
  });
}

function DetailValue({ label, value, detail }) {
  const percent = parsePercentValue(value);
  const isTrackedMetric = perfectMetricLabels.has(label) && percent !== null;
  if (isTrackedMetric && percent >= 100) {
    return (
      <>
        <SuccessMetric />
        {detail && <span className="ml-1 font-medium text-slate-500 dark:text-slate-400">· {detail}</span>}
      </>
    );
  }
  if (isTrackedMetric && percent <= 0) {
    return (
      <>
        <ZeroMetric />
        {detail && <span className="ml-1 font-medium text-slate-500 dark:text-slate-400">· {detail}</span>}
      </>
    );
  }
  if (isTrackedMetric) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <span className="block h-full rounded-full bg-[#6EADB5]" style={{ width: `${percent}%` }} />
        </span>
        <span>{percent}%</span>
        {detail && <span className="font-medium text-slate-500 dark:text-slate-400">· {detail}</span>}
      </span>
    );
  }
  return (
    <>
      {value}
      {detail && <span className="ml-1 font-medium text-slate-500 dark:text-slate-400">· {detail}</span>}
    </>
  );
}

function DetailMetric({ label, value, detail }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-baseline">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-sm font-semibold text-slate-900 dark:text-white">
        <DetailValue label={label} value={value} detail={detail} />
      </p>
    </div>
  );
}

function HeaderFilter({
  label,
  columnKey,
  options = metricFilterOptions,
  filterValue,
  sortConfig,
  open,
  active,
  onOpen,
  onSort,
  onFilter,
}) {
  const sorted = sortConfig.key === columnKey;
  const iconActive = active || sorted;

  return (
    <div className="relative inline-flex" data-header-filter>
      <button
        type="button"
        className="group inline-flex items-center gap-1 rounded-md py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 transition hover:text-[#2F7F8A]"
        onClick={(event) => {
          event.stopPropagation();
          onOpen(open ? "" : columnKey);
        }}
      >
        {label}
        {active && <span className="h-1.5 w-1.5 rounded-full bg-[#2F7F8A]" />}
        <ChevronDown
          size={13}
          className={`transition ${iconActive ? "text-[#2F7F8A] opacity-100" : "text-slate-400 opacity-60 group-hover:opacity-100"}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-30 w-44 rounded-lg border border-[#E6ECEF] bg-white p-2 normal-case tracking-normal shadow-lift dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            className="block w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-[#F7FAFA] dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => onSort(columnKey, "asc")}
          >
            Sort Ascending
          </button>
          <button
            type="button"
            className="block w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-[#F7FAFA] dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => onSort(columnKey, "desc")}
          >
            Sort Descending
          </button>
          <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className={`block w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold transition ${
                filterValue === option
                  ? "bg-[#EEF8F8] text-[#2F7F8A]"
                  : "text-slate-600 hover:bg-[#F7FAFA] dark:text-slate-200 dark:hover:bg-slate-800"
              }`}
              onClick={() => onFilter(columnKey, option)}
            >
              {option === "All" ? "All" : option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClassHeaderFilter({ classes, classId, open, onOpen, onFilter }) {
  const active = classId !== "";
  const selectedClass = classes.find((classDoc) => classDoc.class_id === classId);
  const options = [{ class_id: "", name: "All Classes" }, ...classes];

  return (
    <div className="relative inline-flex" data-header-filter>
      <button
        type="button"
        className="group inline-flex items-center gap-1 rounded-md py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 transition hover:text-[#2F7F8A]"
        onClick={(event) => {
          event.stopPropagation();
          onOpen(open ? "" : "class");
        }}
        aria-label="Filter classes"
      >
        Classes
        {active && <span className="h-1.5 w-1.5 rounded-full bg-[#2F7F8A]" />}
        <School
          size={13}
          className={`transition ${active || open ? "text-[#2F7F8A] opacity-100" : "text-slate-400 opacity-60 group-hover:opacity-100"}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-30 max-h-72 w-52 overflow-y-auto rounded-lg border border-[#E6ECEF] bg-white p-2 normal-case tracking-normal shadow-lift dark:border-slate-800 dark:bg-slate-900">
          {options.map((option) => {
            const selected = option.class_id === classId;
            return (
              <button
                key={option.class_id || "all-classes"}
                type="button"
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs font-semibold transition ${
                  selected
                    ? "bg-[#EEF8F8] text-[#2F7F8A]"
                    : "text-slate-600 hover:bg-[#F7FAFA] dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
                onClick={() => onFilter(option.class_id)}
              >
                <span className="truncate">{option.name}</span>
                {selected && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2F7F8A]" />}
              </button>
            );
          })}
          {/* {active && selectedClass && (
            <p className="mt-1 truncate px-2 py-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
              Showing {selectedClass.name}
            </p>
          )} */}
        </div>
      )}
    </div>
  );
}

function RiskTable({
  students,
  classes,
  classId,
  isAllClasses,
  expandedStudentId,
  sortConfig,
  columnFilters,
  openHeaderMenu,
  onToggleStudent,
  onHeaderMenu,
  onHeaderSort,
  onHeaderFilter,
  onClassFilter,
}) {
  const filterControls = {
    attendance: { label: "Attendance", options: metricFilterOptions },
    correctness: { label: "Correctness", options: metricFilterOptions },
    engagement: { label: "Engagement", options: metricFilterOptions },
    risk: { label: "Risk", options: ["All", ...riskLevels] },
    lastActive: { label: "Last Active", options: activityFilters },
  };

  function renderHeader(columnKey) {
    const control = filterControls[columnKey];
    const active = columnFilters[columnKey] !== "All";
    return (
      <HeaderFilter
        label={control.label}
        columnKey={columnKey}
        options={control.options}
        filterValue={columnFilters[columnKey]}
        sortConfig={sortConfig}
        open={openHeaderMenu === columnKey}
        active={active}
        onOpen={onHeaderMenu}
        onSort={onHeaderSort}
        onFilter={onHeaderFilter}
      />
    );
  }

  return (
    <div className="overflow-visible rounded-lg border border-[#E6ECEF] bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="hidden overflow-x-auto overflow-y-visible lg:block">
        <table className="w-full min-w-[920px] border-collapse text-left text-sm">
          <thead className="bg-[#F7FAFA] text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Student</th>
              <th className="px-4 py-2.5 font-semibold">
                <ClassHeaderFilter
                  classes={classes}
                  classId={classId}
                  open={openHeaderMenu === "class"}
                  onOpen={onHeaderMenu}
                  onFilter={onClassFilter}
                />
              </th>
              <th className="px-4 py-2.5 font-semibold">{renderHeader("attendance")}</th>
              <th className="px-4 py-2.5 font-semibold">{renderHeader("correctness")}</th>
              <th className="px-4 py-2.5 font-semibold">{renderHeader("engagement")}</th>
              <th className="px-4 py-2.5 font-semibold">
                <span className="inline-flex items-center gap-1">
                  {renderHeader("risk")}
                  <InfoTip label="Risk formula" text="Risk is 100 minus engagement. Engagement combines attendance, participation, correctness, response consistency, and recent activity." />
                </span>
              </th>
              <th className="px-4 py-2.5 font-semibold">{renderHeader("lastActive")}</th>
              <th className="px-4 py-2.5 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {students.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-400" colSpan={8}>
                  No students found.
                </td>
              </tr>
            )}
            {students.map((student) => {
              const expanded = expandedStudentId === student.id;
              return (
                <Fragment key={student.id}>
                  <tr
                    className="cursor-pointer transition hover:bg-[#F7FAFA] dark:hover:bg-slate-800/60"
                    onClick={() => onToggleStudent(student.id)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#172B36] dark:text-white">{student.student_name}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{classesLabel(student, isAllClasses)}</td>
                    <td className="px-4 py-3"><MetricBar value={student.attendance} /></td>
                    <td className="px-4 py-3"><MetricBar value={student.correctness} /></td>
                    <td className="px-4 py-3"><MetricBar value={student.engagement} /></td>
                    <td className="px-4 py-3"><RiskCompact row={student} /></td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatLastActive(student.lastActive)}</td>
                    <td className="px-4 py-3">
                      <Button type="button" size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onToggleStudent(student.id); }}>
                        {expanded ? "Hide" : "View"}
                      </Button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td className="bg-[#F7FAFA] px-4 py-3 dark:bg-slate-950/50" colSpan={8}>
                        <ExpandedStudentDetails student={student} isAllClasses={isAllClasses} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid divide-y divide-slate-100 dark:divide-slate-800 lg:hidden">
        <div className="flex items-center justify-between gap-3 p-4">
          <ClassHeaderFilter
            classes={classes}
            classId={classId}
            open={openHeaderMenu === "class"}
            onOpen={onHeaderMenu}
            onFilter={onClassFilter}
          />
          <span className="text-xs font-semibold text-slate-400">{students.length} shown</span>
        </div>
        {students.length === 0 && (
          <div className="p-6 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
            No students found.
          </div>
        )}
        {students.map((student) => {
          const expanded = expandedStudentId === student.id;
          return (
            <div key={student.id} className="p-4">
              <button type="button" className="w-full text-left" onClick={() => onToggleStudent(student.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950 dark:text-white">{student.student_name}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{classesLabel(student, isAllClasses)}</p>
                  </div>
                  <RiskCompact row={student} />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <MetricBar value={student.attendance} />
                  <MetricBar value={student.engagement} />
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-500">Correctness</span>
                  <MetricBar value={student.correctness} />
                </div>
              </button>
              <div className="mt-3 flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => onToggleStudent(student.id)}>
                  {expanded ? "Hide" : "View"}
                </Button>
              </div>
              {expanded && <div className="mt-4"><ExpandedStudentDetails student={student} isAllClasses={isAllClasses} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExpandedStudentDetails({ student, isAllClasses }) {
  return (
    <div className="rounded-lg border border-[#E6ECEF] bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="grid gap-x-8 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
        <DetailMetric label="Participation" value={`${student.participation}%`} detail={`${student.questions_answered || 0}/${student.questions_presented || 0} questions`} />
        <DetailMetric label="Response consistency" value={`${student.consistency}%`} />
        <DetailMetric label="Recent activity" value={`${student.recentActivity}%`} />
        <DetailMetric label="Reason" value={student.risk_reason} />
        <DetailMetric label="Classes included" value={isAllClasses ? classesLabel(student, true) : student.class_name || "1 class"} detail={student.classNames?.join(", ")} />
        <DetailMetric label="Latest session" value={latestSessionLabel(student)} detail={trendLabel(student)} />
      </div>
    </div>
  );
}

export function InstructorAtRiskStudentsPage() {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState([]);
  const [expandedStudentId, setExpandedStudentId] = useState("");
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState(defaultColumnFilters);
  const [sortConfig, setSortConfig] = useState({ key: "risk", direction: "desc" });
  const [openHeaderMenu, setOpenHeaderMenu] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isAllClasses = classId === "";

  const normalizedStudents = useMemo(
    () => {
      const rows = isAllClasses ? aggregateStudentMetricsAcrossClasses(students) : students.map(normalizeStudent);
      return sortStudents(rows, { key: "risk", direction: "desc" });
    },
    [isAllClasses, students],
  );
  const filteredStudents = useMemo(
    () => sortStudents(filterStudents(normalizedStudents, { search, columnFilters }), sortConfig),
    [columnFilters, normalizedStudents, search, sortConfig],
  );
  const averageAttendance = average(normalizedStudents.map((student) => student.attendance));
  const averageParticipation = average(normalizedStudents.map((student) => student.participation));
  const averageEngagement = average(normalizedStudents.map((student) => student.engagement));
  const riskDistribution = riskLevels.map((level) => ({
    level,
    count: normalizedStudents.filter((student) => student.risk_level === level).length,
  }));
  const atRiskCount = normalizedStudents.filter((student) => student.risk_level !== "Low").length;

  async function loadPage(nextClassId = classId) {
    setLoading(true);
    try {
      const classResult = await listClasses().catch(() => []);
      const selectedClassId = nextClassId || "";
      setClasses(classResult);
      setClassId(selectedClassId);
      const result = await getAtRiskStudents({ class_id: selectedClassId || undefined, include_all: true });
      setStudents(result);
      setExpandedStudentId((current) => {
        const normalized = (selectedClassId ? result.map(normalizeStudent) : aggregateStudentMetricsAcrossClasses(result))
          .sort((first, second) => second.riskScore - first.riskScore || first.attendance - second.attendance);
        if (normalized.some((student) => student.id === current)) return current;
        return "";
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage(classId);
  }, []);

  useEffect(() => {
    function closeHeaderMenu(event) {
      if (!openHeaderMenu) return;
      if (event.target?.closest?.("[data-header-filter]")) return;
      setOpenHeaderMenu("");
    }

    document.addEventListener("mousedown", closeHeaderMenu);
    return () => document.removeEventListener("mousedown", closeHeaderMenu);
  }, [openHeaderMenu]);

  async function handleRecalculate() {
    setRefreshing(true);
    try {
      const targetClassIds = classId ? [classId] : classes.map((classDoc) => classDoc.class_id);
      await Promise.all(targetClassIds.map((targetClassId) => recalculateClassAnalytics(targetClassId).catch(() => null)));
      await loadPage(classId);
    } finally {
      setRefreshing(false);
    }
  }

  function handleClassFilter(nextClassId) {
    setClassId(nextClassId || "");
    setExpandedStudentId("");
    setOpenHeaderMenu("");
    void loadPage(nextClassId);
  }

  function handleHeaderSort(columnKey, direction) {
    setSortConfig({ key: columnKey, direction });
    setOpenHeaderMenu("");
  }

  function handleHeaderFilter(columnKey, value) {
    setColumnFilters((current) => ({ ...current, [columnKey]: value }));
    setOpenHeaderMenu("");
  }

  function toggleStudent(studentId) {
    setExpandedStudentId((current) => (current === studentId ? "" : studentId));
  }

  return (
    <div className="page-grid">
      <PageHeader
        title="At-Risk Students"
        description="Identify students who may need support."
        tone="role"
        action={
          <div className="flex items-center gap-2">
            <InfoTip label="Risk formula" text="Risk is 100 minus engagement. Engagement combines attendance, participation, correctness, response consistency, and recent activity." />
            <Button type="button" variant="role" loading={refreshing} onClick={handleRecalculate}>
              <RefreshCw size={18} />
              Recalculate
            </Button>
          </div>
        }
      />

      {!loading && classes.length > 0 && (
        <AtRiskIndicator count={atRiskCount} total={normalizedStudents.length} />
      )}

      {loading && <DashboardCard>Loading students...</DashboardCard>}
      {!loading && classes.length === 0 && (
        <EmptyState
          title="No classes yet"
          description="Classes will appear here after they are created."
        />
      )}

      {!loading && classes.length > 0 && (
        <>
          <DashboardCard className="grid gap-3 border-[#E6ECEF] bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <label className="min-w-56 flex-1">
                <input
                  className={controlClass("w-full")}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search student..."
                />
              </label>
            </div>

            <RiskTable
              students={filteredStudents}
              classes={classes}
              classId={classId}
              isAllClasses={isAllClasses}
              expandedStudentId={expandedStudentId}
              sortConfig={sortConfig}
              columnFilters={columnFilters}
              openHeaderMenu={openHeaderMenu}
              onToggleStudent={toggleStudent}
              onHeaderMenu={setOpenHeaderMenu}
              onHeaderSort={handleHeaderSort}
              onHeaderFilter={handleHeaderFilter}
              onClassFilter={handleClassFilter}
            />
          </DashboardCard>

          {normalizedStudents.length > 0 && (
            <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
              <DashboardCard className="border-[#E6ECEF] bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-[#172B36] dark:text-white">Learning Signals</h2>
                <div className="mt-3 h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { metric: "Attendance", score: averageAttendance },
                      { metric: "Participation", score: averageParticipation },
                      { metric: "Engagement", score: averageEngagement },
                    ]}>
                      <XAxis dataKey="metric" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} domain={[0, 100]} />
                      <Tooltip />
                      <Bar dataKey="score" fill="#8BC3C7" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </DashboardCard>
              <DashboardCard className="border-[#E6ECEF] bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-[#172B36] dark:text-white">Risk Distribution</h2>
                <div className="mt-3 h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={riskDistribution}>
                      <XAxis dataKey="level" axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#9CC9CD" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </DashboardCard>
            </div>
          )}
        </>
      )}
    </div>
  );
}
