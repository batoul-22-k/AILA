from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BALANCE_VERSION = "v1"
DEFAULT_EXPECTED_QUESTIONS = 4
CSV_COLUMNS = [
    "model",
    "lecture_hash",
    "batch_id",
    "question_number",
    "attempt_number",
    "processing_time_seconds",
    "valid_json",
    "schema_valid",
    "request_compliant",
    "usable_output",
    "retries",
    "completion_status",
]


@dataclass(frozen=True)
class BatchCandidate:
    model_id: str
    model_name: str | None
    provider: str | None
    deployment_type: str | None
    lecture_hash: str
    lecture_id: str | None
    batch_id: str
    created_at: str | None
    updated_at: str | None
    lecture: dict[str, Any]
    requests: tuple[dict[str, Any], ...]
    question_count: int
    distinct_question_count: int
    complete: bool
    exploratory: bool
    interrupted: bool


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_default(value: Any) -> str:
    return str(value)


def as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    try:
        if value is None or str(value).strip() == "":
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def normalized_text(value: Any) -> str:
    return str(value or "")


def sort_timestamp(value: Any) -> str:
    return normalized_text(value)


def safe_model_id(payload: dict[str, Any], fallback: str) -> str:
    value = payload.get("model_id")
    return str(value) if value else fallback


def read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON root must be an object: {path}")
    return payload


def discover_input_files(input_dir: Path | None, explicit_inputs: list[Path]) -> list[Path]:
    if explicit_inputs:
        return sorted(explicit_inputs)
    if input_dir is None:
        raise ValueError("Provide --input-dir or at least one --input file.")
    files = sorted(path for path in input_dir.glob("*_all_results.json") if path.is_file())
    if not files:
        files = sorted(
            path
            for path in input_dir.glob("*.json")
            if path.name not in {"balanced_results.json", "full_results.json", "balanced_summary.json"}
        )
    return files


def request_batch_key(record: dict[str, Any]) -> tuple[str | None, str | None]:
    return record.get("lecture_hash"), record.get("batch_id")


def build_candidates(payload: dict[str, Any], *, source_file: Path, expected_questions: int) -> list[BatchCandidate]:
    model_id = safe_model_id(payload, source_file.stem)
    model_name = payload.get("model_name")
    provider = payload.get("provider")
    deployment_type = payload.get("deployment_type")
    requests_by_batch: dict[tuple[str | None, str | None], list[dict[str, Any]]] = {}
    for request in payload.get("requests") or []:
        if not isinstance(request, dict):
            continue
        requests_by_batch.setdefault(request_batch_key(request), []).append(request)

    candidates: list[BatchCandidate] = []
    for lecture in payload.get("lectures") or []:
        if not isinstance(lecture, dict):
            continue
        lecture_hash = lecture.get("lecture_hash")
        batch_id = lecture.get("batch_id")
        if not lecture_hash or not batch_id:
            continue
        requests = tuple(requests_by_batch.get((lecture_hash, batch_id), []))
        question_numbers = {
            number
            for number in (as_int(request.get("question_number")) for request in requests)
            if number is not None
        }
        question_count = as_int(lecture.get("question_count")) or len(question_numbers)
        distinct_question_count = len(question_numbers)
        complete = question_count == expected_questions and distinct_question_count == expected_questions
        candidates.append(
            BatchCandidate(
                model_id=model_id,
                model_name=model_name,
                provider=provider,
                deployment_type=deployment_type,
                lecture_hash=str(lecture_hash),
                lecture_id=lecture.get("lecture_id"),
                batch_id=str(batch_id),
                created_at=lecture.get("created_at"),
                updated_at=lecture.get("updated_at"),
                lecture=lecture,
                requests=requests,
                question_count=question_count,
                distinct_question_count=distinct_question_count,
                complete=complete,
                exploratory=question_count > expected_questions or distinct_question_count > expected_questions,
                interrupted=question_count < expected_questions or distinct_question_count < expected_questions,
            )
        )
    return candidates


def candidate_sort_key(candidate: BatchCandidate) -> tuple[str, str, str]:
    return (sort_timestamp(candidate.created_at), normalized_text(candidate.lecture_id), normalized_text(candidate.batch_id))


