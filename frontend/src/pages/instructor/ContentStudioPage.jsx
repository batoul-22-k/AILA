import {
  Check,
  CheckCircle2,
  Circle,
  Download,
  FileText,
  ListChecks,
  Loader2,
  Pencil,
  Radio,
  RefreshCw,
  Rocket,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  approveInstructorQuestion,
  createInstructorSession,
  downloadApiFile,
  generateInstructorQuestions,
  getAiStatus,
  getInstructorUpload,
  listClasses,
  listInstructorQuestions,
  reconstructInstructorPresentation,
  regenerateInstructorQuestion,
  saveInstructorQuestions,
  startAiService,
  uploadInstructorLecture,
} from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { useToast } from "../../components/ToastProvider";
import { useAuth } from "../../state/AuthContext";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";
import { cn } from "../../utils/cn";

const bloomOptions = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];
const defaultGenerationSettings = {
  mcq_count: 3,
  short_answer_count: 1,
  difficulty: "Easy",
  output_language: "en",
  bloom_preference: "auto",
  bloom_plan: [
    { level: "Remember", type: "mcq" },
    { level: "Understand", type: "mcq" },
    { level: "Apply", type: "mcq" },
    { level: "Analyze", type: "short_answer" },
    { level: "Evaluate", type: "skip" },
    { level: "Create", type: "skip" },
  ],
};

function getStoredJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function studioKey(classId, key) {
  return `contentStudio:${classId}:${key}`;
}

