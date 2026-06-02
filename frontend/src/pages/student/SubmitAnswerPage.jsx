import { Check, Send } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { submitAnswer } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";

const options = ["High participation", "Low response rate", "Fast correct answers", "Balanced distribution"];

export function SubmitAnswerPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const session = JSON.parse(localStorage.getItem("activeSession") ?? "null");
  const selected = localStorage.getItem("selectedAnswer") ?? "";
  const [mode, setMode] = useState(selected ? "mcq" : "short");
  const [answer, setAnswer] = useState(selected);
  const [loading, setLoading] = useState(false);
  const questionId = localStorage.getItem("activeQuestionId") ?? session?.question_ids?.[0] ?? "question_demo";

  async function handleSubmit(event) {
    event.preventDefault();
    if (!session) {
      showToast({ title: "Join a session first", description: "Join a session before submitting an answer.", tone: "warning" });
      return;
    }
    setLoading(true);
    try {
      await submitAnswer({
        session_id: session.session_id,
        question_id: questionId,
        student_id: "current",
        answer,
      });
      navigate("/student/success");
    } catch (err) {
      showToast({ title: "Could not submit answer", description: err instanceof Error ? err.message : "Could not submit answer", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Answer" title="Submit your response" description="Choose MCQ or short answer depending on the live prompt." tone="emerald" />
      <DashboardCard>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <div className="inline-grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-950 sm:w-fit">
            {["mcq", "short"].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setMode(item);
                  setAnswer(item === "mcq" ? selected : "");
                }}
                className={`rounded-lg px-4 py-2 text-sm font-black transition ${
                  mode === item ? "bg-white text-emerald-700 shadow-sm dark:bg-slate-800 dark:text-emerald-100" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {item === "mcq" ? "MCQ" : "Short answer"}
              </button>
            ))}
          </div>

          {mode === "mcq" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setAnswer(option)}
                  className={`focus-ring flex items-center justify-between rounded-lg border px-4 py-4 text-left text-sm font-black transition ${
                    answer === option
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-100"
                      : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  }`}
                >
                  {option}
                  {answer === option && <Check size={18} />}
                </button>
              ))}
            </div>
          ) : (
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              Short answer
              <textarea
                className="focus-ring min-h-40 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Explain your reasoning..."
                required
              />
            </label>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit" size="lg" variant="success" loading={loading}>
              <Send size={18} />
              Submit response
            </Button>
            <Badge tone="gold">Correctness evaluated later</Badge>
          </div>
        </form>
      </DashboardCard>
    </div>
  );
}
