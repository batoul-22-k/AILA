import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { getClassPredictionSummary, listClasses, runPredictionAnalysis } from "../../api/client";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { InstructorPredictionPanel } from "../../components/predictions/PredictionPanels";

export function InstructorAnalyticsPage() {
  const [classes, setClasses] = useState([]);
  const [predictionClassId, setPredictionClassId] = useState("");
  const [predictionSummary, setPredictionSummary] = useState(null);
  const [loadingPrediction, setLoadingPrediction] = useState(false);
  const [predictionError, setPredictionError] = useState("");
  const [runningPrediction, setRunningPrediction] = useState(false);

  useEffect(() => {
    async function loadClasses() {
      const classResult = await listClasses().catch(() => []);
      setClasses(classResult);
      setPredictionClassId((current) => current || classResult[0]?.class_id || "");
    }
    loadClasses();
  }, []);

  useEffect(() => {
    async function loadPredictionSummary() {
      if (!predictionClassId) return;
      setLoadingPrediction(true);
      setPredictionError("");
      try {
        setPredictionSummary(await getClassPredictionSummary(predictionClassId));
      } catch (err) {
        setPredictionSummary(null);
        setPredictionError(err instanceof Error ? err.message : "Could not load classroom support insights");
      } finally {
        setLoadingPrediction(false);
      }
    }
    loadPredictionSummary();
  }, [predictionClassId]);

  async function handleRunPrediction() {
    if (!predictionClassId) return;
    setRunningPrediction(true);
    setPredictionError("");
    try {
      await runPredictionAnalysis(predictionClassId);
      setPredictionSummary(await getClassPredictionSummary(predictionClassId));
    } catch (err) {
      setPredictionError(err instanceof Error ? err.message : "Could not update classroom support insights");
    } finally {
      setRunningPrediction(false);
    }
  }

  return (
    <div className="page-grid">
      <PageHeader title="Classroom Support" tone="role" />

      <DashboardCard className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-role-primary">Classroom intervention view</p>
            <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Who needs help, what needs reinforcement, and what to do next</h2>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              className="adaptive-input focus-ring h-10 rounded-lg border border-role-border bg-white px-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              value={predictionClassId}
              onChange={(event) => setPredictionClassId(event.target.value)}
            >
              {classes.map((classDoc) => (
                <option key={classDoc.class_id} value={classDoc.class_id}>{classDoc.name}</option>
              ))}
            </select>
            <Button type="button" variant="role" loading={runningPrediction} onClick={handleRunPrediction} disabled={!predictionClassId}>
              <RefreshCw size={16} />
              Update support plan
            </Button>
          </div>
        </div>
      </DashboardCard>

      <InstructorPredictionPanel
        summary={predictionSummary}
        loading={loadingPrediction}
        error={predictionError}
        onRun={handleRunPrediction}
        running={runningPrediction}
      />
    </div>
  );
}
