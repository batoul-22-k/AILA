from __future__ import annotations

import random
from pathlib import Path

import pandas as pd


SEED = 42
ROW_COUNT = 10_000
OUTPUT_PATH = Path(__file__).resolve().parent / "synthetic_student_risk_dataset.csv"

# The CSV keeps gamification columns for UI/context experiments, but the
# XGBoost trainer ignores xp, level, badges_count, and streak to avoid circular
# reasoning from platform-generated outputs.
COLUMNS = [
    "student_id",
    "class_id",
    "attendance_rate",
    "participation_rate",
    "correctness_rate",
    "semantic_score",
    "engagement_score",
    "consistency_score",
    "response_time",
    "recent_activity_count",
    "xp",
    "level",
    "badges_count",
    "streak",
    "weak_concepts_count",
    "risk_label",
]

CLASS_COUNTS = {
    "low": 4_500,
    "medium": 3_500,
    "high": 2_000,
}


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return round(max(low, min(high, value)), 2)


def gaussian(mean: float, sd: float, low: float = 0.0, high: float = 100.0) -> float:
    return clamp(random.gauss(mean, sd), low, high)


def randint(low: int, high: int) -> int:
    return random.randint(low, high)


def engagement_score(row: dict) -> float:
    return clamp(
        (0.35 * float(row["attendance_rate"]))
        + (0.25 * float(row["participation_rate"]))
        + (0.25 * float(row["correctness_rate"]))
        + (0.10 * float(row["consistency_score"]))
        + (0.05 * min(float(row["recent_activity_count"]) * 10, 100))
        + random.gauss(0, 2.5)
    )


def base_features(risk_label: str) -> dict:
    if risk_label == "low":
        attendance = gaussian(86, 9, 45, 100)
        participation = gaussian(82, 11, 35, 100)
        correctness = gaussian(84, 9, 45, 100)
        consistency = gaussian(80, 12, 35, 100)
        recent_activity = randint(5, 18)
        response_time = round(random.lognormvariate(3.15, 0.35), 2)
        weak_concepts = max(0, int(random.gauss(0.6, 0.8)))
    elif risk_label == "medium":
        attendance = gaussian(62, 17, 15, 100)
        participation = gaussian(58, 18, 10, 100)
        correctness = gaussian(60, 17, 15, 100)
        consistency = gaussian(55, 18, 5, 100)
        recent_activity = randint(1, 10)
        response_time = round(random.lognormvariate(3.65, 0.45), 2)
        weak_concepts = max(0, int(random.gauss(2.2, 1.3)))
    else:
        attendance = gaussian(34, 18, 0, 90)
        participation = gaussian(32, 18, 0, 90)
        correctness = gaussian(38, 18, 0, 90)
        consistency = gaussian(30, 17, 0, 85)
        recent_activity = randint(0, 5)
        response_time = round(random.lognormvariate(4.05, 0.55), 2)
        weak_concepts = max(1, int(random.gauss(4.0, 1.7)))

    semantic = gaussian(correctness + random.gauss(0, 6), 5, 0, 100)
    xp_seed = (participation * 18) + (recent_activity * 28) + random.gauss(0, 120)
    xp = max(0, int(xp_seed))
    level = max(1, min(25, int(xp // 250) + 1))
    badges = max(0, min(18, int((correctness >= 80) + (attendance >= 80) + (xp // 650) + random.choice([0, 0, 1]))))
    streak = max(0, min(45, int((recent_activity * random.uniform(0.7, 1.9)) + random.gauss(0, 2))))

    return {
        "attendance_rate": attendance,
        "participation_rate": participation,
        "correctness_rate": correctness,
        "semantic_score": semantic,
        "consistency_score": consistency,
        "response_time": response_time,
        "recent_activity_count": recent_activity,
        "xp": xp,
        "level": level,
        "badges_count": badges,
        "streak": streak,
        "weak_concepts_count": weak_concepts,
    }


def apply_edge_case(row: dict, risk_label: str) -> None:
    roll = random.random()

    if roll < 0.035:
        row["attendance_rate"] = gaussian(88, 6, 70, 100)
        row["participation_rate"] = gaussian(72, 13, 35, 100)
        row["correctness_rate"] = gaussian(38, 10, 5, 60)
        row["semantic_score"] = gaussian(row["correctness_rate"] + 2, 8, 0, 70)
        row["weak_concepts_count"] = randint(3, 7)
    elif roll < 0.07:
        row["attendance_rate"] = gaussian(32, 10, 0, 55)
        row["participation_rate"] = gaussian(46, 18, 5, 90)
        row["correctness_rate"] = gaussian(82, 8, 60, 100)
        row["semantic_score"] = gaussian(84, 8, 55, 100)
        row["weak_concepts_count"] = randint(0, 2)
    elif roll < 0.105 and risk_label == "medium":
        row["xp"] = randint(2_500, 6_500)
        row["level"] = max(8, min(25, row["xp"] // 250))
        row["badges_count"] = randint(6, 14)
        row["streak"] = randint(8, 30)
        row["correctness_rate"] = gaussian(52, 14, 20, 78)
        row["weak_concepts_count"] = randint(2, 5)
    elif roll < 0.15:
        row["recent_activity_count"] = 0
        row["streak"] = 0
        row["consistency_score"] = min(row["consistency_score"], gaussian(35, 15, 0, 65))


def add_missing_and_zero_like_values(row: dict) -> None:
    nullable_columns = [
        "attendance_rate",
        "participation_rate",
        "correctness_rate",
        "semantic_score",
        "consistency_score",
        "response_time",
        "recent_activity_count",
        "xp",
        "level",
        "badges_count",
        "streak",
        "weak_concepts_count",
    ]
    zero_like_columns = [
        "recent_activity_count",
        "xp",
        "badges_count",
        "streak",
        "weak_concepts_count",
    ]

    for column in nullable_columns:
        if random.random() < 0.008:
            row[column] = None

    for column in zero_like_columns:
        if row.get(column) is not None and random.random() < 0.012:
            row[column] = 0


def synthetic_row(index: int, risk_label: str) -> dict:
    row = base_features(risk_label)
    apply_edge_case(row, risk_label)
    row["engagement_score"] = engagement_score(row)
    row["student_id"] = f"stu_{index:05d}"
    row["class_id"] = f"class_{randint(1, 40):03d}"
    row["risk_label"] = risk_label
    add_missing_and_zero_like_values(row)
    return {column: row.get(column) for column in COLUMNS}


def build_dataset() -> pd.DataFrame:
    random.seed(SEED)
    labels = [
        risk_label
        for risk_label, count in CLASS_COUNTS.items()
        for _ in range(count)
    ]
    random.shuffle(labels)
    rows = [synthetic_row(index, risk_label) for index, risk_label in enumerate(labels, start=1)]
    return pd.DataFrame(rows, columns=COLUMNS)


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    frame = build_dataset()
    frame.to_csv(OUTPUT_PATH, index=False)

    print(f"Saved dataset to: {OUTPUT_PATH}")
    print(f"Dataset shape: {frame.shape}")
    print("Class distribution:")
    print(frame["risk_label"].value_counts().sort_index().to_string())
    print("Missing value counts:")
    print(frame.isna().sum().to_string())
    print("First 5 rows:")
    print(frame.head(5).to_string(index=False))


if __name__ == "__main__":
    main()
