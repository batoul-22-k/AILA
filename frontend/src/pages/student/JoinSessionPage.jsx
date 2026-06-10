import { LogIn, QrCode, Radio } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { joinSession } from "../../api/client";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { Input } from "../../components/Input";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";

export function JoinSessionPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { sessionCode: routeSessionCode } = useParams();
  const [sessionCode, setSessionCode] = useState(routeSessionCode ?? "");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const session = await joinSession({ session_code: sessionCode, student_id: "current" });
      localStorage.setItem("activeSession", JSON.stringify(session));
      if (session.active_question_id) {
        localStorage.setItem(`activeQuestionId:${session.session_id}`, session.active_question_id);
        localStorage.setItem("activeQuestionId", session.active_question_id);
      }
      navigate("/student/active-question");
    } catch (err) {
      showToast({ title: "Could not join session", description: err instanceof Error ? err.message : "Could not join session", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Live class" title="Enter session code" description="Join the active session shared by your instructor." tone="role" />
      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <DashboardCard>
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-role-soft text-role-primary">
              <Radio size={22} />
            </span>
            <div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Session access</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">Use the code shared by your instructor to enter the active class session.</p>
            </div>
          </div>
          <div className="mt-6 flex items-center gap-3 rounded-lg bg-role-hover p-4 text-sm font-bold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
            <QrCode size={20} />
            Codes can be typed here or opened from a shared QR link.
          </div>
        </DashboardCard>

        <DashboardCard>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <Input label="Session code" value={sessionCode} onChange={(event) => setSessionCode(event.target.value.toUpperCase())} placeholder="Enter code" required className="h-14 text-center text-xl font-black tracking-[0.2em]" />
            <Button type="submit" size="lg" variant="success" loading={loading}>
              <LogIn size={18} />
              Join now
            </Button>
          </form>
        </DashboardCard>
      </div>
      <EmptyState title="No active code" description="Your instructor can create a live session and share a QR or session code from the live dashboard." />
    </div>
  );
}
