import { Download, FileText } from "lucide-react";

import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";

const reports = [
  { title: "Weekly engagement forecast", status: "Draft", date: "2026-05-30" },
  { title: "Risk model placeholder", status: "Pending ML", date: "2026-05-30" },
  { title: "Instructor summary pack", status: "Ready", date: "2026-05-29" },
];

export function PredictionReportsPage() {
  return (
    <div className="page-grid">
      <PageHeader eyebrow="Reports" title="Reports and ML outputs" description="A clean executive report center for future prediction model results." tone="orange" />
      <div className="grid gap-4 lg:grid-cols-3">
        {reports.map((report) => (
          <DashboardCard key={report.title} interactive>
            <FileText className="text-orange-600 dark:text-orange-100" size={28} />
            <Badge className="mt-4" tone={report.status === "Ready" ? "green" : "gold"}>
              {report.status}
            </Badge>
            <h2 className="mt-4 text-lg font-black text-slate-950 dark:text-white">{report.title}</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">{report.date}</p>
            <Button className="mt-5 w-full" variant={report.status === "Ready" ? "orange" : "outline"}>
              <Download size={17} />
              Export
            </Button>
          </DashboardCard>
        ))}
      </div>
      <EmptyState title="Prediction model placeholder" description="Connect prediction_results from the ML service when the model is ready." />
    </div>
  );
}
