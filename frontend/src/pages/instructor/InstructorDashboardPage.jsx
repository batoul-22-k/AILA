import { Activity, BrainCircuit, BookOpen, Radio, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getInstructorDashboard } from "../../api/client";
import { Button } from "../../components/Button";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import { engagementTrend, weakConcepts } from "../../data/mockData";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";

export function InstructorDashboardPage() {
  const { currentWorkspace } = useCurrentWorkspace();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    getInstructorDashboard().then(setSummary).catch(() => setSummary(null));
  }, []);

  return (
    <div className="page-grid">
      <PageHeader
        /* eyebrow="Instructor dashboard" */
        tone="role"
        action={
          <Link to="/instructor/sessions">
            <Button size="lg" variant="role">
              <Radio size={18} />
              Create session
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active sessions" value={summary?.active_sessions ?? 0} icon={Activity} tone="role" trend="+8%" />
        <StatCard label="Classes" value={summary?.total_classes ?? 0} icon={Users} tone="role" />
        <StatCard label="Responses" value={summary?.total_responses ?? 0} icon={Radio} tone="gold" trend="+22%" />
        <StatCard label="Weak concepts" value="3" icon={BrainCircuit} tone="red" detail="need review" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <ChartCard title="Engagement trend" subtitle="Participation and responses over time">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={engagementTrend}>
              <XAxis dataKey="label" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} />
              <Tooltip />
              <Area type="monotone" dataKey="engagement" stroke="#2B7886" strokeWidth={3} fill="#2B788626" />
              <Area type="monotone" dataKey="responses" stroke="#79D99C" strokeWidth={3} fill="#79D99C33" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Weak concepts" subtitle="Lower scores need instructor attention">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weakConcepts} layout="vertical" margin={{ left: 16 }}>
              <XAxis type="number" axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="concept" axisLine={false} tickLine={false} width={92} />
              <Tooltip />
              <Bar dataKey="score" fill="#EF6B6B" radius={[0, 12, 12, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <DashboardCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Operational workflow</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create a class, open Content Studio, approve questions, then run a live session.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link to="/instructor/classes">
              <Button variant="outline">
                <BookOpen size={17} />
                Classes
              </Button>
            </Link>
            <Link to="/instructor/content-studio">
              <Button variant="role">
                <BrainCircuit size={17} />
                Content Studio
              </Button>
            </Link>
          </div>
        </div>
      </DashboardCard>
    </div>
  );
}
