import { CheckCircle2, Edit3, Sparkles } from "lucide-react";

import { Badge } from "./Badge";
import { Button } from "./Button";
import { DashboardCard } from "./DashboardCard";
import { cn } from "../utils/cn";

export function QuestionCard({ title, prompt, options = [], type = "MCQ", status = "AI Draft", onSelect, selected, showActions = status !== "Live" }) {
  return (
    <DashboardCard interactive>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-[var(--role-radius)] bg-role-hover text-role-accent dark:bg-violet-400/15 dark:text-violet-100">
            <Sparkles size={18} />
          </span>
          <div>
            <h3 className="font-black text-slate-950 dark:text-white">{title}</h3>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{type}</p>
          </div>
        </div>
        <Badge tone={status === "Approved" ? "green" : "violet"}>{status}</Badge>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">{prompt}</p>
      {options.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onSelect?.(option)}
              className={cn("adaptive-answer focus-ring border px-3 py-3 text-left text-sm font-semibold", 
                selected === option
                  ? "border-role-secondary bg-role-hover text-role-text dark:bg-emerald-500/15 dark:text-emerald-100"
                  : "text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {showActions && <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm">
          <Edit3 size={15} />
          Edit
        </Button>
        <Button variant="success" size="sm">
          <CheckCircle2 size={15} />
          Approve
        </Button>
      </div>}
    </DashboardCard>
  );
}
