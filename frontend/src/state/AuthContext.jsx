import { createContext, useContext, useMemo, useState } from "react";

import { getCurrentSession, login as loginRequest, updateProfile as updateProfileRequest } from "../api/client";

const AuthContext = createContext(null);

function readStoredAuth() {
  try {
    return JSON.parse(window.localStorage.getItem("smartAuth") || "null");
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(readStoredAuth);

  const value = useMemo(
    () => ({
      auth,
      user: auth?.user ?? null,
      workspaces: auth?.workspaces ?? [],
      isAuthenticated: Boolean(auth?.session_token),
      async login(credentials) {
        const nextAuth = await loginRequest(credentials);
        window.localStorage.setItem("smartAuth", JSON.stringify(nextAuth));
        setAuth(nextAuth);
        return nextAuth;
      },
      async updateProfile(payload) {
        const nextAuth = await updateProfileRequest(payload);
        window.localStorage.setItem("smartAuth", JSON.stringify(nextAuth));
        setAuth(nextAuth);
        return nextAuth;
      },
      async refreshSession() {
        const nextAuth = await getCurrentSession();
        window.localStorage.setItem("smartAuth", JSON.stringify(nextAuth));
        setAuth(nextAuth);
        return nextAuth;
      },
      logout() {
        window.localStorage.removeItem("smartAuth");
        window.localStorage.removeItem("currentWorkspace");
        setAuth(null);
      },
    }),
    [auth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
