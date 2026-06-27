import { GraduationCap, Sparkles, X } from "lucide-react";

import { Button } from "../Button";

export function CelebrationOverlay({ show, title, description, onClose, variant = "achievement", level, bonusXp = 50 }) {
  if (!show) return null;
  const isLevelUp = variant === "level";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md animate-[fadeIn_220ms_ease-out] overflow-hidden rounded-2xl border border-white/60 bg-white p-6 text-center shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-role-primary to-transparent" />
        <button type="button" className="absolute right-3 top-3 rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose} aria-label="Close celebration">
          <X size={17} />
        </button>
        <div className={isLevelUp ? "mx-auto flex h-16 w-16 scale-100 items-center justify-center rounded-full bg-role-soft text-role-primary shadow-soft dark:bg-role-dark-soft" : "mx-auto flex h-16 w-16 scale-100 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-100"}>
          {isLevelUp ? <GraduationCap size={31} /> : <Sparkles size={30} />}
        </div>
        <p className="mt-4 text-xs font-black uppercase tracking-[0.18em] text-role-primary">{isLevelUp ? "Level Up" : "Achievement"}</p>
        <h2 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">
          {isLevelUp ? `Level ${level || ""} Achieved` : title || "Achievement unlocked"}
        </h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
          {isLevelUp ? description || `+${bonusXp} XP Bonus · New rewards available` : description || "Your progress has been updated."}
        </p>
        {isLevelUp && (
          <div className="mt-4 grid gap-2 rounded-xl border border-role-border bg-role-hover p-3 text-sm font-black text-role-primary dark:border-slate-800 dark:bg-slate-950/50">
            <span>+{bonusXp} XP Bonus</span>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">New rewards available</span>
          </div>
        )}
        <Button className="mt-5" variant="role" onClick={onClose}>Continue</Button>
      </div>
    </div>
  );
}
