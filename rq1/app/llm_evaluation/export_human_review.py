"""Export blinded instructor-review CSV files from comparison results."""

from __future__ import annotations

import argparse
import csv
import json
import logging
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.llm_evaluation.validate_outputs import load_result_file, questions_from_parsed


logger = logging.getLogger(__name__)

REVIEW_COLUMNS = [
    "review_id",
    "lecture_id",
    "topic",
    "anonymous_model",
    "question_number",
    "question_type",
    "lecture_content",
    "question_text",
    "options",
    "generated_correct_answer",
    "generated_explanation",
    "generated_bloom_level",
    "generated_difficulty",
    "answer_correct",
    "grounded_in_lecture",
    "relevance_score",
    "clarity_score",
    "distractor_quality_score",
    "bloom_label_correct",
    "difficulty_label_correct",
    "reviewer_notes",
]


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def create_model_mapping(models: list[str]) -> dict[str, str]:
    if len(models) != 2:
        raise ValueError(f"Expected exactly two models, found {len(models)}.")
    shuffled = models[:]
    random.SystemRandom().shuffle(shuffled)
    return {"Model A": shuffled[0], "Model B": shuffled[1]}


def anonymous_label_for_model(mapping: dict[str, str], model: str) -> str:
    for anonymous_label, real_model in mapping.items():
        if real_model == model:
            return anonymous_label
    raise KeyError(f"No anonymous mapping found for model {model!r}")


def build_review_rows(payload: dict[str, Any], mapping: dict[str, str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    has_aggregate_records = any(record.get("record_type") == "aggregate_question_set" or record.get("aggregate_record") is True for record in payload["records"])
    for record in payload["records"]:
        if record.get("record_type") == "individual_question":
            continue
        if has_aggregate_records and not (record.get("record_type") == "aggregate_question_set" or record.get("aggregate_record") is True):
            continue
        if record.get("generation_success") is not True:
            continue
        if record.get("valid_json") is not True or record.get("schema_compliant") is not True:
            continue
        questions = questions_from_parsed(record.get("parsed_output"))
        anonymous_model = anonymous_label_for_model(mapping, str(record.get("model")))
        for question_index, question in enumerate(questions, start=1):
            options = question.get("o") if isinstance(question.get("o"), list) else []
            answer_index = question.get("a")
            correct_answer = options[answer_index] if isinstance(answer_index, int) and 0 <= answer_index < len(options) else ""
            rows.append(
                {
                    "review_id": f"{record.get('lecture_id')}__{anonymous_model.replace(' ', '_')}__q{question_index:02d}",
                    "lecture_id": record.get("lecture_id"),
                    "topic": record.get("topic"),
                    "anonymous_model": anonymous_model,
                    "question_number": question_index,
                    "question_type": "mcq",
                    "lecture_content": record.get("lecture_content", ""),
                    "question_text": question.get("q", ""),
                    "options": json.dumps(options, ensure_ascii=False),
                    "generated_correct_answer": correct_answer,
                    "generated_explanation": question.get("e", ""),
                    "generated_bloom_level": question.get("b", ""),
                    "generated_difficulty": question.get("d", ""),
                    "answer_correct": "",
                    "grounded_in_lecture": "",
                    "relevance_score": "",
                    "clarity_score": "",
                    "distractor_quality_score": "",
                    "bloom_label_correct": "",
                    "difficulty_label_correct": "",
                    "reviewer_notes": "",
                }
            )
    random.SystemRandom().shuffle(rows)
    return rows


def export_review_files(input_path: Path) -> tuple[Path, Path]:
    payload = load_result_file(input_path)
    experiment_id = str(payload.get("experiment_id") or input_path.stem.replace("_comparison", ""))
    models = sorted({str(record.get("model")) for record in payload["records"]})
    mapping = create_model_mapping(models)
    rows = build_review_rows(payload, mapping)

    review_path = input_path.parent / f"{experiment_id}_human_review_blinded.csv"
    mapping_path = input_path.parent / f"{experiment_id}_model_mapping.json"
    with review_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=REVIEW_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    with mapping_path.open("w", encoding="utf-8") as file:
        json.dump(
            {
                "experiment_id": experiment_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "mapping": mapping,
            },
            file,
            indent=2,
            ensure_ascii=False,
        )
    return review_path, mapping_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export a blinded human-review CSV from comparison results.")
    parser.add_argument("--input", type=Path, required=True, help="Path to a *_comparison.json result file.")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    review_path, mapping_path = export_review_files(args.input)
    print(f"Saved blinded review CSV: {review_path}")
    print(f"Saved private model mapping: {mapping_path}")


if __name__ == "__main__":
    main()
