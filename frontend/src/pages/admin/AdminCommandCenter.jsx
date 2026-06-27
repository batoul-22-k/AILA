import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getAdminCommandCenter } from "../../api/client";
import { AdminClassMonitoring } from "../../components/admin/AdminClassMonitoring";
import { InstitutionHealthCard } from "../../components/admin/InstitutionHealthCard";
import { Button } from "../../components/Button";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { CardSkeleton, ChartSkeleton, TableSkeleton } from "../../components/LoadingSkeleton";

export function AdminCommandCenter() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await getAdminCommandCenter());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load command center");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="admin-command-center page-grid mx-auto w-full max-w-[86rem] overflow-hidden pr-1 sm:pr-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">Institution command center</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white">Institution Command Center</h1>
          
        </div>
        <div className="shrink-0 sm:pt-1">
          <Button type="button" variant="role" loading={loading} onClick={load}>
            <RefreshCw size={17} />
            Refresh
          </Button>
        </div>
      </div>

      {error && <DashboardCard><p className="text-sm font-semibold text-red-600">{error}</p></DashboardCard>}
      {loading && !data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <CardSkeleton key={index} />)}
          </div>
          <TableSkeleton rows={6} columns={6} />
          <ChartSkeleton />
        </>
      )}
      {data && (
        <>
          <InstitutionHealthCard health={data.health} />
          <AdminClassMonitoring classes={data.classes || []} />
          <ChartCard className="shadow-none" title="Engagement trends" subtitle="Weekly engagement, attendance, participation, and risk trend">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trends || []}>
                <XAxis dataKey="week" axisLine={false} tickLine={false} />
                <YAxis yAxisId="percent" axisLine={false} tickLine={false} domain={[0, 100]} />
                <YAxis yAxisId="risk" orientation="right" axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip />
                <Area yAxisId="percent" type="monotone" dataKey="engagement" name="Weekly engagement" stroke="#2B7886" strokeWidth={3} fill="#2B788626" />
                <Area yAxisId="percent" type="monotone" dataKey="attendance" name="Attendance trend" stroke="#79D99C" strokeWidth={3} fill="#79D99C33" />
                <Area yAxisId="percent" type="monotone" dataKey="participation" name="Participation trend" stroke="#245866" strokeWidth={3} fill="#24586622" />
                <Area yAxisId="risk" type="monotone" dataKey="at_risk_count" name="Risk trend" stroke="#dc2626" strokeWidth={3} fill="#dc262622" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}
    </div>
  );
}
