from __future__ import annotations

import argparse
import csv
import hashlib
import json
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MERGE_VERSION = "v1"
SUPPORTED_EXPORT_VERSION = "v4"
STRICT_WARNING_TYPES = {
    "unreadable_json",
    "malformed_file",
    "missing_required_fields",
    "mixed_model_names",
    "mixed_provider_types",
}
CSV_COLUMNS = [
    "model_id",
    "provider",
    "deployment_type",
    "lecture_id",
    "batch_id",
    "question_number",
    "attempt_number",
    "request_kind",
    "requested_bloom_level",
    "requested_difficulty",
    "processing_time_seconds",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "tokens_per_second",
    "done",
    "done_reason",
    "valid_json",
    "schema_valid",
    "request_compliant",
    "instruction_compliance_score",
    "usable_output",
    "violation_count",
    "violations",
]


@dataclass
class MergeState:
    warnings: list[dict[str, Any]] = field(default_factory=list)
    malformed: bool = False

    def warn(self, warning_type: str, message: str, *, file: Path | None = None, **details: Any) -> None:
        if warning_type in STRICT_WARNING_TYPES:
            self.malformed = True
        warning: dict[str, Any] = {"type": warning_type, "message": message}
        if file is not None:
            warning["file"] = str(file)
        warning.update({key: value for key, value in details.items() if value is not None})
        self.warnings.append(warning)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_default(value: Any) -> str:
    return str(value)


def read_json(path: Path, state: MergeState) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        state.warn("unreadable_json", f"Could not read JSON file: {exc}", file=path)
        return None
    if not isinstance(payload, dict):
        state.warn("malformed_file", "JSON root must be an object.", file=path)
        return None
    return payload


def sha256_text(value: str | None) -> str | None:
    if value is None:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def as_number(value: Any) -> float | int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        if value is None or str(value).strip() == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def as_int(value: Any) -> int | None:
    number = as_number(value)
    return int(number) if isinstance(number, (int, float)) else None


def as_bool(value: Any) -> bool:
    return value is True


