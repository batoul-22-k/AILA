import { ChevronDown, Filter } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../utils/cn";
import { TableFilterPopover } from "./TableFilterPopover";

export function TableHeaderFilter({
  label,
  value = "",
  options = [],
  onChange,
  allLabel = "All",
  align = "left",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = Boolean(value);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span ref={ref} className={cn("relative inline-flex items-center", className)}>
      <button
        type="button"
        className={cn(
          "focus-ring inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-black uppercase tracking-wide text-slate-500 transition hover:bg-white hover:text-role-primary dark:text-slate-400 dark:hover:bg-slate-900",
          active && "bg-white text-role-primary dark:bg-slate-900",
        )}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Filter ${label}`}
      >
        <span>{label}</span>
        {active ? <Filter size={12} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <TableFilterPopover
          align={align}
          allLabel={allLabel}
          options={options}
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}
