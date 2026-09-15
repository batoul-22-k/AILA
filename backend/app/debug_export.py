import csv
import hashlib
import json
import logging
import re
import statistics
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)

EXPORT_VERSION = "v3"
AGGREGATE_EXPORT_VERSION = "v4"
PROVIDER = "ollama"
NEAR_DUPLICATE_JACCARD_THRESHOLD = 0.8
REQUEST_KINDS = {"initial", "automatic_retry", "quality_retry", "manual_regeneration"}
DEFAULT_REQUEST_METADATA = {
    "request_id": None,
    "batch_id": None,
    "question_number": None,
    "question_type": None,
    "attempt_number": 1,
    "request_kind": "initial",
    "is_retry": False,
    "is_regeneration": False,
    "parent_request_id": None,
}

HUMAN_REVIEW_TEMPLATE = {
    "reviewed": False,
    "question_relevant": None,
    "answer_correct": None,
    "only_one_correct_answer": None,
    "question_clear": None,
    "options_plausible": None,
    "explanation_correct": None,
    "reviewer_notes": None,
}

SUMMARY_COLUMNS = [
    "model",
    "total_requests",
    "total_llm_requests",
    "initial_requests",
    "automatic_retries",
    "quality_retries",
    "manual_regenerations",
    "retry_rate",
    "regeneration_rate",
    "schema_compliance_rate",
    "schema_valid_rate",
    "request_compliance_rate",
    "mean_instruction_compliance_score",
    "exact_question_count_compliance_rate",
    "requested_type_compliance_rate",
    "correct_field_name_rate",
    "finish_reason_distribution",
    "truncated_response_rate",
    "mean_latency_per_request",
    "mean_tokens_per_request",
    "total_requested_questions",
    "first_attempt_success_rate",
    "first_attempt_compliant_rate",
    "final_compliant_rate_after_retries",
    "retries_that_improved_compliance",
    "retries_that_reduced_compliance",
    "manual_regenerations_that_improved_compliance",
    "final_success_rate_after_retries",
    "mean_attempts_per_question",
    "median_attempts_per_question",
    "maximum_attempts_required",
    "mean_total_latency_per_completed_question",
    "questions_requiring_retries",
    "questions_requiring_manual_regeneration",
    "total_generations",
    "successful_generations",
    "generation_success_rate",
    "valid_json_rate",
    "mean_processing_time_seconds",
    "median_processing_time_seconds",
    "minimum_processing_time_seconds",
    "maximum_processing_time_seconds",
    "processing_time_standard_deviation",
    "mean_tokens_per_second",
    "mean_prompt_tokens",
    "mean_completion_tokens",
    "mean_total_tokens",
    "total_questions",
    "valid_answer_rate",
    "unique_options_rate",
    "near_duplicate_option_rate",
    "reviewed_question_count",
    "human_answer_accuracy",
    "human_relevance_rate",
    "single_correct_answer_rate",
]

REQUIRED_QUESTION_FIELDS = {
    "type",
    "question_text",
    "options",
    "correct_answer",
    "explanation",
    "bloom_level",
    "difficulty",
    "source_slide",
}


def get_debug_export_root() -> Path:
    return Path(__file__).resolve().parents[1] / "debug_exports"


def safe_debug_filename_part(value: str | None, fallback: str = "unknown") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "").strip())
    return cleaned.strip("._") or fallback


def model_names_match(requested_model: str | None, response_model: str | None) -> bool:
    requested = str(requested_model or "").strip()
    response = str(response_model or "").strip()
    if not requested or not response:
        return False
    if requested == response:
        return True
    if ":" not in requested and response == f"{requested}:latest":
        return True
    if ":" not in response and requested == f"{response}:latest":
        return True
    return False


def sortable_number(value: Any) -> int:
    return value if isinstance(value, int) else 10**9


def parse_timestamp(value: Any) -> str:
    return str(value or "")


def clean_request_metadata(request_metadata: dict | None) -> dict:
    metadata = {**DEFAULT_REQUEST_METADATA, **(request_metadata or {})}
    if metadata.get("request_kind") not in REQUEST_KINDS:
        metadata["request_kind"] = "initial"
    metadata["is_retry"] = bool(metadata.get("is_retry"))
    metadata["is_regeneration"] = bool(metadata.get("is_regeneration"))
    return metadata


def sha256_hex(value: str | None) -> str | None:
    if value is None:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def include_full_prompt() -> bool:
    try:
        return bool(get_settings().debug_export_include_full_prompt)
    except Exception:
        return True


def request_options(request_payload: dict) -> dict:
    return request_payload.get("options") if isinstance(request_payload.get("options"), dict) else {}


def build_request_settings(request_payload: dict) -> dict:
    options = request_options(request_payload)
    return {
        "provider": request_payload.get("provider"),
        "deployment_type": request_payload.get("deployment_type"),
        "endpoint_label": request_payload.get("endpoint_label"),
        "temperature": options.get("temperature"),
        "seed": options.get("seed"),
        "num_ctx": options.get("num_ctx"),
        "num_predict": options.get("num_predict"),
        "stream": request_payload.get("stream"),
        "format": request_payload.get("format"),
        "keep_alive": request_payload.get("keep_alive"),
        "num_gpu": options.get("num_gpu"),
        "num_thread": options.get("num_thread"),
    }


def build_input_section(
    *,
    input_metadata: dict | None,
    request_metadata: dict,
    user_prompt: str,
    lecture_text: str | None,
) -> dict:
    clean_input = input_metadata or {}
    question_number = clean_input.get("question_number") or request_metadata.get("question_number")
    question_type = clean_input.get("question_type") or request_metadata.get("question_type")
    return {
        "question_type": question_type,
        "question_number": question_number,
        "bloom_level": clean_input.get("bloom_level"),
        "difficulty": clean_input.get("difficulty"),
        "output_language": clean_input.get("output_language"),
        "requested_question_count": clean_input.get("requested_question_count", 1),
        "previous_questions": clean_input.get("previous_questions") or [],
        "lecture_hash": sha256_hex(lecture_text),
        "prompt_hash": sha256_hex(user_prompt),
    }


