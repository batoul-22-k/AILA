import { Copy, ExternalLink, QrCode, Radio, RotateCcw, StopCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { createInstructorSession, listClasses, listInstructorSessions, updateInstructorSessionStatus } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";
import { useAuth } from "../../state/AuthContext";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";

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
  const [updatingSessionId, setUpdatingSessionId] = useState("");
  const approvedQuestionIds = JSON.parse(localStorage.getItem("instructorApprovedQuestionIds") || "[]");
  const classNames = Object.fromEntries(classes.map((classDoc) => [classDoc.class_id, classDoc.name]));
  const activeCount = sessions.filter((session) => session.status === "active").length;
  const scheduledCount = sessions.filter((session) => session.status === "scheduled").length;
  const closedCount = sessions.filter((session) => session.status === "closed").length;

  function getSessionTone(status) {
    if (status === "active") return "green";
    if (status === "scheduled") return "gold";
    return "slate";
  }

  function getSessionActionLabel(status) {
    if (status === "scheduled") return "Start now";
    if (status === "closed") return "Reopen";
    return "Stop session";
  }

  async function loadSessions() {
    try {
      setSessions(await listInstructorSessions());
    } catch {
      setSessions([]);
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
      if (nextClassId) setClassId(nextClassId);
    } catch {
      setClasses([]);
    }
  }

  useEffect(() => {
    loadClasses();
    loadSessions();
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    setLoading(true);
    try {
      localStorage.setItem("instructorSelectedClassId", classId);
      const payload = {
        instructor_id: user?.user_id,
        class_id: classId,
        question_ids: approvedQuestionIds,
        scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      };
      const session = await createInstructorSession(payload);
      localStorage.setItem("instructorSession", JSON.stringify(session));
      setCreated(session);
      showToast({ title: "Session created", description: session.status === "scheduled" ? `Session ${session.session_code} is scheduled.` : `Session ${session.session_code} is active.`, tone: "success" });
      await loadSessions();
    } catch (err) {
      showToast({ title: "Could not create session", description: err instanceof Error ? err.message : "Could not create session", tone: "error" });
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
        title: status === "closed" ? "Session stopped" : "Session reopened",
        description: status === "closed" ? `Session ${updated.session_code} stopped. Students can no longer join.` : `Session ${updated.session_code} reopened.`,
        tone: "success",
      });
    } catch (err) {
      showToast({ title: "Could not update session", description: err instanceof Error ? err.message : "Could not update session", tone: "error" });
    } finally {
      setUpdatingSessionId("");
    }
  }

  async function handleCopyJoinLink(session) {
    try {
      await navigator.clipboard.writeText(session.join_link);
      showToast({ title: "Join link copied", description: `Join link copied for ${session.session_code}.`, tone: "success" });
    } catch {
      showToast({ title: "Could not copy join link", description: "The join link could not be copied to the clipboard.", tone: "error" });
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
      showToast({ title: "QR downloaded", description: `QR code downloaded for ${session.session_code}.`, tone: "success" });
    } catch (err) {
      showToast({ title: "Could not download QR", description: err instanceof Error ? err.message : "Could not download QR code", tone: "error" });
    }
  }

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Live sessions" title="Create a classroom session" description="Create a live session from approved questions. The backend generates the session code and QR join link." tone="role" />

      {approvedQuestionIds.length === 0 && <EmptyState title="No approved questions" description="Approve generated questions before creating a live session." />}

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
            Start date & time
            <input
              type="datetime-local"
              className="adaptive-input focus-ring h-11 border px-3 text-sm"
              value={scheduledFor}
              onChange={(event) => setScheduledFor(event.target.value)}
              placeholder="Schedule start"
            />
          </label>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{approvedQuestionIds.length} approved questions will be used.</p>
          <Button className="w-fit" type="submit" variant="role" loading={loading} disabled={approvedQuestionIds.length === 0}>
            <Radio size={18} />
            {scheduledFor ? "Schedule session" : "Create session"}
          </Button>
        </form>
      </DashboardCard>

      <div className="grid gap-3 sm:grid-cols-4">
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Active sessions</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{activeCount}</p>
        </DashboardCard>
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Scheduled sessions</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{scheduledCount}</p>
        </DashboardCard>
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Closed sessions</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{closedCount}</p>
        </DashboardCard>
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Total sessions</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{sessions.length}</p>
        </DashboardCard>
      </div>

      {created && (
        <DashboardCard className="text-center">
          <Badge tone={getSessionTone(created.status)}>{created.status}</Badge>
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
              <Button variant="role">Open live dashboard</Button>
            </Link>
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
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Session Management</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Stop sessions when class ends, reopen them if you need to continue, and copy join links for sharing.</p>
        </div>
        {sessions.map((session) => (
          <DashboardCard key={session.session_id}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <QrCode size={18} className="text-role-text" />
                  <h2 className="font-black text-slate-900 dark:text-white">{session.session_code}</h2>
                  <Badge tone={getSessionTone(session.status)}>{session.status}</Badge>
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
              <div className="grid gap-2 sm:grid-cols-2 lg:min-w-80">
                <Link to={`/instructor/live/${session.session_id}`}>
                  <Button className="w-full" variant="outline" type="button">
                    <ExternalLink size={16} />
                    Open
                  </Button>
                </Link>
                <Button type="button" variant="outline" onClick={() => handleCopyJoinLink(session)}>
                  <Copy size={16} />
                  Copy link
                </Button>
                <Button type="button" variant="outline" onClick={() => handleDownloadQr(session)}>
                  <QrCode size={16} />
                  Download QR
                </Button>
                {session.status === "active" ? (
                  <Button
                    type="button"
                    variant="outline"
                    loading={updatingSessionId === session.session_id}
                    onClick={() => handleStatusChange(session, "closed")}
                  >
                    <StopCircle size={16} />
                    {getSessionActionLabel(session.status)}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="role"
                    loading={updatingSessionId === session.session_id}
                    onClick={() => handleStatusChange(session, "active")}
                  >
                    <RotateCcw size={16} />
                    {getSessionActionLabel(session.status)}
                  </Button>
                )}
              </div>
            </div>
          </DashboardCard>
        ))}
      </div>
    </div>
  );
}
