import { AlertTriangle, ShieldCheck } from "lucide-react";

import { Badge } from "../../components/Badge";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { ResponsiveTable, RiskBadge } from "../../components/ResponsiveTable";
import { riskReports, studentRiskRoster } from "../../data/mockData";

export function AtRiskPage() {
  return (
    <div className="page-grid">
      <PageHeader eyebrow="Students" title="Students and risk overview" description="A strategic, readable roster of students who may need timely support." tone="orange" />
      <div className="grid gap-4 lg:grid-cols-3">
        {riskReports.map((report) => (
          <DashboardCard key={report.title} interactive>
            <span className={`grid h-12 w-12 place-items-center rounded-lg ${report.level === "High" ? "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-100" : "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-100"}`}>
              {report.level === "Low" ? <ShieldCheck size={22} /> : <AlertTriangle size={22} />}
            </span>
            <Badge className="mt-4" tone={report.level === "High" ? "red" : report.level === "Medium" ? "gold" : "green"}>
              {report.level} risk
            </Badge>
            <h2 className="mt-4 text-lg font-black text-slate-950 dark:text-white">{report.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{report.detail}</p>
          </DashboardCard>
        ))}
      </div>
      <ResponsiveTable
        columns={[
          { key: "name", label: "Student" },
          { key: "className", label: "Class" },
          { key: "attendance", label: "Attendance", render: (row) => `${row.attendance}%` },
          { key: "engagement", label: "Engagement", render: (row) => `${row.engagement}%` },
          { key: "risk", label: "Risk", render: (row) => <RiskBadge level={row.risk} /> },
          { key: "reason", label: "Reason" },
        ]}
        rows={studentRiskRoster}
      />
    </div>
  );
}
