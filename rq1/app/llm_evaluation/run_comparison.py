"""Run the offline TinyLlama vs stronger Ollama model comparison."""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import logging
import os
import re
import time
import zipfile
from dataclasses import replace
from datetime import datetime, timezone
from xml.etree import ElementTree
from pathlib import Path
from statistics import median
from typing import Any
from uuid import uuid4

import requests

from app.llm_evaluation.config import DEFAULT_INPUT_FILE, DEFAULT_RESULTS_DIR, EvaluationConfig, load_config
from app.llm_evaluation.prompts import (
    OLLAMA_JSON_SCHEMA,
    ONE_QUESTION_JSON_SCHEMA,
    build_evaluation_prompt,
    build_one_question_prompt,
    build_prompt_context,
)
from app.llm_evaluation.validate_outputs import (
    complete_question_set,
    final_output_records,
    one_question_schema_diagnostics,
    questions_from_parsed,
    relevance_flags,
    schema_compliant,
    schema_diagnostics,
)


logger = logging.getLogger(__name__)
UNLOAD_POLL_INTERVAL_SECONDS = 1.0
RETRY_DELAY_SECONDS = 10
INVALID_CONTROL_CHARACTERS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def clean_extracted_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = text.replace("\x0b", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_pptx_text(path: Path) -> str:
    try:
        from pptx import Presentation
    except ImportError as exc:
        logger.debug("python-pptx is unavailable; falling back to zipped PPTX XML parsing: %s", exc)
        return extract_pptx_text_from_zip(path)

    presentation = Presentation(path)
    lines: list[str] = []
    for slide_index, slide in enumerate(presentation.slides, start=1):
        slide_lines: list[str] = []
        for shape in slide.shapes:
            if hasattr(shape, "text") and str(shape.text or "").strip():
                slide_lines.append(str(shape.text).strip())
        if slide_lines:
            lines.append(f"[Slide {slide_index}]\n" + "\n".join(slide_lines))
    return clean_extracted_text("\n\n".join(lines))


def extract_pptx_text_from_zip(path: Path) -> str:
    slide_pattern = re.compile(r"ppt/slides/slide(\d+)\.xml$")
    lines: list[str] = []
    with zipfile.ZipFile(path) as archive:
        slide_names = []
        for name in archive.namelist():
            match = slide_pattern.match(name)
            if match:
                slide_names.append((int(match.group(1)), name))
        for slide_index, slide_name in sorted(slide_names):
            root = ElementTree.fromstring(archive.read(slide_name))
            text_items = [
                node.text.strip()
                for node in root.iter()
                if node.tag.endswith("}t") and node.text and node.text.strip()
            ]
            if text_items:
                lines.append(f"[Slide {slide_index}]\n" + "\n".join(text_items))
    return clean_extracted_text("\n\n".join(lines))


def passage_id_from_path(path: Path) -> str:
    stem = path.stem.lower()
    stem = re.sub(r"[^a-z0-9]+", "_", stem).strip("_")
    return stem or path.stem


def load_pptx_dataset(path: Path) -> list[dict[str, str]]:
    files = sorted(path.glob("*.pptx"), key=lambda item: item.name.lower())
    if not files:
        raise ValueError(f"Dataset directory does not contain any .pptx files: {path}")

    passages: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for file_path in files:
        lecture_id = passage_id_from_path(file_path)
        if lecture_id in seen_ids:
            lecture_id = f"{lecture_id}_{len(seen_ids) + 1}"
        seen_ids.add(lecture_id)
        content = extract_pptx_text(file_path)
        if not content:
            raise ValueError(f"No readable slide text extracted from {file_path}")
        passages.append(
            {
                "id": lecture_id,
                "topic": file_path.stem,
                "content": content,
                "source_file": str(file_path),
                "source_type": "pptx",
            }
        )
    return passages


def load_passages(path: Path) -> list[dict[str, str]]:
    if path.is_dir():
        return load_pptx_dataset(path)
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, list):
        raise ValueError("Evaluation input file must contain a JSON array.")
    passages: list[dict[str, str]] = []
    for index, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Input item {index} must be an object.")
        lecture_id = str(item.get("id") or "").strip()
        topic = str(item.get("topic") or "").strip()
        content = str(item.get("content") or "").strip()
        if not lecture_id or not topic or not content:
            raise ValueError(f"Input item {index} must include non-empty id, topic, and content.")
        passages.append({"id": lecture_id, "topic": topic, "content": content})
    return passages


