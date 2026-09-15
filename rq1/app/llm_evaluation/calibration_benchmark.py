"""Pre-experiment calibration benchmark for Ollama generation limits."""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import time
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.llm_evaluation.config import DEFAULT_INPUT_FILE, DEFAULT_RESULTS_DIR, EvaluationConfig, load_config
from app.llm_evaluation.prompts import build_evaluation_prompt
from app.llm_evaluation.run_comparison import (
    make_record,
    model_tags_for,
    preflight_checks,
    unload_and_confirm,
    load_passages,
)


logger = logging.getLogger(__name__)
DEFAULT_CALIBRATION_PAIRS = ((1024, 280), (2048, 512), (3072, 512), (4096, 768), (4096, 1024))
RANKING_COLUMNS = [
    "rank",
    "recommended",
    "num_ctx",
    "num_predict",
    "both_models_generation_success",
    "total_requests",
    "http_successes",
    "generation_successes",
    "valid_json_outputs",
    "truncated_outputs",
    "average_elapsed_seconds",
    "average_tokens_per_second",
]


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def parse_calibration_pairs(value: str | None) -> list[tuple[int, int]]:
    raw_value = value if value is not None else os.getenv("EVALUATION_CALIBRATION_PAIRS", "")
    if not raw_value.strip():
        return list(DEFAULT_CALIBRATION_PAIRS)

    pairs: list[tuple[int, int]] = []
    for item in raw_value.split(","):
        item = item.strip().lower().replace(" ", "")
        if not item:
            continue
        separator = "x" if "x" in item else ":"
        if separator not in item:
            raise ValueError(f"Calibration pair must look like 2048x512, got {item!r}")
        left, right = item.split(separator, 1)
        try:
            num_ctx = int(left)
            num_predict = int(right)
        except ValueError as exc:
            raise ValueError(f"Calibration pair must use integers, got {item!r}") from exc
        if num_ctx <= 0 or num_predict <= 0:
            raise ValueError(f"Calibration pair values must be positive, got {item!r}")
        pairs.append((num_ctx, num_predict))
    if not pairs:
        raise ValueError("At least one calibration pair is required.")
    return pairs


def select_lecture(passages: list[dict[str, str]], lecture_id: str | None) -> dict[str, str]:
    if not passages:
        raise ValueError("At least one lecture passage is required for calibration.")
    if not lecture_id:
        return passages[0]
    for passage in passages:
        if passage["id"] == lecture_id:
            return passage
    raise ValueError(f"Lecture id not found in input file: {lecture_id}")


def calibration_config(config: EvaluationConfig, num_ctx: int, num_predict: int) -> EvaluationConfig:
    return replace(config, num_ctx=num_ctx, num_predict=num_predict)


def _bool_count(records: list[dict[str, Any]], field: str) -> int:
    return sum(1 for record in records if record.get(field) is True)


def _average(values: list[Any]) -> float | None:
    clean = [float(value) for value in values if isinstance(value, (int, float))]
    if not clean:
        return None
    return round(sum(clean) / len(clean), 4)


def summarize_pair_records(
    *,
    num_ctx: int,
    num_predict: int,
    records: list[dict[str, Any]],
    models: tuple[str, str],
) -> dict[str, Any]:
    by_model = {model: next((record for record in records if record.get("model") == model), None) for model in models}
    both_success = all(record is not None and record.get("generation_success") is True for record in by_model.values())
    row: dict[str, Any] = {
        "rank": None,
        "recommended": False,
        "num_ctx": num_ctx,
        "num_predict": num_predict,
        "both_models_generation_success": both_success,
        "total_requests": len(records),
        "http_successes": _bool_count(records, "request_success"),
        "generation_successes": _bool_count(records, "generation_success"),
        "valid_json_outputs": _bool_count(records, "valid_json"),
        "truncated_outputs": _bool_count(records, "truncated"),
        "average_elapsed_seconds": _average([record.get("elapsed_seconds") for record in records]),
        "average_tokens_per_second": _average([record.get("tokens_per_second") for record in records]),
    }
    for model in models:
        record = by_model[model] or {}
        prefix = model
        row[f"{prefix}_http_success"] = bool(record.get("request_success"))
        row[f"{prefix}_generation_success"] = bool(record.get("generation_success"))
        row[f"{prefix}_valid_json"] = bool(record.get("valid_json"))
        row[f"{prefix}_truncated"] = bool(record.get("truncated"))
        row[f"{prefix}_elapsed_seconds"] = record.get("elapsed_seconds")
        row[f"{prefix}_tokens_per_second"] = record.get("tokens_per_second")
    return row


