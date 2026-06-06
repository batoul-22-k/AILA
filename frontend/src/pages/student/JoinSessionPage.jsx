import { LogIn, QrCode, Smartphone } from "lucide-react";
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
      <PageHeader eyebrow="Join live class" title="Enter your session code" description="Large, simple controls for fast classroom entry on any device." tone="emerald" />
      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <DashboardCard className="bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
          <Smartphone size={42} className="animate-float" />
          <h2 className="mt-6 text-3xl font-black">Fast join for live participation</h2>
          <p className="mt-3 text-sm leading-7 text-white/85">Ask your instructor for the code on the classroom screen or QR display.</p>
          <div className="mt-6 flex items-center gap-3 rounded-lg bg-white/15 p-3 text-sm font-bold">
            <QrCode size={20} />
            Codes can be typed or scanned in class.
          </div>
        </DashboardCard>

        <DashboardCard>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <Input label="Session code" value={sessionCode} onChange={(event) => setSessionCode(event.target.value.toUpperCase())} placeholder="ABC123" required className="h-14 text-center text-xl font-black tracking-[0.2em]" />
            <Button type="submit" size="lg" variant="success" loading={loading}>
              <LogIn size={18} />
              Join now
            </Button>
          </form>
        </DashboardCard>
      </div>
      <EmptyState title="No code yet?" description="Your instructor can create a live session and share a QR or session code from their dashboard." />
    </div>
  );
}
