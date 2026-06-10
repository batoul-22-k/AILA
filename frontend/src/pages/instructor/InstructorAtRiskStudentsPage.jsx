import { Activity, AlertTriangle, BarChart3, CheckCircle2, Mail, Radio, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getAtRiskStudents, listClasses, recalculateClassAnalytics } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { ResponsiveTable, RiskBadge } from "../../components/ResponsiveTable";
import { StatCard } from "../../components/StatCard";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";
import { average, formatPercent } from "../../utils/analytics";

function metricRows(student) {
  return [
    { metric: "Attendance", score: student.attendance_rate || 0 },
    { metric: "Participation", score: student.participation_rate || 0 },
    { metric: "Consistency", score: student.consistency_rate || 0 },
    { metric: "Engagement", score: student.engagement_score || 0 },
  ];
}

export function InstructorAtRiskStudentsPage() {
  const { currentWorkspace } = useCurrentWorkspace();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(currentWorkspace?.type === "instructor" ? currentWorkspace.class_id || "" : "");
  const [students, setStudents] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const selectedStudent = students.find((student) => `${student.class_id}:${student.student_id}` === selectedStudentId) || students[0] || null;
  const highRiskCount = students.filter((student) => student.risk_level === "High").length;
  const mediumRiskCount = students.filter((student) => student.risk_level === "Medium").length;
  const averageEngagement = average(students.map((student) => student.engagement_score));
  const tableRows = useMemo(
    () =>
      students.map((student) => ({
        ...student,
        id: `${student.class_id}:${student.student_id}`,
        attendance: `${Math.round(student.attendance_rate || 0)}%`,
        participation: `${Math.round(student.participation_rate || 0)}%`,
        engagement: `${Math.round(student.engagement_score || 0)}%`,
      })),
    [students],
  );

  async function loadPage(nextClassId = classId) {
    setLoading(true);
    try {
      const classResult = await listClasses().catch(() => []);
      const selectedClassId = nextClassId || classResult[0]?.class_id || "";
      setClasses(classResult);
      setClassId(selectedClassId);
      const result = await getAtRiskStudents({ class_id: selectedClassId || undefined });
      setStudents(result);
      setSelectedStudentId((current) => {
        if (result.some((student) => `${student.class_id}:${student.student_id}` === current)) return current;
        return result[0] ? `${result[0].class_id}:${result[0].student_id}` : "";
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage(classId);
  }, []);

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

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="At-risk students"
        title="Student support roster"
        description="Students flagged by attendance, participation, and weekly engagement analytics."
        tone="role"
        action={
          <Button type="button" variant="role" loading={refreshing} onClick={handleRecalculate}>
            <RefreshCw size={18} />
            Recalculate
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="At-risk students"
          value={students.length}
          icon={AlertTriangle}
          tone="red"
          detailPanel={{
            title: "Risk roster details",
            description: "Students currently below support thresholds.",
            items: [
              { label: "Total at risk", value: students.length },
              { label: "High risk", value: highRiskCount },
              { label: "Medium risk", value: mediumRiskCount },
            ],
          }}
        />
        <StatCard
          label="High risk"
          value={highRiskCount}
          icon={Activity}
          tone="red"
          detailPanel={{
            title: "High risk details",
            description: "Students needing the quickest instructor follow-up.",
            items: [
              { label: "High risk", value: highRiskCount },
              { label: "Class filter", value: classes.find((classDoc) => classDoc.class_id === classId)?.name || "All classes" },
            ],
          }}
        />
        <StatCard
          label="Medium risk"
          value={mediumRiskCount}
          icon={Radio}
          tone="gold"
          detailPanel={{
            title: "Medium risk details",
            description: "Students showing early engagement concerns.",
            items: [
              { label: "Medium risk", value: mediumRiskCount },
              { label: "Total at risk", value: students.length },
            ],
          }}
        />
        <StatCard
          label="Avg engagement"
          value={formatPercent(averageEngagement)}
          icon={BarChart3}
          tone="role"
          detailPanel={{
            title: "Engagement details",
            description: "Average engagement score for the filtered support roster.",
            items: [
              { label: "Avg engagement", value: formatPercent(averageEngagement) },
              { label: "Students reviewed", value: students.length },
            ],
          }}
        />
      </div>

      <DashboardCard>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Class filter</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose which class roster to review.</p>
          </div>
          <select className="adaptive-input focus-ring h-11 border px-3 text-sm sm:min-w-72" value={classId} onChange={(event) => loadPage(event.target.value)}>
            {classes.map((classDoc) => (
              <option key={classDoc.class_id} value={classDoc.class_id}>
                {classDoc.name}
              </option>
            ))}
          </select>
        </div>
      </DashboardCard>

      {loading && <DashboardCard>Loading at-risk student details...</DashboardCard>}
      {!loading && students.length === 0 && (
        <EmptyState
          title={classes.length === 0 ? "No classes yet" : "No at-risk students"}
          description={
            classes.length === 0
              ? "Risk analytics starts after classes and live sessions exist."
              : "No students are below the risk thresholds, or this class has no live sessions to measure yet."
          }
        />
      )}

      {!loading && students.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <DashboardCard>
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-role-soft text-role-primary">
                <Users size={20} />
              </span>
              <div>
                <h2 className="text-lg font-black text-slate-950 dark:text-white">Student names</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Select a student to view full participation details.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              {students.map((student) => {
                const id = `${student.class_id}:${student.student_id}`;
                const active = id === `${selectedStudent?.class_id}:${selectedStudent?.student_id}`;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedStudentId(id)}
                    className={`focus-ring rounded-[var(--role-radius)] border p-4 text-left transition ${
                      active ? "border-role-primary bg-role-hover shadow-soft" : "border-role-border bg-white hover:border-role-primary dark:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-black text-slate-950 dark:text-white">{student.student_name}</p>
                        <p className="mt-1 truncate text-sm font-semibold text-slate-500 dark:text-slate-400">{student.class_name}</p>
                      </div>
                      <RiskBadge level={student.risk_level} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-black">
                      <span className="rounded-lg bg-slate-50 px-2 py-2 dark:bg-slate-950">{formatPercent(student.attendance_rate)}</span>
                      <span className="rounded-lg bg-slate-50 px-2 py-2 dark:bg-slate-950">{formatPercent(student.participation_rate)}</span>
                      <span className="rounded-lg bg-slate-50 px-2 py-2 dark:bg-slate-950">{formatPercent(student.engagement_score)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </DashboardCard>

          {selectedStudent && (
            <DashboardCard>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Badge tone={selectedStudent.risk_level === "High" ? "red" : selectedStudent.risk_level === "Medium" ? "gold" : "green"}>
                    {selectedStudent.risk_level} risk
                  </Badge>
                  <h2 className="mt-3 text-2xl font-black text-slate-950 dark:text-white">{selectedStudent.student_name}</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{selectedStudent.class_name}</p>
                  {selectedStudent.email && (
                    <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                      <Mail size={16} />
                      {selectedStudent.email}
                    </p>
                  )}
                </div>
                <div className="rounded-[var(--role-radius)] bg-role-hover px-4 py-3 text-sm font-black text-role-primary">
                  {selectedStudent.risk_reason}
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Attendance</p>
                  <p className="mt-2 text-xl font-black text-slate-950 dark:text-white">
                    {selectedStudent.sessions_attended}/{selectedStudent.total_sessions} sessions
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Participation</p>
                  <p className="mt-2 text-xl font-black text-slate-950 dark:text-white">
                    {selectedStudent.questions_answered}/{selectedStudent.questions_presented} questions
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Consistency</p>
                  <p className="mt-2 text-xl font-black text-slate-950 dark:text-white">
                    {selectedStudent.sessions_with_answers}/{selectedStudent.sessions_attended} attended sessions
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Latest week</p>
                  <p className="mt-2 text-xl font-black text-slate-950 dark:text-white">{selectedStudent.week || "No data"}</p>
                </div>
              </div>
            </DashboardCard>
          )}
        </div>
      )}

      {selectedStudent && (
        <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <ChartCard title="Metric breakdown" subtitle={`${selectedStudent.student_name}'s latest weekly analytics`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metricRows(selectedStudent)}>
                <XAxis dataKey="metric" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="score" fill="#2B7886" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ResponsiveTable
            columns={[
              { key: "week", label: "Week" },
              { key: "attendance_rate", label: "Attendance", render: (row) => formatPercent(row.attendance_rate) },
              { key: "participation_rate", label: "Participation", render: (row) => formatPercent(row.participation_rate) },
              { key: "consistency_rate", label: "Consistency", render: (row) => formatPercent(row.consistency_rate) },
              { key: "engagement_score", label: "Engagement", render: (row) => formatPercent(row.engagement_score) },
            ]}
            rows={selectedStudent.weekly_history || []}
          />
        </div>
      )}

      {!loading && students.length > 0 && (
        <ResponsiveTable
          columns={[
            { key: "student_name", label: "Student" },
            { key: "class_name", label: "Class" },
            { key: "attendance", label: "Attendance" },
            { key: "participation", label: "Participation" },
            { key: "engagement", label: "Engagement" },
            { key: "risk_level", label: "Risk", render: (row) => <RiskBadge level={row.risk_level} /> },
            { key: "risk_reason", label: "Reason" },
          ]}
          rows={tableRows}
        />
      )}
    </div>
  );
}
