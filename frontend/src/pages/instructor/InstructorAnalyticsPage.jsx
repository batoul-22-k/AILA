import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartCard } from "../../components/ChartCard";
import { PageHeader } from "../../components/PageHeader";
import { ResponsiveTable, RiskBadge } from "../../components/ResponsiveTable";
import { engagementTrend, weakConcepts } from "../../data/mockData";

export function InstructorAnalyticsPage() {
  return (
    <div className="page-grid">
      <PageHeader eyebrow="Analytics" title="Classroom insight dashboard" description="Participation rate, answer distribution, weak concepts, and session outcomes." tone="violet" />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Participation rate" subtitle="Weekly live engagement">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={engagementTrend}>
              <XAxis dataKey="label" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} />
              <Tooltip />
              <Line type="monotone" dataKey="engagement" stroke="#16a3a3" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Weak concept ranking" subtitle="Lower score means more support needed">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weakConcepts}>
              <XAxis dataKey="concept" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="score" fill="#8067dc" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <ResponsiveTable
        columns={[
          { key: "session", label: "Session" },
          { key: "participation", label: "Participation" },
          { key: "risk", label: "Risk", render: (row) => <RiskBadge level={row.risk} /> },
          { key: "concept", label: "Weak concept" },
        ]}
        rows={[
          { session: "Morning AI", participation: "86%", risk: "Low", concept: "Recall" },
          { session: "Data Lab", participation: "61%", risk: "Medium", concept: "Precision" },
          { session: "ML Sprint", participation: "49%", risk: "High", concept: "Regression" },
        ]}
      />
    </div>
  );
}