function orderQuestionsByIds(questions, orderedIds) {
  if (!orderedIds?.length) return questions;
  const byId = new Map(questions.map((question) => [question.question_id, question]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  const leftovers = questions.filter((question) => !orderedIds.includes(question.question_id));
  return [...ordered, ...leftovers];
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function UploadActionButton({ label = "Choose file", loading = false, disabled = false, onFile }) {
  return (
    <label className={cn("inline-flex", disabled && "pointer-events-none opacity-60")}>
      <input
        className="sr-only"
        type="file"
        accept=".pdf,.pptx"
        disabled={disabled}
        onClick={(event) => {
          event.currentTarget.value = "";
        }}
        onChange={(event) => onFile(event.target.files?.[0])}
      />
      <span className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-role-primary px-5 text-sm font-black text-white shadow-soft transition hover:brightness-95">
        {loading ? <Loader2 className="animate-spin" size={17} /> : <UploadCloud size={17} />}
        {loading ? "Uploading..." : label}
      </span>
    </label>
  );
}

function WorkflowHeader({
  className,
  classes,
  selectedClassId,
  onSelectClass,
  stats,
  activeStage,
  primaryAction,
}) {
  const statusLabel = {
    upload: "Waiting for material",
    analyze: "Analyzing lecture",
    generate: "Generating questions",
    review: "Needs instructor review",
    ready: "Classroom package ready",
  }[activeStage];

  return (
    <section className="rounded-[32px] border border-[var(--role-card-border)] bg-white p-5 shadow-[var(--role-card-shadow)] dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="role">Content Studio</Badge>
            <Badge tone={activeStage === "ready" ? "green" : activeStage === "review" ? "gold" : "slate"}>{statusLabel}</Badge>
          </div>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-role-text dark:text-white sm:text-3xl">{className}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)] dark:text-slate-300">
            Upload lecture material, watch the AI prepare assessment items, approve the final set, and launch a live classroom session from one workspace.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-[20px] border border-[var(--role-card-border)] bg-[var(--role-hover)] px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
                <p className="text-[11px] font-black uppercase tracking-wide text-[var(--color-muted)] dark:text-slate-400">{stat.label}</p>
                <p className="mt-1 text-sm font-black text-role-text dark:text-white">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid min-w-0 gap-3">
          <select
            className="adaptive-input focus-ring h-11 w-full border border-role-border px-4 text-sm font-bold"
            value={selectedClassId}
            onChange={(event) => onSelectClass(event.target.value)}
          >
            <option value="">Choose class</option>
            {classes.map((classDoc) => (
              <option key={classDoc.class_id} value={classDoc.class_id}>
                {classDoc.name}
              </option>
            ))}
          </select>
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
            {primaryAction}
            <Link className="inline-flex h-11 items-center justify-center rounded-full border border-role-border bg-white px-4 text-sm font-black text-role-text hover:bg-role-hover dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" to="/instructor/classes">
              Manage Classes
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function UploadLectureStep({
  selectedFile,
  isUploading,
  progress,
  error,
  generationSettings,
  setGenerationSettings,
  onFile,
}) {
  const [dragging, setDragging] = useState(false);

  function handleFile(nextFile) {
    if (!nextFile) return;
    onFile(nextFile);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <DashboardCard
        className={cn("grid min-h-80 place-items-center border-dashed bg-white text-center", dragging && "border-role-primary bg-role-soft")}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFile(event.dataTransfer.files?.[0]);
        }}
      >
        <div className="max-w-md">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-role-soft text-role-primary">
            <UploadCloud size={28} />
          </span>
          <h2 className="mt-4 text-xl font-black text-role-text dark:text-white">Upload lecture material</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)] dark:text-slate-400">
            Drop a PPTX or PDF. Choosing a file uploads, analyzes, generates, and opens review automatically.
          </p>
          <div className="mt-5">
            <UploadActionButton label="Choose file" loading={isUploading} disabled={isUploading} onFile={handleFile} />
          </div>
          <div className="mt-5 text-sm">
            <p className="font-black text-role-text dark:text-white">{selectedFile?.name ?? "No file selected"}</p>
            <p className="mt-1 text-xs font-semibold text-[var(--color-muted)] dark:text-slate-400">Supported files: PPTX, PDF</p>
          </div>
          {(selectedFile || isUploading) && (
            <div className="mx-auto mt-5 h-3 max-w-md overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-role-primary transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </DashboardCard>
      <GenerationSettingsPanel generationSettings={generationSettings} setGenerationSettings={setGenerationSettings} disabled={isUploading} />
    </div>
  );
}

function questionTypeLabel(type) {
  return type === "mcq" ? "MCQ" : "Short answer";
}

function buildGenerationPlan(settings) {
  const mcqCount = Math.max(0, Number(settings.mcq_count || 0));
  const shortAnswerCount = Math.max(0, Number(settings.short_answer_count || 0));
  const autoMcqLevels = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];
  const autoShortLevels = ["Analyze", "Evaluate", "Create", "Understand", "Apply", "Remember"];
  const preferredLevel = settings.bloom_preference && settings.bloom_preference !== "auto" ? settings.bloom_preference : null;
  const plan = [];

  for (let index = 0; index < mcqCount; index += 1) {
    plan.push({ type: "mcq", level: preferredLevel || autoMcqLevels[index % autoMcqLevels.length] });
  }
  for (let index = 0; index < shortAnswerCount; index += 1) {
    plan.push({ type: "short_answer", level: preferredLevel || autoShortLevels[index % autoShortLevels.length] });
  }
  return plan;
}

function NumberStepper({ label, value, min, max, disabled, onChange }) {
  return (
    <div className="rounded-[24px] border border-[var(--role-card-border)] bg-[var(--role-hover)] p-3 dark:border-slate-800 dark:bg-slate-950">
      <p className="text-xs font-black uppercase tracking-wide text-[var(--color-muted)] dark:text-slate-400">{label}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          className="grid h-9 w-9 place-items-center rounded-full border border-role-border bg-white text-lg font-black text-role-text disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          type="button"
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          -
        </button>
        <span className="text-2xl font-black text-role-text dark:text-white">{value}</span>
        <button
          className="grid h-9 w-9 place-items-center rounded-full border border-role-border bg-white text-lg font-black text-role-text disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          type="button"
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}

function SegmentedControl({ label, value, options, disabled, onChange }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-wide text-[var(--color-muted)] dark:text-slate-400">{label}</p>
      <div className="mt-2 grid grid-cols-3 rounded-full border border-role-border bg-role-hover p-1 dark:border-slate-800 dark:bg-slate-950">
        {options.map((option) => (
          <button
            key={option.value}
            className={cn(
              "h-9 rounded-full text-xs font-black transition",
              value === option.value ? "bg-white text-role-primary shadow-sm dark:bg-slate-800 dark:text-blue-200" : "text-[var(--color-muted)] hover:text-role-text dark:text-slate-400 dark:hover:text-white",
            )}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function GenerationSettingsPanel({ generationSettings, setGenerationSettings, disabled }) {
  return (
    <DashboardCard className="bg-white">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-role-primary">Generation settings</p>
        <h2 className="mt-1 text-lg font-black text-role-text dark:text-white">Question mix</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--color-muted)] dark:text-slate-400">Set this before upload. The file starts generation immediately.</p>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <NumberStepper
            label="MCQs"
            min={0}
            max={6}
            disabled={disabled}
            value={Number(generationSettings.mcq_count || 0)}
            onChange={(value) => setGenerationSettings({ ...generationSettings, mcq_count: value })}
          />
          <NumberStepper
            label="Short answer"
            min={0}
            max={3}
            disabled={disabled}
            value={Number(generationSettings.short_answer_count || 0)}
            onChange={(value) => setGenerationSettings({ ...generationSettings, short_answer_count: value })}
          />
        </div>

        <SegmentedControl
          label="Difficulty"
          value={generationSettings.difficulty}
          disabled={disabled}
          options={[
            { label: "Easy", value: "Easy" },
            { label: "Medium", value: "Medium" },
            { label: "Hard", value: "Hard" },
          ]}
          onChange={(value) => setGenerationSettings({ ...generationSettings, difficulty: value })}
        />

        <div className="grid gap-2">
          <label className="grid gap-1.5 text-xs font-black uppercase tracking-wide text-[var(--color-muted)] dark:text-slate-400">
            Language
            <select
              className="adaptive-input focus-ring h-11 border border-role-border px-4 text-sm font-bold"
              disabled={disabled}
              value={generationSettings.output_language}
              onChange={(event) => setGenerationSettings({ ...generationSettings, output_language: event.target.value })}
            >
              <option value="en">English</option>
              <option value="ar">Arabic</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-black uppercase tracking-wide text-[var(--color-muted)] dark:text-slate-400">
            Bloom focus
            <select
              className="adaptive-input focus-ring h-11 border border-role-border px-4 text-sm font-bold"
              disabled={disabled}
              value={generationSettings.bloom_preference || "auto"}
              onChange={(event) => setGenerationSettings({ ...generationSettings, bloom_preference: event.target.value })}
            >
              <option value="auto">Auto balanced</option>
              {bloomOptions.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </DashboardCard>
  );
}

function getQuestionKey(question, index = 0) {
  return question.question_id || `${question.type}-${index}`;
}

function isQuestionApproved(question, savedQuestions) {
  return savedQuestions.some((item) => item.question_id === question.question_id);
}

function getQuestionReviewStatus(question, savedQuestions) {
  if (isQuestionApproved(question, savedQuestions)) return "approved";
  if (!question.correct_answer || !question.explanation) return "needs edit";
  return "pending";
}

function getQuestionConfidence(question, index) {
  const rawScore = question.confidence_score ?? question.confidence ?? question.ai_confidence;
  if (typeof rawScore === "number") return rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore);
  return Math.max(82, 94 - index * 3);
}

function QuestionReviewCard({
  question,
  index,
  total,
  status,
  editing,
  busy,
  onPatch,
  onApprove,
  onEdit,
  onCancelEdit,
  onRegenerate,
}) {
  if (!question) return null;
  const isMcq = question.type === "mcq";
  const confidence = getQuestionConfidence(question, index);
  const statusTone = status === "approved" ? "green" : status === "needs edit" ? "gold" : "slate";

  return (
    <DashboardCard className="border-[var(--role-card-border)] bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone}>{status}</Badge>
          <Badge tone="violet">{questionTypeLabel(question.type)}</Badge>
          <Badge tone="slate">{question.bloom_level || "Bloom pending"}</Badge>
          <Badge tone="slate">{question.difficulty || "Difficulty pending"}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="green">{confidence}% confidence</Badge>
          <Badge tone="slate">{index + 1} / {total}</Badge>
        </div>
      </div>

      <div className="mt-5">
        {editing ? (
          <label className="grid gap-2 text-sm font-black text-role-text dark:text-slate-200">
            Question text
            <textarea
              className="adaptive-input focus-ring min-h-28 rounded-[24px] border border-role-border px-4 py-3 text-sm"
              value={question.question_text}
              onChange={(event) => onPatch(question.question_id, { question_text: event.target.value })}
            />
          </label>
        ) : (
          <h3 className="text-lg font-black leading-8 text-role-text dark:text-white">{question.question_text}</h3>
        )}
      </div>

      {isMcq && (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {(question.options || []).map((option, optionIndex) => (
            <div key={`${option}-${optionIndex}`} className="rounded-[20px] border border-role-border bg-role-hover px-3 py-3 text-sm font-semibold text-role-text dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              <span className="mr-2 font-black text-role-primary">{String.fromCharCode(65 + optionIndex)}.</span>
              {option}
            </div>
          ))}
        </div>
      )}

      {editing && isMcq && (
        <label className="mt-4 grid gap-2 text-sm font-black text-role-text dark:text-slate-200">
          Options
          <textarea
            className="adaptive-input focus-ring min-h-24 rounded-[24px] border border-role-border px-4 py-3 text-sm"
            value={(question.options || []).join("\n")}
            onChange={(event) => onPatch(question.question_id, { options: event.target.value.split("\n").filter(Boolean) })}
          />
        </label>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-black text-role-text dark:text-slate-200">
          {isMcq ? "Correct answer" : "Suggested answer"}
          {editing ? (
            <input
              className="adaptive-input focus-ring h-11 border border-role-border px-4 text-sm"
              value={question.correct_answer || ""}
              onChange={(event) => onPatch(question.question_id, { correct_answer: event.target.value })}
            />
          ) : (
            <span className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100">
              {question.correct_answer || "Not provided"}
            </span>
          )}
        </label>
        <label className="grid gap-2 text-sm font-black text-role-text dark:text-slate-200">
          Explanation
          {editing ? (
            <textarea
              className="adaptive-input focus-ring min-h-24 rounded-[24px] border border-role-border px-4 py-3 text-sm"
              value={question.explanation || ""}
              onChange={(event) => onPatch(question.question_id, { explanation: event.target.value })}
            />
          ) : (
            <span className="rounded-[20px] border border-role-border bg-role-hover px-3 py-3 text-sm font-semibold leading-6 text-[var(--color-muted)] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              {question.explanation || "No explanation generated yet."}
            </span>
          )}
        </label>
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="success" onClick={() => onApprove(question)} loading={busy} disabled={busy || status === "approved"}>
          <Check size={17} />
          {status === "approved" ? "Approved" : "Approve"}
        </Button>
        <Button type="button" variant="outline" onClick={editing ? onCancelEdit : () => onEdit(question.question_id)} disabled={busy}>
          <Pencil size={17} />
          {editing ? "Done editing" : "Edit"}
        </Button>
        <Button type="button" variant="outline" onClick={() => onRegenerate(question, index)} loading={busy}>
          <RefreshCw size={17} />
          Regenerate
        </Button>
      </div>
    </DashboardCard>
  );
}

function getProcessingState({ upload, selectedFile, extractedText, generatedQuestions, generationProgress, generationLabel, isUploading, isExtracting, isGenerating, isThinking, error }) {
  const total = Math.max(generationProgress.total || generatedQuestions.length || 1, 1);
  const generationPercent = Math.round(((generationProgress.current || 0) / total) * 100);
  if (error) {
    return {
      tone: "error",
      title: "Needs attention",
      description: error,
      progress: Math.max(8, generationPercent),
      icon: FileText,
    };
  }
  if (isUploading) {
    return {
      tone: "running",
      title: "Uploading lecture material",
      description: selectedFile?.name || "Sending the file to Content Studio.",
      progress: 18,
      icon: UploadCloud,
    };
  }
  if (isExtracting) {
    return {
      tone: "running",
      title: "Extracting lecture text",
      description: upload?.filename || selectedFile?.name || "Reading your slides and notes.",
      progress: 35,
      icon: FileText,
    };
  }
  if (isGenerating || isThinking) {
    return {
      tone: "running",
      title: "Generating questions",
      description: generationLabel || "Creating the classroom question pack.",
      progress: Math.max(42, generationPercent),
      icon: Sparkles,
    };
  }
  if (generatedQuestions.length > 0) {
    return {
      tone: "complete",
      title: "Ready for review",
      description: `${generatedQuestions.length} questions are ready for instructor review.`,
      progress: 100,
      icon: CheckCircle2,
    };
  }
  if (extractedText) {
    return {
      tone: "running",
      title: "Lecture analyzed",
      description: `${extractedText.length.toLocaleString()} characters extracted. Preparing generation.`,
      progress: 50,
      icon: FileText,
    };
  }
  return {
    tone: "idle",
    title: "Waiting for upload",
    description: "Choose a PPTX or PDF to start.",
    progress: 0,
    icon: UploadCloud,
  };
}

function AIProcessingCard({ state, upload, selectedFile, extractedText, generatedQuestions }) {
  const Icon = state.icon;
  const toneClass = {
    idle: "bg-slate-50 text-slate-600 border-slate-200",
    running: "bg-role-soft text-role-primary border-role-border",
    complete: "bg-emerald-50 text-emerald-700 border-emerald-200",
    error: "bg-red-50 text-red-700 border-red-200",
  }[state.tone];
  const fileName = upload?.filename || selectedFile?.name || "No file selected";

  return (
    <DashboardCard className="bg-white">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-xl border", toneClass)}>
              {state.tone === "running" ? <Loader2 className="animate-spin" size={23} /> : <Icon size={23} />}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">AI thinking timeline</p>
              <h2 className="mt-1 truncate text-2xl font-black text-role-text dark:text-white">{state.title}</h2>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--color-muted)] dark:text-slate-400">{state.description}</p>
          <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-role-primary transition-all duration-500" style={{ width: `${state.progress}%` }} />
          </div>
        </div>

        <div className="grid gap-2 rounded-[24px] border border-role-border bg-role-hover p-4 dark:border-slate-800 dark:bg-slate-950">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wide text-[var(--color-muted)] dark:text-slate-400">File</p>
            <p className="mt-1 truncate text-sm font-black text-role-text dark:text-white">{fileName}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[18px] bg-white p-3 dark:bg-slate-900">
              <p className="text-[11px] font-black uppercase tracking-wide text-[var(--color-muted)]">Text</p>
              <p className="mt-1 text-sm font-black text-role-text dark:text-white">{extractedText ? extractedText.length.toLocaleString() : "0"}</p>
            </div>
            <div className="rounded-[18px] bg-white p-3 dark:bg-slate-900">
              <p className="text-[11px] font-black uppercase tracking-wide text-[var(--color-muted)]">Questions</p>
              <p className="mt-1 text-sm font-black text-role-text dark:text-white">{generatedQuestions.length}</p>
            </div>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}

function QuestionReviewFeed({ questions, savedQuestions, editingQuestionId, busy, onPatch, onApprove, onApproveAll, onEdit, onCancelEdit, onRegenerate }) {
  if (questions.length === 0) {
    return (
    <DashboardCard className="grid min-h-72 place-items-center bg-white text-center">
        <div className="max-w-md">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-role-soft text-role-primary">
            <Sparkles size={26} />
          </span>
          <h2 className="mt-4 text-xl font-black text-role-text dark:text-white">Waiting for generated questions</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)] dark:text-slate-400">The review feed will appear here as soon as the AI finishes preparing the classroom questions.</p>
        </div>
      </DashboardCard>
    );
  }

  const pendingCount = questions.filter((question) => getQuestionReviewStatus(question, savedQuestions) !== "approved").length;

  return (
    <div className="grid gap-4">
      <DashboardCard className="bg-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-role-primary">Instructor review</p>
            <h2 className="mt-1 text-xl font-black text-role-text dark:text-white">Generated question feed</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--color-muted)] dark:text-slate-400">
              {pendingCount} questions still need approval before the classroom package is ready.
            </p>
          </div>
          <Button type="button" variant="success" onClick={onApproveAll} loading={busy} disabled={busy || pendingCount === 0}>
            <CheckCircle2 size={17} />
            Approve all
          </Button>
        </div>
      </DashboardCard>
      {questions.map((question, index) => (
        <QuestionReviewCard
          key={getQuestionKey(question, index)}
          question={question}
          index={index}
          total={questions.length}
          status={getQuestionReviewStatus(question, savedQuestions)}
          editing={editingQuestionId === question.question_id}
          busy={busy}
          onPatch={onPatch}
          onApprove={onApprove}
          onEdit={onEdit}
          onCancelEdit={onCancelEdit}
          onRegenerate={onRegenerate}
        />
      ))}
    </div>
  );
}

function getReadinessChecks({ generatedQuestions, savedQuestions, createdSession }) {
  const generated = generatedQuestions.length > 0;
  const bloomLevels = new Set(generatedQuestions.map((question) => question.bloom_level).filter(Boolean));
  const difficultyLevels = new Set(generatedQuestions.map((question) => question.difficulty).filter(Boolean));
  return [
    { label: "Questions generated", complete: generated },
    { label: "Bloom coverage", complete: generated && bloomLevels.size >= Math.min(3, generatedQuestions.length) },
    { label: "Difficulty balance", complete: generated && (difficultyLevels.size >= 2 || generatedQuestions.length <= 2) },
    { label: "Explanations created", complete: generated && generatedQuestions.every((question) => Boolean(question.explanation)) },
    { label: "Session ready", complete: Boolean(createdSession) || (generated && savedQuestions.length === generatedQuestions.length) },
  ];
}

function QuestionQueue({ questions, savedQuestions }) {
  const typeCounts = { mcq: 0, short_answer: 0 };

  return (
    <DashboardCard className="bg-white">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">Question queue</p>
          <h2 className="mt-1 text-base font-black text-role-text dark:text-white">{questions.length} generated</h2>
        </div>
        <ListChecks size={20} className="text-role-primary" />
      </div>
      <div className="mt-4 grid gap-2">
        {questions.length === 0 && <p className="rounded-[20px] bg-role-hover px-3 py-3 text-sm font-semibold text-[var(--color-muted)] dark:bg-slate-950 dark:text-slate-400">No questions generated yet.</p>}
        {questions.map((question, index) => {
          typeCounts[question.type] = (typeCounts[question.type] || 0) + 1;
          const label = question.type === "mcq" ? `MCQ ${typeCounts[question.type]}` : `Short Answer ${typeCounts[question.type]}`;
          const status = getQuestionReviewStatus(question, savedQuestions);
          const statusClass = status === "approved" ? "text-emerald-700 bg-emerald-50" : status === "needs edit" ? "text-amber-700 bg-amber-50" : "text-[var(--color-muted)] bg-role-hover";
          return (
            <div key={getQuestionKey(question, index)} className="rounded-[22px] border border-role-border bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black text-role-text dark:text-white">{label}</p>
                <span className={cn("rounded-full px-2 py-1 text-[11px] font-black uppercase", statusClass)}>{status}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-[var(--color-muted)] dark:text-slate-400">{question.question_text}</p>
            </div>
          );
        })}
      </div>
    </DashboardCard>
  );
}

function ClassroomReadinessCard({ generatedQuestions, savedQuestions, createdSession }) {
  const checks = getReadinessChecks({ generatedQuestions, savedQuestions, createdSession });
  const score = Math.round((checks.filter((check) => check.complete).length / checks.length) * 100);

  return (
    <DashboardCard className="bg-white">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">Classroom readiness</p>
          <h2 className="mt-1 text-3xl font-black text-role-text dark:text-white">{score}%</h2>
        </div>
        <span className={cn("grid h-12 w-12 place-items-center rounded-full", score === 100 ? "bg-emerald-50 text-emerald-700" : "bg-role-soft text-role-primary")}>
          <Rocket size={23} />
        </span>
      </div>
      <div className="mt-4 grid gap-2">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-2 text-sm font-semibold text-role-text dark:text-slate-200">
            {check.complete ? <CheckCircle2 size={17} className="text-emerald-600" /> : <Circle size={15} className="text-[#94A3B8]" />}
            {check.label}
          </div>
        ))}
      </div>
    </DashboardCard>
  );
}