def ns_to_ms(value: Any) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    return round(value / 1_000_000, 3)


def ms_to_seconds(value: Any) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    return round(value / 1000, 6)


def safe_divide(numerator: int | float | None, denominator: int | float | None) -> float | None:
    if not isinstance(numerator, (int, float)) or not isinstance(denominator, (int, float)) or denominator == 0:
        return None
    return numerator / denominator


def rounded(value: float | None, digits: int = 6) -> float | None:
    return round(value, digits) if isinstance(value, (int, float)) else None


def word_count(value: Any) -> int:
    return len(re.findall(r"\b[\w'-]+\b", str(value or "")))


def value_present(value: Any) -> bool:
    return value is not None and str(value).strip() != ""


def normalize_text(value: Any) -> str:
    lowered = str(value or "").lower()
    no_punctuation = re.sub(r"[^\w\s]", " ", lowered)
    return re.sub(r"\s+", " ", no_punctuation).strip()


def option_tokens(value: Any) -> set[str]:
    return {token for token in normalize_text(value).split() if token}


def jaccard_similarity(left: Any, right: Any) -> float:
    left_tokens = option_tokens(left)
    right_tokens = option_tokens(right)
    if not left_tokens and not right_tokens:
        return 1.0
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def parse_generated_content(raw_response: str | None) -> tuple[Any | None, bool]:
    if not raw_response or not str(raw_response).strip():
        return None, False
    try:
        return json.loads(raw_response), True
    except json.JSONDecodeError:
        return None, False


def questions_from_generated_content(parsed_generated_content: Any) -> list[dict]:
    if isinstance(parsed_generated_content, dict):
        questions = parsed_generated_content.get("questions")
    elif isinstance(parsed_generated_content, list):
        questions = parsed_generated_content
    else:
        questions = None
    return [question for question in questions or [] if isinstance(question, dict)]


def build_structure_metrics(raw_response: str | None, parsed_generated_content: Any | None, valid_json: bool) -> dict:
    questions = questions_from_generated_content(parsed_generated_content)
    root_is_object = isinstance(parsed_generated_content, dict)
    questions_field_present = root_is_object and "questions" in parsed_generated_content
    questions_is_array = questions_field_present and isinstance(parsed_generated_content.get("questions"), list)
    metrics = {
        "response_not_empty": bool(raw_response and str(raw_response).strip()),
        "valid_json": valid_json,
        "root_is_object": root_is_object,
        "questions_field_present": questions_field_present,
        "questions_is_array": questions_is_array,
        "question_count": len(questions),
        "all_questions_have_text": bool(questions) and all(value_present(question.get("question_text")) for question in questions),
        "all_questions_have_options": bool(questions) and all("options" in question and isinstance(question.get("options"), list) for question in questions),
        "all_questions_have_correct_answer": bool(questions) and all(value_present(question.get("correct_answer")) for question in questions),
        "all_questions_have_explanation": bool(questions) and all(value_present(question.get("explanation")) for question in questions),
    }
    boolean_keys = [key for key, value in metrics.items() if isinstance(value, bool)]
    metrics["structure_score"] = rounded(sum(1 for key in boolean_keys if metrics[key]) / len(boolean_keys), 6)
    metrics["violations"] = [key for key in boolean_keys if not metrics[key]]
    return metrics


def answer_index_from_value(correct_answer: Any, options: list[Any]) -> int | None:
    if isinstance(correct_answer, int):
        return correct_answer if 0 <= correct_answer < len(options) else None
    if isinstance(correct_answer, str):
        stripped = correct_answer.strip()
        if stripped.isdigit():
            index = int(stripped)
            if 0 <= index < len(options):
                return index
        normalized_answer = normalize_text(stripped)
        for index, option in enumerate(options):
            if normalized_answer and normalized_answer == normalize_text(option):
                return index
    return None


def duplicate_pairs(options: list[Any]) -> list[list[int]]:
    normalized = [normalize_text(option) for option in options]
    pairs: list[list[int]] = []
    for left in range(len(normalized)):
        for right in range(left + 1, len(normalized)):
            if normalized[left] and normalized[left] == normalized[right]:
                pairs.append([left, right])
    return pairs


def near_duplicate_pairs(options: list[Any]) -> list[list[int]]:
    pairs: list[list[int]] = []
    for left in range(len(options)):
        for right in range(left + 1, len(options)):
            if normalize_text(options[left]) == normalize_text(options[right]):
                continue
            if jaccard_similarity(options[left], options[right]) >= NEAR_DUPLICATE_JACCARD_THRESHOLD:
                pairs.append([left, right])
    return pairs


def build_question_metrics(questions: list[dict]) -> list[dict]:
    metrics = []
    for index, question in enumerate(questions, start=1):
        options = question.get("options") if isinstance(question.get("options"), list) else []
        correct_answer = question.get("correct_answer")
        correct_answer_index = answer_index_from_value(correct_answer, options)
        exact_pairs = duplicate_pairs(options)
        near_pairs = near_duplicate_pairs(options)
        warnings = []
        if correct_answer_index is None and options:
            warnings.append("correct_answer_not_found_in_options")
        if exact_pairs:
            warnings.append("exact_duplicate_options")
        if near_pairs:
            warnings.append("near_duplicate_options")
        if not value_present(question.get("question_text")):
            warnings.append("missing_question_text")
        if "options" not in question:
            warnings.append("missing_options_field")
        if not value_present(correct_answer):
            warnings.append("missing_correct_answer")
        if not value_present(question.get("explanation")):
            warnings.append("missing_explanation")

        metrics.append(
            {
                "question_number": index,
                "question_text": question.get("question_text"),
                "question_word_count": word_count(question.get("question_text")),
                "option_count": len(options),
                "option_word_counts": [word_count(option) for option in options],
                "explanation_word_count": word_count(question.get("explanation")),
                "correct_answer": correct_answer,
                "correct_answer_index": correct_answer_index,
                "correct_answer_present_in_options": correct_answer_index is not None,
                "exact_duplicate_options": bool(exact_pairs),
                "near_duplicate_options": bool(near_pairs),
                "duplicate_option_pairs": exact_pairs,
                "near_duplicate_option_pairs": near_pairs,
                "near_duplicate_jaccard_threshold": NEAR_DUPLICATE_JACCARD_THRESHOLD,
                "answer_explanation_consistent": None,
                "answer_supported_by_lecture": None,
                "question_supported_by_lecture": None,
                "multiple_plausible_answers": None,
                "human_review": dict(HUMAN_REVIEW_TEMPLATE),
                "quality_warnings": warnings,
            }
        )
    return metrics


