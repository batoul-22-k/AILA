import { Check, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getLiveSessionQuestions, submitAnswer } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";

function getAnswerKey(sessionId, questionId) {
  return `selectedAnswer:${sessionId || "demo"}:${questionId || "question_demo"}`;
}

function getActiveQuestionId(session) {
  const questionIds = session?.question_ids ?? [];
  if (session?.active_question_id && questionIds.includes(session.active_question_id)) return session.active_question_id;
  const scopedQuestionId = session?.session_id ? localStorage.getItem(`activeQuestionId:${session.session_id}`) : null;
  const storedQuestionId = scopedQuestionId || localStorage.getItem("activeQuestionId");
  return questionIds.includes(storedQuestionId) ? storedQuestionId : questionIds[0] ?? "question_demo";
}

function getStoredAnswer(sessionId, questionId) {
  return localStorage.getItem(getAnswerKey(sessionId, questionId)) || localStorage.getItem("selectedAnswer") || "";
}

export function SubmitAnswerPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const session = JSON.parse(localStorage.getItem("activeSession") ?? "null");
  const questionId = getActiveQuestionId(session);
  const [questions, setQuestions] = useState([]);
  const activeQuestion = questions.find((question) => question.question_id === questionId);
  const hasOptions = (activeQuestion?.options?.length ?? 0) > 0;
  const [mode, setMode] = useState(() => (getStoredAnswer(session?.session_id, questionId) ? "mcq" : "short"));
  const [answer, setAnswer] = useState(() => getStoredAnswer(session?.session_id, questionId));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadQuestions() {
      if (!session?.session_id) return;
      try {
        const result = await getLiveSessionQuestions(session.session_id);
        setQuestions(result);
      } catch (err) {
        showToast({ title: "Could not load live question", description: err instanceof Error ? err.message : "Could not load live question", tone: "error" });
      }
    }

    loadQuestions();
  }, [session?.session_id, showToast]);

  useEffect(() => {
    const storedAnswer = getStoredAnswer(session?.session_id, questionId);
    setAnswer(storedAnswer);
    setMode(hasOptions ? "mcq" : "short");
  }, [hasOptions, questionId, session?.session_id]);

  function updateAnswer(nextAnswer) {
    setAnswer(nextAnswer);
    localStorage.setItem(getAnswerKey(session?.session_id, questionId), nextAnswer);
    localStorage.setItem("selectedAnswer", nextAnswer);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!session) {
      showToast({ title: "Join a session first", description: "Join a session before submitting an answer.", tone: "warning" });
      return;
    }
    if (!answer.trim()) {
      showToast({ title: "Answer required", description: "Choose or write an answer before submitting.", tone: "warning" });
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
      <PageHeader eyebrow="Answer" title="Submit your response" description="Review the active prompt, then send one answer for this question." tone="emerald" />
      <DashboardCard>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <div>
            <Badge tone="teal">{hasOptions ? "MCQ" : "Short answer"}</Badge>
            <h2 className="mt-3 text-xl font-black text-slate-950 dark:text-white">
              {activeQuestion?.question_text || "Loading active question..."}
            </h2>
          </div>

          {hasOptions && (
            <div className="inline-grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-950 sm:w-fit">
              {["mcq", "short"].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setMode(item);
                    if (item === "short") updateAnswer("");
                  }}
                  className={`rounded-lg px-4 py-2 text-sm font-black transition ${
                    mode === item ? "bg-white text-emerald-700 shadow-sm dark:bg-slate-800 dark:text-emerald-100" : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {item === "mcq" ? "MCQ" : "Short answer"}
                </button>
              ))}
            </div>
          )}

          {mode === "mcq" && hasOptions ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {activeQuestion.options.map((option, index) => (
                <button
                  key={`${option}-${index}`}
                  type="button"
                  onClick={() => updateAnswer(option)}
                  className={`focus-ring flex items-center justify-between rounded-lg border px-4 py-4 text-left text-sm font-black transition ${
                    answer === option
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-100"
                      : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  }`}
                >
                  <span>
                    <span className="mr-2 text-xs font-black text-emerald-700">{String.fromCharCode(65 + index)}.</span>
                    {option}
                  </span>
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
                onChange={(event) => updateAnswer(event.target.value)}
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
            <Badge tone="gold">One answer per question</Badge>
          </div>
        </form>
      </DashboardCard>
    </div>
  );
}
