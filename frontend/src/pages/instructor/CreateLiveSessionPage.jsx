import { CheckCircle2, Copy, ExternalLink, QrCode, Radio, RotateCcw, StopCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { createInstructorSession, deleteInstructorSession, listClasses, listInstructorQuestions, listInstructorSessions, updateInstructorSessionStatus } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";
import { useAuth } from "../../state/AuthContext";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";

function getStoredJsonArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function studioKey(classId, name) {
  return `contentStudio:${classId}:${name}`;
}

function getStoredApprovedQuestionIds(classId) {
  const scoped = classId ? getStoredJsonArray(studioKey(classId, "approvedQuestionIds")) : [];
  const legacy = getStoredJsonArray("instructorApprovedQuestionIds");
  return Array.from(new Set([...scoped, ...legacy]));
}

function persistApprovedQuestionIds(classId, questionIds) {
  const cleanIds = Array.from(new Set(questionIds.filter(Boolean)));
  if (classId) localStorage.setItem(studioKey(classId, "approvedQuestionIds"), JSON.stringify(cleanIds));
  localStorage.setItem("instructorApprovedQuestionIds", JSON.stringify(cleanIds));
  return cleanIds;
}

function removeStoredQuestions(classId, questionIds) {
  if (!classId || !questionIds.length) return;
  const deletedIds = new Set(questionIds);
  const storedQuestions = getStoredJsonArray(studioKey(classId, "questions"));
  const nextQuestions = storedQuestions.filter((question) => !deletedIds.has(question?.question_id));
  localStorage.setItem(studioKey(classId, "questions"), JSON.stringify(nextQuestions));
}

export function CreateLiveSessionPage() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const instructorWorkspace = currentWorkspace?.type === "instructor" ? currentWorkspace : null;
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(localStorage.getItem("instructorSelectedClassId") || instructorWorkspace?.class_id || "");
  const [sessions, setSessions] = useState([]);
  const [created, setCreated] = useState(null);
  const [scheduledFor, setScheduledFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [updatingSessionId, setUpdatingSessionId] = useState("");
  const [deletingSessionId, setDeletingSessionId] = useState("");
  const [approvedQuestionIds, setApprovedQuestionIds] = useState(() => getStoredApprovedQuestionIds(classId));
  const classNames = Object.fromEntries(classes.map((classDoc) => [classDoc.class_id, classDoc.name]));
  const activeCount = sessions.filter((session) => session.status === "active").length;
  const scheduledCount = sessions.filter((session) => session.status === "scheduled").length;
  const stoppedCount = sessions.filter((session) => session.status === "closed").length;
  const completedCount = sessions.filter((session) => session.status === "finished").length;

  function getSessionTone(status) {
    if (status === "active") return "green";
    if (status === "scheduled") return "gold";
    if (status === "finished") return "emerald";
    return "slate";
  }

  function getSessionLabel(status) {
    if (status === "active") return "Active";
    if (status === "scheduled") return "Scheduled";
    if (status === "closed") return "Stopped";
    if (status === "finished") return "Finished";
    return status;
  }

  function getSessionActionLabel(status) {
    if (status === "scheduled") return "Start now";
    if (status === "closed") return "Reopen";
    if (status === "finished") return "Completed";
    return "Stop session";
  }

  async function loadSessions() {
    try {
      setSessions(await listInstructorSessions());
    } catch {
      setSessions([]);
    }
  }

  async function loadApprovedQuestionIds(nextClassId = classId) {
    const storedIds = getStoredApprovedQuestionIds(nextClassId);
    if (!nextClassId) {
      setApprovedQuestionIds(storedIds);
      return storedIds;
    }
    setQuestionsLoading(true);
    try {
      const questions = await listInstructorQuestions({ class_id: nextClassId, status: "approved" });
      const backendIds = questions.map((question) => question.question_id).filter(Boolean);
      const storedOrder = storedIds.filter((questionId) => backendIds.includes(questionId));
      const missingStoredIds = backendIds.filter((questionId) => !storedOrder.includes(questionId));
      const nextIds = persistApprovedQuestionIds(nextClassId, [...storedOrder, ...missingStoredIds]);
      setApprovedQuestionIds(nextIds);
      return nextIds;
    } catch {
      setApprovedQuestionIds(storedIds);
      return storedIds;
    } finally {
      setQuestionsLoading(false);
    }
  }

  async function loadClasses() {
    try {
      const result = await listClasses();
      setClasses(result);
      const availableIds = result.map((classDoc) => classDoc.class_id);
      const nextClassId =
        (availableIds.includes(classId) && classId) ||
        (instructorWorkspace?.class_id && availableIds.includes(instructorWorkspace.class_id) && instructorWorkspace.class_id) ||
        result[0]?.class_id ||
        "";
      if (nextClassId) {
        setClassId(nextClassId);
        localStorage.setItem("instructorSelectedClassId", nextClassId);
        await loadApprovedQuestionIds(nextClassId);
      }
    } catch {
      setClasses([]);
    }
  }

  useEffect(() => {
    loadClasses();
    loadSessions();
  }, []);

  useEffect(() => {
    if (!classId) return;
    localStorage.setItem("instructorSelectedClassId", classId);
    void loadApprovedQuestionIds(classId);
  }, [classId]);

  async function handleCreate(event) {
    event.preventDefault();
    setLoading(true);
    try {
      localStorage.setItem("instructorSelectedClassId", classId);
      const questionIds = await loadApprovedQuestionIds(classId);
      if (questionIds.length === 0) throw new Error("Approve questions first.");
      const payload = {
        instructor_id: user?.user_id,
        class_id: classId,
        question_ids: questionIds,
        scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      };
      const session = await createInstructorSession(payload);
      localStorage.setItem("instructorSession", JSON.stringify(session));
      setCreated(session);
      showToast({ title: session.status === "scheduled" ? "Session scheduled" : "Session started", tone: "success" });
      await loadSessions();
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(session, status) {
    setUpdatingSessionId(session.session_id);
    try {
      const updated = await updateInstructorSessionStatus(session.session_id, status);
      setSessions((current) => current.map((item) => (item.session_id === updated.session_id ? updated : item)));
      const savedSession = JSON.parse(localStorage.getItem("instructorSession") || "null");
      if (savedSession?.session_id === updated.session_id) localStorage.setItem("instructorSession", JSON.stringify(updated));
      if (created?.session_id === updated.session_id) setCreated(updated);
      showToast({
        title: status === "closed" ? "Session stopped" : "Session started",
        tone: "success",
      });
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setUpdatingSessionId("");
    }
  }

  async function handleDeleteSession(session) {
    const confirmed = window.confirm(
      `Delete session ${session.session_code}? This removes it for everyone and deletes its responses, participation records, and attached questions that are not used by another session.`,
    );
    if (!confirmed) return;

    setDeletingSessionId(session.session_id);
    try {
      const result = await deleteInstructorSession(session.session_id);
      setSessions((current) => current.filter((item) => item.session_id !== session.session_id));
      if (created?.session_id === session.session_id) setCreated(null);
      const savedSession = JSON.parse(localStorage.getItem("instructorSession") || "null");
      if (savedSession?.session_id === session.session_id) localStorage.removeItem("instructorSession");
      if (result.deleted_question_ids?.length) {
        const nextApprovedIds = approvedQuestionIds.filter((questionId) => !result.deleted_question_ids.includes(questionId));
        persistApprovedQuestionIds(classId, nextApprovedIds);
        removeStoredQuestions(classId, result.deleted_question_ids);
        setApprovedQuestionIds(nextApprovedIds);
      }
      showToast({ title: "Session deleted", tone: "success" });
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setDeletingSessionId("");
    }
  }

  async function handleCopyJoinLink(session) {
    try {
      await navigator.clipboard.writeText(session.join_link);
      showToast({ title: "Copied", tone: "success" });
    } catch {
      showToast({ title: "Something went wrong", tone: "error" });
    }
  }

  function handleDownloadQr(session) {
    try {
      const a = document.createElement("a");
      a.href = session.qr_code_base64;
      a.download = `${session.session_code}_qr.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast({ title: "QR ready", tone: "success" });
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : undefined, tone: "error" });
    }
  }

  return (
    <div className="page-grid">
      <PageHeader title="Sessions" description="Create and manage live sessions." tone="role" />

      {approvedQuestionIds.length === 0 && !questionsLoading && <EmptyState title="No approved questions" description="Review questions before starting." />}

      <DashboardCard>
        <form className="grid gap-4" onSubmit={handleCreate}>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Class
            <select className="adaptive-input focus-ring h-11 border px-3 text-sm" value={classId} onChange={(event) => setClassId(event.target.value)} required>
              <option value="">Choose class</option>
              {classes.map((classDoc) => (
                <option key={classDoc.class_id} value={classDoc.class_id}>
                  {classDoc.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Start time
            <input
              type="datetime-local"
              className="adaptive-input focus-ring h-11 border px-3 text-sm"
              value={scheduledFor}
              onChange={(event) => setScheduledFor(event.target.value)}
              placeholder="Schedule start"
            />
          </label>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
            {questionsLoading ? "Checking questions..." : `${approvedQuestionIds.length} approved questions`}
          </p>
          <Button className="w-fit" type="submit" variant="role" loading={loading || questionsLoading} disabled={approvedQuestionIds.length === 0 || questionsLoading}>
            <Radio size={18} />
            {scheduledFor ? "Schedule" : "Create"}
          </Button>
        </form>
      </DashboardCard>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Active</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{activeCount}</p>
        </DashboardCard>
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Scheduled</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{scheduledCount}</p>
        </DashboardCard>
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Stopped</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{stoppedCount}</p>
        </DashboardCard>
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Finished</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{completedCount}</p>
        </DashboardCard>
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Total</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{sessions.length}</p>
        </DashboardCard>
      </div>

      {created && (
        <DashboardCard className="text-center">
          <Badge tone={getSessionTone(created.status)}>{getSessionLabel(created.status)}</Badge>
          <p className="mt-4 text-sm font-black uppercase tracking-wide text-slate-500">Session code</p>
          <p className="mt-2 text-5xl font-black tracking-[0.22em] text-slate-900 dark:text-white">{created.session_code}</p>
          {created.scheduled_for && (
            <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
              Starts {new Date(created.scheduled_for).toLocaleString()}
            </p>
          )}
          <img className="mx-auto mt-5 h-36 w-36 rounded-smart bg-white p-2" src={created.qr_code_base64} alt="Session QR code" />
          <div className="mt-3">
            <Button type="button" variant="outline" onClick={() => handleDownloadQr(created)}>
              <QrCode size={16} />
              Download QR
            </Button>
          </div>
          {created.status === "active" ? (
            <Link className="mt-5 inline-flex" to={`/instructor/live/${created.session_id}`}>
              <Button variant="role">Open live</Button>
            </Link>
          ) : created.status === "finished" ? (
            <Button className="mt-5" variant="outline" type="button" disabled>
              <CheckCircle2 size={16} />
              Finished
            </Button>
          ) : (
            <Button className="mt-5" variant="role" type="button" onClick={() => handleStatusChange(created, "active")} loading={updatingSessionId === created.session_id}>
              <RotateCcw size={16} />
              Start now
            </Button>
          )}
        </DashboardCard>
      )}

      <div className="grid gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Recent sessions</h2>
        </div>
        {sessions.map((session) => (
          <DashboardCard key={session.session_id}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <QrCode size={18} className="text-role-text" />
                  <h2 className="font-black text-slate-900 dark:text-white">{session.session_code}</h2>
                  <Badge tone={getSessionTone(session.status)}>{getSessionLabel(session.status)}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {classNames[session.class_id] ?? session.class_id} · {session.question_ids.length} questions
                </p>
                {session.scheduled_for && (
                  <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                    Starts {new Date(session.scheduled_for).toLocaleString()}
                  </p>
                )}
                <p className="mt-2 break-all text-xs font-semibold text-slate-500 dark:text-slate-400">{session.join_link}</p>
              </div>
              <div className="flex flex-wrap gap-2 lg:max-w-64 lg:justify-end">
                <Link to={`/instructor/live/${session.session_id}`} title="Open live" aria-label={`Open session ${session.session_code}`}>
                  <Button size="icon" variant="outline" type="button" title="Open live" aria-label="Open live">
                    <ExternalLink size={16} />
                  </Button>
                </Link>
                <Button size="icon" type="button" variant="outline" title="Copy join link" aria-label="Copy join link" onClick={() => handleCopyJoinLink(session)}>
                  <Copy size={16} />
                </Button>
                <Button size="icon" type="button" variant="outline" title="Download QR" aria-label="Download QR" onClick={() => handleDownloadQr(session)}>
                  <QrCode size={16} />
                </Button>
                {session.status === "active" ? (
                  <Button
                    size="icon"
                    type="button"
                    variant="outline"
                    title="Stop session"
                    aria-label="Stop session"
                    loading={updatingSessionId === session.session_id}
                    onClick={() => handleStatusChange(session, "closed")}
                  >
                    <StopCircle size={16} />
                  </Button>
                ) : session.status === "finished" ? (
                  <Button
                    size="icon"
                    type="button"
                    variant="outline"
                    title="Session completed"
                    aria-label="Session completed"
                    disabled
                  >
                    <CheckCircle2 size={16} />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    type="button"
                    variant="role"
                    title={getSessionActionLabel(session.status)}
                    aria-label={getSessionActionLabel(session.status)}
                    loading={updatingSessionId === session.session_id}
                    onClick={() => handleStatusChange(session, "active")}
                  >
                    <RotateCcw size={16} />
                  </Button>
                )}
                <Button
                  className="text-red-600 hover:border-red-300 hover:text-red-700"
                  size="icon"
                  type="button"
                  variant="outline"
                  title="Delete session"
                  aria-label="Delete session"
                  loading={deletingSessionId === session.session_id}
                  onClick={() => handleDeleteSession(session)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          </DashboardCard>
        ))}
      </div>
    </div>
  );
}
