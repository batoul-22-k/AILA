import { CheckCircle2, Edit3, Sparkles } from "lucide-react";

import { Badge } from "./Badge";
import { Button } from "./Button";
import { DashboardCard } from "./DashboardCard";
import { cn } from "../utils/cn";

function normalizeAnswer(value) {
  return String(value || "").trim().toLowerCase();
}

export function QuestionCard({
  title,
  subtitle,
  prompt,
  options = [],
  type = "MCQ",
  status = "AI Draft",
  onSelect,
  selected,
  showActions = status !== "Live",
  disabled = false,
  correctAnswer = "",
  revealed = false,
}) {
  const statusTone = status === "Approved" || status === "Submitted" || status === "Revealed" ? "green" : status === "Live" ? "teal" : status === "Scheduled" ? "gold" : "violet";

  return (
    <DashboardCard className="overflow-hidden bg-white p-0 dark:bg-slate-900" interactive>
      <div className="border-b border-role-border bg-role-hover/60 p-4 dark:border-slate-800 dark:bg-slate-950/60 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[18px] bg-white text-role-accent shadow-sm dark:bg-slate-900 dark:text-violet-100">
              <Sparkles size={18} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate font-black text-slate-950 dark:text-white">{title}</h3>
              {subtitle && <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{subtitle}</p>}
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{type}</p>
            </div>
          </div>
          <Badge tone={statusTone}>{status}</Badge>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <p className="text-lg font-black leading-7 text-slate-950 dark:text-white">{prompt}</p>
        {options.length > 0 && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {options.map((option, index) => {
              const active = selected === option;
              const label = String.fromCharCode(65 + index);
              const normalizedCorrect = normalizeAnswer(correctAnswer);
              const isCorrect = revealed && normalizedCorrect && [normalizeAnswer(option), normalizeAnswer(label)].includes(normalizedCorrect);
              const isWrongSelection = revealed && active && normalizedCorrect && !isCorrect;
              return (
                <button
                  key={`${option}-${index}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect?.(option)}
                  className={cn(
                    "focus-ring flex min-h-16 items-start gap-3 rounded-[20px] border px-4 py-3 text-left text-sm font-bold transition disabled:cursor-not-allowed",
                    isCorrect
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900 shadow-sm dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-100"
                      : isWrongSelection
                        ? "border-amber-300 bg-amber-50 text-amber-900 shadow-sm dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-100"
                        : active
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900 shadow-sm dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-100"
                      : "border-role-border bg-role-hover text-slate-700 hover:border-role-primary hover:bg-white disabled:hover:border-role-border disabled:hover:bg-role-hover dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900 dark:disabled:hover:bg-slate-950",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black",
                      isCorrect
                        ? "bg-emerald-600 text-white"
                        : isWrongSelection
                          ? "bg-amber-500 text-white"
                          : active
                            ? "bg-emerald-600 text-white"
                            : "bg-white text-role-primary dark:bg-slate-900",
                    )}
                  >
                    {label}
                  </span>
                  <span className="leading-6">
                    {option}
                    {isCorrect && <span className="ml-2 text-xs font-black uppercase text-emerald-700 dark:text-emerald-100">Correct</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {showActions && <div className="mt-5 flex flex-wrap gap-2 border-t border-role-border pt-4 dark:border-slate-800">
          <Button variant="outline" size="sm">
            <Edit3 size={15} />
            Edit
          </Button>
          <Button variant="success" size="sm">
            <CheckCircle2 size={15} />
            Approve
          </Button>
        </div>}
      </div>
    </DashboardCard>
  );
}
