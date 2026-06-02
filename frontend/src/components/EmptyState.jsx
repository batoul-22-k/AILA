import { Inbox } from "lucide-react";

import { Button } from "./Button";
import { DashboardCard } from "./DashboardCard";

export function EmptyState({ title, description, actionLabel, onAction, icon: Icon = Inbox }) {
  return (
    <DashboardCard className="grid place-items-center py-10 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        <Icon size={25} />
      </span>
      <h3 className="mt-4 text-lg font-black text-slate-950 dark:text-white">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
      {actionLabel && (
        <Button className="mt-5" type="button" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </DashboardCard>
  );
}