def mean(values: list[int | float | None]) -> float | None:
    clean = [value for value in values if isinstance(value, (int, float))]
    return rounded(sum(clean) / len(clean), 6) if clean else None


def build_aggregate_quality_metrics(question_metrics: list[dict]) -> dict:
    total_questions = len(question_metrics)
    valid_answer_count = sum(1 for question in question_metrics if question.get("correct_answer_present_in_options"))
    unique_options_count = sum(1 for question in question_metrics if not question.get("exact_duplicate_options"))
    near_duplicate_count = sum(1 for question in question_metrics if question.get("near_duplicate_options"))
    option_word_counts = [
        count
        for question in question_metrics
        for count in question.get("option_word_counts", [])
        if isinstance(count, int)
    ]
    return {
        "total_questions": total_questions,
        "questions_with_valid_answer": valid_answer_count,
        "valid_answer_rate": rounded(safe_divide(valid_answer_count, total_questions)),
        "questions_with_unique_options": unique_options_count,
        "unique_options_rate": rounded(safe_divide(unique_options_count, total_questions)),
        "questions_with_near_duplicate_options": near_duplicate_count,
        "near_duplicate_option_rate": rounded(safe_divide(near_duplicate_count, total_questions)),
        "mean_question_word_count": mean([question.get("question_word_count") for question in question_metrics]),
        "mean_option_word_count": mean(option_word_counts),
        "mean_explanation_word_count": mean([question.get("explanation_word_count") for question in question_metrics]),
        "automatic_quality_score": None,
    }


def field_names_exact(question: dict) -> bool:
    return set(question.keys()) == REQUIRED_QUESTION_FIELDS


def generated_questions(parsed_generated_content: Any) -> list[dict]:
    return questions_from_generated_content(parsed_generated_content)


def previous_question_repeated(question: dict, previous_questions: list[str]) -> bool:
    question_text = normalize_text(question.get("question_text"))
    return bool(question_text) and question_text in {normalize_text(item) for item in previous_questions}


def build_instruction_evaluation(
    *,
    parsed_generated_content: Any | None,
    valid_json: bool,
    input_section: dict,
) -> dict:
    questions = generated_questions(parsed_generated_content)
    expected_count = input_section.get("requested_question_count") or 1
    expected_type = input_section.get("question_type")
    expected_bloom = input_section.get("bloom_level")
    expected_difficulty = input_section.get("difficulty")
    previous_questions = input_section.get("previous_questions") or []
    violations: list[str] = []
    checks: dict[str, bool] = {}

    checks["valid_json"] = valid_json
    checks["exact_question_count"] = len(questions) == expected_count
    if not checks["exact_question_count"]:
        violations.append("wrong_question_count")

    if questions:
        checks["required_field_names"] = all(field_names_exact(question) for question in questions)
        if not checks["required_field_names"]:
            violations.append("required_field_names_not_exact")
    else:
        checks["required_field_names"] = False
        violations.append("no_questions")

    if expected_type:
        checks["question_type_matches_request"] = bool(questions) and all(question.get("type") == expected_type for question in questions)
        if not checks["question_type_matches_request"]:
            violations.append("question_type_mismatch")

    if expected_bloom:
        checks["bloom_level_matches_request"] = bool(questions) and all(question.get("bloom_level") == expected_bloom for question in questions)
        if not checks["bloom_level_matches_request"]:
            violations.append("bloom_level_mismatch")

    if expected_difficulty:
        checks["difficulty_matches_request"] = bool(questions) and all(question.get("difficulty") == expected_difficulty for question in questions)
        if not checks["difficulty_matches_request"]:
            violations.append("difficulty_mismatch")

    checks["question_text_within_25_words"] = bool(questions) and all(word_count(question.get("question_text")) <= 25 for question in questions)
    if not checks["question_text_within_25_words"]:
        violations.append("question_text_too_long")

    checks["does_not_repeat_previous_question"] = bool(questions) and all(not previous_question_repeated(question, previous_questions) for question in questions)
    if not checks["does_not_repeat_previous_question"]:
        violations.append("repeats_previous_question")

    for index, question in enumerate(questions, start=1):
        question_type = question.get("type") or expected_type
        options = question.get("options") if isinstance(question.get("options"), list) else []
        if question_type == "mcq":
            key = f"q{index}_mcq_has_four_options"
            checks[key] = len([option for option in options if str(option).strip()]) == 4
            if not checks[key]:
                violations.append(f"q{index}_mcq_option_count")
            key = f"q{index}_correct_answer_matches_option"
            checks[key] = answer_index_from_value(question.get("correct_answer"), options) is not None
            if not checks[key]:
                violations.append(f"q{index}_correct_answer_not_in_options")
            key = f"q{index}_mcq_options_within_15_words"
            checks[key] = all(word_count(option) <= 15 for option in options)
            if not checks[key]:
                violations.append(f"q{index}_mcq_option_too_long")
        elif question_type == "short_answer":
            key = f"q{index}_short_answer_options_empty"
            checks[key] = options == []
            if not checks[key]:
                violations.append(f"q{index}_short_answer_options_not_empty")
            key = f"q{index}_short_answer_correct_answer_14_words"
            checks[key] = word_count(question.get("correct_answer")) <= 14
            if not checks[key]:
                violations.append(f"q{index}_short_answer_correct_answer_too_long")

    applicable = list(checks.values())
    passed = sum(1 for value in applicable if value)
    score = rounded(safe_divide(passed, len(applicable)) or 0.0)
    schema_valid = checks.get("valid_json", False) and checks.get("required_field_names", False)
    request_compliant = bool(applicable) and all(applicable)
    return {
        "valid_json": valid_json,
        "schema_valid": schema_valid,
        "request_compliant": request_compliant,
        "instruction_compliance_score": score,
        "expected_question_count": expected_count,
        "actual_question_count": len(questions),
        "expected_question_type": expected_type,
        "violations": sorted(set(violations)),
        "compliance_checks": checks,
        "question_metrics": build_question_metrics(questions),
        "aggregate_quality_metrics": build_aggregate_quality_metrics(build_question_metrics(questions)),
        "human_review": dict(HUMAN_REVIEW_TEMPLATE),
    }


