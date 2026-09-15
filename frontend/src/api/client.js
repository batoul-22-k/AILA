const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

function getSessionToken() {
  try {
    return JSON.parse(localStorage.getItem("smartAuth") || "null")?.session_token;
  } catch {
    return null;
  }
}

function authHeaders() {
  const token = getSessionToken();
  return token ? { "X-Session-Token": token } : {};
}

function errorDetailText(detail) {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    if (typeof detail.message === "string") return detail.message;
    if (typeof detail.error === "string") return detail.error;
    try {
      return JSON.stringify(detail);
    } catch {
      return "Request failed";
    }
  }
  return "";
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const body = await response.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = errorDetailText(parsed.detail || parsed.message) || body;
    } catch {
      detail = body;
    }
    throw new Error(detail || `Request failed: ${response.status}`);
  }

  return response.json();
}

export function login(payload) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getCurrentSession() {
  return request("/api/auth/me");
}

export function updateProfile(payload) {
  return request("/api/auth/profile", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function listNotifications(options = {}) {
  const query = options.unreadOnly === false ? "?unread_only=false" : "";
  return request(`/api/notifications${query}`);
}

export function markNotificationsRead(notificationIds) {
  return request("/api/notifications/mark-read", {
    method: "POST",
    body: JSON.stringify(notificationIds),
  });
}

export function getAiStatus(provider) {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  return request(`/api/ai/status${query}`);
}

export function startAiService() {
  return request("/api/ai/start", {
    method: "POST",
  });
}

export function createClass(payload) {
  return request("/api/classes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listClasses(options = {}) {
  const query = options.includeInactive || options.includeArchived ? "?include_inactive=true" : "";
  return request(`/api/classes${query}`);
}

export function updateClass(classId, payload) {
  return request(`/api/classes/${classId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function updateClassStatus(classId, status) {
  return request(`/api/classes/${classId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function deleteClass(classId) {
  return request(`/api/classes/${classId}`, {
    method: "DELETE",
  });
}

export function listUsers(options = {}) {
  const query = options.includeAll ? "?include_all=true" : "";
  return request(`/api/users${query}`);
}

export function createUser(payload) {
  return request("/api/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function previewInstitutionUsers() {
  return request("/api/admin/institution-users/preview");
}

export function syncInstitutionAccounts(institutionIds) {
  return request("/api/admin/accounts/sync", {
    method: "POST",
    body: JSON.stringify({ institution_ids: institutionIds }),
  });
}

export function previewInstitutionSync() {
  return request("/api/admin/institution-sync/preview");
}

export function applyInstitutionSync(institutionIds) {
  return request("/api/admin/institution-sync/apply", {
    method: "POST",
    body: JSON.stringify({ institution_ids: institutionIds }),
  });
}

export function createManualAccount(payload) {
  return request("/api/admin/accounts/manual", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteUser(userId) {
  return request(`/api/users/${userId}`, {
    method: "DELETE",
  });
}

export function listClassStudents(classId) {
  return request(`/api/classes/${classId}/students`);
}

export function enrollClassStudent(classId, userId) {
  return request(`/api/classes/${classId}/students`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

export function removeClassStudent(classId, userId) {
  return request(`/api/classes/${classId}/students/${userId}`, {
    method: "DELETE",
  });
}

export function uploadLectureMaterial(classId, file) {
  const formData = new FormData();
  formData.append("class_id", classId);
  formData.append("file", file);

  return fetch(`${API_BASE_URL}/api/lecture-uploads`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  }).then((response) => {
    if (!response.ok) throw new Error("Lecture upload failed");
    return response.json();
  });
}

export function uploadInstructorLecture(file, onProgress, classId) {
  const formData = new FormData();
  formData.append("class_id", classId);
  formData.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/api/instructor/uploads`);
    const token = getSessionToken();
    if (token) xhr.setRequestHeader("X-Session-Token", token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let detail = xhr.responseText || "Lecture upload failed";
        try {
          const parsed = JSON.parse(xhr.responseText);
          detail = parsed.detail || detail;
        } catch {
          // Keep raw detail.
        }
        reject(new Error(detail));
      }
    };
    xhr.onerror = () => reject(new Error("Lecture upload failed"));
    xhr.send(formData);
  });
}

export function getInstructorUpload(uploadId) {
  return request(`/api/instructor/uploads/${uploadId}`);
}

export function generateInstructorQuestions(payload) {
  return request("/api/instructor/questions/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function testInstructorLlmConnection(payload) {
  return request("/api/instructor/llm/test-connection", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function saveInstructorQuestions(payload) {
  return request("/api/instructor/questions/save", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listInstructorQuestions(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString();
  return request(`/api/instructor/questions${query ? `?${query}` : ""}`);
}

export function updateInstructorQuestion(questionId, payload) {
  return request(`/api/instructor/questions/${questionId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteInstructorQuestion(questionId) {
  return request(`/api/instructor/questions/${questionId}`, {
    method: "DELETE",
  });
}

export function approveInstructorQuestion(questionId) {
  return request(`/api/instructor/questions/${questionId}/approve`, {
    method: "POST",
  });
}

export function regenerateInstructorQuestion(payload) {
  return request("/api/instructor/questions/regenerate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function reconstructInstructorPresentation(payload) {
  return request("/api/instructor/presentations/reconstruct", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getDownloadUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function getAuthenticatedDownloadUrl(path) {
  const token = getSessionToken();
  const url = new URL(`${API_BASE_URL}${path}`);
  if (token) url.searchParams.set("session_token", token);
  return url.toString();
}

function triggerBrowserDownload(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  if (filename) link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function downloadApiFile(path, filename) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: authHeaders(),
  });

  if (response.status === 401 || response.status === 403) {
    triggerBrowserDownload(getAuthenticatedDownloadUrl(path), filename);
    return;
  }

  if (!response.ok) {
    const body = await response.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed.detail || parsed.message || body;
    } catch {
      detail = body;
    }
    throw new Error(detail || `Download failed: ${response.status}`);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  triggerBrowserDownload(url, filename || "download");
  window.URL.revokeObjectURL(url);
}

export function createInstructorSession(payload) {
  return request("/api/instructor/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listInstructorSessions() {
  return request("/api/instructor/sessions");
}

export function getInstructorSession(sessionId) {
  return request(`/api/instructor/sessions/${sessionId}`);
}

export function updateInstructorSessionStatus(sessionId, status) {
  return request(`/api/instructor/sessions/${sessionId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function deleteInstructorSession(sessionId) {
  return request(`/api/instructor/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export function updateInstructorActiveQuestion(sessionId, questionId, durationSeconds) {
  return request(`/api/instructor/sessions/${sessionId}/active-question`, {
    method: "PATCH",
    body: JSON.stringify({ question_id: questionId, duration_seconds: durationSeconds }),
  });
}

export function saveGeneratedQuestions(payload) {
  return request("/api/questions/generated", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createLiveSession(payload) {
  return request("/api/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function joinSession(payload) {
  return request("/api/sessions/join", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function submitAnswer(payload) {
  return request("/api/responses", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getLiveSessionStats(sessionId) {
  return request(`/api/sessions/${sessionId}/stats`);
}

export function getLiveSessionResponseDetails(sessionId, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString();
  return request(`/api/sessions/${sessionId}/responses${query ? `?${query}` : ""}`);
}

export function revealSessionQuestion(sessionId, questionId) {
  return request(`/api/sessions/${sessionId}/questions/${questionId}/reveal`, {
    method: "POST",
  });
}

export function correctShortAnswerResponses(sessionId, questionId) {
  return request(`/api/sessions/${sessionId}/questions/${questionId}/correct-short-answers`, {
    method: "POST",
  });
}

export function updateInstructorReview(responseId, payload) {
  return request(`/api/responses/${responseId}/instructor-review`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function finishLiveSession(sessionId) {
  return request(`/api/sessions/${sessionId}/finish`, {
    method: "POST",
  });
}

export function getLiveSession(sessionId) {
  return request(`/api/sessions/${sessionId}`);
}

export function getStudentAnalytics(studentId) {
  return request(`/api/analytics/student/${studentId}`);
}

export function getMyProgress(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString();
  return request(`/api/progress/me${query ? `?${query}` : ""}`);
}

function gamificationQuery(params = {}) {
  return new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString();
}

export function getGamificationProfile(params = {}) {
  const query = gamificationQuery(params);
  return request(`/api/gamification/me${query ? `?${query}` : ""}`);
}

export function getGamificationMissions(params = {}) {
  const query = gamificationQuery(params);
  return request(`/api/gamification/missions${query ? `?${query}` : ""}`);
}

export function claimGamificationMission(missionId) {
  return request(`/api/gamification/missions/${missionId}/claim`, {
    method: "POST",
  });
}

export function getGamificationBadges(params = {}) {
  const query = gamificationQuery(params);
  return request(`/api/gamification/badges${query ? `?${query}` : ""}`);
}

export function getGamificationNotifications(options = {}) {
  const query = gamificationQuery({
    unread_only: options.unreadOnly,
    limit: options.limit,
  });
  return request(`/api/gamification/notifications${query ? `?${query}` : ""}`);
}

export function markGamificationNotificationRead(notificationId) {
  return request(`/api/gamification/notifications/${notificationId}/read`, {
    method: "POST",
  });
}

export function markAllGamificationNotificationsRead() {
  return request("/api/gamification/notifications/read-all", {
    method: "POST",
  });
}

export function getGamificationSessionSummary(sessionId) {
  return request(`/api/gamification/sessions/${sessionId}/summary`);
}

export function getGamificationHistory(params = {}) {
  const query = gamificationQuery(params);
  return request(`/api/gamification/history${query ? `?${query}` : ""}`);
}

export function getGamificationLeaderboard(params = {}) {
  const query = gamificationQuery(params);
  return request(`/api/gamification/leaderboard${query ? `?${query}` : ""}`);
}

export function getGamificationChallenges(params = {}) {
  const query = gamificationQuery(params);
  return request(`/api/gamification/challenges${query ? `?${query}` : ""}`);
}

export function claimGamificationChallenge(challengeId) {
  return request(`/api/gamification/challenges/${challengeId}/claim`, {
    method: "POST",
  });
}

export function getClassAnalytics(classId) {
  return request(`/api/analytics/class/${classId}`);
}

export function recalculateClassAnalytics(classId) {
  return request(`/api/analytics/recalculate/${classId}`, {
    method: "POST",
  });
}

export function getAtRiskStudents(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString();
  return request(`/api/analytics/at-risk-students${query ? `?${query}` : ""}`);
}

export function recalculateClassPredictions(classId) {
  return request(`/api/analytics/predictions/recalculate/${classId}`, {
    method: "POST",
  });
}

export function runPredictionAnalysis(classId) {
  return request(`/api/predictions/class/${classId}/run`, {
    method: "POST",
  });
}

export function getClassPredictionSummary(classId) {
  return request(`/api/predictions/class/${classId}`);
}

export function getStudentPrediction(params = {}) {
  const query = gamificationQuery(params);
  return request(`/api/predictions/student${query ? `?${query}` : ""}`);
}

export function getAdminPredictionOverview() {
  return request("/api/predictions/admin/overview");
}

export function getClassPredictionFeatures(classId, options = {}) {
  const query = gamificationQuery({ refresh: options.refresh });
  return request(`/api/predictions/features/class/${classId}${query ? `?${query}` : ""}`);
}

export function getLiveSessionQuestions(sessionId) {
  return request(`/api/sessions/${sessionId}/questions`);
}

export function getInstructorDashboard() {
  return request("/api/instructor/dashboard");
}

export function getAdminDashboard() {
  return request("/api/admin/dashboard");
}

export function getAdminCommandCenter() {
  return request("/api/admin/command-center");
}

export function getAdminAlerts() {
  return request("/api/admin/alerts");
}

export function markAdminAlertReviewed(alertId) {
  return request(`/api/admin/alerts/${alertId}/review`, {
    method: "POST",
  });
}

export function getAdminClassesMonitoring() {
  return request("/api/admin/classes/monitoring");
}

export function getAdminInstructorsMonitoring() {
  return request("/api/admin/instructors/monitoring");
}

export function getAdminRiskOverview() {
  return request("/api/admin/risk-overview");
}

export function getAdminTrends() {
  return request("/api/admin/trends");
}

export function listAdminSessions(options = {}) {
  const query = options.activeOnly ? "?active_only=true" : "";
  return request(`/api/admin/sessions${query}`);
}

export function getAdminSessionReport(sessionId) {
  return request(`/api/admin/sessions/${sessionId}/report`);
}

export function getWebSocketUrl(sessionId) {
  const url = new URL(API_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/ws/sessions/${sessionId}`;
  return url.toString();
}
