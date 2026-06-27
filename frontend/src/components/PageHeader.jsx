import { cn } from "../utils/cn";

const eyebrowTone = {
  brand: "text-brand-600 dark:text-brand-100",
  emerald: "text-emerald-600 dark:text-emerald-300",
  violet: "text-[var(--role-primary)] dark:text-[var(--role-dark-text)]",
  orange: "text-orange-600 dark:text-orange-300",
  role: "text-[var(--role-primary)] dark:text-[var(--role-dark-text)]",
};

export function PageHeader({ eyebrow, title, description, action, tone = "brand" }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className={cn("text-xs font-black uppercase tracking-wide", eyebrowTone[tone])}>{eyebrow}</p>}
        {title && <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white">{title}</h1>}
        {description && <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}
