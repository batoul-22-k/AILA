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
      detail = parsed.detail || parsed.message || body;
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

export function getAiStatus() {
  return request("/api/ai/status");
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

export function updateInstructorActiveQuestion(sessionId, questionId) {
  return request(`/api/instructor/sessions/${sessionId}/active-question`, {
    method: "PATCH",
    body: JSON.stringify({ question_id: questionId }),
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

export function getLiveSessionQuestions(sessionId) {
  return request(`/api/sessions/${sessionId}/questions`);
}

export function getInstructorDashboard() {
  return request("/api/instructor/dashboard");
}

export function getAdminDashboard() {
  return request("/api/admin/dashboard");
}

export function getWebSocketUrl(sessionId) {
  const url = new URL(API_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/ws/sessions/${sessionId}`;
  return url.toString();
}
