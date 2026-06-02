import { Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "./components/ProtectedRoute";
import { RoleGate } from "./components/RoleGate";
import { RoleLayout } from "./components/RoleLayout";
import { AdminDashboardPage } from "./pages/admin/AdminDashboardPage";
import { AtRiskPage } from "./pages/admin/AtRiskPage";
import { ClassesOverviewPage } from "./pages/admin/ClassesOverviewPage";
import { EngagementTrendsPage } from "./pages/admin/EngagementTrendsPage";
import { InstructorClassComparisonPage } from "./pages/admin/InstructorClassComparisonPage";
import { PredictionReportsPage } from "./pages/admin/PredictionReportsPage";
import { AppearanceSettingsPage } from "./pages/instructor/AppearanceSettingsPage";
import { ContentStudioPage } from "./pages/instructor/ContentStudioPage";
import { CreateLiveSessionPage } from "./pages/instructor/CreateLiveSessionPage";
import { InstructorAnalyticsPage } from "./pages/instructor/InstructorAnalyticsPage";
import { InstructorClassDetailPage } from "./pages/instructor/InstructorClassDetailPage";
import { InstructorClassesPage } from "./pages/instructor/InstructorClassesPage";
import { InstructorDashboardPage } from "./pages/instructor/InstructorDashboardPage";
import { LiveParticipationDashboardPage } from "./pages/instructor/LiveParticipationDashboardPage";
import { SessionCodePage } from "./pages/instructor/SessionCodePage";
import { ActiveQuestionPage } from "./pages/student/ActiveQuestionPage";
import { JoinSessionPage } from "./pages/student/JoinSessionPage";
import { PersonalProgressPage } from "./pages/student/PersonalProgressPage";
import { StudentDashboardPage } from "./pages/student/StudentDashboardPage";
import { SubmissionSuccessPage } from "./pages/student/SubmissionSuccessPage";
import { SubmitAnswerPage } from "./pages/student/SubmitAnswerPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { WorkspaceSelectPage } from "./pages/WorkspaceSelectPage";
import { useAuth } from "./state/AuthContext";
import { useCurrentWorkspace } from "./state/WorkspaceContext";

function HomeRoute() {
  const { isAuthenticated } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return currentWorkspace ? <Navigate to={`/${currentWorkspace.type}`} replace /> : <Navigate to="/workspace-select" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route index element={<HomeRoute />} />
      <Route path="login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="workspace-select" element={<WorkspaceSelectPage />} />

        <Route element={<RoleGate allowed="student" />}>
          <Route element={<RoleLayout role="student" />}>
            <Route path="student" element={<StudentDashboardPage />} />
            <Route path="student/join" element={<JoinSessionPage />} />
            <Route path="student/join/:sessionCode" element={<JoinSessionPage />} />
            <Route path="student/session" element={<ActiveQuestionPage />} />
            <Route path="student/active-question" element={<ActiveQuestionPage />} />
            <Route path="student/submit-answer" element={<SubmitAnswerPage />} />
            <Route path="student/success" element={<SubmissionSuccessPage />} />
            <Route path="student/progress" element={<PersonalProgressPage />} />
            <Route path="student/settings" element={<Navigate to="/student/settings/appearance" replace />} />
            <Route path="student/settings/appearance" element={<AppearanceSettingsPage />} />
            <Route path="student/profile" element={<ProfilePage />} />
          </Route>
        </Route>

        <Route element={<RoleGate allowed="instructor" />}>
          <Route element={<RoleLayout role="instructor" />}>
            <Route path="instructor" element={<InstructorDashboardPage />} />
            <Route path="instructor/classes" element={<InstructorClassesPage />} />
            <Route path="instructor/classes/:classId" element={<InstructorClassDetailPage />} />
            <Route path="instructor/content-studio" element={<ContentStudioPage />} />
            <Route path="instructor/upload" element={<Navigate to="/instructor/content-studio" replace />} />
            <Route path="instructor/generate" element={<Navigate to="/instructor/content-studio" replace />} />
            <Route path="instructor/questions" element={<Navigate to="/instructor/content-studio" replace />} />
            <Route path="instructor/review" element={<Navigate to="/instructor/content-studio" replace />} />
            <Route path="instructor/reconstruct" element={<Navigate to="/instructor/content-studio" replace />} />
            <Route path="instructor/sessions" element={<CreateLiveSessionPage />} />
            <Route path="instructor/session" element={<CreateLiveSessionPage />} />
            <Route path="instructor/code" element={<SessionCodePage />} />
            <Route path="instructor/live" element={<LiveParticipationDashboardPage />} />
            <Route path="instructor/live/:sessionId" element={<LiveParticipationDashboardPage />} />
            <Route path="instructor/analytics" element={<InstructorAnalyticsPage />} />
            <Route path="instructor/settings" element={<Navigate to="/instructor/settings/appearance" replace />} />
            <Route path="instructor/settings/appearance" element={<AppearanceSettingsPage />} />
            <Route path="instructor/profile" element={<ProfilePage />} />
          </Route>
        </Route>

        <Route element={<RoleGate allowed="admin" />}>
          <Route element={<RoleLayout role="admin" />}>
            <Route path="admin" element={<AdminDashboardPage />} />
            <Route path="admin/classes" element={<ClassesOverviewPage />} />
            <Route path="admin/instructors" element={<InstructorClassComparisonPage />} />
            <Route path="admin/comparison" element={<InstructorClassComparisonPage />} />
            <Route path="admin/trends" element={<EngagementTrendsPage />} />
            <Route path="admin/students" element={<AtRiskPage />} />
            <Route path="admin/risk" element={<AtRiskPage />} />
            <Route path="admin/reports" element={<PredictionReportsPage />} />
            <Route path="admin/settings" element={<Navigate to="/admin/settings/appearance" replace />} />
            <Route path="admin/settings/appearance" element={<AppearanceSettingsPage />} />
            <Route path="admin/profile" element={<ProfilePage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
