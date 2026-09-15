"""Diagnostics for local/cloud Ollama model behavior in the RQ1 evaluator."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any

from app.llm_evaluation.config import EvaluationConfig, load_config
from app.llm_evaluation.prompts import build_evaluation_prompt
from app.llm_evaluation.run_comparison import (
    build_generate_payload,
    classify_generation_result,
    estimate_prompt_tokens,
    invalid_control_character_details,
    model_config_for,
    model_tag_for,
    parse_json_output,
    perform_generate_request,
    prompt_size_diagnostics,
    resolve_model_selection,
)


DIAGNOSTIC_PROMPT = "Write one short English sentence about routing."
SHORT_LECTURE = (
    "[Slide 1]\n"
    "Routing chooses paths for packets across networks. Routers use forwarding tables, metrics, and protocols."
)


def _print_json(title: str, payload: Any) -> None:
    print(f"\n{title}")
    print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))


def validate_call_result(call_result: dict[str, Any]) -> dict[str, Any]:
    raw_response = call_result.get("raw_response")
    raw_output = str(raw_response.get("response") or "") if isinstance(raw_response, dict) else ""
    valid_json, parsed_output = parse_json_output(raw_output)
    classification = classify_generation_result(
        raw_response=raw_response if isinstance(raw_response, dict) else None,
        call_result=call_result,
        parsed_output=parsed_output,
        valid_json=valid_json,
    )
    return {
        "valid_json": valid_json,
        "parsed_output": parsed_output,
        "done": classification["done"],
        "done_reason": classification["done_reason"],
        "generation_success": classification["generation_success"],
        "validation_result": "passed" if classification["generation_success"] else "failed",
        "failure_category": classification["error_category"],
        "error": classification["error"],
        "invalid_control_characters": invalid_control_character_details(raw_output),
    }


def run_rq1_diagnostic(config: EvaluationConfig, model_id: str, prompt: str) -> dict[str, Any]:
    model_tag = model_tag_for(config, model_id)
    model_config = model_config_for(config, model_id)
    payload = build_generate_payload(config, model_tag, prompt)
    result = perform_generate_request(
        config,
        model_tag,
        payload,
        capture_local_resources=model_config.get("deployment_type") == "local" and config.capture_local_resource_metrics,
    )
    validation = validate_call_result(result)
    raw_response = result.get("raw_response")
    response_text = json.dumps(raw_response, ensure_ascii=False) if raw_response is not None else str(result.get("ollama_error_body") or "")
    return {
        "model_id": model_id,
        "model_tag": model_tag,
        "endpoint": config.generate_url,
        "request_payload": payload,
        "prompt_character_count": len(prompt),
        "estimated_prompt_tokens": estimate_prompt_tokens(prompt),
        "num_ctx": config.num_ctx,
        "num_predict": config.num_predict,
        "http_status": result.get("http_status"),
        "elapsed_seconds": result.get("elapsed_seconds"),
        "done": validation["done"],
        "done_reason": validation["done_reason"],
        "response_text_repr": repr(response_text),
        "raw_response": raw_response,
        "validation": validation,
        "failure_category": validation["failure_category"],
    }


def run_backend_production_probe(project_root: Path, model_tag: str, lecture_text: str) -> dict[str, Any]:
    backend_root = project_root / "backend"
    backend_python = backend_root / ".venv" / "Scripts" / "python.exe"
    python_executable = str(backend_python) if backend_python.exists() else sys.executable
    code = r"""
import json
import time
import urllib.request
from app.config import get_settings
from app.instructor_services import build_question_prompt

settings = get_settings()
lecture_text = __LECTURE_TEXT__
model_tag = __MODEL_TAG__
prompt = build_question_prompt(
    lecture_text,
    question_type="mcq",
    bloom_level="Understand",
    difficulty="Medium",
    output_language="en",
    question_index=1,
    avoid_questions=[],
)
options = {
    "temperature": 1,
    "num_ctx": settings.ollama_num_ctx,
    "num_predict": settings.ollama_num_predict,
    "num_gpu": settings.ollama_num_gpu,
}
if settings.ollama_num_thread > 0:
    options["num_thread"] = settings.ollama_num_thread
payload = {
    "model": model_tag,
    "prompt": prompt,
    "stream": False,
    "format": "json",
    "keep_alive": "2m",
    "options": options,
}
started = time.perf_counter()
request = urllib.request.Request(
    settings.ollama_url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(request, timeout=settings.ollama_timeout_seconds) as response:
        status = getattr(response, "status", None)
        text = response.read().decode("utf-8")
    parsed = json.loads(text)
    error = None
except Exception as exc:
    status = getattr(exc, "code", None)
    text = getattr(exc, "reason", None) or str(exc)
    parsed = None
    error = {"type": type(exc).__name__, "message": str(exc)}
print(json.dumps({
    "endpoint": settings.ollama_url,
    "prompt": prompt,
    "payload": payload,
    "options": options,
    "http_status": status,
    "elapsed_seconds": time.perf_counter() - started,
    "raw_response": text,
    "parsed_response": parsed,
    "error": error,
}, ensure_ascii=False))
"""
    code = code.replace("__LECTURE_TEXT__", json.dumps(lecture_text)).replace("__MODEL_TAG__", json.dumps(model_tag))
    completed = subprocess.run(
        [python_executable, "-c", code],
        cwd=backend_root,
        text=True,
        capture_output=True,
        timeout=180,
        check=False,
    )
    if completed.returncode != 0:
        return {
            "error": "production_probe_failed",
            "returncode": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }
    return json.loads(completed.stdout)


def run_production_equivalence(config: EvaluationConfig, model_id: str, project_root: Path) -> dict[str, Any]:
    model_tag = model_tag_for(config, model_id)
    production = run_backend_production_probe(project_root, model_tag, SHORT_LECTURE)
    rq1_prompt = build_evaluation_prompt(SHORT_LECTURE, config.prompt_chars)
    rq1 = run_rq1_diagnostic(config, model_id, rq1_prompt)
    return {
        "production": production,
        "rq1": rq1,
        "prompt_comparison": {
            "production_prompt_characters": len(str(production.get("prompt") or "")),
            "rq1_prompt_characters": len(rq1_prompt),
            "production_estimated_prompt_tokens": estimate_prompt_tokens(str(production.get("prompt") or "")),
            "rq1_estimated_prompt_tokens": estimate_prompt_tokens(rq1_prompt),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Diagnose RQ1 Ollama model behavior with a tiny prompt.")
    parser.add_argument("--model", default="tinyllama-local", help="Configured RQ1 model id or exact Ollama tag.")
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[3], help="Project root containing backend and rq1.")
    parser.add_argument("--production-equivalence", action="store_true", help="Also run a production-shaped short lecture probe for comparison.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = replace(load_config(), max_passages=1)
    model_id = resolve_model_selection(config, args.model)[0]
    if args.production_equivalence:
        result = run_production_equivalence(config, model_id, args.project_root)
        _print_json("Production Equivalence Diagnostic", result)
        return

    lecture = {"id": "diagnostic", "topic": "diagnostic", "content": DIAGNOSTIC_PROMPT}
    diagnostics = prompt_size_diagnostics(lecture, config, DIAGNOSTIC_PROMPT)
    result = run_rq1_diagnostic(config, model_id, DIAGNOSTIC_PROMPT)
    result["prompt_diagnostics"] = diagnostics
    _print_json("RQ1 Model Diagnostic", result)


if __name__ == "__main__":
    main()
