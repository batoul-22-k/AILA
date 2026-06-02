import { cn } from "../utils/cn";

export function LoadingSkeleton({ className }) {
  return <div className={cn("animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800", className)} />;
}
