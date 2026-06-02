import { Check, ChevronRight, PanelRightClose, X } from "lucide-react";

import { cn } from "../../utils/cn";
import { Button } from "../Button";
import { DashboardCard } from "../DashboardCard";

export function InstructorCard({ children, className, ...props }) {
  return (
    <DashboardCard className={cn("instructor-card", className)} {...props}>
      {children}
    </DashboardCard>
  );
}

export function InstructorButton(props) {
  return <Button {...props} />;
}

export function InstructorBadge({ children, tone = "neutral", className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold",
        tone === "success" && "border-[color:var(--color-success)] bg-[color-mix(in_srgb,var(--color-success)_12%,var(--color-surface))] text-[var(--color-success)]",
        tone === "primary" && "border-[color:var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,var(--color-surface))] text-[var(--color-primary)]",
        tone === "accent" && "border-[color:var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_16%,var(--color-surface))] text-[var(--color-primary)]",
        tone === "neutral" && "border-[color:var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function InstructorPageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-black uppercase tracking-wide text-[var(--color-primary)]">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-black tracking-tight text-[var(--color-text)] sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function InstructorSection({ title, description, action, children, className }) {
  return (
    <section className={cn("grid gap-4", className)}>
      {(title || description || action) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {title && <h2 className="text-lg font-black text-[var(--color-text)]">{title}</h2>}
            {description && <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function InstructorEmptyState({ icon: Icon, title, description, action }) {
  return (
    <InstructorCard className="grid min-h-56 place-items-center text-center">
      <div className="max-w-md">
        {Icon && (
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-role-hover text-[var(--color-primary)]">
            <Icon size={23} />
          </span>
        )}
        <h3 className="mt-4 text-lg font-black text-[var(--color-text)]">{title}</h3>
        {description && <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{description}</p>}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </InstructorCard>
  );
}

export function ConfirmModal({ open, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "primary", busy, onConfirm, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-[var(--color-text)] shadow-lift">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">{title}</h2>
            {description && <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{description}</p>}
          </div>
          <Button className="h-9 px-2" type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy} aria-label="Close modal">
            <X size={16} />
          </Button>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button type="button" variant={tone === "danger" ? "secondary" : "role"} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </section>
    </div>
  );
}

export function SlideOverDrawer({ open, title, description, children, footer, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <button className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" type="button" onClick={onClose} aria-label="Close drawer" />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-lift">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-5">
          <div>
            <h2 className="text-lg font-black">{title}</h2>
            {description && <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{description}</p>}
          </div>
          <Button className="h-9 px-2" type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close drawer">
            <PanelRightClose size={17} />
          </Button>
        </div>
        <div className="subtle-scroll min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t border-[var(--color-border)] p-5">{footer}</div>}
      </aside>
    </div>
  );
}

export function ProgressTimeline({ steps, currentStep, onStepClick }) {
  const currentIndex = steps.findIndex((step) => step.id === currentStep);

  return (
    <InstructorCard className="p-4">
      <div className="grid gap-2 md:grid-cols-5">
        {steps.map((step, index) => {
          const complete = index < currentIndex;
          const current = index === currentIndex;
          return (
            <button
              key={step.id}
              className={cn(
                "focus-ring flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] border px-3 text-left transition-all",
                complete && "border-[color:var(--color-success)] bg-[color-mix(in_srgb,var(--color-success)_10%,var(--color-surface))]",
                current && "border-[color:var(--color-primary)] bg-role-hover",
                !complete && !current && "border-[var(--color-border)] bg-[var(--color-surface)]",
              )}
              type="button"
              onClick={() => onStepClick?.(step.id)}
            >
              <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-black", complete ? "border-[var(--color-success)] text-[var(--color-success)]" : "border-[var(--color-border)] text-[var(--color-muted)]")}>
                {complete ? <Check size={15} /> : index + 1}
              </span>
              <span>
                <span className="block text-sm font-black text-[var(--color-text)]">{step.label}</span>
                <span className="block text-xs font-semibold text-[var(--color-muted)]">{current ? "Current" : complete ? "Completed" : "Pending"}</span>
              </span>
            </button>
          );
        })}
      </div>
    </InstructorCard>
  );
}

export function FloatingActionBar({ show, label, actionLabel, onAction, busy }) {
  if (!show) return null;

  return (
    <div className="fixed inset-x-3 bottom-5 z-40 sm:inset-x-auto sm:right-5">
      <div className="mx-auto flex max-w-md flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[var(--color-text)] shadow-lift sm:flex-row sm:items-center">
        <p className="flex-1 text-sm font-black">{label}</p>
        <Button type="button" variant="role" loading={busy} onClick={onAction}>
          {actionLabel}
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}