def build_performance_metrics(
    *,
    parsed_ollama_response: dict | None,
    processing_time_ms: int | float | None,
    question_count: int,
) -> dict:
    prompt_tokens = parsed_ollama_response.get("prompt_eval_count") if isinstance(parsed_ollama_response, dict) else None
    completion_tokens = parsed_ollama_response.get("eval_count") if isinstance(parsed_ollama_response, dict) else None
    total_tokens = (
        prompt_tokens + completion_tokens
        if isinstance(prompt_tokens, int) and isinstance(completion_tokens, int)
        else None
    )
    total_duration_ms = ns_to_ms(parsed_ollama_response.get("total_duration")) if isinstance(parsed_ollama_response, dict) else None
    load_duration_ms = ns_to_ms(parsed_ollama_response.get("load_duration")) if isinstance(parsed_ollama_response, dict) else None
    prompt_eval_duration_ms = ns_to_ms(parsed_ollama_response.get("prompt_eval_duration")) if isinstance(parsed_ollama_response, dict) else None
    generation_duration_ms = ns_to_ms(parsed_ollama_response.get("eval_duration")) if isinstance(parsed_ollama_response, dict) else None
    resolved_processing_ms = processing_time_ms if isinstance(processing_time_ms, (int, float)) else total_duration_ms
    processing_time_seconds = ms_to_seconds(resolved_processing_ms)
    generation_duration_seconds = ms_to_seconds(generation_duration_ms)
    return {
        "processing_time_ms": resolved_processing_ms,
        "processing_time_seconds": processing_time_seconds,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "tokens_per_second": rounded(safe_divide(completion_tokens, generation_duration_seconds)),
        "milliseconds_per_token": rounded(safe_divide(generation_duration_ms, completion_tokens)),
        "question_count": question_count,
        "seconds_per_question": rounded(safe_divide(processing_time_seconds, question_count)),
        "load_duration_ms": load_duration_ms,
        "prompt_evaluation_duration_ms": prompt_eval_duration_ms,
        "generation_duration_ms": generation_duration_ms,
    }


def build_debug_export_payload(
    *,
    timestamp: datetime,
    lecture_id: str | None,
    class_id: str | None,
    instructor_id: str | None,
    model: str,
    provider: str,
    system_prompt: str,
    user_prompt: str,
    request_payload: dict,
    raw_response: str | None,
    parsed_ollama_response: dict | list | str | None,
    generation_success: bool,
    processing_time_ms: int | float | None,
    http_status: int | None,
    request_metadata: dict | None = None,
    input_metadata: dict | None = None,
    lecture_text: str | None = None,
    error: dict | None = None,
) -> dict:
    parsed_generated_content, valid_json = parse_generated_content(raw_response)
    parsed_ollama_dict = parsed_ollama_response if isinstance(parsed_ollama_response, dict) else None
    clean_metadata = clean_request_metadata(request_metadata)
    input_section = build_input_section(
        input_metadata=input_metadata,
        request_metadata=clean_metadata,
        user_prompt=user_prompt,
        lecture_text=lecture_text,
    )
    performance = build_performance_metrics(
        parsed_ollama_response=parsed_ollama_dict,
        processing_time_ms=processing_time_ms,
        question_count=len(questions_from_generated_content(parsed_generated_content)),
    )
    evaluation = build_instruction_evaluation(
        parsed_generated_content=parsed_generated_content,
        valid_json=valid_json,
        input_section=input_section,
    )
    request_payload_model = request_payload.get("model") if isinstance(request_payload, dict) else None
    response_model = parsed_ollama_dict.get("model") if parsed_ollama_dict else None
    model_match = model_names_match(model, response_model) if response_model else None
    deployment_type = clean_metadata.get("deployment_type") or request_payload.get("deployment_type")
    endpoint_label = clean_metadata.get("endpoint_label") or request_payload.get("endpoint_label")
    return {
        "metadata": {
            "export_version": EXPORT_VERSION,
            "timestamp": timestamp.isoformat(),
            **clean_metadata,
            "lecture_id": lecture_id,
            "class_id": class_id,
            "instructor_id": instructor_id,
            "model": model,
            "requested_model": model,
            "request_payload_model": request_payload_model,
            "response_model": response_model,
            "model_name_match": model_match,
            "provider": provider,
            "deployment_type": deployment_type,
            "endpoint_label": endpoint_label,
            "processing_time_ms": processing_time_ms,
            "prompt_tokens": performance.get("prompt_tokens"),
            "completion_tokens": performance.get("completion_tokens"),
            "total_tokens": performance.get("total_tokens"),
            "ollama_created_at": parsed_ollama_dict.get("created_at") if parsed_ollama_dict else None,
        },
        "input": input_section,
        "prompt": {
            "system": system_prompt,
            "user": user_prompt if include_full_prompt() else None,
        },
        "request_settings": build_request_settings(request_payload),
        "response": {
            "raw": raw_response,
            "parsed": parsed_generated_content,
            "http_status": http_status,
            "generation_success": generation_success,
            "model": response_model,
            "done": parsed_ollama_dict.get("done") if parsed_ollama_dict else None,
            "done_reason": parsed_ollama_dict.get("done_reason") if parsed_ollama_dict else None,
            "error": error,
        },
        "performance": performance,
        "evaluation": evaluation,
    }


