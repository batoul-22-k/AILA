import { FileText, UploadCloud } from "lucide-react";
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { uploadInstructorLecture } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";
import { cn } from "../../utils/cn";

export function UploadLecturePage() {
  const { showToast } = useToast();
  const { currentWorkspace } = useCurrentWorkspace();
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState(null);
  const [upload, setUpload] = useState(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback((nextFile) => {
    setFile(nextFile);
    setUpload(null);
    setProgress(0);
  }, []);

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    try {
      const result = await uploadInstructorLecture(file, setProgress, currentWorkspace?.class_id);
      localStorage.setItem("instructorUploadId", result.upload_id);
      localStorage.setItem("instructorExtractedText", result.cleaned_text || result.extracted_text || "");
      setUpload(result);
      showToast({ title: "Lecture uploaded", description: "Text was extracted and is ready for question generation.", tone: "success" });
    } catch (err) {
      showToast({ title: "Upload failed", description: err instanceof Error ? err.message : "Upload failed", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Lecture material" title="Upload lecture material" description="Upload a PPTX or PDF. The backend extracts readable content and prepares it for AI question generation." tone="role" />

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <DashboardCard
          className={cn(
            "grid min-h-72 place-items-center border-dashed text-center",
            dragging && "border-role-border bg-role-hover",
          )}
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
          <div className="max-w-sm">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-smart bg-role-hover text-role-text">
              <UploadCloud size={28} />
            </span>
            <h2 className="mt-4 text-xl font-black text-slate-900 dark:text-white">Drop PPTX or PDF here</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">The upload is processed by FastAPI, PyMuPDF, and python-pptx.</p>
            <label className="mt-5 inline-flex cursor-pointer">
              <input className="sr-only" type="file" accept=".pdf,.pptx" onChange={(event) => handleFile(event.target.files?.[0])} />
              <span className="rounded-smart bg-role-accent px-4 py-2 text-sm font-bold text-white shadow-soft">Choose file</span>
            </label>
          </div>
        </DashboardCard>

        <DashboardCard>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">Extraction status</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{file ? file.name : "No file selected"}</p>
            </div>
            <Badge tone={upload?.status === "extracted" ? "green" : loading ? "gold" : "slate"}>{upload?.status || (loading ? "processing" : "waiting")}</Badge>
          </div>

          {file && (
            <div className="mt-5">
              <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-role-accent transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
              <Button className="mt-4" type="button" variant="role" loading={loading} onClick={handleUpload}>
                <UploadCloud size={18} />
                Upload and extract
              </Button>
            </div>
          )}

          {upload?.cleaned_text && (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-black text-slate-800 dark:text-white">Extracted text preview</p>
                <Link to="/instructor/generate">
                  <Button size="sm" variant="role">Generate questions</Button>
                </Link>
              </div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-smart bg-slate-50 p-4 text-xs leading-6 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                {upload.cleaned_text}
              </pre>
            </div>
          )}
        </DashboardCard>
      </div>

      {!upload && <EmptyState icon={FileText} title="No extracted content yet" description="Upload a lecture file to unlock AI question generation." />}
    </div>
  );
}