def exclusion(
    candidate: BatchCandidate,
    reasons: list[str],
    *,
    selected_batch_id: str | None = None,
) -> dict[str, Any]:
    return {
        "model": candidate.model_id,
        "lecture_hash": candidate.lecture_hash,
        "lecture_id": candidate.lecture_id,
        "batch_id": candidate.batch_id,
        "created_at": candidate.created_at,
        "question_count": candidate.question_count,
        "distinct_question_count": candidate.distinct_question_count,
        "selected_batch_id": selected_batch_id,
        "reasons": reasons,
        "reason": reasons[0] if reasons else None,
    }


def classify_incomplete(candidate: BatchCandidate) -> list[str]:
    reasons = ["incomplete_batch"]
    if candidate.interrupted:
        reasons.append("interrupted_generation")
    if candidate.exploratory:
        reasons.append("exploratory_run")
    if not candidate.interrupted and not candidate.exploratory:
        reasons.append("configuration_test")
    return reasons


def select_batches(
    candidates: list[BatchCandidate],
    *,
    expected_questions: int,
    batch_selection: str,
) -> tuple[dict[str, BatchCandidate], list[dict[str, Any]]]:
    by_hash: dict[str, list[BatchCandidate]] = {}
    for candidate in candidates:
        by_hash.setdefault(candidate.lecture_hash, []).append(candidate)

    selected: dict[str, BatchCandidate] = {}
    exclusions: list[dict[str, Any]] = []
    reverse = batch_selection == "latest"

    for lecture_hash, hash_candidates in sorted(by_hash.items()):
        complete = sorted((candidate for candidate in hash_candidates if candidate.complete), key=candidate_sort_key, reverse=reverse)
        incomplete = [candidate for candidate in hash_candidates if not candidate.complete]
        for candidate in incomplete:
            exclusions.append(exclusion(candidate, classify_incomplete(candidate)))
        if not complete:
            continue
        chosen = complete[0]
        selected[lecture_hash] = chosen
        for candidate in complete[1:]:
            reasons = ["duplicate_batch"]
            if candidate.lecture_id != chosen.lecture_id:
                reasons.append("duplicate_upload")
            exclusions.append(exclusion(candidate, reasons, selected_batch_id=chosen.batch_id))

    return selected, exclusions


def request_sort_key(record: dict[str, Any]) -> tuple[str, str, int, int, str]:
    return (
        normalized_text(record.get("lecture_hash")),
        normalized_text(record.get("batch_id")),
        as_int(record.get("question_number")) or 10**9,
        as_int(record.get("attempt_number")) or 10**9,
        normalized_text(record.get("timestamp")),
    )


def completion_status(record: dict[str, Any]) -> str:
    if record.get("http_status") != 200 or record.get("raw_response") is None:
        return "transport_failed"
    if record.get("done_reason") == "length":
        return "length"
    if record.get("done") is True:
        return "completed"
    if record.get("done") is False:
        return "incomplete"
    return "unknown"


def retry_value(record: dict[str, Any]) -> bool:
    if record.get("is_retry") is True:
        return True
    if normalized_text(record.get("request_kind")) in {"automatic_retry", "quality_retry"}:
        return True
    attempt_number = as_int(record.get("attempt_number"))
    return bool(attempt_number and attempt_number > 1)


def build_balanced_model_payload(input_payload: dict[str, Any], selected_by_hash: dict[str, BatchCandidate], common_hashes: set[str]) -> dict[str, Any]:
    selected_candidates = [candidate for hash_value, candidate in selected_by_hash.items() if hash_value in common_hashes]
    selected_lecture_keys = {(candidate.lecture_hash, candidate.batch_id) for candidate in selected_candidates}
    requests = [
        dict(request)
        for candidate in selected_candidates
        for request in candidate.requests
        if (request.get("lecture_hash"), request.get("batch_id")) in selected_lecture_keys
    ]
    requests = sorted(requests, key=request_sort_key)
    return {
        "model_id": input_payload.get("model_id"),
        "model_name": input_payload.get("model_name"),
        "provider": input_payload.get("provider"),
        "deployment_type": input_payload.get("deployment_type"),
        "lectures": [candidate.lecture for candidate in sorted(selected_candidates, key=lambda item: (item.lecture_hash, sort_timestamp(item.created_at), item.batch_id))],
        "requests": requests,
    }


