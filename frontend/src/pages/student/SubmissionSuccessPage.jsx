import { CheckCircle2, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";

export function SubmissionSuccessPage() {
  return (
    <div className="grid min-h-[70vh] place-items-center">
      <DashboardCard className="max-w-xl text-center">
        <span className="mx-auto grid h-20 w-20 place-items-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-100">
          <CheckCircle2 size={40} />
        </span>
        <Badge className="mt-5" tone="green">Response saved</Badge>
        <h1 className="mt-4 text-3xl font-black text-slate-950 dark:text-white">Submission received</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-slate-400">
          Your instructor's live dashboard has been updated.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link to="/student/active-question">
            <Button variant="role">
              <ArrowLeft size={17} />
              Back to question
            </Button>
          </Link>
          <Link to="/student/progress">
            <Button variant="outline">View progress</Button>
          </Link>
        </div>
      </DashboardCard>
    </div>
  );
}
