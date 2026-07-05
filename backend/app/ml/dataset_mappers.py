from __future__ import annotations

from pathlib import Path

from app.ml.risk_feature_engineering import (
    DATASET_SOURCE_COLUMN,
    LABEL_COLUMN,
    LABEL_ID_COLUMN,
    COMMON_EDUCATIONAL_FEATURE_COLUMNS,
    engagement_score,
    finalize_training_frame,
    percentile_rank,
    read_csv,
    require_files,
    require_pandas,
    safe_divide,
)


ML_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ML_DIR.parents[1]
DEFAULT_OULAD_DIR = BACKEND_DIR / "dataset" / "oulad"
DEFAULT_KDD_DIR = BACKEND_DIR / "dataset" / "kdd_cup_2015"
DEFAULT_UNIFIED_DATASET_PATH = ML_DIR / "datasets" / "unified_training_dataset.csv"

OULAD_FILES = [
    "studentInfo.csv",
    "studentVle.csv",
    "studentAssessment.csv",
    "assessments.csv",
]

KDD_FILES = [
    "enrollment_train.csv",
    "log_train.csv",
    "truth_train.csv",
]
KDD_TRAIN_DIR_CANDIDATES = [
    Path("."),
    Path("train"),
    Path("train") / "train",
]


def _require_files_from_candidates(root: Path, filenames: list[str], candidates: list[Path]) -> dict[str, Path]:
    checked = []
    for candidate in candidates:
        candidate_root = root / candidate
        checked.append(str(candidate_root))
        try:
            return require_files(candidate_root, filenames)
        except FileNotFoundError:
            continue
    raise FileNotFoundError(
        f"Missing required files: {', '.join(filenames)}. "
        f"Checked: {', '.join(checked)}"
    )


def _oulad_risk_label(final_result: str) -> str:
    result = str(final_result or "").strip().lower()
    if result == "distinction":
        return "low"
    if result == "pass":
        return "medium"
    return "high"


def _educational_signal_risk_score(frame, outcome_bonus=0):
    return (
        (0.35 * (100 - frame["engagement_score"].fillna(0)))
        + (0.25 * (100 - frame["correctness_rate"].fillna(0)))
        + (0.20 * (100 - frame["participation_rate"].fillna(0)))
        + (0.10 * (100 - frame["attendance_rate"].fillna(0)))
        + (0.10 * (100 - frame["consistency_score"].fillna(0)))
        + outcome_bonus
    )


def _label_from_outcome_and_signals(frame, weak_outcome, partial_outcome):
    """
    Outcome labels such as dropout, fail, and withdraw are strong evidence, but
    they are not identical to the app's Low/Medium/High early-warning classes.
    This rule keeps outcome evidence while letting engagement, correctness, and
    participation separate severe risk from students who need monitoring.
    """
    import numpy as np

    labels = np.full(len(frame), "low", dtype=object)
    score = _educational_signal_risk_score(frame)
    weak_score = _educational_signal_risk_score(frame, outcome_bonus=15)

    labels = np.where(weak_outcome & (weak_score >= 65), "high", labels)
    labels = np.where(weak_outcome & (weak_score >= 45) & (weak_score < 65), "medium", labels)
    labels = np.where(partial_outcome & (score >= 70), "high", labels)
    labels = np.where(partial_outcome & (score >= 45) & (score < 70), "medium", labels)
    labels = np.where((~weak_outcome & ~partial_outcome) & (score >= 75), "high", labels)
    labels = np.where((~weak_outcome & ~partial_outcome) & (score >= 50) & (score < 75), "medium", labels)
    return labels


