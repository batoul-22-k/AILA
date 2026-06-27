import { FileQuestion, Loader2, Save } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { generateInstructorQuestions, saveInstructorQuestions } from "../../api/client";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";

export function GeneratedQuestionsPage() {
  const { showToast } = useToast();
  const [questions, setQuestions] = useState(() => JSON.parse(localStorage.getItem("instructorGeneratedQuestions") || "[]"));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const uploadId = localStorage.getItem("instructorUploadId");
  const extractedText = localStorage.getItem("instructorExtractedText");

  async function handleGenerate() {
    setLoading(true);
    try {
      const result = await generateInstructorQuestions({ upload_id: uploadId, extracted_text: extractedText });
      setQuestions(result);
      localStorage.setItem("instructorGeneratedQuestions", JSON.stringify(result));
      showToast({ title: "Questions generated", tone: "success" });
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Question generation failed", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const saved = await saveInstructorQuestions({ upload_id: uploadId, questions });
      setQuestions(saved);
      localStorage.setItem("instructorGeneratedQuestions", JSON.stringify(saved));
      showToast({ title: "Saved", tone: "success" });
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not save generated questions", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-grid">
      <PageHeader
        title="Questions"
        description="Create questions from uploaded content."
        tone="role"
        action={
          <Button type="button" variant="role" loading={loading} onClick={handleGenerate} disabled={!uploadId && !extractedText}>
            <FileQuestion size={18} />
            Generate
          </Button>
        }
      />

      {!uploadId && !extractedText && (
        <EmptyState title="Upload content first" description="Add lecture material to begin." />
      )}

      {loading && (
        <DashboardCard className="text-center">
          <Loader2 className="mx-auto animate-spin text-role-text" size={34} />
          <p className="mt-3 text-sm font-bold text-slate-600 dark:text-slate-300">Generating questions...</p>
        </DashboardCard>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {questions.map((question, index) => (
          <DashboardCard key={question.question_id || index}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-role-text">{question.type}</p>
                <h2 className="mt-1 text-lg font-black text-slate-900 dark:text-white">{question.question_text}</h2>
              </div>
              <span className="rounded-full bg-role-hover px-2.5 py-1 text-xs font-black text-role-text">{question.difficulty}</span>
            </div>
            {question.options?.length > 0 && (
              <div className="mt-4 grid gap-2">
                {question.options.map((option) => (
                  <div key={option} className="rounded-smart bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                    {option}
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              <strong>Answer:</strong> {question.correct_answer}
            </p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{question.explanation}</p>
          </DashboardCard>
        ))}
      </div>

      {questions.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="role" loading={saving} onClick={handleSave}>
            <Save size={18} />
            Save
          </Button>
          <Link to="/instructor/questions">
            <Button type="button" variant="outline">Review</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
