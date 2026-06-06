import { useEffect, useRef } from "react";

import { listNotifications } from "../api/client";
import { useAuth } from "../state/AuthContext";
import { useToast } from "./ToastProvider";

export function NotificationToasts() {
  const { user, isAuthenticated } = useAuth();
  const { showToast } = useToast();
  const shownIdsRef = useRef(new Set());

  useEffect(() => {
    if (!isAuthenticated || !user?.user_id) return undefined;
    let cancelled = false;

    async function syncNotifications() {
      try {
        const notifications = await listNotifications();
        if (cancelled || notifications.length === 0) return;

        notifications
          .slice()
          .reverse()
          .forEach((notification) => {
            if (shownIdsRef.current.has(notification.notification_id)) return;
            shownIdsRef.current.add(notification.notification_id);
            showToast({
              title: notification.title,
              description: notification.description,
              tone: notification.tone || "info",
              duration: 7000,
            });
          });
      } catch {
        // Notification delivery should never interrupt the active workflow.
      }
    }

    syncNotifications();
    const intervalId = window.setInterval(syncNotifications, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated, showToast, user?.user_id]);

  return null;
}
