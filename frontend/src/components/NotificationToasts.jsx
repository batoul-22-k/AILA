import { useEffect, useRef } from "react";

import { listNotifications, markNotificationsRead } from "../api/client";
import { useAuth } from "../state/AuthContext";
import { useToast } from "./ToastProvider";

const MAX_TOASTS_PER_SYNC = 2;
const MAX_STORED_NOTIFICATION_IDS = 200;

function storageKey(userId) {
  return `aila-shown-notification-toasts:${userId}`;
}

function readShownIds(userId) {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(storageKey(userId)) || "[]"));
  } catch {
    return new Set();
  }
}

function writeShownIds(userId, ids) {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify([...ids].slice(-MAX_STORED_NOTIFICATION_IDS)));
  } catch {
    // Local storage is an optimization; notification delivery still works without it.
  }
}

export function NotificationToasts() {
  const { user, isAuthenticated } = useAuth();
  const { showToast } = useToast();
  const shownIdsRef = useRef(new Set());

  useEffect(() => {
    if (!isAuthenticated || !user?.user_id) return undefined;
    let cancelled = false;
    shownIdsRef.current = readShownIds(user.user_id);

    async function syncNotifications() {
      try {
        const notifications = await listNotifications();
        if (cancelled || notifications.length === 0) return;

        const unseen = notifications.filter((notification) => !shownIdsRef.current.has(notification.notification_id));
        if (unseen.length === 0) return;

        unseen.forEach((notification) => {
          shownIdsRef.current.add(notification.notification_id);
        });
        writeShownIds(user.user_id, shownIdsRef.current);
        void markNotificationsRead(unseen.map((notification) => notification.notification_id)).catch(() => {});

        unseen
          .slice(0, MAX_TOASTS_PER_SYNC)
          .slice()
          .reverse()
          .forEach((notification) => {
            showToast({
              title: notification.title,
              description: notification.description,
              tone: notification.tone || "info",
              duration: 7000,
              dedupeKey: `stored-notification:${notification.notification_id}`,
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
