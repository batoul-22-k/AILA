"""Calculate final human-review results for the offline LLM comparison."""

from __future__ import annotations

import argparse
import json
import logging
from itertools import combinations
from pathlib import Path
from typing import Any

import pandas as pd


logger = logging.getLogger(__name__)

BINARY_FIELDS = ["answer_correct", "grounded_in_lecture", "bloom_label_correct", "difficulty_label_correct"]
RATING_FIELDS = ["relevance_score", "clarity_score", "distractor_quality_score"]
REQUIRED_RATING_FIELDS = ["relevance_score", "clarity_score"]
OPTIONAL_RATING_FIELDS = ["distractor_quality_score"]


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def load_mapping(path: Path) -> dict[str, str]:
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    mapping = payload.get("mapping") if isinstance(payload, dict) else None
    if not isinstance(mapping, dict):
        raise ValueError("Mapping file must contain a mapping object.")
    return {str(anonymous): str(real) for anonymous, real in mapping.items()}


def read_reviews(path: Path, mapping: dict[str, str]) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8")
    if "anonymous_model" not in df.columns:
        raise ValueError("Review CSV must contain anonymous_model.")
    df["model"] = df["anonymous_model"].map(mapping)
    if df["model"].isna().any():
        missing = sorted(df.loc[df["model"].isna(), "anonymous_model"].dropna().unique())
        raise ValueError(f"Anonymous model labels missing from mapping: {missing}")
    return df


def numeric_series(df: pd.DataFrame, field: str) -> pd.Series:
    if field not in df.columns:
        return pd.Series(dtype="float64")
    return pd.to_numeric(df[field], errors="coerce")


def validate_ranges(df: pd.DataFrame) -> None:
    errors: list[str] = []
    for field in BINARY_FIELDS:
        if field not in df.columns:
            errors.append(f"Missing required scoring column: {field}")
            continue
        values = numeric_series(df, field)
        invalid = values.notna() & ~values.isin([0, 1])
        if invalid.any():
            errors.append(f"{field} contains values outside 0/1.")

    for field in REQUIRED_RATING_FIELDS:
        if field not in df.columns:
            errors.append(f"Missing required rating column: {field}")
            continue
        values = numeric_series(df, field)
        invalid = values.notna() & ~values.between(1, 5)
        if invalid.any():
            errors.append(f"{field} contains values outside 1-5.")

    for field in OPTIONAL_RATING_FIELDS:
        if field not in df.columns:
            continue
        values = numeric_series(df, field)
        invalid = values.notna() & ~values.between(1, 5)
        if invalid.any():
            errors.append(f"{field} contains values outside 1-5.")

    if errors:
        raise ValueError(" ".join(errors))


def percent_mean(series: pd.Series) -> float:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.empty:
        return 0.0
    return round(float(clean.mean() * 100), 2)


def score_mean(series: pd.Series) -> float:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.empty:
        return 0.0
    return round(float(clean.mean()), 4)


def combined_quality_score(row: dict[str, Any]) -> float:
    """Secondary score: equal-weight average of normalized instructor metrics."""

    components = [
        row["answer_accuracy_percentage"] / 100,
        row["groundedness_percentage"] / 100,
        row["average_relevance_score"] / 5,
        row["average_clarity_score"] / 5,
        row["bloom_label_accuracy_percentage"] / 100,
        row["difficulty_label_accuracy_percentage"] / 100,
    ]
    if row["average_distractor_quality_score"] > 0:
        components.append(row["average_distractor_quality_score"] / 5)
    return round((sum(components) / len(components)) * 100, 2)


