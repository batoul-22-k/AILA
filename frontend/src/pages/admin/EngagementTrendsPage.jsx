import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { engagementTrend, heatmapRows } from "../../data/mockData";

function colorFor(value) {
  if (value >= 80) return "bg-emerald-500";
  if (value >= 65) return "bg-amber-400";
  return "bg-coral";
}

export function EngagementTrendsPage() {
  return (
    <div className="page-grid">
      <PageHeader eyebrow="Trends" title="Engagement trends and heatmap" description="See how engagement changes by week and class." tone="orange" />
      <ChartCard title="Institution trend" subtitle="Engagement and response volume">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={engagementTrend}>
            <XAxis dataKey="label" axisLine={false} tickLine={false} />
            <YAxis axisLine={false} tickLine={false} />
            <Tooltip />
            <Line type="monotone" dataKey="engagement" stroke="#16a3a3" strokeWidth={3} dot={false} />
            <Line type="monotone" dataKey="responses" stroke="#8067dc" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <DashboardCard>
        <h2 className="text-lg font-black text-slate-950 dark:text-white">Engagement heatmap</h2>
        <div className="mt-4 grid gap-3">
          {heatmapRows.map(([name, ...values]) => (
            <div key={name} className="grid grid-cols-[110px_1fr] items-center gap-3">
              <span className="text-sm font-black text-slate-700 dark:text-slate-200">{name}</span>
              <div className="grid grid-cols-4 gap-2">
                {values.map((value, index) => (
                  <div key={`${name}-${index}`} className={`${colorFor(value)} rounded-lg px-2 py-3 text-center text-xs font-black text-white`}>
                    {value}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DashboardCard>
    </div>
  );
}
