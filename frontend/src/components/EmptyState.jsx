import { Inbox } from "lucide-react";

import { Button } from "./Button";
import { DashboardCard } from "./DashboardCard";

export function EmptyState({ title, description, actionLabel, onAction, icon: Icon = Inbox }) {
  return (
    <DashboardCard className="grid place-items-center py-8 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        <Icon size={21} />
      </span>
      <h3 className="mt-3 text-base font-black text-slate-950 dark:text-white">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm leading-5 text-slate-500 dark:text-slate-400">{description}</p>}
      {actionLabel && (
        <Button className="mt-4" type="button" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </DashboardCard>
  );
}
