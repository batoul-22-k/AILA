"""Calculate automatic structural metrics for comparison result files."""

from __future__ import annotations

import argparse
import json
import logging
import re
from pathlib import Path
from typing import Any

import pandas as pd

from app.llm_evaluation.prompts import ALLOWED_BLOOM_LABELS, ALLOWED_DIFFICULTY_LABELS


logger = logging.getLogger(__name__)
REQUIRED_QUESTION_FIELDS = {"q", "o", "a", "e", "b", "d", "s"}
QUESTION_WORD_LIMIT = 14
OPTION_WORD_LIMIT = 8
EXPLANATION_WORD_LIMIT = 10
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9'-]*")
STOP_TERMS = {
    "about",
    "answer",
    "apply",
    "best",
    "choice",
    "choices",
    "correct",
    "describe",
    "does",
    "effect",
    "example",
    "explain",
    "following",
    "from",
    "idea",
    "impact",
    "lecture",
    "likely",
    "main",
    "option",
    "options",
    "result",
    "slide",
    "statement",
    "this",
    "which",
    "why",
    "would",
}


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def load_result_file(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    if not isinstance(payload, dict) or not isinstance(payload.get("records"), list):
        raise ValueError("Result file must contain an object with a records array.")
    return payload


def questions_from_parsed(parsed_output: Any) -> list[dict[str, Any]]:
    if not isinstance(parsed_output, dict):
        return []
    questions = parsed_output.get("questions")
    if not isinstance(questions, list):
        return []
    return [question for question in questions if isinstance(question, dict)]


def word_count(value: Any) -> int:
    return len(TOKEN_RE.findall(str(value or "")))


def _valid_text(value: Any, max_words: int) -> bool:
    return isinstance(value, str) and bool(value.strip()) and word_count(value) <= max_words


def valid_answer_index(question: dict[str, Any]) -> bool:
    answer = question.get("a")
    return isinstance(answer, int) and not isinstance(answer, bool) and 0 <= answer <= 3


def valid_question_text_length(question: dict[str, Any]) -> bool:
    return _valid_text(question.get("q"), QUESTION_WORD_LIMIT)


def valid_option_lengths(question: dict[str, Any]) -> bool:
    options = question.get("o")
    if not isinstance(options, list) or len(options) != 4:
        return False
    return all(_valid_text(option, OPTION_WORD_LIMIT) for option in options)


def valid_explanation_length(question: dict[str, Any]) -> bool:
    return _valid_text(question.get("e"), EXPLANATION_WORD_LIMIT)


def _violation(reason: str, path: str, message: str) -> dict[str, str]:
    return {"reason": reason, "path": path, "message": message}


def _validate_text_field(violations: list[dict[str, str]], question: dict[str, Any], key: str, max_words: int, path: str) -> None:
    value = question.get(key)
    if not isinstance(value, str) or not value.strip():
        violations.append(_violation("invalid_question_fields", path, f"{path} must be a non-empty string"))
    elif word_count(value) > max_words:
        violations.append(_violation("text_length_exceeded", path, f"{path} exceeds {max_words} words"))


def _validate_question(question: Any, index: int) -> list[dict[str, str]]:
    path = f"questions[{index}]"
    violations: list[dict[str, str]] = []
    if not isinstance(question, dict):
        return [_violation("invalid_question_fields", path, f"{path} must be an object")]
    if set(question.keys()) != REQUIRED_QUESTION_FIELDS:
        violations.append(
            _violation(
                "invalid_question_fields",
                path,
                f"{path} must contain exactly q, o, a, e, b, d, s",
            )
        )
    if not isinstance(question.get("s"), (int, str, type(None))):
        violations.append(_violation("invalid_question_fields", f"{path}.s", f"{path}.s must be integer, string, or null"))

    _validate_text_field(violations, question, "q", QUESTION_WORD_LIMIT, f"{path}.q")
    _validate_text_field(violations, question, "e", EXPLANATION_WORD_LIMIT, f"{path}.e")

    options = question.get("o")
    if not isinstance(options, list) or len(options) != 4:
        violations.append(_violation("invalid_question_fields", f"{path}.o", f"{path}.o must contain exactly four options"))
    else:
        for option_index, option in enumerate(options):
            option_path = f"{path}.o[{option_index}]"
            if not isinstance(option, str) or not option.strip():
                violations.append(_violation("invalid_question_fields", option_path, f"{option_path} must be a non-empty string"))
            elif word_count(option) > OPTION_WORD_LIMIT:
                violations.append(_violation("text_length_exceeded", option_path, f"{option_path} exceeds {OPTION_WORD_LIMIT} words"))

    if not valid_answer_index(question):
        violations.append(_violation("invalid_answer_index", f"{path}.a", f"{path}.a must be an integer from 0 to 3"))
    if not valid_bloom(question):
        violations.append(_violation("invalid_question_fields", f"{path}.b", f"{path}.b must be an allowed Bloom label"))
    if not valid_difficulty(question):
        violations.append(_violation("invalid_question_fields", f"{path}.d", f"{path}.d must be an allowed difficulty label"))
    return violations


def schema_diagnostics(parsed_output: Any) -> dict[str, Any]:
    violations: list[dict[str, str]] = []
    if not isinstance(parsed_output, dict):
        violations.append(_violation("root_not_object", "$", "Root JSON value must be an object"))
        return {"compliant": False, "reason": "root_not_object", "violations": violations}

    root_keys = set(parsed_output.keys())
    if "questions" not in parsed_output:
        violations.append(_violation("missing_questions_key", "$", 'Root object must contain a "questions" key'))
        return {"compliant": False, "reason": "missing_questions_key", "violations": violations}
    if root_keys != {"questions"}:
        unexpected = sorted(root_keys - {"questions"})
        violations.append(
            _violation(
                "unexpected_root_fields",
                "$",
                f'Root object must contain only "questions"; unexpected fields: {unexpected}',
            )
        )
        return {"compliant": False, "reason": "unexpected_root_fields", "violations": violations}

    questions = parsed_output["questions"]
    if not isinstance(questions, list):
        violations.append(_violation("questions_not_array", "$.questions", '"questions" must be an array'))
        return {"compliant": False, "reason": "questions_not_array", "violations": violations}
    if len(questions) != 4:
        violations.append(_violation("invalid_question_count", "$.questions", '"questions" must contain exactly 4 objects'))

    for index, question in enumerate(questions):
        violations.extend(_validate_question(question, index))

    return {
        "compliant": not violations,
        "reason": None if not violations else violations[0]["reason"],
        "violations": violations,
    }


def one_question_schema_diagnostics(parsed_output: Any) -> dict[str, Any]:
    violations: list[dict[str, str]] = []
    if not isinstance(parsed_output, dict):
        violations.append(_violation("root_not_object", "$", "Root JSON value must be an object"))
        return {"compliant": False, "reason": "root_not_object", "violations": violations}

    root_keys = set(parsed_output.keys())
    if "question" not in parsed_output:
        violations.append(_violation("missing_question_key", "$", 'Root object must contain a "question" key'))
        return {"compliant": False, "reason": "missing_question_key", "violations": violations}
    if root_keys != {"question"}:
        unexpected = sorted(root_keys - {"question"})
        violations.append(
            _violation(
                "unexpected_root_fields",
                "$",
                f'Root object must contain only "question"; unexpected fields: {unexpected}',
            )
        )
        return {"compliant": False, "reason": "unexpected_root_fields", "violations": violations}

    question_violations = _validate_question(parsed_output["question"], 0)
    for violation in question_violations:
        path = violation["path"].replace("questions[0]", "question", 1)
        violations.append({**violation, "path": path, "message": violation["message"].replace("questions[0]", "question")})

    return {
        "compliant": not violations,
        "reason": None if not violations else violations[0]["reason"],
        "violations": violations,
    }


def schema_compliant(parsed_output: Any) -> bool:
    return bool(schema_diagnostics(parsed_output)["compliant"])


def is_mcq(question: dict[str, Any]) -> bool:
    return isinstance(question.get("o"), list) and valid_answer_index(question)


def has_non_empty(value: Any) -> bool:
    return bool(str(value or "").strip())


def valid_bloom(question: dict[str, Any]) -> bool:
    return str(question.get("b") or "").strip() in ALLOWED_BLOOM_LABELS


def valid_difficulty(question: dict[str, Any]) -> bool:
    return str(question.get("d") or "").strip() in ALLOWED_DIFFICULTY_LABELS


def mcq_has_four_options(question: dict[str, Any]) -> bool:
    options = question.get("o")
    if not isinstance(options, list):
        return False
    return len(options) == 4 and all(str(option or "").strip() for option in options)


def complete_question_set(questions: list[dict[str, Any]]) -> bool:
    mcqs = [question for question in questions if is_mcq(question)]
    if len(questions) != 4 or len(mcqs) != 4:
        return False
    checks = []
    for question in questions:
        checks.append(set(question.keys()) == REQUIRED_QUESTION_FIELDS)
        checks.append(has_non_empty(question.get("q")))
        checks.append(has_non_empty(question.get("e")))
        checks.append(valid_answer_index(question))
        checks.append(valid_question_text_length(question))
        checks.append(valid_option_lengths(question))
        checks.append(valid_explanation_length(question))
        checks.append(valid_bloom(question))
        checks.append(valid_difficulty(question))
        checks.append(mcq_has_four_options(question))
    return all(checks)


def _normalize_term(term: str) -> str:
    term = term.lower().strip("'")
    for suffix in ("ing", "ed", "es"):
        if len(term) > len(suffix) + 3 and term.endswith(suffix):
            return term[: -len(suffix)]
    if len(term) > 4 and term.endswith("s") and not term.endswith(("ss", "sis")):
        return term[:-1]
    return term


def content_terms(text: Any) -> set[str]:
    terms: set[str] = set()
    for raw in TOKEN_RE.findall(str(text or "")):
        term = _normalize_term(raw)
        if len(term) >= 3 and term not in STOP_TERMS:
            terms.add(term)
    return terms


def unsupported_question_terms(question: dict[str, Any], lecture_passage: str) -> list[str]:
    passage_terms = content_terms(lecture_passage)
    terms = content_terms(question.get("q"))
    return sorted(term for term in terms if term not in passage_terms)


def relevance_flags(questions: list[dict[str, Any]], lecture_passage: str) -> list[dict[str, Any]]:
    flags: list[dict[str, Any]] = []
    for index, question in enumerate(questions, start=1):
        unsupported = unsupported_question_terms(question, lecture_passage)
        if unsupported:
            flags.append(
                {
                    "question_number": index,
                    "unsupported_terms": unsupported,
                    "question_text": question.get("q", ""),
                }
            )
    return flags


def _percentage(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return round((numerator / denominator) * 100, 2)


def _average(values: list[float]) -> float:
    clean = [value for value in values if value is not None]
    if not clean:
        return 0.0
    return round(sum(clean) / len(clean), 4)


def analyze_model_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    total_records = len(records)
    valid_records = [record for record in records if record.get("valid_json") is True]
    schema_compliant_records = [
        record
        for record in records
        if record.get("schema_compliant") is True
        or ("schema_compliant" not in record and record.get("valid_json") is True and schema_compliant(record.get("parsed_output")))
    ]
    complete_records = [
        record
        for record in records
        if record.get("complete_question_set") is True
        or ("complete_question_set" not in record and complete_question_set(questions_from_parsed(record.get("parsed_output"))))
    ]
    success_records = [record for record in records if record.get("generation_success") is True]
    question_sets = [questions_from_parsed(record.get("parsed_output")) for record in records]
    valid_question_sets = [questions_from_parsed(record.get("parsed_output")) for record in valid_records]
    all_questions = [question for questions in valid_question_sets for question in questions]
    all_mcqs = [question for question in all_questions if is_mcq(question)]

    return {
        "request_count": total_records,
        "request_success_rate": _percentage(sum(1 for record in records if record.get("request_success") is True), total_records),
        "empty_response_rate": _percentage(sum(1 for record in records if record.get("empty_response") is True), total_records),
        "truncation_rate": _percentage(sum(1 for record in records if record.get("truncated") is True), total_records),
        "valid_json_rate": _percentage(len(valid_records), total_records),
        "schema_compliance_rate": _percentage(len(schema_compliant_records), total_records),
        "complete_question_rate": _percentage(len(complete_records), total_records),
        "generation_success_rate": _percentage(len(success_records), total_records),
        "http_failure_rate": _percentage(sum(1 for record in records if record.get("error_category") == "http_failure"), total_records),
        "invalid_json_rate": _percentage(sum(1 for record in records if record.get("error_category") == "invalid_json"), total_records),
        "schema_non_compliance_rate": _percentage(sum(1 for record in records if record.get("error_category") == "schema_non_compliance"), total_records),
        "incomplete_question_set_rate": _percentage(sum(1 for record in records if record.get("error_category") == "incomplete_question_set"), total_records),
        "complete_question_set_rate": _percentage(sum(1 for questions in question_sets if complete_question_set(questions)), total_records),
        "exactly_four_questions_rate": _percentage(sum(1 for questions in question_sets if len(questions) == 4), total_records),
        "exactly_four_mcqs_rate": _percentage(sum(1 for questions in question_sets if len([q for q in questions if is_mcq(q)]) == 4), total_records),
        "mcqs_with_exactly_four_options_rate": _percentage(sum(1 for question in all_mcqs if mcq_has_four_options(question)), len(all_mcqs)),
        "non_empty_correct_answers_rate": _percentage(sum(1 for question in all_questions if valid_answer_index(question)), len(all_questions)),
        "non_empty_explanations_rate": _percentage(sum(1 for question in all_questions if has_non_empty(question.get("e"))), len(all_questions)),
        "valid_bloom_labels_rate": _percentage(sum(1 for question in all_questions if valid_bloom(question)), len(all_questions)),
        "valid_difficulty_labels_rate": _percentage(sum(1 for question in all_questions if valid_difficulty(question)), len(all_questions)),
        "question_text_word_limit_rate": _percentage(sum(1 for question in all_questions if valid_question_text_length(question)), len(all_questions)),
        "option_word_limit_rate": _percentage(sum(1 for question in all_questions if valid_option_lengths(question)), len(all_questions)),
        "explanation_word_limit_rate": _percentage(sum(1 for question in all_questions if valid_explanation_length(question)), len(all_questions)),
        "average_generation_time": _average([record.get("elapsed_seconds") for record in records if isinstance(record.get("elapsed_seconds"), (int, float))]),
        "average_generated_token_count": _average([record.get("eval_count") for record in records if isinstance(record.get("eval_count"), (int, float))]),
        "average_tokens_per_second": _average([record.get("tokens_per_second") for record in records if isinstance(record.get("tokens_per_second"), (int, float))]),
    }


def is_individual_question_record(record: dict[str, Any]) -> bool:
    return record.get("record_type") == "individual_question"


def is_aggregate_record(record: dict[str, Any]) -> bool:
    return record.get("record_type") == "aggregate_question_set" or record.get("aggregate_record") is True


def final_output_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    aggregate_records = [record for record in records if is_aggregate_record(record)]
    if aggregate_records:
        legacy_records = [
            record
            for record in records
            if not is_individual_question_record(record) and not is_aggregate_record(record)
        ]
        return legacy_records + aggregate_records
    return [record for record in records if not is_individual_question_record(record)]


def calculate_metrics(payload: dict[str, Any]) -> list[dict[str, Any]]:
    records = payload["records"]
    models = sorted({str(record.get("model")) for record in records})
    rows: list[dict[str, Any]] = []
    for model in models:
        model_records = [record for record in records if record.get("model") == model]
        individual_records = [record for record in model_records if is_individual_question_record(record)]
        aggregate_records = [record for record in model_records if is_aggregate_record(record)]
        final_records = final_output_records(model_records)
        rows.append(
            {
                "experiment_id": payload.get("experiment_id"),
                "model": model,
                **analyze_model_records(final_records),
                "individual_request_count": len(individual_records),
                "individual_request_success_rate": _percentage(
                    sum(1 for record in individual_records if record.get("generation_success") is True),
                    len(individual_records),
                ),
                "aggregate_request_count": len(aggregate_records),
                "aggregate_generation_success_rate": _percentage(
                    sum(1 for record in aggregate_records if record.get("generation_success") is True),
                    len(aggregate_records),
                ),
                "aggregate_complete_question_set_rate": _percentage(
                    sum(1 for record in aggregate_records if record.get("complete_question_set") is True),
                    len(aggregate_records),
                ),
            }
        )
    return rows


def save_metrics(input_path: Path, metrics: list[dict[str, Any]], experiment_id: str) -> tuple[Path, Path]:
    results_dir = input_path.parent
    csv_path = results_dir / f"{experiment_id}_automatic_metrics.csv"
    json_path = results_dir / f"{experiment_id}_automatic_metrics.json"
    pd.DataFrame(metrics).to_csv(csv_path, index=False, encoding="utf-8")
    with json_path.open("w", encoding="utf-8") as file:
        json.dump(metrics, file, indent=2, ensure_ascii=False)
    return csv_path, json_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate structural quality of an offline LLM comparison result file.")
    parser.add_argument("--input", type=Path, required=True, help="Path to a *_comparison.json result file.")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    payload = load_result_file(args.input)
    experiment_id = str(payload.get("experiment_id") or args.input.stem.replace("_comparison", ""))
    metrics = calculate_metrics(payload)
    csv_path, json_path = save_metrics(args.input, metrics, experiment_id)
    print(pd.DataFrame(metrics).to_string(index=False))
    print(f"Saved automatic metrics: {csv_path}")
    print(f"Saved automatic metrics JSON: {json_path}")


if __name__ == "__main__":
    main()