function StudioSidePanel({ questions, savedQuestions, createdSession, aiPanel }) {
  return (
    <aside className="grid content-start gap-4 md:grid-cols-2 2xl:sticky 2xl:top-24 2xl:grid-cols-1">
      <QuestionQueue questions={questions} savedQuestions={savedQuestions} />
      <ClassroomReadinessCard generatedQuestions={questions} savedQuestions={savedQuestions} createdSession={createdSession} />
      <div className="md:col-span-2 2xl:col-span-1">{aiPanel}</div>
    </aside>
  );
}

export function WorkflowActionBar({
  approvedCount,
  canDownload,
  canCreateSession,
  isReconstructing,
  isCreatingSession,
  presentation,
  createdSession,
  onDownloadPptx,
  onDownloadReady,
  onCreateSession,
}) {
  return (
    <DashboardCard>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Saved classroom output</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{approvedCount} saved questions are ready for slides or a live session.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="role" loading={isReconstructing} onClick={onDownloadPptx} disabled={!canDownload}>
            <Download size={17} />
            Download Updated PPTX
          </Button>
          <Button type="button" variant="success" loading={isCreatingSession} onClick={onCreateSession} disabled={!canCreateSession}>
            <Radio size={17} />
            Create Live Session
          </Button>
        </div>
      </div>
      {(presentation || createdSession) && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {presentation && (
            <button className="rounded-[24px] bg-role-hover p-4 text-left text-sm font-black text-role-primary" type="button" onClick={() => onDownloadReady(presentation)}>
              Download ready: {presentation.filename}
            </button>
          )}
          {createdSession && (
            <Link className="rounded-[24px] bg-emerald-50 p-4 text-sm font-black text-emerald-700" to={`/instructor/live/${createdSession.session_id}`}>
              Live session ready: {createdSession.session_code}
            </Link>
          )}
        </div>
      )}
    </DashboardCard>
  );
}

