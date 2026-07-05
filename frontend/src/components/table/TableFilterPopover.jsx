import { Check } from "lucide-react";

import { cn } from "../../utils/cn";

function normalizeOptions(options, allLabel) {
  return [
    { value: "", label: allLabel },
    ...options
      .map((option) => {
        if (Array.isArray(option)) return { value: option[0], label: option[1] };
        return option;
      })
      .filter((option) => option && option.value !== ""),
  ];
}

export function TableFilterPopover({
  options = [],
  value = "",
  onChange,
  allLabel = "All",
  onClose,
  align = "left",
}) {
  const normalizedOptions = normalizeOptions(options, allLabel);

  return (
    <div
      className={cn(
        "absolute top-full z-40 mt-1 w-48 overflow-hidden rounded-lg border border-role-border bg-white p-1 text-left shadow-lift dark:border-slate-800 dark:bg-slate-950",
        align === "right" ? "right-0" : "left-0",
      )}
      role="menu"
    >
      {normalizedOptions.map((option) => {
        const selected = String(value || "") === String(option.value || "");
        return (
          <button
            key={String(option.value)}
            type="button"
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs font-black text-slate-600 transition hover:bg-role-hover dark:text-slate-300",
              selected && "bg-role-hover text-role-primary dark:bg-slate-900",
            )}
            onClick={() => {
              onChange(option.value);
              onClose?.();
            }}
            role="menuitemradio"
            aria-checked={selected}
          >
            <span className="truncate">{option.label}</span>
            {selected && <Check size={13} />}
          </button>
        );
      })}
    </div>
  );
}
