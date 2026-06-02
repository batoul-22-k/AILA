import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "./state/AuthContext";
import { AppAppearanceProvider } from "./state/InstructorAppearanceContext";
import { ThemeProvider } from "./state/ThemeContext";
import { WorkspaceProvider } from "./state/WorkspaceContext";
import { NotificationToasts } from "./components/NotificationToasts";
import { ToastProvider } from "./components/ToastProvider";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <AppAppearanceProvider>
        <ToastProvider>
          <AuthProvider>
            <WorkspaceProvider>
              <NotificationToasts />
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </WorkspaceProvider>
          </AuthProvider>
        </ToastProvider>
      </AppAppearanceProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