def calculate_per_model(df: pd.DataFrame) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for model, group in df.groupby("model"):
        row = {
            "model": model,
            "answer_accuracy_percentage": percent_mean(numeric_series(group, "answer_correct")),
            "groundedness_percentage": percent_mean(numeric_series(group, "grounded_in_lecture")),
            "average_relevance_score": score_mean(numeric_series(group, "relevance_score")),
            "average_clarity_score": score_mean(numeric_series(group, "clarity_score")),
            "average_distractor_quality_score": score_mean(numeric_series(group, "distractor_quality_score")),
            "bloom_label_accuracy_percentage": percent_mean(numeric_series(group, "bloom_label_correct")),
            "difficulty_label_accuracy_percentage": percent_mean(numeric_series(group, "difficulty_label_correct")),
            "reviewed_questions": int(len(group)),
        }
        row["combined_educational_quality_score"] = combined_quality_score(row)
        rows.append(row)
    return rows


def calculate_agreement(df: pd.DataFrame) -> dict[str, float]:
    if "reviewer_id" not in df.columns:
        return {}
    reviewers = sorted(str(value) for value in df["reviewer_id"].dropna().unique())
    if len(reviewers) < 2:
        return {}

    try:
        from sklearn.metrics import cohen_kappa_score
    except ImportError:
        logger.warning("scikit-learn is not installed; skipping inter-rater agreement metrics.")
        return {}

    agreement: dict[str, float] = {}
    for field in BINARY_FIELDS + RATING_FIELDS:
        if field not in df.columns:
            continue
        pair_scores: list[float] = []
        for reviewer_a, reviewer_b in combinations(reviewers, 2):
            left = df[df["reviewer_id"].astype(str) == reviewer_a][["review_id", field]].copy()
            right = df[df["reviewer_id"].astype(str) == reviewer_b][["review_id", field]].copy()
            merged = left.merge(right, on="review_id", suffixes=("_a", "_b"))
            values_a = pd.to_numeric(merged[f"{field}_a"], errors="coerce")
            values_b = pd.to_numeric(merged[f"{field}_b"], errors="coerce")
            valid = values_a.notna() & values_b.notna()
            if valid.sum() < 2:
                continue
            weights = "quadratic" if field in RATING_FIELDS else None
            pair_scores.append(float(cohen_kappa_score(values_a[valid], values_b[valid], weights=weights)))
        if pair_scores:
            agreement[f"{field}_cohens_kappa"] = round(sum(pair_scores) / len(pair_scores), 4)
    return agreement


def save_results(reviews_path: Path, rows: list[dict[str, Any]], agreement: dict[str, float]) -> tuple[Path, Path]:
    stem = reviews_path.stem.replace("_human_review_blinded", "")
    csv_path = reviews_path.parent / f"{stem}_final_results.csv"
    json_path = reviews_path.parent / f"{stem}_final_results.json"
    pd.DataFrame(rows).to_csv(csv_path, index=False, encoding="utf-8")
    with json_path.open("w", encoding="utf-8") as file:
        json.dump(
            {
                "results": rows,
                "combined_educational_quality_score_formula": (
                    "Equal-weight average of normalized answer accuracy, groundedness, relevance, clarity, "
                    "Bloom-label accuracy, difficulty-label accuracy, and distractor quality when available."
                ),
                "inter_rater_agreement": agreement,
            },
            file,
            indent=2,
            ensure_ascii=False,
        )
    return csv_path, json_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Calculate final human-review results for an offline LLM comparison.")
    parser.add_argument("--reviews", type=Path, required=True, help="Completed blinded human-review CSV.")
    parser.add_argument("--mapping", type=Path, required=True, help="Private anonymous-model mapping JSON.")
    return parser.parse_args()


def main() -> None:
    configure_logging()
    args = parse_args()
    mapping = load_mapping(args.mapping)
    df = read_reviews(args.reviews, mapping)
    validate_ranges(df)
    rows = calculate_per_model(df)
    agreement = calculate_agreement(df)
    csv_path, json_path = save_results(args.reviews, rows, agreement)
    print(pd.DataFrame(rows).to_string(index=False))
    if agreement:
        print("\nInter-rater agreement:")
        print(pd.DataFrame([agreement]).to_string(index=False))
    print(f"Saved final results: {csv_path}")
    print(f"Saved final results JSON: {json_path}")


if __name__ == "__main__":
    main()
