from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from app.ml.dataset_mappers import (
    DEFAULT_KDD_DIR,
    DEFAULT_OULAD_DIR,
    DEFAULT_UNIFIED_DATASET_PATH,
    save_unified_training_dataset,
    unified_dataset_summary,
)
from app.ml.feature_schema import FEATURE_SCHEMA_VERSION, PREDICTION_FEATURE_COLUMNS, RISK_LABELS
from app.ml.risk_feature_engineering import (
    DATASET_SOURCE_COLUMN,
    LABEL_COLUMN,
    LABEL_ID_COLUMN,
    class_distribution,
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


def load_unified_csv_features(csv_path: str | Path):
    pd = require_pandas()
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(
            f"Unified training dataset not found at {path}. "
            "Run this trainer with --rebuild-unified after placing OULAD and KDD Cup 2015 raw files."
        )
    frame = pd.read_csv(path)
    missing = [
        column
        for column in PREDICTION_FEATURE_COLUMNS + [LABEL_COLUMN, LABEL_ID_COLUMN, DATASET_SOURCE_COLUMN]
        if column not in frame.columns
    ]
    if missing:
        raise ValueError(f"Unified training dataset is missing required columns: {', '.join(missing)}")
    frame = frame[PREDICTION_FEATURE_COLUMNS + [LABEL_COLUMN, LABEL_ID_COLUMN, DATASET_SOURCE_COLUMN]].copy()
    frame = frame.dropna(subset=[LABEL_ID_COLUMN])
    if frame[LABEL_ID_COLUMN].nunique() < 2:
        raise ValueError("Training requires at least two risk classes after preprocessing")
    return frame


def load_training_frame(
    unified_csv: str | Path,
    oulad_dir: str | Path,
    kdd_dir: str | Path,
    rebuild_unified: bool = False,
):
    path = Path(unified_csv)
    if rebuild_unified or not path.exists():
        previous_distribution = None
        if path.exists():
            previous_frame = load_unified_csv_features(path)
            previous_distribution = class_distribution(previous_frame[LABEL_COLUMN])
        frame, saved_path = save_unified_training_dataset(
            oulad_dir=oulad_dir,
            kdd_dir=kdd_dir,
            output_path=path,
        )
        print(f"Unified training dataset exported to {saved_path}")
        if previous_distribution:
            print("Class distribution before rebuild:")
            print(json.dumps(previous_distribution, indent=2, sort_keys=True))
        print("Class distribution after rebuild:")
        print(json.dumps(class_distribution(frame[LABEL_COLUMN]), indent=2, sort_keys=True))
        print(json.dumps(unified_dataset_summary(frame), indent=2, sort_keys=True))
        return frame
    return load_unified_csv_features(path)


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


def feature_distributions(frame) -> dict:
    distributions = {}
    for column in PREDICTION_FEATURE_COLUMNS:
        summary = frame[column].describe(percentiles=[0.25, 0.5, 0.75]).to_dict()
        distributions[column] = {
            "min": round(float(summary.get("min", 0)), 4),
            "p25": round(float(summary.get("25%", 0)), 4),
            "mean": round(float(summary.get("mean", 0)), 4),
            "median": round(float(summary.get("50%", 0)), 4),
            "p75": round(float(summary.get("75%", 0)), 4),
            "max": round(float(summary.get("max", 0)), 4),
        }
    return distributions


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
    predicted_labels = [RISK_LABELS[int(value)] for value in predictions]
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
        "feature_distributions": feature_distributions(frame),
        "class_distribution": class_distribution(frame[LABEL_COLUMN]),
        "predicted_class_distribution": class_distribution(require_pandas().Series(predicted_labels)),
        "dataset_distribution": class_distribution(frame[DATASET_SOURCE_COLUMN]),
        "training_balance_strategy": "Outcome-aware OULAD/KDD relabeling plus balanced sample weights",
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
    parser = argparse.ArgumentParser(description="Train the student academic risk XGBoost classifier from the unified OULAD + KDD dataset.")
    parser.add_argument("--unified-csv", default=str(DEFAULT_UNIFIED_DATASET_PATH), help="Merged OULAD + KDD feature dataset path.")
    parser.add_argument("--oulad-dir", help="Directory containing OULAD CSV files.", default=str(DEFAULT_OULAD_DIR))
    parser.add_argument("--kdd-dir", help="Directory containing KDD Cup 2015 CSV files.", default=str(DEFAULT_KDD_DIR))
    parser.add_argument("--rebuild-unified", action="store_true", help="Rebuild unified_training_dataset.csv from OULAD and KDD raw files before training.")
    parser.add_argument("--output", default="backend/models/student_risk_xgboost.pkl", help="Model artifact output path.")
    parser.add_argument("--metrics-output", default="backend/models/student_risk_xgboost_metrics.json", help="Metrics JSON output path.")
    parser.add_argument("--test-size", type=float, default=0.2)
    args = parser.parse_args()

    deps = require_training_dependencies()
    frame = load_training_frame(
        unified_csv=args.unified_csv,
        oulad_dir=args.oulad_dir,
        kdd_dir=args.kdd_dir,
        rebuild_unified=args.rebuild_unified,
    )
    artifact, metrics = train_model(frame, test_size=args.test_size)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    deps["joblib"].dump(artifact, output_path)
    write_json(Path(args.metrics_output), metrics)
    print(f"Trained {artifact['model_name']} with {len(frame)} rows.")
    print("Class balance:")
    print(json.dumps(metrics["class_distribution"], indent=2, sort_keys=True))
    print("Dataset balance:")
    print(json.dumps(metrics["dataset_distribution"], indent=2, sort_keys=True))
    print("Predicted class distribution on holdout:")
    print(json.dumps(metrics["predicted_class_distribution"], indent=2, sort_keys=True))
    print("Feature distributions:")
    print(json.dumps(metrics["feature_distributions"], indent=2, sort_keys=True))
    print("Evaluation metrics:")
    print(json.dumps(
        {
            "accuracy": metrics["accuracy"],
            "macro_f1": metrics["macro_f1"],
            "weighted_f1": metrics["weighted_f1"],
        },
        indent=2,
        sort_keys=True,
    ))
    print("Confusion matrix:")
    print(json.dumps(metrics["confusion_matrix"], indent=2))
    print("Feature importance:")
    print(json.dumps(metrics["feature_importance"], indent=2))
    print(f"Model exported to {output_path}")
    print(f"Metrics exported to {args.metrics_output}")


if __name__ == "__main__":
    main()
