import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle, ShieldAlert, ShieldCheck } from "lucide-react";

import { cn } from "../utils/cn";

const prediction = {
  high: {
    label: "High Risk",
    icon: AlertTriangle,
    className: "bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/10 dark:text-red-100 dark:ring-red-500/20",
  },
  medium: {
    label: "Medium Risk",
    icon: AlertCircle,
    className: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/20",
  },
  low: {
    label: "Low Risk",
    icon: CheckCircle2,
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-500/20",
  },
  pending: {
    label: "Pending",
    icon: HelpCircle,
    className: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700",
  },
};

const intervention = {
  critical: {
    label: "Immediate intervention required",
    icon: ShieldAlert,
    className: "bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/10 dark:text-red-100 dark:ring-red-500/20",
  },
  "needs attention": {
    label: "Monitor and support",
    icon: AlertCircle,
    className: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-100 dark:ring-orange-500/20",
  },
  monitor: {
    label: "Monitor and support",
    icon: AlertCircle,
    className: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-100 dark:ring-orange-500/20",
  },
  attention: {
    label: "Monitor and support",
    icon: AlertCircle,
    className: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-100 dark:ring-orange-500/20",
  },
  stable: {
    label: "No intervention required",
    icon: ShieldCheck,
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-500/20",
  },
  healthy: {
    label: "No intervention required",
    icon: ShieldCheck,
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-500/20",
  },
  active: {
    label: "Active",
    icon: ShieldCheck,
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-500/20",
  },
  pending: {
    label: "Pending",
    icon: HelpCircle,
    className: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700",
  },
  inactive: {
    label: "Inactive",
    icon: HelpCircle,
    className: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700",
  },
};

function statusMeta(type, status) {
  const key = String(status || "pending").trim().toLowerCase();
  if (type === "intervention") return intervention[key] || intervention.pending;
  return prediction[key] || prediction.pending;
}

export function StatusIcon({ status, type = "prediction", showLabel = false, className }) {
  const meta = statusMeta(type, status);
  const Icon = meta.icon;

  return (
    <span className="group relative inline-flex items-center gap-2 align-middle">
      <span
        className={cn("inline-grid h-8 w-8 shrink-0 place-items-center rounded-full ring-1", meta.className, className)}
        title={meta.label}
        aria-label={meta.label}
        role="img"
      >
        <Icon size={18} aria-hidden="true" />
      </span>
      {showLabel && <span className="text-xs font-black text-slate-600 dark:text-slate-300">{meta.label}</span>}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-black text-white opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:bg-white dark:text-slate-950">
        {meta.label}
      </span>
    </span>
  );
}

export function HeaderIconLabel({ icon: Icon, label }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      {Icon && <Icon size={14} aria-hidden="true" />}
      <span>{label}</span>
    </span>
  );
}
