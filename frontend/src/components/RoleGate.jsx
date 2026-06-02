import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "../state/AuthContext";
import { useCurrentWorkspace } from "../state/WorkspaceContext";

export function RoleGate({ allowed }) {
  const { workspaces } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();

  if (!currentWorkspace) return <Navigate to="/workspace-select" replace />;
  if (currentWorkspace.type !== allowed) {
    return <Navigate to={workspaces.some((workspace) => workspace.type === allowed) ? "/workspace-select" : `/${currentWorkspace.type}`} replace />;
  }

  return <Outlet />;
}
