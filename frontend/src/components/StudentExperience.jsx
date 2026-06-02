import { Award, Radio, Trophy } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "./Badge";
import { Button } from "./Button";
import { DashboardCard } from "./DashboardCard";

export function AchievementBadge({ label, detail, icon: Icon = Award }) {
  return (
    <DashboardCard className="flex items-center gap-3">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--role-info)] text-role-accent">
        <Icon size={21} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-slate-950 dark:text-white">{label}</p>
        {detail && <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{detail}</p>}
      </div>
    </DashboardCard>
  );
}

export function ParticipationScore({ value, detail }) {
  return (
    <DashboardCard className="bg-[var(--role-primary)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Badge tone="green">Participation</Badge>
          <p className="mt-3 text-4xl font-black text-white">{value}</p>
          {detail && <p className="mt-1 text-sm font-semibold text-[#EAF1FA]">{detail}</p>}
        </div>
        <span className="grid h-14 w-14 place-items-center rounded-full bg-white/70 text-role-accent shadow-soft">
          <Trophy size={26} />
        </span>
      </div>
    </DashboardCard>
  );
}

export function SessionJoinCard({ title, detail, to = "/student/join" }) {
  return (
    <DashboardCard className="grid content-between gap-6 bg-[var(--role-primary)]">
      <div>
        <Badge tone="green">Live class</Badge>
        <h2 className="mt-4 text-2xl font-black text-white">{title}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#EAF1FA]">{detail}</p>
      </div>
      <Link to={to}>
        <Button size="lg" variant="role">
          <Radio size={18} />
          Join session
        </Button>
      </Link>
    </DashboardCard>
  );
}

export function AnswerCard({ children, selected, onClick }) {
  return (
    <button
      className={`adaptive-answer focus-ring w-full border px-4 py-4 text-left text-sm font-black ${
        selected ? "border-role-secondary bg-role-hover text-role-text" : "text-slate-700"
      }`}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
