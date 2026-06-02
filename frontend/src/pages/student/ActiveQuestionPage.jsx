import { MessageSquareText, Timer } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { QuestionCard } from "../../components/QuestionCard";

function getSession() {
  const raw = localStorage.getItem("activeSession");
  return raw ? JSON.parse(raw) : null;
}

export function ActiveQuestionPage() {
  const session = getSession();
  const questionId = session?.question_ids?.[0] ?? "question_demo";
  const [selected, setSelected] = useState(localStorage.getItem("selectedAnswer") ?? "");

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Live question" title="Think, choose, and submit confidently" description="Your answer updates the instructor dashboard in real time." tone="emerald" />
      <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[1fr_320px]">
        <QuestionCard
          title={questionId}
          type="MCQ"
          status="Live"
          prompt="Which learning signal best indicates that a class needs immediate instructor support?"
          options={["High participation", "Low response rate", "Fast correct answers", "Balanced distribution"]}
          selected={selected}
          onSelect={(answer) => {
            localStorage.setItem("selectedAnswer", answer);
            setSelected(answer);
          }}
        />

        <DashboardCard>
          <Badge tone="teal">Session {session?.session_code ?? "Demo"}</Badge>
          <div className="mt-5 grid gap-3">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                <Timer size={17} />
                Time left
              </span>
              <span className="font-black">02:30</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                <MessageSquareText size={17} />
                Format
              </span>
              <span className="font-black">MCQ</span>
            </div>
          </div>
          {selected ? (
            <Link to="/student/submit-answer" className="mt-5 block">
              <Button className="w-full" size="lg" variant="success">
                Submit answer
              </Button>
            </Link>
          ) : (
            <Button className="mt-5 w-full" size="lg" variant="success" disabled>
              Choose an answer first
            </Button>
          )}
        </DashboardCard>
      </div>
    </div>
  );
}
