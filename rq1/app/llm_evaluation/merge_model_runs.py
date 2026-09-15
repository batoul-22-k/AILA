"""Merge separate single-model RQ1 evaluation runs into one comparison report."""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.llm_evaluation.config import DEFAULT_RESULTS_DIR
from app.llm_evaluation.run_comparison import summarize_records


logger = logging.getLogger(__name__)


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def load_payload(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    if not isinstance(payload, dict) or not isinstance(payload.get("records"), list):
        raise ValueError(f"Result file must contain an object with a records array: {path}")
    return payload


def _passage_hashes(payload: dict[str, Any]) -> dict[str, str]:
    hashes = payload.get("input_passage_hashes")
    if isinstance(hashes, dict):
        return {str(key): str(value) for key, value in hashes.items()}
    derived: dict[str, str] = {}
    for record in payload.get("records", []):
        if isinstance(record, dict) and record.get("lecture_id") and record.get("lecture_hash"):
            derived[str(record["lecture_id"])] = str(record["lecture_hash"])
    return derived


def validate_merge_inputs(payloads: list[dict[str, Any]]) -> None:
    if len(payloads) < 2:
        raise ValueError("At least two model result files are required for merging.")

    group_ids = {payload.get("experiment_group_id") for payload in payloads}
    if len(group_ids) != 1 or None in group_ids or "" in group_ids:
        raise ValueError("Cannot merge result files with different or missing experiment_group_id values.")

    settings = [payload.get("generation_settings") for payload in payloads]
    if any(setting != settings[0] for setting in settings[1:]):
        raise ValueError("Cannot merge result files because generation settings differ.")

    hashes = [_passage_hashes(payload) for payload in payloads]
    if any(passage_hashes != hashes[0] for passage_hashes in hashes[1:]):
        raise ValueError("Cannot merge result files because input passage hashes differ.")

    lecture_ids = set(hashes[0])
    for payload in payloads:
        payload_lecture_ids = {str(record.get("lecture_id")) for record in payload.get("records", []) if isinstance(record, dict)}
        if payload_lecture_ids != lecture_ids:
            raise ValueError("Cannot merge result files because lecture_id sets differ.")


def merge_payloads(payloads: list[dict[str, Any]]) -> dict[str, Any]:
    validate_merge_inputs(payloads)
    experiment_group_id = str(payloads[0]["experiment_group_id"])
    records = [record for payload in payloads for record in payload["records"]]
    models: list[str] = []
    for payload in payloads:
        for model in payload.get("models", []):
            model = str(model)
            if model not in models:
                models.append(model)

    records.sort(key=lambda record: (str(record.get("lecture_id") or ""), models.index(str(record.get("model"))) if str(record.get("model")) in models else 999))
    return {
        "experiment_id": f"{experiment_group_id}_merged",
        "experiment_group_id": experiment_group_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "merged_from_experiment_ids": [payload.get("experiment_id") for payload in payloads],
        "models": models,
        "configured_models": payloads[0].get("configured_models", models),
        "single_model_run": False,
        "input_file": payloads[0].get("input_file"),
        "input_passage_hashes": _passage_hashes(payloads[0]),
        "generation_settings": payloads[0].get("generation_settings"),
        "execution_order": [entry for payload in payloads for entry in payload.get("execution_order", [])],
        "retry_policy": payloads[0].get("retry_policy"),
        "summary": summarize_records(records, models),
        "records": records,
    }


def merge_result_files(input_paths: list[Path], output_path: Path | None = None) -> Path:
    payloads = [load_payload(path) for path in input_paths]
    merged = merge_payloads(payloads)
    if output_path is None:
        output_path = DEFAULT_RESULTS_DIR / f"{merged['experiment_group_id']}_merged_comparison.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        raise FileExistsError(f"Refusing to overwrite existing merged result file: {output_path}")
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(merged, file, indent=2, ensure_ascii=False)
    logger.info("Saved merged comparison report: %s", output_path)
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Merge separate single-model RQ1 evaluation result files.")
    parser.add_argument("inputs", nargs="+", type=Path, help="Single-model *_comparison.json files to merge.")
    parser.add_argument("--output", type=Path, default=None, help="Output path for the merged comparison JSON.")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    output_path = merge_result_files(args.inputs, args.output)
    print(f"Saved merged comparison results: {output_path}")


if __name__ == "__main__":
    main()
