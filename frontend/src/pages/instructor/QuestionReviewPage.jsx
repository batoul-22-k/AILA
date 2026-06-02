import { CheckCircle2, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  approveInstructorQuestion,
  deleteInstructorQuestion,
  listInstructorQuestions,
  regenerateInstructorQuestion,
  updateInstructorQuestion,
} from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";

export function QuestionReviewPage() {
  const { showToast } = useToast();
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const uploadId = localStorage.getItem("instructorUploadId");

  async function loadQuestions() {
    setLoading(true);
    try {
      const result = await listInstructorQuestions(uploadId ? { upload_id: uploadId } : {});
      setQuestions(result);
      localStorage.setItem("instructorGeneratedQuestions", JSON.stringify(result));
      localStorage.setItem("instructorApprovedQuestionIds", JSON.stringify(result.filter((q) => q.status === "approved").map((q) => q.question_id)));
    } catch (err) {
      showToast({ title: "Could not load questions", description: err instanceof Error ? err.message : "Could not load questions", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQuestions();
  }, []);

  function updateLocal(questionId, patch) {
    setQuestions((current) => current.map((question) => (question.question_id === questionId ? { ...question, ...patch } : question)));
  }

  async function handleSave(question) {
    try {
      const saved = await updateInstructorQuestion(question.question_id, question);
      updateLocal(question.question_id, saved);
      showToast({ title: "Question saved", description: "Your edits were saved.", tone: "success" });
    } catch (err) {
      showToast({ title: "Could not save question", description: err instanceof Error ? err.message : "Could not save question", tone: "error" });
    }
  }

  async function handleApprove(questionId) {
    try {
      const approved = await approveInstructorQuestion(questionId);
      updateLocal(questionId, approved);
      const approvedIds = questions
        .map((question) => (question.question_id === questionId ? approved : question))
        .filter((question) => question.status === "approved")
        .map((question) => question.question_id);
      localStorage.setItem("instructorApprovedQuestionIds", JSON.stringify(approvedIds));
      showToast({ title: "Question approved", description: "It is ready for classroom use.", tone: "success" });
    } catch (err) {
      showToast({ title: "Could not approve question", description: err instanceof Error ? err.message : "Could not approve question", tone: "error" });
    }
  }

  async function handleDelete(questionId) {
    try {
      await deleteInstructorQuestion(questionId);
      setQuestions((current) => current.filter((question) => question.question_id !== questionId));
      showToast({ title: "Question deleted", description: "The question was removed.", tone: "success" });
    } catch (err) {
      showToast({ title: "Could not delete question", description: err instanceof Error ? err.message : "Could not delete question", tone: "error" });
    }
  }

  async function handleRegenerate(question) {
    try {
      const regenerated = await regenerateInstructorQuestion({ upload_id: uploadId, question });
      updateLocal(question.question_id, regenerated);
      showToast({ title: "Question regenerated", description: "A new version is ready for review.", tone: "success" });
    } catch (err) {
      showToast({ title: "Could not regenerate question", description: err instanceof Error ? err.message : "Could not regenerate question", tone: "error" });
    }
  }

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Question review"
        title="Review, edit, and approve"
        description="Generated questions are editable. Only approved questions can be used for reconstructed slides and live sessions."
        tone="role"
        action={
          <Link to="/instructor/reconstruct">
            <Button variant="role">Reconstruct PPTX</Button>
          </Link>
        }
      />

      {loading && <DashboardCard>Loading generated questions...</DashboardCard>}
      {!loading && questions.length === 0 && <EmptyState title="No generated questions found" description="Generate and save questions before reviewing them." />}

      <div className="grid gap-4">
        {questions.map((question) => (
          <DashboardCard key={question.question_id}>
            <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={question.status === "approved" ? "green" : "gold"}>{question.status}</Badge>
                  <Badge tone="violet">{question.bloom_level}</Badge>
                  <Badge tone="slate">{question.difficulty}</Badge>
                </div>
                <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
                  Question
                  <textarea
                    className="focus-ring min-h-24 rounded-smart border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                    value={question.question_text}
                    onChange={(event) => updateLocal(question.question_id, { question_text: event.target.value })}
                  />
                </label>
                {question.type === "mcq" && (
                  <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
                    Options
                    <textarea
                      className="focus-ring min-h-28 rounded-smart border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      value={(question.options || []).join("\n")}
                      onChange={(event) => updateLocal(question.question_id, { options: event.target.value.split("\n").filter(Boolean) })}
                    />
                  </label>
                )}
                <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
                  Correct answer
                  <input
                    className="focus-ring h-11 rounded-smart border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                    value={question.correct_answer}
                    onChange={(event) => updateLocal(question.question_id, { correct_answer: event.target.value })}
                  />
                </label>
              </div>

              <div className="grid content-start gap-2">
                <Button variant="outline" type="button" onClick={() => handleSave(question)}>
                  <Save size={17} />
                  Save edit
                </Button>
                <Button variant="success" type="button" onClick={() => handleApprove(question.question_id)}>
                  <CheckCircle2 size={17} />
                  Approve
                </Button>
                <Button variant="outline" type="button" onClick={() => handleRegenerate(question)}>
                  <RefreshCw size={17} />
                  Regenerate
                </Button>
                <Button variant="outline" type="button" onClick={() => handleDelete(question.question_id)}>
                  <Trash2 size={17} />
                  Delete
                </Button>
              </div>
            </div>
          </DashboardCard>
        ))}
      </div>
    </div>
  );
}
