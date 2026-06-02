import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartCard } from "../../components/ChartCard";
import { PageHeader } from "../../components/PageHeader";
import { ResponsiveTable, RiskBadge } from "../../components/ResponsiveTable";
import { classComparison, instructorSnapshot } from "../../data/mockData";

export function InstructorClassComparisonPage() {
  return (
    <div className="page-grid">
      <PageHeader eyebrow="Instructors" title="Instructors overview" description="Compare teaching load, engagement, and response health across instructors." tone="orange" />
      <ChartCard title="Class engagement comparison" subtitle="Higher is better">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={classComparison}>
            <XAxis dataKey="className" axisLine={false} tickLine={false} />
            <YAxis axisLine={false} tickLine={false} />
            <Tooltip />
            <Bar dataKey="engagement" fill="#8067dc" radius={[10, 10, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ResponsiveTable
        columns={[
          { key: "name", label: "Instructor" },
          { key: "classes", label: "Classes" },
          { key: "engagement", label: "Engagement", render: (row) => `${row.engagement}%` },
          { key: "responseRate", label: "Response rate", render: (row) => `${row.responseRate}%` },
          { key: "focus", label: "Focus class" },
        ]}
        rows={instructorSnapshot}
      />
      <ResponsiveTable
        columns={[
          { key: "instructor", label: "Instructor" },
          { key: "className", label: "Class" },
          { key: "engagement", label: "Engagement", render: (row) => `${row.engagement}%` },
          { key: "risk", label: "Risk", render: (row) => <RiskBadge level={row.risk} /> },
        ]}
        rows={classComparison}
      />
    </div>
  );
}