def write_llm_debug_export(
    *,
    timestamp: datetime,
    lecture_id: str | None,
    class_id: str | None,
    instructor_id: str | None,
    model: str,
    provider: str = PROVIDER,
    system_prompt: str,
    user_prompt: str,
    request_payload: dict,
    raw_response: str | None,
    parsed_ollama_response: dict | list | str | None,
    generation_success: bool,
    processing_time_ms: int | float | None,
    http_status: int | None,
    request_metadata: dict | None = None,
    input_metadata: dict | None = None,
    lecture_text: str | None = None,
    error: dict | None = None,
) -> None:
    if not get_settings().enable_debug_export:
        return

    try:
        export_root = get_debug_export_root()
        export_root.mkdir(parents=True, exist_ok=True)

        export = build_debug_export_payload(
            timestamp=timestamp,
            lecture_id=lecture_id,
            class_id=class_id,
            instructor_id=instructor_id,
            model=model,
            provider=provider,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            request_payload=request_payload,
            raw_response=raw_response,
            parsed_ollama_response=parsed_ollama_response,
            generation_success=generation_success,
            processing_time_ms=processing_time_ms,
            http_status=http_status,
            request_metadata=request_metadata,
            input_metadata=input_metadata,
            lecture_text=lecture_text,
            error=error,
        )
        append_debug_attempt(export_root, export)
    except Exception:
        logger.exception("Failed to write LLM debug export.")


def aggregate_export_path(export_root: Path, lecture_id: str | None, batch_id: str | None, model: str | None) -> Path:
    safe_lecture = safe_debug_filename_part(lecture_id)
    safe_model = safe_debug_filename_part(model)
    safe_batch = safe_debug_filename_part(str(batch_id or "unknown")[:8])
    return export_root / safe_model / f"evaluation_{safe_lecture}_{safe_batch}.json"


def lecture_index_path(export_root: Path, lecture_id: str | None) -> Path:
    return export_root / f"evaluation_{safe_debug_filename_part(lecture_id)}_index.json"


def attempt_from_v3_export(export: dict) -> dict:
    metadata = export.get("metadata") or {}
    return {
        "request_id": metadata.get("request_id"),
        "attempt_number": metadata.get("attempt_number"),
        "request_kind": metadata.get("request_kind"),
        "is_retry": metadata.get("is_retry"),
        "is_regeneration": metadata.get("is_regeneration"),
        "parent_request_id": metadata.get("parent_request_id"),
        "requested_model": metadata.get("requested_model") or metadata.get("model"),
        "request_payload_model": metadata.get("request_payload_model"),
        "response_model": metadata.get("response_model"),
        "model_name_match": metadata.get("model_name_match"),
        "timestamp": metadata.get("timestamp"),
        "input": export.get("input") or {},
        "prompt": export.get("prompt") or {},
        "request_settings": export.get("request_settings") or {},
        "response": export.get("response") or {},
        "performance": export.get("performance") or {},
        "evaluation": export.get("evaluation") or {},
    }


def new_aggregate_export(export: dict) -> dict:
    metadata = export.get("metadata") or {}
    input_section = export.get("input") or {}
    timestamp = metadata.get("timestamp")
    return {
        "export_version": AGGREGATE_EXPORT_VERSION,
        "lecture": {
            "lecture_id": metadata.get("lecture_id"),
            "lecture_hash": input_section.get("lecture_hash"),
            "class_id": metadata.get("class_id"),
            "instructor_id": metadata.get("instructor_id"),
            "model": metadata.get("model"),
            "requested_model": metadata.get("requested_model") or metadata.get("model"),
            "response_model": metadata.get("response_model"),
            "model_name_match": metadata.get("model_name_match"),
            "provider": metadata.get("provider"),
        },
        "batch": {
            "batch_id": metadata.get("batch_id"),
            "created_at": timestamp,
            "updated_at": timestamp,
        },
        "questions": [],
    }


def all_aggregate_request_ids(aggregate: dict) -> set[str]:
    return {
        attempt.get("request_id")
        for question in aggregate.get("questions") or []
        for attempt in question.get("attempts") or []
        if attempt.get("request_id")
    }


def sort_aggregate(aggregate: dict) -> None:
    for question in aggregate.get("questions") or []:
        question["attempts"] = sorted(
            question.get("attempts") or [],
            key=lambda attempt: (parse_timestamp(attempt.get("timestamp")), sortable_number(attempt.get("attempt_number"))),
        )
    aggregate["questions"] = sorted(
        aggregate.get("questions") or [],
        key=lambda question: sortable_number(question.get("question_number")),
    )


def find_or_create_question(aggregate: dict, export: dict) -> dict:
    metadata = export.get("metadata") or {}
    input_section = export.get("input") or {}
    question_number = metadata.get("question_number") or input_section.get("question_number")
    for question in aggregate.get("questions") or []:
        if question.get("question_number") == question_number:
            return question

    question = {
        "question_number": question_number,
        "question_type": metadata.get("question_type") or input_section.get("question_type"),
        "requested_bloom_level": input_section.get("bloom_level"),
        "requested_difficulty": input_section.get("difficulty"),
        "attempts": [],
    }
    aggregate.setdefault("questions", []).append(question)
    return question


def latest_attempt(question: dict) -> dict | None:
    attempts = sorted(
        question.get("attempts") or [],
        key=lambda attempt: (sortable_number(attempt.get("attempt_number")), parse_timestamp(attempt.get("timestamp"))),
    )
    return attempts[-1] if attempts else None


def normalize_attempt_number_and_parent(question: dict, attempt: dict) -> None:
    previous = latest_attempt(question)
    previous_number = previous.get("attempt_number") if previous else 0
    provided_number = attempt.get("attempt_number") if isinstance(attempt.get("attempt_number"), int) else 1
    if previous:
        attempt["attempt_number"] = max(provided_number, previous_number + 1)
        if attempt.get("is_regeneration"):
            attempt["parent_request_id"] = previous.get("request_id")
    else:
        attempt["attempt_number"] = max(provided_number, 1)


def atomic_write_json(path: Path, payload: dict) -> None:
    tmp_path = path.with_name(f"{path.name}.{safe_debug_filename_part(payload.get('batch', {}).get('updated_at'))}.tmp")
    tmp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    tmp_path.replace(path)


