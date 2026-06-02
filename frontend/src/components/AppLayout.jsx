import { cn } from "../utils/cn";

export function AppLayout({ children, className, style, ...props }) {
  return (
    <div className={cn("role-root min-h-screen bg-role-bg text-slate-800 dark:bg-slate-950 dark:text-white", className)} style={style} {...props}>
      {children}
    </div>
  );
}