def validate_balanced_hash_sets(models: list[dict[str, Any]], expected_hashes: set[str]) -> None:
    for model in models:
        model_hashes = {request.get("lecture_hash") for request in model.get("requests") or []}
        if model_hashes != expected_hashes:
            raise ValueError(
                "Balanced validation failed for "
                f"{model.get('model_id')}: expected {sorted(expected_hashes)}, got {sorted(model_hashes)}"
            )


def count_exclusions(exclusions: list[dict[str, Any]], reason: str) -> int:
    return sum(1 for item in exclusions if reason in (item.get("reasons") or []))


def write_csv(path: Path, models: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for model in models:
            for request in model.get("requests") or []:
                writer.writerow(
                    {
                        "model": model.get("model_id"),
                        "lecture_hash": request.get("lecture_hash"),
                        "batch_id": request.get("batch_id"),
                        "question_number": request.get("question_number"),
                        "attempt_number": request.get("attempt_number"),
                        "processing_time_seconds": request.get("processing_time_seconds"),
                        "valid_json": request.get("valid_json"),
                        "schema_valid": request.get("schema_valid"),
                        "request_compliant": request.get("request_compliant"),
                        "usable_output": request.get("usable_output"),
                        "retries": retry_value(request),
                        "completion_status": completion_status(request),
                    }
                )


def refine_comparison_results(
    *,
    input_files: list[Path],
    output_dir: Path,
    expected_questions: int = DEFAULT_EXPECTED_QUESTIONS,
    batch_selection: str = "earliest",
) -> dict[str, Any]:
    if batch_selection not in {"earliest", "latest"}:
        raise ValueError("batch_selection must be 'earliest' or 'latest'.")
    if expected_questions <= 0:
        raise ValueError("expected_questions must be positive.")
    if not input_files:
        raise ValueError("No merged model result files found.")

    loaded = [{"source_file": str(path), "payload": read_json(path)} for path in input_files]
    model_selections: dict[str, dict[str, BatchCandidate]] = {}
    model_candidates: dict[str, list[BatchCandidate]] = {}
    exclusions: list[dict[str, Any]] = []

    for item in loaded:
        path = Path(item["source_file"])
        payload = item["payload"]
        model_id = safe_model_id(payload, path.stem)
        candidates = build_candidates(payload, source_file=path, expected_questions=expected_questions)
        model_candidates[model_id] = candidates
        selected, model_exclusions = select_batches(candidates, expected_questions=expected_questions, batch_selection=batch_selection)
        model_selections[model_id] = selected
        exclusions.extend(model_exclusions)

    selected_sets = [set(selected.keys()) for selected in model_selections.values()]
    common_hashes = set.intersection(*selected_sets) if selected_sets else set()
    all_hashes = set.union(*(set(candidate.lecture_hash for candidate in candidates) for candidates in model_candidates.values())) if model_candidates else set()

    for model_id, selected in model_selections.items():
        for lecture_hash, candidate in selected.items():
            if lecture_hash not in common_hashes:
                exclusions.append(exclusion(candidate, ["missing_common_lecture"]))

    balanced_models = [
        build_balanced_model_payload(item["payload"], model_selections[safe_model_id(item["payload"], Path(item["source_file"]).stem)], common_hashes)
        for item in loaded
    ]
    validate_balanced_hash_sets(balanced_models, common_hashes)

    selected_batches_by_model = {
        model_id: {
            lecture_hash: candidate.batch_id
            for lecture_hash, candidate in sorted(selected.items())
            if lecture_hash in common_hashes
        }
        for model_id, selected in sorted(model_selections.items())
    }
    duplicate_uploads_removed = count_exclusions(exclusions, "duplicate_upload")
    duplicate_batches_removed = count_exclusions(exclusions, "duplicate_batch")
    incomplete_batches_removed = count_exclusions(exclusions, "incomplete_batch")
    exploratory_runs_removed = count_exclusions(exclusions, "exploratory_run")
    interrupted_runs_removed = count_exclusions(exclusions, "interrupted_generation")
    missing_common_removed = count_exclusions(exclusions, "missing_common_lecture")

    generated_at = utc_now_iso()
    full_results = {
        "refinement_version": BALANCE_VERSION,
        "generated_at": generated_at,
        "source_files": [item["source_file"] for item in loaded],
        "models": [item["payload"] for item in loaded],
    }
    balanced_results = {
        "balance_version": BALANCE_VERSION,
        "generated_at": generated_at,
        "expected_question_count": expected_questions,
        "batch_selection": batch_selection,
        "model_count": len(loaded),
        "selected_lecture_hashes": sorted(common_hashes),
        "models": balanced_models,
    }
    summary = {
        "balance_version": BALANCE_VERSION,
        "generated_at": generated_at,
        "expected_question_count": expected_questions,
        "batch_selection": batch_selection,
        "model_ids": sorted(model_selections),
        "total_lectures_collected": sum(len(candidates) for candidates in model_candidates.values()),
        "unique_lecture_hash_count": len(all_hashes),
        "common_lecture_count": len(common_hashes),
        "excluded_lecture_count": len({item.get("lecture_hash") for item in exclusions}),
        "excluded_duplicate_batches": duplicate_batches_removed,
        "excluded_incomplete_batches": incomplete_batches_removed,
        "excluded_exploratory_runs": exploratory_runs_removed,
        "excluded_interrupted_generations": interrupted_runs_removed,
        "excluded_missing_common_lectures": missing_common_removed,
        "duplicate_uploads_removed": duplicate_uploads_removed,
        "duplicate_batches_removed": duplicate_batches_removed,
        "incomplete_batches_removed": incomplete_batches_removed,
        "exploratory_runs_removed": exploratory_runs_removed,
        "final_lecture_count_used_for_comparison": len(common_hashes),
        "selected_lecture_hashes": sorted(common_hashes),
        "selected_batches_by_model": selected_batches_by_model,
        "exclusions": sorted(exclusions, key=lambda item: (normalized_text(item.get("model")), normalized_text(item.get("lecture_hash")), normalized_text(item.get("created_at")), normalized_text(item.get("batch_id")))),
        "validation_passed": True,
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "full_results.json").write_text(json.dumps(full_results, indent=2, ensure_ascii=False, default=json_default), encoding="utf-8")
    (output_dir / "balanced_results.json").write_text(json.dumps(balanced_results, indent=2, ensure_ascii=False, default=json_default), encoding="utf-8")
    (output_dir / "balanced_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=json_default), encoding="utf-8")
    write_csv(output_dir / "balanced_comparison.csv", balanced_models)

    return {
        "full_results": full_results,
        "balanced_results": balanced_results,
        "balanced_summary": summary,
        "output_dir": str(output_dir),
    }


def print_report(summary: dict[str, Any], output_dir: Path) -> None:
    print(f"Total lectures collected: {summary['total_lectures_collected']}")
    print(f"Unique lecture_hash values: {summary['unique_lecture_hash_count']}")
    print(f"Common lecture_hash values: {summary['common_lecture_count']}")
    print(f"Duplicate uploads removed: {summary['duplicate_uploads_removed']}")
    print(f"Duplicate batches removed: {summary['duplicate_batches_removed']}")
    print(f"Incomplete batches removed: {summary['incomplete_batches_removed']}")
    print(f"Exploratory runs removed: {summary['exploratory_runs_removed']}")
    print(f"Final lecture count used for comparison: {summary['final_lecture_count_used_for_comparison']}")
    print(f"Validation passed: {summary['validation_passed']}")
    print(f"Balanced JSON: {output_dir / 'balanced_results.json'}")
    print(f"Full JSON: {output_dir / 'full_results.json'}")
    print(f"Summary JSON: {output_dir / 'balanced_summary.json'}")
    print(f"CSV: {output_dir / 'balanced_comparison.csv'}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create balanced LLM comparison datasets from merged model exports.")
    parser.add_argument("--input-dir", type=Path, default=None, help="Folder containing *_all_results.json model merge files.")
    parser.add_argument("--input", action="append", type=Path, default=[], help="Specific merged model result file. Can be repeated.")
    parser.add_argument("--output-dir", required=True, type=Path, help="Folder where balanced/full JSON and CSV files will be written.")
    parser.add_argument("--expected-questions", type=int, default=DEFAULT_EXPECTED_QUESTIONS, help="Expected generated question count per complete batch.")
    parser.add_argument("--batch-selection", choices=["earliest", "latest"], default="earliest", help="Which complete duplicate batch to keep.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        input_files = discover_input_files(args.input_dir, args.input)
        result = refine_comparison_results(
            input_files=input_files,
            output_dir=args.output_dir,
            expected_questions=args.expected_questions,
            batch_selection=args.batch_selection,
        )
    except Exception as exc:
        parser.exit(1, f"balance_comparison_results failed: {exc}\n")
    print_report(result["balanced_summary"], args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
