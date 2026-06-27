from __future__ import annotations

from pathlib import Path

from app.ml.risk_feature_engineering import (
    engagement_score,
    finalize_training_frame,
    percentile_rank,
    read_csv,
    require_files,
    require_pandas,
    safe_divide,
)


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


def _oulad_risk_label(final_result: str) -> str:
    result = str(final_result or "").strip().lower()
    if result == "distinction":
        return "low"
    if result == "pass":
        return "medium"
    return "high"


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
        assessment_features["semantic_score"] = 0.0
        assessment_features["response_time"] = 0.0
        assessment_features["weak_concepts_count"] = 0.0
    else:
        assessment_rows["score"] = pd.to_numeric(assessment_rows["score"], errors="coerce").fillna(0)
        assessment_rows["date_submitted"] = pd.to_numeric(assessment_rows["date_submitted"], errors="coerce")
        assessment_rows["date"] = pd.to_numeric(assessment_rows["date"], errors="coerce")
        assessment_rows["response_delay"] = (assessment_rows["date_submitted"] - assessment_rows["date"]).fillna(0)
        weak_by_type = (
            assessment_rows.assign(is_weak=assessment_rows["score"] < 60)
            .groupby(key + ["assessment_type"])["is_weak"]
            .mean()
            .reset_index()
        )
        weak_counts = (
            weak_by_type[weak_by_type["is_weak"] > 0.5]
            .groupby(key)["assessment_type"]
            .nunique()
            .rename("weak_concepts_count")
            .reset_index()
        )
        assessment_features = assessment_rows.groupby(key).agg(
            correctness_rate=("score", "mean"),
            semantic_score=("score", "mean"),
            response_time=("response_delay", "mean"),
        ).reset_index()
        assessment_features = assessment_features.merge(weak_counts, on=key, how="left")
        assessment_features["weak_concepts_count"] = assessment_features["weak_concepts_count"].fillna(0)

    frame = base.merge(activity, on=key, how="left").merge(assessment_features, on=key, how="left")
    return finalize_training_frame(frame, "oulad")


def _find_kdd_truth_column(truth):
    lower_names = {column.lower(): column for column in truth.columns}
    for candidate in ("dropout", "truth", "label", "is_dropout"):
        if candidate in lower_names:
            return lower_names[candidate]
    if len(truth.columns) >= 2:
        return truth.columns[-1]
    raise ValueError("KDD truth file must include a dropout/label column")


def load_kdd_features(kdd_dir: str | Path):
    pd = require_pandas()
    root = Path(kdd_dir)
    files = require_files(root, KDD_FILES)
    enrollments = read_csv(files["enrollment_train.csv"])
    logs = read_csv(files["log_train.csv"])
    truth = read_csv(files["truth_train.csv"])

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
    grouped["response_time"] = safe_divide(grouped["course_days"] * 24, grouped["event_count"].clip(lower=1))

    problem_columns = [column for column in event_counts.columns if str(column).lower() in {"problem", "problem_check", "quiz"}]
    if problem_columns:
        problem_signal = event_counts[problem_columns].sum(axis=1)
        event_counts["correctness_rate"] = percentile_rank(problem_signal)
        event_counts["weak_concepts_count"] = (event_counts["correctness_rate"] < 40).astype(int)
    else:
        event_counts["correctness_rate"] = 0.0
        event_counts["weak_concepts_count"] = 0.0

    frame = enrollments[["enrollment_id"]].drop_duplicates()
    frame = frame.merge(truth[["enrollment_id", truth_column]], on="enrollment_id", how="inner")
    frame = frame.merge(grouped, on="enrollment_id", how="left").merge(
        event_counts[["enrollment_id", "correctness_rate", "weak_concepts_count"]],
        on="enrollment_id",
        how="left",
    )
    frame["semantic_score"] = frame["correctness_rate"]
    frame["engagement_score"] = engagement_score(frame)
    dropout = pd.to_numeric(frame[truth_column], errors="coerce").fillna(0).astype(int)
    frame["risk_label"] = "low"
    frame.loc[(dropout == 0) & (frame["engagement_score"].fillna(0) < 60), "risk_label"] = "medium"
    frame.loc[dropout == 1, "risk_label"] = "high"
    return finalize_training_frame(frame, "kdd_cup_2015")
