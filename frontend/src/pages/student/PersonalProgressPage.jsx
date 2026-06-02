import { Award, Flame, Medal, Star } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Badge } from "../../components/Badge";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { ProgressCard } from "../../components/ProgressCard";
import { StatCard } from "../../components/StatCard";
import { studentProgress } from "../../data/mockData";

export function PersonalProgressPage() {
  return (
    <div className="page-grid">
      <PageHeader eyebrow="Personal progress" title="Your learning journey" description="Badges, streaks, participation, and weekly performance in one friendly view." tone="emerald" />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Streak" value="7" icon={Flame} tone="red" detail="days" />
        <StatCard label="Level" value="4" icon={Medal} tone="gold" detail="Explorer" />
        <StatCard label="Stars" value="126" icon={Star} tone="violet" detail="earned" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_0.75fr]">
        <ChartCard title="Weekly scores" subtitle="Participation and response quality">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={studentProgress}>
              <XAxis dataKey="label" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="score" fill="#16a3a3" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <div className="grid gap-4">
        <ProgressCard label="Participation goal" value={89} badge="Gold" tone="emerald" />
          <ProgressCard label="Reflection quality" value={72} badge="Growing" tone="violet" />
          <DashboardCard>
            <div className="flex items-center gap-3">
              <Award className="text-amber-500" />
              <h2 className="font-black text-slate-950 dark:text-white">Recent badges</h2>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {["Fast Thinker", "Team Helper", "Curious Mind", "Streak Builder"].map((badge) => (
                <Badge key={badge} tone="gold">
                  {badge}
                </Badge>
              ))}
            </div>
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}
