import { AlertTriangle, Building2, CheckCircle2, Eye, FilterX, Flag, MessageSquare, Minus, Search, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getAdminClassesMonitoring, getAtRiskStudents } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { TableSkeleton } from "../../components/LoadingSkeleton";
import { Modal } from "../../components/Modal";
import { PageHeader } from "../../components/PageHeader";

function percent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function riskBucket(level) {
  return level === "Critical" ? "High" : level || "Low";
}

function riskTone(level) {
  const bucket = riskBucket(level);
  if (bucket === "High") return "red";
  if (bucket === "Medium") return "gold";
  return "green";
}

function activityLabel(row) {
  if (!row.last_active_at || Number(row.recent_activity_score || 0) < 50) return "Inactive";
  if (Number(row.recent_activity_score || 0) < 70) return "Recently active";
  return "Active";
}

function formatDate(value) {
  if (!value) return "No activity";
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function classNameFor(row) {
  return row.class_name || row.class_id || "Unassigned";
}

export function AtRiskPage() {
  const [students, setStudents] = useState([]);
  const [classMonitoring, setClassMonitoring] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    classId: "",
    instructor: "",
    risk: "",
    activity: "",
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [studentRows, monitoringResult] = await Promise.all([
          getAtRiskStudents({ include_all: true }),
          getAdminClassesMonitoring().catch(() => ({ classes: [] })),
        ]);
        setStudents(studentRows || []);
        setClassMonitoring(monitoringResult.classes || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load student roster");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const classById = useMemo(() => {
    return new Map(classMonitoring.map((row) => [row.class_id, row]));
  }, [classMonitoring]);

  const rows = useMemo(() => {
    return students.map((student) => {
      const classInfo = classById.get(student.class_id);
      return {
        ...student,
        risk_bucket: riskBucket(student.risk_level),
        activity_status: activityLabel(student),
        instructor_names: classInfo?.instructor_names || [],
      };
    });
  }, [classById, students]);

  const filteredRows = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        !search ||
        row.student_name?.toLowerCase().includes(search) ||
        row.email?.toLowerCase().includes(search);
      const matchesClass = !filters.classId || row.class_id === filters.classId;
      const matchesInstructor = !filters.instructor || row.instructor_names.includes(filters.instructor);
      const matchesRisk = !filters.risk || row.risk_bucket === filters.risk;
      const matchesActivity = !filters.activity || row.activity_status === filters.activity;
      return matchesSearch && matchesClass && matchesInstructor && matchesRisk && matchesActivity;
    });
  }, [filters, rows]);

  const classOptions = useMemo(() => {
    return [...new Map(rows.map((row) => [row.class_id, classNameFor(row)])).entries()]
      .filter(([classId]) => classId)
      .sort((first, second) => first[1].localeCompare(second[1]));
  }, [rows]);

  const instructorOptions = useMemo(() => {
    return [...new Set(rows.flatMap((row) => row.instructor_names || []))].filter(Boolean).sort();
  }, [rows]);

  const stats = useMemo(() => {
    const uniqueStudentIds = new Set(rows.map((row) => row.student_id));
    return {
      total: uniqueStudentIds.size,
      high: rows.filter((row) => row.risk_bucket === "High").length,
      medium: rows.filter((row) => row.risk_bucket === "Medium").length,
      low: rows.filter((row) => row.risk_bucket === "Low").length,
      inactive: rows.filter((row) => row.activity_status === "Inactive").length,
    };
  }, [rows]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setFilters({ search: "", classId: "", instructor: "", risk: "", activity: "" });
  }

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Students"
        title="Students & Support Overview"
       
        tone="orange"
      />

      {error && <DashboardCard><p className="text-sm font-semibold text-red-600">{error}</p></DashboardCard>}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Total Students" value={stats.total} />
        <Kpi label="High Risk" value={stats.high} tone="red" />
        <Kpi label="Medium Risk" value={stats.medium} tone="gold" />
        <Kpi label="Low Risk" value={stats.low} tone="green" />
        <Kpi label="Inactive Students" value={stats.inactive} tone="slate" />
      </div>

      <DashboardCard className="p-3 shadow-none">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
            <input
              className="adaptive-input h-9 w-full border bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 placeholder:text-slate-400 dark:bg-slate-950 dark:text-slate-100"
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="Search by student name or email"
            />
          </label>
          <Select value={filters.classId} onChange={(value) => updateFilter("classId", value)} label="All classes">
            {classOptions.map(([classId, className]) => <option key={classId} value={classId}>{className}</option>)}
          </Select>
          <Select value={filters.instructor} onChange={(value) => updateFilter("instructor", value)} label="All instructors">
            {instructorOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
          <Select value={filters.risk} onChange={(value) => updateFilter("risk", value)} label="All risk levels">
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </Select>
          <Select value={filters.activity} onChange={(value) => updateFilter("activity", value)} label="All activity">
            <option value="Active">Active</option>
            <option value="Recently active">Recently active</option>
            <option value="Inactive">Inactive</option>
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
            <FilterX size={16} />
            Clear
          </Button>
        </div>
      </DashboardCard>

      <DashboardCard className="p-3 shadow-none">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-black text-slate-950 dark:text-white">Student roster</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{filteredRows.length} student-class records shown</p>
          </div>
        </div>

        {loading ? (
          <TableSkeleton className="mt-3" rows={8} columns={6} />
        ) : (
        <div className="mt-3 max-h-[68vh] overflow-auto rounded-lg border border-role-border dark:border-slate-800">
          <table className="min-w-[760px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 bg-role-hover text-xs font-black uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="border-b border-role-border px-3 py-2.5">Student</th>
                <th className="border-b border-role-border px-3 py-2.5">Class</th>
                <th className="border-b border-role-border px-3 py-2.5">Risk</th>
                <th className="border-b border-role-border px-3 py-2.5">Engagement</th>
                <th className="border-b border-role-border px-3 py-2.5">Last Activity</th>
                <th className="border-b border-role-border px-3 py-2.5 text-right">View</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-900">
              {filteredRows.length === 0 && (
                <tr>
                  <td className="px-3 py-8 text-center text-sm font-semibold text-slate-500" colSpan={6}>No students match these filters.</td>
                </tr>
              )}
              {filteredRows.map((row) => (
                <tr key={`${row.student_id}-${row.class_id}`} className="h-14 align-middle transition hover:bg-role-hover/70 dark:hover:bg-slate-800/50">
                  <td className="border-b border-role-border/80 px-3 py-2">
                    <p className="font-black text-slate-950 dark:text-white">{row.student_name}</p>
                    <p className="mt-0.5 text-xs font-semibold text-slate-500">{row.email || row.student_id}</p>
                  </td>
                  <td className="border-b border-role-border/80 px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">{classNameFor(row)}</td>
                  <td className="border-b border-role-border/80 px-3 py-2">
                    <Badge tone={riskTone(row.risk_level)} className="px-2 py-0.5">{row.risk_bucket}</Badge>
                  </td>
                  <td className="border-b border-role-border/80 px-3 py-2 font-black text-slate-800 dark:text-white">{percent(row.engagement_score)}</td>
                  <td className="border-b border-role-border/80 px-3 py-2">
                    <p className="font-semibold text-slate-700 dark:text-slate-200">{formatDate(row.last_active_at)}</p>
                    <p className="mt-0.5 text-xs font-bold text-slate-500">{row.activity_status}</p>
                  </td>
                  <td className="border-b border-role-border/80 px-3 py-2 text-right">
                    <button
                      type="button"
                      className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-full border border-role-border bg-white px-3 text-xs font-black text-slate-600 transition hover:border-role-primary hover:text-role-primary dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                      onClick={() => setSelectedStudent(row)}
                    >
                      <Eye size={14} />
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </DashboardCard>

      <StudentDetailsModal student={selectedStudent} onClose={() => setSelectedStudent(null)} />
    </div>
  );
}

function StudentDetailsModal({ student, onClose }) {
  if (!student) return null;
  const issues = detectedIssuesFor(student);
  const actionableIssueCount = issues.filter((item) => !item.neutral).length;
  const riskScore = overallRiskScore(student);
  const statusSummary = supportSummary(student, actionableIssueCount);
  const latestNote = latestInstructorNote(student);
  const interventionStatus = student.intervention_status || student.interventionStatus || student.support_status || inferredInterventionStatus(student);
  const healthCards = [
    healthCardFor(student, "Attendance", "attendance_rate"),
    healthCardFor(student, "Participation", "participation_rate"),
    healthCardFor(student, "Correctness", "correctness_rate"),
    healthCardFor(student, "Engagement", "engagement_score"),
  ];
  const instructorNames = student.instructor_names?.join(", ") || "Unassigned instructor";

  return (
    <Modal open={Boolean(student)} title="Student Support Details" onClose={onClose} panelClassName="max-h-[92vh] max-w-5xl overflow-y-auto">
      <div className="grid gap-4">
        <section className="rounded-xl border border-role-border bg-white p-4 shadow-soft dark:border-slate-800 dark:bg-slate-950/40">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-2xl font-black text-slate-950 dark:text-white">{student.student_name}</h3>
                <Badge tone={riskTone(student.risk_level)} className="px-2.5 py-1">{student.risk_bucket}</Badge>
              </div>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{statusSummary}</p>
              <div className="mt-4 grid gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
                <HeroDetail label="Class" value={classNameFor(student)} />
                <HeroDetail label="Instructor" value={instructorNames} />
                <HeroDetail label="Last activity" value={`${formatDate(student.last_active_at)} · ${student.activity_status}`} />
                <HeroDetail label="Intervention" value={interventionStatus} />
              </div>
            </div>
            <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-center dark:border-red-400/20 dark:bg-red-500/10">
              <p className="text-[11px] font-black uppercase tracking-wide text-red-600 dark:text-red-200">Overall risk</p>
              <p className="mt-1 text-4xl font-black text-red-700 dark:text-red-100">{riskScore}</p>
              <p className="mt-1 text-xs font-black text-red-600 dark:text-red-200">out of 100</p>
            </div>
          </div>
        </section>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {healthCards.map((card) => (
            <HealthCard key={card.label} card={card} />
          ))}
        </div>

        <section className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-xl border border-role-border p-4 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-role-primary">Detected Issues</p>
                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{actionableIssueCount} signal{actionableIssueCount === 1 ? "" : "s"} requiring review</p>
              </div>
              <Badge tone={actionableIssueCount ? riskTone(student.risk_level) : "green"} className="px-2 py-0.5">{actionableIssueCount ? "Action needed" : "Monitor"}</Badge>
            </div>
            <div className="mt-3 grid gap-2">
              {issues.map((item) => (
                <IssueRow key={`${item.issue}-${item.action}`} issue={item.issue} action={item.action} />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-role-border p-4 dark:border-slate-800">
            <p className="text-xs font-black uppercase tracking-wide text-role-primary">Instructor Context</p>
            <div className="mt-3 grid gap-3">
              <ContextBlock label="Latest note" value={latestNote} />
              <ContextBlock label="Intervention status" value={interventionStatus} />
              <div className="grid grid-cols-2 gap-2">
                <MiniFact label="Sessions" value={`${student.sessions_attended || 0}/${student.total_sessions || 0}`} />
                <MiniFact label="Answered" value={`${student.questions_answered || 0}/${student.questions_presented || 0}`} />
              </div>
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-role-border pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-end">
          <Link
            to={`/admin/classes?class=${student.class_id}`}
            className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-full border border-role-border bg-white px-4 text-sm font-black text-slate-700 transition hover:border-role-primary hover:text-role-primary dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            onClick={onClose}
          >
            <Building2 size={14} />
            View Full Analytics
          </Link>
          <a
            href={`mailto:?subject=${encodeURIComponent(`Student support follow-up: ${student.student_name}`)}&body=${encodeURIComponent(`${student.student_name} may need support in ${classNameFor(student)}.\nRisk: ${student.risk_bucket}\nSummary: ${statusSummary}`)}`}
            className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-full border border-role-border bg-white px-4 text-sm font-black text-slate-700 transition hover:border-role-primary hover:text-role-primary dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          >
            <MessageSquare size={15} />
            Notify Instructor
          </a>
          <Button type="button" variant="orange" className="h-10 rounded-full px-4 text-sm" onClick={onClose}>
            <Flag size={15} />
            Flag For Follow-up
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

function overallRiskScore(student) {
  const explicitScore = Number(student.risk_score);
  if (Number.isFinite(explicitScore) && explicitScore > 0) return Math.round(explicitScore);
  return Math.max(0, Math.min(100, Math.round(100 - Number(student.engagement_score || 0))));
}

function supportSummary(student, issueCount) {
  if (student.activity_status === "Inactive") return "Needs outreach now: activity has dropped and support signals should be confirmed with the instructor.";
  if (student.risk_bucket === "High") return "High-priority support case: review barriers and coordinate a near-term intervention.";
  if (student.risk_bucket === "Medium" || issueCount > 0) return "Monitor closely: one or more learning signals are below the healthy range.";
  return "No immediate intervention needed; keep this student on routine monitoring.";
}

function metricState(label, value) {
  const critical = label === "Engagement" ? 50 : 60;
  const warning = label === "Engagement" ? 70 : 75;
  if (Number(value || 0) < critical) return "Critical";
  if (Number(value || 0) < warning) return "Warning";
  return "Healthy";
}

function trendFor(student, key) {
  const history = student.weekly_history || [];
  if (history.length < 2) return "stable";
  const latest = Number(history[history.length - 1]?.[key] ?? student[key] ?? 0);
  const previous = Number(history[history.length - 2]?.[key] ?? latest);
  const delta = latest - previous;
  if (delta > 2) return "up";
  if (delta < -2) return "down";
  return "stable";
}

function healthCardFor(student, label, key) {
  const value = Number(student[key] || 0);
  return {
    label,
    value,
    state: metricState(label, value),
    trend: trendFor(student, key),
  };
}

function detectedIssuesFor(student) {
  const issues = [];
  if (student.risk_reason) {
    issues.push({
      issue: student.risk_reason,
      action: "Confirm the signal with the instructor and choose one concrete support step.",
    });
  }
  if (Number(student.attendance_rate || 0) < 60) {
    issues.push({
      issue: "Attendance is below the support threshold.",
      action: "Check attendance barriers and coordinate a quick follow-up.",
    });
  }
  if (Number(student.participation_rate || 0) < 60) {
    issues.push({
      issue: "Participation is low during live class activity.",
      action: "Ask the instructor to use lower-stakes prompts in the next session.",
    });
  }
  if (Number(student.correctness_rate || 0) < 60) {
    issues.push({
      issue: "Correctness suggests the student may be missing core concepts.",
      action: "Review weak answers and assign targeted reinforcement.",
    });
  }
  if (student.activity_status === "Inactive") {
    issues.push({
      issue: "Recent activity is inactive.",
      action: "Send a re-engagement message and verify class access.",
    });
  }
  return issues.length ? issues : [{
    issue: "No urgent support issue detected.",
    action: "Continue monitoring and revisit after the next class activity.",
    neutral: true,
  }];
}

function latestInstructorNote(student) {
  return student.latest_instructor_note
    || student.instructor_note
    || student.instructorNote
    || student.latest_note
    || student.note
    || "No instructor note recorded yet.";
}

function inferredInterventionStatus(student) {
  if (student.activity_status === "Inactive" || student.risk_bucket === "High") return "Needs admin follow-up";
  if (student.risk_bucket === "Medium") return "Instructor review recommended";
  return "Routine monitoring";
}

function stateClasses(state) {
  if (state === "Critical") return "border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-100";
  if (state === "Warning") return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100";
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-100";
}

function trendMeta(trend) {
  if (trend === "up") return { icon: TrendingUp, label: "Up", className: "text-emerald-600 dark:text-emerald-200" };
  if (trend === "down") return { icon: TrendingDown, label: "Down", className: "text-red-600 dark:text-red-200" };
  return { icon: Minus, label: "Stable", className: "text-slate-500 dark:text-slate-300" };
}

function HeroDetail({ label, value }) {
  return (
    <div className="rounded-lg bg-role-hover px-3 py-2 dark:bg-slate-900/70">
      <p className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function HealthCard({ card }) {
  const trend = trendMeta(card.trend);
  const TrendIcon = trend.icon;

  return (
    <div className={`rounded-xl border p-3 ${stateClasses(card.state)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide opacity-80">{card.label}</p>
          <p className="mt-1 text-2xl font-black">{percent(card.value)}</p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-xs font-black ${trend.className} dark:bg-slate-950/40`}>
          <TrendIcon size={13} />
          {trend.label}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm font-black">
        {card.state === "Healthy" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        {card.state}
      </div>
    </div>
  );
}

function IssueRow({ issue, action }) {
  return (
    <div className="grid gap-2 rounded-lg bg-role-hover p-3 dark:bg-slate-950/40 sm:grid-cols-[1fr_1.1fr]">
      <div>
        <p className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Issue</p>
        <p className="mt-1 text-sm font-black leading-6 text-slate-900 dark:text-white">{issue}</p>
      </div>
      <div>
        <p className="text-[11px] font-black uppercase tracking-wide text-role-primary">Recommended action</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200">{action}</p>
      </div>
    </div>
  );
}

function ContextBlock({ label, value }) {
  return (
    <div className="rounded-lg bg-role-hover p-3 dark:bg-slate-950/40">
      <p className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-6 text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  );
}

function MiniFact({ label, value }) {
  return (
    <div className="rounded-lg border border-role-border p-3 dark:border-slate-800">
      <p className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-black text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}

function Kpi({ label, value, tone = "role" }) {
  const classes = {
    red: "border-l-red-500",
    gold: "border-l-amber-500",
    green: "border-l-emerald-500",
    slate: "border-l-slate-400",
    role: "border-l-role-primary",
  };

  return (
    <DashboardCard className={`border-l-4 p-3 shadow-none ${classes[tone]}`}>
      <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{value}</p>
    </DashboardCard>
  );
}

function Select({ value, onChange, label, children }) {
  return (
    <select
      className="adaptive-input h-9 min-w-[9.5rem] max-w-full flex-1 border bg-white px-3 text-sm font-semibold text-slate-700 dark:bg-slate-950 dark:text-slate-100 sm:flex-none"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{label}</option>
      {children}
    </select>
  );
}