def load_oulad_features(oulad_dir: str | Path):
    pd = require_pandas()
    root = Path(oulad_dir)
    files = require_files(root, OULAD_FILES)
    info = read_csv(files["studentInfo.csv"])
    student_vle = read_csv(files["studentVle.csv"])
    student_assessment = read_csv(files["studentAssessment.csv"])
    assessments = read_csv(files["assessments.csv"])

    key = ["id_student", "code_module", "code_presentation"]
    course_key = ["code_module", "code_presentation"]
    base = info[key + ["final_result"]].drop_duplicates()
    base["risk_label"] = base["final_result"].map(_oulad_risk_label)

    if student_vle.empty:
        activity = base[key].copy()
        activity["attendance_rate"] = 0.0
        activity["participation_rate"] = 0.0
        activity["consistency_score"] = 0.0
        activity["recent_activity_count"] = 0.0
    else:
        active = student_vle.copy()
        active["date"] = pd.to_numeric(active["date"], errors="coerce").fillna(0)
        active["sum_click"] = pd.to_numeric(active["sum_click"], errors="coerce").fillna(0)
        course_span = active.groupby(course_key)["date"].max().rename("course_days").reset_index()
        grouped = active.groupby(key).agg(
            active_days_count=("date", "nunique"),
            recent_activity_count=("date", lambda values: int((values >= max(values.max() - 7, 0)).sum())),
            total_clicks=("sum_click", "sum"),
            activity_weeks=("date", lambda values: int((values // 7).nunique())),
            last_active_day=("date", "max"),
        ).reset_index()
        grouped = grouped.merge(course_span, on=course_key, how="left")
        grouped["course_days"] = grouped["course_days"].replace(0, 1).fillna(1)
        grouped["course_weeks"] = (grouped["course_days"] / 7).clip(lower=1)
        grouped["attendance_rate"] = safe_divide(grouped["active_days_count"], grouped["course_days"]) * 100
        grouped["participation_rate"] = grouped.groupby(course_key)["total_clicks"].transform(percentile_rank)
        grouped["consistency_score"] = safe_divide(grouped["activity_weeks"], grouped["course_weeks"]) * 100
        activity = grouped[key + ["attendance_rate", "participation_rate", "consistency_score", "recent_activity_count"]]

    assessment_rows = student_assessment.merge(assessments, on="id_assessment", how="left")
    if assessment_rows.empty:
        assessment_features = base[key].copy()
        assessment_features["correctness_rate"] = 0.0
    else:
        assessment_rows["score"] = pd.to_numeric(assessment_rows["score"], errors="coerce").fillna(0)
        assessment_features = assessment_rows.groupby(key).agg(
            correctness_rate=("score", "mean"),
        ).reset_index()

    frame = base.merge(activity, on=key, how="left").merge(assessment_features, on=key, how="left")
    frame["engagement_score"] = engagement_score(frame)
    outcome = frame["final_result"].map(lambda value: str(value or "").strip().lower())
    frame["risk_label"] = _label_from_outcome_and_signals(
        frame,
        weak_outcome=outcome.isin({"fail", "withdrawn"}),
        partial_outcome=outcome.eq("pass"),
    )
    return finalize_training_frame(frame, "oulad")


def _find_kdd_truth_column(truth):
    lower_names = {column.lower(): column for column in truth.columns}
    for candidate in ("dropout", "truth", "label", "is_dropout"):
        if candidate in lower_names:
            return lower_names[candidate]
    if len(truth.columns) >= 2:
        return truth.columns[-1]
    raise ValueError("KDD truth file must include a dropout/label column")


def _read_kdd_truth(path: Path):
    pd = require_pandas()
    truth = read_csv(path)
    lower_names = {str(column).lower(): column for column in truth.columns}
    if "enrollment_id" in lower_names:
        return truth.rename(columns={lower_names["enrollment_id"]: "enrollment_id"})
    raw = pd.read_csv(path, header=None)
    if raw.shape[1] < 2:
        raise ValueError("KDD truth file must include enrollment_id and dropout/label columns")
    return raw.rename(columns={0: "enrollment_id", 1: "truth"})


def load_kdd_features(kdd_dir: str | Path):
    pd = require_pandas()
    root = Path(kdd_dir)
    files = _require_files_from_candidates(root, KDD_FILES, KDD_TRAIN_DIR_CANDIDATES)
    enrollments = read_csv(files["enrollment_train.csv"])
    logs = read_csv(files["log_train.csv"])
    truth = _read_kdd_truth(files["truth_train.csv"])

    if "enrollment_id" not in enrollments.columns or "enrollment_id" not in logs.columns:
        raise ValueError("KDD enrollment_train.csv and log_train.csv must include enrollment_id")
    truth_column = _find_kdd_truth_column(truth)
    if "enrollment_id" not in truth.columns:
        first_column = truth.columns[0]
        truth = truth.rename(columns={first_column: "enrollment_id"})

    logs = logs.copy()
    logs["time"] = pd.to_datetime(logs["time"], errors="coerce")
    logs["date"] = logs["time"].dt.date
    logs["week"] = logs["time"].dt.isocalendar().week.fillna(0).astype(int)
    event_counts = logs.pivot_table(
        index="enrollment_id",
        columns="event",
        values="time",
        aggfunc="count",
        fill_value=0,
    ).reset_index()
    grouped = logs.groupby("enrollment_id").agg(
        active_days_count=("date", "nunique"),
        activity_weeks=("week", "nunique"),
        event_count=("event", "count"),
        recent_activity_count=("time", lambda values: int((values >= values.max() - pd.Timedelta(days=7)).sum()) if values.notna().any() else 0),
        first_time=("time", "min"),
        last_time=("time", "max"),
    ).reset_index()
    grouped["course_days"] = (grouped["last_time"] - grouped["first_time"]).dt.days.clip(lower=1).fillna(1)
    grouped["course_weeks"] = (grouped["course_days"] / 7).clip(lower=1)
    grouped["attendance_rate"] = safe_divide(grouped["active_days_count"], grouped["course_days"]) * 100
    grouped["participation_rate"] = percentile_rank(grouped["event_count"])
    grouped["consistency_score"] = safe_divide(grouped["activity_weeks"], grouped["course_weeks"]) * 100

    problem_columns = [column for column in event_counts.columns if str(column).lower() in {"problem", "problem_check", "quiz"}]
    if problem_columns:
        problem_signal = event_counts[problem_columns].sum(axis=1)
        event_counts["correctness_rate"] = percentile_rank(problem_signal)
    else:
        event_counts["correctness_rate"] = 0.0

    frame = enrollments[["enrollment_id"]].drop_duplicates()
    frame = frame.merge(truth[["enrollment_id", truth_column]], on="enrollment_id", how="inner")
    frame = frame.merge(grouped, on="enrollment_id", how="left").merge(
        event_counts[["enrollment_id", "correctness_rate"]],
        on="enrollment_id",
        how="left",
    )
    frame["engagement_score"] = engagement_score(frame)
    dropout = pd.to_numeric(frame[truth_column], errors="coerce").fillna(0).astype(int)
    frame["risk_label"] = _label_from_outcome_and_signals(
        frame,
        weak_outcome=dropout == 1,
        partial_outcome=(dropout == 0) & (frame["engagement_score"].fillna(0) < 60),
    )
    return finalize_training_frame(frame, "kdd_cup_2015")


def load_unified_educational_features(oulad_dir: str | Path, kdd_dir: str | Path):
    pd = require_pandas()
    frames = [
        load_oulad_features(oulad_dir),
        load_kdd_features(kdd_dir),
    ]
    combined = pd.concat(frames, ignore_index=True)
    combined = combined.dropna(subset=[LABEL_ID_COLUMN])
    if combined[LABEL_ID_COLUMN].nunique() < 2:
        raise ValueError("Unified training requires at least two risk classes after preprocessing")
    return combined


def save_unified_training_dataset(
    oulad_dir: str | Path = DEFAULT_OULAD_DIR,
    kdd_dir: str | Path = DEFAULT_KDD_DIR,
    output_path: str | Path = DEFAULT_UNIFIED_DATASET_PATH,
):
    frame = load_unified_educational_features(oulad_dir, kdd_dir)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False)
    return frame, path


def unified_dataset_summary(frame) -> dict:
    return {
        "rows": int(len(frame)),
        "dataset_distribution": {
            str(key): int(value)
            for key, value in frame[DATASET_SOURCE_COLUMN].value_counts().sort_index().items()
        },
        "class_distribution": {
            str(key): int(value)
            for key, value in frame[LABEL_COLUMN].value_counts().sort_index().items()
        },
        "common_features": COMMON_EDUCATIONAL_FEATURE_COLUMNS,
    }