def update_lecture_index(export_root: Path, aggregate_path: Path, aggregate: dict) -> None:
    lecture = aggregate.get("lecture") or {}
    batch = aggregate.get("batch") or {}
    index_path = lecture_index_path(aggregate_path.parent, lecture.get("lecture_id"))
    if index_path.exists():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            index = {"lecture_id": lecture.get("lecture_id"), "batches": []}
    else:
        index = {"lecture_id": lecture.get("lecture_id"), "batches": []}

    batches = [
        item
        for item in index.get("batches") or []
        if not (item.get("batch_id") == batch.get("batch_id") and item.get("model") == lecture.get("model"))
    ]
    request_count = sum(len(question.get("attempts") or []) for question in aggregate.get("questions") or [])
    batches.append(
        {
            "batch_id": batch.get("batch_id"),
            "file": aggregate_path.name,
            "model": lecture.get("model"),
            "created_at": batch.get("created_at"),
            "question_count": len(aggregate.get("questions") or []),
            "request_count": request_count,
        }
    )
    index["batches"] = sorted(batches, key=lambda item: str(item.get("created_at") or ""))
    atomic_write_json(index_path, index)


def append_debug_attempt(export_root: Path, export: dict) -> Path:
    metadata = export.get("metadata") or {}
    batch_id = metadata.get("batch_id") or metadata.get("request_id") or "unknown"
    lecture_id = metadata.get("lecture_id")
    model = metadata.get("model")
    metadata["batch_id"] = batch_id
    export["metadata"] = metadata
    path = aggregate_export_path(export_root, lecture_id, batch_id, model)

    aggregate = None
    if path.exists():
        candidate = json.loads(path.read_text(encoding="utf-8"))
        existing_batch_id = (candidate.get("batch") or {}).get("batch_id")
        if existing_batch_id and str(existing_batch_id) != str(batch_id):
            path = export_root / safe_debug_filename_part(model) / (
                f"evaluation_{safe_debug_filename_part(lecture_id)}_"
                f"{safe_debug_filename_part(batch_id)}.json"
            )
            if path.exists():
                aggregate = json.loads(path.read_text(encoding="utf-8"))
        else:
            aggregate = candidate

    if aggregate is None:
        aggregate = new_aggregate_export(export)

    aggregate["batch"]["updated_at"] = metadata.get("timestamp")
    if metadata.get("request_id") in all_aggregate_request_ids(aggregate):
        return path

    question = find_or_create_question(aggregate, export)
    attempt = attempt_from_v3_export(export)
    normalize_attempt_number_and_parent(question, attempt)
    question.setdefault("attempts", []).append(attempt)
    sort_aggregate(aggregate)
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(path, aggregate)
    update_lecture_index(export_root, path, aggregate)
    return path


def value_from_export(export: dict, dotted_path: str) -> Any:
    value: Any = export
    for part in dotted_path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def export_version(export: dict) -> str:
    return str(value_from_export(export, "metadata.export_version") or export.get("export_version") or "v2")


def export_valid_json(export: dict) -> bool | None:
    if export_version(export) == "v3":
        return value_from_export(export, "evaluation.valid_json")
    return value_from_export(export, "structure_metrics.valid_json")


def export_schema_valid(export: dict) -> bool | None:
    if export_version(export) == "v3":
        return value_from_export(export, "evaluation.schema_valid")
    score = value_from_export(export, "structure_metrics.structure_score")
    return score == 1.0 if isinstance(score, (int, float)) else None


def export_request_compliant(export: dict) -> bool | None:
    if export_version(export) == "v3":
        return value_from_export(export, "evaluation.request_compliant")
    return None


def export_instruction_score(export: dict) -> float | None:
    if export_version(export) == "v3":
        return value_from_export(export, "evaluation.instruction_compliance_score")
    return value_from_export(export, "structure_metrics.structure_score")


def export_performance(export: dict, key: str) -> Any:
    if export_version(export) == "v3":
        value = value_from_export(export, f"performance.{key}")
        if key == "processing_time_seconds" and value is None:
            return ms_to_seconds(value_from_export(export, "performance.processing_time_ms"))
        return value
    return value_from_export(export, f"performance_metrics.{key}")


def export_evaluation_value(export: dict, key: str) -> Any:
    if export_version(export) == "v3":
        return value_from_export(export, f"evaluation.{key}")
    if key == "question_metrics":
        return export.get("question_metrics", [])
    if key == "aggregate_quality_metrics":
        return export.get("aggregate_quality_metrics", {})
    return None


def export_compliance_check(export: dict, key: str) -> bool | None:
    if export_version(export) != "v3":
        return None
    return value_from_export(export, f"evaluation.compliance_checks.{key}")


def export_done_reason(export: dict) -> str | None:
    return value_from_export(export, "response.done_reason")


def average(values: list[Any]) -> float | None:
    clean = [float(value) for value in values if isinstance(value, (int, float))]
    return rounded(sum(clean) / len(clean)) if clean else None


def sample_standard_deviation(values: list[Any]) -> float | None:
    clean = [float(value) for value in values if isinstance(value, (int, float))]
    if len(clean) < 2:
        return None
    return rounded(statistics.stdev(clean))


def rate_from_bools(values: list[Any]) -> float | None:
    clean = [bool(value) for value in values if isinstance(value, bool)]
    return rounded(sum(1 for value in clean if value) / len(clean)) if clean else None


def human_review_summary(question_metrics: list[dict]) -> dict:
    reviewed = [question for question in question_metrics if (question.get("human_review") or {}).get("reviewed") is True]
    return {
        "reviewed_question_count": len(reviewed),
        "human_answer_accuracy": rate_from_bools([(question.get("human_review") or {}).get("answer_correct") for question in reviewed]),
        "human_relevance_rate": rate_from_bools([(question.get("human_review") or {}).get("question_relevant") for question in reviewed]),
        "single_correct_answer_rate": rate_from_bools([(question.get("human_review") or {}).get("only_one_correct_answer") for question in reviewed]),
    }


def export_question_success(export: dict) -> bool:
    return (
        value_from_export(export, "response.generation_success") is True
        and export_valid_json(export) is True
        and (export_evaluation_value(export, "aggregate_quality_metrics") or {}).get("total_questions", 0) > 0
    )


