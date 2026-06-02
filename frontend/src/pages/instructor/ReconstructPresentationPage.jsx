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
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleReconstruct() {
    setLoading(true);
    try {
      const response = await reconstructInstructorPresentation({ upload_id: uploadId, question_ids: approvedQuestionIds });
      setResult(response);
      showToast({ title: "PPTX ready", description: "The reconstructed presentation is ready to download.", tone: "success" });
    } catch (err) {
      showToast({ title: "Could not reconstruct presentation", description: err instanceof Error ? err.message : "Could not reconstruct presentation", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="PowerPoint reconstruction"
        title="Create engagement slide deck"
        description="Approved questions are inserted into a clean PPTX deck for classroom use."
        tone="role"
      />

      {!uploadId && <EmptyState title="Upload required" description="Upload lecture material before reconstructing a presentation." />}
      {approvedQuestionIds.length === 0 && <EmptyState title="No approved questions" description="Approve at least one generated question before creating the PPTX." />}

      <DashboardCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">Ready to build</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{approvedQuestionIds.length} approved questions selected</p>
          </div>
          <Button type="button" variant="role" loading={loading} onClick={handleReconstruct} disabled={!uploadId || approvedQuestionIds.length === 0}>
            <FileSliders size={18} />
            Generate PPTX
          </Button>
        </div>
      </DashboardCard>

      {result && (
        <DashboardCard>
          <h2 className="text-lg font-black text-slate-900 dark:text-white">{result.filename}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">The reconstructed presentation is ready.</p>
          <a className="mt-5 inline-flex" href={getDownloadUrl(result.download_url)}>
            <Button type="button" variant="role">
              <Download size={18} />
              Download PPTX
            </Button>
          </a>
          <Link className="ml-3 inline-flex" to="/instructor/sessions">
            <Button type="button" variant="outline">Create session</Button>
          </Link>
        </DashboardCard>
      )}
    </div>
  );
}
