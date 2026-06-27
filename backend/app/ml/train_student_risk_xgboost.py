from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from app.ml.dataset_mappers import load_kdd_features, load_oulad_features
from app.ml.feature_schema import FEATURE_SCHEMA_VERSION, PREDICTION_FEATURE_COLUMNS, RISK_LABELS
from app.ml.risk_feature_engineering import (
    DATASET_SOURCE_COLUMN,
    LABEL_COLUMN,
    LABEL_ID_COLUMN,
    class_distribution,
    finalize_training_frame,
    require_pandas,
)


def require_training_dependencies():
    try:
        import joblib
        from sklearn.impute import SimpleImputer
        from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
        from sklearn.model_selection import train_test_split
        from sklearn.pipeline import Pipeline
        from sklearn.utils.class_weight import compute_sample_weight
        from xgboost import XGBClassifier
    except ImportError as exc:
        raise RuntimeError(
            "Training requires pandas, scikit-learn, xgboost, and joblib. "
            "Install backend requirements before running this script."
        ) from exc
    return {
        "joblib": joblib,
        "SimpleImputer": SimpleImputer,
        "accuracy_score": accuracy_score,
        "classification_report": classification_report,
        "confusion_matrix": confusion_matrix,
        "f1_score": f1_score,
        "train_test_split": train_test_split,
        "Pipeline": Pipeline,
        "compute_sample_weight": compute_sample_weight,
        "XGBClassifier": XGBClassifier,
    }


def load_synthetic_csv_features(csv_path: str | Path):
    pd = require_pandas()
    frame = pd.read_csv(csv_path)
    if LABEL_COLUMN not in frame.columns:
        raise ValueError(f"Synthetic CSV must include a {LABEL_COLUMN!r} target column")
    return finalize_training_frame(frame, "synthetic_student_risk")


def load_training_frame(oulad_dir: str | None, kdd_dir: str | None, synthetic_csv: str | None):
    pd = require_pandas()
    frames = []
    if oulad_dir:
        frames.append(load_oulad_features(oulad_dir))
    if kdd_dir:
        frames.append(load_kdd_features(kdd_dir))
    if synthetic_csv:
        frames.append(load_synthetic_csv_features(synthetic_csv))
    if not frames:
        raise ValueError("Provide at least one dataset with --oulad-dir, --kdd-dir, or --synthetic-csv")
    combined = pd.concat(frames, ignore_index=True)
    combined = combined.dropna(subset=[LABEL_ID_COLUMN])
    if combined[LABEL_ID_COLUMN].nunique() < 2:
        raise ValueError("Training requires at least two risk classes after preprocessing")
    return combined


def build_model(deps):
    return deps["Pipeline"](
        steps=[
            ("imputer", deps["SimpleImputer"](strategy="median")),
            (
                "classifier",
                deps["XGBClassifier"](
                    objective="multi:softprob",
                    num_class=len(RISK_LABELS),
                    n_estimators=300,
                    max_depth=4,
                    learning_rate=0.05,
                    subsample=0.9,
                    colsample_bytree=0.9,
                    reg_lambda=1.0,
                    random_state=42,
                    eval_metric="mlogloss",
                ),
            ),
        ]
    )


def feature_importance(model) -> list[dict]:
    classifier = model.named_steps["classifier"]
    values = getattr(classifier, "feature_importances_", [])
    pairs = zip(PREDICTION_FEATURE_COLUMNS, values, strict=False)
    return [
        {"feature": feature, "importance": round(float(value), 6)}
        for feature, value in sorted(pairs, key=lambda item: float(item[1]), reverse=True)
    ]


def split_training_data(frame, deps, test_size: float):
    counts = frame[LABEL_ID_COLUMN].value_counts()
    stratify = frame[LABEL_ID_COLUMN] if counts.min() >= 2 and len(counts) > 1 else None
    return deps["train_test_split"](
        frame[PREDICTION_FEATURE_COLUMNS],
        frame[LABEL_ID_COLUMN],
        test_size=test_size,
        random_state=42,
        stratify=stratify,
    )


def train_model(frame, test_size: float = 0.2) -> tuple[dict, dict]:
    deps = require_training_dependencies()
    x_train, x_test, y_train, y_test = split_training_data(frame, deps, test_size)
    model = build_model(deps)
    sample_weight = deps["compute_sample_weight"](class_weight="balanced", y=y_train)
    model.fit(x_train, y_train, classifier__sample_weight=sample_weight)
    predictions = model.predict(x_test)
    labels = list(range(len(RISK_LABELS)))
    report = deps["classification_report"](
        y_test,
        predictions,
        labels=labels,
        target_names=RISK_LABELS,
        output_dict=True,
        zero_division=0,
    )
    matrix = deps["confusion_matrix"](y_test, predictions, labels=labels)
    metrics = {
        "accuracy": round(float(deps["accuracy_score"](y_test, predictions)), 6),
        "macro_f1": round(float(deps["f1_score"](y_test, predictions, labels=labels, average="macro", zero_division=0)), 6),
        "weighted_f1": round(float(deps["f1_score"](y_test, predictions, labels=labels, average="weighted", zero_division=0)), 6),
        "classification_report": report,
        "confusion_matrix": {
            "labels": RISK_LABELS,
            "matrix": matrix.tolist(),
        },
        "feature_importance": feature_importance(model),
        "class_distribution": class_distribution(frame[LABEL_COLUMN]),
        "dataset_distribution": class_distribution(frame[DATASET_SOURCE_COLUMN]),
        "train_rows": int(len(x_train)),
        "test_rows": int(len(x_test)),
    }
    artifact = {
        "model": model,
        "model_name": "student_risk_xgboost",
        "model_version": f"xgboost-{FEATURE_SCHEMA_VERSION}",
        "model_type": "xgboost_classifier",
        "feature_columns": PREDICTION_FEATURE_COLUMNS,
        "risk_labels": RISK_LABELS,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "metrics": metrics,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    return artifact, metrics


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the student academic risk XGBoost classifier.")
    parser.add_argument("--oulad-dir", help="Directory containing OULAD CSV files.", default=None)
    parser.add_argument("--kdd-dir", help="Directory containing KDD Cup 2015 CSV files.", default=None)
    parser.add_argument("--synthetic-csv", help="CSV containing schema-compatible synthetic student risk rows.", default=None)
    parser.add_argument("--output", default="backend/models/student_risk_xgboost.pkl", help="Model artifact output path.")
    parser.add_argument("--metrics-output", default="backend/models/student_risk_xgboost_metrics.json", help="Metrics JSON output path.")
    parser.add_argument("--test-size", type=float, default=0.2)
    args = parser.parse_args()

    deps = require_training_dependencies()
    frame = load_training_frame(args.oulad_dir, args.kdd_dir, args.synthetic_csv)
    artifact, metrics = train_model(frame, test_size=args.test_size)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    deps["joblib"].dump(artifact, output_path)
    write_json(Path(args.metrics_output), metrics)
    print(f"Trained {artifact['model_name']} with {len(frame)} rows.")
    print(f"Model exported to {output_path}")
    print(f"Metrics exported to {args.metrics_output}")
    print(f"Accuracy: {metrics['accuracy']}, macro F1: {metrics['macro_f1']}")


if __name__ == "__main__":
    main()
