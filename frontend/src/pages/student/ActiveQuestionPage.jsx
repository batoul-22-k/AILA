import { MessageSquareText, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getLiveSessionQuestions, getWebSocketUrl } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { QuestionCard } from "../../components/QuestionCard";
import { useToast } from "../../components/ToastProvider";

const QUESTION_DURATION_SECONDS = 180;

function getSession() {
  const raw = localStorage.getItem("activeSession");
  return raw ? JSON.parse(raw) : null;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function shortenQuestionId(id) {
  if (!id || id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function getActiveQuestionId(session, questionIds) {
  if (session?.active_question_id && questionIds.includes(session.active_question_id)) return session.active_question_id;
  const scopedQuestionId = session?.session_id ? localStorage.getItem(`activeQuestionId:${session.session_id}`) : null;
  const storedQuestionId = scopedQuestionId || localStorage.getItem("activeQuestionId");
  return questionIds.includes(storedQuestionId) ? storedQuestionId : questionIds[0] ?? "question_demo";
}

function getAnswerKey(sessionId, questionId) {
  return `selectedAnswer:${sessionId || "demo"}:${questionId || "question_demo"}`;
}

function getStoredAnswer(sessionId, questionId) {
  return localStorage.getItem(getAnswerKey(sessionId, questionId)) || "";
}

export function ActiveQuestionPage() {
  const { showToast } = useToast();
  const session = useMemo(() => getSession(), []);
  const questionIds = useMemo(() => session?.question_ids ?? [], [session]);
  const [questions, setQuestions] = useState([]);
  const [activeQuestionId, setActiveQuestionId] = useState(() => getActiveQuestionId(session, questionIds));
  const activeQuestionIndex = Math.max(0, questionIds.indexOf(activeQuestionId));
  const activeQuestionNumber = activeQuestionIndex + 1;
  const totalQuestions = Math.max(questionIds.length, 1);
  const activeQuestion = questions.find((question) => question.question_id === activeQuestionId);
  const isMcq = (activeQuestion?.options?.length ?? 0) > 0;
  const questionType = isMcq ? "MCQ" : "Short answer";
  const [selected, setSelected] = useState(() => getStoredAnswer(session?.session_id, getActiveQuestionId(session, questionIds)));
  const [timeLeft, setTimeLeft] = useState(QUESTION_DURATION_SECONDS);

  useEffect(() => {
    async function loadQuestions() {
      if (!session?.session_id) return;
      try {
        const result = await getLiveSessionQuestions(session.session_id);
        setQuestions(result);
      } catch (err) {
        showToast({ title: "Could not load live questions", description: err instanceof Error ? err.message : "Could not load live questions", tone: "error" });
      }
    }

    loadQuestions();
  }, [session?.session_id, showToast]);

  useEffect(() => {
    function syncActiveQuestion() {
      setActiveQuestionId(getActiveQuestionId(session, questionIds));
    }

    function handleActivatedQuestion(event) {
      if (!event.detail?.questionId) return;
      if (event.detail.sessionId && session?.session_id && event.detail.sessionId !== session.session_id) return;
      setActiveQuestionId(event.detail.questionId);
    }

    window.addEventListener("storage", syncActiveQuestion);
    window.addEventListener("live-question-activated", handleActivatedQuestion);
    return () => {
      window.removeEventListener("storage", syncActiveQuestion);
      window.removeEventListener("live-question-activated", handleActivatedQuestion);
    };
  }, [questionIds, session]);

  useEffect(() => {
    if (!session?.session_id) return undefined;
    const socket = new WebSocket(getWebSocketUrl(session.session_id));

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type !== "active_question" || !message.payload?.question_id) return;
        localStorage.setItem(`activeQuestionId:${session.session_id}`, message.payload.question_id);
        localStorage.setItem("activeQuestionId", message.payload.question_id);
        setActiveQuestionId(message.payload.question_id);
      } catch {
        // Ignore malformed live messages.
      }
    };

    return () => socket.close();
  }, [session?.session_id]);

  useEffect(() => {
    setSelected(getStoredAnswer(session?.session_id, activeQuestionId));
    setTimeLeft(QUESTION_DURATION_SECONDS);
  }, [activeQuestionId, questionIds.length, session?.session_id]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTimeLeft((current) => Math.max(current - 1, 0));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeQuestionId]);

  function handleSelect(answer) {
    localStorage.setItem(getAnswerKey(session?.session_id, activeQuestionId), answer);
    localStorage.setItem("selectedAnswer", answer);
    setSelected(answer);
  }

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Live question" title="Think, choose, and submit confidently" description="Your answer updates the instructor dashboard in real time." tone="emerald" />
      <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[1fr_320px]">
        <QuestionCard
          title={`Question ${activeQuestionNumber} of ${totalQuestions}`}
          subtitle={`ID: ${shortenQuestionId(activeQuestionId)}`}
          type={questionType}
          status="Live"
          prompt={activeQuestion?.question_text || "Waiting for the instructor to activate the next question."}
          options={activeQuestion?.options || []}
          selected={selected}
          onSelect={handleSelect}
        />

        <DashboardCard>
          <Badge tone="teal">Session {session?.session_code ?? "Demo"}</Badge>
          <div className="mt-5 grid gap-3">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                <Timer size={17} />
                Time left
              </span>
              <span className="font-black">{formatTime(timeLeft)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                <MessageSquareText size={17} />
                Format
              </span>
              <span className="font-black">{questionType}</span>
            </div>
          </div>
          {isMcq && !selected ? (
            <Button className="mt-5 w-full" size="lg" variant="success" disabled>
              Choose an answer first
            </Button>
          ) : (
            <Link to="/student/submit-answer" className="mt-5 block">
              <Button className="w-full" size="lg" variant="success">
                {isMcq ? "Submit answer" : "Write answer"}
              </Button>
            </Link>
          )}
        </DashboardCard>
      </div>
    </div>
  );
}