/* function WorkflowSummary({ upload, uploadId, generatedCount, approvedCount, currentStep, presentation, createdSession }) {
  const nextAction = {
    upload: "Upload a PPTX or PDF.",
    extract: "Confirm the extracted text and generate questions.",
    generate: "Wait for AI generation to finish.",
    review: approvedCount > 0 ? "Download a PPTX or create a live session." : "Approve at least one question.",
  }[currentStep]; */

 /*  return (
    <DashboardCard className="lg:sticky lg:top-24">
      <h2 className="text-base font-black text-slate-950 dark:text-white">Workflow summary</h2>
      <div className="mt-4 grid gap-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-slate-500 dark:text-slate-400">File</span>
          <span className="text-right font-black text-slate-800 dark:text-slate-100">{upload?.filename ?? "Not uploaded"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-slate-500 dark:text-slate-400">Upload ID</span>
          <span className="max-w-40 truncate text-right font-black text-slate-800 dark:text-slate-100">{uploadId ?? "None"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-slate-500 dark:text-slate-400">Generated</span>
          <span className="font-black text-slate-800 dark:text-slate-100">{generatedCount}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-slate-500 dark:text-slate-400">Approved</span>
          <span className="font-black text-slate-800 dark:text-slate-100">{approvedCount}</span>
        </div>
      </div>
      <div className="mt-5 rounded-[var(--role-radius)] bg-role-hover p-4">
        <p className="text-xs font-black uppercase tracking-wide text-role-accent">Next recommended action</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200">{nextAction}</p>
      </div>
      {presentation && <Badge className="mt-4" tone="green">PPTX ready</Badge>}
      {createdSession && <Badge className="mt-4" tone="green">Session created</Badge>}
    </DashboardCard>
  );
}
 */