def rank_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def score(row: dict[str, Any]) -> tuple[Any, ...]:
        return (
            bool(row["both_models_generation_success"]),
            int(row["generation_successes"]),
            int(row["http_successes"]),
            int(row["valid_json_outputs"]),
            -int(row["truncated_outputs"]),
            int(row["num_ctx"]),
            int(row["num_predict"]),
            float(row["average_tokens_per_second"] or 0),
        )

    ranked = sorted(rows, key=score, reverse=True)
    for index, row in enumerate(ranked, start=1):
        row["rank"] = index
        row["recommended"] = False
    recommended = next((row for row in ranked if row["both_models_generation_success"]), None)
    if recommended is not None:
        recommended["recommended"] = True
    return ranked


def write_ranking_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    extra_columns = sorted({key for row in rows for key in row} - set(RANKING_COLUMNS))
    columns = RANKING_COLUMNS + extra_columns
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def run_calibration(
    *,
    input_path: Path,
    results_dir: Path,
    config: EvaluationConfig,
    pairs: list[tuple[int, int]],
    lecture_id: str | None = None,
) -> tuple[Path, Path]:
    passages = load_passages(input_path)
    lecture = select_lecture(passages, lecture_id)
    results_dir.mkdir(parents=True, exist_ok=True)
    calibration_id = f"rq1_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_calibration"
    ranking_path = results_dir / f"{calibration_id}_ranking.csv"
    detail_path = results_dir / f"{calibration_id}_details.json"

    preflight = preflight_checks(config)
    all_records: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    started = time.perf_counter()
    prompt = build_evaluation_prompt(lecture["content"], config.prompt_chars)

    for num_ctx, num_predict in pairs:
        pair_config = calibration_config(config, num_ctx, num_predict)
        pair_records: list[dict[str, Any]] = []
        logger.info("Calibrating num_ctx=%s num_predict=%s", num_ctx, num_predict)
        for model in pair_config.models:
            other_models = [other_model for other_model in pair_config.models if other_model != model]
            other_model_tags = model_tags_for(pair_config, other_models)
            if other_models:
                transition = unload_and_confirm(pair_config, other_model_tags)
                if transition["confirmed"] and pair_config.request_delay_seconds > 0:
                    time.sleep(pair_config.request_delay_seconds)
            record = make_record(
                experiment_id=calibration_id,
                lecture=lecture,
                model=model,
                config=pair_config,
                prompt=prompt,
                other_models=other_model_tags,
            )
            pair_records.append(record)
            all_records.append(record)
        rows.append(summarize_pair_records(num_ctx=num_ctx, num_predict=num_predict, records=pair_records, models=pair_config.models))
        unload_and_confirm(pair_config, model_tags_for(pair_config, pair_config.models))

    ranked_rows = rank_rows(rows)
    write_ranking_csv(ranking_path, ranked_rows)
    detail_payload = {
        "calibration_id": calibration_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input_file": str(input_path),
        "lecture_id": lecture["id"],
        "models": list(config.models),
        "tested_pairs": [{"num_ctx": num_ctx, "num_predict": num_predict} for num_ctx, num_predict in pairs],
        "recommended_configuration": next(
            (
                {"num_ctx": row["num_ctx"], "num_predict": row["num_predict"]}
                for row in ranked_rows
                if row["recommended"]
            ),
            None,
        ),
        "preflight": preflight,
        "total_elapsed_seconds": time.perf_counter() - started,
        "ranking": ranked_rows,
        "records": all_records,
    }
    with detail_path.open("w", encoding="utf-8") as file:
        json.dump(detail_payload, file, indent=2, ensure_ascii=False)
    return ranking_path, detail_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a one-lecture calibration benchmark for evaluation generation limits.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT_FILE, help="Path to evaluation_inputs.json.")
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS_DIR, help="Directory for calibration outputs.")
    parser.add_argument("--pairs", default=None, help="Comma-separated pairs such as 1024x280,2048x512,4096x768.")
    parser.add_argument("--lecture-id", default=None, help="Optional lecture id; defaults to the first input passage.")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    config = load_config()
    pairs = parse_calibration_pairs(args.pairs)
    ranking_path, detail_path = run_calibration(
        input_path=args.input,
        results_dir=args.results_dir,
        config=config,
        pairs=pairs,
        lecture_id=args.lecture_id,
    )
    with ranking_path.open("r", newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    recommended = next((row for row in rows if row.get("recommended") == "True"), None)
    print(f"Saved calibration ranking: {ranking_path}")
    print(f"Saved calibration details: {detail_path}")
    if recommended:
        print(f"Recommended stable configuration: num_ctx={recommended['num_ctx']} num_predict={recommended['num_predict']}")
    else:
        print("No tested configuration succeeded for both models.")


if __name__ == "__main__":
    main()
