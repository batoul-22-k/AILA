import { Copy, QrCode } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";

export function SessionCodePage() {
  const session = JSON.parse(localStorage.getItem("instructorSession") ?? "null");
  const code = session?.session_code ?? "------";

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Share session" title="QR and session code" description="Large, phone-friendly, and easy to project in class." tone="violet" />
      <DashboardCard className="mx-auto w-full max-w-2xl text-center">
        <span className="mx-auto grid h-24 w-24 place-items-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-100">
          <QrCode size={54} />
        </span>
        <Badge className="mt-5" tone="green">Active session</Badge>
        <p className="mt-5 rounded-lg bg-slate-950 px-6 py-7 text-5xl font-black tracking-[0.25em] text-white shadow-lift sm:text-7xl">
          {code}
        </p>
        <p className="mt-4 break-all text-sm font-semibold text-slate-500 dark:text-slate-400">Session ID: {session?.session_id ?? "Create a session first"}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button type="button" variant="outline" onClick={() => navigator.clipboard?.writeText(code)}>
            <Copy size={17} />
            Copy code
          </Button>
          <Link to="/instructor/live">
            <Button variant="violet">Open live dashboard</Button>
          </Link>
        </div>
      </DashboardCard>
    </div>
  );
}