function AiServicePanel({ status, checking, starting, onRefresh, onStart }) {
  const running = Boolean(status?.running);
  const modelReady = Boolean(status?.model_available);

  return (
    <DashboardCard>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={running && modelReady ? "green" : running ? "gold" : "red"}>
              {running && modelReady ? "Engine Ready" : running ? "Model Missing" : "Engine Offline"}
            </Badge>
            {status?.model && <Badge tone="slate">{status.model}</Badge>}
          </div>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
            {checking ? "Checking Ollama..." : status?.message || "Check the local Ollama service before generating questions."}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onRefresh} disabled={checking}>
            <RefreshCw size={16} />
            Check
          </Button>
          <Button type="button" variant="role" onClick={onStart} loading={starting} disabled={running && modelReady}>
            <FileText size={16} />
            Start engine
          </Button>
        </div>
      </div>
    </DashboardCard>
  );
}

export function ContentStudioPage() {
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const { showToast } = useToast();
  const instructorWorkspace = currentWorkspace?.type === "instructor" ? currentWorkspace : null;
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState(() => localStorage.getItem("instructorSelectedClassId") || instructorWorkspace?.class_id || "");
  const classId = selectedClassId;
  const [currentStep, setCurrentStep] = useState("upload");
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadId, setUploadId] = useState(null);
  const [upload, setUpload] = useState(null);
  const [extractedText, setExtractedText] = useState("");
  const [generatedQuestions, setGeneratedQuestions] = useState([]);
  const [savedQuestions, setSavedQuestions] = useState([]);
  const [generationPhase, setGenerationPhase] = useState("idle");
  const [isThinking, setIsThinking] = useState(false);
  const [editingSavedQuestionId, setEditingSavedQuestionId] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isReconstructing, setIsReconstructing] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generationSettings, setGenerationSettings] = useState(() => ({
    ...defaultGenerationSettings,
    ...getStoredJson("contentStudio:generationSettings", {}),
  }));
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  const [generationLabel, setGenerationLabel] = useState("Ready to generate questions");
  const [error, setError] = useState("");
  const [presentation, setPresentation] = useState(null);
  const [createdSession, setCreatedSession] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [isCheckingAi, setIsCheckingAi] = useState(false);
  const [isStartingAi, setIsStartingAi] = useState(false);

  const approvedCount = savedQuestions.length;
  const approvedQuestionIds = useMemo(() => savedQuestions.map((question) => question.question_id).filter(Boolean), [savedQuestions]);
  function notifySuccess(title, description) {
    showToast({ title, description, tone: "success" });
  }

  function notifyError(err, fallback) {
    const description = err instanceof Error ? err.message : fallback;
    showToast({ title: "Action could not be completed", description, tone: "error" });
  }

  useEffect(() => {
    async function loadClasses() {
    try {
      const result = await listClasses();
        setClasses(result);
        const availableIds = result.map((classDoc) => classDoc.class_id);
        const nextClassId =
          (availableIds.includes(selectedClassId) && selectedClassId) ||
          (instructorWorkspace?.class_id && availableIds.includes(instructorWorkspace.class_id) && instructorWorkspace.class_id) ||
          result[0]?.class_id ||
          "";
        if (nextClassId) {
          setSelectedClassId(nextClassId);
          localStorage.setItem("instructorSelectedClassId", nextClassId);
        }
    } catch (err) {
        notifyError(err, "Could not load classes");
      }
    }
    loadClasses();
  }, [instructorWorkspace?.class_id, selectedClassId]);

  async function refreshAiStatus() {
    setIsCheckingAi(true);
    try {
      const status = await getAiStatus();
      setAiStatus(status);
      return status;
    } catch (err) {
      const offline = {
        running: false,
        model_available: false,
        message: err instanceof Error ? err.message : "Could not check AI service",
      };
      setAiStatus(offline);
      return offline;
    } finally {
      setIsCheckingAi(false);
    }
  }

  async function handleStartAi() {
    setIsStartingAi(true);
    setError("");
    try {
      const status = await startAiService();
      setAiStatus(status);
      if (!status.model_available) {
        notifyError(new Error(`Ollama is running, but model '${status.model}' is not available. Run: ollama pull ${status.model}`), "AI model is not available");
      }
      return status;
    } catch (err) {
      notifyError(err, "Could not start AI service");
      return null;
    } finally {
      setIsStartingAi(false);
    }
  }

  useEffect(() => {
    refreshAiStatus();
  }, []);

  useEffect(() => {
    if (!classId) return;
    setUpload(null);
    setPresentation(null);
    setCreatedSession(null);
    const storedUploadId = localStorage.getItem(studioKey(classId, "uploadId"));
    const storedText = localStorage.getItem(studioKey(classId, "extractedText")) || "";
    const storedQuestions = getStoredJson(studioKey(classId, "questions"), []);
    const storedApproved = getStoredJson(studioKey(classId, "approvedQuestionIds"), []);
    const storedSaved = orderQuestionsByIds(
      storedQuestions.filter((question) => storedApproved.includes(question.question_id) || question.status === "approved"),
      storedApproved,
    );
    setUploadId(storedUploadId);
    setExtractedText(storedText);
    setGeneratedQuestions(storedQuestions);
    setSavedQuestions(storedSaved);
    setGenerationPhase(storedQuestions.length > 0 && storedSaved.length < storedQuestions.length ? "reviewing" : "idle");
    if (storedSaved.length > 0) setCurrentStep("saved");
    else if (storedText) setCurrentStep("generate");
    else setCurrentStep("upload");
  }, [classId]);

  useEffect(() => {
    async function reloadWorkflow() {
      if (!classId || !uploadId) return;
      setIsExtracting(true);
      try {
        const [uploadResult, questionsResult] = await Promise.all([
          getInstructorUpload(uploadId),
          listInstructorQuestions({ upload_id: uploadId }).catch(() => []),
        ]);
        const text = uploadResult.cleaned_text || uploadResult.extracted_text || "";
        const approvedIds = questionsResult.filter((question) => question.status === "approved").map((question) => question.question_id);
        const storedOrder = getStoredJson(studioKey(classId, "approvedQuestionIds"), approvedIds);
        const savedResult = orderQuestionsByIds(
          questionsResult.filter((question) => question.status === "approved"),
          storedOrder,
        );
        setUpload(uploadResult);
        setExtractedText(text);
        setGeneratedQuestions(questionsResult);
        setSavedQuestions(savedResult);
        localStorage.setItem(studioKey(classId, "extractedText"), text);
        localStorage.setItem(studioKey(classId, "questions"), JSON.stringify(questionsResult));
        if (savedResult.length > 0) setCurrentStep("saved");
        else if (text) setCurrentStep("extract");
      } catch {
        localStorage.removeItem(studioKey(classId, "uploadId"));
      } finally {
        setIsExtracting(false);
      }
    }
    reloadWorkflow();
  }, [classId, uploadId]);

  useEffect(() => {
    const savedIds = savedQuestions.map((question) => question.question_id).filter(Boolean);
    if (classId) localStorage.setItem(studioKey(classId, "approvedQuestionIds"), JSON.stringify(savedIds));
    localStorage.setItem("instructorApprovedQuestionIds", JSON.stringify(savedIds));
  }, [savedQuestions, classId]);

  useEffect(() => {
    localStorage.setItem("contentStudio:generationSettings", JSON.stringify(generationSettings));
  }, [generationSettings]);

  useEffect(() => {
    if (classId) localStorage.setItem(studioKey(classId, "questions"), JSON.stringify(generatedQuestions));
  }, [generatedQuestions, classId]);

  function handleClassSelect(nextClassId) {
    setSelectedClassId(nextClassId);
    if (nextClassId) {
      localStorage.setItem("instructorSelectedClassId", nextClassId);
      const classDoc = classes.find((item) => item.class_id === nextClassId);
      if (classDoc) localStorage.setItem("instructorSelectedClassName", classDoc.name);
    }
  }

  function handleFile(file) {
    const suffix = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "pptx"].includes(suffix)) {
      notifyError(new Error("Only PPTX and PDF files are supported."), "Unsupported file");
      setSelectedFile(null);
      return;
    }
    setError("");
    setSelectedFile(file);
    setProgress(0);
    void handleUpload(file);
  }

  async function handleUpload(fileOverride) {
    const activeFile = fileOverride ?? selectedFile;
    if (!activeFile || !classId || isUploading) return;
    setIsUploading(true);
    setError("");
    try {
      const result = await uploadInstructorLecture(activeFile, setProgress, classId);
      const text = result.cleaned_text || result.extracted_text || "";
      setUpload(result);
      setUploadId(result.upload_id);
      setExtractedText(text);
      setGeneratedQuestions([]);
      setSavedQuestions([]);
      setGenerationPhase("idle");
      setEditingSavedQuestionId(null);
      localStorage.setItem(studioKey(classId, "uploadId"), result.upload_id);
      localStorage.setItem(studioKey(classId, "extractedText"), text);
      localStorage.setItem(studioKey(classId, "questions"), JSON.stringify([]));
      localStorage.setItem(studioKey(classId, "approvedQuestionIds"), JSON.stringify([]));
      setCurrentStep("generate");
      notifySuccess("Lecture uploaded", "Text was extracted. Generation is starting now.");
      setIsUploading(false);
      await handleGenerate({ uploadId: result.upload_id, extractedText: text });
    } catch (err) {
      notifyError(err, "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleGenerate(source = {}) {
    const activeUploadId = source.uploadId ?? uploadId;
    const activeExtractedText = source.extractedText ?? extractedText;
    setCurrentStep("generate");
    setIsGenerating(true);
    setIsThinking(true);
    setGenerationPhase("thinking");
    setError("");
    const activePlan = buildGenerationPlan(generationSettings);
    setGenerationProgress({ current: 0, total: activePlan.length });
    setGenerationLabel("Preparing AI question generation...");
    try {
      if (activePlan.length === 0) throw new Error("Advanced options must include at least one question.");
      if (!activeUploadId || !activeExtractedText) throw new Error("Upload a lecture before generating questions.");
      let status = await refreshAiStatus();
      if (!status.running) status = await handleStartAi();
      if (!status?.running) throw new Error("AI service is offline. Start Ollama and try again.");
      if (!status.model_available) throw new Error(`Ollama model '${status.model}' is missing. Run: ollama pull ${status.model}`);
      const generatedQuestionsBatch = [];
      for (const [index, planItem] of activePlan.entries()) {
        setGenerationLabel(`Thinking about a ${planItem.level} ${questionTypeLabel(planItem.type)} question...`);
        setGenerationProgress({ current: index, total: activePlan.length });
        setIsThinking(true);
        await sleep(350);
        const generated = await generateInstructorQuestions({
          upload_id: activeUploadId,
          extracted_text: activeExtractedText,
          question_type: planItem.type,
          bloom_level: planItem.level,
          difficulty: generationSettings.difficulty,
          output_language: generationSettings.output_language,
          question_index: index + 1,
          avoid_questions: generatedQuestionsBatch.map((question) => question.question_text).filter(Boolean),
        });
        generatedQuestionsBatch.push(...generated);
        setGenerationProgress({ current: index + 1, total: activePlan.length });
      }
      setGeneratedQuestions(generatedQuestionsBatch);
      setEditingSavedQuestionId(null);
      localStorage.setItem(studioKey(classId, "questions"), JSON.stringify(generatedQuestionsBatch));
      setGenerationLabel("Question ready for review.");
      setGenerationPhase(generatedQuestionsBatch.length > 0 ? "reviewing" : "complete");
      if (generatedQuestionsBatch.length > 0) setCurrentStep("saved");
      notifySuccess("Questions generated", `${generatedQuestionsBatch.length} questions are ready for review.`);
    } catch (err) {
      notifyError(err, "Question generation failed");
      setGenerationPhase("idle");
    } finally {
      setIsGenerating(false);
      setIsThinking(false);
    }
  }

  function handleQuestionChange(questionId, patch) {
    setSavedQuestions((current) => current.map((question) => (question.question_id === questionId ? { ...question, ...patch } : question)));
    setGeneratedQuestions((current) => current.map((question) => (question.question_id === questionId ? { ...question, ...patch } : question)));
  }

  async function handleApproveQuestion(question) {
    if (!question || savedQuestions.some((item) => item.question_id === question.question_id)) return;
    setIsApproving(true);
    setError("");
    try {
      const [saved] = await saveInstructorQuestions({ upload_id: uploadId, questions: [{ ...question, status: "generated" }] });
      const approved = await approveInstructorQuestion(saved.question_id);
      setSavedQuestions((current) => {
        if (current.some((item) => item.question_id === approved.question_id)) return current;
        return [...current, approved];
      });
      setGeneratedQuestions((current) => current.map((item) => (item.question_id === question.question_id ? approved : item)));
      setGenerationPhase("reviewing");
      notifySuccess("Question approved", "It was added to the classroom package.");
    } catch (err) {
      notifyError(err, "Could not approve question");
    } finally {
      setIsApproving(false);
    }
  }

  async function handleApproveAllQuestions() {
    const pending = generatedQuestions.filter((question) => !savedQuestions.some((item) => item.question_id === question.question_id));
    if (pending.length === 0) return;
    setIsApproving(true);
    setError("");
    try {
      const approvedBatch = [];
      for (const question of pending) {
        const [saved] = await saveInstructorQuestions({ upload_id: uploadId, questions: [{ ...question, status: "generated" }] });
        const approved = await approveInstructorQuestion(saved.question_id);
        approvedBatch.push(approved);
      }
      setSavedQuestions((current) => {
        const known = new Set(current.map((question) => question.question_id));
        return [...current, ...approvedBatch.filter((question) => !known.has(question.question_id))];
      });
      setGeneratedQuestions((current) =>
        current.map((question) => approvedBatch.find((approved) => approved.question_id === question.question_id) || question),
      );
      setCurrentStep("session");
      notifySuccess("All questions approved", "The classroom package is ready to launch.");
    } catch (err) {
      notifyError(err, "Could not approve all questions");
    } finally {
      setIsApproving(false);
    }
  }

  async function handleRegenerateQuestion(question, index) {
    if (!question) return;
    setIsGenerating(true);
    setIsThinking(true);
    setGenerationProgress({ current: 0, total: 1 });
    setGenerationLabel(`Regenerating ${questionTypeLabel(question.type)} ${index + 1}...`);
    try {
      const regeneratePayload = {
        upload_id: uploadId,
        question: {
          ...question,
          difficulty: question.difficulty || generationSettings.difficulty,
        },
      };
      const isPersisted = savedQuestions.some((item) => item.question_id === question.question_id);
      const regenerated = isPersisted
        ? await regenerateInstructorQuestion(regeneratePayload)
        : (await generateInstructorQuestions({
            upload_id: uploadId,
            extracted_text: extractedText,
            question_type: question.type,
            bloom_level: question.bloom_level,
            difficulty: question.difficulty || generationSettings.difficulty,
            output_language: generationSettings.output_language,
            question_index: index + 1,
            avoid_questions: generatedQuestions.map((item) => item.question_text).filter(Boolean),
          }))[0];
      setGeneratedQuestions((current) => current.map((item) => (item.question_id === question.question_id ? regenerated : item)));
      setSavedQuestions((current) => current.filter((item) => item.question_id !== question.question_id));
      setGenerationProgress({ current: 1, total: 1 });
      setGenerationPhase("reviewing");
      notifySuccess("Question regenerated", "A new version is ready for review.");
    } catch (err) {
      notifyError(err, "Question regeneration failed");
    } finally {
      setIsThinking(false);
      setIsGenerating(false);
    }
  }

  async function handleDownloadPptx() {
    setIsReconstructing(true);
    setError("");
    try {
      const result = await reconstructInstructorPresentation({ upload_id: uploadId, question_ids: approvedQuestionIds });
      setPresentation(result);
      await downloadApiFile(result.download_url, result.filename);
      notifySuccess("PPTX ready", "The updated deck download has started.");
    } catch (err) {
      notifyError(err, "Could not create updated PPTX");
    } finally {
      setIsReconstructing(false);
    }
  }

  async function handleDownloadReady(presentationResult) {
    try {
      await downloadApiFile(presentationResult.download_url, presentationResult.filename);
      notifySuccess("Download started", presentationResult.filename);
    } catch (err) {
      notifyError(err, "Could not download PPTX");
    }
  }

  async function handleCreateSession() {
    setIsCreatingSession(true);
    setError("");
    try {
      const session = await createInstructorSession({ instructor_id: user?.user_id, class_id: classId, question_ids: approvedQuestionIds });
      setCreatedSession(session);
      localStorage.setItem("instructorSession", JSON.stringify(session));
      setCurrentStep("session");
      notifySuccess("Session created", `Session code ${session.session_code} is ready.`);
    } catch (err) {
      notifyError(err, "Could not create live session");
    } finally {
      setIsCreatingSession(false);
    }
  }

  const selectedClass = classes.find((classDoc) => classDoc.class_id === selectedClassId);
  const pendingReviewCount = generatedQuestions.filter((question) => getQuestionReviewStatus(question, savedQuestions) !== "approved").length;
  const classroomReady = generatedQuestions.length > 0 && pendingReviewCount === 0;
  const slidesExtracted =
    upload?.slide_count ??
    upload?.slides_count ??
    upload?.metadata?.slide_count ??
    (extractedText ? Math.max(1, Math.ceil(extractedText.length / 1200)) : 0);
  const activeStage = createdSession || currentStep === "session" || classroomReady
    ? "ready"
    : generatedQuestions.length > 0
      ? "review"
      : isGenerating || isThinking || currentStep === "generate"
        ? "generate"
        : isUploading || isExtracting || uploadId || extractedText
          ? "analyze"
      : "upload";
  useEffect(() => {
    localStorage.setItem("contentStudio:activeStage", activeStage);
    window.dispatchEvent(new CustomEvent("content-studio-stage", { detail: { stage: activeStage } }));
  }, [activeStage]);

  const processingState = getProcessingState({
    upload,
    selectedFile,
    extractedText,
    generatedQuestions,
    generationProgress,
    generationLabel,
    isUploading,
    isExtracting,
    isGenerating,
    isThinking,
    error,
  });
  const workflowStats = [
    { label: "Slides extracted", value: slidesExtracted ? slidesExtracted.toLocaleString() : "0" },
    { label: "Questions generated", value: generatedQuestions.length.toLocaleString() },
    { label: "Pending review", value: pendingReviewCount.toLocaleString() },
    { label: "Status", value: activeStage === "ready" ? "Ready" : activeStage === "review" ? "Review" : activeStage === "generate" ? "Working" : activeStage === "analyze" ? "Analyzing" : "Upload" },
  ];
  const workflowActionBar = (
    <WorkflowActionBar
      approvedCount={approvedCount}
      canDownload={Boolean(uploadId && approvedQuestionIds.length > 0)}
      canCreateSession={approvedQuestionIds.length > 0}
      isReconstructing={isReconstructing}
      isCreatingSession={isCreatingSession}
      presentation={presentation}
      createdSession={createdSession}
      onDownloadPptx={handleDownloadPptx}
      onDownloadReady={handleDownloadReady}
      onCreateSession={handleCreateSession}
    />
  );
  const primaryAction = activeStage === "upload" ? (
    <UploadActionButton label="Choose file" loading={isUploading} disabled={!classId || isUploading} onFile={handleFile} />
  ) : activeStage === "review" ? (
    <Button type="button" variant="success" onClick={handleApproveAllQuestions} loading={isApproving} disabled={pendingReviewCount === 0}>
      <CheckCircle2 size={17} />
      Approve all
    </Button>
  ) : activeStage === "ready" && createdSession ? (
    <Link
      className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-black text-white shadow-soft transition hover:bg-emerald-700"
      to={`/instructor/live/${createdSession.session_id}`}
    >
      <Rocket size={17} />
      Launch live session
    </Link>
  ) : activeStage === "ready" ? (
    <Button type="button" variant="success" onClick={handleCreateSession} loading={isCreatingSession} disabled={approvedQuestionIds.length === 0}>
      <Rocket size={17} />
      Launch live session
    </Button>
  ) : (
    <Button type="button" variant="outline" disabled>
      <Loader2 className="animate-spin" size={17} />
      AI working
    </Button>
  );
  const mainPanel = generatedQuestions.length > 0 && !isGenerating ? (
    <div className="grid gap-4">
      {classroomReady && workflowActionBar}
      <QuestionReviewFeed
        questions={generatedQuestions}
        savedQuestions={savedQuestions}
        editingQuestionId={editingSavedQuestionId}
        busy={isApproving || isGenerating}
        onPatch={handleQuestionChange}
        onApprove={handleApproveQuestion}
        onApproveAll={handleApproveAllQuestions}
        onEdit={setEditingSavedQuestionId}
        onCancelEdit={() => setEditingSavedQuestionId(null)}
        onRegenerate={handleRegenerateQuestion}
      />
    </div>
  ) : uploadId || isUploading || isExtracting || isGenerating || extractedText ? (
    <AIProcessingCard
      state={processingState}
      upload={upload}
      selectedFile={selectedFile}
      extractedText={extractedText}
      generatedQuestions={generatedQuestions}
    />
  ) : (
    <UploadLectureStep
      selectedFile={selectedFile}
      isUploading={isUploading}
      progress={progress}
      error={error}
      generationSettings={generationSettings}
      setGenerationSettings={setGenerationSettings}
      onFile={handleFile}
    />
  );

  return (
    <div className="page-grid">
      <WorkflowHeader
        className={selectedClass?.name ?? "Select a class"}
        classes={classes}
        selectedClassId={selectedClassId}
        onSelectClass={handleClassSelect}
        stats={workflowStats}
        activeStage={activeStage}
        primaryAction={primaryAction}
      />

      {!classId && <EmptyState title="Create a class first" description="Content Studio needs a class before lecture uploads, generated questions, and live sessions can be organized." />}

      {classId && <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 grid gap-4">
          {mainPanel}
        </div>
        <StudioSidePanel
          questions={generatedQuestions}
          savedQuestions={savedQuestions}
          createdSession={createdSession}
          aiPanel={(
            <AiServicePanel
              status={aiStatus}
              checking={isCheckingAi}
              starting={isStartingAi}
              onRefresh={refreshAiStatus}
              onStart={handleStartAi}
            />
          )}
        />
      </div>}
    </div>
  );
}