def rate(count: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(count / denominator, 6)


def sorted_json_values(values: set[Any]) -> list[str]:
    return sorted(str(value) for value in values if value is not None and str(value).strip() != "")


def is_index_file(path: Path) -> bool:
    return path.name.endswith("_index.json")


def primary_files(input_dir: Path) -> list[Path]:
    return sorted(path for path in input_dir.rglob("*.json") if not is_index_file(path))


def index_files(input_dir: Path) -> list[Path]:
    return sorted(path for path in input_dir.rglob("*.json") if is_index_file(path))


def validate_index_files(index_paths: list[Path], state: MergeState) -> None:
    for path in index_paths:
        payload = read_json(path, state)
        if payload is None:
            continue
        for batch in payload.get("batches") or []:
            if not isinstance(batch, dict):
                state.warn("malformed_index_entry", "Index batch entry must be an object.", file=path)
                continue
            filename = batch.get("file")
            if not filename:
                state.warn("missing_index_file_reference", "Index batch entry has no file reference.", file=path)
                continue
            referenced = path.parent / str(filename)
            if not referenced.exists():
                state.warn(
                    "index_missing_batch_file",
                    "Index references a batch file that is not present.",
                    file=path,
                    referenced_file=str(referenced),
                )


def validate_batch(payload: dict[str, Any], path: Path, state: MergeState) -> bool:
    missing = [field_name for field_name in ("export_version", "lecture", "batch", "questions") if field_name not in payload]
    if missing:
        state.warn("missing_required_fields", "Batch file is missing required top-level fields.", file=path, fields=missing)
        return False
    if payload.get("export_version") != SUPPORTED_EXPORT_VERSION:
        state.warn(
            "malformed_file",
            f"Unsupported export_version {payload.get('export_version')!r}; expected {SUPPORTED_EXPORT_VERSION}.",
            file=path,
        )
        return False
    if not isinstance(payload.get("lecture"), dict) or not isinstance(payload.get("batch"), dict):
        state.warn("malformed_file", "Batch lecture and batch sections must be objects.", file=path)
        return False
    if not isinstance(payload.get("questions"), list):
        state.warn("malformed_file", "Batch questions section must be a list.", file=path)
        return False
    return True


def prompt_text(prompt: Any) -> str | None:
    if isinstance(prompt, dict):
        system = prompt.get("system")
        user = prompt.get("user")
        if system and user:
            return f"{system}\n\n{user}"
        return system or user
    if isinstance(prompt, str):
        return prompt
    return None


def infer_provider(lecture: dict[str, Any], attempt: dict[str, Any], override: str | None) -> str | None:
    settings = attempt.get("request_settings") if isinstance(attempt.get("request_settings"), dict) else {}
    return override or settings.get("provider") or lecture.get("provider")


def infer_deployment_type(lecture: dict[str, Any], attempt: dict[str, Any], override: str | None) -> str | None:
    settings = attempt.get("request_settings") if isinstance(attempt.get("request_settings"), dict) else {}
    return override or settings.get("deployment_type") or lecture.get("deployment_type")


def flatten_attempt(
    *,
    source_file: Path,
    lecture: dict[str, Any],
    batch: dict[str, Any],
    question: dict[str, Any],
    attempt: dict[str, Any],
    model_id: str,
    provider_override: str | None,
    deployment_type_override: str | None,
) -> dict[str, Any]:
    input_section = attempt.get("input") if isinstance(attempt.get("input"), dict) else {}
    prompt_section = attempt.get("prompt") if isinstance(attempt.get("prompt"), dict) else attempt.get("prompt")
    response = attempt.get("response") if isinstance(attempt.get("response"), dict) else {}
    performance = attempt.get("performance") if isinstance(attempt.get("performance"), dict) else {}
    evaluation = attempt.get("evaluation") if isinstance(attempt.get("evaluation"), dict) else {}
    request_settings = attempt.get("request_settings") if isinstance(attempt.get("request_settings"), dict) else {}

    requested_model = (
        attempt.get("requested_model")
        or attempt.get("request_payload_model")
        or lecture.get("requested_model")
        or lecture.get("model")
    )
    response_model = attempt.get("response_model") or response.get("model") or lecture.get("response_model")
    raw_response = response.get("raw")
    http_status = response.get("http_status")
    done = response.get("done")
    done_reason = response.get("done_reason")
    valid_json = evaluation.get("valid_json")
    schema_valid = evaluation.get("schema_valid")
    request_compliant = evaluation.get("request_compliant")
    transport_success = http_status == 200 and raw_response is not None
    completed = done is True and done_reason != "length"
    usable_output = transport_success and completed and valid_json is True and schema_valid is True and request_compliant is True
    prompt_hash = input_section.get("prompt_hash") or sha256_text(prompt_text(prompt_section))
    processing_time_ms = as_number(performance.get("processing_time_ms"))
    processing_time_seconds = as_number(performance.get("processing_time_seconds"))
    if processing_time_seconds is None and isinstance(processing_time_ms, (int, float)):
        processing_time_seconds = round(processing_time_ms / 1000, 6)

    return {
        "model_id": model_id,
        "source_file": str(source_file),
        "lecture_id": lecture.get("lecture_id"),
        "lecture_hash": lecture.get("lecture_hash") or input_section.get("lecture_hash"),
        "class_id": lecture.get("class_id"),
        "instructor_id": lecture.get("instructor_id"),
        "batch_id": batch.get("batch_id"),
        "batch_created_at": batch.get("created_at"),
        "question_number": question.get("question_number") or input_section.get("question_number"),
        "question_type": question.get("question_type") or input_section.get("question_type"),
        "requested_bloom_level": question.get("requested_bloom_level") or input_section.get("bloom_level"),
        "requested_difficulty": question.get("requested_difficulty") or input_section.get("difficulty"),
        "request_id": attempt.get("request_id"),
        "attempt_number": attempt.get("attempt_number"),
        "request_kind": attempt.get("request_kind"),
        "is_retry": bool(attempt.get("is_retry")),
        "is_regeneration": bool(attempt.get("is_regeneration")),
        "parent_request_id": attempt.get("parent_request_id"),
        "timestamp": attempt.get("timestamp"),
        "provider": infer_provider(lecture, attempt, provider_override),
        "deployment_type": infer_deployment_type(lecture, attempt, deployment_type_override),
        "requested_model": requested_model,
        "response_model": response_model,
        "model_name_match": attempt.get("model_name_match") if attempt.get("model_name_match") is not None else lecture.get("model_name_match"),
        "prompt_hash": prompt_hash,
        "prompt": prompt_section,
        "request_settings": request_settings,
        "raw_response": raw_response,
        "parsed_response": response.get("parsed"),
        "http_status": http_status,
        "done": done,
        "done_reason": done_reason,
        "generation_success": response.get("generation_success"),
        "processing_time_ms": processing_time_ms,
        "processing_time_seconds": processing_time_seconds,
        "prompt_tokens": as_int(performance.get("prompt_tokens")),
        "completion_tokens": as_int(performance.get("completion_tokens")),
        "total_tokens": as_int(performance.get("total_tokens")),
        "tokens_per_second": as_number(performance.get("tokens_per_second")),
        "valid_json": valid_json,
        "schema_valid": schema_valid,
        "request_compliant": request_compliant,
        "instruction_compliance_score": as_number(evaluation.get("instruction_compliance_score")),
        "violations": evaluation.get("violations") or [],
        "compliance_checks": evaluation.get("compliance_checks") or {},
        "question_metrics": evaluation.get("question_metrics") or [],
        "aggregate_quality_metrics": evaluation.get("aggregate_quality_metrics") or {},
        "human_review": evaluation.get("human_review"),
        "transport_success": transport_success,
        "completed": completed,
        "usable_output": usable_output,
        "length_termination": done_reason == "length",
    }


def dedupe_key(record: dict[str, Any]) -> tuple[Any, ...]:
    request_id = record.get("request_id")
    if request_id:
        return ("request_id", request_id)
    return (
        "fallback",
        record.get("lecture_id"),
        record.get("batch_id"),
        record.get("question_number"),
        record.get("attempt_number"),
        record.get("timestamp"),
    )


def request_sort_key(record: dict[str, Any]) -> tuple[str, str, int, int, str]:
    return (
        str(record.get("lecture_id") or ""),
        str(record.get("batch_created_at") or ""),
        as_int(record.get("question_number")) or 10**9,
        as_int(record.get("attempt_number")) or 10**9,
        str(record.get("timestamp") or ""),
    )


def build_lecture_entries(batch_payloads: list[tuple[Path, dict[str, Any]]], requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
    request_counts: dict[tuple[Any, Any], int] = {}
    for record in requests:
        key = (record.get("lecture_id"), record.get("batch_id"))
        request_counts[key] = request_counts.get(key, 0) + 1

    entries: dict[tuple[Any, Any], dict[str, Any]] = {}
    for _path, payload in batch_payloads:
        lecture = payload.get("lecture") or {}
        batch = payload.get("batch") or {}
        key = (lecture.get("lecture_id"), batch.get("batch_id"))
        entries[key] = {
            "lecture_id": lecture.get("lecture_id"),
            "lecture_hash": lecture.get("lecture_hash"),
            "class_id": lecture.get("class_id"),
            "instructor_id": lecture.get("instructor_id"),
            "batch_id": batch.get("batch_id"),
            "created_at": batch.get("created_at"),
            "updated_at": batch.get("updated_at"),
            "question_count": len(payload.get("questions") or []),
            "request_count": request_counts.get(key, 0),
        }
    return sorted(entries.values(), key=lambda item: (str(item.get("lecture_id") or ""), str(item.get("created_at") or ""), str(item.get("batch_id") or "")))


def collect_requests(
    batch_payloads: list[tuple[Path, dict[str, Any]]],
    *,
    model_id: str,
    provider: str | None,
    deployment_type: str | None,
    state: MergeState,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    seen_request_ids: set[Any] = set()

    for source_file, payload in batch_payloads:
        lecture = payload.get("lecture") or {}
        batch = payload.get("batch") or {}
        for question in payload.get("questions") or []:
            if not isinstance(question, dict):
                state.warn("malformed_question", "Question entry must be an object.", file=source_file)
                continue
            attempts = question.get("attempts") or []
            if not isinstance(attempts, list):
                state.warn("malformed_attempts", "Question attempts must be a list.", file=source_file)
                continue
            for attempt in attempts:
                if not isinstance(attempt, dict):
                    state.warn("malformed_attempt", "Attempt entry must be an object.", file=source_file)
                    continue
                record = flatten_attempt(
                    source_file=source_file,
                    lecture=lecture,
                    batch=batch,
                    question=question,
                    attempt=attempt,
                    model_id=model_id,
                    provider_override=provider,
                    deployment_type_override=deployment_type,
                )
                key = dedupe_key(record)
                if key in seen:
                    state.warn(
                        "duplicate_request_id" if key[0] == "request_id" else "duplicate_fallback_request",
                        "Duplicate request skipped.",
                        file=source_file,
                        request_id=record.get("request_id"),
                    )
                    continue
                if record.get("request_id") in seen_request_ids:
                    state.warn("duplicate_request_id", "Duplicate request_id skipped.", file=source_file, request_id=record.get("request_id"))
                    continue
                seen.add(key)
                if record.get("request_id"):
                    seen_request_ids.add(record.get("request_id"))
                records.append(record)
    return sorted(records, key=request_sort_key)


def calculate_summary(
    *,
    source_file_count: int,
    lectures: list[dict[str, Any]],
    requests: list[dict[str, Any]],
) -> dict[str, Any]:
    request_count = len(requests)
    processing_times = [value for value in (as_number(record.get("processing_time_seconds")) for record in requests) if isinstance(value, (int, float))]
    tokens_per_second = [value for value in (as_number(record.get("tokens_per_second")) for record in requests) if isinstance(value, (int, float))]
    transport_success_count = sum(1 for record in requests if record.get("transport_success") is True)
    completed_count = sum(1 for record in requests if record.get("completed") is True)
    valid_json_count = sum(1 for record in requests if record.get("valid_json") is True)
    schema_valid_count = sum(1 for record in requests if record.get("schema_valid") is True)
    request_compliant_count = sum(1 for record in requests if record.get("request_compliant") is True)
    usable_output_count = sum(1 for record in requests if record.get("usable_output") is True)
    length_termination_count = sum(1 for record in requests if record.get("length_termination") is True)
    total_processing_time = sum(processing_times)

    summary = {
        "source_file_count": source_file_count,
        "lecture_count": len({item.get("lecture_id") for item in lectures}),
        "batch_count": len(lectures),
        "question_count": sum(as_int(item.get("question_count")) or 0 for item in lectures),
        "request_count": request_count,
        "initial_request_count": sum(1 for record in requests if record.get("request_kind") == "initial"),
        "retry_count": sum(1 for record in requests if record.get("is_retry") is True),
        "regeneration_count": sum(1 for record in requests if record.get("is_regeneration") is True),
        "transport_success_count": transport_success_count,
        "completed_count": completed_count,
        "valid_json_count": valid_json_count,
        "schema_valid_count": schema_valid_count,
        "request_compliant_count": request_compliant_count,
        "usable_output_count": usable_output_count,
        "length_termination_count": length_termination_count,
        "mean_processing_time_seconds": round(statistics.mean(processing_times), 6) if processing_times else None,
        "median_processing_time_seconds": round(statistics.median(processing_times), 6) if processing_times else None,
        "mean_tokens_per_second": round(statistics.mean(tokens_per_second), 6) if tokens_per_second else None,
        "total_processing_time_seconds": round(total_processing_time, 6),
        "total_prompt_tokens": sum(as_int(record.get("prompt_tokens")) or 0 for record in requests),
        "total_completion_tokens": sum(as_int(record.get("completion_tokens")) or 0 for record in requests),
        "total_tokens": sum(as_int(record.get("total_tokens")) or 0 for record in requests),
    }
    summary.update(
        {
            "transport_success_rate": rate(transport_success_count, request_count),
            "completion_rate": rate(completed_count, request_count),
            "valid_json_rate": rate(valid_json_count, request_count),
            "schema_valid_rate": rate(schema_valid_count, request_count),
            "request_compliance_rate": rate(request_compliant_count, request_count),
            "usable_output_rate": rate(usable_output_count, request_count),
            "length_termination_rate": rate(length_termination_count, request_count),
        }
    )
    return summary


def validate_mixed_values(
    *,
    requests: list[dict[str, Any]],
    batch_payloads: list[tuple[Path, dict[str, Any]]],
    state: MergeState,
) -> None:
    models = set()
    providers = set()
    for _path, payload in batch_payloads:
        lecture = payload.get("lecture") or {}
        models.update(value for value in (lecture.get("model"), lecture.get("requested_model")) if value)
        providers.add(lecture.get("provider")) if lecture.get("provider") else None
    for record in requests:
        models.update(value for value in (record.get("requested_model"), record.get("response_model")) if value)
        providers.add(record.get("provider")) if record.get("provider") else None
    if len(sorted_json_values(models)) > 1:
        state.warn("mixed_model_names", "Multiple model names were found in one merge input.", values=sorted_json_values(models))
    if len(sorted_json_values(providers)) > 1:
        state.warn("mixed_provider_types", "Multiple provider values were found in one merge input.", values=sorted_json_values(providers))


def infer_top_level_value(explicit: str | None, records: list[dict[str, Any]], *fields: str, fallback: str | None = None) -> str | None:
    if explicit:
        return explicit
    values: list[str] = []
    for record in records:
        for field_name in fields:
            value = record.get(field_name)
            if value is not None and str(value).strip() and str(value) not in values:
                values.append(str(value))
    return values[0] if values else fallback


def write_csv(path: Path, *, model_id: str, requests: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for record in requests:
            violations = record.get("violations") or []
            writer.writerow(
                {
                    "model_id": model_id,
                    "provider": record.get("provider"),
                    "deployment_type": record.get("deployment_type"),
                    "lecture_id": record.get("lecture_id"),
                    "batch_id": record.get("batch_id"),
                    "question_number": record.get("question_number"),
                    "attempt_number": record.get("attempt_number"),
                    "request_kind": record.get("request_kind"),
                    "requested_bloom_level": record.get("requested_bloom_level"),
                    "requested_difficulty": record.get("requested_difficulty"),
                    "processing_time_seconds": record.get("processing_time_seconds"),
                    "prompt_tokens": record.get("prompt_tokens"),
                    "completion_tokens": record.get("completion_tokens"),
                    "total_tokens": record.get("total_tokens"),
                    "tokens_per_second": record.get("tokens_per_second"),
                    "done": record.get("done"),
                    "done_reason": record.get("done_reason"),
                    "valid_json": record.get("valid_json"),
                    "schema_valid": record.get("schema_valid"),
                    "request_compliant": record.get("request_compliant"),
                    "instruction_compliance_score": record.get("instruction_compliance_score"),
                    "usable_output": record.get("usable_output"),
                    "violation_count": len(violations),
                    "violations": json.dumps(violations, ensure_ascii=False, default=json_default),
                }
            )


def load_batches(input_dir: Path, state: MergeState) -> list[tuple[Path, dict[str, Any]]]:
    batches: list[tuple[Path, dict[str, Any]]] = []
    for path in primary_files(input_dir):
        payload = read_json(path, state)
        if payload is None:
            continue
        if validate_batch(payload, path, state):
            batches.append((path, payload))
    return batches


def merge_model_results(
    *,
    input_dir: Path,
    model_id: str,
    output_path: Path,
    provider: str | None = None,
    deployment_type: str | None = None,
    model_name: str | None = None,
    strict: bool = False,
) -> dict[str, Any]:
    state = MergeState()
    if not input_dir.exists() or not input_dir.is_dir():
        raise ValueError(f"Input folder does not exist or is not a directory: {input_dir}")

    validate_index_files(index_files(input_dir), state)
    batch_payloads = load_batches(input_dir, state)
    requests = collect_requests(
        batch_payloads,
        model_id=model_id,
        provider=provider,
        deployment_type=deployment_type,
        state=state,
    )
    lectures = build_lecture_entries(batch_payloads, requests)
    validate_mixed_values(requests=requests, batch_payloads=batch_payloads, state=state)

    if strict and any(warning.get("type") in STRICT_WARNING_TYPES for warning in state.warnings):
        warning_summary = ", ".join(sorted({str(warning.get("type")) for warning in state.warnings if warning.get("type") in STRICT_WARNING_TYPES}))
        raise ValueError(f"Strict merge failed due to: {warning_summary}")

    result = {
        "merge_version": MERGE_VERSION,
        "model_id": model_id,
        "model_name": infer_top_level_value(model_name, requests, "requested_model", "response_model"),
        "provider": infer_top_level_value(provider, requests, "provider"),
        "deployment_type": infer_top_level_value(deployment_type, requests, "deployment_type"),
        "generated_at": utc_now_iso(),
        "source_folder": str(input_dir),
        "summary": calculate_summary(source_file_count=len(batch_payloads), lectures=lectures, requests=requests),
        "lectures": lectures,
        "requests": requests,
        "merge_warnings": state.warnings,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2, ensure_ascii=False, default=json_default), encoding="utf-8")
    write_csv(output_path.with_suffix(".csv"), model_id=model_id, requests=requests)
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Merge production v4 LLM evaluation exports for one model.")
    parser.add_argument("--input", required=True, type=Path, help="Folder containing production evaluation JSON exports.")
    parser.add_argument("--model-id", required=True, help="Research model ID, for example tinyllama-local.")
    parser.add_argument("--output", required=True, type=Path, help="Merged JSON output path.")
    parser.add_argument("--provider", default=None, help="Provider label to use or validate, for example ollama.")
    parser.add_argument("--deployment-type", default=None, help="Deployment type label, for example local or cloud.")
    parser.add_argument("--model-name", default=None, help="Exact model tag to store at the top level.")
    parser.add_argument("--strict", action="store_true", help="Fail for malformed files or mixed model/provider inputs.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = merge_model_results(
            input_dir=args.input,
            model_id=args.model_id,
            output_path=args.output,
            provider=args.provider,
            deployment_type=args.deployment_type,
            model_name=args.model_name,
            strict=args.strict,
        )
    except Exception as exc:
        parser.exit(1, f"merge_model_results failed: {exc}\n")

    csv_path = args.output.with_suffix(".csv")
    print(f"Merged {result['summary']['request_count']} requests from {result['summary']['source_file_count']} files.")
    print(f"JSON: {args.output}")
    print(f"CSV: {csv_path}")
    if result.get("merge_warnings"):
        print(f"Warnings: {len(result['merge_warnings'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