def passage_hash(lecture: dict[str, str]) -> str:
    payload = json.dumps(
        {
            "id": lecture["id"],
            "topic": lecture["topic"],
            "content": lecture["content"],
        },
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalized_slide_text(lecture: dict[str, str], config: EvaluationConfig) -> str:
    return build_prompt_context(lecture["content"], config.prompt_chars)


def input_hash(lecture: dict[str, str], config: EvaluationConfig) -> str:
    return sha256_text(normalized_slide_text(lecture, config))


def prompt_hash(prompt: str) -> str:
    return sha256_text(prompt)


def prompt_size_diagnostics(lecture: dict[str, str], config: EvaluationConfig, prompt: str) -> dict[str, Any]:
    source_text = str(lecture["content"] or "")
    normalized = normalized_slide_text(lecture, config)
    estimated_input_tokens = estimate_prompt_tokens(source_text)
    estimated_normalized_input_tokens = estimate_prompt_tokens(normalized)
    estimated_prompt_token_count = estimate_prompt_tokens(prompt)
    context_with_reservation = estimated_prompt_token_count + config.num_predict
    truncated = len(normalized) < len(" ".join(source_text.replace("\x00", " ").split()))
    diagnostics = {
        "source_input_characters": len(source_text),
        "normalized_input_characters": len(normalized),
        "final_prompt_characters": len(prompt),
        "estimated_source_input_tokens": estimated_input_tokens,
        "estimated_normalized_input_tokens": estimated_normalized_input_tokens,
        "estimated_final_prompt_tokens": estimated_prompt_token_count,
        "configured_context_tokens": config.num_ctx,
        "reserved_output_tokens": config.num_predict,
        "estimated_prompt_plus_reserved_output_tokens": context_with_reservation,
        "context_overflow_estimated": context_with_reservation > config.num_ctx,
        "input_truncated_to_prompt_chars": truncated,
        "prompt_chars_limit": config.prompt_chars,
        "input_chunked": False,
        "input_rejected": False,
        "input_handling": "truncated_to_prompt_chars" if truncated else "used_full_input",
    }
    if truncated:
        logger.warning(
            "Evaluation input was truncated before prompting: source_chars=%s normalized_chars=%s prompt_chars_limit=%s",
            diagnostics["source_input_characters"],
            diagnostics["normalized_input_characters"],
            diagnostics["prompt_chars_limit"],
        )
    if diagnostics["context_overflow_estimated"]:
        logger.warning(
            "Evaluation prompt may exceed context after output reservation: prompt_tokens=%s reserved_output_tokens=%s num_ctx=%s",
            diagnostics["estimated_final_prompt_tokens"],
            diagnostics["reserved_output_tokens"],
            diagnostics["configured_context_tokens"],
        )
    return diagnostics


def input_passage_hashes(passages: list[dict[str, str]]) -> dict[str, str]:
    return {lecture["id"]: passage_hash(lecture) for lecture in passages}


def safe_model_name(model: str) -> str:
    return "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in model)


def resolve_model_selection(config: EvaluationConfig, selected_model: str | None) -> tuple[str, ...]:
    if selected_model is None:
        return config.models
    matches = [
        model_id
        for model_id in config.models
        if selected_model == model_id or model_names_match(selected_model, config.model_tag(model_id))
    ]
    if len(matches) != 1:
        configured = ", ".join(config.models)
        raise ValueError(f"--model must match exactly one configured model. Got {selected_model!r}; configured models: {configured}")
    return (matches[0],)


def parse_json_output(raw_output: str) -> tuple[bool, Any | None]:
    try:
        return True, json.loads(raw_output)
    except json.JSONDecodeError:
        return False, None


def invalid_control_character_details(value: str) -> dict[str, Any] | None:
    matches = list(INVALID_CONTROL_CHARACTERS.finditer(value or ""))
    if not matches:
        return None
    counts: dict[str, int] = {}
    for match in matches:
        code = f"U+{ord(match.group(0)):04X}"
        counts[code] = counts.get(code, 0) + 1
    return {
        "count": len(matches),
        "codepoints": counts,
        "first_index": matches[0].start(),
    }


def estimate_prompt_tokens(prompt: str) -> int:
    return max(1, (len(prompt) + 2) // 3)


def context_pressure(config: EvaluationConfig, prompt: str, prompt_eval_count: Any = None) -> dict[str, Any]:
    source = "ollama" if isinstance(prompt_eval_count, (int, float)) else "estimate"
    prompt_tokens = int(prompt_eval_count) if source == "ollama" else estimate_prompt_tokens(prompt)
    warning = prompt_tokens + config.num_predict > config.num_ctx
    return {
        "context_pressure_warning": warning,
        "prompt_token_count_for_context": prompt_tokens,
        "prompt_token_count_source": source,
    }


def warn_if_context_pressure(config: EvaluationConfig, prompt: str) -> dict[str, Any]:
    pressure = context_pressure(config, prompt)
    if pressure["context_pressure_warning"]:
        print("Configured context may be too small: prompt tokens + requested output tokens exceed num_ctx.")
    return pressure


def duration_tokens_per_second(eval_count: Any, eval_duration: Any) -> float | None:
    try:
        token_count = float(eval_count)
        duration_ns = float(eval_duration)
    except (TypeError, ValueError):
        return None
    if token_count <= 0 or duration_ns <= 0:
        return None
    return token_count / (duration_ns / 1_000_000_000)


def _round_gib(value: float | None) -> float | None:
    return None if value is None else round(float(value), 4)


def get_total_system_ram_gib() -> float | None:
    try:
        if os.name == "nt":
            class MemoryStatus(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            status = MemoryStatus()
            status.dwLength = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return status.ullTotalPhys / (1024**3)
        if hasattr(os, "sysconf"):
            pages = os.sysconf("SC_PHYS_PAGES")
            page_size = os.sysconf("SC_PAGE_SIZE")
            return (pages * page_size) / (1024**3)
    except (AttributeError, OSError, ValueError):
        return None
    return None


def system_ram_snapshot() -> dict[str, float | None]:
    total = get_total_system_ram_gib()
    available = get_available_system_ram_gib()
    used = total - available if total is not None and available is not None else None
    return {
        "total_system_ram_gib": _round_gib(total),
        "available_system_ram_gib": _round_gib(available),
        "used_system_ram_gib": _round_gib(used),
    }


def local_resource_metrics(
    *,
    model_tag: str,
    before: dict[str, float | None],
    after: dict[str, float | None],
    running_model_details: list[dict[str, Any]],
) -> dict[str, Any]:
    matching_models = [
        item
        for item in running_model_details
        if model_names_match(model_tag, str(item.get("name") or item.get("model") or ""))
    ]
    used_values = [
        value
        for value in [before.get("used_system_ram_gib"), after.get("used_system_ram_gib")]
        if isinstance(value, (int, float))
    ]
    return {
        "scope": "local_inference_host",
        "ram_before_request_gib": before.get("used_system_ram_gib"),
        "ram_after_response_gib": after.get("used_system_ram_gib"),
        "peak_system_ram_used_gib": max(used_values) if used_values else None,
        "ollama_running_model_metadata": matching_models,
    }


def extract_cloud_usage(raw_response: dict[str, Any] | None) -> dict[str, Any] | None:
    if raw_response is None:
        return None
    usage_keys = {
        "total_duration",
        "load_duration",
        "prompt_eval_count",
        "prompt_eval_duration",
        "eval_count",
        "eval_duration",
        "usage",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
    }
    usage = {key: raw_response[key] for key in usage_keys if key in raw_response}
    return usage or None


def contains_account_or_usage_limit_error(*parts: Any) -> bool:
    combined = " ".join(str(part or "") for part in parts).lower()
    account_terms = ["quota", "usage limit", "rate limit", "billing", "subscription", "plan", "payment", "credit"]
    return any(term in combined for term in account_terms)


def model_names_match(configured_model: str, actual_model: str) -> bool:
    configured = str(configured_model or "").strip()
    actual = str(actual_model or "").strip()
    if not configured or not actual:
        return False
    if configured == actual:
        return True
    if ":" not in configured and actual.startswith(f"{configured}:"):
        return True
    if ":" not in actual and configured.startswith(f"{actual}:"):
        return True
    return False


def extract_model_names(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return []
    models = payload.get("models")
    if not isinstance(models, list):
        return []
    names: list[str] = []
    for item in models:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("model") or "").strip()
        if name:
            names.append(name)
    return names


def model_config_for(config: EvaluationConfig, model_id: str) -> dict[str, Any]:
    return config.model_config(model_id)


def model_tag_for(config: EvaluationConfig, model_id: str) -> str:
    return config.model_tag(model_id)


def model_tags_for(config: EvaluationConfig, model_ids: list[str] | tuple[str, ...]) -> list[str]:
    return [model_tag_for(config, model_id) for model_id in model_ids]


def configured_models_present(configured_models: list[str] | tuple[str, ...], actual_models: list[str]) -> list[str]:
    present: list[str] = []
    for configured_model in configured_models:
        if any(model_names_match(configured_model, actual_model) for actual_model in actual_models):
            present.append(configured_model)
    return present


def get_running_model_details(config: EvaluationConfig) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    try:
        response = requests.get(config.ps_url, timeout=config.timeout_seconds)
        status = response.status_code
        body = response.text
        response.raise_for_status()
        payload = response.json()
        models = payload.get("models") if isinstance(payload, dict) else None
        if not isinstance(models, list):
            return [], None
        return [item for item in models if isinstance(item, dict)], None
    except requests.RequestException as exc:
        return [], {
            "error": f"Ollama /api/ps request failed: {exc}",
            "http_status": getattr(getattr(exc, "response", None), "status_code", locals().get("status", None)),
            "ollama_error_body": getattr(getattr(exc, "response", None), "text", locals().get("body", None)),
            "exception_type": type(exc).__name__,
        }
    except json.JSONDecodeError as exc:
        return [], {
            "error": f"Ollama /api/ps returned non-JSON body: {exc}",
            "http_status": locals().get("status", None),
            "ollama_error_body": locals().get("body", None),
            "exception_type": type(exc).__name__,
        }


def build_generate_payload(
    config: EvaluationConfig,
    model: str,
    prompt: str,
    output_schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "keep_alive": config.keep_alive,
        "options": config.generation_options,
    }
    if config.use_json_schema:
        payload["format"] = output_schema or OLLAMA_JSON_SCHEMA
    else:
        payload["format"] = "json"
    return payload


def get_running_models(config: EvaluationConfig) -> tuple[list[str], dict[str, Any] | None]:
    try:
        response = requests.get(config.ps_url, timeout=config.timeout_seconds)
        status = response.status_code
        body = response.text
        response.raise_for_status()
        return extract_model_names(response.json()), None
    except requests.RequestException as exc:
        return [], {
            "error": f"Ollama /api/ps request failed: {exc}",
            "http_status": getattr(getattr(exc, "response", None), "status_code", locals().get("status", None)),
            "ollama_error_body": getattr(getattr(exc, "response", None), "text", locals().get("body", None)),
            "exception_type": type(exc).__name__,
        }
    except json.JSONDecodeError as exc:
        return [], {
            "error": f"Ollama /api/ps returned non-JSON body: {exc}",
            "http_status": locals().get("status", None),
            "ollama_error_body": locals().get("body", None),
            "exception_type": type(exc).__name__,
        }


def unload_model(config: EvaluationConfig, model: str) -> dict[str, Any]:
    payload = {
        "model": model,
        "keep_alive": 0,
        "stream": False,
    }
    try:
        response = requests.post(config.generate_url, json=payload, timeout=config.timeout_seconds)
        response_text = response.text
        status = response.status_code
        response.raise_for_status()
        return {
            "model": model,
            "success": True,
            "http_status": status,
            "ollama_error_body": None,
            "exception_type": None,
        }
    except requests.RequestException as exc:
        return {
            "model": model,
            "success": False,
            "http_status": getattr(getattr(exc, "response", None), "status_code", locals().get("status", None)),
            "ollama_error_body": getattr(getattr(exc, "response", None), "text", locals().get("response_text", None)),
            "exception_type": type(exc).__name__,
            "error": str(exc),
        }


def wait_until_models_absent(config: EvaluationConfig, models: list[str] | tuple[str, ...]) -> dict[str, Any]:
    deadline = time.perf_counter() + max(config.unload_timeout_seconds, 0)
    checked_models = list(models)
    last_running: list[str] = []
    last_error: dict[str, Any] | None = None

    while True:
        running_models, error = get_running_models(config)
        if error is not None:
            last_error = error
        last_running = running_models
        still_loaded = configured_models_present(checked_models, running_models)
        if not still_loaded and error is None:
            return {
                "confirmed": True,
                "running_models": running_models,
                "error": None,
            }
        if time.perf_counter() >= deadline:
            return {
                "confirmed": False,
                "running_models": running_models,
                "error": last_error or f"Timed out waiting for models to unload: {', '.join(still_loaded)}",
            }
        time.sleep(UNLOAD_POLL_INTERVAL_SECONDS)


def unload_and_confirm(config: EvaluationConfig, models: list[str] | tuple[str, ...]) -> dict[str, Any]:
    unload_results = [unload_model(config, model) for model in models]
    wait_result = wait_until_models_absent(config, models)
    return {
        "confirmed": bool(wait_result["confirmed"]),
        "unload_results": unload_results,
        "running_models": wait_result["running_models"],
        "error": wait_result["error"],
    }


def unload_all_configured_models(config: EvaluationConfig) -> dict[str, Any]:
    return unload_and_confirm(config, config.models)


def is_retryable_error(status: int | None, error: str | None, exception_type: str | None, body: str | None) -> bool:
    combined = " ".join(str(part or "") for part in [error, exception_type, body]).lower()
    if status == 500:
        return True
    if exception_type in {"ConnectionError", "Timeout", "ReadTimeout", "ConnectTimeout"}:
        return True
    return "runner" in combined and ("terminat" in combined or "unexpected empty grammar stack" in combined)


def retry_reason_for_error(status: int | None, error: str | None, exception_type: str | None, body: str | None) -> str:
    combined = " ".join(str(part or "") for part in [error, exception_type, body]).lower()
    if status == 500:
        return "http_500"
    if exception_type in {"ConnectionError", "Timeout", "ReadTimeout", "ConnectTimeout"}:
        if "reset" in combined:
            return "connection_reset"
        return "transport_failure"
    if "connection reset" in combined:
        return "connection_reset"
    if "runner" in combined and ("terminat" in combined or "unexpected empty grammar stack" in combined):
        return "terminated_runner"
    return "not_retryable"


def perform_generate_request(
    config: EvaluationConfig,
    model: str,
    payload: dict[str, Any],
    *,
    capture_local_resources: bool = False,
) -> dict[str, Any]:
    started = time.perf_counter()
    resource_before = system_ram_snapshot() if capture_local_resources else None
    try:
        response = requests.post(config.generate_url, json=payload, timeout=config.timeout_seconds)
        elapsed = time.perf_counter() - started
        http_status = response.status_code
        response_text = response.text
        resource_after = system_ram_snapshot() if capture_local_resources else None
        running_details, running_details_error = get_running_model_details(config) if capture_local_resources else ([], None)
        if http_status >= 400:
            return {
                "raw_response": None,
                "error": f"Ollama request failed for {model}: HTTP {http_status}",
                "elapsed_seconds": elapsed,
                "http_status": http_status,
                "ollama_error_body": response_text,
                "exception_type": None,
                "local_resource_metrics": local_resource_metrics(
                    model_tag=model,
                    before=resource_before or {},
                    after=resource_after or {},
                    running_model_details=running_details,
                )
                if capture_local_resources
                else None,
                "local_resource_metrics_error": running_details_error,
            }
        try:
            return {
                "raw_response": response.json(),
                "error": None,
                "elapsed_seconds": elapsed,
                "http_status": http_status,
                "ollama_error_body": None,
                "exception_type": None,
                "local_resource_metrics": local_resource_metrics(
                    model_tag=model,
                    before=resource_before or {},
                    after=resource_after or {},
                    running_model_details=running_details,
                )
                if capture_local_resources
                else None,
                "local_resource_metrics_error": running_details_error,
            }
        except json.JSONDecodeError as exc:
            return {
                "raw_response": None,
                "error": f"Ollama returned non-JSON HTTP body for {model}: {exc}",
                "elapsed_seconds": elapsed,
                "http_status": http_status,
                "ollama_error_body": response_text,
                "exception_type": type(exc).__name__,
                "local_resource_metrics": local_resource_metrics(
                    model_tag=model,
                    before=resource_before or {},
                    after=resource_after or {},
                    running_model_details=running_details,
                )
                if capture_local_resources
                else None,
                "local_resource_metrics_error": running_details_error,
            }
    except requests.RequestException as exc:
        elapsed = time.perf_counter() - started
        return {
            "raw_response": None,
            "error": f"Ollama request failed for {model}: {exc}",
            "elapsed_seconds": elapsed,
            "http_status": getattr(getattr(exc, "response", None), "status_code", None),
            "ollama_error_body": getattr(getattr(exc, "response", None), "text", None),
            "exception_type": type(exc).__name__,
            "local_resource_metrics": local_resource_metrics(
                model_tag=model,
                before=resource_before or {},
                after=system_ram_snapshot() if capture_local_resources else {},
                running_model_details=[],
            )
            if capture_local_resources
            else None,
            "local_resource_metrics_error": None,
        }
    finally:
        if config.unload_after_request:
            unload_model(config, model)


def call_ollama(
    *,
    config: EvaluationConfig,
    model: str,
    prompt: str,
    deployment_type: str = "local",
    other_models: list[str] | tuple[str, ...] = (),
    output_schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    running_before, running_before_error = get_running_models(config)
    if other_models:
        other_unload = unload_and_confirm(config, other_models)
        if not other_unload["confirmed"]:
            running_after, _ = get_running_models(config)
            return {
                "raw_response": None,
                "error": f"Skipped {model}: could not confirm other evaluation model unloaded.",
                "elapsed_seconds": 0.0,
                "http_status": None,
                "ollama_error_body": None,
                "exception_type": None,
                "attempt_count": 0,
                "retry_performed": False,
                "retryable": False,
                "retry_reason": "pre_request_unload_failed",
                "initial_error": other_unload["error"],
                "final_error": other_unload["error"],
                "model_unloaded_after_request": False,
                "running_models_before_request": running_before,
                "running_models_after_request": running_after,
                "pre_request_unload": other_unload,
                "running_models_error": running_before_error,
            }

    payload = build_generate_payload(config, model, prompt, output_schema=output_schema)
    attempt_count = 0
    retry_performed = False
    initial_error: str | None = None
    final_result: dict[str, Any] | None = None

    while attempt_count < 2:
        attempt_count += 1
        result = perform_generate_request(
            config,
            model,
            payload,
            capture_local_resources=deployment_type == "local" and config.capture_local_resource_metrics,
        )
        if config.unload_after_request:
            unload_wait = wait_until_models_absent(config, [model])
            result["model_unloaded_after_request"] = bool(unload_wait["confirmed"])
            result["running_models_after_request"] = unload_wait["running_models"]
        else:
            running_after, running_after_error = get_running_models(config)
            result["model_unloaded_after_request"] = False
            result["running_models_after_request"] = running_after
            result["running_models_after_request_error"] = running_after_error
        final_result = result

        if result["error"] is None:
            break

        retry_reason = retry_reason_for_error(
            result.get("http_status"),
            result.get("error"),
            result.get("exception_type"),
            result.get("ollama_error_body"),
        )
        retryable = retry_reason != "not_retryable" and is_retryable_error(
            result.get("http_status"),
            result.get("error"),
            result.get("exception_type"),
            result.get("ollama_error_body"),
        )
        result["retryable"] = retryable
        result["retry_reason"] = retry_reason if result["error"] else "request_succeeded"
        if attempt_count == 1 and retryable:
            initial_error = result["error"]
            retry_performed = True
            unload_all_configured_models(config)
            time.sleep(RETRY_DELAY_SECONDS)
            continue
        break

    if final_result is None:
        final_result = {
            "raw_response": None,
            "error": f"Ollama request failed for {model}: no attempt was made.",
            "elapsed_seconds": 0.0,
            "http_status": None,
            "ollama_error_body": None,
            "exception_type": None,
            "model_unloaded_after_request": False,
            "running_models_after_request": [],
            "retryable": False,
            "retry_reason": "no_attempt",
        }
    final_error = final_result.get("error")
    if "retryable" not in final_result:
        final_result["retryable"] = False
        final_result["retry_reason"] = "request_succeeded" if final_error is None else "not_retryable"
    final_result.update(
        {
            "attempt_count": attempt_count,
            "retry_performed": retry_performed,
            "initial_error": initial_error,
            "final_error": final_error,
            "running_models_before_request": running_before,
            "running_models_error": running_before_error,
            "request_payload": payload,
        }
    )
    return final_result


def classify_generation_result(
    *,
    raw_response: dict[str, Any] | None,
    call_result: dict[str, Any],
    parsed_output: Any | None,
    valid_json: bool,
) -> dict[str, Any]:
    http_status = call_result.get("http_status")
    request_success = http_status == 200
    raw_output = str(raw_response.get("response") or "") if raw_response is not None else ""
    invalid_controls = invalid_control_character_details(raw_output)
    empty_response = request_success and raw_response is not None and not raw_output.strip()
    done = raw_response.get("done") if raw_response is not None else None
    done_reason = raw_response.get("done_reason") if raw_response is not None else None
    truncated = done_reason == "length"
    diagnostics = schema_diagnostics(parsed_output) if valid_json else {"compliant": False, "reason": None, "violations": []}
    output_schema_compliant = valid_json and bool(diagnostics["compliant"])
    questions = questions_from_parsed(parsed_output)
    complete = valid_json and complete_question_set(questions)
    exactly_four_questions = len(questions) == 4
    generation_completed = request_success and not empty_response and done is True and not truncated
    generation_success = (
        request_success
        and not empty_response
        and invalid_controls is None
        and done is True
        and not truncated
        and valid_json
        and output_schema_compliant
        and complete
        and exactly_four_questions
    )

    error = call_result.get("error")
    error_category = None
    retryable = bool(call_result.get("retryable"))
    retry_reason = str(call_result.get("retry_reason") or "not_retryable")
    account_or_usage_limit = contains_account_or_usage_limit_error(
        error,
        call_result.get("ollama_error_body"),
        raw_response,
    )
    if not request_success and account_or_usage_limit:
        error_category = "account_or_usage_limit"
        retryable = False
        retry_reason = "account_or_usage_limit"
    elif not request_success:
        error_category = "http_failure" if http_status is not None else "transport_failure"
    elif invalid_controls:
        error = "Model output contained disallowed ASCII control characters"
        error_category = "invalid_control_characters"
        retryable = False
        retry_reason = "invalid_control_characters"
    elif empty_response:
        error = "Ollama returned an empty model response"
        error_category = "empty_response"
        retryable = False
        retry_reason = "empty_response"
    elif done is False:
        error = "Ollama returned a non-streaming response with done=false"
        error_category = "incomplete_response"
        retryable = False
        retry_reason = "done_false"
        logger.warning("Ollama returned done=false payload: %s", json.dumps(raw_response, ensure_ascii=False))
    elif truncated:
        error = "Model output reached the configured generation limit before completion"
        error_category = "truncated_output"
        retryable = False
        retry_reason = "truncated_output"
    elif not valid_json:
        error_category = "invalid_json"
        retryable = False
        retry_reason = "invalid_json"
        if not error:
            error = "Model output was not valid JSON"
    elif not output_schema_compliant:
        error_category = "schema_non_compliance"
        retryable = False
        retry_reason = "schema_non_compliance"
        error = "Model output JSON did not match the required schema"
    elif not complete:
        error_category = "incomplete_question_set"
        retryable = False
        retry_reason = "incomplete_question_set"
        error = "Model output did not contain a complete required question set"
    elif done is not True:
        error_category = "incomplete_generation"
        retryable = False
        retry_reason = "incomplete_generation"
        error = "Ollama did not report a completed generation"
    elif generation_success:
        error = None
        error_category = None
        retryable = False
        retry_reason = "request_succeeded"

    return {
        "request_success": request_success,
        "generation_completed": generation_completed,
        "empty_response": empty_response,
        "done": done,
        "done_reason": done_reason,
        "truncated": truncated,
        "invalid_control_characters": invalid_controls,
        "schema_compliant": output_schema_compliant,
        "schema_failure_reason": diagnostics["reason"],
        "schema_violations": diagnostics["violations"],
        "complete_question_set": complete,
        "exactly_four_questions": exactly_four_questions,
        "generation_success": generation_success,
        "error": error,
        "error_category": error_category,
        "account_or_usage_limit_error": account_or_usage_limit,
        "retryable": retryable,
        "retry_reason": retry_reason,
    }


def question_from_one_question_output(parsed_output: Any) -> dict[str, Any] | None:
    if not isinstance(parsed_output, dict):
        return None
    question = parsed_output.get("question")
    return question if isinstance(question, dict) else None


def classify_one_question_generation_result(
    *,
    raw_response: dict[str, Any] | None,
    call_result: dict[str, Any],
    parsed_output: Any | None,
    valid_json: bool,
) -> dict[str, Any]:
    http_status = call_result.get("http_status")
    request_success = http_status == 200
    raw_output = str(raw_response.get("response") or "") if raw_response is not None else ""
    invalid_controls = invalid_control_character_details(raw_output)
    empty_response = request_success and raw_response is not None and not raw_output.strip()
    done = raw_response.get("done") if raw_response is not None else None
    done_reason = raw_response.get("done_reason") if raw_response is not None else None
    truncated = done_reason == "length"
    diagnostics = one_question_schema_diagnostics(parsed_output) if valid_json else {"compliant": False, "reason": None, "violations": []}
    output_schema_compliant = valid_json and bool(diagnostics["compliant"])
    generation_completed = request_success and not empty_response and done is True and not truncated
    generation_success = (
        request_success
        and not empty_response
        and invalid_controls is None
        and done is True
        and not truncated
        and valid_json
        and output_schema_compliant
    )

    error = call_result.get("error")
    error_category = None
    retryable = bool(call_result.get("retryable"))
    retry_reason = str(call_result.get("retry_reason") or "not_retryable")
    account_or_usage_limit = contains_account_or_usage_limit_error(
        error,
        call_result.get("ollama_error_body"),
        raw_response,
    )
    if not request_success and account_or_usage_limit:
        error_category = "account_or_usage_limit"
        retryable = False
        retry_reason = "account_or_usage_limit"
    elif not request_success:
        error_category = "http_failure" if http_status is not None else "transport_failure"
    elif invalid_controls:
        error = "Model output contained disallowed ASCII control characters"
        error_category = "invalid_control_characters"
        retryable = False
        retry_reason = "invalid_control_characters"
    elif empty_response:
        error = "Ollama returned an empty model response"
        error_category = "empty_response"
        retryable = False
        retry_reason = "empty_response"
    elif done is False:
        error = "Ollama returned a non-streaming response with done=false"
        error_category = "incomplete_response"
        retryable = False
        retry_reason = "done_false"
        logger.warning("Ollama returned done=false payload: %s", json.dumps(raw_response, ensure_ascii=False))
    elif truncated:
        error = "Model output reached the configured generation limit before completion"
        error_category = "truncated_output"
        retryable = False
        retry_reason = "truncated_output"
    elif not valid_json:
        error_category = "invalid_json"
        retryable = False
        retry_reason = "invalid_json"
        if not error:
            error = "Model output was not valid JSON"
    elif not output_schema_compliant:
        error_category = "schema_non_compliance"
        retryable = False
        retry_reason = "schema_non_compliance"
        error = "Model output JSON did not match the one-question schema"
    elif done is not True:
        error_category = "incomplete_generation"
        retryable = False
        retry_reason = "incomplete_generation"
        error = "Ollama did not report a completed generation"
    elif generation_success:
        error = None
        error_category = None
        retryable = False
        retry_reason = "request_succeeded"

    return {
        "request_success": request_success,
        "generation_completed": generation_completed,
        "empty_response": empty_response,
        "done": done,
        "done_reason": done_reason,
        "truncated": truncated,
        "invalid_control_characters": invalid_controls,
        "schema_compliant": output_schema_compliant,
        "schema_failure_reason": diagnostics["reason"],
        "schema_violations": diagnostics["violations"],
        "complete_question_set": False,
        "exactly_four_questions": False,
        "generation_success": generation_success,
        "error": error,
        "error_category": error_category,
        "account_or_usage_limit_error": account_or_usage_limit,
        "retryable": retryable,
        "retry_reason": retry_reason,
    }


def make_record(
    *,
    experiment_id: str,
    lecture: dict[str, str],
    model: str,
    config: EvaluationConfig,
    prompt: str,
    attempt_number: int = 1,
    request_id: str | None = None,
    experiment_group_id: str = "",
    lecture_hash: str = "",
    input_hash_value: str = "",
    other_models: list[str] | tuple[str, ...] = (),
) -> dict[str, Any]:
    model_id = model
    model_config = model_config_for(config, model_id)
    model_tag = str(model_config["model"])
    deployment_type = str(model_config["deployment_type"])
    lecture_hash = lecture_hash or passage_hash(lecture)
    input_hash_value = input_hash_value or input_hash(lecture, config)
    request_id = request_id or str(uuid4())
    prompt_diagnostics = prompt_size_diagnostics(lecture, config, prompt)
    estimated_pressure = warn_if_context_pressure(config, prompt)
    call_result = call_ollama(
        config=config,
        model=model_tag,
        prompt=prompt,
        deployment_type=deployment_type,
        other_models=other_models,
    )
    raw_response = call_result["raw_response"]
    elapsed_seconds = call_result["elapsed_seconds"]
    raw_output = ""
    parsed_output = None
    valid_json = False

    if raw_response is not None:
        raw_output = str(raw_response.get("response") or "")
        valid_json, parsed_output = parse_json_output(raw_output)

    prompt_eval_count = raw_response.get("prompt_eval_count") if raw_response else None
    eval_count = raw_response.get("eval_count") if raw_response else None
    prompt_eval_duration = raw_response.get("prompt_eval_duration") if raw_response else None
    eval_duration = raw_response.get("eval_duration") if raw_response else None
    pressure = context_pressure(config, prompt, prompt_eval_count) if prompt_eval_count is not None else estimated_pressure
    classification = classify_generation_result(
        raw_response=raw_response,
        call_result=call_result,
        parsed_output=parsed_output,
        valid_json=valid_json,
    )
    question_relevance_flags = relevance_flags(questions_from_parsed(parsed_output), lecture["content"]) if valid_json else []

    return {
        "experiment_id": experiment_id,
        "experiment_group_id": experiment_group_id,
        "record_type": "four_question_request",
        "aggregate_record": False,
        "question_sequence_number": None,
        "request_id": request_id,
        "attempt_number": attempt_number,
        "lecture_id": lecture["id"],
        "lecture_hash": lecture_hash,
        "input_hash": input_hash_value,
        "prompt_hash": prompt_hash(prompt),
        "topic": lecture["topic"],
        "lecture_content": lecture["content"],
        "source_file": lecture.get("source_file"),
        "source_type": lecture.get("source_type"),
        "normalized_slide_text": normalized_slide_text(lecture, config),
        "prompt_diagnostics": prompt_diagnostics,
        "model": model_id,
        "model_tag": model_tag,
        "exact_model_tag": model_tag,
        "provider": model_config["provider"],
        "deployment_type": deployment_type,
        "internet_required": bool(model_config["internet_required"]),
        "data_leaves_institution": bool(model_config["data_leaves_institution"]),
        "offline_supported": bool(model_config["offline_supported"]),
        "pricing": model_config.get("pricing"),
        "pricing_display": model_config.get("pricing_display"),
        "generation_settings": config.generation_settings,
        "requested_output_schema": OLLAMA_JSON_SCHEMA if config.use_json_schema else None,
        "elapsed_seconds": elapsed_seconds,
        "response_time_seconds": elapsed_seconds,
        "valid_json": valid_json,
        "raw_output": raw_output,
        "parsed_output": parsed_output,
        "format_validation": {
            "valid_json": valid_json,
            "schema_compliant": classification["schema_compliant"],
            "schema_failure_reason": classification["schema_failure_reason"],
            "schema_violations": classification["schema_violations"],
            "complete_question_set": classification["complete_question_set"],
            "exactly_four_questions": classification["exactly_four_questions"],
            "invalid_control_characters": classification["invalid_control_characters"],
            "done": classification["done"],
        },
        "error": classification["error"],
        "error_category": classification["error_category"],
        "account_or_usage_limit_error": classification["account_or_usage_limit_error"],
        "request_success": classification["request_success"],
        "generation_completed": classification["generation_completed"],
        "empty_response": classification["empty_response"],
        "done": classification["done"],
        "done_reason": classification["done_reason"],
        "truncated": classification["truncated"],
        "invalid_control_characters": classification["invalid_control_characters"],
        "schema_compliant": classification["schema_compliant"],
        "schema_failure_reason": classification["schema_failure_reason"],
        "schema_violations": classification["schema_violations"],
        "complete_question_set": classification["complete_question_set"],
        "exactly_four_questions": classification["exactly_four_questions"],
        "question_relevance_flags": question_relevance_flags,
        "off_topic_question_count": len(question_relevance_flags),
        "generation_success": classification["generation_success"],
        "http_status": call_result.get("http_status"),
        "ollama_error_body": call_result.get("ollama_error_body"),
        "exception_type": call_result.get("exception_type"),
        "attempt_count": call_result.get("attempt_count"),
        "retry_performed": call_result.get("retry_performed"),
        "retryable": classification["retryable"],
        "retry_reason": classification["retry_reason"],
        "initial_error": call_result.get("initial_error"),
        "final_error": call_result.get("final_error"),
        "success": classification["generation_success"],
        "model_unloaded_after_request": call_result.get("model_unloaded_after_request"),
        "running_models_before_request": call_result.get("running_models_before_request"),
        "running_models_after_request": call_result.get("running_models_after_request"),
        "local_inference_load_status": (
            "warm"
            if deployment_type == "local"
            and any(model_names_match(model_tag, running) for running in call_result.get("running_models_before_request") or [])
            else ("cold" if deployment_type == "local" else None)
        ),
        "local_resource_metrics": call_result.get("local_resource_metrics") if deployment_type == "local" else None,
        "local_resource_metrics_error": call_result.get("local_resource_metrics_error") if deployment_type == "local" else None,
        "client_side_usage": None,
        "cloud_usage": extract_cloud_usage(raw_response) if deployment_type == "cloud" else None,
        "context_pressure_warning": pressure["context_pressure_warning"],
        "prompt_token_count_for_context": pressure["prompt_token_count_for_context"],
        "prompt_token_count_source": pressure["prompt_token_count_source"],
        "prompt_eval_count": prompt_eval_count,
        "eval_count": eval_count,
        "prompt_eval_duration": prompt_eval_duration,
        "eval_duration": eval_duration,
        "tokens_per_second": duration_tokens_per_second(eval_count, eval_duration),
        "raw_response": raw_response,
    }


def make_one_question_record(
    *,
    experiment_id: str,
    lecture: dict[str, str],
    model: str,
    config: EvaluationConfig,
    prompt: str,
    attempt_number: int,
    question_sequence_number: int,
    request_id: str | None = None,
    experiment_group_id: str = "",
    lecture_hash: str = "",
    input_hash_value: str = "",
    other_models: list[str] | tuple[str, ...] = (),
) -> dict[str, Any]:
    model_id = model
    model_config = model_config_for(config, model_id)
    model_tag = str(model_config["model"])
    deployment_type = str(model_config["deployment_type"])
    lecture_hash = lecture_hash or passage_hash(lecture)
    input_hash_value = input_hash_value or input_hash(lecture, config)
    request_id = request_id or str(uuid4())
    prompt_diagnostics = prompt_size_diagnostics(lecture, config, prompt)
    estimated_pressure = warn_if_context_pressure(config, prompt)
    call_result = call_ollama(
        config=config,
        model=model_tag,
        prompt=prompt,
        deployment_type=deployment_type,
        other_models=other_models,
        output_schema=ONE_QUESTION_JSON_SCHEMA,
    )
    raw_response = call_result["raw_response"]
    elapsed_seconds = call_result["elapsed_seconds"]
    raw_output = ""
    parsed_output = None
    valid_json = False

    if raw_response is not None:
        raw_output = str(raw_response.get("response") or "")
        valid_json, parsed_output = parse_json_output(raw_output)

    prompt_eval_count = raw_response.get("prompt_eval_count") if raw_response else None
    eval_count = raw_response.get("eval_count") if raw_response else None
    prompt_eval_duration = raw_response.get("prompt_eval_duration") if raw_response else None
    eval_duration = raw_response.get("eval_duration") if raw_response else None
    pressure = context_pressure(config, prompt, prompt_eval_count) if prompt_eval_count is not None else estimated_pressure
    classification = classify_one_question_generation_result(
        raw_response=raw_response,
        call_result=call_result,
        parsed_output=parsed_output,
        valid_json=valid_json,
    )
    question = question_from_one_question_output(parsed_output)
    question_relevance_flags = relevance_flags([question], lecture["content"]) if valid_json and question else []

    return {
        "experiment_id": experiment_id,
        "experiment_group_id": experiment_group_id,
        "record_type": "individual_question",
        "aggregate_record": False,
        "request_id": request_id,
        "attempt_number": attempt_number,
        "question_sequence_number": question_sequence_number,
        "lecture_id": lecture["id"],
        "lecture_hash": lecture_hash,
        "input_hash": input_hash_value,
        "prompt_hash": prompt_hash(prompt),
        "topic": lecture["topic"],
        "lecture_content": lecture["content"],
        "source_file": lecture.get("source_file"),
        "source_type": lecture.get("source_type"),
        "normalized_slide_text": normalized_slide_text(lecture, config),
        "prompt_diagnostics": prompt_diagnostics,
        "model": model_id,
        "model_tag": model_tag,
        "exact_model_tag": model_tag,
        "provider": model_config["provider"],
        "deployment_type": deployment_type,
        "internet_required": bool(model_config["internet_required"]),
        "data_leaves_institution": bool(model_config["data_leaves_institution"]),
        "offline_supported": bool(model_config["offline_supported"]),
        "pricing": model_config.get("pricing"),
        "pricing_display": model_config.get("pricing_display"),
        "generation_settings": config.generation_settings,
        "requested_output_schema": ONE_QUESTION_JSON_SCHEMA if config.use_json_schema else None,
        "elapsed_seconds": elapsed_seconds,
        "response_time_seconds": elapsed_seconds,
        "valid_json": valid_json,
        "raw_output": raw_output,
        "parsed_output": parsed_output,
        "format_validation": {
            "valid_json": valid_json,
            "schema_compliant": classification["schema_compliant"],
            "schema_failure_reason": classification["schema_failure_reason"],
            "schema_violations": classification["schema_violations"],
            "complete_question_set": False,
            "exactly_four_questions": False,
            "invalid_control_characters": classification["invalid_control_characters"],
            "done": classification["done"],
        },
        "error": classification["error"],
        "error_category": classification["error_category"],
        "account_or_usage_limit_error": classification["account_or_usage_limit_error"],
        "request_success": classification["request_success"],
        "generation_completed": classification["generation_completed"],
        "empty_response": classification["empty_response"],
        "done": classification["done"],
        "done_reason": classification["done_reason"],
        "truncated": classification["truncated"],
        "invalid_control_characters": classification["invalid_control_characters"],
        "schema_compliant": classification["schema_compliant"],
        "schema_failure_reason": classification["schema_failure_reason"],
        "schema_violations": classification["schema_violations"],
        "complete_question_set": False,
        "exactly_four_questions": False,
        "question_relevance_flags": question_relevance_flags,
        "off_topic_question_count": len(question_relevance_flags),
        "generation_success": classification["generation_success"],
        "http_status": call_result.get("http_status"),
        "ollama_error_body": call_result.get("ollama_error_body"),
        "exception_type": call_result.get("exception_type"),
        "attempt_count": call_result.get("attempt_count"),
        "retry_performed": call_result.get("retry_performed"),
        "retryable": classification["retryable"],
        "retry_reason": classification["retry_reason"],
        "initial_error": call_result.get("initial_error"),
        "final_error": call_result.get("final_error"),
        "success": classification["generation_success"],
        "model_unloaded_after_request": call_result.get("model_unloaded_after_request"),
        "running_models_before_request": call_result.get("running_models_before_request"),
        "running_models_after_request": call_result.get("running_models_after_request"),
        "local_inference_load_status": (
            "warm"
            if deployment_type == "local"
            and any(model_names_match(model_tag, running) for running in call_result.get("running_models_before_request") or [])
            else ("cold" if deployment_type == "local" else None)
        ),
        "local_resource_metrics": call_result.get("local_resource_metrics") if deployment_type == "local" else None,
        "local_resource_metrics_error": call_result.get("local_resource_metrics_error") if deployment_type == "local" else None,
        "client_side_usage": None,
        "cloud_usage": extract_cloud_usage(raw_response) if deployment_type == "cloud" else None,
        "context_pressure_warning": pressure["context_pressure_warning"],
        "prompt_token_count_for_context": pressure["prompt_token_count_for_context"],
        "prompt_token_count_source": pressure["prompt_token_count_source"],
        "prompt_eval_count": prompt_eval_count,
        "eval_count": eval_count,
        "prompt_eval_duration": prompt_eval_duration,
        "eval_duration": eval_duration,
        "tokens_per_second": duration_tokens_per_second(eval_count, eval_duration),
        "raw_response": raw_response,
    }


def aggregate_one_question_records(
    *,
    experiment_id: str,
    experiment_group_id: str,
    lecture: dict[str, str],
    model: str,
    config: EvaluationConfig,
    attempt_number: int,
    question_records: list[dict[str, Any]],
    lecture_hash: str,
    input_hash_value: str,
) -> dict[str, Any]:
    model_config = model_config_for(config, model)
    model_tag = str(model_config["model"])
    deployment_type = str(model_config["deployment_type"])
    ordered_records = sorted(question_records, key=lambda record: int(record.get("question_sequence_number") or 0))
    questions = [
        question_from_one_question_output(record.get("parsed_output"))
        for record in ordered_records
        if record.get("generation_success") is True and question_from_one_question_output(record.get("parsed_output")) is not None
    ]
    parsed_output = {"questions": questions}
    diagnostics = schema_diagnostics(parsed_output)
    complete = complete_question_set(questions)
    all_children_successful = (
        len(ordered_records) == 4
        and all(
            record.get("request_success") is True
            and record.get("done") is True
            and record.get("truncated") is not True
            and record.get("invalid_control_characters") is None
            and record.get("valid_json") is True
            and record.get("schema_compliant") is True
            and record.get("generation_success") is True
            for record in ordered_records
        )
    )
    generation_success = all_children_successful and bool(diagnostics["compliant"]) and complete
    total_elapsed_seconds = round(
        sum(float(record.get("elapsed_seconds") or 0.0) for record in ordered_records),
        6,
    )
    child_error_categories = [
        record.get("error_category")
        for record in ordered_records
        if record.get("error_category")
    ]
    error_category = None if generation_success else (child_error_categories[0] if child_error_categories else "incomplete_question_set")
    error = None if generation_success else "One-question requests did not produce a complete four-question set"
    question_relevance_flags = relevance_flags(questions, lecture["content"]) if questions else []

    return {
        "experiment_id": experiment_id,
        "experiment_group_id": experiment_group_id,
        "record_type": "aggregate_question_set",
        "aggregate_record": True,
        "request_id": str(uuid4()),
        "aggregate_request_ids": [str(record.get("request_id")) for record in ordered_records],
        "attempt_number": attempt_number,
        "question_sequence_number": None,
        "lecture_id": lecture["id"],
        "lecture_hash": lecture_hash,
        "input_hash": input_hash_value,
        "prompt_hash": prompt_hash("|".join(str(record.get("prompt_hash") or "") for record in ordered_records)),
        "topic": lecture["topic"],
        "lecture_content": lecture["content"],
        "source_file": lecture.get("source_file"),
        "source_type": lecture.get("source_type"),
        "normalized_slide_text": normalized_slide_text(lecture, config),
        "model": model,
        "model_tag": model_tag,
        "exact_model_tag": model_tag,
        "provider": model_config["provider"],
        "deployment_type": deployment_type,
        "internet_required": bool(model_config["internet_required"]),
        "data_leaves_institution": bool(model_config["data_leaves_institution"]),
        "offline_supported": bool(model_config["offline_supported"]),
        "pricing": model_config.get("pricing"),
        "pricing_display": model_config.get("pricing_display"),
        "generation_settings": config.generation_settings,
        "requested_output_schema": OLLAMA_JSON_SCHEMA,
        "question_count": len(questions),
        "target_question_count": 4,
        "successful_question_count": sum(1 for record in ordered_records if record.get("generation_success") is True),
        "total_elapsed_seconds": total_elapsed_seconds,
        "elapsed_seconds": total_elapsed_seconds,
        "response_time_seconds": total_elapsed_seconds,
        "valid_json": True,
        "raw_output": "",
        "parsed_output": parsed_output,
        "format_validation": {
            "valid_json": True,
            "schema_compliant": bool(diagnostics["compliant"]),
            "schema_failure_reason": diagnostics["reason"],
            "schema_violations": diagnostics["violations"],
            "complete_question_set": complete,
            "exactly_four_questions": len(questions) == 4,
            "invalid_control_characters": None,
            "done": all(record.get("done") is True for record in ordered_records),
        },
        "error": error,
        "error_category": error_category,
        "account_or_usage_limit_error": any(record.get("account_or_usage_limit_error") is True for record in ordered_records),
        "request_success": all(record.get("request_success") is True for record in ordered_records) and len(ordered_records) == 4,
        "generation_completed": all(record.get("generation_completed") is True for record in ordered_records) and len(ordered_records) == 4,
        "empty_response": any(record.get("empty_response") is True for record in ordered_records),
        "done": all(record.get("done") is True for record in ordered_records) and len(ordered_records) == 4,
        "done_reason": "aggregate",
        "truncated": any(record.get("truncated") is True for record in ordered_records),
        "invalid_control_characters": None,
        "schema_compliant": bool(diagnostics["compliant"]),
        "schema_failure_reason": diagnostics["reason"],
        "schema_violations": diagnostics["violations"],
        "complete_question_set": complete,
        "complete_question_set_source": "aggregate_one_question_requests",
        "exactly_four_questions": len(questions) == 4,
        "question_relevance_flags": question_relevance_flags,
        "off_topic_question_count": len(question_relevance_flags),
        "generation_success": generation_success,
        "http_status": 200 if all(record.get("http_status") == 200 for record in ordered_records) and len(ordered_records) == 4 else None,
        "child_http_statuses": [record.get("http_status") for record in ordered_records],
        "ollama_error_body": None,
        "exception_type": None,
        "attempt_count": sum(int(record.get("attempt_count") or 0) for record in ordered_records),
        "retry_performed": any(record.get("retry_performed") is True for record in ordered_records),
        "retryable": False,
        "retry_reason": "request_succeeded" if generation_success else "aggregate_child_failure",
        "initial_error": None,
        "final_error": error,
        "success": generation_success,
        "model_unloaded_after_request": any(record.get("model_unloaded_after_request") is True for record in ordered_records),
        "running_models_before_request": ordered_records[0].get("running_models_before_request") if ordered_records else [],
        "running_models_after_request": ordered_records[-1].get("running_models_after_request") if ordered_records else [],
        "local_inference_load_status": ordered_records[0].get("local_inference_load_status") if deployment_type == "local" and ordered_records else None,
        "local_resource_metrics": None,
        "local_resource_metrics_error": None,
        "client_side_usage": None,
        "cloud_usage": None,
        "context_pressure_warning": any(record.get("context_pressure_warning") is True for record in ordered_records),
        "prompt_token_count_for_context": None,
        "prompt_token_count_source": "aggregate_child_prompts",
        "prompt_eval_count": sum(record.get("prompt_eval_count") or 0 for record in ordered_records) or None,
        "eval_count": sum(record.get("eval_count") or 0 for record in ordered_records) or None,
        "prompt_eval_duration": sum(record.get("prompt_eval_duration") or 0 for record in ordered_records) or None,
        "eval_duration": sum(record.get("eval_duration") or 0 for record in ordered_records) or None,
        "tokens_per_second": None,
        "raw_response": None,
    }


def make_skipped_record(
    *,
    experiment_id: str,
    lecture: dict[str, str],
    model: str,
    config: EvaluationConfig,
    error: str,
    attempt_number: int = 1,
    request_id: str | None = None,
    experiment_group_id: str = "",
    lecture_hash: str = "",
    input_hash_value: str = "",
    running_models_before_request: list[str] | None = None,
    running_models_after_request: list[str] | None = None,
) -> dict[str, Any]:
    model_id = model
    model_config = model_config_for(config, model_id)
    model_tag = str(model_config["model"])
    deployment_type = str(model_config["deployment_type"])
    lecture_hash = lecture_hash or passage_hash(lecture)
    input_hash_value = input_hash_value or input_hash(lecture, config)
    prompt = build_evaluation_prompt(lecture["content"], config.prompt_chars)
    request_id = request_id or str(uuid4())
    prompt_diagnostics = prompt_size_diagnostics(lecture, config, prompt)
    running_models_before_request = running_models_before_request or []
    running_models_after_request = running_models_after_request or []
    return {
        "experiment_id": experiment_id,
        "experiment_group_id": experiment_group_id,
        "request_id": request_id,
        "attempt_number": attempt_number,
        "lecture_id": lecture["id"],
        "lecture_hash": lecture_hash,
        "input_hash": input_hash_value,
        "prompt_hash": prompt_hash(prompt),
        "topic": lecture["topic"],
        "lecture_content": lecture["content"],
        "source_file": lecture.get("source_file"),
        "source_type": lecture.get("source_type"),
        "normalized_slide_text": normalized_slide_text(lecture, config),
        "prompt_diagnostics": prompt_diagnostics,
        "model": model_id,
        "model_tag": model_tag,
        "exact_model_tag": model_tag,
        "provider": model_config["provider"],
        "deployment_type": deployment_type,
        "internet_required": bool(model_config["internet_required"]),
        "data_leaves_institution": bool(model_config["data_leaves_institution"]),
        "offline_supported": bool(model_config["offline_supported"]),
        "pricing": model_config.get("pricing"),
        "pricing_display": model_config.get("pricing_display"),
        "generation_settings": config.generation_settings,
        "requested_output_schema": OLLAMA_JSON_SCHEMA if config.use_json_schema else None,
        "elapsed_seconds": 0.0,
        "response_time_seconds": 0.0,
        "valid_json": False,
        "raw_output": "",
        "parsed_output": None,
        "format_validation": {
            "valid_json": False,
            "schema_compliant": False,
            "schema_failure_reason": None,
            "schema_violations": [],
            "complete_question_set": False,
            "exactly_four_questions": False,
            "invalid_control_characters": None,
            "done": None,
        },
        "error": error,
        "error_category": "pre_request_unload_failed",
        "account_or_usage_limit_error": False,
        "request_success": False,
        "generation_completed": False,
        "empty_response": False,
        "done": None,
        "done_reason": None,
        "truncated": False,
        "invalid_control_characters": None,
        "schema_compliant": False,
        "schema_failure_reason": None,
        "schema_violations": [],
        "complete_question_set": False,
        "exactly_four_questions": False,
        "question_relevance_flags": [],
        "off_topic_question_count": 0,
        "generation_success": False,
        "http_status": None,
        "ollama_error_body": None,
        "exception_type": None,
        "attempt_count": 0,
        "retry_performed": False,
        "retryable": False,
        "retry_reason": "pre_request_unload_failed",
        "initial_error": error,
        "final_error": error,
        "success": False,
        "model_unloaded_after_request": False,
        "running_models_before_request": running_models_before_request,
        "running_models_after_request": running_models_after_request,
        "local_inference_load_status": "cold" if deployment_type == "local" else None,
        "local_resource_metrics": None,
        "local_resource_metrics_error": None,
        "client_side_usage": None,
        "cloud_usage": None,
        "context_pressure_warning": False,
        "prompt_token_count_for_context": None,
        "prompt_token_count_source": None,
        "prompt_eval_count": None,
        "eval_count": None,
        "prompt_eval_duration": None,
        "eval_duration": None,
        "tokens_per_second": None,
        "raw_response": None,
    }


def get_available_system_ram_gib() -> float | None:
    try:
        if os.name == "nt":
            class MemoryStatus(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            status = MemoryStatus()
            status.dwLength = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return status.ullAvailPhys / (1024**3)
        if hasattr(os, "sysconf"):
            pages = os.sysconf("SC_AVPHYS_PAGES")
            page_size = os.sysconf("SC_PAGE_SIZE")
            return (pages * page_size) / (1024**3)
    except (AttributeError, OSError, ValueError):
        return None
    return None


def validate_local_hardware_for_model(
    *,
    model_id: str,
    model_config: dict[str, Any],
    total_system_ram_gib: float | None,
) -> dict[str, Any]:
    minimum_ram = model_config.get("minimum_system_ram_gib")
    passed = True
    message = None
    if isinstance(minimum_ram, (int, float)):
        if total_system_ram_gib is None:
            passed = False
            message = f"Could not confirm hardware support for {model_id}; total system RAM is unavailable."
        elif total_system_ram_gib < float(minimum_ram):
            passed = False
            message = (
                f"Configured local model {model_id} requires at least {minimum_ram} GiB system RAM; "
                f"detected {total_system_ram_gib:.2f} GiB."
            )
    return {
        "model_id": model_id,
        "model_tag": model_config.get("model"),
        "minimum_system_ram_gib": minimum_ram,
        "total_system_ram_gib": _round_gib(total_system_ram_gib),
        "passed": passed,
        "message": message,
    }


def cloud_setup_error(message: str, details: dict[str, Any] | None = None) -> RuntimeError:
    suffix = f" Details: {details}" if details else ""
    return RuntimeError(f"Setup error: {message}{suffix}")


def _cloud_auth_missing(status: int | None, body: str | None, error: str | None = None) -> bool:
    combined = " ".join(str(part or "") for part in [body, error]).lower()
    if status in {401, 403}:
        return True
    return any(term in combined for term in ["sign in", "signin", "login", "logged in", "unauthorized", "authentication"])


def validate_cloud_access_for_model(
    *,
    config: EvaluationConfig,
    model_id: str,
    model_config: dict[str, Any],
    available_models: list[str],
) -> dict[str, Any]:
    model_tag = str(model_config.get("model") or model_id)
    payload = {
        "model": model_tag,
        "prompt": "Reply with OK.",
        "stream": False,
        "keep_alive": 0,
        "options": {"temperature": 0, "num_predict": 1},
    }
    try:
        response = requests.post(config.generate_url, json=payload, timeout=config.timeout_seconds)
        status = response.status_code
        body = response.text
        if status >= 400:
            if _cloud_auth_missing(status, body):
                raise cloud_setup_error(
                    "Ollama Cloud authentication is missing. Run `ollama signin` before running cloud model comparisons.",
                    {"http_status": status, "model": model_tag},
                )
            if status == 404:
                raise cloud_setup_error(
                    f"Ollama cloud model {model_tag!r} is not available. Confirm the model tag and run `ollama pull {model_tag}` before the experiment.",
                    {"http_status": status},
                )
            if contains_account_or_usage_limit_error(body):
                return {
                    "model_id": model_id,
                    "model_tag": model_tag,
                    "signed_in": True,
                    "model_available": True,
                    "listed_by_local_tags": any(model_names_match(model_tag, available_model) for available_model in available_models),
                    "access_limited": True,
                    "http_status": status,
                }
            raise cloud_setup_error(
                f"Could not validate Ollama Cloud access for {model_tag!r}.",
                {"http_status": status},
            )
        listed_by_local_tags = any(model_names_match(model_tag, available_model) for available_model in available_models)
        return {
            "model_id": model_id,
            "model_tag": model_tag,
            "signed_in": True,
            "model_available": True,
            "listed_by_local_tags": listed_by_local_tags,
            "http_status": status,
        }
    except RuntimeError:
        raise
    except requests.RequestException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        body = getattr(getattr(exc, "response", None), "text", None)
        if _cloud_auth_missing(status, body, str(exc)):
            raise cloud_setup_error(
                "Ollama Cloud authentication is missing. Run `ollama signin` before running cloud model comparisons.",
                {"http_status": status, "model": model_tag},
            ) from exc
        raise cloud_setup_error(
            f"Could not validate Ollama Cloud access for {model_tag!r}: {exc}",
            {"http_status": status},
        ) from exc
    finally:
        unload_model(config, model_tag)


def summarize_records(records: list[dict[str, Any]], models: list[str] | tuple[str, ...]) -> dict[str, Any]:
    def summarize_subset(subset: list[dict[str, Any]]) -> dict[str, int]:
        return {
            "total_requests": len(subset),
            "request_successes": sum(1 for record in subset if record.get("request_success") is True),
            "empty_responses": sum(1 for record in subset if record.get("empty_response") is True),
            "truncated_outputs": sum(1 for record in subset if record.get("truncated") is True),
            "valid_json_outputs": sum(1 for record in subset if record.get("valid_json") is True),
            "schema_compliant_outputs": sum(1 for record in subset if record.get("schema_compliant") is True),
            "complete_question_sets": sum(1 for record in subset if record.get("complete_question_set") is True),
            "generation_successes": sum(1 for record in subset if record.get("generation_success") is True),
            "retries_performed": sum(1 for record in subset if record.get("retry_performed") is True),
            "final_http_failures": sum(1 for record in subset if record.get("request_success") is not True),
        }

    final_records = final_output_records(records)
    return {
        "overall": summarize_subset(final_records),
        "raw_record_count": len(records),
        "individual_request_count": sum(1 for record in records if record.get("record_type") == "individual_question"),
        "aggregate_record_count": sum(1 for record in records if record.get("record_type") == "aggregate_question_set"),
        "by_model": {
            model: summarize_subset([record for record in final_records if record.get("model") == model])
            for model in models
        },
    }


def _average_or_none(values: list[Any]) -> float | None:
    clean = [float(value) for value in values if isinstance(value, (int, float))]
    if not clean:
        return None
    return round(sum(clean) / len(clean), 4)


def _median_or_none(values: list[Any]) -> float | None:
    clean = [float(value) for value in values if isinstance(value, (int, float))]
    if not clean:
        return None
    return round(float(median(clean)), 4)


def _percentage_or_none(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round((numerator / denominator) * 100, 2)


def _local_status_summary(records: list[dict[str, Any]], deployment_type: str) -> str | None:
    if deployment_type != "local":
        return None
    cold = sum(1 for record in records if record.get("local_inference_load_status") == "cold")
    warm = sum(1 for record in records if record.get("local_inference_load_status") == "warm")
    if cold and warm:
        return f"cold:{cold}, warm:{warm}"
    if cold:
        return "cold"
    if warm:
        return "warm"
    return "not_recorded"


def _peak_local_ram(records: list[dict[str, Any]]) -> float | None:
    values: list[float] = []
    for record in records:
        metrics = record.get("local_resource_metrics")
        if not isinstance(metrics, dict):
            continue
        value = metrics.get("peak_system_ram_used_gib")
        if isinstance(value, (int, float)):
            values.append(float(value))
    return round(max(values), 4) if values else None


def _editing_requirement(records: list[dict[str, Any]]) -> str:
    if not records:
        return "not_evaluated"
    if any(record.get("generation_success") is not True for record in records):
        return "required"
    return "human_review_required"


def build_comparison_summary(
    records: list[dict[str, Any]],
    models: list[str] | tuple[str, ...],
    config: EvaluationConfig,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for model_id in models:
        model_records = [record for record in final_output_records(records) if record.get("model") == model_id]
        model_config = model_config_for(config, model_id)
        deployment_type = str(model_config.get("deployment_type"))
        successful_attempts = sum(1 for record in model_records if record.get("generation_success") is True)
        schema_compliant_attempts = sum(1 for record in model_records if record.get("schema_compliant") is True)
        pricing_display = model_config.get("pricing_display") if isinstance(model_config.get("pricing_display"), dict) else {}
        rows.append(
            {
                "model": model_id,
                "model_tag": model_config.get("model"),
                "deployment_type": deployment_type,
                "successful_attempts": successful_attempts,
                "total_attempts": len(model_records),
                "format_compliance_rate": _percentage_or_none(schema_compliant_attempts, len(model_records)),
                "average_response_time_seconds": _average_or_none([record.get("response_time_seconds", record.get("elapsed_seconds")) for record in model_records]),
                "median_response_time_seconds": _median_or_none([record.get("response_time_seconds", record.get("elapsed_seconds")) for record in model_records]),
                "cold_or_warm_status_for_local_inference": _local_status_summary(model_records, deployment_type),
                "peak_ram_for_local_inference_gib": _peak_local_ram(model_records) if deployment_type == "local" else None,
                "human_factual_correctness": "pending_human_review",
                "relevance_score": "pending_human_review",
                "editing_requirement": _editing_requirement(model_records),
                "internet_dependency": bool(model_config.get("internet_required")),
                "data_leaves_institution": bool(model_config.get("data_leaves_institution")),
                "direct_request_cost_status": pricing_display.get("direct_request_cost", "Not applicable"),
                "free_tier_or_plan_limitation_status": (
                    f"Usage limits: {pricing_display.get('usage_limits')}; Plan: {pricing_display.get('plan')}"
                    if deployment_type == "cloud"
                    else "Not applicable"
                ),
            }
        )
    return rows


def preflight_checks(config: EvaluationConfig) -> dict[str, Any]:
    available_models: list[str] = []
    tags_error: dict[str, Any] | None = None
    try:
        response = requests.get(config.tags_url, timeout=config.timeout_seconds)
        tags_status = response.status_code
        tags_body = response.text
        response.raise_for_status()
        available_models = extract_model_names(response.json())
    except requests.RequestException as exc:
        tags_error = {
            "error": f"Ollama /api/tags request failed: {exc}",
            "http_status": getattr(getattr(exc, "response", None), "status_code", locals().get("tags_status", None)),
            "ollama_error_body": getattr(getattr(exc, "response", None), "text", locals().get("tags_body", None)),
            "exception_type": type(exc).__name__,
        }
    except json.JSONDecodeError as exc:
        tags_error = {
            "error": f"Ollama /api/tags returned non-JSON body: {exc}",
            "http_status": locals().get("tags_status", None),
            "ollama_error_body": locals().get("tags_body", None),
            "exception_type": type(exc).__name__,
        }

    model_configs = {model_id: model_config_for(config, model_id) for model_id in config.models}
    local_model_ids = [
        model_id
        for model_id, model_config in model_configs.items()
        if str(model_config.get("deployment_type")) == "local"
    ]
    cloud_model_ids = [
        model_id
        for model_id, model_config in model_configs.items()
        if str(model_config.get("deployment_type")) == "cloud"
    ]
    missing_models = [
        model_id
        for model_id in local_model_ids
        if not any(model_names_match(model_tag_for(config, model_id), available_model) for available_model in available_models)
    ]
    if tags_error:
        raise RuntimeError(f"Could not confirm configured Ollama models before experiment: {tags_error['error']}")
    if missing_models:
        missing_tags = ", ".join(f"{model_id} ({model_tag_for(config, model_id)})" for model_id in missing_models)
        raise RuntimeError(f"Configured local evaluation models not found in /api/tags: {missing_tags}")

    total_ram_gib = get_total_system_ram_gib()
    hardware_checks = [
        validate_local_hardware_for_model(
            model_id=model_id,
            model_config=model_configs[model_id],
            total_system_ram_gib=total_ram_gib,
        )
        for model_id in local_model_ids
    ]
    failed_hardware = [check for check in hardware_checks if not check["passed"]]
    if failed_hardware:
        raise RuntimeError(" ".join(str(check["message"]) for check in failed_hardware if check["message"]))

    cloud_access_checks: list[dict[str, Any]] = []
    if cloud_model_ids and config.require_cloud_preflight:
        for model_id in cloud_model_ids:
            cloud_access_checks.append(
                validate_cloud_access_for_model(
                    config=config,
                    model_id=model_id,
                    model_config=model_configs[model_id],
                    available_models=available_models,
                )
            )

    running_before, ps_error = get_running_models(config)
    configured_tags = model_tags_for(config, config.models)
    running_evaluation_models = configured_models_present(configured_tags, running_before)
    unload_result = unload_and_confirm(config, running_evaluation_models) if running_evaluation_models else wait_until_models_absent(config, configured_tags)
    if not unload_result["confirmed"]:
        logger.warning("Could not confirm all evaluation models were unloaded before experiment: %s", unload_result["error"])

    available_ram_gib = get_available_system_ram_gib()
    if available_ram_gib is not None and available_ram_gib < 5:
        logger.warning("Available system RAM is below 5 GiB: %.2f GiB", available_ram_gib)

    return {
        "available_models": available_models,
        "missing_models": missing_models,
        "model_configs": model_configs,
        "local_model_ids": local_model_ids,
        "cloud_model_ids": cloud_model_ids,
        "hardware_checks": hardware_checks,
        "cloud_access_checks": cloud_access_checks,
        "tags_error": tags_error,
        "running_models_before_preflight": running_before,
        "running_models_error": ps_error,
        "running_evaluation_models_before_unload": running_evaluation_models,
        "preflight_unload": unload_result,
        "available_system_ram_gib": available_ram_gib,
        "total_system_ram_gib": _round_gib(total_ram_gib),
    }


def run_experiment(
    input_path: Path,
    results_dir: Path,
    config: EvaluationConfig,
    selected_model: str | None = None,
    experiment_group_id: str | None = None,
) -> Path:
    if config.questions_per_request not in (1, 4):
        raise ValueError("questions_per_request must be 1 or 4.")
    passages = load_passages(input_path)
    if config.max_passages is not None:
        passages = passages[: config.max_passages]
    results_dir.mkdir(parents=True, exist_ok=True)
    selected_models = resolve_model_selection(config, selected_model)
    experiment_group_id = experiment_group_id or f"rq1_group_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    experiment_id = f"rq1_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    model_suffix = f"_{safe_model_name(selected_models[0])}" if selected_model is not None else ""
    output_path = results_dir / f"{experiment_id}{model_suffix}_comparison.json"
    if output_path.exists():
        raise FileExistsError(f"Refusing to overwrite existing result file: {output_path}")
    passage_hashes = input_passage_hashes(passages)
    normalized_input_hashes = {lecture["id"]: input_hash(lecture, config) for lecture in passages}

    records: list[dict[str, Any]] = []
    execution_order: list[dict[str, Any]] = []
    experiment_started = time.perf_counter()
    preflight = preflight_checks(config)
    logger.info("Starting experiment %s with %d passages", experiment_id, len(passages))
    for model in selected_models:
        model_tag = model_tag_for(config, model)
        other_models = [other_model for other_model in config.models if other_model != model]
        other_model_tags = model_tags_for(config, other_models)
        transition = unload_and_confirm(config, other_model_tags)
        if transition["confirmed"] and config.request_delay_seconds > 0:
            time.sleep(config.request_delay_seconds)
        execution_order.append(
            {
                "model": model,
                "model_tag": model_tag,
                "lecture_ids": [lecture["id"] for lecture in passages],
                "attempts_per_lecture": config.attempts_per_model,
                "questions_per_request": config.questions_per_request,
                "requests_per_lecture_attempt": 4 if config.questions_per_request == 1 else 1,
                "other_models_unloaded_before_batch": transition,
                "request_delay_seconds": config.request_delay_seconds if transition["confirmed"] else 0,
            }
        )
        if not transition["confirmed"]:
            error = f"Skipped batch for {model}: could not confirm other evaluation model unloaded."
            logger.warning(error)
            running_after = transition.get("running_models", [])
            for lecture in passages:
                for attempt_number in range(1, config.attempts_per_model + 1):
                    records.append(
                        make_skipped_record(
                            experiment_id=experiment_id,
                            experiment_group_id=experiment_group_id,
                            lecture=lecture,
                            model=model,
                            config=config,
                            error=error,
                            attempt_number=attempt_number,
                            lecture_hash=passage_hashes[lecture["id"]],
                            input_hash_value=normalized_input_hashes[lecture["id"]],
                            running_models_before_request=running_after,
                            running_models_after_request=running_after,
                        )
                    )
            continue

        for lecture in passages:
            for attempt_number in range(1, config.attempts_per_model + 1):
                if config.questions_per_request == 1:
                    question_records: list[dict[str, Any]] = []
                    for question_sequence_number in range(1, 5):
                        prompt = build_one_question_prompt(
                            lecture["content"],
                            config.prompt_chars,
                            question_sequence_number,
                        )
                        logger.info(
                            "Generating lecture=%s model=%s attempt=%s question=%s",
                            lecture["id"],
                            model,
                            attempt_number,
                            question_sequence_number,
                        )
                        record = make_one_question_record(
                            experiment_id=experiment_id,
                            experiment_group_id=experiment_group_id,
                            lecture=lecture,
                            model=model,
                            config=config,
                            prompt=prompt,
                            attempt_number=attempt_number,
                            question_sequence_number=question_sequence_number,
                            lecture_hash=passage_hashes[lecture["id"]],
                            input_hash_value=normalized_input_hashes[lecture["id"]],
                            other_models=other_model_tags,
                        )
                        if record["error"]:
                            logger.warning(record["error"])
                        records.append(record)
                        question_records.append(record)
                    aggregate_record = aggregate_one_question_records(
                        experiment_id=experiment_id,
                        experiment_group_id=experiment_group_id,
                        lecture=lecture,
                        model=model,
                        config=config,
                        attempt_number=attempt_number,
                        question_records=question_records,
                        lecture_hash=passage_hashes[lecture["id"]],
                        input_hash_value=normalized_input_hashes[lecture["id"]],
                    )
                    if aggregate_record["error"]:
                        logger.warning(aggregate_record["error"])
                    records.append(aggregate_record)
                else:
                    prompt = build_evaluation_prompt(lecture["content"], config.prompt_chars)
                    logger.info("Generating lecture=%s model=%s attempt=%s", lecture["id"], model, attempt_number)
                    record = make_record(
                        experiment_id=experiment_id,
                        experiment_group_id=experiment_group_id,
                        lecture=lecture,
                        model=model,
                        config=config,
                        prompt=prompt,
                        attempt_number=attempt_number,
                        lecture_hash=passage_hashes[lecture["id"]],
                        input_hash_value=normalized_input_hashes[lecture["id"]],
                        other_models=other_model_tags,
                    )
                    if record["error"]:
                        logger.warning(record["error"])
                    records.append(record)
        unload_and_confirm(config, [model_tag])

    total_elapsed_seconds = time.perf_counter() - experiment_started
    payload = {
        "experiment_id": experiment_id,
        "experiment_group_id": experiment_group_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input_file": str(input_path),
        "models": list(selected_models),
        "configured_models": list(config.models),
        "model_configurations": {model_id: model_config_for(config, model_id) for model_id in config.models},
        "single_model_run": selected_model is not None,
        "input_passage_hashes": passage_hashes,
        "normalized_input_hashes": normalized_input_hashes,
        "generation_settings": config.generation_settings,
        "attempts_per_model": config.attempts_per_model,
        "questions_per_request": config.questions_per_request,
        "max_passages": config.max_passages,
        "execution_order": execution_order,
        "retry_policy": {
            "max_attempts": 2,
            "retry_delay_seconds": RETRY_DELAY_SECONDS,
            "retryable_failures": ["transport failure", "HTTP 500", "terminated runner"],
        },
        "preflight": preflight,
        "summary": summarize_records(records, selected_models),
        "comparison_summary": build_comparison_summary(records, selected_models, config),
        "total_elapsed_seconds": total_elapsed_seconds,
        "records": records,
    }
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2, ensure_ascii=False)
    logger.info("Saved %s", output_path)
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Ollama local/cloud deployment comparison for educational question generation.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT_FILE, help="Path to evaluation_inputs.json or a PPTX dataset directory.")
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS_DIR, help="Directory for timestamped result files.")
    parser.add_argument("--model", default=None, help="Run only one configured model id or exact Ollama model tag in this process.")
    parser.add_argument("--max-passages", type=int, default=None, help="Limit the number of JSON passages or PPTX files used.")
    parser.add_argument("--all-passages", action="store_true", help="Use every JSON passage or PPTX file in the input.")
    parser.add_argument("--questions-per-request", type=int, default=None, help="Use 1 for four one-question calls per attempt, or 4 for legacy mode.")
    parser.add_argument("--experiment-group-id", default=None, help="Shared id used to merge separate model runs later.")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    config = load_config()
    if args.all_passages:
        config = replace(config, max_passages=None)
    elif args.max_passages is not None:
        if args.max_passages <= 0:
            raise ValueError("--max-passages must be a positive integer.")
        config = replace(config, max_passages=args.max_passages)
    if args.questions_per_request is not None:
        if args.questions_per_request not in (1, 4):
            raise ValueError("--questions-per-request must be 1 or 4.")
        config = replace(config, questions_per_request=args.questions_per_request)
    output_path = run_experiment(
        args.input,
        args.results_dir,
        config,
        selected_model=args.model,
        experiment_group_id=args.experiment_group_id,
    )
    print(f"Saved comparison results: {output_path}")


if __name__ == "__main__":
    main()
