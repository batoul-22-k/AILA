import { useEffect, useState } from "react";

import { getAdminClassesMonitoring, getAdminInstructorsMonitoring } from "../../api/client";
import { AdminClassMonitoring } from "../../components/admin/AdminClassMonitoring";
import { AdminInstructorMonitoring } from "../../components/admin/AdminInstructorMonitoring";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";

export function InstructorClassComparisonPage() {
  const [instructors, setInstructors] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [instructorResult, classResult] = await Promise.all([
        getAdminInstructorsMonitoring(),
        getAdminClassesMonitoring(),
      ]);
      setInstructors(instructorResult.instructors || []);
      setClasses(classResult.classes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load instructor monitoring");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Instructors" title="Instructor monitoring" description="Compare teaching load, engagement, reviews, and class support signals." tone="orange" />
      {loading && <DashboardCard><div className="h-32 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /></DashboardCard>}
      {error && <DashboardCard><p className="text-sm font-semibold text-red-600">{error}</p></DashboardCard>}
      {!loading && !error && (
        <>
          <AdminInstructorMonitoring instructors={instructors} />
          <AdminClassMonitoring classes={classes} />
        </>
      )}
    </div>
  );
}
