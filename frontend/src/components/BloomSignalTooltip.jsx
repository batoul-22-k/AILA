import { Info } from "lucide-react";

const BLOOM_TOOLTIP_TEXT = "Bloom cognitive skills represent the level of thinking demonstrated by students (e.g., Remember, Understand, Apply, Analyze, Evaluate, Create). Lower performance at these levels contributes to the academic risk prediction.";

export function BloomSignalTooltip({ text = BLOOM_TOOLTIP_TEXT, className = "" }) {
  return (
    <span className={`group relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-role-primary outline-none transition hover:bg-role-soft focus:bg-role-soft"
        aria-label="Bloom cognitive skills information"
      >
        <Info size={14} />
      </button>
      <span className="pointer-events-none absolute left-0 top-[calc(100%+0.5rem)] z-40 w-72 translate-y-1 rounded-lg border border-role-border bg-white p-3 text-left text-xs font-semibold normal-case leading-5 tracking-normal text-slate-600 opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        {text}
      </span>
    </span>
  );
}

export const BLOOM_SIGNAL_TOOLTIP_TEXT = BLOOM_TOOLTIP_TEXT;
