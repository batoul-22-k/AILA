import { useEffect, useState } from "react";

import { getLiveSessionStats, getWebSocketUrl } from "../api/client";

export function useLiveSessionStats(sessionId) {
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!sessionId) return undefined;

    let active = true;
    setStatus("connecting");

    getLiveSessionStats(sessionId)
      .then((snapshot) => {
        if (active) setStats(snapshot);
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    const socket = new WebSocket(getWebSocketUrl(sessionId));
    socket.onopen = () => setStatus("connected");
    socket.onerror = () => setStatus("error");
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "session_stats") setStats(message.payload);
    };

    return () => {
      active = false;
      socket.close();
    };
  }, [sessionId]);

  return { stats, status };
}
