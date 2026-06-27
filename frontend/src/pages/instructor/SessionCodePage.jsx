import { Copy, QrCode } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";

export function SessionCodePage() {
  const session = JSON.parse(localStorage.getItem("instructorSession") ?? "null");
  const code = session?.session_code ?? "";

  return (
    <div className="page-grid">
      <PageHeader title="Session Code" tone="role" />
      <DashboardCard className="mx-auto w-full max-w-2xl text-center">
        <span className="mx-auto grid h-24 w-24 place-items-center rounded-lg bg-role-soft text-role-primary dark:bg-slate-900 dark:text-role-primary">
          <QrCode size={54} />
        </span>
        <Badge className="mt-5" tone="green">Active session</Badge>
        {code ? (
          <p className="mt-5 rounded-lg bg-slate-950 px-6 py-7 text-5xl font-black tracking-[0.25em] text-white shadow-lift sm:text-7xl">
            {code}
          </p>
        ) : (
          <p className="mt-5 rounded-lg border border-dashed border-role-border bg-role-hover px-6 py-7 text-lg font-black text-slate-600 dark:text-slate-300">
            No session
          </p>
        )}
        <p className="mt-4 break-all text-sm font-semibold text-slate-500 dark:text-slate-400">Session ID: {session?.session_id ?? "No session"}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button type="button" variant="outline" disabled={!code} onClick={() => navigator.clipboard?.writeText(code)}>
            <Copy size={17} />
            Copy
          </Button>
          <Link to="/instructor/live">
            <Button variant="role">Open live</Button>
          </Link>
        </div>
      </DashboardCard>
    </div>
  );
}
