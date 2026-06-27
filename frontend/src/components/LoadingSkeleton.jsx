import { cn } from "../utils/cn";

export function LoadingSkeleton({ className }) {
  return <div className={cn("animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800", className)} />;
}

export function CardSkeleton({ className }) {
  return (
    <div className={cn("rounded-lg border border-role-border bg-white p-4 dark:border-slate-800 dark:bg-slate-900", className)}>
      <LoadingSkeleton className="h-3 w-24" />
      <LoadingSkeleton className="mt-3 h-7 w-16" />
      <LoadingSkeleton className="mt-3 h-3 w-32" />
    </div>
  );
}

export function ChartSkeleton({ className }) {
  return (
    <div className={cn("rounded-lg border border-role-border bg-white p-4 dark:border-slate-800 dark:bg-slate-900", className)}>
      <LoadingSkeleton className="h-4 w-36" />
      <LoadingSkeleton className="mt-4 h-56 w-full" />
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5, className }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-role-border bg-white dark:border-slate-800 dark:bg-slate-900", className)}>
      <div className="grid gap-3 border-b border-role-border bg-role-hover p-3 dark:border-slate-800 dark:bg-slate-950" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }).map((_, index) => <LoadingSkeleton key={index} className="h-3" />)}
      </div>
      <div className="divide-y divide-role-border dark:divide-slate-800">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="grid gap-3 p-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }).map((_, columnIndex) => <LoadingSkeleton key={columnIndex} className="h-4" />)}
          </div>
        ))}
      </div>
    </div>
  );
}