def question_group_key(export: dict) -> tuple[str, Any]:
    metadata = export.get("metadata") if isinstance(export.get("metadata"), dict) else {}
    batch_id = metadata.get("batch_id")
    question_number = metadata.get("question_number")
    if batch_id is not None and question_number is not None:
        return str(batch_id), question_number
    request_id = metadata.get("request_id") or f"legacy_{id(export)}"
    return str(request_id), question_number


def request_classification_summary(exports: list[dict]) -> dict:
    total_requests = len(exports)
    kind_counts = {
        "initial": 0,
        "automatic_retry": 0,
        "quality_retry": 0,
        "manual_regeneration": 0,
    }
    for export in exports:
        kind = value_from_export(export, "metadata.request_kind") or "initial"
        if kind in kind_counts:
            kind_counts[kind] += 1
    retry_count = kind_counts["automatic_retry"] + kind_counts["quality_retry"]
    finish_reasons: dict[str, int] = defaultdict(int)
    for export in exports:
        reason = export_done_reason(export) or "unknown"
        finish_reasons[str(reason)] += 1
    return {
        "total_requests": total_requests,
        "total_llm_requests": total_requests,
        "initial_requests": kind_counts["initial"],
        "automatic_retries": kind_counts["automatic_retry"],
        "quality_retries": kind_counts["quality_retry"],
        "manual_regenerations": kind_counts["manual_regeneration"],
        "retry_rate": rounded(safe_divide(retry_count, total_requests)),
        "regeneration_rate": rounded(safe_divide(kind_counts["manual_regeneration"], total_requests)),
        "valid_json_rate": rate_from_bools([export_valid_json(export) for export in exports]),
        "schema_valid_rate": rate_from_bools([export_schema_valid(export) for export in exports]),
        "schema_compliance_rate": rate_from_bools([export_schema_valid(export) for export in exports]),
        "request_compliance_rate": rate_from_bools([export_request_compliant(export) for export in exports]),
        "mean_instruction_compliance_score": average([export_instruction_score(export) for export in exports]),
        "exact_question_count_compliance_rate": rate_from_bools([export_compliance_check(export, "exact_question_count") for export in exports]),
        "requested_type_compliance_rate": rate_from_bools([export_compliance_check(export, "question_type_matches_request") for export in exports]),
        "correct_field_name_rate": rate_from_bools([export_compliance_check(export, "required_field_names") for export in exports]),
        "finish_reason_distribution": dict(sorted(finish_reasons.items())),
        "truncated_response_rate": rate_from_bools([export_done_reason(export) == "length" for export in exports]),
        "mean_latency_per_request": average([export_performance(export, "processing_time_seconds") for export in exports]),
        "mean_tokens_per_request": average([export_performance(export, "total_tokens") for export in exports]),
    }


def question_level_summary(exports: list[dict]) -> dict:
    grouped: dict[tuple[str, Any], list[dict]] = defaultdict(list)
    for export in exports:
        grouped[question_group_key(export)].append(export)

    attempts_per_question: list[int] = []
    total_latency_completed: list[float] = []
    first_attempt_successes = 0
    first_attempt_compliant = 0
    final_successes = 0
    final_compliant = 0
    retry_questions = 0
    regeneration_questions = 0
    retries_improved = 0
    retries_reduced = 0
    manual_regens_improved = 0

    for rows in grouped.values():
        rows = sorted(rows, key=lambda row: value_from_export(row, "metadata.attempt_number") or 1)
        attempts_per_question.append(len(rows))
        first_attempts = [row for row in rows if (value_from_export(row, "metadata.attempt_number") or 1) == 1]
        if any(export_question_success(row) for row in first_attempts):
            first_attempt_successes += 1
        if any(export_request_compliant(row) is True for row in first_attempts):
            first_attempt_compliant += 1
        completed = any(export_question_success(row) for row in rows)
        if completed:
            final_successes += 1
            latency_sum = sum(
                float(latency)
                for row in rows
                if isinstance((latency := export_performance(row, "processing_time_seconds")), (int, float))
            )
            total_latency_completed.append(latency_sum)
        if export_request_compliant(rows[-1]) is True:
            final_compliant += 1
        if any(value_from_export(row, "metadata.is_retry") is True for row in rows):
            retry_questions += 1
        if any(value_from_export(row, "metadata.is_regeneration") is True for row in rows):
            regeneration_questions += 1
        for index, row in enumerate(rows):
            kind = value_from_export(row, "metadata.request_kind")
            if kind not in {"automatic_retry", "quality_retry", "manual_regeneration"}:
                continue
            previous = rows[index - 1] if index > 0 else None
            current_score = export_instruction_score(row)
            previous_score = export_instruction_score(previous) if previous else None
            if not isinstance(current_score, (int, float)) or not isinstance(previous_score, (int, float)):
                continue
            if kind == "manual_regeneration":
                if current_score > previous_score:
                    manual_regens_improved += 1
            elif current_score > previous_score:
                retries_improved += 1
            elif current_score < previous_score:
                retries_reduced += 1

    total_questions = len(grouped)
    return {
        "total_requested_questions": total_questions,
        "first_attempt_success_rate": rounded(safe_divide(first_attempt_successes, total_questions)),
        "first_attempt_compliant_rate": rounded(safe_divide(first_attempt_compliant, total_questions)),
        "final_success_rate_after_retries": rounded(safe_divide(final_successes, total_questions)),
        "final_compliant_rate_after_retries": rounded(safe_divide(final_compliant, total_questions)),
        "retries_that_improved_compliance": retries_improved,
        "retries_that_reduced_compliance": retries_reduced,
        "manual_regenerations_that_improved_compliance": manual_regens_improved,
        "mean_attempts_per_question": average(attempts_per_question),
        "median_attempts_per_question": rounded(statistics.median(attempts_per_question)) if attempts_per_question else None,
        "maximum_attempts_required": max(attempts_per_question) if attempts_per_question else None,
        "mean_total_latency_per_completed_question": average(total_latency_completed),
        "questions_requiring_retries": retry_questions,
        "questions_requiring_manual_regeneration": regeneration_questions,
    }


