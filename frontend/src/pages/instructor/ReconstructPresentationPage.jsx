import { Download, FileSliders } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { getDownloadUrl, reconstructInstructorPresentation } from "../../api/client";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";

export function ReconstructPresentationPage() {
  const { showToast } = useToast();
  const uploadId = localStorage.getItem("instructorUploadId");
  const approvedQuestionIds = JSON.parse(localStorage.getItem("instructorApprovedQuestionIds") || "[]");
  const savedSession = JSON.parse(localStorage.getItem("instructorSession") || "null");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleReconstruct() {
    setLoading(true);
    try {
      const response = await reconstructInstructorPresentation({
        upload_id: uploadId,
        question_ids: approvedQuestionIds,
        session_code: savedSession?.session_code ?? null,
      });
      setResult(response);
      showToast({ title: "Export ready", tone: "success" });
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not reconstruct presentation", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-grid">
      <PageHeader
        title="Export Slides"
        description="Create a PPTX from approved questions."
        tone="role"
      />

      {!uploadId && <EmptyState title="Upload required" description="Upload content first." />}
      {approvedQuestionIds.length === 0 && <EmptyState title="No approved questions" description="Approve questions before exporting." />}

      <DashboardCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">Ready</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{approvedQuestionIds.length} approved questions selected</p>
          </div>
          <Button type="button" variant="role" loading={loading} onClick={handleReconstruct} disabled={!uploadId || approvedQuestionIds.length === 0}>
            <FileSliders size={18} />
            Export
          </Button>
        </div>
      </DashboardCard>

      {result && (
        <DashboardCard>
          <h2 className="text-lg font-black text-slate-900 dark:text-white">{result.filename}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ready to download.</p>
          <a className="mt-5 inline-flex" href={getDownloadUrl(result.download_url)}>
            <Button type="button" variant="role">
              <Download size={18} />
              Download
            </Button>
          </a>
          <Link className="ml-3 inline-flex" to="/instructor/sessions">
            <Button type="button" variant="outline">Start</Button>
          </Link>
        </DashboardCard>
      )}
    </div>
  );
}
