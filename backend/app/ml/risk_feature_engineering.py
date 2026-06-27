from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from app.ml.feature_schema import PREDICTION_FEATURE_COLUMNS, RISK_LABEL_TO_ID


DATASET_SOURCE_COLUMN = "dataset_source"
LABEL_COLUMN = "risk_label"
LABEL_ID_COLUMN = "risk_label_id"


@dataclass(frozen=True)
class DatasetFrame:
    name: str
    frame: "pd.DataFrame"


def require_pandas():
    try:
        import pandas as pd
    except ImportError as exc:
        raise RuntimeError("pandas is required for ML training. Install backend requirements first.") from exc
    return pd


def read_csv(path: Path):
    pd = require_pandas()
    return pd.read_csv(path)


def require_files(root: Path, filenames: Iterable[str]) -> dict[str, Path]:
    found = {}
    missing = []
    for filename in filenames:
        path = root / filename
        if path.exists():
            found[filename] = path
        else:
            missing.append(filename)
    if missing:
        raise FileNotFoundError(f"Missing required files in {root}: {', '.join(missing)}")
    return found


def clamp_series(series, low: float = 0.0, high: float = 100.0):
    return series.fillna(0).clip(lower=low, upper=high).round(4)


def percentile_rank(series):
    if len(series) <= 1:
        return series.fillna(0).map(lambda _value: 50.0)
    return (series.fillna(0).rank(method="average", pct=True) * 100).round(4)


def safe_divide(numerator, denominator):
    denominator = denominator.replace(0, float("nan")) if hasattr(denominator, "replace") else denominator
    return numerator / denominator


def engagement_score(frame):
    return clamp_series(
        (0.35 * frame["attendance_rate"])
        + (0.25 * frame["participation_rate"])
        + (0.25 * frame["correctness_rate"])
        + (0.10 * frame["consistency_score"])
        + (0.05 * clamp_series(frame["recent_activity_count"] * 10)),
    )


def label_id(label: str) -> int:
    clean = str(label).strip().lower().replace(" risk", "")
    if clean not in RISK_LABEL_TO_ID:
        raise ValueError(f"Unsupported risk label: {label}")
    return RISK_LABEL_TO_ID[clean]


def finalize_training_frame(frame, source: str):
    pd = require_pandas()
    clean = frame.copy()
    for column in PREDICTION_FEATURE_COLUMNS:
        if column not in clean:
            clean[column] = 0.0
        clean[column] = pd.to_numeric(clean[column], errors="coerce").fillna(0.0)
    clean["engagement_score"] = engagement_score(clean)
    clean[LABEL_COLUMN] = clean[LABEL_COLUMN].map(lambda value: str(value).strip().lower().replace(" risk", ""))
    clean = clean[clean[LABEL_COLUMN].isin(RISK_LABEL_TO_ID)]
    clean[LABEL_ID_COLUMN] = clean[LABEL_COLUMN].map(label_id).astype(int)
    clean[DATASET_SOURCE_COLUMN] = source
    return clean[PREDICTION_FEATURE_COLUMNS + [LABEL_COLUMN, LABEL_ID_COLUMN, DATASET_SOURCE_COLUMN]]


def class_distribution(labels) -> dict[str, int]:
    counts = labels.value_counts().to_dict()
    return {str(label): int(count) for label, count in sorted(counts.items())}
