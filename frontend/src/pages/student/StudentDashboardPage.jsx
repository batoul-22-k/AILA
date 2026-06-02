import { ArrowRight, Award, Calendar, Flame, Radio, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { ProgressCard } from "../../components/ProgressCard";
import { AchievementBadge, ParticipationScore, SessionJoinCard } from "../../components/StudentExperience";

export function StudentDashboardPage() {
  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Student home"
        title="Ready for today’s live class?"
        description="A friendly home for joining sessions, keeping your streak alive, and seeing progress without clutter."
        tone="emerald"
        action={
          <Link to="/student/join">
            <Button size="lg" variant="success">
              <Radio size={18} />
              Join session
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <ParticipationScore value="89%" detail="You are doing great this week." />
        <div className="grid gap-4 sm:grid-cols-3">
          <AchievementBadge label="7 day streak" detail="Keep going" icon={Flame} />
          <AchievementBadge label="14 badges" detail="3 new" icon={Award} />
          <AchievementBadge label="5 answers" detail="Today" icon={Sparkles} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
        <SessionJoinCard
          title="Join, answer, breathe."
          detail="Your session room keeps one question in focus at a time with large answer choices and instant feedback."
          to="/student/session"
        />

        <div className="grid gap-4">
          <DashboardCard>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-emerald-600 dark:text-emerald-300">Today</p>
                <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Advanced AI at 14:00</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Live participation is the only action you need.</p>
              </div>
              <Calendar className="text-emerald-600" />
            </div>
          </DashboardCard>
          <ProgressCard label="Weekly mission" value={82} badge="On fire" tone="emerald" />
          <ProgressCard label="Question accuracy" value={76} badge="Rising" tone="gold" />
          <DashboardCard className="bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
            <Badge tone="gold">Daily boost</Badge>
            <h2 className="mt-4 text-xl font-black">Answer one more question to unlock a focus badge.</h2>
            <Link className="mt-4 inline-flex items-center gap-2 text-sm font-black text-white" to="/student/session">
              Open session room
              <ArrowRight size={16} />
            </Link>
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}
