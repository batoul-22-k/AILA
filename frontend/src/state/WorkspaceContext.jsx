import { createContext, useContext, useMemo, useState } from "react";

import { useAuth } from "./AuthContext";

const WorkspaceContext = createContext(null);

function readStoredWorkspace() {
  try {
    return JSON.parse(window.localStorage.getItem("currentWorkspace") || "null");
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }) {
  const { workspaces } = useAuth();
  const [currentWorkspace, setCurrentWorkspace] = useState(readStoredWorkspace);

  const value = useMemo(
    () => ({
      currentWorkspace,
      role: currentWorkspace?.type ?? null,
      selectWorkspace(workspace) {
        window.localStorage.setItem("currentWorkspace", JSON.stringify(workspace));
        setCurrentWorkspace(workspace);
      },
      clearWorkspace() {
        window.localStorage.removeItem("currentWorkspace");
        setCurrentWorkspace(null);
      },
      hasWorkspace(type) {
        return workspaces.some((workspace) => workspace.type === type);
      },
    }),
    [currentWorkspace, workspaces],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useCurrentWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useCurrentWorkspace must be used inside WorkspaceProvider");
  return context;
}
