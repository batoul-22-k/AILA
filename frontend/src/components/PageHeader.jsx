import { cn } from "../utils/cn";

const eyebrowTone = {
  brand: "text-brand-600 dark:text-brand-100",
  emerald: "text-emerald-600 dark:text-emerald-300",
  violet: "text-violet-600 dark:text-violet-300",
  orange: "text-orange-600 dark:text-orange-300",
  role: "text-[var(--role-primary)] dark:text-[var(--role-dark-text)]",
};

export function PageHeader({ eyebrow, title, description, action, tone = "brand" }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className={cn("text-s font-black uppercase tracking-wide", eyebrowTone[tone])}>{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white sm:text-xl">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}
