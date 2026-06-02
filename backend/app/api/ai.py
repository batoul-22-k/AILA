from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.instructor_services import get_ollama_status, start_ollama_server

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status")
async def get_ai_status(user: dict = Depends(get_current_user)) -> dict:
    return get_ollama_status()


@router.post("/start")
async def start_ai_service(user: dict = Depends(get_current_user)) -> dict:
    # TODO: In production, restrict this to local/dev deployments or admin-only infrastructure controls.
    try:
        return start_ollama_server()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
