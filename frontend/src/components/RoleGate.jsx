import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "../state/AuthContext";
import { useCurrentWorkspace } from "../state/WorkspaceContext";

export function RoleGate({ allowed }) {
  const { user, workspaces } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();

  const accountRole = user?.account_role;
  if (!currentWorkspace && (allowed === "admin" || allowed === "instructor") && accountRole === allowed) {
    return <Outlet />;
  }
  if (!currentWorkspace) return <Navigate to="/workspace-select" replace />;
  if (currentWorkspace.type !== allowed) {
    if ((allowed === "admin" || allowed === "instructor") && accountRole === allowed) return <Outlet />;
    return <Navigate to={workspaces.some((workspace) => workspace.type === allowed) ? "/workspace-select" : `/${currentWorkspace.type}`} replace />;
  }

  return <Outlet />;
}
