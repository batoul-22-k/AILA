from collections import defaultdict

from fastapi import WebSocket


class SessionConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections[session_id].add(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        self.active_connections[session_id].discard(websocket)
        if not self.active_connections[session_id]:
            del self.active_connections[session_id]

    async def broadcast(self, session_id: str, payload: dict) -> None:
        disconnected: list[WebSocket] = []
        for websocket in self.active_connections.get(session_id, set()):
            try:
                await websocket.send_json(payload)
            except RuntimeError:
                disconnected.append(websocket)

        for websocket in disconnected:
            self.disconnect(session_id, websocket)


manager = SessionConnectionManager()