def model_summary(model: str, exports: list[dict]) -> dict:
    successful = [export for export in exports if value_from_export(export, "response.generation_success") is True]
    quality_exports = [export for export in exports if ((export_evaluation_value(export, "aggregate_quality_metrics") or {}).get("total_questions") or 0) > 0]
    all_question_metrics = [
        question
        for export in exports
        for question in (export_evaluation_value(export, "question_metrics") or [])
        if isinstance(question, dict)
    ]
    processing_times = [export_performance(export, "processing_time_seconds") for export in exports]
    clean_processing_times = [float(value) for value in processing_times if isinstance(value, (int, float))]
    human = human_review_summary(all_question_metrics)
    total_generations = len(exports)
    successful_generations = len(successful)
    total_questions = sum(
        (export_evaluation_value(export, "aggregate_quality_metrics") or {}).get("total_questions") or 0
        for export in quality_exports
    )
    valid_answers = sum(
        (export_evaluation_value(export, "aggregate_quality_metrics") or {}).get("questions_with_valid_answer") or 0
        for export in quality_exports
    )
    unique_options = sum(
        (export_evaluation_value(export, "aggregate_quality_metrics") or {}).get("questions_with_unique_options") or 0
        for export in quality_exports
    )
    near_duplicates = sum(
        (export_evaluation_value(export, "aggregate_quality_metrics") or {}).get("questions_with_near_duplicate_options") or 0
        for export in quality_exports
    )
    return {
        "model": model,
        **request_classification_summary(exports),
        **question_level_summary(exports),
        "total_generations": total_generations,
        "successful_generations": successful_generations,
        "generation_success_rate": rounded(safe_divide(successful_generations, total_generations)),
        "valid_json_rate": rate_from_bools([export_valid_json(export) for export in exports]),
        "mean_processing_time_seconds": average(processing_times),
        "median_processing_time_seconds": rounded(statistics.median(clean_processing_times)) if clean_processing_times else None,
        "minimum_processing_time_seconds": rounded(min(clean_processing_times)) if clean_processing_times else None,
        "maximum_processing_time_seconds": rounded(max(clean_processing_times)) if clean_processing_times else None,
        "processing_time_standard_deviation": sample_standard_deviation(processing_times),
        "mean_tokens_per_second": average([export_performance(export, "tokens_per_second") for export in exports]),
        "mean_prompt_tokens": average([export_performance(export, "prompt_tokens") for export in exports]),
        "mean_completion_tokens": average([export_performance(export, "completion_tokens") for export in exports]),
        "mean_total_tokens": average([export_performance(export, "total_tokens") for export in exports]),
        "total_questions": total_questions,
        "valid_answer_rate": rounded(safe_divide(valid_answers, total_questions)),
        "unique_options_rate": rounded(safe_divide(unique_options, total_questions)),
        "near_duplicate_option_rate": rounded(safe_divide(near_duplicates, total_questions)),
        **human,
    }


def read_generation_exports(export_root: Path) -> list[dict]:
    exports = []
    for path in sorted(export_root.glob("generation_*.json")):
        try:
            exports.append(json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            logger.exception("Skipping unreadable debug export %s.", path)
    for path in sorted(export_root.rglob("evaluation_*.json")):
        if path.name.endswith("_index.json"):
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("export_version") == AGGREGATE_EXPORT_VERSION:
                exports.extend(flatten_aggregate_export(payload))
        except Exception:
            logger.exception("Skipping unreadable debug export %s.", path)
    return exports


def flatten_aggregate_export(aggregate: dict) -> list[dict]:
    lecture = aggregate.get("lecture") or {}
    batch = aggregate.get("batch") or {}
    flattened = []
    for question in aggregate.get("questions") or []:
        for attempt in question.get("attempts") or []:
            input_section = attempt.get("input") or {}
            flattened.append(
                {
                    "metadata": {
                        "export_version": EXPORT_VERSION,
                        "source_export_version": AGGREGATE_EXPORT_VERSION,
                        "timestamp": attempt.get("timestamp"),
                        "request_id": attempt.get("request_id"),
                        "batch_id": batch.get("batch_id"),
                        "lecture_id": lecture.get("lecture_id"),
                        "class_id": lecture.get("class_id"),
                        "instructor_id": lecture.get("instructor_id"),
                        "model": lecture.get("model"),
                        "requested_model": attempt.get("requested_model") or lecture.get("requested_model") or lecture.get("model"),
                        "request_payload_model": attempt.get("request_payload_model"),
                        "response_model": attempt.get("response_model"),
                        "model_name_match": attempt.get("model_name_match"),
                        "provider": lecture.get("provider"),
                        "question_number": question.get("question_number"),
                        "question_type": question.get("question_type"),
                        "attempt_number": attempt.get("attempt_number"),
                        "request_kind": attempt.get("request_kind"),
                        "is_retry": attempt.get("is_retry"),
                        "is_regeneration": attempt.get("is_regeneration"),
                        "parent_request_id": attempt.get("parent_request_id"),
                    },
                    "input": input_section,
                    "prompt": attempt.get("prompt") or {},
                    "request_settings": attempt.get("request_settings") or {},
                    "response": attempt.get("response") or {},
                    "performance": attempt.get("performance") or {},
                    "evaluation": attempt.get("evaluation") or {},
                }
            )
    return flattened


def build_model_comparison_summary(export_root: Path | None = None) -> list[dict]:
    root = export_root or get_debug_export_root()
    grouped: dict[str, list[dict]] = defaultdict(list)
    for export in read_generation_exports(root):
        model = value_from_export(export, "metadata.model") or export.get("model") or "unknown"
        grouped[str(model)].append(export)
    return [model_summary(model, rows) for model, rows in sorted(grouped.items())]


def write_model_comparison_summary(export_root: Path | None = None) -> tuple[Path, Path]:
    root = export_root or get_debug_export_root()
    root.mkdir(parents=True, exist_ok=True)
    summary = build_model_comparison_summary(root)
    json_path = root / "model_comparison_summary.json"
    csv_path = root / "model_comparison_summary.csv"
    json_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=SUMMARY_COLUMNS)
        writer.writeheader()
        for row in summary:
            writer.writerow({
                column: json.dumps(row.get(column), sort_keys=True) if isinstance(row.get(column), (dict, list)) else row.get(column)
                for column in SUMMARY_COLUMNS
            })
    return json_path, csv_path
